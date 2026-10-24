// The editor's view of typed programs (src/lang/): blocks you click, holes
// that know their type, and the gestures that can't produce a type error.
//
// Every expression is a span with its node id and its inferred type, so the
// type of anything is a hover away. Edits are pure functions here; each is
// checked by re-inferring the whole program and refused if it adds an error.

import type { Code, Id, Node, NodeData, NodeOf } from "../src/model.ts";
import { children, collect, freshId, replace, subtree, swapIn } from "../src/model.ts";
import type { Names, Notation, Presentation } from "../src/presentation.ts";
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import { fillings, infer as check, type Filling, type Info } from "../src/lang/infer.ts";
import { isPublished } from "../src/model.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { B } from "../src/prelude.ts";
import { pinsOf, type Pins } from "../src/lang/signatures.ts";
import { addVariant, fillHole } from "../src/lang/refactor.ts";
import { ARITH, FALSE, TRUE } from "../src/lang/std.ts";
import { INT, schemeArith, showIn, showType } from "../src/lang/types.ts";
import { read as readInt } from "../src/lang/int.ts";
import type { Value } from "../src/lang/run.ts";
import { parseValue } from "../src/lang/values.ts";
import { blocksOf, litLabel, type Blk, type Piece } from "../src/lang/render.ts";

