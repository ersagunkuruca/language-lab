// The commands of ters (cli/ters.ts says what each does).
import type { Plugin } from "esbuild";
import { gradeMistakes } from "../src/lang/grades.ts";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { merge, type Code, type Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { fromFile } from "../src/files.ts";
import { infer, type Info, type Options } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { addToStore, lineageOf, pointsAt, previousVersion, publishVersion, sameLines, upgrade, upgradeNames, upgradeOwn, verify, type Module } from "../src/lang/modules.ts";
import { base, baseNames, loadProgram, optionsWith, programModules, programStore } from "../src/lang/load.ts";
import { equal, mainProblem, pageProblem, runMain, runProgram, showerFor, valueMain, type Value, type World } from "../src/lang/run.ts";
import { Cells } from "../src/lang/cells.ts";
import { evaluatorCall, htmlText } from "../src/lang/html.ts";
import { pageDocument } from "../src/lang/page.ts";
import { showType, STRING } from "../src/lang/types.ts";
import { Lang } from "../src/lang/dsl.ts";
import { S, SHOW_ANY } from "../src/lang/std.ts";
import { choose, representationsIn } from "../src/lang/represent.ts";
import { allowedOnly, nodeWorld } from "../src/lang/world.ts";
import { readLog, replaying, type LogEntry } from "../src/lang/worldlog.ts";
import { CFLAGS, emitC } from "../../compiler/src/c.ts";
import { emitWasm } from "../../compiler/src/wasm.ts";
import { mapsInPlaceCounted, ownedArrays } from "../../compiler/src/owned-arrays.ts";
import { columns } from "../../compiler/src/columns.ts";
import { untaggedLoops } from "../../compiler/src/untagged-ints.ts";
import { parallelColumnMaps } from "../../compiler/src/par-columns.ts";
import { intoAsSets, ownedRecords } from "../../compiler/src/owned-records.ts";
import { lowerScalar } from "../../compiler/src/scalar.ts";
import { FAIL, Unsupported, codeLines, coreCall, coreMap, coreModule, hostOpsOf, loadCoreJs, lowerCore, plainValue, runCoreMain } from "../../compiler/src/core-js.ts";
import { withInverses } from "../../compiler/src/inverses.ts";
import { execFileSync } from "node:child_process";
import { recordings, webCorePage } from "./web.ts";
import { appFolder } from "./app.ts";
import { nativeAppFolder } from "./native-app.ts";
import { soundOf } from "./sound.ts";
import { readWav, writeWav } from "./wav.ts";
import { represented as representedOr, type Program } from "./represented.ts";
import { audioProblem, BLOCK, playBlocks } from "../src/lang/audio.ts";
import { answersAgain, checkedTests, checksAgain, compiledValue, mainCall, mainDiffers, runMainIn, runTests, savedFrom, testsIn, type Again, type Called, type Failure, type Saved } from "../src/lang/tests.ts";
import { representationLaws } from "../src/lang/rep-laws.ts";
import { embeddingLaws } from "../src/lang/embed-laws.ts";
import { effectOfOperation, hostSkeleton, hostSkeletonC, ownOperations, type Hosts } from "../src/lang/hosts.ts";
import { evaluatorHash, readKept, resultKeys, writeKept } from "./checks.ts";
import { append, logFile, readLog as readLineageLog, readLogFile, signingKey } from "./logs.ts";

const USAGE = `ters: the command line for Ters, the language
usage:
  ters run <program> [arguments…]        run main, compiled through the core IR, or with the evaluator when it
                                        doesn't compile (a page prints as static HTML)
    [--evaluator]                       with the evaluator always
    [--replay log.json]                 answering from a run's log of the world's answers, such as a compiled
                                        program writes when TERS_LOG=log.json is set
  ters compile <program> [-o out.mjs]    compile to a JavaScript module that runs main, through the core IR,
                                        as WebAssembly and C are
  ters native <program> [-o out]         compile to a native program through C, with $CC (default cc)
  ters wasi <program> [-o out.wasm]      compile to a WASI command: WebAssembly with GC (wasmtime, Node's WASI)
  ters check <program>                   type-check, and list the definitions and their types
  ters hosts <program> [--c]             print a hosts/js.js answering the program's own effects, to start from;
                                        with --c a hosts/c.c, for ters native (FOREIGN.md)
  ters test <program> [--fresh]          run each definition that performs Check, check each accepted answer in examples.json
    [--compiled]                        and each representation's jobs against its type's through meaning;
                                        an unchanged test's result is kept by hash (.lab/checks.json), --fresh runs it again;
                                        --compiled: each accepted answer again, compiled to JavaScript through the core IR
  ters build-web <program> [-o app.html]  one HTML file running the page main returns, from the core IR
  ters build-app <program> [-o folder]   that page as an app for phones: a PWA in folder/www, and a Capacitor project
  ters build-native-app <program> [-o folder]  that page as a native Android app, no webview: its C and Android's
                                        own views, a Gradle project (gradle assembleDebug builds the APK)
  ters mcp [program]                     an MCP server over stdio: an LLM views, edits, runs and tests programs
  ters publish <program> <name…> [-o module.json]
                                        publish the named definitions, and the drafts they use, as their next
                                        versions in a module (default <program>.module.json): the old versions
                                        stay, and each keeps its draft's id as its lineage (SHARING.md §1)
  ters broken <module.json> <name> <n> <reason…> [--key file]
                                        mark version n of name broken in the module's log, signed with your key
                                        (default ~/.lab/key.pem, made on first use); ters publish signs each new
                                        version into the same log, and ters upgrade warns and won't move to it (§4)
  ters fetch <program> <url or path>     a module from any host into the program's modules folder, every definition
                                        checked by its hash, and its log beside it by its author's key (§4)
  ters downgrade <program> <name>        move what the program calls name back to the version before, from its
                                        store (store.json, every version it has used, kept by upgrade and
                                        downgrade, so it runs when a module's file is gone; §4b)
  ters upgrade <program> [--take-names]  move a program onto the newest versions of what it uses from the
                                        modules in its modules folder, where each new pin is at least as
                                        general as the old, and keep it only if its tests still pass (§2);
                                        its names stay its own unless --take-names takes the author's (§5)
  ters render <program> in.wav [-o out.wav] [--block n] [--compiled]
                                        play the sound main makes over a WAV file, n samples a block (default 128)
options:
  --main <name>    the entry point (default: main)
  --as-defined     ignore the program's representations and run the definitions as written
  --allow <list>   ters run answers only these: network, files, fetch=host (the network for one host);
                   without it a run reaches everything
A program is a file saved by the editor, or a folder like examples/sort.`;


// What the logs beside a program's modules say (L114a): versions marked
// broken, and each lineage's author. A log that doesn't check out is
// refused whole, and said.
function moduleLogs(dir: string, store: Module | null): { broken: Record<Id, string>; authors: Record<Id, string> } {
  const at = join(dir, "modules"), out = { broken: {} as Record<Id, string>, authors: {} as Record<Id, string> };
  if (!existsSync(at)) return out;
  for (const f of readdirSync(at).filter((x) => x.endsWith(".json") && !x.endsWith(".log.json")).sort()) {
    const r = readLineageLog(readLogFile(join(at, f)), store?.authors ?? {});
    if (r.problem) { console.log(`warn   modules/${f}'s log is refused: ${r.problem}`); continue; }
    Object.assign(out.broken, r.broken);
    for (const [l, k] of Object.entries(r.authors)) out.authors[l] ??= k;
  }
  return out;
}

function fail(message: string): never {
  process.stderr.write(`ters: ${message}\n`);
  process.exit(2);
}

function load(path: string): Program {
  if (!existsSync(path)) fail(`no such program: ${path}`);
  if (statSync(path).isDirectory()) {
    const p = loadProgram(path);
    const info = infer(p.code, p.pres.names, undefined, p.options);
    return { title: basename(resolve(path)), code: p.code, own: p.own.defs, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, p.own.defs), options: p.options };
  }
  // opened on top of the modules, as the editor does
  const r = fromFile(readFileSync(path, "utf8"), () => LIBRARY.code);
  if ("error" in r) fail(`can't open ${path}: ${r.error}`);
  const names = baseNames(r.file.names);
  // The file's own pins too (L173c), as the editor checks it.
  const options = optionsWith(r.file.signatures);
  const info = infer(r.code, names, undefined, options);
  return { title: r.file.title, code: r.code, own: r.file.code.defs, names, info, reps: representationsIn(r.code, info, names, r.file.code.defs), options };
}

