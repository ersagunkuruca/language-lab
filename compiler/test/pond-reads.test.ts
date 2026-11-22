// C259: pond-page's reads of its cells follow the places its code uses.
// Each place of a read was kept once, but a list built item by item (a
// reverse's accumulator) held one more copy of a place each call, so
// every call looked new and the work went 649 calls deep, past the stack;
// the reads were all kept whole. And a read used at more places than the
// limit (the fish's fields) was whole too; now it waits on the items.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { emitCoreJs, lowerCore } from "../src/core-js.ts";

test("pond-page's reads wait on the places they use, the fish's among them (C259)", () => {
  const p = loadProgram(join(import.meta.dirname, "../../ters/examples/pond-page"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const main = p.own.defs.find((d) => p.pres.names[d] === "main")!;
  const js = emitCoreJs(lowerCore(p.code, info, p.pres.names, [main])).js;
  const followed = js.match(/R\.rt\("readPaths:[^"]*"/g) ?? [];
  assert.ok(followed.length >= 3, `${followed.length} reads followed`);
  assert.ok(followed.some((r) => r.includes("*/")), followed.join("\n"));
});
