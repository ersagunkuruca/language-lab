#!/usr/bin/env node
// larder, written by hand: the JavaScript the compiler should aim to produce
// for compiler/gaps/larder (GAPS.md round 20). The same program, with the
// same output and exit codes:
// - a line is read the way the program reads it, by running its printer
//   backwards (miniKanren's relational reading, Friedman, Byrd and
//   Kiselyov): here the one reading whose unit and food are one word each,
//   found directly from the words;
// - amounts are exact fractions, [top, bottom] in lowest terms;
// - an amount is spelled in the largest unit that holds at least a quarter
//   of one, with the simplest kitchen fraction; else in any unit; else
//   about, to the nearest eighth of the smallest unit;
// - the packs to buy are every way to cover what is short, never more of
//   one pack than covers what is left, the one with the least over and
//   then the fewest packs chosen.
//
// `io` is the world: readFile (which throws an Error when it can't), print
// and printError. A failure becomes the program's Abort.
//
// Run: node compiler/gaps/larder.ideal.js book.txt

import { fileURLToPath } from "node:url";

class Abort { constructor(why) { this.why = why; } }
const abort = (why) => { throw new Abort(why); };

// ---- Exact fractions ----
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const frac = (n, d) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; return [n / g, d / g]; };
const add = (a, b) => frac(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const sub = (a, b) => frac(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a, b) => frac(a[0] * b[0], a[1] * b[1]);
const div = (a, b) => frac(a[0] * b[1], a[1] * b[0]);
const cmp = (a, b) => a[0] * b[1] - b[0] * a[1];
const ZERO = [0, 1], ONE = [1, 1], QUARTER = [1, 4];
const wholePart = (x) => Math.floor(x[0] / x[1]);

// ---- Amounts, read and written ----
const intRe = /^-?(0|[1-9][0-9]*)$/;
const int = (t) => (intRe.test(t) && t !== "-0" ? Number(t) : null);
// The amount `spelled quantity` would print as these words, or null.
function quantityOf(ws) {
  if (ws.length === 1) {
    const w = int(ws[0]); if (w !== null) return { kind: "whole", n: w };
    const m = /^([^/]*)\/([^/]*)$/.exec(ws[0]);
    if (m && int(m[1]) !== null && int(m[2]) !== null) return { kind: "part", t: int(m[1]), b: int(m[2]) };
    return null;
  }
  if (ws.length === 2) {
    const u = int(ws[0]), m = /^([^/]*)\/([^/]*)$/.exec(ws[1]);
    if (u !== null && m && int(m[1]) !== null && int(m[2]) !== null) return { kind: "mixed", u, t: int(m[1]), b: int(m[2]) };
  }
  return null;
}
const spelled = (q) => (q.kind === "whole" ? String(q.n) : q.kind === "part" ? `${q.t}/${q.b}` : `${q.u} ${q.t}/${q.b}`);
const badAmount = (n) => abort(`line ${n}: an amount is a whole number or a fraction above 0`);
function valueOf(q, n) {
  if (q.kind === "whole") return q.n < 1 ? badAmount(n) : [q.n, 1];
  if (q.kind === "part") return q.t < 1 || q.b < 1 ? badAmount(n) : frac(q.t, q.b);
  return q.u < 1 || q.t < 1 || q.b < 1 || q.t >= q.b ? badAmount(n) : add([q.u, 1], frac(q.t, q.b));
}
// `amount unit food`: the amount is the words before the last two.
function itemOf(ws, n) {
  const q = ws.length >= 3 ? quantityOf(ws.slice(0, -2)) : null;
  if (!q) abort(`line ${n}: expected an amount, a unit and a food, as in 1 1/2 cup flour`);
  return { amount: q, unit: ws[ws.length - 2], food: ws[ws.length - 1] };
}
// `called amount unit`, after `unit`.
function definitionOf(ws, n) {
  const q = ws.length >= 3 ? quantityOf(ws.slice(1, -1)) : null;
  if (!q) abort(`line ${n}: expected a unit, or a unit, an amount and another unit, as in tbsp 3 tsp`);
  return { called: ws[0], many: q, of: ws[ws.length - 1] };
}

// ---- Reading the book ----
const words = (line) => line.split(" ").filter((w) => w !== "");
const badLine = (n) => abort(`line ${n}: expected unit, recipe, have, sell, make, or an amount, a unit and a food`);
function whole(field, n, what) {
  const v = int(field);
  if (v === null) abort(`line ${n}: ${what} ${field} isn't a whole number`);
  return v;
}
function entryOf(ws, n) {
  const [w, ...rest] = ws;
  switch (w) {
    case "unit":
      if (rest.length === 1) return { kind: "measure", m: { name: rest[0], size: ONE, base: rest[0], line: n } };
      { const d = definitionOf(rest, n); return { kind: "measure", m: { name: d.called, size: valueOf(d.many, n), base: d.of, line: n } }; }
    case "recipe": {
      if (rest.length !== 2) badLine(n);
      const serves = whole(rest[1], n, "serves");
      if (serves < 1) abort(`line ${n}: a recipe serves at least one`);
      return { kind: "recipe", dish: rest[0], serves, line: n };
    }
    case "have": return { kind: "have", it: [itemOf(rest, n), n] };
    case "sell": return { kind: "sell", it: [itemOf(rest, n), n] };
    case "make": {
      if (rest.length !== 2) badLine(n);
      const portions = whole(rest[1], n, "portions");
      if (portions < 1) abort(`line ${n}: make at least one portion`);
      return { kind: "make", mk: { want: rest[0], portions, line: n } };
    }
    default: return { kind: "food", it: [itemOf(ws, n), n] };
  }
}

function toBase(ms, name, steps) {
  const m = ms.find((x) => x.name === name);
  if (!m) abort(`${name} isn't a unit`);
  if (m.base === m.name) return [ONE, name];
  if (steps > ms.length) abort(`line ${m.line}: unit ${name} is measured by itself`);
  const b = toBase(ms, m.base, steps + 1);
  return [mul(m.size, b[0]), b[1]];
}
const knownMeasure = (ms, name, n) => { if (!ms.some((m) => m.name === name)) abort(`line ${n}: ${name} isn't a unit`); };
function inBase(ms, [i, n]) {
  knownMeasure(ms, i.unit, n);
  const b = toBase(ms, i.unit, 0);
  return [mul(valueOf(i.amount, n), b[0]), b[1]];
}

function bookOf(text) {
  const es = [], lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ws = words(lines[i]);
    if (ws.length === 0 || lines[i].startsWith("#")) continue;
    es.push(entryOf(ws, i + 1));
  }
  let inside = false;
  for (const e of es) {
    if (e.kind === "food" && !inside) abort(`line ${e.it[1]}: a food line comes before any recipe`);
    inside = e.kind === "recipe" || e.kind === "food";
  }
  const ms = es.filter((e) => e.kind === "measure").map((e) => e.m);
  for (const m of ms) {
    const f = ms.find((x) => x.name === m.name);
    if (f.line !== m.line) abort(`line ${m.line}: unit ${m.name} again (first on line ${f.line})`);
    knownMeasure(ms, m.base, m.line);
  }
  for (const m of ms) toBase(ms, m.name, 0);
  const rs = [];
  es.forEach((e, i) => {
    if (e.kind !== "recipe") return;
    const items = [];
    for (let j = i + 1; j < es.length && es[j].kind === "food"; j++) items.push(es[j].it);
    rs.push({ dish: e.dish, serves: e.serves, items, line: e.line });
  });
  for (const r of rs) {
    const f = rs.find((o) => o.dish === r.dish);
    if (f.line !== r.line) abort(`line ${r.line}: recipe ${r.dish} again (first on line ${f.line})`);
    if (r.items.length === 0) abort(`line ${r.line}: ${r.dish} has no foods`);
  }
  const larder = es.filter((e) => e.kind === "have").map((e) => e.it);
  const packs = es.filter((e) => e.kind === "sell").map((e) => e.it);
  const plan = es.filter((e) => e.kind === "make").map((e) => e.mk);
  for (const mk of plan) theRecipe(rs, mk.want, mk.line);
  const mentions = [...rs.flatMap((r) => r.items), ...larder, ...packs].map((it) => {
    const b = inBase(ms, it);
    return { food: it[0].food, dim: b[1], said: it[0].unit, line: it[1] };
  });
  for (const o of mentions) {
    const f = mentions.find((x) => x.food === o.food);
    if (f.dim !== o.dim) abort(`line ${o.line}: ${o.food} is in ${o.said} here but in ${f.said} on line ${f.line}`);
  }
  if (rs.length === 0) abort("the book has no recipes");
  if (plan.length === 0) abort("the book makes nothing: add a make line");
  return { ms, rs, larder, packs, plan };
}
function theRecipe(rs, name, n) {
  const r = rs.find((x) => x.dish === name);
  if (!r) abort(`line ${n}: ${name} isn't a recipe`);
  return r;
}

