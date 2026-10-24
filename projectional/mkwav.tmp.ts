import { writeWav } from "/home/user/language-lab/projectional/cli/wav.ts";
import { writeFileSync } from "node:fs";
const rate = 48000, secs = Number(process.argv[3] ?? 1);
const s = Float64Array.from({ length: rate * secs }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 220 * i / rate));
writeFileSync(process.argv[2], writeWav({ rate, samples: s }));
