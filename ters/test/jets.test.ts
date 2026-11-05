// The library's host ways (library/hosts.ts, L206; BACKLOG L118): a
// library definition the evaluator runs natively must give the same bits
// as the definition itself, and its name must still be a definition of
// the library's, or the host way silently stops.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY } from "../src/lang/library.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { LIBRARY_HOSTS } from "../library/hosts.ts";
import { pureHosts } from "../src/lang/hosts.ts";
import { UNHOSTED } from "../src/lang/library.ts";

const TABLE_PRODUCT = Object.keys(LIBRARY.names).find((d) => LIBRARY.code.defs.includes(d) && LIBRARY.names[d] === "table product")!;

const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

test("each host way names one of the library's definitions", () => {
  assert.deepEqual(UNHOSTED, []);
  assert.equal(Object.keys(pureHosts).length, Object.keys(LIBRARY_HOSTS).length);
  for (const id of Object.keys(pureHosts)) assert.equal(LIBRARY.code.nodes[id]?.kind, "def", id);
  assert.equal(pureHosts[TABLE_PRODUCT], LIBRARY_HOSTS["table product"]);
});

test("table product's host way gives the definition's bits: Spacetime's charge path, Cl(1, 3)", () => {
  const p = loadProgram("examples/spacetime");
  const info = infer(p.code, p.pres.names);
  const id = (n: string) => p.code.defs.find((d) => p.pres.names[d] === n)!;
  const path = (libraryHosts: boolean) => {
    const r = makeRunner(p.code, info, { print: () => {}, names: p.pres.names, libraryHosts });
    const F = first(r.call(r.value(id("field")), 0, 0.5, 0, 0, 0, 1) as Iterable<Value>)!;
    return JSON.stringify(first(r.call(r.value(id("motion")), F, 25, 0.06) as Iterable<Value>));
  };
  assert.equal(path(true), path(false));
});

test("table product's host way gives the definition's bits on random multivectors, and hands back what it doesn't take", () => {
  const p = loadProgram("examples/constructions");
  const info = infer(p.code, p.pres.names);
  const algebra = p.code.defs.find((d) => p.pres.names[d] === "algebra")!;
  const both = [true, false].map((libraryHosts) => makeRunner(p.code, info, { print: () => {}, names: p.pres.names, libraryHosts }));
  // std's Algebra: its table is the list of `times` lines.
  const al = both[0].value(algebra) as { fields: Value[] };
  const table = al.fields.find((f) => ((f as { fields?: Value[] }).fields?.[0] as { fields?: Value[] })?.fields?.length === 3)!;
  const shape = (((table as { fields: Value[] }).fields[0] as { fields: Value[] }).fields[0]) as { tag: string; fields: number[] };
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 4 - 2;
  for (let t = 0; t < 8; t++) {
    const mv = (zeros: boolean) => ({ tag: shape.tag, fields: shape.fields.map((_, i) => (zeros && i % 3 === 0 ? 0 : rand())) });
    const a = mv(false), b = mv(t % 2 === 0);
    const [fast, slow] = both.map((r) => first(r.call(r.value(TABLE_PRODUCT), table, a, b) as Iterable<Value>));
    assert.deepEqual(fast, slow, `case ${t}`);
  }
  // A part that isn't a Float64 isn't the host way's: the definition runs.
  const odd = { tag: shape.tag, fields: shape.fields.map(() => "x" as unknown as number) };
  let called = false;
  const wrapped = LIBRARY_HOSTS["table product"](() => { called = true; return []; });
  first(wrapped(table, odd, odd));
  assert.ok(called);
});
