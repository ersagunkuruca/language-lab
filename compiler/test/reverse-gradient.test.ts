// gradient over an array of Float64s, in one pass back (pullback.ts,
// L285, docs/design/numbers/REVERSE-GRADIENT-2026-11-23.md): a sum of
// squares, a softmax's first item, a branch and a definition calling
// itself, each against its slopes worked out by hand, and value and
// gradient over an array and over a Float64, in the evaluator,
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
import { wasiImports } from "../src/wasi-imports.ts";

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
  // Forward over reverse (a Hessian times a vector): the pass back at
  // dual numbers, its arithmetic theirs.
  const dat = (i: string) => `first(item at(p, ${i}), else dual(0.0, 0.0))`;
  fill("cubes", ["p"], `sum(map(range(array length(p)), (i) => ${dat("i")} · ${dat("i")} · ${dat("i")}))`);
  fill("hv", ["p"], "items of array(first(gradient(cubes)(p), else array of(list of())))");
  fill("shown", ["g"], "show(g)");
  fill("main", [], [
    "shown(first(gradient(squares)(array of(list of(1.0, 2.0, 3.0))), else array of(list of())))",
    "shown(first(gradient(soft)(array of(list of(0.5, −1.0, 2.0))), else array of(list of())))",
    "shown(first(gradient(bent)(array of(list of(1.0, 2.0))), else array of(list of())))",
    "shown(first(gradient(bent)(array of(list of(−1.0, 2.0))), else array of(list of())))",
    "shown(first(gradient((q) => dots(q, 3, 0.0))(array of(list of(1.0, 2.0, 3.0))), else array of(list of())))",
    "shown(first(value and gradient(soft)(array of(list of(0.5, −1.0, 2.0))), else (0.0, array of(list of()))))",
    "shown(first(value and gradient((x) => x · x · x)(2.0), else (0.0, 0.0)))",
    "shown(map(hv(array of(list of(dual(1.0, 1.0), dual(2.0, 0.0)))), (d) => d.value))",
    "shown(map(hv(array of(list of(dual(1.0, 1.0), dual(2.0, 0.0)))), (d) => d.slope))",
  ].reduce((a, b) => `${a} ++ "\\n" ++ ${b}`).replace(/^/, "print(") + ")");
  assert.equal(s.errors(), "ok");
  // The evaluator's own gradient, where the function is known only once
  // it runs.
  assert.equal(s.eval("all(gradient(squares)(array of(list of(1.0, 2.0, 3.0))))"), "= [array [2, 4, 6]] : List (Array Float64)");
  assert.equal(s.eval("all(value and gradient(squares)(array of(list of(1.0, 2.0, 3.0))))"), "= [(14, array [2, 4, 6])] : List (Float64, Array Float64)");
  // Over dual numbers only as made ahead: x³'s 3x² at x = 1 + ε is 3 + 6ε.
  assert.equal(s.eval("hv(array of(list of(dual(1.0, 1.0), dual(2.0, 0.0))))"), "= [dual(3, 6), dual(12, 0)] : List Dual");
  s.save();
  // softmax's first item s0 at p: ∂s0/∂p0 = s0(1 − s0), ∂s0/∂pj = −s0·sj.
  const e = [0.5, -1, 2].map(Math.exp), total = e.reduce((a, b) => a + b), sm = e.map((x) => x / total);
  const want = [[2, 4, 6], [sm[0] * (1 - sm[0]), -sm[0] * sm[1], -sm[0] * sm[2]], [0, 3], [2, -1], [2, 4, 6], [sm[0], sm[0] * (1 - sm[0]), -sm[0] * sm[1], -sm[0] * sm[2]], [8, 12], [3, 12], [6, 0]];
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
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), wasiImports(wasi)));
  closeSync(fd);
  check("ters wasi", readFileSync(of, "utf8"));
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "n")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  check("ters native", spawnSync(join(dir, "n"), [], { encoding: "utf8" }).stdout);
});

