import { chromium } from "playwright-core";
import { createServer } from "node:http";
const server = createServer((q, r) => { r.setHeader("content-type", q.url!.endsWith(".js") ? "text/javascript" : "text/html"); r.end(q.url!.endsWith(".js") ? "registerProcessor('x', class extends AudioWorkletProcessor { process() { return true; } })" : "<p>hi</p>"); }).listen(8124);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", ...(process.env.IGN === "all" ? { ignoreDefaultArgs: true } : process.env.IGN ? { ignoreDefaultArgs: process.env.IGN.split(" ") } : {}), args: (process.env.ARGS ?? "").split(" ").filter(Boolean) });
const p = await (await b.newContext()).newPage();
p.on("console", (m) => console.log(m.type(), m.text()));
await p.goto("http://127.0.0.1:8124/");
console.log(await p.evaluate(async () => {
  const out: string[] = [String(isSecureContext)];
  const wk = new Worker(URL.createObjectURL(new Blob(["postMessage(1)"])));
  out.push(await Promise.race([new Promise((r) => (wk.onmessage = () => r("worker ok"))), new Promise((r) => setTimeout(() => r("worker timeout"), 2000))]) as string);
  const ctx = new AudioContext();
  out.push(await Promise.race([ctx.audioWorklet.addModule("/w.js").then(() => "module ok", (e) => "err " + e), new Promise((r) => setTimeout(() => r("module timeout"), 20000))]) as string);
  return out;
}));
await b.close(); server.close();
