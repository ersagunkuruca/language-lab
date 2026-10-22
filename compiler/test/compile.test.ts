// The compiler is a second implementation of the language, so the
// evaluator is its test oracle: every example program must print exactly
// the same lines both ways.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runMain, makeRunner, fromList, type Value } from "../../projectional/src/lang/run.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { CONS, NIL, S } from "../../projectional/src/lang/std.ts";
import { B } from "../../projectional/src/prelude.ts";
import { compile } from "../src/compile.ts";
import { compileProgram, load } from "../src/program.ts";
import { $setPrint } from "../src/runtime.js";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const dir = mkdtempSync(join(tmpdir(), "compiled-"));

async function compiled(name: string, exports: string[]) {
  const file = join(dir, `${name}-${exports.join("-").replace(/\W/g, "")}.js`);
  writeFileSync(file, compileProgram(name, exports, runtime));
  return (await import(pathToFileURL(file).href)).defs as Record<string, (...a: unknown[]) => unknown>;
}

function printed(run: () => void, setPrint: (p: (s: string) => void) => void): string[] {
  const lines: string[] = [];
  setPrint((s) => lines.push(s));
  run();
  return lines;
}

for (const name of ["queens", "algebra", "relations", "backwards", "calculus"]) {
  test(`${name}: compiled main prints what the evaluator prints`, async () => {
    const p = load(name);
    const want: string[] = [];
    runMain(p.code, p.info, p.named("main"), { print: (s) => want.push(s) });
    const defs = await compiled(name, ["main"]);
    const got = printed(() => defs.main(), $setPrint);
    assert.deepEqual(got, want);
    assert.ok(want.length > 3);
  });
}

test("queens: a Choice function compiles to a generator with the same stream of answers", async () => {
  const p = load("queens");
  const defs = await compiled("queens", ["queens"]);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const want = [...r.call(r.value(p.named("queens")), 6)].map((b) => fromList(b));
  const got = [...(defs.queens(6) as Iterable<Value>)].map((b) => fromList(b));
  assert.deepEqual(got, want);
  assert.equal(got.length, 4);
});

test("relations: solved directions give the solver's answers, in its order", async () => {
  const p = load("relations");
  const defs = await compiled("relations", ["split", "to polar", "square roots"]);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  // Some directions have infinitely many answers (an angle plus 2πk), so
  // compare the first few.
  const take = (xs: Iterable<Value>, n = 6) => { const out: Value[] = []; for (const x of xs) if (out.push(x) >= n) break; return out; };
  const ev = (name: string, ...args: Value[]) => take(r.call(r.value(p.named(name)), ...args));
  // split is pure: a plain function. to polar has Choice: a generator.
  assert.deepEqual(defs.split(10, 4), ev("split", 10, 4)[0]);
  for (const [x, y] of [[0, 2], [3, 4], [-1, 0], [0, 0]]) {
    assert.deepEqual(take(defs["to polar"](x, y) as Iterable<Value>), ev("to polar", x, y));
  }
  for (const y of [9, 2, 0, -1]) assert.deepEqual(defs["square roots"](y), ev("square roots", y)[0]);
});

test("an effect-polymorphic function gets one copy per calling convention", async () => {
  // map(list, change): pure when change is pure, Choice when change is.
  const k = new Lang();
  const map = k.def("map");
  k.define(map, k.fn(["list", "change"], (xs, f) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["item", "rest"], body: ([h, t]) => k.call(CONS, k.call(f, h), k.call(map, t, f)) },
  ])));
  const plain = k.def("plain");
  k.define(plain, k.thunk(() => k.call(map, k.call(S.range, k.lit(4)), k.fn(["x"], (x) => k.call(B.mul, x, x)))));
  const choices = k.def("choices");
  k.define(choices, k.thunk(() => k.call(S.all, k.thunk(() => k.call(map, k.call(S.range, k.lit(3)),
    k.fn(["x"], (x) => k.call(S.oneOf, k.list(x, k.call(B.add, x, k.lit(10))))))))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);

  const source = compile(code, info, names, { runtime, exports: ["plain", "choices"] });
  assert.match(source, /^function map\(/m);
  assert.match(source, /^function\* map\$choice\(/m);
  const file = join(dir, "poly.js");
  writeFileSync(file, source);
  const defs = (await import(pathToFileURL(file).href)).defs;

  const r = makeRunner(code, info, { print: () => {} });
  for (const name of ["plain", "choices"]) {
    const def = code.defs.find((d) => names[d] === name)!;
    assert.deepEqual(defs[name](), [...r.call(r.value(def))][0]);
  }
  assert.equal(fromList(defs.choices()).length, 8);
});
