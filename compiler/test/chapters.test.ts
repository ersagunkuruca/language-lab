// chapters (ters/examples/chapters), the file-writing program of
// GAPS.md round 2: the evaluator, the compiled code and the hand-written
// ideal must print the same, leave the same files and exit the same way,
// failures included.

import { test } from "node:test";
import assert from "node:assert/strict";
import { book, ways } from "../gaps/chapters.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>) => {
  const want = w.ideal(args, files);
  assert.deepEqual(w.compiled(args, files), want);
  assert.deepEqual(w.evaluator(args, files), want);
  return want;
};

test("chapters: a small book, file by file", () => {
  const r = all(["book.md", "out"], {
    "book.md": "Before the first heading.\n\n# Hello, World!\none  two\n\n# Hello, World!\nthree\n# ***\n",
    "out/chapters.log": "an earlier run\n",
  });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ["wrote 4 chapters and contents.md to out (7 words)"]);
  assert.deepEqual(Object.keys(r.files), ["book.md", "out/01-preface.md", "out/02-hello-world.md", "out/03-hello-world-2.md", "out/04-section.md", "out/chapters.log", "out/contents.md"]);
  assert.equal(r.files["out/02-hello-world.md"], "# Hello, World!\none  two\n\n");
  assert.equal(r.files["out/chapters.log"], "an earlier run\nwrote 01-preface.md: Preface\nwrote 02-hello-world.md: Hello, World!\nwrote 03-hello-world-2.md: Hello, World!\nwrote 04-section.md: ***\n");
  assert.equal(r.files["out/contents.md"], "# Contents\n\n1. [Preface](01-preface.md) — 4 words\n2. [Hello, World!](02-hello-world.md) — 2 words\n3. [Hello, World!](03-hello-world-2.md) — 1 word\n4. [***](04-section.md) — 0 words\n");
});

test("chapters: a generated book of 100 chapters", () => {
  const r = all(["book.md", "out"], { "book.md": book(100) });
  assert.equal(r.code, 0);
  assert.equal(Object.keys(r.files).length, 1 + 101 + 2);
});

test("chapters: what goes wrong, and the exit codes", () => {
  assert.deepEqual(all(["book.md"], {}), { out: [], err: ["usage: chapters book.md folder"], code: 2, files: {} });
  assert.deepEqual(all(["nope.md", "out"], {}), { out: [], err: ["chapters: no such file or folder: nope.md"], code: 1, files: {} });
  assert.deepEqual(all(["book.md", "out"], { "book.md": "\n \n" }).err, ["chapters: book.md has no text"]);
  // A write that fails stops the run there, with what was written before.
  const r = all(["book.md", "ro"], { "book.md": "# One\nword\n" });
  assert.deepEqual([r.code, r.err, Object.keys(r.files)], [1, ["chapters: permission denied: ro/01-one.md"], ["book.md"]]);
});
