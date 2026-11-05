// A definition group's check, kept by what it depends on (L215a,
// docs/design/tools/CHECK-BY-GROUP-2026-11-03.md). A group (one
// definition, or a mutually recursive group) has the same check result
// whenever its definitions' nodes are the same and so are the schemes of
// what it calls, the program's data types, its values (implementations and
// embeddings among them) and the check's options. The key holds the
// callees' schemes, not their code, so an edit that keeps a definition's
// type stops there: its callers' keys don't change (early cutoff).
//
// A result is closed: its types' variables are numbered from 0 with what
// the checker knows of them (plain, a number, an interface needed, a row
// inside another), and copying it into a check numbers them anew there.
// Only a group the check found no problem in, with no holes, whose
// variables no other group shares, is kept: what it gives is then all
// in the result.
//
// infer(code, names, reuse, { cache }) reads and fills one. The test is
// test/check-cache.test.ts: random edits to the examples, each checked
// with the cache and from scratch, compared node by node.
//
// Influences: Unison (definitions checked once, by the hash of what they
// mean), Salsa and Adapton (incremental queries), GHC's recompilation
// avoidance by interface fingerprints, and "Build systems à la carte"
// (Mokhov, Mitchell and Peyton Jones, ICFP 2018) for early cutoff.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { conditionResults, isCall, isUse, subtree } from "../model.ts";
import { EMBEDDING_V } from "./std.ts";
import type { Info, Options } from "./infer.ts";
import type { Arith, Row, Scheme, Subst, Type } from "./types.ts";

// A closed group: everything the check gave it, numbered from 0.
interface Closed {
  defs: Id[];
  // Variables 0..size-1; `rows` says which are row tails.
  size: number;
  rows: number[];
  schemes: [Id, Scheme][];
  divergent: Id[];
  typeOf: [Id, Type][];
  opAt: [Id, Type][];
  solveAt: [Id, Type][];
  embedded: [Id, { def: Id; from: Type; to: Type; of?: Type & { t: "fn" } }][];
  answered: Id[];
  spread: Id[];
  reshape: [Id, { size: number; tupled: boolean }][];
  wanted: { t: Type; iface: Id; at: Id }[];
  // What the checker knows of each variable.
  plain: number[];
  numbers: number[];
  arith: [number, Arith][];
  fractional: number[];
  whole: number[];
  noWorld: number[];
  needs: [number, Id, Id][];
  subs: { from: Row; to: Row; at?: Id }[];
}

// Renumbers the variables of the types it is given, in the order they are
// met, from 0.
class Closer {
  map = new Map<number, number>();
  rows: number[] = [];
  private s: Subst;
  constructor(s: Subst) { this.s = s; }
  v(x: number, row = false): number {
    let k = this.map.get(x);
    if (k === undefined) { k = this.map.size; this.map.set(x, k); if (row) this.rows.push(k); }
    return k;
  }
  type(t: Type): Type {
    t = this.s.resolve(t);
    if (t.t === "var") return { t: "var", v: this.v(t.v) };
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map((a) => this.type(a)) };
    return { t: "fn", params: t.params.map((p) => this.type(p)), ret: this.type(t.ret), eff: this.row(t.eff) };
  }
  row(r: Row): Row {
    const z = this.s.resolveRow(r);
    const out: Row = { effs: z.effs, tail: z.tail === null ? null : this.v(z.tail, true) };
    if (z.args) out.args = Object.fromEntries(Object.entries(z.args).map(([e, xs]) => [e, xs.map((x) => this.type(x))]));
    if (z.name !== undefined) out.name = z.name;
    return out;
  }
  scheme(sc: Scheme): Scheme {
    const type = this.type(sc.type);
    const n = (xs: number[] | undefined) => xs?.map((x) => this.v(x));
    const out: Scheme = { vars: sc.vars.map((x) => this.v(x)), rows: sc.rows.map((x) => this.v(x, true)), type };
    for (const f of ["plain", "numbers", "arith", "less", "ordered", "fractional", "whole", "noWorld"] as const) if (sc[f]) out[f] = n(sc[f]);
    if (sc.needs) out.needs = sc.needs.map(([v, i]) => [this.v(v), i]);
    if (sc.subs) out.subs = sc.subs.map(([a, b]) => [this.v(a, true), this.v(b, true)]);
    return out;
  }
}

