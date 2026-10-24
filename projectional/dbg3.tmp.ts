import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: (process.env.ARGS ?? "").split(" ").filter(Boolean) });
const p = await (await b.newContext()).newPage();
await p.goto("http://127.0.0.1:8125/" + (process.env.T ?? "t.html"));
await p.waitForTimeout(5000);
console.log(await p.textContent("#r"));
await b.close();
