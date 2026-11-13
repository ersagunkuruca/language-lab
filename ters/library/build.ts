// Publishes the prelude (src/lang/prelude-source.ts) to library/prelude.json,
// the vectors module (src/lang/vectors-source.ts) to library/vectors.json
// and the html module (src/lang/html-source.ts) to library/html.json,
// checks it, then moves every example onto it: an example's own copy of a
// prelude definition hashes the same as the published one, so it's replaced
// by a reference to it (adopt). Running this again changes nothing.
//   node library/build.ts
//   node library/build.ts --check   writes nothing; fails if a module
//                                   built now differs from the one kept

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { merge } from "../src/model.ts";
import { prelude } from "../src/prelude.ts";
import { std } from "../src/lang/std.ts";
import { addVersions } from "../src/lang/modules.ts";
import { buildModules } from "./modules.ts";
import { printSaved } from "../src/saved.ts";

const here = import.meta.dirname;
// --check: build the modules, write nothing, and say which kept file a
// rebuild would change (I244): a source changed without a rebuild (#2548's
// first-arms.ts changed cases.json's ids). test/library-built.test.ts
// asks the same.
const check = process.argv.includes("--check");
const differs: string[] = [];
const save = (path: string, value: unknown) => {
  const text = printSaved(value);
  if (!check) writeFileSync(path, text);
  else if (!existsSync(path) || readFileSync(path, "utf8") !== text) differs.push(basename(path));
};

// The published definitions before this build, by name: an example that
// refers to one whose content changed is moved onto the new one below.
const before = (file: string): Record<string, string> => {
  if (!existsSync(join(here, file))) return {};
  const old = JSON.parse(readFileSync(join(here, file), "utf8")) as { code: { defs: string[] }; names: Record<string, string> };
  return Object.fromEntries(old.code.defs.map((d) => [old.names[d] ?? d, d]));
};
const oldIds = { ...before("prelude.json"), ...before("vectors.json"), ...before("html.json"), ...before("steady.json"), ...before("cases.json"), ...before("numbers.json") };

const built = buildModules();
const [m, v, h, st, cs, nu] = ["prelude", "vectors", "html", "steady", "cases", "numbers"].map((k) => built.find((b) => b.name === k)!.module);
for (const b of built) {
  save(join(here, `${b.name}.json`), b.module);
  console.log(b.line);
}
if (check) {
  if (differs.length) {
    console.error(`library: a rebuild changes ${differs.join(", ")}: run node library/build.ts and commit what it writes`);
    process.exit(1);
  }
  console.log("library: the kept modules are what the sources build");
  process.exit(0);
}

// Definitions whose content changed: old id to new, by name.
const newIds: Record<string, string> = {};
for (const mod of [m, v, h, st, cs, nu]) for (const d of mod.code.defs) newIds[mod.names[d] ?? d] = d;
const moved = Object.entries(oldIds).flatMap(([name, old]) => (newIds[name] && newIds[name] !== old ? [[old, newIds[name]] as const] : []));
// A saved program refers to library definitions by id, so one whose content
// changed keeps opening: its old id is read as the new one (moved.json, read
// by std.ts onTodaysIds; L184). Every move is kept, the older ones pointed
// on at today's id.
const movedPath = join(here, "moved.json");
const kept: Record<string, string> = existsSync(movedPath) ? JSON.parse(readFileSync(movedPath, "utf8")) : {};
for (const [a, b] of moved) kept[a] = b;
const today = (id: string) => { for (const seen = new Set<string>(); kept[id] && !seen.has(id);) { seen.add(id); id = kept[id]; } return id; };
save(movedPath, Object.fromEntries(Object.keys(kept).sort().map((a) => [a, today(a)] as const).filter(([a, b]) => a !== b)));

// Every version each std definition has had (SHARING.md §3, L109): a
// change to a declaration adds one and keeps the old.
const versionsPath = join(here, "std-versions.json");
const keptVersions = existsSync(versionsPath) ? JSON.parse(readFileSync(versionsPath, "utf8")) : {};
save(versionsPath, addVersions(keptVersions, merge(prelude, std), std.defs));

// Examples, with the library just written.
const { adoptLibrary } = await import("../src/lang/library.ts");
// The examples, and the bigger programs the compiler's gaps rounds wrote
// (compiler/gaps/board, machine), which are saved programs too.
const examples = join(here, "../examples"), gaps = join(here, "../../compiler/gaps");
const programs = [examples, gaps].flatMap((root) => (existsSync(root) ? readdirSync(root).map((dir) => [dir, join(root, dir)] as const) : []));
for (const [dir, d] of programs) {
  if (!existsSync(join(d, "code.json")) || !existsSync(join(d, "names.default.json"))) continue;
  // Refer to the library's current definitions.
  for (const f of ["code.json", "names.default.json", "comments.json"]) {
    if (!existsSync(join(d, f))) continue;
    const text = readFileSync(join(d, f), "utf8");
    const out = moved.reduce((t, [a, b]) => t.split(`"${a}"`).join(`"${b}"`), text);
    if (out !== text) { writeFileSync(join(d, f), out); console.log(`${dir}: ${f} now refers to the changed library definitions`); }
  }
  const read = (f: string) => (existsSync(join(d, f)) ? JSON.parse(readFileSync(join(d, f), "utf8")) : {});
  const r = adoptLibrary(read("code.json"), read("names.default.json"), read("comments.json"));
  if (!r.adopted.length) continue;
  save(join(d, "code.json"), r.code);
  save(join(d, "names.default.json"), r.names);
  if (existsSync(join(d, "comments.json"))) save(join(d, "comments.json"), r.comments);
  console.log(`${dir}: now uses the prelude's ${r.adopted.length} definitions instead of its own copies`);
}
