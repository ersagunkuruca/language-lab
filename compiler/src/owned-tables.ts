// A put or a remove on a hash table written in place where nobody else can
// see the table it was given (IN-PLACE.md step 2, C71's other half): std's
// Table keeps every version a value (Baker's shallow binding), so each
// change makes a new newest version and turns the old one into the change
// back to it. Where one-holder.ts says, from the program alone, that every
// table and hash set has one holder, no old version is read again, and the
// change is written into the one it was given (std.ts `changeOwned`): no
// version, no undo record, the entries' sorted list dropped. swarm's map
// of motes, changed several times a tick, made a version and a record each.

import type { Code, Id } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { oneHolder } from "../../ters/src/lang/one-holder.ts";
import { HASH_SET_OPS, TABLE_OPS } from "../../ters/src/lang/std.ts";
import { HASH_SET, TABLE } from "../../ters/src/lang/types.ts";
import { kids, type CoreIR, type SExpr } from "./scalar.ts";

const CHANGE = /^table\.(put|remove)\.t(\d+)$/;
// The hash tables' jobs that change the table they are given first: a put,
// or a merge putting the second's entries into the first.
const CHANGING = new Set(["put", "update at", "remove key", "merge maps", "add item", "remove item", "set union"]);

export function ownedTables(ir: CoreIR, code: Code, info: Info, names: Record<Id, string>, main: Id): number {
  const found: SExpr[] = [];
  const scan = (e: SExpr) => { if (e.k === "rt" && CHANGE.test(e.fn)) found.push(e); kids(e).forEach(scan); };
  ir.funcs.forEach((f) => scan(f.body));
  if (!found.length) return 0;
  // The jobs (map-tree.ts's hash table rows), read as they do them: each
  // only reads its table, but those that change it.
  const rows = LIBRARY.reps.filter((r) => r.oneHolder);
  const jobs = new Set<Id>([...Object.values(TABLE_OPS), ...Object.values(HASH_SET_OPS), ...rows.flatMap((r) => Object.values(r.impl))]);
  const changes = new Map<Id, number>([[TABLE_OPS.put, 0], [TABLE_OPS.remove, 0], [HASH_SET_OPS.add, 0], [HASH_SET_OPS.remove, 0]]);
  for (const r of rows) for (const [op, d] of Object.entries(r.impl)) if (CHANGING.has(LIBRARY.names[op])) changes.set(d, 0);
  if (!oneHolder(code, info, main, new Set([TABLE, HASH_SET]), jobs, changes, names).ok) return 0;
  for (const e of found) if (e.k === "rt") e.fn = e.fn.replace(CHANGE, "table.$1Owned.t$2");
  return found.length;
}
