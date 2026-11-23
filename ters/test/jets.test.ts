// The library's host ways (library/hosts.ts, L206; BACKLOG L118): a
// library definition the evaluator runs natively must give the same bits
// as the definition itself, and its name must still be a definition of
// the library's, or the host way silently stops.

import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY } from "../src/lang/library.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions, loadProgram } from "../src/lang/load.ts";
import { Lang } from "../src/lang/dsl.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { LIBRARY_HOSTS } from "../library/hosts.ts";
import { neighbourLists, neighbourListsByTree, neighboursFound } from "../library/near.ts";
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
  const p = loadProgram(join(import.meta.dirname, "../examples/spacetime"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const id = (n: string) => p.code.defs.find((d) => p.pres.names[d] === n)!;
  const path = (libraryHosts: boolean) => {
    const r = makeRunner(p.code, info, { print: () => {}, names: p.pres.names, libraryHosts });
    const F = first(r.call(r.value(id("field")), 0, 0.5, 0, 0, 0, 1) as Iterable<Value>)!;
    return JSON.stringify(first(r.call(r.value(id("motion")), F, 25, 0.06) as Iterable<Value>));
  };
  assert.equal(path(true), path(false));
});

test("table product's host way gives the definition's bits on random multivectors, and hands back what it doesn't take", () => {
  const p = loadProgram(join(import.meta.dirname, "../examples/constructions"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
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

test("item at, put entry and entries have: their host ways give the definitions' answers, and hand back what they don't take (I195)", () => {
  const p = loadProgram(join(import.meta.dirname, "../examples/agent"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const both = [true, false].map((libraryHosts) => makeRunner(p.code, info, { print: () => {}, names: p.pres.names, libraryHosts }));
  const lib = (n: string) => Object.keys(LIBRARY.names).find((d) => LIBRARY.code.defs.includes(d) && LIBRARY.names[d] === n)!;
  const list = (xs: Value[]): Value => xs.reduceRight<Value>((t, x) => ({ tag: "std.list.cons", fields: [x, t] }), { tag: "std.list.nil", fields: [] });
  const pair = (a: Value, b: Value): Value => ({ tag: "std.tuple2.tuple", fields: [a, b] });
  const call = (n: string, ...xs: Value[]) => both.map((r) => JSON.stringify(first(r.call(r.value(lib(n)), ...xs) as Iterable<Value>)));
  let seed = 7;
  const rand = (k: number) => (seed = (seed * 16807) % 2147483647) % k;
  for (let t = 0; t < 40; t++) {
    const key = (): Value => (t % 2 ? pair(rand(4), rand(4)) : rand(12) - 3);
    const keys = [...new Map(Array.from({ length: rand(8) }, () => { const k = key(); return [JSON.stringify(k), k] as const; })).values()];
    const sorted = keys.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    // Kept sorted by the definitions themselves, then asked of.
    let m: Value = list([]);
    for (const k of sorted) m = first(both[1].call(both[1].value(lib("put entry")), m, k, rand(100)) as Iterable<Value>)!;
    const k = key();
    const [fast, slow] = call("put entry", m, k, -1);
    assert.equal(fast, slow, `put entry ${t}`);
    const [hasFast, hasSlow] = call("entries have", m, k);
    assert.equal(hasFast, hasSlow, `entries have ${t}`);
    const [atFast, atSlow] = call("item at", list([1, 2, 3, 4]), rand(7) - 2, 0);
    assert.equal(atFast, atSlow, `item at ${t}`);
  }
  // One list asked again and again (its items kept beside it, L281i):
  // every position, a fraction, before and past the end.
  const kept = list([5, 6, 7, 8, 9]);
  for (const at of [0, 4, 2, -1, 5, 9, 1.5, 3, 0.25, -0.5]) {
    const [atFast, atSlow] = call("item at", kept, at, 0);
    assert.equal(atFast, atSlow, `item at ${at}`);
  }
  // A key of text isn't the host way's: the definition runs.
  let called = false;
  first(LIBRARY_HOSTS["put entry"](() => { called = true; return []; })(list([pair("a", 1)]), "b", 2));
  assert.ok(called);
});

test("neighbours on a grid gives the definition's lists: on a line, in the plane and in space, ties at reach included (L280g)", () => {
  const lib = (n: string) => Object.keys(LIBRARY.names).find((d) => LIBRARY.code.defs.includes(d) && LIBRARY.names[d] === n)!;
  // A program that names both, so they are loaded.
  const k = new Lang(LIBRARY.code);
  const place = k.def("place");
  k.define(place, k.fn(["x"], (x) => x));
  k.define(k.def("uses"), k.call(lib("neighbours"), k.list(k.lit(0)), place, k.lit(1)));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const both = [true, false].map((libraryHosts) => makeRunner(code, info, { print: () => {}, names, libraryHosts }));
  const list = (xs: Value[]): Value => xs.reduceRight<Value>((t, x) => ({ tag: "std.list.cons", fields: [x, t] }), { tag: "std.list.nil", fields: [] });
  const call = (items: Value, place: string, reach: number) => both.map((r) => JSON.stringify(first(r.call(r.value(lib("neighbours")), items, r.value(place), reach) as Iterable<Value>)));
  let seed = 11;
  const rand = (k: number) => (seed = (seed * 16807) % 2147483647) % k;
  for (let t = 0; t < 30; t++) {
    const dims = 1 + (t % 3), n = rand(60);
    // Whole numbers often lie exactly reach apart (3, 4 and 5); scaled, at
    // places a division by the cell rounds.
    const scale = t % 2 ? 1 : 0.1 + rand(1000) / 997;
    const at = () => Array.from({ length: dims }, () => (rand(41) - 20) * scale);
    const places = Array.from({ length: n }, () => (dims === 1 && t % 4 === 0 ? at()[0] : { tag: "spot", fields: at() }));
    const reach = (1 + rand(8)) * scale;
    const [fast, slow] = call(list(places), place, reach);
    assert.equal(fast, slow, `neighbours ${t}`);
  }
  // A reach that isn't positive, or places of different lengths: the definition.
  for (const [places, reach] of [[[1, 2], 0], [[1, 2], -1], [[{ tag: "spot", fields: [0, 0] }, { tag: "spot", fields: [0] }], 1]] as [Value[], number][]) {
    let called = false;
    first(LIBRARY_HOSTS["neighbours"](() => { called = true; return []; })(list(places), (x: Value) => [x], reach));
    assert.ok(called);
  }
});

test("neighbours by a k-d tree, in any number of parts, and on grids of any cell size give every pair's lists (L280g, near.ts)", () => {
  let seed = 17;
  const rand = (k: number) => (seed = (seed * 16807) % 2147483647) % k;
  const pairs = (ps: number[][], reach: number) => ps.map((a, i) => ps.flatMap((b, j) => { let s = (a[0] - b[0]) * (a[0] - b[0]); for (let p = 1; p < a.length; p++) s = s + (a[p] - b[p]) * (a[p] - b[p]); return j !== i && !(reach * reach < s) ? [j] : []; }));
  for (let t = 0; t < 50; t++) {
    const dims = 1 + (t % 5), n = rand(150), scale = t % 2 ? 1 : 0.1 + rand(1000) / 997;
    // Clustered half the time: most places near a few centres.
    const centres = Array.from({ length: 1 + rand(4) }, () => Array.from({ length: dims }, () => (rand(201) - 100) * scale));
    const ps = Array.from({ length: n }, () => (t % 4 < 2 ? Array.from({ length: dims }, () => (rand(41) - 20) * scale) : centres[rand(centres.length)].map((c) => c + (rand(9) - 4) * scale)));
    const reach = (1 + rand(8)) * scale, want = pairs(ps, reach);
    assert.deepEqual(neighbourListsByTree(ps, reach), want, `tree ${t}`);
    // Past 3 parts the grid can't take them, and the tree is asked.
    for (const side of [reach, reach / 3, reach * 2.5]) assert.deepEqual(neighbourLists(ps, reach, side), dims > 3 && n ? null : want, `grid of ${side} ${t}`);
    assert.deepEqual(neighboursFound(ps, reach), want, `found ${t}`);
  }
});
