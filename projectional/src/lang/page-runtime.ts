// What a built page runs besides its compiled program (WEB.md): the
// compiler's runtime, the mount and the browser's world, and `startPage`,
// which sets them up and draws the page into the document. `lab build-web`
// bundles the program with this (esbuild keeps only what it uses); the
// editor's "Save page" puts all of it, prebuilt, before the compiled
// program (cli/web.ts pageRuntime, page.ts pageFile).

import { $cells, $setPrint, $setWorld } from "../../../compiler/src/runtime.js";
import { soundPlayer } from "./audio-page.ts";
import { browserWorld, type Store } from "./browser.ts";
import { compiledCall, mountHtml, type Doc, type Node_ } from "./html.ts";

export * from "../../../compiler/src/runtime.js";

// localStorage, or a map when the browser refuses it (a sandboxed frame,
// some private windows): the page works, and forgets on reload.
const storage = (): Store => {
  try { if (globalThis.localStorage) return globalThis.localStorage; } catch { /* refused */ }
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null };
};

// `program` names the page's files in localStorage (browser.ts). A page
// with sound gives `worklet`, its program bundled for the audio thread
// (cli/web.ts, audio-page.ts).
export function startPage(main: () => unknown, program: string, worklet?: string): void {
  $setWorld(browserWorld(storage(), program, console, { cells: $cells(), frame: (f) => requestAnimationFrame(f) }));
  // A handler run that's taken back prints nothing (cells.ts attempt).
  $setPrint((line: string) => $cells().later(() => console.log(line)));
  const doc = document as unknown as Doc & { body: { append(n: Node_): void } };
  const sound = worklet ? soundPlayer($cells(), worklet, main as never) : null;
  doc.body.append(mountHtml((sound ? sound.page : main()) as never, { cells: $cells(), doc, call: compiledCall, listen: sound?.listen }));
}
