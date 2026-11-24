// A version over other nodes lists each kind's nodes as a walk of it
// would (model.ts kindsOver): the kinds it changes merged when asked,
// the nodes changed, taken out and added in their places.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyNodes, dropNode, nodeValues, nodesOfKindIn, type Kind, type Node } from "../src/model.ts";

test("a version's kinds are its walk's, changed in place after or not", () => {
  const under: Record<string, Node> = {};
  for (let i = 0; i < 40; i++) under[`n${i}`] = (i % 3 ? { id: `n${i}`, kind: "lit", value: i } : { id: `n${i}`, kind: "ref", target: "x" }) as Node;
  const walked = (nodes: Record<string, Node>, kind: Kind) => nodeValues(nodes).filter((n) => n.kind === kind);
  const v = copyNodes(under);
  v.n3 = { id: "n3", kind: "lit", value: 3 } as Node;     // a ref now a lit
  v.n4 = { id: "n4", kind: "ref", target: "y" } as Node;  // a lit now a ref
  dropNode(v, "n9");
  v.m1 = { id: "m1", kind: "ref", target: "z" } as Node;
  for (const kind of ["ref", "lit", "def"] as const) assert.deepEqual(nodesOfKindIn(v, kind), walked(v, kind), kind);
  v.n0 = { id: "n0", kind: "lit", value: 0 } as Node;
  for (const kind of ["ref", "lit"] as const) assert.deepEqual(nodesOfKindIn(v, kind), walked(v, kind), `${kind}, after a change in place`);
});

test("a version with its own ids renamed lists its nodes as the plain copy renamed would", async () => {
  const { renamedOver, nodeIds } = await import("../src/model.ts");
  const under: Record<string, Node> = { a: { id: "a", kind: "ref", target: "b" } as Node, b: { id: "b", kind: "lit", value: 1 } as Node };
  const v = copyNodes(under);
  v.x = { id: "x", kind: "ref", target: "a" } as Node;
  v.y = { id: "y", kind: "ref", target: "x" } as Node;
  v.z = { id: "z", kind: "lit", value: 2 } as Node;
  const rename = new Map([["x", "X"]]);
  const mapped = new Map<string, Node>([["x", { id: "X", kind: "ref", target: "a" } as Node], ["y", { id: "y", kind: "ref", target: "X" } as Node]]);
  const r = renamedOver(v, rename, mapped)!;
  assert.deepEqual(nodeIds(r), ["a", "b", "X", "y", "z"]);
  assert.equal(r.y, mapped.get("y"));
  assert.equal(r.a, under.a);
  // A renamed id among the nodes under takes their place there: not over them.
  assert.equal(renamedOver(v, new Map([["a", "A"]]), new Map()), null);
});
