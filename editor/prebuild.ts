// The site's build compiles each shipped page example and picture once
// (BACKLOG E245), as the editor would (pageCompile.ts, picture.ts
// buildPicture), and writes it to
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
import { buildPicture, pictureEntries } from "./picture.ts";
import { infer, setDisplayNames, setProgramPins } from "./typed.ts";
import { prebuiltKey } from "./prebuilt.ts";
import { exampleTables, type Manifest } from "./examplesPlugin.ts";
import { checkedForRun, coreMain } from "./coreMain.ts";

type Tables = { code?: Code; names?: Names };

export async function prebuild(manifest: Manifest, site: string, core: boolean): Promise<string[]> {
  const dir = site + "prebuilt/";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const keys: string[] = [];
  const write = (key: string, made: unknown) => { writeFileSync(`${dir}${key}.json`, JSON.stringify(made)); keys.push(key); };
  for (const m of manifest.programs.filter((p) => p.editor !== false && !p.built && p.folders?.length)) {
    const fs = (m.folders ?? []).map((f) => onTodaysIds(exampleTables(manifest, f) as Tables));
    const code = merge(LIBRARY.code, fs.map((f) => f.code as Code).reduce((a, b) => merge(a, b)));
    const short = Object.assign({}, ...fs.map((f) => f.names ?? {})) as Names;
    const names = { ...LIBRARY.names, ...short };
    // A picture (pagePanel.ts pictureSection): the drawing without the
    // evaluator's check, which the editor doesn't make.
    const entries = pictureEntries(code.defs.filter((d) => !LIBRARY.code.nodes[d]), names);
    if (entries) try {
      setDisplayNames(names);
      setProgramPins({});
      const info = infer(code, names);
      write(prebuiltKey("picture", code, entries, {}), await buildPicture(code, info, names, entries, false));
    } catch (e) { console.log(`prebuilt: ${m.program}'s picture didn't compile (${(e as Error).message})`); }
    const main = code.defs.find((d) => !LIBRARY.code.nodes[d] && names[d] === "main");
    // Run main (E245c, coreMain.ts): printed from the core IR as the run
    // would lower it, with the command line's words when the example is
    // run with some (runPanel.ts runGiven). Not one whose solves need the
    // program's nodes (they'd be most of the file), or a derivative's types.
    // A page's main is a view, which Run shows the evaluator's way.
    if (main && !m.page) try {
      setDisplayNames(names);
      setProgramPins({});
      const lib = checkedForRun(code, names, main), made = coreMain(lib.code, lib.info, lib.names, main, !!m.run);
      if (made && !made.printed.code && !made.printed.checked) write(prebuiltKey("main", code, { main }, {}), made);
    } catch (e) { console.log(`prebuilt: ${m.program}'s main didn't lower (${(e as Error).message})`); }
    if (!m.page) continue;
    // A page with sound stays interpreted in the editor (pagePanel.ts).
    if (!main || hasSound(code)) continue;
    try {
      write(prebuiltKey("page", code, { main }, {}), compilePageProgram(code, names, {}, main, core));
    } catch (e) { console.log(`prebuilt: ${m.program} didn't compile (${(e as Error).message})`); }
  }
  writeFileSync(dir + "index.json", JSON.stringify(keys));
  return keys;
}
