// A printer's reader written as a definition in the language (C110 s7a,
// GRAMMAR-DESCENT-2026-11-05.md "step 7"): what descent.ts does by walking
// the printer's nodes for each line, written out once as code, so every
// target can run it with the Text operations it already has: the arms
// that don't start with the printer itself (calc's literal, variable and
// negative, and parentheses, s7a) as `read <printer> primary`, and the
// infix arms by precedence climbing (s7b) as `read <printer> operators`.
//
// The reader, `read <printer>(text, at, given…, top…)`, gives
// `some((at after, value))` or `none`: a primary, then the operators after
// it. A primary is each arm tried in turn, its pieces
// read left to right, each one's continuation written after it (so an arm
// whose guard picks among ways tries each way with the rest of the arm
// after it); then "(" with the whole printer read inside at the outermost
// inputs (`top`), and ")". `read <printer> line(text, given…)` reads a
// whole line: the reading that ends at its end, or none.
//
// The pieces, as descent.ts reads them: a literal; `++`; show of a whole
// number (an optional "-" and digits); a Text binder a guard says is all
// letters or digits (the longest such run); `spaced` (any spaces round
// it); `optional parens` (needing none, the arm itself; needing some, the
// parentheses path above); a call of the printer itself (the reader,
// recursively); a match on a guard (each arm, its guard checked on what
// was read). A guard, and what the printer is given, are copied in with
// what was read in place of the arm's binders.

import type { Code, Id } from "../model.ts";
import { isUse } from "../model.ts";
import { Lang } from "./dsl.ts";
import { FALSE, INT_OPS, NONE, S, SOME, TEXT_OPS, TRUE, tupleVariant } from "./std.ts";
import { firstSets } from "./first-sets.ts";
import { infixesOf, Unsupported } from "./descent.ts";
import { INT } from "./types.ts";

type Any = { id: Id; kind: string; target: Id; value: unknown; of?: Id; fn: Id; args: Id[]; params: Id[]; body: Id; scrutinee: Id; arms: Id[]; variant: Id; binds: (Id | null)[] };
// What a binder of an arm stands for in the reader: an expression's binder
// once read, or still to be read (as a number, or as a run of letters or
// digits).
type Slot = { b: Id } | { unknown: "int" | "letters" | "digits" };
type Env = Map<Id, Slot>;

export interface Written { code: Code; names: Record<Id, string>; read: Id; line: Id }

