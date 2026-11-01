// A Float64 is finite on compiled JavaScript too (L125c,
// FLOAT-VALUES-2026-11-01.md §2): where the evaluator stops with a reason
// (run.ts finiteFloat), compiled code stops with the same one. No answer
// (x / 0, √ of a negative, log of 0, 0 to a negative power) is checked on
// the argument; an overflow is checked late, where it would otherwise
// vanish or decide something: a comparison, `show`, a divisor, `exp`.
// Since L125b no answer is a Choice in the evaluator: WebAssembly's
// partial functions give none too, and so does compiled JavaScript (L125c3).

import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { WASI } from "node:wasi";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { infer } from "../../ters/src/lang/infer.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { Aborted, makeRunner, runProgram } from "../../ters/src/lang/run.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { ABORT_OP, S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import type { Id } from "../../ters/src/model.ts";
import { compile } from "../src/compile.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, fromText, instantiate } from "../src/wasm.ts";

// Each definition takes two Float64s and shows its answer.
const CASES: [string, (k: Lang, a: Id, b: Id) => Id][] = [
  ["divide", (k, a, b) => k.call(B.div, a, b)],
  ["root", (k, a) => k.call(B.sqrt, a)],
  ["log", (k, a) => k.call(B.log, a)],
  ["power", (k, a, b) => k.call(B.pow, a, b)],
  ["mod", (k, a, b) => k.call(S.mod, a, b)],
  // Overflow in a chain, seen first by show.
  ["grow", (k, a, b) => k.call(B.add, k.call(B.mul, a, b), k.lit(1))],
  // An overflow exp would turn into 0, and a divisor would turn into 0.
  ["exp", (k, a, b) => k.call(B.exp, k.call(B.neg, k.call(B.mul, a, b)))],
  ["over", (k, a, b) => k.call(B.div, k.lit(1), k.call(B.mul, a, b))],
  ["atan2", (k, a, b) => k.call(B.atan2, k.call(B.mul, a, b), k.lit(-1))],
];
// Overflow decides a comparison: the show is of a Bool, so only less sees it.
const LESS = (k: Lang, a: Id, b: Id) => k.call(S.less, k.call(B.mul, a, b), k.lit(0));

function program() {
  const k = new Lang();
  const defs = [...CASES.map(([name, f]): [string, Id] => {
    const d = k.def(name);
    k.define(d, k.fn(["a", "b"], (a, b) => k.call(S.show, f(k, k.call(B.add, a, k.lit(0)), k.call(B.add, b, k.lit(0))))));
    return [name, d];
  })];
  const less = k.def("less");
  k.define(less, k.fn(["a", "b"], (a, b) => k.if(LESS(k, k.call(B.add, a, k.lit(0)), k.call(B.add, b, k.lit(0))), k.lit(1), k.lit(2))));
  defs.push(["less", less]);
  // The stop is an Abort performed where the division was: a handler in
  // the program gets it, in both.
  const caught = k.def("caught");
  k.define(caught, k.fn(["a", "b"], (a, b) => k.handle(k.call(S.show, k.call(B.div, k.call(B.add, a, k.lit(0)), b)), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])));
  defs.push(["caught", caught]);
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, defs };
}
// What a run says: its answer, or the reason it stopped.
const said = (f: () => unknown) => { try { const v = f(); return typeof v === "object" ? JSON.stringify(v) : String(v); } catch (e) { if (e instanceof Aborted) return `stops: ${e.reason}`; throw e; } };
const INPUTS = [[1, 0], [0, 0], [-4, 2], [0, -1], [-8, 0.5], [6, 4], [1e300, 1e300], [-1e300, 1e300], [2, 3], [-0, 1]];

