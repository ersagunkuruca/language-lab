// Building typed programs from TypeScript. Still not a parser: each call
// makes nodes with fresh ids and records names in a side table.

import { Builder } from "../builder.ts";
import { merge, type Code, type Id } from "../model.ts";
import { prelude } from "../prelude.ts";
import { BOOL, CONS, FALSE, NIL, S, std, TRUE, UNIT_V } from "./std.ts";
import { INT } from "./types.ts";

export interface Case {
  variant: Id;
  names: string[];
  // fold only: a name for the folded value of each recursive field, else null
  results?: (string | null)[];
  body: (binds: Id[], results: (Id | null)[]) => Id;
}

export class Lang extends Builder {
  // `known`: what the program can refer to besides itself. Give it the
  // library (src/lang/library.ts) to use the modules' definitions.
  constructor(known: Code = merge(prelude, std)) {
    super(known);
  }

  // A data type. `variants` maps each case to its fields; a field's type is
  // built by a function of (the type itself, its params).
  type(name: string, params: string[], variants: [string, [string, (self: Id, ps: Id[]) => Id][]][]) {
    const def = this.def(name);
    const ps = params.map((p) => this.binder(p));
    const ids: Record<string, Id> = {};
    const fields: Record<string, Id> = {};
    const vs = variants.map(([vname, fs]) => {
      const fids = fs.map(([fname, ty]) => {
        const f = this.named(this.add({ kind: "field", type: ty(def, ps) }), fname);
        fields[`${vname}.${fname}`] = f;
        return f;
      });
      return (ids[vname] = this.named(this.add({ kind: "variant", fields: fids }), vname));
    });
    this.code.nodes[def] = { id: def, kind: "def", body: this.add({ kind: "typedef", params: ps, variants: vs }) };
    return { def, v: ids, f: fields };
  }

  // An effect: a data type whose cases are operations. Each operation
  // lists its inputs and the type it returns, or null for one that never
  // returns (it ends the handled computation, like abort).
  effect(name: string, ops: [string, [string, () => Id][], (() => Id) | null][]) {
    const def = this.def(name);
    const ids: Record<string, Id> = {};
    const vs = ops.map(([oname, fs, returns]) => {
      const fids = fs.map(([fname, ty]) => this.named(this.add({ kind: "field", type: ty() }), fname));
      return (ids[oname] = this.named(this.add({ kind: "variant", fields: fids, ...(returns ? { returns: returns() } : {}) }), oname));
    });
    this.code.nodes[def] = { id: def, kind: "def", body: this.add({ kind: "typedef", params: [], variants: vs, effect: true }) };
    return { def, op: ids };
  }

  // A handler: a match on the operations of an effect, around the
  // computation that performs it.
  handle(body: Id, cases: Case[]): Id {
    return this.match(body, cases);
  }

  tref(target: Id, ...args: Id[]): Id {
    return this.add({ kind: "tref", target, args });
  }

  fn(names: string[], body: (...params: Id[]) => Id): Id {
    return this.lambda(names, body);
  }

  // A thunk: an action with no inputs, what handlers take.
  thunk(body: () => Id): Id {
    return this.lambda([], body);
  }

  let(name: string, value: Id, body: (b: Id) => Id): Id {
    return this.call(this.lambda([name], body), value);
  }

  // Do these in order; the value is the last one's.
  seq(...steps: Id[]): Id {
    return steps.reduceRight((rest, step) => this.call(this.lambda(["_"], () => rest), step));
  }

  private arm(c: Case, fold: boolean): Id {
    const binds = c.names.map((n) => this.binder(n));
    const results = fold ? (c.results ?? c.names.map(() => null)).map((r) => (r === null ? null : this.binder(r))) : binds.map(() => null);
    return this.add({ kind: "arm", variant: c.variant, binds, results, body: this.x(c.body(binds, results)) });
  }

  match(scrutinee: Id, cases: Case[], otherwise?: Id): Id {
    return this.add({ kind: "match", scrutinee: this.x(scrutinee), arms: cases.map((c) => this.arm(c, false)), otherwise: otherwise === undefined ? null : this.x(otherwise) });
  }

  fold(scrutinee: Id, cases: Case[]): Id {
    return this.add({ kind: "fold", scrutinee: this.x(scrutinee), arms: cases.map((c) => this.arm(c, true)) });
  }

  if(cond: Id, then: Id, otherwise: Id): Id {
    return this.match(cond, [
      { variant: TRUE, names: [], body: () => then },
      { variant: FALSE, names: [], body: () => otherwise },
    ]);
  }

  // Use relation `fn` in one direction: `given` ports from expressions, the
  // `want` ports solved for and bound (by the given display names) in body.
  solve(fn: Id, given: Record<string, Id>, want: Record<string, string>, body: (b: Record<string, Id>) => Id): Id {
    const binds = Object.fromEntries(Object.entries(want).map(([k, name]) => [k, this.binder(name)]));
    const g = Object.fromEntries(Object.entries(given).map(([k, e]) => [k, this.x(e)]));
    return this.add({ kind: "solve", fn, given: g, binds, body: this.x(body(binds)) });
  }

  // An Int literal: exact at any size.
  int(value: number | bigint | string): Id {
    const v = typeof value === "number" ? value : BigInt(value);
    const safe = typeof v === "number" || (v >= -9007199254740991n && v <= 9007199254740991n);
    return this.add({ kind: "lit", value: safe ? Number(v) : String(v), of: INT });
  }

  // Predicates: what a network is. `equal` is a wire, `and` puts wires
  // side by side, and `for some` names unknowns that aren't ports (one
  // `for some` per unknown, nested).
  equal(a: Id, b: Id): Id {
    return this.call(S.equal, a, b);
  }

  and(...xs: Id[]): Id {
    return xs.reduceRight((rest, x) => this.call(S.and, x, rest));
  }

  exists(names: string[], body: (...unknowns: Id[]) => Id): Id {
    const go = (i: number, got: Id[]): Id => i === names.length ? body(...got)
      : this.call(S.exists, this.lambda([names[i]], (x) => go(i + 1, [...got, x])));
    return go(0, []);
  }

  hole(): Id {
    return this.add({ kind: "hole" });
  }

  list(...items: Id[]): Id {
    return items.reduceRight((tail, x) => this.call(CONS, x, tail), this.x(NIL));
  }

  text(...parts: Id[]): Id {
    return parts.reduce((a, b) => this.call(S.concat, a, b));
  }

  get unitValue() { return this.x(UNIT_V); }
  get true() { return this.x(TRUE); }
  get false() { return this.x(FALSE); }
}

export { BOOL };
