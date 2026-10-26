// Types and effect rows, and unification over them.
//
// A function type carries the effects calling it may perform, as a row: a set
// of effect ids plus, optionally, a row variable standing for "whatever else
// the caller is doing". That tail is what lets `map` be pure when its
// function is pure and print when its function prints, without monads.

import type { Id } from "../model.ts";
import type { Names } from "../presentation.ts";

export type Type =
  | { t: "var"; v: number }
  | { t: "con"; id: Id; args: Type[] }
  | { t: "fn"; params: Type[]; ret: Type; eff: Row };

export interface Row { effs: Id[]; tail: number | null }

// The effects. Ids, like everything else; names are presentation.
export const CHOICE = "effect.choice";
export const CONSOLE = "effect.console";
export const DIVERGE = "effect.diverge";
// Reading and writing files.
export const FILES = "effect.files";
// Cells: making and reading cells, and formulas computed on demand
// (src/lang/cells.ts). Update: writing a cell. A write is seen outside
// (whatever reads that cell runs again), like printing, so Update is a
// world effect; reading isn't, so a search may read cells.
export const CELLS = "effect.cells";
export const UPDATE = "effect.update";
// Network: reading from the web (`fetch text`). A GET reads; it doesn't
// change the world (RFC 9110 calls it safe), and the runtime fetches each
// address once per run, so a search that backtracks never asks twice. So
// it isn't a world effect, and it may run under Choice.
export const NETWORK = "effect.network";
// The world effects: what they do can't be taken back. They may not happen
// while a Choice is still open (LANGUAGE.md, "The world and Choice"), and
// only the runtime handles them.
export const WORLD: readonly Id[] = [CONSOLE, FILES, UPDATE];
// The effects that are builtins rather than typedefs a program declares.
export const BUILTIN_EFFECTS: readonly Id[] = [CHOICE, CONSOLE, DIVERGE, FILES, CELLS, UPDATE, NETWORK];

export const NUMBER = "type.number";
export const STRING = "type.string";
// Whole numbers that never overflow (src/lang/int.ts).
export const INT = "type.int";
// std.ts's Rational (a data type, so its id is std's): exact, ordered,
// with the prelude's arithmetic.
export const RATIONAL_TYPE = "std.rational";
// std.ts's Complex: a record of two Float64s with the prelude's + − · and
// no <.
export const COMPLEX_TYPE = "std.complex";
// A cell holding an `a` (src/lang/cells.ts). Not plain data: two cells
// holding the same value are still two cells.
export const CELL = "type.cell";

export class TypeError extends Error {}

// A type that must be plain data: no functions anywhere inside it. Only
// plain data can be compared, shown, saved or sent, and only plain data can
// be solved for (a function can't be guessed). Type variables can carry the
// requirement, the way a type class constraint would: `equal` is
// (a, a) → Bool for every plain a.
export class PlainError extends TypeError {}

// A type that must be a record of Float64s: Float64 itself, or data with one
// case whose fields are all Float64s (a point, a colour). The parts-wise
// builtins (`map parts`, `zip parts`, `total`) work on any of them, so
// vector arithmetic is written once for every such record. Carried by type
// variables like plain data is. Such a record is plain data too.
export class NumbersError extends TypeError {}

// A number type, for the generic arithmetic (NUMBERS.md, "One `+` for every
// number system"): `arith` is a type that has + − · and −x (Float64, Int, or
// a record of Float64s), `ordered` one that also has < (Float64 or Int). A
// type variable can carry either, like `numbers` above, and the program is
// resolved to each type's own operations before it runs (arith.ts).
export type Arith = "arith" | "ordered";
export class ArithError extends TypeError {
  kind: Arith;
  constructor(kind: Arith) { super(kind === "ordered" ? "not a Number with <" : "not a Number"); this.kind = kind; }
}

// A literal with a fraction part (0.5) is some Number too, but not an Int
// (WHAT-NUMBER-MEANS.md; Haskell's Fractional). Carried by type variables
// like `numbers`.
export class FractionError extends TypeError {}

// One row contained in another: what a search's function does is in what
// the call of the search does, without being all of it (Koka's subeffecting
// by `open`, Leijen 2017). `at` is the call it came from.
export interface Sub { from: Row; to: Row; at?: Id }

