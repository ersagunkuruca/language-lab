// Case and graphemes on a target with no host to ask (L214e5, TEXT-2026-
// 11-03 "How each target does it"): C and WebAssembly run the cases
// module's own `table uppercase`, `table lowercase` and `table graphemes`
// (cases-source.ts), written in Ters over tables read off the host. A use
// of the builtin is pointed at the module's definition and the module
// joins the program, so lowering sees plain Ters.

import type { Code, Id } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { CASES, LIBRARY } from "../../ters/src/lang/library.ts";
import { TEXT_OPS } from "../../ters/src/lang/std.ts";
import { infer, type Info } from "../../ters/src/lang/infer.ts";

const BY_TABLE: Record<Id, string> = {
  [TEXT_OPS.uppercase]: "table uppercase", [TEXT_OPS.lowercase]: "table lowercase", [TEXT_OPS.graphemes]: "table graphemes",
};
const tables = (): Record<Id, Id> => Object.fromEntries(Object.entries(BY_TABLE).map(([op, name]) =>
  [op, CASES.exports.find((d) => LIBRARY.names[d] === name)!]));

export function tableText(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const used = (c: Code) => Object.values(c.nodes).filter((n) => n.kind === "ref" && BY_TABLE[n.target]);
  if (!used(code).length) return { code, info, names };
  const to = tables();
  const nodes = { ...LIBRARY.code.nodes, ...code.nodes };
  for (const u of used({ ...code, nodes })) nodes[u.id] = { ...u, target: to[(u as { target: Id }).target] } as never;
  const defs = [...new Set([...LIBRARY.code.defs, ...code.defs])];
  const all = { ...LIBRARY.names, ...names };
  const next = { ...code, nodes, defs };
  return { code: next, info: infer(next, all), names: all };
}
