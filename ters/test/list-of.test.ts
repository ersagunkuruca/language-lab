// A written list is one call with an input per item (L181, PORTS §4,
// FOUNDATIONS-2026-11-03 §6): a list of ten thousand items is checked,
// run and compiled, where ten thousand nested `cons` calls overflow the
// stack of every pass (I154).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { root } from "../src/io.ts";
import { S } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";

const sum = LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === "sum")!;
const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function program(items: (k: Lang) => string[]) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  let list = "";
  k.define(main, k.thunk(() => k.call(S.show, k.call(sum, (list = k.listOf(...items(k)))))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names), main, list };
}

test("list of with three inputs is the list of them: a List Float64, its sum 6", async () => {
  const p = program((k) => [k.lit(1), k.lit(2), k.lit(3)]);
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.equal(showType(p.info.typeOf.get(p.list)!, p.names), "List Float64");
  assert.equal(runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), "6");
  const path = join(mkdtempSync(join(tmpdir(), "list-of-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, "6");
});

test("its items have one type: a Text among numbers is an error at the call", () => {
  const p = program((k) => [k.lit(1), k.lit("two")]);
  assert.ok(p.info.errors.length > 0);
});

test("ten thousand items are checked and run, depth one", () => {
  const p = program((k) => Array.from({ length: 10_000 }, (_, i) => k.lit(i % 7)));
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.equal(runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), String(Array.from({ length: 10_000 }, (_, i) => i % 7).reduce((a, b) => a + b, 0)));
});

test("a written list reads as [a, b, c], as the nested conses do (L181c)", () => {
  const k = new Lang(LIBRARY.code);
  const flat = k.def("flat"), nested = k.def("nested");
  k.define(flat, k.listOf(k.lit(1), k.lit(2), k.lit(3)));
  k.define(nested, k.consList(k.lit(1), k.lit(2), k.lit(3)));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const pres = { names, comments: {}, hints: {}, style: JSON.parse(readFileSync(join(root, "styles", "blocks.json"), "utf8")) };
  const text = (d: string) => renderBlocks(code, pres, info, d).split("\n").slice(1).join(" ").trim();
  assert.equal(text(flat).replace("flat", "nested"), text(nested));
  assert.match(text(flat), /\[1, 2, 3\]/);
});
