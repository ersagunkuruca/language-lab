#!/usr/bin/env node
// rota, written by hand: the JavaScript the compiler should aim to produce
// for compiler/gaps/rota (GAPS.md round 14). The same program, with the
// same output, exit codes and search, in the same order:
// - every place of every shift of every day is filled by backtracking;
// - the place filled next is the one the fewest people can take (Golomb
//   and Baumert, "Backtrack programming", JACM 1965), and a branch stops
//   as soon as a place has nobody left (forward checking, Haralick and
//   Elliott, "Increasing tree search efficiency for constraint
//   satisfaction problems", Artificial Intelligence 14, 1980), or the
//   places left outnumber the shifts people may still work;
// - the people on a shift are taken in order of name, so each set of them
//   is tried once.
//
// The program's Choice (`one of`, `first`, `count`, `optional`) is a
// search here: a recursive function that calls `found` for each rota and
// returns true to stop. The rota as it is made is changed in place and
// changed back on the way out (a trail), as a constraint solver keeps it.
//
// `io` is the world: readFile (which throws an Error when it can't), print
// and printError. A failure becomes the program's Abort.
//
// Run: node compiler/gaps/rota.ideal.js plan.txt

import { fileURLToPath } from "node:url";

class Abort { constructor(why) { this.why = why; } }
const abort = (why) => { throw new Abort(why); };

// ---- Reading the plan ----
const wholeRe = /^-?(0|[1-9][0-9]*)$/;
const badLine = (n) => abort(`line ${n}: expected days, shift, person, off or rest`);
function whole(field, n, what) {
  if (!wholeRe.test(field) || field === "-0") abort(`line ${n}: ${what} ${field} isn't a whole number`);
  return Number(field);
}
const words = (line) => line.split(" ").filter((w) => w !== "");
function entryOf(ws, n) {
  const [w, ...rest] = ws;
  switch (w) {
    case "days":
      if (rest.length === 0) badLine(n);
      return { kind: "days", names: rest, line: n };
    case "shift": {
      if (rest.length !== 2) badLine(n);
      const need = whole(rest[1], n, "need");
      if (need < 1) abort(`line ${n}: a shift needs at least one person`);
      return { kind: "shift", it: { name: rest[0], need, line: n } };
    }
    case "person": {
      if (rest.length < 2) badLine(n);
      const can = rest.slice(2);
      if (can.length === 0) badLine(n);
      return { kind: "person", it: { name: rest[0], most: whole(rest[1], n, "most"), can, line: n } };
    }
    case "off":
      if (rest.length < 2) badLine(n);
      return { kind: "off", who: rest[0], days: rest.slice(1), line: n };
    case "rest":
      if (rest.length !== 2) badLine(n);
      return { kind: "rest", after: rest[0], before: rest[1], line: n };
    default:
      return badLine(n);
  }
}
function entries(text) {
  const out = [], lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ws = words(lines[i]);
    if (ws.length === 0 || lines[i].startsWith("#")) continue;
    out.push(entryOf(ws, i + 1));
  }
  return out;
}

function problemOf(text) {
  const es = entries(text);
  const dayLines = es.filter((e) => e.kind === "days");
  if (dayLines.length === 0) abort("the plan has no days line");
  if (dayLines.length > 1) abort(`line ${dayLines[1].line}: the days are given again`);
  const days = dayLines[0].names;
  const shifts = es.filter((e) => e.kind === "shift").map((e) => e.it);
  const people = es.filter((e) => e.kind === "person").map((e) => e.it);
  const isShift = (name) => shifts.some((s) => s.name === name);
  for (const e of es) {
    if (e.kind === "days") {
      const seen = [];
      for (const d of e.names) { if (seen.includes(d)) abort(`line ${e.line}: ${d} is a day twice`); seen.push(d); }
    } else if (e.kind === "shift") {
      const f = shifts.find((s) => s.name === e.it.name);
      if (f.line !== e.it.line) abort(`line ${e.it.line}: ${e.it.name} is a shift again (first on line ${f.line})`);
    } else if (e.kind === "person") {
      const q = e.it, f = people.find((o) => o.name === q.name);
      if (f.line !== q.line) abort(`line ${q.line}: ${q.name} is a person again (first on line ${f.line})`);
      for (const c of q.can) if (!isShift(c)) abort(`line ${q.line}: ${q.name} can work ${c}, which isn't a shift`);
    } else if (e.kind === "off") {
      if (!people.some((q) => q.name === e.who)) abort(`line ${e.line}: ${e.who} isn't a person`);
      for (const d of e.days) if (!days.includes(d)) abort(`line ${e.line}: ${d} isn't a day`);
    } else {
      if (!isShift(e.after)) abort(`line ${e.line}: ${e.after} isn't a shift`);
      if (!isShift(e.before)) abort(`line ${e.line}: ${e.before} isn't a shift`);
    }
  }
  if (shifts.length === 0) abort("the plan has no shifts");
  if (people.length === 0) abort("the plan has no people");
  const off = new Set();
  for (const e of es) if (e.kind === "off") for (const d of e.days) off.add(e.who + "\u0000" + days.indexOf(d));
  const rests = es.filter((e) => e.kind === "rest").map((e) => [e.after, e.before]);
  return { days, shifts, people, off, rests };
}

