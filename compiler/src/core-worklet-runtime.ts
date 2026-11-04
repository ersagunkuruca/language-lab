// The audio thread's side of a page printed from the core IR, prebuilt as
// one script that sets `$core` (cli/web.ts coreWorkletRuntime), for a
// worklet made without a bundler (page.ts coreWorkletFile, C137d6).

export { startCoreSound } from "./core-sound.ts";
export { useSolver } from "./core-rt.ts";
export { solver } from "./core-solve.ts";
