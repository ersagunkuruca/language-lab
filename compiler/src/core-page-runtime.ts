// What a page printed from the core IR runs besides its printed functions,
// prebuilt as one script that sets `$core` (cli/web.ts corePageRuntime),
// for a page made without a bundler (page.ts corePageFile, C137d6), as
// page-runtime.ts is for compile.ts's: core-page.ts and the solver.

export { mountCorePage, startCorePage } from "./core-page.ts";
export { usePlans, useSolver } from "./core-rt.ts";
export { plans } from "./plan-rt.js";
export { solver } from "./core-solve.ts";
