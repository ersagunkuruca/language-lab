// Values given to the values' worker are sent flat (editor/flatValues.ts,
// I356): a list thousands of cells deep crossed postMessage's copy as it
// was and overflowed the stack, taking the editor down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { flatten, unflatten } from "../../editor/flatValues.ts";
import type { Value } from "../src/lang/run.ts";

const cons = (n: number): Value => { let v: Value = { tag: "nil", fields: [] }; for (let i = n - 1; i >= 0; i--) v = { tag: "cons", fields: [i, v] }; return v; };

test("a list 200,000 cells deep is sent and read back whole", () => {
  const f = flatten([cons(200_000), "x", 3n])!;
  assert.ok(f, "plain data flattens");
  const [list, x, b] = unflatten(structuredClone(f));
  let n = 0;
  for (let v = list as { tag: string; fields: Value[] }; v.tag === "cons"; v = v.fields[1] as typeof v) assert.equal(v.fields[0], n++);
  assert.equal(n, 200_000);
  assert.equal(x, "x");
  assert.equal(b, 3n);
});

test("shared data stays shared, and what isn't plain data isn't sent", () => {
  const leaf: Value = { tag: "pair", fields: [1, "a"] };
  const [both] = unflatten(flatten([{ tag: "two", fields: [leaf, leaf] }])!) as { fields: Value[] }[];
  assert.equal(both.fields[0], both.fields[1]);
  assert.deepEqual(both.fields[0], leaf);
  assert.equal(flatten([{ tag: "f", fields: [() => []] }]), null);
  assert.equal(flatten([[1, 2] as unknown as Value]), null);
});
