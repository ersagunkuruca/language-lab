// Modes (src/lang/modes.ts, MODES.md): what the analysis says about a
// direction before it runs, checked against what relate.ts does when it
// runs. The checker types solves from it (MODES.md, plan step 2), so these
// tests are the evidence it can be trusted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { get, subtree, type Code, type Id, type NodeOf } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, loadProgram } from "../src/lang/load.ts";
import { analyzer, describeVerdict, type Fn, type Verdict } from "../src/lang/modes.ts";
import { relate } from "../src/lang/relate.ts";
import { makeRunner, toList, bool } from "../src/lang/run.ts";
import { planSolve } from "../src/lang/solve.ts";
import { CONS, FIRST, INT_OPS, NIL, PAIR_V, S } from "../src/lang/std.ts";
import { DIVERGE } from "../src/lang/types.ts";

const load = (name: string) => loadProgram(join(root, "examples", name));
const params = (code: Code, def: Id) => get(code, get(code, def, "def").body!, "lambda").params;

// Run def in a mode with relate.ts under a step budget, and check the
// verdict against what happened:
//   ends            the search finished within the budget
//   at most one     no more than one answer
//   at least one    one answer or more
//   stuck           no answer is pinned down (each has unknowns or waits)
function agrees(code: Code, def: Id, known: Record<string, unknown>, v: Verdict, budget = 20000) {
  let steps = 0;
  const answers = [...relate(code, def, known, { spend: () => ++steps < budget })];
  const what = `${describeVerdict(v)}, and relate gave ${answers.length} answers in ${steps} steps`;
  if (v.ends) assert.ok(steps < budget, `said it ends: ${what}`);
  const pinned = answers.filter((a) => !a.free.length && !a.residual.length);
  if (v.stuck.length) assert.equal(pinned.length, 0, `said it's stuck: ${what}`);
  else {
    if (!v.answers.many) assert.ok(pinned.length <= 1, `said at most one: ${what}`);
    if (!v.answers.fail && steps < budget) assert.ok(pinned.length >= 1, `said at least one: ${what}`);
  }
  return { answers, steps };
}

// The verdict for def with these ports known (binder ids or "out").
function verdict(code: Code, def: Id, known: string[], spec: Record<string, Fn> = {}, names: Record<Id, string> = {}) {
  const ps = params(code, def);
  const at = (p: string) => (p === "out" ? "out" : String(ps.indexOf(p)));
  return analyzer(code, names).ofMode(def, known.map(at), new Map(Object.entries(spec).map(([p, f]) => [ps.indexOf(p), f])));
}

test("backwards: the functions examples/backwards solves end, and say how many answers", () => {
  const p = load("backwards");
  const show = p.named("show numbers");
  for (const out of ["1 22 333", "1  2", "", "01"]) agrees(p.code, show, { out }, verdict(p.code, show, ["out"]));
  assert.equal(describeVerdict(verdict(p.code, show, ["out"])), "ends, any number of answers");

  const map = p.named("map"), [, change] = params(p.code, map);
  const r = makeRunner(p.code, infer(p.code, p.pres.names), { print: () => {} });
  const v = verdict(p.code, map, [change, "out"], { [change]: { k: "def", id: p.named("square") } });
  const { answers } = agrees(p.code, map, { [change]: r.value(p.named("square")), out: toList([4, 9]) }, v);
  assert.equal(answers.length, 4);
  assert.ok(v.ends && v.answers.many, describeVerdict(v));

  const m = p.named("magnitude");
  for (const out of [5, 0, -1]) agrees(p.code, m, { out }, verdict(p.code, m, ["out"]));
  const greet = p.named("greet");
  for (const out of ["hello, Ada", "goodbye"]) agrees(p.code, greet, { out }, verdict(p.code, greet, ["out"]));
  assert.equal(describeVerdict(verdict(p.code, greet, ["out"])), "ends, at most one answer");
});

test("a fold run backwards whose result doesn't shrink may not end, and doesn't", () => {
  // count(xs) = the number of items. Backwards from −1 the search tries
  // −2, −3, … forever: whole numbers don't get smaller towards a base case.
  const k = new Lang();
  const count = k.def("count");
  k.define(count, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.int(0) },
    { variant: CONS, names: ["x", "rest"], results: [null, "n"], body: (_, [, n]) => k.call(INT_OPS.add, n!, k.int(1)) },
  ])));
  const code = base(k.code);
  const v = verdict(code, count, ["out"]);
  assert.equal(v.ends, false, describeVerdict(v));
  assert.match(v.loops[0], /isn't smaller/);
  const { steps } = agrees(code, count, { out: -1 }, v, 2000);
  assert.equal(steps, 2000);
  // Forward it ends: each part is smaller than the list.
  assert.equal(verdict(code, count, params(code, count)).ends, true);
});

test("a recursive call on something that isn't smaller may not end", () => {
  // queens' safe, backwards from true: every list of queens.
  const p = load("queens");
  const safe = p.named("safe");
  const v = verdict(p.code, safe, ["out"]);
  assert.equal(v.ends, false, describeVerdict(v));
  // It's still searching when the budget runs out (each open branch
  // asks once more after that).
  const { steps } = agrees(p.code, safe, { out: bool(true) }, v, 2000);
  assert.ok(steps >= 2000, `${steps} steps`);
});

