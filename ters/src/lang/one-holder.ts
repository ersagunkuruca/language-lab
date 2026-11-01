// Does every value of these types have one holder? (IN-PLACE.md step 2,
// BACKLOG C63.) A map that nobody can see again after it is changed may be
// changed in place: the program can't tell. This says whether that holds
// for every map a program makes, from the program alone (Ersagun,
// 2026-10-29: no annotations, no uniqueness in the types).
//
// The rule is linearity with borrowing, checked on every path in the
// order the program runs (arguments left to right, a let's value before
// its body):
//
// - A value is **consumed** when it is changed (`put`), kept (stored in a
//   record or a list, returned, given to a function that keeps it) or
//   given away (to a function nobody can see into). After that, nothing
//   may use it again, by any name.
// - It is **borrowed** when it is only read (`value at`, `show`, a
//   function that only reads its parameter). Reads are fine any number of
//   times, before it is consumed.
// - A record holding a map holds a part of it: taking the record apart
//   gives names to its fields, and consuming one field consumes only that
//   field, so `search(add(s.frontier, x), put(s.found, t, d))` is fine, and
//   using `s` again afterwards is not.
// - A function's parameters are read off its body the same way (borrowed,
//   consumed once, or neither: used twice in a way that would share it),
//   so the check goes through the program's own helpers and the prelude's
//   generic ones. A closure may only read what it captures, and only when
//   it is given to a function that calls it and doesn't keep it.
// - Choice may run the rest twice, so a definition with Choice that holds
//   one of these values fails the check (IN-PLACE.md "What this doesn't
//   do").
//
// Prior art: linear types with borrowing, as in Wadler's "Linear types can
// change the world!" (1990) and Rust's borrow checker; here inferred, never
// written, as Perceus (Reinking et al., 2021) and Lean 4 (Ullrich and de
// Moura, 2019) decide ownership from the program.

import type { Code, Id, NodeOf } from "../model.ts";
import { subtree } from "../model.ts";
import type { Info } from "./infer.ts";
import { COMPARE, S, SHOW_ANY } from "./std.ts";
import { CHOICE, type Type } from "./types.ts";

export interface OneHolder { ok: boolean; problems: string[] }

