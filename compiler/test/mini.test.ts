// mini (compiler/gaps/mini), GAPS.md round 21's program: a little
// functional language read, typed by algorithm W and run, over a corpus
// and generated programs. The evaluator, the core IR's module and the
// hand-written ideal must print the same and exit the same way, and so
// must `ters wasi` and `ters native`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { folder, ways } from "../gaps/mini.ts";
import { skip } from "./c-harness.ts";
import { wasiImports } from "../src/wasi-imports.ts";

const w = await ways();
const ideal = (n: number) => w.ideal([String(n)], {});

test("mini: the corpus and 20 programs, by the evaluator, the core IR and the ideal", () => {
  const want = ideal(20);
  for (const way of ["evaluator", "core"] as const) assert.deepEqual(w[way](["20"], {}), want, way);
  // Let-polymorphism, an infinite type, a clash, an unbound name, a parse error.
  assert.ok(want.out.includes("id: int = 1"));
  assert.ok(want.out.includes("compose: (a -> b) -> (c -> a) -> c -> b = <fun>"));
  assert.ok(want.out.includes("self: type error: infinite type"));
  assert.ok(want.out.includes("test: type error: cannot unify int with bool"));
  assert.ok(want.out.includes("unbound: type error: unbound foo"));
  assert.ok(want.out.includes("bracket: parse error: expected ) before in"));
});

test("mini: 300 programs from the core IR and the ideal, some ill typed", () => {
  const r = w.core(["300"], {});
  assert.deepEqual(r, ideal(300));
  const m = /^generated: 300 programs, (\d+) well typed, (\d+) ill typed/.exec(r.out[r.out.length - 1])!;
  assert.ok(m && Number(m[1]) > 0 && Number(m[2]) > 0, r.out[r.out.length - 1]);
});

test("mini: arguments that aren't whole numbers are 200 programs", () => {
  assert.deepEqual(w.core(["x"], {}), ideal(200));
});

test("mini through ters wasi and ters native prints what the ideal prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "mini-"));
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "m.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["m", "300"], stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "m.wasm"))), wasiImports(wasi)));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), ideal(300).out.join("\n") + "\n", "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "m")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "m"), ["300"], { encoding: "utf8" }).stdout, ideal(300).out.join("\n") + "\n", "ters native");
});
