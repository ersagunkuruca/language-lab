// flock (GAPS.md game round 3, BACKLOG G6d), written by hand in JavaScript:
// the same 3D boids as compiler/gaps/flock and the same code as
// flock.ideal.c, the birds as Float64Array columns, the grid a counting sort
// each tick, each bird's neighbours added in their numbers' order (as
// `neighbours` lists them), the arithmetic in the program's order.
// node flock.ideal.js [ticks] [birds]; flock(ticks, n) gives the lines.
const SIDE = 120, SC = 12, CELLS = SC * SC * SC;
const rnd = (s) => (s * 16807) % 2147483647;
const chance = (s) => s / 2147483647;
const along = (c) => Math.floor(c / 10) % SC;
const kept = (c) => Math.min(Math.max(c, 0), SIDE - 0.001);
const away = (c) => (c < 15 ? 0.08 : c > SIDE - 15 ? 0 - 0.08 : 0);
const swept = (tick, period) => { const u = tick % (2 * period), p = period; return u < p ? 25 + 70 * u / p : 95 - 70 * (u - p) / p; };
export function flock(T, n) {
  let x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n), vz = new Float64Array(n);
  let nx = new Float64Array(n), ny = new Float64Array(n), nz = new Float64Array(n), nvx = new Float64Array(n), nvy = new Float64Array(n), nvz = new Float64Array(n);
  const near = new Int32Array(n), cell = new Int32Array(n), order = new Int32Array(n), start = new Int32Array(CELLS + 1), fill = new Int32Array(CELLS);
  for (let i = 0; i < n; i++) {
    const s = rnd(i * 7919 + 13), a = rnd(s), b = rnd(a), c = rnd(b), d = rnd(c);
    x[i] = 20 + 80 * chance(s); y[i] = 20 + 80 * chance(a); z[i] = 20 + 80 * chance(b);
    vx[i] = chance(c) - 0.5; vy[i] = chance(d) - 0.5; vz[i] = chance(rnd(d)) - 0.5;
  }
  const log = [];
  for (let tick = 0; tick < T; tick++) {
    start.fill(0);
    for (let i = 0; i < n; i++) { cell[i] = (along(z[i]) * SC + along(y[i])) * SC + along(x[i]); start[cell[i] + 1]++; }
    for (let c = 0; c < CELLS; c++) { start[c + 1] += start[c]; fill[c] = start[c + 1]; }
    for (let i = 0; i < n; i++) order[--fill[cell[i]]] = i;
    const gx = swept(tick, 450), gy = swept(tick, 610), gz = swept(tick, 370);
    for (let i = 0; i < n; i++) {
      const px = x[i], py = y[i], pz = z[i];
      let sx = 0, sy = 0, sz = 0, hx = 0, hy = 0, hz = 0, cx = 0, cy = 0, cz = 0, count = 0;
      const ax = along(px), ay = along(py), az = along(pz);
      let m = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = (((az + dz + SC) % SC) * SC + (ay + dy + SC) % SC) * SC + (ax + dx + SC) % SC;
        for (let r = start[k]; r < start[k + 1]; r++) {
          const j = order[r];
          const ox = x[j] - px, oy = y[j] - py, oz = z[j] - pz, d2 = ox * ox + oy * oy + oz * oz;
          if (d2 < 100 && d2 > 0) { let q = m++; while (q > 0 && near[q - 1] > j) { near[q] = near[q - 1]; q--; } near[q] = j; }
        }
      }
      for (let q = 0; q < m; q++) {
        const j = near[q];
        const ox = x[j] - px, oy = y[j] - py, oz = z[j] - pz, inv = 1 / (ox * ox + oy * oy + oz * oz);
        sx = sx - ox * inv; sy = sy - oy * inv; sz = sz - oz * inv;
        hx += vx[j]; hy += vy[j]; hz += vz[j]; cx += ox; cy += oy; cz += oz; count++;
      }
      const ux = gx - px, uy = gy - py, uz = gz - pz, ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
      let tx = 0, ty = 0, tz = 0;
      if (ul > 0) { const r = 1 / ul; tx = ux * r; ty = uy * r; tz = uz * r; }
      tx = tx * 0.012 + away(px); ty = ty * 0.012 + away(py); tz = tz * 0.012 + away(pz);
      const v0x = vx[i], v0y = vy[i], v0z = vz[i];
      let wx, wy, wz;
      if (count === 0) { wx = v0x + tx; wy = v0y + ty; wz = v0z + tz; }
      else {
        const inv = 1 / count, g = 0.03 / count;
        wx = v0x + ((sx * 0.3 + (hx * inv - v0x) * 0.12) + (cx * g + tx));
        wy = v0y + ((sy * 0.3 + (hy * inv - v0y) * 0.12) + (cy * g + ty));
        wz = v0z + ((sz * 0.3 + (hz * inv - v0z) * 0.12) + (cz * g + tz));
      }
      const sp = Math.sqrt(wx * wx + wy * wy + wz * wz);
      if (sp > 1.8) { const r = 1.8 / sp; wx = wx * r; wy = wy * r; wz = wz * r; }
      else if (sp < 0.8 && sp > 0) { const r = 0.8 / sp; wx = wx * r; wy = wy * r; wz = wz * r; }
      nvx[i] = wx; nvy[i] = wy; nvz[i] = wz;
      nx[i] = kept(px + wx); ny[i] = kept(py + wy); nz[i] = kept(pz + wz);
    }
    [x, nx] = [nx, x]; [y, ny] = [ny, y]; [z, nz] = [nz, z]; [vx, nvx] = [nvx, vx]; [vy, nvy] = [nvy, vy]; [vz, nvz] = [nvz, vz];
    if ((tick + 1) % 25 === 0) {
      let sum = 0, speed = 0;
      for (let i = 0; i < n; i++) sum += x[i] + 2 * y[i] + 3 * z[i];
      for (let i = 0; i < n; i++) speed += Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      log.push(`tick ${tick + 1}: checksum ${sum.toFixed(6)}, mean speed ${(speed / n).toFixed(6)}`);
    }
  }
  log.push("Credits: the birds flock by Craig Reynolds's boids (Flocks, herds and schools, SIGGRAPH 1987), each looking only at the birds within reach, found on a grid of cells (Bentley, Stanat and Williams, 1977); random numbers by Stephen Park and Keith Miller's minimal standard generator (1988).");
  return log;
}
if (import.meta.url === `file://${process.argv[1]}`) for (const l of flock(Number(process.argv[2] ?? 100), Number(process.argv[3] ?? 5000))) console.log(l);
