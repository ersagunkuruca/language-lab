// Baking to a file (G16b3c2, docs/design/targets/BAKING.md): a value
// definition whose answer is numbers in records and lists is run once,
// compiled, at build time; its answer's leaves are written to a file; and
// its body is rewritten into a decoder written in Ters,
//
//   match baked bytes("<key>") { some(b) → <the answer read from b>; none → <the body as written> }
//
// which the compiler then compiles like any other code, into whatever
// representation it chooses for the answer. The encoder that writes the
// file is Ters too (the prelude's `baked … bytes`), run compiled, so it
// reads the answer in whatever representation it was made in.
//
// The file: "TERSBAKE", the layout's version (a 4-byte word), the key's
// length and its UTF-8 bytes, the answer's length, then the answer: its
// leaves in order, each a little-endian word (Float32, Int and Bool 4
// bytes, Float64 8), a list's items after its length.

import { createHash } from "node:crypto";
import type { Code, Id } from "../../ters/src/model.ts";
import { dependenciesOfAll, subtreeKept, withNodes } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY, FLOAT32_TYPE } from "../../ters/src/lang/library.ts";
import { BOOL, INT_OPS, IO, LIST, NONE, SOME } from "../../ters/src/lang/std-ids.ts";
import { INT, NUMBER, type Type } from "../../ters/src/lang/types.ts";
import { compiledDefs, compiledMain } from "./core-js.ts";

import { BAKE_VERSION, bakeFile } from "./bake-header.ts";

// An answer's layout: its leaves, records and lists, as the bake writes
// them.
export type Layout =
  | { k: "f32" } | { k: "f64" } | { k: "i32" } | { k: "bool" }
  | { k: "record"; variant: Id; fields: Layout[] }
  | { k: "list"; item: Layout };

const libDef = (name: string): Id => {
  const id = LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name) ?? LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name);
  if (!id) throw new Error(`bake: no library definition ${name}`);
  return id;
};

// Float32's own conversions (the numbers module), found by their types:
// its case is private, so a program, the bake's too, converts this way.
// `as float32` of a Float32's own value is that value.
const float32Way = (info: Info, from: Id, to: Id): Id => {
  const id = LIBRARY.code.defs.find((d) => {
    if (LIBRARY.names[d] !== (to === FLOAT32_TYPE ? "as float32" : "as float64")) return false;
    const t = info.schemes.get(d)?.type;
    return t?.t === "fn" && t.params.length === 1 && t.params[0].t === "con" && t.params[0].id === from && t.ret.t === "con" && t.ret.id === to;
  });
  if (!id) throw new Error(`bake: no conversion from ${from} to ${to}`);
  return id;
};

// The layout of a type, or null where it isn't one a bake writes: a
// record is a type of one variant and no parameters, of fields that are.
// A list's items have a size known ahead (no list inside them), so the
// decoder finds the i-th by its position (G16e reads the rest).
export function layoutOf(code: Code, info: Info, t: Type, seen = new Set<Id>()): Layout | null {
  if (t.t !== "con") return null;
  if (t.id === NUMBER) return { k: "f64" };
  if (t.id === INT) return { k: "i32" };
  if (t.id === BOOL) return { k: "bool" };
  if (t.id === FLOAT32_TYPE) return { k: "f32" };
  if (t.id === LIST) {
    const item = t.args[0] && layoutOf(code, info, info.subst.zonk(t.args[0]), seen);
    return item && sizeOf(item) !== null ? { k: "list", item } : null;
  }
  if (seen.has(t.id) || t.args.length) return null;
  const def = code.nodes[t.id];
  const td = def?.kind === "def" && def.body ? code.nodes[def.body] : undefined;
  if (td?.kind !== "typedef" || td.effect || td.interface || td.params.length || td.variants.length !== 1) return null;
  const variant = td.variants[0], v = code.nodes[variant];
  if (v?.kind !== "variant" || v.returns || v.params?.length) return null;
  const inner = new Set(seen).add(t.id);
  const fields = v.fields.map((f) => { const n = code.nodes[f]; const ft = n?.kind === "field" ? written(code, n.type) : null; return ft && layoutOf(code, info, ft, inner); });
  return fields.every((f): f is Layout => f !== null) ? { k: "record", variant, fields } : null;
}

// A field's type as written: a type named, with its arguments.
function written(code: Code, id: Id): Type | null {
  const n = code.nodes[id];
  if (n?.kind !== "tref" || n.unit) return null;
  const args = n.args.map((a) => written(code, a));
  return args.every((a): a is Type => a !== null) ? { t: "con", id: n.target, args } : null;
}

// Its size in bytes, or null where a list makes it depend on the answer.
export function sizeOf(l: Layout): number | null {
  switch (l.k) {
    case "f32": case "i32": case "bool": return 4;
    case "f64": return 8;
    case "list": return null;
    case "record": { let n = 0; for (const f of l.fields) { const s = sizeOf(f); if (s === null) return null; n += s; } return n; }
  }
}

