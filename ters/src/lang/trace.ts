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
// A caller that bounds the run with it (throwing when time is up) may run
// one that might not finish (newton, I78).
// `copied`: a caller ran this definition as a copy at other number types
// (arith.ts): + on multivectors, say, where the definition as written
// defaults to Float64's (BACKLOG I125). When the definition as written
// fails on these values, each copy is tried, and the one that runs has its
// values shown on the nodes it copies.
export function trace(written: Code, info: Info, def: Id, args: Value[], world?: Runtime["world"], entered?: Runtime["entered"], copied = false): Trace {
  if (info.divergent.has(def) && !entered) return { values: new Map(), error: { id: def, message: "it might not finish, so it isn't run here" } };
  const r = makeRunner(written, info, { print: () => {}, world, entered });
  const own = traceOn(written, info, def, args, entered, r, null);
  if (!own.error || !copied) return own;
  const lam = (written.nodes[def] as NodeOf<"def">).body;
  for (const [c, o] of r.copyOf ?? []) {
    if (o !== lam || r.code.nodes[c]?.kind !== "lambda") continue;
    const t = traceOn(written, info, def, args, entered, r, c);
    if (!t.error) return t;
  }
  return own;
}

function traceOn(written: Code, info: Info, def: Id, args: Value[], entered: Runtime["entered"], r: ReturnType<typeof makeRunner>, copy: Id | null): Trace {
  const values = new Map<Id, Value>();
  const out: Trace = { values };
  const code = copy ? r.code : written;
  const orig = (id: Id) => (copy && r.copyOf?.get(id)) || id;
  const put = (id: Id, v: Value) => values.set(orig(id), v);
  const first = (xs: Iterable<Value>, id: Id): Value => {
    for (const x of xs) return x;
    throw Object.assign(new Error("no answer (a Choice with none)"), { id });
  };
  const divergent = (id: Id) => { if (entered) return false; const n = code.nodes[id]; return n.kind === "call" && code.nodes[n.fn].kind === "ref" && info.divergent.has((code.nodes[n.fn] as NodeOf<"ref">).target); };

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
        // A call the runner runs as something else (+ on records resolved to
        // its parts, f(p) spread: arith.ts) is run as it runs; what went
        // into it is shown as written (BACKLOG I122).
        const ran = r.code.nodes[id];
        if (ran !== n && !(ran?.kind === "call" && ran.fn === n.fn && ran.args.length === n.args.length && ran.args.every((a, i) => a === n.args[i]) && r.code.nodes[n.fn] === head)) v = first(r.ev(id, env), id);
        else if (head.kind === "lambda") {
          // A let: its dots get the values, then its body runs.
          const inner = new Map(env);
          head.params.forEach((p, i) => { inner.set(p, vals[i]); put(p, vals[i]); });
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
        arm.binds.forEach((b, i) => { inner.set(b, d.fields[i]); put(b, d.fields[i]); });
        v = walk(arm.body, inner);
        put(arm.id, v);
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
        arm.binds.forEach((b, i) => { inner.set(b, d.fields[i]); put(b, d.fields[i]); });
        arm.results.forEach((res, i) => {
          if (!res) return;
          const folded = first(r.ev(id, new Map(env).set(at.target, d.fields[i])), id);
          inner.set(res, folded);
          put(res, folded);
        });
        v = walk(arm.body, inner);
        put(arm.id, v);
        break;
      }
      default: v = first(r.ev(id, env), id);
    }
    put(id, v);
    return v;
  };

  const d = code.nodes[def] as NodeOf<"def">;
  const body = copy ? code.nodes[copy] : d.body ? code.nodes[d.body] : null;
  try {
    if (body?.kind === "lambda") {
      const env = new Map<Id, Value>();
      // A definition given by its name (values.ts) is its function.
      const given = args.map((a) => (typeof a === "object" && a !== null && "tag" in a && a.tag === DEF_VALUE ? r.value(a.fields[0] as Id) : a));
      body.params.forEach((p, i) => { env.set(p, given[i]); put(p, given[i]); });
      out.result = walk(body.body, env);
    } else if (body && body.kind !== "typedef") out.result = walk(body.id, new Map());
  } catch (e) {
    out.error = { id: orig((e as { id?: Id }).id ?? def), message: (e as Error).message };
  }
  return out;
}
