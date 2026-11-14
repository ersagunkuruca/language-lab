// A definition's type with the units its signature shows (L252, known
// units only): `period : (Float64 m, Float64 m/s²) -[Choice]-> Float64 s`.
// A plain or unit-generic number stays `Float64`. The checker's types
// carry no units (units.ts checks them beside it), so they are put in for
// showing: each Float64 input or result with a known unit is shown as a
// type named `Float64 m/s`.

import type { Code, Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import { NUMBER, showType, type Type } from "./types.ts";

// std.ts LIST's id, named here so this file doesn't load the library.
const LIST_ID = "std.list";
import { formatUnit, signatureUnits, type Unit } from "../units.ts";

export function showTypeWithUnits(code: Code, def: Id, t: Type, names: Names): string {
  const w = withUnits(code, def, t, names);
  return w ? showType(w.type, w.names) : showType(t, names);
}

// The type with its known units put in, and the names that show them; null
// where it shows none. `t` is the definition's type, resolved.
export function withUnits(code: Code, def: Id, t: Type, names: Names): { type: Type; names: Names } | null {
  const units = signatureUnits(code, def);
  if (!units || (!units.result && !units.params.some(Boolean))) return null;
  const shown: Names = { ...names };
  const at = (x: Type, u: Unit | undefined, inside = false): Type => {
    // A list's unit is its items' (L252d): List (Float64 m), bracketed as
    // a type given to another is.
    if (u && x.t === "con" && x.id === LIST_ID && x.args.length === 1) return { ...x, args: [at(x.args[0], u, true)] };
    if (!u || x.t !== "con" || x.id !== NUMBER || x.args.length) return x;
    const id = `${NUMBER} ${formatUnit(u)}${inside ? " (inside)" : ""}`;
    shown[id] = inside ? `(${names[NUMBER] ?? "Float64"} ${formatUnit(u)})` : `${names[NUMBER] ?? "Float64"} ${formatUnit(u)}`;
    return { t: "con", id, args: [] };
  };
  return { type: t.t === "fn" ? { ...t, params: t.params.map((p, i) => at(p, units.params[i])), ret: at(t.ret, units.result) } : at(t, units.result), names: shown };
}
