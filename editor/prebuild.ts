// The site's build compiles each shipped page example once (BACKLOG E245),
// as the editor's preview would (pageCompile.ts), and writes it to
// prebuilt/<key>.json at the site's root, with prebuilt/index.json listing
// the keys (prebuilt.ts reads them). The program is the example as the
// editor opens it: its folders' tables on today's ids, merged onto the
// library (main.ts initialFor).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { Code } from "../ters/src/model.ts";
import { merge } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { onTodaysIds } from "../ters/src/lang/std.ts";
import { hasSound } from "../ters/src/lang/page.ts";
import { compilePageProgram } from "./pageCompile.ts";
import { prebuiltKey } from "./prebuilt.ts";
import { exampleTables, type Manifest } from "./examplesPlugin.ts";

type Tables = { code?: Code; names?: Names };

export function prebuild(manifest: Manifest, site: string, core: boolean): string[] {
  const dir = site + "prebuilt/";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const keys: string[] = [];
  for (const m of manifest.programs.filter((p) => p.page && p.editor !== false && !p.built)) {
    const fs = (m.folders ?? []).map((f) => onTodaysIds(exampleTables(manifest, f) as Tables));
    const code = merge(LIBRARY.code, fs.map((f) => f.code as Code).reduce((a, b) => merge(a, b)));
    const short = Object.assign({}, ...fs.map((f) => f.names ?? {})) as Names;
    const names = { ...LIBRARY.names, ...short };
    const main = code.defs.find((d) => !LIBRARY.code.nodes[d] && names[d] === "main");
    // A page with sound stays interpreted in the editor (pagePanel.ts).
    if (!main || hasSound(code)) continue;
    const key = prebuiltKey("page", code, main, {});
    try {
      writeFileSync(`${dir}${key}.json`, JSON.stringify(compilePageProgram(code, names, {}, main, core)));
      keys.push(key);
    } catch (e) { console.log(`prebuilt: ${m.program} didn't compile (${(e as Error).message})`); }
  }
  writeFileSync(dir + "index.json", JSON.stringify(keys));
  return keys;
}
