// Time and Wait (LANGUAGE.md "Time"): the world's clock or a match's, and
// what a page may do with them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { browserWorld } from "../src/lang/browser.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { Cells } from "../src/lang/cells.ts";
import { HTML_V, NOW_OP, S, WAIT_OP } from "../src/lang/std.ts";

test("the clock: the world's when nothing answers, a match's when one does", () => {
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(S.show, k.call(NOW_OP))),
    k.call(S.print, k.call(S.show, k.handle(k.call(NOW_OP), [{ variant: NOW_OP, names: [], body: () => k.lit(7) }]))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const out: string[] = [];
  runMain(code, info, main, { print: (s) => out.push(s), names, world: { now: () => 123 } });
  assert.deepEqual(out, ["123", "7"]);
});

test("Node's world waits, without spinning", () => {
  const w = nodeWorld();
  const t = Date.now();
  w.wait(30);
  assert.ok(Date.now() - t >= 25);
  assert.ok(Math.abs(w.now() - Date.now()) < 50);
});

test("a page's parts may read the clock but not wait", () => {
  const k = new Lang();
  const part = (body: () => string) => k.call(HTML_V.text, k.thunk(body));
  const ok = k.def("clock");
  k.define(ok, k.thunk(() => part(() => k.call(S.show, k.call(NOW_OP)))));
  const bad = k.def("sleepy");
  k.define(bad, k.thunk(() => part(() => k.seq(k.call(WAIT_OP, k.lit(10)), k.lit("late")))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const errors = info.errors.map((e) => `${names[e.id] ?? ""} ${e.message}`);
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /Wait/);
});

test("the browser's clock is a cell written each frame, once something reads it", () => {
  const cells = new Cells();
  let frames: (() => void)[] = [];
  let time = 100;
  const store = { getItem: () => null, setItem() {}, length: 0, key: () => null };
  const w = browserWorld(store, "t", console, { cells, frame: (f) => frames.push(f), time: () => time });
  assert.equal(frames.length, 0);
  const seen: number[] = [];
  cells.watch(() => { seen.push(w.now()); });
  assert.equal(frames.length, 1);
  time = 116;
  const fs = frames; frames = []; fs.forEach((f) => f());
  assert.deepEqual(seen, [100, 116]);
  assert.equal(frames.length, 1);
  assert.throws(() => w.wait(5), /can't wait/);
});
