// Undo says which files changed back by telling the two versions apart
// node by node (editor/filesPanel.ts sameCode, QA 11-22d M1), not by
// writing both out as code.json: the same answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { savedForm } from "../src/saved.ts";
import type { Node } from "../src/model.ts";
import { nodeIds, withNodes } from "../src/model.ts";
import { sameCode, userCode } from "../../editor/filesPanel.ts";

test("sameCode answers as comparing the saved code.json does", () => {
  const { code } = loadProgram(join(root, "examples", "sheet"));
  const saved = (c: typeof code) => JSON.stringify(savedForm(userCode(c)));
  const lit = nodeIds(code.nodes).map((id) => code.nodes[id]).find((n) => n.kind === "lit" && typeof n.value === "number") as Node & { kind: "lit"; value: number };
  const edited = { ...code, nodes: withNodes(code.nodes, { [lit.id]: { ...lit, value: lit.value + 1 } }) };
  // A copy of the node, the same value: the same file.
  const copied = { ...code, nodes: withNodes(code.nodes, { [lit.id]: { ...lit } }) };
  const gone = { ...code, nodes: withNodes(code.nodes, { [lit.id]: undefined as never }) };
  const moved = { ...code, defs: [...code.defs].reverse() };
  for (const [name, c] of Object.entries({ edited, copied, gone, moved })) assert.equal(sameCode(code, c), saved(code) === saved(c), name);
  assert.equal(sameCode(code, copied), true);
  assert.equal(sameCode(code, edited), false);
});
