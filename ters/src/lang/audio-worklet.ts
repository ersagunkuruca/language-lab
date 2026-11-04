// The audio thread's side of a page with sound (AUDIO.md, A2) for
// compile.ts's programs: a page's compiled program bundled with this runs
// in an AudioWorkletGlobalScope, on compile.ts's runtime (sound-thread.ts
// does the rest, for the core IR's programs too).

import { $arrayOf, $cells, $setPrint, $setWorld, $toList } from "../../../compiler/src/runtime.js";
import type { Cells } from "./cells.ts";
import type { Value } from "./run.ts";
import { startSoundOn } from "./sound-thread.ts";

export { PROCESSOR, replaying, type Answers, type Write } from "./sound-thread.ts";

export function startSound(main: () => Value, seed = 1): void {
  startSoundOn({
    get cells() { return $cells() as Cells; },
    main: (world) => { $setWorld(world); $setPrint(() => {}); return main(); },
    play: (f, block) => $arrayOf(f, $toList(block)) as number[],
  }, seed);
}

