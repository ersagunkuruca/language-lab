// Values on wires: run one definition on example inputs and record the
// value every node in it produced. The editor draws them next to each
// node's output, so a dataflow picture shows the data flowing.
//
// It walks the definition's own tree and leaves everything else to the
// evaluator (run.ts): a call's value is the callee run on the argument
// values, a fold's is the evaluator's. Only what ran gets a value: the arm
// a match didn't take has none, and a function's body has none until it's
// called (with its own example). A Choice shows its first answer. Printing
// is swallowed. Definitions that might not finish aren't traced, and
// neither is anything that calls one.

import type { Code, Id, NodeOf } from "../model.ts";
import type { Info } from "./infer.ts";
import { makeRunner, type Data, type Value } from "./run.ts";

export interface Trace { values: Map<Id, Value>; result?: Value; error?: { id: Id; message: string } }

export function trace(code: Code, info: Info, def: Id, args: Value[]): Trace {
  const values = new Map<Id, Value>();
  const out: Trace = { values };
  if (info.divergent.has(def)) { out.error = { id: def, message: "it might not finish, so it isn't run here" }; return out; }
  const r = makeRunner(code, info, { print: () => {} });
  const first = (xs: Iterable<Value>, id: Id): Value => {
    for (const x of xs) return x;
    throw Object.assign(new Error("no answer (a Choice with none)"), { id });
  };
  const divergent = (id: Id) => { const n = code.nodes[id]; return n.kind === "call" && code.nodes[n.fn].kind === "ref" && info.divergent.has((code.nodes[n.fn] as NodeOf<"ref">).target); };

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
        const d = walk(n.scrutinee, env) as Data;
        const arm = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">).find((a) => a.variant === d.tag);
        if (!arm) { v = walk(n.otherwise!, env); break; }
        const inner = new Map(env);
        arm.binds.forEach((b, i) => { inner.set(b, d.fields[i]); values.set(b, d.fields[i]); });
        v = walk(arm.body, inner);
        values.set(arm.id, v);
        break;
      }
      case "fold": walk(n.scrutinee, env); v = first(r.ev(id, env), id); break;
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
      body.params.forEach((p, i) => { env.set(p, args[i]); values.set(p, args[i]); });
      out.result = walk(body.body, env);
    } else if (body && body.kind !== "typedef") out.result = walk(body.id, new Map());
  } catch (e) {
    out.error = { id: (e as { id?: Id }).id ?? def, message: (e as Error).message };
  }
  return out;
}
