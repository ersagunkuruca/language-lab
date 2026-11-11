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
function collatzPage(first: number, then: number): string {
  const program = join(dir, `collatz-${first}-${then}`);
  cpSync(join(import.meta.dirname, "../../ters/examples/collatz"), program, { recursive: true });
  const s = new Session(program);
  s.remove("main");
  s.define("main", "function", []);
  s.step("main", "said", 'cell("")');
  const hole = /□#(\w+)/.exec(s.view("main"))![1];
  const count = '((n) => write(said, show(b) ++ ": " ++ show(length(n)) ++ " " ++ show(take(n, 3))))(keep(range(b), (i) => 100 < ‹steps to one›(i, 0)))';
  s.replace(hole, `tag("main", [button("Count", (event) => ((b) => ${count})(if length(read(said)) = 0 then ${first} else ${then})), p([text(() => read(said))])])`);
  s.save();
  const out = join(program, "page.html");
  const r = spawnSync(process.execPath, [lab, "build-web", program, "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return out;
}

test("collatz's keep in a page's handler gets a WebGPU kernel of its test (C61 d′)", () => {
  const html = readFileSync(collatzPage(9000, 9000), "utf8");
  assert.match(html, /pageGpu\(\{0:\{how:"keep",result:"bool"/);
  assert.match(html, /fn lab_main\(/);
  // The walk is a loop counting its steps, its bits as i32 and/shift.
  assert.match(html, /lab_fuel = lab_fuel - 1\.0;/);
  assert.match(html, /lab_ishr/);
});

const exe = chromiumPath();
test("the page's second press runs the keep on the GPU: the CPU's answer, and out of steps where the CPU is (C61 d′)", { skip: !exe && "no Chromium" }, async () => {
  const { chromium } = await import("../../ters/node_modules/playwright-core/index.mjs");
  const browser = await chromium.launch({ executablePath: exe, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"] });
  try {
    // Each page: the clock 100 times the real one, so the first press's
    // map is measured past the GPU's 5 ms; the GPU's submits counted.
    const run = async (file: string, presses: number) => {
      const page = await browser.newPage();
      const said: string[] = [];
      page.on("console", (m: { text(): string }) => { if (/didn't finish/.test(m.text())) said.push("didn't finish"); });
      await page.addInitScript(() => {
        const now = performance.now.bind(performance);
        performance.now = () => now() * 100;
        const w = window as unknown as { submits: number; GPUQueue?: { prototype: { submit(...a: unknown[]): unknown } } };
        w.submits = 0;
        const q = w.GPUQueue?.prototype;
        if (q) { const submit = q.submit; q.submit = function (...a: unknown[]) { w.submits++; return submit.apply(this, a); }; }
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
  } finally { await browser.close(); }
});
