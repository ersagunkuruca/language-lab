// A program on disk and in memory (docs/design/tools/SAVED-FORMAT.md, I237).
// In memory a number literal's value is a number, or a string of digits
// for an Int past 2⁵³. On disk it is always its digits, a string under
// `num`, so no reader's JSON parser decides what a number is: what the
// digits mean is read from `of` when the program is read. A literal a type
// spells as text (a Text, a Rational's 1/3, Bytes) stays under `value`.
//
// The digits are a property of the file, converted at two places only:
// `savedForm` on the way out and `readSaved` on the way in. Content hashes
// are taken over the nodes in memory, so no module's ids move.

const INT = "type.int";
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const whole = /^-?\d+$/;

// A literal's digits: a whole number's decimal digits, anything else
// JavaScript's shortest spelling that reads back as the same double.
const digitsOf = (v: number, of: unknown): string => (of === INT && Number.isInteger(v) ? BigInt(v).toString() : String(v));

const savedLit = (n: Record<string, unknown>): Record<string, unknown> => {
  const v = n.value;
  if (typeof v !== "number" && !(typeof v === "string" && n.of === INT && whole.test(v))) return n;
  // In the place `value` had, so the node's keys keep their order.
  return Object.fromEntries(Object.entries(n).map(([k, x]) => (k === "value" ? ["num", typeof v === "number" ? digitsOf(v, n.of) : v] : [k, x])));
};

// The value the digits spell: at Int a number while it is exact, past 2⁵³
// its digits; at any other type (or none, which the check settles) the
// number they spell.
export const numOf = (num: string, of: unknown): number | string => {
  if (of !== INT || !whole.test(num)) return Number(num);
  const n = Number(num);
  return Number.isSafeInteger(n) ? n : BigInt(num).toString();
};

const readLit = (n: Record<string, unknown>): void => {
  if (typeof n.num !== "string") return;
  const entries = Object.entries(n).map(([k, x]) => (k === "num" ? ["value", numOf(n.num as string, n.of)] : [k, x]));
  for (const k of Object.keys(n)) delete n[k];
  Object.assign(n, Object.fromEntries(entries));
};

// Every table of nodes in `x` (a program's code, a saved file, a module, a
// store) with its number literals as digits. `x` itself is left as it is.
export function savedForm<T>(x: T): T {
  if (Array.isArray(x)) return x.map(savedForm) as T;
  if (!isObj(x)) return x;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x)) {
    o[k] = k === "nodes" && isObj(v)
      ? Object.fromEntries(Object.entries(v).map(([id, n]) => [id, isObj(n) && n.kind === "lit" ? savedLit(n) : n]))
      : savedForm(v);
  }
  return o as T;
}

// The other way: every table of nodes in `x`, read from disk, with its
// literals' digits as values. In place, and returns `x`. A value that is
// a JSON number (a file saved before I237) reads as it always did.
export function readSaved<T>(x: T): T {
  if (Array.isArray(x)) { for (const v of x) readSaved(v); return x; }
  if (!isObj(x)) return x;
  for (const [k, v] of Object.entries(x)) {
    if (k === "nodes" && isObj(v)) { for (const n of Object.values(v)) if (isObj(n) && n.kind === "lit") readLit(n); }
    else readSaved(v);
  }
  return x;
}

// A saved file's text, read; and a value, written as one.
export const parseSaved = <T = unknown>(text: string): T => readSaved(JSON.parse(text) as T);
export const printSaved = (x: unknown, indent = 2): string => JSON.stringify(savedForm(x), null, indent) + "\n";
