// A page program compiled the way the editor's preview runs it (E244):
// from the core IR where main lowers there, else compile.ts. The run
// worker (runWorker.ts) does it after an edit, and the site's build does it
// once for each shipped page example (prebuild.ts, E245), so both give the
// same program for the same code.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { corePageScript, lowerCore } from "../compiler/src/core-js.ts";
import { compile } from "../compiler/src/compile.ts";
import { infer, setDisplayNames, setProgramPins } from "./typed.ts";

export type CompiledPage = { program: string; core?: true };

export function compilePageProgram(code: Code, names: Names, pins: Pins, main: Id, core: boolean): CompiledPage {
  setDisplayNames(names);
  setProgramPins(pins);
  const info = infer(code, names);
  const own = code.defs.filter((d) => !LIBRARY.code.nodes[d]);
  if (core) try {
    const ir = lowerCore(code, info, names, own);
    if (!ir.refused.has(main)) return { program: corePageScript(ir, names[main], "$core", ""), core: true };
  } catch { /* compile.ts's, below */ }
  return { program: compile(code, info, names, { runtime: "$lab", exports: [names[main]], link: "global" }) };
}
