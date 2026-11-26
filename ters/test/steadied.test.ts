// A rewrite that makes a definition again as it was hands back the nodes
// met before (model.ts steadied), so what is kept by node (a definition's
// walk, what it refers to) is found again after it; a node changed is not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyNodes, nodesUnder, steadied, subtreeKept, type Code } from "../src/model.ts";

test("a definition made again as it was is the same nodes; one changed keeps its own", () => {
  const made = (n: number): Code => ({
    defs: ["f", "g"],
    nodes: {
      f: { id: "f", kind: "def", body: "f1" }, f1: { id: "f1", kind: "lit", value: 1 },
      g: { id: "g", kind: "def", body: "g1" }, g1: { id: "g1", kind: "lit", value: n },
    } as never,
  });
  const a = steadied(made(1));
  const b = steadied(made(1));
  assert.equal(b.nodes.f, a.nodes.f);
  assert.equal(subtreeKept(b, "f"), subtreeKept(a, "f"));
  const c = steadied(made(2));
  assert.equal(c.nodes.f1, a.nodes.f1);
  assert.notEqual(c.nodes.g1, a.nodes.g1);
  assert.equal((c.nodes.g1 as { value: number }).value, 2);
});

test("over the library's nodes, the program's own are made the same; the library's stay as they are", () => {
  const library = { l: { id: "l", kind: "def", body: "l1" }, l1: { id: "l1", kind: "lit", value: 7 } } as never as Code["nodes"];
  const made = (n: number): Code => {
    const nodes = copyNodes(library);
    Object.assign(nodes, { f: { id: "f", kind: "def", body: "f1" }, f1: { id: "f1", kind: "lit", value: 1 }, g: { id: "g", kind: "def", body: "g1" }, g1: { id: "g1", kind: "lit", value: n } });
    return { defs: ["l", "f", "g"], nodes };
  };
  const a = steadied(made(1));
  const c = steadied(made(2));
  assert.equal(c.nodes.f1, a.nodes.f1);
  assert.notEqual(c.nodes.g1, a.nodes.g1);
  assert.equal(c.nodes.l1, library.l1);
  assert.equal(nodesUnder(c.nodes), library);
});
