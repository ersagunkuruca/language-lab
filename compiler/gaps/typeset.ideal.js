// typeset (GAPS.md round 24) by hand: the same typesetter as the Ters
// program in compiler/gaps/typeset, written as one would in JavaScript,
// items and sums in arrays. It prints what the program prints.
//
// Paragraphs of made-up text are broken into lines of a measure by
// Knuth and Plass's total fit ("Breaking paragraphs into lines", 1981):
// boxes, glue and penalties; each line's adjustment ratio and badness;
// demerits with a line penalty, a hyphen's penalty, two hyphens running
// and fitness classes far apart; the least total over every way to break
// the paragraph. Words are hyphenated by two syllable rules (a vowel, a
// consonant, a vowel breaks before the consonant; a vowel, two consonants,
// a vowel breaks between them), not by Liang's patterns. First fit, word
// by word with no hyphens, is printed beside it.

const VOCABULARY = ["typesetting", "paragraph", "justification", "hyphenation", "composition", "readability", "measure", "glue", "penalty", "river",
  "margin", "letter", "spacing", "quietly", "between", "rhythm", "balance", "column", "printer", "ink", "paper", "line", "word", "break", "under", "over",
  "the", "and", "of", "to", "a", "in", "that", "with", "for", "every", "careful", "uneven", "patiently", "geometry"];
const SPACE = 6, STRETCH = 3, SHRINK = 2, HYPHEN = 3, HYPHEN_COST = 50, LINE_PENALTY = 10, FLAGGED_DEMERITS = 3000, FITNESS_DEMERITS = 2000, FORCED = -10000;

const nextRandom = (s) => (s * 16807) % 2147483647;
const digitOf = (r, under, base) => Math.trunc(r / under) % base;
const charWidth = (c) => ("il.,'".includes(c) ? 2 : "fjtr".includes(c) ? 3 : "mw".includes(c) ? 7 : 5);
const textWidth = (t) => { let w = 0; for (const c of t) w += charWidth(c); return w; };
const isVowel = (c) => "aeiouy".includes(c);

// A paragraph's words from seed s: 40 to 99 of them, a full stop or a
// comma after some, a full stop after the last. The seed after them.
function paragraphWords(s) {
  const count = 40 + digitOf(s, 1, 60);
  s = nextRandom(s);
  const words = [];
  for (let i = 0; i < count; i++) {
    const w = VOCABULARY[digitOf(s, 10, VOCABULARY.length)];
    const mark = i === count - 1 ? "." : ["." , ","][digitOf(s, 1000, 12)] ?? "";
    words.push(w + mark);
    s = nextRandom(s);
  }
  return { words, s };
}

// Where a word's letters may be broken: before letter i, i from 2 to
// length − 3.
function hyphenPoints(cs) {
  const out = [];
  for (let i = 2; i <= cs.length - 3; i++) {
    const a = cs[i - 2], b = cs[i - 1], c = cs[i], d = cs[i + 1];
    if ((isVowel(b) && !isVowel(c) && isVowel(d)) || (isVowel(a) && !isVowel(b) && !isVowel(c) && isVowel(d))) out.push(i);
  }
  return out;
}

// A word's pieces: its letters broken at its hyphen points, its mark
// after the last.
function pieces(word) {
  const marked = word.endsWith(".") || word.endsWith(",");
  const cs = [...(marked ? word.slice(0, -1) : word)];
  const out = [];
  let from = 0;
  for (const p of hyphenPoints(cs)) { out.push(cs.slice(from, p).join("")); from = p; }
  out.push(cs.slice(from).join("") + (marked ? word.slice(-1) : ""));
  return out;
}

// box: k 0; glue: k 1; penalty: k 2.
function items(words) {
  const out = [];
  words.forEach((w, i) => {
    if (i > 0) out.push({ k: 1, w: SPACE, st: STRETCH, sh: SHRINK });
    pieces(w).forEach((p, j) => {
      if (j > 0) out.push({ k: 2, w: HYPHEN, cost: HYPHEN_COST, flagged: true });
      out.push({ k: 0, t: p, w: textWidth(p) });
    });
  });
  out.push({ k: 1, w: 0, st: 100000, sh: 0 });
  out.push({ k: 2, w: 0, cost: FORCED, flagged: false });
  return out;
}

const ratioOf = (l, st, sh, width) => (l < width ? (st > 0 ? (width - l) / st : 1000) : l > width ? (sh > 0 ? (width - l) / sh : -1000) : 0);
const badness = (r) => { const a = Math.abs(r); return Math.min(Math.floor(100 * a * a * a + 0.5), 10000); };
const fitness = (r) => (r < -0.5 ? 0 : r <= 0.5 ? 1 : r <= 1 ? 2 : 3);
const demeritsOf = (b, cost) => { const l = LINE_PENALTY + b; return cost >= 0 ? l * l + cost * cost : cost > FORCED ? l * l - cost * cost : l * l; };

