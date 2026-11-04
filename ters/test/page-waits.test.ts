// A page's click handler that waits (C40, docs/design/targets/
// PAGE-WAITS-2026-11-03.md, Ersagun 2026-11-04): what it wrote before the
// wait shows at once, and it goes on when the wait is answered, its next
// stretch a step of its own. A second click meanwhile runs too, the two
// taking turns at their waits. `wait(ms)` and `await` of a timer both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { showPage } from "../src/lang/page.ts";
import { AWAIT_OP, CELL_OPS, HTML_V, INT_OPS, S, START_TIMER_OP, TEXT_OPS, WAIT_OP } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";
import { fakeDoc, FakeEl, FakeText } from "./fakedom.ts";

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
  return { code, names, info, main };
}

function open(p: ReturnType<typeof saver>) {
  const timers: { ms: number; go: () => void }[] = [];
  const printed: string[] = [];
  const page = showPage({ code: p.code, info: p.info, names: p.names, main: p.main, program: "t", doc: fakeDoc(), store: memory(), frame: () => {},
    console: { log: (l: string) => printed.push(l), error: (l: string) => printed.push(`error: ${l}`) },
    after: (ms) => new Promise<void>((r) => timers.push({ ms, go: r })) });
  const root = page.root as FakeEl;
  const button = (function find(e: FakeEl): FakeEl | undefined { return e.tag === "button" ? e : e.kids.map((c) => (c instanceof FakeEl ? find(c) : undefined)).find(Boolean); })(root)!;
  return { root, button, timers, printed, shown: () => texts(root)[0] };
}

for (const [how, pause] of [
  ["wait(ms)", (k: Lang) => k.call(WAIT_OP, k.lit(500))],
  ["await(start timer(ms))", (k: Lang) => k.call(AWAIT_OP, k.call(START_TIMER_OP, k.lit(500)))],
] as const) {
  test(`a click that waits by ${how} shows what it did before the wait, and goes on after it`, async () => {
    const o = open(saver(pause));
    assert.equal(o.shown(), "idle 0");
    o.button.fire("click");
    // The stretch before the wait has landed: shown and printed, once.
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

test("a second click while the first waits runs too, and each goes on when its own wait is answered", async () => {
  const o = open(saver((k) => k.call(WAIT_OP, k.lit(500))));
  o.button.fire("click");
  o.button.fire("click");
  assert.equal(o.shown(), "saving… 0");
  assert.deepEqual(o.printed, ["start", "start"]);
  assert.equal(o.timers.length, 2);
  // The second's wait is answered first: it goes on, the first still waits.
  o.timers[1].go();
  await settle();
  assert.equal(o.shown(), "saved 1");
  assert.deepEqual(o.printed, ["start", "start", "done"]);
  o.timers[0].go();
  await settle();
  assert.equal(o.shown(), "saved 2");
  assert.deepEqual(o.printed, ["start", "start", "done", "done"]);
});
