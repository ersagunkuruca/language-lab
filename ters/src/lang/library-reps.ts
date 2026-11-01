// Library representations chosen without the program asking (BACKLOG C47,
// C48; DATA-STRUCTURES.md step 2). A program that uses std's Map or Set
// gets the representation the chooser picks from the costs of the jobs it
// uses: the sorted entries or items as defined, or the library's
// weight-balanced tree (LIBRARY.reps, from the trees module, C51). A
// representation the program writes for the type (lab, #97) still wins.
//
// A tree isn't a canonical spelling, so equal, show and compare on one
// are its row's `byType`, which go through its meaning (the sorted list).
// Where the type sits inside another value (a list of maps, a pair of
// sets, a map's values, main's answer) they are given the value with each
// tree inside it turned into its meaning, by a definition made for that
// type (C52). A map's keys or a set's items that hold one would be ordered
// by the tree's shape, so such a program keeps the definition.

import { dependencies, freshId, mapIds, merge, subtree, type Code, type Id, type Node, type NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info } from "./infer.ts";
import { Lang } from "./dsl.ts";
import { LIBRARY, TREES } from "./library.ts";
import { choose, represent, uses, type Representation } from "./represent.ts";
import { ARRAY_OPS, COMPARE, CONS, LIST, MAP, MAP_V, NIL, PAIR_V, S, SHOW_ANY, SIGS } from "./std.ts";
import { INT, STRING, Subst, type Type } from "./types.ts";

// What equal, show and compare see of a value: these, given a stored one,
// are its row's (byType), which go through its meaning.
const BY_VALUE: Record<Id, "equal" | "show" | "compare"> = { [S.equal]: "equal", [SHOW_ANY]: "show", [COMPARE]: "compare" };

// `insiders`: the representations' definitions, which may call the
// private constructors they represent (infer.ts Options). The library's
// own are insiders already (load.ts checkOptions).
export interface Chosen { code: Code; names: Names; chosen: string[]; insiders: Id[]; info?: Info }

// `defs`: the program's own definitions, which the rewrite changes;
// `asked`: the program's own representations, whose types are left alone.
// A choice that doesn't check is no choice (I105): the program checked as
// written, so a rewrite that makes it fail (a signature it pins to List,
// say) is dropped, the list row first, and the program runs as written.
// The check made is handed back as `info`.
// `hostMaps`: the program runs where std's Table is (the evaluator and
// compiled JavaScript), so a Map may be a hash table changed in place
// (C63b); WebAssembly, C and shaders have none.
export interface LibraryOptions { hostMaps?: boolean }

export function withLibraryRepresentations(code: Code, info: Info, names: Names, main: Id, defs: Id[], asked: Representation[] = [], options: LibraryOptions = {}): Chosen {
  const skip = new Set<Id>();
  for (;;) {
    const r = choiceOf(code, info, names, main, defs, asked, skip, options);
    if (!r.reps.length) return { code, names, chosen: [], insiders: [] };
    const checked = infer(r.code, r.names, undefined, { ...info.options, insiders: [...(info.options?.insiders ?? []), ...r.insiders] });
    if (checked.errors.length <= info.errors.length) return { code: r.code, names: r.names, chosen: r.chosen, insiders: r.insiders, info: checked };
    const list = r.reps.find((x) => x.of === LIST);
    // A hash table that doesn't check gives way to the tree, not to the
    // definition.
    const table = r.reps.find((x) => x.oneHolder);
    for (const x of table ? [table] : list ? [list] : r.reps) skip.add(table ? x.name + " " + x.of : x.of);
  }
}

