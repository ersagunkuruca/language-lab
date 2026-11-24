// A version over other nodes lists each kind's nodes as a walk of it
// would (model.ts kindsOver): the kinds it changes merged when asked,
// the nodes changed, taken out and added in their places.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyNodes, dropNode, nodeValues, nodesOfKindIn, type Node } from "../src/model.ts";

test("a version's kinds are its walk's, changed in place after or not", () => {
  const under: Record<string, Node> = {};
  for (let i = 0; i < 40; i++) under[`n${i}`] = (i % 3 ? { id: `n${i}`, kind: "lit", value: i } : { id: `n${i}`, kind: "ref", target: "x" }) as Node;
  const walked = (nodes: Record<string, Node>, kind: string) => nodeValues(nodes).filter((n) => n.kind === kind);
  const v = copyNodes(under);
  v.n3 = { id: "n3", kind: "lit", value: 3 } as Node;     // a ref now a lit
  v.n4 = { id: "n4", kind: "ref", target: "y" } as Node;  // a lit now a ref
  dropNode(v, "n9");
  v.m1 = { id: "m1", kind: "ref", target: "z" } as Node;
  for (const kind of ["ref", "lit", "def"]) assert.deepEqual(nodesOfKindIn(v, kind), walked(v, kind), kind);
  v.n0 = { id: "n0", kind: "lit", value: 0 } as Node;
  for (const kind of ["ref", "lit"]) assert.deepEqual(nodesOfKindIn(v, kind), walked(v, kind), `${kind}, after a change in place`);
});
