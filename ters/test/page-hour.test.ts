// I239's example: tumble an hour in the editor's window (10 s snapshots,
// 30 kept), tapped every second (five pointer moves and a press) and a new
// board every two minutes. Its log stays under a fixed size once the
// window is full, the heap stays flat, and a step back works anywhere in
// the window. An hour simulated takes about 20 s, so it runs in Check main
// (slow.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { pageMain, showPage } from "../src/lang/page.ts";
import type { LogEntry } from "../src/lang/worldlog.ts";
import { FakeEl, fakeDoc } from "./fakedom.ts";

const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null }; };

test("tumble an hour in the editor's window: its log and heap stay bounded, and a step back works", () => {
  const p = loadProgram(join(import.meta.dirname, "../examples", "tumble"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const main = pageMain(p.own.defs, info, p.pres.names)!;
  let t = 0;
  const log: LogEntry[] = [];
  const page = showPage({ code: p.code, info, names: p.pres.names, main, program: "tumble", console: { log() {}, error() {} }, frame: () => {}, doc: fakeDoc(), store: store(), log, window: { seconds: 10, keep: 30, clock: () => t } });
  const root = page.root as FakeEl;
  const taps = () => { const a: FakeEl[] = []; const walk = (e: FakeEl) => { if (e.listeners.has("pointerdown")) a.push(e); for (const k of e.kids) if (k instanceof FakeEl) walk(k); }; walk(root); return a; };
  const gc = (globalThis as { gc?: () => void }).gc;
  const heap = () => { gc?.(); return process.memoryUsage().heapUsed; };
  const sizes: number[] = [], heaps: number[] = [];
  for (let s = 1; s <= 3600; s++) {
    t += 1000;
    const cs = taps(), c = cs[(s * 7919) % cs.length];
    for (let m = 0; m < 5; m++) c.fire("pointermove", { clientX: m, clientY: m } as never);
    c.fire("pointerdown", { clientX: 1, clientY: 1 } as never);
    if (s % 120 === 0) root.find("new").fire("click");
    if (s % 600 === 0) { sizes.push(JSON.stringify(log).length); heaps.push(heap()); }
  }
  // Full after five minutes (30 segments of 10 s): from then on the same size.
  for (const b of sizes) assert.ok(Math.abs(b - sizes[0]) < sizes[0] * 0.05, `log ${sizes.join(", ")} bytes`);
  assert.ok(sizes[0] < 200_000, `log ${sizes[0]} bytes`);
  assert.ok(page.window!.dropped > 15_000);
  // Without a collector to call, the heap isn't measured.
  if (gc) assert.ok(heaps[heaps.length - 1] < heaps[0] * 1.2, `heap ${heaps.map((h) => Math.round(h / 1e6)).join(", ")} MB`);
  const steps = page.steps!, n = steps.events(), from = steps.from();
  const shown = (k: number) => { steps.to(k); return root.html(); };
  for (const k of [n - 1, from + 1, Math.floor((n + from) / 2)]) {
    const a = performance.now(), html = shown(k);
    assert.ok(performance.now() - a < 2000, `a step to ${k} took ${Math.round(performance.now() - a)} ms`);
    assert.equal(shown(k), html, `a step to ${k} twice shows the same page`);
  }
  steps.to(n);
  steps.resume();
  root.find("new").fire("click");
  assert.equal(steps.events(), n + 1);
});
