// Compiles the example programs of projectional/examples to out/*.js.
// Run: node build.ts   (or npm run build)

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileProgram } from "./src/program.ts";

const programs: Record<string, string[]> = {
  queens: ["main", "queens"],
  algebra: ["main"],
  relations: ["main", "split", "to polar", "square roots"],
};

for (const [name, exports] of Object.entries(programs)) {
  const source = compileProgram(name, exports, "../src/runtime.js");
  writeFileSync(join(import.meta.dirname, "out", `${name}.js`), source);
  console.log(`out/${name}.js: ${source.split("\n").length} lines`);
}
