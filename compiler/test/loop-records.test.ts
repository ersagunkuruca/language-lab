// A record a loop carries is passed as its fields (C68a, loop-records.ts):
// wc's counts, made afresh for every character, are four values in the
// loop and one record only when it ends. That every example whose main
// lowers still agrees with the evaluator is core-js.test.ts's, and on
// WebAssembly and C the targets' own sweeps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { lowerCore } from "../src/core-js.ts";
import { kids, type SExpr } from "../src/scalar.ts";

test("a loop's record goes round as its fields (C68a)", () => {
  const p = load("wc"), main = p.named("main");
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
  const at = ir.funcs.findIndex((f) => f.name === "count.fold.characters.loop");
  assert.ok(at >= 0, ir.funcs.map((f) => f.name).join(", "));
  const loop = ir.funcs[at];
  // No round's call is given a record, and the counts are made once, at the end.
  const makes: SExpr[] = [];
  const walk = (e: SExpr, inRound: boolean) => {
    if (e.k === "make") makes.push(e);
    if (e.k === "make" && inRound) assert.fail("a round is given a record");
    kids(e).forEach((x) => walk(x, inRound || (e.k === "call" && e.fn === at)));
  };
  walk(loop.body, false);
  assert.equal(makes.length, 1);
  assert.ok(loop.params.length > ir.funcs.find((f) => f.name === "count.fold.characters")!.params.length);
});

// C236 (GAPS round 19 S2): a record every round passes on as it is, and
// that is used whole too, stays one. scan's `dfa longest` gives its Dfa to
// `dfa next` for each character; split into fields, the Dfa was made again
// for that call every round.
test("a record a loop passes on unchanged isn't made again each round (C236)", async () => {
  const { program } = await import("../gaps/scan.ts");
  const p = program();
  const ir = lowerCore(p.code, p.info, p.names, [p.main]);
  const loops = ir.funcs.filter((f) => /^dfa (longest|found from)/.test(f.name));
  assert.ok(loops.length >= 2, ir.funcs.map((f) => f.name).join(", "));
  const makes = (e: SExpr): number => (e.k === "make" && e.t.fields.length === 5 ? 1 : 0) + kids(e).reduce((n, x) => n + makes(x), 0);
  for (const f of loops) assert.equal(makes(f.body), 0, f.name);
});
