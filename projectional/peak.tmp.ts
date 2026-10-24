import { readWav } from "./cli/wav.ts";
import { readFileSync } from "node:fs";
for (const f of process.argv.slice(2)) { const s = readWav(readFileSync(f)).samples; let p = 0, e = 0; for (const x of s) { p = Math.max(p, Math.abs(x)); e += x * x; } console.log(f, s.length, "peak", p.toFixed(3), "rms", Math.sqrt(e / s.length).toFixed(3)); }
