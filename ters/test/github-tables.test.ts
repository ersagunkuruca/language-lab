// The Changes tab reads a folder's tables from GitHub (E263): it asks
// which files the folder has first, and fetches only those, so a table it
// hasn't is no 404 in the console (I257). Past GitHub's limit for reading
// without signing in, it tries every table as before.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tablesAt } from "../../editor/github.ts";

function fakeGitHub(listing: number): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    if (url.includes("api.github.com")) return new Response(listing === 200 ? JSON.stringify([{ name: "code.json" }, { name: "names.default.json" }, { name: "README.md" }]) : "{}", { status: listing });
    if (url.endsWith("/code.json")) return new Response('{"nodes": {}, "defs": []}');
    if (url.endsWith("/names.default.json")) return new Response('{"a": "b"}');
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return asked;
}

test("only the tables the folder has are fetched", async () => {
  const asked = fakeGitHub(200);
  const t = await tablesAt("0123456789abcdef0123456789abcdef01234567", "dice");
  assert.deepEqual(Object.keys(t).sort(), ["code", "names"]);
  assert.deepEqual(asked.filter((u) => u.includes("raw.githubusercontent")).map((u) => u.split("/").pop()).sort(), ["code.json", "names.default.json"]);
  assert.ok(asked[0].includes("/contents/ters/examples/dice?ref=0123456789abcdef"));
});

test("past the limit, every table is tried", async () => {
  const asked = fakeGitHub(403);
  const t = await tablesAt("main", "dice");
  assert.deepEqual(Object.keys(t).sort(), ["code", "names"]);
  assert.equal(asked.filter((u) => u.includes("raw.githubusercontent")).length, 9);
});

test("a folder the revision hasn't is said", async () => {
  fakeGitHub(404);
  await assert.rejects(tablesAt("main", "nowhere"), /main has no ters\/examples\/nowhere/);
});
