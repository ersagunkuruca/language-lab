// A map on a page's workers (C61 c′, branches-rt.ts mapAway): the page
// built by `ters build-web` and run against a fake document, with fake
// workers that run the same script in contexts of their own and answer by
// messages, later, as a browser's do. The picture must be the one drawn in
// turn, and while the workers have the rows the page shows nothing new.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { FakeEl, fakeDoc } from "../../ters/test/fakedom.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const dir = mkdtempSync(join(tmpdir(), "page-workers-"));

const memoryStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
};

// The page, with `workers` fake workers (none: no Worker at all).
function open(script: string, workers: number) {
  const blobs = new Map<string, string>(), jobs = { sent: 0 };
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    private ctx: { onmessage: ((e: { data: unknown }) => void) | null };
    constructor(url: string) {
      const self = this;
      this.ctx = { onmessage: null };
      Object.assign(this.ctx, {
        console, performance, setTimeout, importScripts() {},
        navigator: { hardwareConcurrency: workers + 1 },
        postMessage: (m: unknown) => setTimeout(() => self.onmessage?.({ data: structuredClone(m) })),
      });
      runInNewContext(blobs.get(url)!, this.ctx);
    }
    postMessage(m: unknown) { jobs.sent++; setTimeout(() => this.ctx.onmessage?.({ data: structuredClone(m) })); }
  }
  const body = new FakeEl("body");
  const document = { ...fakeDoc(), body, currentScript: { textContent: script } };
  const ctx: Record<string, unknown> = {
    document, localStorage: memoryStore(), console, performance, setTimeout, queueMicrotask,
    navigator: { hardwareConcurrency: workers + 1 }, requestAnimationFrame: () => 0,
    ...(workers ? { Worker: FakeWorker, Blob: class { text: string; constructor(parts: string[]) { this.text = parts.join(""); } }, URL: { createObjectURL: (b: { text: string }) => { const u = `blob:${blobs.size}`; blobs.set(u, b.text); return u; } } } : {}),
  };
  runInNewContext(script, ctx);
  const root = body.kids[0] as FakeEl;
  const all = (tag: string, e: FakeEl = root): FakeEl[] => [...(e.tag === tag ? [e] : []), ...e.kids.flatMap((k) => (k instanceof FakeEl ? all(tag, k) : []))];
  const status = () => all("p")[0].textContent, picture = () => all("pre")[0].textContent;
  const draw = () => all("button")[0].fire("click");
  // Till the status line says `steps`, the workers' answers coming in.
  const drawn = async (steps: number) => { for (let i = 0; i < 2000 && !status().startsWith(`${steps} steps`); i++) await new Promise((r) => setTimeout(r, 5)); assert.match(status(), new RegExp(`^${steps} steps`)); };
  return { status, picture, draw, drawn, jobs };
}

test("a map in a page's handler goes to the page's workers and draws the picture drawn in turn, the page held meanwhile", async () => {
  const out = join(dir, "page.html");
  const r = spawnSync(process.execPath, [lab, "build-web", join(import.meta.dirname, "../../ters/examples/mandelbrot-page"), "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const script = /<script>([\s\S]*)<\/script>/.exec(readFileSync(out, "utf8"))![1];

  // In turn: no workers.
  const alone = open(script, 0);
  const inTurn: string[] = [];
  for (let n = 1; n <= 3; n++) { alone.draw(); await alone.drawn(1000 * n); inTurn.push(alone.picture()); }

  const page = open(script, 3);
  // The first draw runs here, timed, and starts the workers.
  page.draw();
  await page.drawn(1000);
  assert.equal(page.picture(), inTurn[0]);
  // The second goes to them: till they answer, the page shows the first,
  // and a click meanwhile waits its turn.
  page.draw();
  assert.match(page.status(), /^1000 steps/);
  assert.equal(page.picture(), inTurn[0]);
  page.draw();
  assert.ok(page.jobs.sent > 0, "the rows went to the workers");
  await page.drawn(3000);
  assert.equal(page.picture(), inTurn[2]);
});
