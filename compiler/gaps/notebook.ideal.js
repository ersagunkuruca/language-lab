#!/usr/bin/env node
// notebook, written by hand: the JavaScript the compiler should aim to
// produce for ters/examples/notebook. Same program, same output, same exit
// codes, same algorithm: an inverted index (term → note → times) built once,
// then read by every question. What differs is only what a compiler could
// decide on its own; each difference is marked with the gap it stands for
// in docs/reports/GAPS.md (round 6).
//
// The program's maps are persistent. Here every map is built by one owner
// and then only read, so each is a JS Map filled in place (N2), the inner
// postings too (N3). Where the program walks a map in key order and the
// order shows in the output, the keys are sorted then.
//
// `io` is the world: readFile (which throws an Error when it can't), print
// and printError. A failure becomes the program's Abort.
//
// Run: node compiler/gaps/notebook.ideal.js notes.txt

import { fileURLToPath } from "node:url";

class Abort { constructor(why) { this.why = why; } }

const STOP = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was", "with"]);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const badLine = (n) => new Abort(`line ${n}: expected note <name> <text>, find <words>, any <words>, like <name> or seen <word>`);

// `term`: one pass over the word's code units (N5: the program makes a
// list of one-character texts, maps, keeps and joins them).
function term(w) {
  let t = "";
  for (let i = 0; i < w.length; i++) {
    let c = w.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 39) t += String.fromCharCode(c);
  }
  const n = t.length;
  if (n < 4) return t;
  if (t.endsWith("ies")) return t.slice(0, n - 3) + "y";
  if (t.endsWith("ss")) return t;
  if (t.endsWith("s")) return t.slice(0, n - 1);
  return t;
}
const pieces = (line) => line.split(" ").filter((w) => w !== "");
function termsIn(ws) {
  const out = [];
  for (const w of ws) { const t = term(w); if (t !== "" && !STOP.has(t)) out.push(t); }
  return out;
}

function lines(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    const line = texts[i], n = i + 1;
    if (line === "" || line[0] === "#") continue;
    const w = pieces(line);
    const cmd = w[0];
    if (cmd === "note" && w.length >= 2) out.push({ kind: 0, name: w[1], text: w.slice(2).join(" "), n });
    else if (cmd === "find") out.push({ kind: 1, terms: termsIn(w.slice(1)), n });
    else if (cmd === "any") out.push({ kind: 2, terms: termsIn(w.slice(1)), n });
    else if (cmd === "like" && w.length === 2) out.push({ kind: 3, name: w[1], n });
    else if (cmd === "seen" && w.length === 2) out.push({ kind: 4, word: term(w[1]), n });
    else throw badLine(n);
  }
  return out;
}

// The index: notes by name, and postings term → (note → times). Both
// filled in place (N2, N3).
function indexOf(ls) {
  const notes = new Map(), postings = new Map();
  for (const l of ls) {
    if (l.kind !== 0) continue;
    if (notes.has(l.name)) throw new Abort(`line ${l.n}: a second note named ${l.name}`);
    const counts = new Map();
    let size = 0;
    for (const t of termsIn(pieces(l.text))) { counts.set(t, (counts.get(t) ?? 0) + 1); size++; }
    notes.set(l.name, { name: l.name, text: l.text, terms: counts, size });
    for (const [t, c] of counts) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = new Map()));
      p.set(l.name, c);
    }
  }
  return { notes, postings };
}

const EMPTY = new Map();
const postingsOf = (ix, t) => ix.postings.get(t) ?? EMPTY;
const weight = (ix, t) => { const df = postingsOf(ix, t).size; return df === 0 ? 0 : Math.floor((1000 * ix.notes.size) / df); };

// `ranked`: scores, highest first, then by name.
function ranked(scores) {
  const hs = [...scores];
  hs.sort((a, b) => b[1] - a[1] || byText(a[0], b[0]));
  return hs;
}
const hitsText = (hs) => (hs.length === 0 ? "nothing" : hs.slice(0, 5).map(([name, s]) => `${name} ${s}`).join(", "));

