// An array made from a mapped range, filled where it is made (L271c):
// `array of(map(range(n), f))` made a list of n numbers, a list of their
// images (on workers, as a pure map may be), and then an array of that.
// The sounds module's `wav of` makes its samples' words so. It is
//
//   filled(start, 0, n, f)
//   filled(a, i, n, f) = if i < n then filled(push(a, f(i)), i + 1, n, f) else a
//
// from an empty array, or, for `array of(append(xs, map(range(n), f)))`,
// from the array of xs: one loop, each item pushed into the room the
// array has (array-view.ts pushBack), no list made. The items are made
// in the order the map makes them. Where Bytes are stored as a byte
// array, a WAV file's `bytes of(append(header, map(range(size), byte)))`
// is a call of `byte array bytes of`, which reads its list only as
// `array of` it: its copy given the filled array is called instead. The
// program is checked again only when one was found.
// (Fusion: Wadler's deforestation, 1990; CREDITS.md.)

import type { Code, Id, Node } from "../../ters/src/model.ts";
import { isCall, copyNodes, dropNode, freshId, mapIds, nodeEntries, subtree } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, inferRewritten, type Info } from "../../ters/src/lang/infer.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { PRELUDE_DEFS, originalOf } from "../../ters/src/lang/prelude-ids.ts";
import { ARRAY_OPS, INT_OPS, LIST } from "../../ters/src/lang/std.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";

const MAP = PRELUDE_DEFS["map"], APPEND = PRELUDE_DEFS["append"];
// Where the program's lists are arrays (library-reps.ts), its map and
// append are the array row's, the range made an array first, and a
// taker of a list given one through `items of array` (L271c: wav of
// beside a Sound stored so).
const ARRAY_ROW = LIBRARY.reps.find((r) => r.of === LIST && r.name === "array of List");
const isMap = (t: Id) => originalOf(t) === MAP || t === ARRAY_ROW?.impl[MAP];
const isAppend = (t: Id) => originalOf(t) === APPEND || t === ARRAY_ROW?.impl[APPEND];

