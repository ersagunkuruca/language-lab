// The functional view: one expression per definition, nested as deep as the
// tree is.

import type { Code, Id } from "../model.ts";
import { get } from "../model.ts";
import type { Presentation } from "../presentation.ts";
import { Namer } from "./namer.ts";
import { atom, callText, comment, Footnotes, lambdaText, unread, type R } from "./expr.ts";

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
        // Steps done one after another (print this, then that): a; b.
        const f = code.nodes[n.fn];
        if (f.kind === "lambda" && f.params.every((p) => unread(code, p, f.body))) {
          r = { text: [...n.args.map((a) => expr(a).text), expr(f.body).text].join("; "), prec: 0 };
          break;
        }
        const args = n.args.map(expr);
        r = callText(pres, namer, code.nodes[n.fn], args, () => expr(n.fn));
        break;
      }
      case "match":
      case "fold": {
        // One line per program is this view's promise, so arms go inline.
        const arms = n.arms.map((a) => {
          const arm = get(code, a, "arm");
          const rs = arm.results.filter((x): x is Id => x !== null);
          const pat = arm.binds.length ? `${namer.name(arm.variant)}(${arm.binds.map((b) => namer.name(b)).join(", ")})` : namer.name(arm.variant);
          return `${pat}${rs.length ? ` with ${rs.map((b) => namer.name(b)).join(", ")}` : ""} → ${expr(arm.body).text}`;
        });
        if (n.kind === "match" && n.otherwise) arms.push(`otherwise → ${expr(n.otherwise).text}`);
        r = atom(`${n.kind} ${expr(n.scrutinee).text} { ${arms.join("; ")} }`);
        break;
      }
      case "solve": {
        const given = Object.entries(n.given).map(([k, e]) => `${k} = ${expr(e).text}`).join(", ");
        const wanted = Object.values(n.binds).map((b) => namer.name(b)).join(", ");
        r = atom(`solve ${namer.name(n.fn)}(${given}) for ${wanted} → ${expr(n.body).text}`);
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
