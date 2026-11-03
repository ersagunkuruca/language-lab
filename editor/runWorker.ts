// Run main off the page's thread, so a long run (Countdown's main takes
// seconds) leaves the page drawing, shows its printing as it comes, and
// can be stopped: Stop ends the worker. editor/build.ts bundles this file
// on its own and the editor starts it from that text (RUN_WORKER), so the
// editor stays one file that opens from disk.
//
// The worker has no localStorage: the program's files come in as a copy,
// and what the run wrote goes back to the page with the result.

import type { Code, Id } from "../ters/src/model.ts";
import { isUse, subtree } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { browserWorld, type Store } from "../ters/src/lang/browser.ts";
import { mainProblem, runMain, runProgram, showValue, type World } from "../ters/src/lang/run.ts";
import type { Info } from "../ters/src/lang/infer.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { withLibraryRepresentations } from "../ters/src/lang/library-reps.ts";
import { infer, setDisplayNames, setProgramPins } from "./typed.ts";
import { searchBackwards, type BackAsk, type Found } from "./backSearch.ts";
import { stuckReading, type Reading } from "../ters/src/lang/relate.ts";
import { compile } from "../compiler/src/compile.ts";
import * as runtime from "../compiler/src/runtime.js";
import { $Aborted } from "../compiler/src/runtime.js";

// `compiled`: main as compiled JavaScript from an earlier run of this same
// code (E238), so the run needs no checking or compiling again.
export type RunAsk = { code: Code; names: Names; pins: Pins; def: Id; title: string; files: [string, string][]; args?: string[]; compiled?: Compiled };
export type Compiled = { program: string; name: string };
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
// `compiled`: main ran as compiled JavaScript (E238), so there's no profile.
export type RunSays = { lines: string[] } | { done: true; shown: string; files: [string, string][]; stuck?: Stuck; profile?: Profile; compiled?: Compiled } | { error: string; files: [string, string][]; stuck?: Stuck; compiled?: Compiled };

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
  const { code, names, pins, def, title, files, args, compiled: before } = e.data;
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
    const print = (line: string) => { lines.push(line); if (Date.now() - sent > 100) flush(); };
    if (before && runCompiled(before, args, browserWorld(store, title), print, flush, () => [...wrote])) return;
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
      print,
      names: lib.names, world: browserWorld(store, title),
      stuck: (r: Reading) => { stuck = { text: r.text, at: r.at, expected: [...r.expected], said: stuckReading(r), times: (stuck?.times ?? 0) + 1 }; },
    };
    // main as compiled JavaScript when it compiles (E238): machine's run
    // takes 12 s in the evaluator, 0.2 s compiled (plus 3 s compiling, once
    // per version of the code). A function run backwards inside main (a
    // text read back, L70c) says where its reading stopped only in the
    // evaluator, so such a main runs there.
    const backwards = runsBackwards(lib.code, def);
    const made = !backwards && (args || unitAction(info, def)) ? compiledMain(lib.code, info, lib.names, def) : undefined;
    if (made && runCompiled(made, args, rt.world, rt.print, flush, () => [...wrote])) return;
    // With its arguments main gives an exit code, which shows when it isn't 0.
    const exit = (c: number) => (c ? `exit ${c}` : "unit");
    const shown = args ? exit(runProgram(lib.code, info, def, args, rt)) : showValue(runMain(lib.code, info, def, rt), lib.code, lib.names);
    flush();
    post({ done: true, shown, files: [...wrote], ...(stuck ? { stuck } : {}), profile: profile() });
  } catch (err) {
    flush();
    post({ error: (err as Error).message, files: [...wrote], ...(stuck ? { stuck } : {}) });
  }
};

// Whether anything main reaches, the library's definitions included, runs
// a function backwards.
function runsBackwards(code: Code, main: Id): boolean {
  const seen = new Set<Id>([main]), todo = [main];
  while (todo.length) {
    const n = code.nodes[todo.pop()!];
    if (n?.kind !== "def" || !n.body) continue;
    for (const x of subtree(code, n.body)) {
      const m = code.nodes[x];
      if (isUse(m)) return true;
      if (m?.kind === "ref" && code.nodes[m.target]?.kind === "def" && !seen.has(m.target)) { seen.add(m.target); todo.push(m.target); }
    }
  }
  return false;
}

// An action whose result is Unit: what it gives shows as nothing, so the
// compiled run needs no showing of a value the evaluator's way (E238).
function unitAction(info: Info, def: Id): boolean {
  const t = info.typeOf.get(def);
  if (!t || t.t !== "fn" || t.params.length) return false;
  const r = info.subst.zonk(t.ret);
  return r.t === "con" && r.id === "std.unit";
}

// main compiled (compiler/src/compile.ts) for the runtime linked here.
// undefined when main has a problem or doesn't compile: the evaluator then
// runs it, and says what's wrong as it always has.
function compiledMain(code: Code, info: Info, names: Names, def: Id): Compiled | undefined {
  if (mainProblem(info, def, names)) return undefined;
  const name = names[def];
  if (!name) return undefined;
  try {
    const program = compile(code, info, names, { runtime: "$lab", exports: [name], link: "global", steps: false });
    // The program's own effects answered by a hosts/js.js: not in the editor.
    return /\$setHosts\(/.test(program) ? undefined : { program, name };
  } catch { return undefined; }
}

// Run main compiled, answering the same world and printing the same way as
// the evaluator's run (run.ts runProgram, runMain): an Abort nothing
// handles prints its reason to standard error and, with arguments, exits
// with 1. false when it can't be linked, so the evaluator runs it.
function runCompiled(c: Compiled, args: string[] | undefined, world: World, print: (line: string) => void, flush: () => void, files: () => [string, string][]): boolean {
  let f: unknown;
  try { f = (new Function("$lab", `${c.program}\nreturn defs;`)(runtime) as Record<string, unknown>)[c.name]; } catch { return false; }
  if (typeof f !== "function") return false;
  const ended = (shown: string) => { flush(); post({ done: true, shown, files: files(), compiled: c }); };
  const settle = (v: unknown) => ended(args ? ((n: number) => (n ? `exit ${n}` : "unit"))(typeof v === "number" || typeof v === "bigint" ? Number(v) : 0) : "unit");
  const failed = (e: unknown) => {
    if (!(e instanceof $Aborted)) { flush(); return post({ error: (e as Error).message, files: files(), compiled: c }); }
    const reason = (e as { reason: string }).reason;
    if (args) { world.error(reason); return ended("exit 1"); }
    flush(); post({ error: reason, files: files(), compiled: c });
  };
  runtime.$setWorld(world);
  runtime.$setPrint(print);
  try { const v = runtime.$main(args ? f(runtime.$toList(args)) : f()); if (v instanceof Promise) v.then(settle, failed); else settle(v); } catch (e) { failed(e); }
  return true;
}
