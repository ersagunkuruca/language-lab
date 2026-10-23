// The live preview of a page program (src/lang/page.ts): the example apps
// open, draw and react the way their built pages do, and a stopped preview
// asks for no more frames.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { pageMain, showPage } from "../src/lang/page.ts";
import { FakeEl, fakeDoc } from "./fakedom.ts";

const store = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
};

const open = (name: string) => {
  const p = loadProgram(join(import.meta.dirname, "../examples", name));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const main = pageMain(p.own.defs, info, p.pres.names);
  assert.ok(main, `${name} is a page`);
  let frames: (() => void)[] = [];
  const page = showPage({ code: p.code, info, names: p.pres.names, main, program: name, doc: fakeDoc(), store: store(), console: { log() {}, error() {} }, frame: (f) => frames.push(f) });
  const tick = () => { const fs = frames; frames = []; fs.forEach((f) => f()); return frames.length; };
  return { root: page.root as FakeEl, page, tick, p, info };
};

test("the dice page previews: Roll draws, the clock runs on frames, stop stops it", () => {
  const { root, page, tick } = open("dice");
  assert.match(root.find("said").textContent, /Nothing rolled yet/);
  root.find("hundred").fire("click");
  assert.match(root.find("status").textContent, /^100 rolls/);
  // the status line reads now(), so it asked for a frame, and asks again
  assert.equal(tick(), 1);
  page.stop();
  assert.equal(tick(), 0);
});

test("the converter previews: typing in one field moves the others", () => {
  const { root } = open("converter");
  const inputs: FakeEl[] = [];
  const all = (e: FakeEl) => { if (e.tag === "input") inputs.push(e); e.kids.forEach((k) => k instanceof FakeEl && all(k)); };
  all(root);
  inputs[1].type_("212");
  assert.equal(inputs[0].value, "100");
});

test("a program whose main isn't a page has no page main", () => {
  const p = loadProgram(join(import.meta.dirname, "../examples/wc"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  assert.equal(pageMain(p.own.defs, info, p.pres.names), null);
});
