// `keep` over a List kept as an array, a loop pushing the kept items
// (G1b1, kept-items.ts): the greenhouse's `keep(items, is lamp)` with no
// list of the things taken apart, no list of answers reversed and no
// array made of it. (Its keep of the moths, every item told it has a
// velocity, is gone since G25a.) That every program prints the same is
// the sweeps'.

import { test } from "node:test";
import assert from "node:assert/strict";
import { represented } from "../../ters/cli/represented.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { load } from "../src/program.ts";
import { lowerCore } from "../src/core-js.ts";
import { kids, type SExpr } from "../src/scalar.ts";

const found = (e: SExpr, p: (e: SExpr) => boolean): boolean => p(e) || kids(e).some((k) => found(k, p));

test("keep over an array's items is a loop pushing the kept ones (G1b1)", () => {
  const p = load("../../compiler/gaps/greenhouse"), main = p.named("main");
  // Its Lists as arrays, as the compiler represents them.
  const r = represented({ title: "greenhouse", code: p.code, own: p.own.defs, names: p.pres.names, info: p.info, reps: representationsIn(p.code, p.info, p.pres.names, p.own.defs), options: p.options }, main, true);
  const ir = lowerCore(r.code, r.info, r.names, [main]);
  const loop = ir.funcs.find((f) => f.name === "keep·is lamp.value.kept");
  assert.ok(loop, ir.funcs.map((f) => f.name).join(", "));
  assert.ok(ir.funcs.some((f) => f.name === "keep·is lamp.value" && f.body.k === "call" && ir.funcs[f.body.fn] === loop), "keep calls its loop");
  assert.ok(found(loop.body, (e) => e.k === "rt" && /^array\.c?push\.a\d+$/.test(e.fn)), "the kept item pushed");
  assert.ok(found(loop.body, (e) => e.k === "rt" && /^array\.(get|cget\d+)\.a\d+$/.test(e.fn)), "the item read by position");
  assert.ok(!found(loop.body, (e) => e.k === "rt" && /^(array\.(items|of)\.a\d+|choose\.split)$/.test(e.fn)), "no list between");
});

// G1b2: the arrays those loops build, and `pool items` (the pool as
// slots), are columns that grow as they are pushed onto: the
// greenhouse's Things read by field, with no row per Thing.
test("arrays built by pushes are columns that grow (G1b2)", () => {
  const p = load("../../compiler/gaps/greenhouse"), main = p.named("main");
  const r = represented({ title: "greenhouse", code: p.code, own: p.own.defs, names: p.pres.names, info: p.info, reps: representationsIn(p.code, p.info, p.pres.names, p.own.defs), options: p.options }, main, true);
  const ir = lowerCore(r.code, r.info, r.names, [main]);
  const thing = ir.arrays.find((a) => typeof a.item === "object" && "name" in a.item && a.item.name === "Thing")!;
  const a = `.a${thing.index}`;
  // The loops making and reading them: columns only.
  // A loop carrying a record as its fields runs as its `.loop` (loop-records.ts).
  const ops = (name: string) => { const fs = ir.funcs.filter((g) => g.name === name || g.name === `${name}.loop`); assert.ok(fs.length, name); const fns: string[] = []; for (const f of fs) found(f.body, (e) => { if (e.k === "rt" && e.fn.endsWith(a)) fns.push(e.fn); return false; }); return fns; };
  for (const name of ["keep·is lamp.value.kept", "pool slots items from$from", "gathered$from"]) {
    const fns = ops(name);
    assert.ok(fns.length && fns.every((fn) => /^array\.c(push|get\d+|length|in|build)\./.test(fn)), `${name}: ${fns.join(", ")}`);
  }
  assert.ok(ops("pool slots items from$from").some((fn) => fn.startsWith("array.cpush")), "pool items pushed going down");
});
