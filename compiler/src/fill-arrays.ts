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
// array has (array-view.ts pushBack), no list made. The items are made in the order the map
// makes them. The program is checked again only when one was found.
// (Fusion: Wadler's deforestation, 1990; CREDITS.md.)

import type { Code, Id, Node } from "../../ters/src/model.ts";
import { isCall, copyNodes, dropNode, nodeEntries } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, inferRewritten, type Info } from "../../ters/src/lang/infer.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { PRELUDE_DEFS, originalOf } from "../../ters/src/lang/prelude-ids.ts";
import { ARRAY_OPS, INT_OPS } from "../../ters/src/lang/std.ts";

const MAP = PRELUDE_DEFS["map"], APPEND = PRELUDE_DEFS["append"];

export function fillArrays(code: Code, names: Names): { code: Code; names: Names; made: Id[] } {
  const target = (id: Id | undefined) => { const n = id ? code.nodes[id] : undefined; return n?.kind === "ref" ? n.target : null; };
  const calls = (id: Id | undefined, f: (t: Id) => boolean, n: number) => { const x = id ? code.nodes[id] : undefined; if (!isCall(x) || x.args?.length !== n) return null; const t = target(x.fn); return t && f(t) ? x.args : null; };
  // map(range(n), f): n and f.
  const mapped = (id: Id | undefined) => {
    const m = calls(id, (t) => originalOf(t) === MAP, 2);
    const r = m && calls(m[0], (t) => t === INT_OPS.range, 1);
    return m && r ? { n: r[0], f: m[1] } : null;
  };
  const sites: { id: Id; before: Id | null; n: Id; f: Id }[] = [];
  for (const [id, n] of nodeEntries(code.nodes)) {
    if (!isCall(n) || n.args?.length !== 1 || target(n.fn) !== ARRAY_OPS.of) continue;
    const m = mapped(n.args[0]);
    if (m) { sites.push({ id, before: null, ...m }); continue; }
    const a = calls(n.args[0], (t) => originalOf(t) === APPEND, 2), m2 = a && mapped(a[1]);
    if (a && m2) sites.push({ id, before: a[0], ...m2 });
  }
  if (!sites.length) return { code, names, made: [] };
  const k = new Lang(code), nodes = copyNodes(code.nodes);
  const fill = k.def("filled");
  k.define(fill, k.fn(["array", "at", "count", "f"], (a, i, n, f) =>
    k.if(k.call(INT_OPS.less, i, n), k.call(fill, k.call(ARRAY_OPS.push, a, k.call(f, i)), k.call(INT_OPS.add, i, k.int(1)), n, f), a)));
  for (const s of sites) {
    const start = s.before ? k.call(ARRAY_OPS.of, s.before) : k.call(ARRAY_OPS.empty);
    // The list made before taken out: the map's call, its range's, and
    // an append's, with the refs naming them.
    const was = code.nodes[s.id] as { args: Id[] };
    for (let x: Id | undefined = was.args[0]; x;) {
      const c = code.nodes[x] as { fn: Id; args: Id[] };
      dropNode(nodes, x);
      dropNode(nodes, c.fn);
      const t = target(c.fn);
      if (t === INT_OPS.range) break;
      x = originalOf(t!) === APPEND ? c.args[1] : c.args[0];
    }
    nodes[s.id] = { id: s.id, kind: "call", fn: k.x(fill), args: [start, k.int(0), s.n, s.f] } as Node;
  }
  Object.assign(nodes, k.code.nodes);
  return { code: { nodes, defs: [...code.defs, ...k.code.defs] }, names: { ...names, ...k.names }, made: sites.map((s) => s.id) };
}

export function withFilledArrays(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const r = fillArrays(code, names);
  if (!r.made.length) return { code, info, names };
  // Checked again where it changed; the program as it came may have
  // problems its first check didn't (first-arms.ts has the same): only
  // new ones count.
  let checked: Info;
  try { checked = inferRewritten(code, r.code, r.names, info, r.made, r.code.defs.slice(code.defs.length)); } catch { return { code, info, names }; }
  if (checked.errors.length > info.errors.length) {
    const before = new Set(infer(code, names, undefined, info.options).errors.map((e) => e.message));
    if (checked.errors.some((e) => !before.has(e.message))) return { code, info, names };
  }
  return { code: r.code, info: checked, names: r.names };
}