// A substitution for type and row variables. Cheap to copy, so the editor can
// try a candidate for a hole and throw the attempt away.
export class Subst {
  types = new Map<number, Type>();
  rows = new Map<number, Row>();
  next = 0;
  // Type variables that may only stand for plain data.
  plain = new Set<number>();
  // For a data type applied to args: the args that must be plain for the
  // whole to be plain, or null if it holds a function whatever its args.
  // Set by the checker, which can see the data types' fields.
  plainArgs: (id: Id, args: Type[]) => Type[] | null = (_, args) => args;
  // Type variables that may only stand for a record of Float64s.
  numbers = new Set<number>();
  // For a data type applied to args: its fields' types, if it has one
  // case, or null. Set by the checker.
  recordFields: (id: Id, args: Type[]) => Type[] | null = () => null;
  // Type variables that may only stand for a number type, and which kind.
  arith = new Map<number, Arith>();
  // Type variables that may not be Int: a literal's with a fraction part.
  fractional = new Set<number>();
  // Type variables a whole literal gave: left open, they are Int, not
  // Float64 (WHAT-NUMBER-MEANS.md, Haskell's defaulting to Integer).
  whole = new Set<number>();
  // Row tails that may not take a world effect, and rows contained in
  // others (WorldError and Sub above).
  noWorld = new Set<number>();
  subs: Sub[] = [];

  clone(): Subst {
    const s = new Subst();
    s.types = new Map(this.types);
    s.rows = new Map(this.rows);
    s.next = this.next;
    s.plain = new Set(this.plain);
    s.plainArgs = this.plainArgs;
    s.numbers = new Set(this.numbers);
    s.recordFields = this.recordFields;
    s.arith = new Map(this.arith);
    s.fractional = new Set(this.fractional);
    s.whole = new Set(this.whole);
    s.noWorld = new Set(this.noWorld);
    s.subs = [...this.subs];
    return s;
  }

  fresh(plain = false, numbers = false, arith?: Arith): Type {
    if (plain || numbers || arith) this.plain.add(this.next);
    if (numbers) this.numbers.add(this.next);
    if (arith) this.arith.set(this.next, arith);
    return { t: "var", v: this.next++ };
  }

  // Require t to be a number type of this kind. A record of Float64s has
  // + − · and −x part by part, but no <.
  requireArith(t: Type, kind: Arith): void {
    t = this.resolve(t);
    if (t.t === "var") {
      if (this.arith.get(t.v) !== "ordered") this.arith.set(t.v, kind);
      this.plain.add(t.v);
      return;
    }
    if (t.t === "con" && (t.id === NUMBER || t.id === INT || t.id === RATIONAL_TYPE)) return;
    if (t.t === "con" && t.id === COMPLEX_TYPE) { if (kind === "ordered") throw new ArithError(kind); return; }
    if (t.t === "con" && t.id.startsWith("pin.ordered.")) return;
    if (kind === "arith" && t.t === "con" && (t.id.startsWith("pin.arith.") || t.id.startsWith("pin.numbers."))) return;
    if (kind === "arith" && t.t === "con" && this.recordFields(t.id, t.args)?.length) {
      try { this.requireNumbers(t); } catch (e) { if (e instanceof NumbersError) throw new ArithError(kind); throw e; }
      return;
    }
    throw new ArithError(kind);
  }

  // Require t not to be an Int: a literal with a fraction part's type.
  requireFraction(t: Type): void {
    t = this.resolve(t);
    if (t.t === "var") { this.fractional.add(t.v); return; }
    if (t.t === "con" && t.id === INT) throw new FractionError("an Int is whole");
  }

  // Require t to be a record of Float64s: its fields become Float64s.
  requireNumbers(t: Type): void {
    t = this.resolve(t);
    if (t.t === "var") { this.numbers.add(t.v); this.plain.add(t.v); return; }
    if (t.t === "con" && t.id === NUMBER) return;
    const fields = t.t === "con" ? this.recordFields(t.id, t.args) : null;
    if (!fields?.length) throw new NumbersError("not a record of Float64s");
    try { for (const f of fields) this.unify(f, { t: "con", id: NUMBER, args: [] }); }
    catch (e) { if (e instanceof TypeError && !(e instanceof NumbersError)) throw new NumbersError("a field isn't a Float64"); throw e; }
  }

