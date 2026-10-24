import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashDef } from "../src/hash.ts";
import { root } from "../src/io.ts";
import { get, replace, type Code, type Id, type NodeOf } from "../src/model.ts";
import { infer, fillings } from "../src/lang/infer.ts";
import { base, baseNames, loadProgram } from "../src/lang/load.ts";
import { addVariant, fillHole } from "../src/lang/refactor.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { runMain } from "../src/lang/run.ts";
import { showIn, showType } from "../src/lang/types.ts";
import { reId, sweep, sweepShare } from "./helpers.ts";

const load = (name: string) => loadProgram(join(root, "examples", name));
const run = (code: Code, info: ReturnType<typeof infer>, main: Id) => {
  const out: string[] = [];
  runMain(code, info, main, { print: (s) => out.push(s) });
  return out;
};
const typeOf = (p: ReturnType<typeof load>, info: ReturnType<typeof infer>, name: string) => showIn(info.typeOf.get(p.named(name))!, p.pres.names, info.subst);

test("queens: Choice does the search, handlers decide what the answer is", () => {
  const p = load("queens");
  const info = infer(p.code, p.pres.names);
  assert.deepEqual(info.errors, []);
  assert.equal(typeOf(p, info, "queens"), "(Number) -[Choice]-> List Number");
  assert.equal(typeOf(p, info, "keep"), "(List a, (a) -[Choice, e]-> Bool) -[e]-> List a");
  assert.equal(typeOf(p, info, "main"), "() -[Console]-> Unit");
  const out = run(p.code, info, p.named("main"));
  assert.equal(out[0], "first solution for 8: 3 1 6 2 5 7 4 0");
  assert.equal(out[1], "solutions for 8: 92");
  assert.equal(out.filter((l) => l.startsWith("  ")).length, 4);
  assert.equal(out.at(-1), "even numbers below 10: 0 2 4 6 8");
});

test("algebra: folds are total, Newton's method carries Diverge until fuel turns it into Choice", () => {
  const p = load("algebra");
  const info = infer(p.code, p.pres.names);
  assert.deepEqual(info.errors, []);
  assert.equal(typeOf(p, info, "derivative"), "(expression) -> expression");
  assert.equal(typeOf(p, info, "evaluate"), "(expression, Number) -[Choice]-> Number");
  assert.equal(typeOf(p, info, "for each"), "(List a, (a) -[e]-> b) -[e]-> Unit");
  assert.equal(typeOf(p, info, "newton"), "(expression, expression, Number) -[Choice, Diverge]-> Number");
  assert.equal(typeOf(p, info, "root near"), "(expression, Number) -[Choice]-> Number");
  const out = run(p.code, info, p.named("main"));
  assert.deepEqual(out.slice(0, 4), ["f(x)  = x·x − 2", "f′(x) = x + x", "f(2)  = 2", "root near 1: 1.414213562"]);
  assert.ok(out.includes("root near 1: none found"));
  assert.ok(out.includes("f(2)  = undefined"));
});

// Punch holes in a program, and fill each with every option the palette
// offers. None of them may cause an error: that's the claim that the editor
// can't make a type error, checked.
test("every filling the palette offers keeps the program free of errors", () => {
  let tried = 0;
  // queens is in test/palette.test.ts.
  for (const name of ["algebra"]) {
    const p = load(name);
    // Every third arm body and function body (all of them takes ~30s).
    const targets = Object.values(p.own.nodes).flatMap((n) => (n.kind === "arm" || n.kind === "lambda" ? [n.body] : [])).filter((_, i) => i % 3 === 0);
    for (const target of sweep(targets)) {
      const holed = replace(p.code, target, () => ({ kind: "hole" }));
      const info = infer(holed, p.pres.names);
      assert.deepEqual(info.errors, [], "a hole is not an error");
      const options = fillings(holed, info, target);
      assert.ok(options.length > 0, "something always fits");
      for (const f of options) {
        const filled = fillHole(holed, p.pres.names, target, f);
        const after = infer(filled.code, filled.names);
        assert.deepEqual(after.errors, [], `filling ${f.kind} ${"target" in f ? p.pres.names[f.target] : ""} broke ${name}`);
        tried++;
      }
    }
  }
  // All of it is over 1000. A slice is an eighth of the targets but not
  // of the fillings (some arms offer more), so it is held to 100.
  assert.ok(tried > (sweepShare === 1 ? 1000 : 100), `tried ${tried}`);
});

