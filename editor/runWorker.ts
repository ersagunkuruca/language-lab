// Run main off the page's thread, so a long run (Countdown's main takes
// seconds) leaves the page drawing, shows its printing as it comes, and
// can be stopped: Stop ends the worker. editor/build.ts bundles this file
// on its own and the editor starts it from that text (RUN_WORKER), so the
// editor stays one file that opens from disk.
//
// The worker has no localStorage: the program's files come in as a copy,
// and what the run wrote goes back to the page with the result.

import { logged, MAIN_LOG_CAP, replaying, type LogEntry } from "../ters/src/lang/worldlog.ts";
import type { Code, Id } from "../ters/src/model.ts";
import { subtree } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { browserWorld, type Store } from "../ters/src/lang/browser.ts";
import { shower } from "./shown.ts";
import { loadPrinted } from "../compiler/src/core-js.ts";
import { keepOnMainThread, shareAlways } from "../compiler/src/scalar.ts";
import { isPlace, isPool } from "./choicesFor.ts";
import { checkedForRun, coreMain, type CoreMain } from "./coreMain.ts";
import { Aborted as CoreAborted, Stopped as CoreStopped } from "../compiler/src/core-rt.ts";
import { resolvedFor, runMain, runProgram, toList, type World } from "../ters/src/lang/run.ts";
import type { Info } from "../ters/src/lang/infer.ts";
import { FILES, NETWORK } from "../ters/src/lang/types.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { infer, setDisplayNames, setProgramPins } from "./typed.ts";
import { compilePageProgram, compileSavedPage, type CompiledPage } from "./pageCompile.ts";
import type { SavedScripts } from "../ters/src/lang/page.ts";
import { received, searchBackwards, type BackAsk, type Found } from "./backSearch.ts";
import { stuckReading, type Reading } from "../ters/src/lang/relate.ts";
import { receivedOnto, whereAnswers, type Answer } from "./whereAnswers.ts";
import { receivedCode, type SentCode } from "./runCode.ts";
import { addShipped, loadChecks } from "./checkStore.ts";
import { choicesFor } from "./choicesFor.ts";
import type { TestAsk, TestSays } from "./testAsk.ts";
import type { PictureAsk, PictureSays } from "./pictureAsk.ts";
import { buildPicture } from "./picture.ts";
import { colourOf, paintRows, type PaintAsk } from "./pictureDraw.ts";
import { runTests, savedFrom, type Saved } from "../ters/src/lang/tests.ts";

// `core`: main printed from the core IR, by an earlier run of this same
// code or built with the site (E245c), so the run needs no checking or
// lowering again.
// `replay`: answer from an earlier run's log instead of the world (E232b);
// `until`: give only that many of its answers, then pause (E232c).
export type RunAsk = { shipped?: Record<string, unknown>; code: SentCode; names: Names; pins: Pins; held?: [Id, string][]; def: Id; title: string; files: [string, string][]; args?: string[]; core?: CoreMain; deny?: Id[]; stdin?: string; replay?: LogEntry[]; until?: number };
// Run's worker is kept between runs and started before the first (I177):
// `warm` checks the program, so the library's check is kept by the time
// Run main is pressed.
export type WarmAsk = { shipped?: Record<string, unknown>; warm: true; code: SentCode; names: Names; pins: Pins; held?: [Id, string][]; def: Id };
// args: main takes the command line's words, as `ters run` gives them (E212).
// A page compiled the way "Open in a tab" does (page.ts corePageFile), off the
// page's thread: the preview swaps it in when it's ready (main.ts startPage).
// `saved`: only the page as Open in a tab gives it (pageCompile.ts
// compileSavedPage), a page with sound's too.
export type CompileAsk = { shipped?: Record<string, unknown>; compilePage: true; code: SentCode; names: Names; pins: Pins; held?: [Id, string][]; main: Id; saved?: true };
// Printed from the core IR (core-js.ts corePageScript), the script
// calling $core.startCorePage (E244).
export type CompileSays = CompiledPage | { saved: SavedScripts } | { error: string };
// Where some of the program's own definitions can run (whereRuns.ts,
// L22a): for each in `only`, why a shader can't hold it and why
// WebAssembly and C can't, or null (whereAnswers.ts).
export type WhereAsk = { whereRuns: true; code: SentCode; names: Names; pins: Pins; only: Id[] };
export type WhereSays = { answers: [Id, ...Answer][] } | { error: string };
// The program's choices for main (choicesFor.ts, E292), as `ters choices`
// writes them.
export type ChoicesAsk = { choices: true; code: SentCode; names: Names; pins: Pins; held?: [Id, string][]; main: Id };
// `would`: for each held type, the row the compiler would pick instead.
export type ChoicesSays = { choices: string[]; would: [Id, string][]; refused?: string } | { error: string };
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
export type RunSays = { lines: string[] } | { checking: boolean } | { done: true; shown: string; files: [string, string][]; stuck?: Stuck; profile?: Profile; core?: true; printed?: CoreMain; answers?: LogEntry[]; paused?: true; at?: StopAt } | { error: string; files: [string, string][]; stuck?: Stuck; core?: true; printed?: CoreMain; answers?: LogEntry[]; paused?: true; at?: StopAt };

