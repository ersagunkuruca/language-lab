// Real files saved by the editor during the bigger-program rounds (round
// 7's sheet, round 8's board, round 10's clinic; project files, gzipped
// here), each opened as the editor opens a file. Each opens, checks with
// no errors and gives its main the type it had. They were brought to
// today's shape and library ids once (2026-11-24), when L184's upgrade
// steps were retired: a file at an older shape is refused, and a change
// of shape or library ids rewrites the saved programs in the repositories.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fromFile, toFile } from "../src/files.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { infer } from "../src/lang/infer.ts";
import { showType } from "../src/lang/types.ts";
import { SHAPE } from "../src/model.ts";

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

test("a file is saved at today's shape, and one at another is refused", () => {
  const r = fromFile(read("sheet"), () => LIBRARY.code);
  if ("error" in r) throw new Error(r.error);
  const again = toFile({ ...r.file, code: r.code }, LIBRARY.code);
  assert.equal(JSON.parse(again).shape, SHAPE);
  const back = fromFile(again, () => LIBRARY.code);
  assert.ok(!("error" in back));
  for (const shape of [undefined, SHAPE - 1]) {
    const old = fromFile(JSON.stringify({ ...JSON.parse(again), shape }), () => LIBRARY.code);
    assert.match("error" in old ? old.error : "", /older version/);
  }
});
