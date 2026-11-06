// A relation used one way on C (C195a): the solver's plan written as the
// scalar profile's code, its answer rounded as the solver rounds it
// (+x.toPrecision(12), 0 under 1e-12), so native code gives the
// evaluator's bits, halfway cases included.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { B } from "../../ters/src/prelude.ts";
import { lowerScalar } from "../src/scalar.ts";
import { build, skip } from "./c-harness.ts";

function program() {
  const k = new Lang();
  // plus nothing(x) = x + 0, and lin(x) = 2x + 3, each solved for x.
  const plus = k.def("plus nothing"), lin = k.def("lin");
  k.define(plus, k.fn(["x"], (x) => k.call(B.add, x, k.lit(0))));
  k.define(lin, k.fn(["x"], (x) => k.call(B.add, k.call(B.mul, k.lit(2), x), k.lit(3))));
  const param = (d: string) => (k.code.nodes[(k.code.nodes[d] as { body: string }).body] as { params: string[] }).params[0];
  const px = param(plus), lx = param(lin);
  const back = k.def("back"), solveLin = k.def("solve lin");
  k.define(back, k.fn(["v"], (v) => k.solve(plus, { out: v }, { [px]: "x" }, ({ [px]: y }) => y)));
  k.define(solveLin, k.fn(["v"], (v) => k.solve(lin, { out: v }, { [lx]: "x" }, ({ [lx]: y }) => k.call(B.mul, y, k.lit(3)))));
  const main = k.def("main");
  k.define(main, k.call(solveLin, k.lit(7.3)));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), back, solveLin, main };
}

function values(): number[] {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const vs: number[] = [];
  for (let i = 0; i < 400; i++) {
    const e = Math.floor(rnd() * 44) - 11;
    vs.push((rnd() < 0.5 ? -1 : 1) * (1 + rnd() * 9) * 10 ** e);
    const n = Math.floor(1e11 + rnd() * 9e11);
    vs.push((n + 0.5) * 10 ** (e - 11));
    vs.push(Number(((n + 0.5) / 1e11).toPrecision(17)) * 10 ** e);
  }
  return [...vs, 0, -0.5, 0.1 + 0.2, 1 / 3, 2 / 3, 1e-12, 5e-13, 1e-11, 123456789012.5, 1e21, 9.999999999995, 0.30000000000000004, 1e40, -7.3];
}

test("a relation solved one way on C gives the evaluator's answer, rounded as the solver rounds", { skip }, () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.back, p.solveLin], { data: true });
  const run = build(lowered);
  const at = (d: string) => lowered.funcs.findIndex((f) => f.def === d);
  const vs = values();
  const got = run(vs.map((v) => [at(p.back), [v]] as [number, number[]])).map((r) => r.value);
  // The solver's rounding (invertible/src/relation.js clean).
  const clean = (x: number) => (Math.abs(x) < 1e-12 ? 0 : +x.toPrecision(12));
  const bad = vs.map((v, i) => [v, got[i], clean(v)]).filter(([, g, e]) => !Object.is(g, e));
  assert.deepEqual(bad, []);
  // lin solved for 7.3 is 2.15, then times 3; and the same as main on the evaluator.
  assert.deepEqual(run([[at(p.solveLin), [7.3]], [at(p.solveLin), [-1e5]]]).map((r) => r.value), [2.15 * 3, clean((-1e5 - 3) / 2) * 3]);
  assert.equal(runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), 2.15 * 3);
});

// The same through lab wasi (Node's WASI): each value solved through plus
// nothing, against the solver's rounding, all true as lab run prints.
test("lab wasi solves a relation one way as lab run does", async () => {
  const { spawnSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { WASI } = await import("node:wasi");
  const { LIBRARY } = await import("../../ters/src/lang/library.ts");
  const { SHOW_ANY, S } = await import("../../ters/src/lang/std.ts");
  const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
  const k = new Lang(LIBRARY.code);
  const plus = k.def("plus nothing");
  k.define(plus, k.fn(["x"], (x) => k.call(B.add, x, k.lit(0))));
  const x = (k.code.nodes[(k.code.nodes[plus] as { body: string }).body] as { params: string[] }).params[0];
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(12));
  const pairs = values().slice(0, 300).map((v) => k.listOf(k.lit(v), k.lit(clean(v))));
  const main = k.def("main");
  k.define(main, k.call(SHOW_ANY, k.call(lib("map"), k.listOf(...pairs), k.fn(["p"], (p) =>
    k.solve(plus, { out: k.call(lib("item at"), p, k.int(0), k.lit(0)) }, { [x]: "x" }, ({ [x]: y }) => k.call(S.equal, y, k.call(lib("item at"), p, k.int(1), k.lit(0))))))));
  const dir = mkdtempSync(join(tmpdir(), "solved-wasi-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const lab = join(import.meta.dirname, "../../ters/cli/lab.ts");
  const made = spawnSync(process.execPath, [lab, "wasi", dir, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const want = spawnSync(process.execPath, [lab, "run", dir], { encoding: "utf8" });
  assert.equal(want.stdout, `[${Array(300).fill("true").join(", ")}]\n`);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const w = new WASI({ version: "preview1", args: ["p"], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), w.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want.stdout);
});
