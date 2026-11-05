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
//    are the combining marks: each is sorted after a letter (`a`, or one
//    no mark makes a letter of its own with), and gives a
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

// A mark's has its canonical combining class's rank too (0 or none for the rest).
export type Element = [primary: number, secondary: number, tertiary: number, combining?: number];
// Each code point's elements, and the contractions: a letter's code point
// → the marks after it that make one letter with it, longest first, and
// that letter's code point (its elements are in `elements`).
export interface CollationTables { elements: Map<number, Element[]>; contractions: Map<number, [number[], number][]> }

const ch = String.fromCodePoint;
const ASSIGNED = /[^\p{Cn}\p{Cs}\p{Co}]/u;
// A mark's secondary is above every letter's own (0); a letter's own
// secondary difference sits between two marks', so halves.
const MARKS_FROM = 100;

// `locale`: the order of that locale's own Intl.Collator (L214e5b2), from
// which a tailoring is the difference with the root order's.
export function buildCollationTables(locale = "und"): CollationTables {
  const at = (sensitivity: "base" | "accent" | "variant") => new Intl.Collator(locale, { sensitivity, usage: "sort" });
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
  // The marks, each after a letter none of them makes a letter of its own
  // with (`a`, but Swedish makes a and a diaeresis ä): one secondary for
  // each the host tells apart at the second level, one representative each.
  const base = ["a", "x", "q", "z"].find((l) => marks.every((m) => B.compare(l + ch(m), l) === 0)) ?? "a";
  marks.sort((a, b) => V.compare(base + ch(a), base + ch(b)) || a - b);
  const reps: string[] = [];
  let prev: string | null = null, sec = MARKS_FROM, ter = 0;
  for (const c of marks) {
    const x = base + ch(c);
    if (prev === null) reps.push(ch(c));
    else if (A.compare(prev, x)) { sec++; ter = 0; reps.push(ch(c)); }
    else if (V.compare(prev, x)) ter++;
    tables.elements.set(c, [[0, sec, ter]]);
    prev = x;
  }
  // The marks' canonical combining classes, as ranks: NFD puts two marks
  // in a row the other way round when the first's is higher. A text read
  // in NFC (the cases module's) puts its marks in that order by them.
  const swaps = (a: string, b: string) => ("a" + a + b).normalize("NFD") !== "a" + a + b;
  const combining = marks.map((c) => ch(c)).filter((m) => m === "\u0345" || swaps("\u0345", m));
  combining.sort((a, b) => (swaps(a, b) ? 1 : swaps(b, a) ? -1 : 0));
  let cls = 0;
  combining.forEach((m, i) => {
    if (i === 0 || swaps(m, combining[i - 1])) cls++;
    tables.elements.get(m.codePointAt(0)!)![0][3] = cls;
  });
  // The letters, in the host's order, into primaries: each a head (its
  // first letter) and its others' second- and third-level places.
  letters.sort((a, b) => V.compare(ch(a), ch(b)) || a - b);
  interface Group { head: string; members: { c: number; tertiary: number; secondary: number | null }[]; expands: string | null }
  const groups: Group[] = [];
  let g: Group | null = null, same = "";
  let secondary: number | null = null;
  prev = null; ter = 0;
  for (const c of letters) {
    const x = ch(c);
    if (!g || B.compare(g.head, x)) {
      g = { head: x, members: [{ c, tertiary: 0, secondary: null }], expands: null };
      groups.push(g); same = x; ter = 0; prev = x; secondary = null;
      continue;
    }
    if (A.compare(same, x)) {
      same = x; ter = 0;
      // Where its secondary falls among the marks', after the head; past
      // the last member's when that is the same place (Swedish puts ü and
      // ű both after every mark).
      let lo = 0, hi = reps.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (A.compare(g.head + reps[m], same) < 0) lo = m + 1; else hi = m; }
      const at = MARKS_FROM + lo - (lo < reps.length && A.compare(g.head + reps[lo], same) === 0 ? 0 : 0.5);
      const last = g.members.at(-1)!.secondary;
      secondary = last !== null && at <= last ? last + 1 / 64 : at;
    } else if (V.compare(prev!, x)) ter++;
    g.members.push({ c, tertiary: ter, secondary });
    prev = x;
  }
  // The primaries that are two letters' (or a compatibility
  // decomposition's): found again until none is new, since a search
  // among the single primaries goes wrong past one not yet found.
  for (const grp of groups) {
    const k = grp.head.normalize("NFKD");
    if (k !== grp.head.normalize("NFD") && [...k].length > 1 && B.compare(k, grp.head) === 0) grp.expands = k;
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
  const a = textElements(t, x), b = textElements(t, y);
  for (let level = 0; level < 3; level++) {
    const ws = (es: Element[]) => es.map((e) => e[level] as number).filter((w) => level > 0 || w !== 0);
    const wa = ws(a), wb = ws(b);
    for (let i = 0; i < Math.min(wa.length, wb.length); i++) if (wa[i] !== wb[i]) return wa[i] < wb[i] ? -1 : 1;
    if (wa.length !== wb.length) return wa.length < wb.length ? -1 : 1;
  }
  return 0;
}

