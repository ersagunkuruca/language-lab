// Pure work with known inputs done while compiling, its answer written into
// the program (C255, Ersagun 2026-11-16: "can that data structure be baked
// into the code?"). A call of a definition whose inputs are all written
// down, and which can only give its value (no effect in its type, not even
// Diverge, so it always ends; hoist.ts reads calls the same way), is run by
// the evaluator now and replaced by its value: numbers, texts and data
// written as literals and constructor calls. A definition with no inputs
// (a table, a style sheet) is one too.
//
// Weighed, as inlining is ("performance wins that we need to weigh against
// the file size increase"): the evaluator's work on it is counted (its
// machine's steps and each function it enters, the same on every run), and
// the answer is written in only when it is small next to that work (and
// the work is worth checking the program again for), so a
// big table built once at startup stays code. Work inside a function with
// inputs, which may run many times, counts more (a lambda given to a
// call may run once, as a step's rest does, so it doesn't). A run that goes past a
// budget, fails, or gives what can't be written down (a function, a
// value of a builtin kind) leaves the call as it was.
//
// Prior art: constant folding and compile-time evaluation (C++'s
// constexpr, Zig's comptime); as partial evaluation goes (stage.ts), the
// case where every input is known.

import type { Code, Id, Node, NodeOf } from "../../ters/src/model.ts";
import { children, dependenciesOfAll, fieldWayOf, freshId, isCall, isUse, subtree, subtreeKept, type Call, copyNodes, nodeIds } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { evaluatorTicks, makeRunner, OutOfSteps, withSteps, type Data, type Value } from "../../ters/src/lang/run.ts";
import { INT, Subst, type Type } from "../../ters/src/lang/types.ts";
import { SIGS } from "../../ters/src/lang/std.ts";
import { CONS, NIL, S } from "../../ters/src/lang/std-ids.ts";
import { originalOf, PRELUDE_DEFS } from "../../ters/src/lang/prelude-ids.ts";

// A bake's bytes (BAKING.md): read as the program runs, never folded here,
// where there are none.
const BAKED_BYTES = PRELUDE_DEFS["baked bytes"];

// The weighing: the answer's size (one per number, text, case and field)
// at most WORK_PER_NODE of the work it saves, and at most MAX_SIZE.
const WORK_PER_NODE = 8, MAX_SIZE = 4096;
// And worth checking the program again for: at least this much work.
const LEAST = 100;
// Work in a function with inputs: it may run many times.
const AGAIN = 16;
// Work one run may take, and all of them together (a few hundred ms;
// numbers, Peano Nat, spent 2 s at 4M, I315),
// counted as a page's budget is (OutOfSteps).
const BUDGET = 250_000, TOTAL = 1_000_000;