function choiceOf(code: Code, info: Info, names: Names, main: Id, defs: Id[], asked: Representation[], skip: Set<Id>, options: LibraryOptions): Chosen & { reps: Representation[] } {
  const chosen: Representation[] = [];
  for (const ty of new Set(LIBRARY.reps.filter((r) => r.byType).map((r) => r.of))) {
    const spec = LIBRARY.reps.find((r) => r.of === ty && r.canonical)!;
    if (asked.some((r) => r.of === ty) || skip.has(ty)) continue;
    // A hash table only where it is (hostMaps), and only where every map
    // has one holder, so a put changing it in place can't be seen.
    const rows = LIBRARY.reps.filter((r) => r.of === ty && r.byType && !skip.has(r.name + " " + ty)
      && (!r.oneHolder || (options.hostMaps && inPlace(code, info, main, defs, r))));
    if (!rows.length || !uses(code, main, [spec, ...rows]).length) continue;
    const tree = choose(code, main, [spec, ...rows]).rep;
    if (tree === spec || keyed(info, defs, code, ty) || generic(info, defs, code, tree)) continue;
    // Lists as arrays (C30d3b): alone, and only where every list the
    // program reaches can be one (listBoundary).
    if (tree.of === LIST && (chosen.length || !listBoundary(merge(treesFor(code, [tree]), code), info, defs, tree))) continue;
    chosen.push(tree);
  }
  if (!chosen.length) return { code, names, chosen: [], insiders: [], reps: [] };
  // The trees' module, which the library leaves out (library.ts): only
  // the definitions the chosen rows use, since the program is checked
  // again with them (the whole module is about 2,500 nodes).
  code = merge(treesFor(code, chosen), code);
  names = { ...TREES.names, ...names };
  // Lists as arrays reach the library's own definitions on lists (map,
  // sum, …): the program gets its own copies of them, which the rewrite
  // changes, and the library's stay as they are for everything else.
  const lists = chosen.find((r) => r.of === LIST), boundary = lists && listBoundary(code, info, defs, lists)!;
  let copies: Id[] = [];
  if (boundary) {
    const withBoundary: Code = { nodes: { ...code.nodes, ...boundary.nodes }, defs: [...code.defs, ...boundary.made] };
    const library = boundary.reached.filter((d) => !defs.includes(d));
    const fresh = new Map<Id, Id>();
    for (const d of library) for (const id of subtree(withBoundary, d)) fresh.set(id, freshId());
    const f = (id: Id) => fresh.get(id) ?? id;
    const nodes = { ...withBoundary.nodes };
    for (const d of library) for (const id of subtree(withBoundary, d)) { const n = mapIds(withBoundary.nodes[id], f); nodes[n.id] = n; }
    for (const d of defs) for (const id of subtree(withBoundary, d)) nodes[id] = mapIds(withBoundary.nodes[id], f);
    code = { nodes, defs: [...code.defs, ...boundary.made, ...library.map(f)] };
    names = { ...names, ...Object.fromEntries(library.map((d) => [f(d), names[d] ?? LIBRARY.names[d] ?? d])), ...Object.fromEntries(boundary.made.map((d) => [d, "stored list"])) };
    copies = library.map(f);
  }
  // equal, show and compare on a stored value: the row's own, through its
  // meaning; on a value with one inside, given that value as meanings.
  const k = new Lang(code);
  const meanings = asMeanings(k, code, info, names, chosen);
  const nodes: Record<Id, Node> = { ...code.nodes };
  const typeOf = (id: Id) => { const t = info.typeOf.get(id); return t && info.subst.zonk(t); };
  const rowOf = (id: Id) => { const t = typeOf(id); return t?.t === "con" ? chosen.find((r) => r.of === t.id) : undefined; };
  const call = (fn: Id, arg: Id): Id => { const r = freshId(), c = freshId(); nodes[r] = { id: r, kind: "ref", target: fn }; nodes[c] = { id: c, kind: "call", fn: r, args: [arg] }; return c; };
  for (const d of defs) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    // A match on a stored value's items (keys, entries) whose cons case
    // doesn't use the rest needs only the first: its row's head, down the
    // left of the tree, not the whole list (GAPS.md M3).
    if (n.kind === "match") {
      const s = code.nodes[n.scrutinee], f = s?.kind === "call" ? code.nodes[s.fn] : undefined;
      const head = s?.kind === "call" && f?.kind === "ref" && s.args[0] ? rowOf(s.args[0])?.heads?.[f.target] : undefined;
      const cons = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">).find((a) => a.variant === CONS);
      const rest = cons?.binds[1];
      if (head && rest && !subtree(code, cons.body).some((x) => { const r = code.nodes[x]; return r.kind === "ref" && r.target === rest; })) {
        const r = freshId();
        nodes[r] = { id: r, kind: "ref", target: head };
        nodes[s.id] = { ...(s as NodeOf<"call">), fn: r };
      }
      continue;
    }
    if (n.kind !== "call") continue;
    const f = code.nodes[n.fn];
    const job = f?.kind === "ref" ? BY_VALUE[f.target] : undefined;
    if (!job || !n.args[0]) continue;
    const row = rowOf(n.args[0]), t = typeOf(n.args[0])!;
    if (row && t.t === "con" && !t.args.some((a) => meanings(a))) {
      const r = freshId();
      nodes[r] = { id: r, kind: "ref", target: row.byType![job] };
      nodes[id] = { ...n, fn: r };
      continue;
    }
    const m = meanings(t);
    if (m) nodes[id] = { ...n, args: n.args.map((a) => call(m, a)) };
  }
  // main's answer, for whoever shows it: main gives what it gave, as meanings.
  const answer = (() => { const t = typeOf(main); return t?.t === "fn" ? meanings(info.subst.zonk(t.ret)) : t ? meanings(t) : null; })();
  let own = [...defs, ...copies];
  if (answer) {
    const def = nodes[main] as NodeOf<"def">, inner = k.def(`${names[main] ?? "main"} as stored`);
    const body = code.nodes[def.body!];
    k.code.nodes[inner] = { ...(k.code.nodes[inner] as NodeOf<"def">), body: def.body };
    nodes[main] = { ...def, body: body?.kind === "lambda"
      ? k.fn(body.params.map((p) => names[p] ?? "x"), (...xs) => k.call(answer, k.call(inner, ...xs)))
      : k.call(answer, k.x(inner)) };
    own = [...own, inner];
  }
  const made = k.code.defs.filter((d) => !code.nodes[d]);
  const all = { nodes: { ...k.code.nodes, ...nodes }, defs: [...code.defs, ...made] };
  // The way back from a builtin's list (listBoundary's `made`) is written
  // on List, and stays so.
  const kept = [...made.filter((d) => !own.includes(d)), ...(boundary ? boundary.made : [])];
  const out = chosen.reduce((c, rep) => represent(c, own, rep, kept), all);
  return { code: out, names: { ...names, ...k.names }, chosen: chosen.map((r) => `${names[r.of] ?? LIBRARY.names[r.of]} as ${r.name}`), insiders: made, reps: chosen };
}

