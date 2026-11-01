// Handlers the compiler can see (BACKLOG C64b): a handler whose cases
// answer in place and perform nothing, around code that calls named
// definitions, is put into that code. Each perform of its effect becomes
// the case itself, and each definition the code reaches that performs it
// gets a copy that does the same. The handler is gone, and so is the
// search for it ($perform) and anything an answer didn't use: Pig's
// `quietly` drops each `say`'s line, so the copies don't build it.
//
// Two steps, each giving code that is checked again (compile.ts):
//
//   - A call of a definition whose body is such a handler around a call
//     of one of its inputs, given a function written right there
//     (`quietly(() => …)`), is replaced by that handler with the function's
//     body in place of the call: the code it handles is now known.
//   - A handler around known code is put into it. Values the cases use
//     from around the handler (Pig's `hold at` limits) become inputs of the
//     copies.
//
// It is done only where nothing can see the difference: the effect isn't
// performed inside a function value the code makes (it could be called
// after the handler is gone), no definition reached takes a function that
// may perform it, and no handler for the same effect sits inside.
//
// Prior art: evidence passing for effect handlers, where each perform
// calls the handler it was given and tail-resumptive operations run in
// place (Xie and Leijen, "Generalized evidence passing for effect
// handlers", ICFP 2021; Koka and Effekt), here taken one step further by
// writing the case in; and lambda lifting (Johnsson, 1985) for the values
// the cases use.

import { freshId, mapIds, subtree, type Code, type Id, type Node, type NodeOf } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { SIGS } from "../../ters/src/lang/std.ts";
import { DIVERGE, Subst, type Type } from "../../ters/src/lang/types.ts";

type Names = Record<Id, string>;

