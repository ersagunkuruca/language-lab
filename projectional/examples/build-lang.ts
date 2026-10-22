// Regenerates the typed example programs (examples/queens, examples/algebra,
// …) from src/lang/programs.ts. Ids are random, so each run gives a different
// but equivalent program; the committed JSON is the source of truth.
// Name programs to rebuild only those: node examples/build-lang.ts calculus

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { root, save } from "../src/io.ts";
import type { Code } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { differentiate } from "../src/lang/derive.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { algebra, backwards, calculus, queens, relations } from "../src/lang/programs.ts";

const comments: Record<string, Record<string, string>> = {
  calculus: {
    cubic: "An ordinary function. Its derivative cubic′ below was made by reading this graph, and derivative(f) does the same while the program runs.",
    "cubic′": "Generated from cubic: the chain rule at every node, with each operation's partial derivatives taken from the same table that evaluates and inverts it.",
    "kink′": "The derivative of an if is the same if with each arm differentiated.",
    "bump′": "A let differentiates to a let of the value and its slope.",
    "∂polynomial/∂x": "A fold differentiates to a fold that carries each partial result with its slope, as a pair.",
    "sinc′": "Where sinc fails (at 0), so does its derivative.",
    "zeros of cubic": "cubic run backwards from 0: the solver scans for every root, where Newton finds one.",
  },
  backwards: {
    "magnitudes to": "magnitude is an if; run backwards it is a choice over the two arms.",
    "who was greeted": "join text with the front known strips it off.",
    cuts: "join text with neither side known: every way to cut the text in two.",
    "read numbers": "show numbers is a fold that prints; run backwards it unfolds, so it parses. Unfolding might not end, which the type says (Diverge) until fuel bounds it.",
    "square roots of each": "map run backwards with its function known: every list whose squares these are.",
    "height on the ray": "atan2 run backwards: given the angle and x, the y on that ray, or none.",
  },
  relations: {
    split: "Linear elimination gives one answer, so the type has no Choice.",
    "to polar": "Two branches for the angle and length (plus 2πk): the type says Choice, first picks the canonical one.",
    "square roots": "square read backwards: x · x = y. all collects both roots, and none for a negative y.",
  },
  queens: {
    queens: "One row at a time: pick any column (one of), keep it only if it's safe (else fail). The handler decides whether that means the first board, all of them, or how many.",
    safe: "The fold returns a function of the distance to the row being placed, so each earlier queen is checked at its own distance.",
    keep: "filter, written as a choice: pick any item, fail unless it passes, collect what's left with all.",
  },
  algebra: {
    evaluate: "Total over the tree (a fold), but division by zero is a failure: the type says Choice.",
    derivative: "The fold binds each part and its derivative, so the product and quotient rules read like the textbook.",
    simplify: "first(() => …, () => …) is pattern matching by choice: try treating both sides as constants, else fall back.",
    newton: "Nothing here gets smaller, so the checker can't see that it ends. Its type carries Diverge.",
    "root near": "with fuel gives up after 100 steps: Diverge becomes Choice, which a caller can handle with first.",
  },
};

// calculus keeps the derivative of each sample next to it, generated.
function withDerivatives(p: { code: Code; names: Names; defs: Record<string, string> }, of: string[]) {
  let code = base(p.code);
  let names = baseNames(p.names);
  for (const name of of) {
    const d = differentiate(code, names, p.defs[name]);
    code = d.code;
    names = { ...names, ...d.names };
    Object.assign(p.names, d.names);
  }
  for (const [id, n] of Object.entries(code.nodes)) if (!(id in base({ nodes: {}, defs: [] }).nodes)) p.code.nodes[id] = n;
  p.code.defs = code.defs.filter((d) => p.code.nodes[d]);
  return p;
}

const all = [
  ["queens", queens], ["algebra", algebra], ["relations", relations], ["backwards", backwards],
  ["calculus", () => withDerivatives(calculus(), ["cubic", "wave", "kink", "bump", "parabola", "sinc"])],
] as const;
const only = process.argv.slice(2);
for (const [dir, build] of all) {
  if (only.length && !only.includes(dir)) continue;
  const p = build();
  const d = join(root, "examples", dir);
  mkdirSync(d, { recursive: true });
  const byName = Object.fromEntries(Object.entries(p.names).map(([id, n]) => [n, id]));
  const notes = Object.fromEntries(Object.entries(comments[dir]).map(([n, c]) => [byName[n], c]));
  save(join(d, "code.json"), p.code);
  save(join(d, "names.default.json"), p.names);
  save(join(d, "comments.json"), notes);
}
