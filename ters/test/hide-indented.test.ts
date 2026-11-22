// Hide works on an indented part as on one that fits a line (Ersagun
// 2026-11-22: "hide works only for non indented stuff"): the part reads as
// one "…" and what holds it closes up around it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { blocksOf, blocksText } from "../src/lang/render.ts";
import { isCall, subtree, type Id } from "../src/model.ts";

const p = loadProgram(join(root, "examples", "queens"));
const safe = p.own.defs.find((d) => p.pres.names[d] === "safe")!;
const body = (p.code.nodes[safe] as { body: Id }).body;
const view = (shape: Record<Id, "hidden"> = {}) => blocksText(blocksOf(p.code, p.pres, null, safe, { pane: true, shape })).join("\n");

test("an indented call picked Hide reads as …", () => {
  assert.ok(view().split("\n").length > 4, "the fold is laid out indented");
  const fold = subtree(p.code, body).find((x) => isCall(p.code.nodes[x]))!;
  assert.match(view({ [fold]: "hidden" }), /^safe\(column, placed\) = …$/m);
});

test("an indented operator chain picked Hide reads as …, its case on one line", () => {
  const and = subtree(p.code, body).filter((x) => isCall(p.code.nodes[x])).find((x) => /with ‹others safe› → …$/m.test(view({ [x]: "hidden" })));
  assert.ok(and, "the and chain hides");
  assert.doesNotMatch(view({ [and!]: "hidden" }), /queen = column/);
});
