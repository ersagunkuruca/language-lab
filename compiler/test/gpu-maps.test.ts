// A page's keep on the GPU (C61 d′, gpu-maps.ts, branches-rt.ts `gpuMap`):
// collatz's test printed as a WebGPU kernel, and the page run in headless
// Chromium (SwiftShader's WebGPU), its second press on the GPU. It must say
// what the CPU says, and run out of the handler's steps where the CPU does.
// Skipped where there is no Chromium with WebGPU.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../../ters/mcp/session.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const dir = mkdtempSync(join(tmpdir(), "gpu-maps-"));

// Chromium: CHROMIUM, or Playwright's own in /opt/pw-browsers.
const chromiumPath = (): string | undefined => {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const d = readdirSync(root).find((x) => /^chromium-\d+$/.test(x));
  const exe = d && join(root, d, "chrome-linux", "chrome");
  return exe && existsSync(exe) ? exe : undefined;
};

// The collatz page: its handler keeps the numbers below b taking over 100
// steps to reach 1, b `first` the first time and `then` after.
// `test`: the keep's test, which may capture the handler's b.
const TEST = "(i) => 100 < ‹steps to one›(i, 0)";
function collatzPage(first: number, then: number, keepTest = TEST, said?: string): string {
  const program = join(dir, `collatz-${first}-${then}-${said ? (said === SUM ? "fold" : "walks") : keepTest === TEST ? "plain" : "captures"}`);
  cpSync(join(import.meta.dirname, "../../ters/examples/collatz"), program, { recursive: true });
  const s = new Session(program);
  s.remove("main");
  s.define("main", "function", []);
  s.step("main", "said", 'cell("")');
  const hole = /□#(\w+)/.exec(s.view("main"))![1];
  const count = said ?? '((n) => write(said, show(b) ++ ": " ++ show(length(n)) ++ " " ++ show(take(n, 3))))(keep(range(b), ' + keepTest + '))';
  s.replace(hole, `tag("main", [button("Count", (event) => ((b) => ${count})(if length(read(said)) = 0 then ${first} else ${then})), p([text(() => read(said))])])`);
  s.save();
  const out = join(program, "page.html");
  const r = spawnSync(process.execPath, [lab, "build-web", program, "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return out;
}

// C42f: a fold adding an Int for each item, in a function the handler
// calls (collatz's `steps of all`), as a kernel of its item's arm.
const SUM = 'write(said, show(b) ++ ": " ++ show(‹steps of all›(range(b))))';
test("a fold adding each item's Int in a page's handler gets a WebGPU kernel of its item's arm, the rest's Int given as 0 (C42f)", () => {
  const html = readFileSync(collatzPage(9000, 9000, TEST, SUM), "utf8");
  assert.match(html, /pageGpu\(\{0:\{how:"add",result:"int",caps:\["int"\]/);
  assert.match(html, /\(lab_xs\[i\], lab_caps\[0\]\)/);
});

// C42g: a fold to a record of Ints (collatz's `walks of`: each field
// added or kept larger), its kernel given each field's identity.
const WALKS = 'write(said, show(b) ++ ": " ++ ((w) => show(w.total) ++ " " ++ show(w.most))(‹walks of›(range(b))))';
test("a fold to a record of Ints in a page's handler gets a WebGPU kernel writing each field, given each field's identity (C42g)", () => {
  const html = readFileSync(collatzPage(9000, 9000, TEST, WALKS), "utf8");
  assert.match(html, /pageGpu\(\{0:\{how:"with",result:"int",caps:\["int","int"\],hows:\["add","max"\]/);
  assert.match(html, /\(lab_xs\[i\], \w+\(lab_caps\[0\], lab_caps\[1\]\)\)/);
  assert.match(html, /lab_out\[i \* 2u \+ 1u\] = r\.\w+;/);
});

test("collatz's keep in a page's handler gets a WebGPU kernel of its test (C61 d′)", () => {
  const html = readFileSync(collatzPage(9000, 9000), "utf8");
  assert.match(html, /pageGpu\(\{0:\{how:"keep",result:"bool"/);
  assert.match(html, /fn lab_main\(/);
  // The walk is a loop counting its steps, its bits as i32 and/shift.
  assert.match(html, /lab_fuel = lab_fuel - 1\.0;/);
  assert.match(html, /lab_ishr/);
  // A test capturing b: b the kernel's input after the item.
  const captures = readFileSync(collatzPage(9000, 9000, "(i) => if i < b then 100 < ‹steps to one›(i, 0) else false"), "utf8");
  assert.match(captures, /caps:\["int"\]/);
  assert.match(captures, /\(lab_xs\[i\], lab_caps\[0\]\)/);
});

const exe = chromiumPath();
test("the page's second press runs the keep on the GPU: the CPU's answer, and out of steps where the CPU is (C61 d′)", { skip: !exe && "no Chromium" }, async () => {
  const { chromium } = await import("../../ters/node_modules/playwright-core/index.mjs");
  const browser = await chromium.launch({ executablePath: exe, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"] });
  try {
    // Each page: the clock 100 times the real one, so the first press's
    // map is measured past the GPU's 5 ms; the GPU's answers read back counted.
    const run = async (file: string, presses: number) => {
      const page = await browser.newPage();
      const said: string[] = [];
      page.on("console", (m: { text(): string }) => { if (/didn't finish/.test(m.text())) said.push("didn't finish"); });
      await page.addInitScript(() => {
        const now = performance.now.bind(performance);
        performance.now = () => now() * 100;
        const w = window as unknown as { submits: number };
        w.submits = 0;
        // Read back: only a run with no validation error gets that far.
        const b = (window as unknown as { GPUBuffer?: { prototype: { getMappedRange(...a: unknown[]): unknown } } }).GPUBuffer?.prototype;
        if (b) { const read = b.getMappedRange; b.getMappedRange = function (...a: unknown[]) { w.submits++; return read.apply(this, a); }; }
      });
      await page.goto(`file://${file}`);
      if (!(await page.evaluate(() => !!(navigator as { gpu?: unknown }).gpu))) return null;
      for (let i = 0; i < presses; i++) {
        const before = await page.evaluate(() => (window as unknown as { submits: number }).submits);
        await page.click("button");
        await page.waitForFunction((b: number) => (window as unknown as { submits: number }).submits > b, before, { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(300);
        said.push(await page.textContent("p") ?? "");
      }
      const submits = await page.evaluate(() => (window as unknown as { submits: number }).submits);
      await page.close();
      return { said, submits };
    };
    const fits = await run(collatzPage(9000, 9000), 2);
    if (!fits) return;
    assert.deepEqual(fits.said, ["9000: 3292 [27, 31, 41]", "9000: 3292 [27, 31, 41]"]);
    assert.ok(fits.submits > 0, "the second press went to the GPU");
    // Below 20000 the walks take some two million steps, past the
    // handler's million: on the GPU as on the CPU, it doesn't finish.
    const over = await run(collatzPage(9000, 20000), 2);
    assert.deepEqual(over!.said, ["9000: 3292 [27, 31, 41]", "didn't finish", "9000: 3292 [27, 31, 41]"]);
    assert.ok(over!.submits > 0, "the second press went to the GPU");
    // A test that captures the handler's b.
    const captures = await run(collatzPage(9000, 9000, "(i) => if i < b then 100 < ‹steps to one›(i, 0) else false"), 2);
    assert.deepEqual(captures!.said, ["9000: 3292 [27, 31, 41]", "9000: 3292 [27, 31, 41]"]);
    assert.ok(captures!.submits > 0, "the second press went to the GPU");
    // C42f: the fold's sum on the GPU, the CPU's.
    const sum = await run(collatzPage(9000, 9000, TEST, SUM), 2);
    assert.equal(sum!.said[0], sum!.said[1]);
    assert.match(sum!.said[0], /^9000: \d+$/);
    assert.ok(sum!.submits > 0, "the second press went to the GPU");
    // C42g: the walks' total and most on the GPU, the CPU's.
    const walks = await run(collatzPage(9000, 9000, TEST, WALKS), 2);
    assert.equal(walks!.said[0], walks!.said[1]);
    assert.match(walks!.said[0], /^9000: \d+ 261$/);
    assert.ok(walks!.submits > 0, "the second press went to the GPU");
  } finally { await browser.close(); }
});
