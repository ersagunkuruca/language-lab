// One + for every number type, resolved by type before anything runs
// (NUMBERS.md, "One `+` for every number system").
//
// The program stores one generic `+` (std.ts ARITH), whose type says "any
// number type". A small Int and a Number are the same JavaScript value, so
// the operation can't be chosen by looking at the value: it is chosen by
// the type, here, once. This is a code → code pass, like `represent`:
//
//   - a call whose type is known becomes the type's own operation: Number's
//     builtin, Int's builtin, or `zip parts` / `map parts` of Number's on a
//     record of Numbers;
//   - a generic definition used at another type gets a copy for that type
//     (monomorphisation, as MLton does for every definition and the
//     compiler's scalar profile already does), and its uses point at it.
//     Hindley-Milner has no polymorphic recursion, so this always ends;
//   - a type still open where the operation is used is Number, as Haskell
//     defaults Num (the Run pane on `smaller`, with no caller to say).
//
// The evaluator, relate.ts and the compiler get the resolved program, so
// none of them sees a generic operation and nothing dispatches at run
// time. A program with no generic operation comes back as it was. The
// definition's own id stays its Number version, so entry points and names
// keep working, and the meaning hash is of the program as written.

import type { Code, Id, Node, NodeData, NodeOf } from "../model.ts";
import { freshId } from "../model.ts";
import type { Names } from "../presentation.ts";
import { B } from "../prelude.ts";
import type { Info } from "./infer.ts";
import { ARITH, INT_OPS, S } from "./std.ts";
import { COMPLEX_TYPE, INT, NUMBER, RATIONAL_TYPE, type Row, type Scheme, type Type } from "./types.ts";
import { PRELUDE } from "./library.ts";

const num: Type = { t: "con", id: NUMBER, args: [] };
const pure: Row = { effs: [], tail: null };

// Each generic operation's own operation at Number and at Int.
const AT: Record<Id, { number: Id; int: Id; arity: 1 | 2 }> = {
  [ARITH.add]: { number: B.add, int: INT_OPS.add, arity: 2 },
  [ARITH.sub]: { number: B.sub, int: INT_OPS.sub, arity: 2 },
  [ARITH.mul]: { number: B.mul, int: INT_OPS.mul, arity: 2 },
  [ARITH.neg]: { number: B.neg, int: INT_OPS.neg, arity: 1 },
  [ARITH.less]: { number: S.less, int: INT_OPS.less, arity: 2 },
};

// And at the number types that are data (std.ts): the prelude's
// definitions, found by name when first needed (their ids are their
// content's hashes). Complex has no <.
const PRELUDE_AT: Record<string, Record<Id, string>> = {
  [RATIONAL_TYPE]: {
    [ARITH.add]: "add fractions", [ARITH.sub]: "subtract fractions", [ARITH.mul]: "multiply fractions",
    [ARITH.neg]: "negate fraction", [ARITH.less]: "fraction less than",
  },
  [COMPLEX_TYPE]: {
    [ARITH.add]: "add complex", [ARITH.sub]: "subtract complex", [ARITH.mul]: "multiply complex", [ARITH.neg]: "negate complex",
  },
};
const preludeOps = new Map<string, Record<Id, Id>>();
const atPrelude = (type: string, op: Id): Id => {
  let ops = preludeOps.get(type);
  if (!ops) {
    ops = Object.fromEntries(Object.entries(PRELUDE_AT[type]).map(([g, name]) => {
      const d = Object.keys(PRELUDE.names).find((id) => PRELUDE.names[id] === name && PRELUDE.code.nodes[id]?.kind === "def");
      if (!d) throw new Error(`the prelude has no ${name}`);
      return [g, d];
    }));
    preludeOps.set(type, ops);
  }
  return ops[op];
};

export const usesGenericArithmetic = (code: Code) =>
  Object.values(code.nodes).some((n) => n.kind === "ref" && n.target in AT);

export function resolveArithmetic(code: Code, info: Info, names: Names = {}): { code: Code; info: Info; names: Names } {
  if (!usesGenericArithmetic(code)) return { code, info, names };
  const s = info.subst;
  const nodes: Record<Id, Node> = { ...code.nodes };
  const defs = [...code.defs];
  const typeOf = new Map(info.typeOf);
  const schemes = new Map(info.schemes);
  const divergent = new Set(info.divergent);
  const outNames: Names = { ...names };

  type Env = Map<number, Type>;
  // A type with the definition's variables replaced, and every number-type
  // variable left open made Number.
  const close = (t: Type, env: Env): Type => {
    t = s.resolve(t);
    if (t.t === "var") return env.has(t.v) ? env.get(t.v)! : s.arith.has(t.v) ? num : t;
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map((a) => close(a, env)) };
    return { t: "fn", params: t.params.map((p) => close(p, env)), ret: close(t.ret, env), eff: s.resolveRow(t.eff) };
  };
  const constrained = (sc: Scheme) => [...(sc.arith ?? []), ...(sc.ordered ?? [])];
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
    if (vars.every((v) => { const t = env.get(v); return !t || (t.t === "con" && t.id === NUMBER); })) return def;
    const key = `${def}|${vars.map((v) => JSON.stringify(env.get(v) ?? num)).join(",")}`;
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
    outNames[id] = `${names[def] ?? def} at ${vars.map((v) => show(env.get(v) ?? num)).join(", ")}`;
    const type = close(sc.type, env);
    const left = (xs?: number[]) => (xs ?? []).filter((v) => !env.has(v));
    schemes.set(id, { ...sc, vars: sc.vars.filter((v) => !env.has(v)), type, ...(sc.arith ? { arith: left(sc.arith) } : {}), ...(sc.ordered ? { ordered: left(sc.ordered) } : {}) });
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
    const t = info.typeOf.get(id);
    if (t) typeOf.set(fresh, close(t, env));
    return fresh;
  };

  // Resolve every use under `root`, at these types.
  const resolve = (root: Id, env: Env) => {
    const walk = (id: Id, parent: Id | null) => {
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

  // A generic operation at its type: the type's own, or part by part.
  const operation = (id: Id, t: Type, parent: Id | null) => {
    const at = AT[(nodes[id] as NodeOf<"ref">).target];
    const x = t.t === "fn" ? t.params[0] : num;
    if (x.t === "con" && (x.id === NUMBER || x.id === INT || x.id in PRELUDE_AT)) {
      const target = (nodes[id] as NodeOf<"ref">).target;
      nodes[id] = { id, kind: "ref", target: x.id === INT ? at.int : x.id in PRELUDE_AT ? atPrelude(x.id, target) : at.number };
      typeOf.set(id, t);
      return;
    }
    // A record of Numbers (the checker allows nothing else here): Number's
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

  // Every definition at its own types, its number-type variables Number;
  // then each copy that made, until none is new.
  for (const d of code.defs) {
    const n = code.nodes[d];
    if (n?.kind !== "def" || !n.body) continue;
    const sc = schemes.get(d);
    resolve(n.body, new Map((sc ? constrained(sc) : []).map((v) => [v, num])));
  }
  while (todo.length) { const { root, env } = todo.pop()!; resolve(root, env); }

  return { code: { nodes, defs }, info: { ...info, typeOf, schemes, divergent }, names: outNames };
}
