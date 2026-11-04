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

import type { Code, Id, Node, NodeData, NodeOf, Use } from "../model.ts";
import { isUse, useTarget, isCall, fieldPorts, type Call, bindsOf, useKids } from "../model.ts";
import { resultsAsFunctions, usesResultsAsFunction } from "./results-fn.ts";
import { freshId, layerOf, nodesWhere, offLayer, scanningOnLayer } from "../model.ts";
import type { Names } from "../presentation.ts";
import { B } from "../prelude.ts";
import { implementationOf, type Info } from "./infer.ts";
import { interfaceOps, leftToWays, NEUTRAL, pickWays, waysIn, type BuiltinCost } from "./ways.ts";
import { ALGEBRAIC_OPS, ARITH, ARITH_FIELD, EMBEDDING, EMBEDDING_MAP, COMPLEX_V, DUAL_V, FIXED_V, INT_OPS, LITERAL, LITERAL_V, RATIO, S } from "./std.ts";
import { ALGEBRAIC_TYPE, COMPLEX_TYPE, DUAL_TYPE, FIXED_TYPE, INT, NUMBER, RATIONAL_TYPE, OverMap, type Row, type Scheme, type Type } from "./types.ts";
import { PRELUDE_DEFS } from "./prelude-ids.ts";
import { ratioParts } from "./int.ts";
import { recordVariant } from "./derive.ts";
import { hasRecursiveLet, liftLets } from "./lift-lets.ts";
import { spreadTuples } from "./spread.ts";
import { fieldsByType, usesFieldsByType } from "./fields-by-type.ts";
import { jsonByType, usesJsonByType } from "./json-by-type.ts";
import { setSeveral, usesSetSeveral } from "./set-several.ts";
import { setThrough, usesSetThrough } from "./set-through.ts";
import { literalMatch, usesLiteralMatch } from "./literal-match.ts";
import { sharedFields, usesSharedFields } from "./shared-fields.ts";
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
// A prelude definition's id, by its name: from a table of the few the
// passes look for (prelude-ids.ts), so the solver doesn't carry the
// library to find them (C137d2).
export const preludeDef = (name: string): Id | undefined => PRELUDE_DEFS[name];

export const usesGenericArithmetic = (code: Code) => {
  const ops = interfaceOps(code);
  return nodesWhere(code, "generic arithmetic", (n) => (n.kind === "ref" && (n.target in AT || ops.has(n.target))) || (isUse(n) && ops.has(useTarget(code.nodes, n))) || (n.kind === "lit" && n.of !== undefined && DATA_NUMBERS.has(n.of))).length > 0;
};

