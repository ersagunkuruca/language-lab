// The example programs' files, for the editor's bundle (BACKLOG E205).
// main.ts imports "examples:files", a function that gives, for a folder
// editor/examples.json names, its side tables as the editor reads them:
// { code, names, descriptive, comments, examples, layout, hints, data }, each
// there if the folder has it. Every build of main.ts adds this plugin
// (editor/build.ts, ters/test/editor-page.ts, ters/test/draws.test.ts).
//
// "inline" puts them in the script. "page" (the site, E204) reads each
// from a JSON script element of the page, `lab-example-<folder>`, the
// first time it is asked: the browser keeps such an element as text and
// nothing parses it until then, where the script's own objects were all
// parsed before the first drawing. build.ts writes the elements
// (exampleTags).

import { existsSync, readFileSync } from "node:fs";
import type { Plugin } from "../ters/node_modules/esbuild/lib/main.js";

const editor = new URL(".", import.meta.url).pathname;
const examples = editor + "../ters/examples/";
// A folder is under ters/examples/, or, with a slash, from the repository's
// root (compiler/gaps/board: the bigger programs kept with the compiler).
const dirOf = (f: string) => (f.includes("/") ? `${editor}../${f}/` : `${examples}${f}/`);
// Its page element's id has no slash.
const idOf = (f: string) => f.replace(/\//g, "-");

export type Manifest = { programs: { program: string; label: string; folders?: string[]; start?: string; page?: boolean; built?: boolean; editor?: boolean; run?: { args: string[]; files?: string[] } }[] };

// Which file holds which table. A folder has names.default.json, or
// names.short.json beside names.descriptive.json (quadratic).
const TABLES: [string, string][] = [["code", "code"], ["names", "names.default"], ["names", "names.short"], ["descriptive", "names.descriptive"], ["comments", "comments"], ["examples", "examples"], ["layout", "layout"], ["hints", "hints"], ["signatures", "signatures"]];

const foldersOf = (manifest: Manifest) => [...new Set(manifest.programs.filter((p) => p.editor !== false).flatMap((p) => p.folders ?? []))];
// The files a program's main reads when Run gives it its arguments (E212):
// `data`, name to text, in its first folder's tables.
const dataOf = (manifest: Manifest, f: string): Record<string, string> | undefined => {
  const names = manifest.programs.filter((p) => p.folders?.[0] === f).flatMap((p) => p.run?.files ?? []);
  return names.length ? Object.fromEntries(names.map((n) => [n, readFileSync(dirOf(f) + n, "utf8")])) : undefined;
};

export const examplesPlugin = (manifest: Manifest, mode: "inline" | "page" = "inline"): Plugin => ({
  name: "examples",
  setup(b) {
    b.onResolve({ filter: /^examples:files$/ }, (a) => ({ path: a.path, namespace: "examples" }));
    b.onLoad({ filter: /.*/, namespace: "examples" }, () => {
      if (mode === "page") return { contents: `const read = {};\nexport default (f) => read[f] ??= JSON.parse(document.getElementById("lab-example-" + f.replace(/\\//g, "-")).textContent);\n`, loader: "js" };
      const imports: string[] = [], entries: string[] = [];
      for (const f of foldersOf(manifest)) {
        const own: string[] = [];
        for (const [table, file] of TABLES) {
          const path = `${dirOf(f)}${file}.json`;
          if (!existsSync(path)) continue;
          const v = `f${imports.length}`;
          imports.push(`import ${v} from ${JSON.stringify(path)} with { type: "json" };`);
          own.push(`${table}: ${v}`);
        }
        const data = dataOf(manifest, f);
        if (data) own.push(`data: ${JSON.stringify(data)}`);
        entries.push(`${JSON.stringify(f)}: { ${own.join(", ")} }`);
      }
      return { contents: `${imports.join("\n")}\nconst files = { ${entries.join(", ")} };\nexport default (f) => files[f];\n`, loader: "js", resolveDir: editor };
    });
  },
});

// The page's JSON elements, one a folder, for "page". A `<` is only ever
// in a JSON string, where \u003c means the same, so none can end the
// element early.
export function exampleTags(manifest: Manifest): string {
  return foldersOf(manifest).map((f) => {
    const tables = exampleTables(manifest, f);
    return `<script type="application/json" id="lab-example-${idOf(f)}">${JSON.stringify(tables).replace(/</g, "\\u003c")}</script>\n`;
  }).join("");
}

// A folder's tables as the editor reads them ("examples:files").
export function exampleTables(manifest: Manifest, f: string): Record<string, unknown> {
  const tables: Record<string, unknown> = {};
  for (const [table, file] of TABLES) {
    const path = `${dirOf(f)}${file}.json`;
    if (existsSync(path)) tables[table] = JSON.parse(readFileSync(path, "utf8"));
  }
  const data = dataOf(manifest, f);
  if (data) tables.data = data;
  return tables;
}
