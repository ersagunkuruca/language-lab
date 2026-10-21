// The functional view: one expression per definition, nested as deep as the
// tree is.

import type { Code, Id } from "../model.ts";
import { get } from "../model.ts";
import type { Presentation } from "../presentation.ts";
import { Namer } from "./namer.ts";
import { atom, callText, comment, Footnotes, lambdaText, type R } from "./expr.ts";

export function nestedExpr(code: Code, pres: Presentation, namer: Namer, notes: Footnotes) {
  const expr = (id: Id): R => {
    const n = code.nodes[id];
    let r: R;
    switch (n.kind) {
      case "lit": r = atom(typeof n.value === "string" ? JSON.stringify(n.value) : String(n.value)); break;
      case "ref": r = atom(namer.name(n.target)); break;
      case "hole": r = atom("□"); break;
      case "lambda": r = lambdaText(code, namer, n.params, expr(n.body)); break;
      case "call": {
        const args = n.args.map(expr);
        r = callText(pres, namer, code.nodes[n.fn], args, () => expr(n.fn));
        break;
      }
      default: throw new Error(`unexpected ${n.kind} in expression`);
    }
    return notes.mark(id, r);
  };
  return expr;
}

export function renderNested(code: Code, pres: Presentation, defId: Id): string {
  const namer = new Namer(code, pres, defId);
  const notes = new Footnotes(pres, namer);
  const def = get(code, defId, "def");
  const expr = nestedExpr(code, pres, namer, notes);

  const head = comment(pres, namer, defId);
  const body = def.body === null ? "extern" : expr(def.body).text;
  return [
    ...(head ? [`-- ${head}`] : []),
    `${namer.name(defId)} = ${body}`,
    ...notes.lines(),
  ].join("\n");
}
