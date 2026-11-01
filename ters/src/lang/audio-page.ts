// The page's side of a page with sound (AUDIO.md, A2). An element with a
// `listen` attribute plays when it's clicked (browsers start sound only
// on a gesture) and stops when it's clicked again: its input, through an
// AudioWorkletNode running the page's program on the audio thread
// (audio-worklet.ts), to the speakers. Each write to a cell main made
// goes to the audio thread too, so a knob turns while it plays. What goes
// wrong (no microphone, not allowed, silence) is said on the element in
// words, not only in the console.

import type { Cells } from "./cells.ts";
import { listens } from "./audio.ts";
import { PROCESSOR, type Write } from "./audio-worklet.ts";
import type { El } from "./html.ts";
import type { Data, Value } from "./run.ts";
import { HTML_V } from "./std.ts";

// Run around main: records its cells in the order it made them, then
// returns what draws a `listen` attribute. `worklet` is the program
// bundled with audio-worklet.ts, as a script.
// `base` is where a recording's address is read from (the page's own
// address when not given): the editor's preview finds them under apps/.
// `stop` ends everything playing and closes the audio: a page that is
// gone, replaced or left must not keep sounding.
export function soundPlayer(cells: Cells, worklet: string, main: () => Value, base?: string) {
  // By their place among main's cells, which is their place on the audio
  // thread too (the handler's own count may have started before main).
  const made: Value[] = [], mine = new Map<number, number>();
  cells.onCell = (c, at) => { mine.set(at, made.length); made.push(c); };
  let page: Value;
  try { page = main(); } finally { cells.onCell = null; }
  const place = new Map(listens(page).map((a, i) => [a, i]));
  const playing = new Set<{ port: MessagePort }>();
  const send = (w: Write) => {
    for (const node of playing) {
      // A value that can't be copied (a function) stays on the page.
      try { node.port.postMessage(w); } catch { return; }
    }
  };
  cells.onWrite = (at, value) => { const cell = mine.get(at); if (cell !== undefined && playing.size) send({ cell, value }); };
  // One context, at the device's rate; another only for a microphone at a
  // rate the browser won't convert (Firefox refuses to connect across rates).
  const contexts = new Map<number, Promise<AudioContext>>();
  let closed = false;
  const going = new Set<() => void>();
  const start = (sampleRate = 0) => {
    let made = contexts.get(sampleRate);
    if (!made) {
      contexts.set(sampleRate, made = (async () => {
        const ctx = new AudioContext(sampleRate ? { latencyHint: "interactive", sampleRate } : { latencyHint: "interactive" });
        const url = URL.createObjectURL(new Blob([worklet], { type: "text/javascript" }));
        await ctx.audioWorklet.addModule(url);
        return ctx;
      })());
      made.catch(() => contexts.delete(sampleRate));
    }
    return made;
  };

  async function microphone(ctx: AudioContext): Promise<{ ctx: AudioContext; node: AudioNode; stop: () => void }> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("this browser gives no microphone here: a page needs https (or localhost) for one");
    // The guitar as it is: no echo cancelling, noise gate or gain riding.
    // Asked for, not demanded, and nothing about the rate or channels, so
    // a headset's 16 or 44.1 kHz mono microphone is taken as it comes.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      if ((e as DOMException).name !== "OverconstrainedError") throw new Error(micProblem(e as DOMException));
      stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((e2) => { throw new Error(micProblem(e2)); });
    }
    const stop = () => stream.getTracks().forEach((t) => t.stop());
    try {
      return { ctx, node: ctx.createMediaStreamSource(stream), stop };
    } catch (e) {
      const rate = stream.getAudioTracks()[0]?.getSettings().sampleRate;
      if (!rate || rate === ctx.sampleRate) { stop(); throw e; }
      const own = await start(rate);
      if (own.state === "suspended") await own.resume();
      return { ctx: own, node: own.createMediaStreamSource(stream), stop };
    }
  }

  async function source(ctx: AudioContext, to: Data): Promise<{ ctx: AudioContext; node: AudioNode; stop: () => void }> {
    if (to.tag === HTML_V.microphone) return microphone(ctx);
    const reply = await fetch(base ? new URL(String(to.fields[0]), new URL(base, location.href)).href : String(to.fields[0]));
    if (!reply.ok) throw new Error(`${to.fields[0]}: ${reply.status} ${reply.statusText}`);
    const s = ctx.createBufferSource();
    s.buffer = await ctx.decodeAudioData(await reply.arrayBuffer());
    s.loop = true;
    s.start();
    return { ctx, node: s, stop: () => s.stop() };
  }

  return {
    page,
    // Ends what plays; a click plays again.
    hush() { for (const end of [...going]) end(); },
    stop() {
      closed = true;
      for (const end of [...going]) end();
      const all = [...contexts.values()];
      contexts.clear();
      for (const ctx of all) void ctx.then((c) => c.close()).catch(() => {});
    },
    listen(e: El, a: Data) {
      const index = place.get(a);
      if (index === undefined) { console.error("a listen inside a part doesn't play: put it where main returns it"); return; }
      showSaid(e);
      const say = (why: string | null) => e.setAttribute("data-said", why ?? "");
      let on: { stop: () => void } | null = null;
      e.addEventListener("click", async () => {
        if (on) { on.stop(); return; }
        if (closed) return;
        on = { stop: () => {} };
        say(null);
        try {
          const first = await start();
          if (first.state === "suspended") await first.resume();
          const from = await source(first, a.fields[0] as Data), ctx = from.ctx;
          // Mono in: a stereo input is mixed down, so a microphone on either
          // channel is heard.
          const node = new AudioWorkletNode(ctx, PROCESSOR, { processorOptions: { index }, numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers" });
          node.port.onmessage = (m: MessageEvent<{ said: string }>) => { console.warn(`sound: ${m.data.said}`); say(m.data.said); };
          // The cells as the page has them now, before what's written next.
          for (const [cell, c] of made.entries()) { try { node.port.postMessage({ cell, value: cells.peek(c) }); } catch { /* not copied */ } }
          from.node.connect(node).connect(ctx.destination);
          playing.add(node);
          const quiet = (a.fields[0] as Data).tag === HTML_V.microphone ? silence(ctx, from.node, () => say("the microphone sends silence: is it muted (a headset often has a switch on its cable), or is another input chosen in the system's sound settings?")) : () => {};
          const end = () => { quiet(); from.stop(); from.node.disconnect(); node.disconnect(); playing.delete(node); going.delete(end); on = null; e.setAttribute("data-playing", "false"); };
          on = { stop: end };
          going.add(end);
          // Stopped while it was starting: nothing plays.
          if (closed) return end();
          e.setAttribute("data-playing", "true");
        } catch (err) {
          on = null;
          console.error(`sound: ${(err as Error).message}`);
          say((err as Error).message);
          e.setAttribute("data-playing", "false");
        }
      });
    },
  };
}

// What getUserMedia's refusals mean, in words.
function micProblem(e: DOMException): string {
  switch (e.name) {
    case "NotAllowedError": return "the microphone wasn't allowed: allow it in the site settings by the address bar, then click again";
    case "NotFoundError": return "no microphone was found: is the headset plugged in, and chosen as the input in the system's sound settings?";
    case "NotReadableError": return "the microphone couldn't be opened: another program may be using it, or its driver refused; close the other program or pick another input, then click again";
    case "SecurityError": return "this page isn't allowed a microphone (it needs https, and an iframe needs allow=\"microphone\")";
    default: return `the microphone didn't open: ${e.name ? `${e.name}, ` : ""}${e.message}`;
  }
}

// Calls `quiet` once if the first three seconds from `node` are all
// silence; gives what stops listening.
function silence(ctx: AudioContext, node: AudioNode, quiet: () => void): () => void {
  const a = ctx.createAnalyser(), buf = new Float32Array(a.fftSize);
  node.connect(a);
  let loudest = 0;
  const look = setInterval(() => { a.getFloatTimeDomainData(buf); for (const x of buf) loudest = Math.max(loudest, Math.abs(x)); }, 100);
  const done = setTimeout(() => { clearInterval(look); if (loudest < 1e-4) quiet(); }, 3000);
  return () => { clearInterval(look); clearTimeout(done); a.disconnect(); };
}

// What an element with sound says, under its label.
function showSaid(e: El) {
  const doc = (e as unknown as Element).ownerDocument;
  if (!doc || doc.getElementById("lab-sound-said")) return;
  const style = doc.createElement("style");
  style.id = "lab-sound-said";
  style.textContent = "[data-said]:not([data-said=\"\"])::after { content: attr(data-said); display: block; max-width: 28em; margin-top: 4px; color: #b3261e; font-size: 13px; font-weight: normal; text-align: left; white-space: normal; }";
  doc.head.appendChild(style);
}