// ---- Spelling an amount the way a kitchen would ----
const BOTTOMS = [1, 2, 3, 4, 8];
function quantityFor(w, b) {
  const n = Math.trunc(w / b), t = w - n * b;
  return t === 0 ? { kind: "whole", n } : n === 0 ? { kind: "part", t, b } : { kind: "mixed", u: n, t, b };
}
function kitchen(x) {
  for (const b of BOTTOMS) {
    const y = mul(x, [b, 1]);
    if (y[1] === 1) return quantityFor(y[0], b);
  }
  return null;
}
function unitsFor(ms, dim) {
  const us = [];
  for (const m of ms) { const b = toBase(ms, m.name, 0); if (b[1] === dim) us.push([m, b[0]]); }
  return us.sort((a, b) => cmp(b[1], a[1]));
}
function bestSpelling(units, r, low) {
  for (const [m, size] of units) {
    const x = div(r, size);
    if (cmp(x, low) < 0) continue;
    const q = kitchen(x);
    if (q) return `${spelled(q)} ${m.name}`;
  }
  return null;
}
function spelling(units, r) {
  const s = bestSpelling(units, r, QUARTER) ?? bestSpelling(units, r, ZERO);
  if (s !== null) return s;
  const [m, size] = units[units.length - 1];
  const x = div(r, size), w = Math.floor((x[0] / x[1]) * 8 + 0.5);
  return `about ${spelled(kitchen(frac(w, 8)))} ${m.name}`;
}

