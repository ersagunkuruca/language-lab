// A definition's type with the units its signature shows (L252, known
// units only): `period : (Float64 m, Float64 m/s²) -[Choice]-> Float64 s`.
// A plain or unit-generic number stays `Float64`. The checker's types
// carry no units (units.ts checks them beside it), so they are put in for
// showing: each Float64 input or result with a known unit is shown as a
// type named `Float64 m/s`.

import type { Code, Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import { NUMBER, showType, type Type } from "./types.ts";

// std.ts's tuples' ids, named here so this file doesn't load the library.
const TUPLE = /^std\.tuple\d+$/;
import { formatUnit, signatureUnits, type Slots } from "../units.ts";
// A slot's key: the path without the zeros it ends in (units.ts).
const slotKey = (p: number[]) => { let n = p.length; while (n && p[n - 1] === 0) n--; return p.slice(0, n).join("."); };

export function showTypeWithUnits(code: Code, def: Id, t: Type, names: Names): string {
  const w = withUnits(code, def, t, names);
  return w ? showType(w.type, w.names) : showType(t, names);
}

// The type with its known units put in, and the names that show them; null
// where it shows none. `t` is the definition's type, resolved.
export function withUnits(code: Code, def: Id, t: Type, names: Names): { type: Type; names: Names } | null {
  const units = signatureUnits(code, def);
  if (!units) return null;
  const { slots } = units;
  if (![slots.result, ...slots.params].some((s) => Object.keys(s).length)) return null;
  const shown: Names = { ...names };
  // A number's unit is its slot's; a type's arguments have the slots after
  // their parameter's (L252d, L252e): List (Float64 m), the list's own;
  // Map Int (Float64 s), "1"; a tuple's parts, (Int, Float64 s), are
  // bracketed only as an argument to a named type.
  const at = (x: Type, s: Slots, path: number[], inside: boolean): Type => {
    if (x.t !== "con") return x;
    if (x.id === NUMBER && !x.args.length) {
      const u = s[slotKey(path)];
      if (!u) return x;
      const id = `${NUMBER} ${formatUnit(u)}${inside ? " (inside)" : ""}`;
      shown[id] = inside ? `(${names[NUMBER] ?? "Float64"} ${formatUnit(u)})` : `${names[NUMBER] ?? "Float64"} ${formatUnit(u)}`;
      return { t: "con", id, args: [] };
    }
    if (!x.args.length || path.length >= 3) return x;
    const tuple = TUPLE.test(x.id);
    return { ...x, args: x.args.map((a, j) => at(a, s, [...path, j], !tuple)) };
  };
  return { type: t.t === "fn" ? { ...t, params: t.params.map((p, i) => at(p, slots.params[i] ?? {}, [], false)), ret: at(t.ret, slots.result, [], false) } : at(t, slots.result, [], false), names: shown };
}
