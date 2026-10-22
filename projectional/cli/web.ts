// A page as one HTML file (WEB.md): `lab build-web` and editor/build.ts.

import { join } from "node:path";
import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { compile } from "../../compiler/src/compile.ts";

// A page (WEB.md): the compiled program, its runtime, the mount and the
// browser's world, bundled by esbuild into one script inside one HTML file.
// editor/build.ts builds the example apps with it too.
export async function webPage(title: string, code: Code, info: Info, names: Names, main: Id): Promise<string> {
  const here = import.meta.dirname;
  const at = (path: string) => JSON.stringify(join(here, path));
  const name = names[main];
  const program = compile(code, info, names, { runtime: JSON.parse(at("../../compiler/src/runtime.js")), exports: [name] });
  const { build } = await import("esbuild").catch(() => { throw new Error("a page needs esbuild to bundle it (npm install in projectional/)"); });
  const out = await build({
    stdin: {
      contents: `${program}
import { $setWorld as $$setWorld, $setPrint as $$setPrint, $cells as $$cells } from ${at("../../compiler/src/runtime.js")};
import { mountHtml as $$mount, compiledCall as $$call } from ${at("../src/lang/html.ts")};
import { browserWorld as $$browserWorld } from ${at("../src/lang/browser.ts")};
const $$store = (() => { try { return localStorage; } catch { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null }; } })();
$$setWorld($$browserWorld($$store, ${JSON.stringify(title)}));
$$setPrint((line) => console.log(line));
document.body.append($$mount(defs[${JSON.stringify(name)}](), { cells: $$cells(), doc: document, call: $$call }));
`,
      resolveDir: here, sourcefile: "page.js", loader: "js",
    },
    bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true, write: false, logLevel: "warning",
  });
  const js = out.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<!-- ${esc(title)}, built by lab build-web (projectional/cli/lab.ts) from a program in the language. -->
</head>
<body>
<script>${js}</script>
</body>
</html>
`;
}

