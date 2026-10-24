import { readWav } from "./cli/wav.ts";
import { readFileSync } from "node:fs";
const a = readWav(readFileSync("/tmp/claude-0/sine.wav")).samples, b = readWav(readFileSync(process.argv[2])).samples;
let pa = 0, pb = 0; for (let i = 0; i < a.length; i++) { pa = Math.max(pa, Math.abs(a[i])); pb = Math.max(pb, Math.abs(b[i])); }
console.log("peak in", pa.toFixed(4), "out", pb.toFixed(4), "samples", a.slice(100,104), b.slice(100,104));
