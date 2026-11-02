// A data type's fields picked by their type (BACKLOG L162b, GAPS round 9
// MG1), written out as an ordinary match before anything runs.
//
// `fields mapped(value, f)` is value with every field of its case whose
// type is f's input given to f; `fields listed(value)` is those fields, in
// order, as a list. Which fields those are is known from the types where
// they are used: machine's `args mapped(instr, f)` on an `Instr` of 21
// cases is `fields mapped(instr, f)` with f : (Arg) -> Arg, and each case's
// Arg fields go through f. This code → code pass gives each such call a
// generated definition for its two types, one arm per case, so the
// evaluator, relate.ts and every compiler target see an ordinary match:
// nothing looks at types at run time. The fields picked are the ones
// declared with that type (a field written `Arg`), one level deep: a field
// holding a List Arg, or one typed by a parameter of the type, is kept as
// it is. Both types must be known where the call is (a definition generic
// in them has no single match to write; the checker says so, infer.ts).
//
// Prior art: Haskell's `deriving Functor`/`Traversable` and "Scrap your
// boilerplate" (Ralf Lämmel and Simon Peyton Jones, TLDI 2003), whose
// gmapT with mkT maps the immediate subterms of one type; here the
// generic step is written out per type once, as GHC's deriving does.

import type { Code, Id, Node } from "../model.ts";
import { freshId } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info } from "./infer.ts";
import { CONS, FIELDS, NIL } from "./std.ts";
import type { Type } from "./types.ts";

type Bare = Node extends infer N ? (N extends Node ? Omit<N, "id"> : never) : never;
const OPS = new Set<Id>([FIELDS.mapped, FIELDS.listed]);

export const usesFieldsByType = (code: Code) => Object.values(code.nodes).some((n) => n.kind === "ref" && OPS.has(n.target));

// The data type a type is, with its cases, or null.
function cases(code: Code, t: Type | undefined): { id: Id; variants: Id[] } | null {
  if (!t || t.t !== "con") return null;
  const d = code.nodes[t.id], body = d?.kind === "def" && d.body ? code.nodes[d.body] : undefined;
  return body?.kind === "typedef" && !body.effect && !body.interface ? { id: t.id, variants: body.variants } : null;
}

// The two types a call of one of the ops is at: the value's, and the
// picked fields'. Null while either is open.
function typesAt(code: Code, info: Info, call: Id): { whole: Type; part: Type } | null {
  const n = code.nodes[call];
  if (n?.kind !== "call" || n.args.length !== (code.nodes[n.fn]?.kind === "ref" && (code.nodes[n.fn] as { target: Id }).target === FIELDS.mapped ? 2 : 1)) return null;
  const at = (id: Id) => { const t = info.typeOf.get(id); return t && info.subst.zonk(t); };
  const whole = at(n.args[0]);
  const target = (code.nodes[n.fn] as { target: Id }).target;
  const f = target === FIELDS.mapped ? at(n.args[1]) : undefined;
  const result = target === FIELDS.listed ? at(call) : undefined;
  const part = f?.t === "fn" ? f.params[0] : result?.t === "con" ? result.args[0] : undefined;
  if (!whole || whole.t !== "con" || !part || part.t !== "con") return null;
  return { whole, part };
}

export function fieldsByType(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  if (!usesFieldsByType(code)) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const defs = [...code.defs];
  const out: Names = { ...names };
  const add = (n: Bare): Id => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; };
  const ref = (target: Id) => add({ kind: "ref", target });
  const made = new Map<string, Id>();
  let changed = false;
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "call") continue;
    const fnNode = code.nodes[n.fn];
    if (fnNode?.kind !== "ref" || !OPS.has(fnNode.target)) continue;
    const at = typesAt(code, info, n.id);
    const data = at && cases(code, at.whole);
    if (!at || !data || at.part.t !== "con") continue;
    const part = at.part.id, mapping = fnNode.target === FIELDS.mapped;
    const key = `${mapping ? "mapped" : "listed"} ${data.id} ${part}`;
    let def = made.get(key);
    if (!def) {
      // A field is picked when it is declared with the part's type.
      const picked = (field: Id) => {
        const f = code.nodes[field], t = f?.kind === "field" ? code.nodes[f.type] : undefined;
        return t?.kind === "tref" && t.target === part;
      };
      const value = add({ kind: "binder" }), g = mapping ? add({ kind: "binder" }) : null;
      const arms = data.variants.map((v) => {
        const vn = code.nodes[v];
        const fields = vn?.kind === "variant" ? vn.fields : [];
        const binds = fields.map((f) => { const b = add({ kind: "binder" }); const nm = names[f]; if (nm) out[b] = nm; return b; });
        const body = mapping
          ? (fields.length ? add({ kind: "call", fn: ref(v), args: fields.map((f, i) => (picked(f) ? add({ kind: "call", fn: ref(g!), args: [ref(binds[i])] }) : ref(binds[i]))) }) : ref(v))
          : fields.reduceRight<Id>((rest, f, i) => (picked(f) ? add({ kind: "call", fn: ref(CONS), args: [ref(binds[i]), rest] }) : rest), ref(NIL));
        return add({ kind: "arm", variant: v, binds, results: binds.map(() => null), body });
      });
      const match = add({ kind: "match", scrutinee: ref(value), arms, otherwise: null });
      const lambda = add({ kind: "lambda", params: g ? [value, g] : [value], body: match });
      def = add({ kind: "def", body: lambda });
      defs.push(def);
      made.set(key, def);
      out[value] = "value";
      if (g) out[g] = "f";
      out[def] = `fields ${mapping ? "mapped" : "listed"} at ${names[data.id] ?? data.id} ${names[part] ?? part}`;
    }
    nodes[n.fn] = { id: n.fn, kind: "ref", target: def };
    changed = true;
  }
  if (!changed) return { code, info, names };
  const next: Code = { ...code, nodes, defs };
  return { code: next, info: infer(next, out, undefined, info.options), names: out };
}
