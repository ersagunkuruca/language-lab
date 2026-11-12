// A page as one HTML file (WEB.md): `ters build-web` and editor/build.ts.

import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Code, Id } from "../src/model.ts";
import { isCall } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { pageShell } from "../src/lang/page.ts";
import { HTML_V } from "../src/lang/std.ts";
import { corePageScript, coreSoundScript, hostOpsOf, lowerCore } from "../../compiler/src/core-js.ts";

const here = import.meta.dirname;
const esbuild = () => import("esbuild").catch(() => { throw new Error("a page needs esbuild to bundle it (npm install in ters/)"); });

const at = (path: string) => JSON.stringify(join(here, path));
// A page with sound (AUDIO.md, A2) also carries its program bundled for the
// audio thread (core-sound.ts), which runs main again there.
const hasSound = (code: Code) => Object.values(code.nodes).some((n) => n.kind === "ref" && n.target === HTML_V.listen);
// The recordings a page plays from files beside it (`recording("strum.wav")`):
// `ters build-web` copies them from the program's folder next to the page.
export function recordings(code: Code): string[] {
  const out = new Set<string>();
  for (const n of Object.values(code.nodes)) {
    if (!isCall(n)) continue;
    const f = code.nodes[n.fn], a = code.nodes[n.args[0]];
    if (f?.kind === "ref" && f.target === HTML_V.recording && a?.kind === "lit" && typeof a.value === "string" && !/^[a-z]+:|^\/|\.\./i.test(a.value)) out.add(a.value);
  }
  return [...out];
}

// A page (WEB.md) printed from the core IR (C137c9, `ters build-web`),
// which WebAssembly and C print too, bundled by esbuild into one script
// inside one HTML file: core-page.ts draws it, and a page with sound
// plays (C137d4).
// `hosts`: the program's hosts/js.js, bundled in and asked (C137d5).
export async function webCorePage(title: string, code: Code, info: Info, names: Names, main: Id, hosts?: string): Promise<string> {
  // Only what main reaches (C168).
  const lowered = lowerCore(code, info, names, [main]);
  const why = lowered.refused.get(main);
  if (why) throw new Error(`${names[main] ?? "main"} isn't compiled through the core IR: it ${why}`);
  const { build } = await esbuild();
  const asked = hosts ? { file: hosts, ops: hostOpsOf(code, names) } : undefined;
  const worklet = hasSound(code) ? await coreSoundWorklet(lowered, names[main] ?? "main", asked) : undefined;
  const script = corePageScript(lowered, names[main] ?? "main", JSON.parse(at("../../compiler/src/core-page.ts")), title, worklet, asked, true);
  const out = await build({
    stdin: { contents: script, resolveDir: here, sourcefile: "page.js", loader: "js" },
    bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true, write: false, logLevel: "warning",
    plugins: carriesProgram(script) ? [] : [withoutSolver],
  });
  return pageShell(title, out.outputFiles[0].text);
}

// A page with sound's audio thread script from the core IR (C137d4),
// bundled the same way; with the program's
// hosts/js.js, which main asks again there (C137d10).
export async function coreSoundWorklet(lowered: ReturnType<typeof lowerCore>, name: string, hosts?: { file: string; ops: ReturnType<typeof hostOpsOf> }): Promise<string> {
  const { build } = await esbuild();
  const script = coreSoundScript(lowered, name, JSON.parse(at("../../compiler/src/core-sound.ts")), hosts);
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

// Pages printed from the core IR made without a bundler (C137d6): core-page.ts and
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