// Numbers a closed result's variables from `base` in the check's Subst.
class Opener {
  private base: number;
  constructor(base: number) { this.base = base; }
  v = (x: number) => x + this.base;
  type = (t: Type): Type =>
    t.t === "var" ? { t: "var", v: this.v(t.v) } : t.t === "con" ? { t: "con", id: t.id, args: t.args.map(this.type) } : { t: "fn", params: t.params.map(this.type), ret: this.type(t.ret), eff: this.row(t.eff) };
  row = (r: Row): Row => {
    const out: Row = { effs: r.effs, tail: r.tail === null ? null : this.v(r.tail) };
    if (r.args) out.args = Object.fromEntries(Object.entries(r.args).map(([e, xs]) => [e, xs.map(this.type)]));
    if (r.name !== undefined) out.name = r.name;
    return out;
  };
  scheme = (sc: Scheme): Scheme => {
    const out: Scheme = { vars: sc.vars.map(this.v), rows: sc.rows.map(this.v), type: this.type(sc.type) };
    for (const f of ["plain", "numbers", "arith", "less", "ordered", "fractional", "whole", "noWorld"] as const) if (sc[f]) out[f] = sc[f]!.map(this.v);
    if (sc.needs) out.needs = sc.needs.map(([v, i]) => [this.v(v), i]);
    if (sc.subs) out.subs = sc.subs.map(([a, b]) => [this.v(a), this.v(b)]);
    return out;
  };
}

// A scheme printed with its variables numbered from 0, for a key.
const schemeText = new WeakMap<Scheme, string>();
function canonical(sc: Scheme, s: Subst, frozen: boolean): string {
  const was = frozen ? schemeText.get(sc) : undefined;
  if (was) return was;
  const text = JSON.stringify(new Closer(s).scheme(sc));
  if (frozen) schemeText.set(sc, text);
  return text;
}

// Each layer under a check (the library's, L216) by a number, for keys.
const layerIds = new WeakMap<Info, number>();
let layerCount = 0;
const layerId = (l: Info | null) => { if (!l) return 0; let n = layerIds.get(l); if (n === undefined) layerIds.set(l, (n = ++layerCount)); return n; };

// A definition's nodes as text. Nodes are never changed in place, so each
// one's text is kept with it.
const nodeText = new WeakMap<object, string>();
// A list of ids as text, kept with the list.
const idsTexts = new WeakMap<object, string>();
const idsText = (xs?: Iterable<Id>) => { if (!xs) return null; let t = idsTexts.get(xs); if (t === undefined) idsTexts.set(xs, (t = JSON.stringify([...xs].sort()))); return t; };
// The data types a layer checked (its parts' owners).
const layerTypes = new WeakMap<Info, { types: Set<Id> }>();
const layerParts = (l: Info) => { let p = layerTypes.get(l); if (!p) layerTypes.set(l, (p = { types: new Set(l.owner.values()) })); return p; };
const textOf = (n: Node) => { let t = nodeText.get(n); if (t === undefined) nodeText.set(n, (t = JSON.stringify(n))); return t; };
// A definition's nodes as a number standing for their text (L215c2), the
// same number for the same text. The nodes it was last asked with are
// kept by its id, so after an edit elsewhere the same node objects are
// answered without writing the text out again (an edit's keys wrote out
// every group's, 11 ms of an edit in Spacetime). A number is never given
// to two texts: when the texts are forgotten, numbering goes on.
const defTexts = new Map<Id, { nodes: Node[]; n: number }>();
const textNumbers = new Map<string, number>();
let textCount = 0;
const defText = (code: Code, d: Id): number => {
  const ids = subtree(code, d);
  const was = defTexts.get(d);
  if (was && was.nodes.length === ids.length && ids.every((id, i) => code.nodes[id] === was.nodes[i])) return was.n;
  const nodes = ids.map((id) => code.nodes[id]);
  const text = nodes.map(textOf).join(",");
  let n = textNumbers.get(text);
  if (n === undefined) {
    if (textNumbers.size > 50_000) { textNumbers.clear(); defTexts.clear(); }
    textNumbers.set(text, (n = ++textCount));
  }
  defTexts.set(d, { nodes, n });
  return n;
};
// Long texts that recur (what every group sees) by a short number, so a
// key doesn't repeat them.
const interned = new Map<string, number>();
let internCount = 0;
const intern = (t: string) => { let n = interned.get(t); if (n === undefined) { if (interned.size > 64) interned.clear(); interned.set(t, (n = ++internCount)); } return n; };

