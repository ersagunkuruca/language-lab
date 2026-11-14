// depot (GAPS.md round 17) by hand: what a person would write in plain
// JavaScript. The stations' state in arrays indexed by station, the
// events in a binary heap ordered by time and then by when they were
// planned, the counts in plain variables, and the same report. Every
// floating-point step is the Ters program's, in its order: the random
// numbers, the gaps, the distances and the times, so the two print the
// same.

class Refused extends Error {}
const refuse = (why) => { throw new Refused(why); };

// Ters's `read number`: a decimal, with an optional sign, fraction and exponent.
const readNumber = (f) => (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(f) ? Number(f) : null);
const readWhole = (f) => (/^[+-]?\d+$/.test(f) ? Number(f) : null);
const numberAt = (f, n) => { const x = readNumber(f); if (x === null) refuse(`line ${n}: ${f} isn't a number`); return x; };
const wholeAt = (f, n) => { const x = readWhole(f); if (x === null) refuse(`line ${n}: ${f} isn't a whole number`); return x; };

// The city file: stations, demands and at most one profile.
function cityOf(text) {
  const stations = [], demands = [], profiles = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], n = i + 1;
    const ws = line.split(" ").filter((w) => w !== "");
    if (ws.length === 0 || line.startsWith("#")) continue;
    const f = (k) => ws[k] ?? "";
    if (ws[0] === "station") {
      if (ws.length !== 6) refuse(`line ${n}: a station is \`station name docks bikes x y\`, x and y in km`);
      const docks = wholeAt(f(2), n), bikes = wholeAt(f(3), n), x = numberAt(f(4), n) * 1000.0, y = numberAt(f(5), n) * 1000.0;
      stations.push({ name: f(1), docks, bikes, x, y });
    } else if (ws[0] === "demand") {
      if (ws.length !== 4) refuse(`line ${n}: a demand is \`demand from to riders-an-hour\``);
      demands.push({ from: f(1), to: f(2), rate: numberAt(f(3), n) });
    } else if (ws[0] === "profile") {
      if (ws.length !== 25) refuse(`line ${n}: a profile is \`profile\` and 24 numbers, one for each hour`);
      profiles.push(ws.slice(1).map((w) => numberAt(w, n)));
    } else refuse(`line ${n}: ${ws[0]} isn't station, demand or profile`);
  }
  const names = new Map();
  stations.forEach((s, i) => names.set(s.name, i));
  const index = (name) => { if (!names.has(name)) refuse(`no station is called ${name}`); return names.get(name); };
  // Each station's routes, the latest demand first, as the program conses them.
  const routes = stations.map(() => []);
  for (const d of demands) { const from = index(d.from); routes[from].unshift({ to: index(d.to), rate: d.rate }); }
  const profile = profiles.length ? profiles[0] : Array.from({ length: 24 }, () => 1.0);
  const peak = profile.length ? Math.max(...profile) : 0.0;
  let bikes = 0, docks = 0;
  for (let i = stations.length - 1; i >= 0; i--) { bikes = stations[i].bikes + bikes; docks = stations[i].docks + docks; }
  if (stations.length < 2) refuse("a city needs two stations or more");
  if (names.size < stations.length) refuse("two stations have one name");
  if (stations.some((s) => s.docks < 1 || s.bikes < 0 || s.bikes > s.docks)) refuse("a station has no docks, or more bikes than docks");
  if (bikes > docks) refuse("there are more bikes than docks");
  if (demands.some((d) => d.from === d.to || d.rate <= 0.0)) refuse("a demand goes nowhere, or has no riders");
  if (profiles.length > 1) refuse("the file gives two profiles");
  if (profile.some((x) => x < 0.0 || x > 1.0)) refuse("a profile's shares are from 0 to 1");
  return { stations, routes, profile, peak };
}

// The events: [time, order planned, kind, a, b, c, d], soonest at the top.
class Heap {
  constructor() { this.a = []; this.n = 0; }
  push(e) {
    const a = this.a; a.push(e);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
  }
  top() { return this.a[0]; }
  pop() {
    const a = this.a, last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
  }
}
const less = (x, y) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
const WANTS = 0, ARRIVES = 1, TRUCK = 2, SNAPSHOT = 3;