test("the palette leaves out what would be a type error, and the checker catches it if forced", () => {
  const p = load("algebra");
  const evaluate = get(p.code, p.code.nodes[p.named("evaluate")].kind === "def" ? (p.code.nodes[p.named("evaluate")] as NodeOf<"def">).body! : "", "lambda");
  const fold = get(p.code, evaluate.body, "fold");
  const sumArm = fold.arms.map((a) => get(p.code, a, "arm")).find((a) => p.pres.names[a.variant] === "sum")!;
  const holed = replace(p.code, sumArm.body, () => ({ kind: "hole" }));
  const info = infer(holed, p.pres.names);
  const offered = fillings(holed, info, sumArm.body).map((f) => ("target" in f ? p.pres.names[f.target] : f.kind));
  assert.ok(offered.includes("l′") && offered.includes("at") && offered.includes("add"));
  assert.ok(!offered.includes("display"), "display returns Text, not Number");
  assert.ok(!offered.includes("print"), "print returns Unit");
  const forced = fillHole(holed, p.pres.names, sumArm.body, { kind: "call", target: p.named("display"), arity: 1, type: info.holes.get(sumArm.body)!.expected });
  const errors = infer(forced.code, forced.names).errors;
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /expected Number, got Text/);
});

test("a case analysis is created with every case, and a new case reaches every analysis", () => {
  const p = load("algebra");
  const type = p.named("expression");
  const edit = addVariant(p.code, p.pres.names, type, "tangent", [{ name: "of", type: (get(p.code, get(p.code, type, "def").body!, "typedef").variants.map((v) => get(p.code, v, "variant")).find((v) => v.fields.length === 1 && p.pres.names[v.id] === "sine")!).fields.map((f) => get(p.code, f, "field").type)[0] }]);
  const info = infer(edit.code, edit.names);
  assert.deepEqual(info.errors, [], "no missing cases, only holes");
  // evaluate, derivative, simplify, display get a tangent arm; matches with
  // `otherwise` don't need one.
  assert.equal(info.holes.size, 4);
  for (const h of info.holes.values()) assert.ok(h.expected.t === "con");
  // The fold's new arm knows `of` is recursive, so it gets a folded value too.
  const arm = Object.values(edit.code.nodes).find((n) => n.kind === "arm" && n.variant === edit.variant && n.results[0]) as NodeOf<"arm">;
  assert.equal(edit.names[arm.results[0]!], "of′");

  // Without the gesture (adding the variant by hand), the checker says so.
  const raw = structuredClone(p.code);
  const tdId = get(raw, type, "def").body!;
  (raw.nodes[tdId] as NodeOf<"typedef">).variants.push(edit.variant);
  raw.nodes[edit.variant] = edit.code.nodes[edit.variant];
  const missing = infer(raw, edit.names).errors.filter((e) => /no case for tangent/.test(e.message));
  assert.equal(missing.length, 4);
});