  // Require t to be plain data, now (for what's known of it) and later (its
  // variables become plain).
  requirePlain(t: Type): void {
    t = this.resolve(t);
    if (t.t === "var") this.plain.add(t.v);
    else if (t.t === "fn") throw new PlainError("a function is not plain data");
    else {
      const args = this.plainArgs(t.id, t.args);
      if (!args) throw new PlainError("this data holds functions");
      args.forEach((a) => this.requirePlain(a));
    }
  }
  freshRow(effs: Id[] = []): Row { return { effs, tail: this.next++ }; }

  resolve(t: Type): Type {
    while (t.t === "var" && this.types.has(t.v)) t = this.types.get(t.v)!;
    return t;
  }

  resolveRow(r: Row): Row {
    const effs = new Set(r.effs);
    let tail = r.tail;
    while (tail !== null && this.rows.has(tail)) {
      const next = this.rows.get(tail)!;
      next.effs.forEach((e) => effs.add(e));
      tail = next.tail;
    }
    return { effs: [...effs].sort(), tail };
  }

  // Fully substituted copy, for display and for storing results.
  zonk(t: Type): Type {
    t = this.resolve(t);
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map((a) => this.zonk(a)) };
    if (t.t === "fn") return { t: "fn", params: t.params.map((p) => this.zonk(p)), ret: this.zonk(t.ret), eff: this.resolveRow(t.eff) };
    return t;
  }

  private occurs(v: number, t: Type): boolean {
    t = this.resolve(t);
    if (t.t === "var") return t.v === v;
    if (t.t === "con") return t.args.some((a) => this.occurs(v, a));
    return t.params.some((p) => this.occurs(v, p)) || this.occurs(v, t.ret);
  }

  unify(a: Type, b: Type): void {
    a = this.resolve(a);
    b = this.resolve(b);
    if (a.t === "var" && b.t === "var" && a.v === b.v) return;
    if (a.t === "var" || b.t === "var") {
      const [v, t] = a.t === "var" ? [a, b] : [b as { t: "var"; v: number }, a];
      if (this.occurs(v.v, t)) throw new TypeError("this would need an infinite type");
      this.types.set(v.v, t);
      if (this.numbers.has(v.v)) this.requireNumbers(t);
      const kind = this.arith.get(v.v);
      if (kind) this.requireArith(t, kind);
      if (this.fractional.has(v.v)) this.requireFraction(t);
      if (this.whole.has(v.v) && t.t === "var") this.whole.add(t.v);
      if (this.plain.has(v.v)) this.requirePlain(t);
      return;
    }
    if (a.t === "con" && b.t === "con" && a.id === b.id && a.args.length === b.args.length) {
      a.args.forEach((x, i) => this.unify(x, b.args[i]));
      return;
    }
    if (a.t === "fn" && b.t === "fn") {
      if (a.params.length !== b.params.length) throw new TypeError(`takes ${a.params.length} inputs, not ${b.params.length}`);
      a.params.forEach((x, i) => this.unify(x, b.params[i]));
      this.unify(a.ret, b.ret);
      this.unifyRow(a.eff, b.eff);
      return;
    }
    throw new TypeError("mismatch");
  }

  // Rows are sets. Each side's missing effects go into the other side's tail;
  // a closed row (no tail) can't take any.
  unifyRow(a: Row, b: Row): void {
    a = this.resolveRow(a);
    b = this.resolveRow(b);
    const onlyA = a.effs.filter((e) => !b.effs.includes(e));
    const onlyB = b.effs.filter((e) => !a.effs.includes(e));
    // Rows are sets, so {Choice | r} = {r} has a solution: r has Choice in
    // it. That's what lets f and derivative(f), which may fail where f
    // doesn't, be passed to the same function.
    if (a.tail !== null && a.tail === b.tail) {
      if (onlyA.length || onlyB.length) this.bindRow(a.tail, { effs: [...onlyA, ...onlyB], tail: this.next++ });
      return;
    }
    if (onlyA.length && b.tail === null) throw new EffectError(onlyA);
    if (onlyB.length && a.tail === null) throw new EffectError(onlyB);
    const rest = a.tail !== null && b.tail !== null ? this.next++ : null;
    if (a.tail !== null) this.bindRow(a.tail, { effs: onlyB, tail: rest });
    if (b.tail !== null) this.bindRow(b.tail, { effs: onlyA, tail: rest });
  }

  // A row tail given its effects, and a tail for the rest; a tail that may
  // not take a world effect refuses one, and its rest may not either.
  private bindRow(tail: number, row: Row): void {
    if (this.noWorld.has(tail)) {
      const w = row.effs.filter((e) => WORLD.includes(e));
      if (w.length) throw new WorldError(w);
      if (row.tail !== null) this.noWorld.add(row.tail);
    }
    this.rows.set(tail, row);
  }
}

