// The audio thread's side of a page with sound (AUDIO.md, A2), for any
// way the program was compiled: compile.ts's (audio-worklet.ts) or the
// core IR's (compiler/src/core-sound.ts, C137d4). A function can't cross
// from the page into this realm, so main runs here once more, and each
// `listen` node of the page takes its block function from this copy of
// the page. Its world answers random() and now() with what the page's
// run of main got, in order (record and replay, L60), so main makes the
// same cells here as there, and the page's writes, sent over the port by
// place, land in the same cells.

import { listens } from "./audio.ts";
import type { Cells, Step } from "./cells.ts";
import { seededGenerator } from "./random.ts";
import { fromList, LIST_SHAPE, OutOfSteps, PAGE_STEPS, toList, withSteps, type Data, type Value } from "./run-values.ts";
import { HTML_V, PAIR_V } from "./std-ids.ts";

// What an AudioWorkletGlobalScope has (Web Audio API).
declare const registerProcessor: (name: string, p: new (options: { processorOptions: { index: number; answers?: Answers } }) => unknown) => void;
declare class AudioWorkletProcessor { readonly port: MessagePort }
// The audio thread's rate, samples a second (AudioWorkletGlobalScope).
declare const sampleRate: number;

export const PROCESSOR = "lab-sound";

// A write to one of main's cells: the cell's place among them, and its
// value. The page sends its writes to the audio thread, and the audio
// thread sends its own back (L267), each as it is, so a cell main made is
// the page's and the sound's alike.
// An edit at a place (L98) crosses as the place and the new part (`at`);
// items written at a run of positions of a long list (a looper's tape,
// C261) as the first position and the items (`from`), not the whole list.
export type Write = { cell: number; value: Value; at?: Step[] } | { cell: number; from: number; items: Value[] };

// A write that came across, put into the cell here.
export function applyWrite(cells: Cells, cell: Value, w: Write): void {
  if ("from" in w) cells.writeItems(cell, w.from, w.items.map(unportable), LIST_SHAPE);
  else if (w.at) cells.edit(cell, w.at, () => unportable(w.value), LIST_SHAPE);
  else cells.write(cell, unportable(w.value));
}

// What was written to main's cells since it was last sent, by their place
// among them: a cell written whole, or the run of items edited of a list
// it holds (an edit inside an item counts as the item's).
export class Wrote {
  private whole = new Set<number>();
  private items = new Map<number, { lo: number; hi: number }>();
  get size() { return this.whole.size + this.items.size; }
  add(cell: number, at?: Step[]): void {
    const top = at?.[0];
    if (!top || !("item" in top) || this.whole.has(cell)) { this.whole.add(cell); this.items.delete(cell); return; }
    const r = this.items.get(cell);
    if (!r) this.items.set(cell, { lo: top.item, hi: top.item });
    else { r.lo = Math.min(r.lo, top.item); r.hi = Math.max(r.hi, top.item); }
  }
  // The writes to send, and none left.
  take(cells: Cells, made: Value[]): Write[] {
    // Items first: a cell written whole after a run of items (a looper's
    // "done" after its capture) lands after them on the other side too.
    const out: Write[] = [];
    for (const [at, { lo, hi }] of this.items) out.push({ cell: at, from: lo, items: cells.itemsAt(made[at], lo, hi - lo + 1, LIST_SHAPE).map(portable) });
    for (const at of this.whole) out.push({ cell: at, value: portable(cells.peek(made[at])) });
    this.whole.clear();
    this.items.clear();
    return out;
  }
}
// What the audio thread sends the page: why a block played silence, or
// the latest value of each of main's cells it wrote since it last sent,
// at most once a frame (a sixtieth of a second of samples).
export type FromSound = { said: string } | { writes: Write[] };

// A value as it crosses between the page and the audio thread. Compiled
// data keeps its case on its class, which a copy across threads loses, so
// it crosses as its tag and fields, which the evaluator and compiled code
// both read (core-js.ts caseOf). A list crosses as its items in an array
// (the tuner's window is 4096 of them): copied as written, a list is
// cells nested as deep as it is long, which overflows the stack of the
// copy and of a recursive walk alike. `unportable` builds it again.
const CONS = "std.list.cons"; // std.ts CONS: this file stays out of std's way
const ITEMS = "portable.items";
const isData = (v: Value): v is Data => v !== null && typeof v === "object" && !Array.isArray(v) && !ArrayBuffer.isView(v) && typeof (v as Data).tag === "string" && Array.isArray((v as Data).fields);
export function portable(v: Value): Value {
  if (!isData(v)) return v;
  if (v.tag === CONS) {
    const items: Value[] = [];
    let at: Value = v;
    while (isData(at) && at.tag === CONS) { items.push(portable(at.fields[0])); at = at.fields[1]; }
    return { tag: ITEMS, fields: [items as unknown as Value, portable(at)] } as Data;
  }
  return { tag: v.tag, fields: v.fields.map(portable) } as Data;
}
export function unportable(v: Value): Value {
  if (!isData(v)) return v;
  if (v.tag === ITEMS) {
    const items = v.fields[0] as unknown as Value[];
    let out = unportable(v.fields[1]);
    for (let i = items.length - 1; i >= 0; i--) out = { tag: CONS, fields: [unportable(items[i]), out] } as Data;
    return out;
  }
  return { tag: v.tag, fields: v.fields.map(unportable) } as Data;
}

// What the page's world answered while main ran there (audio-page.ts
// recordingWorld), in order.
export interface Answers { random: number[]; now: number[] }

