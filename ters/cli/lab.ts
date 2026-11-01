#!/usr/bin/env node
// lab: the language on the command line.
//
//   lab run <program> [arguments…]       run `main` with the evaluator; a page
//                                        prints as static HTML (WEB.md)
//   lab compile <program> [-o out.mjs]   compile to a JavaScript module that runs `main`
//   lab native <program> [-o out]        compile to a native program through C (NATIVE.md)
//   lab check <program>                  type-check, and list the definitions with their types
//   lab hosts <program>                  print a hosts/js.js to start from: the program's own effects (FOREIGN.md)
//   lab test <program> [--fresh]         run the tests: definitions whose row has Check (TESTS-IN-THE-LANGUAGE.md);
//                                        results kept by hash in .lab/checks.json, --fresh ignores them
//   lab build-web <program> [-o app.html] a page: one HTML file, opened anywhere (WEB.md)
//   lab build-app <program> [-o folder]  a page as an installable, offline app, and a Capacitor project
//   lab mcp [program]                    an MCP server on stdin/stdout (mcp/server.ts)
//   lab render <program> in.wav [-o out.wav] [--block n] [--compiled]
//                                        play a sound over a WAV file (AUDIO.md)
//
// A program is a file saved by the editor (Save file), or a folder of side
// tables like ters/examples/sort. `main` gets the arguments as a list
// of texts (or nothing, if it takes none) and returns the exit code; an
// Abort nothing handles prints its reason and exits with 1 (LANGUAGE.md,
// "The world"). `--main <name>` picks another entry point.
//
// A program that writes representations (REPRESENTATIONS.md) runs and
// compiles on the representation the chooser picks for each type `main` uses, e.g.
// Peano Nat stored as an Int. `--as-defined` runs the definitions instead.

import { gradeMistakes } from "../src/lang/grades.ts";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { fromFile } from "../src/files.ts";
import { infer, type Info } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { baseNames, checkOptions, loadProgram } from "../src/lang/load.ts";
import { equal, mainProblem, pageProblem, runMain, runProgram } from "../src/lang/run.ts";
import { Cells } from "../src/lang/cells.ts";
import { evaluatorCall, htmlText } from "../src/lang/html.ts";
import { pageDocument } from "../src/lang/page.ts";
import { showType } from "../src/lang/types.ts";
import { choose, jobProblem, represent, representationsIn, type Representation } from "../src/lang/represent.ts";
import { withLibraryRepresentations } from "../src/lang/library-reps.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { compile } from "../../compiler/src/compile.ts";
import { CFLAGS, emitC } from "../../compiler/src/c.ts";
import { lowerScalar } from "../../compiler/src/scalar.ts";
import { execFileSync } from "node:child_process";
import { recordings, webPage } from "./web.ts";
import { appFolder } from "./app.ts";
import { soundOf } from "./sound.ts";
import { readWav, writeWav } from "./wav.ts";
import { audioProblem, BLOCK, playBlocks } from "../src/lang/audio.ts";
import { runTests, savedFrom } from "../src/lang/tests.ts";
import { representationLaws } from "../src/lang/rep-laws.ts";
import { hostSkeleton, type Hosts } from "../src/lang/hosts.ts";
import { evaluatorHash, readKept, resultKeys, writeKept } from "./checks.ts";

