// Example values, written the way showValue prints them: 3, -1.5, "text",
// [1, 2, 3], true, circle(2), pair(1, "a"), −∞. A case is found by its name, so
// this is a presentation-level reader, for example inputs in the editor; it
// never becomes code.

import type { Code, Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import { DEF_VALUE, toList, type Value } from "./run.ts";
import { EXTENDED_V } from "./std.ts";

export function parseValue(text: string, code: Code, names: Names): { value: Value } | { error: string } {
  const variants = new Map<string, Id>();
  for (const n of Object.values(code.nodes)) if (n.kind === "variant" && names[n.id] !== undefined && !variants.has(names[n.id])) variants.set(names[n.id], n.id);
  // A definition by its name is that function (newton's f: cubic). It
  // stands for the definition until a run looks it up (trace.ts).
  const defs = new Map<string, Id>();
  for (const d of code.defs) if (code.nodes[d]?.kind === "def" && names[d] !== undefined && !defs.has(names[d])) defs.set(names[d], d);
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] ?? "")) i++; };
  const fail = (what: string): never => { throw new Error(`${what} at ${i + 1}`); };
  const expect = (c: string) => { ws(); if (text[i] !== c) fail(`expected ${c}`); i++; };
  const list = (close: string): Value[] => {
    const out: Value[] = [];
    ws();
    if (text[i] === close) { i++; return out; }
    for (;;) {
      out.push(value());
      ws();
      if (text[i] === ",") { i++; continue; }
      expect(close);
      return out;
    }
  };
  const value = (): Value => {
    ws();
    const c = text[i];
    if (c === undefined) return fail("expected a value");
    if (c === "[") { i++; return toList(list("]")); }
    if (c === '"') {
      const m = /^"(?:[^"\\]|\\.)*"/.exec(text.slice(i));
      if (!m) return fail("unfinished text");
      i += m[0].length;
      return JSON.parse(m[0]) as string;
    }
    // An Extended number's ends, as the Run panel shows them (L125d).
    const inf = /^[-−+]?∞/.exec(text.slice(i));
    if (inf) { i += inf[0].length; return { tag: /^[-−]/.test(inf[0]) ? EXTENDED_V.minus : EXTENDED_V.plus, fields: [] }; }
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(text.slice(i));
    if (num) { i += num[0].length; return Number(num[0]); }
    // A case name: letters, digits, spaces between words, primes.
    const m = /^[\p{L}_][\p{L}\p{N}_′' ]*/u.exec(text.slice(i));
    if (!m) return fail("expected a value");
    const name = m[0].trim();
    i += m[0].trimEnd().length;
    const tag = variants.get(name);
    if (!tag && defs.has(name)) return { tag: DEF_VALUE, fields: [defs.get(name)!] };
    if (!tag) return fail(`no case named ${name}`);
    const arity = (code.nodes[tag] as { fields: Id[] }).fields.length;
    ws();
    const fields = text[i] === "(" ? (i++, list(")")) : [];
    if (fields.length !== arity) return fail(`${name} takes ${arity} value${arity === 1 ? "" : "s"}, not ${fields.length}`);
    return { tag, fields };
  };
  try {
    const v = value();
    ws();
    if (i < text.length) fail("unexpected text");
    return { value: v };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
