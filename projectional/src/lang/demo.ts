// Walks through the typed core with the two example programs.
// Run: node src/lang/demo.ts   (or npm run lang)

import { join } from "node:path";
import { root } from "../io.ts";
import { get, replace, type Id, type NodeOf } from "../model.ts";
import { fillings, infer, type Filling } from "./infer.ts";
import { loadProgram } from "./load.ts";
import { addVariant, fillHole } from "./refactor.ts";
import { renderBlocks } from "./render.ts";
import { runMain } from "./run.ts";
import { showType } from "./types.ts";

const section = (title: string) => console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
const indent = (s: string) => s.replace(/^/gm, "    ");

const queens = loadProgram(join(root, "examples/queens"));
const algebra = loadProgram(join(root, "examples/algebra"));
const qi = infer(queens.code, queens.pres.names);
const ai = infer(algebra.code, algebra.pres.names);

section("1. Eight queens: search is an effect (examples/queens)");
for (const d of ["queens", "safe", "keep", "main"]) console.log(indent(renderBlocks(queens.code, queens.pres, qi, queens.named(d))) + "\n");
console.log("  running main:");
runMain(queens.code, qi, queens.named("main"), { print: (s) => console.log("    > " + s) });

section("2. A tiny computer algebra system (examples/algebra)");
for (const d of ["expression", "derivative", "evaluate", "newton", "root near"]) console.log(indent(renderBlocks(algebra.code, algebra.pres, ai, algebra.named(d))) + "\n");
console.log("  running main:");
runMain(algebra.code, ai, algebra.named("main"), { print: (s) => console.log("    > " + s) });

const calculus = loadProgram(join(root, "examples/calculus"));
const ci = infer(calculus.code, calculus.pres.names);
section("2b. Calculus on real functions: derivative reads the graph (examples/calculus)");
for (const d of ["cubic", "cubic′", "kink′", "bump′", "∂polynomial/∂x", "sinc′", "root near"]) console.log(indent(renderBlocks(calculus.code, calculus.pres, ci, calculus.named(d))) + "\n");
console.log("  running main:");
runMain(calculus.code, ci, calculus.named("main"), { print: (s) => console.log("    > " + s) });

const back = loadProgram(join(root, "examples/backwards"));
const bi = infer(back.code, back.pres.names);
section("2c. Everyday functions run backwards (examples/backwards, BACKWARDS.md)");
for (const d of ["magnitudes to", "cuts", "read numbers", "square roots of each"]) console.log(indent(renderBlocks(back.code, back.pres, bi, back.named(d))) + "\n");
console.log("  running main:");
runMain(back.code, bi, back.named("main"), { print: (s) => console.log("    > " + s) });

section("3. What the editor can't let you write");
const names = algebra.pres.names;
const evaluate = get(algebra.code, get(algebra.code, algebra.named("evaluate"), "def").body!, "lambda");
const arm = get(algebra.code, evaluate.body, "fold").arms.map((a) => get(algebra.code, a, "arm")).find((a) => names[a.variant] === "sum")!;
const holed = replace(algebra.code, arm.body, () => ({ kind: "hole" }));
const hi = infer(holed, names);
const hole = hi.holes.get(arm.body)!;
const label = (f: Filling) => ("target" in f ? `${f.kind === "call" ? "call " : ""}${names[f.target] ?? f.target}` : f.kind === "lit" ? `a ${f.of}` : f.kind === "lambda" ? "a function" : `${f.kind} on ${names[f.on]}`);
console.log(`  Delete the body of evaluate's sum case. The hole needs ${showType(hole.expected, names)}; errors: ${hi.errors.length}.`);
console.log(`  The palette offers only what fits:\n    ${fillings(holed, hi, arm.body).map(label).join(", ")}`);
const forced = fillHole(holed, names, arm.body, { kind: "call", target: algebra.named("display"), arity: 1, type: hole.expected });
console.log(`  Forcing display(…) in anyway (not offered): ${infer(forced.code, forced.names).errors.map((e) => e.message).join("; ")}`);

const type = algebra.named("expression");
const sine = get(algebra.code, get(algebra.code, type, "def").body!, "typedef").variants.find((v) => names[v] === "sine")!;
const ofType = get(algebra.code, get(algebra.code, sine, "variant").fields[0], "field").type;
const added = addVariant(algebra.code, names, type, "tangent", [{ name: "of", type: ofType }]);
const ti = infer(added.code, added.names);
console.log(`\n  Add a case \`tangent\` to expression: ${ti.errors.length} errors, ${ti.holes.size} new holes, one in each fold that needs it:`);
for (const [id, h] of ti.holes) {
  const where = Object.values(added.code.nodes).find((n) => n.kind === "arm" && n.body === id) as NodeOf<"arm">;
  const owner = added.code.defs.find((d) => JSON.stringify(added.code.nodes[d]).length && contains(added.code, d, where.id));
  console.log(`    ${added.names[owner!]}: tangent(${where.binds.map((b) => added.names[b]).join(", ")}) with ${where.results.filter(Boolean).map((r) => added.names[r!]).join(", ")} → □ : ${showType(h.expected, added.names)}`);
}

const each = algebra.named("for each");
const lam = get(algebra.code, get(algebra.code, each, "def").body!, "lambda");
const rec = Object.values(algebra.code.nodes).find((n) => n.kind === "call" && algebra.code.nodes[n.fn].kind === "ref" && (algebra.code.nodes[n.fn] as NodeOf<"ref">).target === each && n.args[0] !== lam.params[0] && algebra.code.nodes[n.args[0]].kind === "ref") as NodeOf<"call">;
const looped = replace(algebra.code, rec.args[0], () => ({ kind: "ref", target: lam.params[0] }));
console.log(`\n  for each recurses on the rest of the list: ${showType(ai.typeOf.get(each)!, names)}`);
console.log(`  Make it recurse on the whole list instead:  ${showType(infer(looped, names).typeOf.get(each)!, names)}`);
console.log(`  and main, which uses it, becomes:           ${showType(infer(looped, names).typeOf.get(algebra.named("main"))!, names)}`);

function contains(code: typeof algebra.code, root: Id, id: Id): boolean {
  const n = code.nodes[root];
  if (root === id) return true;
  const kids = n.kind === "def" ? (n.body ? [n.body] : []) : n.kind === "lambda" ? [n.body] : n.kind === "call" ? [n.fn, ...n.args] : n.kind === "fold" || n.kind === "match" ? [n.scrutinee, ...n.arms] : n.kind === "arm" ? [n.body] : [];
  return kids.some((k) => contains(code, k, id));
}
