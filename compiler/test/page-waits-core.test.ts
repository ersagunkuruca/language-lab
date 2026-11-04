// A page's click handler that waits, printed from the core IR (C40 step 4,
// docs/design/targets/PAGE-WAITS-2026-11-03.md): as in the evaluator
// (ters/test/page-waits.test.ts), what it wrote before the wait shows at
// once, and it goes on when the wait is answered, its next stretch a step
// of its own; a second click meanwhile runs too, the two taking turns at
// their waits. The handler's code takes the rest of its run (scalar.ts
// FType `waits`), which the world's wait keeps in its Pending.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { Cells } from "../../ters/src/lang/cells.ts";
import { browserWorld } from "../../ters/src/lang/browser.ts";
import { mountHtml } from "../../ters/src/lang/html.ts";
import { equal, type Value } from "../../ters/src/lang/run.ts";
import { AWAIT_OP, CELL_OPS, HTML_V, INT_OPS, S, START_TIMER_OP, TEXT_OPS, WAIT_OP } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { fakeDoc, FakeEl, FakeText } from "../../ters/test/fakedom.ts";
import { coreCall, loadCoreJs, lowerCore } from "../src/core-js.ts";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null }; };
const texts = (n: FakeEl | FakeText): string[] => (n instanceof FakeText ? [n.textContent ?? ""] : n.kids.flatMap(texts));
const settle = () => new Promise((r) => setTimeout(r, 5));

// status, a count of saves, and Save: "saving…", a wait, then "saved" and
// one more save; `pause` is how the handler waits.
function saver(pause: (k: Lang) => Id) {
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("status", k.call(CELL_OPS.cell, k.lit("idle")), (status) => k.let("saves", k.call(CELL_OPS.cell, k.int(0)), (saves) =>
    k.call(HTML_V.element, k.lit("div"), k.list(), k.list(
      k.call(HTML_V.text, k.thunk(() => k.call(TEXT_OPS.joinAll, k.list(k.call(CELL_OPS.read, status), k.lit(" "), k.call(INT_OPS.show, k.call(CELL_OPS.read, saves))), k.lit("")))),
      k.call(HTML_V.element, k.lit("button"), k.list(k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.seq(
        k.call(CELL_OPS.write, status, k.lit("saving…")),
        k.call(S.print, k.lit("start")),
        pause(k),
        k.call(CELL_OPS.write, saves, k.call(INT_OPS.add, k.call(CELL_OPS.read, saves), k.int(1))),
        k.call(CELL_OPS.write, status, k.lit("saved")),
        k.call(S.print, k.lit("done")))))), k.list(k.call(HTML_V.text, k.thunk(() => k.lit("Save")))))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), [], "a handler may wait");
  const l = lowerCore(code, info, names, [main]);
  assert.deepEqual([...l.refused.values()], [], "main lowers");
  return { l, fi: l.funcs.findIndex((g) => g.name === "main" && !g.inner) };
}

function open(p: ReturnType<typeof saver>) {
  const timers: { ms: number; go: () => void }[] = [];
  const printed: string[] = [];
  const cells = new Cells(equal);
  const world = browserWorld(memory(), "t", { log: (l: string) => printed.push(l), error: (l: string) => printed.push(`error: ${l}`) } as Console,
    { cells, frame: () => {}, after: (ms) => new Promise<void>((r) => timers.push({ ms, go: r })) });
  const value = loadCoreJs(p.l, { print: (line) => cells.later(() => printed.push(line)), cells, world })[p.fi]() as Value;
  const root = mountHtml(value, { cells, doc: fakeDoc(), call: coreCall }) as unknown as FakeEl;
  const button = (function find(e: FakeEl): FakeEl | undefined { return e.tag === "button" ? e : e.kids.map((c) => (c instanceof FakeEl ? find(c) : undefined)).find(Boolean); })(root)!;
  return { root, button, timers, printed, shown: () => texts(root)[0] };
}

for (const [how, pause] of [
  ["wait(ms)", (k: Lang) => k.call(WAIT_OP, k.lit(500))],
  ["await(start timer(ms))", (k: Lang) => k.call(AWAIT_OP, k.call(START_TIMER_OP, k.lit(500)))],
] as const) {
  test(`on the core IR, a click that waits by ${how} shows what it did before the wait, and goes on after it`, async () => {
    const o = open(saver(pause));
    assert.equal(o.shown(), "idle 0");
    o.button.fire("click");
    assert.equal(o.shown(), "saving… 0");
    assert.deepEqual(o.printed, ["start"]);
    assert.equal(o.timers.length, 1);
    assert.equal(o.timers[0].ms, 500);
    o.timers[0].go();
    await settle();
    assert.equal(o.shown(), "saved 1");
    assert.deepEqual(o.printed, ["start", "done"]);
  });
}

test("on the core IR, a second click while the first waits runs too, and each goes on when its own wait is answered", async () => {
  const o = open(saver((k) => k.call(WAIT_OP, k.lit(500))));
  o.button.fire("click");
  o.button.fire("click");
  assert.equal(o.shown(), "saving… 0");
  assert.deepEqual(o.printed, ["start", "start"]);
  assert.equal(o.timers.length, 2);
  o.timers[1].go();
  await settle();
  assert.equal(o.shown(), "saved 1");
  assert.deepEqual(o.printed, ["start", "start", "done"]);
  o.timers[0].go();
  await settle();
  assert.equal(o.shown(), "saved 2");
  assert.deepEqual(o.printed, ["start", "start", "done", "done"]);
});

// A main that waits (C40, #958 for compile.ts) takes the rest of its run
// last too, and the world sleeps: the same lines and the same waits as
// the evaluator's, on a clock that moves only when it waits.
test("on the core IR, a main that waits prints and waits as the evaluator's", async () => {
  const { runMain } = await import("../../ters/src/lang/run.ts");
  const { runCoreMain } = await import("../src/core-js.ts");
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(k.call(S.print, k.lit("a")), k.call(WAIT_OP, k.lit(100)), k.call(S.print, k.lit("b")),
    k.call(AWAIT_OP, k.call(START_TIMER_OP, k.lit(50))), k.call(S.print, k.lit("c")))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const world = (log: string[]) => { let now = 1000; return { now: () => now, wait: (ms: number) => { log.push(`wait ${ms}`); now += ms; } }; };
  const want: string[] = [], got: string[] = [];
  runMain(code, info, main, { print: (s) => want.push(s), names, world: world(want) });
  const l = lowerCore(code, info, names, [main]);
  assert.deepEqual([...l.refused.values()], []);
  assert.equal(runCoreMain(l, "main", [], { print: (s) => got.push(s), world: world(got) }), 0);
  assert.deepEqual(got, want);
  assert.deepEqual(got, ["a", "wait 100", "b", "wait 50", "c"]);
});
