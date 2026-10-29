// The editing gestures, one scenario each, on the editor's own page in
// Node (test/editor-page.ts, TESTING.md T10), written as they were in the
// browser smoke (editor/smoke.ts) against a stand-in for Playwright's page.
// The ones that need where things are on screen stay in the browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { B } from "../src/prelude.ts";
import { toFile } from "../editor/files.ts";
import { openEditor } from "./editor-page.ts";

const page = "index.html";
const errors: string[] = [];
let where = "";
const open: ReturnType<typeof openEditor>[] = [];
const noop = () => {};
// Playwright's browser and page, as far as the scenarios use them.
const browser = {
  async newPage(_?: unknown) {
    const e = openEditor();
    open.push(e);
    type Said = { stack?: string; message: string; type(): string; text(): string };
    let onConsole: (said: Said) => void = noop;
    const take = () => { for (const m of e.errors.splice(0)) onConsole({ message: m, type: () => "error", text: () => m }); };
    const near = new Proxy({}, { get: () => { throw new Error("needs a browser's layout"); } });
    return {
      // What the page throws or logs as an error is said once, as an error.
      on(kind: string, f: (said: Said) => void) { if (kind === "console") onConsole = f; else if (onConsole === noop) onConsole = f; },
      async goto(_: string) {},
      locator: (s: string, o?: { hasText?: string | RegExp }) => e.locator(s, o),
      keyboard: e.keyboard,
      mouse: near,
      async setViewportSize() { throw new Error("needs a browser's layout"); },
      async waitForTimeout(ms: number) { await new Promise((r) => setTimeout(r, ms)); },
      async waitForEvent(): Promise<never> { throw new Error("needs a browser"); },
      async evaluate(): Promise<never> { throw new Error("needs a browser"); },
      async close() { take(); await e.close(); },
      take,
    };
  },
};
async function stopped(p: { locator(s: string): { allInnerTexts(): Promise<string[]> } }) {
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
  // Insert a node after it says so, not "Wrapped it" (I33).
  await p.locator(".p-graph g:has(> text:text-is('·')) > rect.cn").first().click({ button: "right" });
  await p.locator('[data-menu="wrap"]').click();
  await p.locator("#m-query").fill("negate");
  await p.locator(".ctx-menu button", { hasText: /^negate/ }).first().click({ timeout: 2000 }).catch(() => errors.push(`${where}: no negate to insert after ·`));
  if (!/^Inserted the call after it/.test(await p.locator(".status").innerText())) errors.push(`${where}: inserting a node after · says ${await p.locator(".status").innerText()}`);
  await p.locator('button[data-act="undo"]').first().click();
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

const scenarios = { deleteAndUndo, swapAndUndo, implementInterface, choiceAction, heldSeed, listItems, sharedRow, matchDeeper, foldFrom, answeredLater, helperAtValue, textPort, newAndDeleteDefinition };
for (const [name, run] of Object.entries(scenarios)) {
  test(name, async () => {
    errors.length = 0;
    try { await run(); } catch (e) { errors.push(`${where}: ${e instanceof Error ? e.message : String(e)}`); }
    for (const e of open.splice(0)) { await e.close().catch(() => {}); for (const m of e.errors) errors.push(`${where}: ${m}`); }
    if (errors.length) assert.fail(errors.map((e) => e.split("\n")[0]).join("\n"));
  });
}
