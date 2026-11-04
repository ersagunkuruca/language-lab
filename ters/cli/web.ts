// A page as one HTML file (WEB.md): `lab build-web` and editor/build.ts.

import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Code, Id } from "../src/model.ts";
import { isCall } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { pageShell } from "../src/lang/page.ts";
import { HTML_V } from "../src/lang/std.ts";
import { compile } from "../../compiler/src/compile.ts";
import { corePageScript, coreSoundScript, hostOpsOf, lowerCore } from "../../compiler/src/core-js.ts";

const here = import.meta.dirname;
const esbuild = () => import("esbuild").catch(() => { throw new Error("a page needs esbuild to bundle it (npm install in ters/)"); });

// A page (WEB.md): the compiled program and what it runs on
// (src/lang/page-runtime.ts), bundled by esbuild into one script inside one
// HTML file, keeping only what the program uses. editor/build.ts builds the
// example apps with it too.
const at = (path: string) => JSON.stringify(join(here, path));
// A program's hosts/js.js (FOREIGN.md, L69a3), when it has one, is imported
// by the compiled program and bundled in with it.
const compiled = (code: Code, info: Info, names: Names, main: Id, hosts?: string) =>
  compile(code, info, names, { runtime: JSON.parse(at("../../compiler/src/runtime.js")), exports: [names[main]], ...(hosts ? { hosts } : {}) });

// A page with sound (AUDIO.md, A2) also carries its program bundled for the
// audio thread (src/lang/audio-worklet.ts), which runs main again there.
const hasSound = (code: Code) => Object.values(code.nodes).some((n) => n.kind === "ref" && n.target === HTML_V.listen);
// The recordings a page plays from files beside it (`recording("strum.wav")`):
// `lab build-web` copies them from the program's folder next to the page.
export function recordings(code: Code): string[] {
  const out = new Set<string>();
  for (const n of Object.values(code.nodes)) {
    if (!isCall(n)) continue;
    const f = code.nodes[n.fn], a = code.nodes[n.args[0]];
    if (f?.kind === "ref" && f.target === HTML_V.recording && a?.kind === "lit" && typeof a.value === "string" && !/^[a-z]+:|^\/|\.\./i.test(a.value)) out.add(a.value);
  }
  return [...out];
}

export async function soundWorklet(code: Code, info: Info, names: Names, main: Id, hosts?: string): Promise<string> {
  const { build } = await esbuild();
  const out = await build({
    stdin: {
      contents: `${compiled(code, info, names, main, hosts)}
import { startSound as $$startSound } from ${at("../src/lang/audio-worklet.ts")};
$$startSound(defs[${JSON.stringify(names[main])}]);
`,
      resolveDir: here, sourcefile: "worklet.js", loader: "js",
    },
    bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true, write: false, logLevel: "warning",
  });
  return out.outputFiles[0].text;
}

export async function webPage(title: string, code: Code, info: Info, names: Names, main: Id, hosts?: string): Promise<string> {
  const name = names[main];
  const program = compiled(code, info, names, main, hosts);
  const worklet = hasSound(code) ? `, ${JSON.stringify(await soundWorklet(code, info, names, main, hosts))}` : "";
  const { build } = await esbuild();
  const out = await build({
    stdin: {
      contents: `${program}
import { startPage as $$startPage } from ${at("../src/lang/page-runtime.ts")};
$$startPage(defs[${JSON.stringify(name)}], ${JSON.stringify(title)}${worklet});
`,
      resolveDir: here, sourcefile: "page.js", loader: "js",
    },
    bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true, write: false, logLevel: "warning",
  });
  return pageShell(title, out.outputFiles[0].text);
}

// The same page printed from the core IR (C137c9, `lab build-web --core`),
// which WebAssembly and C print too: core-page.ts draws it, and a page
// with sound plays (C137d4). `lab build-web` doesn't use it for a page
// whose sound solves (C137d7).
// `hosts`: the program's hosts/js.js, bundled in and asked (C137d5).
export async function webCorePage(title: string, code: Code, info: Info, names: Names, own: Id[], main: Id, hosts?: string): Promise<string> {
  if (hosts && hasSound(code)) throw new Error("a page with sound and hosts/js.js isn't made from the core IR yet");
  const lowered = lowerCore(code, info, names, own);
  const why = lowered.refused.get(main);
  if (why) throw new Error(`${names[main] ?? "main"} isn't compiled through the core IR: it ${why}`);
  const { build } = await esbuild();
  const worklet = hasSound(code) ? await coreSoundWorklet(lowered, names[main] ?? "main") : undefined;
  const script = corePageScript(lowered, names[main] ?? "main", JSON.parse(at("../../compiler/src/core-page.ts")), title, worklet, hosts ? { file: hosts, ops: hostOpsOf(code, names) } : undefined);
  const out = await build({
    stdin: { contents: script, resolveDir: here, sourcefile: "page.js", loader: "js" },
    bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true, write: false, logLevel: "warning",
    plugins: carriesProgram(script) ? [] : [withoutSolver],
  });
  return pageShell(title, out.outputFiles[0].text);
}

