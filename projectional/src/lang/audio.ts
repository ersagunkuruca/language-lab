// Sounds (AUDIO.md): a function from a block of samples to the block to
// play, made by a function that takes nothing. What checks a sound's type,
// and what plays one over samples block by block, for `lab render` and the
// browser's worklet alike.

import type { Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import { AUDIO_BLOCK, AUDIO_MAKER, LIST } from "./std.ts";
import { NUMBER, type Type } from "./types.ts";

// The browser's render quantum (Web Audio API, AudioWorklet): the block a
// sound gets, unless `lab render` is told another size.
export const BLOCK = 128;

// Why `def` can't be a sound, or null: it takes nothing, may only make
// cells, and returns a function from a List Number to a List Number whose
// effects are a sound's block function's.
export function audioProblem(info: Info, def: Id, names: Names = {}): string | null {
  const t = info.typeOf.get(def);
  const say = "a sound takes nothing and returns its block function, from a List Number to a List Number";
  if (!t || t.t !== "fn" || t.params.length) return say;
  const extra = (row: Type & { t: "fn" }, allowed: readonly Id[]) => row.eff.effs.filter((e) => !allowed.includes(e)).map((e) => names[e] ?? e);
  const made = extra(t, AUDIO_MAKER);
  if (made.length) return `a sound's maker may only make cells (it also runs in the audio thread), and this one has ${made.join(", ")}`;
  const f = info.subst.zonk(t.ret);
  // A List Number, or a type that could be one (`(block) => block`).
  const numbers = (x: Type) => {
    const z = info.subst.zonk(x);
    if (z.t === "var") return true;
    if (z.t !== "con" || z.id !== LIST || z.args.length !== 1) return false;
    const a = info.subst.zonk(z.args[0]);
    return a.t === "var" || (a.t === "con" && a.id === NUMBER);
  };
  if (f.t !== "fn" || f.params.length !== 1 || !numbers(f.params[0]) || !numbers(f.ret)) return say;
  const played = extra(f, AUDIO_BLOCK);
  if (played.length) return `a sound's block function runs on the audio thread, so it can't have ${played.join(", ")}`;
  return null;
}

// What playing went through: blocks that played silence instead, and why
// (the first of each reason is enough to say).
export interface Played { out: Float64Array; silent: { block: number; why: string }[] }

// `play` over `input`, `size` samples at a time; the last block is padded
// with silence and cut back. A block that throws or gives the wrong number
// of samples plays silence.
export function playBlocks(play: (block: number[]) => number[], input: ArrayLike<number>, size = BLOCK): Played {
  const out = new Float64Array(input.length), silent: Played["silent"] = [];
  for (let at = 0, b = 0; at < input.length; at += size, b++) {
    const block = Array.from({ length: size }, (_, i) => (at + i < input.length ? input[at + i] : 0));
    let got: number[];
    try { got = play(block); } catch (e) { silent.push({ block: b, why: (e as Error).message }); continue; }
    if (got.length !== size) { silent.push({ block: b, why: `it gave ${got.length} samples for ${size}` }); continue; }
    for (let i = 0; i < size && at + i < input.length; i++) out[at + i] = got[i];
  }
  return { out, silent };
}