export function fillArrays(code: Code, names: Names): { code: Code; names: Names; made: Id[]; gone: Id[] } {
  const target = (id: Id | undefined) => { const n = id ? code.nodes[id] : undefined; return n?.kind === "ref" ? n.target : null; };
  const calls = (id: Id | undefined, f: (t: Id) => boolean, n: number) => { const x = id ? code.nodes[id] : undefined; if (!isCall(x) || x.args?.length !== n) return null; const t = target(x.fn); return t && f(t) ? x.args : null; };
  // map(range(n), f): n and f.
  const mapped = (id: Id | undefined) => {
    const m = calls(id, isMap, 2);
    const r = m && (calls(m[0], (t) => t === INT_OPS.range, 1) ?? calls(calls(m[0], (t) => t === ARRAY_OPS.of, 1)?.[0], (t) => t === INT_OPS.range, 1));
    return m && r ? { n: r[0], f: m[1] } : null;
  };
  // The list given, or the array whose items are given.
  const givenOf = (id: Id) => { const a = calls(id, (t) => t === ARRAY_OPS.items, 1); return a ? { id: a[0], array: true } : { id, array: false }; };
  // A definition of one parameter that reads it only as `array of` it
  // (bytes-array.ts's `byte array bytes of`, where Bytes are stored as a
  // byte array): its parameter and that call.
  const takers = new Map<Id, { p: Id; at: Id } | null>();
  const taker = (d: Id | null) => {
    if (!d) return null;
    if (takers.has(d)) return takers.get(d)!;
    let r: { p: Id; at: Id } | null = null;
    const def = code.nodes[d], fn = def?.kind === "def" && def.body ? code.nodes[def.body] : undefined;
    if (fn?.kind === "lambda" && fn.params.length === 1) {
      const p = fn.params[0], ids = subtree(code, fn.id);
      const uses = ids.filter((x) => target(x) === p);
      const at = uses.length === 1 ? ids.find((x) => { const c = code.nodes[x]; return isCall(c) && c.args?.length === 1 && c.args[0] === uses[0] && target(c.fn) === ARRAY_OPS.of; }) : undefined;
      if (at) r = { p, at };
    }
    takers.set(d, r);
    return r;
  };
  const sites: { id: Id; by: Id | null; before: Id | null; beforeArray: boolean; n: Id; f: Id }[] = [];
  for (const [id, n] of nodeEntries(code.nodes)) {
    if (!isCall(n) || n.args?.length !== 1) continue;
    // A call of anything but a definition by name is no site: a call of
    // a call, `slopes(f)(map(range(n), g))`, isn't `array of` (Check main
    // after #3284: reverse-gradient's slopes left as a tree).
    const t = target(n.fn);
    if (!t) continue;
    const by = t === ARRAY_OPS.of ? null : t;
    if (by && !taker(by)) continue;
    const g = givenOf(n.args[0]);
    const m = mapped(g.id);
    if (m) { sites.push({ id, by, before: null, beforeArray: false, ...m }); continue; }
    const a = calls(g.id, isAppend, 2), m2 = a && mapped(a[1]);
    if (a && m2) sites.push({ id, by, before: a[0], beforeArray: g.array, ...m2 });
  }
  if (!sites.length) return { code, names, made: [], gone: [] };
  const k = new Lang(code), nodes = copyNodes(code.nodes), gone: Id[] = [];
  const drop = (id: Id) => { dropNode(nodes, id); gone.push(id); };
  const fill = k.def("filled");
  k.define(fill, k.fn(["array", "at", "count", "f"], (a, i, n, f) =>
    k.if(k.call(INT_OPS.less, i, n), k.call(fill, k.call(ARRAY_OPS.push, a, k.call(f, i)), k.call(INT_OPS.add, i, k.int(1)), n, f), a)));
  // A taker given the array instead: a copy of it whose `array of` its
  // parameter is the parameter.
  const given = new Map<Id, Id>();
  const givenArray = (d: Id) => {
    const done = given.get(d);
    if (done) return done;
    const { p, at } = taker(d)!, fn = (code.nodes[d] as { body: Id }).body, use = (code.nodes[at] as { args: Id[] }).args[0];
    const ids = new Map(subtree(code, fn).map((x) => [x, freshId()]));
    const to = (x: Id) => ids.get(x) ?? x;
    for (const [x, y] of ids) if (x !== use) nodes[y] = x === at ? { id: y, kind: "ref", target: to(p) } as Node : mapIds(code.nodes[x], to);
    const c = k.def(`${names[d] ?? "it"} given the array`);
    (k.code.nodes as Record<Id, Node>)[c] = { id: c, kind: "def", body: to(fn) } as Node;
    given.set(d, c);
    return c;
  };
  for (const s of sites) {
    const start = s.before ? k.call(ARRAY_OPS.of, s.beforeArray ? k.call(ARRAY_OPS.items, s.before) : s.before) : k.call(ARRAY_OPS.empty);
    // The list made before taken out: the map's call, its range's, and
    // an append's, with the refs naming them.
    const was = code.nodes[s.id] as { fn: Id; args: Id[] };
    drop(was.fn);
    for (let x: Id | undefined = was.args[0]; x;) {
      const c = code.nodes[x] as { fn: Id; args: Id[] };
      drop(x);
      drop(c.fn);
      const t = target(c.fn);
      if (t === INT_OPS.range) break;
      x = isAppend(t!) ? c.args[1] : c.args[0];
    }
    const filled: Node = { id: s.id, kind: "call", fn: k.x(fill), args: [start, k.int(0), s.n, s.f] } as Node;
    if (!s.by) nodes[s.id] = filled;
    else {
      // The taker's call given the filled array.
      const inner = freshId();
      nodes[inner] = { ...filled, id: inner } as Node;
      nodes[s.id] = { id: s.id, kind: "call", fn: k.x(givenArray(s.by)), args: [inner] } as Node;
    }
  }
  Object.assign(nodes, k.code.nodes);
  return { code: { nodes, defs: [...code.defs, ...k.code.defs] }, names: { ...names, ...k.names }, made: sites.map((s) => s.id), gone };
}

export function withFilledArrays(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const r = fillArrays(code, names);
  if (!r.made.length) return { code, info, names };
  // Checked again where it changed; the program as it came may have
  // problems its first check didn't (first-arms.ts has the same): only
  // new ones count.
  let checked: Info;
  // The nodes taken out are changed too: a recheck's scans read the
  // program before's picks but for those (a whole check read the calls
  // gone, threw, and the arrays were left unfilled).
  try { checked = inferRewritten(code, r.code, r.names, info, [...r.made, ...r.gone], r.code.defs.slice(code.defs.length)); } catch { return { code, info, names }; }
  if (checked.errors.length > info.errors.length) {
    const before = new Set(infer(code, names, undefined, info.options).errors.map((e) => e.message));
    if (checked.errors.some((e) => !before.has(e.message))) return { code, info, names };
  }
  return { code: r.code, info: checked, names: r.names };
}
