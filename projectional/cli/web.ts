// A page as one HTML file (WEB.md): `lab build-web` and editor/build.ts.

import { join } from "node:path";
import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { pageShell } from "../src/lang/page.ts";
import { HTML_V } from "../src/lang/std.ts";
import { compile } from "../../compiler/src/compile.ts";

const here = import.meta.dirname;
const esbuild = () => import("esbuild").catch(() => { throw new Error("a page needs esbuild to bundle it (npm install in projectional/)"); });

// A page (WEB.md): the compiled program and what it runs on
// (src/lang/page-runtime.ts), bundled by esbuild into one script inside one
// HTML file, keeping only what the program uses. editor/build.ts builds the
// example apps with it too.
const at = (path: string) => JSON.stringify(join(here, path));
const compiled = (code: Code, info: Info, names: Names, main: Id) =>
  compile(code, info, names, { runtime: JSON.parse(at("../../compiler/src/runtime.js")), exports: [names[main]] });

// A page with sound (AUDIO.md, A2) also carries its program bundled for the
// audio thread (src/lang/audio-worklet.ts), which runs main again there.
const hasSound = (code: Code) => Object.values(code.nodes).some((n) => n.kind === "ref" && n.target === HTML_V.listen);
// The recordings a page plays from files beside it (`recording("strum.wav")`):
// `lab build-web` copies them from the program's folder next to the page.
export function recordings(code: Code): string[] {
  const out = new Set<string>();
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "call") continue;
    const f = code.nodes[n.fn], a = code.nodes[n.args[0]];
    if (f?.kind === "ref" && f.target === HTML_V.recording && a?.kind === "lit" && typeof a.value === "string" && !/^[a-z]+:|^\/|\.\./i.test(a.value)) out.add(a.value);
  }
  return [...out];
}

export async function soundWorklet(code: Code, info: Info, names: Names, main: Id): Promise<string> {
  const { build } = await esbuild();
  const out = await build({
    stdin: {
      contents: `${compiled(code, info, names, main)}
import { startSound as $$startSound } from ${at("../src/lang/audio-worklet.ts")};
$$startSound(defs[${JSON.stringify(names[main])}]);
`,
      resolveDir: here, sourcefile: "worklet.js", loader: "js",
    },
    bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true, write: false, logLevel: "warning",
  });
  return out.outputFiles[0].text;
}

export async function webPage(title: string, code: Code, info: Info, names: Names, main: Id): Promise<string> {
  const name = names[main];
  const program = compiled(code, info, names, main);
  const worklet = hasSound(code) ? `, ${JSON.stringify(await soundWorklet(code, info, names, main))}` : "";
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
