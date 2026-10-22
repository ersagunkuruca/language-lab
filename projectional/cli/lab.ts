#!/usr/bin/env node
// lab: the language on the command line.
//
//   lab run <program> [arguments…]       run `main` with the evaluator
//   lab compile <program> [-o out.mjs]   compile to a JavaScript module that runs `main`
//   lab check <program>                  type-check, and list the definitions with their types
//
// A program is a file saved by the editor (Save file), or a folder of side
// tables like projectional/examples/sort. `main` gets the arguments as a list
// of texts (or nothing, if it takes none) and returns the exit code; an
// Abort nothing handles prints its reason and exits with 1 (LANGUAGE.md,
// "The world"). `--main <name>` picks another entry point.
//
// A folder with a representations.json (NUMBERS.md) runs and compiles on
// the representation the chooser picks for each type `main` uses, e.g.
// Peano Nat stored as an Int. `--as-defined` runs the definitions instead.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { fromFile } from "../editor/files.ts";
import { infer, type Info } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { baseNames, checkOptions, loadProgram } from "../src/lang/load.ts";
import { mainProblem, runProgram } from "../src/lang/run.ts";
import { showType } from "../src/lang/types.ts";
import { choose, represent, type Representation } from "../src/lang/represent.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { compile } from "../../compiler/src/compile.ts";

const USAGE = `usage:
  lab run <program> [arguments…]        run main with the evaluator
  lab compile <program> [-o out.mjs]    compile to a JavaScript module that runs main
  lab check <program>                   type-check, and list the definitions and their types
options:
  --main <name>    the entry point (default: main)
  --as-defined     ignore representations.json and run the definitions as written
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
    const table = join(path, "representations.json");
    const reps = existsSync(table) ? JSON.parse(readFileSync(table, "utf8")) as Representation[] : [];
    return { title: basename(resolve(path)), code: p.code, own: p.own.defs, names: p.pres.names, info: infer(p.code, p.pres.names, undefined, p.options), reps, options: p.options };
  }
  // opened on top of the modules, as the editor does
  const r = fromFile(readFileSync(path, "utf8"), () => LIBRARY.code);
  if ("error" in r) fail(`can't open ${path}: ${r.error}`);
  const names = baseNames(r.file.names);
  return { title: r.file.title, code: r.code, own: r.file.code.defs, names, info: infer(r.code, names, undefined, checkOptions), reps: [] };
}

// The program from `main`, with each type it uses stored the way the
// chooser picks from the declared costs (the definition itself is one of
// the choices). The rewrite is checked again, like any program.
function represented(p: Program, main: Id): Program {
  let code = p.code;
  const chosen: string[] = [];
  // Every definition the program has, so the ones main shares with others
  // change together; types stay as they are.
  const defs = p.own.filter((d) => { const b = (p.code.nodes[d] as { body?: Id | null }).body; return !b || p.code.nodes[b]?.kind !== "typedef"; });
  for (const of of new Set(p.reps.map((r) => r.of))) {
    const rep = choose(code, main, p.reps.filter((r) => r.of === of)).rep;
    if (rep.type === rep.of) continue;
    code = represent(code, defs, rep);
    chosen.push(`${p.names[of] ?? of} as ${rep.name}`);
  }
  if (!chosen.length) return p;
  const info = infer(code, p.names, undefined, p.options as Parameters<typeof infer>[3]);
  if (info.errors.length) fail(`${p.title} doesn't check on ${chosen.join(", ")}: ${info.errors.map((e) => e.message).join("; ")}`);
  return { ...p, code, info };
}

function entry(p: Program, name: string): Id {
  const errors = p.info.errors;
  if (errors.length) fail(`${p.title} has ${errors.length} error${errors.length === 1 ? "" : "s"}:\n${errors.map((e) => `  ${p.names[e.id] ?? e.id}: ${e.message}`).join("\n")}`);
  const def = p.own.find((d) => p.names[d] === name);
  if (!def) fail(`${p.title} has no definition named ${name}`);
  const problem = mainProblem(p.info, def, p.names);
  if (problem) fail(`${name} can't be run from the command line: ${problem}`);
  return def;
}

