// A WASI module built with TERS_WASM_NAMES carries each function's name
// (wasm.ts, the "name" section) so a profile of it names them (G3e); by
// default it carries none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ters = join(import.meta.dirname, "../../ters/cli/ters.ts"), ex = join(import.meta.dirname, "../../ters/examples/divisors");

test("a WASI module names its functions only when TERS_WASM_NAMES is set", () => {
  const dir = mkdtempSync(join(tmpdir(), "wasm-names-"));
  const built = (names: boolean) => {
    const out = join(dir, names ? "named.wasm" : "plain.wasm"), env = { ...process.env };
    if (names) env.TERS_WASM_NAMES = "1"; else delete env.TERS_WASM_NAMES;
    const r = spawnSync(process.execPath, [ters, "wasi", ex, "-o", out], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    return new WebAssembly.Module(readFileSync(out));
  };
  const named = WebAssembly.Module.customSections(built(true), "name");
  assert.equal(named.length, 1);
  assert.match(new TextDecoder().decode(named[0]), /main/);
  assert.equal(WebAssembly.Module.customSections(built(false), "name").length, 0);
});
