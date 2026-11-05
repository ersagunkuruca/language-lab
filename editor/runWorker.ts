// Run main off the page's thread, so a long run (Countdown's main takes
// seconds) leaves the page drawing, shows its printing as it comes, and
// can be stopped: Stop ends the worker. editor/build.ts bundles this file
// on its own and the editor starts it from that text (RUN_WORKER), so the
// editor stays one file that opens from disk.
//
// The worker has no localStorage: the program's files come in as a copy,
// and what the run wrote goes back to the page with the result.

import { logged, replaying, type LogEntry } from "../ters/src/lang/worldlog.ts";
import type { Code, Id } from "../ters/src/model.ts";
import { subtree } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { browserWorld, type Store } from "../ters/src/lang/browser.ts";
import { shower } from "./shown.ts";
import { loadPrinted } from "../compiler/src/core-js.ts";
import { checkedForRun, coreMain, type CoreMain } from "./coreMain.ts";
import { Aborted as CoreAborted, Stopped as CoreStopped } from "../compiler/src/core-rt.ts";
import { runMain, runProgram, toList, type World } from "../ters/src/lang/run.ts";
import type { Info } from "../ters/src/lang/infer.ts";
import { FILES, NETWORK } from "../ters/src/lang/types.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { infer, setDisplayNames, setProgramPins } from "./typed.ts";
import { compilePageProgram } from "./pageCompile.ts";
import { searchBackwards, type BackAsk, type Found } from "./backSearch.ts";
import { stuckReading, type Reading } from "../ters/src/lang/relate.ts";
import { lowerScalar } from "../compiler/src/scalar.ts";
import { receivedCode, type SentCode } from "./runCode.ts";

// `core`: main printed from the core IR, by an earlier run of this same
// code or built with the site (E245c), so the run needs no checking or
// lowering again.
// `replay`: answer from an earlier run's log instead of the world (E232b);
// `until`: give only that many of its answers, then pause (E232c).
export type RunAsk = { code: SentCode; names: Names; pins: Pins; def: Id; title: string; files: [string, string][]; args?: string[]; core?: CoreMain; deny?: Id[]; stdin?: string; replay?: LogEntry[]; until?: number };
// Run's worker is kept between runs and started before the first (I177):
// `warm` checks the program, so the library's check is kept by the time
// Run main is pressed.
export type WarmAsk = { warm: true; code: SentCode; names: Names; pins: Pins; def: Id };
// args: main takes the command line's words, as `lab run` gives them (E212).
// A page compiled the way "Open in a tab" does (page.ts corePageFile), off the
// page's thread: the preview swaps it in when it's ready (main.ts startPage).
export type CompileAsk = { compilePage: true; code: Code; names: Names; pins: Pins; main: Id };
// Printed from the core IR (core-js.ts corePageScript), the script
// calling $core.startCorePage (E244).
export type CompileSays = { program: string; core: true } | { error: string };
// Where the program's own definitions can run (whereRuns.ts, L22a): the
// ones a shader can't hold, and the ones WebAssembly and C can't, each
// with the compiler's reason.
export type WhereAsk = { whereRuns: true; code: Code; names: Names; pins: Pins };
export type WhereSays = { gpu: [Id, string][]; native: [Id, string][] } | { error: string };
// Where the last read of a text run backwards stopped, when one found no
// answer (L70c): the text, the place, what was looked for there, and how
// many reads stopped.
export type Stuck = { text: string; at: number; expected: string[]; said: string; times: number };
// Where a run went (E233): each of the program's own definitions entered,
// how many times, and about how long the run spent in it.
export type Profile = { def: Id; calls: number; ms: number }[];
// `core`: main ran printed from the core IR (E244), so there's no profile;
// `printed`: what it ran, to keep for running the same code again (E245c).
// `answers`: what the world answered the run, in order (E232a).
// `at`: where a compiled main stopped, its node and definition (C143f).
export type StopAt = { node: Id; def: Id };
export type RunSays = { lines: string[] } | { done: true; shown: string; files: [string, string][]; stuck?: Stuck; profile?: Profile; core?: true; printed?: CoreMain; answers?: LogEntry[]; paused?: true; at?: StopAt } | { error: string; files: [string, string][]; stuck?: Stuck; core?: true; printed?: CoreMain; answers?: LogEntry[]; paused?: true; at?: StopAt };

// The run's log of the world's answers (worldlog.ts), sent with its end.
let answers: LogEntry[] | null = null, paused = false;
// The whole log, writes and bytes too, so Run again can answer from it.
const post = (m: RunSays | Found | CompileSays | WhereSays) => (self as unknown as Worker).postMessage(answers && ("done" in m || ("error" in m && "files" in m)) ? { ...m, answers, ...(paused ? { paused: true } : {}) } : m);

// Standard input typed into Run's box (I168), read as `lab run` reads a
// pipe (world.ts): read input takes the rest, read line a line at a time
// and none at the end.
function withInput(world: World, stdin: string | undefined): World {
  if (stdin === undefined) return world;
  let rest = stdin;
  return {
    ...world,
    input: () => { const all = rest; rest = ""; return all; },
    readLine: () => {
      if (!rest) return null;
      const at = rest.indexOf("\n");
      const line = at < 0 ? rest : rest.slice(0, at);
      rest = at < 0 ? "" : rest.slice(at + 1);
      return line.endsWith("\r") ? line.slice(0, -1) : line;
    },
  };
}