// ---- The report ----
function report(bk, io) {
  const { ms, rs, larder, packs, plan } = bk;
  io.print(`${rs.length} recipes, ${ms.length} units, ${larder.length} things in the larder, ${packs.length} packs for sale`);
  const unitsOf = new Map();
  const units = (dim) => { if (!unitsOf.has(dim)) unitsOf.set(dim, unitsFor(ms, dim)); return unitsOf.get(dim); };
  const spelledNeed = (nd) => `${spelling(units(nd.dim), nd.much)} ${nd.food}`;
  const scaled = (mk) => {
    const r = theRecipe(rs, mk.want, mk.line), factor = frac(mk.portions, r.serves);
    return r.items.map((it) => { const x = inBase(ms, it); return { food: it[0].food, much: mul(x[0], factor), dim: x[1] }; });
  };
  for (const mk of plan) {
    io.print(`${mk.want} for ${mk.portions} (serves ${theRecipe(rs, mk.want, mk.line).serves})`);
    for (const nd of scaled(mk)) io.print("  " + spelledNeed(nd));
  }
  const all = plan.flatMap(scaled), totals = new Map();
  for (const nd of all) {
    const t = totals.get(nd.food);
    totals.set(nd.food, t ? { ...t, much: add(t.much, nd.much) } : { ...nd });
  }
  const ns = [...totals.values()];
  io.print("needed: " + ns.map(spelledNeed).join(", "));
  const stock = new Map();
  for (const it of larder) { const x = inBase(ms, it); stock.set(it[0].food, add(stock.get(it[0].food) ?? ZERO, x[0])); }
  const have = (f) => stock.get(f) ?? ZERO;
  for (const nd of ns) {
    const short = sub(nd.much, have(nd.food));
    if (cmp(short, ZERO) > 0) io.print(shopping(ms, packs, units(nd.dim), nd, short));
  }
  const portions = (mk) => {
    const r = theRecipe(rs, mk.want, mk.line);
    let low = 1000000;
    for (const it of r.items) {
      const per = mul(inBase(ms, it)[0], frac(1, r.serves));
      low = Math.min(low, wholePart(div(have(it[0].food), per)));
    }
    return low;
  };
  io.print("the larder alone makes: " + plan.map((mk) => `${mk.want} for ${portions(mk)}`).join(", "));
  io.print("credits: lines read by running their printers backwards, after miniKanren (Friedman, Byrd and Kiselyov)");
}

