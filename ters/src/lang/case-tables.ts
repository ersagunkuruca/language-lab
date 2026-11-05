// Case tables for the targets with no host to ask (L214e1, TEXT-2026-11-03
// "How each target does it"): WebAssembly and C map case with the
// library's own code (L214e2), and these are its tables. As C's NFC tables
// are (compiler/src/c-nfc.ts), they are not a copy of the Unicode data but
// read off the building machine's own `toUpperCase` and `toLowerCase`, the
// ones the evaluator and compiled JS use, so every target agrees on the
// same Unicode version (TEXT §5).
//
// What they hold:
//  - the one-to-one mappings, as runs: `count` code points from `from`,
//    each `step` apart (1, or 2 where upper and lower case alternate, as
//    in Latin Extended-A), each mapped `delta` away;
//  - the code points that map to several (ß uppercase is SS, ŉ is ʼN), or
//    to one only with a combining mark after (İ lowercase is i̇);
//  - each tailored locale's differences from the root's, code point by
//    code point (Turkish and Azeri dotted and dotless i, Lithuanian's
//    kept dot, Greek capitals without their accents). The rules that look at the letters around (final sigma,
//    Lithuanian's dot before an accent) are the library's code, in
//    e2, not a table.
// Built in about half a second, once per process: a block of 1,024 code
// points that maps as it is is passed over whole.

export interface Run { from: number; count: number; step: number; delta: number }
export interface CaseTable { runs: Run[]; several: [number, number[]][] }
export interface CaseTables {
  upper: CaseTable;
  lower: CaseTable;
  // Locale → its upper and lower mappings that differ from the root's.
  locales: Record<string, { upper: [number, number[]][]; lower: [number, number[]][] }>;
}

// The locales whose case mapping isn't the root's: SpecialCasing's
// conditions (tr, az, lt) and CLDR's Greek uppercase, which drops the
// accents (el).
export const TAILORED = ["tr", "az", "lt", "el"];

let built: CaseTables | undefined;
export const caseTables = (): CaseTables => (built ??= build());

const cps = (s: string) => [...s].map((x) => x.codePointAt(0)!);

// The code points, a block at a time, where a block's text, each code
// point a word of its own, maps differently under `a` and `b`: the rest
// map the same one by one too, so only these are asked one at a time.
const BLOCK = 1024;
function* differing(a: (s: string) => string, b: (s: string) => string): Generator<number> {
  for (let lo = 0; lo < 0x110000; lo += BLOCK) {
    if (lo >= 0xd800 && lo < 0xe000) continue;
    const words: string[] = [];
    for (let c = lo; c < lo + BLOCK; c++) words.push(String.fromCodePoint(c));
    const text = words.join(" ");
    if (a(text) === b(text)) continue;
    for (let c = lo; c < lo + BLOCK; c++) { const s = String.fromCodePoint(c); if (a(s) !== b(s)) yield c; }
  }
}

function table(map: (s: string) => string): CaseTable {
  const runs: Run[] = [], several: [number, number[]][] = [];
  let run: Run | null = null;
  for (const c of differing(map, (s) => s)) {
    const to = cps(map(String.fromCodePoint(c)));
    if (to.length !== 1) { several.push([c, to]); continue; }
    const delta = to[0] - c;
    if (run && run.delta === delta && c === run.from + run.count * run.step) { run.count++; continue; }
    // A run of one may become a run of two a step of 2 apart.
    if (run && run.count === 1 && run.delta === delta && c === run.from + 2) { run.step = 2; run.count++; continue; }
    runs.push(run = { from: c, count: 1, step: 1, delta });
  }
  return { runs, several };
}

function build(): CaseTables {
  const upper = table((s) => s.toUpperCase()), lower = table((s) => s.toLowerCase());
  const locales: CaseTables["locales"] = {};
  for (const tag of TAILORED) {
    const up: [number, number[]][] = [], down: [number, number[]][] = [];
    for (const c of differing((s) => s.toLocaleUpperCase(tag), (s) => s.toUpperCase())) up.push([c, cps(String.fromCodePoint(c).toLocaleUpperCase(tag))]);
    for (const c of differing((s) => s.toLocaleLowerCase(tag), (s) => s.toLowerCase())) down.push([c, cps(String.fromCodePoint(c).toLocaleLowerCase(tag))]);
    locales[tag] = { upper: up, lower: down };
  }
  return { upper, lower, locales };
}

// A code point mapped by a table, as the library will (L214e2), with a
// locale's differences first.
export function mapped(t: CaseTable, c: number, tailored: [number, number[]][] = []): number[] {
  const own = tailored.find(([x]) => x === c);
  if (own) return own[1];
  const s = t.several.find(([x]) => x === c);
  if (s) return s[1];
  for (const r of t.runs) {
    if (c < r.from) break;
    const i = c - r.from;
    if (i % r.step === 0 && i / r.step < r.count) return [c + r.delta];
  }
  return [c];
}
