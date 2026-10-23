// The built page in a real browser: open every example program, every
// definition in it, run it, show its values and click its first nodes (and
// once per program, tidy its graph and show a binding as let and get nodes), and
// fail on any error the page throws or logs, or any run or values that
// stop with an error. The unit tests can't catch a view that throws while
// drawing; this can.
//
// Then the same for a browser that saved its programs with an older editor
// (smoke-saved.json: Relations in programs as saved before one world, with
// a builtin that has since gone), changed by its owner or not.
//
//   npm run build-editor && npm run smoke [-- url of another build]
//
// It uses the Chromium in CHROMIUM if set, otherwise the installed Chrome.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright-core";

const page = process.argv[2] ?? new URL("../../index.html", import.meta.url).href;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: "chrome" });
const errors: string[] = [];
let where = "loading";
let defs = 0;

async function visit(saved: string | null, only?: string) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  if (saved) await context.addInitScript((s) => localStorage.setItem("projectional-editor-v5", s), saved);
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${where}: ${m.text()}`); });
  const click = async (selector: string, i = 0) => {
    const el = p.locator(selector).nth(i);
    if (await el.count()) await el.click({ timeout: 500 }).catch(() => {});
  };
  await p.goto(page);
  const programs = await p.locator('[data-set="program"]').allInnerTexts();
  if (programs.length < 2) errors.push(`only ${programs.length} programs in the picker`);
  for (const [i, program] of programs.entries()) {
    if (only && program !== only) continue;
    where = `${saved ? "saved by an older editor: " : ""}${program}`;
    await click('[data-set="program"]', i);
    const names = await p.locator("[data-def]").allInnerTexts();
    for (const [j, def] of names.entries()) {
      where = `${saved ? "saved by an older editor: " : ""}${program} / ${def}`;
      await click("[data-def]", j);
      // A list reads as a list in the blocks too, however tall its items.
      const blocks = await p.locator(".blocks-wrap").first().innerText({ timeout: 500 }).catch(() => "");
      if (/^\s*cons\($/m.test(blocks) && /\bnil\b/.test(blocks)) errors.push(`${where}: a list shows as cons(…) in the blocks`);
      await click('[data-act="t-run"]');
      await click('[data-act="t-values"]');
      await stopped(p);
      for (let k = 0; k < 6; k++) await click(".p-graph [data-id]", k);
      // The graph's menu, and the gestures it offers that only change the
      // layout: once per program, on its first definition.
      if (j === 0) {
        // The keyboard reaches the program: Tab from the blocks selects a part.
        if (await p.locator(".blocks-wrap").count()) {
          // From the last part Tab leaves the program, so step back instead.
          const ids = await p.locator(".blocks-wrap [data-id]:not(.op)").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));
          const at = await p.locator(".blocks-wrap .sel[data-id]").first().getAttribute("data-id", { timeout: 200 }).catch(() => null);
          await p.locator(".blocks-wrap").first().focus();
          await p.keyboard.press(at && at === ids.at(-1) ? "Shift+Tab" : "Tab");
          if (!(await p.locator(".blocks-wrap .sel").count())) errors.push(`${where}: Tab in the blocks selected nothing`);
          await p.keyboard.press("Escape");
        }
        const svg = p.locator(".p-graph svg.canvas");
        const bb = await svg.boundingBox();
        if (bb) {
          await p.mouse.click(bb.x + 8, bb.y + bb.height - 8, { button: "right" });
          await click('.ctx-item[data-menu="tidy-all"]');
          await click(".p-graph .reroute:not(.silent)");
          await p.locator(".p-graph .reroute:not(.silent)").first().click({ button: "right", timeout: 500 }).catch(() => {});
          await click('.ctx-item[data-menu="named"]');
          await stopped(p);
        }
      }
      defs++;
      if (process.env.SMOKE_LOG) console.log(where, Math.round(performance.now()));
    }
  }
  await context.close();
}

// A run or the values that stopped with an error say so in red.
async function stopped(p: Page) {
  for (const line of await p.locator(".status-line.bad").allInnerTexts()) errors.push(`${where}: ${line}`);
}

// A program of your own, deleted and brought back with Undo: nothing is
// lost to a stray click on Delete.
async function deleteAndUndo() {
  where = "delete and undo";
  const p = await browser.newPage();
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${where}: ${m.text()}`); });
  await p.goto(page);
  const programs = async () => (await p.locator(".nav-row:not([data-def])").allInnerTexts()).map((s) => s.trim());
  await p.locator(".nav-row", { hasText: "+ New program" }).click();
  await p.locator('[data-panel="program"]').click();
  await p.locator('button[data-act="delete-program"]').click();
  if ((await programs()).includes("Untitled 1")) errors.push(`${where}: Delete left the program in the list`);
  await p.locator('button[data-act="undo"]').first().click();
  if (!(await programs()).includes("Untitled 1")) errors.push(`${where}: Undo didn't bring the program back`);
  await p.close();
}

