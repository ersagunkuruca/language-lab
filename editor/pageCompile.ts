// A page program compiled the way the editor's preview runs it (E244):
// from the core IR, or why main doesn't lower there. The run
// worker (runWorker.ts) does it after an edit, and the site's build does it
// once for each shipped page example (prebuild.ts, E245), so both give the
// same program for the same code.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { corePageScript, lowerCore } from "../compiler/src/core-js.ts";
import { hasSound, savedScripts, type SavedScripts } from "../ters/src/lang/page.ts";
import { setDisplayNames, setProgramPins } from "./typed.ts";
import { checkedForRun } from "./coreMain.ts";

// `saved`: the same page as Open in a tab and Save page give it (page.ts
// savedScripts), from the same lowering.
export type CompiledPage = { program: string; core: true; saved: SavedScripts };

export function compilePageProgram(code: Code, names: Names, pins: Pins, main: Id): CompiledPage {
  const { ir, names: shown } = lowered(code, names, pins, main);
  return { program: corePageScript(ir, shown[main], "$core", ""), core: true, saved: savedScripts(ir, shown[main], false) };
}
// The page as saved alone: a page with sound's, which the preview doesn't
// compile (pagePanel.ts compilePage), carries its audio thread's script.
export function compileSavedPage(code: Code, names: Names, pins: Pins, main: Id): SavedScripts {
  const { ir, names: shown } = lowered(code, names, pins, main);
  return savedScripts(ir, shown[main], hasSound(code));
}
// Only what main reaches, as ters build-web lowers it (C168).
function lowered(code: Code, names: Names, pins: Pins, main: Id) {
  setDisplayNames(names);
  setProgramPins(pins);
  // Stored as ters build-web stores it (C197): its lists and Maps chosen.
  const r = checkedForRun(code, names, main);
  const ir = lowerCore(r.code, r.info, r.names, [main]);
  const why = ir.refused.get(main);
  if (why) throw new Error(`${names[main] ?? "main"} isn't compiled through the core IR: it ${why}`);
  return { ir, names: r.names };
}