// Each definition with an accepted answer as the core IR's JavaScript
// prints it (T7e), called on the evaluator's values, which it takes as
// they are; its first answer, or none.
function compiledAnswers(p: Program, saved: Record<Id, Saved[]>) {
  const defs = p.own.filter((d) => (saved[d] ?? []).some((x) => x.answer !== undefined));
  if (!defs.length) return [];
  let ir: ReturnType<typeof lowerCore>, fns: ((...xs: unknown[]) => unknown)[];
  try { ir = lowerCore(p.code, p.info, p.names, defs); fns = loadCoreJs(ir, { print: () => {}, world: nodeWorld() }); }
  catch (e) { const why = `didn't lower (${(e as Error).message})`; return answersAgain(p.code, p.info, p.names, defs, saved, () => why); }
  return answersAgain(p.code, p.info, p.names, defs, saved, (d) => {
    const why = ir.refused.get(d);
    if (why) return why;
    const i = ir.funcs.findIndex((g) => g.def === d && !g.inner);
    if (i < 0) return "isn't among the compiled functions";
    if (ir.funcs[i].multi) return "gives several answers, which a call from here doesn't take yet";
    return (args): Called => {
      try { return { value: fns[i](...args.map(compiledValue)) as Value }; } catch (e) {
        if (e === FAIL) return { none: true };
        throw e instanceof Error ? e : new Error(String((e as { reason?: unknown }).reason ?? e));
      }
    };
  });
}

// main's accepted answers (T7e16), main compiled to JavaScript through
// the core IR and run in each recorded world, as the evaluator's run is.
function compiledMains(p: Program, saved: Record<Id, Saved[]>): Again[] {
  // A main that is a value prints it, as run.ts runProgram does (T7e15).
  const shown = showerFor(p.code, p.info, p.names);
  const valueOf = (ir: ReturnType<typeof lowerCore>, d: Id, print: (l: string) => void, world: World): number => {
    const fi = ir.funcs.findIndex((g) => g.def === d && !g.inner && !g.budgeted);
    const v = loadCoreJs(ir, { print, names: p.names, world } as never)[fi]();
    print(typeof v === "string" ? v : shown(plainValue(v) as Value, true));
    return 0;
  };
  return p.own.filter((d) => (saved[d] ?? []).some((x) => x.main)).map((d) => {
    const name = p.names[d] ?? d;
    let ir: ReturnType<typeof lowerCore>;
    try { ir = lowerCore(p.code, p.info, p.names, [d]); } catch (e) { return { def: d, name, cases: 0, failures: [], skipped: `didn't lower (${(e as Error).message})` }; }
    const why = ir.refused.get(d);
    if (why) return { def: d, name, cases: 0, failures: [], skipped: why };
    const failures: Failure[] = [];
    let cases = 0;
    try {
      for (const s of saved[d] ?? []) {
        if (!s.main) continue;
        cases++;
        const m = s.main;
        const got = runMainIn(p.code, p.info, p.names, d, m, {}, (world, print) => (valueMain(p.info, d) ? valueOf(ir, d, print, world) : runCoreMain(ir, name, m.arguments, { print, names: p.names, world } as never)));
        const what = mainDiffers(got, m);
        if (what.length) failures.push({ inputs: [mainCall(m)], what });
      }
    } catch (e) { return { def: d, name, cases, failures, error: (e as Error).message }; }
    return { def: d, name, cases, failures };
  });
}

// Each test of the program's own, as the core IR's JavaScript runs it
// (T7e2): its checked definition (tests.ts checkedTests), called on the
// inputs the evaluator's run uses; the first expect that failed, or none.
function compiledChecks(p: Program, saved: Record<Id, Saved[]>) {
  const tests = testsIn(p.info, p.own);
  if (!tests.length) return [];
  const c = checkedTests(p.code, p.names, tests);
  let ir: ReturnType<typeof lowerCore>, fns: ((...xs: unknown[]) => unknown)[];
  try {
    const info = infer(c.code, c.names, undefined, p.info.options);
    if (info.errors.length) throw new Error(info.errors[0].message);
    ir = lowerCore(c.code, info, c.names, [...c.wrappers.values()]);
    fns = loadCoreJs(ir, { print: () => {}, world: nodeWorld() });
  } catch (e) { const why = `didn't lower (${(e as Error).message})`; return checksAgain(p.code, p.info, p.names, tests, saved, () => why); }
  return checksAgain(p.code, p.info, p.names, tests, saved, (d) => {
    const w = c.wrappers.get(d);
    if (!w) return "isn't a function written in place";
    const why = ir.refused.get(w);
    if (why) return why;
    const i = ir.funcs.findIndex((g) => g.def === w && !g.inner);
    if (i < 0) return "isn't among the compiled functions";
    if (ir.funcs[i].multi) return "searches, and a search's paths aren't taken from here yet";
    return (args): Called => {
      try { return { value: fns[i](...args.map(compiledValue)) as Value }; } catch (e) {
        if (e === FAIL) return { none: true };
        throw e instanceof Error ? e : new Error(String((e as { reason?: unknown }).reason ?? e));
      }
    };
  });
}

