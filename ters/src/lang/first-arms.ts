// The first answer of a search that can't fail once it takes each choice's
// first way (L72e1d): `first(json spelled(v))` is json spelled with every
// `one of([a, …])` taken at a. The first answer is the leftmost way that
// gets to the end; when the leftmost way has no fail and no other choice
// left on it, that way is the answer, and nothing needs keeping to come
// back to. Compiled code runs the rest of a choice inside it (the core IR's
// several answers), so json spelled's first over a few hundred records ran
// out of stack; here it is plain code.
//
// Each definition with Choice the search reaches gets a copy with its
// `one of`s taken at their first item, the search's thunk the same; the
// program is checked again, and where the thunk has no Choice left, the
// `first` is the thunk's body. Where it still has (a fail, a lookup that
// may find nothing, a `one of` of a list not written down), the `first`
// stays. Inside another search (all, count, first, optional) or a use,
// nothing is taken: there every way may count.
import type { Code, Id, Node } from "../model.ts";
import { SCHEMA, subtree, freshId, isCall } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info } from "./infer.ts";
import { S } from "./std.ts";
import { CHOICE, type Type } from "./types.ts";

const SEARCHES = new Set<Id>([S.all, S.count, S.first, S.optional]);

export function firstArms(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names; taken: number } {
  const node = (id: Id | undefined | null) => (id ? code.nodes[id] : undefined);
  const refTo = (id: Id | undefined) => { const n = node(id); return n?.kind === "ref" ? n.target : undefined; };
  const chooses = (t: Type | undefined) => t?.t === "fn" && info.subst.resolveRow(t.eff).effs.includes(CHOICE);
  const typeOf = (id: Id) => { const t = info.typeOf.get(id); return t && info.subst.zonk(t); };
  // A first whose thunk may choose.
  const sites: Id[] = [];
  for (const n of Object.values(code.nodes)) {
    if (!isCall(n) || refTo(n.fn) !== S.first) continue;
    const th = node(n.args[0]);
    if (th?.kind === "lambda" && th.params.length === 0 && chooses(typeOf(th.id))) sites.push(n.id);
  }
  if (!sites.length) return { code, info, names, taken: 0 };
  // The nodes a search's own ways are under: a search's thunks and a use.
  const barrier = (n: Node) => (isCall(n) && SEARCHES.has(refTo(n.fn) ?? "")) || (n.kind === "call" && n.given !== undefined);
  // What a node is once each choice takes its first way: one of([a, …]) is
  // a, and a match on a case written down (`if false then … else b`) is
  // that case's arm.
  const stand = (id: Id): Id | undefined => {
    const n = code.nodes[id];
    if (isCall(n) && refTo(n.fn) === S.oneOf) {
      const xs = node(n.args[0]);
      return isCall(xs) && refTo(xs.fn) === S.listOf && xs.args.length ? xs.args[0] : undefined;
    }
    if (n?.kind !== "match" || n.name) return undefined;
    const v = refTo(resolved(n.scrutinee)), c = v ? code.nodes[v] : undefined;
    if (c?.kind !== "variant" || c.fields.length) return undefined;
    for (const a of n.arms) { const arm = code.nodes[a]; if (arm?.kind === "arm" && arm.variant === v && arm.body) return arm.body; }
    return n.otherwise ?? undefined;
  };
  const resolved = (x: Id): Id => { for (let s = stand(x); s; s = stand(x)) x = s; return x; };
  // What a thunk reaches outside other searches: definitions with Choice.
  const copies = new Map<Id, Id>();
  const reach = (root: Id) => {
    const walk = (at: Id) => {
      const id = resolved(at), n = code.nodes[id];
      if (!n) return;
      if (n.kind === "ref") {
        const d = code.nodes[n.target];
        if (d?.kind === "def" && d.body && !copies.has(d.id) && chooses(typeOf(d.id))) { copies.set(d.id, freshId()); walk(d.body); }
        return;
      }
      if (n.kind === "call" && barrier(n)) return;
      for (const [a, slot] of Object.entries(SCHEMA[n.kind] ?? {})) if (slot === "child") for (const c of idsIn((n as Record<string, unknown>)[a])) walk(c);
    };
    walk(root);
  };
  for (const s of sites) reach((code.nodes[s] as { args: Id[] }).args[0]);
  const nodes: Record<Id, Node> = { ...code.nodes };
  const outNames: Names = { ...names };
  // A copy of a tree, its choices taken at their first item and its
  // definitions with Choice their copies, outside other searches.
  const copy = (root: Id): Id => {
    const map = new Map<Id, Id>();
    const ids = subtree(code, root);
    for (const id of ids) map.set(id, freshId());
    const inside = new Set<Id>();
    for (const id of ids) { const n = code.nodes[id]; if (n.kind === "call" && barrier(n)) for (const x of subtree(code, id)) if (x !== id) inside.add(x); }
    const to = (x: Id): Id => map.get(inside.has(x) ? x : resolved(x)) ?? x;
    for (const id of ids) {
      const n = code.nodes[id];
      const out: Record<string, unknown> = { ...n, id: map.get(id)! };
      for (const [a, slot] of Object.entries(SCHEMA[n.kind] ?? {})) {
        const v = (n as Record<string, unknown>)[a];
        if (slot === "child") out[a] = remap(v, to);
        else if (slot === "ref" && n.kind === "ref") out[a] = remap(v, (x) => map.get(x) ?? (inside.has(id) ? x : copies.get(x) ?? x));
      }
      nodes[map.get(id)!] = out as unknown as Node;
    }
    return to(root);
  };
  for (const [d, c] of copies) {
    const def = code.nodes[d] as Extract<Node, { kind: "def" }>;
    nodes[c] = { ...def, id: c, body: copy(def.body!) } as Node;
    outNames[c] = `${names[d] ?? "it"} at its first`;
  }
  // Each first tried as its thunk run there, the thunk's type free of
  // first's (which would give it Choice).
  const thunks = new Map(sites.map((s) => [s, copy((code.nodes[s] as { args: Id[] }).args[0])]));
  for (const [s, th] of thunks) nodes[s] = { id: s, kind: "call", fn: th, args: [] } as Node;
  let out: Code = { ...code, nodes, defs: [...code.defs, ...copies.values()] };
  let checked: Info;
  try { checked = infer(out, outNames, undefined, info.options); } catch { return { code, info, names, taken: 0 }; }
  // Where the thunk chooses no more, the first is its body; elsewhere the
  // first stays as it was.
  let taken = 0;
  for (const [s, th] of thunks) {
    const t = checked.typeOf.get(th), z = t && checked.subst.zonk(t);
    if (z?.t === "fn" && !checked.subst.resolveRow(z.eff).effs.includes(CHOICE)) { nodes[s] = { ...nodes[(nodes[th] as { body: Id }).body], id: s } as Node; taken++; }
    else nodes[s] = code.nodes[s];
  }
  if (!taken) return { code, info, names, taken: 0 };
  out = { ...out, nodes };
  try { checked = infer(out, outNames, undefined, info.options); } catch { return { code, info, names, taken: 0 }; }
  // Checked again, the program as it came may have problems its first
  // check didn't (stage.ts has the same): only new ones count.
  if (checked.errors.length > info.errors.length) {
    let before: Set<string>;
    try { before = new Set(infer(code, names, undefined, info.options).errors.map((e) => e.message)); } catch { return { code, info, names, taken: 0 }; }
    if (checked.errors.some((e) => !before.has(e.message))) return { code, info, names, taken: 0 };
  }
  return { code: out, info: checked, names: outNames, taken };
}

const idsIn = (v: unknown): Id[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is Id => typeof x === "string") : v && typeof v === "object" ? (Object.values(v) as Id[]) : [];
const remap = (v: unknown, f: (x: Id) => Id): unknown =>
  typeof v === "string" ? f(v) : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? f(x) : x)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? f(x) : x])) : v;