export class CheckCache {
  private kept = new Map<string, Closed>();
  hits = 0;
  misses = 0;
  private limit: number;
  constructor(limit = 4000) { this.limit = limit; }
  get size() { return this.kept.size; }
  private get(k: string) { const c = this.kept.get(k); if (c) { this.kept.delete(k); this.kept.set(k, c); } return c; }
  private set(k: string, c: Closed) {
    this.kept.set(k, c);
    // The least recently used go first.
    while (this.kept.size > this.limit) this.kept.delete(this.kept.keys().next().value!);
  }

  // One check's use of the cache: infer calls take(group) before it
  // checks each group, done() after the last, and end() before it returns.
  begin(a: { code: Code; info: Info; s: Subst; deps: (d: Id) => Id[]; layer: Info | null; opts: Options; valueDefs: Id[]; typeDefs: Id[] }) {
    const { code, info, s, deps, layer, opts } = a;
    // Only a check over the library's kept check (L216) uses the cache: a
    // check of everything is the library's own, made once, or the
    // palette's trial of one filling, thrown away, and keying either costs
    // more than it saves.
    if (!layer) return undefined;
    const start = s.next;
    // What every group sees: the data types, the values (implementations
    // and embeddings are values), the options and the layer under. The
    // layer's own definitions are as it checked them.
    const under = layerParts(layer);
    // An implementation or an embedding is a value written as its record
    // (infer.ts implementations, embedding): what every group may be
    // resolved through. Other values are groups like the rest (L215c).
    const isImplementation = (d: Id) => {
      const b = (code.nodes[d] as NodeOf<"def">).body, n = b ? code.nodes[b] : undefined;
      if (!n) return true;
      if (n.kind === "lambda") return false;
      const f = isCall(n) ? code.nodes[n.fn] : undefined;
      if (f?.kind !== "ref") return false;
      if (f.target === EMBEDDING_V) return true;
      const t = info.owner.get(f.target), td = t ? code.nodes[(code.nodes[t] as NodeOf<"def">)?.body ?? ""] : undefined;
      return td?.kind === "typedef" && !!td.interface;
    };
    const global = intern(JSON.stringify([
      layerId(layer), idsText(opts.hidden), idsText(opts.insiders), idsText(opts.library),
      a.typeDefs.filter((d) => !under.types.has(d)).map((d) => defText(code, d)),
      a.valueDefs.filter((d) => !layer.schemes.has(d) && isImplementation(d)).map((d) => defText(code, d)),
    ]));
    const missed: { group: Id[]; key: string; from: number; to: number }[] = [];
    const keyOf = (group: Id[]): string | null => {
      const own = new Set(group);
      const seen: string[] = [];
      for (const d of [...new Set(group.flatMap(deps))].filter((x) => !own.has(x)).sort()) {
        const sc = info.schemes.get(d);
        if (!sc) return null;
        seen.push(d, canonical(sc, s, layer?.schemes.get(d) === sc), info.divergent.has(d) ? "!" : "");
      }
      return JSON.stringify([global, group.map((d) => defText(code, d)), group.map((d) => opts.pins?.[d] ?? null), seen]);
    };
    const finish = () => { const last = missed[missed.length - 1]; if (last && last.to < 0) last.to = s.wanted.length; };
    return {
      // Copies the group's kept result in, or says it has none.
      take: (group: Id[]): boolean => {
        finish();
        const key = keyOf(group);
        const c = key === null ? undefined : this.get(key);
        if (!c) { this.misses++; if (key !== null) missed.push({ group, key, from: s.wanted.length, to: -1 }); return false; }
        this.hits++;
        const o = new Opener(s.next);
        s.next += c.size;
        for (const v of c.plain) s.plain.add(o.v(v));
        for (const v of c.numbers) s.numbers.add(o.v(v));
        for (const [v, k] of c.arith) s.arith.set(o.v(v), k);
        for (const v of c.fractional) s.fractional.add(o.v(v));
        for (const v of c.whole) s.whole.add(o.v(v));
        for (const v of c.noWorld) s.noWorld.add(o.v(v));
        for (const [v, i, at] of c.needs) { const m = s.needs.get(o.v(v)) ?? new Map<Id, Id>(); m.set(i, at); s.needs.set(o.v(v), m); }
        for (const x of c.subs) s.subs.push({ from: o.row(x.from), to: o.row(x.to), ...(x.at !== undefined ? { at: x.at } : {}) });
        for (const w of c.wanted) s.wanted.push({ t: o.type(w.t), iface: w.iface, at: w.at });
        for (const [d, sc] of c.schemes) info.schemes.set(d, o.scheme(sc));
        for (const d of c.divergent) info.divergent.add(d);
        for (const [id, t] of c.typeOf) info.typeOf.set(id, o.type(t));
        for (const [id, t] of c.opAt) info.opAt!.set(id, o.type(t));
        if (c.solveAt.length) { info.solveAt ??= new Map(); for (const [id, t] of c.solveAt) info.solveAt.set(id, o.type(t)); }
        if (c.embedded.length) {
          info.embedded ??= new Map();
          for (const [id, e] of c.embedded) info.embedded.set(id, { def: e.def, from: o.type(e.from), to: o.type(e.to), ...(e.of ? { of: o.type(e.of) as Type & { t: "fn" } } : {}) });
        }
        for (const id of c.answered) info.answered!.add(id);
        for (const id of c.spread) info.spread!.add(id);
        for (const [id, r] of c.reshape) info.reshape!.set(id, r);
        return true;
      },
      done: finish,
      // Keeps each group checked here that can be kept.
      end: () => {
        finish();
        if (!missed.length) return;
        const groupOf = new Map<Id, number>();
        missed.forEach((m, i) => { for (const d of m.group) for (const id of subtree(code, d)) groupOf.set(id, i); });
        const bad = new Set<number>();
        for (const e of info.errors) { const g = groupOf.get(e.id); if (g !== undefined) bad.add(g); }
        for (const id of info.holes.keys()) { const g = groupOf.get(id); if (g !== undefined) bad.add(g); }
        // Not kept: definitions with results, directions or ways, whose
        // checks reach outside the group (results(), predicates).
        // A group that runs a definition backwards neither: whether it can
        // be run that way is the callee's body's to say (modes.ts).
        missed.forEach((m, i) => {
          for (const d of m.group) {
            const n = code.nodes[d] as NodeOf<"def">;
            if (conditionResults(code.nodes, d) || n.direction || n.way || subtree(code, d).some((id) => isUse(code.nodes[id]))) bad.add(i);
          }
        });
        // Each variable's group, from every type the check gave: one met
        // in two groups, or made before this check, keeps both out.
        const varGroup = new Map<number, number>();
        const note = (t: Type, g: number) => {
          t = s.resolve(t);
          if (t.t === "var") { claim(t.v, g); return; }
          if (t.t === "con") { for (const x of t.args) note(x, g); return; }
          for (const p of t.params) note(p, g);
          note(t.ret, g);
          noteRow(t.eff, g);
        };
        const noteRow = (r: Row, g: number) => { const z = s.resolveRow(r); if (z.tail !== null) claim(z.tail, g); for (const xs of Object.values(z.args ?? {})) for (const x of xs) note(x, g); };
        const claim = (v: number, g: number) => {
          if (v < start) { bad.add(g); return; }
          const was = varGroup.get(v);
          if (was === undefined) varGroup.set(v, g);
          else if (was !== g) { bad.add(was); bad.add(g); }
        };
        const own = <V>(m: Map<Id, V> | undefined) => (m ? [...((m as { own?: () => Iterable<[Id, V]> }).own?.() ?? m.entries())] : []);
        const typeOf = own(info.typeOf), opAt = own(info.opAt), solveAt = own(info.solveAt);
        // Every variable the check's own types hold, by group (-1: none).
        const where = (id: Id) => groupOf.get(id) ?? -1;
        for (const [id, t] of typeOf) note(t, where(id));
        for (const [id, t] of opAt) note(t, where(id));
        for (const [id, t] of solveAt) note(t, where(id));
        for (const [id, e] of info.embedded ?? []) { note(e.from, where(id)); note(e.to, where(id)); if (e.of) note(e.of, where(id)); }
        for (const [d, sc] of info.schemes) { if (layer?.schemes.get(d) === sc) continue; note(sc.type, where(d)); }
        for (const w of s.wanted) note(w.t, w.at ? where(w.at) : -1);
        for (const c of s.subs) {
          const f = s.resolveRow(c.from).tail, t = s.resolveRow(c.to).tail;
          const gf = f === null ? undefined : varGroup.get(f), gt = t === null ? undefined : varGroup.get(t);
          if (gf !== gt) { if (gf !== undefined) bad.add(gf); if (gt !== undefined) bad.add(gt); }
        }
        bad.delete(-1);
        const typeOfBy = new Map<number, [Id, Type][]>();
        for (const e of typeOf) { const g = groupOf.get(e[0]); if (g !== undefined && !bad.has(g)) { let xs = typeOfBy.get(g); if (!xs) typeOfBy.set(g, (xs = [])); xs.push(e); } }
        missed.forEach((m, i) => {
          if (bad.has(i)) return;
          const cl = new Closer(s);
          const ids = m.group.flatMap((d) => subtree(code, d));
          const mine = <V>(xs: [Id, V][]) => xs.filter(([id]) => groupOf.get(id) === i);
          const c: Closed = {
            defs: m.group, size: 0, rows: [],
            schemes: m.group.map((d) => [d, cl.scheme(info.schemes.get(d)!)]),
            divergent: m.group.filter((d) => info.divergent.has(d)),
            typeOf: (typeOfBy.get(i) ?? []).map(([id, t]) => [id, cl.type(t)]),
            opAt: mine(opAt).map(([id, t]) => [id, cl.type(t)]),
            solveAt: mine(solveAt).map(([id, t]) => [id, cl.type(t)]),
            embedded: mine([...(info.embedded ?? [])]).map(([id, e]) => [id, { def: e.def, from: cl.type(e.from), to: cl.type(e.to), ...(e.of ? { of: cl.type(e.of) as Type & { t: "fn" } } : {}) }]),
            answered: ids.filter((id) => (info.answered as Set<Id> | undefined)?.has(id) && !layer?.answered?.has(id)),
            spread: ids.filter((id) => (info.spread as Set<Id> | undefined)?.has(id) && !layer?.spread?.has(id)),
            reshape: mine(own(info.reshape)),
            wanted: s.wanted.slice(m.from, m.to).map((w) => ({ t: cl.type(w.t), iface: w.iface, at: w.at })),
            plain: [], numbers: [], arith: [], fractional: [], whole: [], noWorld: [], needs: [], subs: [],
          };
          for (const x of s.subs) {
            const f = s.resolveRow(x.from).tail;
            if (f !== null && varGroup.get(f) === i) c.subs.push({ from: cl.row(x.from), to: cl.row(x.to), ...(x.at !== undefined ? { at: x.at } : {}) });
          }
          for (const [old, k] of cl.map) {
            if (s.plain.has(old)) c.plain.push(k);
            if (s.numbers.has(old)) c.numbers.push(k);
            const ar = s.arith.get(old);
            if (ar) c.arith.push([k, ar]);
            if (s.fractional.has(old)) c.fractional.push(k);
            if (s.whole.has(old)) c.whole.push(k);
            if (s.noWorld.has(old)) c.noWorld.push(k);
            for (const [iface, at] of s.needs.get(old) ?? []) c.needs.push([k, iface, at]);
          }
          c.size = cl.map.size;
          c.rows = cl.rows;
          this.set(m.key, c);
        });
      },
    };
  }
}
