#!/usr/bin/env node
// ledger, written by hand: the JavaScript the compiler should aim to
// produce for projectional/examples/ledger. Same program, same output, same
// exit codes, same algorithms (totals kept in a list and updated in place
// of a copy, insertion sort). What differs is only what a compiler could
// decide on its own; each difference is marked with the gap it stands for
// in compiler/GAPS.md (round 3).
//
// `io` is the world: readFile (which throws an Error when it can't), print
// and printError. A failure becomes the program's Abort.
//
// Run: node compiler/gaps/ledger.ideal.js ledger.csv

import { fileURLToPath } from "node:url";

class Abort { constructor(why) { this.why = why; } }

const amountOk = /^-?(0|[1-9][0-9]*)$/;
const badLine = (n) => new Abort(`line ${n}: expected date,account,cents,memo`);

// `entries` and `parse`: one pass over the lines, the fields split once.
// G22: a loop that appends, not a frame per line. G23: the lines stay an
// array. G24: the amount is one regular expression test.
function entries(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], n = i + 1;
    if (line === "" || line.startsWith("#")) continue;
    const f = line.split(",");
    if (f.length !== 4) throw badLine(n);
    if (!amountOk.test(f[2]) || f[2] === "-0") throw new Abort(`line ${n}: the amount isn't a whole number of cents`);
    out.push({ date: f[0], account: f[1], cents: Number(f[2]), memo: f[3] });
  }
  return out;
}

// `add to` as the program has it: the first total with this name gets the
// entry, and a new name goes on the end.
function addTo(totals, name, cents) {
  for (const t of totals) if (t.name === name) { t.cents += cents; t.count++; return; }
  totals.push({ name, cents, count: 1 });
}
// The folds run from the end of the list, as the program's do. G23: from
// the end of an array, with no spine copied first.
function byKey(es, key) {
  const totals = [];
  for (let i = es.length - 1; i >= 0; i--) addTo(totals, key(es[i]), es[i].cents);
  return totals;
}

// G3: byName is a JS boolean.
const larger = (a, b) => b.cents < a.cents || (a.cents === b.cents && a.name < b.name);
const goesBefore = (a, b, byName) => (byName ? a.name < b.name : larger(a, b));
// Insertion sort, the items taken from the end.
function sort(ts, byName) {
  const out = [];
  for (let i = ts.length - 1; i >= 0; i--) {
    let at = 0;
    while (at < out.length && !goesBefore(ts[i], out[at], byName)) at++;
    out.splice(at, 0, ts[i]);
  }
  return out;
}

// G19: lengths and slices in UTF-16; these texts are ASCII.
const padLeft = (t, w, c) => c.repeat(Math.max(0, w - t.length)) + t;
function money(c) {
  const d = padLeft(String(Math.abs(c)), 3, "0");
  return (c < 0 ? "-" : "") + d.slice(0, -2) + "." + d.slice(-2);
}
const row = (t) => t.name.padEnd(14) + padLeft(money(t.cents), 12, " ") + " × " + t.count;
const table = (title, ts) => title + "\n" + ts.map(row).join("\n");

function report(es) {
  let smallest = null, total = 0;
  for (const e of es) {
    if (smallest === null || e.cents < smallest.cents) smallest = e;
    total += e.cents;
  }
  const expense = smallest === null ? "no entries" : `smallest: ${money(smallest.cents)} on ${smallest.date}, ${smallest.memo}`;
  return table("By account", sort(byKey(es, (e) => e.account), false)) + "\n\n" +
    table("By month", sort(byKey(es, (e) => e.date.slice(0, 7)), true)) + "\n\n" +
    expense + "\n" + "total: " + money(total) + " in " + es.length + " entries";
}

export function ledger(args, io) {
  if (args.length !== 1) { io.printError("usage: ledger file.csv"); return 2; }
  try {
    let text;
    try { text = io.readFile(args[0]); } catch (e) { throw new Abort(e.message); }
    const es = entries(text.split("\n"));
    if (es.length === 0) throw new Abort(args[0] + " has no entries");
    io.print(report(es));
    return 0;
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    io.printError("ledger: " + e.why);
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
  process.exitCode = ledger(process.argv.slice(2), io);
}
