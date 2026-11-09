// A page program compiled the way the editor's preview runs it (E244):
// from the core IR, or why main doesn't lower there. The run
// worker (runWorker.ts) does it after an edit, and the site's build does it
// once for each shipped page example (prebuild.ts, E245), so both give the
// same program for the same code.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { corePageScript, lowerCore } from "../compiler/src/core-js.ts";
import { setDisplayNames, setProgramPins } from "./typed.ts";
import { checkedForRun } from "./coreMain.ts";

export type CompiledPage = { program: string; core: true };

export function compilePageProgram(code: Code, names: Names, pins: Pins, main: Id): CompiledPage {
  setDisplayNames(names);
  setProgramPins(pins);
  // Stored as lab build-web stores it (C197): its lists and Maps chosen.
  const r = checkedForRun(code, names, main);
  const own = r.code.defs.filter((d) => !LIBRARY.code.nodes[d]);
  const ir = lowerCore(r.code, r.info, r.names, own);
  const why = ir.refused.get(main);
  if (why) throw new Error(`${names[main] ?? "main"} isn't compiled through the core IR: it ${why}`);
  return { program: corePageScript(ir, r.names[main], "$core", ""), core: true };
}
