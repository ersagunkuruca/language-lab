import { writeWav } from "./cli/wav.ts";
import { writeFileSync } from "node:fs";
// Karplus–Strong plucked strings (Karplus and Strong, 1983): an E power chord, strummed
const rate = 48000, n = rate * 3, out = new Float64Array(n);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
[82.41, 123.47, 164.81].forEach((f, s) => {
  const len = Math.round(rate / f), buf = Float64Array.from({ length: len }, rnd); let i = 0;
  for (let t = Math.round(s * 0.03 * rate); t < n; t++) { const j = i % len, k = (i + 1) % len; const v = buf[j]; buf[j] = 0.996 * 0.5 * (buf[j] + buf[k]); out[t] += 0.12 * v; i++; }
});
writeFileSync(process.argv[2], writeWav({ rate, samples: out }));
