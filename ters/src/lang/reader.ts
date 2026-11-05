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
import { CONS, FALSE, INT_OPS, NIL, NONE, S, SOME, TEXT_OPS, TRUE, tupleVariant } from "./std.ts";
import { firstSets } from "./first-sets.ts";
import { descentReader, infixesOf, Unsupported } from "./descent.ts";
import { INT } from "./types.ts";

type Any = { id: Id; kind: string; target: Id; value: unknown; of?: Id; fn: Id; args: Id[]; params: Id[]; body: Id; scrutinee: Id; arms: Id[]; variant: Id; binds: (Id | null)[] };
// What a binder of an arm stands for in the reader: an expression's binder
// once read, or still to be read (as a number, or as a run of letters or
// digits, or of characters the program's own test passes, C110 s5a).
type Slot = { b: Id } | { unknown: "int" | "letters" | "digits" } | { pass: Id };
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
  // The one of two readings that reads farther, the first if they tie
  // (L72e2b, as descent.ts reads a Choice).
  const atOf = (p: Id, f: (at: Id) => Id) => k.match(k.x(p), [{ variant: tupleVariant(2), names: ["at", "value"], body: ([a]) => f(a) }]);
  const farther = (a: Id, b: Id) => k.match(a, [
    { variant: SOME, names: ["read"], body: ([p]) => k.match(b, [
      { variant: SOME, names: ["other"], body: ([q]) => atOf(p, (pa) => atOf(q, (qa) => k.if(k.call(INT_OPS.less, pa, qa), k.call(SOME, q), k.call(SOME, p)))) },
      { variant: NONE, names: [], body: () => k.call(SOME, p) },
    ]) },
    { variant: NONE, names: [], body: () => b },
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
    // A function written in place (a test of a character, C110 s5a).
    if (n.kind === "lambda") return k.fn(n.params.map((p) => named(p) || "x"), (...ps) => copy(n.body, env, new Map([...inputs, ...n.params.map((p, j) => [p, ps[j]] as const)])));
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
      if (t && s && !("b" in s) && test !== "is letter" && test !== "is digit") env.set(t, { pass: n.args[1] });
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
      if ("pass" in s) return k.let("end", k.call(run, text, at, copy(s.pass, env, inputs)), (end) =>
        k.let(named(n.target) || "run", k.call(TEXT_OPS.slice, text, at, end), (v) => next(end, new Map(env).set(n.target, { b: v }))));
      if (s.unknown === "int") throw new Unsupported(`reads ${named(n.target)} as text`);
      const test = s.unknown === "letters" ? isLetter : isDigit;
      if (!test) throw new Unsupported("no is letter or is digit");
      return k.let("end", k.call(run, text, at, test), (end) =>
        k.let(named(n.target) || "run", k.call(TEXT_OPS.slice, text, at, end), (v) => next(end, new Map(env).set(n.target, { b: v }))));
    }
    if (n.kind === "match") {
      // A match on an input still to be read (L72d2, as descent.ts): each
      // case read with its fields still to be read; the input is that case.
      const sx = target(n.scrutinee), ss = sx ? env.get(sx) : undefined;
      if (sx && ss && !("b" in ss)) {
        const ways = n.arms.map((x) => node(x)! as Any & { value?: Id }).map((a) => {
          if (!a.variant || a.value) throw new Unsupported("reads a match by value on an input");
          const inner: Env = new Map(env);
          for (const b of a.binds) if (b) inner.set(b, { unknown: "int" });
          return piece(a.body, text, at, inner, inputs, tops, (end, e) => {
            const fields = a.binds.map((b) => { const sl = b ? e.get(b) : undefined; if (!sl || !("b" in sl)) throw new Unsupported(`${named(a.variant)} doesn't read all its fields`); return k.x(sl.b); });
            return k.let(named(sx) || "case", fields.length ? k.call(a.variant, ...fields) : k.x(a.variant), (v) => next(end, new Map(e).set(sx, { b: v })));
          });
        });
        return ways.reduceRight((rest, w) => orElse(w, rest));
      }
      // A Choice of arms, `if one of([…]) then a else b` (L72e2b): each
      // read, the one that reads farther kept.
      const sc = node(n.scrutinee);
      if (sc?.kind === "call" && !isUse(sc as never) && target(sc.fn) === S.oneOf)
        return n.arms.map((x) => node(x)!).map((a) => piece(a.body, text, at, env, inputs, tops, next)).reduceRight((rest, w) => farther(w, rest));
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
    // show of a Float64 (L72c2): the longest spelling there that show
    // writes, as descent.ts reads it: a number's text (read number) that
    // show of it gives back exactly.
    if (f === S.show) {
      const b = target(n.args[0]), s = b ? env.get(b) : undefined;
      if (!b || !s || "b" in s) throw new Unsupported("reads show of something other than an input");
      return k.let("end", k.call(run, text, at, floatChar()), (end) =>
        then(k.call(floatOf(), text, at, end), (a, v) => next(a, new Map(env).set(b, { b: v }))));
    }
    // one of(texts) (L72e2b): the longest of them there first.
    if (f === S.oneOf) {
      const l = node(n.args[0]);
      const items = l?.kind === "call" && !isUse(l as never) && target(l.fn) === S.listOf ? l.args.map((x) => node(x)) : [];
      if (!items.length || items.some((x) => x?.kind !== "lit")) throw new Unsupported("reads one of something other than texts written out");
      const texts = items.map((x) => String(x!.value)).sort((a, b) => b.length - a.length);
      return texts.reduceRight<Id>((rest, t) => orElse(k.if(startsWith(text, at, k.lit(t), k.int([...t].length)), k.let("at", plus(at, [...t].length), (a) => next(a, env)), none()), rest), none());
    }
    // A definition that reads itself (L72e2b: blank), given only what is
    // known: a reader of its own, `read <name>(text, at, inputs…)`, giving
    // where it ends; its Choices keep the reading that goes farther.
    if (f && code.nodes[f]?.kind === "def" && callsItself(f) && n.args.every((a) => { const x = target(a), sl = x ? env.get(x) : undefined; return !sl || "b" in sl; })) {
      const d = pieceReader(f);
      return then(k.call(d, text, at, ...n.args.map((a) => copy(a, env, inputs))), (a) => next(a, env));
    }
    // inverse(g, x) with x to be read (L72e1b, as descent.ts): the longest
    // run of the characters g's guard takes that g gives an answer for.
    if (named(f) === "inverse") {
      const x = target(n.args[1]), sx = x ? env.get(x) : undefined, g = target(n.args[0]);
      if (!x || !sx || "b" in sx || !g) throw new Unsupported("reads inverse other than of a definition, for an input");
      return then(inverseAt(g, text, at), (a, v) => next(a, new Map(env).set(x, { b: v })));
    }
    if (named(f) === "spaced") return k.let("at", k.call(spaces, text, at), (a) => piece(n.args[0], text, a, env, inputs, tops, (a2, e) => k.let("at", k.call(spaces, text, a2), (a3) => next(a3, e))));
    // Needing no parentheses, the arm itself; needing some, the reader's
    // own parentheses path reads it (at the outermost inputs, where it
    // needs none).
    if (named(f) === "optional parens") return k.if(copy(n.args[0], env, inputs), none(), piece(n.args[1], text, at, env, inputs, tops, next));
    // join all(map(xs, the printer), sep): the items read by the reader,
    // with sep between them, none too (L72b2, as descent.ts).
    if (named(f) === "join all") {
      const m = node(n.args[0]);
      if (m?.kind !== "call" || isUse(m as never) || named(target(m.fn)) !== "map") throw new Unsupported("reads join all of something other than a map");
      // The characters of an input Text, each written by a function of one
      // character (L72d2): read back by its table, as descent.ts reads them.
      const src = node(m.args[0]), t = src?.kind === "call" && !isUse(src as never) && target(src.fn) === "builtin.text.characters" ? target(src.args[0]) : null, st = t ? env.get(t) : undefined;
      if (t && st && !("b" in st)) {
        const g = target(m.args[1]), sep = node(n.args[1]);
        if (!g || sep?.kind !== "lit" || sep.value !== "") throw new Unsupported("reads characters other than by a definition with no separator");
        return then(k.call(charactersOf(g), text, at, k.lit("")), (end, v) => next(end, new Map(env).set(t, { b: v })));
      }
      const x = target(m.args[0]), s = x ? env.get(x) : undefined;
      if (!x || !s || "b" in s || given.length) throw new Unsupported("reads join all of something other than an input list");
      return k.let("items", orElse(k.call(listOf(m.args[1]), text, at, copy(n.args[1], env, inputs)), some(at, k.x(NIL))), (r) =>
        then(k.x(r), (end, v) => next(end, new Map(env).set(x, { b: v }))));
    }
    if (f === printer) {
      const x = target(n.args[0]), s = x ? env.get(x) : undefined;
      if (!x || !s || "b" in s) throw new Unsupported("reads the printer of something other than an input");
      return then(k.call(read, text, at, ...n.args.slice(1).map((a) => copy(a, env, inputs)), ...tops), (a, v) => next(a, new Map(env).set(x, { b: v })));
    }
    // Another definition, or a function written in place, read through its
    // body with its inputs copied in.
    const fn = f && code.nodes[f]?.kind === "def" ? lambdaOf(f) : node(n.fn)?.kind === "lambda" ? node(n.fn) : undefined;
    if (!fn) throw new Unsupported(`reads ${named(f) || f}`);
    // An input still to be read passes in as one, and what the body reads
    // for it comes back out (L72d2: json quoted(t)).
    const passed: [Id, Id][] = [], lets: (readonly [Id, Id])[] = [];
    fn.params.forEach((p, j) => {
      const x = target(n.args[j]), sl = x ? env.get(x) : undefined;
      if (x && sl && !("b" in sl)) passed.push([p, x]); else lets.push([p, copy(n.args[j], env, inputs)] as const);
    });
    const inner: Env = new Map(env);
    for (const [p, x] of passed) inner.set(p, env.get(x)!);
    const back: Next = (a, e) => { const out = new Map(e); for (const [p, x] of passed) { const v = e.get(p); if (v && "b" in v) out.set(x, v); } return next(a, out); };
    const go = (i: number, ins: Map<Id, Id>): Id => i === lets.length ? piece(fn.body, text, at, inner, ins, tops, back)
      : k.let(named(lets[i][0]) || "x", lets[i][1], (b) => go(i + 1, new Map(ins).set(lets[i][0], b)));
    return go(0, inputs);
  };

  // Whether a definition's body calls it.
  const callsItself = (f: Id) => {
    const seen = new Set<Id>();
    const walk = (id: Id | undefined): boolean => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      const n = code.nodes[id] as unknown as Record<string, unknown> | undefined;
      if (!n || (n.kind === "def" && id !== f)) return false;
      if (n.kind === "ref" && n.target === f) return true;
      return Object.entries(n).some(([key, v]) => key !== "id" && (typeof v === "string" ? walk(v) : Array.isArray(v) && v.some((x) => typeof x === "string" && walk(x))));
    };
    return walk(lambdaOf(f)?.body);
  };
  const pieceReaders = new Map<Id, Id>();
  function pieceReader(f: Id): Id {
    if (pieceReaders.has(f)) return pieceReaders.get(f)!;
    const fn = lambdaOf(f);
    if (!fn) throw new Unsupported(`reads ${named(f)}`);
    const d = k.def(`read ${named(f) || "piece"}`);
    pieceReaders.set(f, d);
    k.define(d, k.fn(["text", "at", ...fn.params.map((p) => named(p) || "x")], (text, at, ...ps) =>
      piece(fn.body, text, at, new Map(), new Map(fn.params.map((p, j) => [p, ps[j]] as const)), [], (end) => some(end, k.x(end)))));
    return d;
  }

  // The test of a character g's guard puts on its Text (`all pass(characters
  // t, p)`), and read inverse of g(text, at, end): the longest text from
  // at, ending by end, that g gives an answer for, and that answer.
  const passTest = (g: Id): Id => {
    const fn = lambdaOf(g), b = fn && node(fn.body), env: Env = new Map(fn ? [[fn.params[0], { unknown: "int" }]] : []);
    if (b?.kind === "match") hint(b.scrutinee, env);
    const sl = fn && env.get(fn.params[0]);
    if (!sl || !("pass" in sl)) throw new Unsupported(`reads inverse of ${named(g)}, whose characters nothing says`);
    return copy(sl.pass, new Map(), new Map());
  };
  // A test g's guard puts on its Text's first character, `p(slice(t, 0, 1))`
  // (json escape start), tried before the run is.
  const headTest = (g: Id): Id | null => {
    const fn = lambdaOf(g), b = fn && node(fn.body);
    const find = (id: Id): Id | null => {
      const n = node(id);
      if (n?.kind !== "call" || isUse(n as never)) return null;
      const f = target(n.fn);
      if (f === "builtin.and") return find(n.args[0]) ?? find(n.args[1]);
      const sl = node(n.args[0]);
      return f && code.nodes[f]?.kind === "def" && n.args.length === 1 && sl?.kind === "call" && !isUse(sl as never) && target(sl.fn) === "builtin.text.slice" && target(sl.args[0]) === fn!.params[0] && node(sl.args[1])?.value === 0 && node(sl.args[2])?.value === 1 ? f : null;
    };
    return b?.kind === "match" ? find(b.scrutinee) : null;
  };
  const inverseAt = (g: Id, text: Id, at: Id): Id => {
    const p = headTest(g), go = k.call(inverseOf(g), text, at, k.call(run, text, at, passTest(g)));
    return p ? k.if(k.call(INT_OPS.less, at, k.call(TEXT_OPS.length, text)), k.if(k.call(p, at1(text, at)), go, none()), none()) : go;
  };
  const inverses = new Map<Id, Id>();
  function inverseOf(g: Id): Id {
    if (inverses.has(g)) return inverses.get(g)!;
    const d = k.def(`read inverse of ${named(g) || "a function"}`);
    inverses.set(g, d);
    k.define(d, k.fn(["text", "at", "end"], (text, at, end) => {
      const shorter = () => k.call(d, text, at, k.call(INT_OPS.sub, end, k.int(1)));
      return k.if(k.call(INT_OPS.less, at, end), k.let("spelling", k.call(TEXT_OPS.slice, text, at, end), (t) =>
        k.match(k.call(S.optional, k.thunk(() => k.call(g, t))), [
          { variant: SOME, names: ["x"], body: ([x]) => some(end, k.x(x)) },
          { variant: NONE, names: [], body: () => shorter() },
        ])), none());
    }));
    return d;
  }

  // A character a Float64's show may write: a digit, a sign, ".", e or E.
  const floatChar = () => k.fn(["c"], (c) => k.byValue(k.x(c), ["-", "+", ".", "e", "E"].map((x) => [k.lit(x), k.x(TRUE)] as [Id, Id]), isDigit ? k.call(isDigit, c) : k.x(FALSE)));
  // read float(text, at, end): the longest text from at, ending by end,
  // that is a number show gives back exactly, with where it ends.
  let float: Id | null = null;
  function floatOf(): Id {
    if (float) return float;
    float = k.def("read float");
    k.define(float, k.fn(["text", "at", "end"], (text, at, end) => {
      const shorter = () => k.call(float!, text, at, k.call(INT_OPS.sub, end, k.int(1)));
      return k.if(k.call(INT_OPS.less, at, end), k.let("spelling", k.call(TEXT_OPS.slice, text, at, end), (t) =>
        k.match(k.call(S.optional, k.thunk(() => k.call(TEXT_OPS.readNumber, t))), [
          { variant: SOME, names: ["x"], body: ([x]) => k.if(k.call(S.equal, k.call(S.show, x), k.x(t)), some(end, k.x(x)), shorter()) },
          { variant: NONE, names: [], body: () => shorter() },
        ])), none());
    }));
    return float;
  }

  // read characters by g(text, at, so far): the longest run of characters
  // read back through g's table, or as themselves where g keeps them. A g
  // that is a Choice of ways (L72e1c: json string character, `if one of([…])
  // then inverse(h, c) else f(c)`) reads each character each way, the one
  // that reads farther kept.
  const charReaders = new Map<Id, Id>();
  function charactersOf(g: Id): Id {
    if (charReaders.has(g)) return charReaders.get(g)!;
    const gb = node(lambdaOf(g)?.body), gs = gb?.kind === "match" ? node(gb.scrutinee) : undefined;
    const choice = gs?.kind === "call" && !isUse(gs as never) && target(gs.fn) === S.oneOf;
    const ways = choice ? gb!.arms.map((x) => node(node(x)!.body)!) : [];
    const viaTable = choice ? ways.map((w) => target(w.fn)).find((f) => f && named(f) !== "inverse" && code.nodes[f]?.kind === "def") : g;
    const viaInverse = choice ? ways.find((w) => named(target(w.fn)) === "inverse") : undefined;
    if (!viaTable || (choice && ways.length !== (viaInverse ? 2 : 1))) throw new Unsupported(`reads characters by ${named(g)}`);
    const table = descentReader(code, printer, names).characterTable(viaTable);
    const d = k.def(`read characters by ${named(g) || "a function"}`);
    charReaders.set(g, d);
    k.define(d, k.fn(["text", "at", "so far"], (text, at, acc) => {
      // One character there by f's table, or itself: (where it ends, it).
      const self = k.if(k.call(INT_OPS.less, at, k.call(TEXT_OPS.length, text)), k.let("character", at1(text, at), (c) =>
        k.if(k.call(S.equal, k.call(viaTable, c), c), some(plus(at, 1), k.x(c)), none())), none());
      const one = table.reduceRight<Id>((rest, [o, c]) => k.if(startsWith(text, at, k.lit(o), k.int([...o].length)), some(plus(at, [...o].length), k.lit(c)), rest), self);
      const h = viaInverse && target(viaInverse.args[0]);
      const both = h ? farther(one, inverseAt(h, text, at)) : one;
      return k.match(both, [
        { variant: SOME, names: ["read"], body: ([p]) => k.match(k.x(p), [{ variant: tupleVariant(2), names: ["at", "character"], body: ([e, c]) => k.call(d, text, e, k.call(S.concat, acc, c)) }]) },
        { variant: NONE, names: [], body: () => some(at, k.x(acc)) },
      ]);
    }));
    return d;
  }
  // read <printer> list(text, at, sep): one item or more, sep between,
  // each item the printer's, or read by another function of one input
  // through its body (L72d2: json's object fields).
  const lists = new Map<Id, Id>();
  function listOf(itemFn: Id): Id {
    const g = target(itemFn) ?? itemFn;
    if (lists.has(g)) return lists.get(g)!;
    const items = k.def(lists.size ? `read ${title} list ${lists.size + 1}` : `read ${title} list`);
    lists.set(g, items);
    const fn = g === printer ? null : code.nodes[g]?.kind === "def" ? lambdaOf(g) : node(itemFn)?.kind === "lambda" ? node(itemFn) : undefined;
    if (fn === undefined || (fn && fn.params.length !== 1)) throw new Unsupported(`reads a list's items by ${named(g) || "this"}`);
    const item = (text: Id, at: Id): Id => !fn ? k.call(read, text, at)
      : piece(fn.body, text, at, new Map([[fn.params[0], { unknown: "int" }]]), new Map(), [], (end, e) => {
        const sl = e.get(fn.params[0]);
        if (!sl || !("b" in sl)) throw new Unsupported("a list's item isn't read");
        return some(end, k.x(sl.b));
      });
    k.define(items, k.fn(["text", "at", "sep"], (text, at, sep) =>
      then(item(text, at), (a, x) => {
        const len = () => k.call(TEXT_OPS.length, sep), one = () => some(a, k.call(CONS, x, k.x(NIL)));
        const rest = (from: Id) => orElse(then(k.call(items, text, from, sep), (b, xs) => some(b, k.call(CONS, x, xs))), one());
        return k.if(k.call(INT_OPS.less, k.int(0), len()), k.if(startsWith(text, a, k.x(sep), len()), rest(k.call(INT_OPS.add, a, len())), one()), rest(k.x(a)));
      })));
    return items;
  }

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
