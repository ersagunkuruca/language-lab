// A printer read backwards by recursive descent (C110 s3,
// docs/design/relations-and-effects/GRAMMAR-DESCENT-2026-11-05.md): the
// text is read left to right once, each arm picked by the next character
// from its first set (first-sets.ts), each piece of the arm's Text read in
// turn, instead of relate.ts searching every way the printer could have
// printed it. An arm that starts with the printer itself is an infix
// operator, read by precedence climbing (step 4): its own condition for
// parentheses says which operators go on at a level, and the levels it
// prints its operands at say the rest (`Infix` below).
//
// The pieces read, each as relate.ts's grammar pieces read them (the
// prelude's `spaced` any spaces around, none too; `optional parens` the
// text with any number of parentheses round it, none too where the printer
// would print none):
// a literal; `++`; show of a whole number (its digits); a Text binder an
// arm's guard says is all letters or digits (the longest such run); a
// call of the printer itself (read again, with what it is given worked
// out); another definition, or a function written in place, read through
// its body; a match on a guard, each arm that doesn't fail tried and its
// guard checked on what was read. What else an arm prints can't be read
// here, and the reader says so (Unsupported).
//
// The answer is the evaluator's value (run.ts Value), or null where the
// line has no reading.

import type { Code, Id, Use } from "../model.ts";
import { isUse, useTarget } from "../model.ts";
import { answerKeys } from "./ports.ts";
import { intLit } from "./int.ts";
import { INT } from "./types.ts";
import { FALSE, S, STD_IMPL, TRUE } from "./std.ts";
import { META, fromList, toList, type Value } from "./run.ts";
import { firstSets } from "./first-sets.ts";
import * as T from "./text.ts";
import type { Reading } from "./relate.ts";

export class Unsupported extends Error {}
// A piece worked out forward that has no answer (fail, a character code
// of something not one character).
class NoAnswer extends Error {}
const SHOW_FLOAT = (x: number) => (STD_IMPL[S.show] as (x: number) => string)(x);

export type Any = { id: Id; kind: string; target: Id; value: unknown; fn: Id; args: Id[]; params: Id[]; body: Id; scrutinee: Id; arms: Id[]; variant: Id; binds: (Id | null)[] };
// A Text binder still to be read: a run of letters, digits, or characters
// a predicate passes (`all pass(characters(t), p)` with p the program's own).
type Kind = "letters" | "digits" | { pass: Id };
type Env = Map<Id, Value | { unknown: Kind | "int" }>;
const isUnknown = (v: unknown): v is { unknown: Kind | "int" } => typeof v === "object" && v !== null && "unknown" in v;
const LETTER = /[A-Za-z]/, DIGIT = /[0-9]/;
const TRUE_V: Value = { tag: TRUE, fields: [] }, FALSE_V: Value = { tag: FALSE, fields: [] };

