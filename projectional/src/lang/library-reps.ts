// Library representations chosen without the program asking (BACKLOG C47,
// C48; DATA-STRUCTURES.md step 2). A program that uses std's Map or Set
// gets the representation the chooser picks from the costs of the jobs it
// uses: the sorted entries or items as defined, or the library's
// weight-balanced tree (LIBRARY.reps, from the trees module, C51). A
// representations.json row for the type (lab, #97) still wins.
//
// A tree isn't a canonical spelling, so equal, show and compare on one
// are its row's `byType`, which go through its meaning (the sorted list).
// Where the type sits inside another value (a list of maps, a pair of
// sets, a map's values, main's answer) they are given the value with each
// tree inside it turned into its meaning, by a definition made for that
// type (C52). A map's keys or a set's items that hold one would be ordered
// by the tree's shape, so such a program keeps the definition.

import { freshId, merge, subtree, type Code, type Id, type Node, type NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import { Lang } from "./dsl.ts";
import { LIBRARY, TREES } from "./library.ts";
import { choose, represent, uses, type Representation } from "./represent.ts";
import { COMPARE, LIST, MAP, MAP_V, PAIR_V, S, SHOW_ANY } from "./std.ts";
import type { Type } from "./types.ts";

// What equal, show and compare see of a value: these, given a stored one,
// are its row's (byType), which go through its meaning.
const BY_VALUE: Record<Id, "equal" | "show" | "compare"> = { [S.equal]: "equal", [SHOW_ANY]: "show", [COMPARE]: "compare" };

// `insiders`: the representations' definitions, which may call the
// private constructors they represent (infer.ts Options). The library's
// own are insiders already (load.ts checkOptions).
export interface Chosen { code: Code; names: Names; chosen: string[]; insiders: Id[] }

// `defs`: the program's own definitions, which the rewrite changes;
// `asked`: rows from a representations.json, whose types are left alone.
export function withLibraryRepresentations(code: Code, info: Info, names: Names, main: Id, defs: Id[], asked: Representation[] = []): Chosen {
  const chosen: Representation[] = [];
  for (const tree of LIBRARY.reps.filter((r) => r.byType)) {
    const spec = LIBRARY.reps.find((r) => r.of === tree.of && r.canonical)!;
    if (asked.some((r) => r.of === tree.of)) continue;
    if (!uses(code, main, [spec, tree]).length || choose(code, main, [spec, tree]).rep !== tree || keyed(info, defs, code, tree.of) || generic(info, defs, code, tree)) continue;
    chosen.push(tree);
  }
  if (!chosen.length) return { code, names, chosen: [], insiders: [] };
  // The trees' module, which the library leaves out (library.ts).
  code = merge(TREES.code, code);
  names = { ...TREES.names, ...names };
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
  let own = defs;
  if (answer) {
    const def = nodes[main] as NodeOf<"def">, inner = k.def(`${names[main] ?? "main"} as stored`);
    const body = code.nodes[def.body!];
    k.code.nodes[inner] = { ...(k.code.nodes[inner] as NodeOf<"def">), body: def.body };
    nodes[main] = { ...def, body: body?.kind === "lambda"
      ? k.fn(body.params.map((p) => names[p] ?? "x"), (...xs) => k.call(answer, k.call(inner, ...xs)))
      : k.call(answer, k.x(inner)) };
    own = [...defs, inner];
  }
  const made = k.code.defs.filter((d) => !code.nodes[d]);
  const all = { nodes: { ...k.code.nodes, ...nodes }, defs: [...code.defs, ...made] };
  const out = chosen.reduce((c, rep) => represent(c, own, rep, made), all);
  return { code: out, names: { ...names, ...k.names }, chosen: chosen.map((r) => `${names[r.of] ?? LIBRARY.names[r.of]} as ${r.name}`), insiders: made };
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
// don't count.
function generic(info: Info, defs: Id[], code: Code, rep: Representation): boolean {
  const has = (t: Type): boolean => { t = info.subst.zonk(t); return t.t === "con" ? t.id === rep.of || t.args.some(has) : t.t === "fn" ? [...t.params, t.ret].some(has) : false; };
  // Where the callee's own type has a variable, does the argument's type have the type?
  const open = (param: Type, arg: Type): boolean => {
    arg = info.subst.zonk(arg);
    if (param.t === "var") return has(arg);
    if (param.t === "con" && arg.t === "con") return param.args.some((p, i) => !!arg.args[i] && open(p, arg.args[i]));
    if (param.t === "fn" && arg.t === "fn") return param.params.some((p, i) => !!arg.params[i] && open(p, arg.params[i])) || open(param.ret, arg.ret);
    return false;
  };
  return defs.some((d) => subtree(code, d).some((id) => {
    const n = code.nodes[id];
    if (n.kind !== "call") return false;
    const f = code.nodes[n.fn];
    const scheme = f?.kind === "ref" && !(f.target in rep.impl) ? info.schemes.get(f.target) : undefined;
    if (scheme?.type.t !== "fn") return false;
    const params = scheme.type.params;
    return n.args.some((a, i) => !!params[i] && !!info.typeOf.get(a) && open(params[i], info.typeOf.get(a)!));
  }));
}
