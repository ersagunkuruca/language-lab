import { chromium } from "playwright-core";
import { mkdtempSync } from "node:fs";
const c = await chromium.launchPersistentContext(mkdtempSync("/tmp/claude-0/prof-"), { executablePath: "/opt/pw-browsers/chromium", args: (process.env.ARGS ?? "").split(" ").filter(Boolean) });
const p = c.pages()[0] ?? await c.newPage();
await p.goto("http://127.0.0.1:8125/" + (process.env.T ?? "t.html"));
await p.waitForTimeout(5000);
console.log(await p.textContent("#r"));
await c.close();
