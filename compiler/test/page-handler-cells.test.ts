// A page's handler that may not end (Break's frame, which plays events up
// to the time shown) takes the rest of the work as a continuation
// (scalar.ts `several`, a type key ending `!*`), though the Html it sits
// in holds the plain function type. zero-parts.ts didn't take it for one
// the runtime calls, so what it wrote to a cell went unseen, and a part of
// the cell's value that starts 0 was taken for always 0: the Break page
// moved every ball from time 0, not from the table's last event, so the
// balls it drew ran ahead of the simulation and off the cloth.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { lowerCore } from "../src/core-js.ts";
import { kids, type SExpr } from "../src/scalar.ts";

test("the Break page draws its balls moved from the table's time, which its frame handler writes", () => {
  const p = load("break-page");
  const main = p.code.defs.find((d) => p.pres.names[d] === "main")!;
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
  // table drawn(tb, t) moves the balls by t − tb.time: the subtraction stays.
  const drawn = ir.funcs.filter((f) => f.name === "table drawn");
  assert.ok(drawn.length > 0);
  // The table's time is its field 0, tb is input 0.
  const time = (e: SExpr): boolean => e.k === "get" && e.i === 0 && e.rec.k === "local" && e.rec.i === 0;
  const subs = (e: SExpr): number => (e.k === "op" && e.op === "sub" && time(e.args[1]) ? 1 : 0) + kids(e).reduce((n, x) => n + subs(x), 0);
  for (const f of drawn) assert.equal(subs(f.body), 1, "table drawn moves the balls from time 0");
});