// The program Build targets asked about last (whereAnswers.ts receivedOnto).
let lastWhere: Code | null = null;

// The run's log of the world's answers (worldlog.ts), sent with its end.
let answers: LogEntry[] | null = null, paused = false;
// The whole log, writes and bytes too, so Run again can answer from it.
const post = (m: RunSays | Found | CompileSays | WhereSays | ChoicesSays | TestSays | PictureSays) => (self as unknown as Worker).postMessage(answers && ("done" in m || ("error" in m && "files" in m)) ? { ...m, answers, ...(paused ? { paused: true } : {}) } : m);

// Standard input typed into Run's box (I168), read as `ters run` reads a
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

// The same program as the last ask keeps its code (I177), so its check
// for running and its arithmetic resolved (run.ts resolvedFor, kept by
// the code) are kept too: calc's run was 0.14 s of checking and 0.6 s of
// resolving each time, then printing `→ 0` at once.
let lastAsk: { key: string; code: Code; def?: Id; lib?: ReturnType<typeof checkedForRun> } | null = null;
const askKey = (given: SentCode, names: Names, pins: Pins, held: [Id, string][]) => JSON.stringify([given, names, pins, held]);
function checked(given: SentCode, names: Names, pins: Pins, def: Id, held: [Id, string][] = [], key = askKey(given, names, pins, held)): ReturnType<typeof checkedForRun> {
  if (lastAsk?.key !== key) lastAsk = { key, code: receivedCode(given) };
  setDisplayNames(names);
  setProgramPins(pins);
  if (lastAsk.def === def && lastAsk.lib) return lastAsk.lib;
  const lib = checkedForRun(lastAsk.code, names, def, held);
  lastAsk.def = def;
  lastAsk.lib = lib;
  return lib;
}

// The checks this build kept in the browser (checkStore.ts), read before
// the first ask: the worker checked the library anew each time it was
// started (I203), its whole check and its bodies, though the page had
// kept them.
const checksRead = loadChecks();
const asked: MessageEvent<Ask | PaintAsk>[] = [];
if (checksRead) {
  self.onmessage = (e) => { asked.push(e); };
  void checksRead.then(() => { self.onmessage = onAsk; for (const e of asked.splice(0)) onAsk(e); });
} else self.onmessage = onAsk;

// The placements held in Choices (E292, L280h), set for the lowering of
// the ask (scalar.ts keeps them for the next): main's work kept on the
// main thread, or a command-line program's shared out always; and how
// many workers main starts (L280e), on whichever target it is lowered
// for. The types' held rows are the rest.
function placed(held: [Id, string][] = []): [Id, string][] {
  keepOnMainThread(held.filter(([, r]) => r === "main thread").map(([id]) => id), []);
  const pool = held.find(([, r]) => isPool(r)), n = pool && Number(pool[1]);
  shareAlways(held.filter(([, r]) => r === "worker threads").map(([id]) => id), [], [], [], [], n !== undefined ? [["JavaScript", n], ["JavaScript page", n]] : []);
  return held.filter(([, r]) => !isPlace(r));
}

// A picture drawn on the CPU (pictureDraw.ts, E319c): its program made
// once, then its rows as they're asked for, each sent as it's drawn.
let painting: ReturnType<typeof colourOf> | null = null;
function paint(m: PaintAsk) {
  const failed = (err: unknown) => (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : String(err) });
  if ("paint" in m) {
    painting = colourOf(m.paint);
    return void painting.then(({ how, moving }) => (self as unknown as Worker).postMessage({ how, moving }), failed);
  }
  void painting?.then((c) => { const got = paintRows(c.colourAt, m.rows); (self as unknown as Worker).postMessage(got, [got.data.buffer]); }).catch(failed);
}

