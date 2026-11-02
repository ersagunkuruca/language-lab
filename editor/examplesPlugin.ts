// The example programs' files, for the editor's bundle (BACKLOG E205).
// main.ts imports "examples:files" and gets, for each folder that
// editor/examples.json names, its side tables as the editor reads them:
// { code, names, descriptive, comments, examples, layout, hints }, each
// there if the folder has it. Every build of main.ts adds this plugin
// (editor/build.ts, ters/test/editor-page.ts, ters/test/draws.test.ts).

import { existsSync } from "node:fs";
import type { Plugin } from "../ters/node_modules/esbuild/lib/main.js";

const editor = new URL(".", import.meta.url).pathname;
const examples = editor + "../ters/examples/";

export type Manifest = { programs: { program: string; label: string; folders?: string[]; start?: string; page?: boolean; built?: boolean; editor?: boolean }[] };

// Which file holds which table. A folder has names.default.json, or
// names.short.json beside names.descriptive.json (quadratic).
const TABLES: [string, string][] = [["code", "code"], ["names", "names.default"], ["names", "names.short"], ["descriptive", "names.descriptive"], ["comments", "comments"], ["examples", "examples"], ["layout", "layout"], ["hints", "hints"]];

export const examplesPlugin = (manifest: Manifest): Plugin => ({
  name: "examples",
  setup(b) {
    b.onResolve({ filter: /^examples:files$/ }, (a) => ({ path: a.path, namespace: "examples" }));
    b.onLoad({ filter: /.*/, namespace: "examples" }, () => {
      const folders = [...new Set(manifest.programs.filter((p) => p.editor !== false).flatMap((p) => p.folders ?? []))];
      const imports: string[] = [], entries: string[] = [];
      for (const f of folders) {
        const own: string[] = [];
        for (const [table, file] of TABLES) {
          const path = `${examples}${f}/${file}.json`;
          if (!existsSync(path)) continue;
          const v = `f${imports.length}`;
          imports.push(`import ${v} from ${JSON.stringify(path)} with { type: "json" };`);
          own.push(`${table}: ${v}`);
        }
        entries.push(`${JSON.stringify(f)}: { ${own.join(", ")} }`);
      }
      return { contents: `${imports.join("\n")}\nexport default { ${entries.join(", ")} };\n`, loader: "js", resolveDir: editor };
    });
  },
});
