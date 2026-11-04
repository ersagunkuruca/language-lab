// Why a program stops when a Float64 operation's answer isn't finite
// (L125c2, FLOAT-VALUES-2026-11-01.md §2), by number: scalar.ts's `stop`
// op names one, and WebAssembly's host, WASI's wasi.stop and C's lab_stop
// say it. The same words as the evaluator's (run.ts finiteFloat).
export const STOPS = [
  "x / 0 has no answer",
  "x mod 0 has no answer",
  "the square root of a negative number has no answer",
  "the log of 0 or less has no answer",
  "0 to a negative power has no answer",
  "a negative number to a fractional power has no answer",
  "the answer is too big for a Float64 (overflow)",
];

// Where a stop came from (C143): scalar.ts's `stop` op is given
// reason + SITES · (site + 1), the site the node the stop was lowered
// from (CoreIR.stops, by index), 0 where none is known. So a target that
// only says the reason takes it modulo SITES, and one that can say where
// looks the site up.
export const SITES = 16;
export const reasonOf = (code: number): string => STOPS[code % SITES];
export const siteOf = (code: number): number => Math.floor(code / SITES) - 1;
