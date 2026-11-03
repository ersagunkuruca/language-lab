// L178a: the hash covers what a definition means, not only its body's
// shape (FOUNDATIONS-2026-11-03.md §1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashDef } from "../src/hash.ts";
import type { Code, Node } from "../src/model.ts";

const code = (...ns: Node[]): Code => ({ nodes: Object.fromEntries(ns.map((n) => [n.id, n])), defs: ns.filter((n) => n.kind === "def").map((n) => n.id) });
const h = (c: Code) => hashDef(c, "d");

// A type of one case with one Float64 field, marked as given.
const type = (marks: Partial<Node & { kind: "typedef" }>, op: Partial<Node & { kind: "variant" }> = {}) => code(
  { id: "d", kind: "def", body: "t" },
  { id: "t", kind: "typedef", params: [], variants: ["v"], ...marks } as Node,
  { id: "v", kind: "variant", fields: ["f"], ...op } as Node,
  { id: "f", kind: "field", type: "ft" },
  { id: "ft", kind: "tref", target: "type.number", args: [] },
  { id: "r", kind: "tref", target: "type.number", args: [] },
);

test("an effect, an interface and a data type of one shape hash apart", () => {
  const all = [h(type({})), h(type({ effect: true })), h(type({ interface: true }))];
  assert.equal(new Set(all).size, 3);
});

test("an operation's result type, later and private are part of its hash", () => {
  const all = [h(type({ effect: true })), h(type({ effect: true }, { returns: "r" })), h(type({ effect: true }, { later: true })), h(type({}, { private: true }))];
  assert.equal(new Set(all).size, 4);
});

// d(a, b) = a = b, with or without b named its result.
const pred = (more: object) => code(
  { id: "d", kind: "def", body: "l", ...more } as Node,
  { id: "l", kind: "lambda", params: ["a", "b"], body: "c" },
  { id: "c", kind: "call", fn: "eq", args: ["ra", "rb"] },
  { id: "eq", kind: "ref", target: "b.eq" },
  { id: "b.eq", kind: "builtin", op: "equal" } as Node,
  { id: "ra", kind: "ref", target: "a" }, { id: "rb", kind: "ref", target: "b" },
  { id: "a", kind: "binder" }, { id: "b", kind: "binder" },
);

test("a definition with results, and which, hashes apart from one without", () => {
  assert.equal(new Set([h(pred({})), h(pred({ results: ["b"] })), h(pred({ results: ["a"] }))]).size, 3);
});

// match x { 1 → 2 }: the arm is its value, not its node's id.
const match = (value: number, id = "k") => code(
  { id: "d", kind: "def", body: "l" },
  { id: "l", kind: "lambda", params: ["x"], body: "m" },
  { id: "m", kind: "match", scrutinee: "rx", arms: ["arm"], otherwise: "o" },
  { id: "rx", kind: "ref", target: "x" }, { id: "x", kind: "binder" },
  { id: "arm", kind: "arm", variant: id, value: id, binds: [], results: [], body: "two" },
  { id, kind: "lit", value }, { id: "two", kind: "lit", value: 2 }, { id: "o", kind: "lit", value: 0 },
);

test("a literal match arm is hashed by its value: editing it changes the hash, writing it again with other ids doesn't", () => {
  assert.notEqual(h(match(1)), h(match(5)));
  assert.equal(h(match(1, "k")), h(match(1, "other")));
});
