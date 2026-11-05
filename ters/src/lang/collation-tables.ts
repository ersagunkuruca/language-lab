// Collation tables for the targets with no host to ask (L214e4, TEXT-2026-
// 11-03 "How each target does it"): the root order of the Unicode
// Collation Algorithm, which `collated` sorts by. As the case and grapheme
// tables are (case-tables.ts, grapheme-tables.ts), they are read off the
// building machine's own `Intl.Collator`, the one the evaluator and
// compiled JS use, not copied from the Unicode data, so every target
// agrees on one Unicode version.
//
// What they hold: each code point's collation elements, each three
// weights (UTS #10's primary, secondary and tertiary: the letter, its
// accents, its case and form). They are found by sorting:
//  - every assigned code point that NFD leaves as it is (the rest are
//    compared through their NFD) is sorted by the host; a run of letters
//    the host calls the same at the first level ("base") is one primary,
//    and within it the letters it calls different at the second
//    ("accent") and third ("variant") levels take their places;
//  - the code points the host calls equal to nothing at the first level
//    are the combining marks: each is sorted after an `a`, and gives a
//    secondary weight alone;
//  - a letter that sorts as two (æ as ae, ß as ss, ﬁ as fi, ½ as 1⁄2)
//    is found by its compatibility decomposition, or by the host calling
//    it equal to two letters at the first level; its elements are theirs,
//    then one that tells it from them at the third level;
//  - a letter with a secondary difference that isn't a mark in its NFD
//    (ø against o) is its primary's element and a secondary placed among
//    the marks' where the host puts it.
// Code points the host calls equal to nothing at every level (controls,
// joiners) have no elements. A letter and marks the host calls one letter
// of its own (Cyrillic й, Arabic آ, Tibetan and Indic vowel signs: a
// contraction) is sorted as a letter, and the comparison reads it off the
// text's NFD, its marks found past others as UTS #10 does.
//
// `collationCompare` is UTS #10's comparison over the elements, level by
// level, here to check the tables against the host (test/collation-
// tables.test.ts) and to be written in Ters next.

export type Element = [primary: number, secondary: number, tertiary: number];
// Each code point's elements, and the contractions: a letter's code point
// → the marks after it that make one letter with it, longest first, and
// that letter's code point (its elements are in `elements`).
export interface CollationTables { elements: Map<number, Element[]>; contractions: Map<number, [number[], number][]> }

const ch = String.fromCodePoint;
const ASSIGNED = /[^\p{Cn}\p{Cs}\p{Co}]/u;
// A mark's secondary is above every letter's own (0); a letter's own
// secondary difference sits between two marks', so halves.
const MARKS_FROM = 100;

