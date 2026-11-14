// Int's own definition as data (L249b, NUMBERS.md stage 1): `from(n)` is
// n for a natural number n, and `minus one minus(n)` is −1 − n, so a match
// on an Int splits it by sign and hands over a Nat. The cases are the
// numbers module's type "Int as data", whose values are Ints: library.ts
// fills these ids in, infer.ts types the type's values as Int, and
// int-cases.ts writes each match and case out on Int before anything runs.
export const INT_CASES = { type: "", from: "", minus: "", fromFn: "", minusFn: "", natural: "" };
