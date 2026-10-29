// routes compiled on trees, then edited by hand one gap at a time (GAPS.md
// round 5, M3 to M7), each edit on top of the ones before, to measure what
// each fix would buy before anyone writes it. Each edited program must
// still print what the ideal prints. The edits are regular expressions
// over the compiled file, so a change to the compiler can make one stop
// matching: it then says so and stops.
// Run: node gaps/bench-routes-edits.ts

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { country, treesSource } from "./routes.ts";
import { routes as ideal } from "./routes.ideal.js";
import { $setPrint, $setWorld, $toList } from "../src/runtime.js";

const dir = mkdtempSync(join(tmpdir(), "routes-edits-"));
const src = treesSource();
const SET_BIN = "@6oq1tkustaa02pvgr5nh90a5ci:4", MAP_BIN = "@p9rseik1jjr9eq5ir8ehhlt035:5";
type Edit = [string, (s: string) => string];
const edits: Edit[] = [
  ["E1 smallest, not items of", (s) => s.replace(/const (s\$\d+) = set_tree_list\((s2\.fields\[0\])\);/, (_m, v, fr) => `const ${v} = ${fr}.tag === "${SET_BIN}" ? { tag: "std.list.cons", fields: [set_tree_smallest(${fr}.fields[2], ${fr}.fields[1]), null] } : $nil;`)],
  ["E2 compare at its type", (s) => s.replace(/\$compare\(([^,()]+), ([^,()]+), \$order\)/g, "$cmp($1, $2)") + `
const $B = { tag: "std.order.before", fields: [] }, $S = { tag: "std.order.same", fields: [] }, $A = { tag: "std.order.after", fields: [] };
function $cmp(a, b) {
  if (typeof a === "string") return a < b ? $B : a === b ? $S : $A;
  if (typeof a === "number") return a < b ? $B : a === b ? $S : $A;
  if (a.tag === "std.pair.pair") { const x = a.fields[0], y = b.fields[0]; if (x !== y) return x < y ? $B : $A; const p = a.fields[1], q = b.fields[1]; return p < q ? $B : p === q ? $S : $A; }
  return $compare(a, b, $order);
}`],
  ["E3 no depth counting", (s) => s.replace(/  if \(\$rec\.d > 1000\) return \$drive\(([a-z_0-9]+)\$h\(([^)]*)\)\);\n  \$rec\.d\+\+;\n  const r\$ = \1\$b\(\2\);\n  \$rec\.d--;\n  return r\$;/g, (_m, f, a) => `  return ${f}$b(${a});`)],
  ["E4 value at as a loop", (s) => s.replace(/\/\/ tree value at\nfunction tree_value_at\(tree8, key9\) \{[\s\S]*?\n\}\n/, `// tree value at
function tree_value_at(t, key) {
  for (;;) {
    if (t.tag !== "${MAP_BIN}") return $no;
    const c = $cmp(key, t.fields[1]);
    if (c === $S) return t.fields[2];
    t = c === $B ? t.fields[3] : t.fields[4];
  }
}
`)],
  ["E5 improve looks up once", (s) => s.replace(/\/\/ improve\nfunction improve\(s4, town9, km7, via\) \{[\s\S]*?\n\}\n/, `// improve
function improve(s4, town9, km7, via) {
  const old = tree_value_at(s4.fields[1], town9);
  if (old === $no || km7 < old.fields[0]) {
    const f = old === $no ? s4.fields[0] : set_tree_remove(s4.fields[0], { tag: "std.pair.pair", fields: [old.fields[0], town9] });
    return { tag: "uj8ch4qv8qo2ffc6m6e4p0juev", fields: [set_tree_add(f, { tag: "std.pair.pair", fields: [km7, town9] }), tree_put(s4.fields[1], town9, { tag: "ge7fkg5aahbes53o6mse1m6m3g", fields: [km7, via] })] };
  }
  return s4;
}
`)],
];
const files: Record<string, string> = { 1000: country(1000), 3000: country(3000) };
// The ideal's time, best of 15, once per size, so every row is divided by
// the same number.
const idealMs: Record<number, number> = {};
async function measure(label: string, js: string, n: number) {
  const p = join(dir, `${label.slice(0, 2)}-${n}.mjs`);
  writeFileSync(p, js);
  const main = (await import(pathToFileURL(p).href)).defs.main;
  const io = { readFile: () => files[n], print: (s: string) => out.push(s), printError: (s: string) => err.push(s) };
  let out: string[] = [], err: string[] = [];
  $setWorld({ readFile: () => files[n], error: (l: string) => err.push(l) } as any);
  $setPrint((s: string) => out.push(s));
  const run = () => { out = []; err = []; return main($toList(["c.txt"])); };
  run(); const got = out;
  const want: string[] = []; ideal(["c.txt"], { ...io, print: (s: string) => want.push(s) });
  assert.deepEqual(got, want, label);
  const ts = []; for (let i = 0; i < 7; i++) { const t = performance.now(); run(); ts.push(performance.now() - t); }
  if (!idealMs[n]) {
    const it = []; for (let i = 0; i < 15; i++) { const t = performance.now(); ideal(["c.txt"], { ...io, print: () => {} }); it.push(performance.now() - t); }
    idealMs[n] = Math.min(...it);
  }
  const a = Math.min(...ts), b = idealMs[n];
  console.log(`${label.padEnd(28)} ${n} towns: ${a.toFixed(1)} ms, ideal ${b.toFixed(2)} ms, ${(a / b).toFixed(1)}×`);
}
for (const n of [1000, 3000]) {
  let js = src;
  await measure("E0 as compiled", js, n);
  for (const [label, f] of edits) { const before = js; js = f(js); if (js === before) throw new Error(`${label} changed nothing`); await measure(label, js, n); }
}
