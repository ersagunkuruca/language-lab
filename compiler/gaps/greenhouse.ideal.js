// greenhouse (GAPS.md game round 2, BACKLOG G6b), written by hand in
// JavaScript: the same night as compiler/gaps/greenhouse and the same code as
// greenhouse.ideal.c, the pool as typed-array columns by slot with its
// generations and free list, the moths' grid a counting sort each tick, the
// same arithmetic in the same order, so it prints the same digits.
// node greenhouse.ideal.js [ticks] [moths]; greenhouse(ticks, n) gives the lines.
const SIDE = 256, SC = 32, CELLS = SC * SC, PLANTS = 24, NIGHT = 2700;
const EMPTY = 0, MOTH = 1, PLANT = 2, LAMP = 3;
const wrapped = (c) => c - SIDE * Math.floor(c / SIDE);
const around = (d) => (d > SIDE * 0.5 ? d - SIDE : d < 0 - SIDE * 0.5 ? d + SIDE : d);
const rnd = (s) => (s * 16807) % 2147483647;
const chance = (s) => s / 2147483647;
const along = (c) => Math.floor(wrapped(c) / 8) % SC;
export function greenhouse(T, n) {
  const cap = n + PLANTS + 2;
  // The pool: slots by number, what each holds; free slots, the next last.
  const kind = new Int32Array(cap), gen = new Int32Array(cap), freel = new Int32Array(cap);
  const x = new Float64Array(cap), y = new Float64Array(cap), vx = new Float64Array(cap), vy = new Float64Array(cap);
  const growth = new Float64Array(cap), health = new Float64Array(cap), reach = new Float64Array(cap);
  let slots = 0, nfree = 0;
  const add = (k, px, py) => { const s = nfree ? freel[--nfree] : slots++; kind[s] = k; x[s] = px; y[s] = py; return s; };
  // The moths as columns by moth number (movers), and the grid of them.
  const mx = new Float64Array(n), my = new Float64Array(n), mvx = new Float64Array(n), mvy = new Float64Array(n);
  const mslot = new Int32Array(n), cell = new Int32Array(n), order = new Int32Array(n);
  const start = new Int32Array(CELLS + 1), fill = new Int32Array(CELLS), gone = new Int32Array(PLANTS + 8);
  for (let i = 0; i < PLANTS; i++) {
    const s = rnd(rnd(i * 104729 + 7)), col = i % 6, row = Math.floor(i / 6);
    const t = add(PLANT, 38 + 36 * col + 8 * chance(s), 44 + 52 * row + 8 * chance(rnd(s)));
    growth[t] = 0.3 + 0.4 * chance(rnd(rnd(s))); health[t] = 1;
  }
  for (let i = 0; i < n; i++) {
    const s = rnd(i * 7919 + 13);
    const t = add(MOTH, SIDE * chance(s), SIDE * chance(rnd(s)));
    vx[t] = chance(rnd(rnd(s))) - 0.5; vy[t] = chance(rnd(rnd(rnd(s)))) - 0.5;
  }
  // The gardener: where they stand, and the lamp they carry (reach 0: none).
  let gx = 128, gy = 128, greach = 40, tick = 0, eaten = 0;
  const log = [], lx = new Float64Array(8), ly = new Float64Array(8);
  for (let left = T; ; left--) {
    if (left === 0 || tick >= NIGHT || tick % 100 === 0) {
      let moths = 0, plants = 0, sum = 0;
      for (let s = 0; s < slots; s++) if (kind[s]) { sum += x[s] + 2 * y[s]; moths += kind[s] === MOTH; plants += kind[s] === PLANT; }
      log.push(`tick ${tick}: moths ${moths}, plants ${plants}, eaten ${eaten}, checksum ${sum.toFixed(6)}`);
      if (left === 0 || tick >= NIGHT) break;
    }
    // The movers, in slot order, and the grid of them.
    let m = 0;
    for (let s = 0; s < slots; s++) if (kind[s] === MOTH) { mslot[m] = s; mx[m] = x[s]; my[m] = y[s]; mvx[m] = vx[s]; mvy[m] = vy[s]; m++; }
    start.fill(0);
    for (let i = 0; i < m; i++) { cell[i] = along(my[i]) * SC + along(mx[i]); start[cell[i] + 1]++; }
    for (let c = 0; c < CELLS; c++) { start[c + 1] += start[c]; fill[c] = start[c + 1]; }
    for (let i = 0; i < m; i++) order[--fill[cell[i]]] = i; // each cell's moths, highest number first
    // The gardener walks a square, 150 ticks a side.
    const q = Math.floor(tick / 150) % 4;
    let wx = q === 0 ? 1 : q === 2 ? -1 : 0, wy = q === 1 ? 1 : q === 3 ? -1 : 0;
    const wl = Math.sqrt(wx * wx + wy * wy);
    if (wl > 0) { const r = 1 / wl; wx = wx * r; wy = wy * r; }
    gx = wrapped(gx + wx * 1.2); gy = wrapped(gy + wy * 1.2);
    // The lights: the gardener's first, then the hung lamps in slot order.
    let nl = 0;
    if (greach > 0) { lx[nl] = gx; ly[nl] = gy; nl++; }
    for (let s = 0; s < slots && nl < 8; s++) if (kind[s] === LAMP) { lx[nl] = x[s]; ly[nl] = y[s]; nl++; }
    // The moths fly, from where they all were.
    for (let i = 0; i < m; i++) {
      const px = mx[i], py = my[i];
      let pushx = 0, pushy = 0, hx = 0, hy = 0, cx = 0, cy = 0, count = 0;
      const ax = along(px), ay = along(py);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = ((ay + dy + SC) % SC) * SC + (ax + dx + SC) % SC;
        for (let r = start[k]; r < start[k + 1]; r++) {
          const j = order[r];
          const ox = around(mx[j] - px), oy = around(my[j] - py), d2 = ox * ox + oy * oy;
          if (d2 < 64 && d2 > 0) { pushx = pushx - ox / d2; pushy = pushy - oy / d2; hx += mvx[j]; hy += mvy[j]; cx += ox; cy += oy; count++; }
        }
      }
      let bx = 0, by = 0, bd = 1000000000;
      for (let l = 0; l < nl; l++) {
        const ox = around(lx[l] - px), oy = around(ly[l] - py), e = ox * ox + oy * oy;
        if (e < bd) { bx = ox; by = oy; bd = e; }
      }
      const ll = Math.sqrt(bx * bx + by * by);
      let ux = 0, uy = 0;
      if (ll > 0) { const r = 1 / ll; ux = bx * r; uy = by * r; }
      const pullx = ux * 0.08, pully = uy * 0.08, v0x = mvx[i], v0y = mvy[i];
      let nvx, nvy;
      if (count === 0) { nvx = v0x + pullx; nvy = v0y + pully; }
      else {
        const inv = 1 / count, g = 0.01 / count;
        nvx = v0x + ((pushx * 1.5 + (hx * inv - v0x) * 0.05) + (cx * g + pullx));
        nvy = v0y + ((pushy * 1.5 + (hy * inv - v0y) * 0.05) + (cy * g + pully));
      }
      const sp = Math.sqrt(nvx * nvx + nvy * nvy);
      if (sp > 2) { const r = 2 / sp; nvx = nvx * r; nvy = nvy * r; }
      const s = mslot[i];
      vx[s] = nvx; vy[s] = nvy; x[s] = wrapped(px + nvx); y[s] = wrapped(py + nvy);
    }
    // The plants grow, or lose health to each moth on them (where the moths
    // were before they flew).
    for (let s = 0; s < slots; s++) if (kind[s] === PLANT) {
      const ax = along(x[s]), ay = along(y[s]);
      let bites = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = ((ay + dy + SC) % SC) * SC + (ax + dx + SC) % SC;
        for (let r = start[k]; r < start[k + 1]; r++) {
          const j = order[r], ox = around(mx[j] - x[s]), oy = around(my[j] - y[s]);
          if (ox * ox + oy * oy < 4) bites++;
        }
      }
      if (bites === 0) growth[s] = growth[s] + 0.0004 > 1 ? 1 : growth[s] + 0.0004;
      else health[s] = health[s] - 0.002 * bites;
    }
    // The plants with no health left are gone: their slots go on top of the
    // free list, the lowest last, so they are used again first.
    let ng = 0;
    for (let s = 0; s < slots; s++) if (kind[s] === PLANT && !(health[s] > 0)) gone[ng++] = s;
    for (let k = ng - 1; k >= 0; k--) { kind[gone[k]] = EMPTY; gen[gone[k]]++; freel[nfree++] = gone[k]; }
    eaten += ng;
    // Every 400 ticks the gardener hangs the lamp, or takes it down.
    if (tick % 400 === 199) {
      if (greach > 0) { const s = add(LAMP, gx, gy); reach[s] = greach; greach = 0; }
      else for (let s = 0; s < slots; s++) if (kind[s] === LAMP) {
        const ox = around(x[s] - gx), oy = around(y[s] - gy);
        if (ox * ox + oy * oy < 100) { greach = reach[s]; kind[s] = EMPTY; gen[s]++; freel[nfree++] = s; break; }
      }
    }
    tick++;
  }
  log.push("Credits: the moths flock by Craig Reynolds's boids (1987); random numbers by Stephen Park and Keith Miller's minimal standard generator (1988); entities as a pool of things with optional parts, stored as the compiler chooses, after Unity DOTS, flecs (Sander Mertens), Bevy and EnTT (Michele Caini).");
  return log;
}
if (import.meta.url === `file://${process.argv[1]}`) for (const l of greenhouse(Number(process.argv[2] ?? 600), Number(process.argv[3] ?? 2000))) console.log(l);
