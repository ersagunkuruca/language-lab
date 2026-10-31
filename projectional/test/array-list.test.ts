// Lists stored as arrays (REPRESENTATIONS.md step 5, BACKLOG L117): the
// trees module publishes `array of List`, a representation of List at
// Array written in the language. Its row says its costs and that a cons's
// rest is hidden, and each job agrees with List's own through the meaning.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY, TREES } from "../src/lang/library.ts";
import { ARRAY_OPS, CONS, LIST, NIL, SHOW_ANY } from "../src/lang/std.ts";
import { ARRAY } from "../src/lang/types.ts";
import { merge, type Id } from "../src/model.ts";

test("array of List: its row, and its jobs agree with List's through items of array", () => {
  const rep = LIBRARY.reps.find((r) => r.name === "array of List")!;
  assert.ok(rep, "the trees module publishes it");
  assert.equal(rep.of, LIST);
  assert.equal(rep.type, ARRAY);
  assert.equal(rep.meaning, ARRAY_OPS.items);
  assert.equal(rep.canonical, true);
  assert.deepEqual(rep.hidden, { [CONS]: [1] });
  const lib = (n: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === n)!;
  assert.deepEqual(rep.cost, { space: "n", [NIL]: "1", [CONS]: "n", match: "n", fold: "n²", [lib("length")]: "1", [lib("append")]: "n" });
  // The library's chooser stores only non-canonical rows by itself (C47):
  // this one waits for the compiler's lists as arrays (C30d).
  assert.equal(LIBRARY.reps.filter((r) => r.byType).some((r) => r === rep), false);

  const all = merge(LIBRARY.code, TREES.code);
  const k = new Lang(all);
  const tree = (n: string) => TREES.code.defs.find((d) => TREES.names[d] === n)!;
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const nums = (...xs: number[]) => k.list(...xs.map((x) => k.lit(x)));
  const arr = (...xs: number[]) => k.call(ARRAY_OPS.of, nums(...xs));
  const items = (a: Id) => k.call(ARRAY_OPS.items, a);
  const names: string[] = [];
  const show = (name: string, x: () => Id) => { names.push(`the ${name}`); def(`the ${name}`, () => k.call(SHOW_ANY, x())); };
  show("nil", () => items(k.x(tree("array nil"))));
  show("cons", () => items(k.call(tree("array cons"), k.lit(1), arr(2, 3))));
  show("match", () => k.call(tree("array match"), arr(1, 2, 3), k.thunk(() => k.call(CONS, k.lit(0), k.x(NIL))), k.fn(["x", "rest"], (x, rest) => k.call(CONS, x, items(rest)))));
  show("match empty", () => k.call(tree("array match"), arr(), k.thunk(() => k.call(CONS, k.lit(0), k.x(NIL))), k.fn(["x", "rest"], (x, rest) => k.call(CONS, x, items(rest)))));
  // The fold gives each arm its item, its rest and the rest's answer.
  show("fold", () => k.call(tree("array fold"), arr(1, 2, 3), k.thunk(() => k.x(NIL)), k.fn(["x", "rest", "r"], (x, rest, r) => k.call(CONS, k.call(lib("length"), items(rest)), k.call(CONS, x, r)))));
  show("length", () => k.call(tree("array length of"), arr(4, 5, 6)));
  show("append", () => items(k.call(tree("array append"), arr(1, 2), arr(3))));
  const code = merge(base(TREES.code), k.code), nm = { ...baseNames(k.names), ...TREES.names };
  const info = infer(code, nm, undefined, { ...checkOptions, insiders: [...(checkOptions.insiders ?? []), ...TREES.code.defs] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const got = names.map((n) => r.value(code.defs.find((d) => nm[d] === n)!));
  assert.deepEqual(got, ["[]", "[1, 2, 3]", "[1, 2, 3]", "[0]", "[2, 1, 1, 2, 0, 3]", "3", "[1, 2, 3]"]);
});
