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

import { readFileSync } from "node:fs";
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
      await click('[data-act="t-run"]');
      await click('[data-act="t-values"]');
      await stopped(p);
      for (let k = 0; k < 6; k++) await click(".p-graph [data-id]", k);
      // The graph's menu, and the gestures it offers that only change the
      // layout: once per program, on its first definition.
      if (j === 0) {
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

const saved = readFileSync(new URL("smoke-saved.json", import.meta.url), "utf8");
const edited = JSON.stringify({ ...JSON.parse(saved), docs: { relations: { ...JSON.parse(saved).docs.relations, edited: true } } });
await visit(null);
const fresh = defs;
await visit(saved, "Relations in programs");
await visit(edited, "Relations in programs");
await browser.close();
console.log(`${fresh} definitions, and ${defs - fresh} more on programs saved by an older editor`);
if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exit(1);
}
