// The editor plays a page with sound in its preview (AUDIO.md A4): the
// built editor (npm run build-editor) served from the site's root, the
// guitar pedal opened, and its recording played through the preview. What
// reaches the speakers is tapped with an analyser, as test/sound-browser.ts
// does for the built page: it must be sound, driven louder than what came
// in, and Softer must reach the audio thread. Fails on any error or
// warning logged.
//
//   node editor/sound-smoke.ts
//
// Over the DevTools protocol, not Playwright, for the reason
// test/sound-browser.ts gives: Playwright pauses an AudioWorklet's start.

import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "sound-"));
const site = join(import.meta.dirname, "../..");
const server = createServer((q, r) => {
  const path = (q.url ?? "/").split("?")[0].replace(/^\/$/, "/index.html");
  if (path.includes("..")) { r.statusCode = 404; return r.end(); }
  try { r.end(readFileSync(join(site, path))); } catch { r.statusCode = 404; r.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const port = (server.address() as { port: number }).port;

const chrome = spawn(process.env.CHROMIUM ?? "/opt/google/chrome/chrome", [
  "--headless", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${join(dir, "profile")}`, "--no-first-run",
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
const errors: string[] = [];
try {
  const devtools = await new Promise<string>((resolve, reject) => {
    let said = "";
    chrome.stderr!.on("data", (d) => { said += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(said); if (m) resolve(m[1]); });
    chrome.on("exit", () => reject(new Error(`the browser stopped: ${said}`)));
  });
  const http = devtools.replace(/^ws/, "http").replace(/\/devtools\/.*/, "");
  const target = await (await fetch(`${http}/json/new?about:blank`, { method: "PUT" })).json() as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let next = 0;
  const waiting = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id !== undefined) return waiting.get(m.id)?.(m);
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) errors.push(m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" "));
  };
  const send = (method: string, params: object = {}) => new Promise<unknown>((resolve, reject) => {
    const id = next++;
    waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  // In the page, awaited; a click counts as the user's.
  const run = async <T>(f: string): Promise<T> => {
    const r = await send("Runtime.evaluate", { expression: `(async () => ${f})()`, awaitPromise: true, returnByValue: true, userGesture: true }) as { result: { value: T }; exceptionDetails?: { exception?: { description: string } } };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "it threw");
    return r.result.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  // What comes in and what goes to the speakers, each through an analyser.
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const connect = AudioNode.prototype.connect;
    window.taps = [];
    AudioNode.prototype.connect = function (to, ...rest) {
      const tap = () => { const a = this.context.createAnalyser(); a.fftSize = 2048; connect.call(this, a); return a; };
      if (to instanceof AudioWorkletNode) window.taps.push({ into: tap() });
      if (to === this.context.destination) window.taps[window.taps.length - 1].out = tap();
      return connect.call(this, to, ...rest);
    };
  })()` });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });
  for (let i = 0; i < 100 && !(await run<boolean>(`!!document.querySelector('[data-set="program"]')`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  await run(`[...document.querySelectorAll('[data-set="program"]')].find((b) => b.textContent.includes("guitar pedal")).click()`);
  const frame = `document.querySelector("iframe.page").contentDocument`;
  for (let i = 0; i < 100 && !(await run<boolean>(`${frame}?.querySelectorAll("button").length === 4`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  const click = (label: string) => run(`[...${frame}.querySelectorAll("button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
  const playing = async (label: string) => {
    for (let i = 0; i < 100; i++) {
      if (await run<boolean>(`[...${frame}.querySelectorAll("button")].find((b) => b.textContent === ${JSON.stringify(label)}).dataset.playing === "true"`)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${label} didn't start playing`);
  };
  // The loudest sample in and out over a second of playing.
  const peaks = (tap: number) => run<{ into: number; out: number }>(`(async () => {
    const t = window.taps[${tap}], buf = new Float32Array(2048);
    let into = 0, out = 0;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      t.into.getFloatTimeDomainData(buf); for (const x of buf) into = Math.max(into, Math.abs(x));
      t.out.getFloatTimeDomainData(buf); for (const x of buf) out = Math.max(out, Math.abs(x));
    }
    return { into, out };
  })()`);
  const check = (what: string, ok: boolean, detail: object) => { if (ok) console.log(`ok  ${what} ${JSON.stringify(detail)}`); else errors.push(`${what}: ${JSON.stringify(detail)}`); };

  // The strum is quieter: driven louder, then Softer turns it down.
  await click("A strum");
  await playing("A strum");
  const strum = await peaks(0);
  check("the recording, driven", strum.into > 0.01 && strum.out > 1.5 * strum.into, strum);
  await click("Softer");
  await click("Softer");
  const softer = await peaks(0);
  check("Softer reaches the audio thread", softer.out < strum.out * 0.9, { before: strum.out, after: softer.out });
  ws.close();
} catch (e) {
  errors.push((e as Error).message);
} finally {
  chrome.kill();
  server.close();
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("sound in the editor: ok");
