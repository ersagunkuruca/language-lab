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
import { Lang } from "../src/lang/dsl.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { B } from "../src/prelude.ts";
import { toFile } from "./files.ts";

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
          // Tidy everything is one layout: doing it again moves nothing (BACKLOG E106).
          await p.mouse.click(bb.x + 8, bb.y + bb.height - 8, { button: "right" });
          await click('.ctx-item[data-menu="tidy-all"]');
          if (!/^Already tidy/.test(await p.locator(".status").innerText())) errors.push(`${where}: tidying twice moved nodes: ${await p.locator(".status").innerText()}`);
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
  const distance = async () => (await p.locator(".p-text").innerText()).split("\n").find((l) => l.includes("distance ="))?.trim();
  // In the graph, an input dropped on another input of the same + moves
  // there (BACKLOG E101); one Undo puts it back.
  where = "reorder inputs in the graph";
  const ports = p.locator(".p-graph g:has(> text:text-is('+')) > circle.inp");
  const [one, two] = [await ports.nth(0).boundingBox(), await ports.nth(1).boundingBox()];
  if (one && two) {
    await p.mouse.move(one.x + one.width / 2, one.y + one.height / 2);
    await p.mouse.down();
    await p.mouse.move(two.x + two.width / 2, two.y + two.height / 2, { steps: 6 });
    await p.mouse.up();
    if ((await distance()) !== "distance = drop + drift") errors.push(`${where}: dropping drift's input on drop's reads ${await distance()}`);
    await p.locator('button[data-act="undo"]').first().click();
  } else errors.push(`${where}: the + node's inputs aren't on screen`);
  where = "change the function, then undo";
  await p.locator(".p-graph g:has(> text:text-is('+')) > rect.cn").first().click({ button: "right" });
  // Each item says what it does, and a greyed one says why (BACKLOG E88).
  const greyed = await p.locator(".ctx-menu .ctx-item:disabled").count(), why = await p.locator(".ctx-menu .ctx-item:disabled .ctx-why.cant").count();
  if (greyed !== why) errors.push(`${where}: ${greyed - why} greyed menu items don't say why`);
  if (!(await p.locator('.ctx-menu [data-menu="pick"] .ctx-why').count())) errors.push(`${where}: Pick doesn't say what it does`);
  await p.locator('[data-menu="swap"]').click();
  // A generic function says what its a stands for (BACKLOG E71), once (E72).
  const subtracts = await p.locator(".ctx-menu .palette .opt", { hasText: /^subtract/ }).allInnerTexts();
  if (subtracts.length !== 1 || !subtracts[0].includes("where a is a Number")) errors.push(`${where}: the palette lists subtract as ${JSON.stringify(subtracts)}`);
  await p.locator("button", { hasText: /^subtract/ }).first().click();
  if ((await distance()) !== "distance = drift − drop") errors.push(`${where}: after picking subtract the text reads ${await distance()}`);
  await p.locator('button[data-act="undo"]').first().click();
  if ((await distance()) !== "distance = drift + drop") errors.push(`${where}: one Undo leaves ${await distance()}`);
  // A function that doesn't fit, named in full, says why: speed · time is
  // m/s by s, and subtract would take two of one unit (BACKLOG E126).
  await p.locator(".p-graph g:has(> text:text-is('·')) > rect.cn").first().click({ button: "right" });
  await p.locator('[data-menu="swap"]').click();
  await p.locator("#m-query").fill("subtract");
  const refusal = await p.locator(".ctx-menu .palette").innerText();
  if (!/subtract doesn't fit here: .*(m\/s|s\b)/s.test(refusal)) errors.push(`${where}: subtract over speed · time is refused with ${JSON.stringify(refusal)}`);
  await p.keyboard.press("Escape");
  // The same from the Blocks pane: right-click its +, which stands for the
  // call as the graph's node does.
  where = "change the function from the Blocks pane";
  await p.locator(".blocks-wrap .op", { hasText: "+" }).first().click({ button: "right" });
  await p.locator('.ctx-menu [data-menu="swap"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: no Change the function in its menu`));
  await p.locator("button", { hasText: /^subtract/ }).first().click({ timeout: 2000 }).catch(() => {});
  if ((await distance()) !== "distance = drift − drop") errors.push(`${where}: after picking subtract the text reads ${await distance()}`);
  // Any part is replaced in one step from its panel, and one Undo puts it
  // back (BACKLOG E86).
  where = "replace a part with another";
  await p.locator(".blocks-wrap .ref.var", { hasText: /^drop$/ }).last().click();
  await p.locator('[data-act="t-replace"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: a selected variable's panel has no Replace with`));
  await p.locator(".palette .opt", { hasText: /^drift/ }).first().click({ timeout: 2000 }).catch(() => errors.push(`${where}: Replace with doesn't offer drift`));
  if ((await distance()) !== "distance = drift − drift") errors.push(`${where}: after picking drift the text reads ${await distance()}`);
  await p.locator('button[data-act="undo"]').first().click();
  if ((await distance()) !== "distance = drift − drop") errors.push(`${where}: one Undo leaves ${await distance()}`);
  // Right-click on the blocks' empty space adds a value, as the graph's
  // canvas does (BACKLOG E100); Undo takes it back.
  where = "add a value from the blocks";
  const steps = async () => (await p.locator(".p-text").innerText()).split("\n").filter((l) => /^\s*\S+ = /.test(l)).length;
  const had = await steps();
  await p.locator(".blocks-wrap").dispatchEvent("contextmenu", { clientX: 600, clientY: 700 });
  // A hole of any type is offered everything, so its palette takes seconds (E103).
  await p.locator('.ctx-menu [data-menu="add"]').click({ timeout: 15000 }).catch(() => errors.push(`${where}: no Add a value on the blocks' empty space`));
  if ((await steps()) !== had + 1) errors.push(`${where}: no new named value (${had} before, ${await steps()} after)`);
  await p.keyboard.press("Escape");
  await p.locator('button[data-act="undo"]').first().click();
  // A function's name picks its whole call, whose panel changes the
  // function (BACKLOG E92).
  where = "a function's name in the blocks";
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  await p.locator(".blocks-wrap .head", { hasText: /^print$/ }).first().click({ timeout: 2000 }).catch(() => errors.push(`${where}: main shows no print by name`));
  const head = (await p.locator(".insp-head").first().innerText()).trim();
  if (head !== "Step (call)") errors.push(`${where}: clicking it selects a ${JSON.stringify(head)}, not the call`);
  await p.locator('[data-act="t-swap"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: the call's panel has no Change the function`));
  if (!(await p.locator("#f-query").count())) errors.push(`${where}: Change the function doesn't open the palette`);
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
  const head = (await p.locator(".insp-head").first().innerText()).trim();
  if (head !== "Hole") errors.push(`${where}: the Selected panel heads the hole ${JSON.stringify(head)}, not just Hole`);
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
  // A program with no units keeps the unit chooser folded (BACKLOG E87).
  where = "a dice seed's panel";
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  await p.locator(".blocks-wrap .lit", { hasText: /^7$/ }).first().click({ timeout: 2000 }).catch(() => errors.push(`${where}: main shows no 7`));
  if (await p.locator(".sub-head", { hasText: "Unit" }).count()) errors.push(`${where}: the unit chooser shows in a program with no units`);
  if (!(await p.locator("details.units summary").count())) errors.push(`${where}: no folded Give it a unit`);
  await p.close();
}

// A list's items are added, moved and taken out from the panel, in either
// view, and the graph's + adds one at the end (BACKLOG E91): the button row
// of two dice's main.
async function listItems() {
  where = "a list's items";
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  const text = async () => (await p.locator(".p-text").innerText()).replace(/\s+/g, " ");
  const before = await text();
  await p.locator(".blocks-wrap .head", { hasText: /^h1$/ }).first().click();
  const head = (await p.locator(".sub-head", { hasText: /^Item 1 of \d+ in the list/ }).count());
  if (!head) errors.push(`${where}: h1(…) in main's list doesn't say it's an item`);
  await p.locator("button", { hasText: /^Add one after$/ }).click({ timeout: 2000 }).catch(() => errors.push(`${where}: no Add one after`));
  if ((await p.locator(".insp-head").first().innerText()).trim() !== "Hole") errors.push(`${where}: the new item isn't a selected hole`);
  if (!/h1\(\[words\("Two dice"\)\]\), □/.test(await text())) errors.push(`${where}: no hole after h1 in ${(await text()).slice(400, 600)}`);
  await p.locator("button", { hasText: /^Earlier$/ }).click({ timeout: 2000 }).catch(() => errors.push(`${where}: a new item can't move earlier`));
  if (!/\[ □\S*, h1\(/.test(await text())) errors.push(`${where}: Earlier didn't put the hole first`);
  await p.locator("button", { hasText: /^Take it out$/ }).click({ timeout: 2000 }).catch(() => errors.push(`${where}: no Take it out`));
  if ((await text()) !== before) errors.push(`${where}: taking the new item out doesn't give back main`);
  const holes = await p.locator(".p-graph .pill.hole, .p-graph circle.inp.empty").count();
  // The first + may be off the visible part of the canvas: press it where it is.
  await p.locator(".p-graph .add-inp").first().dispatchEvent("pointerdown", { button: 0 }, { timeout: 2000 }).catch(() => errors.push(`${where}: the graph has no + on a list or a chain`));
  if ((await p.locator(".p-graph .pill.hole, .p-graph circle.inp.empty").count()) <= holes) errors.push(`${where}: the graph's + didn't add a hole`);
  // It's an empty input, not a node (BACKLOG E115), and a click on it is
  // the palette's, as a hole's is.
  const empty = p.locator(".p-graph circle.inp.empty");
  if (!(await empty.count())) errors.push(`${where}: the new item isn't drawn as an empty input`);
  else {
    await empty.first().dispatchEvent("click");
    if ((await p.locator(".insp-head").first().innerText()).trim() !== "Hole") errors.push(`${where}: clicking the empty input doesn't select its hole`);
  }
  await p.close();
}

// Changing the selection leaves the text where it was, from either view
// (BACKLOG E105): two dice's main, scrolled to its end.
async function textKeepsPlace() {
  where = "the text's scroll on a new selection";
  const p = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  const body = p.locator(".p-text .body");
  const top = () => body.evaluate((e) => e.scrollTop);
  await body.evaluate((e) => { e.scrollTop = e.scrollHeight; });
  const end = await top();
  if (end < 50) errors.push(`${where}: main's text doesn't scroll at 700 px (${end})`);
  await p.locator(".blocks-wrap .head").last().click();
  if (Math.abs((await top()) - end) > 40) errors.push(`${where}: clicking a part scrolled the text from ${end} to ${await top()}`);
  await p.locator(".p-graph [data-move]").first().dispatchEvent("click");
  await p.locator(".p-graph [data-move]").first().dispatchEvent("pointerdown", { button: 0 });
  await p.locator(".p-graph [data-move]").first().dispatchEvent("pointerup", { button: 0 });
  if ((await top()) < 20) errors.push(`${where}: selecting in the graph sent the text back to the top`);
  await p.close();
}

// Delete takes out one node: what fed it lies loose at the end of the
// text and beside the graph, and wires back in from its frame's output
// (BACKLOG E116, E117; NODE-EDITOR.md, "Loose parts"). Two dice's main.
async function looseParts() {
  where = "loose parts";
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  const text = async () => (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  await p.locator(".blocks-wrap .head", { hasText: /^named$/ }).first().click();
  await p.keyboard.press("Delete");
  const after = await text();
  const loose = (t: string) => (t.match(/ loose: /g) ?? []).length;
  if (!after.includes("-- loose, not used yet") || loose(after) < 2) errors.push(`${where}: deleting named(…) didn't leave its inputs loose: ${after.slice(-300)}`);
  if (!(await p.locator(".p-graph .rg.loose").count())) errors.push(`${where}: the graph doesn't show the loose parts`);
  await p.locator('.p-graph button:has-text("Fit")').first().click().catch(() => {});
  // By the part's own last node's output, as the status says (BACKLOG E120):
  // the faded output furthest right, of a node, not of a lone literal (E122).
  const outs = await p.locator(".p-graph .items > g.faded:not(:has(rect.pill)) circle.outp[data-out]").evaluateAll((es) => es.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  const out = outs.sort((a, b) => b.x - a.x)[0];
  if (!out) { errors.push(`${where}: the loose part's nodes have no output to drag`); return p.close(); }
  const hole = (await p.locator(".p-graph .pill.hole, .p-graph circle.inp.empty").first().boundingBox())!;
  await p.mouse.move(out.x + out.width / 2, out.y + out.height / 2); await p.mouse.down();
  await p.mouse.move(hole.x + hole.width / 2, hole.y + hole.height / 2, { steps: 8 }); await p.mouse.up();
  if (!/^Wired it in/.test(await p.locator(".status").innerText())) { errors.push(`${where}: wiring a loose part into the hole: ${await p.locator(".status").innerText()}`); return p.close(); }
  if (loose(await text()) !== loose(after) - 1) errors.push(`${where}: the part wired in is still listed as loose`);
  // Undo, twice, gives main back as it was.
  await p.locator('[data-act="undo"]').click();
  await p.locator('[data-act="undo"]').click();
  if ((await text()).includes("-- loose")) errors.push(`${where}: undo left loose parts behind`);
  await p.close();
}

// A drop on an input that has a value swaps it in, and the old value lies
// loose (NODE-EDITOR.md "Loose parts", rule 5; BACKLOG E117): in two dice's
// main, the words output onto another input that takes it.
async function swapDrop() {
  where = "an output dropped on a filled input";
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  await p.locator('.p-graph button:has-text("Fit")').first().click().catch(() => {});
  const words = p.locator(".p-graph g.items > g", { has: p.locator("text.cl", { hasText: /^words$/ }) }).locator("circle.outp[data-out]").first();
  const from = (await words.boundingBox())!;
  await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await p.mouse.down();
  await p.mouse.move(from.x + 40, from.y + 40, { steps: 3 });
  // While dragging, the inputs it fits are marked; pick a filled one.
  const to = await p.locator(".p-graph circle.inp.can:not(.use)").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  if (!to.length) { await p.mouse.up(); errors.push(`${where}: no filled input takes the words`); return p.close(); }
  await p.mouse.move(to[0].x, to[0].y, { steps: 8 }); await p.mouse.up();
  const status = await p.locator(".status").innerText();
  const text = (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  if (!/lies loose/.test(status) || !text.includes("-- loose, not used yet")) errors.push(`${where}: the old value wasn't kept loose: ${status}`);
  await p.close();
}

// A value added on the graph's canvas is loose, and drawn faded, until it's
// wired in (NODE-EDITOR.md "Loose parts", rules 7 and 9; BACKLOG E118).
async function looseValue() {
  where = "a value added on the canvas";
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator("[data-def]", { hasText: /^fall$/ }).click();
  const box = (await p.locator(".p-graph svg.tgraph").first().boundingBox())!;
  await p.locator(".p-graph svg.tgraph").first().dispatchEvent("contextmenu", { clientX: box.x + box.width - 40, clientY: box.y + box.height - 40 });
  await p.locator('.ctx-menu [data-menu="add"]').click({ timeout: 15000 }).catch(() => errors.push(`${where}: no Add a value on the canvas`));
  const text = (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  if (!/-- loose, not used yet loose: □/.test(text)) errors.push(`${where}: the new value isn't a loose part: ${text.slice(-200)}`);
  if (!(await p.locator(".p-graph .rg.loose").count()) || !(await p.locator(".p-graph .items > g.faded").count())) errors.push(`${where}: it isn't drawn as a faded loose part`);
  // Its palette is the side panel's, focused, not a pop-up over the graph
  // repeating it (BACKLOG E125).
  if (await p.locator(".ctx-menu").count()) errors.push(`${where}: a pop-up palette covers the graph`);
  if (!(await p.locator("#f-query").evaluate((e) => e === document.activeElement).catch(() => false))) errors.push(`${where}: the side panel's palette isn't ready to fill it`);
  // It reads as what it is, not as a function named _1 (BACKLOG E124).
  const titles = await p.locator(".p-graph text.rt").evaluateAll((es) => es.map((e) => e.textContent ?? ""));
  if (/_1/.test(text) || !titles.some((t) => /^loose : /.test(t))) errors.push(`${where}: the loose part reads as _1: ${JSON.stringify(titles)}`);
  // Its hole takes no effects, and a search for one says why (BACKLOG E123).
  await p.locator("#f-query").fill('print("hi")');
  if (!/loose part .* can't have effects/.test(await p.locator(".side .palette").innerText())) errors.push(`${where}: a search for print in a loose hole doesn't say why nothing fits`);
  // Filled with a literal, it still has an output to wire it in by (BACKLOG E122).
  await p.locator("#f-query").fill("7");
  await p.locator("#f-query").press("Enter");
  if (!(await p.locator(".p-graph .items > g.faded circle.outp[data-out]").count())) errors.push(`${where}: the loose 7 has no output to wire it in by`);
  await p.keyboard.press("Escape");
  await p.locator('button[data-act="undo"]').first().click();
  await p.locator('button[data-act="undo"]').first().click();
  if ((await p.locator(".p-text .body").innerText()).includes("-- loose")) errors.push(`${where}: Undo left it`);
  await p.close();
}

// An action's steps run top to bottom, and the graph says so: numbered,
// in one column in that order, and each one's menu moves it (Ersagun
// 2026-10-26: "are they run in sequence, how are they edited?").
async function stepOrder() {
  where = "the order of steps";
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: /physics/ }).first().click();
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  const marks = await p.locator(".p-graph .stepn").evaluateAll((es) => es.map((e) => ({ n: Number(e.textContent), y: e.getBoundingClientRect().y })));
  const ys = marks.sort((a, b) => a.n - b.n).map((m) => m.y);
  if (marks.length < 7 || ys.some((y, i) => i && y <= ys[i - 1])) errors.push(`${where}: steps numbered ${JSON.stringify(marks)}`);
  const prints = await p.locator(".p-graph g:has(> text:text-is('print')) > rect.cn").evaluateAll((es) => es.map((e) => Math.round(e.getBoundingClientRect().x)));
  if (new Set(prints).size !== 1) errors.push(`${where}: the prints aren't in one column: ${prints}`);
  const first = async () => (await p.locator(".p-text .body").innerText()).split("\n").find((l) => l.startsWith("print("));
  const was = await first();
  await p.locator('.p-graph button:has-text("Fit")').first().click().catch(() => {});
  await p.locator(".p-graph circle.reroute.silent").nth(1).click({ button: "right" });
  await p.locator('.ctx-menu [data-menu="step-earlier"]').click({ timeout: 15000 }).catch(async () => errors.push(`${where}: step 2's menu has no Do it earlier: ${await p.locator(".ctx-menu").innerText().catch(() => "no menu")}`));
  if ((await first()) === was) errors.push(`${where}: Do it earlier on step 2 left ${was} first`);
  await p.locator('button[data-act="undo"]').first().click();
  if ((await first()) !== was) errors.push(`${where}: one Undo doesn't put the order back`);
  await p.close();
}

// An operation answered later is declared in the editor, beside what it
// gives back, and its case reads the rest the way the text does (BACKLOG
// E80): ask(question) with rest, in the text and the graph.
async function answeredLater() {
  where = "answered later";
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: /^Effects/ }).click();
  await p.locator("[data-def]", { hasText: /Ask/ }).first().click();
  const text = async () => (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  await p.locator(".p-text .body .variant .con", { hasText: /^ask$/ }).first().click();
  await p.locator("#f-later").check({ timeout: 5000 }).catch(() => errors.push(`${where}: ask's panel has no Answered later`));
  if (!(await text()).includes("returns Float64, later")) errors.push(`${where}: ticked, Ask reads ${(await text()).slice(-80)}`);
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  if (!(await text()).includes("ask(question) with rest →")) errors.push(`${where}: main's handler reads ${(await text()).slice(0, 300)}`);
  if (!(await p.locator(".p-graph text", { hasText: "(question) with rest =>" }).count())) errors.push(`${where}: the graph doesn't draw the case as (question) with rest`);
  await p.locator('button[data-act="undo"]').first().click();
  if ((await text()).includes("with rest")) errors.push(`${where}: one Undo leaves the rest`);
  await p.close();
}

// A new value's type is open, so a function written in place is offered
// there, to start a local helper (BACKLOG E128).
async function helperAtValue() {
  where = "a new function at a new value";
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator("[data-def]", { hasText: /^fall$/ }).click();
  await p.locator(".p-graph g:has(> text:text-is('+')) > rect.cn").first().click({ button: "right" });
  await p.locator('.ctx-menu [data-menu="add-before"]').click({ timeout: 15000 });
  await p.locator(".palette .opt", { hasText: /^\(□\) => □/ }).first().click({ timeout: 5000 }).catch(() => errors.push(`${where}: the palette offers no (□) => □`));
  const text = (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  if (!/= \(\w+\) => □/.test(text)) errors.push(`${where}: no new function at the value: ${text.slice(-160)}`);
  await p.close();
}

// Run backwards shows the first answer it finds at once, and looks for
// others in the background, which Stop ends (BACKLOG E127): fibFast(n) = 8
// is found in 11 steps, and the search for a second answer goes on.
async function searchGoesOn() {
  where = "run backwards, first answer first";
  const k = new Lang();
  const fib3 = k.def("fib3"), fast = k.def("fibFast");
  k.define(fib3, k.fn(["a", "b", "k"], (a, b, i) => k.if(k.equal(i, k.lit(0)), a, k.call(fib3, b, k.call(B.add, a, b), k.call(B.sub, i, k.lit(1))))));
  k.define(fast, k.fn(["n"], (n) => k.call(fib3, k.lit(1), k.lit(1), n)));
  const file = toFile({ title: "Fibonacci", typed: true, code: base(k.code), names: baseNames(k.names), descriptive: {}, comments: {}, layout: { known: { [fast]: ["out"] } }, examples: { [fast]: ["", "8"] }, signatures: {} }, base(new Lang().code));
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-panel="program"]').click();
  const chooser = p.waitForEvent("filechooser");
  await p.locator('[data-act="open-file"]').first().click();
  await (await chooser).setFiles({ name: "fibonacci.json", mimeType: "application/json", buffer: Buffer.from(file) });
  const t = Date.now();
  await p.locator("[data-def]", { hasText: /^fibFast$/ }).first().click();
  const run = async () => (await p.locator(".run").first().innerText()).replace(/\s+/g, " ");
  if (Date.now() - t > 5000 || !/\bn 5\b/.test(await run())) errors.push(`${where}: after ${Date.now() - t} ms it shows ${(await run()).slice(0, 200)}`);
  await p.locator('[data-act="stop-search"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: no Stop while it looks for more`));
  if (!(await run()).includes("Stopped looking for other answers") || !/\bn 5\b/.test(await run())) errors.push(`${where}: stopped, it shows ${(await run()).slice(0, 200)}`);
  await p.close();
}

// A simplification that keeps the meaning is offered on the node's menu:
// append of two lists written out is one list (BACKLOG E98).
async function simplifyAppend() {
  where = "simplify append";
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator("[data-def]", { hasText: /^fall$/ }).click();
  const box = (await p.locator(".p-graph svg.tgraph").first().boundingBox())!;
  await p.locator(".p-graph svg.tgraph").first().dispatchEvent("contextmenu", { clientX: box.x + box.width - 40, clientY: box.y + box.height - 40 });
  await p.locator('.ctx-menu [data-menu="add"]').click({ timeout: 15000 });
  await p.keyboard.type("append([1, 2], [3])");
  await p.keyboard.press("Enter");
  await p.keyboard.press("Escape");
  const text = async () => (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  if (!(await text()).includes("append([1, 2], [3])")) { errors.push(`${where}: couldn't write the append: ${(await text()).slice(-120)}`); return p.close(); }
  await p.waitForTimeout(900);
  await p.locator(".p-graph g:has(> text:text-is('append')) > rect.cn").first().click({ button: "right" });
  await p.locator('.ctx-menu [data-menu="simplify"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: append's menu offers no Simplify`));
  if (!(await text()).includes("[1, 2, 3]") || (await text()).includes("append(")) errors.push(`${where}: simplified, it reads ${(await text()).slice(-120)}`);
  await p.locator('button[data-act="undo"]').first().click();
  if (!(await text()).includes("append([1, 2], [3])")) errors.push(`${where}: one Undo doesn't bring the append back`);
  await p.close();
}

// A click on a wire puts a dot where you clicked, and nothing else moves
// (BACKLOG E109), though the dot's let changes how main would be laid out.
async function dotOnWire() {
  where = "a dot put on a wire";
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  await p.locator('.p-graph button:has-text("Fit")').first().click().catch(() => {});
  const places = () => p.locator(".p-graph .items > g").evaluateAll((es) => Object.fromEntries(es.map((e) => [e.querySelector("[data-id]")?.getAttribute("data-id") ?? "", e.getAttribute("transform")])));
  const dots = () => p.locator(".p-graph [data-src]").evaluateAll((es) => es.map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-src"), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const hits = p.locator(".p-graph path.edge-hit");
  // Every fifth wire: enough to meet one whose dot reshuffled main.
  for (let i = 0; i < (await hits.count()); i += 5) {
    const before = await places(), had = new Set((await dots()).map((d) => d.id));
    const at = await hits.nth(i).evaluate((e: any) => { const q = e.getPointAtLength(e.getTotalLength() / 2), m = e.getScreenCTM(); return { x: q.x * m.a + m.e, y: q.y * m.d + m.f }; });
    await p.mouse.click(at.x, at.y);
    if (!/^Put a dot/.test(await p.locator(".status").innerText())) continue;
    const dot = (await dots()).find((d) => !had.has(d.id));
    if (!dot || Math.hypot(dot.x - at.x, dot.y - at.y) > 8) errors.push(`${where}: wire ${i}: the dot is ${dot ? Math.round(Math.hypot(dot.x - at.x, dot.y - at.y)) : "?"}px from the click`);
    const now = await places();
    const moved = Object.keys(before).filter((k) => k && now[k] && now[k] !== before[k]);
    if (moved.length) errors.push(`${where}: wire ${i}: ${moved.length} other nodes moved`);
    await p.locator('button[data-act="undo"]').first().click();
  }
  await p.close();
}

// Let and get nodes for the whole definition at once, from the canvas's
// menu (BACKLOG E112); and a call picked in the graph opens or changes the
// function it calls (E113).
async function letNodes() {
  where = "let and get nodes for every value";
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  const canvas = p.locator(".p-graph svg.tgraph").first();
  const menu = async () => { const b = (await canvas.boundingBox())!; await canvas.dispatchEvent("contextmenu", { clientX: b.x + b.width - 30, clientY: b.y + b.height - 30 }); };
  await menu();
  await p.locator('.ctx-menu [data-menu="named-all"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: the canvas's menu has no Show every value as let and get nodes`));
  if ((await p.locator(".p-graph rect.letn").count()) < 4) errors.push(`${where}: main shows ${await p.locator(".p-graph rect.letn").count()} let nodes`);
  await menu();
  await p.locator('.ctx-menu [data-menu="named-none"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: no way back to wires`));
  if (await p.locator(".p-graph rect.letn").count()) errors.push(`${where}: let nodes are left after Show every value as wires`);
  where = "a call picked in the graph";
  // A menu opened by a script counts as a long press, whose tap is ignored for a moment.
  await p.waitForTimeout(900);
  await p.locator(".p-graph g.items > g:has(text.cl:text-is('die')) rect.cn").first().dispatchEvent("click");
  const acts = (await p.locator(".side button").allInnerTexts()).join(" | ");
  if (!acts.includes("Open die") || !acts.includes("Change the function")) errors.push(`${where}: its panel offers ${acts}`);
  await p.close();
}

// A folded frame is a node like the rest (BACKLOG E107): pressing on its
// words selects it, outlined, and drags it. Two dice's main, its first lambda.
async function foldedFrame() {
  where = "a folded frame";
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  await p.locator('.p-graph .fold-t:text("▾")').first().dispatchEvent("click");
  const box = p.locator(".p-graph rect.folded").first();
  const words = p.locator(".p-graph rect.folded + text.rt").first();
  await words.scrollIntoViewIfNeeded();
  const wb = await words.boundingBox();
  if (!wb) { errors.push(`${where}: folding drew no box`); return p.close(); }
  await p.mouse.click(wb.x + 5, wb.y + wb.height / 2);
  if (!/\bsel\b/.test((await box.getAttribute("class")) ?? "")) errors.push(`${where}: a click on its title doesn't select it, or it isn't outlined`);
  const at = () => box.evaluate((e) => e.parentElement!.getAttribute("transform"));
  const before = await at();
  await p.mouse.move(wb.x + 5, wb.y + wb.height / 2); await p.mouse.down(); await p.mouse.move(wb.x + 60, wb.y + 50, { steps: 5 }); await p.mouse.up();
  if ((await at()) === before) errors.push(`${where}: dragging it by its title doesn't move it`);
  await p.close();
}

// A value dropped on a list's + becomes a new item, wired to it (BACKLOG
// E108): in two dice's main, the words saying "Two dice" onto h1's list.
async function plusDrop() {
  where = "an output dropped on a list's +";
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
  await p.locator("[data-def]", { hasText: /^main$/ }).first().click();
  await p.locator('.p-graph button:has-text("Fit")').first().click().catch(() => {});
  const words = p.locator(".p-graph g.items > g", { has: p.locator("text.cl", { hasText: /^words$/ }) }).locator("circle.outp[data-out]");
  // The list that h1 takes: the + nearest that words node.
  const from = (await words.first().boundingBox())!;
  const pluses = await p.locator(".p-graph [data-add]").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const to = pluses.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  if (!to) { errors.push(`${where}: no + in main`); return p.close(); }
  await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 8 }); await p.mouse.up();
  const text = (await p.locator(".p-text").innerText()).replace(/\s+/g, " ");
  if (!/h1\(\[(\S+), \1\]\)/.test(text)) errors.push(`${where}: h1's list didn't get the value as a second item: ${await p.locator(".status").innerText()}`);
  await p.close();
}

// Opening a program shows its open definition in the navigator, even
// below the fold (BACKLOG E75): the guitar pedal's main at 1280 by 800.
async function navScroll() {
  where = "the navigator on opening a program";
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Page: guitar pedal" }).click();
  const seen = await p.locator(".p-nav .nav-row[data-def].on").evaluate((e) => {
    const r = e.getBoundingClientRect(), nav = e.closest(".p-nav")!.getBoundingClientRect();
    return r.top >= nav.top && r.bottom <= nav.bottom;
  }).catch(() => null);
  if (seen !== true) errors.push(`${where}: the open definition ${seen === null ? "isn't in the list" : "is out of sight"}`);
  // Nor does the map start on top of its nodes (BACKLOG E74).
  where = "the map on a first visit";
  const covered = await p.evaluate(() => {
    const m = document.querySelector(".minimap");
    if (!m || m.getAttribute("display") === "none") return 0;
    const c = m.getBoundingClientRect();
    return [...document.querySelectorAll(".p-graph [data-move]")].filter((el) => { const b = el.getBoundingClientRect(); return b.right > c.left && b.left < c.right && b.bottom > c.top && b.top < c.bottom; }).length;
  });
  if (covered) errors.push(`${where}: the map covers ${covered} nodes of the pedal's main`);
  await p.close();
}

// A Text port reads what's typed as text, quotes or not (BACKLOG E93):
// greet run forwards from a name.
async function textPort() {
  where = "a Text port in Run";
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: "Run backwards" }).click();
  await p.locator("[data-def]", { hasText: /^greet$/ }).click();
  const port = p.locator('.port-row.known input[type="text"]').first();
  if (!(await port.count())) { errors.push(`${where}: greet has no known port to type in`); return p.close(); }
  await port.fill("Ersagun");
  await port.press("Enter");
  await port.dispatchEvent("change");
  const bad = await p.locator(".status-line.bad").allInnerTexts();
  if (bad.length) errors.push(`${where}: typing Ersagun says ${JSON.stringify(bad)}`);
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
  // Duplicate opens a copy next to it (BACKLOG E90); deleting the copy
  // leaves double.
  await p.locator("button", { hasText: "Duplicate double" }).click();
  if (!(await p.locator(".nav-row[data-def]").allInnerTexts()).some((s) => s.trim() === "double copy")) errors.push(`${where}: Duplicate made no "double copy"`);
  await p.locator("button", { hasText: "Delete double copy" }).click({ timeout: 2000 }).catch(() => errors.push(`${where}: Duplicate didn't open the copy`));
  await p.locator("[data-def]", { hasText: /^double$/ }).first().click();
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
  // Upright, the top bar fits without scrolling, and More shows the links
  // that make room for it (BACKLOG E73).
  const [tw, tc] = await p.locator(".bar").evaluate((e) => [e.scrollWidth, e.clientWidth]);
  if (tw > tc) errors.push(`${where}: the top bar scrolls (${tw} of ${tc} px)`);
  await p.locator(".bar .more").tap();
  if (!(await p.locator(".bar .links a", { hasText: "Learn" }).isVisible())) errors.push(`${where}: More doesn't show Learn`);
  await p.locator(".bar .more").tap();
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
  // + New program fills its hole from the palette: the palette shows, and
  // tapping the hole, already picked, in Text brings it back (BACKLOG E121).
  await p.locator('.panes [data-pane="nav"]').tap();
  await p.locator('[data-act="new-program"]').first().tap();
  if (!(await p.locator("#f-query").isVisible())) errors.push(`${where}: + New program left the palette out of sight`);
  await p.locator('.panes [data-pane="text"]').tap();
  await p.locator(".blocks-wrap .hole").first().tap({ timeout: 2000 }).catch(() => errors.push(`${where}: no hole to tap in the new program`));
  if (!(await p.locator("#f-query").isVisible())) errors.push(`${where}: tapping the new program's hole didn't bring the palette`);
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
  // In the text pane too, a long press on a part opens its menu (BACKLOG E102).
  await p.keyboard.press("Escape");
  await p.locator('.panes [data-pane="text"]').tap();
  const part = await p.locator(".blocks-wrap [data-id]").evaluateAll((els) => els.flatMap((e) => {
    const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return r.width && document.elementFromPoint(x, y) === e ? [[x, y]] : [];
  })[0]);
  if (!part) errors.push(`${where}: no part of the blocks to press`);
  else {
    await hold(part[0], part[1]);
    if ((await p.locator(".ctx-menu").count()) !== 1) errors.push(`${where}: a long press on the blocks opened ${await p.locator(".ctx-menu").count()} menus`);
  }
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
  // What's typed in a page's field is said too (BACKLOG E76).
  await p.locator('[data-set="program"]', { hasText: "Page: unit converter" }).click();
  const field = f.locator("input").first();
  await field.fill("100");
  await field.press("Enter");
  if (!(await p.locator(".status[role=status]").innerText()).includes("Typed 100 in")) errors.push(`${where}: the status bar says nothing of typing 100 in the converter`);
  await p.locator('[data-set="program"]', { hasText: "Page: two dice" }).click();
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
await textPort();
await listItems();
await navScroll();
await textKeepsPlace();
await foldedFrame();
await plusDrop();
await looseParts();
await swapDrop();
await looseValue();
await stepOrder();
await simplifyAppend();
await searchGoesOn();
await helperAtValue();
await answeredLater();
await dotOnWire();
await letNodes();
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
