// examples/mnist-page: a network learning MNIST's digits on a page. Built
// as the site builds it (`ters build-web`) and run on a fake document, a
// step at a time: two passes over the 600 training digits name most of
// the 150 test digits right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { FakeEl, fakeDoc } from "./fakedom.ts";

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
};
const byText = (e: FakeEl, t: string): FakeEl | null =>
  e.tag === "button" && e.textContent === t ? e : e.kids.map((k) => (k instanceof FakeEl ? byText(k, t) : null)).find((x) => x) ?? null;
const byClass = (e: FakeEl, c: string): FakeEl | null =>
  e.attrs.get("class") === c ? e : e.kids.map((k) => (k instanceof FakeEl ? byClass(k, c) : null)).find((x) => x) ?? null;

test("the digits page learns: two passes name most test digits right", () => {
  const out = join(mkdtempSync(join(tmpdir(), "mnist-page-")), "page.html");
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../cli/ters.ts"), "build-web", join(import.meta.dirname, "../examples/mnist-page"), "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const script = /<script>([\s\S]*)<\/script>/.exec(readFileSync(out, "utf8"))![1];
  const body = new FakeEl("body");
  const errors: unknown[] = [];
  runInNewContext(script, { document: { ...fakeDoc(), body }, localStorage: store(), console: { log() {}, error: (...a: unknown[]) => errors.push(a) }, requestAnimationFrame: () => 0 });
  const root = body.kids[0] as FakeEl;
  const step = byText(root, "Step")!;
  assert.ok(step, "a Step button");
  const status = () => byClass(root, "status")!.textContent;
  assert.equal(status(), "pass 1, batch 1 of 12");
  for (let i = 0; i < 24; i++) step.fire("click");
  const m = /^pass 3, batch 1 of 12 · last pass's loss ([\d.]+) · test: (\d+) of 150 right$/.exec(status());
  assert.ok(m, status());
  assert.ok(Number(m[1]) < 1.5, `loss ${m[1]}`);
  assert.ok(Number(m[2]) >= 90, `${m[2]} right`);
  assert.deepEqual(errors, []);
});
