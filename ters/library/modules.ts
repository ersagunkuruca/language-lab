// The library's modules built from their sources, each checked: what
// library/build.ts writes to library/<name>.json, and what
// test/library-built.test.ts compares with the files kept (I244).

import { merge, type Code } from "../src/model.ts";
import { prelude } from "../src/prelude.ts";
import { std } from "../src/lang/std.ts";
import { buildPrelude } from "../src/lang/prelude-source.ts";
import { buildVectors } from "../src/lang/vectors-source.ts";
import { buildHtml } from "../src/lang/html-source.ts";
import { buildTreesModule } from "../src/lang/trees-source.ts";
import { buildSteady } from "../src/lang/steady-source.ts";
import { buildCases } from "../src/lang/cases-source.ts";
import { buildNumbers } from "../src/lang/numbers-source.ts";
import { verify, type Module } from "../src/lang/modules.ts";

export interface Built { name: string; module: Module; line: string }

export function buildModules(): Built[] {
  const out: Built[] = [];
  const add = (name: string, module: Module, over: Code[], what = `${module.exports.length} offered`) => {
    const wrong = verify(module, merge(...over), true);
    if (wrong) throw new Error(`${name}: ${wrong}`);
    out.push({ name, module, line: `${name}: ${module.code.defs.length} definitions, ${what}, ${Object.keys(module.code.nodes).length} nodes` });
  };
  const m = buildPrelude();
  add("prelude", m, [prelude, std]);
  add("vectors", buildVectors(), [prelude, std]);
  add("html", buildHtml(), [prelude, std, m.code]);
  add("steady", buildSteady(), [prelude, std]);
  add("cases", buildCases(), [prelude, std]);
  add("numbers", buildNumbers(m), [prelude, std, m.code]);
  const t = buildTreesModule(m);
  add("trees", t, [prelude, std, m.code], `${t.representations!.length} representations`);
  return out;
}
