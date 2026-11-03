// Run main off the page's thread, so a long run (Countdown's main takes
// seconds) leaves the page drawing, shows its printing as it comes, and
// can be stopped: Stop ends the worker. editor/build.ts bundles this file
// on its own and the editor starts it from that text (RUN_WORKER), so the
// editor stays one file that opens from disk.
//
// The worker has no localStorage: the program's files come in as a copy,
// and what the run wrote goes back to the page with the result.

import type { Code, Id } from "../ters/src/model.ts";
import { subtree } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { browserWorld, type Store } from "../ters/src/lang/browser.ts";
import { runMain, runProgram, showValue } from "../ters/src/lang/run.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { withLibraryRepresentations } from "../ters/src/lang/library-reps.ts";
import { infer, setDisplayNames, setProgramPins } from "./typed.ts";
import { searchBackwards, type BackAsk, type Found } from "./backSearch.ts";
import { stuckReading, type Reading } from "../ters/src/lang/relate.ts";
import { compile } from "../compiler/src/compile.ts";

export type RunAsk = { code: Code; names: Names; pins: Pins; def: Id; title: string; files: [string, string][]; args?: string[] };
// args: main takes the command line's words, as `lab run` gives them (E212).
// A page compiled the way "Open in a tab" does (page.ts pageFile), off the
// page's thread: the preview swaps it in when it's ready (main.ts startPage).
export type CompileAsk = { compilePage: true; code: Code; names: Names; pins: Pins; main: Id };
export type CompileSays = { program: string } | { error: string };
// Where the last read of a text run backwards stopped, when one found no
// answer (L70c): the text, the place, what was looked for there, and how
// many reads stopped.
export type Stuck = { text: string; at: number; expected: string[]; said: string; times: number };
// Where a run went (E233): each of the program's own definitions entered,
// how many times, and about how long the run spent in it.
export type Profile = { def: Id; calls: number; ms: number }[];
export type RunSays = { lines: string[] } | { done: true; shown: string; files: [string, string][]; stuck?: Stuck; profile?: Profile } | { error: string; files: [string, string][]; stuck?: Stuck; profile?: Profile };

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
  const { code, names, pins, def, title, files, args } = e.data;
  const kept = new Map(files), wrote = new Map<string, string>();
  const store: Store = {
    getItem: (k) => kept.get(k) ?? null,
    setItem: (k, v) => { kept.set(k, v); wrote.set(k, v); },
    get length() { return kept.size; },
    key: (i) => [...kept.keys()][i] ?? null,
  };
  // Printing goes out in batches, a few times a second.
  let lines: string[] = [], sent = Date.now(), stuck: Stuck | undefined;
  const flush = () => { if (lines.length) post({ lines }); lines = []; sent = Date.now(); };
  try {
    setDisplayNames(names);
    setProgramPins(pins);
    // std's Map stored the way the chooser picks (library-reps.ts, C47),
    // in the program's own types' fields too (GAPS.md M2): the types go in.
    const own = code.defs.filter((d) => !LIBRARY.code.nodes[d]);
    const first = infer(code, names), lib = withLibraryRepresentations(code, first, names, def, own);
    const info = lib.chosen.length ? infer(lib.code, lib.names) : first;
    // Each lambda of the program's own definitions, by the definition it's in.
    const ownerOf = new Map<Id, Id>();
    for (const d of own) { const n = lib.code.nodes[d]; if (n?.kind === "def" && n.body) for (const x of subtree(lib.code, n.body)) if (lib.code.nodes[x]?.kind === "lambda") ownerOf.set(x, d); }
    // Calls are counted exactly. Time is sampled: every 256 entries the
    // time since the last sample goes to the definition just entered, so a
    // definition's share is about the share of the run spent in it.
    const calls = new Map<Id, number>(), ms = new Map<Id, number>();
    let entries = 0, last = performance.now();
    const profile = (): Profile => [...calls].map(([d, c]) => ({ def: d, calls: c, ms: Math.round(ms.get(d) ?? 0) })).sort((a, b) => b.ms - a.ms || b.calls - a.calls);
    const rt = {
      entered: (lambda: Id) => {
        const d = ownerOf.get(lambda);
        if (d === undefined) return;
        calls.set(d, (calls.get(d) ?? 0) + 1);
        if ((++entries & 255) === 0) { const now = performance.now(); ms.set(d, (ms.get(d) ?? 0) + now - last); last = now; }
      },
      print: (line: string) => { lines.push(line); if (Date.now() - sent > 100) flush(); },
      names: lib.names, world: browserWorld(store, title),
      stuck: (r: Reading) => { stuck = { text: r.text, at: r.at, expected: [...r.expected], said: stuckReading(r), times: (stuck?.times ?? 0) + 1 }; },
    };
    // With its arguments main gives an exit code, which shows when it isn't 0.
    const shown = args ? ((c: number) => (c ? `exit ${c}` : "unit"))(runProgram(lib.code, info, def, args, rt)) : showValue(runMain(lib.code, info, def, rt), lib.code, lib.names);
    flush();
    post({ done: true, shown, files: [...wrote], ...(stuck ? { stuck } : {}), profile: profile() });
  } catch (err) {
    flush();
    post({ error: (err as Error).message, files: [...wrote], ...(stuck ? { stuck } : {}) });
  }
};