const USAGE = `lab: the command line for Ters, the language
usage:
  lab run <program> [arguments…]        run main with the evaluator (a page prints as static HTML)
  lab compile <program> [-o out.mjs]    compile to a JavaScript module that runs main
  lab native <program> [-o out]         compile to a native program through C, with $CC (default cc)
  lab check <program>                   type-check, and list the definitions and their types
  lab hosts <program>                   print a hosts/js.js answering the program's own effects, to start from (FOREIGN.md)
  lab test <program> [--fresh]          run each definition that performs Check, check each accepted answer in examples.json
                                        and each representation's jobs against its type's through meaning;
                                        an unchanged test's result is kept by hash (.lab/checks.json), --fresh runs it again
  lab build-web <program> [-o app.html] one HTML file running the page main returns
  lab build-app <program> [-o folder]   that page as an app for phones: a PWA in folder/www, and a Capacitor project
  lab mcp [program]                     an MCP server over stdio: an LLM views, edits, runs and tests programs
  lab render <program> in.wav [-o out.wav] [--block n] [--compiled]
                                        play the sound main makes over a WAV file, n samples a block (default 128)
options:
  --main <name>    the entry point (default: main)
  --as-defined     ignore the program's representations and run the definitions as written
A program is a file saved by the editor, or a folder like examples/sort.`;

interface Program { title: string; code: Code; own: Id[]; names: Names; info: Info; reps: Representation[]; options?: unknown }

function fail(message: string): never {
  process.stderr.write(`lab: ${message}\n`);
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
  const info = infer(r.code, names, undefined, checkOptions);
  return { title: r.file.title, code: r.code, own: r.file.code.defs, names, info, reps: representationsIn(r.code, info, names, r.file.code.defs) };
}

// The program from `main`, with each type it uses stored the way the
// chooser picks from the declared costs (the definition itself is one of
// the choices). Library types (std's Map) are chosen for too, unless the
// table has a row for them (library-reps.ts, C47). The rewrite is checked
// again, like any program.
function represented(p: Program, main: Id): Program {
  // Every definition the program has, so the ones main shares with others
  // change together; types stay as they are for its own representations.
  // The library's are chosen over the types too, so a field typed Map
  // becomes the tree its code builds (GAPS.md M2).
  // A representation's own definition says which definitions do the jobs:
  // it is read, not rewritten or run, so the represented program leaves it out.
  const reps = new Set(p.reps.map((r) => r.def));
  const defs = p.own.filter((d) => { const b = (p.code.nodes[d] as { body?: Id | null }).body; return (!b || p.code.nodes[b]?.kind !== "typedef") && !reps.has(d); });
  const lib = withLibraryRepresentations(p.code, p.info, p.names, main, p.own, p.reps);
  let code = lib.code;
  const names = lib.names, chosen = [...lib.chosen];
  for (const of of new Set(p.reps.map((r) => r.of))) {
    const rep = choose(code, main, p.reps.filter((r) => r.of === of)).rep;
    if (rep.type === rep.of) continue;
    const problem = jobProblem(p.info, rep, p.names);
    if (problem) fail(`${p.title} can't be stored as ${rep.name}: ${problem}`);
    code = represent(code, defs, rep);
    chosen.push(`${p.names[of] ?? of} as ${rep.name}`);
  }
  if (!chosen.length) return p;
  code = { ...code, defs: code.defs.filter((d) => !reps.has(d)) };
  // The library's representations may call the constructors they stand for.
  const options = p.options as Parameters<typeof infer>[3];
  const info = infer(code, names, undefined, { ...options, insiders: [...(options?.insiders ?? []), ...lib.insiders] });
  if (info.errors.length) fail(`${p.title} doesn't check on ${chosen.join(", ")}: ${info.errors.map((e) => e.message).join("; ")}`);
  return { ...p, code, names, info };
}

// `lab run` takes a page too: it prints, once, as static HTML.
let staticPage = false;
function entry(p: Program, name: string, web = false): Id {
  const errors = p.info.errors;
  if (errors.length) fail(`${p.title} has ${errors.length} error${errors.length === 1 ? "" : "s"}:\n${errors.map((e) => `  ${p.names[e.id] ?? e.id}: ${e.message}`).join("\n")}`);
  const def = p.own.find((d) => p.names[d] === name);
  if (!def) fail(`${p.title} has no definition named ${name}`);
  if (!web && !pageProblem(p.info, def, p.names)) { staticPage = true; return def; }
  const problem = web ? pageProblem(p.info, def, p.names) : mainProblem(p.info, def, p.names);
  if (problem) fail(`${name} can't be ${web ? "a page" : "run from the command line"}: ${problem}`);
  return def;
}

