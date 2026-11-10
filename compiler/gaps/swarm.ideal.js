// swarm, written by hand as a data-oriented C developer would
// (examples/swarm, BACKLOG C58): the motes as columns in birth order (so
// in key order, as the Map's keys are listed), compacted as they die, and
// a table from key to place for following. Same answers as the program.
//   node compiler/gaps/swarm.ideal.js [ticks] [born]
const ticks = Number(process.argv[2] ?? 2000), k = Number(process.argv[3] ?? 50);
const t0 = performance.now();
const random = (s) => (s * 16807) % 2147483647;
let cap = 1024, n = 0, next = 0, seed = 1;
let x = new Float64Array(cap), life = new Int32Array(cap), follows = new Int32Array(cap), key = new Int32Array(cap);
let where = new Int32Array(ticks * k + 1).fill(-1);
const grow = () => {
  cap *= 2;
  const nx = new Float64Array(cap); nx.set(x); x = nx;
  const nl = new Int32Array(cap); nl.set(life); life = nl;
  const nf = new Int32Array(cap); nf.set(follows); follows = nf;
  const nk = new Int32Array(cap); nk.set(key); key = nk;
};
for (let t = 0; t < ticks; t++) {
  // Moved in key order; a mote follows its leader as the leader is now.
  let w = 0;
  for (let i = 0; i < n; i++) {
    if (life[i] === 0) { where[key[i]] = -1; continue; }
    const f = follows[i] >= 0 ? where[follows[i]] : -1;
    const fx = f >= 0 ? x[f] : x[i];
    x[w] = x[i] + (fx - x[i]) * 0.5; life[w] = life[i] - 1; follows[w] = follows[i]; key[w] = key[i]; where[key[w]] = w;
    w++;
  }
  n = w;
  for (let j = 0; j < k; j++) {
    if (n === cap) grow();
    const r = random(seed);
    x[n] = r % 1000; life[n] = 20 + (r % 40); follows[n] = next - 1 - (random(r) % 30); key[n] = next; where[next] = n;
    n++; next++; seed = random(r);
  }
}
console.log(`${n} motes after ${ticks} ticks, ${next} made`, `(${(performance.now() - t0).toFixed(0)} ms)`);
