// The audio thread's side of a page printed from the core IR, prebuilt as
// one script that sets `$core` (cli/web.ts coreWorkletRuntime), for a
// worklet made without a bundler (page.ts coreWorkletFile, C137d6).

export { startCoreSound } from "./core-sound.ts";
export { usePlans, useSolver } from "./core-rt.ts";
// Every builtin, since a page made without a bundler can't pick (C251b).
import { useBuiltins } from "./core-rt.ts";
import { STD_IMPL, STD_MANY } from "../../ters/src/lang/std-impl.ts";
useBuiltins(STD_IMPL, STD_MANY);
export { plans } from "./plan-rt.js";
export { solver } from "./core-solve.ts";
