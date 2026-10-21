// Building typed programs from TypeScript. Still not a parser: each call
// makes nodes with fresh ids and records names in a side table.

import { Builder } from "../builder.ts";
import { merge, type Id } from "../model.ts";
import { prelude } from "../prelude.ts";
import { BOOL, CONS, FALSE, NIL, S, std, TRUE, UNIT_V } from "./std.ts";

export interface Case {
  variant: Id;
  names: string[];
  // fold only: a name for the folded value of each recursive field, else null
  results?: (string | null)[];
  body: (binds: Id[], results: (Id | null)[]) => Id;
}

export class Lang extends Builder {
  constructor() {
    super(merge(prelude, std));
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
