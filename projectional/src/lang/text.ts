// Text at real sizes. Positions and lengths count characters (Unicode code
// points), not UTF-16 units, so an emoji is one character. Text that has no
// characters outside the basic plane (most text) takes the fast path, where
// a code point is a JS string index.
//
// Opinion, from REVIEW.md §5.1: text's meaning should become `List Char`,
// represented by JS strings, so everything that works on lists works on
// text. These builtins are the jobs that representation will provide.

import type { Int } from "./int.ts";

const wide = /[\uD800-\uDFFF]/;
const chars = (t: string): string[] => (wide.test(t) ? Array.from(t) : t.split(""));
const small = (i: Int): number => (typeof i === "bigint" ? (i < 0n ? -Infinity : Infinity) : i);

export const length = (t: string): Int => (wide.test(t) ? Array.from(t).length : t.length);

// The characters from `from` up to, not including, `to`. Out-of-range
// positions are clamped, so it never fails: slice("abc", 1, 99) = "bc".
// It walks the text only as far as `to`, so a slice near the start of a long
// line doesn't read the whole line (compiler/GAPS.md G19).
export function slice(t: string, from: Int, to: Int): string {
  const a = Math.max(0, small(from)), b = small(to);
  if (b <= a) return "";
  let i = 0, at = 0, start = -1;
  for (; at < b && i < t.length; at++) {
    if (at === a) start = i;
    const c = t.charCodeAt(i), d = t.charCodeAt(i + 1);
    i += c >= 0xd800 && c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff ? 2 : 1;
  }
  return start < 0 ? "" : t.slice(start, i);
}

export const characters = chars;

// The first position where `part` starts; no answer if it isn't there
// (Choice).
export function find(t: string, part: string): Int[] {
  const i = t.indexOf(part);
  if (i < 0) return [];
  return [wide.test(t) ? Array.from(t.slice(0, i)).length : i];
}

export const split = (t: string, by: string): string[] => (by === "" ? chars(t) : t.split(by));
export const joinAll = (parts: string[], by: string): string => parts.join(by);

// Code-point order, which is also the order of the characters' numbers.
export function less(a: string, b: string): boolean {
  if (!wide.test(a) && !wide.test(b)) return a < b;
  const x = Array.from(a, (c) => c.codePointAt(0)!), y = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i];
  return x.length < y.length;
}

// A one-character text's number, and back. Other texts, and numbers that
// aren't characters, have no answer.
export function code(t: string): Int[] {
  const cs = chars(t);
  return cs.length === 1 ? [cs[0].codePointAt(0)!] : [];
}
export function fromCode(n: Int): string[] {
  if (typeof n !== "number" || n < 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return [];
  return [String.fromCodePoint(n)];
}
