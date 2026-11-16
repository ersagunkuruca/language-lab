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
  assert.throws(() => withSteps(1e12, () => evaluatorCall(part.fields[0] as never), () => performance.now() > t + 50), OutOfSteps);
  assert.ok(performance.now() - t < 2000, `${Math.round(performance.now() - t)} ms`);
});
