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

export const NUMBER = "type.number";
export const STRING = "type.string";

export class TypeError extends Error {}

// A type that must be plain data: no functions anywhere inside it. Only
// plain data can be compared, shown, saved or sent, and only plain data can
// be solved for (a function can't be guessed). Type variables can carry the
// requirement, the way a type class constraint would: `equal` is
// (a, a) → Bool for every plain a.
export class PlainError extends TypeError {}

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

  clone(): Subst {
    const s = new Subst();
    s.types = new Map(this.types);
    s.rows = new Map(this.rows);
    s.next = this.next;
    s.plain = new Set(this.plain);
    s.plainArgs = this.plainArgs;
    return s;
  }

  fresh(plain = false): Type {
    if (plain) this.plain.add(this.next);
    return { t: "var", v: this.next++ };
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
      if (onlyA.length || onlyB.length) this.rows.set(a.tail, { effs: [...onlyA, ...onlyB], tail: this.next++ });
      return;
    }
    if (onlyA.length && b.tail === null) throw new EffectError(onlyA);
    if (onlyB.length && a.tail === null) throw new EffectError(onlyB);
    const rest = a.tail !== null && b.tail !== null ? this.next++ : null;
    if (a.tail !== null) this.rows.set(a.tail, { effs: onlyB, tail: rest });
    if (b.tail !== null) this.rows.set(b.tail, { effs: onlyA, tail: rest });
  }
}

export class EffectError extends TypeError {
  effects: Id[];
  constructor(effects: Id[]) {
    super("unhandled effect");
    this.effects = effects;
  }
}

// A type scheme: a type with its own variables, copied fresh at each use.
// `plain` lists the variables that may only stand for plain data.
export interface Scheme { vars: number[]; rows: number[]; type: Type; plain?: number[] }

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
  const plain = new Set(sc.plain ?? []);
  const vm = new Map(sc.vars.map((v) => [v, s.fresh(plain.has(v))]));
  const rm = new Map(sc.rows.map((r) => [r, s.next++]));
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
// means "and possibly more", which is the default reading anyway.
export function showType(t: Type, names: Names): string {
  const varNames = new Map<number, string>();
  const tailCount = new Map<number, number>();
  const count = (t: Type) => {
    if (t.t === "con") t.args.forEach(count);
    if (t.t === "fn") {
      t.params.forEach(count);
      count(t.ret);
      if (t.eff.tail !== null) tailCount.set(t.eff.tail, (tailCount.get(t.eff.tail) ?? 0) + 1);
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
    if (t.eff.tail !== null && (tailCount.get(t.eff.tail) ?? 0) > 1) {
      if (!tailNames.has(t.eff.tail)) tailNames.set(t.eff.tail, `e${tailNames.size ? tailNames.size + 1 : ""}`);
      effs.push(tailNames.get(t.eff.tail)!);
    }
    const arrow = effs.length ? ` -[${effs.join(", ")}]-> ` : " -> ";
    const s = `(${t.params.map((p) => go(p, false)).join(", ")})${arrow}${go(t.ret, false)}`;
    return nested ? s : s;
  };
  return go(t, false);
}
