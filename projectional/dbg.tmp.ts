import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const server = createServer((q, r) => { try { r.end(readFileSync("/tmp/claude-0/site" + q.url!.split("?")[0])); } catch { r.statusCode = 404; r.end(); } }).listen(8123);
const b = await chromium.launch({ executablePath: process.env.EXE ?? "/opt/pw-browsers/chromium", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", ...(process.env.ARGS ? process.env.ARGS.split(" ") : [])] });
const c = await b.newContext(); await c.grantPermissions(["microphone"]);
const p = await c.newPage();
p.on("console", (m) => console.log(m.type(), m.text()));
await p.goto("http://localhost:8123/pedal.html" + (process.env.Q ?? ""));
console.log(await p.evaluate(async () => {
  const out: string[] = [];
  const ctx = location.search.includes("offline") ? new OfflineAudioContext(1, 48000, 48000) : new AudioContext(); out.push(ctx.state);
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); out.push("mic " + s.getTracks().length); } catch (e) { out.push("mic err " + e); }
  const url = location.search.includes("served") ? "/w.js" : URL.createObjectURL(new Blob(["registerProcessor('x', class extends AudioWorkletProcessor { process() { return true; } })"], { type: "text/javascript" }));
  try { await Promise.race([ctx.audioWorklet.addModule(url), new Promise((_, j) => setTimeout(() => j("timeout"), 3000))]); out.push("module ok"); } catch (e) { out.push("module err " + e); }
  return out;
}));
await p.getByRole("button", { name: "Guitar in (microphone)" }).click();
await p.waitForTimeout(3000);
console.log(await p.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.outerHTML)));
await b.close(); server.close();
