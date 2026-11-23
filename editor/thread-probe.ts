// The editor's thread kept free (E319a, docs/reports/EDITOR-THREAD-2026-11-23.md):
// programs whose code loops or takes seconds, opened where the editor runs
// that code, while a PerformanceObserver records the editor's long tasks.
// Each place fails on a task over LONG_MS after the program is open. A
// place whose row isn't built yet is listed in KNOWN with its row: it's
// reported, not failed, and once its row is built it must pass (a known
// place that passes fails too, so its entry is taken off).
//
//   npm run build-editor && npm run thread-probe [-- url of another build]
//
// Each E319 row that moves or bounds a place adds that place here first,
// so its probe shows the freeze before the fix and none after.
//
// It uses the Chromium in CHROMIUM if set, otherwise the installed Chrome.

import playwright from "../ters/node_modules/playwright-core/index.js";
import type { Page } from "../ters/node_modules/playwright-core/index.js";
import { Lang } from "../ters/src/lang/dsl.ts";
import { base, baseNames } from "../ters/src/lang/load.ts";
import { B } from "../ters/src/prelude.ts";
import { CHECK_OP, INT_OPS } from "../ters/src/lang/std.ts";
import { toFile } from "../ters/src/files.ts";
import type { Id } from "../ters/src/model.ts";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../ters/mcp/session.ts";
import { loadProgram } from "../ters/src/lang/load.ts";

const { chromium } = playwright;
const url = process.argv[2] ?? new URL("../index.html", import.meta.url).href;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: "chrome" });

// One frame is 16 ms; a task the size of a few is a stutter, one of
// LONG_MS a freeze.
const LONG_MS = 200;
// The places whose row moves or bounds them, not built yet.
const KNOWN: Record<string, string> = {
  "values on a wire": "E319e",
  // Bounded since E319d (each update 50 ms of the page's own steps); what's
  // left is range's million items, made in one builtin call that takes no
  // steps, and their collection.
  "a page's view": "E319i",
};

// `then`: what the place shows once its work is done, off the thread or not.
type Place = { name: string; file: string; open: (p: Page) => Promise<void>; then?: (p: Page) => Promise<string | null> };

// A definition with no inputs that takes seconds: Show values runs it on
// the editor's thread (main.ts boundedTrace, GIVEN_MS: a 3 s freeze).
function wireValues(): Place {
  const k = new Lang();
  const fib = slowFib(k), slow = k.def("slow");
  k.define(slow, k.call(fib, k.lit(30)));
  return { name: "values on a wire", file: fileOf("Slow wires", k), open: async (p) => { await openDef(p, "slow"); await p.getByText("Show values", { exact: true }).first().click(); } };
}

// A test whose every case takes seconds: Run's Test ran it on the
// editor's thread, with no bound (E319b).
function slowTest(): Place {
  const k = new Lang();
  const fib = slowFib(k), t = k.def("fib is fib");
  const expect = (holds: Id, what: string) => k.call(CHECK_OP, holds, k.lit(what));
  k.define(t, k.fn(["n"], (n) => k.let("a", expect(k.call(INT_OPS.less, n, k.int(1000)), "n is small"), () => expect(k.equal(k.call(fib, k.lit(25)), k.call(fib, k.lit(25))), "fib is fib"))));
  return { name: "a test", file: fileOf("Slow test", k), open: (p) => openDef(p, "fib is fib"),
    then: async (p) => (await p.locator(".run .status-line", { hasText: "Passed" }).first().waitFor({ timeout: 120000 }).then(() => null, async () => `the test didn't pass: ${(await p.locator(".run").first().innerText()).slice(0, 200)}`)) };
}

// The dice page with a view that sums a million numbers: the editor's
// preview runs a page's views and handlers on the editor's thread, where
// compiled code that ends took no steps from the page's budget (238 and
// 720 ms tasks before E319d).
function slowPage(): Place {
  const dir = mkdtempSync(join(tmpdir(), "probe-page-"));
  try {
    cpSync(new URL("../ters/examples/dice", import.meta.url).pathname, dir, { recursive: true });
    const s = new Session(dir);
    s.replace("main", "read(said) ++ show(sum(range(1000000)))", "read(said)");
    s.save();
    const p = loadProgram(dir);
    const file = toFile({ title: "Slow page", typed: true, code: p.code, names: p.pres.names, descriptive: {}, comments: {}, layout: { known: {} }, examples: {}, signatures: p.pins }, base(new Lang().code));
    return { name: "a page's view", file, open: (q) => openDef(q, "main") };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function slowFib(k: Lang): Id {
  const fib = k.def("fib");
  k.define(fib, k.fn(["n"], (n) => k.if(k.equal(n, k.lit(0)), n, k.if(k.equal(n, k.lit(1)), n, k.call(B.add, k.call(fib, k.call(B.sub, n, k.lit(1))), k.call(fib, k.call(B.sub, n, k.lit(2))))))));
  return fib;
}

function fileOf(title: string, k: Lang, examples: Record<Id, string[]> = {}): string {
  return toFile({ title, typed: true, code: base(k.code), names: baseNames(k.names), descriptive: {}, comments: {}, layout: { known: {} }, examples, signatures: {} }, base(new Lang().code));
}

async function openDef(p: Page, name: string) {
  await p.locator("[data-def]", { hasText: new RegExp(`^${name}$`) }).first().click();
}

// The editor's long tasks since the last read, in ms.
const longTasks = (p: Page) => p.evaluate(() => (globalThis as unknown as { labLong: number[] }).labLong.splice(0));

const failures: string[] = [];
for (const place of [wireValues(), slowTest(), slowPage()]) {
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await p.addInitScript(() => {
    const g = globalThis as unknown as { labLong: number[] };
    g.labLong = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) g.labLong.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: false });
  });
  p.on("pageerror", (e) => failures.push(`${place.name}: ${e.message}`));
  await p.goto(url);
  await p.locator('[data-panel="program"]').click();
  const chooser = p.waitForEvent("filechooser");
  await p.locator('[data-act="open-file"]').first().click();
  await (await chooser).setFiles({ name: "probe.json", mimeType: "application/json", buffer: Buffer.from(place.file) });
  // What opening the file costs is E319g's, not this place's.
  await p.waitForTimeout(2000);
  await longTasks(p);
  await place.open(p);
  await p.waitForTimeout(6000);
  const long = (await longTasks(p)).filter((ms) => ms > LONG_MS);
  const row = KNOWN[place.name];
  const said = long.length ? `tasks of ${long.join(", ")} ms` : "no long task";
  if (row) console.log(`${long.length ? "known" : "FIXED"} ${place.name} (${row}): ${said}`);
  else console.log(`${long.length ? "FAIL " : "ok   "} ${place.name}: ${said}`);
  const after = await place.then?.(p);
  if (after) failures.push(`${place.name}: ${after}`);
  if (row ? !long.length : long.length) failures.push(row ? `${place.name} passes now: take it off KNOWN (${row})` : `${place.name}: ${said} on the editor's thread`);
  await p.close();
}
await browser.close();
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
