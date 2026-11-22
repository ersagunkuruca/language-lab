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
import { addShipped } from "./checkStore.ts";

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
// A program's definition groups as the build checked them (E314,
// keptChecks.ts), named in `lab-example-checks`: read with its folders, so
// a first visit's check of it takes them (checkStore.ts groupStore). One
// that can't be read is checked here instead.
let checkSrcs: Record<string, string> | null | undefined;
const checksRead = new Map<string, Promise<void>>();
function readChecks(program: string): Promise<void> {
  if (checkSrcs === undefined) {
    const el = typeof document === "object" ? document.getElementById("lab-example-checks") : null;
    checkSrcs = el ? JSON.parse(el.textContent ?? "{}") : null;
  }
  const src = checkSrcs?.[program];
  if (!src) return Promise.resolve();
  let p = checksRead.get(program);
  if (!p) checksRead.set(program, (p = new Promise<void>((done) => {
    const g = globalThis as { labExampleChecks?: (b: string, p: string, k: Record<string, unknown>) => void };
    g.labExampleChecks ??= (_, p, k) => addShipped(k, p);
    const s = document.createElement("script");
    s.src = src;
    s.onload = s.onerror = () => { s.remove(); done(); };
    document.head.appendChild(s);
  })));
  return p;
}
// The example programs' folders read, so each can be opened.
export const readExamples = (programs: string[]): Promise<void> =>
  Promise.all([...[...new Set(programs.flatMap(foldersOf))].map(readFolder), ...programs.map(readChecks)]).then(() => undefined);
