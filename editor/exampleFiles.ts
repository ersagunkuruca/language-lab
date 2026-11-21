// The example programs' files as the site ships them (E282): one script a
// folder, `example-files/<folder>.<hash>.js`, read when its program is
// first opened, not all of them in the page (they were 10 MB of it, 4 MB
// of the 5.4 a visit downloaded). The page names each file in
// `lab-example-files`; the ones the first drawing needs (the program
// reopened, the first example) are read before the editor's script, by
// the page's own few lines (build.ts). A build without that element (a
// test's, examplesPlugin "inline") has every example in its script.
//
// Each file calls `labExample(folder, tables)`: a script tag, not a fetch,
// so a page opened from file:// reads them too.

import manifest from "./examples.json" with { type: "json" };

type Tables = Record<string, unknown>;
const store = () => ((globalThis as { labExamples?: Record<string, Tables> }).labExamples ??= {});
let srcs: Record<string, string> | null | undefined;
const srcOf = (folder: string): string | null => {
  if (srcs === undefined) {
    const el = typeof document === "object" ? document.getElementById("lab-example-files") : null;
    srcs = el ? JSON.parse(el.textContent ?? "{}") : null;
  }
  return srcs?.[folder] ?? null;
};
const foldersOf = (program: string) => manifest.programs.find((p) => p.program === program && p.editor !== false)?.folders ?? [];

// A folder's tables, there once read.
export const folderHere = (folder: string) => !srcOf(folder) || folder in store();
// Every folder of an example program read: it can be opened now.
export const exampleHere = (program: string) => foldersOf(program).every(folderHere);

const asked = new Map<string, Promise<void>>();
function readFolder(folder: string): Promise<void> {
  const src = srcOf(folder);
  if (!src || folder in store()) return Promise.resolve();
  let p = asked.get(folder);
  if (!p) asked.set(folder, (p = new Promise<void>((done, failed) => {
    (globalThis as { labExample?: (f: string, t: Tables) => void }).labExample ??= (f, t) => { store()[f] = t; };
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => { s.remove(); if (folder in store()) done(); else failed(new Error(`${src} gave no example`)); };
    s.onerror = () => { s.remove(); asked.delete(folder); failed(new Error(`${src} couldn't be read`)); };
    document.head.appendChild(s);
  })));
  return p;
}
// The example programs' folders read, so each can be opened.
export const readExamples = (programs: string[]): Promise<void> =>
  Promise.all([...new Set(programs.flatMap(foldersOf))].map(readFolder)).then(() => undefined);
