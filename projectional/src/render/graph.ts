// The node view, as a Mermaid flowchart (GitHub renders these inline). Values
// flow left to right along wires. A variable is just a wire that fans out; a
// let binding disappears entirely.

import type { Code, Id } from "../model.ts";
import { get } from "../model.ts";
import type { Presentation } from "../presentation.ts";
import { Namer } from "./namer.ts";

const key = (id: Id) => "n" + id.replace(/[^A-Za-z0-9]/g, "_");
const q = (s: string) => `"${s.replace(/"/g, "#quot;")}"`;

export function renderGraph(code: Code, pres: Presentation, defId: Id): string {
  const namer = new Namer(code, pres, defId);
  const def = get(code, defId, "def");
  const lines = ["flowchart LR"];
  const declared = new Set<string>();
  const declare = (k: string, shape: string) => {
    if (!declared.has(k)) { declared.add(k); lines.push(`  ${k}${shape}`); }
    return k;
  };
  const glyph = (target: Id) => pres.style.notation[target]?.glyph ?? namer.name(target);
  const label = (id: Id, text: string) => (pres.names[id] ? `${text}<br/><i>${pres.names[id]}</i>` : text);

  // Returns the graph node whose output is this expression's value.
  const source = (id: Id): string => {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": return declare(key(id), `[${q(String(n.value))}]`);
      case "ref": {
        const t = code.nodes[n.target];
        return t.kind === "binder"
          ? declare(key(n.target), `((${q(namer.name(n.target))}))`)
          : declare(key(n.target), `[[${q(glyph(n.target))}]]`);
      }
      case "lambda": return declare(key(id), `[${q("λ " + n.params.map((p) => namer.name(p)).join(", "))}]`);
      case "call": {
        const fn = code.nodes[n.fn];
        if (fn.kind === "lambda") {
          n.args.forEach((arg, i) => {
            const b = declare(key(fn.params[i]), `((${q(namer.name(fn.params[i]))}))`);
            lines.push(`  ${source(arg)} --> ${b}`);
          });
          return source(fn.body);
        }
        const text = fn.kind === "ref" ? glyph(fn.target) : "apply";
        const k = declare(key(id), `[${q(label(id, text))}]`);
        if (fn.kind !== "ref") lines.push(`  ${source(n.fn)} -->|fn| ${k}`);
        n.args.forEach((arg, i) => lines.push(`  ${source(arg)} -->${n.args.length > 1 ? `|${i + 1}|` : ""} ${k}`));
        return k;
      }
      default: throw new Error(`unexpected ${n.kind} in expression`);
    }
  };

  if (def.body !== null) {
    let body = def.body;
    const b = code.nodes[body];
    if (b.kind === "lambda") {
      b.params.forEach((p) => declare(key(p), `([${q(namer.name(p))}])`));
      body = b.body;
    }
    const out = declare("out_" + key(defId), `[/${q(namer.name(defId))}/]`);
    lines.push(`  ${source(body)} --> ${out}`);
  }
  return lines.join("\n");
}
