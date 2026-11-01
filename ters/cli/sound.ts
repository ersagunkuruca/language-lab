// A sound (AUDIO.md) made ready to play from Node: its maker run once, by
// the evaluator or as compiled JavaScript, and its block function wrapped
// to take and give arrays. `lab render` plays it over a WAV file; the tests
// compare the two ways on the same samples.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { evaluatorCall } from "../src/lang/html.ts";
import { seededGenerator } from "../src/lang/random.ts";
import { fromList, PAGE_STEPS, runMain, toList, withSteps } from "../src/lang/run.ts";
import { compile } from "../../compiler/src/compile.ts";
import { $arrayOf, $setWorld, $toList } from "../../compiler/src/runtime.js";

export type Way = "evaluator" | "compiled";
export type Play = (block: number[]) => number[];

// `seed`: the noise a block function draws (Random) repeats from it.
export async function soundOf(p: { code: Code; info: Info; names: Names }, def: Id, way: Way, seed = 1): Promise<Play> {
  const gen = seededGenerator(seed);
  const world = { random: () => gen.next() };
  const step = <T>(f: () => T) => withSteps(PAGE_STEPS, f);
  if (way === "evaluator") {
    const play = runMain(p.code, p.info, def, { print: () => {}, names: p.names, world });
    return (block) => step(() => fromList(evaluatorCall(play, toList(block))) as number[]);
  }
  const name = p.names[def];
  const file = join(mkdtempSync(join(tmpdir(), "sound-")), "sound.mjs");
  writeFileSync(file, compile(p.code, p.info, p.names, { runtime: pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href, exports: [name] }));
  const defs = (await import(pathToFileURL(file).href)).defs as Record<string, () => (l: unknown) => unknown>;
  $setWorld(world);
  const play = step(() => defs[name]());
  return (block) => step(() => $arrayOf(play, $toList(block)) as number[]);
}
