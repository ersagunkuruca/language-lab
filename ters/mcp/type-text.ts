// A type written as the MCP's view prints it, read back into type nodes
// (I183): `Float64`, `Float64 m/s` (a unit, L252), `List Ball`, `(a, Ball, Float64) -> Float64`,
// `(a) -[Choice]-> Float64`, `Set (Text, Int)` (a tuple's parts in
// parentheses with no arrow after them). A name is a builtin type, a data type or
// effect the program or the library defines, or one of `params` (the
// interface's `a`, a type's own parameters); a name of several words is
// read as the longest that names one.

import type { Code, Id, NodeData } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { tupleType } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import { parseUnit } from "../src/units.ts";

export type Build = (add: (n: NodeData) => Id) => Id;

type Tok = { t: "(" | ")" | "," | "->" | "word"; s: string; effects?: string[] };

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(-\[([^\]]*)\]->)|(->|→)|([(),])|([^\s(),\-→]+))/y;
  let m: RegExpExecArray | null;
  let at = 0;
  while (at < text.length && (re.lastIndex = at, (m = re.exec(text)))) {
    if (m[1]) out.push({ t: "->", s: m[1], effects: m[2].split(",").map((x) => x.trim()).filter(Boolean) });
    else if (m[3]) out.push({ t: "->", s: m[3] });
    else if (m[4]) out.push({ t: m[4] as "(" | ")" | ",", s: m[4] });
    else if (m[5]) out.push({ t: "word", s: m[5] });
    at = re.lastIndex;
    if (!text.slice(at).trim()) break;
  }
  if (text.slice(at).trim()) throw new Error(`can't read the type at "${text.slice(at).trim()}"`);
  return out;
}

// The types a name can mean: builtins (Float64, Int, Text, Choice), the
// program's and the library's data types and effects, the program's first.
export function typeNames(code: Code, names: Names, own: Id[]): Map<string, Id> {
  const out = new Map<string, Id>();
  const put = (id: Id) => { const n = names[id]; if (n && !out.has(n)) out.set(n, id); };
  for (const d of own) if (code.nodes[(code.nodes[d] as { body?: Id }).body ?? ""]?.kind === "typedef") put(d);
  for (const d of code.defs) if (code.nodes[(code.nodes[d] as { body?: Id }).body ?? ""]?.kind === "typedef") put(d);
  for (const [id, n] of Object.entries(code.nodes)) if (n.kind === "builtin" && /^(type|effect)\./.test(id)) put(id);
  return out;
}

export function readType(text: string, known: Map<string, Id>, params: Map<string, Id> = new Map()): Build {
  const ts = tokens(text);
  let i = 0;
  const peek = () => ts[i];
  const want = (t: Tok["t"]) => { if (peek()?.t !== t) throw new Error(`expected ${t === "word" ? "a type" : t} in ${text}`); return ts[i++]; };
  const lookup = (s: string): Id | undefined => params.get(s) ?? known.get(s);
  const effect = (s: string) => { const id = known.get(s); if (!id) throw new Error(`no effect ${s}`); return id; };
  // Types in parentheses, the `(` read: one is that type, several a tuple
  // of them (`(Text, Int)`, I217 M1).
  const grouped = (): Build => {
    const parts = [whole()];
    while (peek()?.t === ",") { i++; parts.push(whole()); }
    want(")");
    if (parts.length === 1) return parts[0];
    return (add) => add({ kind: "tref", target: tupleType(parts.length), args: parts.map((p) => p(add)) });
  };
  // A name, then its arguments: single words or types in parentheses, in
  // any order (`Map (Tuple2 Text Int) Text`).
  const applied = (): Build => {
    if (peek()?.t === "(") {
      i++;
      return grouped();
    }
    const words: string[] = [];
    while (peek()?.t === "word") words.push(ts[i++].s);
    if (!words.length) throw new Error(`expected a type in ${text}`);
    let n = words.length;
    while (n > 0 && !lookup(words.slice(0, n).join(" "))) n--;
    if (!n) throw new Error(`no type named ${words.join(" ")}`);
    const head = lookup(words.slice(0, n).join(" "))!;
    // A unit after Float64 (`Float64 m/s`, L252): a word that names no type
    // and reads as a unit.
    const unit = head === NUMBER && words.length === n + 1 ? parseUnit(words[n]) : null;
    if (unit) return (add) => add({ kind: "tref", target: head, args: [], unit });
    const args: Build[] = words.slice(n).map((w) => { const id = lookup(w); if (!id) throw new Error(`no type named ${w}`); return (add) => add({ kind: "tref", target: id, args: [] }); });
    for (;;) {
      if (peek()?.t === "(") { i++; args.push(grouped()); continue; }
      const w = peek()?.t === "word" ? lookup(ts[i].s) : undefined;
      if (!w) break;
      i++;
      args.push((add) => add({ kind: "tref", target: w, args: [] }));
    }
    return (add) => add({ kind: "tref", target: head, args: args.map((a) => a(add)) });
  };
  // `(x, y) -> z`, `x -> z`, or a type alone.
  const whole = (): Build => {
    let ins: Build[];
    if (peek()?.t === "(") {
      const save = i;
      i++;
      ins = [];
      if (peek()?.t !== ")") { ins.push(whole()); while (peek()?.t === ",") { i++; ins.push(whole()); } }
      want(")");
      if (peek()?.t !== "->") {
        // Several with no arrow: a tuple, which may be given arguments
        // no further.
        if (ins.length > 1) { const parts = ins; return (add) => add({ kind: "tref", target: tupleType(parts.length), args: parts.map((p) => p(add)) }); }
        if (ins.length !== 1) throw new Error(`a list of types needs -> after it in ${text}`);
        i = save;
        ins = [applied()];
        if (peek()?.t !== "->") return ins[0];
      }
    } else {
      ins = [applied()];
      if (peek()?.t !== "->") return ins[0];
    }
    const arrow = want("->");
    const out = whole();
    const effects = (arrow.effects ?? []).map(effect);
    const params = ins;
    return (add) => add({ kind: "tfun", params: params.map((p) => p(add)), result: out(add), ...(effects.length ? { effects } : {}) });
  };
  const t = whole();
  if (i < ts.length) throw new Error(`can't read the type at "${ts.slice(i).map((x) => x.s).join(" ")}"`);
  return t;
}

// `ball(number: Int, place: Vec)`: a case's name and its fields' types.
export function readCase(text: string): { name: string; fields: [string, string][] } {
  const m = /^([^(]+?)\s*(?:\((.*)\))?\s*$/s.exec(text.trim());
  if (!m) throw new Error(`write a case as name(field: Type, …)`);
  const fields: [string, string][] = [];
  if (m[2]?.trim()) {
    // Split on commas outside parentheses and arrows' brackets.
    let depth = 0, from = 0;
    const s = m[2];
    const parts: string[] = [];
    for (let k = 0; k < s.length; k++) {
      if (s[k] === "(" || s[k] === "[") depth++;
      else if (s[k] === ")" || s[k] === "]") depth--;
      else if (s[k] === "," && !depth) { parts.push(s.slice(from, k)); from = k + 1; }
    }
    parts.push(s.slice(from));
    for (const p of parts) {
      const c = p.indexOf(":");
      if (c < 0) throw new Error(`a field is name: Type, not ${p.trim()}`);
      fields.push([p.slice(0, c).trim(), p.slice(c + 1).trim()]);
    }
  }
  return { name: m[1].trim(), fields };
}
