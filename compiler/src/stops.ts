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
