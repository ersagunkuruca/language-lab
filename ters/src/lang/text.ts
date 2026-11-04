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
// line doesn't read the whole line (docs/reports/GAPS.md G19).
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
// The extended grapheme clusters (UAX #29, L214c): what a reader sees as
// one character, a flag, an emoji with its skin tone, "e" with a
// combining accent. The host's segmenter (Intl.Segmenter, ICU's rules).
let segmenter: Intl.Segmenter | undefined;
export function graphemes(t: string): string[] {
  segmenter ??= new Intl.Segmenter("und", { granularity: "grapheme" });
  return Array.from(segmenter.segment(t), (s) => s.segment);
}
// Case in a language (L214b): the host's (ICU's) mapping for that tag; a
// tag the host can't read gets the root locale's mapping.
const readable = (tag: string): string => { try { return Intl.getCanonicalLocales(tag)[0] ?? "und"; } catch { return "und"; } };
export const uppercase = (t: string, tag: string): string => t.toLocaleUpperCase(readable(tag));
export const lowercase = (t: string, tag: string): string => t.toLocaleLowerCase(readable(tag));
// The host's language (L214b2): what `my locale()` answers when the world
// doesn't say.
export const hostLocale = (): string => { try { return new Intl.DateTimeFormat().resolvedOptions().locale || "und"; } catch { return "und"; } };
// −1, 0 or 1 in a language's collation (L214d): Intl.Collator, one per tag.
const collators = new Map<string, Intl.Collator>();
export function collate(a: string, b: string, tag: string): number {
  const t = readable(tag);
  let c = collators.get(t);
  if (!c) collators.set(t, (c = new Intl.Collator(t)));
  return Math.sign(c.compare(a, b));
}
export const graphemeCount = (t: string): number => { let n = 0; segmenter ??= new Intl.Segmenter("und", { granularity: "grapheme" }); for (const _ of segmenter.segment(t)) n++; return n; };

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

// The Float64 a text spells (L176, GAPS round 10 KL3: clinic read "30.5"
// with a parser of its own): digits with perhaps a point, a sign and an
// exponent, "30.5", "-2", ".5", "1e-3". No answer for anything else, nor
// for a number too big to be a Float64 (a Float64 is finite, L125). The
// nearest Float64 to the decimal, as JavaScript's Number and C's strtod
// round it. -0 reads as 0, as show never shows it.
export function readNumber(t: string): number[] {
  if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(t)) return [];
  const x = Number(t);
  return Number.isFinite(x) ? [x === 0 ? 0 : x] : [];
}
