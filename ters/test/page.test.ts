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
import { merge } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { HTML_MODULE, LIBRARY } from "../src/lang/library.ts";
import { ABORT_OP } from "../src/lang/std.ts";

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
  assert.match(root.find("status").textContent, /^Rolls: 100;/);
  // the status line reads now(), so it asked for a frame, and asks again
  assert.equal(tick(), 1);
  page.stop();
  assert.equal(tick(), 0);
});

// Pig: one game, run under different handlers. A replay answers Random from
// the numbers the game drew, so it says exactly what the game said.
test("the pig page: a game, its replay word for word, and a thousand games told quietly", () => {
  const { root } = open("pig");
  const lines = () => root.find("lines").textContent;
  root.find("play").fire("click");
  const game = lines();
  assert.match(game, /^(A|B) rolls /);
  assert.match(game, /(A|B) wins, 1\d\d to \d+$/);
  root.find("replay").fire("click");
  assert.equal(lines(), game);
  root.find("many").fire("click");
  const [, a, b] = root.find("tally").textContent.match(/A \(holds at 20\) won (\d+) and B \(holds at 25\) won (\d+)\./)!.map(Number);
  assert.equal(a + b, 1000);
  assert.equal(lines(), game, "the quiet games say nothing on the page");
});

// Tumble: one chain reaction under three strategies. A tap goes to all
// three lanes; each step's animation ending (animationend) shows the next.
test("the tumble page: three lanes agree on one move, and treat a second one tapped mid-chain three ways", () => {
  const { root } = open("tumble");
  const all = (e: FakeEl, f: (e: FakeEl) => boolean, out: FakeEl[] = []) => { if (f(e)) out.push(e); e.kids.forEach((k) => k instanceof FakeEl && all(k, f, out)); return out; };
  const lanes = ["wait", "at once", "step by step"].map((id) => root.find(id));
  const status = () => lanes.map((l) => all(l, (e) => e.attrs.get("id")?.endsWith(" status") ?? false)[0].textContent);
  const logic = () => lanes.map((l) => all(l, (e) => (e.attrs.get("class") ?? "").startsWith("dot")).map((e) => e.attrs.get("class") + (e.attrs.get("style") ?? "")).join("|"));
  // Every step's animation ends, lane by lane, until all three rest.
  const settle = () => {
    for (let n = 0; n < 100; n++) {
      const timers = lanes.map((l) => all(l, (e) => e.attrs.get("class") === "timer")[0]);
      if (timers.every((t) => !t)) return n;
      timers.forEach((t) => t?.fire("animationend"));
    }
    throw new Error("the lanes never came to rest");
  };
  root.find("hint").fire("click");
  const hinted = all(lanes[0], (e) => e.attrs.get("class") === "tap hint");
  assert.equal(hinted.length, 2);
  hinted.forEach((e) => e.fire("pointerdown"));
  assert.deepEqual(status().map((s) => s.split(".")[0]), ["Showing: swap", "Showing: swap", "Showing: swap"]);
  assert.match(status()[1], /still to show: [1-9]/, "all at once worked out the whole chain");
  assert.ok(settle() >= 4);
  const one = logic();
  assert.equal(one[0], one[1]);
  assert.equal(one[1], one[2], "with no tap mid-chain the three strategies end on the same board");
  root.find("two").fire("click");
  assert.match(status()[0], /Taps ignored: 1\./);
  assert.match(status()[2], /Swaps waiting for the next link: 1\./);
  settle();
  assert.match(status()[2], /At rest\. Swaps waiting for the next link: 0\./);
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

// A handler that aborts says so through `stopped`, which the editor's
// preview shows under the page (C143), beside the console's line.
test("a handler that aborts is told to the preview's stopped", () => {
  const lib = (name: string) => HTML_MODULE.exports.find((d) => HTML_MODULE.names[d] === name)!;
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const go = k.call(lib("button"), k.lit("go"), k.fn(["e"], () => k.call(ABORT_OP, k.lit("no more"))));
  k.define(main, k.thunk(() => k.call(lib("div"), k.list(go))));
  const code = merge(LIBRARY.code, k.code), names = { ...LIBRARY.names, ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const said: unknown[] = [];
  const page = showPage({ code, info, names, main, program: "abort", doc: fakeDoc(), store: store(), console: { log() {}, error() {} }, frame: () => {}, stopped: (e) => said.push(e) });
  const real = console.error;
  console.error = () => {};
  try { ((page.root as FakeEl).kids.find((e) => e instanceof FakeEl && e.tag === "button") as FakeEl).fire("click"); } finally { console.error = real; }
  assert.equal(said.length, 1);
  assert.match((said[0] as Error).message, /no more/);
});

// C172g: a page's run, logged (the world's answers and the events its
// handlers were given, with where their elements are), replays in the
// evaluator to the same page: dice's status reads the clock, which the
// log answers, and the clicks are given again to the same buttons.
test("a page's logged run replays to the same page (C172g)", () => {
  const p = loadProgram(join(import.meta.dirname, "../examples", "dice"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const main = pageMain(p.own.defs, info, p.pres.names)!;
  const log: import("../src/lang/worldlog.ts").LogEntry[] = [];
  const base = { code: p.code, info, names: p.pres.names, main, program: "dice", console: { log() {}, error() {} }, frame: () => {} };
  const first = showPage({ ...base, doc: fakeDoc(), store: store(), log });
  const root = first.root as FakeEl;
  root.find("hundred").fire("click");
  root.find("hundred").fire("click");
  const events = log.filter((e) => e.op === "event");
  assert.equal(events.length, 2);
  assert.ok(log.some((e) => e.op === "now"));
  const again = showPage({ ...base, doc: fakeDoc(), store: store(), replay: log });
  assert.equal((again.root as FakeEl).find("said").textContent, root.find("said").textContent);
  assert.equal((again.root as FakeEl).find("status").textContent, root.find("status").textContent);
  assert.match(root.find("status").textContent, /^Rolls: 200;/);
  // A log whose event's element isn't there says so.
  const wrong = log.map((e) => (e.op === "event" ? { ...e, args: [...e.args.slice(0, 6), [9, 9, 9]] } : e));
  assert.throws(() => showPage({ ...base, doc: fakeDoc(), store: store(), replay: wrong }), /went another way/);
});

// I239b (WORLD-LOG-WINDOW.md §2): a page's log as a window. Every 10
// seconds, at the next event, a snapshot of its cells; past the last 3,
// the oldest segment leaves the log, so the log stays as long as 3
// segments however long the page runs.
test("a page's log keeps a window of segments, each from a snapshot", () => {
  const p = loadProgram(join(import.meta.dirname, "../examples", "dice"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const main = pageMain(p.own.defs, info, p.pres.names)!;
  const log: import("../src/lang/worldlog.ts").LogEntry[] = [];
  let t = 0;
  const page = showPage({ code: p.code, info, names: p.pres.names, main, program: "dice", console: { log() {}, error() {} }, frame: () => {}, doc: fakeDoc(), store: store(), log, window: { seconds: 10, keep: 3, clock: () => t } });
  const root = page.root as FakeEl, w = page.window!;
  const lengths: number[] = [];
  for (let i = 0; i < 40; i++) {
    t += 4000;
    root.find("hundred").fire("click");
    lengths.push(log.length);
  }
  assert.match(root.find("status").textContent, /^Rolls: 4000;/);
  // 40 clicks over 160 s: a snapshot every 3 clicks, 3 kept.
  assert.equal(w.snapshots.length, 3);
  assert.ok(w.dropped > 0);
  assert.ok(Math.max(...lengths.slice(20)) <= Math.max(...lengths.slice(0, 20)) + 2, `${lengths}`);
  // Each segment starts at an event, with the cells main made and where
  // the generator was.
  for (const s of w.snapshots) {
    assert.equal(log[s.at]?.op, "event");
    assert.ok(s.state && s.state.cells.length > 0);
  }
});

// I239c (WORLD-LOG-WINDOW.md §3): step back and on through the window,
// from the nearest snapshot; go on from there.
test("a page steps back and on through its log's window, and goes on from a step", () => {
  const p = loadProgram(join(import.meta.dirname, "../examples", "dice"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const main = pageMain(p.own.defs, info, p.pres.names)!;
  const log: import("../src/lang/worldlog.ts").LogEntry[] = [];
  let t = 0;
  const page = showPage({ code: p.code, info, names: p.pres.names, main, program: "dice", console: { log() {}, error() {} }, frame: () => {}, doc: fakeDoc(), store: store(), log, window: { seconds: 10, keep: 3, clock: () => t } });
  const root = page.root as FakeEl, steps = page.steps!;
  const shown = () => [root.find("status").textContent, root.find("said").textContent].join(" | ");
  const after: string[] = [shown()];
  for (let i = 0; i < 6; i++) { t += 4000; root.find("hundred").fire("click"); after.push(shown()); }
  assert.equal(steps.events(), 6);
  // From the run's start (no snapshot yet) and from a snapshot.
  for (const n of [0, 2, 5, 3, 6, 1]) {
    steps.to(n);
    assert.equal(shown(), after[n], `after ${n}`);
  }
  // While stepped, a click isn't given, and nothing is logged.
  const length = log.length;
  root.find("hundred").fire("click");
  assert.equal(shown(), after[1]);
  assert.equal(log.length, length);
  // Going on from the second step drops the old future.
  steps.resume();
  assert.equal(steps.events(), 1);
  root.find("hundred").fire("click");
  assert.equal(steps.events(), 2);
  assert.match(root.find("status").textContent, /^Rolls: 200;/);
  // The window trims as before, and steps from what it keeps.
  for (let i = 0; i < 30; i++) { t += 4000; root.find("hundred").fire("click"); }
  const n = steps.events();
  const last = shown();
  steps.to(n - 4);
  steps.to(n);
  assert.equal(shown(), last);
});

// A step from the run's start draws from the seed the log has: dice's
// plain Roll asks the world's randomness, not a seed of its own.
test("stepping over clicks that draw from the world's randomness shows each roll", () => {
  const p = loadProgram(join(import.meta.dirname, "../examples", "dice"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const main = pageMain(p.own.defs, info, p.pres.names)!;
  let t = 0;
  const page = showPage({ code: p.code, info, names: p.pres.names, main, program: "dice", console: { log() {}, error() {} }, frame: () => {}, doc: fakeDoc(), store: store(), log: [], window: { seconds: 10, keep: 3, clock: () => t } });
  const root = page.root as FakeEl, steps = page.steps!;
  const shown = () => [root.find("status").textContent, root.find("said").textContent].join(" | ");
  const after: string[] = [shown()];
  for (let i = 0; i < 4; i++) { t += 1000; root.find("roll").fire("click"); after.push(shown()); }
  assert.match(after[4], /^Rolls: 4/);
  for (const n of [4, 2, 0, 1, 3]) {
    steps.to(n);
    assert.equal(shown(), after[n], `after ${n}`);
  }
});

// I239f: the compiled page keeps its log as a window too, with its cells
// by place; paused, the interpreted page is built at its last event from
// those snapshots and steps back and on from there, then goes on.
test("the interpreted page steps through the compiled page's window, and goes on from a step", async () => {
  const { lowerCore, corePageScript } = await import("../../compiler/src/core-js.ts");
  const core = await import("../../compiler/src/core-page-runtime.ts");
  const p = loadProgram(join(import.meta.dirname, "../examples", "dice"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const main = pageMain(p.own.defs, info, p.pres.names)!;
  const ir = lowerCore(p.code, info, p.pres.names, p.own.defs);
  let given: unknown[] | null = null;
  new Function("$core", corePageScript(ir, p.pres.names[main], "$core", ""))({ ...core, startCorePage: (...a: unknown[]) => { given = a; } });
  const [tables, worlds, defs, name, , nodes] = given! as never[];
  const log: import("../src/lang/worldlog.ts").LogEntry[] = [];
  let t = 0;
  const window = { seconds: 10, keep: 3, clock: () => t };
  // Interpreted first, one Roll on it, then the compiled page takes over
  // with what was done on it, as the editor's preview does.
  const shownIn = (root: FakeEl) => [root.find("status").textContent, root.find("said").textContent].join(" | ");
  const first = showPage({ code: p.code, info, names: p.pres.names, main, program: "dice", console: { log() {}, error() {} }, frame: () => {}, doc: fakeDoc(), store: store(), log, window, keepCells: true });
  (first.root as FakeEl).find("roll").fire("click");
  const m = core.mountCorePage(tables, worlds, defs, name, "dice", nodes, { doc: fakeDoc(), store: store(), frame: () => {}, log, window, handFrom: first.kept! });
  first.stop();
  const after = [shownIn(m.root as FakeEl)];
  assert.equal(after[0], shownIn(first.root as FakeEl));
  // Plain Rolls draw from the world's randomness; a hundred more with seed 7.
  for (let i = 0; i < 8; i++) { t += 4000; (m.root as FakeEl).find(i % 3 === 2 ? "hundred" : "roll").fire("click"); after.push(shownIn(m.root as FakeEl)); }
  assert.ok(m.window!.snapshots.length > 1);
  m.stop();
  const page = showPage({ code: p.code, info, names: p.pres.names, main, program: "dice", console: { log() {}, error() {} }, frame: () => {}, doc: fakeDoc(), store: store(), log, window, stepFrom: { firsts: m.kept.map((k) => k.first), snapshots: m.window!.snapshots } });
  const root = page.root as FakeEl, steps = page.steps!;
  // The interpreted page's Roll came before: the steps start after it.
  assert.equal(steps.from(), 1);
  assert.equal(steps.at, 9);
  assert.equal(shownIn(root), after[8]);
  for (const n of [5, 0, 7, 2, 8, 1]) { steps.to(n + 1); assert.equal(shownIn(root), after[n], `after ${n}`); }
  assert.throws(() => steps.to(0), /can go back to event 1/);
  steps.to(4);
  steps.resume();
  root.find("roll").fire("click");
  assert.match(root.find("status").textContent, /^Rolls: 104;/);
});

// What the editor does around Pause (I239f): the window's start shown
// with nothing read from the log after, and the page gone on from a step
// handed back to the compiled page.
test("a page stepped to the window's start reads nothing more from the log, and hands back to the compiled page", async () => {
  const { lowerCore, corePageScript } = await import("../../compiler/src/core-js.ts");
  const core = await import("../../compiler/src/core-page-runtime.ts");
  const p = loadProgram(join(import.meta.dirname, "../examples", "dice"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const main = pageMain(p.own.defs, info, p.pres.names)!;
  const ir = lowerCore(p.code, info, p.pres.names, p.own.defs);
  let given: unknown[] | null = null;
  new Function("$core", corePageScript(ir, p.pres.names[main], "$core", ""))({ ...core, startCorePage: (...a: unknown[]) => { given = a; } });
  const [tables, worlds, defs, name, , nodes] = given! as never[];
  let t = 0;
  const window = { seconds: 10, keep: 30, clock: () => t };
  const compiled = (log: import("../src/lang/worldlog.ts").LogEntry[], handFrom?: NonNullable<import("../src/lang/cells.ts").Cells["kept"]>) =>
    core.mountCorePage(tables, worlds, defs, name, "dice", nodes, { doc: fakeDoc(), store: store(), frame: () => {}, log, window, handFrom });
  const log: import("../src/lang/worldlog.ts").LogEntry[] = [];
  const m = compiled(log);
  for (let i = 0; i < 4; i++) { t += 1000; (m.root as FakeEl).find("roll").fire("click"); }
  m.stop();
  const errors: unknown[] = [], frames: (() => void)[] = [];
  const page = showPage({ code: p.code, info, names: p.pres.names, main, program: "dice", console: { log() {}, error() {} }, frame: (f) => frames.push(f), doc: fakeDoc(), store: store(), log, window, keepCells: true, stopped: (e) => errors.push(e), stepFrom: { firsts: m.kept.map((k) => k.first), snapshots: m.window!.snapshots } });
  const root = page.root as FakeEl, steps = page.steps!;
  steps.to(steps.from());
  assert.match(root.find("status").textContent, /^Rolls: 0/);
  // Its clock runs on while stepped, answered live.
  for (let i = 0; i < 3; i++) { t += 1000; frames.splice(0).forEach((f) => f()); }
  assert.deepEqual(errors, []);
  steps.to(1);
  steps.resume();
  assert.match(root.find("status").textContent, /^Rolls: 1;/);
  const back = compiled(log, page.kept!);
  page.stop();
  assert.ok(back.handed > 0);
  assert.match((back.root as FakeEl).find("status").textContent, /^Rolls: 1;/);
});
