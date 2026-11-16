// The library's bodies typed one definition at a time (I313, infer.ts
// libraryLater): a program is checked over the library's skeleton, and a
// node inside a library body is typed when first asked for, its body alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { subtree, type Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { bodiesTyped, forgetLibraryChecks, infer, typedBodies, type Info } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { S } from "../src/lang/std.ts";
import { shownIn, type Type } from "../src/lang/types.ts";

const lib = LIBRARY.code, names = LIBRARY.names;
const pinned = lib.defs.filter((d) => checkOptions.pins![d]);

// A program on the library, checked over a library check of its own.
function onLibrary(): Info {
  const k = new Lang(lib);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.lit("hi"))));
  forgetLibraryChecks();
  const info = infer(base(k.code), baseNames(k.names), undefined, checkOptions);
  assert.deepEqual(info.errors, []);
  assert.ok(info.layer && !bodiesTyped(info.layer));
  return info;
}
// A body's first node inside its definition.
const inside = (d: Id) => subtree(lib, d).find((id) => id !== d)!;

test("each library body typed alone has the types the whole check gives it", () => {
  const whole = infer(lib, names, undefined, checkOptions);
  const info = onLibrary(), layer = info.layer!;
  const shownWhole = shownIn(whole.subst);
  // Every fourth, in an order of their own: each typed when its node is
  // asked, with the bodies typed before.
  const some = pinned.filter((_, i) => i % 4 === 0).reverse();
  const vars = (v: unknown) => JSON.stringify(v ?? null, (k, x) => ((k === "v" || k === "tail") && typeof x === "number" ? 0 : x));
  let nodes = 0;
  for (const d of some) {
    // Typed, then shown as the program's types show it (its rows inside
    // others read when shown, so after).
    layer.typeOf.get(inside(d));
    const shown = shownIn(info.subst);
    for (const id of subtree(lib, d)) {
      if (id === d) continue;
      nodes++;
      const a = whole.typeOf.get(id), b = layer.typeOf.get(id);
      assert.equal(b && shown(b, names), a && shownWhole(a, names), `${names[d]}: ${id}`);
      for (const k of ["opAt", "solveAt", "reshape", "copyOf", "embedded", "holes"] as const) assert.equal(vars(layer[k]?.get(id)), vars(whole[k]?.get(id)), `${names[d]}: ${k} of ${id}`);
      for (const k of ["answered", "spread"] as const) assert.equal(!!layer[k]?.has(id), !!whole[k]?.has(id), `${names[d]}: ${k} of ${id}`);
    }
  }
  assert.ok(nodes > 5000, `${nodes} nodes compared`);
});

test("a library body's types are the same whatever was typed first", () => {
  // Kept across runs from them (arith.ts, the library's resolving), they
  // are read in a run that typed other bodies first.
  const [a, b] = [pinned[3], pinned[pinned.length - 3]];
  const typesOf = (order: Id[]): Map<Id, Type | undefined> => {
    const layer = onLibrary().layer!;
    for (const d of order) layer.typeOf.get(inside(d));
    return new Map(subtree(lib, b).map((id) => [id, layer.typeOf.get(id)]));
  };
  assert.deepEqual(typesOf([a, b]), typesOf([b, a]));
});

test("asking a node of one library body types that body only", () => {
  const layer = onLibrary().layer!;
  assert.ok(layer.typeOf.get(inside(pinned[10])));
  assert.equal(typedBodies(layer).size, 1);
  assert.ok(layer.typeOf.get(inside(pinned[20])));
  assert.equal(typedBodies(layer).size, 2);
  // Asked for all of a fact, every body is typed.
  assert.equal(typeof layer.typeOf.size, "number");
  assert.equal(typedBodies(layer).size, pinned.length);
});
