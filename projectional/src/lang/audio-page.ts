// The page's side of a page with sound (AUDIO.md, A2). An element with a
// `listen` attribute plays when it's clicked (browsers start sound only
// on a gesture) and stops when it's clicked again: its input, through an
// AudioWorkletNode running the page's program on the audio thread
// (audio-worklet.ts), to the speakers. Each write to a cell main made
// goes to the audio thread too, so a knob turns while it plays.

import type { Cells } from "./cells.ts";
import { listens } from "./audio.ts";
import { PROCESSOR, type Write } from "./audio-worklet.ts";
import type { El } from "./html.ts";
import type { Data, Value } from "./run.ts";
import { HTML_V } from "./std.ts";

// Run around main: records its cells in the order it made them, then
// returns what draws a `listen` attribute. `worklet` is the program
// bundled with audio-worklet.ts, as a script.
export function soundPlayer(cells: Cells, worklet: string, main: () => Value) {
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
  let context: Promise<AudioContext> | null = null;
  const start = () => (context ??= (async () => {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    const url = URL.createObjectURL(new Blob([worklet], { type: "text/javascript" }));
    await ctx.audioWorklet.addModule(url);
    return ctx;
  })());

  async function source(ctx: AudioContext, to: Data): Promise<{ node: AudioNode; stop: () => void }> {
    if (to.tag === HTML_V.microphone) {
      // The guitar as it is: no echo cancelling, noise gate or gain riding.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      return { node: ctx.createMediaStreamSource(stream), stop: () => stream.getTracks().forEach((t) => t.stop()) };
    }
    const reply = await fetch(String(to.fields[0]));
    if (!reply.ok) throw new Error(`${to.fields[0]}: ${reply.status} ${reply.statusText}`);
    const s = ctx.createBufferSource();
    s.buffer = await ctx.decodeAudioData(await reply.arrayBuffer());
    s.loop = true;
    s.start();
    return { node: s, stop: () => s.stop() };
  }

  return {
    page,
    listen(e: El, a: Data) {
      const index = place.get(a);
      if (index === undefined) { console.error("a listen inside a part doesn't play: put it where main returns it"); return; }
      let on: { stop: () => void } | null = null;
      e.addEventListener("click", async () => {
        if (on) { on.stop(); on = null; e.setAttribute("data-playing", "false"); return; }
        on = { stop: () => {} };
        try {
          const ctx = await start();
          if (ctx.state === "suspended") await ctx.resume();
          const from = await source(ctx, a.fields[0] as Data);
          const node = new AudioWorkletNode(ctx, PROCESSOR, { processorOptions: { index }, numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
          node.port.onmessage = (m: MessageEvent<{ said: string }>) => console.warn(`sound: ${m.data.said}`);
          // The cells as the page has them now, before what's written next.
          for (const [cell, c] of made.entries()) { try { node.port.postMessage({ cell, value: cells.peek(c) }); } catch { /* not copied */ } }
          from.node.connect(node).connect(ctx.destination);
          playing.add(node);
          on = { stop: () => { from.stop(); from.node.disconnect(); node.disconnect(); playing.delete(node); } };
          e.setAttribute("data-playing", "true");
        } catch (err) {
          on = null;
          console.error(`sound: ${(err as Error).message}`);
          e.setAttribute("data-playing", "false");
        }
      });
    },
  };
}
