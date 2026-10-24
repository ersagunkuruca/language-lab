import { soundOf } from "./cli/sound.ts";
import { loadProgram } from "./src/lang/load.ts";
import { infer } from "./src/lang/infer.ts";
const p = loadProgram("examples/pedal");
const info = infer(p.code, p.pres.names, undefined, p.options);
const prog = { code: p.code, info, names: p.pres.names };
const block = Array.from({ length: 128 }, (_, i) => 0.5 * Math.sin(i / 10));
for (const way of ["compiled", "evaluator"] as const) {
  const play = await soundOf(prog, p.named("pedal"), way);
  play(block);
  const t = performance.now(); const n = way === "compiled" ? 40 : 10;
  for (let i = 0; i < n; i++) play(block);
  const ms = (performance.now() - t) / n;
  console.log(way, ms.toFixed(1), "ms a block,", (1000 / ms).toFixed(0), "blocks/s of 375 needed");
}
