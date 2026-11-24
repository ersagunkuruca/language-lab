// Run backwards given a long list (I357): turning the known values into
// the search's terms, and asking whether one holds a function, went a JS
// call per item, and pond's seeded over with its 2304 keys overflowed the
// stack in the values' worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { fromValue } from "../src/lang/relate.ts";
import { CONS, NIL } from "../src/lang/std-ids.ts";
import { searchBackwards } from "../../editor/backSearch.ts";

const list = (n: number) => { let l: unknown = { tag: NIL, fields: [] }; for (let i = n - 1; i >= 0; i--) l = { tag: CONS, fields: [i, l] }; return l; };

test("a list 200,000 long becomes a term, items in order", () => {
  let t = fromValue(list(200000)) as { tag: string; fields: unknown[] }, n = 0;
  for (; t.tag === CONS; t = t.fields[1] as typeof t) assert.equal(t.fields[0], n++);
  assert.equal(n, 200000);
});

test("pond's seeded over runs backwards given 20,000 keys", () => {
  const p = loadProgram(join(root, "examples", "pond-page"));
  const info = infer(p.code, p.pres.names);
  const id = (name: string) => Object.entries(p.pres.names).find(([, n]) => n === name)![0];
  const values = { [id("patches")]: { tag: id("map of"), fields: [{ tag: NIL, fields: [] }] }, [id("ks")]: list(20000) };
  const until = Date.now() + 20000;
  const found = searchBackwards(p.code, id("seeded over"), values, p.pres.names, () => Date.now() > until, info);
  assert.equal(found.error, undefined);
  assert.ok(found.answers.length || found.cut);
});
