#!/usr/bin/env node
// routes, written by hand: the JavaScript the compiler should aim to
// produce for projectional/examples/routes. Same program, same output, same
// exit codes, same algorithms: Dijkstra's shortest paths (1959) with the
// frontier ordered by (distance, town), Kruskal's cheapest network (1956)
// over a union-find forest joined by size (Galler and Fischer, 1964). What
// differs is only what a compiler could decide on its own; each difference
// is marked with the gap it stands for in compiler/GAPS.md (round 5).
//
// The program's maps and sets are persistent; each one here is used by one
// owner at a time, so it is changed in place (R3), and keyed by the town's
// text in a JS Map (R2). Where the program walks a map in key order, the
// keys are sorted then.
//
// `io` is the world: readFile (which throws an Error when it can't), print
// and printError. A failure becomes the program's Abort.
//
// Run: node compiler/gaps/routes.ideal.js roads.txt

import { fileURLToPath } from "node:url";

class Abort { constructor(why) { this.why = why; } }

const wholeKm = /^-?(0|[1-9][0-9]*)$/;
const badLine = (n) => new Abort(`line ${n}: expected road <town> <town> <km>, trip <town> <town> or near <town> <km>`);
function kilometres(field, n) {
  if (!wholeKm.test(field) || field === "-0") throw new Abort(`line ${n}: ${field} isn't a whole number of km`);
  return Number(field);
}

// `lines` and `parse`: one pass, the words split once (as in round 3's G22
// and G23: a loop that appends, the lines an array).
function lines(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    const line = texts[i], n = i + 1;
    if (line === "" || line.startsWith("#")) continue;
    const w = line.split(" ").filter((x) => x !== "");
    if (w.length === 3 && w[0] === "trip") out.push({ kind: 1, from: w[1], to: w[2], at: n });
    else if (w.length === 3 && w[0] === "near") out.push({ kind: 2, from: w[1], within: kilometres(w[2], n), at: n });
    else if (w.length === 4 && w[0] === "road") out.push({ kind: 0, from: w[1], to: w[2], km: kilometres(w[3], n) });
    else throw badLine(n);
  }
  return out;
}

// `graph of` folds from the last line, consing each road onto the front of
// its town's list, so a town's roads end up in file order; within one line
// the road out of `to` is consed after the one out of `from`.
function graphOf(ls) {
  const g = new Map();
  const out = (t) => { let r = g.get(t); if (!r) g.set(t, (r = [])); return r; };
  for (const l of ls) if (l.kind === 0) { out(l.to).push(l.from, l.km); out(l.from).push(l.to, l.km); }
  return g;
}

// The frontier, an ordered set of (km, town) with the nearest first. R4:
// a binary heap. A town whose way gets shorter leaves its old pair behind,
// and a popped pair that isn't the town's best any more is skipped; the
// pairs that count come out in the same order as from the program's set.
const before = (a, ak, b, bk) => ak < bk || (ak === bk && a < b);
class Frontier {
  towns = []; kms = [];
  get size() { return this.towns.length; }
  push(town, km) {
    const t = this.towns, k = this.kms;
    let i = t.length;
    t.push(town); k.push(km);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(town, km, t[p], k[p])) break;
      t[i] = t[p]; k[i] = k[p]; i = p;
    }
    t[i] = town; k[i] = km;
  }
  // Takes the nearest out; its town is this.town, its km this.km.
  pop() {
    const t = this.towns, k = this.kms;
    this.town = t[0]; this.km = k[0];
    const lt = t.pop(), lk = k.pop(), n = t.length;
    if (n === 0) return;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && before(t[c + 1], k[c + 1], t[c], k[c])) c++;
      if (!before(t[c], k[c], lt, lk)) break;
      t[i] = t[c]; k[i] = k[c]; i = c;
    }
    t[i] = lt; k[i] = lk;
  }
}