// `reads`: the nodes whose values the runs could read, each candidate's and
// those of every definition it reaches (an edit of a number elsewhere
// leaves what was baked as it was: literals-again.ts).
export function bakeCalls(code: Code, info: Info, names: Names): { code: Code; baked: Id[]; reads: ReadonlySet<Id> } {
  const nodes = code.nodes;
  const ty = (id: Id): Type => info.subst.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 });
  const binders = new Set<Id>();
  // An effect's operations are variants of its typedef: they do something.
  const operations = new Set<Id>();
  for (const id of nodeIds(nodes)) {
    const n = nodes[id];
    if (n.kind === "binder") binders.add(id);
    if (n.kind === "typedef" && n.effect) n.variants.forEach((v) => operations.add(v));
  }
  // Can only give its value, and takes no function (hoist.ts plainCall).
  const plain = (call: Call): boolean => {
    const f = nodes[call.fn];
    if (f?.kind !== "ref") return false;
    const target = nodes[f.target];
    if (target?.kind === "variant") return !operations.has(f.target);
    // An interface's operation: what its type says at the call (the
    // caller's row joined, so this may say no where it could say yes).
    if (target?.kind === "field") { const t = ty(call.fn); return t.t === "fn" && !t.eff.effs.length && !t.params.some((x) => info.subst.zonk(x).t === "fn"); }
    let own: Type | undefined;
    if (target?.kind === "builtin") own = SIGS[f.target]?.(new Subst());
    else if (target?.kind === "def") {
      if (fieldWayOf(nodes, f.target) || !target.body || nodes[target.body]?.kind !== "lambda" || info.divergent.has(f.target)) return false;
      own = info.schemes.get(f.target)?.type;
    }
    if (own?.t !== "fn" || own.eff.effs.length) return false;
    const t = ty(call.fn);
    return t.t === "fn" && !t.params.some((x) => info.subst.zonk(x).t === "fn") && info.subst.zonk(t.ret).t !== "fn";
  };
  // Written down: nothing in it reads a variable, makes a function or does
  // anything; a definition it names is a value or a function called plainly.
  const known = (id: Id): boolean => subtree(code, id).every((x) => {
    const n = nodes[x];
    if (!n || n.kind === "lambda" || n.kind === "hole" || n.kind === "binder" || isUse(n)) return false;
    if (n.kind === "ref") return !binders.has(n.target) && !operations.has(n.target) && nodes[n.target] !== undefined;
    return !isCall(n) || plain(n);
  });
  const valueDef = (d: Id): boolean => {
    const def = nodes[d];
    if (def?.kind !== "def" || !def.body || nodes[def.body]?.kind === "lambda" || nodes[def.body]?.kind === "typedef" || fieldWayOf(nodes, d) || info.divergent.has(d)) return false;
    return ty(d).t !== "fn";
  };

  // The candidates, outermost first: each a call of a definition with
  // inputs all written down, or a value definition's body.
  const found: { id: Id; again: boolean }[] = [];
  for (const d of code.defs) {
    const def = nodes[d];
    if (def?.kind !== "def" || !def.body) continue;
    if (valueDef(d) && known(def.body)) { found.push({ id: def.body, again: false }); continue; }
    const walk = (id: Id, again: boolean) => {
      const n = nodes[id];
      if (!n) return;
      if (isCall(n) && n.args.length && nodes[(nodes[n.fn] as NodeOf<"ref">)?.target]?.kind === "def" && plain(n) && n.args.every(known)) {
        found.push({ id, again });
        return;
      }
      for (const c of children(n)) walk(c, again);
    };
    // A function's body runs once per call, many times; an action's or a
    // value's once.
    const body = nodes[def.body];
    walk(def.body, body.kind === "lambda" && body.params.length > 0);
  }
  // Nothing that reads a bake's bytes is folded: as evaluated it would
  // give the body as written, and run it.
  if (BAKED_BYTES && nodeIds(nodes).some((x) => { const n = nodes[x]; return n.kind === "ref" && originalOf(n.target) === BAKED_BYTES; })) {
    const reachesBytes = (id: Id) => subtree(code, id).some((x) => { const n = nodes[x]; return n?.kind === "ref" && originalOf(n.target) === BAKED_BYTES; })
      || [...dependenciesOfAll(code, [id])].some((d) => originalOf(d) === BAKED_BYTES);
    for (let i = found.length - 1; i >= 0; i--) if (reachesBytes(found[i].id)) found.splice(i, 1);
  }
  if (!found.length) return { code, baked: [], reads: new Set() };
  const reads = new Set<Id>();
  for (const { id } of found) for (const x of subtree(code, id)) reads.add(x);
  for (const d of dependenciesOfAll(code, found.map((f) => f.id))) if (nodes[d]?.kind === "def") for (const x of subtreeKept(code, d)) reads.add(x);

  let work = 0;
  const runner = makeRunner(code, info, { print: () => {}, names, entered: () => { if (++work > limit) throw new OutOfSteps(); } });
  let limit = 0, spent = 0;
  const out: Code = { nodes: copyNodes(nodes), defs: code.defs };
  const baked: Id[] = [];
  for (const { id, again } of found) {
    if (spent >= TOTAL) break;
    const t0 = evaluatorTicks();
    work = 0;
    limit = Math.min(BUDGET, TOTAL - spent);
    let v: Value;
    try {
      v = withSteps(Number.MAX_SAFE_INTEGER, () => runner.ev(id, new Map()).next().value as Value, () => work + evaluatorTicks() - t0 > limit);
    } catch { spent += limit; continue; }
    const did = work + evaluatorTicks() - t0;
    spent += did;
    const made = written(v, nodes);
    const saved = did * (again ? AGAIN : 1);
    if (!made || made.size > MAX_SIZE || saved < LEAST || saved < WORK_PER_NODE * made.size) continue;
    for (const n of made.nodes) out.nodes[n.id] = n;
    out.nodes[id] = { ...made.root, id } as Node;
    baked.push(id);
  }
  return { code: baked.length ? out : code, baked, reads };
}

// A value as nodes: a number or Int literal, a text, a case of data by its
// constructor (a list as one written list); null for anything else.
function written(v: Value, nodes: Record<Id, Node>): { root: Omit<Node, "id">; nodes: Node[]; size: number } | null {
  const made: Node[] = [];
  let size = 0;
  const add = (n: Omit<Node, "id">): Id => { const id = freshId(); made.push({ ...n, id } as Node); return id; };
  const ref = (target: Id) => add({ kind: "ref", target } as Omit<Node, "id">);
  const go = (x: Value): Omit<Node, "id"> | null => {
    if (++size > MAX_SIZE) return null;
    if (typeof x === "number") return Number.isFinite(x) ? { kind: "lit", value: x } as Omit<Node, "id"> : null;
    if (typeof x === "bigint") return { kind: "lit", value: x >= -9007199254740991n && x <= 9007199254740991n ? Number(x) : String(x), of: INT } as Omit<Node, "id">;
    if (typeof x === "string") { size += x.length >> 4; return { kind: "lit", value: x } as Omit<Node, "id">; }
    if (typeof x !== "object" || x === null || !("tag" in x) || !Array.isArray((x as Data).fields)) return null;
    const d = x as Data;
    if (nodes[d.tag]?.kind !== "variant") return null;
    if (d.tag === CONS) {
      const items: Value[] = [];
      let at: Value = d;
      while (typeof at === "object" && (at as Data).tag === CONS) { items.push((at as Data).fields[0]); at = (at as Data).fields[1]; }
      if (typeof at !== "object" || (at as Data).tag !== NIL) return null;
      const args: Id[] = [];
      for (const i of items) { const n = go(i); if (!n) return null; args.push(add(n)); }
      return { kind: "call", fn: ref(S.listOf), args } as Omit<Node, "id">;
    }
    if (!d.fields.length) return { kind: "ref", target: d.tag } as Omit<Node, "id">;
    const args: Id[] = [];
    for (const f of d.fields) { const n = go(f); if (!n) return null; args.push(add(n)); }
    return { kind: "call", fn: ref(d.tag), args } as Omit<Node, "id">;
  };
  // Too deep to write out (a long chain not a list) is too big too.
  let root: Omit<Node, "id"> | null;
  try { root = go(v); } catch (e) { if (e instanceof RangeError) return null; throw e; }
  return root ? { root, nodes: made, size } : null;
}