// Whether resolveArithmetic changes anything: it also lifts recursive lets
// into definitions first (lift-lets.ts), the other rewrite every runner
// wants before it sees the program.
// A plain number literal is some Number (infer.ts), so a program with one
// may need resolving too; with the types at hand, only when one isn't
// already a Float64.
export const needsResolving = (code: Code) => usesGenericArithmetic(code) || usesResultsAsFunction(code) || usesFieldsByType(code) || usesJsonByType(code) || usesSetSeveral(code) || usesSetThrough(code) || usesLiteralMatch(code) || usesSharedFields(code) || hasRecursiveLet(code) || nodesWhere(code, "plain number", plainNumber).length > 0;
const plainNumber = (n: Node) => n.kind === "lit" && n.of === undefined && typeof n.value === "number";
const someLiteralNotFloat64 = (code: Code, info: Info) => nodesWhere(code, "plain number", plainNumber).some((id) => {
  const n = code.nodes[id];
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
  const r = scanningOnLayer(code, () => resolving(code, info, names, costOf, seedFor(code, info, names, costOf)));
  return r as { code: Code; info: Info; names: Names };
}

// The library's own resolving (L217b): its definitions at their own types,
// and the copies they ask for, made once per check of the library and
// target, and each program's resolving goes on from it with its own
// definitions. Only for a program on the library (load.ts base) checked on
// the library's kept check (infer.ts L216), when the steps before leave
// both as they are and its own implementations are of its own types (an
// implementation for Int could change which type a library number is).
type Seed = {
  layer: Code; nodes: Record<Id, Node>; defs: Id[]; typeOf: Map<Id, Type>; schemes: Map<Id, Scheme>; divergent: Set<Id>; names: Names;
  copies: Map<string, Id>; opAt: Map<Id, Type>; copyOf: Map<Id, Id>; lifted: Map<string, Id>; chosen: Map<Id, Map<Id, Id | null>>;
};
const seeds = new WeakMap<Info, Map<BuiltinCost, Seed | null>>();
function seedFor(code: Code, info: Info, names: Names, costOf: BuiltinCost): Seed | null {
  const lib = layerOf(code), under = info.layer;
  if (!lib || !under || !(info.typeOf instanceof OverMap)) return null;
  for (const k of info.implementations?.keys() ?? []) {
    if (under.implementations?.has(k)) continue;
    const rest = k.slice(k.indexOf("|") + 1), con = rest.startsWith("@") ? rest.slice(1) : null;
    if (!con || con in lib.nodes || con.startsWith("builtin.")) return null;
  }
  // A program's check sets the library's definitions' types again; they
  // must be the library's.
  for (const [id, t] of info.typeOf.own()) if (id in lib.nodes) { const u = under.typeOf.get(id); if (t !== u && JSON.stringify(t) !== JSON.stringify(u)) return null; }
  let byCost = seeds.get(under);
  if (!byCost) seeds.set(under, (byCost = new Map()));
  if (!byCost.has(costOf)) {
    const r = scanningOnLayer(lib, () => resolving(lib, under, names, costOf, null, true));
    byCost.set(costOf, "layer" in r ? { ...r, layer: lib } : null);
  }
  return byCost.get(costOf) ?? null;
}
type Snapshot = Omit<Seed, "layer">;
function resolving(code: Code, info: Info, names: Names, costOf: BuiltinCost, seed: Seed | null, snapshot = false): { code: Code; info: Info; names: Names } | (Snapshot & { layer: true }) {
  const given = { code, info };
  // A relation's own directions first (directions.ts), so the evaluator and
  // the compiler run a solve the way the checker typed it.
  code = useDirections(code);
  ({ code, info } = insertEmbeddings(code, info));
  ({ code, info, names } = liftLets(code, info, names));
  ({ code, info, names } = literalMatch(code, info, names));
  ({ code, info, names } = spreadTuples(code, info, names));
  ({ code, info, names } = resultsAsFunctions(code, info, names));
  ({ code, info, names } = fieldsByType(code, info, names));
  ({ code, info, names } = jsonByType(code, info, names));
  ({ code, info, names } = setThrough(code, info, names));
  ({ code, info, names } = setSeveral(code, info, names));
  ({ code, info, names } = sharedFields(code, info, names));
  if (!snapshot && !usesGenericArithmetic(code) && !someLiteralNotFloat64(code, info)) return { code, info, names };
  // The library's resolving goes on here only when the steps above left the
  // program and its check as they were, and every library node is there.
  const changed = seed && code === given.code && info === given.info ? offLayer(code) : undefined;
  if (seed && (!changed || [...changed].some((id) => id in seed!.layer.nodes))) seed = null;
  if (snapshot && (code !== given.code || info !== given.info)) return { code, info, names };
  const s = info.subst;
  const own = seed ? [...changed!] : [];
  const nodes: Record<Id, Node> = seed ? { ...seed.nodes } : { ...code.nodes };
  for (const id of own) nodes[id] = code.nodes[id];
  const defs = seed ? [...seed.defs, ...code.defs.filter((d) => !(d in seed!.layer.nodes))] : [...code.defs];
  const typeOf = seed ? new Map(seed.typeOf) : new Map(info.typeOf);
  if (seed) for (const [id, t] of (info.typeOf as OverMap<Id, Type>).own()) if (!(id in seed.layer.nodes)) typeOf.set(id, t);
  const schemes = new Map(info.schemes);
  if (seed) for (const [id, sc] of seed.schemes) if (!(id in code.nodes)) schemes.set(id, sc);
  const divergent = new Set(info.divergent);
  if (seed) for (const id of seed.divergent) divergent.add(id);
  const outNames: Names = { ...names, ...(seed?.names ?? {}) };

  type Env = Map<number, Type>;
  // What a number type left open is: Int when a whole literal gave it
  // (`3`, `n + 1`), else Float64 (Haskell defaults to Integer and Double).
  const int: Type = { t: "con", id: INT, args: [] };
  // Int only if it has every interface the variable needs (Haskell's
  // defaulting tries each type in turn the same way).
  const fitsAt = (v: number, t: Type) => [...(s.needs.get(v)?.keys() ?? [])].every((i) => !!implementationOf(info, i, t));
  const intFits = (v: number) => fitsAt(v, int);
  // A variable only Int can stand for (one needing Bits, L193) is Int.
  const otherwise = (v: number): Type => ((s.whole.has(v) && !s.fractional.has(v) && !s.numbers.has(v) && s.arith.has(v)) || !fitsAt(v, num)) && intFits(v) ? int : num;
  // A type with the definition's variables replaced, and every number-type
  // variable left open made its default.
  const close = (t: Type, env: Env): Type => {
    t = s.resolve(t);
    if (t.t === "var") return env.has(t.v) ? env.get(t.v)! : s.arith.has(t.v) ? otherwise(t.v) : t;
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map((a) => close(a, env)) };
    return { t: "fn", params: t.params.map((p) => close(p, env)), ret: close(t.ret, env), eff: s.resolveRow(t.eff) };
  };
  const constrained = (sc: Scheme) => [...new Set([...(sc.arith ?? []), ...(sc.less ?? []), ...(sc.ordered ?? []), ...(sc.needs ?? []).map(([v]) => v)])];
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

  // The variables of def's body's own type that its scheme's stand for.
  const ownVars = (def: Id, sc: Scheme): Map<number, number> => {
    const out = new Map<number, number>();
    const d = code.nodes[def] as NodeOf<"def"> | undefined;
    const own = d?.body ? info.typeOf.get(d.body) : undefined;
    const pair = (b: Type, p: Type) => {
      b = s.resolve(b); p = s.resolve(p);
      if (b.t === "var") { if (p.t === "var" && !out.has(p.v)) out.set(p.v, b.v); return; }
      if (b.t === "con" && p.t === "con") b.args.forEach((a, i) => p.args[i] && pair(a, p.args[i]));
      if (b.t === "fn" && p.t === "fn") { b.params.forEach((x, i) => p.params[i] && pair(x, p.params[i])); pair(b.ret, p.ret); }
    };
    if (own) pair(own, sc.type);
    return out;
  };
  // The copy of `def` for these types of its number-type variables.
  const copies = new Map<string, Id>(seed?.copies ?? []);
  const todo: { root: Id; env: Env }[] = [];
  const instance = (def: Id, env: Env, sc: Scheme): Id => {
    const vars = constrained(sc);
    // The definition itself is at its own defaults (Int for a whole
    // literal nothing fixes, else Float64): a use at those needs no copy.
    // Its body may be typed with variables of its own (a module's
    // definition), and a whole literal marks those: `sum`'s 0 makes its
    // body's item Int though its scheme's variable is unmarked (C114).
    const ownOf = ownVars(def, sc);
    const mine = (v: number): Type => otherwise(ownOf.get(v) ?? v);
    const at = (v: number): Type => env.get(v) ?? mine(v);
    if (vars.every((v) => JSON.stringify(at(v)) === JSON.stringify(mine(v)))) return def;
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
    schemes.set(id, { ...sc, vars: sc.vars.filter((v) => !env.has(v)), type, ...(sc.arith ? { arith: left(sc.arith) } : {}), ...(sc.less ? { less: left(sc.less) } : {}), ...(sc.ordered ? { ordered: left(sc.ordered) } : {}), needs });
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
      case "call":
        if (isUse(n)) {
          c.fn = kid(n.fn);
          c.given = Object.fromEntries(Object.entries(n.given).map(([k, v]) => [k, kid(v)]));
          if (n.binds) c.binds = Object.fromEntries(Object.entries(n.binds).map(([k, v]) => [k, kid(v)]));
          if (n.body !== undefined) c.body = kid(n.body);
          break;
        }
        c.fn = kid(n.fn); c.args = n.args.map(kid); break;
      case "lambda": c.params = n.params.map(kid); c.body = kid(n.body); if (n.results) c.results = n.results.map(kid); break;
      case "match": c.scrutinee = kid(n.scrutinee); c.arms = n.arms.map(kid); c.otherwise = n.otherwise && kid(n.otherwise); break;
      case "fold": c.scrutinee = kid(n.scrutinee); c.arms = n.arms.map(kid); break;
      case "arm": c.binds = n.binds.map(kid); c.results = n.results.map((r) => r && kid(r)); c.body = kid(n.body); break;
    }
    nodes[fresh] = c as unknown as Node;
    copyOf.set(fresh, copyOf.get(id) ?? id);
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
  const opAt = new Map(seed?.opAt ?? info.opAt ?? []);
  if (seed && info.opAt instanceof OverMap) for (const [id, t] of info.opAt.own()) opAt.set(id, t);
  const copyOf = new Map(seed?.copyOf ?? info.copyOf ?? []);
  const lifted = new Map<string, Id>(seed?.lifted ?? []);
  // Ways (WAYS.md, BACKLOG L96, ways.ts): each implementation's pick,
  // made once.
  const ways = waysIn(code, ops);
  const chosen = new Map<Id, Map<Id, Id | null>>(seed?.chosen ?? []);
  const choose = (impl: Id, variant: NodeOf<"variant">, args: Id[]) => {
    let pick = chosen.get(impl);
    if (!pick) chosen.set(impl, (pick = pickWays(code, ways, variant, args, costOf)));
    return pick;
  };
  const implement = (id: Id, env: Env) => {
    const field = (nodes[id] as NodeOf<"ref">).target, iface = ops.get(field)!;
    let at = close(opAt.get(id) ?? num, env);
    if (at.t === "var") at = num;
    const impl = implementationOf(info, iface, at);
    if (!impl) throw new Error(`${show(at)} has no ${names[iface] ?? iface}`);
    const body = code.nodes[(code.nodes[impl] as NodeOf<"def">).body!] as Call;
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

  // A solve of an interface's field with results (POLAR.md, L97c): a solve
  // of what the type gives for it, or of the way picked, its ports moved
  // from positions to that definition's parameters.
  const implementSolve = (id: Id, env: Env) => {
    const n = nodes[id] as Use;
    const ref: NodeOf<"ref"> = { id, kind: "ref", target: useTarget(nodes, n) };
    const before = nodes[id];
    nodes[id] = ref;
    implement(id, env);
    let target = (nodes[id] as NodeOf<"ref">).target;
    nodes[id] = before;
    const sc = schemes.get(target);
    if (sc && constrained(sc).length) {
      const at: Env = new Map();
      const a = close(opAt.get(id) ?? num, env);
      // The field's own type, at a (L128d3): its inputs to its results.
      const f0 = nodes[useTarget(nodes, n)], fp0 = f0?.kind === "field" ? fieldPorts(nodes, f0) : null;
      const k = fp0?.outs.length ?? 2;
      const fieldType = close({ t: "fn", params: (fp0?.ins ?? [0, 1]).map(() => a), ret: k === 1 ? a : { t: "con", id: `std.tuple${k}`, args: Array.from({ length: k }, () => a) }, eff: pure }, env);
      bind(sc.type, fieldType, new Set(constrained(sc)), at);
      target = instance(target, at, sc);
    }
    const d = nodes[target];
    const lam = d?.kind === "def" && d.body ? nodes[d.body] : null;
    const f1 = nodes[useTarget(nodes, n)], fp1 = f1?.kind === "field" ? fieldPorts(nodes, f1) : null;
    if (fp1 && !(d?.kind === "def" && d.results?.length)) {
      // Given by a plain function of the field's type (L128d4): the use in
      // the field's direction is a call of it, its results taken apart.
      // let r = f(inputs) in (results ↦ body)(r.first, r.second, …)
      const k = fp1.outs.length;
      const outT: Type[] = fp1.outs.map((o) => { const b = bindsOf(n)[String(o)]; return (b ? typeOf.get(b) : undefined) ?? num; });
      const resT: Type = k === 1 ? outT[0] : { t: "con", id: `std.tuple${k}`, args: outT };
      const ins = fp1.ins.map((i) => n.given[String(i)]);
      const call = add({ kind: "call", fn: add({ kind: "ref", target }, { t: "fn", params: ins.map((g) => typeOf.get(g) ?? num), ret: resT, eff: pure }), args: ins }, resT);
      // With no body (L211d) the use is the call itself: its result is
      // the one port, or the tuple of them.
      if (n.body === undefined) { nodes[id] = { ...nodes[call], id } as Node; delete nodes[call]; delete nodes[n.fn]; return; }
      const bodyT = typeOf.get(n.body) ?? num;
      const binders = fp1.outs.map((o, i) => bindsOf(n)[String(o)] ?? add({ kind: "binder" }, outT[i]));
      const inner = add({ kind: "lambda", params: binders, body: n.body }, { t: "fn", params: outT, ret: bodyT, eff: pure });
      if (k === 1) { nodes[id] = { id, kind: "call", fn: inner, args: [call] } as Node; delete nodes[n.fn]; return; }
      const r = add({ kind: "binder" }, resT);
      const parts = fp1.outs.map((_, i) => add({ kind: "call", fn: add({ kind: "ref", target: `std.tuple${k}.tuple.${["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"][i]}` }, { t: "fn", params: [resT], ret: outT[i], eff: pure }), args: [add({ kind: "ref", target: r }, resT)] }, outT[i]));
      const outer = add({ kind: "lambda", params: [r], body: add({ kind: "call", fn: inner, args: parts }, bodyT) }, { t: "fn", params: [resT], ret: bodyT, eff: pure });
      nodes[id] = { id, kind: "call", fn: outer, args: [call] } as Node;
      delete nodes[n.fn];
      return;
    }
    if (lam?.kind !== "lambda") throw new Error(`${names[useTarget(nodes, n)] ?? useTarget(nodes, n)} is given by ${names[target] ?? target}, which isn't a definition of its ports`);
    // The field's inputs are the definition's, in order, and its results
    // the definition's results (L128d): the field read as a function.
    const field = nodes[useTarget(nodes, n)], fp = field?.kind === "field" ? fieldPorts(nodes, field) : null;
    const res = d?.kind === "def" ? d.results ?? [] : [], ins = lam.params.filter((p) => !res.includes(p)), outs = res;
    const key = (k: string) => {
      if (k === "out") return k;
      const i = fp?.ins.indexOf(Number(k)) ?? -1, o = fp?.outs.indexOf(Number(k)) ?? -1;
      return i >= 0 && ins[i] ? ins[i] : o >= 0 && outs[o] ? outs[o] : lam.params[Number(k)];
    };
    const re = (r: Record<string, Id>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [key(k), v]));
    nodes[id] = { ...n, given: re(n.given), binds: re(bindsOf(n)) };
    nodes[n.fn] = { id: n.fn, kind: "ref", target };
  };

  // A relational solve of a generic definition runs it at the types the
  // solve gives it, as a call would (L38: x · n + 1 = 13 with n an Int is
  // solved in whole numbers), its ports moved to the copy's parameters.
  const instanceSolve = (id: Id, env: Env) => {
    const n = nodes[id] as Use;
    const sc = schemes.get(useTarget(nodes, n)), t = info.solveAt?.get(id);
    if (!sc || !t || !constrained(sc).length || nodes[useTarget(nodes, n)]?.kind !== "def") return;
    const at: Env = new Map();
    bind(sc.type, close(t, env), new Set(constrained(sc)), at);
    const target = instance(useTarget(nodes, n), at, sc);
    if (target === useTarget(nodes, n)) return;
    const from = nodes[(nodes[useTarget(nodes, n)] as NodeOf<"def">).body!], to = nodes[(nodes[target] as NodeOf<"def">).body!];
    if (from?.kind !== "lambda" || to?.kind !== "lambda") return;
    const key = (k: string) => (k === "out" ? k : to.params[from.params.indexOf(k)] ?? k);
    const re = (r: Record<string, Id>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [key(k), v]));
    nodes[id] = { ...n, given: re(n.given), binds: re(bindsOf(n)) };
    nodes[n.fn] = { id: n.fn, kind: "ref", target };
  };

  // Resolve every use under `root`, at these types.
  const resolve = (root: Id, env: Env) => {
    const walk = (id: Id, parent: Id | null) => {
      // The one + − · −x < at a type with an implementation of its own
      // (Arithmetic, Ordered): that implementation's operation.
      if (nodes[id].kind === "ref" && (nodes[id] as NodeOf<"ref">).target in ARITH_FIELD) {
        const t = typeOf.get(id), c = t && close(t, env), x = c?.t === "fn" ? c.params[0] : null;
        const f = ARITH_FIELD[(nodes[id] as NodeOf<"ref">).target];
        if (x?.t === "con" && !!implementationOf(info, f.iface, x)) { nodes[id] = { id, kind: "ref", target: f.field }; opAt.set(id, x); }
      }
      if (nodes[id].kind === "ref" && ops.has((nodes[id] as NodeOf<"ref">).target)) implement(id, env);
      if (isUse(nodes[id]) && ops.has(useTarget(nodes, (nodes[id] as Use)))) implementSolve(id, env);
      else if (isUse(nodes[id])) instanceSolve(id, env);
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
        case "call":
          if (isUse(n)) { kids.push(...useKids(n)); break; }
          kids.push(n.fn, ...n.args); break;
        case "lambda": kids.push(n.body); break;
        case "def": if (n.body) kids.push(n.body); break;
        case "match": kids.push(n.scrutinee, ...n.arms, ...(n.otherwise ? [n.otherwise] : [])); break;
        case "fold": kids.push(n.scrutinee, ...n.arms); break;
        case "arm": kids.push(n.body); break;
      }
      for (const k of kids) walk(k, id);
    };
    walk(root, null);
  };

  // A literal at Rational, Algebraic or Fixed as its constructor's
  // call; at Complex or Dual through the embedding from Float64 (above).
  const intLit = (v: bigint): NodeData => ({ kind: "lit", value: v >= -9007199254740991n && v <= 9007199254740991n ? Number(v) : String(v), of: INT });
  // A Float64 literal at a type Float64 embeds in (L208e): map(x) of the
  // canonical embedding, so 0.5 at Complex is float64 in complex's: no
  // constructor of its own here.
  const throughEmbedding = (id: Id, x: number, t: Type): boolean => {
    const emb: Type = { t: "con", id: EMBEDDING, args: [num, t] };
    const e = implementationOf(info, EMBEDDING, emb);
    if (!e) return false;
    const fn: Type = { t: "fn", params: [num], ret: t, eff: pure };
    // An embedding whose map is a named function calls it: as complex(x).
    // A shader can't call a function read from a record.
    const body = code.nodes[(code.nodes[e] as NodeOf<"def"> | undefined)?.body ?? ""], arg = isCall(body) && body.args.length === 1 ? code.nodes[body.args[0]] : undefined;
    if (arg?.kind === "ref" && code.nodes[arg.target]?.kind === "def") {
      nodes[id] = { id, kind: "call", fn: add({ kind: "ref", target: arg.target }, fn), args: [add({ kind: "lit", value: x, of: NUMBER }, num)] };
      typeOf.set(id, t);
      return true;
    }
    const map = add({ kind: "call", fn: add({ kind: "ref", target: EMBEDDING_MAP }, { t: "fn", params: [emb], ret: fn, eff: pure }), args: [add({ kind: "ref", target: e }, emb)] }, fn);
    nodes[id] = { id, kind: "call", fn: map, args: [add({ kind: "lit", value: x, of: NUMBER }, num)] };
    typeOf.set(id, t);
    return true;
  };
  const literal = (n: NodeOf<"lit">) => {
    const t: Type = { t: "con", id: n.of!, args: [] };
    if ((n.of === COMPLEX_TYPE || n.of === DUAL_TYPE) && throughEmbedding(n.id, typeof n.value === "number" ? n.value : 0, t)) return;
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
  // (0.25 is 1/4 exactly: the digits as written), a Complex with 0i, a type
  // with a Literal its from fraction (a matrix: that many times the
  // identity, L204c), a record of Float64s with it in every part; a
  // Float64 as it is.
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
    // A type with a Literal of its own (L204b): its from fraction, given
    // the number as top/bottom.
    const impl = implementationOf(info, LITERAL, t);
    if (impl) {
      const [top, bottom] = ratioParts(decimal(x)) ?? [0n, 1n];
      const whole: Type = { t: "con", id: INT, args: [] };
      const made: Type = { t: "fn", params: [whole, whole], ret: t, eff: pure }, given: Type = { t: "con", id: LITERAL, args: [t] };
      // match literal at t { literal(f) → f(top, bottom) }: its field read
      // by its case, so nothing here is an interface's operation to resolve.
      const f = add({ kind: "binder" }, made);
      const body = add({ kind: "call", fn: add({ kind: "ref", target: f }, made), args: [add(intLit(top), whole), add(intLit(bottom), whole)] }, t);
      const arm = add({ kind: "arm", variant: LITERAL_V, binds: [f], results: [null], body } as NodeData, t);
      nodes[n.id] = { id: n.id, kind: "match", scrutinee: add({ kind: "ref", target: impl }, given), arms: [arm], otherwise: null };
      typeOf.set(n.id, t);
      return;
    }
    const variant = recordVariant(code, t.id);
    if (!variant) return;
    const fields = (code.nodes[variant] as NodeOf<"variant">).fields;
    const fn = add({ kind: "ref", target: variant }, { t: "fn", params: fields.map(() => num), ret: t, eff: pure });
    nodes[n.id] = { id: n.id, kind: "call", fn, args: fields.map(() => add({ kind: "lit", value: x }, num)) };
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
    const call = parent && isCall(nodes[parent]) && (nodes[parent] as Call).fn === id ? (nodes[parent] as Call) : null;
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
    if (seed && d in seed.layer.nodes) continue;
    const n = code.nodes[d];
    if (n?.kind !== "def" || !n.body) continue;
    const sc = schemes.get(d);
    resolve(n.body, new Map((sc ? constrained(sc) : []).map((v) => [v, otherwise(v)])));
  }
  while (todo.length) { const { root, env } = todo.pop()!; resolve(root, env); }
  if (snapshot) {
    const added = (m: Names) => Object.fromEntries(Object.entries(m).filter(([id]) => !(id in names)));
    // Shared by every program's resolving from here on, so frozen: a
    // reader that wrote into one would change the next program's.
    for (const id in nodes) if (nodes[id] !== code.nodes[id]) Object.freeze(nodes[id]);
    return { layer: true, nodes, defs, typeOf, schemes, divergent, names: added(outNames), copies, opAt, copyOf, lifted, chosen };
  }
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
    const { arith: _a, less: _l, ordered: _o, fractional: _f, whole: _w, needs: _n, ...rest } = sc;
    const left = (xs?: number[]) => (xs ?? []).filter((v) => !vars.includes(v));
    schemes.set(d, { ...rest, vars: left(sc.vars), type: close(sc.type, new Map(vars.map((v) => [v, otherwise(v)]))),
      ...(left(sc.arith).length ? { arith: left(sc.arith) } : {}), ...(left(sc.less).length ? { less: left(sc.less) } : {}), ...(left(sc.ordered).length ? { ordered: left(sc.ordered) } : {}), ...(left(sc.fractional).length ? { fractional: left(sc.fractional) } : {}) });
  }

  return { code: { nodes, defs }, info: { ...info, typeOf, schemes, divergent, copyOf }, names: outNames };
}