export class EffectError extends TypeError {
  effects: Id[];
  constructor(effects: Id[]) {
    super("unhandled effect");
    this.effects = effects;
  }
}

// The world under a Choice (LANGUAGE.md, "The world and Choice"): a row
// that may not take a world effect (Console, Files, Update), because what
// it stands for runs on paths a search may abandon or repeat. An effect
// error, so a place that reports those reports this too.
export class WorldError extends EffectError {
  constructor(effects: Id[]) { super(effects); this.message = "acts on the world under a Choice"; }
}

// A type scheme: a type with its own variables, copied fresh at each use.
// `plain` lists the variables that may only stand for plain data.
// `numbers` lists those that may only stand for a record of Float64s;
// `arith` and `ordered` those that may only stand for a number type.
// `noWorld` lists the row variables that may not take a world effect, and
// `subs` pairs of row variables, the first contained in the second.
// `fractional` those that may not be Int (a literal's with a fraction part).
export interface Scheme { vars: number[]; rows: number[]; type: Type; plain?: number[]; numbers?: number[]; arith?: number[]; ordered?: number[]; fractional?: number[]; whole?: number[]; noWorld?: number[]; subs?: [number, number][] }

export function freeVars(t: Type, s: Subst, vars = new Set<number>(), rows = new Set<number>()) {
  t = s.resolve(t);
  if (t.t === "var") vars.add(t.v);
  else if (t.t === "con") t.args.forEach((a) => freeVars(a, s, vars, rows));
  else {
    t.params.forEach((p) => freeVars(p, s, vars, rows));
    freeVars(t.ret, s, vars, rows);
    const r = s.resolveRow(t.eff);
    if (r.tail !== null) rows.add(r.tail);
  }
  return { vars, rows };
}

export function instantiate(sc: Scheme, s: Subst): Type {
  const plain = new Set(sc.plain ?? []), numbers = new Set(sc.numbers ?? []);
  const arith = new Set(sc.arith ?? []), ordered = new Set(sc.ordered ?? []);
  const vm = new Map(sc.vars.map((v) => [v, s.fresh(plain.has(v), numbers.has(v), ordered.has(v) ? "ordered" : arith.has(v) ? "arith" : undefined)]));
  for (const v of sc.fractional ?? []) { const t = vm.get(v); if (t?.t === "var") s.fractional.add(t.v); }
  for (const v of sc.whole ?? []) { const t = vm.get(v); if (t?.t === "var") s.whole.add(t.v); }
  const rm = new Map(sc.rows.map((r) => [r, s.next++]));
  for (const r of sc.noWorld ?? []) if (rm.has(r)) s.noWorld.add(rm.get(r)!);
  for (const [f, t] of sc.subs ?? []) s.subs.push({ from: { effs: [], tail: rm.get(f) ?? f }, to: { effs: [], tail: rm.get(t) ?? t } });
  const go = (t: Type): Type => {
    t = s.resolve(t);
    if (t.t === "var") return vm.get(t.v) ?? t;
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map(go) };
    const r = s.resolveRow(t.eff);
    return { t: "fn", params: t.params.map(go), ret: go(t.ret), eff: { effs: r.effs, tail: r.tail === null ? null : rm.get(r.tail) ?? r.tail } };
  };
  return go(sc.type);
}