export function buildCollationTables(): CollationTables {
  const at = (sensitivity: "base" | "accent" | "variant") => new Intl.Collator("und", { sensitivity, usage: "sort" });
  const B = at("base"), A = at("accent"), V = at("variant");
  const letters: number[] = [], marks: number[] = [], contractions: [string, number][] = [];
  for (let c = 0; c < 0x110000; c++) {
    const s = ch(c);
    if (!ASSIGNED.test(s) || V.compare(s, "") === 0) continue;
    const d = s.normalize("NFD");
    if (d !== s) {
      // A letter and its marks that the host calls a letter of its own
      // at the first level (Cyrillic й, Arabic آ): a contraction.
      const first = ch(d.codePointAt(0)!), rest = d.slice(first.length);
      if (B.compare(rest, "") === 0 && B.compare(s, first) !== 0) { letters.push(c); contractions.push([d, c]); }
      continue;
    }
    (B.compare(s, "") === 0 ? marks : letters).push(c);
  }
  const tables: CollationTables = { elements: new Map(), contractions: new Map() };
  for (const [d, c] of contractions) {
    const [first, ...rest] = [...d].map((x) => x.codePointAt(0)!);
    const list = tables.contractions.get(first) ?? [];
    list.push([rest, c]);
    list.sort((a, b) => b[0].length - a[0].length);
    tables.contractions.set(first, list);
  }
  // The marks, each after an `a`: one secondary for each the host tells
  // apart at the second level, one representative each.
  marks.sort((a, b) => V.compare("a" + ch(a), "a" + ch(b)) || a - b);
  const reps: string[] = [];
  let prev: string | null = null, sec = MARKS_FROM, ter = 0;
  for (const c of marks) {
    const x = "a" + ch(c);
    if (prev === null) reps.push(ch(c));
    else if (A.compare(prev, x)) { sec++; ter = 0; reps.push(ch(c)); }
    else if (V.compare(prev, x)) ter++;
    tables.elements.set(c, [[0, sec, ter]]);
    prev = x;
  }
  // The letters, in the host's order, into primaries: each a head (its
  // first letter) and its others' second- and third-level places.
  letters.sort((a, b) => V.compare(ch(a), ch(b)) || a - b);
  interface Group { head: string; members: { c: number; tertiary: number; secondary: number | null }[]; expands: string | null }
  const groups: Group[] = [];
  let g: Group | null = null, same = "";
  prev = null; ter = 0;
  for (const c of letters) {
    const x = ch(c);
    if (!g || B.compare(g.head, x)) {
      g = { head: x, members: [{ c, tertiary: 0, secondary: null }], expands: null };
      groups.push(g); same = x; ter = 0; prev = x;
      continue;
    }
    if (A.compare(same, x)) { same = x; ter = 0; } else if (V.compare(prev!, x)) ter++;
    let secondary: number | null = null;
    if (same !== g.head) {
      // Where its secondary falls among the marks', after the head.
      let lo = 0, hi = reps.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (A.compare(g.head + reps[m], same) < 0) lo = m + 1; else hi = m; }
      secondary = MARKS_FROM + lo - (lo < reps.length && A.compare(g.head + reps[lo], same) === 0 ? 0 : 0.5);
    }
    g.members.push({ c, tertiary: ter, secondary });
    prev = x;
  }
  // The primaries that are two letters' (or a compatibility
  // decomposition's): found again until none is new, since a search
  // among the single primaries goes wrong past one not yet found.
  for (const grp of groups) {
    const k = grp.head.normalize("NFKD");
    if (k !== grp.head && [...k].length > 1 && B.compare(k, grp.head) === 0) grp.expands = k;
  }
  for (let found = true; found;) {
    found = false;
    const singles = groups.filter((x) => !x.expands).map((x) => x.head);
    for (const grp of groups) {
      if (grp.expands) continue;
      const x = grp.head;
      // The first letter: the last single whose pair with the smallest
      // single isn't after it; then the second, by halves.
      let a = 0, b = singles.length - 1;
      while (a < b) { const m = (a + b + 1) >> 1; if (B.compare(singles[m] + singles[0], x) <= 0) a = m; else b = m - 1; }
      const h = singles[a];
      if (h === x) continue;
      let lo = 0, hi = singles.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (B.compare(h + singles[m], x) < 0) lo = m + 1; else hi = m; }
      if (lo < singles.length && B.compare(h + singles[lo], x) === 0) { grp.expands = h + singles[lo]; found = true; }
    }
  }
  // The weights: the single primaries numbered in order, then the
  // expanding ones from them.
  let primary = 0;
  const elements = (m: Group["members"][number], base: Element[]): Element[] =>
    [...base, ...(m.secondary === null ? [] : [[0, m.secondary, 0] as Element])];
  for (const grp of groups) {
    if (grp.expands) continue;
    primary++;
    for (const m of grp.members) tables.elements.set(m.c, elements(m, [[primary, 0, m.tertiary]]));
  }
  for (const grp of groups) {
    if (!grp.expands) continue;
    const base = [...grp.expands].flatMap((y) => tables.elements.get(y.codePointAt(0)!) ?? []).map((e) => [...e] as Element);
    for (const m of grp.members) tables.elements.set(m.c, [...elements(m, base), [0, 0, 1 + m.tertiary]]);
  }
  return tables;
}

// UTS #10's comparison: the texts' primaries in order (the marks' zero
// ones left out), then all their secondaries, then all their tertiaries,
// each a shorter list first. A letter's own secondary and tertiary are
// the lowest, 0, as UTS #10's common weights are.
export function collationCompare(t: CollationTables, x: string, y: string): number {
  const els = (s: string): Element[] => {
    const cps = [...s.normalize("NFD")].map((c) => c.codePointAt(0)!), out: Element[] = [];
    const own = (c: number) => t.elements.get(c) ?? [];
    for (let i = 0; i < cps.length; i++) {
      // A contraction's marks may come after other marks (UTS #10's
      // discontiguous match): those left over follow it.
      let used: Set<number> | null = null, as = cps[i];
      for (const [rest, c] of t.contractions.get(cps[i]) ?? []) {
        const took = new Set<number>();
        let j = i + 1;
        for (const r of rest) {
          while (j < cps.length && cps[j] !== r && own(cps[j])[0]?.[0] === 0) j++;
          if (cps[j] !== r) break;
          took.add(j++);
        }
        if (took.size === rest.length) { used = took; as = c; break; }
      }
      out.push(...own(as));
      if (!used) continue;
      let j = i + 1;
      for (; j < cps.length && (used.has(j) || own(cps[j])[0]?.[0] === 0); j++) if (!used.has(j)) out.push(...own(cps[j]));
      i = j - 1;
    }
    return out;
  };
  const a = els(x), b = els(y);
  for (let level = 0; level < 3; level++) {
    const ws = (es: Element[]) => es.map((e) => e[level]).filter((w) => level > 0 || w !== 0);
    const wa = ws(a), wb = ws(b);
    for (let i = 0; i < Math.min(wa.length, wb.length); i++) if (wa[i] !== wb[i]) return wa[i] < wb[i] ? -1 : 1;
    if (wa.length !== wb.length) return wa.length < wb.length ? -1 : 1;
  }
  return 0;
}
