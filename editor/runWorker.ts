// Run main off the page's thread, so a long run (Countdown's main takes
// seconds) leaves the page drawing, shows its printing as it comes, and
// can be stopped: Stop ends the worker. editor/build.ts bundles this file
// on its own and the editor starts it from that text (RUN_WORKER), so the
// editor stays one file that opens from disk.
//
// The worker has no localStorage: the program's files come in as a copy,
// and what the run wrote goes back to the page with the result.

import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { browserWorld, type Store } from "../ters/src/lang/browser.ts";
import { runMain, showValue } from "../ters/src/lang/run.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { withLibraryRepresentations } from "../ters/src/lang/library-reps.ts";
import { infer, setDisplayNames, setProgramPins } from "./typed.ts";
import { searchBackwards, type BackAsk, type Found } from "./backSearch.ts";
import { compile } from "../compiler/src/compile.ts";

export type RunAsk = { code: Code; names: Names; pins: Pins; def: Id; title: string; files: [string, string][] };
// A page compiled the way "Open in a tab" does (page.ts pageFile), off the
// page's thread: the preview swaps it in when it's ready (main.ts startPage).
export type CompileAsk = { compilePage: true; code: Code; names: Names; pins: Pins; main: Id };
export type CompileSays = { program: string } | { error: string };
export type RunSays = { lines: string[] } | { done: true; shown: string; files: [string, string][] } | { error: string; files: [string, string][] };

const post = (m: RunSays | Found | CompileSays) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<RunAsk | BackAsk | CompileAsk>) => {
  if ("compilePage" in e.data) {
    const { code, names, pins, main } = e.data;
    try {
      setDisplayNames(names);
      setProgramPins(pins);
      return post({ program: compile(code, infer(code, names), names, { runtime: "$lab", exports: [names[main]], link: "global" }) });
    } catch (err) {
      return post({ error: (err as Error).message });
    }
  }
  // A function run backwards, searched to the end, or for a minute at
  // most (backSearch.ts).
  if ("backwards" in e.data) {
    const { code, def, values, names } = e.data, until = Date.now() + 60000;
    return post(searchBackwards(code, def, values, names, () => Date.now() > until));
  }
  const { code, names, pins, def, title, files } = e.data;
  const kept = new Map(files), wrote = new Map<string, string>();
  const store: Store = {
    getItem: (k) => kept.get(k) ?? null,
    setItem: (k, v) => { kept.set(k, v); wrote.set(k, v); },
    get length() { return kept.size; },
    key: (i) => [...kept.keys()][i] ?? null,
  };
  // Printing goes out in batches, a few times a second.
  let lines: string[] = [], sent = Date.now();
  const flush = () => { if (lines.length) post({ lines }); lines = []; sent = Date.now(); };
  try {
    setDisplayNames(names);
    setProgramPins(pins);
    // std's Map stored the way the chooser picks (library-reps.ts, C47),
    // in the program's own types' fields too (GAPS.md M2): the types go in.
    const own = code.defs.filter((d) => !LIBRARY.code.nodes[d]);
    const first = infer(code, names), lib = withLibraryRepresentations(code, first, names, def, own);
    const v = runMain(lib.code, lib.chosen.length ? infer(lib.code, lib.names) : first, def, {
      print: (line) => { lines.push(line); if (Date.now() - sent > 100) flush(); },
      names: lib.names, world: browserWorld(store, title),
    });
    flush();
    post({ done: true, shown: showValue(v, lib.code, lib.names), files: [...wrote] });
  } catch (err) {
    flush();
    post({ error: (err as Error).message, files: [...wrote] });
  }
};
