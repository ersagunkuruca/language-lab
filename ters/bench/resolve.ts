// resolveArithmetic on a program, cold (I192): the work an opened
// definition or the editor's warm-up waits on once per version of the code.
//   npx tsx bench/resolve.ts examples/machine [examples/calc ...]
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { resolveArithmetic, seedArithmetic } from "../src/lang/arith.ts";
for (const dir of process.argv.slice(2)) {
  const p = loadProgram(dir);
  let t = performance.now();
  const info = infer(p.code, p.pres.names);
  const checked = performance.now() - t;
  t = performance.now();
  seedArithmetic(p.code, info, p.pres.names);
  const seeded = performance.now() - t;
  t = performance.now();
  resolveArithmetic(p.code, info, p.pres.names);
  const first = performance.now() - t;
  t = performance.now();
  resolveArithmetic(p.code, info, p.pres.names);
  console.log(`${dir}: check ${checked | 0} ms, library seed ${seeded | 0}, resolve ${first | 0}, again ${(performance.now() - t) | 0}`);
}
