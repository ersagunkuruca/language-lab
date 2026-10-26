// Publishes the prelude (src/lang/prelude-source.ts) to library/prelude.json,
// the vectors module (src/lang/vectors-source.ts) to library/vectors.json
// and the html module (src/lang/html-source.ts) to library/html.json,
// checks it, then moves every example onto it: an example's own copy of a
// prelude definition hashes the same as the published one, so it's replaced
// by a reference to it (adopt). Running this again changes nothing.
//   node library/build.ts

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { merge } from "../src/model.ts";
import { prelude } from "../src/prelude.ts";
import { std } from "../src/lang/std.ts";
import { buildPrelude } from "../src/lang/prelude-source.ts";
import { buildVectors } from "../src/lang/vectors-source.ts";
import { buildHtml } from "../src/lang/html-source.ts";
import { buildTreesModule } from "../src/lang/trees-source.ts";
import { verify } from "../src/lang/modules.ts";

const here = import.meta.dirname;
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

const m = buildPrelude();
const wrong = verify(m, merge(prelude, std), true);
if (wrong) throw new Error(`prelude: ${wrong}`);
save(join(here, "prelude.json"), m);
console.log(`prelude: ${m.code.defs.length} definitions, ${m.exports.length} offered, ${Object.keys(m.code.nodes).length} nodes`);
const v = buildVectors();
const vwrong = verify(v, merge(prelude, std), true);
if (vwrong) throw new Error(`vectors: ${vwrong}`);
save(join(here, "vectors.json"), v);
console.log(`vectors: ${v.code.defs.length} definitions, ${v.exports.length} offered, ${Object.keys(v.code.nodes).length} nodes`);
const h = buildHtml();
const hwrong = verify(h, merge(prelude, std, m.code), true);
if (hwrong) throw new Error(`html: ${hwrong}`);
save(join(here, "html.json"), h);
console.log(`html: ${h.code.defs.length} definitions, ${h.exports.length} offered, ${Object.keys(h.code.nodes).length} nodes`);

const t = buildTreesModule(m);
const twrong = verify(t, merge(prelude, std, m.code), true);
if (twrong) throw new Error(`trees: ${twrong}`);
save(join(here, "trees.json"), t);
console.log(`trees: ${t.code.defs.length} definitions, ${t.representations!.length} representations, ${Object.keys(t.code.nodes).length} nodes`);

// Examples, with the library just written.
const { adoptLibrary } = await import("../src/lang/library.ts");
const examples = join(here, "../examples");
for (const dir of readdirSync(examples)) {
  const d = join(examples, dir);
  if (!existsSync(join(d, "code.json")) || !existsSync(join(d, "names.default.json"))) continue;
  const read = (f: string) => (existsSync(join(d, f)) ? JSON.parse(readFileSync(join(d, f), "utf8")) : {});
  const r = adoptLibrary(read("code.json"), read("names.default.json"), read("comments.json"));
  if (!r.adopted.length) continue;
  save(join(d, "code.json"), r.code);
  save(join(d, "names.default.json"), r.names);
  if (existsSync(join(d, "comments.json"))) save(join(d, "comments.json"), r.comments);
  console.log(`${dir}: now uses the prelude's ${r.adopted.length} definitions instead of its own copies`);
}