export function writeReader(code: Code, printer: Id, names: Record<Id, string>): Written {
  const node = (id: Id | undefined) => (id ? (code.nodes[id] as unknown as Any | undefined) : undefined);
  const target = (id: Id): Id | null => { const n = node(id); return n?.kind === "ref" ? n.target : null; };
  const named = (id: Id | null) => (id ? names[id] ?? "" : "");
  const lambdaOf = (def: Id) => { const d = node(def); const b = d?.body ? node(d.body) : undefined; return b?.kind === "lambda" ? b : undefined; };
  const top = lambdaOf(printer);
  const body = top && node(top.body);
  if (!top || body?.kind !== "match") throw new Unsupported(`${named(printer)} isn't a printer`);
  const report = firstSets(code, printer, names);
  // Arms that start with the printer itself: infix operators, read by
  // precedence climbing (descent.ts `Infix`, s7b).
  const left = new Set(report.leftRecursive);
  const infixes = infixesOf(code, printer, names, report);
  const given = top.params.slice(1);

  const k = new Lang(code);
  const title = named(printer) || "printer";
  const read = k.def(`read ${title}`), primary = k.def(`read ${title} primary`), more = k.def(`read ${title} operators`), line = k.def(`read ${title} line`), run = k.def(`run of`), spaces = k.def(`spaces from`);
  const none = () => k.x(NONE);
  const some = (at: Id, v: Id) => k.call(SOME, k.call(tupleVariant(2), at, v));
  const plus = (a: Id, n: number) => k.call(INT_OPS.add, a, k.int(n));
  const at1 = (text: Id, at: Id) => k.call(TEXT_OPS.slice, text, at, plus(at, 1));
  // A test of the Text at `at`, as long as s.
  const startsWith = (text: Id, at: Id, s: Id, len: Id) => k.call(S.equal, k.call(TEXT_OPS.slice, text, at, k.call(INT_OPS.add, at, len)), s);
  // Take an Optional (at, value) apart: none, or the continuation.
  const then = (r: Id, f: (at: Id, v: Id) => Id) => k.match(r, [
    { variant: SOME, names: ["read"], body: ([p]) => k.match(k.x(p), [{ variant: tupleVariant(2), names: ["at", "value"], body: ([a, v]) => f(a, v) }]) },
    { variant: NONE, names: [], body: () => none() },
  ]);
  // The first of two readings that is one.
  const orElse = (a: Id, b: Id) => k.match(a, [
    { variant: SOME, names: ["read"], body: ([p]) => k.call(SOME, p) },
    { variant: NONE, names: [], body: () => b },
  ]);

  // run of(text, at, test): past the characters from at that pass test.
  k.define(run, k.fn(["text", "at", "test"], (text, at, test) =>
    k.if(k.call(INT_OPS.less, at, k.call(TEXT_OPS.length, text)),
      k.if(k.call(test, at1(text, at)), k.call(run, text, plus(at, 1), test), k.x(at)),
      k.x(at))));
  k.define(spaces, k.fn(["text", "at"], (text, at) =>
    k.call(run, text, at, k.fn(["c"], (c) => k.call(S.equal, c, k.lit(" "))))));
  const prelude = (name: string) => Object.keys(names).find((d) => names[d] === name && code.nodes[d]?.kind === "def");
  const isLetter = prelude("is letter"), isDigit = prelude("is digit");

  // An expression of the printer's, copied in with what was read.
  const copy = (id: Id, env: Env, inputs: Map<Id, Id>): Id => {
    const n = node(id);
    if (!n) throw new Unsupported(`no node ${id}`);
    if (n.kind === "lit") return n.of === INT ? k.int(n.value as number) : k.lit(n.value as string);
    if (n.kind === "ref") {
      const s = env.get(n.target);
      if (s) { if ("b" in s) return k.x(s.b); throw new Unsupported(`${named(n.target)} isn't read yet`); }
      const i = inputs.get(n.target);
      if (i) return k.x(i);
      return k.x(n.target);
    }
    if (n.kind === "call" && !isUse(n as never)) return k.call(copy(n.fn, env, inputs), ...n.args.map((a) => copy(a, env, inputs)));
    if (n.kind === "match") {
      const arms = n.arms.map((a) => node(a)! as Any & { value?: Id }), otherwise = (n as unknown as { otherwise?: Id | null }).otherwise;
      const other = otherwise ? copy(otherwise, env, inputs) : undefined;
      if (arms.some((a) => a.binds.length)) throw new Unsupported("copies a match with fields");
      // A match on values (L164c): each arm a literal.
      if (arms.some((a) => a.value)) return k.byValue(copy(n.scrutinee, env, inputs), arms.map((a) => [copy(a.value!, env, inputs), copy(a.body, env, inputs)]), other);
      return k.match(copy(n.scrutinee, env, inputs), arms.map((a) => ({ variant: a.variant, names: [], body: () => copy(a.body, env, inputs) })), other);
    }
    throw new Unsupported(`copies a ${n.kind}`);
  };
  // What a guard being true says a Text binder holds (as descent.ts hint).
  const hint = (cond: Id, env: Env) => {
    const n = node(cond);
    if (n?.kind !== "call") return;
    if (target(n.fn) === "builtin.and") { hint(n.args[0], env); hint(n.args[1], env); }
    if (named(target(n.fn)) === "all pass") {
      const ch = node(n.args[0]), test = named(target(n.args[1])), t = ch?.kind === "call" && target(ch.fn) === "builtin.text.characters" ? target(ch.args[0]) : null;
      const s = t ? env.get(t) : undefined;
      if (t && s && !("b" in s) && test === "is letter") env.set(t, { unknown: "letters" });
      if (t && s && !("b" in s) && test === "is digit") env.set(t, { unknown: "digits" });
    }
  };

  // Read the Text `id` prints from `at`, then go on with `next`.
  type Next = (at: Id, env: Env) => Id;
  const piece = (id: Id, text: Id, at: Id, env: Env, inputs: Map<Id, Id>, tops: Id[], next: Next): Id => {
    const n = node(id);
    if (!n) throw new Unsupported(`no node ${id}`);
    if (n.kind === "lit") {
      const s = String(n.value);
      return k.if(startsWith(text, at, k.lit(s), k.int([...s].length)), k.let("at", plus(at, [...s].length), (a) => next(a, env)), none());
    }
    if (n.kind === "ref") {
      const s = env.get(n.target);
      if (!s) {
        const i = inputs.get(n.target);
        if (!i) throw new Unsupported(`reads ${named(n.target)}, which nothing says the characters of`);
        return k.if(startsWith(text, at, k.x(i), k.call(TEXT_OPS.length, i)), k.let("at", k.call(INT_OPS.add, at, k.call(TEXT_OPS.length, i)), (a) => next(a, env)), none());
      }
      if ("b" in s) return k.if(startsWith(text, at, k.x(s.b), k.call(TEXT_OPS.length, s.b)), k.let("at", k.call(INT_OPS.add, at, k.call(TEXT_OPS.length, s.b)), (a) => next(a, env)), none());
      if (s.unknown === "int") throw new Unsupported(`reads ${named(n.target)} as text`);
      const test = s.unknown === "letters" ? isLetter : isDigit;
      if (!test) throw new Unsupported("no is letter or is digit");
      return k.let("end", k.call(run, text, at, test), (end) =>
        k.let(named(n.target) || "run", k.call(TEXT_OPS.slice, text, at, end), (v) => next(end, new Map(env).set(n.target, { b: v }))));
    }
    if (n.kind === "match") {
      // Each arm of the guard, read, then the guard checked.
      const ways = n.arms.map((x) => node(x)!).map((a) => {
        if (a.variant !== TRUE && a.variant !== FALSE) throw new Unsupported("reads a match that isn't on a Bool");
        const inner = new Map(env);
        if (a.variant === TRUE) hint(n.scrutinee, inner);
        return piece(a.body, text, at, inner, inputs, tops, (a2, env2) => {
          const cond = copy(n.scrutinee, env2, inputs);
          return a.variant === TRUE ? k.if(cond, next(a2, env2), none()) : k.if(cond, none(), next(a2, env2));
        });
      });
      return ways.reduceRight((rest, w) => orElse(w, rest));
    }
    if (n.kind !== "call" || isUse(n as never)) throw new Unsupported(`reads a ${n.kind}`);
    const f = target(n.fn);
    if (f === "builtin.fail") return none();
    if (f === "builtin.concat") return piece(n.args[0], text, at, env, inputs, tops, (a, e) => piece(n.args[1], text, a, e, inputs, tops, next));
    if (f === "builtin.int.show") {
      const b = target(n.args[0]), s = b ? env.get(b) : undefined;
      if (!b || !s || "b" in s) throw new Unsupported("reads show of something other than an input");
      return k.let("digits", k.if(k.call(S.equal, at1(text, at), k.lit("-")), plus(at, 1), k.x(at)), (from) =>
        k.let("end", k.call(run, text, from, isDigit!), (end) =>
          k.if(k.call(INT_OPS.less, from, end),
            k.let(named(b) || "number", k.call(INT_OPS.read, k.call(TEXT_OPS.slice, text, at, end)), (v) => next(end, new Map(env).set(b, { b: v }))),
            none())));
    }
    if (named(f) === "spaced") return k.let("at", k.call(spaces, text, at), (a) => piece(n.args[0], text, a, env, inputs, tops, (a2, e) => k.let("at", k.call(spaces, text, a2), (a3) => next(a3, e))));
    // Needing no parentheses, the arm itself; needing some, the reader's
    // own parentheses path reads it (at the outermost inputs, where it
    // needs none).
    if (named(f) === "optional parens") return k.if(copy(n.args[0], env, inputs), none(), piece(n.args[1], text, at, env, inputs, tops, next));
    if (f === printer) {
      const x = target(n.args[0]), s = x ? env.get(x) : undefined;
      if (!x || !s || "b" in s) throw new Unsupported("reads the printer of something other than an input");
      return then(k.call(read, text, at, ...n.args.slice(1).map((a) => copy(a, env, inputs)), ...tops), (a, v) => next(a, new Map(env).set(x, { b: v })));
    }
    // Another definition, or a function written in place, read through its
    // body with its inputs copied in.
    const fn = f && code.nodes[f]?.kind === "def" ? lambdaOf(f) : node(n.fn)?.kind === "lambda" ? node(n.fn) : undefined;
    if (!fn) throw new Unsupported(`reads ${named(f) || f}`);
    const lets = fn.params.map((p, j) => [p, copy(n.args[j], env, inputs)] as const);
    const go = (i: number, ins: Map<Id, Id>): Id => i === lets.length ? piece(fn.body, text, at, env, ins, tops, next)
      : k.let(named(lets[i][0]) || "x", lets[i][1], (b) => go(i + 1, new Map(ins).set(lets[i][0], b)));
    return go(0, inputs);
  };

  const params = ["text", "at", ...given.map((g) => named(g) || "given"), ...given.map((g) => `top ${named(g) || "given"}`)];
  // The printer read from `at`: a primary, then the operators after it.
  k.define(read, k.fn(params, (text, at, ...rest) =>
    then(k.call(primary, text, at, ...rest), (a, x) => k.call(more, text, a, x, ...rest))));
  // While the next operator needs no parentheses at this level (its arm's
  // condition false), it takes x as its left operand and reads its right
  // one at the level the printer gives it; then on from there. Otherwise
  // x, as read.
  k.define(more, k.fn(["text", "at", "left so far", ...params.slice(2)], (text, at, x, ...rest) => {
    const ins = rest.slice(0, given.length), tops = rest.slice(given.length);
    const ways = infixes.map((f) => k.let("at", k.call(spaces, text, at), (p) => f.ops.reduceRight<Id>((otherwise, op) =>
      k.if(startsWith(text, p, k.lit(op), k.int([...op].length)), k.let(named(f.op) || "op", k.lit(op), (o) => {
        const lets = (i: number, inputs: Map<Id, Id>): Id => i < f.lets.length
          ? k.let(named(f.lets[i][0]) || "x", copy(f.lets[i][1], new Map(), inputs), (b) => lets(i + 1, new Map(inputs).set(f.lets[i][0], b)))
          : k.if(f.cond ? copy(f.cond, new Map(), inputs) : k.x(FALSE), none(), (() => {
            const env: Env = new Map(f.arm.binds.filter((b): b is Id => !!b && b !== f.left && b !== f.op).map((b) => [b, { unknown: "int" }]));
            env.set(f.left, { b: x });
            env.set(f.op, { b: o });
            return piece(f.rest, text, at, env, inputs, tops, (end, e) => {
              const fields = f.arm.binds.map((b) => { const sl = b ? e.get(b) : undefined; if (!sl || !("b" in sl)) throw new Unsupported(`${named(f.arm.variant)} doesn't read all its fields`); return k.x(sl.b); });
              return k.call(more, text, end, k.call(f.arm.variant, ...fields), ...rest);
            });
          })());
        return lets(0, new Map([...given.map((g, j) => [g, ins[j]] as const), [f.op, o] as const]));
      }), otherwise), none())));
    return [...ways, some(k.x(at), k.x(x))].reduceRight((r, w) => orElse(w, r));
  }));
  k.define(primary, k.fn(params, (text, at, ...rest) => {
    const ins = rest.slice(0, given.length), tops = rest.slice(given.length);
    const inputs = new Map(given.map((g, j) => [g, ins[j]] as const));
    const arms = body.arms.map((a) => node(a)!).filter((a) => !left.has(names[a.variant] ?? a.variant)).map((a) => {
      const env: Env = new Map(a.binds.filter((b): b is Id => !!b).map((b) => [b, { unknown: "int" }]));
      return piece(a.body, text, at, env, inputs, tops, (end, e) => {
        const fields = a.binds.map((b) => { const s = b ? e.get(b) : undefined; if (!s || !("b" in s)) throw new Unsupported(`${named(a.variant)} doesn't read all its fields`); return k.x(s.b); });
        return some(end, fields.length ? k.call(a.variant, ...fields) : k.x(a.variant));
      });
    });
    // "(", the whole printer at its outermost inputs, ")".
    const parens = k.if(k.call(S.equal, at1(text, at), k.lit("(")),
      then(k.call(read, text, plus(at, 1), ...tops, ...tops), (a, v) => k.if(k.call(S.equal, at1(text, a), k.lit(")")), some(plus(a, 1), v), none())),
      none());
    return [...arms, parens].reduceRight((rest, w) => orElse(w, rest));
  }));
  k.define(line, k.fn(["text", ...given.map((g) => named(g) || "given")], (text, ...ins) =>
    then(k.call(read, text, k.int(0), ...ins, ...ins), (a, v) => k.if(k.call(S.equal, a, k.call(TEXT_OPS.length, text)), k.call(SOME, v), none()))));
  return { code: k.code, names: k.names, read, line };
}
