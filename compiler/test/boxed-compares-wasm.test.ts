// C267 on WebAssembly: a comparison of Ints that are i64s boxed (an
// untagged count, an array's length) is compared as i64s, and `0 < a − b`
// as `b < a` (wasm.ts boxedCompares). The greenhouse's walks ask
// `0 < length − i` each step; `ters wasi` prints what `ters compile` does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxedCompares } from "../src/wasm.ts";
import type { SExpr } from "../src/scalar.ts";
import { wasiImportsSource } from "../src/wasi-imports.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const folder = join(import.meta.dirname, "../gaps/greenhouse");
const rt = (fn: string, ...args: SExpr[]): SExpr => ({ k: "rt", fn, args });
const local = (i: number): SExpr => ({ k: "local", i }) as SExpr;
const int = (v: bigint): SExpr => ({ k: "int", v }) as SExpr;

test("0 < length − i over boxed i64s is i < length as i64s", () => {
  const e = rt("int.less", int(0n), rt("int.sub", rt("array.length.a0", local(0)), rt("i64.box", local(2))));
  assert.deepEqual(boxedCompares(e), rt("i64.less", local(2), rt("array.length.a0.i64", local(0))));
  assert.deepEqual(boxedCompares(rt("int.less", rt("i64.box", local(1)), int(7n))), rt("i64.less", local(1), rt("i64.lit", int(7n))));
});

test("an Int that may be big, or a difference read with effects, stays an Int", () => {
  const big = rt("int.less", rt("i64.box", local(1)), int(1n << 63n));
  assert.deepEqual(boxedCompares(big), big);
  const tagged = rt("int.less", local(1), rt("i64.box", local(2)));
  assert.deepEqual(boxedCompares(tagged), tagged);
  const called = rt("int.less", int(0n), rt("int.sub", rt("i64.box", rt("call.f", local(0))), rt("i64.box", local(2))));
  assert.equal((boxedCompares(called) as { fn: string }).fn, "int.less");
});

test("the greenhouse on WebAssembly with its walks' compares as i64s prints as compiled JavaScript", () => {
  const dir = mkdtempSync(join(tmpdir(), "boxed-compares-wasm-"));
  const args = ["40", "300"];
  const js = spawnSync(process.execPath, [lab, "compile", folder, "-o", join(dir, "g.mjs")], { encoding: "utf8" });
  assert.equal(js.status, 0, js.stderr);
  const want = spawnSync(process.execPath, [join(dir, "g.mjs"), ...args], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  const b = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "g.wasm")], { encoding: "utf8" });
  assert.equal(b.status, 0, b.stderr);
  writeFileSync(join(dir, "w.mjs"), `import { readFileSync } from "node:fs"; import { WASI } from "node:wasi"; ${wasiImportsSource}
const w = new WASI({ version: "preview1", args: ["g", ...process.argv.slice(3)], returnOnExit: true });
w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(process.argv[2])), wasiImports(w)));`);
  const r = spawnSync(process.execPath, ["--no-warnings", join(dir, "w.mjs"), join(dir, "g.wasm"), ...args], { encoding: "utf8" });
  assert.equal(r.stdout, want.stdout);
});
