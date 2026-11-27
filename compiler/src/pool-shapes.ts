// A pool's systems told which shapes of item they touch (G4, ENTITIES.md
// "Archetype tables"). A game keeps its entities in a `Pool Thing`, each
// Thing a record whose components are Optional parts, and a system is
// written over the whole pool (GAPS.md game round 2, the greenhouse):
//
//   updated in pool(things, (t) => nibbled(t, movers, grid))
//
// where `nibbled` matches `t.leaf` and gives a Thing with no leaf back as
// it was. Written so, the system walks every moth to change 24 plants.
// An item's shape is which of its Optional parts it has. For each shape
// the system's function is run here on what the shape alone says (its
// parts there or not, everything else unknown): where it surely gives the
// item back, or the test surely passes it (`kept in pool`) or surely fails
// it (`keep` over `pool items`), the call is told it need not look at that
// shape:
//
//   updated in pool shaped(things, Thing's pool shape, [shapes with a leaf], …)
//
// The prelude's meaning of each is the word it was written as, given the
// function or test only for the items of those shapes. A pool stored as a
// table per shape (map-tree.ts "tables") walks only those tables; the
// pool's `empty pool`, written at the type, is made knowing the shape so
// its tables are kept from the start.
//
// Only functions and tests that surely finish and do nothing else, so not
// calling one changes nothing but the time. Taken in the program's own
// definitions, before the representations are chosen (ters/cli/represented.ts).

import { freshId, isCall, subtree, copyNodes, dropNode, mapIds, type Code, type Id, type Node, type NodeOf } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, type Info, type Options } from "../../ters/src/lang/infer.ts";
import { preludeDef } from "../../ters/src/lang/arith.ts";
import { CONS, FALSE, INT_OPS, NIL, NONE, OPTIONAL, POOL, S, SOME, TRUE } from "../../ters/src/lang/std.ts";
import { INT, type Type } from "../../ters/src/lang/types.ts";
import { PRELUDE } from "../../ters/src/lang/library.ts";

const UPDATED = preludeDef("updated in pool"), KEPT = preludeDef("kept in pool"), ITEMS = preludeDef("pool items"), KEEP = preludeDef("keep"), EMPTY = preludeDef("empty pool");
const UPDATED_S = preludeDef("updated in pool shaped"), KEPT_S = preludeDef("kept in pool shaped"), ITEMS_S = preludeDef("pool items shaped"), EMPTY_S = preludeDef("empty pool shaped");
const POOL_SHAPE = preludeDef("Pool shape"), UPDATED_A = preludeDef("updated in pool keeping shapes");
// At most this many Optional parts: 2⁶ shapes, each run once here.
const MOST_PARTS = 6;

// The record types a pool holds, with their Optional parts.
interface Shaped { type: Id; variant: Id; fields: Id[]; parts: number[] }
// A call told its shapes: where it is, what it becomes.
interface Told { at: Id; kind: "updated" | "kept" | "items" | "empty"; type: Id; pool?: Id; fn?: Id; shapes: number[]; keep?: Id; copy?: boolean; alike?: boolean }

