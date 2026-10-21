// Everything that is not semantics. Each layer is a side table keyed by node
// id, stored in its own file, and can be swapped per person without touching
// code.json.

import type { Id } from "./model.ts";

// Display names. Binders and defs need one to be readable; any expression node
// may have one too, which the let view uses as the temporary's name and the
// graph view uses as a wire label. Free text: spaces, symbols, any script.
export type Names = Record<Id, string>;

// Free-text notes attached to a node (not to a line, since there are no lines).
export type Comments = Record<Id, string>;

// Non-semantic hints for tools: evaluation strategy, batch size, memoization.
// Kept out of code.json for the same reason comments are.
export type Hints = Record<Id, Record<string, unknown>>;

// How a function is written when called. Precedence and associativity are a
// property of the notation someone chose, not of the language.
export interface Notation {
  glyph: string;
  fixity: "infix" | "prefix" | "call";
  prec?: number;
  assoc?: "left" | "right" | "both";
}

export interface Style {
  view: "nested" | "let" | "sexpr" | "graph" | "blocks";
  notation: Record<Id, Notation>;
  // How to show a name that wouldn't survive in a plain-text language.
  quote?: [string, string];
  comments?: boolean;
}

export interface Presentation {
  names: Names;
  comments: Comments;
  hints: Hints;
  style: Style;
}

// Rename is a presentation edit: the result is a new names table, nothing else.
export function rename(names: Names, id: Id, name: string): Names {
  return { ...names, [id]: name };
}

export function layer<T extends object>(...tables: (T | undefined)[]): T {
  return Object.assign({}, ...tables);
}
