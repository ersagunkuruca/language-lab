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
import { arrayOf, arrayView } from "../src/lang/std.ts";
import { ARRAY } from "../src/lang/types.ts";

const itemsOfArray = (a: Parameters<typeof arrayView>[0]): unknown[] => { const v = arrayView(a); return v.buf.items.slice(v.start, v.start + v.n) as unknown[]; };

// "core": printed from the core IR (C137d3).
export type Way = "evaluator" | "core";
export type Play = (block: number[]) => number[];

// `seed`: the noise a block function draws (Random) repeats from it.
export async function soundOf(p: { code: Code; info: Info; names: Names }, def: Id, way: Way, seed = 1): Promise<Play> {
  const gen = seededGenerator(seed);
  const world = { random: () => gen.next() };
  const step = <T>(f: () => T) => withSteps(PAGE_STEPS, f);
  // A sound whose lists are arrays (C196) takes and gives its blocks so.
  const t = p.info.typeOf.get(def), made = t?.t === "fn" ? p.info.subst.zonk(t.ret) : undefined;
  const arrays = made?.t === "fn" && [made.params[0], made.ret].map((x) => p.info.subst.zonk(x)).every((x) => x.t === "con" && x.id === ARRAY);
  if (way === "evaluator") {
    const play = runMain(p.code, p.info, def, { print: () => {}, names: p.names, world });
    if (arrays) return (block) => step(() => itemsOfArray(evaluatorCall(play, arrayOf(block) as never) as never) as number[]);
    return (block) => step(() => fromList(evaluatorCall(play, toList(block))) as number[]);
  }
  const name = p.names[def];
  const ir = lowerCore(p.code, p.info, p.names, [def]);
  const why = ir.refused.get(def);
  if (why) throw new Error(`${name} isn't compiled through the core IR: it ${why}`);
  const fi = ir.funcs.findIndex((g) => g.name === name && !g.inner && !g.budgeted);
  const play = step(() => loadCoreJs(ir, { print: () => {}, world })[fi]()) as Value;
  if (arrays) return (block) => step(() => itemsOfArray(coreCall(play, arrayOf(block) as never) as never) as number[]);
  return (block) => step(() => fromList(coreCall(play, toList(block))) as number[]);
}
