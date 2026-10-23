// What a built page runs besides its compiled program (WEB.md): the
// compiler's runtime, the mount and the browser's world, and `startPage`,
// which sets them up and draws the page into the document. `lab build-web`
// bundles the program with this (esbuild keeps only what it uses); the
// editor's "Save page" puts all of it, prebuilt, before the compiled
// program (cli/web.ts pageRuntime, page.ts pageFile).

import { $cells, $setPrint, $setWorld } from "../../../compiler/src/runtime.js";
import { browserWorld, type Store } from "./browser.ts";
import { compiledCall, mountHtml, type Doc, type Node_ } from "./html.ts";

export * from "../../../compiler/src/runtime.js";

// localStorage, or a map when the browser refuses it (a sandboxed frame,
// some private windows): the page works, and forgets on reload.
const storage = (): Store => {
  try { if (globalThis.localStorage) return globalThis.localStorage; } catch { /* refused */ }
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null };
};

// `program` names the page's files in localStorage (browser.ts).
export function startPage(main: () => unknown, program: string): void {
  $setWorld(browserWorld(storage(), program, console, { cells: $cells(), frame: (f) => requestAnimationFrame(f) }));
  $setPrint((line: string) => console.log(line));
  const doc = document as unknown as Doc & { body: { append(n: Node_): void } };
  doc.body.append(mountHtml(main() as never, { cells: $cells(), doc, call: compiledCall }));
}