// The world's random() and now() for main's run here: the page's answers
// again. The page's first clock reading made a cell (browser.ts, the clock
// that ticks each frame), so the first one here makes one too, and the
// cells still line up. Past the answers (a page that sent none, as a test
// does), random numbers are drawn from `seed`, and the clock can't be read.
export function replaying(answers: Answers | undefined, cells: Pick<Cells, "cell">, seed = 1): { random(): number; now(): number } {
  const gen = seededGenerator(seed);
  let drawn = 0, read = 0, clock = false;
  return {
    random: () => (answers && drawn < answers.random.length ? answers.random[drawn++] : gen.next()),
    now: () => {
      if (!answers || read >= answers.now.length) throw new Error("a page with sound read the clock in main on the audio thread more times than on the page");
      const t = answers.now[read++];
      if (!clock) { clock = true; cells.cell(t, "clock"); }
      return t;
    },
  };
}

// How a compiled program runs on the audio thread: its cells, main run
// once with a world, and a block function called on a block (a list, or
// in stereo a pair of them) and the rate.
export interface SoundHost {
  readonly cells: Cells;
  main(world: { random(): number; now(): number; wait(): never; log(): void; error(): void; soundLatency(): number }): Value;
  play(f: Value, block: Value, rate: number): Value;
}

export function startSoundOn(host: SoundHost, seed = 1): void {
  // main runs once for all the page's sounds, as on the page.
  let page: { listens: Data[]; cells: Value[] } | null = null;
  // main's cells the block functions wrote since they were last sent to
  // the page, by their place among main's cells; none while a write from
  // the page is being taken in, which the page already has.
  const wrote = new Wrote();
  let taking = false;
  // What the page says the platform's latency is (C260a): the block
  // function reads it as the page's views do.
  let latency = 0;
  const run = (answers?: Answers) => {
    if (page) return page;
    const cells: Value[] = [], c = host.cells, mine = new Map<number, number>();
    const wait = (): never => { throw new Error("a page can't wait in main"); };
    c.onCell = (cell, place) => { mine.set(place, cells.length); cells.push(cell); };
    try { page = { listens: listens(host.main({ ...replaying(answers, c, seed), wait, log: () => {}, error: () => {}, soundLatency: () => latency })), cells }; } finally { c.onCell = null; }
    c.onWrite = (place, _, where) => { const at = mine.get(place); if (at !== undefined && !taking) wrote.add(at, where); };
    return page;
  };
  registerProcessor(PROCESSOR, class extends AudioWorkletProcessor {
    play: ((block: Value) => Value) | null = null;
    // A `listen in stereo` (L270): a pair of blocks in and out.
    stereo = false;
    said = new Set<string>();
    cells: Value[] = [];
    // Samples played since the page was last sent what was written.
    since = 0;
    // Stopped by the page: it plays no more, and the browser lets it go.
    stopped = false;
    constructor(options: { processorOptions: { index: number; answers?: Answers } }) {
      super();
      try {
        const p = run(options.processorOptions.answers);
        const a = p.listens[options.processorOptions.index];
        this.play = a.fields[1] as never;
        this.stereo = a.tag === HTML_V.listenStereo;
        this.cells = p.cells;
        this.port.onmessage = (e: MessageEvent<Write | { latency: number } | { stop: true }>) => {
          if ("stop" in e.data) { this.stopped = true; return; }
          if ("latency" in e.data) { latency = e.data.latency; return; }
          const cell = p.cells[e.data.cell];
          if (!cell) return;
          taking = true;
          try { applyWrite(host.cells, cell, e.data); } finally { taking = false; }
        };
      } catch (e) { this.say((e as Error).message); }
    }
    // Once for each reason: the page shows it in the console.
    say(why: string) {
      if (this.said.has(why)) return;
      this.said.add(why);
      this.port.postMessage({ said: why });
    }
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      if (this.stopped) return false;
      const out = outputs[0], n = out[0].length;
      const input = inputs[0]?.[0] ?? new Float32Array(n);
      if (!this.play) return true;
      // In stereo the second channel, or the first again for a mono input.
      const block = this.stereo
        ? { tag: PAIR_V, fields: [toList(Array.from(input)), toList(Array.from(inputs[0]?.[1] ?? input))] } as Data
        : toList(Array.from(input));
      let got: number[][];
      try {
        const v = withSteps(PAGE_STEPS, () => host.play(this.play as never, block, sampleRate));
        got = this.stereo ? (v as Data).fields.map((b) => fromList(b) as number[]) : [fromList(v) as number[]];
      } catch (e) {
        this.say(e instanceof OutOfSteps ? "a block didn't finish in its steps, and played silence" : (e as Error).message);
        return true;
      }
      const wrong = got.find((g) => g.length !== n);
      if (wrong) { this.say(`a block gave ${wrong.length} samples for ${n}, and played silence`); return true; }
      // Mono plays on every speaker; stereo left and right.
      out.forEach((channel, c) => { const g = got[Math.min(c, got.length - 1)]; for (let i = 0; i < n; i++) channel[i] = g[i]; });
      this.send(n);
      return true;
    }
    // What the block functions wrote, to the page, once a frame's worth of
    // samples has played: each cell's latest value.
    send(n: number) {
      this.since += n;
      if (!wrote.size || this.since < sampleRate / 60) return;
      this.since = 0;
      const writes = wrote.take(host.cells, this.cells);
      try { this.port.postMessage({ writes } satisfies FromSound); } catch { /* a value that can't be copied (a function) stays here */ }
    }
  });
}
