// The audio thread's side of a page with sound printed from the core IR
// (C137d4): the printed functions on the core runtime, with main run once
// more there and each block played through its block function, as
// sound-thread.ts does for any compiled program.

import { equal, fromList, toList, type Value } from "../../ters/src/lang/run.ts";
import { Cells } from "../../ters/src/lang/cells.ts";
import { startSoundOn } from "../../ters/src/lang/sound-thread.ts";
import { coreCall, coreRuntime, type TableSpec } from "./core-rt.ts";
import type { Code } from "../../ters/src/model.ts";
import type { World } from "../../ters/src/lang/run.ts";

type Defs = Record<string, (...xs: unknown[]) => unknown>;

// As core-page.ts startCorePage: `defs` makes the printed functions from
// the runtime, `main` is the page's by its printed name.
export function startCoreSound(tables: TableSpec[], worlds: string[], defs: (R: ReturnType<typeof coreRuntime>) => Defs, main: string, code?: Code, seed = 1): void {
  const cells = new Cells(equal);
  // The world main is answered with here (the page's answers again), set
  // before main runs: the runtime reads it at each use.
  const world = {} as World;
  const fns = defs(coreRuntime(tables, worlds, { print: () => {}, world, cells }, code));
  startSoundOn({
    cells,
    main: (w) => { Object.assign(world, w); return fns[main]() as Value; },
    play: (f, block) => fromList(coreCall(f, toList(block))) as number[],
  }, seed);
}
