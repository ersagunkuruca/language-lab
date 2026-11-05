// Bytes stored side by side (BACKLOG L189b, bytes-array.ts): a program
// that reads its bytes by position gets the byte array, and prints what
// the definition prints; one that only walks them keeps the list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCoreJs, lowerCore } from "../../compiler/src/core-js.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { runMain } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { withLibraryRepresentations } from "../src/lang/library-reps.ts";
import { CONS, INT_OPS, IO, NIL, S, SHOW_ANY, TEXT_OPS } from "../src/lang/std.ts";
import { nodeWorld } from "../src/lang/world.ts";
import type { Code, Id } from "../src/model.ts";

const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

const printed = (code: Code, names: Record<Id, string>, main: Id, insiders: Id[] = []) => {
  const info = infer(code, names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...insiders] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lines: string[] = [];
  runMain(code, info, main, { print: (s) => lines.push(s), names });
  return lines;
};
const chosen = (p: { code: Code; names: Record<Id, string>; main: Id; own: Id[] }) => {
  const info = infer(p.code, p.names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return withLibraryRepresentations(p.code, info, p.names, p.main, p.own, [], { hostMaps: true });
};

// The sum of every other byte of "hello, bytes", read by position.
function byPosition(walkOnly = false) {
  const k = new Lang(LIBRARY.code);
  const data = k.def("data");
  k.define(data, k.call(L("utf8 of"), k.lit("hello, bytes")));
  const sum = k.def("sum");
  k.define(sum, k.fold(k.call(INT_OPS.range, k.call(L("byte count"), k.x(data))), [
    { variant: NIL, names: [], body: () => k.int(0) },
    { variant: CONS, names: ["i", "rest"], results: [null, "so far"], body: ([i], [, r]) => k.call(INT_OPS.add, r!, k.call(L("byte at"), k.x(data), i, k.int(0))) },
  ]));
  const main = k.def("main");
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  k.define(main, k.thunk(() => k.seq(
    ...(walkOnly ? [] : [show(k.x(sum))]),
    show(k.call(L("text of utf8"), k.x(data))),
    show(k.call(L("hex of"), k.x(data))),
    show(k.x(data)),
  )));
  return { code: base(k.code), names: baseNames(k.names), main, own: walkOnly ? [data, main] : [data, sum, main] };
}

test("bytes read by position are stored side by side, and print what the definition prints", () => {
  const p = byPosition();
  const c = chosen(p);
  assert.deepEqual(c.chosen, ["Bytes as byte array of Bytes"]);
  const plain = printed(p.code, p.names, p.main);
  assert.deepEqual(printed(c.code, c.names, p.main, c.insiders), plain);
  assert.equal(plain[1], "\"hello, bytes\"");
});

test("bytes only walked keep the list they are written as", () => {
  assert.deepEqual(chosen(byPosition(true)).chosen, []);
});

// A file's bytes come in through `read bytes`, which gives the meaning:
// the boundary stores them, and `write bytes` is given the meaning back.
test("read bytes and write bytes meet stored bytes at the border", () => {
  const dir = mkdtempSync(join(tmpdir(), "bytes-array-"));
  const given = join(dir, "given.bin"), made = join(dir, "made.bin");
  writeFileSync(given, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13]));
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  // A PNG's signature read by position, then the file written back.
  k.define(main, k.thunk(() => k.let("png", k.call(IO.readBytes, k.lit(given)), (png) => k.seq(
    show(k.call(L("byte count"), png)),
    show(k.call(L("byte at"), png, k.int(1), k.int(-1))),
    show(k.call(L("byte at"), png, k.int(99), k.int(-1))),
    k.call(IO.writeBytes, k.lit(made), png)))));
  const p = { code: base(k.code), names: baseNames(k.names), main, own: [main] };
  const c = chosen(p);
  assert.deepEqual(c.chosen, ["Bytes as byte array of Bytes"]);
  const run = (code: Code, names: Record<Id, string>, insiders: Id[] = []) => {
    const info = infer(code, names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...insiders] });
    assert.deepEqual(info.errors.map((e) => e.message), []);
    const lines: string[] = [];
    runMain(code, info, main, { print: (s) => lines.push(s), names, world: nodeWorld() });
    return lines;
  };
  assert.deepEqual(run(c.code, c.names, c.insiders), ["12", "80", "-1"]);
  assert.deepEqual([...readFileSync(made)], [...readFileSync(given)]);
});

// The same through the core IR (compiled JavaScript, C137): the byte
// array is a record of an array, which every target has.
test("stored bytes compile through the core IR", () => {
  const k = new Lang(LIBRARY.code);
  const data = k.def("data");
  k.define(data, k.call(L("utf8 of"), k.lit("hé")));
  const answer = k.def("answer");
  k.define(answer, k.call(TEXT_OPS.joinAll, k.list(
    k.call(SHOW_ANY, k.call(L("byte at"), k.x(data), k.int(2), k.int(-1))),
    k.call(SHOW_ANY, k.call(L("byte count"), k.x(data))),
    k.call(L("base64 of"), k.x(data))), k.lit(" ")));
  const p = { code: base(k.code), names: baseNames(k.names), main: answer, own: [data, answer] };
  const c = chosen(p);
  assert.deepEqual(c.chosen, ["Bytes as byte array of Bytes"]);
  const info = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowerCore(c.code, info, c.names, [answer]);
  assert.deepEqual([...l.refused.values()], []);
  const fs = loadCoreJs(l);
  assert.equal(fs[l.funcs.findIndex((g) => g.name === "answer" && !g.inner)](), "169 3 aMOp");
});