const prelude = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

// For a type with a stored value somewhere inside, a definition giving the
// value with each one as its meaning (null if it has none): a list item by
// item, a case field by field, a map's values. The definitions aren't the
// program's, so representing it leaves the meanings they build alone.
function asMeanings(k: Lang, code: Code, info: Info, names: Names, chosen: Representation[]) {
  const made = new Map<string, Id | null>();
  // A case of another type has one if its own fields do (GAPS.md M2: the
  // program's record holding a map).
  const has = (t: Type): boolean => t.t === "con" && (chosen.some((r) => r.of === t.id) || t.args.some((a) => has(info.subst.zonk(a))) || holds(t.id));
  const key = (t: Type): string => (t.t === "con" ? `${t.id}(${t.args.map((a) => key(info.subst.zonk(a))).join(",")})` : t.t);
  const meanings = (t: Type): Id | null => {
    t = info.subst.zonk(t);
    if (t.t !== "con" || !has(t)) return null;
    const ks = key(t);
    if (made.has(ks)) return made.get(ks)!;
    const d = k.def(`as meanings`);
    made.set(ks, d);
    const row = chosen.find((r) => r.of === t.id);
    const args = t.args.map((a) => info.subst.zonk(a));
    if (row?.of === LIST) {
      // An array's items, each as its meaning when it holds some. A fold
      // written here, not the prelude's map, which the program's arrays
      // reach and so is rewritten.
      const inner = meanings(args[0]);
      k.define(d, inner
        ? k.fn(["array"], (a) => k.fold(k.call(row.meaning!, a), [
          { variant: NIL, names: [], body: () => k.x(NIL) },
          { variant: CONS, names: ["item", "rest"], results: [null, "the rest's meanings"], body: ([x], [, r]) => k.call(CONS, k.call(inner, x), r!) },
        ]))
        : k.x(row.meaning!));
      return d;
    }
    if (row) {
      // A map's values that hold some: its entries' values as meanings.
      const inner = t.id === MAP ? meanings(args[1]) : null;
      k.define(d, inner
        ? k.fn(["tree"], (tr) => k.call(MAP_V, k.call(prelude("map"), k.call(row.impl[prelude("entries of")], tr), k.fn(["entry"], (e) =>
          k.match(e, [{ variant: PAIR_V, names: ["key", "value"], body: ([kk, v]) => k.call(PAIR_V, kk, k.call(inner, v)) }])))))
        : k.x(row.meaning!));
      return d;
    }
    if (t.id === LIST) {
      const item = meanings(args[0])!;
      k.define(d, k.fn(["list"], (xs) => k.call(prelude("map"), xs, k.x(item))));
      return d;
    }
    // A case of another type: each field that holds some, as meanings.
    const td = code.nodes[(code.nodes[t.id] as NodeOf<"def">)?.body ?? ""];
    if (td?.kind !== "typedef") { made.set(ks, null); return null; }
    const params = new Map(td.params.map((p, i) => [p, args[i]] as const));
    const fieldType = (id: Id): Type => {
      const n = code.nodes[id];
      if (n.kind === "tref") return params.get(n.target) ?? { t: "con", id: n.target, args: n.args.map(fieldType) };
      return { t: "var", v: -1 };
    };
    // A type whose own fields hold a stored value is rewritten too, so its
    // meanings are built in a copy that isn't (GAPS.md M2).
    const into = holds(t.id) ? (k.code.nodes[(k.code.nodes[shadow(t.id)] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants : td.variants;
    k.define(d, k.fn(["value"], (v) => k.match(v, td.variants.map((variant, j) => {
      const fields = (code.nodes[variant] as NodeOf<"variant">).fields;
      const each = fields.map((f) => meanings(fieldType((code.nodes[f] as NodeOf<"field">).type)));
      return { variant, names: fields.map((_, i) => `field ${i + 1}`), body: (xs: Id[]) => (fields.length ? k.call(into[j], ...xs.map((x, i) => (each[i] ? k.call(each[i]!, x) : x))) : k.x(into[j])) };
    }))));
    return d;
  };
  // Does a type's definition name a stored type in its fields, itself or
  // through another type that does (not through its parameters)?
  const holding = new Map<Id, boolean>();
  const holds = (id: Id): boolean => {
    if (holding.has(id)) return holding.get(id)!;
    holding.set(id, false);
    const td = code.nodes[(code.nodes[id] as NodeOf<"def">)?.body ?? ""];
    const names = (n: Id): boolean => {
      const x = code.nodes[n];
      if (x?.kind === "tref") return chosen.some((r) => r.of === x.target) || (x.target !== id && holds(x.target)) || x.args.some(names);
      if (x?.kind === "tfun") return [...x.params, x.result].some(names);
      return false;
    };
    const r = td?.kind === "typedef" && td.variants.some((v) => (code.nodes[v] as NodeOf<"variant">).fields.some((f) => names((code.nodes[f] as NodeOf<"field">).type)));
    holding.set(id, r);
    return r;
  };
  // The copy: the same cases and names, with each type that holds one
  // (itself too) replaced by its copy, so the stored types stay meanings.
  const shadows = new Map<Id, Id>();
  const shadow = (id: Id): Id => {
    if (shadows.has(id)) return shadows.get(id)!;
    const td = code.nodes[(code.nodes[id] as NodeOf<"def">).body!] as NodeOf<"typedef">;
    const ty = (n: Id, ps: Id[]): Id => {
      const x = code.nodes[n];
      if (x?.kind === "tref") {
        const p = td.params.indexOf(x.target);
        return k.tref(p >= 0 ? ps[p] : holds(x.target) ? shadow(x.target) : x.target, ...x.args.map((a) => ty(a, ps)));
      }
      if (x?.kind === "tfun") return k.tfun(x.params.map((a) => ty(a, ps)), ty(x.result, ps), x.effects);
      return n;
    };
    const made = k.type(names[id] ?? "copy", td.params.map((p) => names[p] ?? "a"), td.variants.map((v) =>
      [names[v] ?? "case", (code.nodes[v] as NodeOf<"variant">).fields.map((f) => [names[f] ?? "field", (self: Id, ps: Id[]) => (shadows.set(id, self), ty((code.nodes[f] as NodeOf<"field">).type, ps))] as [string, (self: Id, ps: Id[]) => Id])]));
    shadows.set(id, made.def);
    return made.def;
  };
  return meanings;
}

// A map's keys or a set's items that hold the type (a set of sets): the
// tree orders them by compare, which would see their shapes.
// The table's keys, wherever the program's own definitions name one, are
// Int or Text, which the table keeps as they are (a Float64's equal is
// near). A helper generic in the key is given maps made elsewhere, where
// their keys are named. Whether each map has one holder no longer decides
// it (C71): every version of a table stays a value (std.ts Table), so a
// map read again after a change is still right; one holder is what makes
// each change constant.
function inPlace(code: Code, info: Info, main: Id, defs: Id[], row: Representation): boolean {
  for (const id of defs.flatMap((d) => subtree(code, d))) {
    const t0 = info.typeOf.get(id);
    if (!t0) continue;
    const t = info.subst.zonk(t0);
    if (t.t === "con" && t.id === row.of) { const k = info.subst.zonk(t.args[0]); if (k.t !== "var" && (k.t !== "con" || (k.id !== INT && k.id !== STRING))) return false; }
  }
  return true;
}

function keyed(info: Info, defs: Id[], code: Code, of: Id): boolean {
  const has = (t: Type): boolean => t.t === "con" && (t.id === of || t.args.some((a) => has(info.subst.zonk(a))));
  const deep = (t: Type): boolean => {
    t = info.subst.zonk(t);
    if (t.t === "con") return (t.id === of && !!t.args[0] && has(info.subst.zonk(t.args[0]))) || t.args.some(deep);
    if (t.t === "fn") return [...t.params, t.ret].some(deep);
    return false;
  };
  return defs.some((d) => subtree(code, d).some((id) => { const t = info.typeOf.get(id); return !!t && deep(t); }));
}

// A stored value given to a definition where its type is a variable
// (`describe(x) = show(x)`, called with a set): what that definition does
// with it is decided for every type, so the rewrite above can't find its
// show by type, and it would see the tree's shape. Such a program keeps
// the definition. The representation's own jobs are replaced, so they
// don't count. Only a variable the definition looks at counts (C70,
// GAPS.md round 6 N1): one whose values reach show, equal or compare,
// there or in a definition it hands them to (`looked`). `map`, `first`,
// `keep` and `sort by` pass their items on unseen, so a map over pairs
// that hold a map keeps the trees.
function generic(info: Info, defs: Id[], code: Code, rep: Representation): boolean {
  // A list is in nearly every type's definition (a Set, a Map, a record
  // with a list field), so for List the types' definitions count too.
  const inside = rep.of === LIST ? holdsType(code, rep.of) : () => false;
  const has = (t: Type): boolean => { t = info.subst.zonk(t); return t.t === "con" ? t.id === rep.of || inside(t.id) || t.args.some(has) : t.t === "fn" ? [...t.params, t.ret].some(has) : false; };
  // Where the callee's own type has a variable, does the argument's type have the type?
  const open = (param: Type, arg: Type): boolean => {
    arg = info.subst.zonk(arg);
    if (param.t === "var") return has(arg);
    if (param.t === "con" && arg.t === "con") return param.args.some((p, i) => !!arg.args[i] && open(p, arg.args[i]));
    if (param.t === "fn" && arg.t === "fn") return param.params.some((p, i) => !!arg.params[i] && open(p, arg.params[i])) || open(param.ret, arg.ret);
    return false;
  };
  const looks = looked(code, info);
  // The callee's parameter type with only its looked-at variables left
  // variables (the others can't see the value).
  const seen = (t: Type, vs: Set<number>): Type => (t.t === "var" ? (vs.has(t.v) ? t : { t: "con", id: "", args: [] }) : t.t === "con" ? { ...t, args: t.args.map((x) => seen(x, vs)) } : t.t === "fn" ? { ...t, params: t.params.map((x) => seen(x, vs)), ret: seen(t.ret, vs) } : t);
  return defs.some((d) => subtree(code, d).some((id) => {
    const n = code.nodes[id];
    if (n.kind !== "call") return false;
    const f = code.nodes[n.fn];
    const scheme = f?.kind === "ref" && !(f.target in rep.impl) ? info.schemes.get(f.target) : undefined;
    if (scheme?.type.t !== "fn") return false;
    // A builtin is looked at as before; a definition, by what it looks at.
    const vs = code.nodes[(f as NodeOf<"ref">).target]?.kind === "def" ? looks((f as NodeOf<"ref">).target) : null;
    const params = scheme.type.params;
    return n.args.some((a, i) => !!params[i] && !!info.typeOf.get(a) && open(vs ? seen(params[i], vs) : params[i], info.typeOf.get(a)!));
  }));
}

// The variables of each definition's type (its scheme's) whose values it
// shows, compares or checks for equality, itself or through a definition
// or builtin it hands them to; for a builtin other than those three,
// every variable it is given (it isn't read). A library definition's body
// has variables of its own, read off its lambda paired with the scheme.
// The same reading as the compiler's copies per compared type (GAPS.md
// M4, compile.ts `compared`).
function looked(code: Code, info: Info): (def: Id) => Set<number> {
  const memo = new Map<Id, Set<number>>();
  const zonk = (t: Type) => info.subst.zonk(t);
  const varsOf = (t: Type, out: Set<number>): Set<number> => {
    t = zonk(t);
    if (t.t === "var") out.add(t.v);
    else if (t.t === "con") t.args.forEach((x) => varsOf(x, out));
    else if (t.t === "fn") { t.params.forEach((x) => varsOf(x, out)); varsOf(t.ret, out); }
    return out;
  };
  const LOOKS = new Set<Id>(Object.keys(BY_VALUE));
  const self = (def: Id): Set<number> => {
    if (memo.has(def)) return memo.get(def)!;
    const out = new Set<number>();
    memo.set(def, out);
    const sc = info.schemes.get(def), d = code.nodes[def];
    if (!sc || !sc.vars.length || d?.kind !== "def" || !d.body) return out;
    const toScheme = new Map<number, number>(sc.vars.map((v) => [v, v]));
    const pair = (a: Type, b: Type) => {
      b = zonk(b);
      if (a.t === "var") { if (b.t === "var") toScheme.set(b.v, a.v); return; }
      if (a.t === "con" && b.t === "con") a.args.forEach((x, i) => b.args[i] && pair(x, b.args[i]));
      if (a.t === "fn" && b.t === "fn") { a.params.forEach((x, i) => b.params[i] && pair(x, b.params[i])); pair(a.ret, b.ret); }
    };
    const bt = info.typeOf.get(d.body);
    if (bt) pair(sc.type, bt);
    const add = (vs: Set<number>) => { for (const v of vs) { const w = toScheme.get(v); if (w !== undefined && sc.vars.includes(w)) out.add(w); } };
    for (const x of subtree(code, def)) {
      const n = code.nodes[x];
      if (n.kind !== "ref" || n.target === def) continue;
      const at = info.typeOf.get(x);
      if (!at) continue;
      const target = code.nodes[n.target];
      // equal, show, compare, or a builtin we don't read: all it's given.
      if (target?.kind !== "def") {
        if (LOOKS.has(n.target) || (SIGS[n.target] && !PASSES_ON.has(n.target) && !STRUCTURAL.has(n.target))) { const t = zonk(at); if (t.t === "fn") t.params.forEach((p) => add(varsOf(p, new Set()))); }
        continue;
      }
      const g = self(n.target);
      if (!g.size) continue;
      const gs = info.schemes.get(n.target);
      if (!gs) continue;
      // The types the callee's looked-at variables stand for here.
      const bindVars = (a: Type, b: Type) => {
        b = zonk(b);
        if (a.t === "var") { if (g.has(a.v)) add(varsOf(b, new Set())); return; }
        if (a.t === "con" && b.t === "con") a.args.forEach((y, i) => b.args[i] && bindVars(y, b.args[i]));
        if (a.t === "fn" && b.t === "fn") { a.params.forEach((y, i) => b.params[i] && bindVars(y, b.params[i])); bindVars(a.ret, b.ret); }
      };
      bindVars(gs.type, at);
    }
    return out;
  };
  return self;
}

// Lists as arrays (C30d3b) or trees (C45): where the program's lists meet
// code the rewrite can't change. A builtin taking or giving a `List x` (x
// with no list in it) gets the row's meaning (`items of array`) around the
// argument and the way back around the answer (`array of`, or for another
// row a fold of the list by its own nil and cons, made here: `made`); one that only passes a value on (first, optional,
// all) can pass an array. Anything else that would see a list as an array
// keeps List as written: a builtin with a list deeper in a parameter
// (Cell (List a)), equal, show or compare on a list inside the library
// (the program's own are rewritten by type above), a relation run
// backwards (solve), or a definition the array's own jobs use, which the
// rewrite leaves as it is. Null when one is found; otherwise the nodes
// that put the boundary in.
const PASSES_ON = new Set<Id>([S.first, S.optional, S.all]);
// Builtins that only move values of a variable type about (C70).
const STRUCTURAL = new Set<Id>([S.oneOf, S.fail, ...Object.values(ARRAY_OPS)]);
function listBoundary(code: Code, info: Info, defs: Id[], rep: Representation): { nodes: Record<Id, Node>; reached: Id[]; made: Id[] } | null {
  const program = new Set(defs), inside = holdsType(code, LIST);
  const hasList = (t: Type): boolean => { t = info.subst.zonk(t); return t.t === "con" ? t.id === LIST || inside(t.id) || t.args.some(hasList) : t.t === "fn" ? [...t.params, t.ret].some(hasList) : false; };
  // A type the library defines with a list in it (Set and Map as written,
  // Algebra): its definition isn't the program's, so the rewrite leaves
  // its fields List while the values in them would be arrays.
  const libraryHolder = (t: Type): boolean => { t = info.subst.zonk(t); return t.t === "con" ? (t.id !== LIST && !program.has(t.id) && inside(t.id)) || t.args.some(libraryHolder) : t.t === "fn" ? [...t.params, t.ret].some(libraryHolder) : false; };
  // What the rewrite reaches (represent.ts), and what it keeps as it is.
  const own = new Set<Id>();
  for (const d of [...Object.values(rep.impl), rep.meaning!]) for (const x of [d, ...dependencies(code, d)]) own.add(x);
  const reached = new Set<Id>(), todo = [...defs];
  while (todo.length) {
    const d = todo.pop()!;
    if (reached.has(d) || rep.impl[d]) continue;
    const def = code.nodes[d];
    if (def?.kind !== "def" || (def.body && code.nodes[def.body]?.kind === "typedef")) continue;
    if (own.has(d)) return null;
    reached.add(d);
    for (const id of subtree(code, d)) { const n = code.nodes[id]; if (n.kind === "ref" && code.nodes[n.target]?.kind === "def") todo.push(n.target); }
  }
  const nodes: Record<Id, Node> = {}, made: Id[] = [];
  const call = (fn: Id, arg: Id): Id => { const r = freshId(), c = freshId(); nodes[r] = { id: r, kind: "ref", target: fn }; nodes[c] = { id: c, kind: "call", fn: r, args: [arg] }; return c; };
  let back: Id | undefined = rep.meaning === ARRAY_OPS.items ? ARRAY_OPS.of : undefined;
  const wayBack = (): Id => {
    if (back) return back;
    const k = new Lang(code), d = k.def("stored list");
    k.define(d, k.fn(["list"], (l) => k.fold(l, [
      { variant: NIL, names: [], body: () => k.x(rep.impl[NIL]) },
      { variant: CONS, names: ["item", "rest"], results: [null, "the rest stored"], body: ([x], [, r]) => k.call(rep.impl[CONS], x, r!) },
    ])));
    Object.assign(nodes, Object.fromEntries(Object.entries(k.code.nodes).filter(([id]) => !code.nodes[id])));
    made.push(d);
    return (back = d);
  };
  // `List x` with no list in x: the boundary can turn it into an array.
  const plainList = (p: Type, t: Type) => p.t === "con" && p.id === LIST && (t = info.subst.zonk(t)).t === "con" && t.id === LIST && !t.args.some(hasList);
  const calledBy = new Map<Id, NodeOf<"call">>();
  for (const d of reached) for (const id of subtree(code, d)) { const n = code.nodes[id]; if (n.kind === "call") calledBy.set(n.fn, n); }
  for (const d of reached) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if (n.kind === "solve") return null;
    const ty = info.typeOf.get(id);
    if (ty && libraryHolder(ty)) return null;
    const target = n.kind === "ref" ? n.target : null;
    if (!target || !SIGS[target] || code.nodes[target]?.kind === "def") continue;
    const at = info.typeOf.get(id);
    if (!at || !hasList(at)) continue;
    // A builtin with a list in its type: only called, by the rules above.
    const c = calledBy.get(id);
    if (!c) return null;
    if (target in BY_VALUE) { if (program.has(d)) continue; return null; }
    const passes = PASSES_ON.has(target);
    const sig = SIGS[target](new Subst());
    if (sig.t !== "fn") return null;
    const args = c.args.map((a, i) => {
      const t = info.typeOf.get(a);
      if (!t || !hasList(t)) return a;
      return plainList(sig.params[i], t) ? call(rep.meaning!, a) : passes ? a : null;
    });
    if (args.includes(null)) return null;
    const ret = info.typeOf.get(c.id);
    const changed = args.some((a, i) => a !== c.args[i]);
    if (ret && hasList(ret) && !(passes && !plainList(sig.ret, ret))) {
      if (!plainList(sig.ret, ret)) return null;
      // The call keeps its id, so its name and comments stay on it.
      const inner = freshId(), of = freshId();
      nodes[inner] = { ...c, id: inner, args: args as Id[] };
      nodes[of] = { id: of, kind: "ref", target: wayBack() };
      nodes[c.id] = { id: c.id, kind: "call", fn: of, args: [inner] };
    } else if (changed) nodes[c.id] = { ...c, args: args as Id[] };
  }
  return { nodes, reached: [...reached], made };
}

// Does a type's definition name `of` in its fields, itself or through
// another type that does?
function holdsType(code: Code, of: Id): (id: Id) => boolean {
  const memo = new Map<Id, boolean>();
  const holds = (id: Id): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, false);
    const td = code.nodes[(code.nodes[id] as NodeOf<"def"> | undefined)?.body ?? ""];
    const names = (n: Id): boolean => {
      const x = code.nodes[n];
      if (x?.kind === "tref") return x.target === of || holds(x.target) || x.args.some(names);
      if (x?.kind === "tfun") return [...x.params, x.result].some(names);
      return false;
    };
    const r = td?.kind === "typedef" && td.variants.some((v) => (code.nodes[v] as NodeOf<"variant">).fields.some((f) => names((code.nodes[f] as NodeOf<"field">).type)));
    memo.set(id, r);
    return r;
  };
  return holds;
}

// The part of the trees' module the rows use: their definitions (the
// checker reads a row's match from it), their jobs, and what those
// reach in the module.
function treesFor(code: Code, rows: Representation[]): Code {
  const all = merge(TREES.code, code);
  const keep = new Set<Id>();
  const roots = rows.flatMap((r) => [...(r.def ? [r.def] : []), ...Object.values(r.impl), ...(r.meaning ? [r.meaning] : []), ...Object.values(r.byType ?? {}), ...Object.values(r.heads ?? {})]);
  for (const d of roots) for (const x of [d, ...dependencies(all, d)]) if (TREES.code.nodes[x]) keep.add(x);
  const defs = TREES.code.defs.filter((d) => keep.has(d));
  const nodes: Record<Id, Node> = {};
  for (const d of defs) for (const id of subtree(TREES.code, d)) nodes[id] = TREES.code.nodes[id];
  return { nodes, defs };
}