function represented(p: Program, main: Id, hostMaps: boolean, tables = false, sound = false): Program {
  try { return representedOr(p, main, hostMaps, tables, sound); } catch (e) { fail((e as Error).message); }
}

// The program lowered for C and WebAssembly (ters native, ters wasi):
// inverse(f, …) of a named f, as the core IR's JavaScript has it (a
// printer's by its reader written out, C110 s7c), since they can't solve;
// a main that is a value prints it, as ters run does; the host answers an
// effect the program never handles itself, and one it handles is on the
// handler stack (L213c4), as effects' Ask is. In WebAssembly a replace in
// an array nobody else holds, and a record rebuilt from one nobody else
// holds, are written in place (C56), as in compiled JavaScript; C knows
// arrays from its counts. In C a map whose function only computes shares
// its items out on threads (L101, c.ts `par:map`).
// `page`: main gives Html, mounted rather than printed (C199c).
function nativeLowered(main: Id, wasm = false, page = false) {
  const q0 = withInverses(p.code, p.info, p.names);
  const { q, root } = !page && valueMain(q0.info, main) ? printingMain(q0, main) : { q: q0, root: main };
  const handled = new Set(Object.values(q.code.nodes).flatMap((n) => (n.kind === "arm" ? [n.variant] : [])));
  const hosted = new Set(ownOperations(q.code).flatMap((op) => (handled.has(op) ? [] : effectOfOperation(q.code, op) ?? [])));
  const lowered = lowerScalar(q.code, q.info, q.names, [root], { data: true, releases: true, handlers: true, hosted, threads: !wasm, cells: true, closureArgs: true });
  // A map writes into the array it was given (C60 c2): in place where
  // nothing else counts it.
  if (!wasm) {
    mapsInPlaceCounted(lowered);
    // And an array of records whose loops read and write it field by
    // field, so on C, each field in its slot (columns.ts).
    ownedRecords(lowered, q.code, q.info, q.names, root);
    columns(lowered, lowered.funcs.flatMap((g, i) => (g.def === root && !g.inner ? [i] : [])));
    // And a loop's counting Ints as plain int64s (C207e, untagged-ints.ts).
    untaggedLoops(lowered);
    // And such a map stepping slot by slot on the threads (par-columns.ts).
    parallelColumnMaps(lowered);
  }
  // On WebAssembly (no counts), a map writes into its array where every
  // array of its type has one holder, as on JavaScript (owned-arrays.ts).
  if (wasm) {
    ownedArrays(lowered, q.code, q.info, q.names, root, true);
    ownedRecords(lowered, q.code, q.info, q.names, root);
    columns(lowered, lowered.funcs.flatMap((g, i) => (g.def === root && !g.inner ? [i] : [])));
    intoAsSets(lowered);
  }
  return { lowered, root };
}

// A program whose main is a value, with a main that prints it (`ters
// native`): a Text as it is, anything else as show shows it.
function printingMain(q: { code: Code; info: Info; names: Names }, main: Id): { q: { code: Code; info: Info; names: Names }; root: Id } {
  const k = new Lang(q.code), t = q.info.typeOf.get(main);
  const root = k.def("main printed");
  const text = t?.t === "con" && t.id === STRING;
  k.define(root, k.thunk(() => k.call(S.print, text ? k.x(main) : k.call(SHOW_ANY, k.x(main)))));
  const code = { nodes: { ...q.code.nodes, ...k.code.nodes }, defs: [...q.code.defs, ...k.code.defs] }, names = { ...q.names, ...k.names };
  return { q: { code, info: infer(code, names, undefined, q.info.options), names }, root };
}

// `ters run` takes a page too: it prints, once, as static HTML.
let staticPage = false;
function entry(p: Program, name: string, web = false): Id {
  const errors = p.info.errors;
  if (errors.length) fail(`${p.title} has ${errors.length} error${errors.length === 1 ? "" : "s"}:\n${errors.map((e) => `  ${p.names[e.id] ?? e.id}: ${e.message}`).join("\n")}`);
  const def = p.own.find((d) => p.names[d] === name);
  if (!def) fail(`${p.title} has no definition named ${name}`);
  if (!web && !pageProblem(p.info, def, p.names)) { staticPage = true; return def; }
  if (!web && valueMain(p.info, def)) return def;
  // The program's own effects, when its host file for this command is
  // there (FOREIGN.md): hosts/c.c for a native program, else hosts/js.js.
  const hostsAt = existsSync(path) && statSync(path).isDirectory() ? join(path, "hosts", command === "native" ? "c.c" : "js.js") : "";
  const hosted = new Set(hostsAt && existsSync(hostsAt) ? ownOperations(p.code).flatMap((op) => effectOfOperation(p.code, op) ?? []) : []);
  const problem = web ? pageProblem(p.info, def, p.names) : mainProblem(p.info, def, p.names, hosted);
  if (problem) fail(`${name} can't be ${web ? "a page" : "run from the command line"}: ${problem}`);
  return def;
}

// The bundle keeps a module only when something in it is used (C82). The
// runtime imports run.ts for show and compare, run.ts imports arith.ts,
// and arith.ts imports the library, whose module code reads every
// published definition (prelude.json, trees.json: 3.4 MB of sheet's
// bundle, most of its start-up). None of this checkout's modules is
// imported for what it does on loading, so each is marked as having no
// side effects there, and the bundler drops what the program never calls.
const onlyWhatIsUsed: Plugin = {
  name: "only what is used",
  setup(build) {
    const marked = Symbol("resolved");
    build.onResolve({ filter: /^(\.\.?)?\// }, async (a) => {
      if (a.pluginData === marked || a.kind === "entry-point") return undefined;
      const r = await build.resolve(a.path, { importer: a.importer, resolveDir: a.resolveDir, kind: a.kind, pluginData: marked });
      return r.errors.length || r.external ? undefined : { path: r.path, sideEffects: false };
    });
  },
};