// `told`: the calls told their shapes, by kind, each with its shapes.
export function poolShapes(code: Code, info: Info, names: Names, own: Id[], opts: Options): { code: Code; info: Info; names: Names; made: Id[]; told: { kind: Told["kind"]; shapes: number[]; alike: boolean }[] } | null {
  if (!UPDATED || !KEPT || !ITEMS || !KEEP || !EMPTY || !UPDATED_S || !KEPT_S || !ITEMS_S || !EMPTY_S || !POOL_SHAPE || !UPDATED_A) return null;
  const nodeAt = (id: Id): Node | undefined => code.nodes[id] ?? PRELUDE.code.nodes[id];
  const shapeVariant = (nodeAt((nodeAt(POOL_SHAPE) as NodeOf<"def">).body!) as NodeOf<"typedef">).variants[0];
  const zonk = (id: Id): Type | undefined => { const t = info.typeOf.get(id); return t && info.subst.zonk(t); };
  const refTo = (id: Id) => { const n = code.nodes[id]; return n?.kind === "ref" ? n.target : undefined; };
  // A function type that does nothing but compute, and surely finishes.
  const pureType = (t: Type | undefined) => !!t && t.t === "fn" && info.subst.resolveRow(t.eff).effs.length === 0;
  // A function given (a definition, or a lambda) that does nothing but
  // compute, and surely finishes, whatever the call it is given to
  // allows (keep's test may choose): a definition by its own type, a
  // lambda by what it calls.
  const pureDef = (d: Id) => { const sc = info.schemes.get(d); return !info.divergent.has(d) && pureType(sc ? sc.type : zonk(d)); };
  const pure = (f: Id): boolean => {
    const t = refTo(f);
    if (t !== undefined) return code.nodes[t]?.kind === "def" && pureDef(t);
    const inside = subtree(code, f);
    const called = new Set(inside.flatMap((x) => { const n = code.nodes[x]; return isCall(n) ? [n.fn] : []; }));
    return inside.every((x) => {
      const n = code.nodes[x];
      if (n.kind !== "ref") return true;
      const k = code.nodes[n.target]?.kind ?? PRELUDE.code.nodes[n.target]?.kind;
      if (k === "binder" || k === "variant" || k === "field") return true;
      if (called.has(x)) return pureType(zonk(x)) || (k === "def" && pureDef(n.target));
      return k === "def" && pureDef(n.target);
    });
  };
  const shapedOf = new Map<Id, Shaped | null>();
  // The item type of a Pool T, when T is one of the program's records with Optional parts.
  const itemOf = (t: Type | undefined): Shaped | null => {
    if (!t || t.t !== "con" || t.id !== POOL || t.args.length !== 1) return null;
    const a = t.args[0];
    if (a.t !== "con" || a.args.length) return null;
    if (shapedOf.has(a.id)) return shapedOf.get(a.id)!;
    let found: Shaped | null = null;
    const body = (code.nodes[a.id] as NodeOf<"def"> | undefined)?.body;
    const td = body ? code.nodes[body] : undefined;
    if (td?.kind === "typedef" && !td.params.length && td.variants.length === 1 && !td.effect && !td.interface) {
      const v = code.nodes[td.variants[0]] as NodeOf<"variant">;
      const parts = v.fields.flatMap((f, i) => { const ty = code.nodes[(code.nodes[f] as NodeOf<"field">).type]; return ty?.kind === "tref" && ty.target === OPTIONAL ? [i] : []; });
      if (parts.length && parts.length <= MOST_PARTS) found = { type: a.id, variant: v.id, fields: v.fields, parts };
    }
    shapedOf.set(a.id, found);
    return found;
  };

  // ---- What a function gives for an item of a shape, worked out from the
  // shape alone.
  // An item made anew of the pool's type: `parts`, whether each Optional
  // part is there (null where not known).
  type V = { k: "item" } | { k: "part"; there: boolean } | { k: "bool"; v: boolean } | { k: "made"; parts: (boolean | null)[] } | { k: "?" };
  const UNKNOWN: V = { k: "?" };
  const same = (a: V, b: V) => a.k === b.k && (a.k !== "bool" || a.v === (b as { v: boolean }).v) && (a.k !== "part" || a.there === (b as { there: boolean }).there)
    && (a.k !== "made" || a.parts.every((x, i) => x === (b as { parts: (boolean | null)[] }).parts[i]));
  function run(sh: Shaped, shape: number, id: Id, env: Map<Id, V>, depth: number): V {
    const n = code.nodes[id];
    if (!n) return UNKNOWN;
    if (n.kind === "ref") return env.get(n.target) ?? (n.target === TRUE ? { k: "bool", v: true } : n.target === FALSE ? { k: "bool", v: false } : n.target === NONE ? { k: "part", there: false } : UNKNOWN);
    if (n.kind === "match") {
      const v = run(sh, shape, n.scrutinee, env, depth);
      const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
      const pick = v.k === "part" ? (v.there ? SOME : NONE) : v.k === "bool" ? (v.v ? TRUE : FALSE) : undefined;
      const inArm = (a: NodeOf<"arm">) => { const e = new Map(env); for (const b of a.binds) e.set(b, UNKNOWN); return run(sh, shape, a.body, e, depth); };
      if (pick !== undefined) {
        const arm = arms.find((a) => a.variant === pick && a.value === undefined);
        if (arm) return inArm(arm);
        return n.otherwise ? run(sh, shape, n.otherwise, env, depth) : UNKNOWN;
      }
      // Not known which: what every arm gives, when they all give it.
      const all = [...arms.map(inArm), ...(n.otherwise ? [run(sh, shape, n.otherwise, env, depth)] : [])];
      return all.length && all.every((x) => same(x, all[0])) ? all[0] : UNKNOWN;
    }
    if (!isCall(n) || !n.args) return UNKNOWN;
    const fn = code.nodes[n.fn];
    if (fn?.kind === "lambda") {
      // A let: its value bound for its body.
      const e = new Map(env);
      fn.params.forEach((p, i) => e.set(p, n.args![i] !== undefined ? run(sh, shape, n.args![i], env, depth) : UNKNOWN));
      return run(sh, shape, fn.body, e, depth);
    }
    const target = refTo(n.fn);
    if (target === undefined) return UNKNOWN;
    const args = n.args.map((a) => run(sh, shape, a, env, depth));
    // A part of the item: there or not, as the shape says.
    const field = sh.fields.indexOf(target);
    if (field >= 0 && args.length === 1 && args[0].k === "item") {
      const j = sh.parts.indexOf(field);
      return j >= 0 ? { k: "part", there: (shape & (1 << j)) !== 0 } : UNKNOWN;
    }
    // An Optional part made: `some(…)` is there.
    if (target === SOME && args.length === 1) return { k: "part", there: true };
    // The pool's own type made anew: which parts it has.
    if (target === sh.variant && args.length === sh.fields.length) return { k: "made", parts: sh.parts.map((i) => (args[i].k === "part" ? args[i].there : null)) };
    if (target === S.and || target === S.or) {
      const [a, b] = args;
      const stop = target === S.or;
      if ((a.k === "bool" && a.v === stop) || (b?.k === "bool" && b.v === stop)) return { k: "bool", v: stop };
      return a.k === "bool" && b?.k === "bool" ? { k: "bool", v: !stop } : UNKNOWN;
    }
    if (target === S.not) return args[0]?.k === "bool" ? { k: "bool", v: !args[0].v } : UNKNOWN;
    // One of the program's own functions given what is known: run in turn.
    if (depth < 8 && own.includes(target) && args.some((a) => a.k !== "?")) {
      const lam = code.nodes[(code.nodes[target] as NodeOf<"def">).body ?? ""];
      if (lam?.kind !== "lambda" || lam.params.length !== args.length) return UNKNOWN;
      return run(sh, shape, lam.body, new Map(lam.params.map((p, i) => [p, args[i]] as const)), depth + 1);
    }
    return UNKNOWN;
  }
  // What f gives for an item of each shape: f a lambda, or one of the program's definitions.
  const lambdaOf = (f: Id): NodeOf<"lambda"> | null => {
    const n = code.nodes[f];
    if (n?.kind === "lambda") return n.params.length === 1 ? n : null;
    const t = refTo(f);
    const lam = t !== undefined && own.includes(t) ? code.nodes[(code.nodes[t] as NodeOf<"def">).body ?? ""] : undefined;
    return lam?.kind === "lambda" && lam.params.length === 1 ? lam : null;
  };
  // The shapes for which `skip` doesn't hold of what f gives, and whether
  // f surely gives each of those an item of its own shape back.
  const shapesWhere = (sh: Shaped, f: Id, skip: (v: V) => boolean): { shapes: number[]; alike: boolean } | null => {
    const lam = lambdaOf(f);
    if (!lam || !pure(f)) return null;
    const shapes: number[] = [];
    let alike = true;
    for (let s = 0; s < 1 << sh.parts.length; s++) {
      const v = run(sh, s, lam.body, new Map([[lam.params[0], { k: "item" } as V]]), 0);
      if (skip(v)) continue;
      shapes.push(s);
      if (!(v.k === "item" || (v.k === "made" && v.parts.every((x, j) => x === ((s & (1 << j)) !== 0))))) alike = false;
    }
    return { shapes, alike };
  };

  // ---- The calls.
  // Each let's name, by what it names.
  const letValue = new Map<Id, Id>();
  for (const d of own) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if (!isCall(n) || !n.args) continue;
    const fn = code.nodes[n.fn];
    if (fn?.kind === "lambda") fn.params.forEach((p, i) => { if (n.args![i] !== undefined) letValue.set(p, n.args![i]); });
  }
  // An expression of names and fields only, so reading it again is the same.
  const readsOnly = (id: Id): boolean => {
    const n = code.nodes[id];
    if (n?.kind === "ref") return code.nodes[n.target]?.kind === "binder";
    return isCall(n) && !!n.args && n.args.length === 1 && code.nodes[refTo(n.fn) ?? ""]?.kind === "field" && readsOnly(n.args[0]);
  };
  // pool items(p) at a, or a let's name for it (p read again, so names and fields only).
  const itemsOf = (a: Id): { sh: Shaped; pool: Id; copy: boolean } | null => {
    const given = code.nodes[a];
    const bound = given?.kind === "ref" ? letValue.get(given.target) : undefined;
    const inner = bound !== undefined ? code.nodes[bound] : given;
    if (!isCall(inner) || !inner.args || refTo(inner.fn) !== ITEMS || inner.args.length !== 1) return null;
    if (bound !== undefined && !readsOnly(inner.args[0])) return null;
    const sh = itemOf(zonk(inner.args[0]));
    return sh ? { sh, pool: inner.args[0], copy: bound !== undefined } : null;
  };
  // Each of the program's definitions by the inputs it reads only once, as
  // what keep keeps from: the test there.
  const keptParams = new Map<Id, (Id | undefined)[]>();
  for (const d of own) {
    const lam = code.nodes[(code.nodes[d] as NodeOf<"def">).body ?? ""];
    if (lam?.kind !== "lambda") continue;
    const inside = subtree(code, lam.id);
    const uses = new Map<Id, Id[]>();
    for (const x of inside) { const r = code.nodes[x]; if (r.kind === "ref" && lam.params.includes(r.target)) uses.set(r.target, [...(uses.get(r.target) ?? []), x]); }
    const tests = lam.params.map((p) => {
      const us = uses.get(p);
      if (us?.length !== 1) return undefined;
      const k = inside.find((x) => { const c = code.nodes[x]; return isCall(c) && !!c.args && refTo(c.fn) === KEEP && c.args.length === 2 && c.args[0] === us[0]; });
      return k === undefined ? undefined : (code.nodes[k] as NodeOf<"call"> & { args: Id[] }).args[1];
    });
    if (tests.some((x) => x !== undefined)) keptParams.set(d, tests);
  }
  const told: Told[] = [];
  for (const d of own) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if (n.kind === "ref" && n.target === EMPTY) {
      const sh = itemOf(zonk(id));
      if (sh) told.push({ at: id, kind: "empty", type: sh.type, shapes: [] });
      continue;
    }
    if (!isCall(n) || !n.args) continue;
    const t = refTo(n.fn);
    if ((t === UPDATED || t === KEPT) && n.args.length === 2) {
      const sh = itemOf(zonk(n.args[0]));
      if (!sh) continue;
      // f gives the pool's own type back (it may give another).
      if (t === UPDATED && itemOf(zonk(id))?.type !== sh.type) continue;
      const w = shapesWhere(sh, n.args[1], t === UPDATED ? (v) => v.k === "item" : (v) => v.k === "bool" && v.v);
      if (w) told.push({ at: id, kind: t === UPDATED ? "updated" : "kept", type: sh.type, pool: n.args[0], fn: n.args[1], shapes: w.shapes, alike: w.alike });
    } else if (t !== undefined && keptParams.has(t)) {
      // One of the program's definitions given pool items(p) for an input
      // it only keeps from: given only the shapes its test may keep.
      keptParams.get(t)!.forEach((test, i) => {
        const a = n.args![i];
        if (test === undefined || a === undefined) return;
        const got = itemsOf(a);
        if (!got) return;
        const shapes = shapesWhere(got.sh, test, (v) => v.k === "bool" && !v.v)?.shapes;
        if (shapes) told.push({ at: a, kind: "items", type: got.sh.type, pool: got.pool, shapes, copy: got.copy });
      });
    } else if (t === KEEP && n.args.length === 2) {
      // keep(pool items(p), test), or of a let's name for pool items(p),
      // whose p is then read again where keep is (names and fields only).
      const given = code.nodes[n.args[0]];

      const bound = given?.kind === "ref" ? letValue.get(given.target) : undefined;
      const inner = bound !== undefined ? code.nodes[bound] : given;
      if (!isCall(inner) || !inner.args || refTo(inner.fn) !== ITEMS || inner.args.length !== 1) continue;
      if (bound !== undefined && !readsOnly(inner.args[0])) continue;
      const sh = itemOf(zonk(inner.args[0]));
      if (!sh) continue;
      const shapes = shapesWhere(sh, n.args[1], (v) => v.k === "bool" && !v.v)?.shapes;
      if (shapes) told.push({ at: bound !== undefined ? given!.id : inner.id, kind: "items", type: sh.type, pool: inner.args[0], shapes, keep: id, copy: bound !== undefined });
    }
  }
  // Worth it only where some call leaves a shape out.
  const types = new Set(told.filter((c) => c.kind !== "empty" && c.shapes.length < 1 << shapedOf.get(c.type)!.parts.length).map((c) => c.type));
  if (!types.size) return null;

  const nodes: Record<Id, Node> = copyNodes(code.nodes), more: Names = {};
  const defs = [...code.defs], made: Id[] = [];
  const add = (x: Omit<Node, "id">, id = freshId()) => { nodes[id] = { id, ...x } as Node; return id; };
  const ref = (t: Id) => add({ kind: "ref", target: t } as Omit<Node, "id">);
  const int = (v: number) => add({ kind: "lit", value: v, of: INT } as Omit<Node, "id">);
  const callOf = (fn: Id, args: Id[], id?: Id) => add({ kind: "call", fn, args } as Omit<Node, "id">, id);
  const binder = (name: string) => { const b = add({ kind: "binder" } as Omit<Node, "id">); more[b] = name; return b; };
  const list = (xs: Id[]) => xs.reduceRight((rest, x) => callOf(ref(CONS), [x, rest]), ref(NIL));
  const copied = (id: Id): Id => { const ids = new Map(subtree(code, id).map((x) => [x, freshId()] as const)); for (const [o, n] of ids) nodes[n] = mapIds(code.nodes[o], (x) => ids.get(x) ?? x); return ids.get(id)!; };
  // Each type's shape: a definition adding up a bit for each part there,
  // and the Pool shape holding it.
  const shapeOf = new Map<Id, Id>();
  for (const ty of types) {
    const sh = shapedOf.get(ty)!;
    const x = binder("item");
    let sum: Id | null = null;
    sh.parts.forEach((field, j) => {
      const p = binder("part");
      const m = add({ kind: "match", scrutinee: callOf(ref(sh.fields[field]), [ref(x)]), otherwise: null, arms: [
        add({ kind: "arm", variant: NONE, binds: [], results: [], body: int(0) } as Omit<Node, "id">),
        add({ kind: "arm", variant: SOME, binds: [p], results: [null], body: int(1 << j) } as Omit<Node, "id">),
      ] } as Omit<Node, "id">);
      sum = sum === null ? m : callOf(ref(INT_OPS.add), [sum, m]);
    });
    const f = freshId();
    nodes[f] = { id: f, kind: "def", body: add({ kind: "lambda", params: [x], body: sum! } as Omit<Node, "id">) } as Node;
    more[f] = `${names[ty] ?? "item"} shape`;
    const v = freshId();
    nodes[v] = { id: v, kind: "def", body: callOf(ref(shapeVariant), [ref(f)]) } as Node;
    more[v] = `${names[ty] ?? "item"} pool shape`;
    defs.push(f, v);
    made.push(f, v);
    shapeOf.set(ty, v);
  }
  const said: { kind: Told["kind"]; shapes: number[]; alike: boolean }[] = [];
  for (const c of told) {
    const v = shapeOf.get(c.type);
    if (!v) continue;
    said.push({ kind: c.kind, shapes: c.shapes, alike: !!c.alike });
    if (c.kind === "empty") { nodes[c.at] = { id: c.at, kind: "call", fn: ref(EMPTY_S), args: [ref(v)] } as Node; continue; }
    const shapes = list(c.shapes.map(int));
    // An update that surely gives each item its own shape back needn't look for items to move.
    const to = c.kind === "updated" ? (c.alike ? UPDATED_A! : UPDATED_S) : c.kind === "kept" ? KEPT_S : ITEMS_S;
    // A let's name given to keep: the pool read again here, the let kept for its other uses.
    const pool = c.copy ? copied(c.pool!) : c.pool!;
    if (!c.copy) dropNode(nodes, (code.nodes[c.at] as NodeOf<"call">).fn);
    nodes[c.at] = { id: c.at, kind: "call", fn: ref(to), args: c.kind === "items" ? [pool, ref(v), shapes] : [pool, ref(v), shapes, c.fn!] } as Node;
  }
  // A let's pool items no longer read (each use told its shapes): nil in
  // its place, so the whole pool isn't walked for nothing.
  const read = new Set<Id>();
  for (const d of own) for (const id of subtree({ ...code, nodes }, d)) { const r = nodes[id]; if (r?.kind === "ref") read.add(r.target); }
  for (const [b, v] of letValue) if (!read.has(b) && told.some((c) => c.copy && shapeOf.has(c.type) && letValue.get((code.nodes[c.at] as NodeOf<"ref">).target) === v)) {
    for (const x of subtree(code, v)) if (x !== v) dropNode(nodes, x);
    nodes[v] = { id: v, kind: "ref", target: NIL } as Node;
  }
  const next: Code = { ...code, nodes, defs };
  const allNames = { ...names, ...more };
  const checked = infer(next, allNames, undefined, opts);
  if (checked.errors.length > info.errors.length) return null;
  return { code: next, info: checked, names: allNames, made, told: said };
}
