// `lab run --allow` (E229b): the world answers only what it's allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOnly } from "../src/lang/world.ts";
import type { World } from "../src/lang/run.ts";

const world = { readFile: () => "text", writeFile: () => {}, appendFile: () => {}, fileExists: () => true, listFolder: () => [], fetchText: (u: string) => `got ${u}` } as unknown as World;

test("files only: a fetch is refused with the reason, files are read", () => {
  const w = allowedOnly(world, ["files"]);
  assert.equal(w.readFile("a"), "text");
  assert.throws(() => w.fetchText("https://example.com/x"), /Network \(https:\/\/example.com\/x\) isn't allowed/);
});

test("fetch=host: that host only; files refused", () => {
  const w = allowedOnly(world, ["fetch=example.com"]);
  assert.equal(w.fetchText("https://example.com/x"), "got https://example.com/x");
  assert.throws(() => w.fetchText("https://other.org/"), /isn't allowed/);
  assert.throws(() => w.readFile("a"), /Files isn't allowed/);
});
