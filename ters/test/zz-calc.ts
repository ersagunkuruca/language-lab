import { join } from "node:path";
import { replace, type NodeOf } from "../src/model.ts";
import { fillings, infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { fillHole } from "../src/lang/refactor.ts";
import { sweep } from "./helpers.ts";
const p = loadProgram(join(import.meta.dirname, "../examples", "calculus"));
const calls = Object.values(p.code.nodes).filter((n): n is NodeOf<"call"> => n.kind === "call" && n.args.length > 0);
for (const c of calls.filter((c) => c.args[0] === process.argv[2])) {
  const hole = c.args[0];
  const code = replace(p.code, hole, () => ({ kind: "hole" }));
  const info = infer(code);
  for (const f of fillings(code, info, hole)) {
    const e = infer(fillHole(code, {}, hole, f).code).errors;
    if (e.length > info.errors.length) console.log("BAD", hole, JSON.stringify(f), e.map((x) => x.message).slice(0, 3).join(" | "));
  }
}
console.log("DONE");
