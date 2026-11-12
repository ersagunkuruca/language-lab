// A webview app tried on an emulator (C198): the page inside Capacitor's
// WebView read and tapped through the WebView's DevTools socket (a debug
// build's WebView allows it), since the accessibility tree uiautomator
// reads may hold no view for what the page shows. Args: the app's id;
// TAPS (split at |) are buttons' texts. Prints whether the page is
// online, what it says before and after each tap, and its console.
import { execFileSync } from "node:child_process";

const adb = (...a) => execFileSync("adb", a, { encoding: "utf8" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = process.argv[2];
const taps = (process.env.TAPS ?? "").split("|").filter(Boolean);

let socket;
for (let i = 0; i < 20 && !socket; i++) {
  const pid = adb("shell", "pidof", app).trim();
  socket = pid && adb("shell", "cat", "/proc/net/unix").match(new RegExp(`@(webview_devtools_remote_${pid})\\b`))?.[1];
  if (!socket) await sleep(1000);
}
if (!socket) { console.log("webview: no DevTools socket"); process.exit(1); }
adb("forward", "tcp:9222", `localabstract:${socket}`);
const pages = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = pages.find((p) => p.type === "page");
console.log("webview page:", page?.url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const waiting = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  else if (m.method === "Runtime.consoleAPICalled") console.log(`console.${m.params.type}:`, m.params.args.map((a) => a.value ?? a.description).join(" "));
  else if (m.method === "Runtime.exceptionThrown") console.log("exception:", m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const run = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send("Runtime.enable");
await sleep(2000);
console.log("online:", await run("navigator.onLine"));
console.log("service worker:", await run("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then((r) => r.length) : 'none'"));
const says = async (name) => console.log(`---- ${name}\n` + (await run("document.body.innerText"))?.slice(0, 600));
await says("started");
for (const [i, t] of taps.entries()) {
  const hit = await run(`(() => { const b = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(t)}); if (!b) return false; b.click(); return true; })()`);
  if (!hit) { console.log(`tap ${t}: no such button`); continue; }
  await sleep(1500);
  await says(`after tapping ${t}`);
  adb("shell", "screencap", "-p", `/sdcard/web${i}.png`); adb("pull", `/sdcard/web${i}.png`, `web${i}.png`);
}
ws.close();
