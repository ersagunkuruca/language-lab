// pond (bigger-program round 13), written by hand as a data-oriented
// JavaScript developer would: the fish as columns of typed arrays, a free
// list of slots with a generation each (so a key is a slot and a
// generation, as std's Pool gives them), the floor's food one
// Float64Array by cell, the herons a few small arrays. Each tick every
// fish's plan is made from the pond as it was, into columns of their own,
// then the plans are carried out in slot order, as the program does. The
// same arithmetic in the same order, so the same answers to the bit.
//   node compiler/gaps/pond.ideal.js [ticks] [fish]
const ticks = Number(process.argv[2] ?? 300), stock = Number(process.argv[3] ?? 400);
const t0 = performance.now();
const SIDE = 48.0, N = 48, CELLS = N * N, STEP = 0.6, APPETITE = 0.25, GAIN = 0.8, UPKEEP = 0.06;
const SPAWN_ENERGY = 2.0, SPAWN_AGE = 12, OLD_AGE = 220, GROWTH = 0.3, CAPACITY = 1.0, TRICKLE = 0.002;
const LEADER_PULL = 0.6, KEEP_GOING = 0.3, FOOD_WEIGHT = 1.0, HERONS = 6, HERON_SPEED = 0.9, REACH = 1.0, DIGEST = 4, EVERY = 50;
const DG = 0.7071067811865476;
const DX = [1.0, DG, 0.0, 0.0 - DG, -1.0, 0.0 - DG, 0.0, DG], DY = [0.0, DG, 1.0, DG, 0.0, 0.0 - DG, -1.0, 0.0 - DG];
const random = (s) => (s * 16807) % 2147483647;
const chance = (s) => s / 2147483647.0;
const wrapped = (c) => c - SIDE * Math.floor(c / SIDE);
const around = (d) => (d > SIDE * 0.5 ? d - SIDE : d < 0.0 - SIDE * 0.5 ? d + SIDE : d);
const cellOf = (c) => Math.floor(wrapped(c));
const wcell = (c) => (c + N) % N;
// A list's sum as std's `sum` adds it: from the last item back, onto 0.
const WEIGHT = [];
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) WEIGHT.push(1.0 / (1 + dx * dx + dy * dy));

// The school: columns by slot, a generation a slot, a free list (newest first).
let cap = 1024, slots = 0, size = 0;
let x = new Float64Array(cap), y = new Float64Array(cap), hx = new Float64Array(cap), hy = new Float64Array(cap), en = new Float64Array(cap);
let age = new Int32Array(cap), ls = new Int32Array(cap), lg = new Int32Array(cap), seed = new Float64Array(cap), gen = new Int32Array(cap), live = new Uint8Array(cap);
const free = [];
const grow = () => {
  cap *= 2;
  const f = (a, T) => { const b = new T(cap); b.set(a); return b; };
  x = f(x, Float64Array); y = f(y, Float64Array); hx = f(hx, Float64Array); hy = f(hy, Float64Array); en = f(en, Float64Array);
  age = f(age, Int32Array); ls = f(ls, Int32Array); lg = f(lg, Int32Array); seed = f(seed, Float64Array); gen = f(gen, Int32Array); live = f(live, Uint8Array);
};
const nextSlot = () => (free.length ? free[free.length - 1] : slots);
const nextGen = () => (free.length ? gen[free[free.length - 1]] : 0);
const add = (px, py, phx, phy, pe, pa, pls, plg, ps) => {
  let s;
  if (free.length) s = free.pop(); else { if (slots === cap) grow(); s = slots++; gen[s] = 0; }
  x[s] = px; y[s] = py; hx[s] = phx; hy[s] = phy; en[s] = pe; age[s] = pa; ls[s] = pls; lg[s] = plg; seed[s] = ps; live[s] = 1; size++;
};
const found = (s, g) => s >= 0 && s < slots && gen[s] === g && live[s] === 1;
const remove = (s, g) => { if (!found(s, g)) return; live[s] = 0; gen[s]++; free.push(s); size--; };

const food = new Float64Array(CELLS);
for (let k = 0; k < CELLS; k++) food[k] = 0.2 + 0.6 * chance(random(k * 7919 + 13));