// Through tensors (L285): contracted, + − · item by item and tensor map,
// each gone back through by what it means (contracted's slopes are two
// contractions), against central differences; over dual numbers, a
// Hessian times a vector against one worked out by hand.
test("gradient through tensors: contracted, + − ·, tensor map (L285)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tensor-gradient-")), folder = join(dir, "p");
  mkdirSync(folder);
  writeFileSync(join(folder, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(folder, "names.default.json"), "{}");
  const s = new Session(folder);
  const fill = (name: string, params: string[], text: string) => { s.define(name, "function", params); s.replace(/□#(\w+)/.exec(s.view(name))![1], text); };
  fill("w", [], "tensor of(list of(3, 2), list of(1.0, −0.5, 0.25, 2.0, −1.5, 0.75))");
  fill("x", ["p"], "tensor of(list of(2, 3), map(range(6), (i) => first(item at(p, i), else 0.0)))");
  // A product, one with the axes paired the other way (its slopes put
  // back in x's order), and + − · and a map of them.
  fill("f", ["p"], "sum(tensor items(tensor map((v) => v · v, contracted(x(p), w(), list of((1, 0))))))");
  fill("g", ["p"], "((a) => sum(tensor items(tensor map((v) => v / (1.0 + v · v), a − (−a) · a + contracted(w(), x(p), list of((0, 1)))))))(contracted(x(p), w(), list of((1, 0))))");
  const point = [1, -0.5, 2, 0.25, 1.5, -1];
  const arr = (xs: number[]) => `array of(list of(${xs.map((v) => v.toFixed(6)).join(", ")}))`;
  fill("shown", ["g"], "show(g)");
  fill("main", [], `print(${["f", "g"].map((f) => `shown(first(gradient(${f})(${arr(point)}), else array of(list of())))`).join(' ++ "\\n" ++ ')})`);
  assert.equal(s.errors(), "ok");
  // f and g in JavaScript, and their slopes by central differences.
  const W = [1, -0.5, 0.25, 2, -1.5, 0.75];
  const xw = (p: number[]) => [0, 1].flatMap((r) => [0, 1].map((c) => [0, 1, 2].reduce((acc, j) => acc + p[r * 3 + j] * W[j * 2 + c], 0)));
  const wx = (p: number[]) => [0, 1].flatMap((c) => [0, 1].map((r) => [0, 1, 2].reduce((acc, j) => acc + W[j * 2 + c] * p[r * 3 + j], 0)));
  const fs = [(p: number[]) => xw(p).reduce((acc, v) => acc + v * v, 0), (p: number[]) => { const a = xw(p), b = wx(p); return a.map((v, i) => v + v * v + b[i]).reduce((acc, v) => acc + v / (1 + v * v), 0); }];
  const want = fs.map((f) => point.map((_, i) => (f(point.map((v, j) => (j === i ? v + 1e-6 : v))) - f(point.map((v, j) => (j === i ? v - 1e-6 : v)))) / 2e-6));
  const check = (how: string, out: string) => {
    const got = out.trim().split("\n").map((l) => [...l.matchAll(/-?[\d.]+(?:e-?\d+)?/g)].map((m) => +m[0]));
    assert.equal(got.length, 2, `${how}: ${out}`);
    got.forEach((g, i) => { assert.equal(g.length, 6, out); g.forEach((v, j) => assert.ok(Math.abs(v - want[i][j]) < 1e-5 * Math.max(1, Math.abs(want[i][j])), `${how} line ${i}, ${j}: ${v} against ${want[i][j]}`)); });
  };
  // Over dual numbers: f = Σ (x w)³'s gradient at p + εv is 3 Σ_c y² w
  // and its ε part the Hessian times v.
  fill("xd", ["p"], "tensor of(list of(2, 3), map(range(6), (i) => first(item at(p, i), else dual(0.0, 0.0))))");
  fill("wd", [], "tensor of(list of(3, 2), map(range(6), (i) => dual(as float64(i) · 0.5 − 1.0, 0.0)))");
  fill("cubes", ["p"], "sum(tensor items(tensor map((v) => v · v · v, contracted(xd(p), wd(), list of((1, 0))))))");
  fill("hv", ["p"], "items of array(first(gradient(cubes)(p), else array of(list of())))");
  assert.equal(s.eval("hv(array of(list of(dual(1.0, 1.0), dual(−0.5, 0.0), dual(2.0, 0.5), dual(0.25, 0.0), dual(1.5, −1.0), dual(−1.0, 0.0))))"),
    "= [dual(-10.59375, 1.3125), dual(7.59375, 1.6875), dual(25.78125, 2.0625), dual(-5.8359375, -1.3125), dual(1.1484375, 1.3125), dual(8.1328125, 3.9375)] : List Dual");
  s.save();
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
  for (const how of [[], ["--evaluator"]]) {
    const r = spawnSync(process.execPath, [lab, "run", folder, ...how], { encoding: "utf8" });
    check(`ters run ${how.join(" ")} ${r.stderr}`, r.stdout);
  }
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "n")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  check("ters native", spawnSync(join(dir, "n"), [], { encoding: "utf8" }).stdout);
});