// Every way to cover `short` with the food's packs, never more of one than
// covers what is left; the least over, then the fewest packs, then the
// counts in order.
function shopping(ms, packs, units, nd, short) {
  const sizes = packs.filter((p) => p[0].food === nd.food).map((p) => [p[0], inBase(ms, p)[0]]);
  const head = `buy ${nd.food}, short ${spelling(units, short)}: `;
  const ks = new Array(sizes.length).fill(0);
  let ways = 0, best = null;
  const better = (over, n, a, b) => {
    const c = cmp(over, b.over);
    if (c !== 0) return c < 0;
    if (n !== b.n) return n < b.n;
    for (let i = 0; i < a.length; i++) if (a[i] !== b.ks[i]) return a[i] < b.ks[i];
    return false;
  };
  const go = (i, left) => {
    if (i === sizes.length) {
      if (cmp(left, ZERO) > 0) return;
      ways++;
      const over = sub(ZERO, left), n = ks.reduce((a, b) => a + b, 0);
      if (!best || better(over, n, ks, best)) best = { over, n, ks: ks.slice() };
      return;
    }
    const size = sizes[i][1];
    let most = 0;
    if (cmp(left, ZERO) > 0) { const q = div(left, size), c = wholePart(q); most = q[1] === 1 ? c : c + 1; }
    for (let k = 0; k <= most; k++) { ks[i] = k; go(i + 1, sub(left, mul([k, 1], size))); }
    ks[i] = 0;
  };
  go(0, short);
  if (!best) return head + "not sold";
  const chosen = sizes.map((s, i) => [s[0], best.ks[i]]).filter((p) => p[1] > 0).map(([p, k]) => `${k} × ${spelled(p.amount)} ${p.unit}`);
  const over = cmp(best.over, ZERO) === 0 ? "nothing" : spelling(units, best.over);
  return `${head}${chosen.join(", ")} (${over} over, ${ways === 1 ? "1 way" : ways + " ways"})`;
}

export function larder(args, io) {
  if (args.length !== 1) { io.printError("usage: larder book.txt"); return 2; }
  try {
    let text;
    try { text = io.readFile(args[0]); } catch (e) { throw new Abort(e.message); }
    report(bookOf(text), io);
    return 0;
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    io.printError("larder: " + e.why);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fs = await import("node:fs");
  const io = {
    readFile: (p) => {
      try { return fs.readFileSync(p, "utf8"); } catch (e) { throw e.code === "ENOENT" ? new Error(`no such file or folder: ${p}`) : e; }
    },
    print: (s) => console.log(s),
    printError: (s) => console.error(s),
  };
  process.exitCode = larder(process.argv.slice(2), io);
}