// ---------------------------------------------------------------- display

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

// Type variables print as a, b, c. A row tail is printed only when it links
// two places (map's function and map itself); a tail that appears once just
// means "and possibly more", which is the default reading anyway. Given
// which variables stand only for number types (the checker's `arith`, or a
// scheme's through schemeArith), the type says so after it: `(a) -> a
// where a is a Number` (the family of number types, WHAT-NUMBER-MEANS.md).
// Rows one inside the other (`links`, from showIn) print as one: a search's
// call and its function, keep and its test.
export function showType(t: Type, names: Names, arith?: ReadonlyMap<number, Arith>, links: readonly [number, number][] = []): string {
  const varNames = new Map<number, string>();
  const tailCount = new Map<number, number>();
  const root = new Map<number, number>();
  const find = (r: number): number => { let x = r; while (root.has(x) && root.get(x) !== x) x = root.get(x)!; return x; };
  for (const [a, b] of links) { const ra = find(a), rb = find(b); if (ra !== rb) root.set(ra, rb); }
  const tailOf = (r: number) => find(r);
  const count = (t: Type) => {
    if (t.t === "con") t.args.forEach(count);
    if (t.t === "fn") {
      t.params.forEach(count);
      count(t.ret);
      if (t.eff.tail !== null) tailCount.set(tailOf(t.eff.tail), (tailCount.get(tailOf(t.eff.tail)) ?? 0) + 1);
    }
  };
  count(t);
  const tailNames = new Map<number, string>();
  const name = (id: Id) => names[id] ?? id;
  const go = (t: Type, nested: boolean): string => {
    if (t.t === "var") {
      if (!varNames.has(t.v)) varNames.set(t.v, LETTERS[varNames.size % 26]);
      return varNames.get(t.v)!;
    }
    if (t.t === "con") {
      if (!t.args.length) return name(t.id);
      return `${name(t.id)} ${t.args.map((a) => (a.t === "con" && a.args.length) || a.t === "fn" ? `(${go(a, true)})` : go(a, true)).join(" ")}`;
    }
    const effs = t.eff.effs.map(name);
    const tail = t.eff.tail === null ? null : tailOf(t.eff.tail);
    if (tail !== null && (tailCount.get(tail) ?? 0) > 1) {
      if (!tailNames.has(tail)) tailNames.set(tail, `e${tailNames.size ? tailNames.size + 1 : ""}`);
      effs.push(tailNames.get(tail)!);
    }
    const arrow = effs.length ? ` -[${effs.join(", ")}]-> ` : " -> ";
    const s = `(${t.params.map((p) => go(p, false)).join(", ")})${arrow}${go(t.ret, false)}`;
    return nested ? s : s;
  };
  const shown = go(t, false);
  if (!arith?.size) return shown;
  const kinds: Record<Arith, string[]> = { arith: [], ordered: [] };
  for (const [v, letter] of varNames) { const k = arith.get(v); if (k) kinds[k].push(letter); }
  const say = (vs: string[], what: string) => (vs.length === 1 ? `${vs[0]} is a ${what}` : `${vs.join(", ")} are ${what.replace("Number", "Numbers")}`);
  const clauses = [kinds.arith.length && say(kinds.arith, "Number"), kinds.ordered.length && say(kinds.ordered, "Number with <")].filter(Boolean);
  return clauses.length ? `${shown} where ${clauses.join(", and ")}` : shown;
}

// A type as the checker `s` has it: its number-type variables said, and
// rows one inside the other (Subst.subs) printed as one.
export function showIn(t: Type, names: Names, s: Subst): string {
  const links: [number, number][] = [];
  for (const c of s.subs) { const f = s.resolveRow(c.from).tail, to = s.resolveRow(c.to).tail; if (f !== null && to !== null) links.push([f, to]); }
  return showType(s.zonk(t), names, s.arith, links);
}

// A scheme's number-type variables, for showType.
export const schemeArith = (sc: Pick<Scheme, "arith" | "ordered">): Map<number, Arith> =>
  new Map<number, Arith>([...(sc.arith ?? []).map((v) => [v, "arith"] as const), ...(sc.ordered ?? []).map((v) => [v, "ordered"] as const)]);
