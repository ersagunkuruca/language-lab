// A page with sound in a real browser (AUDIO.md, A2): examples/pedal built
// as `lab build-web` builds it, served, and played in Chromium from its
// fake microphone (a beep) and from its recording. What reaches the
// speakers is tapped with an analyser: it must be sound, as loud as what
// came in (loudness matched) but driven (peaks squashed), and the Clean
// switch must cross to the audio thread (it gives back what came in).
// Fails on any error or warning the page logs.
//
//   node test/sound-browser.ts
//
// It drives the browser over the DevTools protocol itself: Playwright
// pauses each new worker for its debugger, and an AudioWorklet it doesn't
// resume never loads. It uses the Chromium in CHROMIUM if set, otherwise
// the installed Chrome.

import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "sound-"));
const built = spawnSync(process.execPath, [join(import.meta.dirname, "../cli/lab.ts"), "build-web", join(import.meta.dirname, "../examples/pedal"), "-o", join(dir, "pedal.html")], { encoding: "utf8" });
if (built.status !== 0) throw new Error(built.stderr);
const server = createServer((q, r) => {
  try { r.end(readFileSync(join(dir, (q.url ?? "/").split("?")[0]))); } catch { r.statusCode = 404; r.end(); }
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
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/pedal.html` });
  for (let i = 0; i < 100 && !(await run<boolean>(`document.querySelectorAll("button").length === 5`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  const click = (label: string) => run(`[...document.querySelectorAll("button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
  const playing = async (label: string) => {
    for (let i = 0; i < 100; i++) {
      if (await run<boolean>(`[...document.querySelectorAll("button")].find((b) => b.textContent === ${JSON.stringify(label)}).dataset.playing === "true"`)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${label} didn't start playing`);
  };
  // The loudest sample and the loudness (RMS) in and out over a second of
  // playing; loud over peak is the crest, which falls as the drive clips.
  const levels = (tap: number) => run<{ into: number; out: number; intoRms: number; outRms: number }>(`(async () => {
    const t = window.taps[${tap}], buf = new Float32Array(2048);
    let into = 0, out = 0, inSq = 0, outSq = 0, n = 0;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      t.into.getFloatTimeDomainData(buf); for (const x of buf) { into = Math.max(into, Math.abs(x)); inSq += x * x; }
      t.out.getFloatTimeDomainData(buf); for (const x of buf) { out = Math.max(out, Math.abs(x)); outSq += x * x; }
      n += buf.length;
    }
    return { into, out, intoRms: Math.sqrt(inSq / n), outRms: Math.sqrt(outSq / n) };
  })()`);
  // Driven: about as loud as what came in, under the speakers' limit, its
  // peaks squashed towards its loudness.
  const driven = (l: { into: number; out: number; intoRms: number; outRms: number }) =>
    l.intoRms > 0.005 && l.out < 1 && l.outRms < 1.6 * l.intoRms && l.outRms > l.intoRms / 1.6 && l.out / l.outRms < 0.8 * (l.into / l.intoRms);
  const check = (what: string, ok: boolean, detail: object) => { if (ok) console.log(`ok  ${what} ${JSON.stringify(detail)}`); else errors.push(`${what}: ${JSON.stringify(detail)}`); };

  // The fake microphone beeps at full scale, on and off: driven, it comes
  // out as loud and under the speakers' limit. (Each beep starts from
  // silence, so the compressor's attack lets its first samples through
  // high, to the limit: its crest doesn't fall.)
  await click("Guitar in (microphone)");
  await playing("Guitar in (microphone)");
  const mic = await levels(0);
  check("the microphone, driven", mic.intoRms > 0.005 && mic.out < 1 && mic.outRms < 1.6 * mic.intoRms && mic.outRms > mic.intoRms / 1.6, mic);
  await click("Guitar in (microphone)");

  // The strum, driven; then Clean (a write that crosses to the audio
  // thread) gives it back as it came in.
  await click("A strum");
  await playing("A strum");
  const strum = await levels(1);
  check("the recording, driven", driven(strum), strum);
  await click("Driven");
  await new Promise((r) => setTimeout(r, 300));
  const clean = await levels(1);
  check("Clean reaches the audio thread: what came in", clean.intoRms > 0.005 && Math.abs(clean.out - clean.into) < 0.05 * clean.into, clean);
  ws.close();
} catch (e) {
  errors.push((e as Error).message);
} finally {
  chrome.kill();
  server.close();
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("sound in a browser: ok");
