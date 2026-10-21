// The Lisp view: prefix everywhere, no precedence to think about. Uses the
// chosen glyph if there is one, but ignores fixity.

import type { Code, Id } from "../model.ts";
import { get } from "../model.ts";
import type { Presentation } from "../presentation.ts";
import { Namer } from "./namer.ts";

export function renderSexpr(code: Code, pres: Presentation, defId: Id): string {
  const namer = new Namer(code, pres, defId);
  const def = get(code, defId, "def");
  const expr = (id: Id): string => {
    const n = code.nodes[id];
    switch (n.kind) {
      case "hole": return "□";
      case "lit": return typeof n.value === "string" ? JSON.stringify(n.value) : String(n.value);
      case "ref": return pres.style.notation[n.target]?.glyph ?? namer.name(n.target);
      case "lambda": return `(λ (${n.params.map((p) => namer.name(p)).join(" ")}) ${expr(n.body)})`;
      case "call": return `(${[n.fn, ...n.args].map(expr).join(" ")})`;
      case "match":
      case "fold": {
        const arms = n.arms.map((a) => {
          const arm = get(code, a, "arm");
          const rs = arm.results.filter((x): x is Id => x !== null).map((b) => namer.name(b));
          return `((${[arm.variant, ...arm.binds].map((b) => namer.name(b)).join(" ")})${rs.length ? ` (${rs.join(" ")})` : ""} ${expr(arm.body)})`;
        });
        if (n.kind === "match" && n.otherwise) arms.push(`(else ${expr(n.otherwise)})`);
        return `(${n.kind} ${expr(n.scrutinee)} ${arms.join(" ")})`;
      }
      default: throw new Error(`unexpected ${n.kind} in expression`);
    }
  };
  return `(define ${namer.name(defId)} ${def.body === null ? "extern" : expr(def.body)})`;
}