// The compiled program, and a few lines that run it the way `lab run` does.
// The thread main runs on gets this much stack, in megabytes.
const STACK_MB = 1024;
// `files`: import the runtime by absolute file URL, for an unbundled module;
// otherwise by absolute path, which is what the bundler resolves.
function compiled(p: Program, main: Id, files: boolean): string {
  const here = import.meta.dirname;
  const url = (path: string) => JSON.stringify(files ? pathToFileURL(join(here, path)).href : join(here, path));
  const name = p.names[main];
  const takesArgs = (p.info.typeOf.get(main) as { params: unknown[] }).params.length === 1;
  const program = compile(p.code, p.info, p.names, { runtime: JSON.parse(url("../../compiler/src/runtime.js")), exports: [name] });
  return `#!/usr/bin/env node
// ${p.title}, compiled by lab (projectional/cli/lab.ts). Run: node <this file> [arguments…]
${program}
import { $setWorld as $$setWorld, $setPrint as $$setPrint, $toList as $$toList, $Aborted as $$Aborted } from ${url("../../compiler/src/runtime.js")};
import { nodeWorld as $$nodeWorld } from ${url("../src/lang/world.ts")};
import { Worker as $$Worker, isMainThread as $$isMain, parentPort as $$parent } from "node:worker_threads";
import { writeSync as $$writeSync } from "node:fs";
// Recursion that isn't a tail call uses the JS stack, so main runs on a
// thread with a big one (compiler/GAPS.md, G1); the evaluator has no limit.
if ($$isMain) {
  const worker = new $$Worker(new URL(import.meta.url), { argv: process.argv.slice(2), resourceLimits: { stackSizeMb: ${STACK_MB} } });
  worker.on("message", (code) => { process.exitCode = code; });
} else {
  // A worker's process.stdout and stderr are relayed to the main thread
  // separately, which loses their order, so it writes to the descriptors
  // itself. Standard output goes in large pieces, not a write per print
  // (GAPS.md G8), flushed before anything goes to standard error and before
  // the program reads, so a prompt shows before its answer is read.
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
  $$parent.postMessage(process.exitCode);
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
if (!command || command === "help" || command === "--help" || !path) {
  process.stdout.write(USAGE + "\n");
  process.exit(command && command !== "help" && command !== "--help" ? 2 : 0);
}

const loaded = load(path);
const main = command === "run" || command === "compile" ? entry(loaded, mainName) : "";
const p = main && defined < 0 ? represented(loaded, main) : loaded;
switch (command) {
  case "run": {
    process.exitCode = runProgram(p.code, p.info, main, rest, { print: (s) => console.log(s), names: p.names, world: nodeWorld() });
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
        banner: { js: `// ${p.title}, compiled by lab (projectional/cli/lab.ts), with its runtime. Run: node <this file> [arguments…]` },
      });
    } else {
      writeFileSync(out, compiled(p, main, true));
      process.stderr.write("lab: esbuild isn't installed (npm install in projectional/), so the output imports the runtime from this checkout\n");
    }
    process.stderr.write(`lab: wrote ${out}; run it with: node ${out} [arguments…]\n`);
    break;
  }
  case "check": {
    for (const e of p.info.errors) console.log(`error  ${p.names[e.id] ?? e.id}: ${e.message}`);
    for (const d of p.own) {
      const t = p.info.typeOf.get(d);
      console.log(`${p.names[d] ?? d} : ${t ? showType(t, p.names) : "(a type)"}`);
    }
    process.exitCode = p.info.errors.length ? 1 : 0;
    break;
  }
  default:
    fail(`unknown command ${command}\n${USAGE}`);
}
