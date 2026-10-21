// Builtins. They are ordinary nodes with stable ids, so user code refers to
// them exactly the way it refers to its own defs: by id. "+" is not syntax, it
// is one possible name for the node `builtin.add`.

import type { Code, Id } from "./model.ts";
import type { Names } from "./presentation.ts";

const ops = ["add", "sub", "mul", "div", "neg", "sqrt", "pow"] as const;
export type Op = (typeof ops)[number];

export const B = Object.fromEntries(ops.map((op) => [op, `builtin.${op}`])) as Record<Op, Id>;

export const prelude: Code = {
  nodes: Object.fromEntries(ops.map((op) => [B[op], { id: B[op], kind: "builtin", op }])),
  defs: [],
};

export const preludeNames: Names = {
  [B.add]: "add",
  [B.sub]: "subtract",
  [B.mul]: "multiply",
  [B.div]: "divide",
  [B.neg]: "negate",
  [B.sqrt]: "square root",
  [B.pow]: "power",
};

export const impl: Record<Op, (...xs: number[]) => number> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  neg: (a) => -a,
  sqrt: (a) => Math.sqrt(a),
  pow: (a, b) => a ** b,
};
