// C345: on a WASI command a file's Bytes hold the bytes as they are (a
// $bytes beside the list), and `byte array of bytes` takes them a byte a
// slot without making the list; the list is made only when something
// reads it (`byte items`, `show`, `write bytes`). A program reading
// Bytes by `byte at` and `byte count` keeps them as a byte array
// (bytes-array.ts). Bytes of 40 and of 5 (under array.narrow's 16, so
// through the list) read back as the evaluator reads them, by position,
// as a list, and written again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";
import { wasiImportsSource } from "../src/wasi-imports.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("a file's bytes on WebAssembly are read in place, by position and as a list, as the evaluator reads them", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "bytes-wasm-")), "p");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "main", kind: "function", params: [] });
  ask("replace", { at: "main", find: "□", text: "a = read bytes(\"long.bin\"); □" });
  ask("replace", { at: "main", find: "□", text: "b = read bytes(\"short.bin\"); □" });
  ask("replace", { at: "main", find: "□", text: "print(show([byte count(a), byte at(a, 0, -1), byte at(a, 39, -1), byte at(a, 40, -1), byte count(b), byte at(b, 4, -1)])); □" });
  ask("replace", { at: "main", find: "□", text: "c = read bytes(\"long.bin\"); print(show(byte items(c))); write bytes(\"again.bin\", c)" });
  const run = mkdtempSync(join(tmpdir(), "bytes-wasm-run-"));
  const long = Uint8Array.from({ length: 40 }, (_, i) => (i * 37 + 200) % 256), short = Uint8Array.from([9, 255, 0, 128, 7]);
  writeFileSync(join(run, "long.bin"), long);
  writeFileSync(join(run, "short.bin"), short);
  const ev = spawnSync(process.execPath, [lab, "run", dir, "--evaluator"], { cwd: run, encoding: "utf8" });
  assert.equal(ev.status, 0, ev.stderr);
  assert.equal(ev.stdout, `[40, 200, ${long[39]}, -1, 5, 7]\n[${[...long].join(", ")}]\n`);
  const wasm = join(run, "p.wasm");
  const made = spawnSync(process.execPath, [lab, "wasi", dir, "-o", wasm], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
  assert.equal(made.status, 0, made.stderr);
  writeFileSync(join(run, "again.bin"), "");
  writeFileSync(join(run, "run.cjs"), `const { readFileSync } = require("node:fs"), { WASI } = require("node:wasi"); ${wasiImportsSource}
const w = new WASI({ version: "preview1", args: ["p"], preopens: { ".": ${JSON.stringify(run)} }, returnOnExit: true });
process.exitCode = w.start(new WebAssembly.Instance(new WebAssembly.Module(readFileSync(${JSON.stringify(wasm)})), wasiImports(w)));
`);
  const r = spawnSync(process.execPath, [join(run, "run.cjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, ev.stdout);
  assert.deepEqual([...readFileSync(join(run, "again.bin"))], [...long]);
  // The long file's array is its bytes: no list walked into an array.
  const names = spawnSync(process.execPath, [lab, "wasi", dir, "-o", join(run, "n.wasm")], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1", TERS_WASM_NAMES: "1" } });
  assert.equal(names.status, 0, names.stderr);
  assert.ok(readFileSync(join(run, "n.wasm")).includes("array.ofBytes.a"), "byte array of bytes takes the bytes as they are");
});
