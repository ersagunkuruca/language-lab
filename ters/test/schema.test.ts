// L178b: every node attribute is classified once (model.ts SCHEMA, which
// the type makes complete), children() reads it, and the hash reads every
// attribute that is part of the meaning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA, children, type Node } from "../src/model.ts";
import { LIBRARY } from "../src/lang/library.ts";

test("every attribute the library's nodes carry is in the schema", () => {
  const unknown = new Set<string>();
  for (const n of Object.values(LIBRARY.code.nodes) as Node[]) {
    const slots = SCHEMA[n.kind] as Record<string, string> | undefined;
    if (!slots) { unknown.add(n.kind); continue; }
    for (const a of Object.keys(n)) if (a !== "id" && a !== "kind" && !(a in slots)) unknown.add(`${n.kind}.${a}`);
  }
  assert.deepEqual([...unknown], []);
});

test("the hash reads every attribute that is part of the meaning", () => {
  const src = readFileSync(join(import.meta.dirname, "../src/hash.ts"), "utf8");
  const missing = Object.entries(SCHEMA).flatMap(([kind, slots]) =>
    Object.entries(slots as Record<string, string>).filter(([a, s]) => s === "meaning" && !new RegExp(`\\.${a}\\b`).test(src)).map(([a]) => `${kind}.${a}`));
  assert.deepEqual(missing, []);
});

test("children come in the order of the schema's child slots", () => {
  assert.deepEqual(children({ id: "a", kind: "arm", variant: "v", value: "k", binds: ["b"], results: [null, "r"], body: "x" }), ["k", "b", "r", "x"]);
  assert.deepEqual(children({ id: "u", kind: "call", fn: "f", given: { 0: "g" }, binds: { 1: "b" }, body: "x" }), ["f", "g", "b", "x"]);
  assert.deepEqual(children({ id: "c", kind: "call", fn: "f", args: ["a", "b"] }), ["f", "a", "b"]);
});
