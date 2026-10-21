// The step-by-step view (A-normal form): every operation gets its own line
// and an intermediate name. An immediately applied lambda, ((d) => body)(x),
// is shown as the assignment d = x, because that is all it is.
//
// Intermediate names come from the names layer when a node has one, so
// naming a step is a presentation edit, the same as a comment.

import type { Code, Id } from "../model.ts";
import { get } from "../model.ts";
import type { Presentation } from "../presentation.ts";
import { nestedExpr } from "./nested.ts";
import { Namer } from "./namer.ts";
import { atom, callText, comment, Footnotes, lambdaText, type R } from "./expr.ts";

export function renderLet(code: Code, pres: Presentation, defId: Id): string {
  const namer = new Namer(code, pres, defId);
  const notes = new Footnotes(pres, namer);
  const def = get(code, defId, "def");
  const out: string[] = [];
  const head = comment(pres, namer, defId);
  if (head) out.push(`-- ${head}`);
  if (def.body === null) return [...out, `${namer.name(defId)} = extern`].join("\n");

  let indent = "";
  const emit = (lhs: string, r: R, id: Id) => {
    const c = comment(pres, namer, id);
    out.push(`${indent}${lhs} = ${r.text}${c ? `   -- ${c}` : ""}`);
  };

  // One operation whose operands are all atoms. Emits lines for the operands.
  const step = (id: Id): R => {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit":
      case "ref":
      case "hole":
        return operand(id);
      case "match":
      case "fold":
        // Arms have their own scopes; shown nested rather than flattened.
        return inline(id);
      case "lambda":
        // A lambda passed as a value: no sensible way to flatten it into the
        // enclosing sequence, so show it inline in nested form.
        return lambdaText(code, namer, n.params, inline(n.body));
      case "call": {
        const fn = code.nodes[n.fn];
        if (fn.kind === "lambda") {
          n.args.forEach((arg, i) => emit(namer.name(fn.params[i]), step(arg), arg));
          return step(fn.body);
        }
        const args = n.args.map(operand);
        return callText(pres, namer, fn, args, () => operand(n.fn));
      }
      default:
        throw new Error(`unexpected ${n.kind} in expression`);
    }
  };

  const operand = (id: Id): R => {
    const n = code.nodes[id];
    if (n.kind === "lit") return notes.mark(id, atom(typeof n.value === "string" ? JSON.stringify(n.value) : String(n.value)));
    if (n.kind === "ref") return notes.mark(id, atom(namer.name(n.target)));
    if (n.kind === "hole") return notes.mark(id, atom("□"));
    const r = step(id);
    if (n.kind === "lambda") return r;
    const t = namer.temp(id);
    emit(t, r, id);
    return atom(t);
  };

  const inline = nestedExpr(code, pres, namer, notes);

  const body = code.nodes[def.body];
  if (body.kind === "lambda") {
    out.push(`${namer.name(defId)}(${body.params.map((p) => namer.name(p)).join(", ")}):`);
    indent = "  ";
    const r = step(body.body);
    out.push(`  return ${r.text}`);
  } else {
    const r = step(def.body);
    out.push(`${namer.name(defId)} = ${r.text}`);
  }
  return [...out, ...notes.lines()].join("\n");
}
