#!/usr/bin/env node
// sheet, written by hand: the JavaScript the compiler should aim to produce
// for ters/examples/sheet. Same program, same output, same exit codes, same
// algorithm: formulas tokenized and parsed by recursive descent, every cell
// worked out once, depth first, with the cells on the way kept to find
// cycles; then a grid, the problems, and a report written beside the file.
// What differs is only what a compiler could decide on its own; each
// difference is marked with the gap it stands for in docs/reports/GAPS.md
// (round 7).
//
// The program threads a persistent Map of results through every cell
// (`computed`, `filled`). Here it is one JS Map changed in place, tokens
// are an array with an index instead of a list of tokens and a list of
// one-character texts, and a formula's value is a number or an error
// object (all S3). The grid's width and columns are worked out once, not
// once per row (S2), and no map is a search (S1).
//
// `io` is the world: readFile and writeFile (which throw an Error when they
// can't), print and printError. A failure becomes the program's Abort.
//
// Run: node compiler/gaps/sheet.ideal.js sheet.txt

import { fileURLToPath } from "node:url";

class Abort { constructor(why) { this.why = why; } }
class NoParse {}
const NO = new NoParse();
const err = (reason) => ({ reason });
const isErr = (v) => typeof v === "object";
const floorDiv = (a, b) => Math.floor(a / b);

// ---- reading (S3: one pass over the code units, no list of characters)
const SYMBOLS = "+-*/():,";
const WHOLE = /^-?(0|[1-9][0-9]*)$/;
function tokenize(text) {
  const out = [];
  let cur = "";
  const flush = () => {
    if (cur === "") return;
    if (cur[0] >= "0" && cur[0] <= "9") {
      if (!WHOLE.test(cur)) throw NO;
      out.push({ k: 0, v: Number(cur) });
    } else out.push({ k: 1, v: cur.toUpperCase() });
    cur = "";
  };
  for (const c of text) {
    if (c === " " || c === "\t") flush();
    else if (SYMBOLS.includes(c)) { flush(); out.push({ k: 2, v: c }); }
    else cur += c;
  }
  flush();
  return out;
}

// ---- parsing: recursive descent over the array, `at` the next token
function parseFormula(text) {
  const ts = tokenize(text);
  let at = 0;
  const sym = (s) => at < ts.length && ts[at].k === 2 && ts[at].v === s;
  const expression = () => {
    let e = term();
    while (sym("+") || sym("-")) { const op = ts[at++].v; e = { t: "bin", op, l: e, r: term() }; }
    return e;
  };
  const term = () => {
    let e = factor();
    while (sym("*") || sym("/")) { const op = ts[at++].v; e = { t: "bin", op, l: e, r: factor() }; }
    return e;
  };
  const factor = () => {
    if (at >= ts.length) throw NO;
    const tk = ts[at++];
    if (tk.k === 0) return { t: "lit", v: tk.v };
    if (tk.k === 1) {
      if (sym("(")) {
        at++;
        const args = [expression()];
        for (;;) {
          if (at >= ts.length) throw NO;
          if (sym(",")) { at++; args.push(expression()); continue; }
          if (!sym(")")) throw NO;
          at++;
          return { t: "call", name: tk.v, args };
        }
      }
      if (sym(":")) {
        at++;
        if (at >= ts.length || ts[at].k !== 1) throw NO;
        return { t: "span", from: tk.v, to: ts[at++].v };
      }
      return { t: "cell", name: tk.v };
    }
    if (tk.v === "-") return { t: "neg", of: factor() };
    if (tk.v === "(") {
      const e = expression();
      if (!sym(")")) throw NO;
      at++;
      return e;
    }
    throw NO;
  };
  const e = expression();
  if (at !== ts.length) throw NO;
  return e;
}
function formulaOf(text) {
  try { return parseFormula(text); } catch (e) { if (e === NO) return { t: "broken", reason: "parse" }; throw e; }
}

// ---- cell names
const columnOf = (name) => (name.codePointAt(0) ?? NaN) - 65;
const rowOf = (name) => { const s = name.slice(1); return WHOLE.test(s) ? Number(s) : NaN; };
const letter = (c) => (c + 65 >= 0 && c + 65 <= 0x10ffff ? String.fromCodePoint(c + 65) : "?");
function namesInSpan(from, to) {
  const c0 = columnOf(from), c1 = columnOf(to), r0 = rowOf(from), r1 = rowOf(to);
  if ([c0, c1, r0, r1].some(Number.isNaN)) return [];
  const out = [];
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push(letter(c) + r);
  return out;
}