// The arms that start with the printer itself, as infix operators: for
// descent here and the reader written as a definition (reader.ts, s7b).
export interface Infix { arm: Any; lets: [Id, Id][]; cond: Id | null; left: Id; rest: Id; op: Id; ops: string[] }
export function infixesOf(code: Code, printer: Id, names: Record<Id, string>, report: ReturnType<typeof firstSets>): Infix[] {
  const node = (id: Id) => code.nodes[id] as unknown as Any | undefined;
  const target = (id: Id): Id | null => { const n = node(id); return n?.kind === "ref" ? n.target : null; };
  const named = (id: Id | null) => (id ? names[id] ?? "" : "");
  const lambdaOf = (def: Id) => { const d = code.nodes[def] as { body?: Id } | undefined; const b = d?.body ? node(d.body) : undefined; return b?.kind === "lambda" ? b : undefined; };
  const body = node(lambdaOf(printer)!.body)!;
  // An arm that starts with the printer itself, as an infix operator
  // (precedence climbing, step 4): its functions of the operator (`s`,
  // `right`), the condition its optional parens put round it, its left
  // operand, the rest (the operator and the right operand), and the
  // operators it can print: the literal arms of a match on the operator
  // whose other values fail (calc's `binding strength`).
  const literalsOf = (def: Id, j: number): string[] | null => {
    const fn = lambdaOf(def);
    return fn ? literals(fn.body, fn.params[j]) : null;
  };
  // The Texts x may be for e not to fail: a match on x by literal arms
  // whose other values fail, or the chain of equality tests the lowering
  // makes of one (x = "+" then …, else x = "-" then …, else fail).
  const literals = (e: Id, x: Id): string[] | null => {
    const m = node(e);
    if (!m) return null;
    if (m.kind === "call" && target(m.fn) === "builtin.fail") return [];
    if (m.kind === "call" && node(m.fn)?.kind === "lambda" && m.args.length === 1 && target(m.args[0]) === x) return literals(node(m.fn)!.body, node(m.fn)!.params[0]);
    if (m.kind !== "match") return null;
    const otherwise = (m as unknown as { otherwise?: Id | null }).otherwise;
    if (target(m.scrutinee) === x) {
      const o = otherwise ? literals(otherwise, x) : [];
      const lits = m.arms.map((a) => node(node(a)!.value as Id)).map((l) => (l?.kind === "lit" && typeof l.value === "string" ? l.value : null));
      return o && lits.every((l) => l !== null) ? [...(lits as string[]), ...o] : null;
    }
    const t = node(m.scrutinee), [l, r] = t?.kind === "call" && target(t.fn) === "builtin.equal" ? t.args.map((y) => node(y)) : [];
    const lit = l && r && (target(l.id) === x && r.kind === "lit" ? r.value : target(r.id) === x && l.kind === "lit" ? l.value : null);
    if (typeof lit !== "string" || otherwise) return null;
    const no = m.arms.map((a) => node(a)!).find((a) => a.variant === FALSE);
    const rest = no ? literals(no.body, x) : [];
    return rest && [lit, ...rest];
  };
  return body.arms.map((a) => node(a)!).filter((a) => report.leftRecursive.includes(names[a.variant] ?? a.variant)).map((a) => {
    const lets: [Id, Id][] = [];
    let e = node(a.body)!;
    while (e.kind === "call" && node(e.fn)?.kind === "lambda") { const l = node(e.fn)!; lets.push([l.params[0], e.args[0]]); e = node(l.body)!; }
    let cond: Id | null = null;
    if (e.kind === "call" && named(target(e.fn)) === "optional parens") { cond = e.args[0]; e = node(e.args[1])!; }
    const left = e.kind === "call" && target(e.fn) === "builtin.concat" ? node(e.args[0]) : undefined;
    if (!left || left.kind !== "call" || target(left.fn) !== printer) throw new Unsupported(`${names[a.variant]} starts with the printer but isn't an infix operator`);
    const l = target(left.args[0])!, ops = new Set<string>(), op = a.binds.find((b) => b && b !== l && lets.some(([, x]) => { const c = node(x); return c?.kind === "call" && c.args.some((y) => target(y) === b); }));
    if (!op) throw new Unsupported(`${names[a.variant]}: no operator`);
    for (const [, x] of lets) {
      const c = node(x);
      if (c?.kind === "call" && code.nodes[target(c.fn) ?? ""]?.kind === "def") c.args.forEach((y, j) => { if (target(y) === op) for (const o of literalsOf(target(c.fn)!, j) ?? []) ops.add(o); });
    }
    if (!ops.size) throw new Unsupported(`${names[a.variant]}: its operators aren't a known few`);
    return { arm: a, lets, cond, left: l, rest: e.args[1], op, ops: [...ops].sort((x, y) => y.length - x.length) };
  });
}

// Where the last line with no reading stopped (L70c, relate.ts Reading):
// the furthest place a piece was read to or looked for, and what was
// looked for there.
export interface Stopped { at: number; expected: Set<string> }
export type Reader = ((text: string, ...given: Value[]) => Value | null) & { stopped: Stopped; characterTable: (def: Id) => [string, string][] };

