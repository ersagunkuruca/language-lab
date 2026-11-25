// A program as a pass that never reads the numbers, texts or truth values
// written in it sees it (the incremental compile, plan doc "Incremental
// compile after edits"): every node but the library's as the library has
// it, a number only by whether it is whole, its sign and whether it is 0
// (what the check may tell from it), no text or truth value. A pass keeps
// what it found by this and what else it reads (the check's options), so
// an edit of a number (the editor's drag) finds it again.
import { nodeValues, type Code, type Node } from "../model.ts";
import { LIBRARY } from "./library.ts";
import { valueRead } from "./value-reads.ts";

export function classKey(code: Code, also: unknown): string {
  const own: Node[] = [];
  // Listed as model.ts lists a version's nodes (TERS_CHECK_NODES refuses `in`).
  for (const n of nodeValues(code.nodes)) if (LIBRARY.code.nodes[n.id] !== n) own.push(n);
  // (A literal a pass reads the value of, by its value: value-reads.ts.)
  const read = valueRead(code);
  return JSON.stringify([code.defs, own, also], function (this: { kind?: string; id?: string }, k, v) {
    if (k !== "value" || this.kind !== "lit") return v;
    if (this.id !== undefined && read(this.id)) return v;
    if (typeof v === "number") return Object.is(v, -0) ? "-0" : `${Number.isInteger(v) ? "i" : "f"}${Math.sign(v)}`;
    return typeof v;
  });
}

// The check's options as a key reads them: its cache left out, sets in order.
export const optionsText = (o: unknown) => JSON.stringify(o ?? {}, (k, v) => (k === "cache" ? undefined : v instanceof Set ? [...v].sort() : v));
