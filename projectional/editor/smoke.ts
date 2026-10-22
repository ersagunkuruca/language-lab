// The built page in a real browser: open every example program, every
// definition in it, run it, show its values and click its first nodes, and
// fail on any error the page throws or logs. The unit tests can't catch a
// view that throws while drawing; this can.
//
//   npm run build-editor && npm run smoke [-- url of another build]
//
// It uses the Chromium in CHROMIUM if set, otherwise the installed Chrome.

import { chromium } from "playwright-core";

const page = process.argv[2] ?? new URL("../../index.html", import.meta.url).href;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: "chrome" });
const p = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errors: string[] = [];
let where = "loading";
p.on("pageerror", (e) => errors.push(`${where}: ${e.stack ?? e.message}`));
p.on("console", (m) => { if (m.type() === "error") errors.push(`${where}: ${m.text()}`); });

const click = async (selector: string, i = 0) => {
  const el = p.locator(selector).nth(i);
  if (await el.count()) await el.click({ timeout: 500 }).catch(() => {});
};

await p.goto(page);
const programs = await p.locator('[data-set="program"]').allInnerTexts();
if (programs.length < 2) errors.push(`only ${programs.length} programs in the picker`);
let defs = 0;
for (const [i, program] of programs.entries()) {
  where = program;
  await click('[data-set="program"]', i);
  const names = await p.locator("[data-def]").allInnerTexts();
  for (const [j, def] of names.entries()) {
    where = `${program} / ${def}`;
    await click("[data-def]", j);
    await click('[data-act="t-run"]');
    await click('[data-act="t-values"]');
    for (let k = 0; k < 6; k++) await click(".p-graph [data-id]", k);
    defs++;
    if (process.env.SMOKE_LOG) console.log(where, Math.round(performance.now()));
  }
}
await browser.close();
console.log(`${programs.length} programs, ${defs} definitions`);
if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exit(1);
}
