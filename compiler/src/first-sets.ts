// What each arm of a printer can print first (C110 s2,
// docs/design/relations-and-effects/GRAMMAR-DESCENT-2026-11-05.md). A
// printer is a definition whose first input is matched on, one arm per
// case, each giving Text. Read backwards, an arm can be picked from the
// next character when the arms' first sets are disjoint (LL(1)); an arm
// that starts with the printer itself is left recursion, which
// precedence climbing reads (step s4). A report only: nothing is compiled
// from it yet.
//
// The sets are found by reading each arm's Text: a literal gives its first
// character, `++` its left side's (and its right's when the left may be
// empty), show of a whole number a digit (or "-" unless the number is known
// not to be below 0), a Text the arm has checked is all letters (or all
// digits) a letter (a digit), a call of the printer itself "itself", a
// definition called with what it is given read through its body, a match
// each arm it can take, and fail nothing. Anything else may start with
// anything.

import type { Code, Id } from "../../ters/src/model.ts";
import { isUse } from "../../ters/src/model.ts";
import { FALSE, TRUE } from "../../ters/src/lang/std.ts";

// The first characters: single characters, or the classes "digit" and
// "letter", "itself" for the printer's own call, "anything"; `empty`: it
// may print nothing, so what follows counts too; `none`: it never prints
// (every way fails).
export interface First { starts: Set<string>; empty: boolean; none?: true }

export interface ArmFirst { variant: Id; name: string; first: string[] }
export interface FirstReport {
  arms: ArmFirst[];
  // Two arms and what both can start with.
  overlaps: [string, string, string[]][];
  // The arms that start with the printer itself.
  leftRecursive: string[];
}

type Abs = { k: "text"; f: First } | { k: "bool"; v: boolean } | { k: "int"; nonNegative: boolean } | { k: "other" };
// What a guard told an arm of a binder: all letters, all digits, not
// empty, not below 0.
interface Fact { letters?: true; digits?: true; nonEmpty?: true; nonNegative?: true }

const ANY: First = { starts: new Set(["anything"]), empty: true };
const NONE: First = { starts: new Set(), empty: false, none: true };
const one = (c: string): First => ({ starts: new Set([c]), empty: false });
const union = (a: First, b: First): First => (a.none ? b : b.none ? a : { starts: new Set([...a.starts, ...b.starts]), empty: a.empty || b.empty });
const then = (a: First, b: First): First => (a.none || b.none ? NONE : a.empty ? { starts: new Set([...a.starts, ...b.starts]), empty: b.empty } : a);

