import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { get, type Id, type NodeOf } from "../src/model.ts";
import { JOBS, STORE_AS } from "../src/lang/std.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { relate } from "../src/lang/relate.ts";
import { choose, jobProblem, pinsIn, represent, representationsIn, type Representation } from "../src/lang/represent.ts";
import { equal, makeRunner, runMain, type Data, type Value } from "../src/lang/run.ts";
import { showType } from "../src/lang/types.ts";

const dir = join(root, "examples/numbers");
const p = loadProgram(dir);
const names = p.pres.names;
const info = infer(p.code, names);
// Written in the program (REPRESENTATIONS.md, L108).
const reps = representationsIn(p.code, info, names, p.own.defs);
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

// The representations are definitions in the program (REPRESENTATIONS.md,
// L108a): each one's jobs, read back, say which definition does what, at
// what cost; and a job whose definition has the wrong type is refused.
test("the program writes its representations, and a job of the wrong type is refused", () => {
  assert.deepEqual(reps.map((r) => [r.name, names[r.type] ?? r.type, r.meaning && names[r.meaning]]), [["unary", "Nat", null], ["binary", "Binary", "meaning"], ["int", "Int", "natural"]]);
  assert.equal(names[binary.impl[SUCC]], "succ′");
  assert.equal(names[int.impl.match], "match Nat (Int)");
  assert.deepEqual([binary.cost[p.named("multiply")], unary.cost.fold, binary.cost.space], ["log² n", "n", "log n"]);
  const succJob = Object.values(p.code.nodes).find((n) => n.kind === "call" && (p.code.nodes[n.fn] as { target?: Id }).target === JOBS.job
    && (p.code.nodes[n.args[1]] as { target?: Id }).target === binary.impl[SUCC]) as NodeOf<"call">;
  const wrong = { ...p.code, nodes: { ...p.code.nodes, [succJob.args[1]]: { id: succJob.args[1], kind: "ref" as const, target: p.named("number′") } } };
  const errors = infer(wrong, names).errors.map((e) => e.message);
  assert.deepEqual(errors, ["this does (Nat) -> Nat's job at Binary, so its type is (Binary) -> Binary, not (Binary) -> Float64"]);
});

test("the chooser picks Int for main, and represent onto binary gives the same answers", () => {
  const c = choose(p.code, p.named("main"), reps);
  assert.equal(c.rep.name, "int");
  assert.ok(c.jobs.includes("fold") && c.jobs.includes(p.named("multiply")));
  assert.equal(represent(p.code, [p.named("main")], unary), p.code);

  // Each job does only what it replaces (test/containers.test.ts has one that doesn't).
  for (const r of reps) assert.equal(jobProblem(info, r, names), null, r.name);
  const bin = represent(p.code, [p.named("main"), p.named("small")], binary);
  const bi = infer(bin, names);
  assert.deepEqual(bi.errors, []);
  assert.equal(showType(bi.typeOf.get(p.named("factorial"))!, names), "(Binary) -> Binary");
  assert.deepEqual(printed(bin, bi, "small"), printed(p.code, info, "small"));
  assert.deepEqual(printed(bin, bi, "main"), ["18! = 6402373705728000", "2^50 = 1125899906842624", "100 is even: yes"]);
});