// Stocking.
{
  let s = 12345, lastS = 0, lastG = 0;
  for (let n = stock; n > 0; n--) {
    const ks = nextSlot(), kg = nextGen();
    const lead = chance(s) < 0.3;
    add(SIDE * chance(s), SIDE * chance(random(s)), 1.0, 0.0, 1.0, Math.floor(chance(random(random(s))) * 50.0), lead ? ks : lastS, lead ? kg : lastG, random(random(random(s))));
    s = random(random(random(s)));
    lastS = ks; lastG = kg;
  }
}
// Herons.
const hsx = new Float64Array(HERONS), hsy = new Float64Array(HERONS), hts = new Int32Array(HERONS), htg = new Int32Array(HERONS), hc = new Int32Array(HERONS), hr = new Int32Array(HERONS);
for (let id = 0; id < HERONS; id++) { const s = random(id * 104729 + 7); hsx[id] = SIDE * chance(s); hsy[id] = SIDE * chance(random(s)); }
let born = 0, died = 0, caught = 0, tick = 0;
const log = [];

const scent = (px, py) => {
  const cx = cellOf(px), cy = cellOf(py);
  let total = 0;
  for (let i = 4; i >= 0; i--) {
    const dy = i - 2;
    let row = 0;
    for (let j = 4; j >= 0; j--) { const dx = j - 2; row = food[wcell(cy + dy) * N + wcell(cx + dx)] * WEIGHT[i * 5 + j] + row; }
    total = row + total;
  }
  return total;
};

// The plans, as columns.
let pc = 0, P = { s: new Int32Array(cap), g: new Int32Array(cap), x: new Float64Array(cap), y: new Float64Array(cap), hx: new Float64Array(cap), hy: new Float64Array(cap), e: new Float64Array(cap), a: new Int32Array(cap), ls: new Int32Array(cap), lg: new Int32Array(cap), seed: new Float64Array(cap), cell: new Int32Array(cap) };
const showD = (v, p) => {
  const scale = 10 ** p, steps = Math.floor(Math.abs(v) * scale + 0.5), whole = Math.floor(steps / scale);
  const t = String(whole) + "." + String(steps - whole * scale).padStart(p, "0");
  return v < 0 && 0 < steps ? "-" + t : t;
};
const sumBack = (xs) => { let a = 0; for (let i = xs.length - 1; i >= 0; i--) a = xs[i] + a; return a; };

