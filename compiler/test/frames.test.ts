// Which closures never leave the function that made them (C327b,
// frames.ts), read on hand-made lowered functions: given to a helper that
// only applies it, or to a map on the threads (which waits for them), a
// closure stays. Answered, put in a list, given to a helper that answers
// it or to the rest of the runtime, handed to the next turn of its maker's
// loop, or made of code that lets the closure itself out, it leaves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { frames } from "../src/frames.ts";
import type { DType, FType, LType, SExpr, SFunc } from "../src/scalar.ts";

const fnT: FType = { key: "fn i64 -> i64", params: ["i64"], result: "i64" };
const listT: DType = { key: "list of fn", name: "List", def: "list", cases: [{ variant: "empty", name: "empty", fields: [] }, { variant: "cons", name: "cons", fields: [{ name: "head", t: fnT }, { name: "tail", t: "i64" }] }] };
const local = (i: number): SExpr => ({ k: "local", i });
const one: SExpr = { k: "int", v: 1n };
const fn = (name: string, params: LType[], locals: LType[], result: LType, body: SExpr): SFunc =>
  ({ def: name, name, params, result, locals: [...params, ...locals], body, spends: false, budgeted: false });
const closure = (code: number): Extract<SExpr, { k: "closure" }> => ({ k: "closure", t: fnT, fn: code, shape: 0, caps: [one] });

test("a closure given to a helper that only applies it stays in its frame; one that is let out leaves", () => {
  const made: Record<string, SExpr> = {};
  const at = (name: string, e: Extract<SExpr, { k: "closure" }>) => (made[name] = e);
  const funcs: SFunc[] = [];
  // 0: apply(f, x) = f(x).
  funcs.push(fn("apply", [fnT, "i64"], [], "i64", { k: "apply", fn: local(0), t: fnT, args: [local(1)], tail: true, tmp: 2 }));
  funcs[0].locals.push(fnT);
  // 1: the code, adding what it captured.
  funcs.push(fn("code", [fnT, "i64"], [], "i64", { k: "op", op: "iadd", args: [local(1), { k: "cap", t: fnT, shape: 0, i: 0 }] }));
  // 2: applied by the helper: stays.
  funcs.push(fn("given", [], [fnT], "i64", { k: "let", i: 0, value: at("given", closure(1)), body: { k: "call", fn: 0, args: [local(0), one], tail: true } }));
  // 3: answered: leaves.
  funcs.push(fn("answered", [], [], fnT, at("answered", closure(1))));
  // 4: put in a list: leaves.
  funcs.push(fn("listed", [], [], listT, { k: "new", t: listT, c: 1, args: [at("listed", closure(1)), one] }));
  // 5: keep(f) = f; 6 gives it a closure: leaves through 5's summary.
  funcs.push(fn("keep", [fnT], [], fnT, local(0)));
  funcs.push(fn("kept", [], [], fnT, { k: "call", fn: 5, args: [at("kept", closure(1))], tail: false }));
  // 7: loop(n, f): a new closure each turn, handed to the next: leaves.
  funcs.push(fn("loop", ["i64", fnT], [], "i64", {
    k: "if", cond: { k: "op", op: "iless", args: [local(0), one] }, t: "i64",
    then: { k: "apply", fn: local(1), t: fnT, args: [local(0)], tail: true, tmp: 2 },
    else: { k: "call", fn: 7, args: [{ k: "op", op: "isub", args: [local(0), one] }, at("loop", closure(1))], tail: true },
  }));
  funcs[7].locals.push(fnT);
  // 8: code that answers the closure itself; 9 applies one: leaves.
  funcs.push(fn("self", [fnT, "i64"], [], fnT, local(0)));
  const selfT: FType = { key: "fn i64 -> self", params: ["i64"], result: fnT };
  funcs.push(fn("applied", [], [selfT], fnT, { k: "apply", fn: { k: "closure", t: selfT, fn: 8, shape: 0, caps: [] }, t: selfT, args: [one], tail: false, tmp: 0 }));
  made.applied = (funcs[9].body as Extract<SExpr, { k: "apply" }>).fn;
  // 10: given to the runtime: leaves.
  funcs.push(fn("runtime", [], [], "i64", { k: "rt", fn: "some.op", args: [at("runtime", closure(1))] }));
  // 11: given to a map on the threads, which waits for them: stays.
  funcs.push(fn("mapped", [], [], "i64", { k: "rt", fn: "par:map", args: [one, at("mapped", closure(1))] }));
  const r = frames(funcs);
  const stays = Object.entries(made).filter(([, e]) => r.closures.has(e)).map(([n]) => n);
  assert.deepEqual(stays, ["given", "mapped"]);
  assert.deepEqual(r.leaves[0], [false, false], "apply lets neither input out");
  assert.deepEqual(r.leaves[5], [true], "keep answers its input");
  assert.deepEqual(r.leaves[7], [false, false], "loop's own closure only goes round");
  assert.deepEqual(r.leaves[8], [true, false], "self answers its closure");
});