// The bytes of a value of the layout, as a List Int: the prelude's
// encoders, a record's fields one after another, a list's length then its
// items.
function encoder(k: Lang, info: Info, v: Id, l: Layout): Id {
  const call = (name: string, ...xs: Id[]) => k.call(libDef(name), ...xs);
  switch (l.k) {
    case "f64": return call("baked float64 bytes", v);
    case "i32": return call("baked int32 bytes", v);
    case "f32": return call("baked float32 bytes", k.call(float32Way(info, FLOAT32_TYPE, NUMBER), v));
    case "bool": return k.if(v, k.list(k.int(1), k.int(0), k.int(0), k.int(0)), k.list(k.int(0), k.int(0), k.int(0), k.int(0)));
    case "list": return call("append", call("baked int32 bytes", call("length", v)), call("flat map", v, k.fn(["item"], (x) => encoder(k, info, x, l.item))));
    case "record": return k.match(v, [{ variant: l.variant, names: l.fields.map((_, i) => `field ${i}`), body: (fs) =>
      fs.map((f, i) => encoder(k, info, f, l.fields[i])).reduceRight((rest, bytes) => call("append", bytes, rest), k.list()) }]);
  }
}

// The value of the layout read from b at a position, given with where
// it ends to what comes next.
function decoder(k: Lang, info: Info, b: Id, at: Id, l: Layout, next: (value: Id, end: Id) => Id): Id {
  const call = (name: string, ...xs: Id[]) => k.call(libDef(name), ...xs);
  const plus = (x: Id, n: Id) => k.call(INT_OPS.add, x, n);
  const leaf = (value: Id, size: number) => k.let("end", plus(at, k.int(size)), (end) => next(value, end));
  switch (l.k) {
    case "f64": return leaf(call("baked float64 at", b, at), 8);
    case "i32": return leaf(call("baked int32 at", b, at), 4);
    case "f32": return leaf(k.call(float32Way(info, NUMBER, FLOAT32_TYPE), call("baked float32 at", b, at)), 4);
    case "bool": return leaf(k.equal(call("baked int32 at", b, at), k.int(1)), 4);
    case "record": {
      const field = (i: number, from: Id, values: Id[]): Id => i === l.fields.length ? next(k.call(l.variant, ...values), from)
        : decoder(k, info, b, from, l.fields[i], (v, end) => k.let(`field ${i}`, v, (fv) => field(i + 1, end, [...values, fv])));
      return field(0, at, []);
    }
    case "list": {
      const size = sizeOf(l.item)!;
      return k.let("count", call("baked int32 at", b, at), (n) => k.let("items from", plus(at, k.int(4)), (from) =>
        next(call("map", k.call(INT_OPS.range, n), k.fn(["i"], (i) => decoder(k, info, b, plus(from, k.call(INT_OPS.mul, k.int(size), i)), l.item, (v) => v))),
          plus(from, k.call(INT_OPS.mul, k.int(size), n)))));
    }
  }
}

// What a bake is keyed by (BAKING.md): the definition's nodes and those
// of every definition it reaches, the layout, the bake's version.
export function bakeKey(code: Code, def: Id, l: Layout): string {
  const h = createHash("sha256");
  const ids = [def, ...[...dependenciesOfAll(code, [def])].sort()];
  for (const d of ids) for (const x of subtreeKept(code, d)) h.update(JSON.stringify(code.nodes[x] ?? null));
  h.update(JSON.stringify(l));
  h.update(String(BAKE_VERSION));
  return h.digest("hex").slice(0, 24);
}

export interface Baked { def: Id; key: string; file: Uint8Array; ms: number }

// Bakes a value definition: runs its encoder compiled and gives the file,
// or why not.
export function bake(code: Code, info: Info, names: Record<Id, string>, def: Id): Baked | string {
  const d = code.nodes[def];
  if (d?.kind !== "def" || !d.body || code.nodes[d.body]?.kind === "lambda") return "isn't a value";
  const t = info.schemes.get(def)?.type ?? info.typeOf.get(def);
  const l = t && layoutOf(code, info, info.subst.zonk(t));
  if (!l) return "its answer isn't numbers in records and lists";
  const k = new Lang(code);
  const main = k.def("bake main");
  k.define(main, k.thunk(() => k.call(IO.writeBytes, k.lit("answer"), k.call(libDef("bytes of"), encoder(k, info, k.x(def), l)))));
  const all: Code = { nodes: withNodes(code.nodes, k.code.nodes), defs: [...code.defs, ...k.code.defs] };
  const allNames = { ...names, ...k.names };
  const allInfo = infer(all, allNames);
  if (allInfo.errors.length) return `its encoder doesn't check: ${allInfo.errors[0].message}`;
  let answer: Uint8Array | null = null;
  const t0 = performance.now();
  let status = 0;
  try {
    status = compiledMain(all, allInfo, allNames, { print: () => {}, world: { writeBytes: (_: string, b: Uint8Array) => { answer = b.slice(); } } } as never, "bake main");
  } catch (e) { return `its encoder stopped: ${(e as Error).message}`; }
  const ms = performance.now() - t0;
  if (status !== 0) return `its encoder stopped (exit status ${status})`;
  if (!answer) return "its encoder wrote nothing";
  const key = bakeKey(code, def, l);
  return { def, key, file: bakeFile(key, answer), ms };
}