const argv = process.argv.slice(2);
let mainName = "main";
const defined = argv.indexOf("--as-defined");
if (defined >= 0) argv.splice(defined, 1);
const at = argv.indexOf("--main");
if (at >= 0) { mainName = argv[at + 1] ?? fail("--main needs a name"); argv.splice(at, 2); }
// `--allow network,files,fetch=host`: answer only these world effects
// (E229b). Without it the run reaches everything, as before.
const allowAt = argv.indexOf("--allow");
let allow: string[] | null = null;
if (allowAt >= 0) { allow = (argv[allowAt + 1] ?? fail("--allow needs a list, such as network,files")).split(",").filter(Boolean); argv.splice(allowAt, 2); }
// `--replay log.json`: answer from a run's log of the world's answers
// (L186), such as a compiled program writes with TERS_LOG set (C172a).
const replayAt = argv.indexOf("--replay");
let replay: LogEntry[] | null = null;
if (replayAt >= 0) { replay = readLog(readFileSync(argv[replayAt + 1] ?? fail("--replay needs a log file"), "utf8")); argv.splice(replayAt, 2); }
// A replay checks each write against the log and does none, but the
// lines a run prints to stderr are still printed, as the run printed them.
const replayed = (log: LogEntry[]): World => {
  const real = nodeWorld(), r = replaying(log, real) as unknown as Record<string, (...a: unknown[]) => unknown>;
  const shown = (op: "error" | "log") => (...a: unknown[]) => { r[op](...a); return (real[op] as (...x: unknown[]) => unknown)(...a); };
  return { ...r, error: shown("error"), log: shown("log") } as unknown as World;
};
// `--evaluator`: run on the evaluator even when main compiles (L118c).
const evalAt = argv.indexOf("--evaluator");
if (evalAt >= 0) argv.splice(evalAt, 1);
const world = () => (replay ? replayed(replay) : allow ? allowedOnly(nodeWorld(), allow) : nodeWorld());
const [command, path, ...rest] = argv;
// An MCP server for an LLM to read, change and run programs (mcp/server.ts).
if (command === "mcp") { (await import("../mcp/server.ts")).serve(path); await new Promise(() => {}); }
// Program files compared and merged id by id (merge-files.ts, L113).
if (command === "diff" || command === "merge") {
  const { describe, diffLines, merge3 } = await import("../src/merge-files.ts");
  const json = (f: string | undefined) => { if (!f || !existsSync(f)) return undefined; try { return JSON.parse(readFileSync(f, "utf8")); } catch { fail(`${f} isn't JSON`); } };
  if (command === "diff") {
    if (!path || !rest[0]) fail("diff needs two files: before and after");
    const beside = join(dirname(rest[0]), "names.default.json");
    const lines = diffLines(json(path), json(rest[0]), basename(rest[0]) === "code.json" && existsSync(beside) ? json(beside) : {});
    process.stdout.write(lines.length ? lines.join("\n") + "\n" : "no changes\n");
    process.exit(0);
  }
  const [ours, theirs, shown] = rest;
  if (!path || !ours || !theirs) fail("merge needs base, ours and theirs (git passes %O %A %B)");
  const o = json(ours), t = json(theirs);
  const { merged, conflicts } = merge3(json(path), o, t);
  // git reads the result from ours' file.
  writeFileSync(ours, JSON.stringify(merged, null, 2) + "\n");
  if (!conflicts.length) process.exit(0);
  // Names for the message: a code.json's are beside it.
  const beside = shown ? join(dirname(shown), "names.default.json") : "";
  const named = beside && existsSync(beside) ? { names: json(beside), ...(o && typeof o === "object" ? o : {}) } : o;
  process.stderr.write(`ters: ${shown ?? ours}: ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}, ours kept:\n${describe(conflicts, named, t).map((l) => `  ${l}\n`).join("")}`);
  process.exit(1);
}
// A module from any host, into a program's modules folder (SHARING.md §4,
// L114b): a URL or a path. Code fetched by hash checks itself, so where it
// came from needn't be trusted: verify rehashes every definition, and its
// log, fetched beside it, must be signed by the authors the program took.
if (command === "fetch") {
  const url = rest[0];
  if (!path || !url) fail("fetch needs a program folder and a module's URL or path");
  const get = async (u: string): Promise<string | null> => {
    if (/^https?:\/\//.test(u)) { const r = await fetch(u); return r.ok ? await r.text() : null; }
    return existsSync(u) ? readFileSync(u, "utf8") : null;
  };
  const text = (await get(url)) ?? fail(`nothing at ${url}`);
  let m: Module;
  try { m = JSON.parse(text); } catch { fail(`${url} isn't a module`); }
  const wrong = verify(m, LIBRARY.code);
  if (wrong) fail(`${url} isn't what it says: ${wrong}`);
  const logText = await get(url.replace(/\.json$/, "") + ".log.json");
  const log = logText ? JSON.parse(logText) : [];
  const store = programStore(path);
  const r = readLineageLog(log, store?.authors ?? {});
  if (r.problem) fail(`${url}'s log is refused: ${r.problem}`);
  const file = basename(url.replace(/[?#].*$/, ""));
  mkdirSync(join(path, "modules"), { recursive: true });
  writeFileSync(join(path, "modules", file), JSON.stringify(m, null, 2) + "\n");
  if (log.length) writeFileSync(join(path, "modules", logFile(file)), JSON.stringify(log, null, 2) + "\n");
  const ls = m.lineages ?? {};
  console.log(`fetched ${m.title}: ${m.code.defs.length} definitions checked by hash${Object.keys(ls).length ? `, ${Object.values(ls).map((vs) => `${m.names[vs.at(-1)!] ?? vs.at(-1)} at version ${vs.length}`).join(", ")}` : ""}${log.length ? `, its log signed by its author${Object.keys(r.broken).length ? ` (${Object.keys(r.broken).length} marked broken)` : ""}` : ", no log"}; ters upgrade moves the program onto it`);
  process.exit(0);
}
// A version marked broken in a module's log (SHARING.md §4, L114a).
if (command === "broken") {
  const [name, n, ...why] = rest.filter((a, i, xs) => a !== "--key" && xs[i - 1] !== "--key");
  const ki = rest.indexOf("--key");
  if (!path || !name || !n || !why.length) fail("broken needs a module file, a name, a version number and a reason");
  const m = JSON.parse(readFileSync(path, "utf8")) as Module;
  const lineages = m.lineages ?? {};
  const l = Object.keys(lineages).find((x) => lineages[x].some((v) => m.names[v] === name)) ?? fail(`${path} has no lineage named ${name}`);
  const v = lineages[l][Number(n) - 1] ?? fail(`${name} has ${lineages[l].length} version${lineages[l].length === 1 ? "" : "s"}`);
  const log = append(readLogFile(path), signingKey(ki >= 0 ? rest[ki + 1] : undefined), { kind: "broken", lineage: l, version: v, reason: why.join(" ") });
  const r = readLineageLog(log);
  if (r.problem) fail(`the log refuses it: ${r.problem}`);
  writeFileSync(logFile(path), JSON.stringify(log, null, 2) + "\n");
  console.log(`${name} version ${n} marked broken`);
  process.exit(0);
}
if (!command || command === "help" || command === "--help" || !path) {
  process.stdout.write(USAGE + "\n");
  process.exit(command && command !== "help" && command !== "--help" ? 2 : 0);
}

const loaded = load(path);
const main = command === "run" || command === "compile" || command === "native" || command === "wasi" || command === "build-web" || command === "build-app" || command === "build-native-app" ? entry(loaded, mainName, command.startsWith("build-")) : "";
const p = main && defined < 0 ? represented(loaded, main, command !== "native" && command !== "wasi" && command !== "build-native-app", command === "native" || command === "wasi" || command === "build-native-app") : loaded;
// The host's answers to the program's own effects (FOREIGN.md, L69a):
// hosts/js.js beside the program, if it has one.
const hostFile = existsSync(path) && statSync(path).isDirectory() ? join(path, "hosts", "js.js") : "";
const hosts: Hosts | undefined = hostFile && existsSync(hostFile) ? (await import(pathToFileURL(resolve(hostFile)).href)).default : undefined;
// A page or app bundles the same file into its script (L69a3).
const pageHost = hostFile && existsSync(hostFile) ? resolve(hostFile) : undefined;
// The program's page, for `ters build-web` and `ters build-app`, printed
// from the core IR (C137c9).
async function pageFile(): Promise<string> {
  try { return await webCorePage(p.title, p.code, p.info, p.names, main, pageHost); } catch (e) { fail((e as Error).message.replace(/^(ters|lab): /, "")); }
}

switch (command) {
  case "run": {
    if (staticPage) {
      // Every text, part and attribute called once, and the handlers left
      // out: server-side rendering without a server.
      // Through the core IR, as `ters build-web` makes it (C186: agent's
      // first frame took minutes on the evaluator); the evaluator where
      // main doesn't lower, with the program's own hosts, or --evaluator.
      if (evalAt < 0 && !hosts) {
        const ir = lowerCore(p.code, p.info, p.names, [main]);
        const fi = ir.funcs.findIndex((g) => g.def === main && !g.inner && !g.budgeted);
        if (!ir.refused.get(main) && fi >= 0) {
          try {
            const cells = new Cells(equal);
            const page = loadCoreJs(ir, { print: (s: string) => console.error(s), cells, world: world() } as never)[fi]() as Value;
            process.stdout.write(pageDocument(p.title, htmlText(page, coreCall)));
            break;
          } catch (e) { if (!(e instanceof Unsupported)) throw e; }
        }
      }
      const cells = new Cells(equal);
      const page = runMain(p.code, p.info, main, { print: (s) => console.error(s), names: p.names, cells, world: world(), hosts });
      process.stdout.write(pageDocument(p.title, htmlText(page, evaluatorCall)));
      break;
    }
    // Through the core IR's JavaScript when main lowers (L118c): tens of
    // times faster than the evaluator on a long run. The evaluator when it
    // doesn't, when the program has its own hosts, for a main that is a
    // value (printed as the evaluator shows it), or with --evaluator.
    if (evalAt < 0 && !hosts && !valueMain(p.info, main)) {
      const ir = lowerCore(p.code, p.info, p.names, [main]);
      if (!ir.refused.get(main)) {
        let wrote = false;
        const rt = { print: (s: string) => { wrote = true; console.log(s); }, names: p.names, world: world() };
        try { process.exitCode = runCoreMain(ir, p.names[main] ?? "main", rest, rt as never); break; } catch (e) {
          // A part the printed code doesn't have yet: the evaluator, if
          // nothing was printed. (A world effect done before it is done again.)
          if (!(e instanceof Unsupported) || wrote) throw e;
        }
      }
    }
    process.exitCode = runProgram(p.code, p.info, main, rest, { print: (s) => console.log(s), names: p.names, world: world(), hosts });
    break;
  }
  case "compile": {
    const o = rest.indexOf("-o");
    const out = o >= 0 ? rest[o + 1] ?? fail("-o needs a file") : `${basename(resolve(path)).replace(/\.json$/, "")}.mjs`;
    // One file with the runtime in it, so it runs anywhere Node does and
    // starts fast; without esbuild (a dev dependency), a module that
    // imports the runtime from this checkout.
    const esbuild = await import("esbuild").catch(() => null);
    // Printed from the core IR (C137c5), which WebAssembly and C print too.
    const source = (inCheckout: boolean): string => {
      // Only what main reaches (C168): a definition nothing calls isn't
      // compiled, so an unreached solve doesn't bring in the node table.
      const lowered = lowerCore(p.code, p.info, p.names, [main]);
      const why = lowered.refused.get(main);
      if (why) fail(`${p.names[main] ?? "main"} isn't compiled through the core IR: it ${why}`);
      const here = (f: string) => resolve(import.meta.dirname, f);
      // Its hosts/js.js, bundled in or imported from beside the program (C137d5).
      const host = pageHost ? { file: inCheckout ? pathToFileURL(pageHost).href : pageHost, ops: hostOpsOf(p.code, p.names) } : undefined;
      map = coreMap(lowered, !!host);
      return coreModule(lowered, p.names[main] ?? "main", here("../../compiler/src/core-rt.ts"), here("../src/lang/world.ts"), host);
    };
    // Beside the module, its map (C143c): ids only, the editor and tools
    // join the names.
    let map: object | null = null, printed = "";
    if (esbuild) {
      await esbuild.build({
        stdin: { contents: (printed = source(false)), resolveDir: import.meta.dirname, sourcefile: basename(out), loader: "js" },
        bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning",
        banner: { js: `// ${p.title}, compiled by ters (ters/cli/ters.ts), with its runtime. Run: node <this file> [arguments…]` },
        plugins: [onlyWhatIsUsed],
      });
    } else {
      writeFileSync(out, (printed = source(true)));
      process.stderr.write("ters: esbuild isn't installed (npm install in ters/), so the output imports the runtime from this checkout\n");
    }
    // Each function's lines in the module as written (C143e).
    if (map) writeFileSync(`${out}.map.json`, `${JSON.stringify({ ...map, lines: codeLines(printed, readFileSync(out, "utf8")) }, null, 1)}\n`);
    process.stderr.write(`ters: wrote ${out}${map ? ` (and ${out}.map.json)` : ""}; run it with: node ${out} [arguments…]\n`);
    break;
  }
  case "native": {
    // The program as one C file, then built by the system's C compiler
    // with the flags that keep the evaluator's numbers (compiler/src/c.ts).
    const o = rest.indexOf("-o");
    const out = o >= 0 ? rest[o + 1] ?? fail("-o needs a file") : basename(resolve(path)).replace(/\.json$/, "");
    // Its own effects' operations nothing handles, from hosts/c.c (L69b1).
    const cHost = existsSync(path) && statSync(path).isDirectory() ? join(path, "hosts", "c.c") : "";
    const hosts = { ops: hostOpsOf(p.code, p.names), c: cHost && existsSync(cHost) ? readFileSync(cHost, "utf8") : undefined };
    const { lowered, root } = nativeLowered(main);
    let c: string;
    try { c = emitC(lowered, { main: root, hosts }).c; } catch (e) { fail((e as Error).message); }
    writeFileSync(`${out}.c`, c);
    const cc = process.env.CC ?? "cc", flags = [...CFLAGS, "-pthread", "-o", out, `${out}.c`, "-lm"];
    try { execFileSync(cc, flags, { stdio: "inherit" }); } catch {
      fail(`wrote ${out}.c, but ${cc} didn't build it; build it with: cc ${flags.join(" ")}`);
    }
    process.stderr.write(`ters: wrote ${out} (and ${out}.c); run it with: ${out.includes("/") ? out : `./${out}`} [arguments…]\n`);
    break;
  }
  case "wasi": {
    // The program as a WASI command: WebAssembly with GC, its console and
    // files over wasi_snapshot_preview1 (compiler/src/wasm.ts), lowered as
    // ters native lowers it.
    const o = rest.indexOf("-o");
    const out = o >= 0 ? rest[o + 1] ?? fail("-o needs a file") : `${basename(resolve(path)).replace(/\.json$/, "")}.wasm`;
    const { lowered, root } = nativeLowered(main, true);
    if (!lowered.funcs.some((f) => f.def === root && !f.inner)) fail(`main isn't in WebAssembly: ${lowered.refused.get(root as never) ?? "it isn't lowered"}`);
    let m: ReturnType<typeof emitWasm>;
    try { m = emitWasm(lowered, { wasi: true, main: root }); } catch (e) { fail((e as Error).message); }
    writeFileSync(out, m.bytes);
    process.stderr.write(`ters: wrote ${out}; run it with: wasmtime -W gc=y,function-references=y,tail-call=y --dir . ${out} [arguments…]\n`);
    break;
  }
  case "build-web": {
    const o = rest.indexOf("-o");
    const out = o >= 0 ? rest[o + 1] ?? fail("-o needs a file") : `${basename(resolve(path)).replace(/\.json$/, "")}.html`;
    writeFileSync(out, await pageFile());
    // A recording the page plays, from the program's folder (AUDIO.md).
    const copied = recordings(p.code).filter((f) => existsSync(join(path, f)) && statSync(path).isDirectory());
    for (const f of copied) copyFileSync(join(path, f), join(dirname(out), f));
    process.stderr.write(`ters: wrote ${out}${copied.length ? ` and ${copied.join(", ")} beside it` : ""}; open it in a browser${copied.length ? " (from a web server: a page opened as a file can't fetch its recordings)" : ""}\n`);
    break;
  }
  case "build-app": {
    const o = rest.indexOf("-o");
    const out = o >= 0 ? rest[o + 1] ?? fail("-o needs a folder") : basename(resolve(path)).replace(/\.json$/, "");
    // Its page as `ters build-web` makes it: from the core IR (C137d24).
    for (const [file, x] of Object.entries(appFolder(p.title, await pageFile()))) {
      mkdirSync(dirname(join(out, file)), { recursive: true });
      writeFileSync(join(out, file), x);
    }
    process.stderr.write(`ters: wrote ${out}/; put ${out}/www on an HTTPS host to install it, or see ${out}/README.md for Android and iOS\n`);
    break;
  }
  case "build-native-app": {
    // The page as C (C199c, NATIVE-APPS.md), mounted on Android's views.
    const o = rest.indexOf("-o");
    const out = o >= 0 ? rest[o + 1] ?? fail("-o needs a folder") : `${basename(resolve(path)).replace(/\.json$/, "")}-android`;
    const { lowered, root } = nativeLowered(main, false, true);
    let c: string;
    try { c = emitC(lowered, { main: root, page: "ui" }).c; } catch (e) { fail((e as Error).message); }
    for (const [file, x] of Object.entries(nativeAppFolder(p.title, c))) {
      mkdirSync(dirname(join(out, file)), { recursive: true });
      writeFileSync(join(out, file), x);
    }
    process.stderr.write(`ters: wrote ${out}/; build the APK there with: gradle assembleDebug (see ${out}/README.md)\n`);
    break;
  }
  case "render": {
    const named = loaded.own.find((d) => loaded.names[d] === mainName) ?? fail(`${loaded.title} has no definition named ${mainName}`);
    // Stored as `ters compile` stores it, with the sound as the root (C137
    // s1), compiled or not, so the evaluator plays what is compiled (C197).
    const p = defined < 0 ? represented(loaded, named, true, false, true) : loaded, def = named;
    // Checked as written: stored, its blocks may be arrays (C196).
    const problem = audioProblem(loaded.info, def, loaded.names);
    if (problem) fail(`${mainName} can't be a sound: ${problem}`);
    const option = (flag: string) => { const at = rest.indexOf(flag); if (at < 0) return undefined; const v = rest[at + 1] ?? fail(`${flag} needs a value`); rest.splice(at, 2); return v; };
    const out = option("-o"), size = Number(option("--block") ?? BLOCK), compiled = rest.includes("--compiled");
    const input = rest.find((a) => !a.startsWith("--")) ?? fail("render needs a WAV file to play the sound over");
    if (!Number.isInteger(size) || size < 2 || size % 2) fail("--block takes an even number of samples, 2 or more");
    let wav;
    try { wav = readWav(readFileSync(input)); } catch (e) { fail(`${input}: ${(e as Error).message}`); }
    // --compiled: the core IR's JavaScript (C137d3).
    const played = playBlocks(await soundOf(p, def, compiled ? "core" : "evaluator"), wav.samples, size);
    const to = out ?? input.replace(/(\.wav)?$/i, ".out.wav");
    writeFileSync(to, writeWav({ rate: wav.rate, samples: played.out }));
    if (played.silent.length) process.stderr.write(`ters: ${played.silent.length} block${played.silent.length === 1 ? "" : "s"} played silence, the first (block ${played.silent[0].block}) because ${played.silent[0].why}\n`);
    process.stderr.write(`ters: wrote ${to}, ${(wav.samples.length / wav.rate).toFixed(2)} s at ${wav.rate} Hz\n`);
    break;
  }
  case "check": {
    for (const e of p.info.errors) console.log(`error  ${p.names[e.id] ?? e.id}: ${e.message}`);
    // A part read that is always 0, a wrong grade (GRADES.md, L43e).
    const wrongGrades = p.info.errors.length ? [] : gradeMistakes(p.code, p.info, p.own);
    for (const g of wrongGrades) console.log(`error  ${p.names[g.def] ?? g.def}: ${g.message}`);
    for (const d of p.own) {
      const t = p.info.typeOf.get(d);
      console.log(`${p.names[d] ?? d} : ${t ? showType(t, p.names) : "(a type)"}`);
    }
    // Drafts the same as a library definition or another draft, by hash
    // (SHARING.md §7): said, never merged, and not an error.
    for (const l of sameLines(p.code, p.names, LIBRARY)) console.log(`same   ${l}`);
    // How main stores each type the program writes representations for:
    // the compiler's choice, never the program's (REPRESENTATIONS.md).
    const start = p.own.find((d) => p.names[d] === mainName);
    if (start && !p.info.errors.length) for (const of of new Set(p.reps.map((r) => r.of))) {
      const c = choose(p.code, start, p.reps.filter((r) => r.of === of));
      console.log(`${p.names[of] ?? of} is stored as ${c.rep.name}, the cheapest for the jobs ${mainName} uses`);
    }
    process.exitCode = p.info.errors.length || wrongGrades.length ? 1 : 0;
    break;
  }
  case "publish": {
    // The named definitions as the next versions in a module file (L110).
    const o = rest.indexOf("-o");
    const out = o >= 0 ? rest[o + 1] ?? fail("-o needs a file") : `${resolve(path).replace(/[\\/]$/, "").replace(/\.json$/, "")}.module.json`;
    const wanted = rest.filter((_, i) => o < 0 || (i !== o && i !== o + 1));
    const ki = wanted.indexOf("--key");
    const keyFile = ki >= 0 ? wanted.splice(ki, 2)[1] : undefined;
    if (!wanted.length) fail("publish needs the names of the definitions to publish");
    if (p.info.errors.length) fail(`${p.title} has errors; ters check says which`);
    const defs = wanted.map((n) => p.own.find((d) => p.names[d] === n) ?? fail(`${p.title} has no definition named ${n}`));
    const prev = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as Module) : null;
    const r = publishVersion(prev, prev?.title ?? p.title, p.code, p.names, defs, LIBRARY.code, LIBRARY.pins);
    if (!r.ok) fail(r.reason);
    const wrong = verify(r.module, LIBRARY.code);
    if (wrong) fail(`the module isn't what it says: ${wrong}`);
    writeFileSync(out, JSON.stringify(r.module, null, 2) + "\n");
    const lineages = r.module.lineages ?? {};
    // Each new version said current in the module's log, signed (L114a).
    if (r.added.length) {
      const key = signingKey(keyFile);
      let log = readLogFile(out);
      for (const v of r.added) {
        const l = lineageOf(lineages, v)!, i = lineages[l].indexOf(v);
        log = append(log, key, { kind: "current", lineage: l, version: v, ...(i > 0 ? { was: lineages[l][i - 1] } : {}) });
      }
      writeFileSync(logFile(out), JSON.stringify(log, null, 2) + "\n");
    }
    for (const v of r.added) {
      const l = lineageOf(lineages, v)!;
      console.log(`${r.module.names[v] ?? v}: version ${lineages[l].indexOf(v) + 1}, ${v}`);
    }
    if (!r.added.length) console.log("nothing changed since the last publish");
    break;
  }
  case "upgrade":
  case "downgrade": {
    // The program onto its modules' newest versions (L111), or back to the
    // version before (L115), kept only if it still checks and its tests
    // pass. Every version it had stays in its store either way.
    const up = command === "upgrade";
    if (!statSync(path).isDirectory()) fail(`${command} takes a program folder, whose modules folder holds what it uses`);
    const store0 = programStore(path);
    const modules = [...programModules(path), ...(store0 ? [store0] : [])];
    const own = JSON.parse(readFileSync(join(path, "code.json"), "utf8")) as Code;
    let r: ReturnType<typeof upgradeOwn>;
    // What the modules' authors say in their logs (L114a): a used version
    // marked broken is said, and isn't moved to.
    const logs = moduleLogs(path, store0);
    const usedNow = new Set(Object.values(own.nodes).flatMap(pointsAt));
    for (const [v, why] of Object.entries(logs.broken)) if (usedNow.has(v)) console.log(`warn   ${p.names[v] ?? v} (${v}) is marked broken by its author: ${why}`);
    if (up) r = upgradeOwn(own, modules, p.names, new Set(Object.keys(logs.broken)));
    else {
      const name = rest.find((a) => !a.startsWith("--")) ?? fail("downgrade needs the name of what to move back");
      const used = new Set(Object.values(own.nodes).flatMap(pointsAt));
      const current = [...used].find((d) => p.names[d] === name && store0 && lineageOf(store0.lineages ?? {}, d)) ?? fail(`${p.title} uses nothing named ${name} that its store has versions of`);
      const back = previousVersion(store0!, current) ?? fail(`the store has no version of ${name} before this one`);
      const pins = Object.assign({}, ...modules.map((m) => m.pins));
      const u = upgrade(merge(...modules.map((m) => m.code), own), current, back, pins, p.names);
      if (!u.ok) fail(`${name} can't go back: ${u.reason}`);
      const ids = new Set(Object.keys(own.nodes));
      r = { own: { nodes: Object.fromEntries(Object.entries(u.code.nodes).filter(([id]) => ids.has(id))), defs: own.defs }, moved: [{ from: current, to: back, uses: u.uses }], refused: [] };
    }
    for (const x of r.refused) console.log(`kept   ${p.names[x.from] ?? x.from}: the newest version can't take its place, ${x.reason}`);
    if (!r.moved.length) { if (!r.refused.length) console.log("nothing to upgrade"); process.exitCode = r.refused.length ? 1 : 0; break; }
    const code = base(merge(...modules.map((m) => m.code), r.own));
    const info = infer(code, p.names, undefined, p.options as Options);
    if (info.errors.length) fail(`after the ${command}, ${info.errors.length} error${info.errors.length === 1 ? "" : "s"}:\n${info.errors.map((e) => `  ${p.names[e.id] ?? e.id}: ${e.message}`).join("\n")}\nnothing written`);
    const file = join(path, "examples.json");
    const saved = existsSync(file) ? savedFrom(JSON.parse(readFileSync(file, "utf8"))) : {};
    const failed = runTests(code, info, p.names, own.defs, saved, { world: nodeWorld(), hosts }).filter((t) => t.error || t.failures.length);
    if (failed.length) fail(`after the ${command}, ${failed.map((t) => t.name).join(", ")} fail${failed.length === 1 ? "s" : ""} (ters test says how); nothing written`);
    writeFileSync(join(path, "code.json"), JSON.stringify(r.own, null, 2) + "\n");
    // Both versions into the store (SHARING.md §4b, L115).
    const stored = addToStore(addToStore(store0, own, modules), r.own, modules);
    // The authors' keys pinned the first time the program took a lineage.
    const authors = { ...logs.authors, ...(store0?.authors ?? {}) };
    writeFileSync(join(path, "store.json"), JSON.stringify(Object.keys(authors).length ? { ...stored, authors } : stored, null, 2) + "\n");
    // The program's names stay its own (L112): the author's renames are
    // said once, and taken only with --take-names; going back takes the
    // names that version had.
    const namesFile = join(path, "names.default.json");
    const ownNames = existsSync(namesFile) ? JSON.parse(readFileSync(namesFile, "utf8")) as Names : {};
    const take = !up || rest.includes("--take-names");
    const nn = upgradeNames(r.moved, modules, ownNames, take);
    if (JSON.stringify(nn.names) !== JSON.stringify(ownNames)) writeFileSync(namesFile, JSON.stringify(nn.names, null, 2) + "\n");
    if (up && nn.renamed.length) console.log(`names  the author renamed ${nn.renamed.map((x) => `${x.from} → ${x.to}`).join(", ")}: ${take ? "taken" : "your names kept (--take-names takes theirs)"}`);
    for (const m of r.moved) {
      const l = modules.map((x) => x.lineages ?? {}).find((ls) => lineageOf(ls, m.to));
      const n = l ? l[lineageOf(l, m.to)!].indexOf(m.to) + 1 : 0;
      console.log(`moved  ${nn.names[m.to] ?? p.names[m.to] ?? m.to} to version ${n} (${m.uses} use${m.uses === 1 ? "" : "s"})`);
    }
    break;
  }
  case "hosts": {
    process.stdout.write(rest.includes("--c") ? hostSkeletonC(p.code, p.names, p.own) : hostSkeleton(p.code, p.names, p.own));
    break;
  }
  case "test": {
    // Accepted answers first, then saved inputs (examples.json, the editor's Run), then small values.
    const file = join(path, "examples.json");
    const saved = existsSync(file) && statSync(path).isDirectory() ? savedFrom(JSON.parse(readFileSync(file, "utf8"))) : {};
    for (const e of p.info.errors) console.log(`error  ${p.names[e.id] ?? e.id}: ${e.message}`);
    // A test whose key is kept isn't run again (T7c).
    const keys = p.info.errors.length ? new Map<Id, string>() : resultKeys(p.code, p.info, p.own, saved, evaluatorHash());
    const kept = rest.includes("--fresh") ? {} : readKept();
    const old = new Map(p.own.filter((d) => kept[keys.get(d) ?? ""]).map((d) => [d, { def: d, ...kept[keys.get(d)!], kept: true }]));
    // main's accepted answers on the program as ters run runs it, after the
    // chooser (T7e15e): numbers' main counts in Peano Nat as defined.
    const mainDef = p.own.find((d) => p.names[d] === mainName && (saved[d] ?? []).some((x) => x.main));
    let mains: Program | undefined;
    if (mainDef && !p.info.errors.length && defined < 0) { try { mains = representedOr(p, mainDef, true); } catch { /* as defined */ } }
    const ran = p.info.errors.length ? [] : runTests(p.code, p.info, p.names, p.own.filter((d) => !old.has(d)), saved, { world: nodeWorld(), hosts }, mains);
    const results = [...ran, ...old.values()].sort((a, b) => p.own.indexOf(a.def) - p.own.indexOf(b.def));
    if (ran.some((r) => keys.has(r.def))) {
      const now = readKept();
      for (const { def, ...r } of ran) if (keys.has(def)) now[keys.get(def)!] = r;
      writeKept(now);
    }
    for (const r of results) {
      if (r.error) console.log(`✗ ${r.name}: ${r.error}`);
      else if (!r.failures.length) console.log(`✓ ${r.name} (${r.cases} cases${"kept" in r ? ", unchanged since it last ran" : ""})`);
      for (const f of r.failures.slice(0, 3)) console.log(`✗ ${r.name}(${f.inputs.join(", ")}): ${f.what.join("; ")}`);
      if (r.failures.length > 3) console.log(`  … and ${r.failures.length - 3} more`);
    }
    // --compiled: the accepted answers again, compiled to JavaScript through
    // the core IR, which must give them too (T7e), and each test, run
    // compiled under a handler of its Check (T7e2); a definition that
    // doesn't lower is said, not failed.
    const again = rest.includes("--compiled") && !p.info.errors.length ? [...compiledAnswers(p, saved), ...compiledChecks(p, saved), ...compiledMains(mains ?? p, saved)] : [];
    for (const r of again) {
      if (r.skipped) console.log(`– ${r.name} compiled: not checked, it ${r.skipped}`);
      else if (r.error) console.log(`✗ ${r.name} compiled: ${r.error}`);
      else if (!r.failures.length) console.log(`✓ ${r.name} compiled (${r.cases} case${r.cases === 1 ? "" : "s"})`);
      for (const f of r.failures.slice(0, 3)) console.log(`✗ ${r.name} compiled(${f.inputs.join(", ")}): ${f.what.join("; ")}`);
    }
    // The program's own representations: each job agrees with its type's through meaning (L108d).
    const laws = p.info.errors.length ? [] : representationLaws(p.code, p.info, p.names, p.reps);
    for (const l of laws) {
      if (!l.failures.length) console.log(`✓ ${l.rep}'s ${l.job} agrees through its meaning (${l.cases} case${l.cases === 1 ? "" : "s"})`);
      for (const f of l.failures.slice(0, 3)) console.log(`✗ ${l.rep}'s ${l.job}(${f.inputs.join(", ")}): ${f.what}`);
      if (l.failures.length > 3) console.log(`  … and ${l.failures.length - 3} more`);
    }
    // The program's own embeddings keep + − · and < (L208b).
    const near = LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "near");
    const embedded = p.info.errors.length ? [] : embeddingLaws(p.code, p.info, p.names, new Set(p.own), near);
    for (const l of embedded) {
      if (l.error) console.log(`✗ ${l.name}: ${l.error}`);
      else if (!l.failures.length) console.log(`✓ ${l.embedding} keeps ${l.law} (${l.cases} case${l.cases === 1 ? "" : "s"})`);
      for (const f of l.failures.slice(0, 3)) console.log(`✗ ${l.embedding} doesn't keep ${l.law} at ${f.inputs.join(", ")}`);
    }
    laws.push(...embedded.map((l) => ({ rep: l.embedding, job: l.law, cases: l.cases, failures: l.error ? [{ inputs: [], what: l.error }] : l.failures.map((f) => ({ inputs: f.inputs, what: f.what.join("; ") })) })));
    if (!results.length && !laws.length && !p.info.errors.length) console.log("no tests: a test is a definition that performs Check (expect), or an accepted answer in examples.json");
    process.exitCode = p.info.errors.length || [...results, ...again].some((r) => r.error || r.failures.length) || laws.some((l) => l.failures.length) ? 1 : 0;
    break;
  }
  default:
    fail(`unknown command ${command}\n${USAGE}`);
}
