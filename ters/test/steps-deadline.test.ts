// A page's step budget with a deadline (run.ts withSteps `over`, I310):
// the editor's seeds run gives the page back on time even where a search
// spends steps without calling a lambda the editor times.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { OutOfSteps, spendStep, withSteps } from "../src/lang/run.ts";

test("a budget runs out when its deadline says so, asked every 1024 steps", () => {
  let asked = 0, spent = 0;
  assert.throws(() => withSteps(1e9, () => { for (;;) { spendStep(); spent++; } }, () => ++asked === 3), OutOfSteps);
  assert.equal(asked, 3);
  assert.ok(spent < 4 * 1024, `${spent} steps`);
});

test("without one, only the count runs out", () => {
  let spent = 0;
  assert.throws(() => withSteps(5000, () => { for (;;) { spendStep(); spent++; } }), OutOfSteps);
  assert.equal(spent, 5000);
});

// I310: the page's view of Countdown searches through definitions that
// end, spending no step (20 s interpreted); the evaluator's machine asks
// the deadline itself.
test("a view whose search spends no step still stops at the deadline", async () => {
  const { loadProgram } = await import("../src/lang/load.ts");
  const { infer } = await import("../src/lang/infer.ts");
  const { runMain } = await import("../src/lang/run.ts");
  const { evaluatorCall } = await import("../src/lang/html.ts");
  const { HTML_V } = await import("../src/lang/std-ids.ts");
  const { Cells } = await import("../src/lang/cells.ts");
  const p = loadProgram(join(import.meta.dirname, "../examples/countdown-page"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  type Html = { tag: string; fields: unknown[] };
  const items = (l: unknown): Html[] => { const out: Html[] = []; for (let c = l as Html; c?.fields?.length === 2; c = c.fields[1] as Html) out.push(c.fields[0] as Html); return out; };
  // The page's first part, a view.
  const todo = [runMain(p.code, info, p.named("main"), { print: () => {}, cells: new Cells() } as never) as Html];
  let part: Html | undefined;
  while (!part && todo.length) { const d = todo.shift()!; if (d.tag === HTML_V.part) part = d; else if (d.tag === HTML_V.element) todo.push(...items(d.fields[2])); }
  assert.ok(part, "the page has a view");
  const t = performance.now();
  let asked = 0;
  assert.throws(() => withSteps(1e12, () => evaluatorCall(part.fields[0] as never), () => (asked++, performance.now() > t + 50)), OutOfSteps);
  assert.ok(performance.now() - t < 2000, `${Math.round(performance.now() - t)} ms`);
  // Asked as it goes, not first after half a second of search (the direct
  // search's calls ask it too): past 50 ms on the first ask, it was once.
  assert.ok(asked > 1, `asked ${asked} times`);
});

// thread-probe's long list: a view of dice whose words count a reversed
// range runs directly, through definitions that end, spending no step;
// the direct run asks the deadline itself, as the machine does, or the
// editor's preview made the whole list on its thread (nightly #44).
test("a view running directly through definitions that end stops at the deadline", async () => {
  const { cpSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { Session } = await import("../mcp/session.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { infer } = await import("../src/lang/infer.ts");
  const { runMain } = await import("../src/lang/run.ts");
  const { evaluatorCall, htmlText } = await import("../src/lang/html.ts");
  const { Cells } = await import("../src/lang/cells.ts");
  const dir = mkdtempSync(join(tmpdir(), "deadline-"));
  cpSync(join(import.meta.dirname, "../examples/dice"), dir, { recursive: true });
  const s = new Session(dir);
  s.replace("main", "read(said) ++ show(length(reverse(range(3000000))))", "read(said)");
  s.save();
  const p = loadProgram(dir);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const page = runMain(p.code, info, p.named("main"), { print: () => {}, cells: new Cells(), random: () => 0.5 } as never);
  // The deadline passes once range has made its items (it asks every
  // 65,536 of them, 45 times here), as when the editor's range ended
  // first. reverse and length ask it too, so the view stops in a few ms;
  // they asked first once the reversed list was made (1.5 s here, and the
  // editor's twenty million ran its tab out of memory).
  const t = performance.now();
  let asked = 0;
  assert.throws(() => withSteps(1e12, () => htmlText(page as never, evaluatorCall), () => ++asked > 45), OutOfSteps);
  assert.ok(performance.now() - t < 1000, `${Math.round(performance.now() - t)} ms`);
});
