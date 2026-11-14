// A range made only to be walked (C228, GAPS round 17 D5): depot's
// `indices(c)`, `range(length(c.stations))`, made for each search of the
// stations. On the core IR's JavaScript the array is filled with no list
// made (rangeArrays, as on WebAssembly), and the searches, recursions
// inside `closest`, walk it by position with no view made a step
// (array-offsets.ts, now on a lambda's code too).

import { test } from "node:test";
import assert from "node:assert/strict";
import { kids, type SExpr } from "../src/scalar.ts";
import { lowerCore } from "../src/core-js.ts";
import { city, program, ways } from "../gaps/depot.ts";

test("depot's indices are filled with no list, and its searches walk them by position (C228)", async () => {
  const p = program();
  const ir = lowerCore(p.code, p.info, p.names, [p.main]);
  const all = (e: SExpr): SExpr[] => [e, ...kids(e).flatMap(all)];
  const indices = ir.funcs.find((f) => f.name === "indices")!;
  assert.ok(all(indices.body).some((e) => e.k === "rt" && /^array\.range\.a\d+$/.test(e.fn)), "indices fills its array");
  assert.ok(!all(indices.body).some((e) => e.k === "rt" && e.fn === "int.range"), "no list of the range");
  // Each loop of them, a function calling itself: the first step before
  // one may take a rest, once a search.
  const loops = ir.funcs.filter((f, i) => f.name.startsWith("closest·") && all(f.body).some((e) => e.k === "call" && e.fn === i));
  assert.ok(loops.length >= 2, loops.map((f) => f.name).join(", "));
  for (const f of loops) assert.ok(!all(f.body).some((e) => e.k === "rt" && /^array\.rest\./.test(e.fn)), `${f.name} takes no rest`);
  // And prints what the hand-written one does.
  const w = await ways(), files = { "d.txt": city(60) };
  assert.deepEqual(w.core(["d.txt"], files), w.ideal(["d.txt"], files));
});
