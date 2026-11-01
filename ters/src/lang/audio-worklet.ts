// The audio thread's side of a page with sound (AUDIO.md, A2): a page's
// compiled program bundled with this runs in an AudioWorkletGlobalScope.
// A function can't cross from the page into this realm, so main runs here
// once more, with a world that only draws seeded noise, and each `listen`
// node of the page takes its block function from this copy of the page.
// Its cells were made in the same order as the page's, so the page's
// writes, sent over the port by place, land in the same cells.

import { $arrayOf, $cells, $setPrint, $setWorld, $toList } from "../../../compiler/src/runtime.js";
import { listens } from "./audio.ts";
import type { Cells } from "./cells.ts";
import { seededGenerator } from "./random.ts";
import { OutOfSteps, PAGE_STEPS, withSteps, type Data, type Value } from "./run.ts";

// What an AudioWorkletGlobalScope has (Web Audio API).
declare const registerProcessor: (name: string, p: new (options: { processorOptions: { index: number } }) => unknown) => void;
declare class AudioWorkletProcessor { readonly port: MessagePort }

export const PROCESSOR = "lab-sound";

// A write from the page: the cell's place, and its value.
export interface Write { cell: number; value: Value }

export function startSound(main: () => Value, seed = 1): void {
  // main runs once for all the page's sounds, as on the page.
  let page: { listens: Data[]; cells: Value[] } | null = null;
  const run = () => {
    if (page) return page;
    const gen = seededGenerator(seed);
    const no = (what: string) => () => { throw new Error(`a page with sound can't ${what} in main: main runs again on the audio thread, and must make the same cells`); };
    $setWorld({ random: () => gen.next(), now: no("read the clock"), wait: no("wait"), log: () => {}, error: () => {} });
    $setPrint(() => {});
    const cells: Value[] = [], c = $cells() as Cells;
    c.onCell = (cell) => void cells.push(cell);
    try { return (page = { listens: listens(main()), cells }); } finally { c.onCell = null; }
  };
  registerProcessor(PROCESSOR, class extends AudioWorkletProcessor {
    play: ((block: Value) => Value) | null = null;
    said = new Set<string>();
    constructor(options: { processorOptions: { index: number } }) {
      super();
      try {
        const p = run();
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
