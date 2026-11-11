// I193: the library's check kept on disk (library-store.ts) checks a
// program as the library's check made in this process does: the same
// problems, and every node of the program's own the same type.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram, checkOptions } from "../src/lang/load.ts";
import { infer, keepLibraryChecks, type Info } from "../src/lang/infer.ts";
import { checkerFiles, libraryStore } from "../src/lang/library-store.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { subtree } from "../src/model.ts";
import { showType } from "../src/lang/types.ts";

const EXAMPLES = ["wc", "physics", "calculus", "queens", "ledger"];

const said = (code: Parameters<typeof subtree>[0], info: Info) => {
  const own = code.defs.filter((d) => !LIBRARY.code.nodes[d]).flatMap((d) => subtree(code, d));
  return {
    errors: info.errors.map((e) => `${e.id} ${e.message}`),
    types: own.map((id) => { const t = info.typeOf.get(id); return `${id} ${t ? showType(info.subst.zonk(t), {}) : "-"}`; }),
  };
};

test("a program checks the same over the library's check kept on disk", () => {
  const progs = EXAMPLES.map((ex) => loadProgram(join(root, "examples", ex)));
  const check = () => progs.map((p) => said(p.code, infer(p.code, p.pres.names, undefined, checkOptions)));
  try {
    keepLibraryChecks(null);
    const here = check();
    // Written by this check, then read back by the next.
    keepLibraryChecks(libraryStore);
    check();
    keepLibraryChecks(libraryStore);
    assert.deepEqual(check(), here);
  } finally { keepLibraryChecks(process.env.LAB_NO_LIBRARY_STORE ? null : libraryStore); }
});

// I193f: each node's type inside the library's definitions is kept in a
// file of its own, read when one is first asked for: read back, the same.
test("a library node's type read back from the kept check is the one made here", () => {
  const p = loadProgram(join(root, "examples", "wc"));
  const inside = (info: Info) => {
    const lib = info.layer!;
    const map = LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "map")!;
    return [map, ...subtree(LIBRARY.code, map)].map((id) => { const t = lib.typeOf.get(id); return `${id} ${t ? showType(lib.subst.zonk(t), {}) : "-"}`; });
  };
  try {
    keepLibraryChecks(null);
    const here = inside(infer(p.code, p.pres.names, undefined, checkOptions));
    keepLibraryChecks(libraryStore);
    infer(p.code, p.pres.names, undefined, checkOptions);
    keepLibraryChecks(libraryStore);
    const read = inside(infer(p.code, p.pres.names, undefined, checkOptions));
    assert.ok(here.filter((l) => !l.endsWith(" -")).length > 5);
    assert.deepEqual(read, here);
  } finally { keepLibraryChecks(process.env.LAB_NO_LIBRARY_STORE ? null : libraryStore); }
});

// I193i: each group's check kept by a key another process writes the same
// way (texts, not this process's numbers): a cache made anew over the same
// store takes every group, and the check is the same.
test("a program's groups kept on disk are taken by a fresh cache, the same check", async () => {
  const { CheckCache } = await import("../src/lang/check-cache.ts");
  const kept = new Map<string, unknown>();
  const store = { load: (k: string) => kept.get(k) as never, save: (k: string, c: unknown) => { kept.set(k, structuredClone(c)); } };
  for (const ex of ["calc", "wc"]) {
    const p = loadProgram(join(root, "examples", ex));
    const first = new CheckCache(4000, store);
    const a = said(p.code, infer(p.code, p.pres.names, undefined, { ...checkOptions, cache: first }));
    const again = new CheckCache(4000, store);
    const b = said(p.code, infer(p.code, p.pres.names, undefined, { ...checkOptions, cache: again }));
    assert.ok(again.hits > 0 && again.misses === 0, `${ex}: ${again.hits} hits, ${again.misses} misses`);
    assert.deepEqual(b, a);
  }
});

// A kept check is found by the checker's own files (library-store.ts
// checkerFiles: the imports read with a regex, a few ms), so a change to
// any file the checker runs must change its name. Held to esbuild's import
// graph, which is the bundler's own reading (REVIEW-2026-11-11 §3, I209).
test("the files a kept check is named by are every file the checker imports", async () => {
  const { build } = await import("esbuild");
  const entry = join(root, "src", "lang", "library-store.ts");
  const r = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "node", format: "esm", logLevel: "silent", packages: "external" });
  const repo = join(root, "..");
  const imported = Object.keys(r.metafile!.inputs).map((f) => join(process.cwd(), f)).filter((f) => f.startsWith(repo) && /\.ts$/.test(f));
  const named = new Set(checkerFiles());
  assert.ok(imported.length > 20, `${imported.length} files`);
  assert.deepEqual(imported.filter((f) => !named.has(f)), []);
});
