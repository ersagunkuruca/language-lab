// A page as one HTML file (WEB.md): `lab build-web` and editor/build.ts.

import { join } from "node:path";
import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { pageShell } from "../src/lang/page.ts";
import { compile } from "../../compiler/src/compile.ts";

const here = import.meta.dirname;
const esbuild = () => import("esbuild").catch(() => { throw new Error("a page needs esbuild to bundle it (npm install in projectional/)"); });

// A page (WEB.md): the compiled program and what it runs on
// (src/lang/page-runtime.ts), bundled by esbuild into one script inside one
// HTML file, keeping only what the program uses. editor/build.ts builds the
// example apps with it too.
export async function webPage(title: string, code: Code, info: Info, names: Names, main: Id): Promise<string> {
  const at = (path: string) => JSON.stringify(join(here, path));
  const name = names[main];
  const program = compile(code, info, names, { runtime: JSON.parse(at("../../compiler/src/runtime.js")), exports: [name] });
  const { build } = await esbuild();
  const out = await build({
    stdin: {
      contents: `${program}
import { startPage as $$startPage } from ${at("../src/lang/page-runtime.ts")};
$$startPage(defs[${JSON.stringify(name)}], ${JSON.stringify(title)});
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