// Over a tensor itself (L285): its slopes a tensor of its shape, over
// Float64 (2 (x w) wᵀ, worked out by hand) and over Dual (the Hessian
// times a vector, as the test above has it).
test("gradient over a tensor: a tensor of its shape (L285)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tensor-input-gradient-")), folder = join(dir, "p");
  mkdirSync(folder);
  writeFileSync(join(folder, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(folder, "names.default.json"), "{}");
  const s = new Session(folder);
  const fill = (name: string, params: string[], text: string) => { s.define(name, "function", params); s.replace(/□#(\w+)/.exec(s.view(name))![1], text); };
  fill("w", [], "tensor of(list of(3, 2), list of(1.0, −0.5, 0.25, 2.0, −1.5, 0.75))");
  fill("squares", ["t"], "sum(tensor items(tensor map((v) => v · v, contracted(t, w(), list of((1, 0))))))");
  fill("t0", [], "tensor of(list of(2, 3), list of(1.0, −0.5, 2.0, 0.25, 1.5, −1.0))");
  fill("wd", [], "tensor of(list of(3, 2), map(range(6), (i) => dual(as float64(i) · 0.5 − 1.0, 0.0)))");
  fill("cubes", ["t"], "sum(tensor items(tensor map((v) => v · v · v, contracted(t, wd(), list of((1, 0))))))");
  fill("td", [], "tensor of(list of(2, 3), list of(dual(1.0, 1.0), dual(−0.5, 0.0), dual(2.0, 0.5), dual(0.25, 0.0), dual(1.5, −1.0), dual(−1.0, 0.0)))");
  fill("main", [], 'print(show(first(gradient(squares)(t0()), else t0())) ++ "\\n" ++ show(first(gradient(cubes)(td()), else td())))');
  assert.equal(s.errors(), "ok");
  const want = [
    "tensor([2, 3], array [-4.25, -1.0625, 6.375, 2.125, 9.5625, -3.1875])",
    "tensor([2, 3], array [dual(-10.59375, 1.3125), dual(7.59375, 1.6875), dual(25.78125, 2.0625), dual(-5.8359375, -1.3125), dual(1.1484375, 1.3125), dual(8.1328125, 3.9375)])",
  ];
  assert.equal(s.eval("first(gradient(squares)(t0()), else t0())"), `= ${want[0]} : Tensor Float64`);
  assert.equal(s.eval("first(gradient(cubes)(td()), else td())"), `= ${want[1]} : Tensor Dual`);
  s.save();
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
  for (const how of [[], ["--evaluator"]]) {
    const r = spawnSync(process.execPath, [lab, "run", folder, ...how], { encoding: "utf8" });
    assert.equal(r.stdout.trim(), want.join("\n"), `ters run ${how.join(" ")} ${r.stderr}`);
  }
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "n")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "n"), [], { encoding: "utf8" }).stdout.trim(), want.join("\n"));
});
