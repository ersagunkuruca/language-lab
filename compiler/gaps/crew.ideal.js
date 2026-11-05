#!/usr/bin/env node
// crew, written by hand: the JavaScript the compiler should aim to produce
// for compiler/gaps/crew (GAPS.md round 11). It is the same program, with
// the same output, exit codes and algorithms:
// - Kahn's sort (1962), the free tasks taken first by name;
// - the critical path method's forward and backward passes (Kelley and
//   Walker, 1959);
// - a crew of workers run in simulated minutes, with the ready tasks
//   handed out by rank (longest tail first, after Hu 1961 and Graham 1966,
//   or by line).
//
// Each worker is a fiber here too: a JS generator that yields what it
// does (ask for a job, spend minutes, finish a task), resumed by a
// scheduler with the answer. That is how a good compiler would write an
// effect whose operations are answered later. The program's maps and
// sets are JS Maps and binary heaps changed in place, since every one has
// one owner. Where the program walks a map in key order, the keys are
// sorted then. What differs from the compiled code is marked with the gap
// it stands for in GAPS.md, round 11.
//
// `io` is the world: readFile (which throws an Error when it can't), print
// and printError. A failure becomes the program's Abort.
//
// Run: node compiler/gaps/crew.ideal.js plan.txt

import { fileURLToPath } from "node:url";

class Abort { constructor(why) { this.why = why; } }

// A binary heap of items compared by `before`.
class Heap {
  constructor(before) { this.a = []; this.before = before; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  push(x) {
    const a = this.a; let i = a.length; a.push(x);
    while (i > 0) { const p = (i - 1) >> 1; if (!this.before(x, a[p])) break; a[i] = a[p]; i = p; }
    a[i] = x;
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop(), n = a.length;
    if (n === 0) return top;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && this.before(a[c + 1], a[c])) c++;
      if (!this.before(a[c], last)) break;
      a[i] = a[c]; i = c;
    }
    a[i] = last;
    return top;
  }
}
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---- Reading the plan ----
const whole = /^-?(0|[1-9][0-9]*)$/;
const badLine = (n) => new Abort(`line ${n}: expected <task> <minutes> [after <task>…] or workers <n>`);
function number(field, n, what) {
  if (!whole.test(field) || field === "-0") throw new Abort(`line ${n}: ${what} ${field} isn't a whole number`);
  return Number(field);
}
function items(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], n = i + 1;
    if (line === "" || line.startsWith("#")) continue;
    const w = line.split(" ").filter((x) => x !== "");
    if (w.length === 0) throw badLine(n);
    if (w[0] === "workers") {
      if (w.length !== 2) throw badLine(n);
      out.push({ crew: number(w[1], n, "workers"), line: n });
    } else {
      if (w.length < 2) throw badLine(n);
      const minutes = number(w[1], n, "minutes");
      let needs = [];
      if (w.length > 2) { if (w[2] !== "after" || w.length === 3) throw badLine(n); needs = w.slice(3); }
      out.push({ name: w[0], minutes, needs, line: n });
    }
  }
  return out;
}

// The program folds from the end: a name used again is found at its
// second-last line, naming the last; a crew under 1 at the last such line,
// and the crew is the first `workers` line's.
function tasksOf(its) {
  const seen = new Map();
  for (let i = its.length - 1; i >= 0; i--) {
    const t = its[i];
    if (t.crew !== undefined) continue;
    if (seen.has(t.name)) throw new Abort(`line ${t.line}: ${t.name} is a task again on line ${seen.get(t.name).line}`);
    seen.set(t.name, t);
  }
  return seen;
}
function crewOf(its) {
  let size = 2;
  for (let i = its.length - 1; i >= 0; i--) {
    const t = its[i];
    if (t.crew === undefined) continue;
    if (t.crew < 1) throw new Abort(`line ${t.line}: a crew needs at least one worker`);
    size = t.crew;
  }
  return size;
}

function planOf(text) {
  const its = items(text.split("\n"));
  const tasks = tasksOf(its);
  if (tasks.size === 0) throw new Abort("the plan has no tasks");
  const names = [...tasks.keys()].sort(byName);
  for (const name of names) {
    const t = tasks.get(name);
    for (const need of t.needs) if (!tasks.has(need)) throw new Abort(`line ${t.line}: ${t.name} waits for ${need}, which isn't a task`);
  }
  // users: the tasks that wait for each, by name, once per need.
  const users = new Map();
  for (const name of names) for (const need of tasks.get(name).needs) {
    let us = users.get(need);
    if (!us) users.set(need, (us = []));
    us.push(name);
  }
  // Kahn's sort, the free tasks first by name.
  const waiting = new Map();
  const free = new Heap((a, b) => a < b);
  for (const name of names) { const n = tasks.get(name).needs.length; waiting.set(name, n); if (n === 0) free.push(name); }
  const order = [];
  while (free.size) {
    const t = free.pop();
    order.push(t);
    for (const u of users.get(t) ?? []) { const now = waiting.get(u) - 1; waiting.set(u, now); if (now === 0) free.push(u); }
  }
  if (order.length < tasks.size) throw new Abort("these tasks wait for each other: " + names.filter((n) => waiting.get(n) > 0).join(", "));
  // The forward and backward passes.
  const start = new Map(), tail = new Map();
  for (const name of order) {
    let latest = 0;
    for (const need of tasks.get(name).needs) latest = Math.max(latest, start.get(need) + tasks.get(need).minutes);
    start.set(name, latest);
  }
  let length = 0;
  for (let i = order.length - 1; i >= 0; i--) {
    const name = order[i];
    let longest = 0;
    for (const u of users.get(name) ?? []) longest = Math.max(longest, tail.get(u));
    tail.set(name, tasks.get(name).minutes + longest);
  }
  for (const name of order) length = Math.max(length, tail.get(name));
  return { tasks, names, users, order, start, tail, length, workers: crewOf(its) };
}