// Each expression the checker lifted through a canonical embedding (L208c,
// EMBEDDINGS.md) is given to the embedding's map where it is used: in
// `add(i, x)` with i an Int and x a Float64, i becomes map(i) of int in
// float64. The expression keeps its node, so what is known of it (its
// type, the type an operation in it is at) stays.
function insertEmbeddings(code: Code, info: Info): { code: Code; info: Info } {
  if (!info.embedded?.size) return { code, info };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const typeOf = new Map(info.typeOf);
  const none = { effs: [], tail: null };
  // map(x) of the embedding, its nodes named after `at`.
  const wrap = (x: Id, at: Id, e: { def: Id; from: Type; to: Type }): Id => {
    const emb: Type = { t: "con", id: EMBEDDING, args: [e.from, e.to] }, fn: Type = { t: "fn", params: [e.from], ret: e.to, eff: none };
    const field = `${at}.field`, of = `${at}.of`, map = `${at}.map`;
    nodes[field] = { id: field, kind: "ref", target: EMBEDDING_MAP };
    nodes[of] = { id: of, kind: "ref", target: e.def };
    nodes[map] = { id: map, kind: "call", fn: field, args: [of] };
    nodes[at] = { id: at, kind: "call", fn: map, args: [x] };
    typeOf.set(field, { t: "fn", params: [emb], ret: fn, eff: none });
    typeOf.set(of, emb);
    typeOf.set(map, fn);
    typeOf.set(at, e.to);
    return at;
  };
  const lift = (a: Id): Id => {
    const e = info.embedded!.get(a);
    if (!e) return a;
    if (!e.of) return wrap(a, `${a}.embed`, e);
    // A function whose result is lifted (L208c2): a lambda's body is
    // wrapped where it is; any other function becomes (x…) → map(f(x…)).
    const lifted: Type = { ...e.of, ret: e.to };
    const f = code.nodes[a];
    if (f?.kind === "lambda") {
      nodes[a] = { ...f, body: wrap(f.body, `${a}.embed`, e) };
      typeOf.set(a, lifted);
      return a;
    }
    const params = e.of.params.map((t, j) => { const b = `${a}.embed.p${j}`; nodes[b] = { id: b, kind: "binder" }; typeOf.set(b, t); return b; });
    const refs = params.map((b, j) => { const r = `${a}.embed.r${j}`; nodes[r] = { id: r, kind: "ref", target: b }; typeOf.set(r, e.of!.params[j]); return r; });
    const call = `${a}.embed.call`, lam = `${a}.embed.fn`;
    nodes[call] = { id: call, kind: "call", fn: a, args: refs };
    typeOf.set(call, e.from);
    nodes[lam] = { id: lam, kind: "lambda", params, body: wrap(call, `${a}.embed`, e) };
    typeOf.set(lam, lifted);
    return lam;
  };
  for (const n of Object.values(code.nodes)) {
    // A pinned definition's body (L208c4), and a call's inputs.
    if (n.kind === "def" && n.body && info.embedded.has(n.body)) nodes[n.id] = { ...n, body: lift(n.body) };
    if (n.kind !== "call" || !n.args?.some((a) => info.embedded!.has(a))) continue;
    nodes[n.id] = { ...n, args: n.args.map(lift) } as Node;
  }
  return { code: { ...code, nodes }, info: { ...info, typeOf } };
}
