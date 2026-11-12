// Foreign definitions (FOREIGN.md, BACKLOG L69a): an operation of an effect
// the program declares itself, which nothing in the program handles, is
// answered by the host: `hosts/js.js` beside the program, a default export
// of functions keyed by each operation's id (names are presentation, so a
// rename changes nothing).
//
// What goes out is the operation's fields as JavaScript (Text a string,
// Float64 a finite number and small Int a number, big Int a bigint, Bool a boolean, Unit
// undefined, a List an array, a record an object by field name). What
// comes back is checked against the operation's result type at the border
// before the program sees it (Elm's ports): a wrong answer is the
// program's Abort with the reason, never a value of the wrong type inside
// it. A host function here answers at once; one that waits is L59's,
// after operations answered later.
//
// Prior art: Gleam's `@external` (a body per target, any of which may be
// missing), Elm's ports (checked at the border), Koka's `extern`, and
// Unison's abilities and Eff's handlers (the runtime as the outermost
// handler). CREDITS.md.

import type { Code, Id, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { isInt, norm } from "./int.ts";
import { ABORT_OP, BOOL, CHECK_OP, CONS, FALSE, HTML, HTML_V, LIST, NIL, TRUE, UNIT, UNIT_V } from "./std.ts";
import { INT, NUMBER, STRING } from "./types.ts";
import type { Value as RunValue } from "./run.ts";

// What a host's view carries (L235, Symbol.for so a bundle's copy of this
// module and the page's agree).
export const FOREIGN_VIEW: unique symbol = Symbol.for("ters.foreign view") as never;
export type Hosts = Record<Id, (...args: unknown[]) => unknown>;
type Value = unknown;
interface Data { tag: Id; fields: Value[] }

// An operation's effect, when it is one a program declared.
export function effectOfOperation(code: Code, op: Id): Id | null {
  for (const d of code.defs) {
    const b = (code.nodes[d] as NodeOf<"def">)?.body, td = b ? code.nodes[b] : undefined;
    if (td?.kind === "typedef" && td.effect && td.variants.includes(op)) return d;
  }
  return null;
}

// std's world operations (the clock, Random, Settings, Console, Files,
// Network) are answered by the runner's World, the host every target
// gives (run.ts World); a program's hosts/js.js may answer one in its
// place, by the operation's id ("std.time.now": a fixed clock), as it
// answers the program's own (L69d1). Abort and Check are the language's
// own, never a host's. The effect stays in every row, whoever answers it
// (Ersagun, 2026-11-05: "Reading the clock isn't pure").
const NOT_HOSTED = new Set<Id>([ABORT_OP, CHECK_OP]);
export const stdHosted = (op: Id, hosts: Hosts): boolean => typeof hosts[op] === "function" && op.startsWith("std.") && !NOT_HOSTED.has(op);

// An effect the program marks pure (L69d2): its operations are functions
// of their inputs (a hash, a parser) that the host answers, so the checker
// keeps it out of every row, on the program's word. Allowed only for what
// is a function of its inputs (Ersagun, 2026-11-05: "If it is actually
// pure, yes. Reading the clock isn't pure.").
export function pureEffect(code: Code, effect: Id): boolean {
  const b = (code.nodes[effect] as NodeOf<"def">)?.body, td = b ? code.nodes[b] : undefined;
  return td?.kind === "typedef" && !!td.effect && !!td.pure;
}

// The effects the host answers: each with an operation in `hosts`.
export function hostedEffects(code: Code, hosts: Hosts | undefined): Set<Id> {
  const out = new Set<Id>();
  for (const op of Object.keys(hosts ?? {})) { const e = effectOfOperation(code, op); if (e) out.add(e); }
  return out;
}

// Host ways for pure library definitions (L206): the library declares
// them by name (library/hosts.ts), and library.ts gives them here by the
// definition's id, which the evaluator runs in place of the definition.
// Given the definition's own value, the value to run.
export type PureHost = (self: (...xs: RunValue[]) => Iterable<RunValue>) => (...xs: RunValue[]) => Iterable<RunValue>;
export const pureHosts: Record<Id, PureHost> = {};
// The library's definition by each name, or the names it has none for.
export function declarePureHosts(byName: Record<string, PureHost>, defs: Id[], names: Names): string[] {
  const missing: string[] = [];
  for (const [name, host] of Object.entries(byName)) {
    const d = defs.filter((x) => names[x] === name);
    if (d.length === 1) pureHosts[d[0]] = host; else missing.push(name);
  }
  return missing;
}

class Border extends Error {}

// A type expression's own reading, for the border: what a host may give.
export type Shape = { k: "view" } | { k: "int" } | { k: "float" } | { k: "text" } | { k: "bool" } | { k: "unit" } | { k: "list"; of: Shape } | { k: "record"; variant: Id; fields: [string, Shape][] } | { k: "any" };

function shapeOf(code: Code, names: Names, tid: Id | undefined): Shape {
  const t = tid ? code.nodes[tid] : undefined;
  if (t?.kind !== "tref") return { k: "any" };
  if (t.target === INT) return { k: "int" };
  if (t.target === NUMBER) return { k: "float" };
  if (t.target === STRING) return { k: "text" };
  if (t.target === BOOL) return { k: "bool" };
  if (t.target === UNIT) return { k: "unit" };
  if (t.target === HTML) return { k: "view" };
  if (t.target === LIST) return { k: "list", of: shapeOf(code, names, t.args[0]) };
  const b = (code.nodes[t.target] as NodeOf<"def">)?.body, td = b ? code.nodes[b] : undefined;
  if (td?.kind === "typedef" && !td.effect && td.variants.length === 1 && !td.params.length) {
    const v = code.nodes[td.variants[0]] as NodeOf<"variant">;
    return { k: "record", variant: v.id, fields: v.fields.map((f) => [names[f] ?? f, shapeOf(code, names, (code.nodes[f] as NodeOf<"field">).type)]) };
  }
  return { k: "any" };
}

const describe = (s: Shape): string => s.k === "view" ? "a view" : s.k === "list" ? `a list of ${describe(s.of)}` : s.k === "record" ? "a record" : ({ int: "a whole number", float: "a finite number", text: "a text", bool: "true or false", unit: "nothing", any: "a value" } as const)[s.k];

function inward(s: Shape, x: unknown, where: string): Value {
  const wrong = () => { throw new Border(`${where} gave ${JSON.stringify(x) ?? String(x)}, not ${describe(s)}`); };
  switch (s.k) {
    case "int":
      if (typeof x === "bigint") return norm(x);
      if (typeof x === "number" && Number.isInteger(x) && isInt(x)) return x;
      if (typeof x === "number" && Number.isSafeInteger(x)) return norm(BigInt(x));
      return wrong();
    // A Float64 is finite (L125f): NaN and ±∞ from the host are refused here.
    case "float": return typeof x === "number" && Number.isFinite(x) ? x : wrong();
    case "text": return typeof x === "string" ? x : wrong();
    case "bool": return typeof x === "boolean" ? { tag: x ? TRUE : FALSE, fields: [] } : wrong();
    case "unit": return x === undefined || x === null ? { tag: UNIT_V, fields: [] } : wrong();
    case "list": {
      if (!Array.isArray(x)) return wrong();
      return x.reduceRight<Data>((tail, y, i) => ({ tag: CONS, fields: [inward(s.of, y, `${where}[${i}]`), tail] }), { tag: NIL, fields: [] });
    }
    case "record": {
      if (typeof x !== "object" || x === null) return wrong();
      return { tag: s.variant, fields: s.fields.map(([n, f]) => inward(f, (x as Record<string, unknown>)[n], `${where}.${n}`)) };
    }
    // A view of the host's own (L235): what the platform draws (a DOM
    // element on the web), placed on the page as an element `ters-view`
    // that carries it, so the program can hold it, put it among others and
    // even look at it, and html.ts mounts the host's own in its place.
    case "view":
      if (typeof x !== "object" || x === null) return wrong();
      return Object.assign({ tag: HTML_V.element, fields: ["ters-view", { tag: NIL, fields: [] }, { tag: NIL, fields: [] }] }, { [FOREIGN_VIEW]: x });
    case "any": throw new Border(`${where}: this type can't come from a host yet`);
  }
}

function outward(s: Shape, v: Value): unknown {
  switch (s.k) {
    case "bool": return (v as Data).tag === TRUE;
    case "unit": return undefined;
    case "list": { const out: unknown[] = []; let c = v as Data; while (c.tag === CONS) { out.push(outward(s.of, c.fields[0])); c = c.fields[1] as Data; } return out; }
    case "record": return Object.fromEntries(s.fields.map(([n, f], i) => [n, outward(f, (v as Data).fields[i])]));
    default: return v;
  }
}

// What the border needs of an operation: its name, and its fields' and
// answer's shapes. Plain data, so compiled JavaScript carries it too.
export interface HostOp { name: string; ins: Shape[]; out: Shape }
export function hostOp(code: Code, names: Names, op: Id): HostOp {
  const v = code.nodes[op] as NodeOf<"variant">;
  return { name: names[op] ?? op, ins: v.fields.map((fid) => shapeOf(code, names, (code.nodes[fid] as NodeOf<"field">).type)), out: shapeOf(code, names, v.returns) };
}

// Answer an operation from the host: its fields out, the answer checked
// on the way in. Throws Error with the reason when the host has no answer
// or gives a wrong one; the runner makes that the program's Abort, and so
// does compiled JavaScript's runtime (L69a2).
export function answerByShapes(h: HostOp, hosts: Hosts, op: Id, args: Value[]): Value {
  const f = hosts[op];
  if (typeof f !== "function") throw new Error(`hosts/js.js has no answer for ${h.name} (${op})`);
  const ins = h.ins.map((s, i) => outward(s, args[i]));
  let x: unknown;
  try { x = f(...ins); } catch (e) { throw new Error(`the host's ${h.name} failed: ${(e as Error).message ?? e}`); }
  if (x instanceof Promise) throw new Error(`the host's ${h.name} answered later (a promise); answering later is L59's, so a host answers at once for now`);
  try { return inward(h.out, x, `the host's ${h.name}`); }
  catch (e) { if (e instanceof Border) throw new Error(e.message); throw e; }
}
export const answerFromHost = (code: Code, names: Names, hosts: Hosts, op: Id, args: Value[]): Value => answerByShapes(hostOp(code, names, op), hosts, op, args);

// A program's own effects' operations, which a host may answer.
export function ownOperations(code: Code): Id[] {
  return code.defs.flatMap((d) => {
    if (d.startsWith("std.") || d.startsWith("effect.")) return [];
    const b = (code.nodes[d] as NodeOf<"def">)?.body, td = b ? code.nodes[b] : undefined;
    return td?.kind === "typedef" && td.effect ? td.variants : [];
  });
}

const showShape = (s: Shape): string => s.k === "list" ? `Array<${showShape(s.of)}>` : s.k === "record" ? `{ ${s.fields.map(([n, f]) => `${JSON.stringify(n)}: ${showShape(f)}`).join(", ")} }` : ({ int: "number | bigint", float: "number", text: "string", bool: "boolean", unit: "undefined", any: "unknown", view: "Element" } as const)[s.k];

// `ters hosts`: a hosts/js.js to start from, one entry per operation of
// each effect the program declares, with its name and types in a comment.
export function hostSkeleton(code: Code, names: Names, own: Id[]): string {
  const lines = ["// Answers for this program's own effects (FOREIGN.md), keyed by each", "// operation's id: renaming an operation changes nothing here.", "export default {"];
  for (const d of own) {
    const b = (code.nodes[d] as NodeOf<"def">)?.body, td = b ? code.nodes[b] : undefined;
    if (td?.kind !== "typedef" || !td.effect) continue;
    lines.push(`  // ${names[d] ?? d}`);
    for (const op of td.variants) {
      const v = code.nodes[op] as NodeOf<"variant">;
      const params = v.fields.map((f) => `${(names[f] ?? f).replace(/[^\p{L}\p{N}_$]+/gu, "_")} /* ${showShape(shapeOf(code, names, (code.nodes[f] as NodeOf<"field">).type))} */`);
      lines.push(`  // ${names[op] ?? op}, giving back ${v.returns ? showShape(shapeOf(code, names, v.returns)) : "nothing (it never returns)"}`);
      lines.push(`  ${JSON.stringify(op)}: (${params.join(", ")}) => { throw new Error("not written yet"); },`);
    }
  }
  lines.push("};", "");
  return lines.join("\n");
}

// The C function a native program's hosts/c.c defines for an operation
// (L69b1), by its id.
export const hostCName = (op: Id) => `host_${op.replace(/[^A-Za-z0-9_]/g, "_")}`;
const C_TYPE: Partial<Record<Shape["k"], string>> = { int: "int64_t", float: "double", text: "const char *", bool: "int", unit: "void" };

// `ters hosts --c`: a hosts/c.c to start from. What crosses is C's own: an
// Int is int64_t, a Float64 a double, a Text a C string (the program's
// copy, freed after the call; a Text given back is copied, so it may be
// the host's own), a Bool 0 or 1. A host fails with lab_host_fail(reason),
// which is the program's Abort.
export function hostSkeletonC(code: Code, names: Names, own: Id[]): string {
  const lines = ["// Answers for this program's own effects in a native program (FOREIGN.md),", "// one function per operation, named by its id: renaming an operation", "// changes nothing here. lab_host_fail(reason) makes the program's Abort."];
  for (const d of own) {
    const b = (code.nodes[d] as NodeOf<"def">)?.body, td = b ? code.nodes[b] : undefined;
    if (td?.kind !== "typedef" || !td.effect) continue;
    lines.push("", `// ${names[d] ?? d}`);
    for (const op of td.variants) {
      const h = hostOp(code, names, op), out = C_TYPE[h.out.k];
      const ins = h.ins.map((s, j) => { const v = code.nodes[op] as NodeOf<"variant">, t = C_TYPE[s.k] ?? "/* doesn't cross to C yet */ void *"; return `${t}${t.endsWith("*") ? "" : " "}${(names[v.fields[j]] ?? `x${j}`).replace(/[^A-Za-z0-9_]+/g, "_")}`; });
      lines.push(`// ${h.name}`);
      const ret = out ?? "/* doesn't cross to C yet */ void";
      lines.push(`${ret}${ret.endsWith("*") ? "" : " "}${hostCName(op)}(${ins.join(", ") || "void"}) { lab_host_fail("not written yet");${out && out !== "void" ? ` return ${h.out.k === "text" ? '""' : "0"};` : ""} }`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// `ters hosts --android`: a hosts/android.java to start from (C204), the
// Android app's class Hosts in package pkg, one static method per
// operation named by its id, as hosts/c.c has a C function. What crosses
// is Java's own: an Int a long, a Float64 a double, a Text a String, a Bool
// a boolean. An exception thrown is the program's Abort.
const JAVA_TYPE: Partial<Record<Shape["k"], string>> = { int: "long", float: "double", text: "String", bool: "boolean", unit: "void" };
export function hostSkeletonJava(code: Code, names: Names, own: Id[], pkg: string): string {
  const lines = [`package ${pkg};`, "", "// Answers for this program's own effects in its Android app (FOREIGN.md),", "// one static method per operation, named by its id. MainActivity.current", "// is the app (a Context) for Android's own APIs; an exception thrown is", "// the program's Abort.", "public final class Hosts {"];
  for (const d of own) {
    const b = (code.nodes[d] as NodeOf<"def">)?.body, td = b ? code.nodes[b] : undefined;
    if (td?.kind !== "typedef" || !td.effect) continue;
    lines.push(`  // ${names[d] ?? d}`);
    for (const op of td.variants) {
      const h = hostOp(code, names, op), v = code.nodes[op] as NodeOf<"variant">;
      const ins = h.ins.map((s, j) => `${JAVA_TYPE[s.k] ?? "/* doesn't cross to Java yet */ Object"} ${(names[v.fields[j]] ?? `x${j}`).replace(/[^A-Za-z0-9_]+/g, "_").replace(/^(\d)/, "_$1")}`);
      lines.push(`  // ${h.name}`, `  public static ${JAVA_TYPE[h.out.k] ?? "/* doesn't cross to Java yet */ Object"} ${hostCName(op)}(${ins.join(", ")}) { throw new UnsupportedOperationException("not written yet"); }`);
    }
  }
  lines.push("}", "");
  return lines.join("\n");
}