function findHits(ix, ts) {
  if (ts.length === 0) return [];
  // `rarest first`: a stable sort by how many notes have the term.
  const order = ts.map((t, i) => [postingsOf(ix, t).size, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => ts[i]);
  const others = order.slice(1);
  const ws = ts.map((t) => weight(ix, t)), ps = ts.map((t) => postingsOf(ix, t));
  const scores = new Map();
  for (const name of postingsOf(ix, order[0]).keys()) {
    if (!others.every((t) => postingsOf(ix, t).has(name))) continue;
    let s = 0;
    for (let i = 0; i < ts.length; i++) s += (ps[i].get(name) ?? 0) * ws[i];
    scores.set(name, s);
  }
  return ranked(scores);
}

// `any scores` and `credit`: one map of scores, added to in place (N2).
function anyScores(ix, ts, except) {
  const acc = new Map();
  for (const t of ts) {
    const w = weight(ix, t);
    for (const [name, times] of postingsOf(ix, t)) if (name !== except) acc.set(name, (acc.get(name) ?? 0) + times * w);
  }
  return acc;
}

function seenWith(ix, w) {
  const acc = new Map();
  for (const name of postingsOf(ix, w).keys()) {
    for (const [t, times] of ix.notes.get(name).terms) if (t !== w) acc.set(t, (acc.get(t) ?? 0) + times);
  }
  return acc;
}

const plural = (n, thing) => `${n} ${thing}${n === 1 ? "" : "s"}`;

function summary(ix) {
  const names = [...ix.notes.keys()].sort(byText);
  let terms = 0, longest = ix.notes.get(names[0]);
  for (const name of names) {
    const nt = ix.notes.get(name);
    terms += nt.size;
    if (longest.size < nt.size) longest = nt;
  }
  const common = [];
  for (const [t, p] of ix.postings) { let c = 0; for (const x of p.values()) c += x; common.push([t, c]); }
  common.sort((a, b) => b[1] - a[1] || byText(a[0], b[0]));
  return `${plural(ix.notes.size, "note")}, ${plural(terms, "term")}, ${plural(ix.postings.size, "different term")}\n` +
    `most common: ${common.slice(0, 5).map(([t, c]) => `${t} ${c}`).join(", ")}\n` +
    `longest: ${longest.name}, ${plural(longest.size, "term")}`;
}

export function notebook(args, io) {
  if (args.length !== 1) { io.printError("usage: notebook notes.txt"); return 2; }
  const path = args[0];
  try {
    let text;
    try { text = io.readFile(path); } catch (e) { throw new Abort(e.message); }
    const ls = lines(text.split("\n"));
    const ix = indexOf(ls);
    if (ix.notes.size === 0) throw new Abort(`${path} has no notes`);
    io.print(summary(ix));
    for (const l of ls) {
      if (l.kind === 1) io.print(`find ${l.terms.join(" ")}: ${hitsText(findHits(ix, l.terms))}`);
      else if (l.kind === 2) io.print(`any ${l.terms.join(" ")}: ${hitsText(ranked(anyScores(ix, l.terms, "")))}`);
      else if (l.kind === 3) {
        const it = ix.notes.get(l.name);
        if (!it) throw new Abort(`line ${l.n}: no note named ${l.name}`);
        io.print(`like ${l.name}: ${hitsText(ranked(anyScores(ix, it.terms.keys(), l.name)))}`);
      } else if (l.kind === 4) io.print(`seen ${l.word}: ${hitsText(ranked(seenWith(ix, l.word)))}`);
    }
    return 0;
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    io.printError(`notebook: ${e.why}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { readFileSync } = await import("node:fs");
  process.exitCode = notebook(process.argv.slice(2), { readFile: (p) => readFileSync(p, "utf8"), print: (s) => console.log(s), printError: (s) => console.error(s) });
}