// The first of some tasks with the longest tail.
function longestOf(p, list) {
  let best = "";
  for (const name of list) if (best === "" || p.tail.get(name) > p.tail.get(best)) best = name;
  return best;
}
function criticalPath(p) {
  const out = [];
  for (let t = longestOf(p, p.order.filter((t) => p.start.get(t) === 0)); t !== ""; ) {
    out.push(t);
    const rest = p.tail.get(t) - p.tasks.get(t).minutes;
    t = longestOf(p, (p.users.get(t) ?? []).filter((u) => p.tail.get(u) === rest));
  }
  return out;
}
const slack = (p, t) => p.length - p.tail.get(t) - p.start.get(t);

// ---- The crew ----
// A worker, as a generator of what it does.
function* worker(id) {
  for (;;) {
    const job = yield { op: 0, id };
    if (job === null) return;
    yield { op: 1, minutes: job.minutes };
    yield { op: 2, task: job.name };
  }
}

function simulate(p, workers, criticalFirst) {
  const rank = new Map();
  for (const name of p.names) rank.set(name, criticalFirst ? -p.tail.get(name) : p.tasks.get(name).line);
  const ready = new Heap((a, b) => a.rank < b.rank || (a.rank === b.rank && a.name < b.name));
  const waiting = new Map();
  for (const name of p.names) waiting.set(name, p.tasks.get(name).needs.length);
  for (const name of p.order) if (waiting.get(name) === 0) ready.push({ rank: rank.get(name), name });
  const timers = new Heap((a, b) => a.at < b.at || (a.at === b.at && a.id < b.id));
  const fibers = [], idle = [], busy = new Map(), log = [];
  let clock = 0, left = p.tasks.size;
  const note = (line) => log.push(String(clock).padStart(5) + "  " + line);

  // A worker resumed with an answer, and what it does next answered, until
  // it parks: spending (a timer), idle (no job yet), or ended.
  // An idle worker is resumed still asking: its question is answered anew.
  function resume(id, answer, asking = false) {
    for (;;) {
      let step = { op: 0 };
      if (!asking) { const r = fibers[id].next(answer); if (r.done) return; step = r.value; }
      asking = false;
      if (step.op === 1) {
        timers.push({ at: clock + step.minutes, id });
        busy.set(id, (busy.get(id) ?? 0) + step.minutes);
        return;
      }
      if (step.op === 2) {
        left--;
        note(`w${id} finishes ${step.task}`);
        const us = p.users.get(step.task) ?? [];
        for (let i = us.length - 1; i >= 0; i--) {
          const u = us[i], now = waiting.get(u) - 1;
          waiting.set(u, now);
          if (now === 0) ready.push({ rank: rank.get(u), name: u });
        }
        answer = undefined;
        continue;
      }
      // Asking for a job.
      if (ready.size) {
        const best = ready.pop();
        note(`w${id} starts ${best.name}`);
        answer = { name: best.name, minutes: p.tasks.get(best.name).minutes };
      } else if (left === 0) answer = null;
      else { idle.push(id); idle.sort((a, b) => a - b); return; }
    }
  }
  for (let id = 1; id <= workers; id++) { fibers[id] = worker(id); resume(id, undefined); }
  for (;;) {
    while (idle.length && (left === 0 || ready.size)) resume(idle.shift(), undefined, true);
    if (!timers.size) break;
    const next = timers.pop();
    clock = next.at;
    resume(next.id, undefined);
  }
  return { length: clock, busy, log };
}

// ---- The report ----
const percent = (part, whole) => (whole === 0 ? 0 : Math.floor((part * 100) / whole));
function lowerBound(p, work, w) { return Math.max(p.length, Math.floor((work + w - 1) / w)); }
const row = (title, ns) => title.padEnd(16) + ns.map((n) => String(n).padStart(6)).join("");

function report(p, io) {
  const run = simulate(p, p.workers, true);
  let work = 0, links = 0;
  for (const t of p.tasks.values()) { work += t.minutes; links += t.needs.length; }
  io.print(`${p.tasks.size} tasks, ${links} links, ${work} minutes of work`);
  io.print(`critical path: ${criticalPath(p).join(" → ")} (${p.length} minutes)`);
  const loose = p.names.filter((t) => slack(p, t) > 0);
  io.print("slack: " + (loose.length ? loose.map((t) => `${t} ${slack(p, t)}`).join(", ") : "none"));
  io.print(`with ${p.workers} workers, critical first: done at ${run.length} minutes`);
  for (const line of run.log) io.print(line);
  for (let id = 1; id <= p.workers; id++) {
    const b = run.busy.get(id) ?? 0;
    io.print(`  w${id} busy ${b} of ${run.length} minutes (${percent(b, run.length)}%)`);
  }
  const sizes = Array.from({ length: p.workers + 2 }, (_, i) => i + 1);
  const lines = [row("workers", sizes)];
  lines.push(row("critical first", sizes.map((w) => simulate(p, w, true).length)));
  lines.push(row("in file order", sizes.map((w) => simulate(p, w, false).length)));
  lines.push(row("lower bound", sizes.map((w) => lowerBound(p, work, w))));
  for (const line of lines) io.print(line);
}

export function crew(args, io) {
  if (args.length !== 1) { io.printError("usage: crew plan.txt"); return 2; }
  try {
    let text;
    try { text = io.readFile(args[0]); } catch (e) { throw new Abort(e.message); }
    report(planOf(text), io);
    return 0;
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    io.printError("crew: " + e.why);
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
  process.exitCode = crew(process.argv.slice(2), io);
}
