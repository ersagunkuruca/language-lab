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
  const alsoText = typeof also === "string" ? also : JSON.stringify(also), was = last.get(alsoText);
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
  const classed = function (this: { kind?: string; id?: string }, k: string, v: unknown) {
    if (k !== "value" || this.kind !== "lit") return v;
    if (this.id !== undefined && read(this.id)) return v;
    return litClass(v);
  };
  // Written out as JSON.stringify writes the whole, each node but a
  // literal written once (nodes are values: machine's key is a megabyte,
  // 16 ms a time written whole).
  const texts = own.map((n) => {
    if (n.kind === "lit") return JSON.stringify(n, classed);
    let t = nodeText.get(n);
    if (t === undefined) nodeText.set(n, (t = JSON.stringify(n, classed)));
    return t;
  });
  return `[${JSON.stringify(code.defs)},[${texts.join(",")}],${JSON.stringify(also, classed) ?? "null"}]`;
}
const nodeText = new WeakMap<Node, string>();

// The check's options as a key reads them: its cache left out, sets in order.
// Each option written out once for the value it holds (options are values,
// made anew and never changed: the library's pins, 230 kB written out, are
// the same object in every compile's options).
const optionText = new WeakMap<object, string>();
const textOf = (v: unknown) => JSON.stringify(v, (k, x) => (k === "cache" ? undefined : x instanceof Set ? [...x].sort() : x));
export const optionsText = (o: unknown): string => {
  if (!o || typeof o !== "object") return JSON.stringify(o ?? {});
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === "cache" || v === undefined || typeof v === "function" || typeof v === "symbol") continue;
    let t = v && typeof v === "object" ? optionText.get(v) : undefined;
    if (t === undefined) { t = textOf(v); if (v && typeof v === "object") optionText.set(v, t); }
    parts.push(`${JSON.stringify(k)}:${t}`);
  }
  // The same text as the last time, as the same string: a key read
  // through a Map (classKey's) is hashed once (machine's 300 kB, 5 ms a
  // time).
  const was = textsMade.find((m) => m.parts.length === parts.length && m.parts.every((x, i) => x === parts[i]));
  if (was) return was.text;
  const text = `{${parts.join(",")}}`;
  textsMade.unshift({ parts, text });
  textsMade.length = Math.min(textsMade.length, 8);
  return text;
};
const textsMade: { parts: string[]; text: string }[] = [];
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
