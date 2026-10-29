// One + for every number type, resolved by type before anything runs
// (NUMBERS.md, "One `+` for every number system").
//
// The program stores one generic `+` (std.ts ARITH), whose type says "any
// number type". A small Int and a Float64 are the same JavaScript value, so
// the operation can't be chosen by looking at the value: it is chosen by
// the type, here, once. This is a code → code pass, like `represent`:
//
//   - a call whose type is known becomes the type's own operation: Float64's
//     builtin, Int's builtin, or `zip parts` / `map parts` of Float64's on a
//     record of Float64s;
//   - a generic definition used at another type gets a copy for that type
//     (monomorphisation, as MLton does for every definition and the
//     compiler's scalar profile already does), and its uses point at it.
//     Hindley-Milner has no polymorphic recursion, so this always ends;
//   - a type still open where the operation is used is Float64, as Haskell
//     defaults Num (the Run pane on `smaller`, with no caller to say).
//
// The evaluator, relate.ts and the compiler get the resolved program, so
// none of them sees a generic operation and nothing dispatches at run
// time. A program with no generic operation comes back as it was. The
// definition's own id stays its Float64 version, so entry points and names
// keep working, and the meaning hash is of the program as written.

import type { Code, Id, Node, NodeData, NodeOf } from "../model.ts";
import { freshId } from "../model.ts";
import type { Names } from "../presentation.ts";
import { B } from "../prelude.ts";
import { implementationKey, type Info } from "./infer.ts";
import { interfaceOps, leftToWays, NEUTRAL, pickWays, waysIn, type BuiltinCost } from "./ways.ts";
import { ALGEBRAIC_OPS, ARITH, ARITH_FIELD, COMPLEX_V, DUAL_V, FIXED_V, INT_OPS, RATIO, S } from "./std.ts";
import { ALGEBRAIC_TYPE, COMPLEX_TYPE, DUAL_TYPE, FIXED_TYPE, MATRIX_SIZE, INT, NUMBER, RATIONAL_TYPE, type Row, type Scheme, type Type } from "./types.ts";
import { PRELUDE } from "./library.ts";
import { ratioParts } from "./int.ts";
import { recordVariant } from "./derive.ts";
import { hasRecursiveLet, liftLets } from "./lift-lets.ts";
import { useDirections } from "./directions.ts";

const num: Type = { t: "con", id: NUMBER, args: [] };
const pure: Row = { effs: [], tail: null };

// Each generic operation's own operation at Float64 and at Int.
const AT: Record<Id, { number: Id; int: Id; arity: 1 | 2 }> = {
  [ARITH.add]: { number: B.add, int: INT_OPS.add, arity: 2 },
  [ARITH.sub]: { number: B.sub, int: INT_OPS.sub, arity: 2 },
  [ARITH.mul]: { number: B.mul, int: INT_OPS.mul, arity: 2 },
  [ARITH.neg]: { number: B.neg, int: INT_OPS.neg, arity: 1 },
  [ARITH.less]: { number: S.less, int: INT_OPS.less, arity: 2 },
};

// The number types that are data (std.ts), whose literals are their
// constructors' calls. Their + − · −x < are the prelude's implementations
// of Arithmetic and Ordered (INTERFACES.md step 4), found by type like any
// other: Rational's `add fractions`, Complex's `multiply complex`, Dual's
// product rule, Algebraic's builtins.
const DATA_NUMBERS = new Set<Id>([RATIONAL_TYPE, COMPLEX_TYPE, DUAL_TYPE, ALGEBRAIC_TYPE, FIXED_TYPE]);
// A prelude definition's id, by its name.
export const preludeDef = (name: string): Id | undefined =>
  Object.keys(PRELUDE.names).find((id) => PRELUDE.names[id] === name && PRELUDE.code.nodes[id]?.kind === "def");

export const usesGenericArithmetic = (code: Code) => {
  const ops = interfaceOps(code);
  return Object.values(code.nodes).some((n) => (n.kind === "ref" && (n.target in AT || ops.has(n.target))) || (n.kind === "lit" && n.of !== undefined && DATA_NUMBERS.has(n.of)));
};

