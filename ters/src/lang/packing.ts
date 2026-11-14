// A data type whose case packs a value of any type with the interfaces it
// has (L256, INTERFACES.md step 6): `device(it: a) where a has Appliance`.
// The case's own variable a is fresh at each `device(x)`, which needs x's
// type to have Appliance, and the type itself then has Appliance: its
// operations on a Device are the packed value's own. Before anything runs,
// packs.ts writes such a type as the record of closures it is (an
// existential as an object: Pierce, TAPL ch. 24; Läufer 1996).

import type { Code, Id, NodeOf } from "../model.ts";

export interface Packing {
  def: Id;
  variant: Id;
  field: Id;
  param: Id;
  // Each interface the packed value has, with the `has` node saying so.
  has: { iface: Id; at: Id }[];
}

const typedef = (code: Code, def: Id) => {
  const d = code.nodes[def];
  const b = d?.kind === "def" && d.body ? code.nodes[d.body] : undefined;
  return b?.kind === "typedef" ? b : undefined;
};

// The data type's packing case, when it has one: its own variable and
// what it has. Whether the type is written as packing allows (one case,
// one field of that variable) is packingProblem's to say.
export function packingOf(code: Code, def: Id): Packing | null {
  const td = typedef(code, def);
  if (!td || td.effect || td.interface || td.variants.length !== 1) return null;
  const v = code.nodes[td.variants[0]] as NodeOf<"variant"> | undefined;
  if (!v?.params?.length || v.fields.length !== 1) return null;
  const has = (v.has ?? []).flatMap((h) => { const t = code.nodes[h]; return t?.kind === "tref" ? [{ iface: t.target, at: h }] : []; });
  return { def, variant: v.id, field: v.fields[0], param: v.params[0], has };
}

export const packs = (code: Code, def: Id, iface: Id) => !!packingOf(code, def)?.has.some((h) => h.iface === iface);

// What is wrong with a data type's own variables, or undefined: a case
// with its own variables packs one value, of one of them, with what it has;
// and each operation of what it has can be run on the packed value alone,
// with its other inputs (Rust's object safety).
export function packingProblem(code: Code, def: Id, nm: (id: Id) => string): { at: Id; message: string } | undefined {
  const td = typedef(code, def);
  if (!td || td.effect || td.interface) return;
  for (const vid of td.variants) {
    const v = code.nodes[vid] as NodeOf<"variant">;
    if (!v.params?.length && !v.has?.length) continue;
    const say = `${nm(vid)} packs a value of any type with what it has`;
    if (td.variants.length !== 1 || td.params.length) return { at: vid, message: `${say}, so it is its type's one case and the type takes no types of its own` };
    if (v.params?.length !== 1) return { at: vid, message: `${say}: one type of its own, a` };
    const f = code.nodes[v.fields[0] ?? ""] as NodeOf<"field"> | undefined, ft = f && code.nodes[f.type];
    if (v.fields.length !== 1 || ft?.kind !== "tref" || ft.target !== v.params[0]) return { at: vid, message: `${say}: one field, of its own type ${nm(v.params[0])}` };
    if (!v.has?.length) return { at: vid, message: `${say}, and ${nm(v.params[0])} has nothing yet, so the value could never be used: say what it has, where ${nm(v.params[0])} has an interface` };
    for (const h of v.has) {
      const t = code.nodes[h];
      const iface = t?.kind === "tref" ? typedef(code, t.target) : undefined;
      if (t?.kind !== "tref" || !iface?.interface || t.args.length !== 1 || (code.nodes[t.args[0]] as NodeOf<"tref"> | undefined)?.target !== v.params[0]) return { at: h, message: `${say}: what it has is an interface at ${nm(v.params[0])}` };
      const a = iface.params[0];
      const mentions = (id: Id): boolean => { const n = code.nodes[id]; return n?.kind === "tref" ? n.target === a || n.args.some(mentions) : n?.kind === "tfun" ? n.params.some(mentions) || mentions(n.result) : false; };
      for (const op of (code.nodes[iface.variants[0]] as NodeOf<"variant">).fields) {
        const ot = code.nodes[(code.nodes[op] as NodeOf<"field">).type];
        if (ot?.kind !== "tfun") continue;
        const first = code.nodes[ot.params[0] ?? ""];
        const self = first?.kind === "tref" && first.target === a && !first.args.length;
        const res = code.nodes[ot.result];
        const resultOk = !mentions(ot.result) || (res?.kind === "tref" && res.target === a && !res.args.length);
        if (!self || ot.params.slice(1).some(mentions) || !resultOk || ot.ports) return { at: h, message: `${nm(t.target)}'s ${nm(op)} can't be run on a packed value: an operation a packed value does takes it first and no other ${nm(a)}, and gives back ${nm(a)} itself or no ${nm(a)} at all` };
      }
    }
  }
  return;
}
