// What a page printed from the core IR runs besides its printed functions,
// prebuilt as one script that sets `$core` (cli/web.ts corePageRuntime),
// for a page made without a bundler (page.ts corePageFile, C137d6), as
// page-runtime.ts is for compile.ts's: core-page.ts and the solver.

export { mountCorePage, startCorePage } from "./core-page.ts";
export { usePlans, useSolver } from "./core-rt.ts";
// Every builtin, since a page made without a bundler can't pick (C251b).
import { useBuiltins } from "./core-rt.ts";
import { STD_IMPL, STD_MANY } from "../../ters/src/lang/std-impl.ts";
useBuiltins(STD_IMPL, STD_MANY);
export { plans } from "./plan-rt.js";
export { solver } from "./core-solve.ts";