// `shortest`: settle, relax and improve as one loop (R5: no Search record
// made per step). `found` is the Map Text Best, km and via side by side.
function shortest(graph, start) {
  const km = new Map([[start, 0]]), via = new Map([[start, start]]);
  const f = new Frontier();
  f.push(start, 0);
  while (f.size) {
    f.pop();
    const town = f.town, d = f.km;
    if (km.get(town) !== d) continue;
    const roads = graph.get(town) ?? [];
    // relax folds from the end of the town's roads.
    for (let j = roads.length - 2; j >= 0; j -= 2) {
      const to = roads[j], k = d + roads[j + 1], old = km.get(to);
      if (old === undefined || k < old) { km.set(to, k); via.set(to, town); f.push(to, k); }
    }
  }
  return { km, via };
}

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function tripLine(graph, from, to) {
  const { km, via } = shortest(graph, from);
  if (!km.has(to)) return `${from} → ${to}: no route`;
  const path = [];
  for (let t = to; ; t = via.get(t)) { path.push(t); if (t === from) break; }
  return path.reverse().join(" → ") + ": " + km.get(to) + " km";
}

function nearLine(graph, from, within) {
  const { km } = shortest(graph, from);
  const close = [];
  for (const [town, d] of km) if (town !== from && d <= within) close.push([d, town]);
  close.sort((a, b) => a[0] - b[0] || byName(a[1], b[1]));
  return `within ${within} km of ${from}: ` + (close.length ? close.map(([d, t]) => `${t} ${d}`).join(", ") : "nothing");
}

// Kruskal over the roads sorted by (km, from, to).
function cheapest(ls) {
  const spans = ls.filter((l) => l.kind === 0);
  spans.sort((a, b) => a.km - b.km || byName(a.from, b.from) || byName(a.to, b.to));
  const parent = new Map(), size = new Map();
  const root = (t) => { for (let up; (up = parent.get(t)) !== undefined && up !== t; t = up); return t; };
  const sizeOf = (r) => size.get(r) ?? 1;
  let total = 0, roads = 0;
  for (const s of spans) {
    const a = root(s.from), b = root(s.to);
    if (a === b) continue;
    total += s.km; roads++;
    const [big, small] = sizeOf(a) < sizeOf(b) ? [b, a] : [a, b];
    parent.set(small, big);
    size.set(big, sizeOf(big) + sizeOf(small));
  }
  return { km: total, roads, spans: spans.length };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function summary(graph, ls) {
  const towns = graph.size, net = cheapest(ls);
  const start = [...graph.keys()].reduce((a, b) => (b < a ? b : a));
  let far = "", farKm = 0;
  for (const [town, d] of shortest(graph, start).km) if (d > farKm || (d === farKm && (far === "" || town < far))) { far = town; farKm = d; }
  return `${plural(towns, "town")}, ${plural(net.spans, "road")}, ${plural(towns - net.roads, "part")}\n` +
    `cheapest network: ${net.km} km in ${plural(net.roads, "road")}\n` +
    `farthest from ${start}: ${far}, ${farKm} km`;
}

function report(path, ls, io) {
  if (ls.length === 0) throw new Abort(path + " has no roads");
  const graph = graphOf(ls);
  if (graph.size === 0) throw new Abort(path + " has no roads");
  io.print(summary(graph, ls));
  const check = (town, n) => { if (!graph.has(town)) throw new Abort(`line ${n}: no road goes to ${town}`); };
  for (const l of ls) {
    if (l.kind === 1) { check(l.from, l.at); check(l.to, l.at); io.print(tripLine(graph, l.from, l.to)); }
    else if (l.kind === 2) { check(l.from, l.at); io.print(nearLine(graph, l.from, l.within)); }
  }
}

export function routes(args, io) {
  if (args.length !== 1) { io.printError("usage: routes roads.txt"); return 2; }
  try {
    let text;
    try { text = io.readFile(args[0]); } catch (e) { throw new Abort(e.message); }
    report(args[0], lines(text.split("\n")), io);
    return 0;
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    io.printError("routes: " + e.why);
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
  process.exitCode = routes(process.argv.slice(2), io);
}