// The compiled program, and a few lines that run it the way `lab run` does.
// Recursion that isn't a tail call goes on the heap past 1,000 levels
// (BACKLOG.md C21), so main runs on Node's own stack, with no thread of its
// own to start (C26).
// `files`: import the runtime by absolute file URL, for an unbundled module;
// otherwise by absolute path, which is what the bundler resolves.
function compiled(p: Program, main: Id, files: boolean): string {
  const here = import.meta.dirname;
  const url = (path: string) => JSON.stringify(files ? pathToFileURL(join(here, path)).href : join(here, path));
  const name = p.names[main];
  const takesArgs = (p.info.typeOf.get(main) as { params: unknown[] }).params.length === 1;
  const program = compile(p.code, p.info, p.names, { runtime: JSON.parse(url("../../compiler/src/runtime.js")), exports: [name], steps: false });
  return `#!/usr/bin/env node
// ${p.title}, compiled by lab (ters/cli/lab.ts). Run: node <this file> [arguments…]
${program}
import { $setWorld as $$setWorld, $setPrint as $$setPrint, $toList as $$toList, $Aborted as $$Aborted } from ${url("../../compiler/src/runtime.js")};
import { nodeWorld as $$nodeWorld } from ${url("../src/lang/world.ts")};
import { writeSync as $$writeSync } from "node:fs";
{
  // Standard output goes to the descriptor in large pieces, not a write
  // per print (GAPS.md G8), flushed before anything goes to standard error
  // and before the program reads, so a prompt shows before its answer is
  // read, and the two streams keep their order.
  // A reader that went away (\`| head\`) closes the pipe: the rest is dropped.
  const closed = new Set();
  const write = (fd, text) => {
    for (let b = Buffer.from(text); b.length && !closed.has(fd);) {
      try { b = b.subarray($$writeSync(fd, b)); } catch (e) { if (e.code === "EPIPE") closed.add(fd); else if (e.code !== "EAGAIN") throw e; }
    }
  };
  let out = "";
  const flush = () => { if (out) { write(1, out); out = ""; } };
  const world = $$nodeWorld();
  const first = (f) => (...a) => (flush(), f(...a));
  const error = (line) => { flush(); write(2, line + "\\n"); };
  $$setWorld({ ...world, error, log: error, input: first(world.input), readLine: first(world.readLine) });
  $$setPrint((line) => { out += line + "\\n"; if (out.length > 65536) flush(); });
  try {
    const code = defs[${JSON.stringify(name)}](${takesArgs ? "$$toList(process.argv.slice(2))" : ""});
    process.exitCode = typeof code === "number" || typeof code === "bigint" ? Number(code) : 0;
  } catch (e) {
    flush();
    if (!(e instanceof $$Aborted)) throw e;
    error(e.reason);
    process.exitCode = 1;
  }
  flush();
}
`;
}

const argv = process.argv.slice(2);
let mainName = "main";
const defined = argv.indexOf("--as-defined");
if (defined >= 0) argv.splice(defined, 1);
const at = argv.indexOf("--main");
if (at >= 0) { mainName = argv[at + 1] ?? fail("--main needs a name"); argv.splice(at, 2); }
const [command, path, ...rest] = argv;
// An MCP server for an LLM to read, change and run programs (mcp/server.ts).
if (command === "mcp") { (await import("../mcp/server.ts")).serve(path); await new Promise(() => {}); }
if (!command || command === "help" || command === "--help" || !path) {
  process.stdout.write(USAGE + "\n");
  process.exit(command && command !== "help" && command !== "--help" ? 2 : 0);
}

