// Values on wires: run one definition on example inputs and record the
// value every node in it produced. The editor draws them next to each
// node's output, so a dataflow picture shows the data flowing.
//
// It walks the definition's own tree and leaves everything else to the
// evaluator (run.ts): a call's value is the callee run on the argument
// values, a fold's is the evaluator's. Only what ran gets a value: the arm
// a match didn't take has none, and a function's body has none until it's
// called (with its own example). A fold shows its outermost pass: the case
// the value took, with the rest already folded. A handler shows its result.
// A Choice shows its first answer. Printing
// is swallowed. Definitions that might not finish aren't traced, and
// neither is anything that calls one.

import type { Code, Id, NodeOf } from "../model.ts";
import type { Info } from "./infer.ts";
import { DEF_VALUE, makeRunner, type Data, type Runtime, type Value } from "./run.ts";

export interface Trace { values: Map<Id, Value>; result?: Value; error?: { id: Id; message: string } }

// `world` is what the world effects do (run.ts Runtime); without one they
// abort saying so.
// `entered`: told of every call to a function written as a lambda (run.ts).
export function trace(code: Code, info: Info, def: Id, args: Value[], world?: Runtime["world"], entered?: Runtime["entered"]): Trace {
  const values = new Map<Id, Value>();
  const out: Trace = { values };
  if (info.divergent.has(def)) { out.error = { id: def, message: "it might not finish, so it isn't run here" }; return out; }
  const r = makeRunner(code, info, { print: () => {}, world, entered });
  const first = (xs: Iterable<Value>, id: Id): Value => {
    for (const x of xs) return x;
    throw Object.assign(new Error("no answer (a Choice with none)"), { id });
  };
  const divergent = (id: Id) => { const n = code.nodes[id]; return n.kind === "call" && code.nodes[n.fn].kind === "ref" && info.divergent.has((code.nodes[n.fn] as NodeOf<"ref">).target); };

  const handler = (n: NodeOf<"match">) => {
    const owner = n.arms.length ? info.owner.get((code.nodes[n.arms[0]] as NodeOf<"arm">).variant) : undefined;
    const d = owner ? code.nodes[owner] : null;
    return d?.kind === "def" && !!d.body && !!(code.nodes[d.body] as { effect?: true }).effect;
  };

  const walk = (id: Id, env: Map<Id, Value>): Value => {
    const n = code.nodes[id];
    let v: Value;
    if (divergent(id)) throw Object.assign(new Error("calls something that might not finish"), { id });
    switch (n.kind) {
      case "hole": throw Object.assign(new Error("reached a hole"), { id });
      case "call": {
        const head = code.nodes[n.fn];
        const vals = n.args.map((a) => walk(a, env));
        if (head.kind === "lambda") {
          // A let: its dots get the values, then its body runs.
          const inner = new Map(env);
          head.params.forEach((p, i) => { inner.set(p, vals[i]); values.set(p, vals[i]); });
          v = walk(head.body, inner);
        } else v = first(r.call(walk(n.fn, env), ...vals), id);
        break;
      }
      case "match": {
        // A handler's value examined is a computation that performs its
        // effect, which only the evaluator can run with the handler around
        // it: the handler shows its result.
        if (handler(n)) { v = first(r.ev(id, env), id); break; }
        const d = walk(n.scrutinee, env) as Data;
        const arm = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">).find((a) => a.variant === d.tag);
        if (!arm) { v = walk(n.otherwise!, env); break; }
        const inner = new Map(env);
        arm.binds.forEach((b, i) => { inner.set(b, d.fields[i]); values.set(b, d.fields[i]); });
        v = walk(arm.body, inner);
        values.set(arm.id, v);
        break;
      }
      case "fold": {
        // The case the value itself took, with each recursive part already
        // folded (the evaluator folds it): one pass, the outermost, is
        // what the frame shows.
        const d = walk(n.scrutinee, env) as Data;
        const at = code.nodes[n.scrutinee];
        const arm = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">).find((a) => a.variant === d.tag);
        if (!arm || at.kind !== "ref" || code.nodes[at.target]?.kind !== "binder") { v = first(r.ev(id, env), id); break; }
        const inner = new Map(env);
        arm.binds.forEach((b, i) => { inner.set(b, d.fields[i]); values.set(b, d.fields[i]); });
        arm.results.forEach((res, i) => {
          if (!res) return;
          const folded = first(r.ev(id, new Map(env).set(at.target, d.fields[i])), id);
          inner.set(res, folded);
          values.set(res, folded);
        });
        v = walk(arm.body, inner);
        values.set(arm.id, v);
        break;
      }
      default: v = first(r.ev(id, env), id);
    }
    values.set(id, v);
    return v;
  };

  const d = code.nodes[def] as NodeOf<"def">;
  const body = d.body ? code.nodes[d.body] : null;
  try {
    if (body?.kind === "lambda") {
      const env = new Map<Id, Value>();
      // A definition given by its name (values.ts) is its function.
      const given = args.map((a) => (typeof a === "object" && a !== null && "tag" in a && a.tag === DEF_VALUE ? r.value(a.fields[0] as Id) : a));
      body.params.forEach((p, i) => { env.set(p, given[i]); values.set(p, given[i]); });
      out.result = walk(body.body, env);
    } else if (body && body.kind !== "typedef") out.result = walk(body.id, new Map());
  } catch (e) {
    out.error = { id: (e as { id?: Id }).id ?? def, message: (e as Error).message };
  }
  return out;
}