// A text's elements, through its NFD and the contractions.
export function textElements(t: CollationTables, s: string): Element[] {
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
  return els(s);
}

export interface SavedCollation { unicode: string; runs: [number, number, number, number, number, number][]; multi: [number, Element[]][]; contractions: [number[], number][]; tailorings: Record<string, [number, Element[]][]> }
export const HANGUL = { from: 0xac00, to: 0xd7a3 };
// A root primary is TAILORED · its number, so a locale's letters fit
// between two of root's (L214e5b2).
export const TAILORED = 1024;

// Every code point's elements as NFC text reads it: a code point NFD
// would take apart (é, Ǽ) has the elements its NFD gives; Hangul
// syllables are left out, taken apart by arithmetic.
export function elementsByCode(t: CollationTables): Map<number, Element[]> {
  const all = new Map(t.elements);
  for (let c = 0; c < 0x110000; c++) {
    if (all.has(c) || (c >= HANGUL.from && c <= HANGUL.to) || (c >= 0xd800 && c < 0xe000)) continue;
    const s = ch(c), d = s.normalize("NFD");
    if (d === s || !ASSIGNED.test(s)) continue;
    const es = textElements(t, s);
    if (es.length) all.set(c, es);
  }
  return all;
}

// A locale's tailoring (L214e5b2): the code points whose elements in its
// order aren't root's, with primaries in root's numbers times TAILORED.
// Each of the locale's primaries is the root primary its letters share,
// where those keep root's order (the longest run that does); one that
// doesn't, or a letter of its own (Turkish ç), comes just after the last
// kept, one up for each; a locale that puts more than TAILORED − 1
// letters after one throws. Its accents' secondaries are put in root's
// the same way, numbered with root's when saved.
export function tailoring(root: Map<number, Element[]>, loc: Map<number, Element[]>): Map<number, Element[]> {
  // The locale's weights at a level in root's: each the root weight its
  // elements share, where they keep
  // root's order (the longest run that does), and one that doesn't just
  // after the last kept, a step up for each.
  const inRoot = (level: 0 | 1, of: (e: Element) => boolean, step: number, scale: number) => {
    const shared = new Map<number, Set<number>>();
    for (const [c, es] of loc) {
      const r = root.get(c);
      if (r?.length !== es.length) continue;
      es.forEach((e, i) => {
        if (!of(e) || !of(r[i])) return;
        if (!shared.has(e[level])) shared.set(e[level], new Set());
        shared.get(e[level])!.add(r[i][level]);
      });
    }
    const qs = [...new Set([...loc.values()].flatMap((es) => es.map((e) => e[level])).filter((w) => w > 0))].sort((a, b) => a - b);
    const r = qs.map((q) => { const s = shared.get(q); return s?.size === 1 ? [...s][0] : -1; });
    const tails: number[] = [], before: number[] = [];
    for (let i = 0; i < qs.length; i++) {
      if (r[i] < 0) continue;
      let lo = 0, hi = tails.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (r[tails[m]] < r[i]) lo = m + 1; else hi = m; }
      before[i] = lo ? tails[lo - 1] : -1;
      tails[lo] = i;
    }
    const kept = new Set<number>();
    for (let i = tails.at(-1) ?? -1; i >= 0; i = before[i]) kept.add(i);
    const to = new Map<number, number>([[0, 0]]);
    let last = 0, up = 0;
    qs.forEach((q, i) => {
      if (kept.has(i)) { last = r[i] * scale; up = 0; } else if (++up * step >= scale) throw new Error(`more than ${scale / step - 1} ${level ? "accents" : "letters"} after one`);
      to.set(q, last + up * step);
    });
    return to;
  };
  // Each element against root's for the same code point, where both have
  // as many: primaries by letters' elements, secondaries by all.
  const primary = inRoot(0, (e) => e[0] > 0, 1, TAILORED), secondary = inRoot(1, () => true, 1 / 64, 1);
  const out = new Map<number, Element[]>();
  for (const [c, es] of loc) {
    const mine = es.map(([p, sec, ter, cc]) => [primary.get(p)!, secondary.get(sec)!, ter, cc ?? 0] as Element);
    const theirs = (root.get(c) ?? []).map(([p, sec, ter, cc]) => [p * TAILORED, sec, ter, cc ?? 0] as Element);
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) out.set(c, mine);
  }
  for (const c of root.keys()) if (!loc.has(c)) out.set(c, []);
  return out;
}

