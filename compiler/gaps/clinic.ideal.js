// clinic by hand: the same walk-in clinic as compiler/gaps/clinic (round
// 10), written as a JavaScript programmer would, with the same random
// numbers (the language's own seeded generator) so the two print the same
// report. The waiting room and the events are binary heaps in arrays, the
// desks an array changed in place, the last events a ring of 8.
import { seededGenerator } from "../../ters/src/lang/random.ts";
import { $show } from "../src/runtime.js";

const share = (a, b) => { const r = a / b; return Number.isFinite(r) ? r : 0; };
const intOf = (x) => Math.floor(x);
const showDecimals = (x, places) => {
  const scale = 10 ** places, m = Math.floor(Math.abs(x) * scale + 0.5), w = Math.floor(m / scale);
  const text = places < 0.5 ? $show(w) : $show(w) + "." + String(m - w * scale).padStart(places, "0");
  return x < 0 && 0 < m ? "-" + text : text;
};
const one = (x) => showDecimals(x, 1);
const pct = (x) => showDecimals(x, 0) + "%";
const two = (n) => String(n).padStart(2, "0");
const clock = (m) => { const t = intOf(m); return two(8 + Math.trunc(t / 60)) + ":" + two(t % 60); };
const URG = ["urgent", "soon", "routine"]; // rank 0, 1, 2
const FACTOR = { routine: 1.0, soon: 1.5, urgent: 4.0 };

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = [k[0], v[0]], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = lk; v[i] = lv; }
    return top;
  }
  remove(pred) { const keep = []; for (let i = 0; i < this.k.length; i++) if (!pred(this.v[i])) keep.push([this.k[i], this.v[i]]); this.k = []; this.v = []; for (const [a, b] of keep) this.push(a, b); }
  find(pred) { return this.v.find(pred); }
}

export function day(cfg) {
  const g = seededGenerator(cfg.seed), random = () => g.next();
  const exponential = (mean) => { const u = 1 - random(); return 0 - mean * (u > 0 ? Math.log(u) : 0); };
  const close = cfg.hours * 60;
  const events = new Heap(), waiting = new Heap();
  const desks = Array.from({ length: cfg.desks }, (_, i) => ({ id: i, serving: null, since: 0, served: 0, busy: 0, onBreak: false }));
  const visits = [], recent = [];
  let now = 0, nextId = 1, area = 0;
  const note = (line) => { recent.push(clock(now) + " " + line); if (recent.length > 8) recent.shift(); };
  events.push(close, { kind: "closing" });
  events.push(exponential(share(60, cfg.rate)), { kind: "arrival" });
  if (cfg.breaks) for (let i = 0; i < cfg.desks; i++) events.push(120 + 25 * i, { kind: "break starts", desk: i });
  const assign = () => {
    for (;;) {
      const free = desks.filter((d) => !d.onBreak && d.serving === null);
      if (!free.length || !waiting.size) return;
      const [, p] = waiting.pop();
      let d;
      if (cfg.pick === "first free") d = free[0];
      else if (cfg.pick === "least busy") { d = free[0]; for (const x of free) if (x.busy < d.busy) d = x; }
      else d = free[intOf(random() * free.length)] ?? desks[0];
      d.serving = p; d.since = now;
      events.push(now + p.needs, { kind: "finished", desk: d.id });
      visits.push({ seen: true, p, waited: now - p.arrived, desk: d.id });
      note(`desk ${d.id} takes #${p.id} (${p.urgency})`);
    }
  };
  while (events.size) {
    const [t, e] = events.pop();
    area += waiting.size * (t - now); now = t;
    switch (e.kind) {
      case "arrival": {
        const u = random(), urgency = u < cfg.urgent ? "urgent" : u < cfg.urgent + cfg.soon ? "soon" : "routine";
        const patience = exponential(cfg.patience) * FACTOR[urgency];
        const p = { id: nextId++, arrived: now, urgency, patience, needs: Math.max(2, exponential(cfg.minutes)) };
        waiting.push(cfg.order === "arrival order" ? p.arrived : URG.indexOf(urgency) * 100000 + p.arrived, p);
        events.push(now + p.patience, { kind: "gave up", patient: p.id });
        const gap = exponential(share(60, cfg.rate));
        if (now + gap < close) events.push(now + gap, { kind: "arrival" });
        note(`#${p.id} arrives (${urgency})`);
        assign(); break;
      }
      case "finished": {
        const d = desks[e.desk];
        if (d.serving) { const p = d.serving; d.served++; d.busy += now - d.since; d.serving = null; note(`desk ${d.id} done with #${p.id}`); assign(); }
        break;
      }
      case "gave up": {
        const p = waiting.find((q) => q.id === e.patient);
        if (p) { waiting.remove((q) => q.id === p.id); visits.push({ seen: false, p, waited: now - p.arrived }); note(`#${p.id} gives up`); }
        break;
      }
      case "break starts": desks[e.desk].onBreak = true; events.push(now + 30, { kind: "break ends", desk: e.desk }); note(`desk ${e.desk} on break`); break;
      case "break ends": desks[e.desk].onBreak = false; note(`desk ${e.desk} back`); assign(); break;
      case "closing": note("doors close"); break;
    }
  }
  return { cfg, now, area, desks, visits, recent };
}