// Whether resolveArithmetic changes anything: it also lifts recursive lets
// into definitions first (lift-lets.ts), the other rewrite every runner
// wants before it sees the program.
// A plain number literal is some Number (infer.ts), so a program with one
// may need resolving too; with the types at hand, only when one isn't
// already a Float64.
export const needsResolving = (code: Code) => usesGenericArithmetic(code) || hasRecursiveLet(code) || Object.values(code.nodes).some(plainNumber);
const plainNumber = (n: Node) => n.kind === "lit" && n.of === undefined && typeof n.value === "number";
const someLiteralNotFloat64 = (code: Code, info: Info) => Object.values(code.nodes).some((n) => {
  if (!plainNumber(n)) return false;
  const t = info.typeOf.get(n.id), r = t && (info.subst ? info.subst.resolve(t) : t);
  return !!r && !(r.t === "con" && r.id === NUMBER);
});

// A Float64 literal's digits, as written, as top/bottom: 0.25 is 25/100.
// A literal at Fixed: its digits as a fraction, rounded once to the nearest
// step of 2⁻³² (halves up), so 0.1 is the same steps on every target.
function fixedSteps(v: unknown): bigint {
  const [top, bottom] = ratioParts(typeof v === "number" ? decimal(v) : (v as string)) ?? [0n, 1n];
  const twice = 2n * top * 2n ** 32n + bottom, d = 2n * bottom;
  return twice >= 0n ? twice / d : -((-twice + d - 1n) / d);
}

function decimal(x: number): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(x));
  if (!m) return "0";
  const digits = BigInt(m[2] + (m[3] ?? "")), exp = Number(m[4] ?? 0) - (m[3] ?? "").length;
  const [top, bottom] = exp >= 0 ? [digits * 10n ** BigInt(exp), 1n] : [digits, 10n ** BigInt(-exp)];
  return `${m[1]}${top}/${bottom}`;
}

