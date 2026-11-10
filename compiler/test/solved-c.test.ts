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
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { INT_OPS, NONE, SHOW_ANY, S, SOME } from "../../ters/src/lang/std.ts";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { B } from "../../ters/src/prelude.ts";
import { lowerScalar } from "../src/scalar.ts";
import { build, skip } from "./c-harness.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

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

// A program printed by ters run, then by ters wasi (Node's WASI) and, with a
// C compiler, ters native.
async function throughLab(k: Lang): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "solved-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  return throughDir(dir, dir);
}
async function throughDir(program: string, dir = mkdtempSync(join(tmpdir(), "solved-"))): Promise<string> {
  const want = spawnSync(process.execPath, [lab, "run", program], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  const made = spawnSync(process.execPath, [lab, "wasi", program, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const w = new WASI({ version: "preview1", args: ["p"], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), w.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want.stdout, "ters wasi");
  if (!skip) {
    const built = spawnSync(process.execPath, [lab, "native", program, "-o", join(dir, "p")], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    assert.equal(spawnSync(join(dir, "p"), [], { encoding: "utf8" }).stdout, want.stdout, "ters native");
  }
  return want.stdout;
}
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
const firstParam = (k: Lang, d: string) => (k.code.nodes[(k.code.nodes[d] as { body: string }).body] as { params: string[] }).params[0];

// Each value solved for through plus nothing, against the solver's rounding.
test("ters wasi and ters native solve a relation one way as ters run does", async () => {
  const k = new Lang(LIBRARY.code);
  const plus = k.def("plus nothing");
  k.define(plus, k.fn(["x"], (x) => k.call(B.add, x, k.lit(0))));
  const x = firstParam(k, plus);
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(12));
  const pairs = values().slice(0, 300).map((v) => k.listOf(k.lit(v), k.lit(clean(v))));
  const main = k.def("main");
  k.define(main, k.call(SHOW_ANY, k.call(lib("map"), k.listOf(...pairs), k.fn(["p"], (p) =>
    k.solve(plus, { out: k.call(lib("item at"), p, k.int(0), k.lit(0)) }, { [x]: "x" }, ({ [x]: y }) => k.call(S.equal, y, k.call(lib("item at"), p, k.int(1), k.lit(0))))))));
  assert.equal(await throughLab(k), `[${Array(300).fill("true").join(", ")}]\n`);
});

// A solve with two ways (C195b): every answer in a search, one where two
// ways give the same (0, and 1e-20's ±1e-10, which the solver's key takes
// for one), and the first where first asks.
test("a relation with several ways gives the solver's answers on WebAssembly and C", async () => {
  const k = new Lang(LIBRARY.code);
  const sq = k.def("square");
  k.define(sq, k.fn(["x"], (x) => k.call(B.mul, x, x)));
  const x = firstParam(k, sq);
  const roots = k.def("roots"), one = k.def("a root");
  k.define(roots, k.fn(["v"], (v) => k.call(S.all, k.thunk(() => k.solve(sq, { out: v }, { [x]: "x" }, ({ [x]: y }) => y)))));
  k.define(one, k.fn(["v"], (v) => k.solve(sq, { out: v }, { [x]: "x" }, ({ [x]: y }) => k.call(B.mul, y, k.lit(10)))));
  const first = (v: number) => k.call(S.first, k.thunk(() => k.call(one, k.lit(v))), k.thunk(() => k.lit(-1)));
  const main = k.def("main");
  k.define(main, k.call(SHOW_ANY, k.listOf(...[9, 0, -1, 2, 1e-20].map((v) => k.call(roots, k.lit(v))), k.listOf(first(16), first(-16)))));
  assert.equal(await throughLab(k), "[[3, -3], [0], [], [1.414213562, -1.414213562], [1e-10], [40, -1]]\n");
});

// A solve the relational interpreter runs, in a mode with one answer or
// none: its plan as functions. Text joined run backwards (a greeting's
// name), Int + and − (det), and a case built backwards (some(t + "!")).
test("a relational solve with one answer or none runs on WebAssembly and C as ters run does", async () => {
  const k = new Lang(LIBRARY.code);
  const param = (d: string) => firstParam(k, d);
  const greet = k.def("greet"), shifted = k.def("shifted"), said = k.def("said");
  k.define(greet, k.fn(["name"], (x) => k.call(S.concat, k.lit("hello, "), x)));
  k.define(shifted, k.fn(["n"], (x) => k.call(INT_OPS.sub, k.call(INT_OPS.add, x, k.int(3)), k.int(1))));
  k.define(said, k.fn(["o"], (o) => k.call(SOME, k.call(S.concat, o, k.lit("!")))));
  const who = k.def("who was greeted"), unshift = k.def("unshift"), heard = k.def("heard");
  const [g, n, o] = [param(greet), param(shifted), param(said)];
  k.define(who, k.fn(["t"], (t) => k.call(S.first, k.thunk(() => k.solve(greet, { out: t }, { [g]: "name" }, ({ [g]: y }) => y)), k.thunk(() => k.lit("nobody")))));
  k.define(unshift, k.fn(["t"], (t) => k.solve(shifted, { out: t }, { [n]: "n" }, ({ [n]: y }) => y)));
  k.define(heard, k.fn(["t"], (t) => k.call(S.first, k.thunk(() => k.solve(said, { out: t }, { [o]: "o" }, ({ [o]: y }) => y)), k.thunk(() => k.lit("?")))));
  const main = k.def("main");
  k.define(main, k.call(SHOW_ANY, k.listOf(...["hello, Ada", "goodbye", "hello, ", "hello, Çağrı ✨"].map((t) => k.call(who, k.lit(t))),
    k.call(S.show, k.call(unshift, k.int(10))), k.call(heard, k.call(SOME, k.lit("hi!"))), k.call(heard, k.call(SOME, k.lit("hi"))), k.call(heard, k.x(NONE)))));
  assert.equal(await throughLab(k), '["Ada", "nobody", "", "Çağrı ✨", "8", "hi", "?", "?"]\n');
});

// A torn plan (C195, torn.ts): a quadratic in time, which the solver
// searches for numerically, gives its roots on WebAssembly and C as the
// solver's search does: two, one where they touch (a dip, not a sign
// change), none.
test("a relation solved by searching for a number gives the solver's roots on WebAssembly and C", async () => {
  const k = new Lang(LIBRARY.code);
  const fall = k.def("fall");
  k.define(fall, k.fn(["speed", "time"], (v, t) => k.call(B.add, k.call(B.mul, v, t), k.call(B.mul, k.lit(4.905), k.call(B.mul, t, t)))));
  const body = k.code.nodes[(k.code.nodes[fall] as { body: string }).body] as { params: string[] };
  const [sp, tm] = body.params;
  const times = k.def("times");
  k.define(times, k.fn(["h", "v"], (h, v) => k.call(S.all, k.thunk(() => k.solve(fall, { out: h, [sp]: v }, { [tm]: "t" }, ({ [tm]: y }) => y)))));
  const main = k.def("main");
  k.define(main, k.call(SHOW_ANY, k.listOf(...[[29.62, 5], [0, 0], [-100, 0], [1, -3], [1e4, 1]].map(([h, v]) => k.call(times, k.lit(h), k.lit(v))))));
  assert.equal(await throughLab(k), "[[2, -3.019367992], [0], [], [-0.239527661, 0.851148456], [45.050542366, -45.254415965]]\n");
});

// A family of answers (C195): angle = ±acos(x / 2) + 2πk, where only a
// first takes it: the solver's first answer (level 0, every k 0), and
// none where acos has none; and for some over a predicate, whether it
// has an answer.
test("a solve with a periodic family gives the solver's first answer on WebAssembly and C", async () => {
  const k = new Lang(LIBRARY.code);
  const c = k.def("twice cos");
  k.define(c, k.fn(["a"], (a) => k.call(B.mul, k.lit(2), k.call(B.cos, a))));
  const a = firstParam(k, c);
  const angle = k.def("angle");
  k.define(angle, k.fn(["v"], (v) => k.call(S.first, k.thunk(() => k.solve(c, { out: v }, { [a]: "a" }, ({ [a]: y }) => k.call(B.mul, y, k.lit(10)))), k.thunk(() => k.lit(-1)))));
  const main = k.def("main");
  k.define(main, k.call(SHOW_ANY, k.listOf(...[1, 2, -2, 0, 3, -0.5].map((v) => k.call(angle, k.lit(v))))));
  assert.equal(await throughLab(k), "[10.471975512, 0, 31.415926536, 15.707963268, -1, 18.234765819]\n");
});

// physics, all of it: fall's tear, rotate's periodic ways under first, and
// for some y, angle: polar(…).
test("physics prints on WebAssembly and C what ters run prints", async () => {
  assert.match(await throughDir(join(import.meta.dirname, "../../ters/examples/physics")), /for some y, angle: polar\(3, y, 2, angle\) = false\n$/);
});

// relations: to polar, a definition that is one solve with a family of
// answers, read through first (its body written in place there).
test("relations prints on WebAssembly and C what ters run prints", async () => {
  assert.match(await throughDir(join(import.meta.dirname, "../../ters/examples/relations")), /to polar\(0, 2\), canonical = 2, 1\.570796327\n/);
});

// A relational solve with several answers (C195, backwards' magnitude):
// in a search, one of every answer, in the interpreter's order.
test("a relational solve with several answers gives each on WebAssembly and C as ters run does", async () => {
  const k = new Lang(LIBRARY.code);
  const mag = k.def("magnitude");
  k.define(mag, k.fn(["x"], (x) => k.if(k.call(S.less, x, k.lit(0)), k.call(B.neg, x), x)));
  const sizes = k.def("magnitudes to");
  k.define(sizes, k.fn(["s"], (s) => k.call(S.all, k.thunk(() => k.solve(mag, { out: s }, { [firstParam(k, mag)]: "x" }, ({ [firstParam(k, mag)]: y }) => y)))));
  // Text joined with neither side known: every cut.
  const cuts = k.def("cuts");
  k.define(cuts, k.fn(["t"], (t) => k.call(S.all, k.thunk(() => k.solve(S.concat, { out: t }, { 0: "a", 1: "b" }, ({ 0: a, 1: b }) => k.call(S.concat, a, k.call(S.concat, k.lit("|"), b)))))));
  const main = k.def("main");
  k.define(main, k.call(SHOW_ANY, k.listOf(k.call(SHOW_ANY, k.listOf(...[5, 0, -2, 0.25].map((v) => k.call(sizes, k.lit(v))))), k.call(SHOW_ANY, k.listOf(...["abc", "", "çğ✨"].map((t) => k.call(cuts, k.lit(t))))))));
  assert.equal(await throughLab(k), `["[[-5, 5], [0], [], [-0.25, 0.25]]", "[[\\"|abc\\", \\"a|bc\\", \\"ab|c\\", \\"abc|\\"], [\\"|\\"], [\\"|çğ✨\\", \\"ç|ğ✨\\", \\"çğ|✨\\", \\"çğ✨|\\"]]"]\n`);
});
