#!/usr/bin/env node
// calc, written by hand: the JavaScript the compiler should aim to produce
// for projectional/examples/calc. Same program, same algorithm, same output
// and exit code, same Int representation (a number while it's a safe
// integer, a BigInt beyond, as in projectional/src/lang/int.ts). What
// differs is only what a compiler could decide on its own; each difference
// is marked with the gap it stands for in docs/reports/GAPS.md (G1, G2, …).
//
// Run: node compiler/gaps/calc.ideal.js < input

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as I from "../../projectional/src/lang/int.ts";

// G3: variants as small numbers, not 26-character id strings, and Bool as
// JS booleans. Data stays { tag, fields } so values can still cross into
// the evaluator; only the tag is cheaper to switch on.
const NUMBER = 0, WORD = 1, SYMBOL = 2, GAP = 3;
const LITERAL = 0, VARIABLE = 1, NEGATIVE = 2, BINARY = 3;
const NIL = null; // G3: the empty list as null, a cons as [head, tail]
const GAP_TOKEN = { tag: GAP, fields: [] }; // G6: a nullary variant is built once

class Abort { constructor(reason) { this.reason = reason; } }
const abort = (reason) => { throw new Abort(reason); }; // G5: Abort as a plain throw

// The console. G8: from the command line, output is buffered and written
// in large pieces (see the end of the file).
let print = (s) => console.log(s), printError = (s) => console.error(s);

const blank = (c) => c === " " || c === "\t" || c === "\r";
const digit = (c) => !(c < "0") && !("9" < c);
const letter = (c) => (!(c < "a") && !("z" < c)) || (!(c < "A") && !("Z" < c)) || c === "_";

// G7: the fold over `characters(line)` walks the string from the end
// instead of building a list of one-character strings and then a spine
// array. G4: keep's test is pure, so it's an `if`, not a generator.
function tokens(line) {
  const cs = [...line];
  let after = NIL;
  for (let i = cs.length - 1; i >= 0; i--) {
    const c = cs[i];
    if (blank(c)) after = [GAP_TOKEN, after];
    else if (digit(c)) after = after !== NIL && after[0].tag === NUMBER ? [{ tag: NUMBER, fields: [c + after[0].fields[0]] }, after[1]] : [{ tag: NUMBER, fields: [c] }, after];
    else if (letter(c)) after = after !== NIL && (after[0].tag === WORD || after[0].tag === NUMBER) ? [{ tag: WORD, fields: [c + after[0].fields[0]] }, after[1]] : [{ tag: WORD, fields: [c] }, after];
    else after = [{ tag: SYMBOL, fields: [c] }, after];
  }
  // keep(…, t ≠ gap): G2, a comparison with a constant variant is a tag test
  const kept = [];
  for (let l = after; l !== NIL; l = l[1]) if (l[0].tag !== GAP) kept.push(l[0]);
  let r = NIL;
  for (let i = kept.length - 1; i >= 0; i--) r = [kept[i], r];
  return r;
}

function describe(ts) {
  if (ts === NIL) return "the end of the line";
  const t = ts[0];
  switch (t.tag) {
    case NUMBER: case WORD: return t.fields[0];
    case SYMBOL: return "“" + t.fields[0] + "”";
    default: return "a gap";
  }
}

// G2: `isMark(t, ["+", "-"])` is a tag test and string compares; no IIFE,
// no Bool object.
const mark = (t, m) => t.tag === SYMBOL && t.fields[0] === m;

// G1: the parser's Diverge costs nothing, because no `with fuel` is ever
// active in this program (main has none, and nothing calls it from one).
// G9: Parsed is two return values, so the parse functions return the
// expression and leave the rest of the tokens in `rest`.
let rest;
const expression = (ts) => sum(ts);
function sum(ts) {
  let left = product(ts);
  // G1: `sum rest` is a self tail call: a loop
  for (;;) {
    const t = rest === NIL ? null : rest[0];
    if (t && t.tag === SYMBOL && (t.fields[0] === "+" || t.fields[0] === "-")) {
      const right = product(rest[1]);
      left = { tag: BINARY, fields: [t.fields[0], left, right] };
    } else return left;
  }
}
function product(ts) {
  let left = unary(ts);
  for (;;) {
    const t = rest === NIL ? null : rest[0];
    if (t && t.tag === SYMBOL && (t.fields[0] === "*" || t.fields[0] === "/" || t.fields[0] === "%")) {
      const right = unary(rest[1]);
      left = { tag: BINARY, fields: [t.fields[0], left, right] };
    } else return left;
  }
}
function unary(ts) {
  if (ts !== NIL && mark(ts[0], "-")) return { tag: NEGATIVE, fields: [unary(ts[1])] };
  return power(ts);
}
function power(ts) {
  const base = atom(ts);
  if (rest !== NIL && mark(rest[0], "^")) return { tag: BINARY, fields: ["^", base, unary(rest[1])] };
  return base;
}
function atom(ts) {
  if (ts !== NIL) {
    const t = ts[0];
    switch (t.tag) {
      case NUMBER: {
        // G2: `first(read whole number(d), abort)` is the builtin's array, checked
        const [v] = I.read(t.fields[0]);
        if (v === undefined) abort("not a number: " + t.fields[0]);
        rest = ts[1];
        return { tag: LITERAL, fields: [v] };
      }
      case WORD: rest = ts[1]; return { tag: VARIABLE, fields: [t.fields[0]] };
      case SYMBOL:
        if (t.fields[0] === "(") {
          const inside = expression(ts[1]);
          rest = expect(")", rest);
          return inside;
        }
    }
  }
  return abort("expected a number, a name or “(”, got " + describe(ts));
}
function expect(m, ts) {
  if (ts !== NIL && mark(ts[0], m)) return ts[1];
  return abort("expected “" + m + "”, got " + describe(ts));
}

