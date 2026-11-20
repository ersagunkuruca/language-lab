// A read or write at an item of a cell's list given the path's parts, not
// a path (C273): `read at(c, item path(p, i))` is `readItem(c, p, i)`, so
// a looper reading and writing its tape each sample makes no path value
// (a function, its steps and a step) for each. The item path may be
// written in place or made by a function of the index alone (`at item(i)
// = item path(path((t) => t), i)`), whose call is the path.
//
// Changes no answer: the parts are worked out in the same order (the
// cell, the list's path, the index, the value written), and the runtime's
// readItem and writeItem (run.ts cellOps) are read at and write at of
// that item path.

import { CELL_OPS } from "../../ters/src/lang/std.ts";
import { ITEM_OPS } from "../../ters/src/lang/cells.ts";
import { kids, mapKids, type CoreIR, type SExpr } from "./scalar.ts";

const ITEM = `host:${CELL_OPS.itemPath}`;
const READ = `host:${CELL_OPS.readAt}`, WRITE = `host:${CELL_OPS.writeAt}`;
// `host:<id>[:how]` split at its id.
const opOf = (fn: string) => { const [, id, how] = fn.split(":"); return { id: `host:${id}`, how: how === undefined ? "" : `:${how}` }; };
const closed = (e: SExpr): boolean => e.k !== "local" && kids(e).every(closed);

export function itemPaths(ir: CoreIR): number {
  // Functions whose body is `item path(p, input)`, p reading no local: by
  // index, that p.
  const makers = new Map<number, SExpr>();
  ir.funcs.forEach((g, i) => {
    const b = g.body;
    if (g.params.length === 1 && !g.inner && b.k === "rt" && b.fn === ITEM && closed(b.args[0]) && b.args[1].k === "local" && b.args[1].i === 0) makers.set(i, b.args[0]);
  });
  // The list's path and the index of an item path, else null.
  const parts = (p: SExpr): [SExpr, SExpr] | null => {
    if (p.k === "rt" && p.fn === ITEM) return [p.args[0], p.args[1]];
    if (p.k === "call" && !p.cps && makers.has(p.fn)) return [structuredClone(makers.get(p.fn)!), p.args[0]];
    return null;
  };
  let changed = 0;
  const put = (e: SExpr): SExpr => {
    const r = mapKids(e, put);
    if (r.k !== "rt") return r;
    const { id, how } = opOf(r.fn);
    if (id !== READ && id !== WRITE) return r;
    const at = parts(r.args[1]);
    if (!at) return r;
    changed++;
    return { ...r, fn: `host:${id === READ ? ITEM_OPS.readItem : ITEM_OPS.writeItem}${how}`, args: [r.args[0], ...at, ...r.args.slice(2)] };
  };
  for (const f of ir.funcs) f.body = put(f.body);
  return changed;
}