test("effects: a definition's value must be pure, and run refuses unhandled Choice", () => {
  const p = load("algebra");
  const samples = get(p.code, p.named("samples"), "def");
  // samples = evaluate(x, 1): evaluate may fail, and nothing handles that.
  const evaluate = p.named("evaluate");
  const code = replace(p.code, samples.body!, (c) => {
    const f = "fx", a = "a1", b = "a2";
    c.nodes[f] = { id: f, kind: "ref", target: evaluate };
    c.nodes[a] = { id: a, kind: "ref", target: Object.keys(p.pres.names).find((id) => p.pres.names[id] === "x" && c.nodes[id]?.kind === "variant")! };
    c.nodes[b] = { id: b, kind: "lit", value: 1 };
    return { kind: "call", fn: f, args: [a, b] };
  });
  const errors = infer(code, p.pres.names).errors;
  assert.ok(errors.some((e) => /evaluate performs Choice, which nothing here handles/.test(e.message)), JSON.stringify(errors));

  const q = load("queens");
  const info = infer(q.code, q.pres.names);
  // A main that is the queens search itself: Choice escapes to the top.
  const code2 = replace(q.code, get(q.code, q.named("main"), "def").body!, (c) => {
    c.nodes.r = { id: "r", kind: "ref", target: q.named("queens") };
    c.nodes.l = { id: "l", kind: "lit", value: 4 };
    c.nodes.c = { id: "c", kind: "call", fn: "r", args: ["l"] };
    return { kind: "lambda", params: [], body: "c" };
  });
  const info2 = infer(code2, q.pres.names);
  assert.deepEqual(info2.errors, []);
  assert.throws(() => runMain(code2, info2, q.named("main"), { print: () => {} }), /unhandled effect/);
  void info;
});

test("totality is inferred: recursion on a smaller piece is total, anything else is Diverge", () => {
  const p = load("algebra");
  const each = p.named("for each");
  const lam = get(p.code, get(p.code, each, "def").body!, "lambda");
  const info = infer(p.code, p.pres.names);
  assert.ok(!info.divergent.has(each));
  // Recurse on the whole list instead of the rest: no longer smaller.
  const recursive = Object.values(p.code.nodes).find((n) => n.kind === "call" && p.code.nodes[n.fn].kind === "ref" && (p.code.nodes[n.fn] as NodeOf<"ref">).target === each && p.code.nodes[n.args[0]].kind === "ref" && n.args[0] !== lam.params[0]) as NodeOf<"call">;
  const code = replace(p.code, recursive.args[0], () => ({ kind: "ref", target: lam.params[0] }));
  const after = infer(code, p.pres.names);
  assert.ok(after.divergent.has(each));
  assert.match(showType(after.typeOf.get(each)!, p.pres.names), /Diverge/);
});

test("scope: a variable moved out of the case that binds it is caught", () => {
  const p = load("algebra");
  const derivative = get(p.code, get(p.code, p.named("derivative"), "def").body!, "lambda");
  const fold = get(p.code, derivative.body, "fold");
  const arm = fold.arms.map((a) => get(p.code, a, "arm")).find((a) => a.binds.length === 2)!;
  // derivative(e) = l   (l belongs to one arm only)
  const code = replace(p.code, derivative.body, () => ({ kind: "ref", target: arm.binds[0] }));
  const errors = infer(code, p.pres.names).errors;
  assert.ok(errors.some((e) => /used outside the function or case that introduces it/.test(e.message)));
});

test("hashes ignore ids and names, and recursive definitions hash", () => {
  for (const [name, defs] of [["queens", ["main", "safe", "queens"]], ["algebra", ["simplify", "derivative"]]] as const) {
    const p = load(name);
    const b = reId(p.own);
    const cb = base(b.code);
    for (const d of defs) assert.equal(hashDef(p.code, p.named(d)), hashDef(cb, b.ids.get(p.named(d))!), `${name}: ${d}`);
  }
  const q = load("queens");
  assert.notEqual(hashDef(q.code, q.named("for each")), hashDef(q.code, q.named("map")));
});

test("the block view shows if, folds and lets, with the inferred type on top", () => {
  const p = load("algebra");
  const info = infer(p.code, p.pres.names);
  const text = renderBlocks(p.code, p.pres, info, p.named("newton"));
  assert.equal(text.split("\n").slice(-4).join("\n"), [
    "newton : (expression, expression, Number) -[Choice, Diverge]-> Number",
    "newton(f, slope, guess) =",
    "  next = guess − evaluate(f, guess) / evaluate(slope, guess)",
    "  if abs(next − guess) < 1e-12 then next else newton(f, slope, next)",
  ].join("\n"));
  const type = renderBlocks(p.code, p.pres, info, p.named("expression"));
  assert.match(type, /^type expression\n {2}\| number\(value: Number\)\n {2}\| x\n/);
  void baseNames;
});

