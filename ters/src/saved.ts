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
    if (k !== "nodes" || !isObj(v)) { readSaved(v); continue; }
    for (const [id, n] of Object.entries(v)) {
      if (!isObj(n)) continue;
      // One node per line keeps its id only as its key (I240).
      if (n.id === undefined) v[id] = { id, ...n };
      if (n.kind === "lit") readLit(v[id] as Record<string, unknown>);
    }
  }
  return x;
}

// The one printer of saved programs (I240, SAVED-FORMAT.md): still plain
// JSON, one spelling for each value, so an unchanged program saved again
// is the same bytes, and a line is what an edit changes.
// - A node is one line, keyed by its id and sorted by it, its id not
//   written again inside: `kind` first, its other keys sorted.
// - Every other table is one entry per line: the top of a file (a
//   code.json's defs, a names file's names) and each table in a file
//   that holds programs (a module's, an editor file's names, comments
//   and pins), sorted by key. Arrays keep their order, and so do the
//   keys of an object inside a line.
// - What is inside a line is inline, with a space after ":" and ",".
// - UTF-8 as it is, \n line ends, a final newline.
export const printSaved = (x: unknown): string => block(savedForm(x)) + "\n";

const sortedKeys = (o: Record<string, unknown>, first?: string) =>
  Object.keys(o).filter((k) => o[k] !== undefined).sort((a, b) => (a === first ? -1 : b === first ? 1 : a < b ? -1 : a > b ? 1 : 0));
// Inside a line, an object's keys keep their order: some say an order
// (a representation's operations). A node's own keys are sorted (`sort`).
const inline = (x: unknown, sort?: { first: string }): string => {
  if (Array.isArray(x)) return `[${x.map((v) => inline(v === undefined ? null : v)).join(", ")}]`;
  if (!isObj(x)) return JSON.stringify(x) ?? "null";
  const keys = sort ? sortedKeys(x, sort.first) : Object.keys(x).filter((k) => x[k] !== undefined);
  return `{${keys.map((k) => `${JSON.stringify(k)}: ${inline(x[k])}`).join(", ")}}`;
};
const holdsNodes = (x: unknown): boolean =>
  Array.isArray(x) ? x.some(holdsNodes) : isObj(x) && (isObj(x.nodes) || Object.values(x).some((v) => typeof v === "object" && v !== null && holdsNodes(v)));
const lines = (rows: string[], open: string, close: string) => (rows.length ? `${open}\n${rows.join(",\n")}\n${close}` : open + close);
const node = (n: unknown): string => {
  if (!isObj(n)) return inline(n);
  const { id: _, ...rest } = n;
  return inline(rest, { first: "kind" });
};
// A value that holds programs, or a file's top: one entry per line.
function block(x: unknown): string {
  if (Array.isArray(x)) return lines(x.map((v) => (holdsNodes(v) ? block(v) : inline(v))), "[", "]");
  if (!isObj(x)) return inline(x);
  const entry = (k: string): string => {
    const v = x[k], key = JSON.stringify(k);
    if (k === "nodes" && isObj(v)) return `${key}: ${lines(Object.keys(v).sort().map((id) => `${JSON.stringify(id)}: ${node(v[id])}`), "{", "}")}`;
    if (holdsNodes(v)) return `${key}: ${block(v)}`;
    if (Array.isArray(v)) return `${key}: ${lines(v.map((i) => inline(i)), "[", "]")}`;
    if (isObj(v)) return `${key}: ${lines(sortedKeys(v).map((i) => `${JSON.stringify(i)}: ${inline(v[i])}`), "{", "}")}`;
    return `${key}: ${inline(v)}`;
  };
  return `{${sortedKeys(x).map(entry).join(",\n")}}`;
}

// A saved file's text, read: either layout, either spelling of a number.
export const parseSaved = <T = unknown>(text: string): T => readSaved(JSON.parse(text) as T);