function stats(xs) {
  let n = 0, mean = 0, m2 = 0, low = 0, high = 0;
  for (const x of xs) { const m = mean + share(x - mean, n + 1); m2 = m2 + (x - mean) * (x - m); low = n === 0 ? x : Math.min(low, x); high = n === 0 ? x : Math.max(high, x); mean = m; n++; }
  return { n, mean, m2, low, high };
}
const spread = (s) => Math.sqrt(s.n < 2 ? 0 : share(s.m2, s.n - 1));
const statsLine = (s) => s.n === 0 ? "none" : `mean ${one(s.mean)} ± ${one(spread(s))} (${one(s.low)} to ${one(s.high)}, ${s.n})`;
const waitsOf = (vs) => vs.filter((v) => v.seen).map((v) => v.waited);
const percentile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[intOf(q * (s.length - 1))] ?? 0; };
const walked = (vs) => vs.filter((v) => !v.seen).length;
const right = (s, n) => String(s).padStart(n, " "), left = (s, n) => String(s).padEnd(n, " ");

function report(c) {
  const vs = c.visits, ws = waitsOf(vs), cfg = c.cfg, out = [];
  out.push(`${cfg.desks} desks, ${cfg.order}, ${cfg.pick}, seed ${$show(cfg.seed)}`);
  out.push(`Patients ${vs.length}, seen ${vs.length - walked(vs)}, walked out ${walked(vs)} (${pct(share(100 * walked(vs), vs.length))})`);
  out.push("Wait " + statsLine(stats(ws)));
  out.push(`Median ${one(percentile(ws, 0.5))}, 90th percentile ${one(percentile(ws, 0.9))}`);
  out.push(`Average waiting room ${one(share(c.area, c.now))} people, last event at ${clock(c.now)}`);
  out.push("", "Waits (minutes)");
  const counts = new Array(12).fill(0); for (const w of ws) counts[Math.min(intOf(share(w, 5)), 11)]++;
  const top = Math.max(0, ...counts);
  counts.forEach((n, b) => out.push((b === 11 ? "55+    " : right(b * 5, 2) + "–" + left(b * 5 + 5, 4)) + " " + right(n, 4) + " " + "#".repeat(top === 0 ? 0 : Math.trunc(n * 40 / top))));
  out.push("", "urgency  people  walked    wait");
  for (const u of URG) { const us = vs.filter((v) => v.p.urgency === u); out.push(left(u, 9) + right(us.length, 6) + right(walked(us), 8) + right(one(stats(waitsOf(us)).mean), 8)); }
  out.push("", "desk     seen    busy");
  for (const d of c.desks) out.push(left("desk " + d.id, 9) + right(d.served, 6) + right(pct(share(100 * d.busy, c.now)), 8));
  out.push("", "Last events", ...c.recent);
  return out;
}

function hourly(c) {
  const out = [];
  for (let hr = 0; hr < intOf(c.cfg.hours); hr++) {
    const ws = c.visits.filter((v) => intOf(share(v.p.arrived, 60)) === hr);
    out.push(clock(hr * 60) + right(ws.length, 6) + right(one(stats(waitsOf(ws)).mean), 8) + " " + "#".repeat(ws.length));
  }
  return out;
}

export const defaultConfig = { desks: 4, hours: 8, rate: 18, minutes: 12, patience: 25, urgent: 0.1, soon: 0.3, order: "urgency first", pick: "least busy", breaks: true, seed: 7 };

export function clinic(cfg = defaultConfig) {
  const c = day(cfg), out = [...report(c), "", "hour  people    wait", ...hourly(c), "", "Every way, the same seed", "order          pick           seen  walked    wait     p90"];
  for (const order of ["arrival order", "urgency first"]) for (const pick of ["first free", "least busy", "random free"]) {
    const vs = day({ ...cfg, order, pick }).visits, ws = waitsOf(vs);
    out.push(left(order, 15) + left(pick, 13) + right(vs.length - walked(vs), 6) + right(walked(vs), 8) + right(one(stats(ws).mean), 8) + right(one(percentile(ws, 0.9)), 8));
  }
  out.push("", "desks walked    wait     p90");
  for (let n = 2; n < 8; n++) { const vs = day({ ...cfg, desks: n }).visits, ws = waitsOf(vs); out.push(right(n, 5) + right(walked(vs), 8) + right(one(stats(ws).mean), 8) + right(one(percentile(ws, 0.9)), 8)); }
  const means = []; for (let k = 0; k < 10; k++) means.push(stats(waitsOf(day({ ...cfg, seed: cfg.seed + k }).visits)).mean);
  let n = 1; for (;; n++) { const vs = day({ ...cfg, desks: n }).visits; if (n > 12 || (percentile(waitsOf(vs), 0.9) < 15 && walked(vs) === 0)) break; }
  out.push("", "Over 10 days, the mean wait: " + statsLine(stats([...means].reverse())), "Desks for a 90th percentile under 15 minutes with nobody walking out: " + n);
  return out;
}
