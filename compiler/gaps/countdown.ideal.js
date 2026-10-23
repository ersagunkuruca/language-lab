#!/usr/bin/env node
// Countdown, written by hand: the JavaScript the compiler should aim to
// produce for projectional/examples/countdown. Same program, same search,
// same order of answers, same output. What differs is only what a compiler
// could decide on its own; each difference is marked with the gap it stands
// for in compiler/GAPS.md (round 2: G11, G12, …; round 1's numbers where
// the same gap comes back).
//
// The algorithm is Graham Hutton's, from "The countdown problem", Journal
// of Functional Programming 12(6), 2002
// (https://www.cs.nott.ac.uk/~pszgmh/countdown.pdf): every ordering of
// every subset of the numbers, every way to split it in two, every
// operator, keeping only the expressions his `valid` allows (the version
// that uses commutativity and identities to skip duplicates).
//
// Run: node compiler/gaps/countdown.ideal.js

import { fileURLToPath } from "node:url";

// G3: variants as small numbers. Data stays { tag, fields }.
const PLUS = 0, MINUS = 1, TIMES = 2, OVER = 3;
const NUMBER = 0, APPLY = 1;
// G9: a nullary variant is built once, and so is the list of operators
// `one of([plus, minus, times, over])` picks from.
const OPS = [{ tag: PLUS, fields: [] }, { tag: MINUS, fields: [] }, { tag: TIMES, fields: [] }, { tag: OVER, fields: [] }];
// G3: the empty list as null, a cons as [head, tail].
const NIL = null;

// Numbers are equal to the precision floats carry, as in the language
// (projectional/src/lang/run.ts `close`).
const near = (a, b) => a === b || Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b));
const mod = (a, b) => ((a % b) + b) % b;
const show = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e9) / 1e9));

function valid(op, x, y) {
  switch (op.tag) {
    case PLUS: return !(y < x);
    case MINUS: return y < x;
    case TIMES: return !near(x, 1) && !near(y, 1) && !(y < x);
    default: return !near(y, 1) && near(mod(x, y), 0);
  }
}

function combine(op, x, y) {
  switch (op.tag) {
    case PLUS: return x + y;
    case MINUS: return x - y;
    case TIMES: return x * y;
    default: return x / y;
  }
}

// G11: a Choice function takes the rest of the search as a function `k`
// and calls it once per answer, instead of being a generator that every
// caller drains with `for … of` and yields again. Answers come in the same
// order.
// G12: `one of([true, false])` is the two branches one after the other: no
// list of Bools, and no Bool test.
// G13: a `Found` or a `Halves` that is taken apart as soon as it's made is
// two arguments to `k`, not an object.
function split(items, k) {
  if (items === NIL || items[1] === NIL) return;
  const head = items[0], tail = items[1];
  k([head, NIL], tail);
  split(tail, (front, back) => k([head, front], back));
}

function subsequence(items, k) {
  if (items === NIL) return k(NIL);
  const head = items[0];
  subsequence(items[1], (rest) => { k([head, rest]); k(rest); });
}

function insertAnywhere(x, items, k) {
  if (items === NIL) return k([x, NIL]);
  const head = items[0];
  k([x, items]);
  insertAnywhere(x, items[1], (r) => k([head, r]));
}

function permutation(items, k) {
  if (items === NIL) return k(NIL);
  const head = items[0];
  permutation(items[1], (rest) => insertAnywhere(head, rest, k));
}

// G1 (fuel): results has Diverge, but no `with fuel` is ever active in this
// program, so there's no `$spend()` before each call.
function results(numbers, k) {
  if (numbers === NIL) return;
  if (numbers[1] === NIL) return k({ tag: NUMBER, fields: [numbers[0]] }, numbers[0]);
  split(numbers, (front, back) =>
    results(front, (l, x) =>
      results(back, (r, y) => {
        for (const op of OPS) if (valid(op, x, y)) k({ tag: APPLY, fields: [op, l, r] }, combine(op, x, y));
      })));
}

const toList = (xs) => xs.reduceRight((rest, x) => [x, rest], NIL);

export function solutions(numbers, target) {
  const all = [];
  subsequence(toList(numbers), (s) => permutation(s, (c) => results(c, (e, v) => { if (near(v, target)) all.push(e); })));
  return all;
}

const SYMBOL = [" + ", " − ", " × ", " ÷ "];
// G7: a fold over an Expr is plain recursion here. Its depth is at most the
// count of numbers, so the JS stack is no risk.
export function showExpr(e) {
  return e.tag === NUMBER ? show(e.fields[0]) : "(" + showExpr(e.fields[1]) + SYMBOL[e.fields[0].tag] + showExpr(e.fields[2]) + ")";
}

export function countdown(numbers, target, print) {
  for (const e of solutions(numbers, target)) print(showExpr(e));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) countdown([1, 3, 7, 10, 25, 50], 765, (s) => console.log(s));
