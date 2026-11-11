// Measured for BACKLOG C209 (2026-11-11): node compiler/gaps/herd.shared.mjs [ticks] [born], T=0 for one thread.
// herd by hand in JS: columns (x, y, life, leader, alive) in a SharedArrayBuffer;
// each tick's new x/y computed on workers over runs of the live ids, applied here.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
const CAP = 1 << 15;
const mk = (sab) => ({ x: new Float64Array(sab, 0, CAP), y: new Float64Array(sab, 8 * CAP, CAP), nx: new Float64Array(sab, 16 * CAP, CAP), ny: new Float64Array(sab, 24 * CAP, CAP),
  life: new Int32Array(sab, 32 * CAP, CAP), leader: new Int32Array(sab, 36 * CAP, CAP), alive: new Uint8Array(sab, 40 * CAP, CAP), live: new Int32Array(sab, 41 * CAP, CAP), ctl: new Int32Array(sab, 45 * CAP, 8) });
const BYTES = 45 * CAP + 64;
const wander = (x, y, n) => { while (n--) x = x + Math.sin(y * 0.7 + x) * 0.01; return x; };
function step(c, lo, hi) {
  for (let k = lo; k < hi; k++) {
    const id = c.live[k], ax = c.x[id], ay = c.y[id], l = c.leader[id], ok = l >= 0 && c.alive[l];
    const lx = ok ? c.x[l] : ax, ly = ok ? c.y[l] : ay;
    c.nx[id] = wander(ax + (lx - ax) * 0.1, ay, 64); c.ny[id] = wander(ay + (ly - ay) * 0.1, ax, 64);
  }
}
const RUN = 64;
function work(c) { // ctl: 0 gen, 1 next run, 2 n live, 3 done count
  for (let k; (k = Atomics.add(c.ctl, 1, 1)) * RUN < c.ctl[2];) step(c, k * RUN, Math.min(c.ctl[2], (k + 1) * RUN));
}
if (!isMainThread) {
  const c = mk(workerData);
  let gen = 0;
  for (;;) { Atomics.wait(c.ctl, 0, gen); gen = Atomics.load(c.ctl, 0); work(c); Atomics.add(c.ctl, 3, 1); Atomics.notify(c.ctl, 3); }
} else {
  const T = Number(process.env.T ?? 3), sab = new SharedArrayBuffer(BYTES), c = mk(sab);
  const ws = Array.from({ length: T }, () => new Worker(new URL(import.meta.url), { workerData: sab }));
  ws.forEach((w) => w.unref());
  const n = Number(process.argv[2] ?? 200), kk = Number(process.argv[3] ?? 50);
  const rnd = (s) => Number((BigInt(s) * 16807n) % 2147483647n);
  let next = 0, seed = 1, nlive = 0;
  const t0 = performance.now();
  for (let t = 0; t < n; t++) {
    if (T && nlive > 256) {
      c.ctl[2] = nlive; Atomics.store(c.ctl, 1, 0); Atomics.store(c.ctl, 3, 0); Atomics.add(c.ctl, 0, 1); Atomics.notify(c.ctl, 0);
      work(c);
      for (let d; (d = Atomics.load(c.ctl, 3)) < T;) Atomics.wait(c.ctl, 3, d);
    } else step(c, 0, nlive);
    let m = 0;
    for (let k = 0; k < nlive; k++) { const id = c.live[k]; c.life[id]--; if (c.life[id] === 0) c.alive[id] = 0; else { c.x[id] = c.nx[id]; c.y[id] = c.ny[id]; c.live[m++] = id; } }
    nlive = m;
    for (let k = 0; k < kk; k++) {
      const r1 = rnd(seed), r2 = rnd(r1), r3 = rnd(r2);
      c.x[next] = r1 % 1000; c.y[next] = r2 % 1000; c.life[next] = 20 + r1 % 40; c.leader[next] = next - 1 - r3 % 30; c.alive[next] = 1; c.live[nlive++] = next; next++; seed = r3;
    }
  }
  let sum = 0; for (let k = 0; k < nlive; k++) sum += c.x[c.live[k]];
  console.log(`${nlive} animals after ${n} ticks, ${next} born, x total ${sum}`, (performance.now() - t0).toFixed(0), "ms");
  process.exit(0);
}