export function fuseHandlers(code: Code, info: Info, names: Names): { code: Code; names: Names; fused: number } | null {
  const nodes: Record<Id, Node> = { ...code.nodes };
  const defs = [...code.defs];
  const newNames: Names = { ...names };
  const effectOf = (variant: Id): Id | null => {
    const def = info.owner.get(variant);
    const body = def ? (code.nodes[def] as NodeOf<"def">).body : null;
    return body && (code.nodes[body] as NodeOf<"typedef">)?.effect ? def! : null;
  };
  const opOf = (id: Id): Id | null => { const n = nodes[id]; if (n?.kind !== "call") return null; const f = nodes[n.fn]; return f?.kind === "ref" && nodes[f.target]?.kind === "variant" ? effectOf(f.target) && f.target : null; };
  const calleeDef = (id: Id): Id | null => { const n = nodes[id]; if (n?.kind !== "call") return null; const f = nodes[n.fn]; return f?.kind === "ref" && nodes[f.target]?.kind === "def" && code.nodes[f.target] ? f.target : null; };
  // A callee's own type: a builtin's signature (its variables are its
  // own, not the program's), or a definition's scheme.
  const ownType = (target: Id): { fn: boolean; params: Type[]; effs: Id[] } | null => {
    const t = nodes[target];
    if (t?.kind === "builtin") { const s = SIGS[target]?.(new Subst()); return s?.t === "fn" ? { fn: true, params: s.params, effs: s.eff.effs } : null; }
    const s = t?.kind === "def" ? info.schemes.get(target)?.type : undefined;
    return s?.t === "fn" ? { fn: true, params: s.params.map((p) => info.subst.zonk(p)), effs: info.subst.resolveRow(s.eff).effs } : null;
  };
  const effectsOf = (target: Id): Id[] | null => ownType(target)?.effs ?? null;
  const kids = (id: Id) => subtree({ nodes, defs }, id);

  // A handler this can take: cases that answer, perform nothing, and no
  // case for the finish or for an operation answered later.
  const handlerEffect = (n: Node): Id | null => {
    if (n.kind !== "match" || !n.arms.length || n.otherwise) return null;
    const arms = n.arms.map((a) => nodes[a] as NodeOf<"arm">);
    const e = effectOf(arms[0].variant);
    if (!e) return null;
    for (const a of arms) {
      const v = nodes[a.variant] as NodeOf<"variant">;
      if (!v.returns || v.later || effectOf(a.variant) !== e) return null;
      if (!quiet(a.body)) return null;
    }
    return e;
  };
  // Every call in it is of a named function or operation-free builtin,
  // taking no function, with no effect but Diverge.
  const quiet = (root: Id) => kids(root).every((id) => {
    const c = nodes[id];
    if (c.kind === "lambda") return isLet(id);
    if (c.kind !== "call") return true;
    const f = nodes[c.fn];
    if (f?.kind === "lambda") return true;
    if (f?.kind !== "ref" || opOf(id)) return false;
    if (nodes[f.target]?.kind === "variant") return true;
    const t = ownType(f.target);
    return !!t && !t.params.some((p) => p.t === "fn") && t.effs.every((x) => x === DIVERGE);
  });
  // Pure and sure to end: a value nobody uses can be left unmade.
  const pure = (root: Id) => kids(root).every((id) => {
    const c = nodes[id];
    if (c.kind === "lambda") return isLet(id);
    if (c.kind === "match") return !handlerEffect(c);
    if (c.kind !== "call") return true;
    const f = nodes[c.fn];
    if (f?.kind === "lambda") return true;
    if (f?.kind !== "ref" || opOf(id)) return false;
    if (nodes[f.target]?.kind === "variant") return true;
    if (nodes[f.target]?.kind === "def" && info.divergent.has(f.target)) return false;
    const es = effectsOf(f.target);
    return !!es && es.length === 0;
  });
  // A lambda called right where it's written: a let.
  const parentCall = new Map<Id, Id>();
  for (const [id, n] of Object.entries(nodes)) if (n.kind === "call") parentCall.set(n.fn, id);
  const isLet = (lam: Id) => parentCall.has(lam);

  // Copy a subtree with fresh ids for everything in it; `swap` maps ids
  // outside it (a binder of the handler's surroundings) to others.
  const copy = (root: Id, swap = new Map<Id, Id>()): Id => {
    const fresh = new Map<Id, Id>();
    const inside = kids(root);
    for (const id of inside) { const f = freshId(); fresh.set(id, f); if (names[id] ?? newNames[id]) newNames[f] = names[id] ?? newNames[id]; }
    for (const id of inside) { const n = mapIds(nodes[id], (x) => fresh.get(x) ?? swap.get(x) ?? x); nodes[n.id] = n; }
    for (const id of inside) { const n = nodes[fresh.get(id)!]; if (n.kind === "call") parentCall.set(n.fn, n.id); }
    return fresh.get(root)!;
  };
  const ref = (target: Id): Id => { const id = freshId(); nodes[id] = { id, kind: "ref", target }; return id; };
  const call = (fn: Id, args: Id[]): Id => { const id = freshId(); nodes[id] = { id, kind: "call", fn, args }; parentCall.set(fn, id); return id; };
  const binderOf = (b: Id) => { const id = freshId(); nodes[id] = { id, kind: "binder" }; return id; };

  let fused = 0;

  // ---- Step 1: wrappers given a function written right there.
  // `wrapper`: a definition (input, …) => handler around input(), and the
  // input's position.
  const wrappers = new Map<Id, { lam: NodeOf<"lambda">; at: number } | null>();
  const wrapper = (d: Id) => { if (!wrappers.has(d)) wrappers.set(d, wrapperOf(d)); return wrappers.get(d)!; };
  const wrapperOf = (d: Id): { lam: NodeOf<"lambda">; at: number } | null => {
    const def = nodes[d] as NodeOf<"def">;
    const lam = def?.body ? nodes[def.body] : null;
    if (lam?.kind !== "lambda") return null;
    const h = nodes[lam.body];
    if (!h || !handlerEffect(h)) return null;
    const s = nodes[(h as NodeOf<"match">).scrutinee];
    if (s?.kind !== "call" || s.args.length) return null;
    const f = nodes[s.fn];
    const at = f?.kind === "ref" ? lam.params.indexOf(f.target) : -1;
    // The handler doesn't call itself, and the input is used once.
    if (at < 0 || kids(lam.body).some((x) => { const r = nodes[x]; return r.kind === "ref" && (r.target === d || (r.target === lam.params[at] && x !== s.fn)); })) return null;
    return { lam, at };
  };
  const simple = (id: Id) => { const n = nodes[id]; return n.kind === "ref" || n.kind === "lit"; };
  const inlineWrappers = (root: Id): void => {
    for (const id of kids(root)) {
      const d = calleeDef(id);
      if (!d) continue;
      const w = wrapper(d);
      if (!w) continue;
      const c = nodes[id] as NodeOf<"call">;
      const thunk = nodes[c.args[w.at]];
      if (thunk?.kind !== "lambda" || thunk.params.length || c.args.some((a, i) => i !== w.at && !simple(a))) continue;
      // The handler with the inputs put in (a name given for one: that
      // name; a literal: the literal), and the function's body for the
      // call of it.
      const swap = new Map<Id, Id>();
      c.args.forEach((a, i) => { const r = nodes[a]; if (i !== w.at && r.kind === "ref") swap.set(w.lam.params[i], r.target); });
      const h = copy(w.lam.body, swap);
      const m = nodes[h] as NodeOf<"match">;
      for (const [i, a] of c.args.entries()) {
        if (i === w.at || nodes[a].kind !== "lit") continue;
        for (const x of kids(h)) { const r = nodes[x]; if (r.kind === "ref" && r.target === w.lam.params[i]) nodes[x] = { ...nodes[a], id: x } as Node; }
      }
      nodes[m.scrutinee] = { ...nodes[thunk.body], id: m.scrutinee } as Node;
      if (nodes[m.scrutinee].kind === "call") parentCall.set((nodes[m.scrutinee] as NodeOf<"call">).fn, m.scrutinee);
      nodes[id] = { ...m, id } as Node;
      fused++;
      inlineWrappers(id);
      return;
    }
  };

  // ---- Step 2: a handler around known code, put into it.
  const fuse = (h: NodeOf<"match">, e: Id): boolean => {
    const arms = new Map(h.arms.map((a) => { const arm = nodes[a] as NodeOf<"arm">; return [arm.variant, arm] as const; }));
    // Values the cases use from around the handler.
    const bound = new Set<Id>();
    for (const a of arms.values()) for (const x of kids(a.body)) { const n = nodes[x]; if (n.kind === "lambda") n.params.forEach((p) => bound.add(p)); if (n.kind === "arm") n.binds.forEach((p) => bound.add(p)); }
    const free = [...new Set([...arms.values()].flatMap((a) => kids(a.body).flatMap((x) => {
      const n = nodes[x];
      return n.kind === "ref" && nodes[n.target]?.kind === "binder" && !a.binds.includes(n.target) && !bound.has(n.target) ? [n.target] : [];
    })))];
    // The definitions the code reaches that perform the effect.
    const performs = (d: Id) => (effectsOf(d) ?? []).includes(e);
    const reach = new Set<Id>(), todo = [h.scrutinee];
    const seen = new Set<Id>();
    while (todo.length) {
      const root = todo.pop()!;
      if (seen.has(root)) continue;
      seen.add(root);
      for (const x of kids(root)) {
        const n = nodes[x];
        if (n.kind === "ref" && nodes[n.target]?.kind === "def" && code.nodes[n.target] && performs(n.target) && !reach.has(n.target)) {
          // Only called, never passed as a value.
          if (parentCall.get(x) === undefined) return false;
          reach.add(n.target);
          const body = (nodes[n.target] as NodeOf<"def">).body;
          if (body) todo.push(body);
        }
      }
    }
    // What would see the difference.
    for (const root of [h.scrutinee, ...[...reach].map((d) => (nodes[d] as NodeOf<"def">).body!)]) {
      const top = nodes[root];
      for (const x of kids(root)) {
        const n = nodes[x];
        if (handlerEffect(n) === e) return false;
        if (n.kind === "match" && n.arms.some((a) => effectOf((nodes[a] as NodeOf<"arm">).variant) === e)) return false;
        // A function value that performs it, or reaches what does.
        if (n.kind === "lambda" && !isLet(x) && !(top.kind === "lambda" && x === top.id)) {
          if (kids(x).some((y) => { const op = opOf(y); const d = nodes[y].kind === "ref" ? (nodes[y] as NodeOf<"ref">).target : null; return (op && effectOf(op) === e) || (d && reach.has(d)); })) return false;
        }
        // A builtin that performs it (print, for Console): it asks the
        // handler at run time, so the handler stays.
        if (n.kind === "ref" && nodes[n.target]?.kind === "builtin" && (effectsOf(n.target) ?? []).includes(e)) return false;
        // A function known only when it runs (an input called), which
        // may perform it.
        if (n.kind === "call") {
          const f = nodes[n.fn];
          const known = (f?.kind === "ref" && ["def", "builtin", "variant"].includes(nodes[f.target]?.kind ?? "")) || (f?.kind === "lambda" && isLet(n.fn));
          if (!known) {
            const t = info.typeOf.get(n.fn), z = t && info.subst.zonk(t);
            if (z?.t !== "fn") return false;
            const row = info.subst.resolveRow(z.eff);
            if (row.effs.includes(e) || row.tail !== null) return false;
          }
        }
        // A definition taking a function that may perform it.
        if (n.kind === "call") {
          const t = info.typeOf.get(n.fn), z = t && info.subst.zonk(t);
          if (z?.t === "fn" && z.params.some((p) => { const q = info.subst.zonk(p); return q.t === "fn" && info.subst.resolveRow(q.eff).effs.includes(e); })) return false;
        }
      }
    }
    for (const d of reach) if (nodes[(nodes[d] as NodeOf<"def">).body!]?.kind !== "lambda") return false;
    // The copies: each reached definition with the values as more inputs.
    const copies = new Map<Id, Id>([...reach].map((d) => [d, freshId()]));
    // Write the cases in, and calls of reached definitions as their copies,
    // under `root`; `values` are the refs that give the values there.
    const writeIn = (root: Id, values: Map<Id, Id>) => {
      for (const x of kids(root)) {
        const n = nodes[x];
        if (n.kind !== "call") continue;
        const op = opOf(x);
        if (op && arms.has(op)) {
          const arm = arms.get(op)!;
          const own = arm.binds.map(binderOf);
          arm.binds.forEach((b, i) => { newNames[own[i]] = names[b] ?? "input"; });
          const body = copy(arm.body, new Map([...values, ...arm.binds.map((b, i) => [b, own[i]] as const)]));
          // The case's inputs as a let; one nobody uses, pure, left out.
          const keep = own.map((b, i) => [b, n.args[i]] as const).filter(([b, a]) => kids(body).some((y) => { const r = nodes[y]; return r.kind === "ref" && r.target === b; }) || !pure(a));
          if (!keep.length) { nodes[x] = { ...nodes[body], id: x } as Node; if (nodes[x].kind === "call") parentCall.set((nodes[x] as NodeOf<"call">).fn, x); continue; }
          const params = keep.map(([b]) => b);
          const lam = freshId();
          nodes[lam] = { id: lam, kind: "lambda", params, body };
          nodes[x] = { id: x, kind: "call", fn: lam, args: keep.map(([, a]) => a) };
          parentCall.set(lam, x);
          continue;
        }
        const d = calleeDef(x);
        if (d && copies.has(d)) {
          nodes[n.fn] = { ...(nodes[n.fn] as NodeOf<"ref">), target: copies.get(d)! };
          nodes[x] = { ...n, args: [...n.args, ...free.map((v) => ref(values.get(v) ?? v))] };
        }
      }
    };
    for (const d of reach) {
      const def = nodes[d] as NodeOf<"def">;
      const lam = nodes[def.body!] as NodeOf<"lambda">;
      const extra = free.map(binderOf);
      const body = copy(lam.body);
      const params = lam.params.map(binderOf);
      // the copy's own inputs
      const rename = new Map(lam.params.map((p, i) => [p, params[i]] as const));
      for (const x of kids(body)) { const r = nodes[x]; if (r.kind === "ref" && rename.has(r.target)) nodes[x] = { ...r, target: rename.get(r.target)! }; }
      const values = new Map(free.map((v, i) => [v, extra[i]] as const));
      writeIn(body, values);
      const l = freshId(), c = copies.get(d)!;
      nodes[l] = { id: l, kind: "lambda", params: [...params, ...extra], body };
      nodes[c] = { id: c, kind: "def", body: l } as Node;
      defs.push(c);
      newNames[c] = `${(names[d] ?? newNames[d] ?? d).replace(/ handled$/, "")} handled`;
      extra.forEach((b, i) => { newNames[b] = names[free[i]] ?? "value"; });
      params.forEach((b, i) => { newNames[b] = names[lam.params[i]] ?? "input"; });
    }
    writeIn(h.scrutinee, new Map());
    nodes[h.id] = { ...nodes[h.scrutinee], id: h.id } as Node;
    if (nodes[h.id].kind === "call") parentCall.set((nodes[h.id] as NodeOf<"call">).fn, h.id);
    fused++;
    return true;
  };

  for (const d of code.defs) {
    const def = code.nodes[d];
    if (def?.kind !== "def" || !def.body || code.nodes[def.body]?.kind === "typedef") continue;
    inlineWrappers(def.body);
  }
  // The handlers just written in are checked before step 2 looks at them.
  if (fused) return { code: { nodes, defs }, names: newNames, fused };
  // Innermost first: a handler whose code holds another is done after it,
  // in the next round, once the code is checked again.
  for (const d of code.defs) {
    const def = nodes[d];
    if (def?.kind !== "def" || !def.body) continue;
    for (const x of kids(def.body)) {
      const n = nodes[x];
      const e = handlerEffect(n);
      if (!e) continue;
      if (kids((n as NodeOf<"match">).scrutinee).some((y) => handlerEffect(nodes[y]))) continue;
      fuse(n as NodeOf<"match">, e);
    }
  }
  return fused ? { code: { nodes, defs }, names: newNames, fused } : null;
}
