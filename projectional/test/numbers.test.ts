import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { get } from "../src/model.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { relate } from "../src/lang/relate.ts";
import { choose, represent, type Representation } from "../src/lang/represent.ts";
import { equal, makeRunner, runMain, type Data, type Value } from "../src/lang/run.ts";
import { showType } from "../src/lang/types.ts";

const dir = join(root, "examples/numbers");
const p = loadProgram(dir);
const names = p.pres.names;
const info = infer(p.code, names);
const reps: Representation[] = JSON.parse(readFileSync(join(dir, "representations.json"), "utf8"));
const [unary, binary, int] = reps;
const variant = (n: string) => Object.keys(names).find((k) => names[k] === n && p.code.nodes[k]?.kind === "variant")!;
const [ZERO, SUCC, EMPTY, EVEN, ODD] = ["zero", "succ", "empty", "even", "odd"].map(variant);

const r = makeRunner(p.code, info, { print: () => {} });
const call = (def: string, ...args: Value[]) => { for (const v of r.call(r.value(p.named(def)), ...args)) return v; throw new Error("no result"); };
const peano = (n: number): Data => (n === 0 ? { tag: ZERO, fields: [] } : { tag: SUCC, fields: [peano(n - 1)] });
const bits = (n: number): Data => (n === 0 ? { tag: EMPTY, fields: [] } : { tag: n % 2 ? ODD : EVEN, fields: [bits(Math.floor(n / 2))] });
const canonical = (b: Value): boolean => { const d = b as Data; return d.tag === EMPTY || (!(d.tag === EVEN && (d.fields[0] as Data).tag === EMPTY) && canonical(d.fields[0])); };
const printed = (code: typeof p.code, i: typeof info, def: string) => { const lines: string[] = []; runMain(code, i, p.named(def), { print: (s) => lines.push(s) }); return lines; };

test("the program and its representation check, with the types you'd expect", () => {
  assert.deepEqual(info.errors, []);
  assert.equal(showType(info.typeOf.get(p.named("factorial"))!, names), "(Nat) -> Nat");
  assert.equal(showType(info.typeOf.get(p.named("meaning"))!, names), "(Binary) -> Nat");
  // Both of Nat's eliminators, on Binary, are total.
  for (const d of ["match Nat′", "fold Nat′", "add′", "multiply′"]) assert.ok(!info.divergent.has(p.named(d)), d);
});

test("every implementation agrees with the definition it replaces, through meaning", () => {
  const means = (b: Value, n: Value) => assert.ok(equal(call("meaning", b), n));
  for (let a = 0; a <= 9; a++) {
    means(bits(a), peano(a));
    means(call("succ′", bits(a)), peano(a + 1));
    assert.equal(call("number′", bits(a)), call("number", peano(a)));
    for (let b = 0; b <= 9; b++) {
      for (const [spec, impl] of [["add", "add′"], ["multiply", "multiply′"]]) {
        const got = call(impl, bits(a), bits(b));
        means(got, call(spec, peano(a), peano(b)));
        assert.ok(canonical(got), `${impl}(${a}, ${b}) has a leading zero`);
      }
    }
  }
});

test("match and fold on Nat, done on Binary, see the same cases as on Nat", () => {
  // fold n (zero → [], succ(m) with r → cons(m, r)) lists the predecessors.
  const nums = (n: Value) => call("number′", n);
  for (let n = 0; n <= 12; n++) {
    const seen: number[] = [];
    const out = call("fold Nat′", bits(n), () => [0], (m: Value, acc: Value) => (seen.push(nums(m) as number), [(acc as number) + 1]));
    assert.equal(out, n);
    assert.deepEqual(seen, Array.from({ length: n }, (_, i) => i));
    const which = call("match Nat′", bits(n), () => ["zero"], (m: Value) => [nums(m)]);
    assert.equal(which, n === 0 ? "zero" : n - 1);
  }
});

test("the chooser picks Int for main, and represent onto binary gives the same answers", () => {
  const c = choose(p.code, p.named("main"), reps);
  assert.equal(c.rep.name, "int");
  assert.ok(c.jobs.includes("fold") && c.jobs.includes(p.named("multiply")));
  assert.equal(represent(p.code, [p.named("main")], unary), p.code);

  const bin = represent(p.code, [p.named("main"), p.named("small")], binary);
  const bi = infer(bin, names);
  assert.deepEqual(bi.errors, []);
  assert.equal(showType(bi.typeOf.get(p.named("factorial"))!, names), "(Binary) -> Binary");
  assert.deepEqual(printed(bin, bi, "small"), printed(p.code, info, "small"));
  assert.deepEqual(printed(bin, bi, "main"), ["18! = 6402373705728000", "2^50 = 1125899906842624", "100 is even: yes"]);
});

// Nat stored as an Int (NUMBERS.md, "Folds run the way their value is
// stored"): the program still says zero and succ; fold Nat (Int) folds over
// range(n), so compiled it is a counted loop.
test("Nat as an Int: every job agrees with Nat through natural, and folds see the same cases", () => {
  for (const d of ["natural", "match Nat (Int)", "fold Nat (Int)"]) assert.ok(!info.divergent.has(p.named(d)), d);
  const means = (i: Value, n: Value) => assert.ok(equal(call("natural", i), n));
  for (let a = 0; a <= 9; a++) {
    means(a, peano(a));
    means(call("succ (Int)", a), peano(a + 1));
    assert.equal(call("number (Int)", a), call("number", peano(a)));
    for (let b = 0; b <= 9; b++) {
      means(a + b, call("add", peano(a), peano(b)));
      means(a * b, call("multiply", peano(a), peano(b)));
    }
    const seen: number[] = [];
    assert.equal(call("fold Nat (Int)", a, () => [0], (m: Value, acc: Value) => (seen.push(m as number), [(acc as number) + 1])), a);
    assert.deepEqual(seen, Array.from({ length: a }, (_, i) => i));
    assert.equal(call("match Nat (Int)", a, () => ["zero"], (m: Value) => [m]), a === 0 ? "zero" : a - 1);
  }
  const ints = represent(p.code, [p.named("main"), p.named("small")], int);
  const ii = infer(ints, names);
  assert.deepEqual(ii.errors, []);
  assert.equal(showType(ii.typeOf.get(p.named("factorial"))!, names), "(Int) -> Int");
  assert.deepEqual(printed(ints, ii, "small"), printed(p.code, info, "small"));
  assert.deepEqual(printed(ints, ii, "main"), ["18! = 6402373705728000", "2^50 = 1125899906842624", "100 is even: yes"]);
});

test("meaning run backwards encodes: the canonical spelling first, then the ones with leading zeros", () => {
  const [b] = get(p.code, get(p.code, p.named("meaning"), "def").body!, "lambda").params;
  const answers: Value[] = [];
  for (const a of relate(p.code, p.named("meaning"), { out: peano(6) })) {
    answers.push(a.values[b] as unknown as Value);
    if (answers.length === 3) break;
  }
  const spelled = answers.map((a) => JSON.stringify(a).replace(/[0-9a-f]{8}/g, (m) => names[m] ?? m));
  assert.ok(spelled[0].includes("even") && canonical(toData(answers[0])), spelled[0]);
  assert.ok(!canonical(toData(answers[1])));
});

// relate's answers are terms; turn one back into a value.
function toData(t: unknown): Data {
  const x = t as { tag?: string; fields?: unknown[]; k?: string; name?: string; args?: unknown[] };
  if (x.tag) return { tag: x.tag, fields: x.fields!.map(toData) };
  throw new Error(`not data: ${JSON.stringify(t)}`);
}
