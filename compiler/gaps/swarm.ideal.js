// swarm, written by hand (examples/swarm): 100,000 motes moved by their
// velocity a hundred times, three ways: each record rebuilt, changed in
// place, and as columns (an array per field). node gaps/swarm.ideal.js [n]
const n = Number(process.argv[2] ?? 100000), K = 100;
const made = (i) => ({ x: Math.sin(i * 1.7) * 100, y: Math.cos(i * 2.3) * 100, vx: Math.sin(i * 0.31), vy: Math.cos(i * 0.17), mass: 1 + Math.sin(i) ** 2, red: 0.5, green: 0.25, blue: 0.75, name: "mote" });
const time = (name, f) => { const t = performance.now(); const r = f(); console.log(name.padEnd(10), (performance.now() - t).toFixed(0), "ms", r.toFixed(6)); };
time("rebuilt", () => { let ms = Array.from({ length: n }, (_, i) => made(i)); for (let k = 0; k < K; k++) ms = ms.map((m) => ({ ...m, x: m.x + m.vx, y: m.y + m.vy })); return ms.reduce((s, m) => s + m.x, 0); });
time("in place", () => { const ms = Array.from({ length: n }, (_, i) => made(i)); for (let k = 0; k < K; k++) for (const m of ms) { m.x += m.vx; m.y += m.vy; } return ms.reduce((s, m) => s + m.x, 0); });
time("columns", () => { const ms = Array.from({ length: n }, (_, i) => made(i)); const x = Float64Array.from(ms, (m) => m.x), y = Float64Array.from(ms, (m) => m.y), vx = Float64Array.from(ms, (m) => m.vx), vy = Float64Array.from(ms, (m) => m.vy); for (let k = 0; k < K; k++) for (let i = 0; i < n; i++) { x[i] += vx[i]; y[i] += vy[i]; } let s = 0; for (let i = 0; i < n; i++) s += x[i]; return s; });
