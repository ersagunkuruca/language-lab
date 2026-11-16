// The Float64 operations a mode plan runs forward (core-rt.ts useFloats,
// C251c), on their own so a prebuilt runtime's plain build can leave them
// out (cli/web.ts).
export { impl as floats } from "../../ters/src/prelude.ts";
