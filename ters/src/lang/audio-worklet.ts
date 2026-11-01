// The audio thread's side of a page with sound (AUDIO.md, A2): a page's
// compiled program bundled with this runs in an AudioWorkletGlobalScope.
// A function can't cross from the page into this realm, so main runs here
// once more, and each `listen` node of the page takes its block function
// from this copy of the page. Its world answers random() and now() with
// what the page's run of main got, in order (record and replay, L60), so
// main makes the same cells here as there, and the page's writes, sent
// over the port by place, land in the same cells.

import { $arrayOf, $cells, $setPrint, $setWorld, $toList } from "../../../compiler/src/runtime.js";
import { listens } from "./audio.ts";
import type { Cells } from "./cells.ts";
import { seededGenerator } from "./random.ts";
import { OutOfSteps, PAGE_STEPS, withSteps, type Data, type Value } from "./run.ts";

// What an AudioWorkletGlobalScope has (Web Audio API).
declare const registerProcessor: (name: string, p: new (options: { processorOptions: { index: number; answers?: Answers } }) => unknown) => void;
declare class AudioWorkletProcessor { readonly port: MessagePort }

export const PROCESSOR = "lab-sound";

// A write from the page: the cell's place, and its value.
export interface Write { cell: number; value: Value }

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

export function startSound(main: () => Value, seed = 1): void {
  // main runs once for all the page's sounds, as on the page.
  let page: { listens: Data[]; cells: Value[] } | null = null;
  const run = (answers?: Answers) => {
    if (page) return page;
    const cells: Value[] = [], c = $cells() as Cells;
    const wait = () => { throw new Error("a page can't wait in main"); };
    $setWorld({ ...replaying(answers, c, seed), wait, log: () => {}, error: () => {} });
    $setPrint(() => {});
    c.onCell = (cell) => void cells.push(cell);
    try { return (page = { listens: listens(main()), cells }); } finally { c.onCell = null; }
  };
  registerProcessor(PROCESSOR, class extends AudioWorkletProcessor {
    play: ((block: Value) => Value) | null = null;
    said = new Set<string>();
    constructor(options: { processorOptions: { index: number; answers?: Answers } }) {
      super();
      try {
        const p = run(options.processorOptions.answers);
        this.play = p.listens[options.processorOptions.index].fields[1] as never;
        this.port.onmessage = (e: MessageEvent<Write>) => {
          const cell = p.cells[e.data.cell];
          if (cell) $cells().write(cell, e.data.value);
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
      const out = outputs[0], n = out[0].length;
      const input = inputs[0]?.[0] ?? new Float32Array(n);
      if (!this.play) return true;
      let got: number[];
      try { got = withSteps(PAGE_STEPS, () => $arrayOf(this.play!, $toList(Array.from(input))) as number[]); } catch (e) {
        this.say(e instanceof OutOfSteps ? "a block didn't finish in its steps, and played silence" : (e as Error).message);
        return true;
      }
      if (got.length !== n) { this.say(`a block gave ${got.length} samples for ${n}, and played silence`); return true; }
      for (const channel of out) for (let i = 0; i < n; i++) channel[i] = got[i];
      return true;
    }
  });
}
