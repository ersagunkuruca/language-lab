// The number literals whose value, not only its class (class-key.ts:
// whole or not, its sign, whether 0), a pass may read, so an edit of one
// is never taken as one of its class (literals-again.ts, the choice's
// butLiterals, the keys class-key.ts writes). An audit of 2026-11-25:
//   - signs.ts tells a test's side from the expression whose sign it asks
//     by their nodes (`alike`), literals by value: a literal inside the
//     input of a partial builtin (`x / (n - 1)`) or inside a side of a
//     comparison (`if n - 1 = 0`);
//   - and a log's sign from its literal's value (log 1 is 0), the literal
//     found through definitions, lets and, in a call's body, its inputs;
//   - reader.ts and first-sets.ts take `slice(t, 0, 1)` as a head test.
// What else reads values (bake.ts's runs, stage.ts's evaluator, grades.ts)
// says so as it reads (literals-again.ts readLit).
import { parentLookup, isCall, isUse, nodesUnder, ownNodeIds, type Code, type Id, type Node } from "../model.ts";
import { B } from "../prelude.ts";
import { ARITH, INT_OPS, S } from "./std.ts";
import { PARTIAL } from "./signs.ts";

const COMPARE = new Set<Id>([S.equal, S.less, ARITH.less, INT_OPS.less]);
const SLICE = "builtin.text.slice";

const kept = new WeakMap<Code, (id: Id) => boolean>();
export function valueRead(code: Code): (id: Id) => boolean {
  let got = kept.get(code);
  if (!got) kept.set(code, (got = readsOf(code)));
  return got;
}

function readsOf(code: Code): (id: Id) => boolean {
  const parent = parentLookup(code);
  const target = (id: Id): Id | undefined => { const n = code.nodes[id]; return n?.kind === "ref" ? n.target : undefined; };
  // What a log may read the value of (signs.ts numLit): the definitions
  // and lets named where a literal is found, and the definitions whose
  // inputs it may be (signs.ts reads a call's body with its inputs known),
  // with those that pass theirs on to one. (Read once, when first asked.)
  let logged: { names: Set<Id>; takers: Set<Id> } | null = null;
  const logs = () => {
    if (logged) return logged;
    const names = new Set<Id>(), takers = new Set<Id>();
    // The definition whose input a name is, or the let's value it names.
    const reach = (id: Id, depth: number, into: (def: Id) => void) => {
      const t = target(id);
      if (t === undefined || names.has(t) || depth > 8) return;
      names.add(t);
      const d = code.nodes[t];
      if (d?.kind === "def") { if (d.body) reach(d.body, depth + 1, into); return; }
      if (d?.kind !== "binder") return;
      const holder = parent(t), h = holder !== undefined ? code.nodes[holder] : undefined;
      if (h?.kind !== "lambda") return;
      const c = parent(h.id), call = c !== undefined ? code.nodes[c] : undefined;
      if (isCall(call) && call.fn === h.id) { const i = h.params.indexOf(t); if (call.args[i] !== undefined) reach(call.args[i], depth + 1, into); return; }
      const def = parent(h.id);
      if (def !== undefined && code.nodes[def]?.kind === "def") into(def);
    };
    const todo: Id[] = [];
    const take = (def: Id) => { if (!takers.has(def)) { takers.add(def); todo.push(def); } };
    // The calls of a definition: the refs to it, by the versions they are
    // in (each version's own refs found once).
    const callsOf = (f: Id): Id[] => {
      const out: Id[] = [];
      for (const id of refsTo(code.nodes, f)) {
        const r = code.nodes[id];
        if (r?.kind !== "ref" || r.target !== f) continue;
        const c = parent(r.id), call = c !== undefined ? code.nodes[c] : undefined;
        if (isCall(call) && !isUse(call as never) && call.fn === r.id) out.push(call.id);
      }
      return out;
    };
    for (const c of callsOf(B.log)) { const n = code.nodes[c]; if (isCall(n) && n.args.length === 1) reach(n.args[0], 0, take); }
    // A definition passing its input on to a taker is one.
    while (todo.length) {
      for (const c of callsOf(todo.pop()!)) { const call = code.nodes[c]; if (!isCall(call)) continue; for (const a of call.args) { const t = target(a); if (t !== undefined && code.nodes[t]?.kind === "binder") reach(a, 0, take); } }
    }
    return (logged = { names, takers });
  };
  return (id: Id): boolean => {
    if (code.nodes[id]?.kind !== "lit") return false;
    let child = id;
    for (let at = parent(id), depth = 0; at !== undefined && depth < 64; child = at, at = parent(at), depth++) {
      const n = code.nodes[at];
      if (!n) return false;
      if (n.kind === "def") return logs().names.has(at);
      if (isCall(n) && !isUse(n as never)) {
        const f = target(n.fn);
        if (f === B.log && child === id) return true;
        if (f !== undefined && (PARTIAL[f] || COMPARE.has(f)) && child !== id && n.args.includes(child)) return true;
        if (f === SLICE && child === id && (n.args[1] === id || n.args[2] === id)) return true;
        // An input of a function whose body takes a log of one.
        if (child === id && f !== undefined && n.args.includes(id) && logs().takers.has(f)) return true;
        // A let's value, its name logged.
        const fn = code.nodes[n.fn];
        if (fn?.kind === "lambda" && n.args.includes(child)) { const b = fn.params[n.args.indexOf(child)]; if (b !== undefined && child === id && logs().names.has(b)) return true; }
      }
    }
    return false;
  };
}

// The refs to f in a version and those under it, each version's own read
// once (a version's own may hide one under it: read again by its id).
const ownRefs = new WeakMap<object, Map<Id, Id[]>>();
function refsTo(nodes: Record<Id, Node>, f: Id): Id[] {
  const out = new Set<Id>();
  for (let at: Record<Id, Node> | undefined = nodes; at; at = nodesUnder(at)) {
    let m = ownRefs.get(at);
    if (!m) {
      m = new Map();
      for (const id of ownNodeIds(at)) { const n = at[id]; if (n?.kind === "ref") { let rs = m.get(n.target); if (!rs) m.set(n.target, (rs = [])); rs.push(id); } }
      ownRefs.set(at, m);
    }
    for (const id of m.get(f) ?? []) out.add(id);
  }
  return [...out];
}
