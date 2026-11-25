// The literals a pass reads the value of, not only its class (value-reads.ts):
// an edit of one is never taken as an edit within its class.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { B } from "../src/prelude.ts";
import { S } from "../src/lang/std.ts";
import { valueRead } from "../src/lang/value-reads.ts";
import { classKey } from "../src/lang/class-key.ts";
import { replace, type Code, type Id } from "../src/model.ts";

test("value-reads: a log's literal, one inside a divisor or a test's side, a slice's ends; not a plain divisor or input", () => {
  const k = new Lang(LIBRARY.code);
  const lits: Record<string, Id> = {};
  const lit = (name: string, v: number) => (lits[name] = k.lit(v));
  const logOf = k.def("log of"), plus = k.def("plus one"), main = k.def("main");
  k.define(logOf, k.lambda(["b"], (b) => k.call(B.log, b)));
  k.define(plus, k.lambda(["b"], (b) => k.call(B.add, b, lit("one in plus one", 1))));
  k.define(main, k.lambda(["x", "n"], (x, n) => k.seq(
    k.call(B.log, lit("logged", 2)),
    k.call(B.div, x, lit("divisor", 2)),
    k.call(B.div, x, k.call(B.sub, n, lit("in a divisor", 1))),
    k.if(k.call(S.equal, k.call(B.sub, n, lit("in a test", 1)), lit("tested against", 0)), x, x),
    k.call(logOf, lit("given to a log", 3)),
    k.call(plus, lit("given to a sum", 3)),
    k.call("builtin.text.slice", k.lit("abc"), lit("slice start", 0), lit("slice end", 1)),
  )));
  const read = valueRead(k.code);
  const got = Object.fromEntries(Object.entries(lits).map(([name, id]) => [name, read(id)]));
  assert.deepEqual(got, {
    "one in plus one": false,
    logged: true,
    divisor: false,
    "in a divisor": true,
    "in a test": true,
    "tested against": false,
    "given to a log": true,
    "given to a sum": false,
    "slice start": true,
    "slice end": true,
  });
  // The class key writes those by their value.
  const edit = (code: Code, id: Id, v: number) => replace(code, id, () => ({ ...code.nodes[id], value: v }) as never);
  assert.equal(classKey(edit(k.code, lits["given to a sum"], 4), null), classKey(k.code, null));
  assert.notEqual(classKey(edit(k.code, lits["given to a log"], 4), null), classKey(k.code, null));
});