// A page with sound's audio thread script from the core IR (C137d4),
// bundled as soundWorklet bundles compile.ts's.
export async function coreSoundWorklet(lowered: ReturnType<typeof lowerCore>, name: string): Promise<string> {
  const { build } = await esbuild();
  const script = coreSoundScript(lowered, name, JSON.parse(at("../../compiler/src/core-sound.ts")));
  const out = await build({
    stdin: { contents: script, resolveDir: here, sourcefile: "worklet.js", loader: "js" },
    bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true, write: false, logLevel: "warning",
    plugins: carriesProgram(script) ? [] : [withoutSolver],
  });
  return out.outputFiles[0].text;
}

// A printed page that solves nothing and looks inside no function
// (C149): the evaluator's solver, checker and library aren't run, though
// run.ts, which the page's cells and mount share, imports them. They are
// left out, each export a function saying so, so the page is about 75 KB,
// not 3.3 MB (the prelude's and trees' JSON, through arith.ts).
// (The same test as core-js.ts's codeFor, which carries the nodes then.)
const carriesProgram = (script: string) => /R\.rt\("(solve|exists"|derive:)/.test(script);
const SOLVER = /[\\/]src[\\/]lang[\\/](arith|relate|solve|modes|directions|derive)\.ts$/;
const withoutSolver = {
  name: "without the solver",
  setup(b: { onLoad(o: { filter: RegExp }, f: (a: { path: string }) => { contents: string; loader: "js" }): void }) {
    b.onLoad({ filter: SOLVER }, (a) => {
      const text = readFileSync(a.path, "utf8");
      const names = [...text.matchAll(/^export (?:function\*?|const|let|class) (\w+)/gm), ...[...text.matchAll(/^export \{([^}]*)\}/gm)].flatMap((m) => m[1].split(",").map((x) => [, x.trim().split(/\s+as\s+/).pop()!] as const))].map((m) => m[1]);
      return { contents: names.map((n) => `export function ${n}() { throw new Error("this page was made without the solver"); }`).join("\n"), loader: "js" };
    });
  },
};

// All of page-runtime.ts as one script that sets `$lab`, for pages made
// without a bundler (page.ts pageFile): the editor's "Save page".
export async function pageRuntime(): Promise<string> {
  const { build } = await esbuild();
  const out = await build({
    entryPoints: [join(here, "../src/lang/page-runtime.ts")],
    bundle: true, platform: "browser", format: "iife", globalName: "$lab", target: "es2022", minify: true, write: false, logLevel: "warning",
  });
  return out.outputFiles[0].text;
}

// The same for pages printed from the core IR (C137d6): core-page.ts and
// the solver as one script that sets `$core` (page.ts corePageFile), and
// the audio thread's (page.ts coreWorkletFile).
export async function corePageRuntime(): Promise<string> { return prebuilt("../../compiler/src/core-page-runtime.ts", "$core"); }
export async function coreWorkletRuntime(): Promise<string> { return prebuilt("../../compiler/src/core-worklet-runtime.ts", "$core"); }
async function prebuilt(entry: string, globalName: string): Promise<string> {
  const { build } = await esbuild();
  const out = await build({
    entryPoints: [join(here, entry)],
    bundle: true, platform: "browser", format: "iife", globalName, target: "es2022", minify: true, write: false, logLevel: "warning",
  });
  return out.outputFiles[0].text;
}

// The audio thread's runtime, prebuilt the same way (src/lang/worklet-runtime.ts):
// what the editor puts before a page's compiled program to play its sound
// (page.ts workletFile).
export async function workletRuntime(): Promise<string> {
  const { build } = await esbuild();
  const out = await build({
    entryPoints: [join(here, "../src/lang/worklet-runtime.ts")],
    bundle: true, platform: "browser", format: "iife", globalName: "$lab", target: "es2022", minify: true, write: false, logLevel: "warning",
  });
  return out.outputFiles[0].text;
}
