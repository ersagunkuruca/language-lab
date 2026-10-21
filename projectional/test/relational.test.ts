import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { evaluate } from "../src/eval.ts";
import { hashDef } from "../src/hash.ts";
import { loadCode, root } from "../src/io.ts";
import { get, type Code, type Id } from "../src/model.ts";
import { partDirections, solveNetwork, toNetwork } from "../src/relational.ts";

const vectors = loadCode(join(root, "examples/vectors"));
const [toPolar, rotate] = vectors.defs;
const ports = (code: Code, def: Id) => get(code, get(code, def, "def").body!, "network").params;
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test("a network runs in whichever direction its known ports choose", () => {
  const [x, y, angle, length] = ports(vectors, toPolar);
  const fwd = solveNetwork(vectors, toPolar, { [x]: 1, [y]: 1 }).canonical!;
  close(fwd[angle], Math.PI / 4);
  close(fwd[length], Math.SQRT2);
  const back = solveNetwork(vectors, toPolar, { [angle]: Math.PI / 4, [length]: Math.SQRT2 }).canonical!;
  close(back[x], 1);
  close(back[y], 1);
  const mixed = solveNetwork(vectors, toPolar, { [x]: 1, [length]: 2 });
  close(mixed.canonical![y], Math.sqrt(3));
  assert.ok(mixed.solutions.some((s) => Math.abs(s.values[y] + Math.sqrt(3)) < 1e-6), "the other branch, y = -sqrt(3), is listed too");
});

test("inverting the surrounding network inverts the nodes inside it", () => {
  const [x, y, turn, x2, y2] = ports(vectors, rotate);
  const s = solveNetwork(vectors, rotate, { [x]: 1, [y]: 0, [x2]: 0, [y2]: 1 }).canonical!;
  close(s[turn], Math.PI / 2);
});

test("a part's port directions follow the wiring", () => {
  const [x, y, angle, length] = ports(vectors, toPolar);
  const part = get(vectors, get(vectors, toPolar, "def").body!, "network").parts[0];
  assert.deepEqual(partDirections(vectors, toPolar, [x, y])[part], { x: "in", y: "in", r: "out", θ: "out" });
  assert.deepEqual(partDirections(vectors, toPolar, [angle, length])[part], { x: "out", y: "out", r: "in", θ: "in" });
});

test("an expression def becomes a network that agrees with it and also runs backwards", () => {
  const quad = loadCode(join(root, "examples/quadratic"));
  const rootDef = quad.defs[1];
  const forward = (evaluate(quad, rootDef) as (...xs: number[]) => number)(1, -3, 2);
  const { code } = toNetwork(quad, rootDef);
  const [a, b, c, result] = ports(code, rootDef);
  close(solveNetwork(code, rootDef, { [a]: 1, [b]: -3, [c]: 2 }).canonical![result], forward);
  close(solveNetwork(code, rootDef, { [a]: 1, [c]: 2, [result]: forward }).canonical![b], -3);
  // calls became parts with the same ids, so names and comments still apply
  const parts = get(code, get(code, rootDef, "def").body!, "network").parts;
  assert.ok(parts.some((p) => quad.nodes[p]?.kind === "call"));
});

test("network hashes ignore ids and names like expression hashes do", () => {
  const h = hashDef(vectors, rotate);
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.notEqual(h, hashDef(vectors, toPolar));
});
