// The library is checked once per process (L216): a program's check reads
// through to it and checks only its own definitions. It must agree with a
// check from scratch: errors, schemes and every node's type.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { checkOnce, infer, type Info } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { checkOptions, loadProgram } from "../src/lang/load.ts";
import { showIn } from "../src/lang/types.ts";

const seen = (info: Info, names: Record<string, string>) => ({
  errors: info.errors.map((e) => e.message).sort(),
  types: [...info.typeOf].map(([id, t]) => `${id} ${showIn(t, names, info.subst)}`).sort(),
});

for (const example of ["queens", "physics", "tumble"]) test(`${example}: a check over the kept library is a check from scratch`, () => {
  const p = loadProgram(join(root, "examples", example));
  for (const opts of [checkOptions, {}]) {
    const layered = seen(infer(p.code, p.pres.names, undefined, opts), p.pres.names);
    checkOnce(null);
    try {
      assert.deepEqual(layered, seen(infer(p.code, p.pres.names, undefined, opts), p.pres.names));
    } finally { checkOnce(LIBRARY.code, LIBRARY.names); }
  }
});

test("a program that changes a library node is checked whole", () => {
  const p = loadProgram(join(root, "examples", "queens"));
  const keep = p.named("keep");
  const code = { ...p.code, nodes: { ...p.code.nodes, [keep]: { ...p.code.nodes[keep] } } };
  assert.deepEqual(infer(code, p.pres.names).errors, []);
});
