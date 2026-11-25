// typeset (compiler/gaps/typeset), GAPS.md round 24's program: paragraphs
// broken into lines by Knuth and Plass's total fit, first fit beside it.
// The evaluator, the core IR's module and the hand-written ideal must
// print the same, every line's ratio included, and so must `ters compile`,
// `ters wasi` and `ters native`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { folder, ways } from "../gaps/typeset.ts";
import { skip } from "./c-harness.ts";
import { wasiImports } from "../src/wasi-imports.ts";

const w = await ways();

test("typeset: 3 paragraphs at 300 by the evaluator, the core IR and the ideal", () => {
  const want = w.ideal(["3", "300"]);
  for (const way of ["evaluator", "core"] as const) assert.deepEqual(w[way](["3", "300"]), want, way);
  const out = want.out.join("\n");
  // Total fit takes fewer lines than first fit, and breaks a word once.
  assert.match(out, /^paragraph 2: 48 words; first fit 6 lines, badness 2184; total fit 5 lines, demerits 3513, 1 hyphens$/m);
  assert.match(out, /^\S.*-\s+-?\d+\.\d\d$/m);
  assert.match(out, /^3 paragraphs at 300: first fit 19 lines; total fit 17 lines, demerits 8334, 2 hyphens$/m);
});

test("typeset: narrow and wide measures, 200 paragraphs from the core IR", () => {
  for (const a of [["20", "100"], ["10", "1200"], ["200", "300"]]) assert.deepEqual(w.core(a), w.ideal(a), a.join(" "));
});

test("typeset: no paragraphs, a measure out of range or an argument that isn't a whole number is refused", () => {
  for (const a of [["0"], ["3", "99"], ["2", "2001"], ["x"], ["03"]]) {
    const r = w.core(a);
    assert.deepEqual(r, w.ideal(a), a.join(" "));
    assert.deepEqual(r.out, []);
    assert.deepEqual(r.err, ["usage: typeset [paragraphs, at least 1] [measure, 100 to 2000]"]);
  }
});

test("typeset through ters compile, ters wasi and ters native prints what the ideal prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "typeset-"));
  const want = w.ideal(["40", "240"]).out.join("\n") + "\n";
  const js = spawnSync(process.execPath, [lab, "compile", folder, "-o", join(dir, "t.mjs")], { encoding: "utf8" });
  assert.equal(js.status, 0, js.stderr);
  assert.equal(spawnSync(process.execPath, [join(dir, "t.mjs"), "40", "240"], { encoding: "utf8" }).stdout, want, "ters compile");
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "t.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["t", "40", "240"], stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "t.wasm"))), wasiImports(wasi)));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "t")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "t"), ["40", "240"], { encoding: "utf8" }).stdout, want, "ters native");
});
