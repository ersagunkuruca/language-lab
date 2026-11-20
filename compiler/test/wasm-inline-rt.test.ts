// Small runtime functions put in place where they are called with locals
// on WebAssembly (G3g, wasm-rt.ts `inlined`): an array's item and length,
// which V8 left as calls in the moths' loops. Their bytes and their text
// both; that every program prints the same, and the moths' loops call
// neither, is the targets' sweeps' (ters wasi lowers them so).

import { test } from "node:test";
import assert from "node:assert/strict";
import { inlined, runtime } from "../src/wasm-rt.ts";

test("an array's length read in place, a straight run with the caller's locals (G3g)", () => {
  const r = { type: () => 7, func: () => 0, global: () => 0, memory: () => ({ index: 0, base: 0 }), at: () => 0, valtype: () => ({ bytes: [0x7f], text: "i32" }) };
  const f = runtime("array.length.a0.i64");
  const put = inlined(f, r, [5], ["$x"]);
  assert.ok(put, "inlined");
  assert.deepEqual(put.code.slice(0, 2), [0x20, 5], "reads the caller's local 5");
  assert.equal(put.wat[0], "local.get $x");
  // One that branches or keeps a local of its own stays a call.
  assert.equal(inlined(runtime("array.slot.a0"), r, [1, 2], ["$a", "$b"]), null);
});
