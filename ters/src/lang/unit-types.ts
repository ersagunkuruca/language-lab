// A definition's type with the units its signature shows (L252, known
// units only): `period : (Float64 m, Float64 m/s²) -[Choice]-> Float64 s`.
// A plain or unit-generic number stays `Float64`; a number type that is a
// variable shows its unit after it, `a u` (L252f). The checker's types
// carry no units (units.ts checks them beside it), so they are put in for
// showing: each Float64 input or result with a known unit is shown as a
// type named `Float64 m/s`.

import type { Code, Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import { NUMBER, schemeArith, schemeNeeds, showType, UNIT_ON, type Scheme, type Type } from "./types.ts";

// std.ts's tuples' ids, named here so this file doesn't load the library.
const TUPLE = /^std\.tuple\d+$/;
import { formatUnit, holeUnit, pinSlots, signatureUnits, type PinUnits, type SignatureUnits, type Slots } from "../units.ts";
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
  return units ? withSlots(t, units.slots, names) : null;
}

// A pinned scheme with the units a pin says (L252e), or a body makes
// where it breaks them: `rate is pinned to (Float64 u, Float64 v) ->
// Float64 u/v, and this makes it (Float64 u, Float64 v) -> Float64 u·v`.
export function showWithPinUnits(sc: Scheme, pu: PinUnits, names: Names): string {
  const t = sc.type, w = withSlots(t, pinSlots(pu, t.t === "fn" ? t.params.length : 0), names);
  return w ? showType(w.type, w.names, schemeArith(sc), [], schemeNeeds(sc), sc.effectsAt) : showType(t, names, schemeArith(sc), [], schemeNeeds(sc), sc.effectsAt);
}

// A hole's type with the unit it needs (QA 11-15 Q1): `Float64 u` in
// `rate(d, t) = □ / t` pinned at (Float64 u, Float64 v) -> Float64 u/v.
// Null where it needs no unit, or one nothing fixes.
export function holeWithUnit(code: Code, def: Id, hole: Id, t: Type, names: Names): { type: Type; names: Names } | null {
  if (t.t !== "var" && (t.t !== "con" || t.id !== NUMBER || t.args.length)) return null;
  const u = holeUnit(code, def, hole);
  return u && Object.keys(u).length ? withSlots(t, { params: [], result: { "": u } }, names) : null;
}

function withSlots(t: Type, slots: SignatureUnits["slots"], names: Names): { type: Type; names: Names } | null {
  if (![slots.result, ...slots.params].some((s) => Object.keys(s).length)) return null;
  const shown: Names = { ...names };
  // A number's unit is its slot's; a type's arguments have the slots after
  // their parameter's (L252d, L252e): List (Float64 m), the list's own;
  // Map Int (Float64 s), "1"; a tuple's parts, (Int, Float64 s), are
  // bracketed only as an argument to a named type.
  const at = (x: Type, s: Slots, path: number[], inside: boolean): Type => {
    // A number type that is generic shows its unit after it (L252f):
    // `squared : (a u) -> a u²`, `split : a s`.
    if (x.t === "var") { const u = s[slotKey(path)]; return u && Object.keys(u).length ? { t: "con", id: `${UNIT_ON}${formatUnit(u)}`, args: [x] } : x; }
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
