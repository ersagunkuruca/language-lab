// steady's modes worked out afresh (library/steady-modes.ts writes them).
import type { NodeOf } from "../src/model.ts";
import { LIBRARY, STEADY } from "../src/lang/library.ts";
import { analyzer, keptRows, unseeded } from "../src/lang/modes.ts";

export function steadyRows() {
  unseeded();
  const code = LIBRARY.code;
  const an = analyzer(code, {});
  for (const d of STEADY.code.defs) {
    const def = code.nodes[d] as NodeOf<"def"> | undefined, body = def?.body ? code.nodes[def.body] : undefined;
    if (body?.kind !== "lambda" || !body.params.length) continue;
    an.ofMode(d, ["out"]);
    an.ofMode(d, body.params.map((_, i) => String(i)));
  }
  return keptRows();
}
