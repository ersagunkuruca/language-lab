// One program, two representations of its numbers (NUMBERS.md).
// Run: node src/lang/numbers-demo.ts   (or npm run numbers)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "../io.ts";
import { get, ID_PATTERN } from "../model.ts";
import { infer } from "./infer.ts";
import { loadProgram } from "./load.ts";
import { relate, showTerm } from "./relate.ts";
import { choose, represent, type Representation } from "./represent.ts";
import { renderBlocks } from "./render.ts";
import { runMain } from "./run.ts";

const section = (title: string) => console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
const indent = (s: string) => s.replace(/^/gm, "    ");
const dir = join(root, "examples/numbers");
const p = loadProgram(dir);
const reps: Representation[] = JSON.parse(readFileSync(join(dir, "representations.json"), "utf8"));
const names = p.pres.names;
const info = infer(p.code, names);
const show = (d: string, i = info, code = p.code) => console.log(indent(renderBlocks(code, p.pres, i, p.named(d))) + "\n");
const timed = (label: string, f: () => void) => { const t = performance.now(); f(); console.log(`    (${label}: ${(performance.now() - t).toFixed(1)} ms)`); };
const out = (s: string) => console.log("    > " + s);

section("1. The program: Peano naturals, written the mathematical way");
for (const d of ["Nat", "add", "multiply", "factorial", "is even"]) show(d);

section("2. A representation: binary, with what it means");
for (const d of ["Binary", "meaning", "add′", "match Nat′", "fold Nat′"]) show(d);

section("3. Choosing: the costs of the jobs main uses");
const c = choose(p.code, p.named("main"), reps);
const jobs = [...c.jobs, "space"];
const label = (j: string) => names[j] ?? j;
console.log("    " + ["", ...jobs.map(label)].map((s) => s.padEnd(10)).join(""));
for (const row of c.table) console.log("    " + [row.rep, ...jobs.map((j) => row.costs[j])].map((s) => s.padEnd(10)).join(""));
console.log(`\n    chosen: ${c.rep.name}`);

section("4. Running the same program both ways");
console.log("  small, in unary (the definition):");
timed("unary", () => runMain(p.code, info, p.named("small"), { print: out }));
const bin = represent(p.code, [p.named("main"), p.named("small")], c.rep);
const bi = infer(bin, names);
console.log("\n  small, in binary:");
timed("binary", () => runMain(bin, bi, p.named("small"), { print: out }));
console.log("\n  main, in binary (unary would need 6.4 quadrillion succ nodes for 18!):");
timed("binary", () => runMain(bin, bi, p.named("main"), { print: out }));
console.log("\n  factorial, after the change of representation (the same nodes, new types):");
show("factorial", bi, bin);

section("5. meaning run backwards encodes, canonical spelling first");
const [bits] = get(p.code, get(p.code, p.named("meaning"), "def").body!, "lambda").params;
const variant = (n: string) => Object.keys(names).find((k) => names[k] === n)!;
let six: unknown = { tag: variant("zero"), fields: [] };
for (let i = 0; i < 6; i++) six = { tag: variant("succ"), fields: [six] };
let i = 0;
for (const a of relate(p.code, p.named("meaning"), { out: six })) {
  console.log(`    ${i === 0 ? "canonical" : "also     "}  ${showTerm(a.values[bits]).replace(new RegExp(ID_PATTERN, "g"), (m) => names[m] ?? m)}`);
  if (++i === 3) break;
}
console.log("    (6 = 2·(2·(2·0 + 1) + 1); the others have leading zeros, which the representation's own functions never make)");
