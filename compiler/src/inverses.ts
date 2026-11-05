// inverse(f, y) and conjugate(f, g) with f a definition the program names
// become a solve on f itself, before compiling (AUDIO.md, A1b). The
// prelude's inverse is a solve on `applied`, the relation that calls a
// function it is given, so with f known only at run time the relational
// interpreter runs it for each call (0.7 ms each, too slow for a sound's
// 48,000 samples a second). With f named, the solve is on f, and a solve
// whose mode has one answer is plain arithmetic (#250): conjugate(atanh, g)
// is then tanh(g(atanh(x))) in closed form, a few hundred times faster.
// The source still says inverse(f, y), as expandDerivatives (derive.ts)
// keeps saying derivative(f).
//
// conjugate(f, g) is opened up only when g is a function written there or
// a name, so running it again for each call does nothing g's own call
// didn't. Specializing a function on a known function argument is old:
// partial evaluation (Futamura, 1971; Jones, Gomard and Sestoft, 1993).

import type { Bound, Code, Id, Node, NodeOf } from "../../ters/src/model.ts";
import { freshId, isCall, subtree } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";

const prelude = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name);
const INVERSE = prelude("inverse"), CONJUGATE = prelude("conjugate");

export function expandInverses(code: Code, names: Names): { code: Code; names: Names; expanded: Id[] } {
  const out: Code = { nodes: { ...code.nodes }, defs: [...code.defs] };
  const more: Names = {};
  const add = (n: Omit<Node, "id">) => { const id = freshId(); out.nodes[id] = { id, ...n } as Node; return id; };
  const ref = (target: Id) => add({ kind: "ref", target } as Omit<Node, "id">);
  // The one input of a definition that is a function of one input.
  const param = (fn: Id): Id | null => {
    const n = out.nodes[fn];
    const target = n?.kind === "ref" ? n.target : null;
    const def = target ? out.nodes[target] : null;
    if (def?.kind !== "def" || !def.body) return null;
    const body = out.nodes[def.body];
    return body?.kind === "lambda" && body.params.length === 1 ? body.params[0] : null;
  };
  const calls = (target: Id | undefined, id: Id) => {
    const n = out.nodes[id];
    if (!isCall(n) || !target) return null;
    const f = out.nodes[n.fn];
    return f?.kind === "ref" && f.target === target ? n : null;
  };
  // inverse(F, y) → solve F given out = y, for F's input.
  const inverse = (id: Id, fn: Id, y: Id) => {
    const p = param(fn)!, x = add({ kind: "binder" } as Omit<Node, "id">);
    more[x] = names[p] ?? "x";
    out.nodes[id] = { id, kind: "call", fn, given: { out: y }, binds: { [p]: x }, body: ref(x) } satisfies Bound;
  };
  const expanded: Id[] = [];
  for (const id of Object.keys(code.nodes)) {
    const c = calls(CONJUGATE, id);
    if (!c || c.args.length !== 2 || !param(c.args[0])) continue;
    const g = out.nodes[c.args[1]];
    if (g?.kind !== "lambda" && g?.kind !== "ref") continue;
    // conjugate(F, g) → (x) => inverse(F, g(F(x)))
    const x = add({ kind: "binder" } as Omit<Node, "id">);
    more[x] = "x";
    const inner = add({ kind: "call", fn: ref(INVERSE!), args: [c.args[0], add({ kind: "call", fn: c.args[1], args: [add({ kind: "call", fn: ref((out.nodes[c.args[0]] as NodeOf<"ref">).target), args: [ref(x)] } as Omit<Node, "id">)] } as Omit<Node, "id">)] } as Omit<Node, "id">);
    out.nodes[id] = { id, kind: "lambda", params: [x], body: inner } as Node;
    expanded.push(id);
  }
  // inverse(e ↦ F(e, …), y), F a printer (its first input matched on)
  // and the others not depending on e → solve F given out = y and the
  // others, for that input (C110 s5: calc's `read expression`, whose printer
  // takes the level it prints at as well, can then be read by descent,
  // core-solve.ts).
  const around = (fn: Id): { f: Id; params: Id[]; at: number; args: Id[] } | null => {
    const l = out.nodes[fn];
    if (l?.kind !== "lambda" || l.params.length !== 1) return null;
    const c = out.nodes[l.body];
    if (!isCall(c)) return null;
    const f = out.nodes[c.fn], def = f?.kind === "ref" ? out.nodes[f.target] : null, body = def?.kind === "def" && def.body ? out.nodes[def.body] : null;
    if (f?.kind !== "ref" || body?.kind !== "lambda" || body.params.length !== c.args.length) return null;
    const uses = (a: Id) => subtree(out, a).some((x) => { const r = out.nodes[x]; return r?.kind === "ref" && r.target === l.params[0]; });
    const at = c.args.findIndex((a) => { const r = out.nodes[a]; return r?.kind === "ref" && r.target === l.params[0]; });
    if (at < 0 || c.args.some((a, j) => j !== at && uses(a))) return null;
    // Only a printer for now: its first input matched on, read by descent.
    // (pedal's multiband ran wrong as a solve on its function this way.)
    const m = out.nodes[body.body];
    if (at !== 0 || m?.kind !== "match" || (out.nodes[m.scrutinee] as NodeOf<"ref"> | undefined)?.target !== body.params[0]) return null;
    return { f: f.target, params: body.params, at, args: c.args };
  };
  for (const id of Object.keys(out.nodes)) {
    const c = calls(INVERSE, id);
    if (!c || c.args.length !== 2) continue;
    if (param(c.args[0])) { inverse(id, c.args[0], c.args[1]); expanded.push(id); continue; }
    const a = around(c.args[0]);
    if (!a) continue;
    const x = add({ kind: "binder" } as Omit<Node, "id">);
    more[x] = names[a.params[a.at]] ?? "x";
    const given: Record<string, Id> = { out: c.args[1] };
    a.params.forEach((p, j) => { if (j !== a.at) given[p] = a.args[j]; });
    out.nodes[id] = { id, kind: "call", fn: ref(a.f), given, binds: { [a.params[a.at]]: x }, body: ref(x) } satisfies Bound;
    expanded.push(id);
  }
  return expanded.length ? { code: out, names: { ...names, ...more }, expanded } : { code, names, expanded };
}
