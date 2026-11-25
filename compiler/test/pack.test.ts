// pack (compiler/gaps/pack), GAPS.md round 18's program: a made-up
// document packed by LZ77 and Huffman and unpacked again. The evaluator,
// the core IR's module and the hand-written ideal must print the same and
// exit the same way, and so must `ters wasi` and `ters native`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { folder, program, ways } from "../gaps/pack.ts";
import { skip } from "./c-harness.ts";
import { consOnto } from "../../ters/src/lang/cons-onto.ts";
import { PRELUDE_DEFS } from "../../ters/src/lang/prelude-ids.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { CARRIED, uses } from "../../ters/src/lang/represent.ts";
import { LIST } from "../../ters/src/lang/std.ts";
import { wasiImports } from "../src/wasi-imports.ts";

const w = await ways();
const all = (args: string[]) => {
  const want = w.ideal(args, {});
  for (const way of ["evaluator", "core"] as const) assert.deepEqual(w[way](args, {}), want, way);
  return want;
};

test("pack: 200 words packed and back", () => {
  const r = all(["200"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, [
    "200 words, 1113 bytes, Adler-32 " + r.out[0].split(" ").at(-1),
    "LZ77: 350 tokens, 165 of them copies",
    "Huffman: 516 bytes, 46.4% of the text",
    r.out[3],
  ]);
  assert.match(r.out[3], /^Unpacked: 1113 bytes, Adler-32 \d+, the same$/);
});

test("pack: no words, a few, and arguments that aren't numbers", () => {
  assert.equal(all(["0"]).out[0], "0 words, 0 bytes, Adler-32 1");
  for (const args of [["1"], ["7"], ["2.7"], ["x"]]) assert.match(all(args).out[3], /, the same$/);
});

// GAPS round 18 P1 (C229): the bytes come from a Bytes, which kept every
// list as written, so the bytes, read by position, were linked lists and
// the program quadratic. Bytes holds only its own lists: they are trees.
test("pack: what the lists are stored as", () => {
  assert.deepEqual(program().chosen, ["Map as weight-balanced tree", "List as array of List", "Nat as int"]);
});

test("pack: 800 words, from the core IR and the ideal", () => {
  assert.deepEqual(w.core(["800"], {}), w.ideal(["800"], {}));
});

// Past 32 KB a copy still reaches at most 32767 bytes back, what its 15
// bits say: 12800 words came back different before.
test("pack: 12800 words, 72 KB, come back the same", () => {
  const r = w.core(["12800"], {});
  assert.deepEqual(r, w.ideal(["12800"], {}));
  assert.match(r.out[3], /^Unpacked: 72035 bytes, .*, the same$/);
});

// C232: `prose` and `tokens` cons onto a call of themselves; on the tree's
// cons, a call, they were recursions as deep as the words, past
// WebAssembly's stack at 6400 words. Each is a loop now, appending at the
// back (cons-onto.ts), on the arrays too since their append onto what a
// loop carries is a push (C240): past a thousand deep, every call under
// `tokens` ran as a generator.
test("pack: what conses onto a call of itself appends at the back instead", () => {
  const p = program(), made = new Set(Object.entries(p.names).filter(([d]) => p.code.nodes[d]?.kind === "def").map(([, n]) => n));
  for (const n of ["prose onto", "tokens onto", "decoded onto"]) assert.ok(made.has(n), n);
  const q = program(true), c = consOnto(q.code, q.names, q.code.defs, PRELUDE_DEFS["added at end"]);
  assert.ok(new Set(c.made.map((d) => c.names[d])).has("tokens onto"));
});

// C234: an array's append writes the shorter one onto the longer one's
// free end, so `unpacked`'s appends onto what it carries and `flatten`'s
// onto the rest's answer copy nothing; the chooser counts them so and
// takes arrays (the tree was 1.8 times slower at 12800 words).
test("pack: appends onto what a loop carries are the array's own", () => {
  const p = program(true), lists = LIBRARY.reps.filter((r) => r.of === LIST);
  const array = lists.find((r) => r.name === "array of List")!;
  assert.equal(array.cost[CARRIED + PRELUDE_DEFS.append], "1");
  const main = p.code.defs.find((d) => p.names[d] === "main")!;
  assert.ok(uses(p.code, main, lists).includes(CARRIED + PRELUDE_DEFS.append));
  assert.deepEqual(program().chosen, ["Map as weight-balanced tree", "List as array of List", "Nat as int"]);
});

// The program as `ters wasi` and `ters native` build it, on 6400 words
// (WebAssembly's stack, C232).
test("pack through ters wasi and ters native prints what ters run prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "pack-"));
  const want = spawnSync(process.execPath, [lab, "run", folder, "6400"], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["p", "6400"], stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), wasiImports(wasi)));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want.stdout, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "p")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "p"), ["6400"], { encoding: "utf8" }).stdout, want.stdout, "ters native");
});
