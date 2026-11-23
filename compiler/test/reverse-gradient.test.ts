// gradient over an array of Float64s, in one pass back (pullback.ts,
// L285, docs/design/numbers/REVERSE-GRADIENT-2026-11-23.md): a sum of
// squares, a softmax's first item, a branch and a definition calling
// itself, each against its slopes worked out by hand, in the evaluator,
// the core IR's JavaScript (`ters run`), WebAssembly and C.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { Session } from "../../ters/mcp/session.ts";
import { skip } from "./c-harness.ts";

test("gradient of a function of an array: one pass back, in the evaluator and compiled (L285)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reverse-gradient-")), folder = join(dir, "p");
  mkdirSync(folder);
  writeFileSync(join(folder, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(folder, "names.default.json"), "{}");
  const s = new Session(folder);
  const fill = (name: string, params: string[], text: string) => { s.define(name, "function", params); s.replace(/□#(\w+)/.exec(s.view(name))![1], text); };
  const at = (a: string, i: string) => `first(item at(${a}, ${i}), else 0.0)`;
  fill("squares", ["p"], `sum(map(range(array length(p)), (i) => ${at("p", "i")} · ${at("p", "i")}))`);
  fill("soft", ["p"], `((e) => ${at("e", "0")} / sum(map(range(3), (i) => ${at("e", "i")})))(array of(map(range(array length(p)), (i) => exp(${at("p", "i")}))))`);
  fill("bent", ["p"], `if ${at("p", "0")} > 0.0 then ${at("p", "1")} · 3.0 else ${at("p", "0")} · ${at("p", "1")}`);
  fill("dots", ["p", "k", "acc"], `if k ≤ 0 then acc else dots(p, k − 1, acc + ${at("p", "k − 1")} · ${at("p", "k − 1")})`);
  fill("shown", ["g"], "show(g)");
  fill("main", [], [
    "shown(first(gradient(squares)(array of(list of(1.0, 2.0, 3.0))), else array of(list of())))",
    "shown(first(gradient(soft)(array of(list of(0.5, −1.0, 2.0))), else array of(list of())))",
    "shown(first(gradient(bent)(array of(list of(1.0, 2.0))), else array of(list of())))",
    "shown(first(gradient(bent)(array of(list of(−1.0, 2.0))), else array of(list of())))",
    "shown(first(gradient((q) => dots(q, 3, 0.0))(array of(list of(1.0, 2.0, 3.0))), else array of(list of())))",
  ].reduce((a, b) => `${a} ++ "\\n" ++ ${b}`).replace(/^/, "print(") + ")");
  assert.equal(s.errors(), "ok");
  // The evaluator's own gradient, where the function is known only once
  // it runs.
  assert.equal(s.eval("all(gradient(squares)(array of(list of(1.0, 2.0, 3.0))))"), "= [array [2, 4, 6]] : List (Array Float64)");
  s.save();
  // softmax's first item s0 at p: ∂s0/∂p0 = s0(1 − s0), ∂s0/∂pj = −s0·sj.
  const e = [0.5, -1, 2].map(Math.exp), total = e.reduce((a, b) => a + b), sm = e.map((x) => x / total);
  const want = [[2, 4, 6], [sm[0] * (1 - sm[0]), -sm[0] * sm[1], -sm[0] * sm[2]], [0, 3], [2, -1], [2, 4, 6]];
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
  const check = (how: string, out: string) => {
    const got = out.trim().split("\n").map((l) => [...l.matchAll(/-?[\d.]+(?:e-?\d+)?/g)].map((m) => +m[0]));
    assert.equal(got.length, want.length, `${how}: ${out}`);
    got.forEach((g, i) => { assert.equal(g.length, want[i].length, out); g.forEach((x, j) => assert.ok(Math.abs(x - want[i][j]) < 1e-6, `${how} line ${i}: ${out}`)); });
  };
  for (const how of [[], ["--evaluator"]]) {
    const r = spawnSync(process.execPath, [lab, "run", folder, ...how], { encoding: "utf8" });
    check(`ters run ${how.join(" ")} ${r.stderr}`, r.stdout);
  }
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["p"], stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  check("ters wasi", readFileSync(of, "utf8"));
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "n")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  check("ters native", spawnSync(join(dir, "n"), [], { encoding: "utf8" }).stdout);
});
