// One cost scale for the compiler's two choosers (BACKLOG C30a): the way
// picker (WAYS.md, ways.ts), which finds the cheapest way to each field of
// an implementation, and the representation chooser (REPRESENTATIONS.md,
// represent.ts), which finds the cheapest representation for the jobs a
// program does on a type. Both add costs up and take the smallest, so both
// use this.
//
// A cost counts steps at each order of NUMBERS.md's ladder: `steps(3)` is
// three constant steps, `steps(1, "n")` one linear one. Adding adds the
// counts. Comparing looks at the highest order first, so one linear step
// costs more than any number of constant ones, then the count at that
// order, then the next order down. That is big-O with the constants kept
// for ties. A builtin a target lacks costs `NEVER`, more than anything
// that can be done.

export const LADDER = ["1", "log n", "log² n", "n", "n log n", "n²"];

export type Cost = readonly number[];

const zero = (): number[] => LADDER.map(() => 0);

// k steps of one order (a ladder entry); Infinity steps is NEVER.
export function steps(k: number, order = "1"): Cost {
  if (k === Infinity) return NEVER;
  const c = zero();
  const i = LADDER.indexOf(order);
  if (i < 0) throw new Error(`no order ${order} on the cost ladder`);
  c[i] = k;
  return c;
}

export const FREE: Cost = zero();
export const NEVER: Cost = [...zero().slice(0, -1), Infinity];

export const add = (...cs: Cost[]): Cost => LADDER.map((_, i) => cs.reduce((t, c) => t + c[i], 0));

// Negative when a is cheaper than b, 0 when they cost the same.
export function compare(a: Cost, b: Cost): number {
  for (let i = LADDER.length - 1; i >= 0; i--) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

export const less = (a: Cost, b: Cost) => compare(a, b) < 0;
export const possible = (c: Cost) => compare(c, NEVER) < 0;

// The highest order with a step in it: the cost in big-O.
export const order = (c: Cost): string => LADDER[Math.max(0, ...c.map((k, i) => (k ? i : 0)))];