export function descentReader(code: Code, printer: Id, names: Record<Id, string>): Reader {
  const node = (id: Id) => code.nodes[id] as unknown as Any | undefined;
  const target = (id: Id): Id | null => { const n = node(id); return n?.kind === "ref" ? n.target : null; };
  const named = (id: Id | null) => (id ? names[id] ?? "" : "");
  const lambdaOf = (def: Id) => { const d = code.nodes[def] as { body?: Id } | undefined; const b = d?.body ? node(d.body) : undefined; return b?.kind === "lambda" ? b : undefined; };
  const top = lambdaOf(printer)!;
  const body = node(top.body)!;
  const report = firstSets(code, printer, names);
  // The arms read here, with what they may start with backwards: their
  // first set, and "(" (optional parens read with parentheses whatever
  // the printer would have needed).
  const arms = body.arms.map((a) => node(a)!).filter((a) => !report.leftRecursive.includes(names[a.variant] ?? a.variant));
  const firsts = new Map(report.arms.map((a) => [a.variant, new Set(a.first)]));
  const starts = (variant: Id, c: string | undefined) => {
    const f = firsts.get(variant)!;
    if (c === undefined) return false;
    return c === "(" || f.has(c) || f.has("anything") || (f.has("digit") && DIGIT.test(c)) || (f.has("letter") && LETTER.test(c))
      || [...f].some((t) => t.startsWith("test:") && passesDef(t.slice(5), c));
  };

  const infixes = infixesOf(code, printer, names, report);

  let text = "";
  const stopped: Stopped = { at: 0, expected: new Set() };
  const expect = (at: number, what?: string) => {
    if (at > stopped.at) { stopped.at = at; stopped.expected = new Set(what ? [what] : []); } else if (at === stopped.at && what) stopped.expected.add(what);
  };
  const described = (c: string) => (c === "digit" ? "a digit" : c === "letter" ? "a letter" : c.startsWith("test:") ? describeTest(c.slice(5)) : JSON.stringify(c));
  // Forward, the little a guard or a printer's input needs.
  function evaluate(id: Id, env: Env): Value {
    const n = node(id);
    if (!n) throw new Unsupported(`no node ${id}`);
    if (n.kind === "lit") return n.value as Value;
    if (n.kind === "ref") {
      if (n.target === TRUE) return TRUE_V;
      if (n.target === FALSE) return FALSE_V;
      const v = env.get(n.target);
      if (v === undefined || isUnknown(v)) throw new Unsupported(`${named(n.target)} isn't known`);
      return v;
    }
    // A match on a Bool, or on a Text by its literal arms.
    if (n.kind === "match") {
      const v = evaluate(n.scrutinee, env);
      for (const a of n.arms.map((x) => node(x)!)) {
        const lit = a.value ? node(a.value as Id) : undefined;
        if (lit?.kind === "lit" ? lit.value === v : (v as { tag?: Id }).tag === a.variant) {
          // A case's fields, bound (L72d: a list walked forward).
          const fs = (v as { fields?: Value[] }).fields, inner = new Map(env);
          (a.binds ?? []).forEach((b, j) => { if (b && fs) inner.set(b, fs[j]); });
          return evaluate(a.body, inner);
        }
      }
      const otherwise = (n as unknown as { otherwise?: Id }).otherwise;
      if (otherwise) return evaluate(otherwise, env);
      throw new Unsupported("a match no arm of which is taken");
    }
    if (n.kind !== "call" || isUse(n as never)) throw new Unsupported(`can't work out a ${n.kind}`);
    const f = target(n.fn), xs = () => n.args.map((a) => evaluate(a, env));
    if (f === "builtin.fail") throw new NoAnswer();
    // first(a, b): a's answer, or b's where a has none (thunks).
    if (f === "builtin.first") {
      const thunk = (x: Id) => { const l = node(x); if (l?.kind !== "lambda" || l.params.length) throw new Unsupported("first of something other than thunks"); return l.body; };
      try { return evaluate(thunk(n.args[0]), env); } catch (e) { if (!(e instanceof NoAnswer)) throw e; return evaluate(thunk(n.args[1]), env); }
    }
    if (f === S.listOf) return toList(xs());
    const bool = (b: boolean) => (b ? TRUE_V : FALSE_V), truth = (v: Value) => (v as { tag?: Id }).tag === TRUE;
    switch (f) {
      case "builtin.int.less": { const [a, b] = xs(); return bool((a as number) < (b as number)); }
      case "builtin.int.add": { const [a, b] = xs(); return (a as number) + (b as number); }
      case "builtin.int.sub": { const [a, b] = xs(); return (a as number) - (b as number); }
      case "builtin.and": return bool(truth(evaluate(n.args[0], env)) && truth(evaluate(n.args[1], env)));
      case "builtin.or": return bool(truth(evaluate(n.args[0], env)) || truth(evaluate(n.args[1], env)));
      case "builtin.not": return bool(!truth(evaluate(n.args[0], env)));
      case "builtin.text.less": { const [a, b] = xs(); return bool(T.less(a as string, b as string)); }
      case "builtin.text.slice": { const [t, a, b] = xs(); return T.slice(t as string, a as never, b as never); }
      case "builtin.equal": { const [a, b] = xs(); if (typeof a === "object" || typeof b === "object") throw new Unsupported("compares data"); return bool(a === b); }
      case "builtin.text.code": { const c = [...(evaluate(n.args[0], env) as string)]; if (c.length !== 1) throw new NoAnswer(); return c[0].codePointAt(0)!; }
      case "builtin.concat": { const [a, b] = xs(); if (typeof a !== "string" || typeof b !== "string") throw new Unsupported("joins something other than text"); return a + b; }
      case "builtin.text.characters": return toList([...(evaluate(n.args[0], env) as string)]);
      case "builtin.int.shiftDown": { const [a, b] = xs(); return Number(a) >> Number(b); }
      case "builtin.int.bitAnd": { const [a, b] = xs(); return Number(a) & Number(b); }
      case "builtin.text.length": return [...(evaluate(n.args[0], env) as string)].length;
    }
    if (named(f) === "all pass") {
      const ch = node(n.args[0]), test = named(target(n.args[1]));
      if (ch?.kind === "call" && target(ch.fn) === "builtin.text.characters" && (test === "is letter" || test === "is digit")) {
        const t = evaluate(ch.args[0], env) as string;
        return bool([...t].every((c) => (test === "is letter" ? LETTER : DIGIT).test(c)));
      }
      if (ch?.kind === "call" && target(ch.fn) === "builtin.text.characters") {
        const t = evaluate(ch.args[0], env) as string;
        return bool([...t].every((c) => passes(n.args[1], c, env)));
      }
    }
    const fn = f && code.nodes[f]?.kind === "def" ? lambdaOf(f) : node(n.fn)?.kind === "lambda" ? node(n.fn) : undefined;
    if (fn) { const inner: Env = new Map(env); fn.params.forEach((p, j) => inner.set(p, evaluate(n.args[j], env))); return evaluate(fn.body, inner); }
    throw new Unsupported(`can't work out ${named(f) || f}`);
  }
  // What a guard being true says a Text binder holds (first-sets.ts facts).
  function hint(cond: Id, out: Map<Id, Kind>) {
    const n = node(cond);
    if (n?.kind !== "call") return;
    const f = target(n.fn);
    if (f === "builtin.and") { hint(n.args[0], out); hint(n.args[1], out); }
    if (named(f) === "all pass") {
      const ch = node(n.args[0]), test = named(target(n.args[1])), t = ch?.kind === "call" && target(ch.fn) === "builtin.text.characters" ? target(ch.args[0]) : null;
      if (t && test === "is letter") out.set(t, "letters");
      else if (t && test !== "is digit") out.set(t, { pass: n.args[1] });
      if (t && test === "is digit") out.set(t, "digits");
    }
  }
  // The program's own test of one character (a definition, or a function
  // written in place), worked out forward.
  // A test of a character, as an error says it: by what it passes among
  // the printable ASCII characters, so it reads the same with or without
  // the program's names.
  function describeTest(def: Id): string {
    let passed = "";
    for (let i = 33; i < 127; i++) { const c = String.fromCharCode(i); try { if (passesDef(def, c)) passed += c; } catch { return `a ${named(def) || "character"}`; } }
    if (/^[0-9]+$/.test(passed) && passed.length === 10) return "a digit";
    if (/^[A-Za-z_]+$/.test(passed) && passed.replace("_", "").length === 52) return "a letter";
    return `a ${named(def) || "character"}`;
  }
  function passesDef(def: Id, c: string): boolean {
    const fn = lambdaOf(def);
    if (!fn || fn.params.length !== 1) throw new Unsupported(`can't test a character with ${named(def)}`);
    return (evaluate(fn.body, new Map([[fn.params[0], c]])) as { tag?: Id }).tag === TRUE;
  }
  function passes(test: Id, c: string, env: Env): boolean {
    const f = target(test), fn = f && code.nodes[f]?.kind === "def" ? lambdaOf(f) : node(test)?.kind === "lambda" ? node(test) : undefined;
    if (!fn || fn.params.length !== 1) throw new Unsupported(`can't test a character with ${named(f) || "this"}`);
    return (evaluate(fn.body, new Map(env).set(fn.params[0], c)) as { tag?: Id }).tag === TRUE;
  }
  const escapes = new Map<object, [string, string][]>();
  // What a function of one character writes for c, or null.
  // Every way it writes c, where its body is `one of(spellings)` (L72e1:
  // json character spelled), the first one its printing.
  function written(fn: Any, c: string, env: Env = new Map()): string[] {
    const all = (id: Id, inner: Env): string[] => {
      const b = node(id);
      if (b?.kind === "call" && !isUse(b as never)) {
        if (target(b.fn) === S.oneOf) return fromList(evaluate(b.args[0], inner)).filter((v): v is string => typeof v === "string");
        // A let: its value bound, then its body.
        const l = node(b.fn);
        if (l?.kind === "lambda") { const e = new Map(inner); l.params.forEach((p, j) => e.set(p, evaluate(b.args[j], inner))); return all(l.body, e); }
      }
      const v = evaluate(id, inner); return typeof v === "string" ? [v] : [];
    };
    try { return all(fn.body, new Map(env).set(fn.params[0], c)); } catch (e) { if (e instanceof NoAnswer) return []; throw e; }
  }
  // The characters among the first 128 it writes as something else, by
  // what it writes, longest first (L72d).
  function characterTable(fn: Any, env: Env = new Map()): [string, string][] {
    let table = escapes.get(fn);
    if (!table) { table = []; for (let i = 0; i < 128; i++) { const c = String.fromCharCode(i); for (const o of new Set(written(fn, c, env))) if (o !== c && o !== "") table.push([o, c]); } table.sort((a, b) => b[0].length - a[0].length); escapes.set(fn, table); }
    return table;
  }
  const spaces = (at: number) => { while (text[at] === " ") at++; return at; };

  // Read the Text id prints from `at`: where it ends, the binders it
  // gave values, or null.
  function read(id: Id, env: Env, at: number): [number, Env] | null {
    const n = node(id);
    if (!n) return null;
    if (n.kind === "lit") { const s = String(n.value); if (text.startsWith(s, at)) return [at + s.length, env]; expect(at, JSON.stringify(s)); return null; }
    if (n.kind === "ref") {
      const v = env.get(n.target);
      if (v === undefined) throw new Unsupported(`reads ${named(n.target)}, which nothing says the characters of`);
      if (!isUnknown(v)) return typeof v === "string" && text.startsWith(v, at) ? [at + v.length, env] : null;
      if (v.unknown === "int") throw new Unsupported(`reads ${named(n.target)} as text`);
      const u = v.unknown, re = u === "letters" ? LETTER : DIGIT;
      const ok = typeof u === "object" ? (c: string) => passes(u.pass, c, env) : (c: string) => re.test(c);
      let end = at;
      while (end < text.length && ok(text[end])) end++;
      if (end === at) expect(at, u === "letters" ? "a letter" : u === "digits" ? "a digit" : undefined);
      return [end, new Map(env).set(n.target, text.slice(at, end))];
    }
    if (n.kind === "match") {
      // A match on an input still to be read (L72d: json's Bool, an
      // object's field pairs): each arm read with its fields still to be
      // read, and the input is that case with them.
      const sx = target(n.scrutinee);
      if (sx && isUnknown(env.get(sx))) {
        for (const a of n.arms.map((x) => node(x)!)) {
          if (!a.variant || (a as { value?: Id }).value) throw new Unsupported("reads a match by value on an input");
          const binds = (a.binds ?? []).filter((b): b is Id => !!b);
          const inner = new Map(env);
          for (const b of binds) inner.set(b, { unknown: "int" });
          const r = read(a.body, inner, at);
          if (!r) continue;
          const fields = (a.binds ?? []).map((b) => (b ? r[1].get(b) : undefined));
          if (fields.some((v) => v === undefined || isUnknown(v))) continue;
          const back = new Map([...env, ...[...r[1]].filter(([b]) => env.has(b))]);
          return [r[0], back.set(sx, { tag: a.variant, fields: fields as Value[] })];
        }
        return null;
      }
      // A Choice of arms (L72e2): `if one of([…]) then a else b` prints
      // either; every arm is read and the one that reads farthest kept,
      // the first of those that tie (a blank greedily, a number longest).
      const sc = node(n.scrutinee);
      if (sc?.kind === "call" && !isUse(sc as never) && target(sc.fn) === S.oneOf) {
        let best: [number, Env] | null = null;
        for (const a of n.arms.map((x) => node(x)!)) {
          const r = read(a.body, env, at);
          if (r && (!best || r[0] > best[0])) best = r;
        }
        return best;
      }
      // Each arm that prints something, then its guard checked.
      for (const a of n.arms.map((x) => node(x)!)) {
        const inner = new Map(env);
        if (a.variant === TRUE) { const h = new Map<Id, Kind>(); hint(n.scrutinee, h); for (const [b, k] of h) if (isUnknown(inner.get(b))) inner.set(b, { unknown: k }); }
        const r = read(a.body, inner, at);
        if (!r) continue;
        const s = evaluate(n.scrutinee, r[1]);
        if ((s as { tag?: Id }).tag === a.variant) return r;
      }
      return null;
    }
    if (n.kind !== "call" || isUse(n as never)) throw new Unsupported(`reads a ${n.kind}`);
    const f = target(n.fn);
    if (f === "builtin.fail") return null;
    if (f === "builtin.concat") { const a = read(n.args[0], env, at); return a && read(n.args[1], a[1], a[0]); }
    if (f === "builtin.int.show") {
      const b = target(n.args[0]);
      if (!b || !isUnknown(env.get(b))) throw new Unsupported("reads show of something other than an input");
      let end = at;
      if (text[end] === "-") end++;
      const digits = end;
      while (end < text.length && DIGIT.test(text[end])) end++;
      if (end === digits) { expect(digits, "a whole number"); return null; }
      // show writes no leading zeros and no "-0": "007" reads only its "0".
      if (text[digits] === "0") { end = digits + 1; if (digits > at) { expect(at, "a whole number"); return null; } }
      const v = Number(text.slice(at, end));
      return [end, new Map(env).set(b, Number.isSafeInteger(v) ? v : BigInt(text.slice(at, end)))];
    }
    // show of a Float64 (L72c): the longest spelling there that show
    // writes, as relate.ts accepts it (a number's text, which show of it
    // gives back exactly).
    if (f === S.show) {
      const b = target(n.args[0]);
      if (!b || !isUnknown(env.get(b))) throw new Unsupported("reads show of something other than an input");
      let end = at;
      while (end < text.length && /[-+0-9.eE]/.test(text[end])) end++;
      for (; end > at; end--) {
        const t = text.slice(at, end), x = Number(t);
        if (Number.isFinite(x) && SHOW_FLOAT(x) === t) return [end, new Map(env).set(b, x)];
      }
      expect(at, "a number");
      return null;
    }
    // one of(texts) (L72e2): the longest of them there, the first of those
    // that tie.
    if (f === S.oneOf) {
      const xs = evaluate(n.args[0], env);
      let best: [number, Env] | null = null;
      for (const x of fromList(xs)) {
        if (typeof x !== "string") throw new Unsupported("reads one of something other than texts");
        if (!text.startsWith(x, at)) expect(at, JSON.stringify(x));
        else if (!best || at + x.length > best[0]) best = [at + x.length, env];
      }
      return best;
    }
    if (named(f) === "spaced") { const r = read(n.args[0], env, spaces(at)); return r && [spaces(r[0]), r[1]]; }
    // Any number of parentheses round it, as the search reads them; at
    // least one where they are needed.
    if (named(f) === "optional parens") {
      let needed = false;
      try { needed = (evaluate(n.args[0], env) as { tag?: Id }).tag === TRUE; } catch (e) { if (!(e instanceof Unsupported)) throw e; }
      const parens = (at: number, must: boolean): [number, Env] | null => {
        if (text[at] === "(") {
          const r = parens(at + 1, false);
          if (r && text[r[0]] === ")") return [r[0] + 1, r[1]];
          if (r) expect(r[0], '")"');
        } else if (must) expect(at, '"("');
        return must ? null : read(n.args[1], env, at);
      };
      return parens(at, needed);
    }
    // join all(map(xs, g), sep): xs's items each read by g, between seps
    // (L72b), none too; xs an input list, or the characters of an input
    // Text, which are then put back together.
    if (named(f) === "join all") {
      const m = node(n.args[0]);
      if (m?.kind !== "call" || isUse(m as never) || named(target(m.fn)) !== "map") throw new Unsupported("reads join all of something other than a map");
      const sep = evaluate(n.args[1], env);
      if (typeof sep !== "string") throw new Unsupported("reads join all with a separator not known");
      const src = node(m.args[0]), chars = src?.kind === "call" && !isUse(src as never) && target(src.fn) === "builtin.text.characters";
      const xs = chars ? target(src!.args[0]) : target(m.args[0]);
      if (!xs || !isUnknown(env.get(xs))) throw new Unsupported("reads join all of a list other than an input");
      const item = (at: number): [number, Value] | null => {
        const g = node(m.args[1]), gt = target(m.args[1]);
        if (gt === printer) { if (top.params.length !== 1) throw new Unsupported("reads the printer with other inputs in a list"); return expression(at, []); }
        const fn = gt && code.nodes[gt]?.kind === "def" ? lambdaOf(gt) : g?.kind === "lambda" ? g : undefined;
        if (!fn || fn.params.length !== 1) throw new Unsupported(`reads a list's items by ${named(gt) || "this"}`);
        // A function of one character (L72d, json's escapes): what it
        // writes for each of the first 128 characters, worked out forward
        // once, read back longest first; any other character, itself where
        // the function writes it as itself.
        if (chars) {
          const out = (c: string) => written(fn, c, env);
          const table = characterTable(fn, env);
          const hit = table.find(([o]) => text.startsWith(o, at));
          if (hit) return [at + hit[0].length, hit[1]];
          if (at >= text.length) return null;
          const c = String.fromCodePoint(text.codePointAt(at)!);
          return out(c).includes(c) ? [at + c.length, c] : null;
        }
        const r = read(fn.body, new Map(env).set(fn.params[0], { unknown: "int" }), at);
        const v = r?.[1].get(fn.params[0]);
        if (!r || v === undefined || isUnknown(v)) return null;
        return [r[0], v];
      };
      const items: Value[] = [];
      let end = at;
      for (let first = item(at); first;) {
        items.push(first[1]); end = first[0];
        if (!sep ? false : !text.startsWith(sep, end)) break;
        const next = item(end + sep.length);
        if (!next) { if (sep) expect(end + sep.length); break; }
        first = next;
        if (!sep && first[0] === end) break;
      }
      const v = chars ? items.join("") : toList(items);
      return [end, new Map(env).set(xs, v)];
    }
    if (f === printer) {
      const x = target(n.args[0]);
      if (!x || !isUnknown(env.get(x))) throw new Unsupported("reads the printer of something other than an input");
      const given = n.args.slice(1).map((a) => evaluate(a, env));
      const r = expression(at, given);
      return r && [r[0], new Map(env).set(x, r[1])];
    }
    const fn = f && code.nodes[f]?.kind === "def" ? lambdaOf(f) : node(n.fn)?.kind === "lambda" ? node(n.fn) : undefined;
    if (!fn) throw new Unsupported(`reads ${named(f) || f}`);
    const inner: Env = new Map(env);
    // An input still to be read passes in as one, and what the body reads
    // for it comes back out (L72d: json quoted(t) read for t).
    const passed: [Id, Id][] = [];
    fn.params.forEach((p, j) => {
      const x = target(n.args[j]), v = x ? env.get(x) : undefined;
      if (x && isUnknown(v)) { inner.set(p, v); passed.push([p, x]); } else inner.set(p, evaluate(n.args[j], env));
    });
    const r = read(fn.body, inner, at);
    if (!r) return null;
    const back = new Map([...env, ...[...r[1]].filter(([b]) => env.has(b))]);
    for (const [p, x] of passed) { const v = r[1].get(p); if (v !== undefined && !isUnknown(v)) back.set(x, v); }
    return [r[0], back];
  }
  // The printer read from `at` with its other inputs given: the arm the
  // next character starts, its binders read and made into the value.
  function expression(at: number, given: Value[]): [number, Value] | null {
    const first = primary(at, given);
    if (!first) return null;
    let [end, x] = first;
    // Precedence climbing: while the next operator needs no parentheses
    // at this level (its arm's condition false), it takes x as its left
    // operand and reads its right one at the level the printer gives it.
    for (let more = true; more;) {
      more = false;
      for (const f of infixes) {
        const p = spaces(end), op = f.ops.find((o) => text.startsWith(o, p));
        if (op === undefined) continue;
        const env: Env = new Map();
        top.params.slice(1).forEach((q, j) => env.set(q, given[j]));
        env.set(f.op, op);
        for (const [q, v] of f.lets) env.set(q, evaluate(v, env));
        if (f.cond && (evaluate(f.cond, env) as { tag?: Id }).tag !== FALSE) continue;
        env.set(f.left, x);
        for (const b of f.arm.binds) if (b && !env.has(b)) env.set(b, { unknown: "int" });
        const r = read(f.rest, env, end);
        if (!r) continue;
        const fields = f.arm.binds.map((b) => (b ? r[1].get(b) : undefined));
        if (fields.some((v) => v === undefined || isUnknown(v))) continue;
        [end, x] = [r[0], { tag: f.arm.variant, fields: fields as Value[] }];
        more = true;
        break;
      }
    }
    return [end, x];
  }
  // The arms that don't start with the printer itself.
  function primary(at: number, given: Value[]): [number, Value] | null {
    for (const a of arms) {
      if (!starts(a.variant, text[at])) { for (const c of firsts.get(a.variant)!) if (c !== "itself" && c !== "anything") expect(at, described(c)); continue; }
      const env: Env = new Map();
      top.params.slice(1).forEach((p, j) => env.set(p, given[j]));
      // An arm's binders start unknown: show reads an Int, a guard says
      // what a Text holds.
      for (const b of a.binds) if (b) env.set(b, { unknown: "int" });
      const r = read(a.body, env, at);
      if (!r) continue;
      const fields = a.binds.map((b) => (b ? r[1].get(b) : undefined));
      if (fields.some((v) => v === undefined || isUnknown(v))) continue;
      return [r[0], { tag: a.variant, fields: fields as Value[] }];
    }
    // An infix operator's own parentheses: what it prints inside them is
    // read as the whole line is, from the lowest level.
    if (infixes.length && text[at] === "(") {
      const r = expression(at + 1, outermost);
      if (r && text[r[0]] === ")") return [r[0] + 1, r[1]];
      if (r) expect(r[0], '")"');
    } else if (infixes.length) expect(at, '"("');
    return null;
  }
  let outermost: Value[] = [];
  const reader = (line: string, ...given: Value[]) => {
    text = line;
    outermost = given;
    stopped.at = 0;
    stopped.expected = new Set();
    const r = expression(0, given);
    if (r && r[0] === line.length) return r[1];
    if (r) expect(r[0]);
    return null;
  };
  // For reader.ts: a definition of one character's table (L72d2).
  const tableOf = (def: Id) => { const fn = lambdaOf(def); if (!fn || fn.params.length !== 1) throw new Unsupported(`reads a list's items by ${named(def)}`); return characterTable(fn); };
  return Object.assign(reader, { stopped, characterTable: tableOf });
}