test("a comment's {id} references show as the names they point at", () => {
  const p = load("quadratic");
  const names = baseNames(JSON.parse(readFileSync(join(root, "examples", "quadratic", "names.short.json"), "utf8")));
  const text = renderBlocks(p.code, { ...p.pres, names }, infer(p.code, names), "0f886080");
  assert.equal(text.split("\n")[0], "-- b² − 4·a·c; negative means no real roots");
});

test("relations: a direction is chosen at the use site, and its effect is inferred", () => {
  const p = load("relations");
  const info = infer(p.code, p.pres.names);
  assert.deepEqual(info.errors, []);
  assert.equal(typeOf(p, info, "split"), "(Number, Number) -> Pair Number Number");
  assert.equal(typeOf(p, info, "missing addend"), "(Number, Number) -> Number");
  assert.equal(typeOf(p, info, "to polar"), "(Number, Number) -[Choice]-> Pair Number Number");
  assert.equal(typeOf(p, info, "square roots"), "(Number) -> List Number");
  assert.deepEqual(run(p.code, info, p.named("main")), [
    "split(10, 4) = 7, 3",
    "missing addend(3, 10) = 7",
    "to polar(0, 2), canonical = 2, 1.570796327",
    "square roots(9) = 3 -3",
    "square roots(−1) = []",
  ]);
  // Polar given only x: not enough to solve, and the checker says so.
  const toPolar = get(p.code, get(p.code, p.named("to polar"), "def").body!, "lambda");
  const solve = get(p.code, toPolar.body, "solve");
  const [x] = Object.keys(solve.given);
  const code = replace(p.code, solve.id, () => ({ ...solve, given: { [x]: solve.given[x], out: solve.given.out } }));
  assert.ok(infer(code, p.pres.names).errors.some((e) => /needs 1 more known port/.test(e.message)));
});

test("a chain of one associative operator is one call however it nests; others keep their pairs", async () => {
  const { chainOperands, S } = await import("../src/lang/std.ts");
  const { B } = await import("../src/prelude.ts");
  const nodes: Code["nodes"] = {};
  const lit = (id: Id, value: string | number) => (nodes[id] = { id, kind: "lit", value }, id);
  const call = (id: Id, op: Id, a: Id, b: Id) => { nodes[`${id}f`] = { id: `${id}f`, kind: "ref", target: op }; nodes[id] = { id, kind: "call", fn: `${id}f`, args: [a, b] }; return id; };
  // ("a" ++ "b") ++ ("c" ++ "d"), and 1 − (2 − 3)
  call("t", S.concat, call("l", S.concat, lit("a", "a"), lit("b", "b")), call("r", S.concat, lit("c", "c"), lit("d", "d")));
  call("s", B.sub, lit("1", 1), call("s2", B.sub, lit("2", 2), lit("3", 3)));
  const code: Code = { nodes, defs: [] };
  assert.deepEqual(chainOperands(code, "t"), ["a", "b", "c", "d"]);
  assert.deepEqual(chainOperands(code, "t", (id) => id === "r"), ["a", "b", "r"]);
  assert.equal(chainOperands(code, "l"), null, "two operands are just the call");
  assert.equal(chainOperands(code, "s"), null, "subtraction isn't associative");
  const p = load("effects");
  const text = renderBlocks(p.code, p.pres, infer(p.code, p.pres.names), p.named("main"));
  assert.match(text, /\n {4}\)\n {4}\+\+ " · "\n {4}\+\+ handle show/);
});

test("an if on one line is bracketed when it is an operand of ++", () => {
  const p = load("ledger");
  const out = renderBlocks(p.code, p.pres, infer(p.code, p.pres.names), p.named("money"));
  assert.match(out, /^ {2}\(if .* then "-" else ""\)$/m);
  assert.match(out, /^ {2}\+\+ /m);
});