test("compiled JavaScript stops where the evaluator does, with the same reason", async () => {
  const { code, names, info, defs } = program();
  const path = join(mkdtempSync(join(tmpdir(), "finite-")), "finite.js");
  writeFileSync(path, compile(code, info, names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: defs.map(([n]) => n) }));
  const js = (await import(pathToFileURL(path).href)).defs as Record<string, (a: number, b: number) => unknown>;
  const r = makeRunner(code, info, { print: () => {}, names });
  const evaluated = (d: Id, a: number, b: number) => said(() => { for (const v of r.call(r.value(d), a, b)) return v; });
  const inputs = INPUTS;
  const stops = new Set<string>();
  const none = new Set<string>();
  for (const [name, d] of defs) for (const [a, b] of inputs) {
    const want = evaluated(d, a, b), got = said(() => { const v = js[name](a, b) as { next?: unknown } & Iterable<unknown>; return typeof v?.next === "function" ? [...v][0] : v; });
    if (want === "undefined") none.add(name);
    if (name !== "less") assert.equal(got, want, `${name}(${a}, ${b})`);
    else assert.equal(got.startsWith("stops"), want.startsWith("stops"), `${name}(${a}, ${b}): ${got} vs ${want}`);
    if (want.startsWith("stops")) stops.add(want);
  }
  // No answer (L125b) is no answer here too (L125c3): x / 0 in caught is a
  // Choice, not an Abort its handler sees. Every partial operation had none.
  assert.equal(said(() => [...(js.caught(1, 0) as Iterable<unknown>)][0]), "undefined");
  // The evaluator stops only on overflow now.
  assert.deepEqual([...stops].sort(), ["stops: the answer is too big for a Float64 (overflow)"]);
  assert.deepEqual([...none].sort(), ["caught", "divide", "log", "mod", "over", "power", "root"]);
});

// WebAssembly (L125c2): the same checks, lowered (scalar.ts), and the
// host's stop throws the Abort. Not a handler's to catch there: `caught`
// stops too (FLOAT-VALUES-2026-11-01.md, L125c2).
test("WebAssembly stops where the evaluator does, with the same reason", async () => {
  const { code, names, info, defs } = program();
  const lowered = lowerScalar(code, info, names, defs.filter(([n]) => n !== "caught").map(([, d]) => d), { data: true });
  assert.deepEqual([...lowered.refused.values()], []);
  const w = (await instantiate(emitWasm(lowered))) as unknown as Record<string, (a: number, b: number) => unknown>;
  const r = makeRunner(code, info, { print: () => {} });
  let stops = 0;
  for (const [name, d] of defs) {
    if (name === "caught") continue;
    const f = lowered.funcs.find((g) => g.def === d)!;
    for (const [a, b] of INPUTS) {
      const want = said(() => { for (const v of r.call(r.value(d), a, b)) return v; });
      // A partial function (one with no answer at some inputs) gives its status too.
      const got = said(() => { let v = w[f.name](a, b); if (f.partial) { const [x, st] = v as [unknown, number]; if (st !== 0) return undefined; v = x; } return f.result === "text" ? fromText(w as never, v) : f.result === "i32" ? (v ? "true" : "false") : v; });
      if (name === "less") assert.equal(got.startsWith("stops"), want.startsWith("stops"), `${name}(${a}, ${b}): ${got} vs ${want}`);
      else assert.equal(got, want, `${name}(${a}, ${b})`);
      if (want.startsWith("stops")) stops++;
    }
  }
  assert.ok(stops > 3);
});

// Under WASI the stop writes its reason to standard error and exits with 1,
// after what the program printed: as `lab run` does.
test("a WASI program stops with the evaluator's reason and exit code", async () => {
  const k = new Lang();
  const main = k.def("main");
  // The divisors are known not to be 0 (L125b), so main has no Choice; the
  // second overflows.
  const half = (x: number, y: number) => k.call(S.print, k.call(S.show, k.call(B.div, k.call(B.add, k.lit(x), k.lit(0)), k.call(B.add, k.lit(y), k.lit(0)))));
  k.define(main, k.thunk(() => k.seq(half(1, 4), half(1e300, 1e-300), half(1, 2))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const printed: string[] = [], errors: string[] = [];
  const exit = runProgram(code, info, main, [], { print: (l) => printed.push(l), names, world: { ...nodeWorld(), error: (l) => errors.push(l) } });
  assert.deepEqual([exit, printed, errors], [1, ["0.25"], ["the answer is too big for a Float64 (overflow)"]]);
  const m = emitWasm(lowerScalar(code, info, names, [main], { data: true }), { wasi: true });
  const io = mkdtempSync(join(tmpdir(), "finite-wasi-"));
  const [stdout, stderr] = [openSync(join(io, "out"), "w"), openSync(join(io, "err"), "w")];
  const wasi = new WASI({ version: "preview1", args: ["main"], stdout, stderr, returnOnExit: true });
  const got = wasi.start(await WebAssembly.instantiate(await WebAssembly.compile(m.bytes), wasi.getImportObject() as WebAssembly.Imports));
  [stdout, stderr].forEach((fd) => closeSync(fd));
  assert.deepEqual([got, readFileSync(join(io, "out"), "utf8"), readFileSync(join(io, "err"), "utf8")], [1, "0.25\n", "the answer is too big for a Float64 (overflow)\n"]);
});
