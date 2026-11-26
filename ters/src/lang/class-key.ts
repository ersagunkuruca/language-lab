// A program as a pass that never reads the numbers, texts or truth values
// written in it sees it (the incremental compile, plan doc "Incremental
// compile after edits"): every node but the library's as the library has
// it, a number only by whether it is whole, its sign and whether it is 0
// (what the check may tell from it), no text or truth value. A pass keeps
// what it found by this and what else it reads (the check's options), so
// an edit of a number (the editor's drag) finds it again.
import { changedOwn, nodeValues, sameValue, type Code, type Node } from "../model.ts";
import { LIBRARY } from "./library.ts";
import { sameValueReads, valueRead } from "./value-reads.ts";

// The last key made for each `also`: a program that differs from the one
// it was made for only in some literals' values, each in the class it had
// and none read for its value, has that key (machine's number edit walked
// all its nodes for it, 12 ms).
const last = new Map<string, { code: Code; key: string }>();

export function classKey(code: Code, also: unknown): string {
  const alsoText = JSON.stringify(also), was = last.get(alsoText);
  if (was && sameClasses(was.code, code)) {
    sameValueReads(was.code, code);
    last.set(alsoText, { code, key: was.key });
    return was.key;
  }
  const key = classKeyIn(code, also);
  if (last.size >= 16 && !last.has(alsoText)) last.clear();
  last.set(alsoText, { code, key });
  return key;
}
const litClass = (v: unknown) => (typeof v === "number" ? (Object.is(v, -0) ? "-0" : `${Number.isInteger(v) ? "i" : "f"}${Math.sign(v)}`) : typeof v);
function sameClasses(a: Code, b: Code): boolean {
  if (a === b) return true;
  if (a.defs !== b.defs && (a.defs.length !== b.defs.length || a.defs.some((d, i) => d !== b.defs[i]))) return false;
  const changed = changedOwn(a.nodes, b.nodes);
  if (!changed) return false;
  const read = valueRead(a);
  return changed.every((id) => {
    const x = a.nodes[id], y = b.nodes[id];
    return x?.kind === "lit" && y?.kind === "lit" && !read(id) && litClass(x.value) === litClass(y.value) && sameValue({ ...x, value: y.value }, y);
  });
}

function classKeyIn(code: Code, also: unknown): string {
  const own: Node[] = [];
  // Listed as model.ts lists a version's nodes (TERS_CHECK_NODES refuses `in`).
  for (const n of nodeValues(code.nodes)) if (LIBRARY.code.nodes[n.id] !== n) own.push(n);
  // (A literal a pass reads the value of, by its value: value-reads.ts.)
  const read = valueRead(code);
  return JSON.stringify([code.defs, own, also], function (this: { kind?: string; id?: string }, k, v) {
    if (k !== "value" || this.kind !== "lit") return v;
    if (this.id !== undefined && read(this.id)) return v;
    return litClass(v);
  });
}

// The check's options as a key reads them: its cache left out, sets in order.
export const optionsText = (o: unknown) => JSON.stringify(o ?? {}, (k, v) => (k === "cache" ? undefined : v instanceof Set ? [...v].sort() : v));
// Two checks' options the same as optionsText reads them, an option held
// by both not written out (the library's pins, a few hundred kilobytes).
export function sameOptions(a: object | undefined, b: object | undefined): boolean {
  const x = (a ?? {}) as Record<string, unknown>, y = (b ?? {}) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (k === "cache" || x[k] === y[k]) continue;
    if (optionsText({ [k]: x[k] }) !== optionsText({ [k]: y[k] })) return false;
  }
  return true;
}