test("an if's condition and branches read as what they are: a match condition shows its arms, a branch's steps sit inside the branch", () => {
  const p = load("calc");
  const info = infer(p.code, p.pres.names);
  const lines = (d: string) => renderBlocks(p.code, p.pres, info, p.named(d)).split("\n").map((l) => l.trim());
  const sum = lines("sum rest");
  // The condition is the test on the token, not a placeholder.
  assert.ok(sum.includes(`symbol(m) → m = "+" or m = "-"`));
  // The parse of the right operand happens only when the test passed.
  const then = sum.indexOf("then"), step = sum.indexOf("right = product(more)"), other = sum.findIndex((l) => l.startsWith("else"));
  assert.ok(then >= 0 && then < step && step < other, sum.join("\n"));
  // `? expression` prints the parse, anything else prints the value: each
  // print belongs to its own branch.
  const run = lines("run line");
  const q = run.indexOf(`else if t = symbol("?")`);
  assert.deepEqual(run.slice(q + 1, q + 7), ["then", "print(parenthesized(‹whole expression›(more)))", "bindings", "else", "print(show(evaluate(‹whole expression›(ts), bindings)))", "bindings"]);
  // No example shows a part of its program as a placeholder.
  for (const name of ["calc", "converter", "ledger", "countdown", "queens", "algebra", "effects"]) {
    const e = load(name), ei = infer(e.code, e.pres.names);
    for (const d of e.own.defs) assert.doesNotMatch(renderBlocks(e.code, e.pres, ei, d), /‹(match|fold|solve|lambda)›/, `${name}: ${e.pres.names[d]}`);
  }
});

test("a field read reads as value.field: the record first, then what is taken from it", () => {
  const text = (name: string, d: string) => { const e = load(name); return renderBlocks(e.code, e.pres, infer(e.code, e.pres.names), e.named(d)); };
  assert.match(text("raymarch", "ring"), /√\(p\.x · p\.x \+ p\.z · p\.z\)/);
  const larger = text("ledger", "larger");
  assert.ok(larger.includes("b.cents < a.cents") && larger.includes("a.name < b.name"), larger);
  assert.doesNotMatch(larger, /cents\(|name\(/);
});

test("a value of a one-case type taken apart reads as a let of its fields, and stays in its branch", () => {
  const cd = load("countdown"), info = infer(cd.code, cd.pres.names);
  const lines = (d: string) => renderBlocks(cd.code, cd.pres, info, cd.named(d)).split("\n").map((l) => l.trim());
  // Both halves are searched, each result taken apart, then joined.
  const results = lines("results");
  const steps = ["halves(front, back) = split(numbers)", "found(expr, value) = results(front)", "found(expr₂, value₂) = results(back)"].map((l) => results.indexOf(l));
  assert.ok(steps.every((i, k) => i >= 0 && (k === 0 || i > steps[k - 1])), results.join("\n"));
  assert.ok(results[steps[2] + 1].startsWith("join("), results.join("\n"));
  // split's else takes the rest apart only when it goes that way.
  const split = lines("split");
  const other = split.indexOf("else");
  assert.ok(other >= 0 && split[other + 1] === "halves(front, back) = split(tail)", split.join("\n"));
  // A type with several cases is still matched, case by case.
  assert.ok(lines("valid").includes("match op"));
});

test("a step done for what it does reads as the step; an unnamed value something reads is called for its type", () => {
  const ledger = load("ledger"), li = infer(ledger.code, ledger.pres.names);
  const usage = renderBlocks(ledger.code, ledger.pres, li, ledger.named("usage")).split("\n").map((l) => l.trim());
  // Print the usage, then give back 2: the print is a step, not a value.
  assert.ok(usage.includes(`‹print error›("usage: ledger file.csv")`), usage.join("\n"));
  for (const d of ["usage", "run", "failed"]) assert.doesNotMatch(renderBlocks(ledger.code, ledger.pres, li, ledger.named(d)), /‹\?/, d);
  // Countdown's numbers have no name but the search reads them: whatever
  // they are called, the binding and the use are the same name.
  const cd = load("countdown");
  const main = renderBlocks(cd.code, cd.pres, infer(cd.code, cd.pres.names), cd.named("main"));
  assert.doesNotMatch(main, /‹\?/);
  const [, name] = main.match(/^ {2}(\S+) = \[1, 3, 7, 10, 25, 50\]$/m) ?? [];
  assert.ok(name && main.includes(`solutions(${name}, 765)`), main);
});
