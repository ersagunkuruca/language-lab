// A put or a remove on a hash table written in place where nobody else can
// see the table it was given (IN-PLACE.md step 2, C71's other half): std's
// Table keeps every version a value (Baker's shallow binding), so each
// change makes a new newest version and turns the old one into the change
// back to it. Where holders.ts says the table a put or a remove is given
// has one holder, and the change is the last to use it, no old version is
// read again, and the change is written into the one it was given (std.ts
// `changeOwned`): no version, no undo record, the entries' sorted list
// dropped. swarm's map of motes, changed several times a tick, made a
// version and a record each. Decided per value (C327f), not by type over
// the program's source as one-holder.ts did.

import type { Id } from "../../ters/src/model.ts";
import { holders } from "./holders.ts";
import type { CoreIR } from "./scalar.ts";

const CHANGE = /^table\.(put|remove)\.t(\d+)$/;

export function ownedTables(ir: CoreIR, main: Id): number {
  const roots = ir.funcs.flatMap((g, i) => (g.def === main && !g.inner ? [i] : []));
  let n = 0;
  for (const e of holders(ir, roots).owned) if (e.k === "rt" && CHANGE.test(e.fn)) { e.fn = e.fn.replace(CHANGE, "table.$1Owned.t$2"); n++; }
  return n;
}