self.onmessage = (e: MessageEvent<RunAsk | WarmAsk | BackAsk | CompileAsk | WhereAsk>) => {
  answers = null; paused = false;
  if ("warm" in e.data) {
    const { code, names, pins, def } = e.data;
    try { setDisplayNames(names); setProgramPins(pins); checkedForRun(receivedCode(code), names, def); } catch { /* the run says what's wrong */ }
    return;
  }
  if ("whereRuns" in e.data) {
    const { code, names, pins } = e.data;
    try {
      setDisplayNames(names);
      setProgramPins(pins);
      const info = infer(code, names);
      const own = code.defs.filter((d) => !LIBRARY.code.nodes[d]);
      const refused = (o: object) => { try { return [...lowerScalar(code, info, names, own, o).refused]; } catch (err) { return own.map((d): [Id, string] => [d, (err as Error).message]); } };
      return post({ gpu: refused({ records: true, shader: true }), native: refused({ data: true }) });
    } catch (err) {
      return post({ error: (err as Error).message });
    }
  }
  if ("compilePage" in e.data) {
    const { code, names, pins, main } = e.data;
    try {
      // From the core IR, as Save page does.
      return post(compilePageProgram(code, names, pins, main));
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
  const { code: given, names, pins, def, title, files, args, core, deny, stdin, replay, until } = e.data;
  const code = receivedCode(given);
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
    // Paused, the run prints nothing more: what shows is where it was.
    const print = (line: string) => { if (paused) return; lines.push(line); if (Date.now() - sent > 100) flush(); };
    const real = denied(withInput(browserWorld(store, title), stdin), deny ?? [], names);
    const logging = logged(replay ? replaying(replay, real, until, () => { paused = true; }) : real);
    const world = logging.world;
    answers = logging.log;
    if (core && core.args === !!args && runPrinted(core, undefined, args, world, print, flush, () => [...wrote])) return;
    setDisplayNames(names);
    setProgramPins(pins);
    const own = code.defs.filter((d) => !LIBRARY.code.nodes[d]);
    const lib = checkedForRun(code, names, def), info = lib.info;
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
      print,
      names: lib.names, world,
      stuck: (r: Reading) => { stuck = { text: r.text, at: r.at, expected: [...r.expected], said: stuckReading(r), times: (stuck?.times ?? 0) + 1 }; },
    };
    // main printed from the core IR, as lab compile does (E244): machine's
    // run takes 12 s in the evaluator, a fraction of a second printed. The
    // evaluator where main doesn't lower there.
    const printed = coreMain(lib.code, info, lib.names, def, !!args);
    if (printed && runPrinted(printed, info, args, rt.world, rt.print, flush, () => [...wrote])) return;
    // With its arguments main gives an exit code, which shows when it isn't 0.
    const exit = (c: number) => (c ? `exit ${c}` : "unit");
    const shown = args ? exit(runProgram(lib.code, info, def, args, rt)) : shower(lib.code, info, lib.names)(runMain(lib.code, info, def, rt));
    flush();
    post({ done: true, shown, files: [...wrote], ...(stuck ? { stuck } : {}), profile: profile() });
  } catch (err) {
    flush();
    post({ error: (err as Error).message, files: [...wrote], ...(stuck ? { stuck } : {}) });
  }
};

// A world that refuses what a program from a file wasn't allowed (E229):
// each of the effect's answers fails with the reason.
const ANSWERS: Record<Id, (keyof World)[]> = {
  [NETWORK]: ["fetchText", "startFetch"],
  [FILES]: ["readFile", "writeFile", "appendFile", "fileExists", "listFolder"],
};
function denied(world: World, deny: Id[], names: Names): World {
  const out = { ...world } as Record<string, unknown>;
  for (const e of deny) for (const k of ANSWERS[e] ?? []) if (k in world) out[k] = () => { throw new Error(`${names[e] ?? e} isn't allowed for this program: Run asked, and it wasn't ticked`); };
  return out as unknown as World;
}

// Run main printed from the core IR (coreMain.ts), answering the same
// world and printing the same way as the evaluator's run (run.ts
// runProgram, runMain): an Abort nothing handles prints its reason to
// standard error and, with arguments, exits with 1.
// `info`: the check's, for a derivative; without it (a kept or a built
// main) one that takes a derivative is lowered again. What ran goes back
// with the end, to keep for the next run of this code (E245c). false when
// it doesn't load: then the evaluator.
function runPrinted(m: CoreMain, info: Info | undefined, args: string[] | undefined, world: World, print: (line: string) => void, flush: () => void, files: () => [string, string][]): boolean {
  if (!info && m.printed.checked) return false;
  let fns;
  try { fns = loadPrinted(m.printed, { print, world }, m.printed.code, info); } catch { return false; }
  const kept = m.printed.checked ? {} : { printed: m };
  const ended = (shown: string, at?: StopAt) => { flush(); post({ done: true, shown, files: files(), core: true, ...kept, ...(at ? { at } : {}) }); };
  try {
    const v = fns[m.at](...(args ? [toList(args)] : []));
    ended(args ? ((n: number) => (n ? `exit ${n}` : "unit"))(m.result !== "other" ? Number(v) : 0) : "unit");
  } catch (e) {
    const reason = e instanceof CoreAborted ? String(e.reason) : e instanceof CoreStopped ? e.message : null;
    // The node a stop was lowered from (C143a), for Run to show (C143f).
    const at = e instanceof CoreStopped && e.node && e.def ? { node: e.node, def: e.def } : undefined;
    if (reason !== null && args) { world.error(reason); ended("exit 1", at); }
    else { flush(); post({ error: reason ?? (e as Error).message, files: files(), core: true, ...kept, ...(at ? { at } : {}) }); }
  }
  return true;
}