function totalFit(its, width) {
  const n = its.length;
  const pw = [0], pst = [0], psh = [0];
  for (const it of its) {
    pw.push(pw[pw.length - 1] + (it.k === 2 ? 0 : it.w));
    pst.push(pst[pst.length - 1] + (it.k === 1 ? it.st : 0));
    psh.push(psh[psh.length - 1] + (it.k === 1 ? it.sh : 0));
  }
  const isBreak = (i) => (its[i].k === 2 ? its[i].cost < 10000 : its[i].k === 1 && i > 0 && its[i - 1].k === 0);
  const startAfter = (b) => { let i = b + 1; while (i < n && its[i].k !== 0) i++; return i; };
  const flagged = (b) => b >= 0 && its[b].k === 2 && its[b].flagged;
  const breaks = [-1];
  for (let i = 0; i < n; i++) if (isBreak(i)) breaks.push(i);
  const line = (a, b) => {
    const s = startAfter(a);
    const l = pw[b] - pw[s] + (its[b].k === 2 ? its[b].w : 0);
    return ratioOf(l, pst[b] - pst[s], psh[b] - psh[s], width);
  };
  // best[4k + c]: the least demerits to break k with its line in class c
  // (−1: none), from which break and class.
  const best = [{ d: -1, from: -1, fc: -1 }, { d: 0, from: -1, fc: -1 }, { d: -1, from: -1, fc: -1 }, { d: -1, from: -1, fc: -1 }];
  for (let k = 1; k < breaks.length; k++) {
    const b = breaks[k], cands = [0, 1, 2, 3].map(() => ({ d: -1, from: -1, fc: -1 }));
    for (let j = k - 1; j >= 0; j--) {
      const r = line(breaks[j], b);
      if (r < -1) break;
      const c = fitness(r), d = demeritsOf(badness(r), its[b].k === 2 ? its[b].cost : 0) + (flagged(breaks[j]) && flagged(b) ? FLAGGED_DEMERITS : 0);
      for (let cj = 0; cj < 4; cj++) {
        const was = best[4 * j + cj];
        if (was.d < 0) continue;
        const total = was.d + d + (Math.abs(c - cj) > 1 ? FITNESS_DEMERITS : 0);
        if (cands[c].d < 0 || total < cands[c].d) cands[c] = { d: total, from: j, fc: cj };
      }
    }
    best.push(...cands);
  }
  const last = breaks.length - 1;
  let c = -1;
  for (let x = 0; x < 4; x++) if (best[4 * last + x].d >= 0 && (c < 0 || best[4 * last + x].d < best[4 * last + c].d)) c = x;
  const ks = [];
  for (let k = last, x = c; k > 0;) { ks.push(k); const node = best[4 * k + x]; k = node.from; x = node.fc; }
  ks.reverse();
  const lines = [];
  let from = -1;
  for (const k of ks) {
    const b = breaks[k], s = startAfter(from);
    let t = "";
    for (let i = s; i < b; i++) t += its[i].k === 0 ? its[i].t : its[i].k === 1 ? " " : "";
    if (flagged(b)) t += "-";
    lines.push({ text: t, ratio: line(from, b), hyphen: flagged(b) });
    from = b;
  }
  return { lines, demerits: best[4 * last + c].d };
}

// First fit, word by word: a line takes the next word while it fits at
// its natural spaces; its badness from its stretch, the last line's none.
function firstFit(words, width) {
  const ws = words.map(textWidth);
  let lines = 0, bad = 0, w = ws[0], spaces = 0;
  for (let i = 1; i < ws.length; i++) {
    if (w + SPACE + ws[i] <= width) { w += SPACE + ws[i]; spaces++; }
    else { lines++; bad += spaces === 0 ? 10000 : badness((width - w) / (STRETCH * spaces)); w = ws[i]; spaces = 0; }
  }
  return { lines: lines + 1, badness: bad };
}

// show decimals(x, 2) as the prelude has it.
const decimals = (x) => { const m = Math.floor(Math.abs(x) * 100 + 0.5), w = Math.floor(m / 100), t = `${w}.${String(m - w * 100).padStart(2, "0")}`; return x < 0 && m > 0 ? `-${t}` : t; };

export function typeset(args, print, printError) {
  // read whole number's: an optional minus, no leading zeros; else 0.
  const read = (t) => (/^-?(0|[1-9][0-9]*)$/.test(t) && t !== "-0" ? Number(t) : 0);
  const n = read(args[0] ?? "3"), width = read(args[1] ?? "300");
  if (n < 1 || width < 100 || width > 2000) { printError("usage: typeset [paragraphs, at least 1] [measure, 100 to 2000]"); return 0; }
  let s = 11, lines = 0, firstLines = 0, demerits = 0, hyphens = 0;
  for (let p = 0; p < n; p++) {
    const g = paragraphWords(s);
    s = g.s;
    const its = items(g.words), fit = totalFit(its, width), first = firstFit(g.words, width);
    const used = fit.lines.filter((l) => l.hyphen).length;
    if (p === 0) for (const l of fit.lines) print(l.text.padEnd(Math.floor(width / 5)) + " " + decimals(l.ratio));
    print(`paragraph ${p + 1}: ${g.words.length} words; first fit ${first.lines} lines, badness ${first.badness}; total fit ${fit.lines.length} lines, demerits ${fit.demerits}, ${used} hyphens`);
    lines += fit.lines.length; firstLines += first.lines; demerits += fit.demerits; hyphens += used;
  }
  print(`${n} paragraphs at ${width}: first fit ${firstLines} lines; total fit ${lines} lines, demerits ${demerits}, ${hyphens} hyphens`);
  return 0;
}