test("one of a list built in place, asked for what isn't in it, ends", () => {
  const k = new Lang();
  const f = k.def("f");
  k.define(f, k.thunk(() => k.call(S.oneOf, k.list(k.lit(3)))));
  const code = base(k.code);
  const v = verdict(code, f, ["out"]);
  assert.equal(describeVerdict(v), "ends, any number of answers");
  for (const out of [3, 5]) agrees(code, f, { out }, v);
});

test("a direction nothing pins down is stuck, and relate gives no answer without unknowns", () => {
  // The first of a pair, backwards: the second is never known.
  const k = new Lang();
  const f = k.def("f");
  k.define(f, k.fn(["p"], (p) => k.call(FIRST, p)));
  const g = k.def("g");
  k.define(g, k.fn(["a", "b"], (a, b) => k.call(FIRST, k.call(PAIR_V, a, b))));
  const code = base(k.code);
  const v = verdict(code, f, ["out"], {}, k.names);
  assert.ok(v.stuck.includes("nothing gives p"), describeVerdict(v));
  agrees(code, f, { out: 1 }, v);
  const w = verdict(code, g, ["out"]);
  assert.ok(w.stuck.length, describeVerdict(w));
  agrees(code, g, { out: 1 }, w);
  // Forward, both are fine.
  assert.equal(describeVerdict(verdict(code, g, params(code, g))), "ends, exactly one answer");
});

test("every relational solve in the examples has a mode that isn't stuck, and its verdict", () => {
  const seen: string[] = [];
  for (const e of readdirSync(join(root, "examples")).filter((e) => existsSync(join(root, "examples", e, "code.json")))) {
    const p = load(e);
    const own = JSON.parse(readFileSync(join(root, "examples", e, "code.json"), "utf8")) as Code;
    const a = analyzer(p.code, p.pres.names);
    for (const n of Object.values(own.nodes)) {
      if (n.kind !== "solve" || planSolve(p.code, n as NodeOf<"solve">).mode !== "relational") continue;
      const v = a.ofSolve(n as NodeOf<"solve">)!;
      assert.equal(v.stuck.length, 0, `${e}: ${p.pres.names[n.fn]}: ${describeVerdict(v)}`);
      seen.push(`${e}: ${p.pres.names[n.fn] ?? n.fn}: ${describeVerdict(v)}`);
    }
  }
  // Today every one of these is typed Choice, and map and show numbers
  // Diverge too (solve.ts mayLoop); step 2 of MODES.md types them from this.
  assert.deepEqual(seen.filter((s) => s.startsWith("backwards")).sort(), [
    "backwards: greet: ends, at most one answer",
    "backwards: join text: ends, any number of answers",
    "backwards: magnitude: ends, any number of answers",
    "backwards: map: ends, any number of answers",
    "backwards: show numbers: ends, any number of answers",
  ]);
  assert.ok(seen.filter((s) => s.startsWith("converter")).every((s) => s.endsWith("ends, at most one answer")), seen.join("\n"));
});

test("forward, a definition ends exactly when the checker finds no Diverge of its own", () => {
  // Forward is a mode too: every parameter known. Where a definition calls
  // a function it was passed, whether that ends is the function's own
  // effect row, which the checker adds; those are left out here. So is
  // the one place the checker is knowingly coarser: a function handed to
  // inverse is looked inside by the modes, at the call, but typed by
  // inverse's own type, which can't know it (Diverge, never too little).
  const inverse = Object.keys(LIBRARY.names).find((d) => LIBRARY.names[d] === "inverse" && LIBRARY.code.nodes[d]?.kind === "def")!;
  const disagree: string[] = [];
  let n = 0;
  for (const e of readdirSync(join(root, "examples")).filter((e) => existsSync(join(root, "examples", e, "code.json")))) {
    const p = load(e);
    const info = infer(p.code, p.pres.names);
    const a = analyzer(p.code, p.pres.names);
    const reaches = new Map<Id, boolean>();
    const viaInverse = (d: Id): boolean => {
      if (!reaches.has(d)) {
        reaches.set(d, false);
        reaches.set(d, subtree(p.code, d).some((x) => { const t = (p.code.nodes[x] as Partial<NodeOf<"ref">>).target; return t === inverse || (!!t && t !== d && p.code.nodes[t]?.kind === "def" && viaInverse(t)); }));
      }
      return reaches.get(d)!;
    };
    for (const d of p.own.defs) {
      const body = p.code.nodes[(p.code.nodes[d] as NodeOf<"def">).body!];
      const t = info.typeOf.get(d);
      if (body?.kind !== "lambda" || t?.t !== "fn") continue;
      const v = a.ofMode(d, body.params.map((_, i) => String(i)));
      if (v.dynamic.some((x) => /only known when it runs/.test(x))) continue;
      n++;
      const diverges = t.eff.effs.includes(DIVERGE);
      if (v.ends && diverges && viaInverse(d)) continue;
      if (v.stuck.length || v.ends === diverges) disagree.push(`${e}: ${p.pres.names[d]}: ${describeVerdict(v)}, typed ${diverges ? "" : "without "}Diverge`);
    }
  }
  assert.deepEqual(disagree, []);
  assert.ok(n > 150, `${n} definitions`);
});
