// The built page in a real browser: open every example program, its first
// definition, its main and a slice of the rest (a different eighth each
// run, all of them with SWEEP=all, as the nightly run does: TESTING.md T4),
// run each, show its values and click its first nodes (and
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
import { inSweep } from "../test/helpers.ts";

const page = process.argv[2] ?? new URL("../../index.html", import.meta.url).href;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: "chrome" });
const errors: string[] = [];
let where = "loading";
let defs = 0;
let seen = 0;

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
      if (j > 0 && def.trim() !== "main" && !inSweep(seen++)) continue;
      where = `${saved ? "saved by an older editor: " : ""}${program} / ${def}`;
      await click("[data-def]", j);
      // A list reads as a list in the blocks too, however tall its items.
      const blocks = await p.locator(".blocks-wrap").first().innerText({ timeout: 500 }).catch(() => "");
      if (/^\s*cons\($/m.test(blocks) && /\bnil\b/.test(blocks)) errors.push(`${where}: a list shows as cons(…) in the blocks`);
      await click('[data-act="t-run"]');
      // Run goes to a worker, and what it printed comes back.
      if (i === 0 && def.trim() === "main" && await p.locator('[data-act="t-stop"], [data-act="t-run"]').count()) {
        await p.locator('[data-act="t-run"]').waitFor({ timeout: 10000 }).catch(() => errors.push(`${where}: Run didn't finish in 10 s`));
        const out = await p.locator(".run pre.out").innerText({ timeout: 500 }).catch(() => "");
        if (!out || out === "Running…") errors.push(`${where}: Run showed nothing`);
      }
      await click('[data-act="t-values"]');
      await stopped(p);
      // Its first nodes, where a click reaches them: a frame is mostly under
      // its contents, and waiting for it to come out from under them cost
      // half a second a try.
      for (let k = 0; k < 6; k++) {
        const at = await p.locator(".p-graph [data-id]").evaluateAll((els, k) => els.flatMap((e) => {
          const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          return document.elementFromPoint(x, y)?.closest("[data-id]") === e ? [[x, y]] : [];
        })[k], k);
        if (!at) break;
        await p.mouse.click(at[0], at[1]);
      }
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
          // Shift+F10 opens the selected part's menu, and Escape closes it.
          await p.keyboard.press("Shift+F10");
          if (!(await p.locator(".ctx-menu").count())) errors.push(`${where}: Shift+F10 opened no menu`);
          await p.keyboard.press("Escape");
          await p.keyboard.press("Escape");
        }
        const svg = p.locator(".p-graph svg.canvas");
        const bb = await svg.boundingBox();
        if (bb) {
          await p.mouse.click(bb.x + 8, bb.y + bb.height - 8, { button: "right" });
          await click('.ctx-item[data-menu="tidy-all"]');
          // The map, when part of the graph is out of the window.
          if (await p.locator(".p-graph .minimap").isVisible().catch(() => false)) {
            // Drawn with the graph's own colours: a frame there was once black.
            const black = await p.locator(".p-graph .minimap .rg").evaluateAll((els) => els.filter((e) => getComputedStyle(e).fill === "rgb(0, 0, 0)").length);
            if (black) errors.push(`${where}: ${black} frames in the map are black`);
            await click(".p-graph .minimap");
          }
          await click(".p-graph .reroute:not(.silent)");
          await p.locator(".p-graph .reroute:not(.silent)").first().click({ button: "right", timeout: 500 }).catch(() => {});
          await click('.ctx-item[data-menu="named"]');
          // A frame folded into one box, and unfolded.
          if (await p.locator(".p-graph [data-fold]").count()) {
            await p.locator(".p-graph [data-fold]").first().dispatchEvent("click");
            if (!(await p.locator(".p-graph .rg.folded").count())) errors.push(`${where}: folding a frame drew no folded box`);
            await p.locator(".p-graph .items [data-fold]").first().dispatchEvent("click", {}, { timeout: 500 }).catch(() => {});
            if (await p.locator(".p-graph .rg.folded").count()) errors.push(`${where}: unfolding left a folded box`);
          }
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

// Change the function is one change: one Undo puts the old function back.
async function swapAndUndo() {
  where = "change the function, then undo";
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator("[data-def]", { hasText: /^fall$/ }).click();
  await p.locator(".p-graph g:has(> text:text-is('+')) > rect.cn").first().click({ button: "right" });
  await p.locator('[data-menu="swap"]').click();
  await p.locator("button", { hasText: /^subtract/ }).first().click();
  const distance = async () => (await p.locator(".p-text").innerText()).split("\n").find((l) => l.includes("distance ="))?.trim();
  if ((await distance()) !== "distance = drift − drop") errors.push(`${where}: after picking subtract the text reads ${await distance()}`);
  await p.locator('button[data-act="undo"]').first().click();
  if ((await distance()) !== "distance = drift + drop") errors.push(`${where}: one Undo leaves ${await distance()}`);
  // The same from the Blocks pane: right-click its +, which stands for the
  // call as the graph's node does.
  where = "change the function from the Blocks pane";
  await p.locator(".blocks-wrap .op", { hasText: "+" }).first().click({ button: "right" });
  await p.locator('.ctx-menu [data-menu="swap"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: no Change the function in its menu`));
  await p.locator("button", { hasText: /^subtract/ }).first().click({ timeout: 2000 }).catch(() => {});
  if ((await distance()) !== "distance = drift − drop") errors.push(`${where}: after picking subtract the text reads ${await distance()}`);
  await p.close();
}

// An action that may give no answer (a Choice) isn't offered a Run that
// can only fail: the panel says how to run it, and its values still show.
async function choiceAction() {
  where = "an action with a Choice";
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator(".nav-row", { hasText: "+ New program" }).click();
  await p.locator(".nav-row", { hasText: "+ New definition" }).click();
  await p.locator('[data-panel="node"]').click();
  await p.locator("#f-def-name").fill("sum");
  await p.locator("button", { hasText: "Create" }).click();
  await p.locator(".hole").first().click();
  await p.locator("#f-query").fill("fraction(1, 2) + fraction(1, 3)");
  await p.keyboard.press("Enter");
  if (await p.locator('[data-act="t-run"]').count()) errors.push(`${where}: Run is offered, and can only fail`);
  if (!(await p.locator(".run", { hasText: "first(" }).count())) errors.push(`${where}: the panel doesn't say how to run it`);
  await p.locator('[data-act="t-values"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: no Show values`));
  const gives = await p.locator(".run").first().innerText();
  if (!/first answer:\s*5\/6/.test(gives)) errors.push(`${where}: Show values reads ${JSON.stringify(gives)}`);
  await p.close();
}

// Ersagun's edit (BACKLOG E81, E82): die() for the seed of a hundred
// rolls. Its type is held while the hole is open and has no Random, so
// die() isn't offered; the panel says so and how to let it loosen, after
// which die() fills it and the type does Random.
async function heldSeed() {
  where = "die() as a hundred rolls' seed";
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
  await p.locator("[data-def]", { hasText: /^a hundred rolls$/ }).click();
  await p.locator(".blocks-wrap .ref.var", { hasText: /^seed$/ }).first().click();
  await p.keyboard.press("Delete");
  const die = p.locator(".palette .opt", { hasText: /^die\(\)/ });
  await p.locator("#f-query").fill("die()");
  if (await die.count()) errors.push(`${where}: die() is offered while the type is held`);
  const loosen = p.locator(".held button", { hasText: "Let it loosen" });
  if (!(await loosen.count())) errors.push(`${where}: the hole's panel doesn't say the type is held, nor offer Let it loosen`);
  else {
    await loosen.click();
    await p.locator("#f-query").fill("die()");
    await die.first().click({ timeout: 2000 }).catch(() => errors.push(`${where}: after Let it loosen die() isn't offered`));
    if (!(await p.locator(".p-text").innerText()).includes("Random")) errors.push(`${where}: filled with die(), its type doesn't say Random`);
  }
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

// A phone: the editor is one screen, not a long page, and each pane is a
// tap away from the bar at the bottom.
async function phone() {
  where = "phone width";
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${where}: ${m.text()}`); });
  await p.goto(page);
  const size = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  if (size[0] > 390 || size[1] > 844) errors.push(`${where}: the page is ${size[0]} by ${size[1]} px, not one screen`);
  // Sideways, and a tablet: one screen too.
  for (const [w, hgt] of [[844, 390], [768, 1024]]) {
    await p.setViewportSize({ width: w, height: hgt });
    const [sw, sh] = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
    if (sw > w || sh > hgt) errors.push(`${where}: at ${w} by ${hgt} the page is ${sw} by ${sh} px, not one screen`);
    // The top bar fits a tablet without scrolling, and a phone held
    // sideways gives the graph most of its height.
    const [bw, bc] = await p.locator(".bar").evaluate((e) => [e.scrollWidth, e.clientWidth]);
    if (w >= 768 && bw > bc) errors.push(`${where}: at ${w} by ${hgt} the top bar scrolls (${bw} of ${bc} px)`);
    const g = (await p.locator(".p-graph .canvas-wrap").boundingBox())?.height ?? 0;
    if (g < hgt * 0.58) errors.push(`${where}: at ${w} by ${hgt} the graph gets ${Math.round(g)} px`);
  }
  await p.setViewportSize({ width: 390, height: 844 });
  for (const [pane, shows] of [["nav", ".p-nav"], ["text", ".p-text"], ["side", ".side"], ["graph", ".p-graph"]]) {
    await p.locator(`.panes [data-pane="${pane}"]`).tap();
    if (!(await p.locator(shows).isVisible())) errors.push(`${where}: the ${pane} pane shows nothing`);
    if (await p.locator(".p-graph").isVisible() !== (pane === "graph")) errors.push(`${where}: the graph shows with the ${pane} pane`);
  }
  // The New definition form is in the side pane: asking for it shows it.
  await p.locator('.panes [data-pane="nav"]').tap();
  await p.locator('[data-act="new-def"]').first().tap();
  if (!(await p.locator("#f-def-name").isVisible())) errors.push(`${where}: + New definition opened its form out of sight`);
  await p.locator('[data-act="new-def"]').first().evaluate((b) => (b as HTMLElement).click()).catch(() => {});
  await p.locator('.panes [data-pane="graph"]').tap();
  // The map would cover a phone's graph: it starts put away, and Map
  // brings it out.
  if (await p.locator(".p-graph .minimap").isVisible()) errors.push(`${where}: the map covers the graph on a phone`);
  else if (await p.locator(".p-graph .map-toggle").isVisible()) {
    await p.locator(".p-graph .map-toggle").tap();
    if (!(await p.locator(".p-graph .minimap").isVisible())) errors.push(`${where}: Map didn't show the map`);
    await p.locator(".p-graph .map-toggle").tap();
  }
  // A touch held still is a right-click: the graph's menu opens.
  const bb = (await p.locator(".p-graph svg.canvas").boundingBox())!;
  const cdp = await p.context().newCDPSession(p);
  const hold = async (x: number, y: number) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await p.waitForTimeout(700);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(100);
  };
  // Two fingers moving apart zoom in.
  const scale = async () => Number(/scale\(([\d.]+)\)/.exec((await p.locator(".p-graph svg.canvas > g.world").getAttribute("transform")) ?? "")?.[1] ?? 0);
  const z0 = await scale(), c = { x: bb.x + bb.width / 2, y: bb.y + 40 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x - 30, y: c.y, id: 1 }, { x: c.x + 30, y: c.y, id: 2 }] });
  for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: c.x - 30 - i * 10, y: c.y, id: 1 }, { x: c.x + 30 + i * 10, y: c.y, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  if (!(await scale() > z0)) errors.push(`${where}: a pinch didn't zoom in (${z0} to ${await scale()})`);
  await hold(bb.x + bb.width - 20, bb.y + 20);
  if ((await p.locator(".ctx-menu").count()) !== 1) errors.push(`${where}: a long press opened ${await p.locator(".ctx-menu").count()} menus`);
  await p.keyboard.press("Escape");
  // Pick two nodes by touch: both stay picked.
  const nodes = await p.locator(".p-graph .items [data-move]").evaluateAll((els) => els.flatMap((e) => {
    const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return document.elementFromPoint(x, y) === e ? [[x, y]] : [];
  }).slice(0, 2));
  for (const [x, y] of nodes) {
    await hold(x, y);
    await p.locator('.ctx-menu [data-menu="pick"]').tap({ timeout: 1000 }).catch(() => {});
  }
  const picked = await p.locator(".p-graph svg.canvas rect.picked").count();
  if (nodes.length === 2 && picked !== 2) errors.push(`${where}: two nodes picked by touch, ${picked} stay picked`);
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
  // The page has the base look (page.ts PAGE_BASE), not the browser's serif.
  const font = await f.locator("body").evaluate((e) => getComputedStyle(e).fontFamily);
  if (!font.includes("system-ui")) errors.push(`${where}: the page is in the browser's default font (${font})`);
  await f.locator("#hundred").click();
  const status = () => f.locator("#status").innerText({ timeout: 2000 }).catch(() => "(no status)");
  if (!(await status()).startsWith("Rolls: 100;")) errors.push(`${where}: after Roll 100 the page says ${await status()}`);
  await p.locator("[data-def]").nth(1).click();
  if (!(await status()).startsWith("Rolls: 100;")) errors.push(`${where}: the editor redrew and the page says ${await status()}`);
  // Its buttons still work after the redraw, and back on main.
  await f.locator("#roll").click();
  if (!(await status()).startsWith("Rolls: 101;")) errors.push(`${where}: Roll after opening another definition: the page says ${await status()}`);
  // The status bar says what was done on the page.
  if (!(await p.locator(".status[role=status]").innerText()).includes("Clicked “Roll”")) errors.push(`${where}: the status bar says nothing of the click on Roll`);
  await p.locator("[data-def]", { hasText: /^main$/ }).click();
  // The page is main's run: no Run main that would print its insides.
  if (await p.locator('[data-act="t-run"]').count()) errors.push(`${where}: a page's main offers Run main`);
  await f.locator("#roll").click();
  if (!(await status()).startsWith("Rolls: 102;")) errors.push(`${where}: Roll after going back to main: the page says ${await status()}`);
  // Another program and back: the page is as it was, and still answers.
  await p.locator('[data-set="program"]', { hasText: "Calculus" }).click();
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
  if (!(await status()).startsWith("Rolls: 102;")) errors.push(`${where}: after another program and back the page says ${await status()}`);
  await f.locator("#roll").click();
  if (!(await status()).startsWith("Rolls: 103;")) errors.push(`${where}: Roll after another program and back: the page says ${await status()}`);
  const [file] = await Promise.all([p.waitForEvent("download"), p.locator('[data-act="page-save"]').click()]);
  // Saved where its name says it's a page, or the browser shows it as text.
  const saved = join(mkdtempSync(join(tmpdir(), "smoke-")), file.suggestedFilename());
  await file.saveAs(saved);
  const q = await ctx.newPage();
  q.on("pageerror", (e) => errors.push(`${where}, saved page: ${e.stack ?? e.message}`));
  await q.goto(pathToFileURL(saved).href);
  await q.locator("#hundred").click();
  if (!(await q.locator("#status").innerText()).startsWith("Rolls: 100;")) errors.push(`${where}: the saved page didn't roll`);
  await ctx.close();
}

const saved = readFileSync(new URL("smoke-saved.json", import.meta.url), "utf8");
const edited = JSON.stringify({ ...JSON.parse(saved), docs: { relations: { ...JSON.parse(saved).docs.relations, edited: true } } });
await visit(null);
const fresh = defs;
await visit(saved, "Relations in programs");
await visit(edited, "Relations in programs");
await deleteAndUndo();
await swapAndUndo();
await choiceAction();
await heldSeed();
await newAndDeleteDefinition();
await pagePreview();
await cellsPage();
await phone();
await browser.close();
console.log(`${fresh} definitions, and ${defs - fresh} more on programs saved by an older editor${process.env.SWEEP === "all" ? "" : " (a slice: SWEEP=all for every one)"}`);
if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exit(1);
}
