// hail (GAPS.md game round 5, BACKLOG G20), written by hand in JavaScript:
// hail.ideal.c line by line, the stones and touches as columns of typed
// arrays changed in place, last tick's impulses in a Map keyed by number.
// node hail.ideal.js [ticks] [discs]
const T = Number(process.argv[2] ?? 100);
let n = Number(process.argv[3] ?? 1000);
const SILL = 0.05, GRAVITY = 1.5, DRAG = 3.0, FRICTION = 0.3, REACH = 0.06, STEP = 1.0 / 60.0, WIDTH = 640.0 / 480.0;
const larger = (a, b) => (a < b ? b : a);
// Stone i's parts at i; the frame (-1) at n0, all zeros, and never written.
const n0 = n;
const id = new Int32Array(n0 + 1), x = new Float64Array(n0 + 1), y = new Float64Array(n0 + 1), ang = new Float64Array(n0 + 1);
const vx = new Float64Array(n0 + 1), vy = new Float64Array(n0 + 1), spin = new Float64Array(n0 + 1), r = new Float64Array(n0 + 1);
id[n0] = -1;
for (let i = 0; i < n; i++) {
  id[i] = i + 1;
  x[i] = (0.03 + 0.026 * (i % 50)) + 0.006 * (Math.floor(i / 50) % 2);
  y[i] = SILL + 0.013 + 0.026 * Math.floor(i / 50);
  r[i] = 0.012;
}
let cap = 1024;
let ta = new Int32Array(cap), tb = new Int32Array(cap), tka = new Int32Array(cap), tkb = new Int32Array(cap);
let tnx = new Float64Array(cap), tny = new Float64Array(cap), tdepth = new Float64Array(cap), tpx = new Float64Array(cap), tpy = new Float64Array(cap);
let tbounce = new Float64Array(cap), tpn = new Float64Array(cap), tpt = new Float64Array(cap);
let m = 0;
const grow = () => {
  cap *= 2;
  const g = (a) => { const b = new a.constructor(cap); b.set(a); return b; };
  ta = g(ta); tb = g(tb); tka = g(tka); tkb = g(tkb); tnx = g(tnx); tny = g(tny); tdepth = g(tdepth);
  tpx = g(tpx); tpy = g(tpy); tbounce = g(tbounce); tpn = g(tpn); tpt = g(tpt);
};
const key = (a, b) => a * 65536 + (b + 8);
let kept = new Map(), fresh = new Map();
const inverseMass = (s) => (id[s] < 0 ? 0.0 : 1.0 / (3.14159265 * r[s] * r[s]));
const inverseInertia = (s) => { const d = r[s] * r[s]; return d === 0.0 ? 0.0 : 2.0 * inverseMass(s) / d; };
const at = (i) => (i < 0 ? n0 : i);
const along = (t, ux, uy) => {
  const a = at(ta[t]), b = at(tb[t]), px = tpx[t], py = tpy[t];
  const dvx = vx[b] - spin[b] * (py - y[b]) - (vx[a] - spin[a] * (py - y[a]));
  const dvy = vy[b] + spin[b] * (px - x[b]) - (vy[a] + spin[a] * (px - x[a]));
  return dvx * ux + dvy * uy;
};
const massAlong = (t, ux, uy) => {
  const a = at(ta[t]), b = at(tb[t]), px = tpx[t], py = tpy[t];
  const ra = (px - x[a]) * uy - (py - y[a]) * ux, rb = (px - x[b]) * uy - (py - y[b]) * ux;
  return (inverseMass(a) + inverseMass(b) + inverseInertia(a) * ra * ra) + inverseInertia(b) * rb * rb;
};
const pushed = (s, px, py, cx, cy) => {
  const im = inverseMass(s), ii = inverseInertia(s);
  const ox = x[s], oy = y[s];
  vx[s] = vx[s] + im * px; vy[s] = vy[s] + im * py;
  spin[s] = spin[s] + ii * ((cx - ox) * py - (cy - oy) * px);
};
const impulse = (t, px, py) => {
  if (ta[t] >= 0) pushed(ta[t], 0.0 - px, 0.0 - py, tpx[t], tpy[t]);
  if (tb[t] >= 0) pushed(tb[t], px, py, tpx[t], tpy[t]);
};
const made = (i, j, nx, ny, depth, px, py, ka, kb) => {
  if (m === cap) grow();
  const t = m++;
  ta[t] = i; tb[t] = j; tnx[t] = nx; tny[t] = ny; tdepth[t] = depth; tpx[t] = px; tpy[t] = py; tka[t] = ka; tkb[t] = kb;
  const vn = along(t, nx, ny);
  tbounce[t] = vn < -0.4 ? -0.3 * vn : 0.0;
  const p = kept.get(key(ka, kb));
  tpn[t] = p ? p[0] : 0.0; tpt[t] = p ? p[1] : 0.0;
};
const wanted = (t) => (tdepth[t] < 0.0 ? tdepth[t] / STEP : larger(12.0 * larger(tdepth[t] - 0.001, 0.0), tbounce[t]));
const applied = (t) => {
  const nx = tnx[t], ny = tny[t], vn = along(t, nx, ny), kn = massAlong(t, nx, ny);
  const pn = larger(tpn[t] + (kn === 0.0 ? 0.0 : (wanted(t) - vn) / kn), 0.0);
  impulse(t, (pn - tpn[t]) * nx, (pn - tpn[t]) * ny);
  const vt = along(t, 0.0 - ny, nx), kt = massAlong(t, 0.0 - ny, nx);
  let pt = tpt[t] - (kt === 0.0 ? 0.0 : vt / kt);
  const lo = 0.0 - FRICTION * pn, hi = FRICTION * pn;
  pt = pt < lo ? lo : pt > hi ? hi : pt;
  impulse(t, (tpt[t] - pt) * ny, (pt - tpt[t]) * nx);
  tpn[t] = pn; tpt[t] = pt;
};
const move = (to, from) => { id[to] = id[from]; x[to] = x[from]; y[to] = y[from]; ang[to] = ang[from]; vx[to] = vx[from]; vy[to] = vy[from]; spin[to] = spin[from]; r[to] = r[from]; };
const cell = REACH * (1 + 2 ** -20), r2 = REACH * REACH;
const cellOf = new Int32Array(n0), order = new Int32Array(n0), near = new Int32Array(n0);
let start = new Int32Array(1);
const log = [];
for (let tick = 1; tick <= T; tick++) {
  let k = 0;
  for (let i = 0; i < n; i++) {
    vy[i] = vy[i] - GRAVITY * STEP; spin[i] = spin[i] / (1.0 + DRAG * STEP); r[i] = r[i] - 0.00002;
    if (r[i] > 0.006) { if (k !== i) move(k, i); k++; }
  }
  n = k;
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(x[i] / cell), cy = Math.floor(y[i] / cell);
    if (i === 0 || cx < x0) x0 = cx;
    if (i === 0 || cx > x1) x1 = cx;
    if (i === 0 || cy < y0) y0 = cy;
    if (i === 0 || cy > y1) y1 = cy;
  }
  const w = x1 - x0 + 3, h = y1 - y0 + 3, cells = w * h;
  if (cells + 1 > start.length) start = new Int32Array(cells + 1); else start.fill(0, 0, cells + 1);
  for (let i = 0; i < n; i++) {
    cellOf[i] = (Math.floor(y[i] / cell) - y0 + 1) * w + (Math.floor(x[i] / cell) - x0 + 1);
    start[cellOf[i] + 1]++;
  }
  for (let c = 0; c < cells; c++) start[c + 1] += start[c];
  for (let i = n - 1; i >= 0; i--) order[--start[cellOf[i] + 1]] = i;
  m = 0;
  for (let i = 0; i < n; i++) {
    const ar = r[i], ax = x[i], ay = y[i];
    const ahead = larger(0.0 - vy[i], 0.0) * STEP + Math.abs(spin[i]) * ar * STEP;
    if (ay - ar < SILL + ahead) made(i, -1, 0.0, -1.0, SILL - ay + ar, ax, ay - ar, id[i], -3);
    if (ax < ar) made(i, -1, -1.0, 0.0, ar - ax, ax - ar, ay, id[i], -1);
    if (ax + ar > WIDTH) made(i, -1, 1.0, 0.0, ax + ar - WIDTH, ax + ar, ay, id[i], -2);
    let q = 0;
    const c = cellOf[i];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const e = c + dy * w + dx, end = e + 2 <= cells ? start[e + 2] : n;
      for (let s = start[e + 1]; s < end; s++) {
        const j = order[s];
        if (j <= i) continue;
        const ox = ax - x[j], oy = ay - y[j];
        if (!(r2 < ox * ox + oy * oy)) { let p = q++; while (p > 0 && near[p - 1] > j) { near[p] = near[p - 1]; p--; } near[p] = j; }
      }
    }
    for (let p = 0; p < q; p++) {
      const j = near[p];
      const dx = x[j] - ax, dy = y[j] - ay, d = Math.sqrt(dx * dx + dy * dy), depth = ar + r[j] - d;
      const nx = d === 0.0 ? 0.0 : dx / d, ny = d === 0.0 ? 1.0 : dy / d;
      if (!(depth <= 0.0)) made(i, j, nx, ny, depth, ax + nx * (ar - depth / 2.0), ay + ny * (ar - depth / 2.0), id[i], id[j]);
    }
  }
  for (let t = m - 1; t >= 0; t--) impulse(t, tpn[t] * tnx[t] - tpt[t] * tny[t], tpn[t] * tny[t] + tpt[t] * tnx[t]);
  for (let pass = 0; pass < 10; pass++) for (let t = m - 1; t >= 0; t--) applied(t);
  k = 0;
  for (let i = 0; i < n; i++) {
    x[i] = x[i] + vx[i] * STEP; y[i] = y[i] + vy[i] * STEP; ang[i] = ang[i] + spin[i] * STEP;
    if (x[i] > 0.0 - r[i] && x[i] < WIDTH + r[i]) { if (k !== i) move(k, i); k++; }
  }
  n = k;
  fresh.clear();
  for (let t = 0; t < m; t++) fresh.set(key(tka[t], tkb[t]), [tpn[t], tpt[t]]);
  [kept, fresh] = [fresh, kept];
  if (tick % 25 === 0) {
    let sum = 0.0;
    for (let i = n - 1; i >= 0; i--) sum = x[i] + y[i] + sum;
    log.push(`tick ${tick}: stones ${n}, checksum ${sum.toFixed(6)}`);
  }
}
console.log(log.join("\n"));
