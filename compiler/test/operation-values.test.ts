// C235 (GAPS round 19 S1): an operation with an effect given as a value,
// `for each(lines, print)`, compiles on every target as the lambda calling
// it, and prints what `ters run` prints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { call } from "../../ters/mcp/server.ts";
import { skip } from "./c-harness.ts";
import { wasiImports } from "../src/wasi-imports.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

// A program written through the MCP: main hands print to for each.
function program(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "op-values-")), "lines");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "main", kind: "function", params: ["arguments"] });
  ask("replace", { at: "main", find: "□", text: 'for each(append(["one", "two"], arguments), print)' });
  return dir;
}

test("print given to for each, through ters run, compile, wasi and native", async () => {
  const dir = program(), out = mkdtempSync(join(tmpdir(), "op-values-out-"));
  const want = spawnSync(process.execPath, [lab, "run", dir, "three"], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  assert.equal(want.stdout, "one\ntwo\nthree\n");
  const js = spawnSync(process.execPath, [lab, "compile", dir, "-o", join(out, "p.js")], { encoding: "utf8" });
  assert.equal(js.status, 0, js.stderr);
  assert.equal(spawnSync(process.execPath, [join(out, "p.js"), "three"], { encoding: "utf8" }).stdout, want.stdout, "ters compile");
  const made = spawnSync(process.execPath, [lab, "wasi", dir, "-o", join(out, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(out, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["p", "three"], stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(out, "p.wasm"))), wasiImports(wasi)));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want.stdout, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", dir, "-o", join(out, "p")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(out, "p"), ["three"], { encoding: "utf8" }).stdout, want.stdout, "ters native");
});
