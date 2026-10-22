// The evaluator for the typed core, effects included.
//
// Every expression evaluates to a lazy stream of results. Pure code produces
// exactly one. `one of` produces several, `fail` none, and a call runs its
// function once for every combination of results of its parts, in order.
// That is all Choice is: backtracking search, the same as the relation
// solver's branches (canonical first, more on demand). The handlers just
// consume the stream: `first` takes the first result (or runs the fallback),
// `all` collects, `count` counts. Console is a callback. Diverge is
// handled by the runtime, or turned into failure by `with fuel`.

import type { Code, Id, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { impl } from "../prelude.ts";
import type { Info } from "./infer.ts";
import { derivativeLambda } from "./derive.ts";
import { relate, toValue } from "./relate.ts";
import { planSolve, solutions } from "./solve.ts";
import { CONS, FALSE, NIL, S, STD_IMPL, TRUE, UNIT_V } from "./std.ts";
import { CONSOLE, DIVERGE } from "./types.ts";

export interface Data { tag: Id; fields: Value[] }
export type Fn = (...args: Value[]) => Iterable<Value>;
export type Value = number | string | Data | Fn;

export const bool = (b: boolean): Data => ({ tag: b ? TRUE : FALSE, fields: [] });
export const unit: Data = { tag: UNIT_V, fields: [] };
export const toList = (xs: Value[]): Data => xs.reduceRight<Data>((tail, x) => ({ tag: CONS, fields: [x, tail] }), { tag: NIL, fields: [] });
export function fromList(v: Value): Value[] {
  const out: Value[] = [];
  for (let d = v as Data; d.tag === CONS; d = d.fields[1] as Data) out.push(d.fields[0]);
  return out;
}

export function equal(a: Value, b: Value): boolean {
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  return a.tag === b.tag && a.fields.every((f, i) => equal(f, b.fields[i]));
}

// Function values remember the node they came from (a lambda and the
// variables it closed over, or a builtin, constructor or projection), so the
// relational interpreter and `derivative` can look inside them.
export const META = Symbol("node");
const tag = <F extends Fn>(f: F, meta: { lambda: Id; env: Map<Id, Value> } | { prim: Id }): F => Object.assign(f, { [META]: meta });

export interface Runtime {
  print: (line: string) => void;
}

// Runs `gen` with `enter`/`exit` around every step, so a handler's dynamic
// state (fuel) is in place exactly while its body is running.
function* scoped<T>(gen: Iterable<T>, enter: () => void, exit: () => void): Generator<T> {
  const it = gen[Symbol.iterator]();
  while (true) {
    enter();
    let r: IteratorResult<T>;
    try { r = it.next(); } finally { exit(); }
    if (r.done) return;
    yield r.value;
  }
}

export function makeRunner(code: Code, info: Info, rt: Runtime) {
  // Our own copy of the node table: `derivative` writes new code into it.
  code = { nodes: { ...code.nodes }, defs: code.defs };
  const fuel: { left: number }[] = [];
  const defs = new Map<Id, Value>();
  const one = (x: Value): Iterable<Value> => [x];

  const builtins: Record<Id, Fn> = {};
  for (const [op, f] of Object.entries(impl)) builtins[`builtin.${op}`] = (...a) => one(f(...(a as number[])));
  for (const [id, f] of Object.entries(STD_IMPL)) builtins[id] = (...a) => one(f(...a));
  Object.assign(builtins, {
    [S.less]: (a, b) => one(bool((a as number) < (b as number))),
    [S.equal]: (a, b) => one(bool(equal(a, b))),
    [S.and]: (a, b) => one(bool((a as Data).tag === TRUE && (b as Data).tag === TRUE)),
    [S.or]: (a, b) => one(bool((a as Data).tag === TRUE || (b as Data).tag === TRUE)),
    [S.not]: (a) => one(bool((a as Data).tag !== TRUE)),
    [S.range]: (n) => one(toList(Array.from({ length: Math.max(0, n as number) }, (_, i) => i))),
    [S.oneOf]: (xs) => fromList(xs),
    [S.fail]: () => [],
    [S.print]: (s) => (rt.print(s as string), one(unit)),
    [S.all]: function* (body) { yield toList([...(body as Fn)()]); },
    [S.count]: function* (body) { let n = 0; for (const _ of (body as Fn)()) n++; yield n; },
    [S.first]: function* (body, otherwise) {
      for (const x of (body as Fn)()) { yield x; return; }
      yield* (otherwise as Fn)();
    },
    [S.derivative]: (f) => {
      const m = (f as unknown as Record<symbol, { lambda?: Id; env?: Map<Id, Value> }>)[META];
      if (!m?.lambda) throw new Error("derivative needs a function written in the program, to look inside it");
      return ev(derivativeLambda(code, m.lambda), m.env!);
    },
    [S.fuel]: (n, body) => {
      const frame = { left: n as number };
      return scoped((body as Fn)(), () => fuel.push(frame), () => fuel.pop());
    },
  } satisfies Record<Id, Fn>);
  for (const [id, f] of Object.entries(builtins)) tag(f, { prim: id });

  // Every combination of the results of `ids`, in order (left to right,
  // earlier choices varying slowest).
  function* each(ids: Id[], env: Map<Id, Value>, i = 0, acc: Value[] = []): Generator<Value[]> {
    if (i === ids.length) { yield acc; return; }
    for (const v of ev(ids[i], env)) yield* each(ids, env, i + 1, [...acc, v]);
  }

  function* ev(id: Id, env: Map<Id, Value>): Generator<Value> {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": yield n.value; return;
      case "ref": yield refValue(n.target, env); return;
      case "lambda":
        yield tag((...args: Value[]) => {
          const inner = new Map(env);
          n.params.forEach((p, i) => inner.set(p, args[i]));
          return ev(n.body, inner);
        }, { lambda: id, env });
        return;
      case "call": {
        const head = code.nodes[n.fn];
        const target = head.kind === "ref" ? head.target : null;
        // Each call into a possibly-divergent definition spends fuel, if a
        // `with fuel` handler is active. Out of fuel means no result.
        if (target && info.divergent.has(target) && fuel.length && --fuel[fuel.length - 1].left < 0) return;
        for (const [f, ...args] of each([n.fn, ...n.args], env)) yield* (f as Fn)(...args);
        return;
      }
      case "match":
        for (const v of ev(n.scrutinee, env)) {
          const d = v as Data;
          const arm = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">).find((a) => a.variant === d.tag);
          if (arm) yield* ev(arm.body, bind(env, arm.binds, d.fields));
          else yield* ev(n.otherwise!, env);
        }
        return;
      case "fold": {
        const arms = new Map(n.arms.map((a) => { const arm = code.nodes[a] as NodeOf<"arm">; return [arm.variant, arm]; }));
        // Children are folded before their parent (bottom-up), as a fold
        // does. With Choice, each combination of the children's results is
        // a separate branch.
        const fold = function* (v: Value): Generator<Value> {
          const d = v as Data;
          const arm = arms.get(d.tag)!;
          const rec = arm.results.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
          const combos = function* (k: number, acc: Value[]): Generator<Value[]> {
            if (k === rec.length) { yield acc; return; }
            for (const r of fold(d.fields[rec[k]])) yield* combos(k + 1, [...acc, r]);
          };
          for (const results of combos(0, [])) {
            const inner = bind(env, arm.binds, d.fields);
            rec.forEach((i, k) => inner.set(arm.results[i]!, results[k]));
            yield* ev(arm.body, inner);
          }
        };
        for (const v of ev(n.scrutinee, env)) yield* fold(v);
        return;
      }
      case "solve": {
        const keys = Object.keys(n.given);
        const p = planSolve(code, n);
        if (p.mode === "relational") {
          // Each step that might unfold forever spends the innermost fuel.
          const spend = () => !(fuel.length && --fuel[fuel.length - 1].left < 0);
          for (const vals of each(keys.map((k) => n.given[k]), env)) {
            for (const sol of relate(code, n.fn, Object.fromEntries(keys.map((k, i) => [k, vals[i]])), { spend })) {
              const bound = Object.keys(n.binds).map((k) => toValue(sol.values[k]));
              if (bound.some((v) => v === undefined)) continue; // not pinned down: not an answer
              yield* ev(n.body, bind(env, Object.values(n.binds), bound as Value[]));
            }
          }
          return;
        }
        const rel = p.rel!;
        for (const vals of each(keys.map((k) => n.given[k]), env)) {
          for (const sol of solutions(rel, Object.fromEntries(keys.map((k, i) => [k, vals[i] as number])))) {
            // A port the equations leave free has no value: not a solution.
            if (Object.keys(n.binds).some((k) => sol[k] === null || sol[k] === undefined)) continue;
            yield* ev(n.body, bind(env, Object.values(n.binds), Object.keys(n.binds).map((k) => sol[k]!)));
          }
        }
        return;
      }
      case "hole": throw new Error("the program reached a hole");
      default: throw new Error(`can't evaluate a ${n.kind}`);
    }
  }

  const bind = (env: Map<Id, Value>, binders: Id[], values: Value[]) => {
    const inner = new Map(env);
    binders.forEach((b, i) => inner.set(b, values[i]));
    return inner;
  };

  function refValue(target: Id, env: Map<Id, Value>): Value {
    if (env.has(target)) return env.get(target)!;
    const t = code.nodes[target];
    switch (t.kind) {
      case "def": {
        if (!defs.has(target)) {
          // Definition values are pure (the checker sees to it), so exactly
          // one result.
          for (const v of ev(t.body!, new Map())) { defs.set(target, v); break; }
        }
        return defs.get(target)!;
      }
      case "builtin":
        if (!builtins[target]) throw new Error(`no implementation for ${target}`);
        return builtins[target];
      case "variant":
        return t.fields.length ? tag((...fields: Value[]) => one({ tag: target, fields }), { prim: target }) : { tag: target, fields: [] };
      case "field": {
        const v = info.owner.get(target)!;
        const variant = (code.nodes[(code.nodes[v] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants[0];
        const i = (code.nodes[variant] as NodeOf<"variant">).fields.indexOf(target);
        return tag((d) => one((d as Data).fields[i]), { prim: target });
      }
      default: throw new Error(`unbound ${target}`);
    }
  }

  return {
    ev,
    value: (def: Id) => refValue(def, new Map()),
    // Call a function value and stream its results.
    call: (f: Value, ...args: Value[]) => (f as Fn)(...args),
  };
}

// Run an action (a definition of type () -> ...). Only effects the runtime
// can handle may be left: Console and Diverge. Anything else (an unhandled
// Choice) is reported before anything runs.
export function runMain(code: Code, info: Info, def: Id, rt: Runtime = { print: (s) => console.log(s) }): Value {
  const t = info.typeOf.get(def);
  if (!t || t.t !== "fn" || t.params.length) throw new Error("only an action (a function with no inputs) can be run");
  const extra = t.eff.effs.filter((e) => e !== CONSOLE && e !== DIVERGE);
  if (extra.length) throw new Error(`unhandled effect: ${extra.join(", ")}; wrap it in first, all or count`);
  const r = makeRunner(code, info, rt);
  for (const v of r.call(r.value(def))) return v;
  throw new Error("no result");
}

export function showValue(v: Value, code: Code, names: Names): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e9) / 1e9);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "function") return "<function>";
  if (v.tag === CONS || v.tag === NIL) return `[${fromList(v).map((x) => showValue(x, code, names)).join(", ")}]`;
  const name = names[v.tag] ?? v.tag;
  return v.fields.length ? `${name}(${v.fields.map((x) => showValue(x, code, names)).join(", ")})` : name;
}

