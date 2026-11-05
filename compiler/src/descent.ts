// A printer read backwards by recursive descent (C110 s3,
// docs/design/relations-and-effects/GRAMMAR-DESCENT-2026-11-05.md): the
// text is read left to right once, each arm picked by the next character
// from its first set (first-sets.ts), each piece of the arm's Text read in
// turn, instead of relate.ts searching every way the printer could have
// printed it. Step 3 reads printers with no left recursion: an arm that
// starts with the printer itself is left out here (step 4 reads it by
// precedence climbing), so a line that needs it has no reading.
//
// The pieces read, each as relate.ts's grammar pieces read them (the
// prelude's `spaced` any spaces around, none too; `optional parens` the
// text with any number of parentheses round it, none too):
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

import type { Code, Id } from "../../ters/src/model.ts";
import { isUse } from "../../ters/src/model.ts";
import { FALSE, TRUE } from "../../ters/src/lang/std.ts";
import type { Value } from "../../ters/src/lang/run.ts";
import { firstSets } from "./first-sets.ts";

export class Unsupported extends Error {}

type Any = { kind: string; target: Id; value: unknown; fn: Id; args: Id[]; params: Id[]; body: Id; scrutinee: Id; arms: Id[]; variant: Id; binds: (Id | null)[] };
type Env = Map<Id, Value | { unknown: "letters" | "digits" | "int" }>;
const isUnknown = (v: unknown): v is { unknown: string } => typeof v === "object" && v !== null && "unknown" in v;
const LETTER = /[A-Za-z]/, DIGIT = /[0-9]/;
const TRUE_V: Value = { tag: TRUE, fields: [] }, FALSE_V: Value = { tag: FALSE, fields: [] };

export function descentReader(code: Code, printer: Id, names: Record<Id, string>): (text: string, ...given: Value[]) => Value | null {
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
    return c === "(" || f.has(c) || f.has("anything") || (f.has("digit") && DIGIT.test(c)) || (f.has("letter") && LETTER.test(c));
  };

  let text = "";
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
    if (n.kind !== "call" || isUse(n as never)) throw new Unsupported(`can't work out a ${n.kind}`);
    const f = target(n.fn), xs = () => n.args.map((a) => evaluate(a, env));
    const bool = (b: boolean) => (b ? TRUE_V : FALSE_V), truth = (v: Value) => (v as { tag?: Id }).tag === TRUE;
    switch (f) {
      case "builtin.int.less": { const [a, b] = xs(); return bool((a as number) < (b as number)); }
      case "builtin.int.add": { const [a, b] = xs(); return (a as number) + (b as number); }
      case "builtin.int.sub": { const [a, b] = xs(); return (a as number) - (b as number); }
      case "builtin.and": return bool(truth(evaluate(n.args[0], env)) && truth(evaluate(n.args[1], env)));
      case "builtin.text.length": return [...(evaluate(n.args[0], env) as string)].length;
    }
    if (named(f) === "all pass") {
      const ch = node(n.args[0]), test = named(target(n.args[1]));
      if (ch?.kind === "call" && target(ch.fn) === "builtin.text.characters" && (test === "is letter" || test === "is digit")) {
        const t = evaluate(ch.args[0], env) as string;
        return bool([...t].every((c) => (test === "is letter" ? LETTER : DIGIT).test(c)));
      }
    }
    throw new Unsupported(`can't work out ${named(f) || f}`);
  }
  // What a guard being true says a Text binder holds (first-sets.ts facts).
  function hint(cond: Id, out: Map<Id, "letters" | "digits">) {
    const n = node(cond);
    if (n?.kind !== "call") return;
    const f = target(n.fn);
    if (f === "builtin.and") { hint(n.args[0], out); hint(n.args[1], out); }
    if (named(f) === "all pass") {
      const ch = node(n.args[0]), test = named(target(n.args[1])), t = ch?.kind === "call" && target(ch.fn) === "builtin.text.characters" ? target(ch.args[0]) : null;
      if (t && test === "is letter") out.set(t, "letters");
      if (t && test === "is digit") out.set(t, "digits");
    }
  }
  const spaces = (at: number) => { while (text[at] === " ") at++; return at; };

  // Read the Text id prints from `at`: where it ends, the binders it
  // gave values, or null.
  function read(id: Id, env: Env, at: number): [number, Env] | null {
    const n = node(id);
    if (!n) return null;
    if (n.kind === "lit") { const s = String(n.value); return text.startsWith(s, at) ? [at + s.length, env] : null; }
    if (n.kind === "ref") {
      const v = env.get(n.target);
      if (v === undefined) throw new Unsupported(`reads ${named(n.target)}, which nothing says the characters of`);
      if (!isUnknown(v)) return typeof v === "string" && text.startsWith(v, at) ? [at + v.length, env] : null;
      if (v.unknown === "int") throw new Unsupported(`reads ${named(n.target)} as text`);
      const re = v.unknown === "letters" ? LETTER : DIGIT;
      let end = at;
      while (end < text.length && re.test(text[end])) end++;
      return [end, new Map(env).set(n.target, text.slice(at, end))];
    }
    if (n.kind === "match") {
      // Each arm that prints something, then its guard checked.
      for (const a of n.arms.map((x) => node(x)!)) {
        const inner = new Map(env);
        if (a.variant === TRUE) { const h = new Map<Id, "letters" | "digits">(); hint(n.scrutinee, h); for (const [b, k] of h) if (isUnknown(inner.get(b))) inner.set(b, { unknown: k }); }
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
      if (end === digits) return null;
      const v = Number(text.slice(at, end));
      return [end, new Map(env).set(b, Number.isSafeInteger(v) ? v : BigInt(text.slice(at, end)))];
    }
    if (named(f) === "spaced") { const r = read(n.args[0], env, spaces(at)); return r && [spaces(r[0]), r[1]]; }
    // Any number of parentheses round it, as the search reads them.
    if (named(f) === "optional parens") {
      const parens = (at: number): [number, Env] | null => {
        if (text[at] === "(") {
          const r = parens(at + 1);
          if (r && text[r[0]] === ")") return [r[0] + 1, r[1]];
        }
        return read(n.args[1], env, at);
      };
      return parens(at);
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
    fn.params.forEach((p, j) => inner.set(p, evaluate(n.args[j], env)));
    const r = read(fn.body, inner, at);
    return r && [r[0], new Map([...env, ...[...r[1]].filter(([b]) => env.has(b))])];
  }
  // The printer read from `at` with its other inputs given: the arm the
  // next character starts, its binders read and made into the value.
  function expression(at: number, given: Value[]): [number, Value] | null {
    for (const a of arms) {
      if (!starts(a.variant, text[at])) continue;
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
    return null;
  }
  return (line, ...given) => {
    text = line;
    const r = expression(0, given);
    return r && r[0] === line.length ? r[1] : null;
  };
}
