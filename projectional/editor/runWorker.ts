// Run main off the page's thread, so a long run (Countdown's main takes
// seconds) leaves the page drawing, shows its printing as it comes, and
// can be stopped: Stop ends the worker. editor/build.ts bundles this file
// on its own and the editor starts it from that text (RUN_WORKER), so the
// editor stays one file that opens from disk.
//
// The worker has no localStorage: the program's files come in as a copy,
// and what the run wrote goes back to the page with the result.

import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import type { Pins } from "../src/lang/signatures.ts";
import { browserWorld, type Store } from "../src/lang/browser.ts";
import { runMain, showValue } from "../src/lang/run.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { withLibraryRepresentations } from "../src/lang/library-reps.ts";
import { infer, setDisplayNames, setProgramPins } from "./typed.ts";
import { searchBackwards, type BackAsk, type Found } from "./backSearch.ts";

export type RunAsk = { code: Code; names: Names; pins: Pins; def: Id; title: string; files: [string, string][] };
export type RunSays = { lines: string[] } | { done: true; shown: string; files: [string, string][] } | { error: string; files: [string, string][] };

const post = (m: RunSays | Found) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<RunAsk | BackAsk>) => {
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
    // std's Map stored the way the chooser picks (library-reps.ts, C47).
    const own = code.defs.filter((d) => !LIBRARY.code.nodes[d] && code.nodes[(code.nodes[d] as { body?: Id }).body ?? ""]?.kind !== "typedef");
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
