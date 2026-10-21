// Regenerates the typed example programs (examples/queens, examples/algebra)
// from src/lang/programs.ts. Ids are random, so each run gives a different
// but equivalent program; the committed JSON is the source of truth.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { root, save } from "../src/io.ts";
import { algebra, queens } from "../src/lang/programs.ts";

const comments: Record<string, Record<string, string>> = {
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

for (const [dir, build] of [["queens", queens], ["algebra", algebra]] as const) {
  const p = build();
  const d = join(root, "examples", dir);
  mkdirSync(d, { recursive: true });
  const byName = Object.fromEntries(Object.entries(p.names).map(([id, n]) => [n, id]));
  const notes = Object.fromEntries(Object.entries(comments[dir]).map(([n, c]) => [byName[n], c]));
  save(join(d, "code.json"), p.code);
  save(join(d, "names.default.json"), p.names);
  save(join(d, "comments.json"), notes);
}
