// A tiny strict interpreter. The environment is keyed by binder id, so names
// can't shadow, capture or collide: there is nothing to collide on.

import type { Code, Id } from "./model.ts";
import { impl } from "./prelude.ts";

export type Value = number | string | ((...args: Value[]) => Value);

export function evaluate(code: Code, id: Id, env: Map<Id, Value> = new Map(), defs = new Map<Id, Value>()): Value {
  const ev = (id: Id, env: Map<Id, Value>): Value => {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": return n.value;
      case "ref": {
        if (env.has(n.target)) return env.get(n.target)!;
        return ev(n.target, env);
      }
      case "builtin": return impl[n.op as keyof typeof impl] as Value;
      case "def": {
        if (!defs.has(id)) {
          if (n.body === null) throw new Error(`extern ${id} has no value`);
          defs.set(id, ev(n.body, new Map()));
        }
        return defs.get(id)!;
      }
      case "lambda":
        return (...args: Value[]) => {
          const inner = new Map(env);
          n.params.forEach((p, i) => inner.set(p, args[i]));
          return ev(n.body, inner);
        };
      case "call": {
        const f = ev(n.fn, env);
        if (typeof f !== "function") throw new Error(`calling a non-function at ${id}`);
        return f(...n.args.map((a) => ev(a, env)));
      }
      case "binder": throw new Error(`unbound binder ${id}`);
      case "hole": throw new Error("the program has a hole here");
    }
  };
  return ev(id, env);
}
