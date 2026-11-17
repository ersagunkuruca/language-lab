// A sound (AUDIO.md) made ready to play from Node: its maker run once, by
// the evaluator or as the core IR's JavaScript, and its block function wrapped
// to take and give arrays. `ters render` plays it over a WAV file; the tests
// compare the two ways on the same samples.

import type { Code, Id } from "../src/model.ts";
import type { Value } from "../src/lang/run.ts";
import type { Names } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { evaluatorCall } from "../src/lang/html.ts";
import { seededGenerator } from "../src/lang/random.ts";
import { fromList, PAGE_STEPS, runMain, toList, withSteps } from "../src/lang/run.ts";
import { loadCoreJs, lowerCore } from "../../compiler/src/core-js.ts";
import { coreCall } from "../../compiler/src/core-rt.ts";
import { arrayOf, arrayView } from "../src/lang/array-view.ts";
import { ARRAY } from "../src/lang/types.ts";
import { soundOpen, soundStereo } from "../src/lang/audio.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { merge } from "../src/model.ts";
import { B } from "../src/prelude.ts";
import { PAIR_V } from "../src/lang/std.ts";
import type { Data } from "../src/lang/run.ts";

const itemsOfArray = (a: Parameters<typeof arrayView>[0]): unknown[] => { const v = arrayView(a); return v.buf.items.slice(v.start, v.start + v.n) as unknown[]; };

// "core": printed from the core IR (C137d3).
export type Way = "evaluator" | "core";
export type Play = (block: number[], rate: number) => number[];
// A sound in stereo (L270): a pair of blocks in, a pair out.
export type StereoPlay = (left: number[], right: number[], rate: number) => [number[], number[]];

// A sound that never reads its rate (L269), or never reads its samples (a
// metronome), leaves their types open, which a page's listen would fix to
// Float64; compiled code needs to know what it holds. Such a sound is
// played through one that passes them on as Float64s (x + 0 at Float64);
// any other is as it was.
export function rateFixed<P extends { code: Code; info: Info; names: Names }>(p: P, def: Id): { p: P; def: Id } {
  const open = soundOpen(p.info, def);
  if (!open.samples && !open.rate) return { p, def };
  const k = new Lang(p.code), at = k.def("sound at a rate");
  const map = LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "map")!;
  const float = (x: Id) => k.call(B.add, x, k.lit(0));
  const floats = (b: Id) => k.call(map, b, k.fn(["x"], (x) => float(x)));
  // In stereo, both blocks of the pair.
  const samples = (block: Id) => !open.samples ? block : soundStereo(p.info, def)
    ? k.match(block, [{ variant: PAIR_V, names: ["left", "right"], body: ([l, r]) => k.call(PAIR_V, floats(l), floats(r)) }])
    : floats(block);
  k.define(at, k.thunk(() => k.let("play", k.call(def), (play) => k.fn(["block", "rate"], (block, rate) =>
    k.call(play, samples(block), open.rate ? float(rate) : rate)))));
  const code = merge(p.code, k.code), names = { ...p.names, ...k.names };
  return { p: { ...p, code, names, info: infer(code, names, undefined, (p as { options?: Parameters<typeof infer>[3] }).options) }, def: at };
}

// The block function made ready: a value in (a list, or a pair of them),
// a value out, by the evaluator or the core IR's JavaScript. `arrays`:
// its lists are stored as arrays (C196).
async function blockFunction(p: { code: Code; info: Info; names: Names }, def: Id, way: Way, seed: number): Promise<{ call: (block: Value, rate: number) => Value; arrays: boolean }> {
  const gen = seededGenerator(seed);
  const world = { random: () => gen.next() };
  const step = <T>(f: () => T) => withSteps(PAGE_STEPS, f);
  // A sound whose lists are arrays (C196) takes and gives its blocks so.
  const t = p.info.typeOf.get(def), made = t?.t === "fn" ? p.info.subst.zonk(t.ret) : undefined;
  const lists = (x: Parameters<typeof p.info.subst.zonk>[0]): ReturnType<typeof p.info.subst.zonk>[] => { const z = p.info.subst.zonk(x); return z.t === "con" && z.id === "std.tuple2" ? z.args.map((a) => p.info.subst.zonk(a)) : [z]; };
  const arrays = made?.t === "fn" && [...lists(made.params[0]), ...lists(made.ret)].every((x) => x.t === "con" && x.id === ARRAY);
  ({ p, def } = rateFixed(p, def));
  if (way === "evaluator") {
    const play = runMain(p.code, p.info, def, { print: () => {}, names: p.names, world });
    return { call: (block, rate) => step(() => evaluatorCall(play, block, rate)), arrays };
  }
  const name = p.names[def];
  const ir = lowerCore(p.code, p.info, p.names, [def]);
  const why = ir.refused.get(def);
  if (why) throw new Error(`${name} isn't compiled through the core IR: it ${why}`);
  const fi = ir.funcs.findIndex((g) => g.name === name && !g.inner && !g.budgeted);
  const play = step(() => loadCoreJs(ir, { print: () => {}, world })[fi]()) as Value;
  return { call: (block, rate) => step(() => coreCall(play, block, rate)), arrays };
}

// `seed`: the noise a block function draws (Random) repeats from it.
export async function soundOf(p: { code: Code; info: Info; names: Names }, def: Id, way: Way, seed = 1): Promise<Play> {
  const { call, arrays } = await blockFunction(p, def, way, seed);
  if (arrays) return (block, rate) => itemsOfArray(call(arrayOf(block) as never, rate) as never) as number[];
  return (block, rate) => fromList(call(toList(block), rate)) as number[];
}

// A sound in stereo (L270), its blocks a pair.
export async function stereoSoundOf(p: { code: Code; info: Info; names: Names }, def: Id, way: Way, seed = 1): Promise<StereoPlay> {
  const { call, arrays } = await blockFunction(p, def, way, seed);
  const into = (b: number[]) => (arrays ? arrayOf(b) as never : toList(b));
  const back = (v: Value) => (arrays ? itemsOfArray(v as never) : fromList(v)) as number[];
  return (left, right, rate) => {
    const got = call({ tag: PAIR_V, fields: [into(left), into(right)] } as Data, rate) as Data;
    return [back(got.fields[0]), back(got.fields[1])];
  };
}