type Kid = HTMLElement | string | null | undefined | false;
function h(tag: string, attrs: Record<string, string | boolean | undefined> = {}, ...kids: Kid[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

export const typeOf = (info: Info | null, id: Id, names: Names): string | null => {
  const t = info?.typeOf.get(id);
  return t ? showIn(t, names, info!.subst) : null;
};

// ---------------------------------------------------------------- view

// The pane draws what the blocks text prints (render.ts blocksOf), so the
// two can't drift apart: a piece that stands for a node is a span you can
// click, with its type on hover; a group of lines is a box.
export function renderTyped(code: Code, pres: Presentation, info: Info | null, defId: Id, selected: Id | null): HTMLElement {
  const errorAt = new Map((info?.errors ?? []).map((e) => [e.id, e.message]));
  const cls = (id: Id | undefined, c: string | undefined) => (id ? `x ${c ?? ""}${selected === id ? " sel" : ""}${errorAt.has(id) ? " err" : ""}` : c);
  const title = (id: Id | undefined, more?: string) => {
    const said = id ? errorAt.get(id) ?? typeOf(info, id, pres.names) ?? undefined : undefined;
    return said && more ? `${said}\n\n${more}` : said ?? more;
  };
  // What only the pane shows (a name's type, a hole's) is marked aside.
  const piece = (p: Piece): Kid => (typeof p === "string" ? p : h("span", { class: `${cls(p.id, p.cls)}${p.pane ? " aside" : ""}`, "data-id": p.id, title: title(p.id, p.title) }, ...p.kids.map(piece)));
  const draw = (b: Blk): HTMLElement => {
    if ("line" in b) return h("div", { class: `ln${b.id ? ` ${cls(b.id, b.cls)}` : b.cls ? ` ${b.cls}` : ""}`, "data-id": b.id }, ...b.line.map(piece));
    const c = [b.pad ? "ind" : "", cls(b.id, b.cls) ?? ""].filter(Boolean).join(" ");
    return h("div", { class: c || undefined, "data-id": b.id, style: b.pad && b.pad !== 2 ? `padding-left: ${b.pad * 11}px` : undefined }, ...b.kids.map(draw));
  };
  return h("div", { class: "typed" }, ...blocksOf(code, pres, info, defId, { pane: true }).map(draw));
}

// ---------------------------------------------------------------- edits

export type TEdit = { ok: true; code: Code; names: Names; select?: Id; note: string } | { ok: false; reason: string };

// Names for messages: the library's and the presentation's, under the
// program's own (which are what edits change and store).
let display: Names = {};
export const setDisplayNames = (n: Names) => { display = n; };

// Accept only if the program has no more type errors than before.
// Every program is checked with the modules' pins, and without offering
// their helpers.
// The program's own pins (signatures.ts) join the modules'; a pin of a
// definition that's gone is dropped.
let programPins: Pins = {};
export const setProgramPins = (p: Pins) => { programPins = p; };
export const infer = (code: Code, names: Names = {}): Info => {
  const own = Object.fromEntries(Object.entries(programPins).filter(([d]) => code.nodes[d]?.kind === "def"));
  return check(code, names, undefined, { pins: { ...LIBRARY.pins, ...own }, hidden: LIBRARY.hidden });
};

// A published definition is named by its content, so it can't change: an
// edit that would change one is refused.
const published = Object.values(LIBRARY.code.nodes).filter((n) => isPublished(n.id));
export function changesPublished(code: Code): Id | null {
  const n = published.find((n) => code.nodes[n.id] !== n && JSON.stringify(code.nodes[n.id]) !== JSON.stringify(n));
  return n ? n.id.split(":")[0] : null;
}

export function guardTyped(before: Info, code: Code, names: Names, select: Id | undefined, note: string): TEdit {
  const lib = changesPublished(code);
  if (lib) return { ok: false, reason: `${names[lib] ?? display[lib] ?? "that"} is published in a module: it is named by what it says, so it can't change` };
  const after = infer(code, { ...display, ...names });
  if (after.errors.length > before.errors.length) return { ok: false, reason: after.errors.at(-1)!.message };
  return { ok: true, code, names, select, note };
}

export function fill(code: Code, names: Names, info: Info, hole: Id, f: Filling, label: string, defId?: Id): TEdit {
  const e = fillHole(code, names, hole, f, display);
  // Select the next hole in reading order, so filling goes on where it
  // should: inside what was just placed, else further on, else from the top.
  // A literal stays selected, to type its value.
  const next = defId && f.kind !== "lit" ? nextHole(e.code, defId, hole) : undefined;
  return guardTyped(info, e.code, e.names, next ?? hole, `Filled with ${label}.${defId && f.kind !== "lit" && !next ? " No holes left in this definition." : ""}`);
}

// Fill a hole with a value written out, the way values print: 3, "text",
// [3, 1, 2], circle(2). It becomes the code that builds it (literals and
// constructor calls), type-checked like any other filling. Arithmetic on
// values reads too: 1 + 2 is add(1, 2), and so do the names in scope
// there, the hole's inputs and lets first: x * 2 in double(x). A call
// reads as it prints, sqrt(x + 1), so it takes one fill, not two.
export function fillValue(code: Code, names: Names, info: Info, hole: Id, text: string, defId?: Id): TEdit {
  const all = { ...display, ...names };
  const scope = new Map<string, Id>();
  for (const d of code.defs) if (all[d]) scope.set(all[d], d);
  for (const b of defId ? scopeAt(code, defId, hole) : []) if (all[b]) scope.set(all[b], b);
  const r = typedOut(text, code, all, scope);
  if ("error" in r) return { ok: false, reason: r.error };
  // A name alone is already in the palette's list.
  if ("ref" in r) return { ok: false, reason: "a name alone is listed already" };
  // A whole number where an Int goes is an Int: 0 in slice's position.
  const whole = (v: Value): boolean => typeof v === "number" ? Number.isInteger(v) : typeof v === "object" && v !== null && "tag" in v && v.fields.some(whole);
  const wholes = (t: Typed): boolean => "value" in t ? whole(t.value) : "args" in t && t.args.some(wholes);
  // A name several things share (show, length) is each of them in turn,
  // and the first that type-checks there is the one meant.
  let first: TEdit | undefined;
  for (const t of readings(r)) {
    const plain = written(code, names, info, hole, text, t, false, defId);
    if (plain.ok) return plain;
    first ??= plain;
    if (!wholes(t)) continue;
    const int = written(code, names, info, hole, text, t, true, defId);
    if (int.ok) return int;
  }
  return first!;
}

// Each way to read what's typed, one id per called name: at most 16.
function readings(t: Typed): Typed[] {
  if (!("op" in t)) return [t];
  let out: Typed[][] = [[]];
  for (const a of t.args) out = out.flatMap((done) => readings(a).map((x) => [...done, x])).slice(0, 16);
  return (t.alts ?? [t.op]).flatMap((op) => out.map((args) => ({ op, args }))).slice(0, 16);
}

// What's typed, as values at the leaves of the operators the blocks draw
// (< ≤ = ++ + − · / …). Split at the last operator of the loosest kind
// outside brackets and text, so 1 − 2 − 3 is (1 − 2) − 3; a − with nothing
// before it negates. A leaf may be a name in scope.
// A leaf may also be a call written the way it prints, f(a, b), of a
// definition, a builtin or a constructor: `alts` when several share the name.
type Typed = { value: Value } | { ref: Id } | { op: Id; args: Typed[]; alts?: Id[] };
// The operators are read from the notation itself (styles/blocks.json),
// loosest first: each glyph is every function drawn with it, and the first
// that type-checks is the one meant. The generic arithmetic comes first, so
// + − × typed over Ints are Int's. Each also reads the way a keyboard
// types it: <= for ≤, * for ·. (^ groups to the right, which this split
// doesn't, so it isn't read yet.)
const KEYS: Record<string, string> = { "-": "−", "*": "·", "×": "·", "÷": "/", "<=": "≤", ">=": "≥" };
const glyphs = (fixity: string) => {
  const by = new Map<string, { prec: number; ids: Id[] }>();
  for (const [id, n] of Object.entries(blocksStyle.notation) as [Id, Notation][]) {
    if (n.fixity !== fixity || /^\p{L}/u.test(n.glyph) || n.glyph === "^") continue;
    const g = by.get(n.glyph) ?? { prec: n.prec ?? 5, ids: [] };
    g.ids.push(id);
    by.set(n.glyph, g);
  }
  for (const g of by.values()) g.ids.sort((a, b) => +b.startsWith("builtin.arith.") - +a.startsWith("builtin.arith."));
  return by;
};
const INFIX = glyphs("infix");
const OPS: [string, Id[]][][] = [...new Set([...INFIX.values()].map((g) => g.prec))].sort((a, b) => a - b).map((prec) => {
  const level = [...INFIX].filter(([, g]) => g.prec === prec).map(([glyph, g]): [string, Id[]] => [glyph, g.ids]);
  const keyed = Object.entries(KEYS).flatMap(([key, glyph]): [string, Id[]][] => (INFIX.get(glyph)?.prec === prec ? [[key, INFIX.get(glyph)!.ids]] : []));
  // Longest first: <= before <, ++ before +.
  return [...level, ...keyed].sort((a, b) => b[0].length - a[0].length);
});
const NEGATE = glyphs("prefix").get("−")?.ids ?? [ARITH.neg];
function typedOut(text: string, code: Code, names: Names, scope: Map<string, Id>): Typed | { error: string } {
  const t = text.trim();
  const named = scope.get(t);
  if (named) return { ref: named };
  const r = parseValue(text, code, names);
  if (!("error" in r)) return { value: r.value };
  for (const level of OPS) {
    let depth = 0, quoted = false;
    for (let i = t.length - 1; i > 0; i--) {
      const c = t[i];
      if (c === '"' && t[i - 1] !== "\\") quoted = !quoted;
      if (quoted) continue;
      if (")]".includes(c)) depth++;
      else if ("([".includes(c)) depth--;
      const op = depth === 0 ? level.find(([sym]) => t.slice(i - sym.length + 1, i + 1) === sym) : undefined;
      if (!op) continue;
      const left = t.slice(0, i - op[0].length + 1).trimEnd();
      if (!left || OPS.flat().some(([sym]) => left.endsWith(sym))) continue;
      const a = typedOut(left, code, names, scope), b = typedOut(t.slice(i + 1), code, names, scope);
      const alts = op[1].filter((id) => code.nodes[id]);
      if (!("error" in a) && !("error" in b) && alts.length) return { op: alts[0], args: [a, b], alts };
    }
  }
  const neg = /^[-−]\s*(.+)$/s.exec(t);
  if (neg) {
    const a = typedOut(neg[1], code, names, scope);
    const alts = NEGATE.filter((id) => code.nodes[id]);
    if (!("error" in a) && alts.length) return { op: alts[0], args: [a], alts };
  }
  if (t.startsWith("(") && t.endsWith(")")) { const inner = typedOut(t.slice(1, -1), code, names, scope); if (!("error" in inner)) return inner; }
  const call = /^([^\s()[\],"]+)\s*\((.*)\)$/s.exec(t);
  const parts = call ? topLevel(call[2]) : undefined;
  if (call && parts) {
    const named = scope.get(call[1]);
    // Out of scope, a binder or a field isn't something to call.
    const callable = (id: Id) => !["binder", "field"].includes(code.nodes[id]?.kind);
    const alts = [...new Set([...(named ? [named] : []), ...Object.keys(names).filter((id) => names[id] === call[1] && callable(id))])];
    const args = parts.map((a) => typedOut(a, code, names, scope));
    if (alts.length && parts.length && args.every((a) => !("error" in a))) return { op: alts[0], args: args as Typed[], alts };
  }
  return r;
}

// The arguments of a call, split at its own commas: none inside brackets
// or text. Undefined when the brackets don't close where they should.
function topLevel(text: string): string[] | undefined {
  const out: string[] = [];
  let depth = 0, quoted = false, from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if ("([".includes(c)) depth++;
    else if (")]".includes(c) && --depth < 0) return undefined;
    else if (c === "," && depth === 0) { out.push(text.slice(from, i)); from = i + 1; }
  }
  if (depth || quoted) return undefined;
  const last = text.slice(from);
  return last.trim() || out.length ? [...out, last] : [];
}

function written(code: Code, names: Names, info: Info, hole: Id, text: string, typed: Typed, int: boolean, defId?: Id): TEdit {
  const nodes = { ...code.nodes };
  // Typed alone, an Int is read from the text, so one past 2⁵³ stays exact.
  const exact = /^\s*-?\d+\s*$/.test(text) ? readInt(text.trim())[0] : undefined;
  const build = (v: Value, at?: Id): Id => {
    const id = at ?? freshId();
    if (int && typeof v === "number" && Number.isInteger(v)) {
      const n = exact ?? v;
      nodes[id] = { id, kind: "lit", value: typeof n === "number" ? n : String(n), of: INT };
    } else if (typeof v === "number" || typeof v === "string") nodes[id] = { id, kind: "lit", value: v };
    else if (typeof v === "object" && "tag" in v) {
      const fn = v.fields.length ? freshId() : id;
      nodes[fn] = { id: fn, kind: "ref", target: v.tag };
      if (v.fields.length) nodes[id] = { id, kind: "call", fn, args: v.fields.map((x) => build(x)) };
    } else throw new Error("only plain values can be written out");
    return id;
  };
  const tree = (t: Typed, at?: Id): Id => {
    if ("value" in t) return build(t.value, at);
    if ("ref" in t) { const id = at ?? freshId(); nodes[id] = { id, kind: "ref", target: t.ref }; return id; }
    const id = at ?? freshId(), fn = freshId();
    nodes[fn] = { id: fn, kind: "ref", target: t.op };
    nodes[id] = { id, kind: "call", fn, args: t.args.map((a) => tree(a)) };
    return id;
  };
  tree(typed, hole);
  const next = { nodes, defs: code.defs };
  const after = defId ? nextHole(next, defId, hole) : undefined;
  return guardTyped(info, next, names, after ?? hole, `Filled with ${text.trim()}.`);
}

// The next hole after `id` in reading order, or the first one.
// Reading order is the order the views show: the tree's, except that a
// match on a Bool reads as if/then/else, so its true case comes first.
export function readingOrder(code: Code, root: Id): Id[] {
  const out: Id[] = [];
  const walk = (id: Id) => {
    const n = code.nodes[id];
    if (!n) return;
    out.push(id);
    const cs = children(n);
    if (n.kind === "match") {
      const t = cs.findIndex((c) => (code.nodes[c] as NodeOf<"arm">).variant === TRUE);
      const f = cs.findIndex((c) => (code.nodes[c] as NodeOf<"arm">).variant === FALSE);
      if (t >= 0 && f >= 0 && f < t) [cs[t], cs[f]] = [cs[f], cs[t]];
    }
    cs.forEach(walk);
  };
  walk(root);
  return out;
}

export function nextHole(code: Code, defId: Id, id: Id): Id | undefined {
  const order = readingOrder(code, defId);
  const holes = order.filter((x) => code.nodes[x].kind === "hole");
  const at = order.indexOf(id);
  return holes.find((h) => order.indexOf(h) > at) ?? holes[0];
}

export function toHole(code: Code, names: Names, info: Info, id: Id): TEdit {
  return guardTyped(info, replace(code, id, () => ({ kind: "hole" })), names, id, "Cleared to a hole. It knows its type: pick from the palette to fill it.");
}

export function setLit(code: Code, names: Names, info: Info, id: Id, raw: string): TEdit {
  const old = code.nodes[id] as NodeOf<"lit">;
  if (old.of === INT) {
    // Any size; digits are kept as text when they don't fit a safe integer.
    const [n] = readInt(raw.trim());
    if (n === undefined) return { ok: false, reason: "this is a whole number; that isn't one" };
    return guardTyped(info, replace(code, id, () => ({ kind: "lit", value: typeof n === "number" ? n : String(n), of: INT })), names, id, "Changed a literal.");
  }
  const v = typeof old.value === "number" ? Number(raw) : raw;
  if (typeof v === "number" && !Number.isFinite(v)) return { ok: false, reason: "this is a number; that isn't one" };
  return guardTyped(info, replace(code, id, () => ({ ...old, kind: "lit", value: v })), names, id, "Changed a literal.");
}

// Binders visible at `id`: lambda params, let names, arm bindings.
export function scopeAt(code: Code, defId: Id, id: Id): Id[] {
  const def = code.nodes[defId] as NodeOf<"def">;
  let found: Id[] | null = null;
  const walk = (n: Id, scope: Id[]) => {
    if (found) return;
    if (n === id) { found = scope; return; }
    const x = code.nodes[n];
    switch (x.kind) {
      case "lambda": walk(x.body, [...scope, ...x.params]); return;
      case "call":
        if (code.nodes[x.fn].kind === "lambda") {
          x.args.forEach((a) => walk(a, scope));
          const lam = code.nodes[x.fn] as NodeOf<"lambda">;
          if (lam.id === id) { found = scope; return; }
          walk(lam.body, [...scope, ...lam.params]);
        } else [x.fn, ...x.args].forEach((a) => walk(a, scope));
        return;
      case "match": case "fold":
        walk(x.scrutinee, scope);
        for (const a of x.arms) {
          const arm = code.nodes[a] as NodeOf<"arm">;
          if (a === id) { found = scope; return; }
          walk(arm.body, [...scope, ...arm.binds, ...arm.results.filter((r): r is Id => r !== null)]);
        }
        if (x.kind === "match" && x.otherwise) walk(x.otherwise, scope);
        return;
      case "solve":
        Object.values(x.given).forEach((g) => walk(g, scope));
        walk(x.body, [...scope, ...Object.values(x.binds)]);
        return;
    }
  };
  if (def.body) walk(def.body, []);
  return found ?? [];
}

// The data type a binder holds, if it's one with cases.
export function dataTypeOf(code: Code, info: Info, b: Id): Id | null {
  const t = info.typeOf.get(b);
  if (!t) return null;
  const r = info.subst.resolve(t);
  return r.t === "con" && [...info.owner.values()].includes(r.id) ? r.id : null;
}

// Copy a subtree with fresh ids, binders included (refs to them follow).
function copyTree(code: Code, nodes: Record<Id, Node>, names: Names, root: Id, map = new Map<Id, Id>()): Id {
  const go = (id: Id): Id => {
    const n = code.nodes[id];
    if (n.kind === "ref") return mk({ kind: "ref", target: map.get(n.target) ?? n.target });
    if (n.kind === "binder") { const nid = mk({ kind: "binder" }); map.set(id, nid); if (names[id] !== undefined) names[nid] = names[id]; return nid; }
    switch (n.kind) {
      case "call": { const fn = go(n.fn); return mk({ kind: "call", fn, args: n.args.map(go) }); }
      case "lambda": { const params = n.params.map(go); return mk({ kind: "lambda", params, body: go(n.body) }); }
      case "match": { const s = go(n.scrutinee); const arms = n.arms.map(go); return mk({ kind: "match", scrutinee: s, arms, otherwise: n.otherwise ? go(n.otherwise) : null }); }
      case "fold": { const s = go(n.scrutinee); return mk({ kind: "fold", scrutinee: s, arms: n.arms.map(go) }); }
      case "arm": { const binds = n.binds.map(go); const results = n.results.map((r) => (r ? go(r) : null)); return mk({ kind: "arm", variant: n.variant, binds, results, body: go(n.body) }); }
      case "solve": {
        const given = Object.fromEntries(Object.entries(n.given).map(([k, v]) => [k, go(v)]));
        const binds = Object.fromEntries(Object.entries(n.binds).map(([k, v]) => [k, go(v)]));
        return mk({ kind: "solve", fn: map.get(n.fn) ?? n.fn, given, binds, body: go(n.body) });
      }
      default: return mk({ ...n, id: undefined } as unknown as NodeData);
    }
  };
  const mk = (d: NodeData): Id => { const id = freshId(); const { id: _, ...rest } = d as NodeData & { id?: Id }; nodes[id] = { id, ...rest } as Node; return id; };
  return go(root);
}

// ---------------------------------------------------------------- copy and paste
//
// A copied piece is its nodes and the names of what it binds. Pasted into a
// hole it gets fresh ids, so the copy is a new piece with the same shape;
// variables it binds itself come along, variables from outside are kept
// where the hole can see them and become holes where it can't, and anything
// the program doesn't have (a definition from another program) becomes a
// hole too. Then it's type-checked like any other edit.

export interface Clip { nodes: Record<Id, Node>; root: Id; names: Names }

export function copyOf(code: Code, names: Names, id: Id): Clip {
  const ids = subtree(code, id);
  return { nodes: Object.fromEntries(ids.map((x) => [x, code.nodes[x]])), root: id, names: Object.fromEntries(ids.filter((x) => names[x] !== undefined).map((x) => [x, names[x]])) };
}

export function paste(code: Code, names: Names, info: Info, defId: Id, clip: Clip, hole: Id): TEdit {
  if (code.nodes[hole]?.kind !== "hole") return { ok: false, reason: "select a hole to paste into" };
  const scope = new Set(scopeAt(code, defId, hole));
  const nodes = { ...code.nodes };
  const nn = { ...names };
  const map = new Map<Id, Id>();
  let lost = 0;
  const mk = (d: NodeData, id = freshId()): Id => { nodes[id] = { id, ...d } as Node; return id; };
  const bind = (b: Id): Id => { const nb = mk({ kind: "binder" }); map.set(b, nb); if (clip.names[b] !== undefined) nn[nb] = clip.names[b]; return nb; };
  const go = (id: Id, at = freshId()): Id => {
    const n = clip.nodes[id];
    switch (n.kind) {
      case "ref": {
        if (map.has(n.target)) return mk({ kind: "ref", target: map.get(n.target)! }, at);
        const t = code.nodes[n.target];
        if (!t || (t.kind === "binder" && !scope.has(n.target))) { lost++; return mk({ kind: "hole" }, at); }
        return mk({ kind: "ref", target: n.target }, at);
      }
      case "call": { const fn = go(n.fn); return mk({ kind: "call", fn, args: n.args.map((a) => go(a)) }, at); }
      case "lambda": { const params = n.params.map(bind); return mk({ kind: "lambda", params, body: go(n.body) }, at); }
      case "match": case "fold": {
        if (n.arms.some((a) => !code.nodes[(clip.nodes[a] as NodeOf<"arm">).variant])) { lost++; return mk({ kind: "hole" }, at); }
        const scrutinee = go(n.scrutinee);
        const arms = n.arms.map((a) => {
          const arm = clip.nodes[a] as NodeOf<"arm">;
          const binds = arm.binds.map(bind);
          const results = arm.results.map((r) => (r ? bind(r) : null));
          return mk({ kind: "arm", variant: arm.variant, binds, results, body: go(arm.body) });
        });
        return n.kind === "match" ? mk({ kind: "match", scrutinee, arms, otherwise: n.otherwise ? go(n.otherwise) : null }, at) : mk({ kind: "fold", scrutinee, arms }, at);
      }
      case "solve": {
        if (!code.nodes[n.fn]) { lost++; return mk({ kind: "hole" }, at); }
        const given = Object.fromEntries(Object.entries(n.given).map(([k, g]) => [k, go(g)]));
        const binds = Object.fromEntries(Object.entries(n.binds).map(([k, b]) => [k, bind(b)]));
        return mk({ kind: "solve", fn: n.fn, given, binds, body: go(n.body) }, at);
      }
      case "lit": return mk({ kind: "lit", value: n.value }, at);
      default: return mk({ kind: "hole" }, at);
    }
  };
  // The root takes the hole's id, so what was attached to the hole stays.
  go(clip.root, hole);
  const note = `Pasted a copy.${lost ? ` ${lost} part${lost === 1 ? "" : "s"} that can't be reached here became hole${lost === 1 ? "" : "s"}.` : ""}`;
  return guardTyped(info, { nodes, defs: code.defs }, nn, hole, note);
}

// Case split: replace an expression by a match on a variable, with one arm
// per case of its type, each starting as a copy of the expression. The
// arms come from the type, so no case is missing; each copy can then be
// changed for its case.
export function splitOn(code: Code, names: Names, info: Info, expr: Id, on: Id): TEdit {
  const type = dataTypeOf(code, info, on);
  if (!type) return { ok: false, reason: "that variable's type has no cases" };
  const nodes = { ...code.nodes };
  const nn = { ...names };
  const td = code.nodes[(code.nodes[type] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  const mk = (d: NodeData): Id => { const id = freshId(); nodes[id] = { id, ...d } as Node; return id; };
  const arms = td.variants.map((v) => {
    const binds = (code.nodes[v] as NodeOf<"variant">).fields.map((f) => { const b = mk({ kind: "binder" }); nn[b] = names[f] ?? display[f] ?? "field"; return b; });
    return mk({ kind: "arm", variant: v, binds, results: binds.map(() => null), body: copyTree(code, nodes, nn, expr) });
  });
  const scrutinee = mk({ kind: "ref", target: on });
  const next = replace({ nodes, defs: code.defs }, expr, () => ({ kind: "match", scrutinee, arms, otherwise: null }));
  return guardTyped(info, next, nn, expr, `Split on ${names[on] ?? "it"}: one case per ${display[type] ?? names[type] ?? "variant"}, each a copy to change.`);
}

// Use a variable in an input: the input's current contents are replaced by
// a reference to it. Refused when it isn't in scope there or doesn't fit.
export function useVar(code: Code, names: Names, info: Info, defId: Id, binder: Id, slot: Id): TEdit {
  const cur = code.nodes[slot];
  if (cur?.kind === "ref" && cur.target === binder) return { ok: false, reason: "already that" };
  if (!scopeAt(code, defId, slot).includes(binder)) return { ok: false, reason: `${display[binder] ?? names[binder] ?? "it"} isn't in scope here` };
  const next = collect(replace(code, slot, () => ({ kind: "ref", target: binder })));
  return guardTyped(info, next, names, slot, `Wired ${display[binder] ?? names[binder] ?? "the variable"} in. Same as picking it from the palette: by id, type-checked.`);
}

// ---------------------------------------------------------------- dots
//
// A let is a dot on a wire, as in a node editor: one value, branching to
// every place that uses it. In the tree that is `let b = value in body`,
// where the binder b *is* the dot: the shared output. Its name lives in
// names.json like any other, so it can have none; then the views show a
// handle (•1, •2) that is never stored.

const lets = (code: Code, defId: Id): NodeOf<"call">[] => {
  const out: NodeOf<"call">[] = [];
  const def = code.nodes[defId] as NodeOf<"def">;
  const stack = def.body ? [def.body] : [];
  while (stack.length) {
    const n = code.nodes[stack.pop()!];
    if (!n) continue;
    if (n.kind === "call" && code.nodes[n.fn]?.kind === "lambda") out.push(n);
    if (n.kind === "call") stack.push(...[...n.args, n.fn].reverse());
    else if (n.kind === "lambda") stack.push(n.body);
    else if (n.kind === "match" || n.kind === "fold") stack.push(...(n.kind === "match" && n.otherwise ? [n.otherwise] : []), ...[...n.arms].reverse(), n.scrutinee);
    else if (n.kind === "arm") stack.push(n.body);
    else if (n.kind === "solve") stack.push(n.body, ...Object.values(n.given).reverse());
  }
  return out;
};

export const isDot = (code: Code, defId: Id, b: Id) => lets(code, defId).some((l) => (code.nodes[l.fn] as NodeOf<"lambda">).params.includes(b));

// Display handles for dots without a name, in reading order.
export function dotHandles(code: Code, defId: Id, names: Names): Names {
  const out: Names = {};
  let k = 0;
  for (const l of lets(code, defId)) for (const p of (code.nodes[l.fn] as NodeOf<"lambda">).params) if (names[p] === undefined) out[p] = `•${++k}`;
  return out;
}

export const usesOf = (code: Code, b: Id): Id[] => Object.values(code.nodes).filter((n) => n.kind === "ref" && n.target === b).map((n) => n.id);

// Put a dot on the wire out of `slot`: its value moves to a dot at the start
// of the innermost body around it (a function's, a case's, a let's), where
// everything after can reach it, and the wire runs from the dot to where the
// value was. Nothing in scope changes on the way up: only bodies bind names.
export function addDot(code: Code, names: Names, info: Info, defId: Id, slot: Id): TEdit {
  const cur = code.nodes[slot];
  if (!cur) return { ok: false, reason: "nothing there" };
  if (cur.kind === "hole") return { ok: false, reason: "a hole has no value to share yet" };
  if (cur.kind === "ref" && code.nodes[cur.target]?.kind === "binder") return { ok: false, reason: "that wire already comes from a variable: drag from it instead" };
  const walk = (n: Id, r: Id): Id | null => {
    if (n === slot) return r;
    const x = code.nodes[n];
    switch (x?.kind) {
      case "lambda": return walk(x.body, x.body);
      case "call": for (const c of [x.fn, ...x.args]) { const f = walk(c, r); if (f) return f; } return null;
      case "match": case "fold": {
        const f = walk(x.scrutinee, r);
        if (f) return f;
        for (const a of x.arms) { const ab = (code.nodes[a] as NodeOf<"arm">).body; const g = walk(ab, ab); if (g) return g; }
        return x.kind === "match" && x.otherwise ? walk(x.otherwise, x.otherwise) : null;
      }
      case "solve": for (const g of Object.values(x.given)) { const f = walk(g, r); if (f) return f; } return walk(x.body, x.body);
      default: return null;
    }
  };
  const def = code.nodes[defId] as NodeOf<"def">;
  const at = def.body ? walk(def.body, def.body) : null;
  if (!at) return { ok: false, reason: "that isn't inside this definition" };
  const dot = freshId(), use = freshId(), lam = freshId(), let_ = freshId();
  // Point the body's parent at the let first, then the value's at the use,
  // so each node has exactly one parent when the next swap looks.
  let next = swapIn(code, at, let_);
  if (at !== slot) next = swapIn(next, slot, use);
  next.nodes[dot] = { id: dot, kind: "binder" };
  next.nodes[use] = { id: use, kind: "ref", target: dot };
  next.nodes[lam] = { id: lam, kind: "lambda", params: [dot], body: at === slot ? use : at };
  next.nodes[let_] = { id: let_, kind: "call", fn: lam, args: [slot] };
  return guardTyped(info, next, names, dot, "Put a dot on that wire. Drag from the dot to any input it can reach to use the same value there; naming it is optional.");
}

// A new value of its own, not wired anywhere yet: a dot holding a hole, as
// the first step of the definition's body (where everything in it can
// reach it). Fill the hole, then drag from the dot to wherever the value
// goes. It's how the graph adds a node in empty space without a node that
// belongs to nothing: every node is still part of the tree.
// With `before`, the step goes just before that part instead (one arm of a
// match, say: print the usage, then return 2).
export function addStep(code: Code, names: Names, info: Info, defId: Id, before?: Id): TEdit & { dot?: Id } {
  const def = code.nodes[defId] as NodeOf<"def">;
  const top = def?.body ? code.nodes[def.body] : null;
  if (!top) return { ok: false, reason: "this definition has no body yet: fill it first" };
  if (top.kind === "typedef") return { ok: false, reason: "a data type has no steps; add a case or a field instead" };
  if (before !== undefined && (!["lit", "ref", "call", "lambda", "match", "fold", "hole"].includes(code.nodes[before]?.kind) || !subtree(code, defId).includes(before)))
    return { ok: false, reason: "a step goes before a value of this definition" };
  const at = before ?? (top.kind === "lambda" ? top.body : def.body!);
  const dot = freshId(), hole = freshId(), lam = freshId(), let_ = freshId();
  const next = swapIn(code, at, let_);
  next.nodes[dot] = { id: dot, kind: "binder" };
  next.nodes[hole] = { id: hole, kind: "hole" };
  next.nodes[lam] = { id: lam, kind: "lambda", params: [dot], body: at };
  next.nodes[let_] = { id: let_, kind: "call", fn: lam, args: [hole] };
  const r = guardTyped(info, next, names, hole, "Added a value: a dot holding a hole. Fill the hole, then drag from the dot to where the value goes.");
  return r.ok ? { ...r, dot } : r;
}

// The reverse: a dot with one wire out goes back to being a plain wire.
export function removeDot(code: Code, names: Names, info: Info, defId: Id, dot: Id): TEdit {
  const l = lets(code, defId).find((c) => (code.nodes[c.fn] as NodeOf<"lambda">).params.includes(dot));
  if (!l) return { ok: false, reason: "that isn't a dot" };
  const uses = usesOf(code, dot);
  if (uses.length === 0) return { ok: false, reason: "nothing reads this dot; it is there for what its value does. Clear the value to drop it" };
  if (uses.length > 1) return { ok: false, reason: `it feeds ${uses.length} places; disconnect all but one first` };
  const lam = code.nodes[l.fn] as NodeOf<"lambda">;
  const i = lam.params.indexOf(dot);
  const value = l.args[i];
  let next: Code = { nodes: { ...code.nodes }, defs: code.defs };
  next.nodes[lam.id] = { ...lam, params: lam.params.filter((_, j) => j !== i) };
  next.nodes[l.id] = { ...l, args: l.args.filter((_, j) => j !== i) };
  next = swapIn(next, uses[0], value);
  if (lam.params.length === 1) next = swapIn(next, l.id, (next.nodes[lam.id] as NodeOf<"lambda">).body);
  const nn = { ...names };
  delete nn[dot];
  return guardTyped(info, collect(next), nn, value, "Removed the dot: the value is back on its one wire.");
}

// Drag a node's output onto another input: the value gets a dot (or uses
// the one it has) and the input is wired from it. The first step is the
// same for every input, so the editor checks each one against `prepare`.
export function prepareShare(code: Code, names: Names, info: Info, defId: Id, from: Id): { dot: Id; code: Code; names: Names; info: Info } | { reason: string } {
  const owner = lets(code, defId).find((l) => l.args.includes(from));
  if (owner) return { dot: (code.nodes[owner.fn] as NodeOf<"lambda">).params[owner.args.indexOf(from)], code, names, info };
  const r = addDot(code, names, info, defId, from);
  if (!r.ok) return { reason: r.reason };
  return { dot: r.select!, code: r.code, names: r.names, info: infer(r.code, { ...display, ...r.names }) };
}

export function share(code: Code, names: Names, info: Info, defId: Id, from: Id, slot: Id): TEdit {
  const p = prepareShare(code, names, info, defId, from);
  if ("reason" in p) return { ok: false, reason: p.reason };
  if (slot === from) return { ok: false, reason: "that's where it already goes" };
  const r = useVar(p.code, p.names, p.info, defId, p.dot, slot);
  return r.ok ? { ...r, select: p.dot, note: "Shared it: the value now has a dot, wired to both inputs." } : r;
}

export function addCase(code: Code, names: Names, info: Info, type: Id, name: string, fields: { name: string; type: Id }[]): TEdit {
  if (!name.trim()) return { ok: false, reason: "a case needs a name" };
  const before = new Set(info.holes.keys());
  const e = addVariant(code, names, type, name.trim(), fields);
  const r = guardTyped(info, e.code, e.names, e.variant, "");
  if (!r.ok) return r;
  const holes = [...infer(e.code, { ...display, ...e.names }).holes.keys()].filter((k) => !before.has(k)).length;
  return { ...r, note: `Added ${name.trim()}. ${holes ? `${holes} match${holes === 1 ? "" : "es"} and fold${holes === 1 ? "" : "s"} got a new case with a hole to fill, so none is missing a case.` : "Nothing matches on this type yet."}` };
}

export { fillings, litLabel, type Filling, type Info };

// ---------------------------------------------------------------- pins and copies
//
// A pin freezes the type the checker gives a definition now, so it becomes
// an interface (src/lang/signatures.ts): an edit inside that would change
// it is refused at the definition, and callers are checked against the pin.
// Pins are a side table like names (signatures in the file), so pinning
// never changes the code.

export type PinEdit = { ok: true; pins: Pins; note: string } | { ok: false; reason: string };

export function pin(code: Code, info: Info, pins: Pins, def: Id, name: string): PinEdit {
  if (isPublished(def)) return { ok: false, reason: `${name} is published, so it's pinned already` };
  if (subtree(code, def).some((x) => code.nodes[x].kind === "hole")) return { ok: false, reason: `${name} has holes: fill them first, so the pin promises the type it will have` };
  if (info.errors.some((e) => subtree(code, def).includes(e.id))) return { ok: false, reason: `${name} has a type error to fix first` };
  const p = pinsOf(info, [def]);
  if (!p[def]) return { ok: false, reason: `${name} has no type yet` };
  return { ok: true, pins: { ...pins, ...p }, note: `Pinned ${name} at ${showType(p[def].type, display, schemeArith(p[def]))}: edits inside it must keep that type, and callers see only it.` };
}

export function unpin(pins: Pins, def: Id, name: string): PinEdit {
  if (!pins[def]) return { ok: false, reason: `${name} isn't pinned` };
  const { [def]: _, ...rest } = pins;
  return { ok: true, pins: rest, note: `Unpinned ${name}: its type follows its body again.` };
}

// A published definition can't change (it is named by what it says). To
// change one, copy it into the program: a new definition with the same body
// under fresh ids, which the program's own calls now use. Recursive calls
// in the copy call the copy. The library's version stays as it was.
export function copyIntoProgram(code: Code, names: Names, info: Info, def: Id, name: string): TEdit {
  const d = code.nodes[def];
  if (d?.kind !== "def" || !d.body || !isPublished(def)) return { ok: false, reason: "only a published definition is copied in; your own you can edit" };
  const nodes = { ...code.nodes };
  const nn = { ...names };
  const copy = freshId();
  // Names of what the copy binds come from the library's names.
  const all: Names = { ...LIBRARY.names, ...display, ...names };
  const body = copyTree(code, nodes, all, d.body, new Map([[def, copy]]));
  for (const id of Object.keys(nodes)) if (!code.nodes[id] && all[id] !== undefined) nn[id] = all[id];
  nodes[copy] = { id: copy, kind: "def", body };
  const taken = new Set(Object.values({ ...display, ...names }));
  let label = `my ${name}`;
  for (let k = 2; taken.has(label); k++) label = `my ${name} ${k}`;
  nn[copy] = label;
  // The program's own calls switch to the copy; the library's don't.
  let uses = 0;
  for (const n of Object.values(code.nodes)) {
    if (n.kind === "ref" && n.target === def && !LIBRARY.code.nodes[n.id]) { nodes[n.id] = { ...n, target: copy }; uses++; }
  }
  const next: Code = { nodes, defs: [...code.defs, copy] };
  return guardTyped(info, next, nn, copy, `Copied ${name} into the program as ${label}${uses ? `; the ${uses === 1 ? "call" : `${uses} calls`} here now use it` : ""}. Edit it freely: the published ${name} is unchanged.`);
}
