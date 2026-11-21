// Pages with sound in a real browser (AUDIO.md, A2): examples/pedal built
// as `ters build-web` builds it, served, and played in Chromium from its
// fake microphone (a beep) and from its recording. What reaches the
// speakers is tapped with an analyser: it must be sound, as loud as what
// came in (loudness matched) but driven (peaks squashed), and the Clean
// switch must cross to the audio thread (it gives back what came in). A
// microphone that won't open must say why on the page. Then
// examples/metronome, a sound with no input (L268): it clicks at its
// tempo, a change of tempo crosses to the audio thread, and the pulses it
// counts cross back to the page (L267). Then examples/tuner (L274): a
// microphone that is a sawtooth at G3, then 10 cents sharp of it, and the
// page reads G and the cents from the samples the audio thread sends back.
// Then examples/looper (L276): its microphone hears the speakers 50 ms
// late, as a microphone held to them does; Measure, before Start, starts
// the sound, finds that round trip and stops the sound again,
// the same again, and says a round trip changing under it is unsteady;
// stopped, it stays stopped, and started again it moves at its pace;
// a pass records a tone, the track plays it back, and Undo takes it away
// and puts it back. Then examples/strum-tuner (L277): a microphone that
// is six sawtooth strings, each a few cents off, read string by string.
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
for (const page of ["pedal", "metronome", "tuner", "looper", "strum-tuner", "frets"]) {
  const built = spawnSync(process.execPath, [join(import.meta.dirname, "../cli/ters.ts"), "build-web", join(import.meta.dirname, `../examples/${page}`), "-o", join(dir, `${page}.html`)], { encoding: "utf8" });
  if (built.status !== 0) throw new Error(built.stderr);
}
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
      // A sound with no input has no tap on what comes in.
      if (to === this.context.destination) { const last = window.taps[window.taps.length - 1]; if (last && !last.out) last.out = tap(); else window.taps.push({ out: tap() }); }
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

  // A microphone that won't open says why on its button, in words.
  await run(`navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Could not start audio source", "NotReadableError"))`);
  await click("Guitar in (microphone)");
  let said = "";
  for (let i = 0; i < 50 && !said; i++) { said = await run<string>(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Guitar in (microphone)").dataset.said ?? ""`); if (!said) await new Promise((r) => setTimeout(r, 100)); }
  check("a microphone that won't open says why on the page", /another program may be using it/.test(said), { said });
  // It says so in the console too, which is expected here.
  for (let i = errors.length - 1; i >= 0; i--) if (errors[i].startsWith("sound: the microphone couldn't be opened")) errors.splice(i, 1);

  // The metronome: no input, so no microphone is asked for. Its clicks,
  // counted over three seconds: 6 at 120 pulses a minute, 12 at 240.
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/metronome.html` });
  for (let i = 0; i < 100 && !(await run<boolean>(`!!document.querySelector("button.start") && window.taps.length === 0`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  await run(`navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error("a sound with no input asked for the microphone"))`);
  await run(`document.querySelector("button.start").click()`);
  for (let i = 0; i < 100 && !(await run<boolean>(`document.querySelector("button.start").dataset.playing === "true"`)); i++) await new Promise((r) => setTimeout(r, 100));
  const clicks = () => run<number>(`(async () => {
    const a = window.taps[0].out, buf = new Float32Array(a.fftSize);
    let n = 0, was = false;
    const end = performance.now() + 3000;
    while (performance.now() < end) {
      await new Promise((r) => setTimeout(r, 10));
      a.getFloatTimeDomainData(buf);
      let peak = 0; for (const x of buf) peak = Math.max(peak, Math.abs(x));
      if (peak > 0.05 && !was) n++;
      was = peak > 0.05;
    }
    return n;
  })()`);
  await run(`window.taps[0].out.fftSize = 512`);
  const at120 = await clicks();
  check("the metronome clicks at its tempo, with no input", Math.abs(at120 - 6) <= 1, { at120 });
  await run(`(() => { const r = document.querySelector("input[type=range]"); r.value = "240"; r.dispatchEvent(new Event("input")); })()`);
  await new Promise((r) => setTimeout(r, 200));
  const at240 = await clicks();
  check("a change of tempo reaches the audio thread", Math.abs(at240 - 12) <= 1, { at240 });
  // The pulses its block function counts come back to the page (L267),
  // which lights the part sounding: it moves on as it plays.
  const lit = await run<number[]>(`(async () => {
    const seen = [];
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const row = document.querySelector(".pattern g");
      seen.push([...row.querySelectorAll("circle")].findIndex((c) => c.classList.contains("now")));
    }
    return seen;
  })()`);
  check("the page lights the part sounding, from the audio thread", new Set(lit.filter((i) => i >= 0)).size >= 3, { lit });

  // The tuner: its microphone a sawtooth (every harmonic) at G3, 196 Hz.
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/tuner.html` });
  for (let i = 0; i < 100 && !(await run<boolean>(`!!document.querySelector("button.start")`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  await run(`(() => {
    const ctx = new AudioContext(), osc = ctx.createOscillator(), out = ctx.createMediaStreamDestination(), g = ctx.createGain();
    osc.type = "sawtooth"; osc.frequency.value = 196; g.gain.value = 0.3;
    osc.connect(g); g.connect(out); osc.start();
    window.tone = osc;
    navigator.mediaDevices.getUserMedia = async () => out.stream;
  })()`);
  await run(`document.querySelector("button.start").click()`);
  const reads = (cents: number) => run<{ note: string; cents: string }>(`(async () => {
    window.tone.frequency.value = 196 * Math.pow(2, ${cents} / 1200);
    let seen = { note: "", cents: "" };
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const n = document.querySelector(".note"), c = document.querySelector(".cents");
      seen = { note: n ? n.textContent : "", cents: c ? c.textContent : "" };
      if (i > 8 && c && Math.abs(parseFloat(seen.cents.replace("−", "-")) - ${cents}) < 1.5) break;
    }
    return seen;
  })()`);
  const inTune = await reads(0), sharp = await reads(10);
  check("the tuner reads G3 in tune from the microphone", inTune.note === "G3" && Math.abs(parseFloat(inTune.cents)) < 1.5, inTune);
  check("and 10 cents sharp of it", sharp.note === "G3" && Math.abs(parseFloat(sharp.cents) - 10) < 1.5, sharp);

  // The looper: what it plays comes back in 50 ms later, with a tone that
  // can be turned on mixed in.
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/looper.html` });
  for (let i = 0; i < 100 && !(await run<boolean>(`!!document.querySelector("button.start")`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  await run(`(() => {
    const made = window.AudioContext;
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = window.looped, d = ctx.createDelay(1), out = ctx.createMediaStreamDestination(), osc = ctx.createOscillator(), g = ctx.createGain();
      d.delayTime.value = 0.05; d.connect(out);
      osc.frequency.value = 440; g.gain.value = 0; osc.connect(g); g.connect(out); osc.start();
      window.back = d; window.tone = g;
      return out.stream;
    };
    window.AudioContext = class extends made { constructor(o) { super(o); window.looped = this; } };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (to, ...rest) {
      if (to === this.context.destination && window.back && this instanceof AudioWorkletNode) connect.call(this, window.back);
      return connect.call(this, to, ...rest);
    };
  })()`);
  const button = (label: string) => `[...document.querySelectorAll("button")].find((b) => b.textContent === ${JSON.stringify(label)})`;
  const until = async (what: string, test: string, ms = 10000) => {
    for (let t = 0; t < ms; t += 100) { if (await run<boolean>(test)) return; await new Promise((r) => setTimeout(r, 100)); }
    throw new Error(`the looper: ${what} didn't happen (${await run<string>(`document.querySelector(".figures")?.textContent`)})`);
  };
  // Measure before Start starts the sound it needs, and Start says Stop.
  await run(`${button("Measure")}.click()`);
  await until("playing", `document.querySelector("button.start").dataset.playing === "true"`);
  check("Measure starts the sound, and Start says Stop", await run<string>(`document.querySelector("button.start").textContent`) === "Stop", {});
  await until("the measurement", `/Round trip [0-9]/.test(document.querySelector(".figures").textContent)`);
  const trip = await run<number>(`parseFloat(/Round trip ([0-9.]+)/.exec(document.querySelector(".figures").textContent)[1])`);
  check("the looper measures the round trip through its speakers and microphone", trip >= 50 && trip < 150, { trip });
  // The sound Measure started stops when it's done (I338).
  await until("stopping", `document.querySelector("button.start").textContent === "Start"`);
  // Measured again, the same to a tenth of a millisecond or so; and a
  // way from speaker to microphone that changes between the chirps
  // (a noise taken for one, or a device's buffer slipping) is no round
  // trip, but each chirp's figure.
  const figures = () => run<string>(`document.querySelector(".figures").textContent`);
  const measure = async (during = "") => {
    await run(`(() => { ${button("Measure")}.click(); ${during} })()`);
    await until("listening", `/listening/.test(document.querySelector(".figures").textContent)`);
    await until("the measurement", `!/listening/.test(document.querySelector(".figures").textContent)`);
    return figures();
  };
  const again = parseFloat(/Round trip ([0-9.]+)/.exec(await measure())?.[1] ?? "NaN");
  check("measured again, the same", Math.abs(again - trip) <= 0.2, { trip, again });
  const unsteady = await measure(`setTimeout(() => (window.back.delayTime.value = 0.08), 450); setTimeout(() => (window.back.delayTime.value = 0.12), 950);`);
  await run(`window.back.delayTime.value = 0.05`);
  check("a round trip that keeps changing is said to be unsteady, with each chirp's", /unsteady \([0-9.]+ ms, [0-9.]+ ms, [0-9.]+ ms\)/.test(unsteady), { unsteady });
  await measure();
  await run(`document.querySelector("button.start").click()`);
  await until("playing", `document.querySelector("button.start").dataset.playing === "true"`);
  // The loop a second long (a bar of 4 at 240), with no click to record.
  await run(`(() => { ${button("Measured")}.click(); ${button("Click")}.click(); })()`);
  await run(`(() => { const [tempo, beats, bars] = document.querySelectorAll(".field input"); for (const [f, v] of [[tempo, "240"], [beats, "4"], [bars, "1"]]) { f.value = v; f.dispatchEvent(new Event("input")); } })()`);
  const loudness = () => run<number>(`(async () => {
    const a = window.taps[window.taps.length - 1].out, buf = new Float32Array(a.fftSize);
    let s = 0, n = 0;
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 20)); a.getFloatTimeDomainData(buf); for (const x of buf) { s += x * x; n++; } }
    return Math.sqrt(s / n);
  })()`);
  // What the click already sent out (started just now) dies away first.
  await new Promise((r) => setTimeout(r, 300));
  const silent = await loudness();
  await run(`(() => { window.tone.gain.value = 0.3; ${button("Record")}.click(); })()`);
  await until("recording", `!!${button("Recording")}`);
  await new Promise((r) => setTimeout(r, 300));
  // Pressed again, it stops when the pass ends.
  await run(`${button("Recording")}.click()`);
  await until("the pass ending", `!${button("Recording")} && !document.querySelector(".track .state").textContent`);
  await run(`window.tone.gain.value = 0`);
  await new Promise((r) => setTimeout(r, 200));
  const played = await loudness();
  const drawn = await run<number>(`Math.max(...[...document.querySelector(".track .wave").querySelectorAll("rect")].map((r) => parseFloat(r.getAttribute("height"))))`);
  await run(`${button("Undo")}.click()`);
  await new Promise((r) => setTimeout(r, 300));
  const undone = await loudness();
  await run(`${button("Undo")}.click()`);
  await new Promise((r) => setTimeout(r, 300));
  const redone = await loudness();
  check("the looper plays back what it recorded, and Undo takes it away and puts it back", silent < 0.01 && played > 0.1 && undone < 0.01 && redone > 0.1 && drawn > 20, { silent, played, undone, redone, drawn });
  // Start again stops it, and it stays stopped: a stopped sound's
  // processor went on running, so a second start had two moving the loop.
  const where = () => run<number>(`parseFloat(document.querySelector(".where progress").value)`);
  await run(`document.querySelector("button.start").click()`);
  await until("stopping", `document.querySelector("button.start").dataset.playing === "false" && document.querySelector("button.start").textContent === "Start"`);
  await new Promise((r) => setTimeout(r, 200));
  const stopped = [await where()];
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 150)); stopped.push(await where()); }
  await run(`document.querySelector("button.start").click()`);
  await until("playing again", `document.querySelector("button.start").dataset.playing === "true"`);
  const t0 = await where(), s0 = Date.now();
  await new Promise((r) => setTimeout(r, 300));
  const moved = ((await where()) - t0 + 1) % 1, seconds = (Date.now() - s0) / 1000;
  const label = await run<string>(`document.querySelector("button.start").textContent`);
  check("stopped, the looper stays where it is; started again, it moves at its pace", new Set(stopped).size === 1 && Math.abs(moved - seconds) < 0.15 && label === "Stop", { stopped, moved, seconds, label });

  // The strum tuner: six strings sounding at once, each off by its own cents.
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/strum-tuner.html` });
  for (let i = 0; i < 100 && !(await run<boolean>(`!!document.querySelector("button.start")`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  const off = [0, 8, -12, 4, -6, 15];
  await run(`(() => {
    const ctx = new AudioContext(), out = ctx.createMediaStreamDestination();
    [82.40688922821748, 110, 146.8323839587038, 195.99771799087463, 246.94165062806206, 329.6275569128699].forEach((f, j) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "sawtooth"; osc.frequency.value = f * Math.pow(2, ${JSON.stringify(off)}[j] / 1200); g.gain.value = 0.05;
      osc.connect(g); g.connect(out); osc.start();
    });
    navigator.mediaDevices.getUserMedia = async () => out.stream;
  })()`);
  await run(`document.querySelector("button.start").click()`);
  const strings = await run<{ name: string; cents: string }[]>(`(async () => {
    const read = () => [...document.querySelectorAll(".string")].map((r) => ({ name: r.querySelector(".name").textContent, cents: r.querySelector(".cents").textContent }));
    let seen = read();
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 100));
      seen = read();
      if (i > 15 && seen.every((s) => s.cents !== "—")) break;
    }
    return seen;
  })()`);
  const cents = strings.map((s) => parseFloat(s.cents.replace("−", "-")));
  check("the strum tuner reads all six strings at once, each within 2 cents", strings.length === 6 && cents.every((c, j) => Math.abs(c - off[j]) <= 2), strings);

  // Frets: fret 7 of 12-TET on a 650 mm scale played 10 cents sharp over
  // an open string at 110 Hz, which plays as if the fret sat 2.5 mm
  // further from the nut.
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/frets.html` });
  for (let i = 0; i < 100 && !(await run<boolean>(`!!document.querySelector("button.start")`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  await run(`(() => {
    const ctx = new AudioContext(), out = ctx.createMediaStreamDestination(), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = "sawtooth"; osc.frequency.value = 110 * Math.pow(2, 710 / 1200); g.gain.value = 0.2;
    osc.connect(g); g.connect(out); osc.start();
    navigator.mediaDevices.getUserMedia = async () => out.stream;
    const field = (name, v) => { const i = [...document.querySelectorAll(".field")].find((f) => f.querySelector("span").textContent === name).querySelector("input"); i.value = v; i.dispatchEvent(new Event("input")); };
    [...document.querySelectorAll("button")].find((b) => b.textContent === "12-TET").click();
    field("Scale (mm)", "650"); field("Open (Hz)", "110");
  })()`);
  await new Promise((r) => setTimeout(r, 200));
  await run(`[...document.querySelectorAll("tbody tr")][6].click()`);
  const seventh = await run<string>(`[...document.querySelectorAll("tbody tr")][6].children[2].textContent`);
  await run(`document.querySelector("button.start").click()`);
  const advice = await run<{ off: string; advice: string }>(`(async () => {
    const read = () => ({ off: document.querySelector(".check .off").textContent, advice: document.querySelector(".check .advice").textContent });
    let seen = read();
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 100));
      seen = read();
      if (i > 10 && seen.advice.startsWith("Move")) break;
    }
    return seen;
  })()`);
  check("the frets page places fret 7 and says to move it 2.5 mm toward the nut when it plays 10 cents sharp", seventh === "216.2" && advice.advice === "Move 2.5 mm toward the nut" && Math.abs(parseFloat(advice.off.replace("−", "-")) - 10) <= 1, { seventh, ...advice });
  ws.close();
} catch (e) {
  errors.push((e as Error).message);
} finally {
  chrome.kill();
  server.close();
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("sound in a browser: ok");
