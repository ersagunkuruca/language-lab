// Ints known small, as plain JavaScript arithmetic (int-ranges.ts, C267):
// a sum or product is the operator only where its inputs and answer are
// shown small; an input from outside, or a count still growing, keeps the
// checked one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { intRanges } from "../src/int-ranges.ts";
import { kids, type CoreIR, type SExpr, type SFunc } from "../src/scalar.ts";

const int = (v: number): SExpr => ({ k: "int", v: BigInt(v) });
const loc = (i: number): SExpr => ({ k: "local", i });
const rt = (fn: string, ...args: SExpr[]): SExpr => ({ k: "rt", fn, args });
const call = (fn: number, ...args: SExpr[]): SExpr => ({ k: "call", fn, args, tail: false });
const fn = (name: string, params: number, body: SExpr): SFunc => ({ def: name, name, params: Array(params).fill("int"), result: "int", locals: Array(params).fill("int"), body, spends: false, budgeted: false });
const fns = (e: SExpr): string[] => [...(e.k === "rt" ? [e.fn] : []), ...kids(e).flatMap(fns)];

test("a cell's number from remainders is plain arithmetic; an input from outside isn't", () => {
  const ir = {
    funcs: [
      // main(n): key(wrap(n), wrap(n + 1)) + square(n)
      fn("main", 1, rt("int.add", call(1, call(2, loc(0)), call(2, rt("int.add", loc(0), int(1)))), call(3, loc(0)))),
      // key(a, b) = a * 12 + b
      fn("key", 2, rt("int.add", rt("int.mul", loc(0), int(12)), loc(1))),
      // wrap(c) = first(remainder(c, 12), else 0)
      fn("wrap", 1, { k: "attempt", body: rt("int.remainder", loc(0), int(12)), res: 1, ok: loc(1), otherwise: int(0), t: "int" }),
      // square(x) = x * x, x from outside
      fn("square", 1, rt("int.mul", loc(0), loc(0))),
    ],
  } as unknown as CoreIR;
  ir.funcs[2].locals.push("int");
  assert.ok(intRanges(ir, new Set([0])) > 0);
  assert.deepEqual(fns(ir.funcs[1].body), ["int.addSmall", "int.mulSmall"], "key's inputs are in [0, 11]");
  assert.deepEqual(fns(ir.funcs[3].body), ["int.mul"], "square's input is anything");
  assert.deepEqual(fns(ir.funcs[0].body).filter((f) => f.startsWith("int.add")), ["int.add", "int.add"], "main's n is anything");
  // wrap's remainder: its input is anything (a BigInt too), so it stays checked.
  assert.equal(ir.funcs[2].body.k, "attempt");
});

test("a count still growing round after round is no range", () => {
  // count(i) = if i < 10 then count(i + 1) * 2 else i
  const body: SExpr = { k: "if", cond: rt("int.less", loc(0), int(10)), then: rt("int.mul", { k: "call", fn: 1, args: [rt("int.add", loc(0), int(1))], tail: false }, int(2)), else: loc(0), t: "int" };
  const ir = { funcs: [fn("main", 0, call(1, int(0))), fn("count", 1, body)] } as unknown as CoreIR;
  intRanges(ir, new Set([0]));
  assert.ok(!fns(ir.funcs[1].body).some((f) => f.endsWith("Small")), "doubling grows past any bound");
});