// A solve the evaluator would search that reads by descent instead (C110
// s6): a printer run backwards for its first input, its others given, or
// the prelude's `applied` (what inverse solves) given `e ↦ F(e, …)` with F
// a printer and the rest of its inputs known. Its answers, one or none;
// null where the solve isn't one of these, or descent can't read the
// printer, so the search reads it as before.
const readers = new WeakMap<Code, Map<Id, ReturnType<typeof descentReader> | null>>();
function readerFor(code: Code, f: Id, names: Record<Id, string>) {
  let m = readers.get(code);
  if (!m) readers.set(code, (m = new Map()));
  if (!m.has(f)) {
    let r: ReturnType<typeof descentReader> | null = null;
    try { r = descentReader(code, f, names); } catch { r = null; }
    m.set(f, r);
  }
  return m.get(f)!;
}
export function readByDescent(code: Code, n: Use, known: Record<string, unknown>, names: Record<Id, string>, stuck?: (r: Reading) => void): Value[][] | null {
  const node = (id: Id | undefined) => (id ? (code.nodes[id] as unknown as Any | undefined) : undefined);
  const lambdaOf = (def: Id) => { const d = node(def); return d?.kind === "def" ? node(d.body) : undefined; };
  const keys = answerKeys(code, n), out = known.out;
  if (keys.length !== 1 || typeof out !== "string") return null;
  const f = useTarget(code.nodes, n), fn = lambdaOf(f);
  if (fn?.kind !== "lambda") return null;
  let printer: Id, given: Value[];
  if (keys[0] === fn.params[0] && fn.params.slice(1).every((q) => q in known)) {
    printer = f;
    given = fn.params.slice(1).map((q) => known[q] as Value);
  } else {
    // applied: (g, x) ↦ g(x), g given and x asked.
    const call = node(fn.body);
    if (fn.params.length !== 2 || keys[0] !== fn.params[1] || call?.kind !== "call" || isUse(call as never) || node(call.fn)?.kind !== "ref" || node(call.fn)!.target !== fn.params[0]) return null;
    const meta = (known[fn.params[0]] as unknown as Record<symbol, { lambda?: Id; env?: Map<Id, Value> }> | undefined)?.[META];
    const lam = node(meta?.lambda), body = node(lam?.body);
    if (!meta?.env || lam?.kind !== "lambda" || lam.params.length !== 1 || body?.kind !== "call" || isUse(body as never)) return null;
    const head = node(body.fn), first = node(body.args[0]);
    if (head?.kind !== "ref" || first?.kind !== "ref" || first.target !== lam.params[0]) return null;
    printer = head.target;
    const vals: Value[] = [];
    for (const a of body.args.slice(1)) {
      const x = node(a) as (Any & { of?: unknown }) | undefined;
      if (x?.kind === "lit") vals.push(x.of === INT ? intLit(x.value as number) : (x.value as Value));
      else if (x?.kind === "ref" && meta.env.has(x.target)) vals.push(meta.env.get(x.target)!);
      else return null;
    }
    given = vals;
  }
  const read = readerFor(code, printer, names);
  if (!read) return null;
  try {
    const v = read(out, ...given);
    if (v === null) stuck?.({ text: out, at: read.stopped.at, expected: new Set(read.stopped.expected), found: new Map() });
    return v === null ? [] : [[v]];
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
}