// A definition made, filled and deleted: the editor draws the program
// without it (it once drew the deleted one first, and threw).
async function newAndDeleteDefinition() {
  where = "new definition, deleted";
  const p = await browser.newPage();
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${where}: ${m.text()}`); });
  await p.goto(page);
  await p.locator(".nav-row", { hasText: "+ New program" }).click();
  await p.locator(".nav-row", { hasText: "+ New definition" }).click();
  await p.locator('[data-panel="node"]').click();
  await p.locator("#f-def-name").fill("double");
  await p.locator("#f-def-inputs").fill("x");
  await p.locator("button", { hasText: "Create" }).click();
  await p.locator(".hole").first().click();
  await p.locator(".opt").first().click();
  await p.keyboard.press("Escape");
  await p.locator("button", { hasText: "Delete double" }).click();
  if ((await p.locator(".nav-row[data-def]").allInnerTexts()).some((s) => s.trim() === "double")) errors.push(`${where}: Delete left the definition in the list`);
  await p.close();
}

// reactive.html, next to the editor: both Cells programs run, and a click
// and a slider change what they should.
async function cellsPage() {
  where = "reactive.html";
  const p = await browser.newPage();
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${where}: ${m.text()}`); });
  await p.goto(new URL("reactive.html", page).href);
  await p.locator("#counter .ui-button", { hasText: "+" }).click();
  const count = await p.locator("#counter .ui-text").first().innerText();
  if (count !== "1") errors.push(`${where}: the counter shows ${count} after one click`);
  await p.locator("#fractions input[type=range]").nth(1).fill("4");
  const square = await p.locator("#fractions .ui-text").last().innerText();
  if (!square.endsWith("= [4]")) errors.push(`${where}: √4 × √4 shows ${square}`);
  await p.close();
}

// The page programs, live above Run: dice draws and a click changes it,
// it survives the editor redrawing, and Save page gives a file that runs.
async function pagePreview() {
  where = "page preview";
  const ctx = await browser.newContext({ acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${where}: ${m.text()}`); });
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
  const f = p.frameLocator("iframe.page");
  await f.locator("#hundred").click();
  const status = () => f.locator("#status").innerText({ timeout: 2000 }).catch(() => "(no status)");
  if (!(await status()).startsWith("100 rolls")) errors.push(`${where}: after Roll 100 the page says ${await status()}`);
  await p.locator("[data-def]").nth(1).click();
  if (!(await status()).startsWith("100 rolls")) errors.push(`${where}: the editor redrew and the page says ${await status()}`);
  // Its buttons still work after the redraw, and back on main.
  await f.locator("#roll").click();
  if (!(await status()).startsWith("101 rolls")) errors.push(`${where}: Roll after opening another definition: the page says ${await status()}`);
  await p.locator("[data-def]", { hasText: /^main$/ }).click();
  await f.locator("#roll").click();
  if (!(await status()).startsWith("102 rolls")) errors.push(`${where}: Roll after going back to main: the page says ${await status()}`);
  const [file] = await Promise.all([p.waitForEvent("download"), p.locator('[data-act="page-save"]').click()]);
  // Saved where its name says it's a page, or the browser shows it as text.
  const saved = join(mkdtempSync(join(tmpdir(), "smoke-")), file.suggestedFilename());
  await file.saveAs(saved);
  const q = await ctx.newPage();
  q.on("pageerror", (e) => errors.push(`${where}, saved page: ${e.stack ?? e.message}`));
  await q.goto(pathToFileURL(saved).href);
  await q.locator("#hundred").click();
  if (!(await q.locator("#status").innerText()).startsWith("100 rolls")) errors.push(`${where}: the saved page didn't roll`);
  await ctx.close();
}

const saved = readFileSync(new URL("smoke-saved.json", import.meta.url), "utf8");
const edited = JSON.stringify({ ...JSON.parse(saved), docs: { relations: { ...JSON.parse(saved).docs.relations, edited: true } } });
await visit(null);
const fresh = defs;
await visit(saved, "Relations in programs");
await visit(edited, "Relations in programs");
await deleteAndUndo();
await newAndDeleteDefinition();
await pagePreview();
await cellsPage();
await browser.close();
console.log(`${fresh} definitions, and ${defs - fresh} more on programs saved by an older editor`);
if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exit(1);
}
