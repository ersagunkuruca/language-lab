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
  // Five tasks of 80 to 200 ms, one of them (its graph drawn, or the
  // click's own) sometimes over.
  "opening a large definition": "E319k",
};

// `then`: what the place shows once its work is done, off the thread or not.
// `opening`: what's measured is the file's opening itself.
type Place = { name: string; file: string; open: (p: Page) => Promise<void>; then?: (p: Page) => Promise<string | null>; opening?: true };

// A definition with no inputs that takes seconds: Show values ran it on
// the editor's thread (main.ts boundedTrace, GIVEN_MS: a 3 s freeze); now
// QUICK_MS there and the rest in the worker (E319e).
function wireValues(): Place {
  const k = new Lang();
  const fib = slowFib(k), slow = k.def("slow");
  k.define(slow, k.call(fib, k.lit(30)));
  return { name: "values on a wire", file: fileOf("Slow wires", k), open: async (p) => { await openDef(p, "slow"); await p.getByText("Show values", { exact: true }).first().click(); },
    then: async (p) => ((await p.getByText("Gives 832040", { exact: false }).count()) ? null : `the worker didn't give fib(30): ${(await p.locator(".hint").allInnerTexts()).join(" | ").slice(0, 300)}`) };
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

// The dice page with a view that sums three million numbers: the editor's
// preview runs a page's views and handlers on the editor's thread, where
// compiled code that ends took no steps from the page's budget (at a million, 238 and
// 720 ms tasks before E319d).
function slowPage(): Place {
  return { name: "a page's view", file: exampleFile("dice", "Slow page", (s) => s.replace("main", "read(said) ++ show(sum(range(3000000)))", "read(said)")), open: (q) => openDef(q, "main") };
}

// The ray marcher, edited so it isn't the shipped one: the editor lowered
// it to WGSL, WebAssembly and JavaScript and checked its Float32 copy on
// its own thread (E319c), and without a GPU draws it there a slice of rows
// a frame.
function picture(): Place {
  return { name: "a picture", file: exampleFile("raymarch", "Slow picture", (s) => s.replace("colour", "rgb(1, 0, 0.9)", "rgb(1, 0, 1)")), open: (q) => openDef(q, "colour"),
    then: drew };
}

// Mandelbrot with ten thousand times the steps a pixel, so a pixel in the
// set takes milliseconds: without a GPU the editor drew its rows on its
// own thread, at least a row at a time (E319c).
function slowPixels(): Place {
  return { name: "a picture's pixels", file: exampleFile("mandelbrot", "Slow pixels", (s) => {
    s.replace("escape", "2999999 < steps", "299 < steps");
    s.replace("colour", "6000000", "600");
    s.replace("colour", "2999999 < steps", "299 < steps");
  }), open: (q) => openDef(q, "colour"), then: drew };
}

// Whether the picture drew, on the GPU or the CPU, and didn't stop.
async function drew(q: Page): Promise<string | null> {
  const said = await q.locator(".pic-status").first().innerText();
  return /Can't|stopped|Drawing…/.test(said) || await q.locator("canvas.picture").first().isHidden() ? `the picture didn't draw: ${said}` : null;
}

// Constructions, one of the largest examples that isn't a page, opened
// from a file: the editor checked the whole program on its thread to draw
// it (E319g, a 617 ms task), then drew it, its page's first run and its
// same-as line in one task (E319k, 504 ms).
function opening(): Place {
  return { name: "opening a file", file: exampleFile("constructions", "Opened", () => {}), open: async () => {}, opening: true,
    then: async (q) => ((await q.locator(".p-nav [data-def]").count()) ? null : "the program didn't show") };
}

// Bounce, its page compiled, paused: the interpreted page is built from
// the program as the compiled page stores it (coreMain.ts checkedForRun),
// which the editor made on its own thread (E319j).
function pausing(): Place {
  return { name: "pausing a compiled page", file: exampleFile("bounce", "Paused", () => {}), open: async (q) => {
    await openDef(q, "main");
    await q.getByRole("button", { name: "Pause", exact: true }).first().waitFor({ timeout: 60000 });
    // The compiled page in place of the interpreted one.
    await q.waitForTimeout(10000);
    await longTasks(q);
    await q.getByRole("button", { name: "Pause", exact: true }).first().click();
  }, then: async (q) => ((await q.getByRole("button", { name: "Go on from here" }).count()) ? null : "the page didn't pause") };
}

// The dice page with a view that makes a list of twenty million numbers:
// range made its items in one call, with no step from the page's budget
// and no look at its deadline (a 1,202 ms task, E319i). Measured once the
// page is compiled.
function longList(): Place {
  return { name: "a page's long list", file: exampleFile("dice", "Long list", (s) => s.replace("main", "read(said) ++ show(length(reverse(range(20000000))))", "read(said)")), open: async (q) => {
    await openDef(q, "main");
    await q.getByText("Compiling…").first().waitFor({ state: "hidden", timeout: 120000 });
  } };
}

// Spacetime's largest definition opened: its graph and blocks were drawn
// in one task (251 ms, E319h measured), and drawn again with each worker's
// answer (445, 438 and 339 ms tasks before E319k's second step).
function bigDef(): Place {
  return { name: "opening a large definition", file: exampleFile("spacetime", "Big definition", () => {}), open: (q) => openDef(q, "rapidity picture") };
}

// An example copied and changed, as the file the editor opens.
function exampleFile(example: string, title: string, change: (s: Session) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  try {
    cpSync(new URL(`../ters/examples/${example}`, import.meta.url).pathname, dir, { recursive: true });
    const s = new Session(dir);
    change(s);
    s.save();
    const p = loadProgram(dir);
    return toFile({ title, typed: true, code: p.code, names: p.pres.names, descriptive: {}, comments: {}, layout: { known: {} }, examples: {}, signatures: p.pins }, base(new Lang().code));
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
for (const place of [wireValues(), slowTest(), slowPage(), picture(), slowPixels(), opening(), pausing(), longList(), bigDef()].filter((x) => !process.env.PLACE || x.name === process.env.PLACE)) {
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await p.addInitScript(() => {
    const g = globalThis as unknown as { labLong: number[] };
    g.labLong = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) g.labLong.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: false });
  });
  p.on("pageerror", (e) => failures.push(`${place.name}: ${e.message}`));
  await p.goto(url);
  await p.locator('[data-panel="program"]').click();
  // The editor's own start isn't any place's.
  await p.waitForTimeout(2000);
  if (place.opening) await longTasks(p);
  const chooser = p.waitForEvent("filechooser");
  await p.locator('[data-act="open-file"]').first().click();
  await (await chooser).setFiles({ name: "probe.json", mimeType: "application/json", buffer: Buffer.from(place.file) });
  // What opening the file costs is its own place's, not this one's.
  await p.waitForTimeout(2000);
  if (!place.opening) await longTasks(p);
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