type Ask = RunAsk | WarmAsk | BackAsk | CompileAsk | WhereAsk | ChoicesAsk | TestAsk | PictureAsk;
function onAsk(e: MessageEvent<Ask | PaintAsk>) {
  if ("paint" in e.data || "rows" in e.data) paint(e.data); else answer(e as MessageEvent<Ask>);
}
function answer(e: MessageEvent<Ask>) {
  answers = null; paused = false;
  // The program's groups as the build checked them (E314), from the page.
  if ("shipped" in e.data && e.data.shipped) addShipped(e.data.shipped);
  // The choices list every placement as the compiler makes it, the held
  // marked (choicesFor.ts); runs and pages are lowered with them held.
  if ("held" in e.data && !("choices" in e.data)) e.data.held = placed(e.data.held);
  else placed([]);
  if ("warm" in e.data) {
    const { code, names, pins, def, held } = e.data;
    try { const lib = checked(code, names, pins, def, held); resolvedFor(lib.code, lib.info, lib.names); } catch { /* the run says what's wrong */ }
    return post({ checking: false });
  }
  if ("choices" in e.data) {
    const { names, pins, main, held } = e.data;
    try {
      setDisplayNames(names);
      setProgramPins(pins);
      return post(choicesFor(receivedCode(e.data.code), names, main, held));
    } catch (err) {
      return post({ error: (err as Error).message });
    }
  }
  // A program's tests (testAsk.ts, E319b), as ters test runs them.
  if ("tests" in e.data) {
    const { names, pins, defs, examples, title, files } = e.data;
    try {
      setDisplayNames(names);
      setProgramPins(pins);
      const code = receivedCode(e.data.code), info = infer(code, names);
      if (info.errors.length) return post({ errors: info.errors.length, first: info.errors[0].message });
      const kept = new Map(files);
      const store: Store = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => { kept.set(k, v); }, get length() { return kept.size; }, key: (i) => [...kept.keys()][i] ?? null };
      const quiet = { log: () => {}, error: () => {} } as unknown as Console;
      return post({ results: runTests(code, info, names, defs, savedFrom(examples as Record<Id, string[] | Saved[]>), { world: browserWorld(store, title, quiet) }) });
    } catch (err) {
      return post({ error: (err as Error).message });
    }
  }
  // A picture lowered and its CPU program made (pictureAsk.ts, E319c).
  if ("picture" in e.data) {
    const { names, pins, entries } = e.data;
    void (async (): Promise<PictureSays> => {
      setDisplayNames(names);
      setProgramPins(pins);
      const code = receivedCode(e.data.code), info = infer(code, names);
      return { built: await buildPicture(code, info, names, entries, false) };
    })().then(post, (err) => post({ error: (err as Error).message }));
    return;
  }
  if ("whereRuns" in e.data) {
    const { names, pins, only } = e.data;
    try {
      setDisplayNames(names);
      setProgramPins(pins);
      // Build targets' worker is kept (I316): the program checked over its
      // last check, so after the first ask an edit is checked, not the
      // whole program.
      const code = (lastWhere = receivedOnto(e.data.code, lastWhere));
      return post({ answers: whereAnswers(code, infer(code, names), names, only) });
    } catch (err) {
      return post({ error: (err as Error).message });
    }
  }
  if ("compilePage" in e.data) {
    const { names, pins, main, saved, held } = e.data, code = receivedCode(e.data.code);
    try {
      // From the core IR, as Save page does.
      return post(saved ? { saved: compileSavedPage(code, names, pins, main, held) } : compilePageProgram(code, names, pins, main, held));
    } catch (err) {
      return post({ error: (err as Error).message });
    }
  }
  // A function run backwards, searched to the end, or for a minute at
  // most (backSearch.ts).
  if ("backwards" in e.data) {
    const { def, values, names } = e.data, until = Date.now() + 60000;
    return post(searchBackwards(receivedCode(e.data.code), def, received(values), names, () => Date.now() > until));
  }
  const { code: given, names, pins, held, def, title, files, args, core, deny, stdin, replay, until } = e.data;
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
    const logging = logged(replay ? replaying(replay, real, until, () => { paused = true; }) : real, [], { cap: MAIN_LOG_CAP });
    const world = logging.world;
    answers = logging.log;
    if (core && core.args === !!args && runPrinted(core, undefined, args, world, print, flush, () => [...wrote])) return;
    // A check to do first is said (I320): Run pressed right after an edit.
    const key = askKey(given, names, pins, held ?? []), toCheck = !(lastAsk?.key === key && lastAsk.def === def && lastAsk.lib);
    if (toCheck) post({ checking: true });
    const lib = checked(given, names, pins, def, held, key), info = lib.info;
    if (toCheck) post({ checking: false });
    const own = lastAsk!.code.defs.filter((d) => !LIBRARY.code.nodes[d]);
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
    // main printed from the core IR, as ters compile does (E244): machine's
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
}

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

