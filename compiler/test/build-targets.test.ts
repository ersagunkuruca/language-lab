// Build targets' two answers (I315, editor/runWorker.ts): the GPU's, then
// WebAssembly and C's on the same check, which reuses the first steps
// every lowering of the same roots takes (scalar.ts `prepared`). The
// second answer is the one it gives asked alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { lowerScalar } from "../src/scalar.ts";
import { examples } from "../src/program.ts";
import { join } from "node:path";

test("WebAssembly and C's answer after the GPU's is the one it gives alone", () => {
  const p = loadProgram(join(examples, "numbers"));
  const own = p.code.defs.filter((d) => !LIBRARY.code.nodes[d]);
  const refused = (info: ReturnType<typeof infer>, o: object) => [...lowerScalar(p.code, info, p.pres.names, own, o).refused].sort();
  const alone = refused(infer(p.code, p.pres.names), { data: true, bake: false });
  const info = infer(p.code, p.pres.names);
  const gpu = refused(info, { records: true, shader: true });
  assert.ok(gpu.length > 0, "the GPU refuses some");
  assert.deepEqual(refused(info, { data: true, bake: false }), alone);
});
