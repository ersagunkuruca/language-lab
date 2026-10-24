import { writeFileSync } from "node:fs";
// Karplus–Strong plucked strings (Karplus and Strong, 1983): an E power chord, strummed, 16-bit PCM
const rate = 24000, n = Math.round(rate * 2.5), out = new Float64Array(n);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
[82.41, 123.47, 164.81].forEach((f, s) => {
  const len = Math.round(rate / f), buf = Float64Array.from({ length: len }, rnd); let i = 0;
  for (let t = Math.round(s * 0.03 * rate); t < n; t++) { const j = i % len, k = (i + 1) % len; const v = buf[j]; buf[j] = 0.993 * 0.5 * (buf[j] + buf[k]); out[t] += 0.12 * v; i++; }
});
const b = Buffer.alloc(44 + 2 * n);
b.write("RIFF", 0); b.writeUInt32LE(36 + 2 * n, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16);
b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
b.write("data", 36); b.writeUInt32LE(2 * n, 40);
for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[i] * 32767))), 44 + 2 * i);
writeFileSync("examples/pedal/strum.wav", b);
