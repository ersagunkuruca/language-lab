// A pool's systems told which shapes of item they touch (G4,
// pool-shapes.ts): the greenhouse's Things are moths, plants and lamps,
// and its systems each touch one or two of them. Told so, its pool is
// kept as a table per shape (map-tree.ts "tables"). That the program
// prints the same is the sweeps'.

import { test } from "node:test";
import assert from "node:assert/strict";
import { poolShapes } from "../src/pool-shapes.ts";
import { represented } from "../../ters/cli/represented.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { load } from "../src/program.ts";

test("the greenhouse's systems are told the shapes they touch (G4)", () => {
  const p = load("../../compiler/gaps/greenhouse");
  const r = poolShapes(p.code, p.info, p.pres.names, p.own.defs, { ...(p.options as object), units: false });
  assert.ok(r, "told");
  assert.ok(r.made.some((d) => r.names[d] === "Thing shape") && r.made.some((d) => r.names[d] === "Thing pool shape"));
  // Thing's parts: each call leaves some shape out, an update that keeps
  // every shape needs no move, and `empty pool` is made knowing the shape.
  const kinds = new Set(r.told.map((c) => c.kind));
  for (const k of ["updated", "kept", "items", "empty"] as const) assert.ok(kinds.has(k), `${k}: ${JSON.stringify(r.told)}`);
  assert.ok(r.told.filter((c) => c.kind === "updated").every((c) => c.alike), JSON.stringify(r.told));
  // Three Optional parts, so eight shapes; a system touching one part
  // (a moth's flight) is told the four that have it.
  assert.ok(r.told.filter((c) => c.kind !== "empty").every((c) => c.shapes.length === 4), JSON.stringify(r.told));
  // The moths kept from the pool's items by whether they have a velocity,
  // told the shapes that have one: all kept, so no keep is left.
  assert.ok(r.told.some((c) => c.kind === "items" && c.all), JSON.stringify(r.told));
  assert.deepEqual(r.info.errors, p.info.errors);
});

test("the greenhouse's pool is stored as tables, a program with no shaped call as slots", () => {
  const p = load("../../compiler/gaps/greenhouse"), main = p.named("main");
  const reps = representationsIn(p.code, p.info, p.pres.names, p.own.defs);
  const prog = { title: "greenhouse", code: p.code, own: p.own.defs, names: p.pres.names, info: p.info, reps, options: p.options };
  const r = represented(prog, main, true);
  assert.ok(r.chosen?.some((c) => /Pool as tables/.test(c)), (r.chosen ?? []).join("\n"));
  process.env.NO_POOL_SHAPES = "1";
  try {
    const s = represented(prog, main, true);
    assert.ok(s.chosen?.some((c) => /Pool as slots/.test(c)), (s.chosen ?? []).join("\n"));
  } finally { delete process.env.NO_POOL_SHAPES; }
});