// A program pins a representation with a definition of its own (L108c):
// `nat storage = store as(binary)`. The chooser takes it as it is, and the
// checker takes only a representation's definition, one pin per type.
test("store as pins a representation: the chooser takes it, and only one per type", () => {
  const pinning = (code: typeof p.code, def: string, arg: Id) => {
    const [d, call, fn, a] = [`${def}:def`, `${def}:call`, `${def}:fn`, `${def}:arg`];
    return { ...code, defs: [...code.defs, d], nodes: { ...code.nodes,
      [d]: { id: d, kind: "def" as const, body: call },
      [call]: { id: call, kind: "call" as const, fn, args: [a] },
      [fn]: { id: fn, kind: "ref" as const, target: STORE_AS },
      [a]: { id: a, kind: "ref" as const, target: arg } } };
  };
  const one = pinning(p.code, "nat storage", binary.def!);
  const pn = { ...names, "nat storage:def": "nat storage", "again:def": "again" };
  const pi = infer(one, pn);
  assert.deepEqual(pi.errors, []);
  assert.equal(showType(pi.typeOf.get("nat storage:def")!, pn), "Storage Nat");
  const pins = pinsIn(one, representationsIn(one, pi, pn, [...p.own.defs, "nat storage:def"]), [...p.own.defs, "nat storage:def"]);
  const pin = pins.get(unary.of)!;
  assert.equal(pin.rep.name, "binary");
  const c = choose(one, p.named("main"), reps, pin);
  assert.deepEqual([c.rep.name, c.pinnedBy], ["binary", "nat storage:def"]);
  assert.equal(choose(one, p.named("main"), reps).rep.name, "int", "without the pin, the chooser's pick");
  // Twice for Nat, or something that isn't a representation's definition.
  assert.deepEqual(infer(pinning(one, "again", int.def!), pn).errors.map((e) => e.message), ["Nat is stored as one representation, and nat storage has pinned it already"]);
  assert.match(infer(pinning(p.code, "again", p.named("meaning")), pn).errors.map((e) => e.message).join("; "), /^store as needs Representation/);
  const alias = { ...p.code, defs: [...p.code.defs, "same:def"], nodes: { ...p.code.nodes, "same:def": { id: "same:def", kind: "def" as const, body: "same:ref" }, "same:ref": { id: "same:ref", kind: "ref" as const, target: int.def! } } };
  assert.deepEqual(infer(pinning(alias, "again", "same:def"), { ...pn, "same:def": "same" }).errors.map((e) => e.message), ["store as takes a representation by its definition's name"]);
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

test("a builtin type can be represented too: Float64 with every job rounded, as Float32 will be", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { S } = await import("../src/lang/std.ts");
  const { B } = await import("../src/prelude.ts");
  const { NUMBER } = await import("../src/lang/types.ts");
  const k = new Lang();
  const round = k.def("round");
  k.define(round, k.fn(["x"], (x) => k.call(S.float32, x)));
  const rounded = (op: Id, name: string) => {
    const d = k.def(name);
    k.define(d, k.fn(["a", "b"], (a, b) => k.call(S.float32, k.call(op, a, b))));
    return d;
  };
  const add32 = rounded(B.add, "add32"), mul32 = rounded(B.mul, "mul32"), div32 = rounded(B.div, "div32");
  const f = k.def("f");
  k.define(f, k.fn(["x"], (x) => k.call(B.add, k.call(B.mul, x, k.lit(0.1)), k.call(B.div, k.lit(1), k.lit(3)))));
  const code = base(k.code), names = baseNames(k.names);
  const rep: Representation = { name: "rounded", of: NUMBER, type: NUMBER, meaning: null, canonical: true, approximate: true, literal: round, impl: { [B.add]: add32, [B.mul]: mul32, [B.div]: div32 }, cost: {} };
  const spec: Representation = { name: "Float64", of: NUMBER, type: NUMBER, meaning: null, canonical: true, impl: {}, cost: {} };
  // Never picked by cost, though it costs the same.
  assert.equal(choose(code, f, [rep, spec]).rep.name, "Float64");
  const out = represent(code, [f], rep);
  const i = infer(out, names);
  assert.deepEqual(i.errors, []);
  const run = (c: typeof code, inf: typeof i, x: number) => { const rr = makeRunner(c, inf, { print: () => {} }); for (const v of rr.call(rr.value(f), x)) return v as number; };
  const fr = Math.fround;
  for (const x of [0.7, 3, 1e-3]) {
    assert.equal(run(out, i, x), fr(fr(x * fr(0.1)) + fr(fr(1) / fr(3))));
    assert.equal(run(code, infer(code, names), x), x * 0.1 + 1 / 3);
  }
});
