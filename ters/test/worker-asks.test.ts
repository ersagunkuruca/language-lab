// What the editor asks of its workers goes by postMessage, whose copy
// keeps only an object's own properties. A program's nodes sit over the
// library's (model.ts nodesOver), so an edited program sent as it is
// reached the worker as its edit alone: each edit's page compile failed
// (looper, pond), and the page ran interpreted on the editor's thread,
// about 4 s an edit. Asks send the program as runCode.ts sendCode gives it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { copyNodes, dropNode, idsOver, nodeIds, subtree, withNodes, type Id, type Node, type NodeOf } from "../src/model.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { receivedCode, sendCode } from "../../editor/runCode.ts";
import { compilePageProgram } from "../../editor/pageCompile.ts";

test("an edited page program sent to a worker arrives whole, and compiles", () => {
  const p = loadProgram(join(root, "examples", "bounce"));
  const names = p.pres.names, code = p.code, main = p.own.defs.find((d) => names[d] === "main")!;
  const lit = subtree(code, (code.nodes[main] as Node & { body: Id }).body).map((id) => code.nodes[id]).find((n) => n.kind === "lit" && typeof n.value === "number") as NodeOf<"lit"> & { value: number };
  const next = { ...code, nodes: withNodes(code.nodes, { [lit.id]: { ...lit, value: lit.value + 1 } }) };
  const all = nodeIds(next.nodes).length;
  assert.ok(Object.keys(structuredClone(next.nodes)).length < all, "the nodes as they are lose what they sit over");
  const got = receivedCode(structuredClone(sendCode(next)));
  assert.equal(nodeIds(got.nodes).length, all);
  assert.deepEqual(got.nodes[lit.id], next.nodes[lit.id]);
  assert.ok(compilePageProgram(got, names, {}, main).program.length > 0);
});

// E319k: a program over the library is sent from its own nodes, as the
// same ask a walk of every node gives: the worker lists its nodes in the
// same order.
test("a program over the library is sent as a walk of all its nodes sends it", () => {
  const p = loadProgram(join(root, "examples", "bounce"));
  const code = p.code, lib = LIBRARY.code.nodes;
  const libId = nodeIds(lib).find((id) => code.nodes[id] === lib[id])!;
  const gone = withNodes(code.nodes, { added1: { id: "added1", kind: "lit", value: 1 } as Node });
  dropNode(gone, libId);
  const next = { ...code, nodes: withNodes(gone, { added2: { id: "added2", kind: "lit", value: 2 } as Node }) };
  assert.ok(idsOver(next.nodes, lib), "the program sits over the library");
  const fast = sendCode(next), slow = sendCode({ ...next, nodes: copyNodes(next.nodes) });
  assert.ok(fast.gone.includes(libId) && "added1" in fast.own && "added2" in fast.own);
  const sorted = (s: ReturnType<typeof sendCode>) => ({ ...s, gone: [...s.gone].sort() });
  assert.deepEqual(sorted(fast), sorted(slow));
  const a = receivedCode(structuredClone(fast)), b = receivedCode(structuredClone(slow));
  assert.deepEqual(nodeIds(a.nodes), nodeIds(b.nodes));
});