function lookup(bs, name) {
  // G1: a self tail call, a loop
  for (; bs !== NIL; bs = bs[1]) if (bs[0].fields[0] === name) return bs[0].fields[1];
  return abort("unknown name " + name);
}

// G2: `first(quotient(a, b), abort)` with the builtin's fast path inlined
function apply(op, a, b) {
  switch (op) {
    case "+": return I.add(a, b);
    case "-": return I.sub(a, b);
    case "*": return I.mul(a, b);
    case "/": return b === 0 ? abort("division by zero") : I.quotient(a, b)[0];
    case "%": return b === 0 ? abort("remainder of division by zero") : I.remainder(a, b)[0];
    case "^": return I.less(b, 0) ? abort("negative power") : I.power(a, b)[0];
  }
  return abort("unknown operator " + op);
}

// The fold over the tree keeps an explicit stack, as the compiler's does;
// G10: with the arity known per case, no index table and no frame objects.
function evaluate(e, bs) {
  const todo = [e], vals = [];
  const BACK = {};
  while (todo.length) {
    const x = todo.pop();
    if (x === BACK) {
      const n = todo.pop();
      if (n.tag === NEGATIVE) vals.push(I.neg(vals.pop()));
      else { const b = vals.pop(), a = vals.pop(); vals.push(apply(n.fields[0], a, b)); }
      continue;
    }
    switch (x.tag) {
      case LITERAL: vals.push(x.fields[0]); break;
      case VARIABLE: vals.push(lookup(bs, x.fields[0])); break;
      case NEGATIVE: todo.push(x, BACK, x.fields[0]); break;
      case BINARY: todo.push(x, BACK, x.fields[2], x.fields[1]); break;
    }
  }
  return vals[0];
}

function parenthesized(e) {
  const todo = [e], vals = [];
  const BACK = {};
  while (todo.length) {
    const x = todo.pop();
    if (x === BACK) {
      const n = todo.pop();
      if (n.tag === NEGATIVE) vals.push("(-" + vals.pop() + ")");
      else { const b = vals.pop(), a = vals.pop(); vals.push("(" + a + " " + n.fields[0] + " " + b + ")"); }
      continue;
    }
    switch (x.tag) {
      case LITERAL: vals.push(String(x.fields[0])); break;
      case VARIABLE: vals.push(x.fields[0]); break;
      case NEGATIVE: todo.push(x, BACK, x.fields[0]); break;
      case BINARY: todo.push(x, BACK, x.fields[2], x.fields[1]); break;
    }
  }
  return vals[0];
}

function whole(ts) {
  const e = expression(ts);
  if (rest !== NIL) abort("expected an operator or the end of the line, got " + describe(rest));
  return e;
}

function runLine(line, bs) {
  const ts = tokens(line);
  if (ts === NIL) return bs;
  const t = ts[0], more = ts[1];
  // G2: `t = word("let")` is a tag test and a string compare, not $eq
  // against a freshly built token
  if (t.tag === WORD && t.fields[0] === "let") {
    if (more === NIL || more[0].tag !== WORD) abort("let needs a name, got " + describe(more));
    const name = more[0].fields[0];
    const v = evaluate(whole(expect("=", more[1])), bs);
    print(name + " = " + String(v));
    return [{ tag: 0, fields: [name, v] }, bs];
  }
  if (mark(t, "?")) { print(parenthesized(whole(more))); return bs; }
  print(String(evaluate(whole(ts), bs)));
  return bs;
}

// G1: `run lines` is a self tail call (through the handler's value), a
// loop. G5: the Abort handler is a try/catch, with no handler stack,
// because nothing inside performs any other effect.
export function calc(input, out = print, err = printError) {
  print = out; printError = err;
  const lines = input.split("\n");
  let bs = NIL, errors = 0;
  for (let i = 0; i < lines.length; i++) {
    try { bs = runLine(lines[i], bs); } catch (e) {
      if (!(e instanceof Abort)) throw e;
      printError("calc: line " + (i + 1) + ": " + e.reason);
      errors++;
    }
  }
  return errors > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let buffer = "";
  const flush = () => { process.stdout.write(buffer); buffer = ""; };
  const code = calc(readFileSync(0, "utf8"),
    (s) => { buffer += s + "\n"; if (buffer.length > 1 << 16) flush(); },
    (s) => { flush(); process.stderr.write(s + "\n"); });
  flush();
  process.exitCode = code;
}