// ---- The search ----
// Places as numbers: seat i is (day, shift index, place). People and
// shifts by index; the rota as arrays changed in place and undone.
function seatsOf(p, onlyDay) {
  const out = [];
  for (let d = 0; d < p.days.length; d++) {
    if (onlyDay !== undefined && d !== onlyDay) continue;
    p.shifts.forEach((s, si) => { for (let k = 0; k < s.need; k++) out.push({ day: d, shift: si }); });
  }
  return out;
}
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function solver(p) {
  const D = p.days.length, S = p.shifts.length, P = p.people.length;
  const shiftIndex = new Map(p.shifts.map((s, i) => [s.name, i]));
  const can = p.people.map((q) => { const c = new Uint8Array(S); for (const n of q.can) c[shiftIndex.get(n)] = 1; return c; });
  const offDay = p.people.map((q) => { const o = new Uint8Array(D); for (let d = 0; d < D; d++) o[d] = p.off.has(q.name + "\u0000" + d) ? 1 : 0; return o; });
  const rests = p.rests.map(([a, b]) => [shiftIndex.get(a), shiftIndex.get(b)]);
  const order = p.people.map((_, i) => i);
  const load = new Int32Array(P);
  const works = new Int32Array(P * D).fill(-1);
  const on = Array.from({ length: D * S }, () => []);
  const nameOf = (i) => p.people[i].name;

  function canWork(cap, q, s) {
    if (!can[q][s.shift] || offDay[q][s.day] || works[q * D + s.day] !== -1) return false;
    if (load[q] >= Math.min(p.people[q].most, cap)) return false;
    const slot = on[s.day * S + s.shift];
    if (slot.length && !(nameOf(slot[slot.length - 1]) < nameOf(q))) return false;
    for (const [a, b] of rests) {
      if (s.shift === b && s.day > 0 && works[q * D + s.day - 1] === a) return false;
      if (s.shift === a && s.day + 1 < D && works[q * D + s.day + 1] === b) return false;
    }
    return true;
  }
  function candidates(cap, s) {
    const out = [];
    for (const q of order) if (canWork(cap, q, s)) out.push(q);
    out.sort((a, b) => load[a] - load[b] || byName(nameOf(a), nameOf(b)));
    return out;
  }
  // Calls found() for each rota, in the program's order, until it returns true.
  function fill(cap, seats, found) {
    if (seats.length === 0) return found();
    let room = 0;
    for (let q = 0; q < P; q++) room += Math.min(p.people[q].most, cap) - load[q];
    if (seats.length > room) return false;
    let best = -1, bestCands = null;
    for (let i = 0; i < seats.length; i++) {
      const c = candidates(cap, seats[i]);
      if (c.length === 0) return false;
      if (best < 0 || c.length < bestCands.length) { best = i; bestCands = c; }
    }
    const s = seats[best];
    const rest = seats.slice(0, best).concat(seats.slice(best + 1));
    const slot = on[s.day * S + s.shift];
    for (const q of bestCands) {
      slot.push(q); load[q]++; works[q * D + s.day] = s.shift;
      const stop = fill(cap, rest, found);
      slot.pop(); load[q]--; works[q * D + s.day] = -1;
      if (stop) return true;
    }
    return false;
  }
  const snapshot = () => ({ on: on.map((x) => x.map(nameOf)), load: Array.from(load) });
  return {
    first(cap, seats) { let r = null; fill(cap, seats, () => { r = snapshot(); return true; }); return r; },
    count(cap, seats) { let n = 0; fill(cap, seats, () => { n++; return false; }); return n; },
  };
}

// ---- The report ----
function report(p, io) {
  const D = p.days.length, seats = seatsOf(p);
  io.print(`${D} days, ${p.shifts.length} shifts, ${p.people.length} people, ${seats.length} places to fill`);
  let cap = Math.max(1, Math.floor((seats.length + p.people.length - 1) / p.people.length)), r = null;
  for (;; cap++) {
    r = solver(p).first(cap, seats);
    if (r || cap >= D) break;
  }
  if (!r) abort("no rota can be made from this plan");
  io.print(`fairest: nobody works more than ${cap} shifts`);
  const S = p.shifts.length;
  const namesOn = (d, si) => r.on[d * S + si].join(",");
  const dayWidth = Math.max(0, ...p.days.map((d) => d.length));
  const widths = p.shifts.map((s, si) => Math.max(s.name.length, ...p.days.map((_, d) => namesOn(d, si).length)));
  io.print("".padEnd(dayWidth) + "  " + p.shifts.map((s, si) => s.name.padEnd(widths[si])).join("  "));
  for (let d = 0; d < D; d++) io.print(p.days[d].padEnd(dayWidth) + "  " + p.shifts.map((_, si) => namesOn(d, si).padEnd(widths[si])).join("  "));
  io.print("shifts: " + p.people.map((q, i) => `${q.name} ${r.load[i]}/${q.most}`).join(", "));
  io.print(`ways to staff ${p.days[0]}: ${solver(p).count(D, seatsOf(p, 0))}`);
  const needed = p.people.filter((q) => !solver({ ...p, people: p.people.filter((o) => o.name !== q.name) }).first(D, seats)).map((q) => q.name);
  const listed = (ns) => (ns.length ? ns.join(", ") : "nobody");
  io.print("needed: " + listed(needed));
  io.print("spare: " + listed(p.people.map((q) => q.name).filter((n) => !needed.includes(n))));
  io.print("credits: fewest options first after Golomb and Baumert (1965), forward checking after Haralick and Elliott (1980)");
}

export function rota(args, io) {
  if (args.length !== 1) { io.printError("usage: rota plan.txt"); return 2; }
  try {
    let text;
    try { text = io.readFile(args[0]); } catch (e) { throw new Abort(e.message); }
    report(problemOf(text), io);
    return 0;
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    io.printError("rota: " + e.why);
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
  process.exitCode = rota(process.argv.slice(2), io);
}
