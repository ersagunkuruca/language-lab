// A program's own values to and from Json (BACKLOG L190d2), written out per
// type as ordinary definitions before anything runs.
//
// `json of(value)` is the Json a value spells and `from json(json)` the
// value of the type wanted where it is used, with no answer when the Json
// has another shape. The type decides the spelling, as serde's derived
// Serialize and Deserialize do (externally tagged, its default):
//   Float64, Int        a number (an Int read back must be whole)
//   Text, Bool          a string, true or false
//   Json                itself
//   List a              a list; a tuple a list of its parts
//   Optional a          null for none, the value for some
//   a record            an object, a field per field, in order
//   several cases       a case with no fields its name as a string, a
//                       case with fields {"name": {its fields}}
// A field missing from an object reads as null, so an Optional field may
// be left out. Fields the type doesn't have are passed over.
// Both types must be known where it is used; a function, a type with
// private cases (a Map, a Set, Bytes) or an effect has no spelling, and the
// checker says so (infer.ts, `jsonProblem` below).
//
// Like fields-by-type.ts, each use is pointed at a generated definition
// for its type, one per type and direction, so the evaluator, relate.ts and
// every compiler target see ordinary matches: nothing looks at types at
// run time.
//
// Prior art: serde's derive (David Tolnay, Erick Tryzelaar), Haskell
// aeson's generic ToJSON/FromJSON; CREDITS.md.

