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
import { Session } from "../../ters/mcp/session.ts";
import { cpSync } from "node:fs";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const dir = mkdtempSync(join(tmpdir(), "page-workers-"));

const memoryStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
};

// The page, with `workers` fake workers (none: no Worker at all), its
// clock `fast` times the real one (so a short first map starts them).
function open(script: string, workers: number, errors: string[] = [], fast = 1) {
  const clock = { now: () => performance.now() * fast };
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
    document, localStorage: memoryStore(), console: { ...console, error: (...xs: unknown[]) => void errors.push(xs.map(String).join(" ")) }, performance: clock, setTimeout, queueMicrotask,
    navigator: { hardwareConcurrency: workers + 1 }, requestAnimationFrame: () => 0,
    ...(workers ? { Worker: FakeWorker, Blob: class { text: string; constructor(parts: string[]) { this.text = parts.join(""); } }, URL: { createObjectURL: (b: { text: string }) => { const u = `blob:${blobs.size}`; blobs.set(u, b.text); return u; } } } : {}),
  };
  runInNewContext(script, ctx);
  const root = body.kids[0] as FakeEl;
  const all = (tag: string, e: FakeEl = root): FakeEl[] => [...(e.tag === tag ? [e] : []), ...e.kids.flatMap((k) => (k instanceof FakeEl ? all(tag, k) : []))];
  const status = () => all("p")[0].textContent, picture = () => all("pre")[0].textContent;
  const draw = () => all("button")[0].fire("click");
  const settled = async () => { for (let i = 0; i < 400; i++) await new Promise((r) => setTimeout(r, 5)); };
  // Till the status line says `steps`, the workers' answers coming in.
  const drawn = async (steps: number) => { for (let i = 0; i < 2000 && !status().startsWith(`${steps} steps`); i++) await new Promise((r) => setTimeout(r, 5)); assert.match(status(), new RegExp(`^${steps} steps`)); };
  return { status, picture, draw, drawn, settled, jobs };
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

// A page whose handler keeps the numbers below b that take over 100 steps
// to reach 1 (collatz's), b 9000 the first time and 300000 after: the
// first fits the handler's million steps, the second doesn't.
function collatzPage(name = "collatz-page", count = '((n) => write(said, show(b) ++ ": " ++ show(length(n)) ++ " " ++ show(take(n, 3))))(keep(range(b), (i) => 100 < ‹steps to one›(i, 0)))', first = 9000, example = "collatz", second = 300000): string {
  const program = join(dir, name);
  cpSync(join(import.meta.dirname, `../../ters/examples/${example}`), program, { recursive: true });
  const s = new Session(program);
  s.remove("main");
  s.define("main", "function", []);
  s.step("main", "said", 'cell("")');
  const hole = () => /□#(\w+)/.exec(s.view("main"))![1];
  s.replace(hole(), `tag("main", [button("Count", (event) => ((b) => ${count})(if length(read(said)) = 0 then ${first} else ${second})), p([text(() => read(said))])])`);
  s.save();
  const out = join(dir, `${name}.html`);
  const r = spawnSync(process.execPath, [lab, "build-web", program, "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return /<script>([\s\S]*)<\/script>/.exec(readFileSync(out, "utf8"))![1];
}

// The page in turn and on three workers: what it says after each of two
// presses, what it wrote to the console, and how many jobs went out.
const twice = (script: string) => Promise.all([0, 3].map(async (workers) => {
    const errors: string[] = [], page = open(script, workers, errors, 100);
    page.draw();
    await page.settled();
    const first = page.status();
    page.draw();
    await page.settled();
    return { first, second: page.status(), errors, sent: page.jobs.sent };
  }));

test("a keep in a page's handler goes to the workers, and their steps count against the handler's, as in turn", async () => {
  const [alone, shared] = await twice(collatzPage());
  assert.equal(alone.first, "9000: 3292 [27, 31, 41]");
  assert.deepEqual(shared, { ...alone, sent: shared.sent });
  // The second runs out of steps, on the workers as in turn: the handler
  // didn't finish, and the page keeps what it showed.
  assert.equal(alone.second, alone.first);
  assert.match(alone.errors.join("\n"), /click handler didn't finish/);
  assert.ok(shared.sent > 0, "the numbers went to the workers");
});

test("a fold in a function a page's handler calls goes to the workers too: the function has a copy that waits", async () => {
  const [alone, shared] = await twice(collatzPage("collatz-calls", 'write(said, show(b) ++ ": " ++ show(‹steps of all›(range(b))) ++ ", most " ++ show(‹most steps›(range(b))))', 1000));
  assert.equal(alone.first, "1000: 59431, most 178");
  assert.deepEqual(shared, { ...alone, sent: shared.sent });
  assert.ok(shared.sent > 0, "the numbers went to the workers");
});

test("a count, an all and a first of a search in a page's handler go to the workers, by its first two choices", async () => {
  const [alone, shared] = await twice(collatzPage("queens-page", 'write(said, show(b) ++ ": " ++ show(count(() => queens(b))) ++ " " ++ show(length(all(() => queens(b)))) ++ " " ++ show(first(() => queens(b), () => [])))', 6, "queens-count", 8));
  assert.equal(alone.first, "6: 4 4 [4, 2, 0, 5, 3, 1]");
  assert.equal(alone.second, "8: 92 92 [3, 1, 6, 2, 5, 7, 4, 0]");
  assert.deepEqual(shared, { ...alone, sent: shared.sent });
  assert.ok(shared.sent > 0, "the pieces went to the workers");
});
