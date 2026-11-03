// A field several cases share (BACKLOG L168, SHARED-FIELDS-2026-11-02.md),
// read on any value of its type, written out as an ordinary match before
// anything runs.
//
// machine's `Instr` has `to` in six of its 21 cases. Each of the six keeps
// its own field node, and five of them say, with `same`, that they are the
// first one's (sharing by identity: renaming it renames it everywhere, and
// a case with a `to` of its own simply doesn't say so). Then `i.to` is
// allowed: the field's type on every case that has it, and no answer
// (Choice) on a case without it, so `first([i.to], else nil)` replaces a
// six-arm match. This code → code pass gives each shared field read a
// generated definition, one arm per case that has it, so the evaluator,
// relate.ts and every compiler target see an ordinary match. A `set` of
// it (L168b) is another: the case rebuilt with that field replaced.
//
// Prior art: Haskell's record fields shared by several constructors, whose
// selector is partial (it throws on the others); here the others have no
// answer, as any Choice. OCaml's inline records and Rust's enum variants
// keep each case's fields apart, as the language did before.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { freshId, isCall, type Call } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info } from "./infer.ts";
import { S, SET } from "./std.ts";
import { fieldPath } from "./records.ts";

type Bare = Node extends infer N ? (N extends Node ? Omit<N, "id"> : never) : never;

// The cases that hold a field shared with `field`, each with its own field
// node, the first case's first; null when the field isn't shared. A
// problem when `same` points out of the type, at a field that itself
// points, or two fields of one case are the same one.
export function sharing(code: Code, td: NodeOf<"typedef">, field: Id): { members: [Id, Id][]; total: boolean; problem?: string } | null {
  const f = code.nodes[field] as NodeOf<"field">;
  const root = f.same ?? field;
  const all = td.variants.flatMap((v) => (code.nodes[v] as NodeOf<"variant">).fields.map((x) => [v, x] as [Id, Id]));
  if (f.same) {
    const r = code.nodes[root];
    if (r?.kind !== "field" || !all.some(([, x]) => x === root)) return { members: [], total: false, problem: "is the same as a field of another type" };
    if (r.same) return { members: [], total: false, problem: "is the same as a field that is itself another's" };
  }
  const members = all.filter(([, x]) => x === root || (code.nodes[x] as NodeOf<"field">).same === root);
  if (members.length < 2) return null;
  if (new Set(members.map(([v]) => v)).size !== members.length) return { members, total: false, problem: "is in one case twice" };
  return { members, total: members.length === td.variants.length };
}

// The type a field belongs to, as its typedef.
function typeOf(code: Code, field: Id): NodeOf<"typedef"> | null {
  for (const d of code.defs) {
    const def = code.nodes[d], td = def?.kind === "def" && def.body ? code.nodes[def.body] : undefined;
    if (td?.kind === "typedef" && td.variants.some((v) => (code.nodes[v] as NodeOf<"variant">).fields.includes(field))) return td;
  }
  return null;
}

export const usesSharedFields = (code: Code) => Object.values(code.nodes).some((n) => n.kind === "field" && !!n.same);

