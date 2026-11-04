// A tuple is written as its type is, (1, "a"), in the Blocks pane and the
// text views, not tuple(1, "a") (L143; show was L143a).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { renderNested } from "../src/render/nested.ts";
import { renderLet } from "../src/render/letseq.ts";
import { root } from "../src/io.ts";
import { tupleVariant } from "../src/lang/std.ts";

test("a tuple reads as (1, \"a\") in Blocks, Nested and Steps", () => {
  const k = new Lang(LIBRARY.code);
  const pair = k.def("pair");
  k.define(pair, k.call(tupleVariant(2), k.lit(1), k.lit("a")));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const pres = { names, comments: {}, hints: {}, style: JSON.parse(readFileSync(join(root, "styles", "blocks.json"), "utf8")) };
  for (const text of [renderBlocks(code, pres, info, pair), renderNested(code, pres, pair), renderLet(code, pres, pair)]) {
    assert.match(text, /\(1, "a"\)/, text);
    assert.doesNotMatch(text, /tuple\(/, text);
  }
});