// ---- evaluation (S3: one Map of results changed in place)
function references(e, out) {
  switch (e.t) {
    case "cell": out.push(e.name); break;
    case "span": for (const n of namesInSpan(e.from, e.to)) out.push(n); break;
    case "bin": references(e.l, out); references(e.r, out); break;
    case "neg": references(e.of, out); break;
    case "call": for (const a of e.args) references(a, out); break;
  }
  return out;
}
const LITERAL_0 = { t: "lit", v: 0 };
function evaluateAll(sheet) {
  const results = new Map();
  const path = new Set();
  const computed = (name) => {
    if (results.has(name)) return;
    if (path.has(name)) { results.set(name, err("cycle")); return; }
    const f = sheet.get(name) ?? LITERAL_0;
    path.add(name);
    for (const n of references(f, [])) computed(n);
    path.delete(name);
    if (!results.has(name)) results.set(name, valueOf(f, results));
  };
  for (const name of [...sheet.keys()].sort()) computed(name);
  return results;
}
const lookedUp = (results, name) => results.get(name) ?? 0;
function valueOf(e, results) {
  switch (e.t) {
    case "lit": return e.v;
    case "cell": return lookedUp(results, e.name);
    case "span": return err("span");
    case "bin": {
      const a = valueOf(e.l, results);
      if (isErr(a)) return a;
      const b = valueOf(e.r, results);
      if (isErr(b)) return b;
      switch (e.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        default: return b === 0 ? err("div/0") : floorDiv(a, b);
      }
    }
    case "neg": { const v = valueOf(e.of, results); return isErr(v) ? v : 0 - v; }
    case "call": {
      const ns = [];
      for (const a of e.args) {
        if (a.t === "span") for (const n of namesInSpan(a.from, a.to)) { const v = lookedUp(results, n); if (isErr(v)) return v; ns.push(v); }
        else { const v = valueOf(a, results); if (isErr(v)) return v; ns.push(v); }
      }
      switch (e.name) {
        case "SUM": return ns.reduce((x, y) => x + y, 0);
        case "MIN": return ns.length ? Math.min(...ns) : err("empty");
        case "MAX": return ns.length ? Math.max(...ns) : err("empty");
        case "COUNT": return ns.length;
        case "AVERAGE": return ns.length ? floorDiv(ns.reduce((x, y) => x + y, 0), ns.length) : err("div/0");
        default: return err("name?");
      }
    }
    case "broken": return err(e.reason);
  }
}

// ---- output (S2: columns and width once; S1: the width's map is a loop)
const showValue = (v) => (isErr(v) ? "#" + v.reason : String(v));
const padded = (t, w) => (t.length < w ? " ".repeat(w - t.length) + t : t);
function grid(sheet, results) {
  const cols = [...new Set([...sheet.keys()].map((n) => { const c = columnOf(n); return Number.isNaN(c) ? 0 : c; }))].sort((a, b) => a - b);
  let last = 0;
  for (const n of sheet.keys()) { const r = rowOf(n); last = Math.max(last, Number.isNaN(r) ? 0 : r); }
  let width = 0;
  for (const v of results.values()) width = Math.max(width, showValue(v).length);
  width += 2;
  const cellText = (name) => (results.has(name) ? showValue(results.get(name)) : "");
  const lines = [padded("", 4) + cols.map((c) => padded(letter(c), width)).join("")];
  for (let r = 1; r <= last; r++) lines.push(padded(String(r), 4) + cols.map((c) => padded(cellText(letter(c) + r), width)).join(""));
  return lines;
}
function showFormula(e) {
  switch (e.t) {
    case "lit": return String(e.v);
    case "cell": return e.name;
    case "span": return e.from + ":" + e.to;
    case "bin": return "(" + showFormula(e.l) + " " + e.op + " " + showFormula(e.r) + ")";
    case "neg": return "-" + showFormula(e.of);
    case "call": return e.name + "(" + e.args.map(showFormula).join(", ") + ")";
    case "broken": return "?";
  }
}

export function sheet(args, io) {
  if (!args.length) { io.print("usage: sheet <file>"); return 2; }
  const path = args[0];
  try {
    let text;
    try { text = io.readFile(path); } catch (e) { throw new Abort(e.message); }
    const entries = [];
    text.split("\n").forEach((line, i) => {
      const n = i + 1;
      if (line.replace(/[ \t]/g, "") === "" || line.startsWith("#")) return;
      const parts = line.split("=");
      if (parts.length < 2) throw new Abort(`line ${n}: expected <cell> = <formula>`);
      entries.push({ name: parts[0].replace(/[ \t]/g, "").toUpperCase(), formula: formulaOf(parts.slice(1).join("=")), line: n });
    });
    const sheet = new Map(entries.map((e) => [e.name, e.formula]));
    const results = evaluateAll(sheet);
    for (const l of grid(sheet, results)) io.print(l);
    const cellText = (name) => (results.has(name) ? showValue(results.get(name)) : "");
    const problems = entries.filter((e) => isErr(lookedUp(results, e.name))).map((e) => `line ${e.line}: ${e.name} is ${cellText(e.name)}`);
    for (const l of problems) io.print(l);
    try { io.writeFile(path + ".out", entries.map((e) => `${e.name} = ${showFormula(e.formula)} → ${cellText(e.name)}`).join("\n")); }
    catch (e) { throw new Abort(e.message); }
    return problems.length ? 1 : 0;
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    io.printError(e.why);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  process.exitCode = sheet(process.argv.slice(2), {
    readFile: (p) => readFileSync(p, "utf8"),
    writeFile: (p, t) => writeFileSync(p, t),
    print: (s) => console.log(s),
    printError: (s) => console.error(s),
  });
}