function simulate(city, hours, seed0) {
  const { stations, routes, profile, peak } = city, n = stations.length;
  const docks = stations.map((s) => s.docks);
  const bikes = stations.map((s) => s.bikes), since = new Float64Array(n), empty = new Float64Array(n), full = new Float64Array(n);
  const rentals = new Int32Array(n), returns = new Int32Array(n), missed = new Int32Array(n), turned = new Int32Array(n);
  const events = new Heap();
  let planned = 0, now = 0.0, seed = seed0;
  let rides = 0, riding = 0.0, longest = 0.0, moved = 0, redirected = 0, walked = 0, fares = 0;
  const rideTimes = new Map(), misses = new Map(), snapshots = [];
  const plan = (at, kind, a = 0, b = 0, c = 0, d = 0) => events.push([at, planned++, kind, a, b, c, d]);
  const uniform = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const settle = (i) => {
    const e = now - since[i];
    if (bikes[i] === 0) empty[i] = empty[i] + e;
    if (bikes[i] === docks[i]) full[i] = full[i] + e;
    since[i] = now;
  };
  const distance = (i, j) => {
    const a = stations[i] ?? NOWHERE, b = stations[j] ?? NOWHERE, dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const rideTime = (i, j) => distance(i, j) / 4.0 + 60.0;
  const closest = (from, ok, within) => {
    let best = -1;
    for (let j = 0; j < n; j++) {
      const d = distance(from, j);
      if (j !== from && d < within && ok(j)) { best = j; within = d; }
    }
    return best;
  };
  const totalRate = (rs) => { let t = 0.0; for (let k = rs.length - 1; k >= 0; k--) t = rs[k].rate + t; return t; };
  const nextWanted = (i) => {
    const rate = totalRate(routes[i]) * peak;
    if (rate > 0.0) { const u = uniform(); plan(now + (-Math.log(1.0 - u) * 3600.0) / rate, WANTS, i, 0); }
  };
  const hourOf = (t) => Math.floor(t / 3600.0);
  const missedAt = (i) => { const h = hourOf(now); misses.set(h, (misses.get(h) ?? 0) + 1); settle(i); missed[i]++; };
  const rent = (i) => {
    const rs = routes[i], u = uniform();
    let x = u * totalRate(rs), to = -1;
    for (let k = 0; k < rs.length; k++) { if (x < rs[k].rate || k === rs.length - 1) { to = rs[k].to; break; } x = x - rs[k].rate; }
    settle(i); bikes[i]--; rentals[i]++;
    plan(now + rideTime(i, to), ARRIVES, i, to, now, 0);
  };
  const riderAt = (i, tries) => {
    if (bikes[i] > 0) rent(i);
    else if (tries === 0) {
      const j = closest(i, (k) => bikes[k] > 0, 900.0);
      if (j < 0) missedAt(i);
      else { walked++; plan(now + distance(i, j) / 1.4, WANTS, j, 1); }
    } else missedAt(i);
  };
  const arrived = (from, to, started, redirects) => {
    if (bikes[to] < docks[to]) {
      settle(to); bikes[to]++; returns[to]++;
      const d = now - started;
      rides++; riding = riding + d; longest = Math.max(longest, d);
      const b = Math.floor(d / 300.0); rideTimes.set(b, (rideTimes.get(b) ?? 0) + 1);
      fares += d <= 600.0 ? 0 : 100 * Math.floor((Math.floor(d) - 1) / 600);
    } else {
      const j = closest(to, (k) => bikes[k] < docks[k], 1000000000.0);
      settle(to); turned[to]++; redirected++;
      if (j >= 0) plan(now + rideTime(to, j), ARRIVES, from, j, started, redirects + 1);
    }
  };
  const surplus = (i) => bikes[i] - Math.floor(docks[i] / 2);
  const truck = () => {
    let hi = 0, lo = 0;
    for (let i = 0; i < n; i++) if (surplus(i) > surplus(hi)) hi = i;
    for (let i = 0; i < n; i++) if (surplus(i) < surplus(lo)) lo = i;
    const k = Math.min(10, Math.min(surplus(hi), -surplus(lo)));
    if (k > 0) { settle(hi); bikes[hi] -= k; settle(lo); bikes[lo] += k; moved += k; }
    plan(now + 1800.0, TRUCK);
  };

  for (let i = 0; i < n; i++) nextWanted(i);
  plan(1800.0, TRUCK);
  plan(3600.0, SNAPSHOT);
  const end = hours * 3600.0;
  while (events.top()[0] <= end) {
    const [at, , kind, a, b, c, d] = events.top();
    events.pop();
    now = at;
    if (kind === WANTS) {
      if (b === 0) {
        nextWanted(a);
        const share = profile[hourOf(now) % 24] ?? 1.0;
        const heads = uniform() < (peak !== 0 ? share / peak : 0.0);
        if (heads) riderAt(a, 0);
      } else riderAt(a, b);
    } else if (kind === ARRIVES) arrived(a, b, c, d);
    else if (kind === TRUCK) truck();
    else { snapshots.push(bikes.slice()); plan(now + 3600.0, SNAPSHOT); }
  }
  now = end;
  for (let i = 0; i < n; i++) settle(i);
  return { bikes, empty, full, rentals, returns, missed, turned, rides, riding, longest, moved, redirected, walked, fares, rideTimes, misses, snapshots };
}
const NOWHERE = { name: "", docks: 0, bikes: 0, x: 0.0, y: 0.0 };

const rounded = (x) => Math.floor(x + 0.5);
const two = (n) => String(n).padStart(2, "0");
const clock = (t) => { const s = rounded(t); return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`; };
const percent = (a, b) => { if (!(b > 0)) return "-"; const t = rounded((1000.0 * a) / b); return `${Math.floor(t / 10)}.${t % 10}%`; };
const money = (c) => `${Math.floor(c / 100)}.${two(c % 100)}`;
const cell = (t, n) => String(t).padStart(n, " ");
const nameCell = (t) => t.padEnd(12, " ");
const LEVELS = [..."·░▒▓█"];
const sorted = (m) => [...m.keys()].sort((x, y) => x - y);

function report(city, hours, seed, w, io) {
  const n = city.stations.length;
  let missed = 0, turned = 0;
  for (let i = 0; i < n; i++) { missed += w.missed[i]; turned += w.turned[i]; }
  io.print(`depot: ${n} stations, ${hours} hours, seed ${seed}`);
  io.print(`rides ${w.rides}, went without ${missed} (${percent(missed, w.rides + missed)}), walked on ${w.walked}`);
  io.print(`found full ${turned}, rode on ${w.redirected}`);
  io.print(`mean ride ${w.rides > 0 ? clock(w.riding / w.rides) : "-"}, longest ${clock(w.longest)}`);
  io.print(`fares ${money(w.fares)}, truck moved ${w.moved} bikes`);
  let busiest = null;
  for (const h of sorted(w.misses)) if (busiest === null || w.misses.get(h) > w.misses.get(busiest)) busiest = h;
  io.print(busiest === null ? "no rider went without a bike" : `most went without at ${two(busiest)}:00: ${w.misses.get(busiest)} riders`);
  io.print("");
  io.print(nameCell("station") + cell("docks", 6) + cell("bikes", 6) + cell("out", 6) + cell("in", 6) + cell("none", 6) + cell("full", 6) + cell("empty for", 10) + cell("full for", 10));
  for (let i = 0; i < n; i++) {
    const s = city.stations[i];
    io.print(nameCell(s.name) + cell(s.docks, 6) + cell(w.bikes[i], 6) + cell(w.rentals[i], 6) + cell(w.returns[i], 6) + cell(w.missed[i], 6) + cell(w.turned[i], 6) + cell(clock(w.empty[i]), 10) + cell(clock(w.full[i]), 10));
  }
  io.print("");
  io.print("ride times");
  let most = 0;
  for (const v of w.rideTimes.values()) most = Math.max(most, v);
  for (const b of sorted(w.rideTimes)) {
    const k = w.rideTimes.get(b);
    io.print(`${cell(b * 5, 3)}-${String(b * 5 + 5).padEnd(3, " ")}min ${cell(k, 5)} ${"█".repeat(Math.floor((k * 30 + most - 1) / most))}`);
  }
  io.print("");
  io.print("bikes by the hour");
  for (let i = 0; i < n; i++) {
    const d = city.stations[i].docks;
    io.print(nameCell(city.stations[i].name) + w.snapshots.map((r) => LEVELS[Math.floor(((r[i] ?? 0) * 4 + d - 1) / d)] ?? "?").join(""));
  }
}

export function depot(args, io) {
  if (args.length < 1 || args.length > 3) { io.printError("usage: depot city.txt [hours] [seed]"); return 2; }
  try {
    const hours = args.length > 1 ? wholeAt(args[1], 0) : 24, seed = args.length > 2 ? wholeAt(args[2], 0) : 1;
    let text;
    try { text = io.readFile(args[0]); } catch (e) { refuse(e.message); }
    const city = cityOf(text);
    if (hours < 1 || seed < 1) refuse("the hours and the seed are whole numbers from 1");
    report(city, hours, seed, simulate(city, hours, seed), io);
    return 0;
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    io.printError(`depot: ${e.message}`);
    return 1;
  }
}