const loaded = load(path);
const main = command === "run" || command === "compile" || command === "native" || command === "build-web" || command === "build-app" ? entry(loaded, mainName, command.startsWith("build-")) : "";
const p = main && defined < 0 ? represented(loaded, main) : loaded;
// The host's answers to the program's own effects (FOREIGN.md, L69a):
// hosts/js.js beside the program, if it has one.
const hostFile = existsSync(path) && statSync(path).isDirectory() ? join(path, "hosts", "js.js") : "";
const hosts: Hosts | undefined = hostFile && existsSync(hostFile) ? (await import(pathToFileURL(resolve(hostFile)).href)).default : undefined;
switch (command) {
  case "run": {
    if (staticPage) {
      // Every text, part and attribute called once, and the handlers left
      // out: server-side rendering without a server.
      const cells = new Cells(equal);
      const page = runMain(p.code, p.info, main, { print: (s) => console.error(s), names: p.names, cells, world: nodeWorld(), hosts });
      process.stdout.write(pageDocument(p.title, htmlText(page, evaluatorCall)));
      break;
    }
    process.exitCode = runProgram(p.code, p.info, main, rest, { print: (s) => console.log(s), names: p.names, world: nodeWorld(), hosts });
    break;
  }
  case "compile": {
    const o = rest.indexOf("-o");
    const out = o >= 0 ? rest[o + 1] ?? fail("-o needs a file") : `${basename(resolve(path)).replace(/\.json$/, "")}.mjs`;
    // One file with the runtime in it, so it runs anywhere Node does and
    // starts fast; without esbuild (a dev dependency), a module that
    // imports the runtime from this checkout.
    const esbuild = await import("esbuild").catch(() => null);
    if (esbuild) {
      await esbuild.build({
        stdin: { contents: compiled(p, main, false), resolveDir: import.meta.dirname, sourcefile: basename(out), loader: "js" },
        bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning",
        banner: { js: `// ${p.title}, compiled by lab (ters/cli/lab.ts), with its runtime. Run: node <this file> [arguments…]` },
      });
    } else {
      writeFileSync(out, compiled(p, main, true));
      process.stderr.write("lab: esbuild isn't installed (npm install in ters/), so the output imports the runtime from this checkout\n");
    }
    process.stderr.write(`lab: wrote ${out}; run it with: node ${out} [arguments…]\n`);
    break;
  }
  case "native": {
    // The program as one C file, then built by the system's C compiler
    // with the flags that keep the evaluator's numbers (compiler/src/c.ts).
    const o = rest.indexOf("-o");
    const out = o >= 0 ? rest[o + 1] ?? fail("-o needs a file") : basename(resolve(path)).replace(/\.json$/, "");
    const lowered = lowerScalar(p.code, p.info, p.names, p.own, { data: true });
    let c: string;
    try { c = emitC(lowered, { main }).c; } catch (e) { fail((e as Error).message); }
    writeFileSync(`${out}.c`, c);
    const cc = process.env.CC ?? "cc", flags = [...CFLAGS, "-pthread", "-o", out, `${out}.c`, "-lm"];
    try { execFileSync(cc, flags, { stdio: "inherit" }); } catch {
      fail(`wrote ${out}.c, but ${cc} didn't build it; build it with: cc ${flags.join(" ")}`);
    }
    process.stderr.write(`lab: wrote ${out} (and ${out}.c); run it with: ./${out} [arguments…]\n`);
    break;
  }
  case "build-web": {
    const o = rest.indexOf("-o");
    const out = o >= 0 ? rest[o + 1] ?? fail("-o needs a file") : `${basename(resolve(path)).replace(/\.json$/, "")}.html`;
    writeFileSync(out, await webPage(p.title, p.code, p.info, p.names, main));
    // A recording the page plays, from the program's folder (AUDIO.md).
    const copied = recordings(p.code).filter((f) => existsSync(join(path, f)) && statSync(path).isDirectory());
    for (const f of copied) copyFileSync(join(path, f), join(dirname(out), f));
    process.stderr.write(`lab: wrote ${out}${copied.length ? ` and ${copied.join(", ")} beside it` : ""}; open it in a browser${copied.length ? " (from a web server: a page opened as a file can't fetch its recordings)" : ""}\n`);
    break;
  }
  case "build-app": {
    const o = rest.indexOf("-o");
    const out = o >= 0 ? rest[o + 1] ?? fail("-o needs a folder") : basename(resolve(path)).replace(/\.json$/, "");
    for (const [file, x] of Object.entries(appFolder(p.title, await webPage(p.title, p.code, p.info, p.names, main)))) {
      mkdirSync(dirname(join(out, file)), { recursive: true });
      writeFileSync(join(out, file), x);
    }
    process.stderr.write(`lab: wrote ${out}/; put ${out}/www on an HTTPS host to install it, or see ${out}/README.md for Android and iOS\n`);
    break;
  }
  case "render": {
    const def = p.own.find((d) => p.names[d] === mainName) ?? fail(`${p.title} has no definition named ${mainName}`);
    const problem = audioProblem(p.info, def, p.names);
    if (problem) fail(`${mainName} can't be a sound: ${problem}`);
    const option = (flag: string) => { const at = rest.indexOf(flag); if (at < 0) return undefined; const v = rest[at + 1] ?? fail(`${flag} needs a value`); rest.splice(at, 2); return v; };
    const out = option("-o"), size = Number(option("--block") ?? BLOCK), compiled = rest.includes("--compiled");
    const input = rest.find((a) => !a.startsWith("--")) ?? fail("render needs a WAV file to play the sound over");
    if (!Number.isInteger(size) || size < 2 || size % 2) fail("--block takes an even number of samples, 2 or more");
    let wav;
    try { wav = readWav(readFileSync(input)); } catch (e) { fail(`${input}: ${(e as Error).message}`); }
    const played = playBlocks(await soundOf(p, def, compiled ? "compiled" : "evaluator"), wav.samples, size);
    const to = out ?? input.replace(/(\.wav)?$/i, ".out.wav");
    writeFileSync(to, writeWav({ rate: wav.rate, samples: played.out }));
    if (played.silent.length) process.stderr.write(`lab: ${played.silent.length} block${played.silent.length === 1 ? "" : "s"} played silence, the first (block ${played.silent[0].block}) because ${played.silent[0].why}\n`);
    process.stderr.write(`lab: wrote ${to}, ${(wav.samples.length / wav.rate).toFixed(2)} s at ${wav.rate} Hz\n`);
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
  case "hosts": {
    process.stdout.write(hostSkeleton(p.code, p.names, p.own));
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
    const ran = p.info.errors.length ? [] : runTests(p.code, p.info, p.names, p.own.filter((d) => !old.has(d)), saved, { world: nodeWorld(), hosts });
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
    // The program's own representations: each job agrees with its type's through meaning (L108d).
    const laws = p.info.errors.length ? [] : representationLaws(p.code, p.info, p.names, p.reps);
    for (const l of laws) {
      if (!l.failures.length) console.log(`✓ ${l.rep}'s ${l.job} agrees through its meaning (${l.cases} case${l.cases === 1 ? "" : "s"})`);
      for (const f of l.failures.slice(0, 3)) console.log(`✗ ${l.rep}'s ${l.job}(${f.inputs.join(", ")}): ${f.what}`);
      if (l.failures.length > 3) console.log(`  … and ${l.failures.length - 3} more`);
    }
    if (!results.length && !laws.length && !p.info.errors.length) console.log("no tests: a test is a definition that performs Check (expect), or an accepted answer in examples.json");
    process.exitCode = p.info.errors.length || results.some((r) => r.error || r.failures.length) || laws.some((l) => l.failures.length) ? 1 : 0;
    break;
  }
  default:
    fail(`unknown command ${command}\n${USAGE}`);
}
