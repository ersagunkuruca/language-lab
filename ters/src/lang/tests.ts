// Tests in the language (TESTS-IN-THE-LANGUAGE.md, BACKLOG T7a). A test is
// an ordinary definition whose row has std's Check: it performs
// `expect(holds, what)`, and nothing else marks it. `runTests` runs each
// one on its saved inputs (examples.json) and then on small values of its
// inputs' types, handling Check by collecting every expect that failed, so
// one run reports them all. Small values come in order of size, and
// nothing is random, so the first failure is the smallest and the same on
// every run (SmallCheck's design: Runciman, Naylor and Lindblad, 2008).
//
// This first step enumerates small values from the types in TypeScript;
// running constructors backwards with relate (BACKWARDS.md), so that a
// type's own invariants are kept, is the note's later form.

import type { Code, Id, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import { discharge } from "./ledger.ts";
import { bool, makeRunner, showerFor, toList, unit, type Data, type Runtime, type Value } from "./run.ts";
import { ABORT_OP, BOOL, CHECK, CHECK_OP, FALSE, LIST, RATIO, RATIONAL, TRUE, UNIT } from "./std.ts";
import { Lang } from "./dsl.ts";
import { CHOICE, INT, NUMBER, STRING, type Type } from "./types.ts";
import { parseValue } from "./values.ts";

export const TEST_HANDLES = discharge("a test run by lab test", [CHECK, CHOICE],
  "the test runner handles Check, collecting every expect that failed, and runs each path a search takes");

// Small values of a type, smallest first; null when there are none to
// make (a function, a type with no case that ends).
export function smallValues(t: Type, code: Code, depth = 3): Value[] | null {
  // A law for any type is tried at Int, as QuickCheck and SmallCheck
  // default a type variable to one type.
  if (t.t === "var") return smallValues({ t: "con", id: INT, args: [] }, code, depth);
  if (t.t !== "con") return null;
  if (t.id === NUMBER) return [0, 1, -1, 0.5, 1e-9, 1e9];
  if (t.id === INT) return [0, 1, -1, 2, -2, 3, -3];
  if (t.id === STRING) return ["", "a", "ab"];
  if (t.id === BOOL) return [bool(false), bool(true)];
  if (t.id === UNIT) return [unit];
  // Fractions in lowest terms over a positive bottom, as `fraction` makes
  // them: a record's own small values would give 1/0 and 2/2 (L208b).
  if (t.id === RATIONAL) return [[0, 1], [1, 1], [-1, 1], [1, 2], [-1, 2], [2, 1], [1, 3], [3, 2]].map((f) => ({ tag: RATIO, fields: f }));
  if (t.id === LIST) {
    const xs = depth > 0 ? smallValues(t.args[0], code, depth - 1) : [];
    if (!xs) return [toList([])];
    const few = xs.slice(0, 3);
    const out: Value[][] = [[]];
    for (let n = 1; n <= 3; n++) for (const tail of out.filter((l) => l.length === n - 1)) for (const x of few) out.push([...tail, x]);
    return out.map(toList);
  }
  // A type the program declares: each case, its fields from smaller values.
  const def = code.nodes[t.id];
  const td = def?.kind === "def" && def.body ? code.nodes[def.body] : undefined;
  if (td?.kind !== "typedef" || td.effect || td.interface) return null;
  if (depth <= 0) return null;
  const subst = new Map(td.params.map((p, i) => [p, t.args[i]]));
  const out: Value[] = [];
  for (const v of td.variants) {
    const variant = code.nodes[v] as NodeOf<"variant">;
    const fields = variant.fields.map((f) => typeOfField(code, (code.nodes[f] as NodeOf<"field">).type, subst));
    const parts = fields.map((ft) => (ft ? smallValues(ft, code, depth - 1) : null));
    if (parts.some((p) => !p || !p.length)) continue;
    for (const fs of bySize(parts as Value[][], 12)) out.push({ tag: v, fields: fs });
  }
  return out.length ? out : null;
}

// A field's written type with the typedef's parameters filled in.
function typeOfField(code: Code, id: Id, subst: Map<Id, Type>): Type | null {
  const n = code.nodes[id];
  if (n?.kind !== "tref") return null;
  if (subst.has(n.target)) return subst.get(n.target)!;
  const args = n.args.map((a) => typeOfField(code, a, subst));
  return args.some((a) => !a) ? null : { t: "con", id: n.target, args: args as Type[] };
}

// Tuples of one value per list, the smallest first (by the sum of the
// positions taken), at most `limit`.
export function bySize(lists: Value[][], limit: number): Value[][] {
  if (!lists.length) return [[]];
  const out: Value[][] = [];
  const max = lists.reduce((s, l) => s + l.length - 1, 0);
  for (let sum = 0; sum <= max && out.length < limit; sum++) {
    const go = (i: number, left: number, acc: Value[]) => {
      if (out.length >= limit) return;
      if (i === lists.length) { if (left === 0) out.push(acc); return; }
      for (let k = 0; k <= Math.min(left, lists[i].length - 1); k++) go(i + 1, left - k, [...acc, lists[i][k]]);
    };
    go(0, sum, []);
  }
  return out;
}

export interface Failure { inputs: string[]; what: string[] }
export interface TestResult { def: Id; name: string; cases: number; failures: Failure[]; error?: string }

// The definitions that are tests: functions whose row has Check.
export function testsIn(info: Info, defs: Id[]): Id[] {
  return defs.filter((d) => {
    const t = info.typeOf.get(d);
    return t?.t === "fn" && t.eff.effs.includes(CHECK);
  });
}

const CASES = 200, PATHS = 100;

// What examples.json keeps for a definition: inputs, and the answer you
// accepted for them (T7b). The editor's older form, one list of input
// texts, reads as inputs with no answer.
export interface Saved { inputs: string[]; answer?: string }
export function savedFrom(json: Record<Id, unknown>): Record<Id, Saved[]> {
  return Object.fromEntries(Object.entries(json).map(([d, v]) => {
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return [d, [{ inputs: v as string[] }]];
    const xs = (Array.isArray(v) ? v : []) as { inputs?: unknown; answer?: unknown }[];
    return [d, xs.filter((x) => Array.isArray(x?.inputs)).map((x) => ({ inputs: x.inputs as string[], ...(typeof x.answer === "string" ? { answer: x.answer } : {}) }))];
  }));
}

// Runs every test, and every definition with an accepted answer: an
// accepted answer is a test without the word, `expect(f(inputs) =
// answer)`, compared as printed (so how a value is stored doesn't matter).
export function runTests(code: Code, info: Info, names: Names, defs: Id[], saved: Record<Id, Saved[]> = {}, rt: Partial<Runtime> = {}): TestResult[] {
  const tests = new Set(testsIn(info, defs));
  const shower = showerFor(code, info, names);
  const show = (v: Value) => shower(v);
  const parse = (texts: string[]) => {
    const vs = texts.map((x) => parseValue(x, code, names));
    return vs.every((v) => "value" in v) ? vs.map((v) => (v as { value: Value }).value) : null;
  };
  return defs.filter((d) => tests.has(d) || (saved[d] ?? []).some((x) => x.answer !== undefined)).map((d) => {
    const t = info.typeOf.get(d) as Type & { t: "fn" };
    const name = names[d] ?? d;
    const failures: Failure[] = [];
    let failed: string[] = [];
    const r = makeRunner(code, info, { print: () => {}, ...rt, names, check: (holds, what) => { if (!holds) failed.push(what); } });
    let cases = 0;
    try {
      // Accepted answers first.
      for (const s of saved[d] ?? []) {
        if (s.answer === undefined) continue;
        const args = parse(s.inputs);
        if (!args) { failures.push({ inputs: s.inputs, what: ["its saved inputs don't read as values any more"] }); continue; }
        cases++;
        failed = [];
        const f = r.value(d);
        let got: string | undefined;
        for (const v of (t?.t === "fn" ? r.call(f, ...args) : [f]) as Iterable<Value>) { got = show(v); break; }
        if (got !== s.answer) failed.push(got === undefined ? `no answer, accepted ${s.answer}` : `gives ${got}, accepted ${s.answer}`);
        if (failed.length) failures.push({ inputs: s.inputs, what: failed });
      }
      if (tests.has(d)) {
        for (const args of testInputs(code, info, names, d, saved)) {
          cases++;
          failed = [];
          let paths = 0;
          for (const _ of r.call(r.value(d), ...args) as Iterable<Value>) if (++paths >= PATHS) break;
          if (failed.length) failures.push({ inputs: args.map(show), what: failed });
        }
      }
    } catch (e) {
      return { def: d, name, cases, failures, error: (e as Error).message };
    }
    return { def: d, name, cases, failures };
  });
}

// What a test runs on: its saved inputs (examples.json, the editor's Run),
// then small values of its inputs' types, smallest first.
export function testInputs(code: Code, info: Info, names: Names, d: Id, saved: Record<Id, Saved[]>): Value[][] {
  const t = info.typeOf.get(d) as Type & { t: "fn" };
  const inputs: Value[][] = [];
  for (const s of saved[d] ?? []) {
    if (s.answer !== undefined) continue;
    const vs = s.inputs.map((x) => parseValue(x, code, names));
    if (vs.every((v) => "value" in v)) inputs.push(vs.map((v) => (v as { value: Value }).value));
  }
  const smalls = t.params.map((p) => smallValues(info.subst.zonk(p), code));
  if (smalls.every((x) => x)) inputs.push(...bySize(smalls as Value[][], CASES - inputs.length));
  return inputs;
}

// Each test as a definition of its own that handles its Check (T7e2), for
// a way of running the program that has no test runner around it
// (`lab test --compiled`): `t checked(inputs)` runs t, an expect that holds
// goes on, and the first that doesn't ends it with its text, as an Abort
// does; "" when every expect held. Written in the language, so it compiles
// like any definition.
export function checkedTests(code: Code, names: Names, tests: Id[]): { code: Code; names: Names; wrappers: Map<Id, Id> } {
  const k = new Lang(code);
  const wrappers = new Map<Id, Id>();
  for (const d of tests) {
    const lam = code.nodes[(code.nodes[d] as NodeOf<"def">).body ?? ""];
    if (lam?.kind !== "lambda") continue;
    const w = k.def(`${names[d] ?? d} checked`);
    k.define(w, k.fn(lam.params.map((p) => names[p] ?? "x"), (...xs) => k.handle(k.let("checked", k.handle(k.call(d, ...xs), [
      { variant: CHECK_OP, names: ["holds", "what"], body: ([h, what]) => k.if(h, k.unitValue, k.call(ABORT_OP, what)) },
    ]), () => k.lit("")), [{ variant: ABORT_OP, names: ["what"], body: ([what]) => what }])));
    wrappers.set(d, w);
  }
  return { code: { nodes: { ...code.nodes, ...k.code.nodes }, defs: [...code.defs, ...k.code.defs] }, names: { ...names, ...k.names }, wrappers };
}

// An evaluator's value as compiled JavaScript takes it (core-js.ts): the
// same, but a Bool is a boolean wherever it sits, in a field or a list
// (T7e9: a Json value holding a Bool compared unequal to itself compiled).
export function compiledValue(v: Value): Value {
  if (typeof v !== "object" || v === null || !("tag" in v) || !Array.isArray(v.fields)) return v;
  if ((v.tag === TRUE || v.tag === FALSE) && v.fields.length === 0) return (v.tag === TRUE) as unknown as Value;
  const fields = v.fields.map(compiledValue);
  return fields.every((f, i) => f === v.fields[i]) ? v : { tag: v.tag, fields };
}

// And back (T7e10): a compiled answer's booleans as the evaluator's Bool,
// so it shows as the accepted answer was written. A compiled case's tag
// and fields can be its class's getters, so a copy names them.
export function evaluatorValue(v: unknown): Value {
  if (typeof v === "boolean") return bool(v);
  if (typeof v !== "object" || v === null || !("tag" in v) || !Array.isArray((v as Data).fields)) return v as Value;
  const d = v as Data, fields = d.fields.map(evaluatorValue);
  return fields.every((f, i) => f === d.fields[i]) ? d : { tag: d.tag, fields };
}

// The tests again, from another way of running the program (T7e2):
// `callOf` gives each test's checked definition (checkedTests) on the
// evaluator's values, or why there is none; a text that isn't "" is the
// first expect that failed there.
export function checksAgain(code: Code, info: Info, names: Names, tests: Id[], saved: Record<Id, Saved[]>, callOf: (d: Id) => ((args: Value[]) => Called) | string): Again[] {
  const show = showerFor(code, info, names);
  return tests.map((d) => {
    const name = names[d] ?? d;
    const call = callOf(d);
    if (typeof call === "string") return { def: d, name, cases: 0, failures: [], skipped: call };
    const failures: Failure[] = [];
    let cases = 0;
    try {
      for (const args of testInputs(code, info, names, d, saved)) {
        cases++;
        const r = call(args);
        if ("value" in r && r.value !== "") failures.push({ inputs: args.map((a) => show(a)), what: [String(r.value)] });
      }
    } catch (e) {
      return { def: d, name, cases, failures, error: (e as Error).message };
    }
    return { def: d, name, cases, failures };
  });
}

// The accepted answers again, from another way of running the program
// (`lab test --compiled`, T7e): `callOf` gives a definition's function on
// the evaluator's values, or why it has none there (it isn't compiled),
// and its answer must print as the accepted one. A function's first
// answer, as the evaluator's above; `none` for no answer.
export type Called = { value: Value } | { none: true };
export interface Again { def: Id; name: string; cases: number; failures: Failure[]; skipped?: string; error?: string }
export function answersAgain(code: Code, info: Info, names: Names, defs: Id[], saved: Record<Id, Saved[]>, callOf: (d: Id) => ((args: Value[]) => Called) | string): Again[] {
  const show = showerFor(code, info, names);
  return defs.filter((d) => (saved[d] ?? []).some((x) => x.answer !== undefined)).map((d) => {
    const name = names[d] ?? d;
    const call = callOf(d);
    if (typeof call === "string") return { def: d, name, cases: 0, failures: [], skipped: call };
    const failures: Failure[] = [];
    let cases = 0;
    try {
      for (const s of saved[d] ?? []) {
        if (s.answer === undefined) continue;
        const vs = s.inputs.map((x) => parseValue(x, code, names));
        if (!vs.every((v) => "value" in v)) { failures.push({ inputs: s.inputs, what: ["its saved inputs don't read as values any more"] }); continue; }
        cases++;
        const r = call(vs.map((v) => (v as { value: Value }).value));
        const got = "value" in r ? show(evaluatorValue(r.value)) : undefined;
        if (got !== s.answer) failures.push({ inputs: s.inputs, what: [got === undefined ? `no answer, accepted ${s.answer}` : `gives ${got}, accepted ${s.answer}`] });
      }
    } catch (e) {
      return { def: d, name, cases, failures, error: (e as Error).message };
    }
    return { def: d, name, cases, failures };
  });
}