export function firstSets(code: Code, printer: Id, names: Record<Id, string>): FirstReport {
  // Any node, read by its kind.
  type Any = { kind: string; target: Id; value: unknown; fn: Id; args: Id[]; params: Id[]; body: Id; scrutinee: Id; arms: Id[]; variant: Id };
  const node = (id: Id) => code.nodes[id] as unknown as Any | undefined;
  const target = (id: Id): Id | null => { const n = node(id); return n?.kind === "ref" ? n.target : null; };
  const lambdaOf = (def: Id) => { const d = code.nodes[def] as { body?: Id } | undefined; const b = d?.body ? node(d.body) : undefined; return b?.kind === "lambda" ? b : undefined; };
  const named = (id: Id | null) => (id ? names[id] ?? "" : "");

  // What a condition being `truth` says about the binders in it.
  function facts(cond: Id, truth: boolean, env: Map<Id, Abs>, out: Map<Id, Fact>) {
    const n = node(cond);
    if (n?.kind !== "call" || isUse(n as never)) return;
    const f = target(n.fn), [a, b] = n.args;
    const add = (x: Id | null, fact: Fact) => { if (x) out.set(x, { ...out.get(x), ...fact }); };
    if (f === "builtin.and" && truth) { facts(a, true, env, out); facts(b, true, env, out); }
    // x < 0 false: x isn't below 0. 0 < length(t) true: t isn't empty.
    if (f === "builtin.int.less" && !truth && node(b)?.kind === "lit" && Number(node(b)!.value) === 0) add(target(a), { nonNegative: true });
    if (f === "builtin.int.less" && truth && node(a)?.kind === "lit" && Number(node(a)!.value) === 0) {
      const l = node(b);
      if (l?.kind === "call" && !isUse(l as never) && target(l.fn) === "builtin.text.length") add(target(l.args[0]), { nonEmpty: true });
    }
    // all pass(characters(t), is letter) true: t is all letters.
    if (truth && named(f) === "all pass") {
      const ch = node(a), test = named(target(b));
      if (ch?.kind === "call" && !isUse(ch as never) && target(ch.fn) === "builtin.text.characters") {
        if (test === "is letter") add(target(ch.args[0]), { letters: true });
        if (test === "is digit") add(target(ch.args[0]), { digits: true });
      }
    }
  }

  function value(id: Id, env: Map<Id, Abs>, depth: number): Abs {
    const n = node(id);
    if (!n) return { k: "other" };
    if (n.kind === "lit") return typeof n.value === "string" ? { k: "text", f: n.value === "" ? { starts: new Set(), empty: true } : one([...n.value][0]) } : { k: "other" };
    if (n.kind === "ref") {
      if (n.target === TRUE || n.target === FALSE) return { k: "bool", v: n.target === TRUE };
      return env.get(n.target) ?? { k: "other" };
    }
    if (n.kind === "match") {
      const s = value(n.scrutinee, env, depth);
      let f: First | null = null;
      for (const a of n.arms.map((x) => node(x)!)) {
        if (s.k === "bool" && a.variant !== (s.v ? TRUE : FALSE)) continue;
        const known = new Map<Id, Fact>();
        if (a.variant === TRUE || a.variant === FALSE) facts(n.scrutinee, a.variant === TRUE, env, known);
        const inner = new Map(env);
        for (const [b, fact] of known) inner.set(b, refined(env.get(b), fact));
        const v = value(a.body, inner, depth);
        if (v.k !== "text") return v.k === "bool" || v.k === "int" ? { k: "other" } : v;
        f = f ? union(f, v.f) : v.f;
      }
      return f ? { k: "text", f } : { k: "other" };
    }
    if (n.kind !== "call" || isUse(n as never)) return { k: "other" };
    const f = target(n.fn);
    const text = (x: Id) => { const v = value(x, env, depth); return v.k === "text" ? v.f : ANY; };
    if (f === "builtin.concat") return { k: "text", f: then(text(n.args[0]), text(n.args[1])) };
    if (f === "builtin.fail") return { k: "text", f: NONE };
    if (f === "builtin.int.show") { const v = value(n.args[0], env, depth); return { k: "text", f: v.k === "int" && v.nonNegative ? one("digit") : union(one("digit"), one("-")) }; }
    if (f === printer) return { k: "text", f: one("itself") };
    // A definition, or a function written in place, read through its body
    // with what it is given.
    const fn = f && code.nodes[f]?.kind === "def" ? lambdaOf(f) : node(n.fn)?.kind === "lambda" ? node(n.fn) : undefined;
    if (!fn || depth > 8) return { k: "other" };
    const inner = new Map(env);
    fn.params.forEach((p, j) => n.args[j] && inner.set(p, value(n.args[j], env, depth + 1)));
    return value(fn.body, inner, depth + 1);
  }
  // A binder an arm's guard said more about.
  function refined(was: Abs | undefined, fact: Fact): Abs {
    if (fact.nonNegative) return { k: "int", nonNegative: true };
    const cls = fact.letters ? "letter" : fact.digits ? "digit" : null;
    if (cls) return { k: "text", f: { starts: new Set([cls]), empty: !fact.nonEmpty } };
    return was ?? { k: "other" };
  }

  const fn = lambdaOf(printer);
  const body = fn && node(fn.body);
  if (!fn || body?.kind !== "match" || target(body.scrutinee) !== fn.params[0]) throw new Error(`${names[printer] ?? printer} isn't a printer: its first input isn't matched on`);
  const arms = body.arms.map((x) => node(x)!).map((a): ArmFirst & { set: First } => {
    const v = value(a.body, new Map(), 0);
    // An arm whose value isn't read as Text: not a printer (pedal's
    // haar join run backwards, a solve on a function over lists).
    if (v.k !== "text") throw new Error(`${names[printer] ?? printer} isn't a printer: ${names[a.variant] ?? a.variant} doesn't give Text`);
    const set = v.f;
    return { variant: a.variant, name: names[a.variant] ?? a.variant, first: [...set.starts].sort(), set };
  });
  const overlaps: [string, string, string[]][] = [];
  arms.forEach((a, i) => arms.slice(i + 1).forEach((b) => {
    const both = a.first.filter((c) => b.set.starts.has(c) || b.set.starts.has("anything") || a.first.includes("anything"));
    if (both.length) overlaps.push([a.name, b.name, both]);
  }));
  return { arms: arms.map(({ set: _, ...a }) => a), overlaps, leftRecursive: arms.filter((a) => a.set.starts.has("itself")).map((a) => a.name) };
}
