// Walks through the ideas using the example programs. Run: node src/demo.ts

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { hashDef } from "./hash.ts";
import { loadCode, loadPresentation, root } from "./io.ts";
import { dependencies, get, replace, subtree, type Code, type Id } from "./model.ts";
import { rename, type Presentation } from "./presentation.ts";
import { B } from "./prelude.ts";
import { renderGraph } from "./render/graph.ts";
import { renderLet } from "./render/letseq.ts";
import { renderNested } from "./render/nested.ts";
import { renderSexpr } from "./render/sexpr.ts";
import { renderBlocks } from "./lang/render.ts";
import { infer } from "./lang/infer.ts";
import { makeRunner } from "./lang/run.ts";

// A definition as a plain JS function: its first result. There is one
// evaluator (src/lang/run.ts); this is just a way to call it.
const evaluate = (code: Code, def: Id) => {
  const r = makeRunner(code, infer(code), { print: () => {} });
  return (...args: number[]) => { for (const v of r.call(r.value(def), ...args)) return v; throw new Error("no result"); };
};

const views = { nested: renderNested, let: renderLet, sexpr: renderSexpr, graph: renderGraph, blocks: (c: Code, p: Presentation, d: Id) => renderBlocks(c, p, null, d) };
const render = (code: Code, pres: Presentation, def: Id) => views[pres.style.view](code, pres, def);
const show = (code: Code, pres: Presentation, defs: Id[]) =>
  defs.map((d) => render(code, pres, d)).join("\n\n").replace(/^/gm, "    ");
const section = (title: string) => console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

// 1. Same tree, two shapes
{
  const dir = join(root, "examples/archive/compose");
  const code = loadCode(dir);
  const a = code.defs.at(-1)!;
  section("1. One tree, two shapes (examples/archive/compose)");
  console.log("  nested view:");
  console.log(show(code, loadPresentation(dir, { names: ["default"], style: "math" }), [a]));
  console.log("\n  let view:");
  console.log(show(code, loadPresentation(dir, { names: ["default"], style: "plain" }), [a]));
  console.log("\n  s-expression view:");
  console.log(show(code, loadPresentation(dir, { names: ["default"], style: "lisp" }), [a]));
}

// 2. Same code, different people
const dir = join(root, "examples/quadratic");
const codeText = readFileSync(join(dir, "code.json"), "utf8");
const code = loadCode(dir);
const [disc, x] = code.defs;
const mathPres = loadPresentation(dir, { names: ["short"], style: "math" });
const plainPres = loadPresentation(dir, { names: ["short", "descriptive"], style: "plain" });
{
  section("2. One code.json, three people's presentations (examples/quadratic)");
  console.log("  short names + math notation, nested:");
  console.log(show(code, mathPres, [disc, x]));
  console.log("\n  descriptive names + ASCII operators, let view:");
  console.log(show(code, plainPres, [disc, x]));
  console.log("\n  lisp:");
  console.log(show(code, loadPresentation(dir, { names: ["short"], style: "lisp" }), [disc, x]));
  console.log("\n  node graph (Mermaid), for x₊:");
  console.log(show(code, loadPresentation(dir, { names: ["short"], style: "graph" }), [x]));
}

// 3. Rename is not an edit to the program
{
  section("3. Renaming touches only the names layer");
  const lam = get(code, get(code, x, "def").body!, "lambda");
  const b = lam.params[1];
  const before = { hash: hashDef(code, x), value: evaluate(code, x) };
  const renamed = { ...plainPres, names: rename(plainPres.names, b, "how steep it is at zero") };
  console.log(show(code, renamed, [x]));
  console.log(`
    code.json sha256        ${sha(codeText)}  (file not touched)
    semantic hash of root   ${before.hash} -> ${hashDef(code, x)}
    root(1, -3, 2)          ${before.value(1, -3, 2)}`);
}

// 4. Two variables with the same name are still two variables
{
  section("4. Name collisions are a display problem, not a semantic one");
  const lam = get(code, get(code, disc, "def").body!, "lambda");
  const [a, b, c] = lam.params;
  let names = rename(mathPres.names, a, "k");
  names = rename(names, b, "k");
  names = rename(names, c, "k");
  const pres = { ...mathPres, names };
  console.log(show(code, pres, [disc]));
  const f = evaluate(code, disc);
  console.log(`\n    all three binders named "k"; Δ(1, -3, 2) is still ${f(1, -3, 2)}`);
}

// 5. Comments and hints hang off node ids, so they survive edits
{
  section("5. A semantic edit elsewhere leaves comments attached");
  const lam = get(code, get(code, x, "def").body!, "lambda");
  // Find the "2" literal in the denominator and turn 2·a into a + a.
  const two = subtree(code, lam.body).find((id) => { const n = code.nodes[id]; return n.kind === "lit" && n.value === 2; })!;
  const den = subtree(code, lam.body).find((id) => { const n = code.nodes[id]; return n.kind === "call" && n.args.includes(two); })!;
  const edited = replace(code, den, (c) => {
    const ref = (t: Id) => { const id = `e${Object.keys(c.nodes).length}`; c.nodes[id] = { id, kind: "ref", target: t }; return id; };
    return { kind: "call", fn: ref(B.add), args: [ref(lam.params[0]), ref(lam.params[0])] };
  });
  console.log(show(edited, plainPres, [x]));
  const f = evaluate(edited, x);
  console.log(`
    the step keeps its name "denominator" and the sqrt step keeps its comment,
    because both are keyed by node id, not by line number.
    semantic hash ${hashDef(code, x)} -> ${hashDef(edited, x)} (this one did change the tree)
    root(1, -3, 2) still ${f(1, -3, 2)}`);
}

// 6. A package is a closure over ids
{
  section("6. Dependencies are just the refs a def reaches");
  const names = (ids: Id[]) => ids.map((id) => plainPres.names[id] ?? id).join(", ");
  console.log(`    root needs: ${names(dependencies(code, x))}`);
  console.log(`    by hash:    ${dependencies(code, x).filter((id) => code.nodes[id].kind === "def").map((id) => hashDef(code, id)).join(", ")}`);
  console.log(`    hints kept beside the code, never in it: ${JSON.stringify(plainPres.hints)}`);
}
