// A let that names a definition or builtin outright is read as that one
// (L222): a dot on the wire into a relation's `equal`, `let f = equal in
// f(y, …)`, keeps the relation's answers. physics's polar had none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import type { Code, Id } from "../src/model.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { addDot } from "../../editor/typed.ts";

const output = (code: Code, names: Record<Id, string>, main: Id) => {
  const out: string[] = [];
  runMain(code, infer(code, names), main, { print: (s) => out.push(s), names });
  return out;
};

test("a dot on polar's equal keeps for some y, angle: polar(1, y, 2, angle) true", () => {
  const p = loadProgram(join(root, "examples", "physics"));
  const polar = p.named("polar"), main = p.named("main");
  const info = infer(p.code, p.pres.names);
  // The equal of y = length · sin(angle), the second of the and.
  const equals = Object.values(p.own.nodes).filter((n) => n.kind === "ref" && n.target === "builtin.equal").map((n) => n.id);
  const before = output(p.code, p.pres.names, main);
  let dotted = 0;
  for (const at of equals) {
    const r = addDot(p.code, p.pres.names, info, polar, at);
    if (!r.ok) continue;
    dotted++;
    assert.deepEqual(output(r.code, r.names, main), before);
  }
  assert.ok(dotted >= 2, `${dotted} dots`);
});