export function sharedFields(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  if (!usesSharedFields(code)) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const defs = [...code.defs];
  const out: Names = { ...names };
  const add = (n: Bare): Id => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; };
  const ref = (target: Id) => add({ kind: "ref", target });
  const made = new Map<Id, Id>();
  let changed = false;
  const shared = (field: Id) => {
    const td = typeOf(code, field);
    const sh = td && td.variants.length > 1 ? sharing(code, td, field) : null;
    return sh && !sh.problem ? sh : null;
  };
  const ownerVariant = (f: Id): Id => typeOf(code, f)!.variants.find((v) => (code.nodes[v] as NodeOf<"variant">).fields.includes(f))!;
  // set(field, value, x) on a shared field: the generated `with` match.
  const withs = new Map<Id, Id>();
  const withDef = (sh: { members: [Id, Id][]; total: boolean }): Id => {
    const root = sh.members[0][1];
    let def = withs.get(root);
    if (def) return def;
    const value = add({ kind: "binder" }), x = add({ kind: "binder" });
    const arms = sh.members.map(([v, field]) => {
      const fields = (code.nodes[v] as NodeOf<"variant">).fields;
      const binds = fields.map((f) => { const b = add({ kind: "binder" }); const nm = names[f]; if (nm) out[b] = nm; return b; });
      return add({ kind: "arm", variant: v, binds, results: binds.map(() => null), body: add({ kind: "call", fn: ref(v), args: fields.map((f, i) => ref(f === field ? x : binds[i])) }) });
    });
    const match = add({ kind: "match", scrutinee: ref(value), arms, otherwise: sh.total ? null : add({ kind: "call", fn: ref(S.fail), args: [] }) });
    def = add({ kind: "def", body: add({ kind: "lambda", params: [value, x], body: match }) });
    defs.push(def);
    withs.set(root, def);
    out[value] = "value";
    out[x] = names[root] ?? "new";
    out[def] = `with ${names[root] ?? root} of every case`;
    return def;
  };
  // A path through shared fields (L168b), p ↦ p.to.value: each step is
  // the value with that field set to the step inside, so
  // set(p ↦ p.to.value, i, x) = with to(i, set(t ↦ t.value, i.to, x)),
  // a step on a field of a one-case type its own `with`. Each value is bound
  // once, by a lambda applied to it.
  for (const n of Object.values(code.nodes)) {
    if (!isCall(n) || n.args.length !== 3 || (code.nodes[n.fn] as { target?: Id })?.target !== SET) continue;
    const path = fieldPath(code, n.args[0]);
    if (!path || !path.some((f) => shared(f))) continue;
    const step = (value: Id, fs: Id[]): Id => {
      const [f, ...rest] = fs;
      const y = add({ kind: "binder" });
      out[y] = "value";
      const inner = rest.length ? step(add({ kind: "call", fn: ref(f), args: [ref(y)] }), rest) : n.args[2];
      // A field of a one-case type is its own `with`, so every step is a
      // call of a definition (a set inside a search isn't compiled yet).
      const sh = shared(f) ?? { members: [[ownerVariant(f), f] as [Id, Id]], total: true };
      const body = add({ kind: "call", fn: ref(withDef(sh)), args: [ref(y), inner] });
      return add({ kind: "call", fn: add({ kind: "lambda", params: [y], body }), args: [value] });
    };
    const whole = step(n.args[1], path);
    nodes[n.id] = { ...(nodes[whole] as Call), id: n.id };
    changed = true;
  }
  for (const n of Object.values(nodes)) {
    if (n.kind !== "ref" || code.nodes[n.target]?.kind !== "field") continue;
    const sh = shared(n.target);
    if (!sh) continue;
    const root = sh.members[0][1];
    let def = made.get(root);
    if (!def) {
      const value = add({ kind: "binder" });
      const arms = sh.members.map(([v, field]) => {
        const fields = (code.nodes[v] as NodeOf<"variant">).fields;
        const binds = fields.map((f) => { const b = add({ kind: "binder" }); const nm = names[f]; if (nm) out[b] = nm; return b; });
        return add({ kind: "arm", variant: v, binds, results: binds.map(() => null), body: ref(binds[fields.indexOf(field)]) });
      });
      const match = add({ kind: "match", scrutinee: ref(value), arms, otherwise: sh.total ? null : add({ kind: "call", fn: ref(S.fail), args: [] }) });
      def = add({ kind: "def", body: add({ kind: "lambda", params: [value], body: match }) });
      defs.push(def);
      made.set(root, def);
      out[value] = "value";
      out[def] = `${names[root] ?? root} of every case`;
    }
    nodes[n.id] = { id: n.id, kind: "ref", target: def };
    changed = true;
  }
  if (!changed) return { code, info, names };
  const next: Code = { ...code, nodes, defs };
  return { code: next, info: infer(next, out, undefined, info.options), names: out };
}