// `types`: the types whose values must have one holder (std's Map).
// `jobs`: the definitions the representation does (put, value at, keys
// of…), read as it does them, not as they are written: each only reads its
// map, except `changes` (put, update at, remove key), which change the map
// at that position; whatever else they are given they may keep.
export function oneHolder(code: Code, info: Info, entry: Id, types: Set<Id>, jobs: Set<Id>, changes: Map<Id, number>, names: Record<Id, string> = {}): OneHolder {
  const nodes = code.nodes;
  const nm = (id: Id) => names[id] ?? id;
  const problems: string[] = [];

  // Does a type mention one of `types`, directly or in a data type's fields?
  const memo = new Map<Id, boolean>();
  const dataMentions = (id: Id): boolean => {
    if (types.has(id)) return true;
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, false);
    const d = nodes[id], td = d?.kind === "def" && d.body ? nodes[d.body] : null;
    let got = false;
    if (td?.kind === "typedef" && !td.effect) {
      const trefMentions = (t: Id): boolean => { const x = nodes[t]; return x?.kind === "tref" ? dataMentions(x.target) || x.args.some(trefMentions) : x?.kind === "tfun" ? false : false; };
      got = td.variants.some((v) => (nodes[v] as NodeOf<"variant">).fields.some((f) => trefMentions((nodes[f] as NodeOf<"field">).type)));
    }
    memo.set(id, got);
    return got;
  };
  const mentions = (t: Type | undefined): boolean => {
    if (!t) return false;
    const z = info.subst.zonk(t);
    return z.t === "con" ? dataMentions(z.id) || z.args.some(mentions) : false;
  };
  const linearBinder = (b: Id) => mentions(info.typeOf.get(b));
  const open = (t: Type | undefined): boolean => {
    if (!t) return true;
    const z = info.subst.zonk(t);
    return z.t === "var" || (z.t === "con" ? z.args.some(open) : z.params.some(open) || open(z.ret));
  };

  // The definitions main reaches.
  const reached = new Set<Id>();
  const reach = (d: Id) => {
    if (reached.has(d) || nodes[d]?.kind !== "def") return;
    reached.add(d);
    for (const id of subtree(code, d)) { const n = nodes[id]; if (n.kind === "ref" && nodes[n.target]?.kind === "def") reach(n.target); }
  };
  reach(entry);
  const lambdaOf = (d: Id) => { const n = nodes[d]; const b = n?.kind === "def" && n.body ? nodes[n.body] : null; return b?.kind === "lambda" ? b : null; };

  // What a function does with a parameter: the parts of it it reads or
  // takes (a path below the parameter, "" for all of it), and whether it
  // uses it in a way that would share it (`share`).
  interface Use { path: string; consume: boolean }
  interface Mode { share: boolean; uses: Use[] }
  const READ: Mode = { share: false, uses: [{ path: "", consume: false }] };
  const TAKE: Mode = { share: false, uses: [{ path: "", consume: true }] };
  const modes = new Map<Id, Mode[]>();
  const modeOf = (d: Id, i: number): Mode => {
    if (jobs.has(d)) { const p = lambdaOf(d)?.params[i]; return p && mentions(info.typeOf.get(p)) ? (changes.get(d) === i ? TAKE : READ) : TAKE; }
    return modes.get(d)?.[i] ?? { share: false, uses: [] };
  };
  // A builtin may keep or give back a value only through a type variable
  // its result mentions (`first`, a list's `items`); `less` can't.
  const occurs = (v: number, t: Type): boolean => t.t === "var" ? t.v === v : t.t === "con" ? t.args.some((a) => occurs(v, a)) : t.params.some((a) => occurs(v, a)) || occurs(v, t.ret);
  const generic = (fnRef: Id, i: number) => {
    const decl = info.typeOf.get((nodes[fnRef] as NodeOf<"ref">).target), dz = decl && info.subst.zonk(decl);
    const p = dz?.t === "fn" ? dz.params[i] : undefined;
    return !!p && p.t === "var" && dz?.t === "fn" && occurs(p.v, dz.ret);
  };
  const fieldIndex = (field: Id) => {
    const v = info.owner.get(field), td = v ? nodes[(nodes[v] as NodeOf<"def">).body!] : null;
    return td?.kind === "typedef" ? (nodes[td.variants[0]] as NodeOf<"variant">).fields.indexOf(field) : -1;
  };

  // `captured`: roots a closure being walked captured, which it may only read.
  interface Walk { consumed: Set<string>; captured: Set<string> }
  const rootOf = (p: string) => p.split("/")[0];
  // Paths stop six fields down: below that, a part stands for all of it
  // (a recursive type would give paths without end).
  const cut = (p: string) => p.split("/").slice(0, 7).join("/");
  const clash = (a: string, b: string) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");

  // One walk over a definition, in the order it runs. `tracked`: the
  // binders followed. `typed`: only values whose types hold one of
  // `types` count (the program); otherwise every use counts (a
  // parameter's mode, whatever it is given).
  function walker(tracked: (b: Id) => boolean, typed: boolean, report: (msg: string, root: string) => void, seen: (p: string, consume: boolean) => void = () => {}) {
    const paths = new Map<Id, string>();
    const isTracked = (b: Id) => paths.has(b) || tracked(b);
    const pathOf = (b: Id) => paths.get(b) ?? b;
    // A part of a known type that holds none of `types` is never followed;
    // in a parameter's mode, one of a type still open might be.
    const counts = (node: Id) => mentions(info.typeOf.get(node)) || (!typed && open(info.typeOf.get(node)));
    const use = (st: Walk, p: string, consume: boolean, node: Id) => {
      if (!counts(node)) return;
      for (const c of st.consumed) if (clash(c, p)) { report(`${nm(rootOf(p))} is used after it was changed or kept`, rootOf(p)); return; }
      seen(p, consume);
      if (!consume) return;
      if (st.captured.has(rootOf(p))) { report(`a closure changes or keeps ${nm(rootOf(p))}, which it captured`, rootOf(p)); return; }
      st.consumed.add(p);
    };
    // The place an expression names: a followed name, or a field of one.
    const place = (id: Id): string | null => {
      const n = nodes[id];
      if (n?.kind === "ref") return nodes[n.target]?.kind === "binder" && isTracked(n.target) ? pathOf(n.target) : null;
      if (n?.kind === "call" && n.args.length === 1 && nodes[n.fn]?.kind === "ref" && nodes[(nodes[n.fn] as NodeOf<"ref">).target]?.kind === "field") {
        const base = place(n.args[0]);
        return base === null ? null : cut(`${base}/${fieldIndex((nodes[n.fn] as NodeOf<"ref">).target)}`);
      }
      return null;
    };
    const ev = (id: Id, consume: boolean, st: Walk): void => {
      const n = nodes[id];
      if (!n) return;
      const p = place(id);
      if (p !== null) { use(st, p, consume, id); return; }
      switch (n.kind) {
        case "ref":
          // A definition passed as a value may be given a followed value.
          if (nodes[n.target]?.kind === "def" && (modes.get(n.target) ?? []).some((m) => m.share) && counts(id)) report(`${nm(n.target)} shares a parameter and is passed as a value`, "");
          return;
        case "lambda": closure(n, consume, st); return;
        case "call": return call(n, consume, st);
        case "match": case "fold": {
          const base = place(n.scrutinee);
          if (base !== null) use(st, base, false, n.scrutinee); else ev(n.scrutinee, true, st);
          const after = new Set(st.consumed);
          const branches: { arm?: NodeOf<"arm">; body: Id }[] = [...n.arms.map((a) => ({ arm: nodes[a] as NodeOf<"arm">, body: (nodes[a] as NodeOf<"arm">).body })), ...(n.kind === "match" && n.otherwise ? [{ body: n.otherwise }] : [])];
          for (const br of branches) {
            // Names the arm binds are new each time it runs: what an
            // earlier walk of the same nodes used up under them is gone (a
            // match's otherwise can be its scrutinee's own nodes again).
            const fresh = new Set<string>();
            br.arm?.binds.forEach((b, i) => { if (base !== null) paths.set(b, cut(`${base}/${i}`)); else if (tracked(b)) { paths.set(b, b); fresh.add(b); } });
            br.arm?.results.forEach((b) => { if (b && tracked(b)) { paths.set(b, b); fresh.add(b); } });
            const inner: Walk = { consumed: new Set([...after].filter((c) => !fresh.has(rootOf(c)))), captured: st.captured };
            ev(br.body, consume, inner);
            inner.consumed.forEach((c) => st.consumed.add(c));
          }
          return;
        }
        case "solve":
          for (const g of Object.values(n.given)) ev(g, true, st);
          for (const b of Object.values(n.binds)) if (tracked(b)) paths.set(b, b);
          ev(n.body, consume, st);
          return;
        default:
          return;
      }
    };
    const call = (n: NodeOf<"call">, consume: boolean, st: Walk) => {
      const f = nodes[n.fn];
      // let x = e in body: a name given to a place is that place.
      if (f?.kind === "lambda") {
        f.params.forEach((x, i) => {
          const a = n.args[i];
          if (a === undefined) return;
          const pa = place(a);
          if (pa !== null) { paths.set(x, pa); return; }
          ev(a, true, st);
          if (tracked(x)) paths.set(x, x);
        });
        ev(f.body, consume, st);
        return;
      }
      const target = f?.kind === "ref" ? f.target : null;
      const tn = target ? nodes[target] : null;
      // first(a, b): b runs only when a gives no answer, so the two are
      // branches. A thunk may change what it captured only in its last
      // step (that change is its answer), so a failure inside it comes
      // before the change.
      if (target === S.first && n.args.every((a) => nodes[a]?.kind === "lambda" && !(nodes[a] as NodeOf<"lambda">).params.length)) {
        const before = new Set(st.consumed);
        for (const a of n.args) {
          const inner: Walk = { consumed: new Set(before), captured: st.captured };
          const body = nodes[(nodes[a] as NodeOf<"lambda">).body];
          if (body?.kind === "call" && nodes[body.fn]?.kind === "ref" && nodes[(nodes[body.fn] as NodeOf<"ref">).target]?.kind !== "field") args(body, inner, true);
          else ev((nodes[a] as NodeOf<"lambda">).body, consume, inner);
          inner.consumed.forEach((c) => st.consumed.add(c));
        }
        return;
      }
      if (!tn || tn.kind === "binder" || tn.kind === "lambda") ev(n.fn, false, st);
      args(n, st, false);
    };
    // A call's arguments, in order; a place given whole is used when the
    // function runs, after all of them; closures given run then too.
    const args = (n: NodeOf<"call">, st: Walk, last: boolean) => {
      const f = nodes[n.fn], target = f?.kind === "ref" ? f.target : null, tn = target ? nodes[target] : null;
      const modeAt = (i: number): Mode => {
        if (tn?.kind === "def") return modeOf(target!, i);
        if (tn?.kind === "variant") return TAKE;
        if (tn?.kind === "builtin") return target === S.equal || target === SHOW_ANY || target === COMPARE ? READ : generic(n.fn, i) ? TAKE : READ;
        return TAKE;
      };
      const deferred: { p: string; m: Mode; node: Id }[] = [];
      const closures: (() => void)[] = [];
      n.args.forEach((a, i) => {
        const m = modeAt(i), an = nodes[a];
        if (m.share && counts(a)) report(`${nm(target ?? "a function")} shares its parameter ${i + 1}`, place(a) ? rootOf(place(a)!) : "");
        if (an?.kind === "lambda") { closures.push(() => closure(an, m.share || m.uses.some((u) => u.consume), st)); return; }
        const pa = place(a);
        if (pa !== null) { deferred.push({ p: pa, m, node: a }); return; }
        ev(a, m.uses.some((u) => u.consume) || m.share, st);
      });
      // The same value given twice, one of them to be taken: shared.
      for (const x of deferred) for (const y of deferred) if (x !== y && clash(x.p, y.p) && x.m.uses.some((u) => u.consume) && counts(x.node)) report(`${nm(rootOf(x.p))} is given twice to one call, and taken`, rootOf(x.p));
      // A mode's uses are what the function may do on any of its paths, not
      // in a row: each is checked against what was used up before the call,
      // and then they are used up together.
      const snapshot = new Set(st.consumed), adds = new Set<string>();
      for (const d of deferred) for (const u of d.m.uses) {
        const w: Walk = { consumed: new Set(snapshot), captured: last ? new Set() : st.captured };
        use(w, cut(d.p + u.path), u.consume, d.node);
        w.consumed.forEach((c) => { if (!snapshot.has(c)) adds.add(c); });
      }
      adds.forEach((c) => st.consumed.add(c));
      closures.forEach((g) => g());
    };
    // A closure's body, walked where it runs: its own parameters are fresh
    // on each call; what it captures it may only read; a closure that is
    // kept may capture nothing followed. What it does is forgotten after:
    // it may run any number of times.
    const closure = (l: NodeOf<"lambda">, keeps: boolean, st: Walk) => {
      const inside = new Set(subtree(code, l.id));
      const captured = new Set<string>();
      for (const id of inside) { const x = nodes[id]; if (x.kind === "ref" && nodes[x.target]?.kind === "binder" && isTracked(x.target) && !inside.has(x.target) && counts(id)) captured.add(rootOf(pathOf(x.target))); }
      if (keeps && captured.size) { report(`a closure that is kept captures ${[...captured].map(nm).join(", ")}`, [...captured][0]); return; }
      for (const x of l.params) if (tracked(x)) paths.set(x, x);
      ev(l.body, true, { consumed: new Set(st.consumed), captured: new Set([...st.captured, ...captured]) });
    };
    return (body: Id, params: Id[] = []) => { for (const x of params) if (tracked(x)) paths.set(x, x); ev(body, true, { consumed: new Set(), captured: new Set() }); };
  }

  // Parameter modes, to a fixed point: each definition's body walked with
  // its parameters followed, whatever their types.
  const defsReached = [...reached].filter((d) => lambdaOf(d) && !jobs.has(d));
  for (let round = 0; round < 30; round++) {
    let changed = false;
    for (const d of defsReached) {
      const lam = lambdaOf(d)!, params = new Set(lam.params);
      const got = new Map<string, Mode>(lam.params.map((x) => [x, { share: false, uses: [] }]));
      const run = walker((b) => params.has(b), false, (_msg, root) => { if (params.has(root)) got.get(root)!.share = true; }, (p, consume) => {
        const r = rootOf(p), m = got.get(r);
        if (!m) return;
        // A mode keeps one field down: a part of a part is the part.
        const path = p.slice(r.length).split("/").slice(0, 2).join("/");
        if (!m.uses.some((u) => u.path === path && u.consume === consume)) m.uses.push({ path, consume });
      });
      run(lam.body);
      const next = lam.params.map((x) => got.get(x)!);
      if (JSON.stringify(next) !== JSON.stringify(modes.get(d))) { modes.set(d, next); changed = true; }
    }
    if (!changed) break;
  }

  // A map whose keys or values hold one of these types would hand out
  // parts of itself: not followed, so refused.
  for (const d of reached) for (const id of subtree(code, d)) {
    const t = info.typeOf.get(id), z = t && info.subst.zonk(t);
    if (z?.t === "con" && types.has(z.id) && z.args.some(mentions)) { problems.push(`${nm(d)} has a ${nm(z.id)} that holds another`); break; }
  }

  // The program: every definition main reaches that holds one of these
  // values, followed.
  for (const d of reached) {
    const def = nodes[d] as NodeOf<"def">;
    if (!def.body || jobs.has(d)) continue;
    if (!subtree(code, d).some((id) => nodes[id].kind === "binder" && linearBinder(id))) continue;
    const t = info.typeOf.get(d), z = t && info.subst.zonk(t);
    if (z?.t === "fn" && info.subst.resolveRow(z.eff).effs.includes(CHOICE)) { problems.push(`${nm(d)} has Choice and holds a ${[...types].map(nm).join(" or ")}`); continue; }
    const lam = lambdaOf(d);
    walker(linearBinder, true, (msg) => problems.push(`${nm(d)}: ${msg}`))(lam ? lam.body : def.body, lam?.params ?? []);
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}
