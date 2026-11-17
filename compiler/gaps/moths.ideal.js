// moths (GAPS.md game round 1, BACKLOG G3), written by hand in JavaScript: the same swarm as
// compiler/gaps/moths, moths as Float64Array columns, the grid as a counting
// sort each tick, the same arithmetic in the same order as moths.ideal.c.
// node moths.ideal.js [ticks] [moths]; moths(ticks, n) gives the lines.
const SIDE = 256, SC = 32, CELLS = SC * SC;
const wrapped = (c) => c - SIDE * Math.floor(c / SIDE);
const around = (d) => (d > SIDE * 0.5 ? d - SIDE : d < 0 - SIDE * 0.5 ? d + SIDE : d);
const rnd = (s) => Number((BigInt(s) * 16807n) % 2147483647n);
const chance = (s) => s / 2147483647;
const along = (c) => Math.floor(wrapped(c) / 8) % SC;
const LX = [64, 192, 64, 192], LY = [64, 64, 192, 192], LP = [0, 100, 200, 300];
export function moths(T, n) {
let x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n);
let nx = new Float64Array(n), ny = new Float64Array(n), nvx = new Float64Array(n), nvy = new Float64Array(n);
const cell = new Int32Array(n), order = new Int32Array(n), start = new Int32Array(CELLS + 1), fill = new Int32Array(CELLS);
for (let i = 0; i < n; i++) {
  const s = rnd(i * 7919 + 13);
  x[i] = SIDE * chance(s); y[i] = SIDE * chance(rnd(s));
  vx[i] = chance(rnd(rnd(s))) - 0.5; vy[i] = chance(rnd(rnd(rnd(s)))) - 0.5;
}
const log = [];
for (let tick = 0; tick < T; tick++) {
  start.fill(0);
  for (let i = 0; i < n; i++) { cell[i] = along(y[i]) * SC + along(x[i]); start[cell[i] + 1]++; }
  for (let c = 0; c < CELLS; c++) { start[c + 1] += start[c]; fill[c] = start[c + 1]; }
  for (let i = 0; i < n; i++) order[--fill[cell[i]]] = i;
  const lit = LP.map((p) => (tick + p) % 400 < 250);
  for (let i = 0; i < n; i++) {
    const px = x[i], py = y[i];
    let pushx = 0, pushy = 0, hx = 0, hy = 0, cx = 0, cy = 0, count = 0;
    const ax = along(px), ay = along(py);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const k = ((ay + dy + SC) % SC) * SC + (ax + dx + SC) % SC;
      for (let q = start[k]; q < start[k + 1]; q++) {
        const j = order[q];
        if (j === i) continue;
        const ox = around(x[j] - px), oy = around(y[j] - py), d2 = ox * ox + oy * oy;
        if (d2 < 64 && d2 > 0) { pushx = pushx - ox / d2; pushy = pushy - oy / d2; hx += vx[j]; hy += vy[j]; cx += ox; cy += oy; count++; }
      }
    }
    let bx = 0, by = 0, bd = 1000000000;
    for (let l = 0; l < 4; l++) {
      const ox = around(LX[l] - px), oy = around(LY[l] - py), e = ox * ox + oy * oy;
      if (lit[l] && e < bd) { bx = ox; by = oy; bd = e; }
    }
    const ll = Math.sqrt(bx * bx + by * by);
    let ux = 0, uy = 0;
    if (ll > 0) { const r = 1 / ll; ux = bx * r; uy = by * r; }
    const pullx = ux * 0.05, pully = uy * 0.05;
    let wx, wy;
    if (count === 0) { wx = vx[i] + pullx; wy = vy[i] + pully; }
    else {
      const inv = 1 / count, g = 0.01 / count;
      wx = vx[i] + ((pushx * 1.5 + (hx * inv - vx[i]) * 0.05) + (cx * g + pullx));
      wy = vy[i] + ((pushy * 1.5 + (hy * inv - vy[i]) * 0.05) + (cy * g + pully));
    }
    const sp = Math.sqrt(wx * wx + wy * wy);
    if (sp > 2) { const r = 2 / sp; wx = wx * r; wy = wy * r; }
    nvx[i] = wx; nvy[i] = wy; nx[i] = wrapped(px + wx); ny[i] = wrapped(py + wy);
  }
  [x, nx] = [nx, x]; [y, ny] = [ny, y]; [vx, nvx] = [nvx, vx]; [vy, nvy] = [nvy, vy];
  if ((tick + 1) % 25 === 0) {
    let sum = 0, speed = 0;
    for (let i = 0; i < n; i++) sum += x[i] + 2 * y[i];
    for (let i = 0; i < n; i++) speed += Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
    log.push(`tick ${tick + 1}: checksum ${sum.toFixed(6)}, mean speed ${(speed / n).toFixed(6)}`);
  }
}
log.push("Credits: the moths flock by Craig Reynolds's boids (1987); random numbers by Stephen Park and Keith Miller's minimal standard generator (1988).");
  return log;
}
if (import.meta.url === `file://${process.argv[1]}`) for (const l of moths(Number(process.argv[2] ?? 100), Number(process.argv[3] ?? 10000))) console.log(l);
