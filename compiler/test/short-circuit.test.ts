// `and` and `or` work out their second side only when the first doesn't
// decide (BACKLOG L259), on every engine: the evaluator, the core IR's
// JavaScript module, `ters wasi` and `ters native` print the same counts
// (scalar.ts lowers such a call as an if where its second side may fail,
// choose or act).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { Session } from "../../ters/mcp/session.ts";
import { skip } from "./c-harness.ts";

test("and, or: the second side only when the first doesn't decide, on every engine (L259)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "short-circuit-")), folder = join(dir, "p");
  mkdirSync(folder);
  writeFileSync(join(folder, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(folder, "names.default.json"), "{}");
  const s = new Session(folder);
  const fill = (name: string, params: string[], text: string) => { s.define(name, "function", params); s.replace(/□#(\w+)/.exec(s.view(name))![1], text); };
  fill("f", ["d"], "d > 0.0 and 1.0 / d > 1.0");
  fill("g", ["d"], "d = 0.0 or 1.0 / d > 1.0");
  fill("h", ["x"], "x > 2 and one of([1, 2, 3, 4]) > x");
  fill("main", [], 'print(show(count(f(0.0))) ++ " " ++ show(count(f(0.5))) ++ " " ++ show(count(g(0.0))) ++ " " ++ show(count(h(1))) ++ " " ++ show(count(h(3))))');
  assert.equal(s.errors(), "ok");
  s.save();
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), want = "1 1 1 1 4\n";
  for (const how of [[], ["--evaluator"]]) {
    const r = spawnSync(process.execPath, [lab, "run", folder, ...how], { encoding: "utf8" });
    assert.equal(r.stdout, want, `ters run ${how.join(" ")} ${r.stderr}`);
  }
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["p"], stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "n")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "n"), [], { encoding: "utf8" }).stdout, want, "ters native");
});