// The tables as saved (library/collation.json) for the cases module's
// `table collated` (L214e4b), which reads NFC text as it comes (see
// elementsByCode). Secondaries are numbered 0, 1, 2… in order. `runs` are
// [from, count, primary, secondary, tertiary, combining class]: count code
// points from `from`, each one primary after the last; `multi` the code
// points of several elements; `contractions` [code points, the letter
// they make]; `tailorings` each locale's (L214e5b2), by its language.
export function saveCollation(t: CollationTables, tailored: Record<string, Map<number, Element[]>> = {}, all = elementsByCode(t)): SavedCollation {
  const secs = [...new Set([...all.values(), ...Object.values(tailored).flatMap((m) => [...m.values()])].flatMap((es) => es.map((e) => e[1])))].sort((a, b) => a - b);
  if (secs.length > 512) throw new Error(`${secs.length} secondaries, more than an element holds`);
  const rank = new Map(secs.map((s, i) => [s, i]));
  const runs: SavedCollation["runs"] = [], multi: SavedCollation["multi"] = [];
  for (const c of [...all.keys()].sort((a, b) => a - b)) {
    const es = all.get(c)!.map(([p, s, x, cc]) => [p, rank.get(s)!, x, cc ?? 0] as Element);
    if (es.length !== 1) { multi.push([c, es]); continue; }
    const [p, s, x, cc] = es[0], last = runs.at(-1);
    if (last && last[0] + last[1] === c && last[2] + last[1] === p && last[3] === s && last[4] === x && last[5] === cc) last[1]++;
    else runs.push([c, 1, p, s, x, cc!]);
  }
  const contractions = [...t.contractions].flatMap(([first, xs]) => xs.map(([rest, c]) => [[first, ...rest], c] as [number[], number]));
  const tailorings = Object.fromEntries(Object.entries(tailored).map(([l, m]) => [l, [...m].sort((a, b) => a[0] - b[0]).map(([c, es]) => [c, es.map(([p, s, x, cc]) => [p, rank.get(s)!, x, cc ?? 0] as Element)] as [number, Element[]])]));
  return { unicode: process.versions.unicode ?? "", runs, multi, contractions, tailorings };
}
