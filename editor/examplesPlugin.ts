// The example programs' files, for the editor's bundle (BACKLOG E205).
// main.ts imports "examples:files", a function that gives, for a folder
// editor/examples.json names, its side tables as the editor reads them:
// { code, names, descriptive, comments, examples, layout, hints, data }, each
// there if the folder has it. Every build of main.ts adds this plugin
// (editor/build.ts, ters/test/editor-page.ts, ters/test/draws.test.ts).
//
// "inline" puts them in the script. "page" (the site) reads each from
// `self.labExamples`, which a folder's own file fills when it's read
// (E282, exampleFiles.ts): build.ts writes the files (exampleFiles).

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Plugin } from "../ters/node_modules/esbuild/lib/main.js";

const editor = new URL(".", import.meta.url).pathname;
const examples = editor + "../ters/examples/";
// A folder is under ters/examples/, or, with a slash, from the repository's
// root (compiler/gaps/board: the bigger programs kept with the compiler).
const dirOf = (f: string) => (f.includes("/") ? `${editor}../${f}/` : `${examples}${f}/`);
// Its page element's id has no slash.
const idOf = (f: string) => f.replace(/\//g, "-");

export type Manifest = { programs: { program: string; label: string; folders?: string[]; start?: string; page?: boolean; built?: boolean; editor?: boolean; run?: { args?: string[]; names?: string[]; files?: string[] } }[] };

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
      if (mode === "page") return { contents: `export default (f) => { const t = self.labExamples?.[f]; if (!t) throw new Error("the example " + f + " isn't read yet"); return t; };\n`, loader: "js" };
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

// The site's files, one a folder (E282): each a script that hands its
// tables to `labExample`, named by its content so a browser keeps it
// across deploys that don't change it. Gives folder to file.
export function exampleFiles(manifest: Manifest, write: (name: string, text: string) => void): Record<string, string> {
  return Object.fromEntries(foldersOf(manifest).map((f) => {
    const json = JSON.stringify(exampleTables(manifest, f));
    const name = `example-files/${idOf(f)}.${createHash("sha1").update(json).digest("hex").slice(0, 12)}.js`;
    write(name, `labExample(${JSON.stringify(f)}, JSON.parse(${JSON.stringify(json)}));\n`);
    return [f, name];
  }));
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