// costOf: what each builtin costs on the target being compiled for, which
// can change which way gives a field (WAYS.md "Costs"); target-neutral
// when not given.
export function resolveArithmetic(code: Code, info: Info, names: Names = {}, costOf: BuiltinCost = NEUTRAL): { code: Code; info: Info; names: Names } {
  // A relation's own directions first (directions.ts), so the evaluator and
  // the compiler run a solve the way the checker typed it.
  code = useDirections(code);
  ({ code, info, names } = liftLets(code, info, names));
  if (!usesGenericArithmetic(code) && !someLiteralNotFloat64(code, info)) return { code, info, names };
  const s = info.subst;
  const nodes: Record<Id, Node> = { ...code.nodes };
  const defs = [...code.defs];
  const typeOf = new Map(info.typeOf);
  const schemes = new Map(info.schemes);
  const divergent = new Set(info.divergent);
  const outNames: Names = { ...names };

  type Env = Map<number, Type>;
  // What a number type left open is: Int when a whole literal gave it
  // (`3`, `n + 1`), else Float64 (Haskell defaults to Integer and Double).
  const int: Type = { t: "con", id: INT, args: [] };
  // Int only if it has every interface the variable needs (Haskell's
  // defaulting tries each type in turn the same way).
  const intFits = (v: number) => [...(s.needs.get(v)?.keys() ?? [])].every((i) => info.implementations?.has(implementationKey(i, int)));
  const otherwise = (v: number): Type => (s.whole.has(v) && !s.fractional.has(v) && !s.numbers.has(v) && s.arith.has(v) && intFits(v) ? int : num);
  // A type with the definition's variables replaced, and every number-type
  // variable left open made its default.
  const close = (t: Type, env: Env): Type => {
    t = s.resolve(t);
    if (t.t === "var") return env.has(t.v) ? env.get(t.v)! : s.arith.has(t.v) ? otherwise(t.v) : t;
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map((a) => close(a, env)) };
    return { t: "fn", params: t.params.map((p) => close(p, env)), ret: close(t.ret, env), eff: s.resolveRow(t.eff) };
  };
  const constrained = (sc: Scheme) => [...new Set([...(sc.arith ?? []), ...(sc.ordered ?? []), ...(sc.needs ?? []).map(([v]) => v)])];
  // What a scheme's variables stand for at one use: walk its type beside
  // the use's.
  const bind = (pat: Type, t: Type, vars: Set<number>, out: Env) => {
    if (pat.t === "var") { if (vars.has(pat.v) && !out.has(pat.v)) out.set(pat.v, t); return; }
    if (pat.t === "con" && t.t === "con") pat.args.forEach((a, i) => t.args[i] && bind(a, t.args[i], vars, out));
    if (pat.t === "fn" && t.t === "fn") { pat.params.forEach((p, i) => t.params[i] && bind(p, t.params[i], vars, out)); bind(pat.ret, t.ret, vars, out); }
  };
  const show = (t: Type): string => (t.t === "con" ? [names[t.id] ?? t.id, ...t.args.map(show)].join(" ") : t.t === "var" ? `?${t.v}` : "a function");

  const add = (n: NodeData, type: Type): Id => {
    const id = freshId();
    nodes[id] = { ...n, id } as Node;
    typeOf.set(id, type);
    return id;
  };

  // The copy of `def` for these types of its number-type variables.
  const copies = new Map<string, Id>();
  const todo: { root: Id; env: Env }[] = [];
  const instance = (def: Id, env: Env, sc: Scheme): Id => {
    const vars = constrained(sc);
    // The definition itself is at its own defaults (Int for a whole
    // literal nothing fixes, else Float64): a use at those needs no copy.
    const at = (v: number): Type => env.get(v) ?? otherwise(v);
    if (vars.every((v) => JSON.stringify(at(v)) === JSON.stringify(otherwise(v)))) return def;
    const key = `${def}|${vars.map((v) => JSON.stringify(at(v))).join(",")}`;
    const done = copies.get(key);
    if (done) return done;
    const d = code.nodes[def] as NodeOf<"def">;
    const id = freshId();
    copies.set(key, id);
    // A pinned definition (a module's) has its body typed with variables of
    // its own, which the pin's are fresh copies of: they stand for the same.
    const own = d.body === null ? undefined : info.typeOf.get(d.body);
    if (own) {
      env = new Map(env);
      const pair = (b: Type, p: Type) => {
        b = s.resolve(b);
        if (b.t === "var") { if (p.t === "var" && env.has(p.v) && !env.has(b.v)) env.set(b.v, env.get(p.v)!); return; }
        if (b.t === "con" && p.t === "con") b.args.forEach((a, i) => p.args[i] && pair(a, p.args[i]));
        if (b.t === "fn" && p.t === "fn") { b.params.forEach((x, i) => p.params[i] && pair(x, p.params[i])); pair(b.ret, p.ret); }
      };
      pair(own, sc.type);
    }
    const renames = new Map<Id, Id>();
    const body = d.body === null ? null : copyTree(d.body, renames, env);
    nodes[id] = { id, kind: "def", body };
    defs.push(id);
    outNames[id] = `${names[def] ?? def} at ${vars.map((v) => show(at(v))).join(", ")}`;
    const type = close(sc.type, env);
    const left = (xs?: number[]) => (xs ?? []).filter((v) => !env.has(v));
    const needs = (sc.needs ?? []).filter(([v]) => !env.has(v));
    schemes.set(id, { ...sc, vars: sc.vars.filter((v) => !env.has(v)), type, ...(sc.arith ? { arith: left(sc.arith) } : {}), ...(sc.ordered ? { ordered: left(sc.ordered) } : {}), needs });
    typeOf.set(id, type);
    if (info.divergent.has(def)) divergent.add(id);
    if (body !== null) todo.push({ root: body, env });
    return id;
  };

  // A subtree with fresh ids (binders too, and the uses of them), each node
  // typed as its original was at these types. Copied from the program as
  // written, since the original's own operations are resolved already.
  const copyTree = (id: Id, renames: Map<Id, Id>, env: Env): Id => {
    const n = code.nodes[id];
    const fresh = freshId();
    if (n.kind === "binder") renames.set(id, fresh);
    const c = structuredClone(n) as Record<string, unknown>;
    c.id = fresh;
    const kid = (x: Id) => copyTree(x, renames, env);
    switch (n.kind) {
      case "ref": c.target = renames.get(n.target) ?? n.target; break;
      case "call": c.fn = kid(n.fn); c.args = n.args.map(kid); break;
      case "lambda": c.params = n.params.map(kid); c.body = kid(n.body); break;
      case "match": c.scrutinee = kid(n.scrutinee); c.arms = n.arms.map(kid); c.otherwise = n.otherwise && kid(n.otherwise); break;
      case "fold": c.scrutinee = kid(n.scrutinee); c.arms = n.arms.map(kid); break;
      case "arm": c.binds = n.binds.map(kid); c.results = n.results.map((r) => r && kid(r)); c.body = kid(n.body); break;
      case "solve":
        c.given = Object.fromEntries(Object.entries(n.given).map(([k, v]) => [k, kid(v)]));
        c.binds = Object.fromEntries(Object.entries(n.binds).map(([k, v]) => [k, kid(v)]));
        c.body = kid(n.body);
        break;
    }
    nodes[fresh] = c as unknown as Node;
    const o = opAt.get(id);
    if (o) opAt.set(fresh, o);
    const t = info.typeOf.get(id);
    if (t) typeOf.set(fresh, close(t, env));
    return fresh;
  };

  // A use of an interface's operation (INTERFACES.md) as the
  // implementation's own: a ref to what the implementation gives for it,
  // or, when that is more than a ref, to a definition made of it.
  const ops = interfaceOps(code);
  const opAt = new Map(info.opAt ?? []);
  const lifted = new Map<string, Id>();
  // Ways (WAYS.md, BACKLOG L96, ways.ts): each implementation's pick,
  // made once.
  const ways = waysIn(code, ops);
  const chosen = new Map<Id, Map<Id, Id | null>>();
  const choose = (impl: Id, variant: NodeOf<"variant">, args: Id[]) => {
    let pick = chosen.get(impl);
    if (!pick) chosen.set(impl, (pick = pickWays(code, ways, variant, args, costOf)));
    return pick;
  };
  const implement = (id: Id, env: Env) => {
    const field = (nodes[id] as NodeOf<"ref">).target, iface = ops.get(field)!;
    let at = close(opAt.get(id) ?? num, env);
    if (at.t === "var") at = num;
    const impl = info.implementations?.get(implementationKey(iface, at));
    if (!impl) throw new Error(`${show(at)} has no ${names[iface] ?? iface}`);
    const body = code.nodes[(code.nodes[impl] as NodeOf<"def">).body!] as NodeOf<"call">;
    const variant = (code.nodes[(code.nodes[body.fn] as NodeOf<"ref">).target] as NodeOf<"variant">);
    const arg = body.args[variant.fields.indexOf(field)];
    const given = code.nodes[arg];
    // A written field is a way like any other: a cheaper way wins.
    const way = choose(impl, variant, body.args).get(field);
    if (way) { nodes[id] = { id, kind: "ref", target: way }; return; }
    if (leftToWays(code, arg)) throw new Error(`${names[impl] ?? impl} leaves ${names[field] ?? field} to its ways, and none of them ends in a field it gives`);
    if (given.kind === "ref") { nodes[id] = { id, kind: "ref", target: given.target }; return; }
    const key = `${impl}|${field}`;
    let d = lifted.get(key);
    if (!d) {
      d = freshId();
      lifted.set(key, d);
      const type = close(info.typeOf.get(arg) ?? num, new Map());
      const root = copyTree(arg, new Map(), new Map());
      nodes[d] = { id: d, kind: "def", body: root };
      defs.push(d);
      outNames[d] = `${names[field] ?? field} of ${names[impl] ?? impl}`;
      schemes.set(d, { vars: [], rows: [], type });
      typeOf.set(d, type);
      todo.push({ root, env: new Map() });
    }
    nodes[id] = { id, kind: "ref", target: d };
  };

  // Resolve every use under `root`, at these types.
  const resolve = (root: Id, env: Env) => {
    const walk = (id: Id, parent: Id | null) => {
      // The one + − · −x < at a type with an implementation of its own
      // (Arithmetic, Ordered): that implementation's operation.
      if (nodes[id].kind === "ref" && (nodes[id] as NodeOf<"ref">).target in ARITH_FIELD) {
        const t = typeOf.get(id), c = t && close(t, env), x = c?.t === "fn" ? c.params[0] : null;
        const f = ARITH_FIELD[(nodes[id] as NodeOf<"ref">).target];
        if (x?.t === "con" && info.implementations?.has(implementationKey(f.iface, x))) { nodes[id] = { id, kind: "ref", target: f.field }; opAt.set(id, x); }
      }
      if (nodes[id].kind === "ref" && ops.has((nodes[id] as NodeOf<"ref">).target)) implement(id, env);
      const n = nodes[id];
      if (n.kind === "ref") {
        const t = typeOf.get(id);
        if (n.target in AT && t) operation(id, close(t, env), parent);
        else if (t) {
          const sc = schemes.get(n.target);
          if (sc && constrained(sc).length && nodes[n.target]?.kind === "def") {
            const at: Env = new Map();
            bind(sc.type, close(t, env), new Set(constrained(sc)), at);
            const target = instance(n.target, at, sc);
            if (target !== n.target) nodes[id] = { ...n, target };
          }
        }
        return;
      }
      if (plainNumber(n)) { numberLiteral(n as NodeOf<"lit">, env); return; }
      if (n.kind === "lit" && n.of !== undefined && DATA_NUMBERS.has(n.of)) { literal(n); return; }
      const kids: Id[] = [];
      switch (n.kind) {
        case "call": kids.push(n.fn, ...n.args); break;
        case "lambda": kids.push(n.body); break;
        case "def": if (n.body) kids.push(n.body); break;
        case "match": kids.push(n.scrutinee, ...n.arms, ...(n.otherwise ? [n.otherwise] : [])); break;
        case "fold": kids.push(n.scrutinee, ...n.arms); break;
        case "arm": kids.push(n.body); break;
        case "solve": kids.push(...Object.values(n.given), n.body); break;
      }
      for (const k of kids) walk(k, id);
    };
    walk(root, null);
  };

  // A literal at Rational, Algebraic, Complex or Dual as its constructor's
  // call: 3 at Dual is dual(3, 0), a constant.
  const intLit = (v: bigint): NodeData => ({ kind: "lit", value: v >= -9007199254740991n && v <= 9007199254740991n ? Number(v) : String(v), of: INT });
  const literal = (n: NodeOf<"lit">) => {
    const t: Type = { t: "con", id: n.of!, args: [] };
    const parts: [NodeData, Type][] = n.of === FIXED_TYPE ? [[intLit(fixedSteps(n.value)), int]]
      : n.of === RATIONAL_TYPE || n.of === ALGEBRAIC_TYPE
      ? (ratioParts(n.value) ?? [0n, 1n]).map((x) => [intLit(x), int])
      : [[{ kind: "lit", value: typeof n.value === "number" ? n.value : 0 }, num], [{ kind: "lit", value: 0 }, num]];
    const ctor = n.of === RATIONAL_TYPE ? RATIO : n.of === ALGEBRAIC_TYPE ? ALGEBRAIC_OPS.fraction : n.of === DUAL_TYPE ? DUAL_V : n.of === FIXED_TYPE ? FIXED_V : COMPLEX_V;
    const fn = add({ kind: "ref", target: ctor }, { t: "fn", params: parts.map(([, pt]) => pt), ret: t, eff: pure });
    nodes[n.id] = { id: n.id, kind: "call", fn, args: parts.map(([p, pt]) => add(p, pt)) };
    typeOf.set(n.id, t);
  };

  // A plain number literal at the Number its use needs: an Int, a fraction
  // (0.25 is 1/4 exactly: the digits as written), a Complex with 0i, a
  // matrix with it down the diagonal (that many times the identity), a
  // record with it in every part; a Float64 as it is.
  const numberLiteral = (n: NodeOf<"lit">, env: Env) => {
    const t = close(typeOf.get(n.id) ?? num, env), x = n.value as number;
    // At Float64 it says so, so checking the resolved program again (the
    // compiler does) finds the same type.
    if (t.t !== "con" || t.id === NUMBER) {
      if (t.t !== "var") { nodes[n.id] = { ...n, of: NUMBER }; typeOf.set(n.id, num); }
      return;
    }
    if (t.id === INT) { nodes[n.id] = { id: n.id, ...intLit(BigInt(x)) } as Node; typeOf.set(n.id, int); return; }
    if (t.id === RATIONAL_TYPE || t.id === ALGEBRAIC_TYPE || t.id === COMPLEX_TYPE || t.id === DUAL_TYPE || t.id === FIXED_TYPE) { literal({ ...n, of: t.id, value: t.id === COMPLEX_TYPE || t.id === DUAL_TYPE ? x : decimal(x) }); return; }
    const variant = recordVariant(code, t.id);
    if (!variant) return;
    const fields = (code.nodes[variant] as NodeOf<"variant">).fields;
    const fn = add({ kind: "ref", target: variant }, { t: "fn", params: fields.map(() => num), ret: t, eff: pure });
    const size = MATRIX_SIZE[t.id];
    nodes[n.id] = { id: n.id, kind: "call", fn, args: fields.map((_, i) => add({ kind: "lit", value: size && i % (size + 1) !== 0 ? 0 : x }, num)) };
    typeOf.set(n.id, t);
  };

  // A generic operation at its type: the type's own, or part by part.
  const operation = (id: Id, t: Type, parent: Id | null) => {
    const at = AT[(nodes[id] as NodeOf<"ref">).target];
    const x = t.t === "fn" ? t.params[0] : num;
    // Their own are their implementations (above); one they don't have
    // (< at Complex) is a type error, and the generic is left as it is.
    if (x.t === "con" && DATA_NUMBERS.has(x.id)) return;
    if (x.t === "con" && (x.id === NUMBER || x.id === INT)) {
      nodes[id] = { id, kind: "ref", target: x.id === INT ? at.int : at.number };
      typeOf.set(id, t);
      return;
    }
    // A record of Float64s (the checker allows nothing else here): Float64's
    // operation part by part.
    const each: Type = { t: "fn", params: at.arity === 1 ? [num] : [num, num], ret: num, eff: pure };
    const parts = at.arity === 1 ? S.mapParts : S.zipParts;
    const partsType: Type = { t: "fn", params: [each, ...(at.arity === 1 ? [x] : [x, x])], ret: x, eff: pure };
    const call = parent && nodes[parent].kind === "call" && (nodes[parent] as NodeOf<"call">).fn === id ? (nodes[parent] as NodeOf<"call">) : null;
    if (call) {
      nodes[id] = { id, kind: "ref", target: parts };
      typeOf.set(id, partsType);
      nodes[call.id] = { ...call, args: [add({ kind: "ref", target: at.number }, each), ...call.args] };
      return;
    }
    // Used as a value: (a, b) => zip parts(+, a, b).
    const params = Array.from({ length: at.arity }, () => add({ kind: "binder" }, x));
    const body = add({ kind: "call", fn: add({ kind: "ref", target: parts }, partsType), args: [add({ kind: "ref", target: at.number }, each), ...params.map((p) => add({ kind: "ref", target: p }, x))] }, x);
    nodes[id] = { id, kind: "lambda", params, body };
    typeOf.set(id, t);
  };

  // Every definition at its own types, its number-type variables Float64;
  // then each copy that made, until none is new.
  for (const d of code.defs) {
    const n = code.nodes[d];
    if (n?.kind !== "def" || !n.body) continue;
    const sc = schemes.get(d);
    resolve(n.body, new Map((sc ? constrained(sc) : []).map((v) => [v, otherwise(v)])));
  }
  while (todo.length) { const { root, env } = todo.pop()!; resolve(root, env); }
  // What's left open is Float64 (a definition's own id is its Float64
  // version, and a literal nothing pins down is one), so every target sees
  // closed types.
  // A record-generic variable (the vectors module's) stays: the scalar
  // profile lowers those once per record.
  const open = (t: Type): Type => {
    t = s.resolve(t);
    if (t.t === "var") return s.arith.has(t.v) && !s.numbers.has(t.v) ? otherwise(t.v) : t;
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map(open) };
    return { t: "fn", params: t.params.map(open), ret: open(t.ret), eff: s.resolveRow(t.eff) };
  };
  for (const [id, t] of typeOf) typeOf.set(id, open(t));
  for (const [d, sc] of schemes) {
    const vars = constrained(sc).filter((v) => !(sc.numbers ?? []).includes(v));
    if (!vars.length) continue;
    const { arith: _a, ordered: _o, fractional: _f, whole: _w, needs: _n, ...rest } = sc;
    const left = (xs?: number[]) => (xs ?? []).filter((v) => !vars.includes(v));
    schemes.set(d, { ...rest, vars: left(sc.vars), type: close(sc.type, new Map(vars.map((v) => [v, otherwise(v)]))),
      ...(left(sc.arith).length ? { arith: left(sc.arith) } : {}), ...(left(sc.ordered).length ? { ordered: left(sc.ordered) } : {}), ...(left(sc.fractional).length ? { fractional: left(sc.fractional) } : {}) });
  }

  return { code: { nodes, defs }, info: { ...info, typeOf, schemes, divergent }, names: outNames };
}
