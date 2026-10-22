// Builtins. They are ordinary nodes with stable ids, so user code refers to
// them exactly the way it refers to its own defs: by id. "+" is not syntax, it
// is one possible name for the node `builtin.add`.

import { FN } from "../../invertible/src/expr.js";
import type { Code, Id } from "./model.ts";
import type { Names } from "./presentation.ts";

const ops = ["add", "sub", "mul", "div", "neg", "sqrt", "pow", "sin", "cos", "tan", "atan2", "exp", "log"] as const;
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
  [B.sin]: "sin",
  [B.cos]: "cos",
  [B.tan]: "tan",
  [B.atan2]: "atan2",
  [B.exp]: "exp",
  [B.log]: "log",
};

// Arithmetic is defined once, in the solver's primitive table: how each
// operation evaluates, how it is undone in each argument, and its partial
// derivatives. Running forward uses `eval` from there; running backwards
// (src/lang/relate.ts) uses the inverses; differentiating a function
// (src/lang/derive.ts) uses the derivatives.
type Prim = { eval: (...xs: number[]) => number };
export const impl = Object.fromEntries(ops.map((op) => [op, (FN as unknown as Record<string, Prim>)[op].eval])) as Record<Op, (...xs: number[]) => number>;
