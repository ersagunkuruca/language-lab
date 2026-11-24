// What a fresh editor page would make of the library in its first seconds
// (I213), made here once and shipped beside the page as checks.json: the
// library's checks (its skeleton and whole) and its hashes and resolving
// (kept.ts), under the names the page's keepers give them
// (checkStore.ts). A visit after the first read them from IndexedDB; the
// first made them, its arithmetic resolving one task of 2 s.
//
// Run by build.ts in a process of its own, so nothing the build checked
// earlier is already in memory: `node editor/keptChecks.ts <CHECKS_KEY> <out>`.

process.env.LAB_NO_LIBRARY_STORE = "1";
const [build, out] = process.argv.slice(2);
const { writeFileSync, readFileSync } = await import("node:fs");
const { keepInMemory } = await import("./checkStore.ts");
const entries = keepInMemory(build);
const T = await import("./typed.ts");
const { merge } = await import("../ters/src/model.ts");
const { LIBRARY } = await import("../ters/src/lang/library.ts");
const { parseSaved } = await import("../ters/src/saved.ts");
const { seedArithmetic } = await import("../ters/src/lang/arith.ts");
const { sameAs } = await import("../ters/src/lang/modules.ts");

// A program with a main, as the editor opens one: on the library, checked
// with the editor's options, then the library's resolving its warm-up
// makes (seeds.ts warmCalls).
const dir = new URL("../ters/examples/markov/", import.meta.url);
const read = (f: string) => parseSaved<any>(readFileSync(new URL(f, dir), "utf8"));
const code = merge(LIBRARY.code, read("code.json"));
const names = { ...LIBRARY.names, ...read("names.default.json") };
T.setProgramPins({});
const info = T.infer(code, names);
seedArithmetic(code, info, names);
// The library's hashes, which the first edit's "same as" asks for.
sameAs(code, LIBRARY);
// Each value as its packed JSON, so the page parses the file once.
const kept = Object.entries(entries()).map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(",");
writeFileSync(out, `{"build":${JSON.stringify(build)},"kept":{${kept}}}`);

// Each shipped example's definition groups as the editor checks it on
// opening (E314): a script beside its folders' (exampleFiles.ts), read
// with them, so a first visit opens it with them as a later visit reads
// them from IndexedDB. `<out dir>/example-checks.json` names each file.
const { groupStore, hashOf, pack } = await import("./checkStore.ts");
const { readSaved } = await import("../ters/src/saved.ts");
const { exampleTables } = await import("./examplesPlugin.ts");
const { createHash } = await import("node:crypto");
const { mkdirSync, rmSync } = await import("node:fs");
const manifest = (await import("./examples.json", { with: { type: "json" } })).default as import("./examplesPlugin.ts").Manifest;
const site = out.slice(0, out.lastIndexOf("/") + 1), dirName = "example-checks/";
rmSync(site + dirName, { recursive: true, force: true });
mkdirSync(site + dirName, { recursive: true });
const used = new Map<string, unknown>();
const { load, save } = groupStore;
groupStore.load = (k) => { const c = load(k); if (c) used.set(k, c); return c; };
groupStore.save = (k, c) => { used.set(k, c); save(k, c); };
const files: Record<string, string> = {};
for (const m of manifest.programs.filter((p) => p.editor !== false && !p.built && p.folders?.length)) {
  const fs = (m.folders ?? []).map((f) => readSaved(exampleTables(manifest, f)) as { code?: unknown; names?: Record<string, string>; signatures?: Record<string, unknown> });
  const code = merge(LIBRARY.code, fs.map((f) => f.code as import("../ters/src/model.ts").Code).reduce((a, b) => merge(a, b)));
  const names = { ...LIBRARY.names, ...Object.assign({}, ...fs.map((f) => f.names ?? {})) };
  used.clear();
  try {
    T.setDisplayNames(names);
    T.setProgramPins(Object.assign({}, ...fs.map((f) => f.signatures ?? {})));
    T.infer(code, names);
  } catch (e) { console.log(`example checks: ${m.program} wasn't checked (${(e as Error).message})`); continue; }
  if (!used.size) continue;
  const text = `labExampleChecks(${JSON.stringify(build)},${JSON.stringify(m.program)},{${[...used].map(([k, v]) => `${JSON.stringify(`${build}|group|${hashOf(k)}`)}:${pack(v)}`).join(",")}});\n`;
  const name = `${dirName}${m.program.replace(/[^\w-]+/g, "-")}.${createHash("sha1").update(text).digest("hex").slice(0, 12)}.js`;
  writeFileSync(site + name, text);
  files[m.program] = name;
}
writeFileSync(site + "example-checks.json", JSON.stringify(files));
