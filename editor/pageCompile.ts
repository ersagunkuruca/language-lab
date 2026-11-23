// A page program compiled the way the editor's preview runs it (E244):
// from the core IR, or why main doesn't lower there. The run
// worker (runWorker.ts) does it after an edit, and the site's build does it
// once for each shipped page example (prebuild.ts, E245), so both give the
// same program for the same code.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { corePageScript, lowerCore, stepEverywhere } from "../compiler/src/core-js.ts";
import { hasSound, savedScripts, type SavedScripts } from "../ters/src/lang/page.ts";
import { setDisplayNames, setProgramPins } from "./typed.ts";
import { checkedForRun } from "./coreMain.ts";

// `saved`: the same page as Open in a tab and Save page give it (page.ts
// savedScripts), from the same lowering.
// `sound`: a page with sound's audio thread script (core-js.ts
// coreSoundScript), which the preview puts after the worklet's runtime
// (E285: such a page was previewed only interpreted, the looper's main
// alone 13 s of the editor's thread).
export type CompiledPage = { program: string; core: true; saved: SavedScripts; sound?: string };

export function compilePageProgram(code: Code, names: Names, pins: Pins, main: Id, held: [Id, string][] = []): CompiledPage {
  const { ir, names: shown } = lowered(code, names, pins, main, held);
  const saved = savedScripts(ir, shown[main], hasSound(code));
  // The preview's script steps everywhere, so its page's budget bounds it on
  // the editor's thread (E319d); Open in a tab's (`saved`) doesn't.
  return { program: stepEverywhere(() => corePageScript(ir, shown[main], "$core", "")), core: true, saved, ...(saved.sound !== undefined ? { sound: saved.sound } : {}) };
}
// The page as saved alone, with its audio thread's script if it has sound.
export function compileSavedPage(code: Code, names: Names, pins: Pins, main: Id, held: [Id, string][] = []): SavedScripts {
  const { ir, names: shown } = lowered(code, names, pins, main, held);
  return savedScripts(ir, shown[main], hasSound(code));
}
// Only what main reaches, as ters build-web lowers it (C168).
function lowered(code: Code, names: Names, pins: Pins, main: Id, held: [Id, string][]) {
  setDisplayNames(names);
  setProgramPins(pins);
  // Stored as ters build-web stores it (C197): its lists and Maps chosen.
  const r = checkedForRun(code, names, main, held);
  const ir = lowerCore(r.code, r.info, r.names, [main]);
  const why = ir.refused.get(main);
  if (why) throw new Error(`${names[main] ?? "main"} isn't compiled through the core IR: it ${why}`);
  return { ir, names: r.names };
}
