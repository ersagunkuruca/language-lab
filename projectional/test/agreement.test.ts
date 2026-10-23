// Forward and backwards agree (REVIEW-2026-10-22b.md, "the systematic
// check"). For every function in every example that takes and gives plain
// data, and some sample inputs x:
//   - run through the relational interpreter with x given, it gives exactly
//     the evaluator's answers f(x);
//   - given x and f(x), it finds an answer (x is one of f's inputs for f(x));
//   - every fully known answer it gives backwards from f(x), run forward,
//     gives f(x) again.
// Each search has a step budget, so a search that never ends shows up as a
// missing answer instead of a hung test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { get, type Code, type Id } from "../src/model.ts";
import { recordVariant } from "../src/lang/derive.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { NotInvertible, relate, showTerm, toValue } from "../src/lang/relate.ts";
import { bool, makeRunner, toList, type Value } from "../src/lang/run.ts";
import { BOOL, LIST } from "../src/lang/std.ts";
import { CHOICE, DIVERGE, INT, NUMBER, STRING, type Type } from "../src/lang/types.ts";
import { inSweep } from "./helpers.ts";

// A few inputs of each plain type: zero, one, a fraction, a negative. A
// record (one case) gets a few, its fields' samples taken in turn.
const samples = (t: Type, code?: Code): Value[] | null => {
  if (t.t !== "con") return null;
  const variant = code && t.args.length === 0 ? recordVariant(code, t.id) : null;
  if (variant) {
    const fields = get(code!, variant, "variant").fields.map((f) => {
      const ft = code!.nodes[get(code!, f, "field").type];
      return ft.kind === "tref" && !ft.args.length ? samples({ t: "con", id: ft.target, args: [] }) : null;
    });
    if (fields.some((f) => !f)) return null;
    return [0, 1, 2].map((i) => ({ tag: variant, fields: fields.map((f, j) => f![(i + j) % f!.length]) }));
  }
  if (t.id === NUMBER) return [0, 1, 2.5, -3];
  if (t.id === INT) return [0, 1, 4];
  if (t.id === STRING) return ["", "ab"];
  if (t.id === BOOL) return [bool(false), bool(true)];
  if (t.id === LIST) { const s = samples(t.args[0]); return s ? [toList([]), toList(s.slice(0, 2))] : null; }
  return null;
};
const product = (xs: Value[][]): Value[][] => xs.reduce<Value[][]>((acc, s) => acc.flatMap((a) => s.map((v) => [...a, v])), [[]]);
// Spread over the samples, at most this many per function.
const spread = <T,>(xs: T[], n: number) => xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]);
const take = <T,>(it: Iterable<T>, n: number) => { const out: T[] = []; for (const x of it) if (out.push(x) >= n) break; return out; };
const key = (v: unknown) => showTerm(v as never);
// Equal as the language says: whole numbers exactly, other numbers closely.
const same = (a: Value, b: Value) => typeof a === "number" && typeof b === "number" && !(Number.isInteger(a) && Number.isInteger(b)) ? Math.abs(a - b) <= 1e-9 * (1 + Math.abs(b)) : key(a) === key(b);

const STEPS = 5000;

function disagreements(ex: string): { checked: string[]; problems: string[] } {
  const dir = join(root, "examples", ex);
  const p = loadProgram(dir);
  const info = infer(p.code, p.pres.names);
  const own = JSON.parse(readFileSync(join(dir, "code.json"), "utf8")).defs as Id[];
  const checked: string[] = [], problems: string[] = [];
  let n = 0;
  for (const def of own) {
    const t = info.typeOf.get(def);
    if (!t || t.t !== "fn" || !t.params.length) continue;
    // Pure functions only (Choice is a set of answers, fine both ways), and
    // none whose recursion isn't known to end: forward could hang.
    if (t.eff.effs.some((e) => e !== CHOICE && e !== DIVERGE) || info.divergent.has(def)) continue;
    const inputs = t.params.map((x) => samples(x, p.code));
    if (inputs.some((s) => !s) || !samples(t.ret, p.code)) continue;
    const name = p.pres.names[def];
    checked.push(name);
    const params = get(p.code, get(p.code, def, "def").body!, "lambda").params;
    const r = makeRunner(p.code, info, { print: () => {} });
    const forward = (args: Value[]) => take(r.call(r.value(def), ...args), 50);
    for (const args of spread(product(inputs as Value[][]), 6)) {
      if (!inSweep(n++)) continue;
      const at = `${name}(${args.map(key).join(", ")})`;
      let fwd: Value[];
      try { fwd = forward(args); } catch { continue; } // fails forward, e.g. a division by zero
      // NaN equals nothing, itself included, so there's nothing to find.
      if (fwd.some((v) => typeof v === "number" && !Number.isFinite(v))) continue;
      const given = Object.fromEntries(params.map((q, i) => [q, args[i]]));
      let steps = 0;
      const spend = () => ++steps < STEPS;
      try {
        steps = 0;
        const rel = take(relate(p.code, def, given, { spend }), 51).filter((a) => !a.free.length).map((a) => a.values.out as Value);
        const fits = rel.length === fwd.length && rel.every((v) => fwd.some((w) => same(v, w))) && fwd.every((w) => rel.some((v) => same(v, w)));
        if (!fits) problems.push(`${at}: the evaluator gives ${fwd.map(key).join(" ")}, relate gives ${rel.map(key).join(" ")}`);
      } catch (e) { problems.push(`${at} forward through relate: ${(e as Error).message}`); }
      const out = fwd[0];
      if (out === undefined) continue;
      try {
        steps = 0;
        if (!take(relate(p.code, def, { ...given, out }, { spend }), 1).length) problems.push(`${at} = ${key(out)}: relate finds no answer with both known`);
      } catch (e) { problems.push(`${at} = ${key(out)} checked: ${(e as Error).message}`); }
      try {
        steps = 0;
        for (const a of take(relate(p.code, def, { out }, { spend }), 3)) {
          if (a.free.length || a.residual.length) continue;
          const back = params.map((q) => toValue(a.values[q])) as Value[];
          if (!forward(back).some((v) => same(v, out))) problems.push(`backwards from ${key(out)}, ${name}(${back.map(key).join(", ")}) gives ${forward(back).map(key).join(" ")}`);
        }
      } catch (e) { if (!(e instanceof NotInvertible)) problems.push(`backwards from ${name} = ${key(out)}: ${(e as Error).message}`); }
    }
  }
  return { checked, problems };
}

const EXAMPLES = readdirSync(join(root, "examples")).filter((e) => existsSync(join(root, "examples", e, "code.json")));
const checkedIn = new Map<string, string[]>();
for (const ex of EXAMPLES) {
  test(`forward and backwards agree: ${ex}`, () => {
    const { checked, problems } = disagreements(ex);
    checkedIn.set(ex, checked);
    assert.deepEqual(problems, []);
  });
}

test("the agreement check covers the examples' functions", () => {
  // If a change to the examples made every function skip (say, a new effect
  // on all of them), the tests above would pass by checking nothing.
  const all = [...checkedIn.values()].flat();
  assert.ok(all.length >= 80, `${all.length} functions checked`);
});