for (let t = 0; t < ticks; t++) {
  if (P.s.length < cap) for (const k of Object.keys(P)) { const T = P[k].constructor; P[k] = new T(cap); }
  pc = 0;
  for (let s = 0; s < slots; s++) {
    if (!live[s]) continue;
    const me = gen[s];
    // Toward its leader, while that one lives.
    let lx = x[s], ly = y[s];
    const self = ls[s] === s && lg[s] === me;
    if (!self && found(ls[s], lg[s])) { lx = x[ls[s]]; ly = y[ls[s]]; }
    let ox = around(lx - x[s]), oy = around(ly - y[s]);
    const l = Math.sqrt(ox * ox + oy * oy);
    let px = 0.0, py = 0.0;
    if (l > 0.0) { const r = 1.0 / l; px = ox * r; py = oy * r; }
    let bx = hx[s], by = hy[s], top = -1000000.0;
    for (let d = 0; d < 8; d++) {
      const ax = wrapped(x[s] + DX[d] * STEP), ay = wrapped(y[s] + DY[d] * STEP);
      const sc = FOOD_WEIGHT * scent(ax, ay) + LEADER_PULL * (px * DX[d] + py * DY[d]) + KEEP_GOING * (hx[s] * DX[d] + hy[s] * DY[d]);
      if (sc > top) { top = sc; bx = DX[d]; by = DY[d]; }
    }
    const nx = wrapped(x[s] + bx * STEP), ny = wrapped(y[s] + by * STEP);
    const keep = found(ls[s], lg[s]);
    P.s[pc] = s; P.g[pc] = me; P.x[pc] = nx; P.y[pc] = ny; P.hx[pc] = bx; P.hy[pc] = by; P.e[pc] = en[s] - UPKEEP; P.a[pc] = age[s] + 1;
    P.ls[pc] = keep ? ls[s] : s; P.lg[pc] = keep ? lg[s] : me; P.seed[pc] = random(seed[s]); P.cell[pc] = cellOf(ny) * N + cellOf(nx);
    pc++;
  }
  for (let i = 0; i < pc; i++) {
    const s = P.s[i], cell = P.cell[i];
    const got = APPETITE < food[cell] ? APPETITE : food[cell];
    food[cell] = food[cell] - got;
    const e = P.e[i] + GAIN * got, a = P.a[i];
    if (e <= 0.0 || a > OLD_AGE) { remove(s, P.g[i]); died++; continue; }
    if (e >= SPAWN_ENERGY && a >= SPAWN_AGE) {
      x[s] = P.x[i]; y[s] = P.y[i]; hx[s] = P.hx[i]; hy[s] = P.hy[i]; en[s] = e * 0.5; age[s] = a; ls[s] = P.ls[i]; lg[s] = P.lg[i]; seed[s] = P.seed[i];
      const j = chance(P.seed[i]);
      add(wrapped(P.x[i] + (j - 0.5)), wrapped(P.y[i] + (0.5 - j)), 0.0 - P.hx[i], 0.0 - P.hy[i], e * 0.5, 0, s, P.g[i], random(P.seed[i] + 17));
      born++;
      continue;
    }
    x[s] = P.x[i]; y[s] = P.y[i]; hx[s] = P.hx[i]; hy[s] = P.hy[i]; en[s] = e; age[s] = a; ls[s] = P.ls[i]; lg[s] = P.lg[i]; seed[s] = P.seed[i];
  }
  for (let id = 0; id < HERONS; id++) {
    if (hr[id] > 0) { hr[id]--; continue; }
    let ts = hts[id], tg = htg[id];
    if (!found(ts, tg)) {
      ts = 0; tg = 0;
      let bd = 1000000.0;
      for (let s = 0; s < slots; s++) {
        if (!live[s]) continue;
        const ox = around(x[s] - hsx[id]), oy = around(y[s] - hsy[id]), d = Math.sqrt(ox * ox + oy * oy);
        if (d < bd) { bd = d; ts = s; tg = gen[s]; }
      }
    }
    const gx = found(ts, tg) ? x[ts] : 0.0, gy = found(ts, tg) ? y[ts] : 0.0;
    const ox = around(gx - hsx[id]), oy = around(gy - hsy[id]), d = Math.sqrt(ox * ox + oy * oy);
    hts[id] = ts; htg[id] = tg;
    if (d <= REACH) { hsx[id] = gx; hsy[id] = gy; hc[id]++; hr[id] = DIGEST; remove(ts, tg); caught++; }
    else {
      let ux = 0.0, uy = 0.0;
      if (d > 0.0) { const r = 1.0 / d; ux = ox * r; uy = oy * r; }
      hsx[id] = wrapped(hsx[id] + ux * HERON_SPEED); hsy[id] = wrapped(hsy[id] + uy * HERON_SPEED);
    }
  }
  for (let k = 0; k < CELLS; k++) { const f = food[k], g = f + GROWTH * f * (CAPACITY - f) + TRICKLE; food[k] = CAPACITY < g ? CAPACITY : g; }
  tick++;
  if (tick % EVERY === 0) {
    const es = [], cs = [];
    let following = 0, elders = 0;
    for (let s = 0; s < slots; s++) {
      if (!live[s]) continue;
      es.push(en[s]); cs.push(x[s] + 2.0 * y[s]);
      if (!(ls[s] === s && lg[s] === gen[s])) following++;
      if (age[s] > 100) elders++;
    }
    const mean = es.length ? sumBack(es) / es.length : 0.0;
    log.push(`tick ${tick}: ${size} fish (born ${born}, died ${died}, caught ${caught}), food ${showD(sumBack(food), 3)}, mean energy ${showD(mean, 4)}, following ${following}, elders ${elders}, checksum ${showD(sumBack(cs), 3)}`);
  }
}
let outside = 0, spent = 0, over = 0, old = 0;
for (let s = 0; s < slots; s++) {
  if (!live[s]) continue;
  if (!(x[s] >= 0.0 && x[s] < SIDE && y[s] >= 0.0 && y[s] < SIDE)) outside++;
  if (en[s] <= 0.0) spent++;
  if (age[s] > OLD_AGE) old++;
}
for (let k = 0; k < CELLS; k++) if (food[k] > CAPACITY || food[k] < 0.0) over++;
console.log(log.join("\n"));
console.log(`Checks: ${outside} outside the pond, ${spent} spent, ${over} overfull patches, ${old} too old.`);
console.log("Credits: the school follows leaders as Craig Reynolds's boids steer (1987); food grows back as Pierre-Francois Verhulst's logistic growth (1838); random numbers by Stephen Park and Keith Miller's minimal standard generator (1988); the fish are kept with generational keys and a free list, as game engines keep their entities.");
console.error(`(${(performance.now() - t0).toFixed(0)} ms)`);
