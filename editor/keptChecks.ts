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
const { seedArithmetic } = await import("../ters/src/lang/arith.ts");
const { sameAs } = await import("../ters/src/lang/modules.ts");

// A program with a main, as the editor opens one: on the library, checked
// with the editor's options, then the library's resolving its warm-up
// makes (seeds.ts warmCalls).
const dir = new URL("../ters/examples/markov/", import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
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
