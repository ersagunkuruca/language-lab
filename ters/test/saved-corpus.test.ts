// Saved programs keep opening (L184, BLIND-SPOTS-2026-11-03.md §1): real
// files saved by the editor during the bigger-program rounds (round 7's
// sheet, round 8's board, round 10's clinic; project files, gzipped here),
// each opened as the editor opens a file. Each opens, checks with no
// errors and gives its main the type it had. A library definition whose
// content changed since is read at its new id (library/moved.json), and
// nodes saved in an older shape are moved through model.ts SHAPE_STEPS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fromFile, toFile } from "../src/files.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { infer } from "../src/lang/infer.ts";
import { showType } from "../src/lang/types.ts";
import { SHAPE, SHAPE_STEPS, toTodaysShape } from "../src/model.ts";

const CORPUS: [string, string][] = [
  ["sheet", "(List Text) -[Console, Diverge, Files, Abort]-> a"],
  ["board", "() -[Cells]-> Html"],
  ["clinic", "() -[Console, Diverge, Files, Abort]-> Unit"],
];
const read = (name: string) => gunzipSync(readFileSync(join(import.meta.dirname, "corpus", `${name}.json.gz`))).toString("utf8");

for (const [name, main] of CORPUS) {
  test(`${name}, saved by an older editor, opens, checks and keeps its main`, () => {
    const r = fromFile(read(name), () => LIBRARY.code);
    assert.ok(!("error" in r), "error" in r ? r.error : "");
    if ("error" in r) return;
    const names = { ...LIBRARY.names, ...r.file.names };
    const info = infer(r.code, names);
    assert.deepEqual(info.errors.map((e) => `${names[e.id] ?? e.id}: ${e.message}`), []);
    const m = r.file.code.defs.find((d) => names[d] === "main")!;
    assert.equal(showType(info.schemes.get(m)!.type, names), main);
  });
}

test("a file is saved at today's shape, and a file at today's shape runs no step", () => {
  assert.equal(SHAPE, SHAPE_STEPS.length);
  const r = fromFile(read("sheet"), () => LIBRARY.code);
  if ("error" in r) throw new Error(r.error);
  const again = toFile({ ...r.file, code: r.code }, LIBRARY.code);
  assert.equal(JSON.parse(again).shape, SHAPE);
  const back = fromFile(again, () => LIBRARY.code);
  assert.ok(!("error" in back));
});

test("a saved use of unpolar moves its ports to the function's order, (x, y) → length, angle (L128d3)", () => {
  const nodes: Record<string, unknown> = {
    u: { id: "u", kind: "call", fn: "u.fn", given: { 2: "x", 3: "y", out: "t" }, binds: { 1: "angle" }, body: "b" },
    "u.fn": { id: "u.fn", kind: "ref", target: "std.trig.trig.unpolar" },
  };
  SHAPE_STEPS[1].step(nodes);
  assert.deepEqual(nodes.u, { id: "u", kind: "call", fn: "u.fn", given: { 0: "x", 1: "y", out: "t" }, binds: { 3: "angle" }, body: "b" });
});
