// Measured for BACKLOG C209 (2026-11-11): node compiler/gaps/drift.shared.mjs [motes], T=0 for one thread.
// drift's step by hand: columns in a SharedArrayBuffer, each step's slots split over workers.
import { Worker, isMainThread, workerData } from "node:worker_threads";
const n = Number(process.argv[2] ?? 300000), K = 100;
const mk = (sab) => ({ x: new Float64Array(sab, 0, n), y: new Float64Array(sab, 8 * n, n), vx: new Float64Array(sab, 16 * n, n), vy: new Float64Array(sab, 24 * n, n), ctl: new Int32Array(sab, 32 * n, 8) });
const RUN = 4096;
const work = (c) => { for (let k; (k = Atomics.add(c.ctl, 1, 1)) * RUN < n;) { const hi = Math.min(n, (k + 1) * RUN); for (let i = k * RUN; i < hi; i++) { c.x[i] += c.vx[i]; c.y[i] += c.vy[i]; } } };
if (!isMainThread) {
  const c = mk(workerData); let gen = 0;
  for (;;) { Atomics.wait(c.ctl, 0, gen); gen = Atomics.load(c.ctl, 0); work(c); Atomics.add(c.ctl, 3, 1); Atomics.notify(c.ctl, 3); }
} else {
  const T = Number(process.env.T ?? 3), sab = new SharedArrayBuffer(32 * n + 64), c = mk(sab);
  const ws = Array.from({ length: T }, () => new Worker(new URL(import.meta.url), { workerData: sab, argv: [String(n)] }));
  for (let i = 0; i < n; i++) { c.x[i] = Math.sin(i * 1.7) * 100; c.y[i] = Math.cos(i * 2.3) * 100; c.vx[i] = Math.sin(i * 0.31); c.vy[i] = Math.cos(i * 0.17); }
  await new Promise((r) => setTimeout(r, 100));
  const t0 = performance.now();
  for (let k = 0; k < K; k++) {
    if (T) { Atomics.store(c.ctl, 1, 0); Atomics.store(c.ctl, 3, 0); Atomics.add(c.ctl, 0, 1); Atomics.notify(c.ctl, 0); work(c); for (let d; (d = Atomics.load(c.ctl, 3)) < T;) Atomics.wait(c.ctl, 3, d); }
    else { Atomics.store(c.ctl, 1, 0); work(c); }
  }
  let s = 0; for (let i = 0; i < n; i++) s += c.x[i];
  console.log(s, (performance.now() - t0).toFixed(0), "ms for the steps");
  process.exit(0);
}
