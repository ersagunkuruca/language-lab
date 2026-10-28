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
  // Escape before anything is picked puts the · back (QA8 M2).
  await p.keyboard.press("Escape");
  if ((await p.locator(".p-text .body").innerText()).includes("□") || !(await p.locator(".p-graph text:text-is('·')").count())) errors.push(`${where}: Escape left a hole where · was`);
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

// A data type's panel lists the interfaces, and Implement writes one: the
// interface's record at the type, a hole per operation wanting it there
// (BACKLOG E137, INTERFACES.md step 5).
async function implementInterface() {
  where = "implementing an interface";
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator(".nav-row", { hasText: "+ New program" }).click();
  await p.locator(".nav-row", { hasText: "+ New definition" }).click();
  await p.locator('[data-panel="node"]').click();
  await p.locator('[data-set="new-kind"][data-value="type"]').click();
  await p.locator("#f-def-name").fill("Wave");
  await p.locator("#f-def-case").fill("wave");
  await p.locator("button", { hasText: "Create" }).click();
  await p.locator(".structure .srow", { hasText: "Trig" }).locator("button", { hasText: "Implement" }).click({ timeout: 5000 }).catch(() => errors.push(`${where}: Wave's panel doesn't offer to implement Trig`));
  const text = (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  // One line per operation, by its name (BACKLOG E151).
  if (!/trig at Wave› : Trig Wave/.test(text) || !/= sin: □/.test(text) || /trig\(/.test(text) || (text.match(/□/g) ?? []).length !== 5) errors.push(`${where}: not trig(□ × 5) at Wave: ${text.slice(0, 200)}`);
  // The graph draws it as Trig at Wave, an input per operation (BACKLOG E152).
  const impl = (await p.locator(".p-graph svg.canvas").first().textContent()) ?? "";
  if (!impl.includes("Trig at Wave") || !impl.includes("sin") || /\btrig\b/.test(impl)) errors.push(`${where}: the graph draws the implementation as ${impl.slice(0, 160)}`);
  await p.locator(".p-text .hole").first().click();
  if (!(await p.locator(".side .hint", { hasText: "This is sin at Wave" }).count())) errors.push(`${where}: sin's hole doesn't say it is sin at Wave`);
  if (!(await p.locator(".typeline", { hasText: "(Wave) -> Wave" }).count())) errors.push(`${where}: sin's hole doesn't want (Wave) -> Wave`);
  // A new interface of the program's own (BACKLOG E138).
  await p.locator(".nav-row", { hasText: "+ New definition" }).click();
  await p.locator('[data-panel="node"]').click();
  await p.locator('[data-set="new-kind"][data-value="interface"]').click();
  await p.locator("#f-def-name").fill("Halving");
  await p.locator("#f-def-case").fill("half");
  await p.locator("button", { hasText: "Create" }).click();
  await p.locator("#f-new-op").fill("twice");
  await p.locator("button", { hasText: "Add the operation" }).click();
  const iface = (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  // It reads as its operations, not as the record that holds them (BACKLOG E151).
  if (!/interface Halving a half : \(a\) -> a twice : \(a\) -> a/.test(iface) || /\bhalving\(/.test(iface)) errors.push(`${where}: the new interface reads ${iface.slice(0, 120)}`);
  // An operation's Takes and Gives change from its panel (BACKLOG E142).
  await p.locator('.side button.slink[data-act="goto-node"]', { hasText: /^twice/ }).first().click({ timeout: 5000 }).catch(() => {});
  await p.locator("#f-op-takes").selectOption("2", { timeout: 5000 }).catch(() => errors.push(`${where}: an operation's panel has no Takes`));
  await p.locator("#f-op-gives").selectOption({ label: "Bool" }).catch(() => {});
  await p.locator(".side button", { hasText: /^Change$/ }).click({ timeout: 5000 }).catch(() => errors.push(`${where}: an operation's panel has no Change`));
  const changed = (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  if (!changed.includes("twice : (a, a) -> Bool")) errors.push(`${where}: changed, the interface reads ${changed.slice(0, 120)}`);
  // The graph draws it as an interface, one node per operation (BACKLOG E141).
  const drawn = (await p.locator(".p-graph svg.canvas").first().textContent()) ?? "";
  if (!drawn.includes("interface Halving: its operations") || !drawn.includes("(a) -> a") || /\bhalving\b/.test(drawn)) errors.push(`${where}: the graph draws ${drawn.slice(0, 160)}`);
  await p.close();
}

// An edit doesn't lay the graph out again: what was drawn stays where it
// was, and only what's new is placed (Ersagun 2026-10-27, BACKLOG E144).
async function editKeepsPlaces() {
  where = "an edit keeps the graph's places";
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator(".nav-row", { hasText: "+ New program" }).click();
  await p.locator(".nav-row", { hasText: "+ New definition" }).click();
  await p.locator('[data-panel="node"]').click();
  await p.locator("#f-def-name").fill("grow");
  await p.locator("#f-def-inputs").fill("x");
  await p.locator("button", { hasText: "Create" }).click();
  await p.locator(".hole").first().click();
  await p.locator("#f-query").fill("x · x + 1");
  await p.keyboard.press("Enter");
  // Each node's place in the world, apart from the canvas's pan and zoom.
  const places = () => p.locator(".p-graph svg.canvas > g.world .items [data-id]:not(.rg):not(.src):not(.use-hit)").evaluateAll((es) => Object.fromEntries(es.map((e) => {
    const g = e as SVGGraphicsElement, b = g.getBBox(), m = (g.closest("g.world") as SVGGraphicsElement).getCTM()!.inverse().multiply(g.getCTM()!);
    // By id and kind: a filled hole keeps its id as something else.
    return [`${e.getAttribute("data-id")} ${e.getAttribute("class")}`, `${Math.round(b.x + m.e)},${Math.round(b.y + m.f)}`];
  })));
  const before = await places();
  await p.locator(".p-text .x", { hasText: /^1$/ }).last().click({ button: "right" });
  await p.locator(".ctx-menu button, .menu button", { hasText: "Replace with" }).first().click();
  await p.locator("#f-query").fill("2 · 3 · 4 · 5");
  await p.keyboard.press("Enter");
  const after = await places();
  const moved = Object.keys(before).filter((k) => k in after && before[k] !== after[k]);
  if (Object.keys(after).length <= Object.keys(before).length) errors.push(`${where}: the edit added nothing to the graph`);
  if (moved.length) errors.push(`${where}: ${moved.length} of ${Object.keys(before).length} nodes moved: ${moved.map((k) => `${before[k]} → ${after[k]}`).join(", ")}`);
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
  // A function is found by what other languages call it, and by its
  // comment (BACKLOG E136).
  await p.locator("#f-query").fill("insert");
  if (!/put\(□, □, □\)\s*elsewhere called insert/.test(await p.locator(".side .palette").innerText())) errors.push(`${where}: insert doesn't find put`);
  await p.locator("#f-query").fill("holds");
  if (!/has key\(□, □\)\s*Whether the map holds key/.test(await p.locator(".side .palette").innerText())) errors.push(`${where}: a word of has key's comment doesn't find it`);
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
  // The graph itself, not the map's copy of it.
  const marks = await p.locator(".p-graph svg.canvas > g.world .stepn").evaluateAll((es) => es.map((e) => ({ n: Number(e.textContent), y: e.getBoundingClientRect().y })));
  const ys = marks.sort((a, b) => a.n - b.n).map((m) => m.y);
  if (marks.length < 7 || ys.some((y, i) => i && y <= ys[i - 1])) errors.push(`${where}: steps numbered ${JSON.stringify(marks)}`);
  const prints = await p.locator(".p-graph svg.canvas > g.world g:has(> text:text-is('print')) > rect.cn").evaluateAll((es) => es.map((e) => Math.round(e.getBoundingClientRect().x)));
  if (new Set(prints).size !== 1) errors.push(`${where}: the prints aren't in one column: ${prints}`);
  const first = async () => (await p.locator(".p-text .body").innerText()).split("\n").find((l) => l.startsWith("print("));
  const was = await first();
  await p.locator('.p-graph button:has-text("Fit")').first().click().catch(() => {});
  await p.locator(".p-graph circle.reroute.silent").nth(1).click({ button: "right" });
  await p.locator('.ctx-menu [data-menu="step-earlier"]').click({ timeout: 15000 }).catch(async () => errors.push(`${where}: step 2's menu has no Do it earlier: ${await p.locator(".ctx-menu").innerText().catch(() => "no menu")}`));
  if ((await first()) === was) errors.push(`${where}: Do it earlier on step 2 left ${was} first`);
  await p.locator('button[data-act="undo"]').first().click();
  if ((await first()) !== was) errors.push(`${where}: one Undo doesn't put the order back`);
  // A step goes before a step as a plain step, with no name (QA8 M1).
  const pr = p.locator(".p-graph svg.canvas > g.world g:has(> text:text-is('print')) > rect.cn").first(), pb = (await pr.boundingBox())!;
  await pr.dispatchEvent("contextmenu", { clientX: pb.x + 5, clientY: pb.y + 5 });
  await p.locator('.ctx-menu [data-menu="step-before"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: a print's menu has no Add a step before this`));
  const lines = (await p.locator(".p-text .body").innerText()).split("\n").map((l) => l.trim());
  if (!lines[2]?.startsWith("□") || lines.some((l) => l.includes("‹•"))) errors.push(`${where}: a step added before the first reads ${lines.slice(0, 4).join(" / ")}`);
  await p.close();
}

// A match whose case only takes a field apart further draws as rows of
// patterns, the way the text reads it, and its menu switches to the nested
// matches it is stored as and back (PATTERNS.md, BACKLOG E61 step 3).
async function patternRows() {
  where = "pattern rows in the graph";
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: /Countdown/ }).first().click();
  await p.locator("[data-def]", { hasText: /^results$/ }).first().click();
  const ports = async () => p.locator(".p-graph .portl").allTextContents();
  if (!(await ports()).includes("[head, second, ..others]")) errors.push(`${where}: results' match has ports ${(await ports()).join(" ")}`);
  const text = async () => (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  const was = await text();
  await p.locator('.p-graph button:has-text("Fit")').first().click().catch(() => {});
  await p.locator(".p-graph g:has(> text:text-is('match List')) > rect.cn").first().click({ button: "right" });
  await p.locator('.ctx-menu [data-menu="tree"]').click({ timeout: 5000 }).catch(() => errors.push(`${where}: the match's menu can't draw it as nested matches`));
  const tree = await ports();
  if (tree.includes("[head, second, ..others]") || !tree.includes("cons")) errors.push(`${where}: as nested matches, the ports are ${tree.join(" ")}`);
  if ((await text()) !== was) errors.push(`${where}: switching the drawing changed the text`);
  await p.locator('button[data-act="undo"]').first().click();
  if (!(await ports()).includes("[head, second, ..others]")) errors.push(`${where}: Undo doesn't bring the rows back`);
  // solutions, opened with main's numbers, stops its values on the wires
  // instead of holding the page for the whole search (BACKLOG I23).
  where = "a slow function's values on the wires";
  const t0 = Date.now();
  await p.locator("[data-def]", { hasText: /^solutions$/ }).first().click();
  if (Date.now() - t0 > 5000) errors.push(`${where}: opening solutions took ${Date.now() - t0} ms`);
  if (!(await p.locator(".side").innerText()).includes("the graph waits")) errors.push(`${where}: solutions doesn't say its values stopped`);
  await p.close();
}

// Cases that say the same thing read once, as the otherwise, and are one
// row to edit (PATTERNS.md step 4): Conjugation's bands has two cases that
// give back nil. Changing the otherwise changes both, in one undo step.
async function sharedRow() {
  where = "a shared otherwise row";
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: /Conjugation/ }).first().click();
  await p.locator("[data-def]", { hasText: /^bands$/ }).first().click();
  const text = async () => (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  if (!/otherwise → nil/.test(await text())) errors.push(`${where}: bands reads ${await text()}`);
  const same = p.locator('.p-text .kw[title^="The same in 2 places"]');
  if ((await same.count()) !== 1) errors.push(`${where}: the otherwise doesn't say it's the same in 2 places`);
  await p.locator(".p-text .body [data-id]", { hasText: /^nil$/ }).last().click();
  await p.keyboard.press("Delete");
  const after = await text();
  if (!/otherwise → □/.test(after) || / nil/.test(after)) errors.push(`${where}: after clearing the otherwise, bands reads ${after}`);
  if (!/2 places/.test(await p.locator(".status").innerText())) errors.push(`${where}: the note doesn't say both places changed`);
  await p.locator('button[data-act="undo"]').first().click();
  if (!/otherwise → nil/.test(await text())) errors.push(`${where}: one Undo doesn't bring both back: ${await text()}`);
  await p.close();
}

// Match deeper on a field of a row (PATTERNS.md "Editing"): refused while
// the row reads the field whole; once it doesn't, the field opens into
// its cases, the rows read as longer patterns.
async function matchDeeper() {
  where = "match deeper";
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: /Conjugation/ }).first().click();
  await p.locator("[data-def]", { hasText: /^bands$/ }).first().click();
  const text = async () => (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  const more = p.locator(".p-text .body [data-id]", { hasText: /^more\b/ }).first();
  const deeper = p.locator('button:text-is("Match deeper")');
  await more.click();
  if (!(await deeper.isDisabled().catch(() => false)) || !/reads more whole/.test((await deeper.getAttribute("title").catch(() => "")) ?? "")) errors.push(`${where}: Match deeper on more isn't refused while bands(more) reads it`);
  await p.locator(".p-text .body [data-id]", { hasText: /^cons$/ }).first().click();
  await p.locator('[data-act="t-clear"]').first().click();
  await more.click();
  await deeper.click({ timeout: 5000 }).catch(() => errors.push(`${where}: no Match deeper on more once its row is a hole`));
  if (!/^Matched deeper/.test(await p.locator(".status").innerText())) errors.push(`${where}: ${await p.locator(".status").innerText()}`);
  if (!/\[a, b\] →/.test(await text())) errors.push(`${where}: after Match deeper bands reads ${await text()}`);
  await p.close();
}

// A fold to a function, applied to its start, draws as one fold node with
// a port for the start, as the text reads it (BACKLOG E62): queens' safe.
// A main opens on its steps (BACKLOG I18): at 1280×720 the first view of
// Numbers & physics' main shows the column they run down, numbered.
async function firstSteps() {
  where = "a main opens on its steps";
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator(".p-graph svg.canvas > g.world text.stepn").first().waitFor({ state: "attached" });
  await p.waitForTimeout(300);
  const [seen, all] = await p.evaluate(() => {
    const cv = document.querySelector(".p-graph svg.canvas")!.getBoundingClientRect();
    const ns = [...document.querySelectorAll(".p-graph svg.canvas > g.world text.stepn")].map((t) => t.getBoundingClientRect());
    return [ns.filter((q) => q.left >= cv.left && q.right <= cv.right && q.top >= cv.top && q.bottom <= cv.bottom).length, ns.length];
  });
  if (seen < Math.min(all, 6)) errors.push(`${where}: ${seen} of ${all} numbered steps in the first view`);
  await p.close();
}

// A definition's Run starts with what main passes it (BACKLOG I19): cuts
// is called as cuts("abc") inside a print, and opens with "abc".
async function seededRun() {
  where = "a Run seeded from main";
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: /Run backwards/ }).first().click();
  await p.locator("[data-def]", { hasText: /^cuts$/ }).first().click();
  const vals = await p.locator(".side input").evaluateAll((es) => es.map((e) => (e as HTMLInputElement).value));
  if (!vals.includes('"abc"')) errors.push(`${where}: cuts opens with ${JSON.stringify(vals)}`);
  await p.close();
}

// A shader opens on the definition its picture draws, not on a data type
// (BACKLOG I22).
async function shaderOpens() {
  where = "a shader's first definition";
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  for (const prog of ["Shader: ray marching", "Shader: Mandelbrot set"]) {
    await p.locator('[data-set="program"]', { hasText: prog }).first().click();
    const tabs = (await p.locator("[data-tab]").allInnerTexts()).map((t) => t.trim());
    if (!tabs.includes("colour")) errors.push(`${where}: ${prog} opens on ${tabs.join(", ")}`);
  }
  await p.close();
}

async function foldFrom() {
  where = "a fold from a start";
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-set="program"]', { hasText: /Eight queens/ }).first().click();
  await p.locator("[data-def]", { hasText: /^safe$/ }).first().click();
  const titles = await p.locator(".p-graph text.cl").allTextContents();
  if (!titles.includes("fold List from distance")) errors.push(`${where}: safe's graph has ${titles.join(" | ")}`);
  const text = (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  if (!/fold placed from distance = 1/.test(text)) errors.push(`${where}: safe reads ${text}`);
  await p.close();
}

// Picked nodes grouped into one box, a view like a frame's fold (BACKLOG
// E111): the box names what it holds, unfolds into a frame, and Ungroup
// takes the frame away. The code is untouched throughout.
async function groupPicked() {
  where = "group the picked";
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator("[data-def]", { hasText: /^fall$/ }).click();
  const text = async () => (await p.locator(".p-text .body").innerText()).replace(/\s+/g, " ");
  const was = await text();
  const muls = p.locator(".p-graph g:has(> text:text-is('·')) > rect.cn");
  // With nothing picked, Group and Make it a function take the node
  // right-clicked (Ersagun 2026-10-27, BACKLOG E154).
  await muls.nth(0).click({ button: "right" });
  for (const act of ["picked-fn", "group-picked"]) if (!(await p.locator(`.ctx-menu [data-menu="${act}"]:not([disabled])`, { hasText: "This node" }).count())) errors.push(`${where}: with nothing picked, a node's menu has no ${act} for it`);
  await p.keyboard.press("Escape");
  await muls.nth(0).click({ modifiers: ["Shift"] });
  await muls.nth(1).click({ modifiers: ["Shift"] });
  await muls.nth(1).click({ button: "right" });
  // Make it a function is on the picked nodes' own menu too (BACKLOG E154).
  if (!(await p.locator('.ctx-menu [data-menu="picked-fn"]', { hasText: "Make it a function" }).count())) errors.push(`${where}: two picked nodes' menu has no Make it a function`);
  await p.locator('.ctx-menu [data-menu="group-picked"]').click({ timeout: 5000 }).catch(() => errors.push(`${where}: no Group on the menu of two picked`));
  const box = p.locator(".p-graph rect.rg.group.folded");
  if ((await box.count()) !== 1) errors.push(`${where}: ${await box.count()} folded group boxes`);
  if ((await muls.count()) > 1) errors.push(`${where}: ${await muls.count()} · nodes still drawn outside the box`);
  // The blocks bracket it too (BACKLOG E145), folded as the graph's is;
  // their title unfolds both.
  if ((await p.locator(".blocks-wrap .grp.folded").count()) !== 1) errors.push(`${where}: the blocks show ${await p.locator(".blocks-wrap .grp.folded").count()} folded groups`);
  await p.locator(".blocks-wrap .grp-t").first().click();
  if (!(await p.locator(".p-graph rect.rg.group:not(.folded)").count())) errors.push(`${where}: unfolded from the blocks, the graph has no open group frame`);
  if ((await p.locator(".blocks-wrap .grp:not(.folded)").count()) !== 1) errors.push(`${where}: unfolded, the blocks show no open group`);
  if ((await text()).replace(/▾ group ?/, "") !== was) errors.push(`${where}: grouping changed the code: ${await text()}`);
  await p.locator('.p-graph [data-fold^="group-"]').first().dispatchEvent("click");
  if ((await p.locator(".blocks-wrap .grp.folded").count()) !== 1) errors.push(`${where}: folded in the graph, the blocks' group stays open`);
  await p.locator('.p-graph [data-fold^="group-"]').first().dispatchEvent("click");
  if (!(await p.locator(".p-graph rect.rg.group:not(.folded)").count())) errors.push(`${where}: unfolded, there's no group frame`);
  // A node inside the group offers it too: the frame's edge is hard to hit.
  await muls.first().click({ button: "right" });
  if (!(await p.locator('.ctx-menu [data-menu="picked-fn"]', { hasText: "The group it's in" }).count())) errors.push(`${where}: a node in a group has no Make it a function`);
  await p.keyboard.press("Escape");
  await p.locator(".p-graph rect.rg.group").first().click({ button: "right", position: { x: 6, y: 6 } });
  // A group's menu offers to make it a function (BACKLOG E146).
  const fnItem = (await p.locator('.ctx-menu [data-menu="group-fn"]').innerText().catch(() => "")).replace(/\s+/g, " ");
  if (!/Make it a function/.test(fnItem)) errors.push(`${where}: the group's menu has no Make it a function`);
  await p.locator('.ctx-menu [data-menu="ungroup"]').click({ timeout: 5000 }).catch(() => errors.push(`${where}: a group's menu has no Ungroup`));
  if (await p.locator(".p-graph rect.rg.group").count()) errors.push(`${where}: ungrouped, the frame is still there`);
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
// others in the background, which Stop ends (BACKLOG E127). The Fibonacci
// numbers with signs that take turns (1, 1, 0, 1, −1, 2, −3, …, 13 at
// n = 9) go both ways, so the search for a second answer goes on
// (fibFast's ends on its own since L83b).
async function searchGoesOn() {
  where = "run backwards, first answer first";
  const k = new Lang();
  const signed = k.def("signed"), fast = k.def("signedFib");
  k.define(signed, k.fn(["a", "b", "k"], (a, b, i) => k.if(k.equal(i, k.lit(0)), a, k.call(signed, b, k.call(B.sub, a, b), k.call(B.sub, i, k.lit(1))))));
  k.define(fast, k.fn(["n"], (n) => k.call(signed, k.lit(1), k.lit(1), n)));
  const file = toFile({ title: "Fibonacci", typed: true, code: base(k.code), names: baseNames(k.names), descriptive: {}, comments: {}, layout: { known: { [fast]: ["out"] } }, examples: { [fast]: ["", "13"] }, signatures: {} }, base(new Lang().code));
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
  await p.goto(page);
  await p.locator('[data-panel="program"]').click();
  const chooser = p.waitForEvent("filechooser");
  await p.locator('[data-act="open-file"]').first().click();
  await (await chooser).setFiles({ name: "fibonacci.json", mimeType: "application/json", buffer: Buffer.from(file) });
  const t = Date.now();
  await p.locator("[data-def]", { hasText: /^signedFib$/ }).first().click();
  const run = async () => (await p.locator(".run").first().innerText()).replace(/\s+/g, " ");
  if (Date.now() - t > 5000 || !/\bn 9\b/.test(await run())) errors.push(`${where}: after ${Date.now() - t} ms it shows ${(await run()).slice(0, 200)}`);
  await p.locator('[data-act="stop-search"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: no Stop while it looks for more`));
  if (!(await run()).includes("Stopped looking for other answers") || !/\bn 9\b/.test(await run())) errors.push(`${where}: stopped, it shows ${(await run()).slice(0, 200)}`);
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
  // They are how named values are drawn to begin with (E157).
  if ((await p.locator(".p-graph rect.letn").count()) < 4) errors.push(`${where}: main opens with ${await p.locator(".p-graph rect.letn").count()} let nodes`);
  await menu();
  await p.locator('.ctx-menu [data-menu="named-none"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: the canvas's menu has no Show every value as wires`));
  if (await p.locator(".p-graph rect.letn").count()) errors.push(`${where}: let nodes are left after Show every value as wires`);
  await menu();
  await p.locator('.ctx-menu [data-menu="named-all"]').click({ timeout: 2000 }).catch(() => errors.push(`${where}: the canvas's menu has no Show every value as let and get nodes`));
  if ((await p.locator(".p-graph rect.letn").count()) < 4) errors.push(`${where}: main shows ${await p.locator(".p-graph rect.letn").count()} let nodes`);
  // A let node's menu is its value's: name it, or back to wires.
  const letn = p.locator(".p-graph rect.letn").first(), lb = (await letn.boundingBox())!;
  await letn.dispatchEvent("contextmenu", { clientX: lb.x + 5, clientY: lb.y + 5 });
  const offers = (await p.locator(".ctx-menu .ctx-item").allInnerTexts()).join(" | ");
  if (!offers.includes("Show as wires") || offers.includes("Put a dot")) errors.push(`${where}: a let node's menu offers ${offers}`);
  await p.keyboard.press("Escape");
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
  // The list that h1 takes: the + nearest h1's node.
  const from = (await words.first().boundingBox())!;
  const h1 = (await p.locator(".p-graph g.items > g", { has: p.locator("text.cl", { hasText: /^h1$/ }) }).first().boundingBox())!;
  const pluses = await p.locator(".p-graph [data-add]").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const to = pluses.sort((a, b) => Math.hypot(a.x - h1.x, a.y - h1.y) - Math.hypot(b.x - h1.x, b.y - h1.y))[0];
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
  // A function that reads files doesn't offer to run backwards: the search
  // would read once per guess (BACKLOG E150).
  await p.locator("[data-def]", { hasText: /^quantity$/ }).click();
  if (await p.locator(".status-line.bad").count() || !(await p.locator(".run .hint, p.hint").allInnerTexts()).some((t) => t.includes("doesn't run backwards"))) errors.push(`${where}: quantity, which reads files, offers to run backwards`);
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
await implementInterface();
await editKeepsPlaces();
await stepOrder();
await simplifyAppend();
await searchGoesOn();
await helperAtValue();
await answeredLater();
await groupPicked();
await patternRows();
await sharedRow();
await matchDeeper();
await foldFrom();
await shaderOpens();
await seededRun();
await firstSteps();
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