import { nodesWhere, isCall, type Code, type Id, type NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { Lang } from "./dsl.ts";
import { infer, type Info } from "./infer.ts";
import { BOOL, CONS, FALSE, INT_OPS, JSON_OPS, JSON_TYPE, JSON_V, LIST, NIL, NONE, OPTIONAL, PAIR_V, S, SOME, TRUE } from "./std.ts";
import { INT, NUMBER, STRING, type Type } from "./types.ts";

const OPS = new Set<Id>([JSON_OPS.of, JSON_OPS.from]);
export const usesJsonByType = (code: Code) => nodesWhere(code, "json by type", (n) => n.kind === "ref" && OPS.has(n.target)).length > 0;

const isTuple = (id: Id) => /^std\.tuple\d+$/.test(id);
type Data = { variants: NodeOf<"variant">[]; env: Map<Id, Type> };

// A data type's cases, with its parameters bound to the type's arguments.
function dataOf(code: Code, t: Type & { t: "con" }): Data | string {
  const d = code.nodes[t.id], td = d?.kind === "def" && d.body ? code.nodes[d.body] : undefined;
  if (td?.kind !== "typedef") return "has no cases to spell";
  if (td.effect || td.interface) return td.effect ? "is an effect" : "is an interface";
  const variants = td.variants.map((v) => code.nodes[v] as NodeOf<"variant">);
  if (variants.some((v) => v.private)) return "keeps its cases to its library";
  return { variants, env: new Map(td.params.map((p, i) => [p, t.args[i]])) };
}

// A field's type, from what it is written as and the type's arguments;
// null for a function.
function fieldType(code: Code, field: Id, env: Map<Id, Type>): Type | null {
  const f = code.nodes[field];
  const go = (id: Id): Type | null => {
    const n = code.nodes[id];
    if (n?.kind !== "tref") return null;
    const p = env.get(n.target);
    if (p) return p;
    const args = n.args.map(go);
    return args.every((a) => a) ? { t: "con", id: n.target, args: args as Type[] } : null;
  };
  return f?.kind === "field" ? go(f.type) : null;
}

// Why a type has no Json spelling, or null when it has one.
export function jsonProblem(code: Code, t: Type | undefined, show: (t: Type) => string, seen = new Set<string>()): string | null {
  if (!t || t.t === "var") return "its type isn't known here";
  if (t.t !== "con") return `${show(t)} is a function`;
  if (t.id === NUMBER || t.id === INT || t.id === STRING || t.id === BOOL || t.id === JSON_TYPE) return null;
  const key = JSON.stringify(t);
  if (seen.has(key)) return null;
  seen.add(key);
  if (t.id === LIST || t.id === OPTIONAL || isTuple(t.id)) {
    for (const a of t.args) { const p = jsonProblem(code, a, show, seen); if (p) return p; }
    return null;
  }
  const data = dataOf(code, t);
  if (typeof data === "string") return `${show(t)} ${data}`;
  for (const v of data.variants) for (const f of v.fields) {
    const ft = fieldType(code, f, data.env);
    const p = ft ? jsonProblem(code, ft, show, seen) : `a field of ${show(t)} holds a function`;
    if (p) return p;
  }
  return null;
}

export function jsonByType(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  if (!usesJsonByType(code)) return { code, info, names };
  const k = new Lang(code);
  const made = new Map<string, Id>();
  const at = (id: Id) => { const t = info.typeOf.get(id); return t && info.subst.zonk(t); };
  const nm = (id: Id) => names[id] ?? id;
  const pair = (a: Id, b: Id) => k.call(PAIR_V, a, b);
  // The value of a field named `name` among an object's fields, or null.
  let lookup: Id | null = null;
  const fieldIn = (fields: Id, name: string) => {
    if (!lookup) {
      lookup = k.def("json field or null");
      k.define(lookup, k.fn(["fields", "name"], (fs, n) => k.match(fs, [
        { variant: NIL, names: [], body: () => k.x(JSON_V.null) },
        { variant: CONS, names: ["field", "rest"], body: ([f, r]) => k.match(f, [{ variant: PAIR_V, names: ["name", "value"], body: ([fn, v]) => k.if(k.equal(fn, n), v, k.call(lookup!, r, n)) }]) },
      ])));
    }
    return k.call(lookup, fields, k.lit(name));
  };
  // A list's items each through f (writing) or each read (a Choice).
  const listed = (name: string, each: Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["items"], (xs) => k.match(xs, [
      { variant: NIL, names: [], body: () => k.x(NIL) },
      { variant: CONS, names: ["item", "rest"], body: ([x, r]) => k.call(CONS, k.call(each, x), k.call(d, r)) },
    ])));
    return d;
  };
  const fail = () => k.call(S.fail);
  const fieldsOf = (v: NodeOf<"variant">, env: Map<Id, Type>) => v.fields.map((f) => ({ name: nm(f), type: fieldType(code, f, env)! }));

  // The definition writing a value of type t as Json.
  const writer = (t: Type & { t: "con" }): Id => {
    const key = `of ${JSON.stringify(t)}`;
    const had = made.get(key);
    if (had) return had;
    const d = k.def(`json of ${showT(t)}`);
    made.set(key, d);
    const sub = (x: Type) => writer(x as Type & { t: "con" });
    const body = (v: Id): Id => {
      if (t.id === NUMBER) return k.call(JSON_V.number, v);
      if (t.id === INT) return k.call(JSON_V.number, k.call(INT_OPS.toNumber, v));
      if (t.id === STRING) return k.call(JSON_V.text, v);
      if (t.id === BOOL) return k.call(JSON_V.bool, v);
      if (t.id === JSON_TYPE) return v;
      if (t.id === LIST) return k.call(JSON_V.list, k.call(listed(`json items of ${showT(t)}`, sub(t.args[0])), v));
      if (t.id === OPTIONAL) return k.match(v, [{ variant: NONE, names: [], body: () => k.x(JSON_V.null) }, { variant: SOME, names: ["value"], body: ([x]) => k.call(sub(t.args[0]), x) }]);
      const data = dataOf(code, t) as Data;
      const one = data.variants.length === 1 && !isTuple(t.id);
      return k.match(v, data.variants.map((variant) => {
        const fs = fieldsOf(variant, data.env);
        return {
          variant: variant.id, names: fs.map((f) => f.name),
          body: (binds: Id[]) => {
            if (isTuple(t.id)) return k.call(JSON_V.list, k.listOf(...binds.map((b, i) => k.call(sub(fs[i].type), b))));
            const object = () => k.call(JSON_V.object, k.listOf(...binds.map((b, i) => pair(k.lit(fs[i].name), k.call(sub(fs[i].type), b)))));
            if (one) return object();
            return fs.length ? k.call(JSON_V.object, k.listOf(pair(k.lit(nm(variant.id)), object()))) : k.call(JSON_V.text, k.lit(nm(variant.id)));
          },
        };
      }));
    };
    k.define(d, k.fn(["value"], body));
    return d;
  };

  // The definition reading a value of type t from Json, no answer for
  // another shape.
  const reader = (t: Type & { t: "con" }): Id => {
    const key = `from ${JSON.stringify(t)}`;
    const had = made.get(key);
    if (had) return had;
    const d = k.def(`from json at ${showT(t)}`);
    made.set(key, d);
    const sub = (x: Type) => reader(x as Type & { t: "con" });
    const as = (j: Id, variant: Id, f: (x: Id) => Id) => k.match(j, [{ variant, names: ["value"], body: ([x]) => f(x) }], fail());
    const body = (j: Id): Id => {
      if (t.id === NUMBER) return as(j, JSON_V.number, (x) => x);
      if (t.id === INT) return as(j, JSON_V.number, (x) => k.let("whole", k.call(INT_OPS.wholePart, x), (n) => k.if(k.equal(k.call(INT_OPS.toNumber, n), x), n, fail())));
      if (t.id === STRING) return as(j, JSON_V.text, (x) => x);
      if (t.id === BOOL) return as(j, JSON_V.bool, (x) => x);
      if (t.id === JSON_TYPE) return j;
      if (t.id === LIST) return as(j, JSON_V.list, (xs) => k.call(listed(`items from json at ${showT(t)}`, sub(t.args[0])), xs));
      if (t.id === OPTIONAL) return k.match(j, [{ variant: JSON_V.null, names: [], body: () => k.x(NONE) }], k.call(SOME, k.call(sub(t.args[0]), j)));
      const data = dataOf(code, t) as Data;
      // A case's fields read from an object's fields, by name.
      const built = (variant: NodeOf<"variant">, fields: Id) => {
        const fs = fieldsOf(variant, data.env);
        return fs.length ? k.call(variant.id, ...fs.map((f) => k.call(sub(f.type), fieldIn(fields, f.name)))) : k.x(variant.id);
      };
      if (isTuple(t.id)) {
        const variant = data.variants[0], fs = fieldsOf(variant, data.env);
        const items = (xs: Id, i: number, got: Id[]): Id => i === fs.length
          ? k.match(xs, [{ variant: NIL, names: [], body: () => k.call(variant.id, ...got) }], fail())
          : k.match(xs, [{ variant: CONS, names: ["item", "rest"], body: ([x, r]) => k.let(fs[i].name, k.call(sub(fs[i].type), x), (b) => items(r, i + 1, [...got, b])) }], fail());
        return as(j, JSON_V.list, (xs) => items(xs, 0, []));
      }
      if (data.variants.length === 1) return as(j, JSON_V.object, (fields) => built(data.variants[0], fields));
      const bare = data.variants.filter((v) => !v.fields.length), full = data.variants.filter((v) => v.fields.length);
      const byName = (name: Id, vs: NodeOf<"variant">[], then: (v: NodeOf<"variant">) => Id) => vs.reduceRight<Id>((rest, v) => k.if(k.equal(name, k.lit(nm(v.id))), then(v), rest), fail());
      return k.match(j, [
        { variant: JSON_V.text, names: ["name"], body: ([n]) => byName(n, bare, (v) => k.x(v.id)) },
        { variant: JSON_V.object, names: ["fields"], body: ([fs]) => k.match(fs, [{ variant: CONS, names: ["field", "rest"], body: ([f, r]) => k.match(r, [{ variant: NIL, names: [], body: () =>
          k.match(f, [{ variant: PAIR_V, names: ["name", "value"], body: ([n, inner]) => byName(n, full, (v) => as(inner, JSON_V.object, (fields) => built(v, fields))) }]) }], fail()) }], fail()) },
      ], fail());
    };
    k.define(d, k.fn(["json"], body));
    return d;
  };
  const showT = (t: Type): string => t.t === "con" ? [nm(t.id), ...t.args.map((a) => a.t === "con" && a.args.length ? `(${showT(a)})` : showT(a))].join(" ") : "?";

  const nodes = { ...code.nodes };
  let changed = false;
  for (const n of Object.values(code.nodes)) {
    if (!isCall(n) || n.args.length !== 1) continue;
    const f = code.nodes[n.fn];
    if (f?.kind !== "ref" || !OPS.has(f.target)) continue;
    const t = f.target === JSON_OPS.of ? at(n.args[0]) : at(n.id);
    if (!t || t.t !== "con" || jsonProblem(code, t, showT)) continue;
    const d = f.target === JSON_OPS.of ? writer(t) : reader(t);
    nodes[n.fn] = { id: n.fn, kind: "ref", target: d };
    changed = true;
  }
  if (!changed) return { code, info, names };
  const next: Code = { ...code, nodes: { ...nodes, ...k.code.nodes }, defs: [...code.defs, ...k.code.defs] };
  const out = { ...names, ...k.names };
  return { code: next, info: infer(next, out, undefined, info.options), names: out };
}