// The definition's body rewritten into its decoder, the body as written
// where there are no bytes.
export function withDecoder(code: Code, info: Info, b: Baked): Code {
  const d = code.nodes[b.def];
  if (d?.kind !== "def" || !d.body) throw new Error("bake: not a definition");
  const t = info.schemes.get(b.def)?.type ?? info.typeOf.get(b.def);
  const l = t && layoutOf(code, info, info.subst.zonk(t));
  if (!l) throw new Error("bake: no layout");
  const k = new Lang(code);
  const body = k.match(k.call(libDef("baked bytes"), k.lit(b.key)), [
    { variant: SOME, names: ["bytes"], body: ([bytes]) => decoder(k, info, bytes, k.int(0), l, (v) => v) },
    { variant: NONE, names: [], body: () => d.body! },
  ]);
  return { nodes: withNodes(code.nodes, k.code.nodes, { [b.def]: { ...d, body } }), defs: code.defs };
}

// A page's bakes (G16b3c3): each value definition main reaches whose
// answer holds a list in a layout, baked where reading it back pays: its
// decoder, compiled and reading the file, and carrying the file in the
// page (base64, about 0.036 ms a KB to parse, measured on rain-page) take
// under 90% of computing it compiled. Both are timed here, once each, in
// Node. rain-page's `start pane` doesn't pay: 20,000 records read back
// cost what making them from their seeds does (BAKING.md).
export const CARRY_MS_PER_KB = 0.036;
// A definition's way held in the decisions file (G16d): computed as
// written, or baked however small its work.
export type BakeWay = "at start" | "baked to a file";
export interface Weighed { def: Id; name: string; computeMs: number; decodeMs: number; carryMs: number; bytes: number; baked: boolean; held?: BakeWay }
export function bakedPage(code: Code, info: Info, names: Record<Id, string>, main: Id, options?: Parameters<typeof infer>[3], held: ReadonlyMap<Id, BakeWay> = new Map()): { code: Code; info: Info; files: Record<string, Uint8Array>; weighed: Weighed[] } {
  const holdsList = (l: Layout): boolean => l.k === "list" || (l.k === "record" && l.fields.some(holdsList));
  const candidates = [...dependenciesOfAll(code, [main])].filter((d) => {
    const n = code.nodes[d];
    if (n?.kind !== "def" || !n.body || !code.defs.includes(d) || !names[d]) return false;
    const body = code.nodes[n.body];
    if (!body || body.kind === "lambda" || body.kind === "typedef" || body.kind === "lit") return false;
    const t = info.schemes.get(d)?.type;
    const l = t && layoutOf(code, info, info.subst.zonk(t));
    return !!l && holdsList(l);
  });
  const timed = (c: Code, i: Info, name: string, world: object | undefined): number => {
    const f = (compiledDefs(c, i, names, [name], { print: () => {}, world } as never) as Record<string, unknown>)[name];
    const t0 = performance.now();
    if (typeof f === "function") (f as () => unknown)();
    return performance.now() - t0;
  };
  let out = code;
  const files: Record<string, Uint8Array> = {}, weighed: Weighed[] = [];
  for (const d of candidates) {
    const way = held.get(d);
    if (way === "at start") { weighed.push({ def: d, name: names[d], computeMs: 0, decodeMs: 0, carryMs: 0, bytes: 0, baked: false, held: way }); continue; }
    const b = bake(code, info, names, d);
    if (typeof b === "string") continue;
    const one = withDecoder(code, info, b), oneInfo = infer(one, names, undefined, options);
    if (oneInfo.errors.length) continue;
    const file = `baked/${b.key}.bin`;
    const world = { readBytes: (p: string) => { if (p !== file) throw new Error("no file"); return b.file; } };
    const carryMs = (b.file.length * 4) / 3 / 1024 * CARRY_MS_PER_KB;
    // One the page can't run compiled, here, stays as written.
    let computeMs = 0, decodeMs = 0;
    try { if (!way) { computeMs = timed(code, info, names[d], undefined); decodeMs = timed(one, oneInfo, names[d], world); } } catch { continue; }
    const pays = way === "baked to a file" || decodeMs + carryMs < 0.9 * computeMs;
    weighed.push({ def: d, name: names[d], computeMs, decodeMs, carryMs, bytes: b.file.length, baked: pays, ...(way ? { held: way } : {}) });
    if (!pays) continue;
    out = withDecoder(out, info, b);
    files[file] = b.file;
  }
  return Object.keys(files).length ? { code: out, info: infer(out, names, undefined, options), files, weighed } : { code, info, files, weighed };
}
