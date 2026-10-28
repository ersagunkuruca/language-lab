// Turns ids into display strings for one rendering. Because identity is the
// id, two different variables may share a name; the namer only has to make
// them distinguishable on screen, and it does so without touching the store.

import type { Code, Id } from "../model.ts";
import { children, subtree } from "../model.ts";
import type { Presentation } from "../presentation.ts";

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const subscript = (n: number) => String(n).split("").map((d) => SUB[+d]).join("");
const plain = /^[\p{L}_][\p{L}\p{N}_']*$/u;

export class Namer {
  private display = new Map<Id, string>();
  private used = new Set<string>();
  private temps = 0;

  private code: Code;
  private pres: Presentation;

  constructor(code: Code, pres: Presentation, root: Id) {
    this.code = code;
    this.pres = pres;
    const order: Id[] = [];
    const add = (id: Id) => { if (!order.includes(id)) order.push(id); };
    add(root);
    for (const id of subtree(code, root)) {
      const n = code.nodes[id];
      if (n.kind === "binder") add(id);
      else if (n.kind === "ref") add(n.target);
      else if (pres.names[id] !== undefined && n.kind !== "def") add(id);
    }
    const byName = new Map<string, Id[]>();
    for (const id of order) {
      const base = this.base(id);
      byName.set(base, [...(byName.get(base) ?? []), id]);
    }
    // Two binders that share a name need telling apart only where one is
    // used inside the other's scope; a function's input named like a value
    // outside it that it doesn't use reads plainly (QA8 L2).
    const owner = new Map<Id, Id>();
    for (const id of subtree(code, root)) for (const c of children(code.nodes[id])) owner.set(c, id);
    // `a` is hidden where `b` is bound inside its scope, and used there.
    const usedIn = (a: Id, b: Id) => {
      const oa = owner.get(a), ob = owner.get(b);
      if (!oa || !ob) return true;
      if (oa === ob) return true;
      const inner = subtree(code, ob);
      return subtree(code, oa).includes(ob) && inner.some((x) => { const n = code.nodes[x]; return n.kind === "ref" && n.target === a; });
    };
    const clash = (ids: Id[]) => ids.some((a) => code.nodes[a]?.kind !== "binder" || ids.some((b) => b !== a && (code.nodes[b]?.kind !== "binder" || usedIn(a, b))));
    for (const [base, ids] of byName) {
      const sub = ids.length > 1 && clash(ids);
      ids.forEach((id, i) => this.display.set(id, sub ? base + subscript(i + 1) : base));
      this.used.add(base);
    }
  }

  private base(id: Id): string {
    const given = this.pres.names[id];
    if (given !== undefined) return given;
    const n = this.code.nodes[id];
    return n?.kind === "builtin" ? n.op : `?${id.slice(0, 4)}`;
  }

  name(id: Id): string {
    const s = this.display.get(id) ?? this.base(id);
    const q = this.pres.style.quote;
    return q && !plain.test(s) ? q[0] + s + q[1] : s;
  }

  // The let view's name for an intermediate value: the user's if they gave
  // one, otherwise t1, t2, ... avoiding anything already on screen.
  temp(id: Id): string {
    if (this.display.has(id)) return this.name(id);
    let t: string;
    do t = `t${++this.temps}`; while (this.used.has(t));
    this.used.add(t);
    this.display.set(id, t);
    return t;
  }
}
