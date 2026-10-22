// The examples are written in the editor. Save the program there (Save
// file), then unpack it into a folder of side tables, the same files the
// editor's Files panel lists:
//
//   node examples/unpack.ts ~/Downloads/insertion-sort.json examples/sort
//
// code.json holds only the program's own nodes; names, comments, layout and
// example inputs are each their own file, so a diff shows which one changed.
// Nothing here generates code: the JSON is the program.

import { mkdirSync, readFileSync } from "node:fs";
import { prelude } from "../src/prelude.ts";
import { std } from "../src/lang/std.ts";
import { merge } from "../src/model.ts";
import { save } from "../src/io.ts";
import { fromFile } from "../editor/files.ts";

const [from, dir] = process.argv.slice(2);
if (!from || !dir) {
  console.error("usage: node examples/unpack.ts <saved program.json> <examples/folder>");
  process.exit(1);
}
const r = fromFile(readFileSync(from, "utf8"), () => merge(prelude, std));
if ("error" in r) {
  console.error(`can't open ${from}: ${r.error}`);
  process.exit(1);
}
const f = r.file;
const some = (x: object) => Object.keys(x).length > 0;
mkdirSync(dir, { recursive: true });
save(`${dir}/code.json`, f.code);
save(`${dir}/names.default.json`, f.names);
if (some(f.descriptive)) save(`${dir}/names.descriptive.json`, f.descriptive);
save(`${dir}/comments.json`, f.comments);
if (some(f.layout.positions) || some(f.layout.known)) save(`${dir}/layout.json`, f.layout);
if (some(f.examples)) save(`${dir}/examples.json`, f.examples);
console.log(`${f.title}: ${f.code.defs.length} definitions into ${dir}`);
