// Every builtin's implementation by its id (C251): std-run.ts's and
// std-run-many.ts's exports, `int$add` as builtin.int.add. The evaluator
// runs a builtin through these; a page imports only those it calls.
import type { Id } from "../model.ts";
import * as ONE from "./std-run.ts";
import * as MANY from "./std-run-many.ts";

const byId = <F>(m: Record<string, F>): Record<Id, F> => Object.fromEntries(Object.entries(m).map(([name, f]) => [`builtin.${name.replace(/\$/g, ".")}`, f]));
export const STD_IMPL: Record<Id, (...xs: any[]) => any> = /* @__PURE__ */ byId(ONE);
// Builtins with Choice: every answer, as an array (none, one or several).
export const STD_MANY: Record<Id, (...xs: any[]) => any[]> = /* @__PURE__ */ byId(MANY);
