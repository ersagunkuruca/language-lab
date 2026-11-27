// WebAssembly for the scalar profile (scalar.ts): Float64 is f64, Bool is
// i32, a let is a local, `if` is `if … else … end`, and a call in tail
// position is `return_call`, so recursion as deep as you like runs in
// constant stack. Functions the host has and WebAssembly doesn't (sin,
// pow, …) are imported from `Math`, so the results are bit-for-bit the
// evaluator's.
//
// A budget (scalar.ts) is a mutable f64 global, what's left of it: a
// function the checker couldn't see end takes one on each call, and
// returns 0 at once when it's below 0; the budget then gives its fallback.
//
// A record (lowered with `records`) is a WasmGC struct with immutable
// fields, one struct type per record type, and a value of it is a
// reference to one: built by `struct.new`, read by `struct.get`
// (docs/design/targets/WASM.md, stage W1).
//
// Data with several cases (lowered with `data`: lists, expression trees)
// is a base struct holding the case's number as an i32, and one subtype
// of it per case, which adds the case's fields. A match puts the value in
// a local and jumps on the number with `br_table`; reading a field casts
// to the case first. Since such types may contain themselves, all the
// structs are written as one recursion group.
//
// A shader's lowering (`lowered.shader`, C66c) runs here too, for the
// editor's pictures on the CPU: Int is an i32, and no answer is a global
// flag, $none, that `first` and `count` read, as WGSL keeps it.
//
// The console and files (lowered with `data`) are imports from "world",
// which `instantiate` gives from the evaluator's own Runtime; `runMain`
// runs a program's main as the evaluator's runProgram does.
//
// No dependencies: the binary format is small enough to write directly
// (https://webassembly.github.io/spec/core/binary/), and a text version is
// printed alongside it for reading.

import { bordered } from "../../ters/src/lang/border.ts";
import { Aborted, type Runtime, type World } from "../../ters/src/lang/run.ts";
import { MATH_DATA, MATH_DATA_AT } from "./wasm-math.ts";
import { arrayCall, viewsByValue, type ViewFunc } from "./wasm-views.ts";
import { assemble, byteSlots, inlined, POW5, runtime, textBytes, WASI_IMPORTS, wasiStop, type RtFn, type VT } from "./wasm-rt.ts";

// Where the math functions' page starts in WASI's memory: after its fixed
// area (iovecs, sizes), before its buffer.
const MATH_AT = 128;
import { keysArrays, TABLE_RT, tableRt } from "./wasm-table.ts";
import { FRAME_FN, frameSpares } from "./frame-spares.ts";
import { reasonOf, siteOf } from "./stops.ts";
import { originalOf, PRELUDE_DEFS } from "../../ters/src/lang/prelude-ids.ts";
import type { Id } from "../../ters/src/model.ts";
import { answerByShapes, type Shape } from "../../ters/src/lang/hosts.ts";
import { norm } from "../../ters/src/lang/int.ts";
import { FALSE, TRUE } from "../../ters/src/lang/std.ts";
import { hostLocale, hostZone, zoneOffset } from "../../ters/src/lang/text.ts";
import type { HostOps } from "./core-rt.ts";
import { leavesOf } from "./columns.ts";
import { emptyArray, fails, isFloat32, listSteps, isArray, isTable, isData, isFn, isRecord, kids, mapKids, mapLocals, OPS, STOPS, type AType, type DType, type FType, type LType, type CoreIR, type Op, type RType, type SExpr, type SFunc, type SType, type TType } from "./scalar.ts";

// int32 (an Int in 32 bits) is the shaders' only (C66c); WebAssembly has Int.
// columns.ts's ops on an array kept as columns (C60 w2).
const COL_FN = /^array\.c(new|length|in|get(\d+)|set([\d_]+))\.a(\d+)$/;
const VAL: Record<SType | "i64", number> = { f64: 0x7c, i32: 0x7f, int32: 0x7f, i64: 0x7e };
// A comparison of Ints that are i64s boxed (untagged-ints.ts's counts,
// an array's length read as an i64): compared as i64s, with no Int made
// or taken apart, and `0 < a − b` as `b < a`, the same for every Int
// (C267: the greenhouse's walks ask `0 < length − i` each step, three
// tagged calls).
export const boxedCompares = (e: SExpr): SExpr => {
  const x = mapKids(e, boxedCompares);
  if (x.k !== "rt" || x.fn !== "int.less" || x.args.length !== 2) return x;
  const i64 = (a: SExpr): SExpr | null => (a.k === "rt" && (a.fn === "i64.box" || a.fn === "int.of") && a.args.length === 1 ? a.args[0]
    : a.k === "rt" && /^array\.length\.a\d+$/.test(a.fn) && runtime(a.fn).uses.includes(`${a.fn}.i64`) ? { ...a, fn: `${a.fn}.i64` }
    : a.k === "int" && a.v >= -(1n << 62n) && a.v < 1n << 62n ? { k: "rt", fn: "i64.lit", args: [a] } : null);
  // Read in either order alike: a local, a literal, an array's length.
  const plain = (a: SExpr): boolean => a.k === "local" || a.k === "int" || (a.k === "rt" && (a.fn === "i64.lit" || /^array\.length\.a\d+\.i64$/.test(a.fn)) && a.args.every(plain));
  let [a, b] = x.args;
  if (a.k === "int" && a.v === 0n && b.k === "rt" && b.fn === "int.sub" && b.args.length === 2) {
    const [p, q] = b.args.map(i64);
    if (p && q && plain(p) && plain(q)) [a, b] = [b.args[1], b.args[0]];
  }
  const [p, q] = [i64(a), i64(b)];
  return p && q ? { k: "rt", fn: "i64.less", args: [p, q] } : { ...x, args: [a, b] };
};

// A type in the module: the program's (scalar.ts), or a machine word the runtime computes with.
type MType = LType | "i64" | "mag" | "raw";
const LIST_TEXT = "std.list<type.string<>>", OPTION_TEXT = "std.optional<type.string<>>", OPTION_INT = "std.optional<type.int<>>", LIST_INT = "std.list<type.int<>>", BYTES_T = "std.bytes<>", FILE_INFO_T = "std.file info<>", FILE_KIND_T = "std.file kind<>", LOCALE_T = "std.locale<>";
const HOST: Partial<Record<Op, { name: string; params: number }>> = {
  sin: { name: "sin", params: 1 }, cos: { name: "cos", params: 1 }, tan: { name: "tan", params: 1 },
  exp: { name: "exp", params: 1 }, log: { name: "log", params: 1 }, pow: { name: "pow", params: 2 }, atan2: { name: "atan2", params: 2 },
  // The program stops with STOPS[i] (L125c2): the host throws its Abort;
  // under WASI, wasi.stop writes the reason and exits.
  stop: { name: "stop", params: 1 },
};
// Float64 arithmetic the runtime writes itself (mod, from musl's fmod): it
// alone doesn't make a module need texts.
const small = (v: bigint) => v >= -(2n ** 30n) && v < 2n ** 30n;
const inI64 = (v: bigint) => v >= -(2n ** 63n) && v < 2n ** 63n;
// A magnitude's 32-bit limbs, the lowest first, each as an i32's bits.
const limbs = (v: bigint): number[] => { const out: number[] = []; for (let m = v < 0n ? -v : v; m; m >>= 32n) out.push(Number(m & 0xffffffffn) | 0); return out; };
// float32: to f32 and back, which rounds to the nearest binary32 value.
const INSTR: Partial<Record<Op, [number | number[], string]>> = {
  add: [0xa0, "f64.add"], sub: [0xa1, "f64.sub"], mul: [0xa2, "f64.mul"], div: [0xa3, "f64.div"],
  neg: [0x9a, "f64.neg"], abs: [0x99, "f64.abs"], sqrt: [0x9f, "f64.sqrt"], floor: [0x9c, "f64.floor"],
  float32: [[0xb6, 0xbb], "f32.demote_f64 f64.promote_f32"],
  less: [0x63, "f64.lt"], equal: [0x61, "f64.eq"], beq: [0x46, "i32.eq"], and: [0x71, "i32.and"], or: [0x72, "i32.or"], not: [0x45, "i32.eqz"],
  // Int in 32 bits (`shader`, C66c): the rest are wasm-rt.ts's int32.*.
  iless: [0x48, "i32.lt_s"], ieq: [0x46, "i32.eq"], itof: [0xb7, "f64.convert_i32_s"],
  // A 32-bit machine word (C150f): wrapping, compared unsigned.
  uadd: [0x6a, "i32.add"], usub: [0x6b, "i32.sub"], umul: [0x6c, "i32.mul"], uneg: [[0x41, 0x7f, 0x6c], "i32.const -1 i32.mul"],
  uand: [0x71, "i32.and"], uor: [0x72, "i32.or"], uxor: [0x73, "i32.xor"], uless: [0x49, "i32.lt_u"],
  u64add: [0x7c, "i64.add"], u64sub: [0x7d, "i64.sub"], u64mul: [0x7e, "i64.mul"], u64neg: [[0x42, 0x7f, 0x7e], "i64.const -1 i64.mul"],
  u64and: [0x83, "i64.and"], u64or: [0x84, "i64.or"], u64xor: [0x85, "i64.xor"], u64less: [0x54, "i64.lt_u"],
};
const INT32_RT: Op[] = ["iadd", "isub", "imul", "ineg", "iabs", "iquot", "irem", "ipow", "iwhole"];
// Where a shader's flag is set or read.
// A program's own handlers (L213c8): their runtime names, and the stack's
// frames, each an effect's number and up to FRAME - 1 cases.
const STACK = /^(hpush|hpop|handler|hhas|htake|hgive|hdepth|hcut|hoff|hon):([^:]+)(?::(\d+))?$/;
// A fold's stack's own functions (C327d), by the data type's place.
const FSTACK = /^fstack\.(push|top|pop)\.(\d+)$/;
// A view held by value's (C327c2, wasm-views.ts).
const VIEW_FN = /^view\.(\w+)(?:\.a(\d+))?(?:\.i64)?$/;
const FRAME = 17, FRAMES = 4096;
// A frame whose case runs while it may perform its own operation (pig's
// `recorded into`, C325) is busy: its effect's number + BUSY, so `hhas`
// and `htake` look past it. The frames taken, last on top, past the
// frames in the same array: their count at TAKEN, then each frame's
// number.
const BUSY = 0x10000, TAKEN = FRAME * FRAMES, SLOTS = TAKEN + 1 + FRAMES;
const flagged = (e: SExpr): boolean => e.k === "attempt" || (e.k === "rt" && /^array\.at32\./.test(e.fn)) || (e.k === "zero" && !!e.none) || (e.k === "op" && ["iquot", "irem", "ipow", "iwhole"].includes(e.op)) || kids(e).some(flagged);

// `floats`: the exports whose answer is a Float64, which instantiate
// checks as it leaves for the host (SPEC §3.3, C156); partial ones give
// it with their status.
// `stops`: the lowering's stop sites (C143), so a stop says where.
// `hosts`: the program's own operations its host answers (core-js.ts
// hostOpsOf), which instantiate asks rt.hosts for (L69b2).
export interface Module { bytes: Uint8Array; wat: string; exports: string[]; made?: string[]; floats?: { name: string; partial: boolean }[]; stops?: { node: Id; def: Id }[]; hosts?: HostOps }

// `wasi`: a WASI command instead, its world written over
// wasi_snapshot_preview1 (wasm-rt.ts) and `_start` running main as
// runMain does, for hosts with no JavaScript (wasmtime).
// A stop's Abort (C143): its reason, and where it is when the module
// knows the site.
function stopped(m: Module, code: number): Aborted {
  const e = new Aborted(reasonOf(code)) as Aborted & { node?: Id; def?: Id }, at = m.stops?.[siteOf(code)];
  if (at) { e.node = at.node; e.def = at.def; }
  return e;
}

// What crosses to the host as itself (L69b2): a Text as the module's
// bytes, made and read as the world's texts are.
const HOST_TYPES: Partial<Record<Shape["k"], LType>> = { int: "int", float: "f64", text: "text", bool: "i32" };
const performsIn = (e: SExpr): boolean => (e.k === "rt" && e.fn.startsWith("perform:")) || kids(e).some(performsIn);

// `hosts`: the program's own operations (core-js.ts hostOpsOf); one that
// nothing handles is an import from "world" that hosts/js.js answers
// (FOREIGN.md, L69b2).
const TEXT_PIECE = 10000;
export function emitWasm(lowered: CoreIR, opts: { wasi?: boolean; hosts?: HostOps; main?: string } = {}): Module {
  const wasi = !!opts.wasi;
  // A shader's lowering (C66c, `lowered.shader`): Int in 32 bits, and no
  // answer is the flag $none that `first` and `count` look at, as WGSL
  // and js-scalar.ts keep it, not a status, so no function is partial.
  const shader = !!lowered.shader;
  // Int in 32 bits (C66c's, and the plain profile's since C163).
  const int32 = shader || !!lowered.int32;
  // No answer as the flag $none (C66c's; the plain profile's inside a
  // search since C166): every profile but `data`.
  const flagging = int32;
  // A shader's arrays (C66c) are the same Array, with an i32 for their
  // length and index and the flag for `at` past the end (wasm-rt.ts).
  const shaderArrays = (e: SExpr): SExpr => {
    const m = e.k === "rt" ? /^array\.(of|length|at)\.(a\d+)$/.exec(e.fn) : null;
    const x = mapKids(e, shaderArrays);
    if (!m || x.k !== "rt") return x;
    return { ...x, fn: `array.${m[1] === "of" ? `of${x.args.length}` : m[1] === "length" ? "size32" : "at32"}.${m[2]}` };
  };
  // An array function given untagged Ints (untagged-ints.ts's copies,
  // `i64.box` of an i64): its `.i64` body, which takes them as they are,
  // not the wrapper taking them back (C211d: queens-count's `at`).
  const viaI64 = (e: SExpr): SExpr => {
    const x = mapKids(e, viaI64);
    if (x.k !== "rt" || !/^array\.\w+\.a\d+$/.test(x.fn)) return x;
    const f = runtime(x.fn), boxed = (a: SExpr) => a.k === "rt" && a.fn === "i64.box";
    if (f.result === "int" || !f.uses.includes(`${x.fn}.i64`) || f.params.length !== x.args.length || !f.params.every(([, t], j) => t !== "int" || boxed(x.args[j]))) return x;
    return { ...x, fn: `${x.fn}.i64`, args: x.args.map((a, j) => (f.params[j][1] === "int" && a.k === "rt" ? a.args[0] : a)) };
  };
  // A program's own operation nothing handles (scalar.ts `perform:`): a
  // world operation the host answers, which may fail with the reason.
  const performs = (e: SExpr): SExpr => {
    const x = mapKids(e, performs);
    if (x.k !== "rt" || !x.fn.startsWith("perform:")) return x;
    const [, eff, i] = x.fn.split(":"), h = opts.hosts?.[`${eff}:${i}`];
    if (!h || wasi) throw new Error(`${h?.name ?? "an operation of an effect"} is performed with nothing handling it, and ${wasi ? "a WASI command has no host" : "no host answers it here"}`);
    const bad = [...h.ins, ...(h.out.k === "unit" ? [] : [h.out])].find((y) => !HOST_TYPES[y.k]);
    if (bad) throw new Error(`${h.name} takes or gives ${bad.k === "list" ? "a list" : bad.k === "record" ? "a record" : "a value"}, which doesn't cross to the host in WebAssembly yet`);
    return { k: "world", op: `host:${eff}:${i}`, aborts: true, args: x.args, t: x.host!.t, ins: h.ins.map((y) => HOST_TYPES[y.k]!) };
  };
  const funcs0 = shader ? lowered.funcs.map((f) => ({ ...f, partial: undefined, body: shaderArrays(f.body) })) : lowered.funcs.map((f) => (performsIn(f.body) ? { ...f, body: performs(f.body) } : f)).map((f) => (lowered.tables.length ? { ...f, body: keysArrays(lowered, f.body) } : f)).map((f) => ({ ...f, body: boxedCompares(viaI64(f.body)) }));
  // A text constant longer than array.new_fixed takes (10,000 bytes; the
  // cases module's collation tables, L214e5b4) is made of pieces joined.
  const longIn = (e: SExpr): boolean => (e.k === "text" && e.v.length > TEXT_PIECE / 4) || kids(e).some(longIn);
  const pieces = (e: SExpr): SExpr => {
    const x = mapKids(e, pieces);
    if (x.k !== "text" || textBytes(x.v).length <= TEXT_PIECE) return x;
    const parts: string[] = [""];
    let n = 0;
    for (const c of x.v) { const b = textBytes(c).length; if (n + b > TEXT_PIECE) { parts.push(""); n = 0; } parts[parts.length - 1] += c; n += b; }
    return parts.map((v): SExpr => ({ k: "text", v })).reduce((a, b) => ({ k: "rt", fn: "text.concat", args: [a, b] }));
  };
  // An Array of Ints, which keeps a byte a slot when it can (L189f2b).
  const byteArray = (a?: AType) => !!a && a.item === "int" && !lowered.int32;
  // Bytes read from a file kept as the bytes they are (C345, as C321 in
  // JavaScript): on WASI a Bytes holds a $bytes beside its list, and the
  // list is made from it only when something reads the list (bytes.list,
  // once). `array of` over a file's byte items (the library's `byte array
  // of bytes`) takes the bytes as they are, a byte a slot, without the
  // list: mnist's 55 M bytes were 55 M list cells.
  const rawBytes = wasi && lowered.records.some((r) => r.key === BYTES_T);
  const named = (e: SExpr): SExpr => (e.k === "let" && e.body.k === "local" && e.body.i === e.i ? e.value : e);
  const byteItems = new Set(funcs0.flatMap((f, i) => { const g = named(f.body); return f.params.length === 1 && g.k === "get" && g.t.key === BYTES_T && g.i === 0 && g.rec.k === "local" && g.rec.i === 0 ? [i] : []; }));
  const bytesIn = (e: SExpr): SExpr => {
    if (e.k === "rt" && e.args.length === 1) {
      const m = /^array\.of\.a(\d+)$/.exec(e.fn), x = e.args[0];
      const b = x.k === "call" && byteItems.has(x.fn) && x.args.length === 1 ? x.args[0] : x.k === "get" && x.t.key === BYTES_T && x.i === 0 ? x.rec : null;
      if (m && b && byteArray(lowered.arrays[Number(m[1])])) return { k: "rt", fn: `array.ofBytes.a${m[1]}`, args: [bytesIn(b)] };
    }
    if (e.k === "get" && e.t.key === BYTES_T && e.i === 0) return { k: "rt", fn: "bytes.list", args: [bytesIn(e.rec)] };
    return mapKids(e, bytesIn);
  };
  const funcs = funcs0.map((f) => rawBytes ? { ...f, body: bytesIn(f.body) } : f).map((f) => onlyRead(longIn(f.body) ? { ...f, body: pieces(f.body) } : f));
  // Host functions used, in a fixed order: they take the first indices.
  // A WASI host has no Math: there sin and the rest are V8's fdlibm,
  // compiled to WebAssembly (wasm-math.ts), their tables and stack in
  // WASI's memory at MATH_AT, between its fixed area and its buffer: one
  // memory, since Node 22's WASI stops a module with two (C193).
  const maths = (Object.keys(HOST) as Op[]).filter((op) => funcs.some((f) => uses(f.body, op)));
  const hosts = wasi ? [] : maths, math = wasi && maths.some((op) => op !== "stop");
  const hostIndex = new Map(hosts.map((op, i) => [op, i]));
  // The runtime functions used, with the ones they use.
  // WASI's functions it uses (wasi_fd_write …) are imports, and the
  // TextList and TextOption makers the module's own helpers.
  const rtNames: string[] = [], wasiImports: string[] = [];
  // A table's functions are written for its types (wasm-table.ts, C63j).
  // A program's own tail-resumptive handlers (L213c8), as C's (c-rt.ts
  // lab_handlers_push): a stack of frames in $hs, FRAME slots each, the
  // effect's number (an i31) and then its cases' closures; $hn frames in
  // use. An operation's case is the nearest frame's of its effect.
  const stackArity = new Map<string, number>(), effectNums = new Map<string, number>();
  const stackRt = (name: string): RtFn => {
    const [, kind, eff, op] = STACK.exec(name)!;
    let n = effectNums.get(eff);
    if (n === undefined) effectNums.set(eff, (n = effectNums.size));
    // The frame nearest the top of effect n that isn't busy, into $k (else -1).
    const free = ["global.get $hn", "local.set $k", "block void", "loop void",
      "local.get $k", "i32.eqz", "if void", "i32.const -1", "local.set $k", "br 2", "end",
      "global.get $hs", "local.get $k", "i32.const 1", "i32.sub", "local.tee $k", `i32.const ${FRAME}`, "i32.mul", "array.get $hstack",
      "ref.cast i31", "i31.get_s", `i32.const ${n}`, "i32.ne", "br_if 0", "end", "end"];
    const taken = (at: string[]) => ["global.get $hs", `i32.const ${TAKEN}`, ...at];
    // How many are taken (0 before the first).
    const count = [...taken(["array.get $hstack", "ref.test i31"]), "if i32", ...taken(["array.get $hstack", "ref.cast i31", "i31.get_s"]), "else", "i32.const 0", "end"];
    if (kind === "hhas") return { name, params: [], result: "i32", locals: [["k", "i32"]], uses: [], native: true, body: [...free, "local.get $k", "i32.const 0", "i32.ge_s"].join("\n") };
    if (kind === "htake") return {
      name, params: [], result: "int", locals: [["k", "i32"], ["t", "i32"]], uses: [], native: true,
      body: [
        ...free, "local.get $k", "i32.const 0", "i32.lt_s", "if void", "unreachable", "end",
        "global.get $hs", "local.get $k", `i32.const ${FRAME}`, "i32.mul", `i32.const ${n + BUSY}`, "ref.i31", "array.set $hstack",
        ...count, "local.set $t",
        "global.get $hs", `i32.const ${TAKEN + 1}`, "local.get $t", "i32.add", "local.get $k", "ref.i31", "array.set $hstack",
        ...taken(["local.get $t", "i32.const 1", "i32.add", "ref.i31", "array.set $hstack"]),
        "global.get $hs", "local.get $k", `i32.const ${FRAME}`, "i32.mul", `i32.const ${Number(op) + 1}`, "i32.add", "array.get $hstack",
      ].join("\n"),
    };
    if (kind === "hgive") return {
      name, params: [], result: "i32", locals: [["k", "i32"], ["t", "i32"]], uses: [], native: true,
      body: [
        ...count, "i32.const 1", "i32.sub", "local.tee $t", "i32.const 0", "i32.lt_s", "if void", "unreachable", "end",
        ...taken(["local.get $t", "ref.i31", "array.set $hstack"]),
        "global.get $hs", `i32.const ${TAKEN + 1}`, "local.get $t", "i32.add", "array.get $hstack", "ref.cast i31", "i31.get_s", "local.set $k",
        "global.get $hs", "local.get $k", `i32.const ${FRAME}`, "i32.mul", `i32.const ${n}`, "ref.i31", "array.set $hstack",
        "i32.const 0",
      ].join("\n"),
    };
    // Handlers that answer later (C325, scalar.ts handleOps): how many
    // frames are open, and back to that many; the frames from the nearest
    // of effect n up taken off as one value (a perform's), and put back on top.
    if (kind === "hdepth") return { name, params: [], result: "i32", locals: [], uses: [], native: true, body: "global.get $hn" };
    if (kind === "hcut") return { name, params: [["d", "i32"]], result: "i32", locals: [], uses: [], native: true, body: "local.get $d\nglobal.set $hn\ni32.const 0" };
    if (kind === "hoff") return {
      name, params: [], result: "int", locals: [["k", "i32"], ["a", "int"]], uses: [], native: true,
      body: [
        "global.get $hn", "local.set $k",
        "loop void",
        "local.get $k", "i32.eqz", "if void", "unreachable", "end",
        "global.get $hs", "local.get $k", "i32.const 1", "i32.sub", "local.tee $k", `i32.const ${FRAME}`, "i32.mul", "array.get $hstack",
        "ref.cast i31", "i31.get_s", `i32.const ${BUSY - 1}`, "i32.and", `i32.const ${n}`, "i32.ne", "br_if 0",
        "end",
        "global.get $hn", "local.get $k", "i32.sub", `i32.const ${FRAME}`, "i32.mul", "array.new_default $hstack", "local.set $a",
        "local.get $a", "ref.cast $hstack", "i32.const 0", "global.get $hs", "local.get $k", `i32.const ${FRAME}`, "i32.mul",
        "global.get $hn", "local.get $k", "i32.sub", `i32.const ${FRAME}`, "i32.mul", "array.copy $hstack $hstack",
        "local.get $k", "global.set $hn", "local.get $a",
      ].join("\n"),
    };
    if (kind === "hon") return {
      name, params: [["a", "int"]], result: "i32", locals: [["n", "i32"]], uses: [], native: true,
      body: [
        "local.get $a", "ref.cast $hstack", "array.len", "local.set $n",
        "global.get $hs", "global.get $hn", `i32.const ${FRAME}`, "i32.mul", "local.get $a", "ref.cast $hstack", "i32.const 0", "local.get $n", "array.copy $hstack $hstack",
        "global.get $hn", "local.get $n", `i32.const ${FRAME}`, "i32.div_u", "i32.add", "global.set $hn", "i32.const 0",
      ].join("\n"),
    };
    if (kind === "hpop") return { name, params: [], result: "i32", locals: [], uses: [], native: true, body: "global.get $hn\ni32.const 1\ni32.sub\nglobal.set $hn\ni32.const 0" };
    if (kind === "hpush") {
      const a = stackArity.get(name) ?? 0;
      if (a >= FRAME) throw new Error(`an effect of more than ${FRAME - 1} operations isn't on WebAssembly yet`);
      // The closures are passed as eqrefs ("int"'s type), native.
      return {
        name, params: Array.from({ length: a }, (_, j) => [`c${j}`, "int"] as [string, VT]), result: "i32", locals: [["b", "i32"]], uses: [], native: true,
        body: [
          "global.get $hs", "global.get $hn", `i32.const ${FRAME}`, "i32.mul", "local.tee $b", `i32.const ${n}`, "ref.i31", "array.set $hstack",
          ...Array.from({ length: a }, (_, j) => ["global.get $hs", "local.get $b", `i32.const ${j + 1}`, "i32.add", `local.get $c${j}`, "array.set $hstack"]).flat(),
          "global.get $hn", "i32.const 1", "i32.add", "global.set $hn", "i32.const 0",
        ].join("\n"),
      };
    }
    // The case, as an eqref: its caller casts it to its closure type.
    return {
      name, params: [], result: "int", locals: [["k", "i32"]], uses: [], native: true,
      body: [
        "global.get $hn", "local.set $k",
        "loop void",
        "local.get $k", "i32.eqz", "if void", "unreachable", "end",
        "global.get $hs", "local.get $k", "i32.const 1", "i32.sub", "local.tee $k", `i32.const ${FRAME}`, "i32.mul", "array.get $hstack",
        "ref.cast i31", "i31.get_s", `i32.const ${BUSY - 1}`, "i32.and", `i32.const ${n}`, "i32.ne", "br_if 0",
        "end",
        "global.get $hs", "local.get $k", `i32.const ${FRAME}`, "i32.mul", `i32.const ${Number(op) + 1}`, "i32.add", "array.get $hstack",
      ].join("\n"),
    };
  };
  // Arrays of records kept as columns (C60 w2, columns.ts): the buffer
  // holds, past its own fields, one array per field of the item (its
  // items left null), and an item is only read and written field by
  // field. Fields of a plain type only: Float64, Int, Text, Bool; a
  // Float32's value an `(array (mut f32))` (colNarrow, C309), rounded as
  // it is written and widened as it is read.
  const colArrays = new Map<number, MType[]>(), colNarrow = new Map<number, boolean[]>();
  const colScan = (e: SExpr): void => {
    const m = e.k === "rt" ? COL_FN.exec(e.fn) : null;
    if (m && !colArrays.has(Number(m[4]))) {
      const a = lowered.arrays[Number(m[4])], r = a?.item;
      const leaves = r && isRecord(r) ? leavesOf(r, true) : [];
      if (!leaves.length || leaves.some((l) => l.opt || !["f64", "int", "text", "i32"].includes(l.t as string))) throw new Error(`array ${m[4]} can't be kept as columns in WebAssembly`);
      colArrays.set(a.index, leaves.map((l) => l.t));
      colNarrow.set(a.index, leaves.map((l) => !!l.narrow));
    }
    if (e.k !== "rt" || !m) kids(e).forEach(colScan); else e.args.forEach(colScan);
  };
  funcs.forEach((f) => colScan(f.body));
  const colTypes = (i: number) => Object.fromEntries(colArrays.get(i)!.map((_, f) => [`col${f}`, { key: `col.${i}.${f}` }]));
  const colRt = (name: string, m: RegExpExecArray): RtFn => {
    const i = Number(m[4]), ts = colArrays.get(i)!, at = (f: number) => `local.get $a\nstruct.get $arr 0\nstruct.get $buf ${4 + f}\nlocal.get $j`;
    const index = "local.get $a\nstruct.get $arr 1\nlocal.get $k\nref.test i31\nif i32\nlocal.get $k\nref.cast i31\ni31.get_s\nelse\nlocal.get $k\ncall $int.clamped\ni32.wrap_i64\nend\ni32.add\nlocal.set $j";
    const base = { name, array: i, native: true as const, types: colTypes(i) };
    if (m[1] === "new") return { ...base, params: [["n", "int"]], result: "array", locals: [["m", "i64"], ["c", "i32"]], uses: ["int.clamped"], body: [
      "local.get $n", "call $int.clamped", "local.tee $m", "i64.const 0", "local.get $m", "i64.const 0", "i64.gt_s", "select", "i32.wrap_i64", "local.set $c",
      "ref.null $items", "i32.const 0", "local.get $c", "i32.const 0", ...ts.map((_, f) => `local.get $c\narray.new_default $col${f}`), "struct.new $buf", "i32.const 0", "local.get $c", "struct.new $arr"].join("\n") };
    if (m[1] === "length") return { ...base, params: [["a", "array"]], result: "int", locals: [], uses: ["int.of"], body: "local.get $a\nstruct.get $arr 2\ni64.extend_i32_s\ncall $int.of" };
    // A position inside the array (`item at`'s check, columns' whole items).
    if (m[1] === "in") return { ...base, params: [["a", "array"], ["k", "int"]], result: "i32", locals: [["j", "i64"]], uses: ["int.clamped"], body: "local.get $k\ncall $int.clamped\nlocal.tee $j\ni64.const 0\ni64.ge_s\nlocal.get $j\nlocal.get $a\nstruct.get $arr 2\ni64.extend_i32_s\ni64.lt_s\ni32.and" };
    const narrow = colNarrow.get(i)!;
    if (m[2] !== undefined) { const f = Number(m[2]); return { ...base, params: [["a", "array"], ["k", "int"]], result: ts[f] as VT, locals: [["j", "i32"]], uses: ["int.clamped"], body: `${index}\n${at(f)}\narray.get $col${f}${narrow[f] ? "\nf64.promote_f32" : ""}` }; }
    const ks = m[3]!.split("_").map(Number);
    return { ...base, params: [["a", "array"], ["k", "int"], ...ks.map((f, x) => [`x${x}`, ts[f] as VT] as [string, VT])], result: "array", locals: [["j", "i32"]], uses: ["int.clamped"],
      body: [index, ...ks.map((f, x) => `${at(f)}\nlocal.get $x${x}${narrow[f] ? "\nf32.demote_f64" : ""}\narray.set $col${f}`), "local.get $a"].join("\n") };
  };
  // Arrays as versions (C285), as compiled JS keeps them (array-view.ts,
  // Baker's trick): a replace in an array whose buffer no other view
  // shares writes the slot and leaves the array it was given a note (the
  // newer array, the slot, what was there), so a replace costs one write
  // however many hold the array. Reading an array with a note first puts
  // its buffer back as that array had it (array.reroot): the notes on the
  // way turned round, as Baker's are; or, when other views share the
  // buffer by then (a rest, a push into its room), in a copy of its own.
  // Only for an item type some replace isn't in place for (owned-arrays.ts
  // makes the rest replaceOwned): its view gets the note field, mutable.
  const versioned = new Set<number>();
  if (!(typeof process !== "undefined" && process.env.NO_ARRAY_VERSIONS)) {
    const scan = (e: SExpr): void => { const m = e.k === "rt" ? /^array\.replaceAt\.a(\d+)(\.i64)?$/.exec(e.fn) : null; if (m) versioned.add(Number(m[1])); kids(e).forEach(scan); };
    funcs.forEach((f) => scan(f.body));
    for (const a of versioned) if (colArrays.has(a)) versioned.delete(a);
  }
  const VERSION_FN = /^array\.(cur|reroot)\.a(\d+)$/;
  const versionRt = (name: string, m: RegExpExecArray): RtFn => {
    const base = { name, array: Number(m[2]), native: true as const };
    // The array itself, its buffer as it has it.
    if (m[1] === "cur") return { ...base, params: [["a", "array"]], result: "array", locals: [], uses: [`array.reroot.a${m[2]}`], body: [
      "local.get $a", "struct.get $arr 3", "ref.is_null", "i32.eqz", "if void", "local.get $a", `call $array.reroot.a${m[2]}`, "end", "local.get $a"].join("\n") };
    return { ...base, params: [["a", "array"]], result: "void", uses: [],
      locals: [["sh", "i32"], ["p", "array"], ["c", "array"], ["nx", "array"], ["nt", "note"], ["s", "i32"], ["w", "item"], ["x", "array"], ["y", "array"], ["it", "items"], ["cp", "items"]],
      body: [
        // The way to the newest turned round: each note on it names the older.
        "ref.null $arr", "local.set $p", "local.get $a", "local.set $c",
        "block void", "loop void",
        "local.get $c", "struct.get $arr 3", "local.tee $nt", "ref.is_null", "br_if 1",
        "local.get $nt", "struct.get $note 0", "local.set $nx", "local.get $nt", "local.get $p", "struct.set $note 0",
        "local.get $c", "local.set $p", "local.get $nx", "local.set $c", "br 0",
        "end", "end",
        // The newest's buffer (an older one given a copy of its own holds
        // another), and whether another view shares it.
        "local.get $c", "struct.get $arr 0", "struct.get $buf 3", "local.set $sh",
        "local.get $c", "struct.get $arr 0", "struct.get $buf 0", "local.set $it",
        // Shared: undone in a copy.
        "local.get $sh", "if void",
        "local.get $it", "array.len", "array.new_default $items", "local.set $cp",
        "local.get $cp", "i32.const 0", "local.get $it", "i32.const 0", "local.get $it", "array.len", "array.copy $items $items",
        "local.get $cp", "local.set $it", "end",
        // Back from the newest, each slot as the older had it.
        "local.get $c", "local.set $x", "local.get $p", "local.set $y",
        "block void", "loop void",
        "local.get $y", "ref.is_null", "br_if 1",
        "local.get $y", "struct.get $arr 3", "local.set $nt",
        "local.get $nt", "struct.get $note 1", "local.set $s",
        "local.get $nt", "struct.get $note 0", "local.set $p",
        "local.get $sh", "if void",
        // The notes left as they were.
        "local.get $it", "local.get $s", "local.get $nt", "struct.get $note 2", "array.set $items",
        "local.get $nt", "local.get $x", "struct.set $note 0",
        "else",
        // The note moved to the newer, with what it held there.
        "local.get $it", "local.get $s", "array.get $items", "local.set $w",
        "local.get $it", "local.get $s", "local.get $nt", "struct.get $note 2", "array.set $items",
        "local.get $nt", "local.get $y", "struct.set $note 0",
        "local.get $nt", "local.get $w", "struct.set $note 2",
        "local.get $x", "local.get $nt", "struct.set $arr 3",
        "local.get $y", "ref.null $note", "struct.set $arr 3",
        "local.get $y", "local.get $c", "struct.get $arr 0", "struct.set $arr 0",
        "end",
        "local.get $y", "local.set $x", "local.get $p", "local.set $y", "br 0",
        "end", "end",
        "local.get $sh", "if void",
        "local.get $a", "local.get $it",
        "local.get $c", "struct.get $arr 0", "struct.get $buf 1", "local.get $c", "struct.get $arr 0", "struct.get $buf 2", "i32.const 0", "struct.new $buf",
        "struct.set $arr 0",
        "local.get $a", "ref.null $note", "struct.set $arr 3",
        "end",
      ].join("\n"),
    };
  };
  // The replace itself: in place with a note where no other view shares
  // the buffer, the copy otherwise (REPLACE_COPY, after this).
  const NOTED = [
    "local.get $a", "struct.get $arr 0", "struct.get $buf 3", "i32.eqz",
    "local.get $k", "i64.const 0", "i64.ge_s", "i32.and",
    "local.get $k", "local.get $a", "struct.get $arr 2", "i64.extend_i32_s", "i64.lt_s", "i32.and",
    "if void",
    "local.get $a", "struct.get $arr 1", "local.get $k", "i32.wrap_i64", "i32.add", "local.set $n",
    "local.get $a", "struct.get $arr 0", "struct.get $buf 0", "local.set $it",
    "local.get $a", "struct.get $arr 0", "local.get $a", "struct.get $arr 1", "local.get $a", "struct.get $arr 2", "struct.new $arr", "local.set $b",
    "local.get $a", "local.get $b", "local.get $n", "local.get $it", "local.get $n", "array.get $items", "struct.new $note", "struct.set $arr 3",
    "local.get $it", "local.get $n", "local.get $x", "array.set $items",
    "local.get $b", "return",
    "end",
  ].join("\n");
  const versions = (g: RtFn): RtFn => {
    const a = g.array!;
    const noted = /^array\.replaceAt\.a\d+\.i64$/.test(g.name);
    // After a byte array's widening (wasm-rt.ts byteSlots), if any.
    const widen = `local.get $a\ncall $array.widen.a${a}\n`, w = g.body.startsWith(widen) ? widen : "";
    const body = (noted ? `${w}${NOTED}\n${g.body.slice(w.length)}` : g.body)
      .replace(/struct\.get \$arr 0/g, `call $array.cur.a${a}\nstruct.get $arr 0`).replace(/struct\.new \$arr/g, "ref.null $note\nstruct.new $arr");
    return { ...g, body, locals: noted ? [...g.locals, ["b", "array"]] : g.locals, uses: body.includes(`call $array.cur.a${a}`) ? [...g.uses, `array.cur.a${a}`] : g.uses };
  };
  // A fold's stack's push, top and pop (C327d), on its frame case's struct
  // S.c1: field 1 its items, field 2 how many.
  const fstackRt = (name: string): RtFn => {
    const [, op, k] = FSTACK.exec(name)!;
    const d = lowered.data[Number(k)], v = d.cases[1].fields[0].t as DType, j = stacks.indexOf(d);
    // (Got when it's written: the structs and globals are laid out later.)
    const types = { S: d, V: v, get SF() { return caseIndex(d, 1); }, get SI() { return stackItems.get(d.key)!; }, get "global spare"() { return stackGlobals + 2 * j; }, get "global done"() { return stackGlobals + 2 * j + 1; } };
    const lines = (xs: string[]) => xs.join("\n");
    if (op === "top") return { name, params: [["s", "S" as VT]], result: "V" as VT, locals: [], uses: [], types, body: lines([
      "local.get $s", "ref.cast $SF", "struct.get $SF 1", "local.get $s", "ref.cast $SF", "struct.get $SF 2", "i32.const 1", "i32.sub", "array.get $SI"]) };
    // Popped: the slot let go, and an emptied stack kept for the next fold.
    if (op === "pop") return { name, params: [["s", "S" as VT]], result: "S" as VT, locals: [["f", "SF" as VT], ["n", "i32"], ["r", "S" as VT]], uses: [], types, body: lines([
      "local.get $s", "ref.cast $SF", "local.tee $f", "local.get $f", "struct.get $SF 2", "i32.const 1", "i32.sub", "local.tee $n", "struct.set $SF 2",
      "local.get $f", "struct.get $SF 1", "local.get $n", "ref.null $V", "array.set $SI",
      "local.get $n", "i32.eqz", "if void", "local.get $f", "global.set $spare", "global.get $done", "local.set $r", "else", "local.get $f", "local.set $r", "end", "local.get $r"]) };
    return { name, params: [["x", "V" as VT], ["s", "S" as VT]], result: "S" as VT, locals: [["f", "SF" as VT], ["a", "SI" as VT], ["b", "SI" as VT], ["n", "i32"]], uses: [], types, body: lines([
      "local.get $s", "struct.get $S 0", "if void", "local.get $s", "ref.cast $SF", "local.set $f",
      "else", "global.get $spare", "local.tee $f", "ref.is_null", "if void", "i32.const 1", "i32.const 8", "array.new_default $SI", "i32.const 0", "struct.new $SF", "local.set $f",
      "else", "ref.null $SF", "global.set $spare", "end", "end",
      "local.get $f", "struct.get $SF 2", "local.tee $n", "local.get $f", "struct.get $SF 1", "local.tee $a", "array.len", "i32.eq", "if void",
      "local.get $n", "i32.const 2", "i32.mul", "array.new_default $SI", "local.tee $b", "i32.const 0", "local.get $a", "i32.const 0", "local.get $n", "array.copy $SI $SI",
      "local.get $f", "local.get $b", "struct.set $SF 1", "local.get $b", "local.set $a", "end",
      "local.get $a", "local.get $n", "local.get $x", "array.set $SI",
      "local.get $f", "local.get $n", "i32.const 1", "i32.add", "struct.set $SF 2", "local.get $f"]) };
  };
  // A deep loop's frame made (a spare one written again, else a new one)
  // and taken (its next given, it spare), C327g part 2b.
  const frameRt = (name: string): RtFn => {
    const [, op, k, cs] = FRAME_FN.exec(name)!;
    const d = lowered.data[Number(k)], c = Number(cs), fs = d.cases[c].fields, n = fs.length, j = spareAt(d, c);
    const types: Record<string, unknown> = { S: d, get SF() { return caseIndex(d, c); }, get "global spare"() { return stackGlobals + 2 * stacks.length + nils.length + j; }, get "global made"() { return stackGlobals + 2 * stacks.length + nils.length + spares.length + madeAt.get(`new ${d.name ?? d.key}.${c} (fresh frame)`)!; } };
    fs.forEach((x, i) => { types[`X${i}`] = x.t; });
    if (op === "take") return { name, params: [["s", "S" as VT]], result: "S" as VT, locals: [], uses: [], types: types as RtFn["types"], body: [
      "local.get $s", "ref.cast $SF", `struct.get $SF ${n}`, "local.get $s", "ref.cast $SF", "global.get $spare", `struct.set $SF ${n}`, "local.get $s", "global.set $spare"].join("\n") };
    return { name, params: fs.map((x, i): [string, VT] => [`x${i}`, (typeof x.t === "string" ? x.t : `X${i}`) as VT]), result: "S" as VT, locals: [["f", "SF" as VT]], uses: [], types: types as RtFn["types"], body: [
      "global.get $spare", "ref.test $SF", "if void",
      "global.get $spare", "ref.cast $SF", "local.tee $f", `struct.get $SF ${n}`, "global.set $spare",
      ...fs.flatMap((_, i) => ["local.get $f", `local.get $x${i}`, `struct.set $SF ${i + 1}`]),
      "else", `i32.const ${c}`, ...fs.map((_, i) => `local.get $x${i}`), "struct.new $SF", "local.set $f",
      ...(counting ? ["global.get $made", "i64.const 1", "i64.add", "global.set $made"] : []),
      "end", "local.get $f"].join("\n") };
  };
  // A view held by value (C327c2, wasm-views.ts): its buffer, start and
  // length taken out, a rest's start and length, a view made of the three,
  // and the reads written again on the three, from the array's own.
  const viewRt = (name: string): RtFn => {
    const [, op, k] = VIEW_FN.exec(name)!, array = Number(k);
    const three: [string, VT][] = [["vb", "buf"], ["vs", "i32"], ["vn", "i32"]];
    if (op === "restLength") return { name, params: [["vn", "i32"]], result: "i32", locals: [], uses: [], native: true, body: "i32.const 0\nlocal.get $vn\ni32.const 1\ni32.sub\nlocal.get $vn\ni32.eqz\nselect" };
    // Another view on the buffer: a replace in place no longer may.
    if (op === "restStart") return { name, array, params: three, result: "i32", locals: [], uses: [], native: true, body: ["local.get $vn", "i32.eqz", "if i32", "local.get $vs", "else", "local.get $vb", "i32.const 1", "struct.set $buf 3", "local.get $vs", "i32.const 1", "i32.add", "end"].join("\n") };
    if (op === "make") return { name, array, params: three, result: "array", locals: [], uses: [], native: true, body: "local.get $vb\nlocal.get $vs\nlocal.get $vn\nstruct.new $arr" };
    // After a push: one longer, and starting where its buffer's first item
    // is (a push in front), or where it did unless the buffer is a copy.
    if (op === "grown") return { name, params: [["vn", "i32"]], result: "i32", locals: [], uses: [], native: true, body: "local.get $vn\ni32.const 1\ni32.add" };
    if (op === "pushFrontStart") return { name, array, params: [["t", "buf"], ["vb", "buf"], ["vs", "i32"]], result: "i32", locals: [], uses: [], native: true, body: "local.get $t\nstruct.get $buf 1" };
    if (op === "pushStart" || op === "pushOwnedStart") return { name, array, params: [["t", "buf"], ["vb", "buf"], ["vs", "i32"]], result: "i32", locals: [], uses: [], native: true, body: "local.get $vs\nlocal.get $t\nstruct.get $buf 1\nlocal.get $t\nlocal.get $vb\nref.eq\nselect" };
    const part = ["buf", "start", "count"].indexOf(op);
    if (part >= 0) return { name, array, params: [["a", "array"]], result: part ? "i32" : "buf", locals: [], uses: [], native: true, body: `local.get $a\nstruct.get $arr ${part}` };
    const g = rt0(name.replace(/^view\./, "array."));
    const body = g.body.replace(/local\.get \$a\s+struct\.get \$arr ([012])/g, (_, i) => `local.get $${three[Number(i)][0]}`)
      .replace(/local\.get \$a\b/g, "local.get $vb\nlocal.get $vs\nlocal.get $vn").replace(/call \$array\.(\w+)\.a(\d+)/g, "call $view.$1.a$2");
    if (g.params[0]?.[0] !== "a" || /\$v[bsn]\b/.test(g.body) || /\$a\b/.test(body)) throw new Error(`${name}: not a read of the view alone`);
    // A push gives its buffer alone (wasm-views.ts works out the rest).
    if (op === "push" || op === "pushOwned" || op === "pushFront") return { ...g, name, params: [...three, ...g.params.slice(1)], result: "buf", body: body.replace(/struct\.new \$arr\b/g, "drop\ndrop"), uses: g.uses.map((x) => x.replace(/^array\.(\w+)\.a(\d+)/, "view.$1.a$2")) };
    return { ...g, name, params: [...three, ...g.params.slice(1)], body, uses: g.uses.map((x) => x.replace(/^array\.(\w+)\.a(\d+)/, "view.$1.a$2")) };
  };
  // A Bytes's list, made from its bytes the first time it's read (C345),
  // and an Int array of a Bytes's items, a byte a slot on its bytes as
  // they are (array.narrow's layout; nothing writes them, a write widens
  // first) when it has them and they are 16 or more.
  const bytesRt = (name: string): RtFn => {
    const b = lowered.records.find((r) => r.key === BYTES_T)!;
    const loop = (n: string, body: string) => `block void\nloop void\n${n}\ni32.eqz\nbr_if 1\n${body}\nbr 0\nend\nend`;
    if (name === "bytes.list") return { name, params: [["b", "Bytes" as VT]], result: "list", list: LIST_INT, locals: [["y", "raw"], ["n", "i32"], ["acc", "list"]], uses: ["int.of", "IntList.nil", "IntList.cons"], types: { Bytes: b }, body: [
      "local.get $b", "struct.get $Bytes 0", "ref.is_null", "i32.eqz", "if void", "local.get $b", "struct.get $Bytes 0", "return", "end",
      "local.get $b", "struct.get $Bytes 1", "local.tee $y", "array.len", "local.set $n", "call $IntList.nil", "local.set $acc",
      loop("local.get $n", ["local.get $y", "local.get $n", "i32.const 1", "i32.sub", "local.tee $n", "array.get_u $bytes", "i64.extend_i32_u", "call $int.of", "local.get $acc", "call $IntList.cons", "local.set $acc"].join("\n")),
      "local.get $b", "local.get $acc", "struct.set $Bytes 0", "local.get $acc"].join("\n") };
    const a = Number(name.slice(name.lastIndexOf(".a") + 2)), of = `array.of.a${a}`;
    const listed = ["local.get $b", "call $bytes.list", `call $${of}`, "return"].join("\n");
    return { name, array: a, params: [["b", "Bytes" as VT]], result: "array", locals: [["y", "raw"], ["n", "i32"]], uses: ["bytes.list", of], types: { Bytes: b }, body: [
      "local.get $b", "struct.get $Bytes 1", "local.tee $y", "ref.is_null", "if void", listed, "end",
      "local.get $y", "array.len", "local.tee $n", "i32.const 16", "i32.lt_u", "if void", listed, "end",
      "ref.null $items", "i32.const 0", "local.get $n", "i32.const 0", "local.get $y", "struct.new $buf", "i32.const 0", "local.get $n", "struct.new $arr"].join("\n") };
  };
  // With TERS_COUNT_VIEWS (wasi), each view made is counted in memory at
  // 120, an i64 a runner reads after (C327c2: structs made, not time).
  // (Its value a pattern: only the runtime functions it matches; 1 all.)
  const countViews = wasi && typeof process !== "undefined" && process.env.TERS_COUNT_VIEWS ? new RegExp(process.env.TERS_COUNT_VIEWS === "1" ? "" : process.env.TERS_COUNT_VIEWS) : null;
  const rt = (name: string): RtFn => { const g = rt1(name); return countViews?.test(name) ? { ...g, body: g.body.replace(/struct\.new \$arr\b/g, "struct.new $arr\ni32.const 120\ni32.const 120\ni64.load\ni64.const 1\ni64.add\ni64.store") } : g; };
  const rt1 = (name: string): RtFn => {
    const vm = VERSION_FN.exec(name);
    if (vm) { const v = versionRt(name, vm); return byteArray(lowered.arrays[v.array!]) ? byteSlots(v) : v; }
    const cm = COL_FN.exec(name);
    if (cm) return colRt(name, cm);
    const g = rt0(name);
    if (g.array !== undefined && versioned.has(g.array)) return versions(g);
    // The buffer's columns, none, wherever it's made as rows.
    if (g.array === undefined || !colArrays.has(g.array)) return g;
    return { ...g, types: { ...g.types, ...colTypes(g.array) }, body: g.body.replace(/struct\.new \$buf/g, `${colArrays.get(g.array)!.map((_, f) => `ref.null $col${f}`).join("\n")}\nstruct.new $buf`) };
  };
  const rt0 = (name: string): RtFn => {
    if (/^grid\.found\.\d+$/.test(name)) return gridRt(Number(name.slice(11)));
    if (STACK.test(name)) return stackRt(name);
    if (FSTACK.test(name)) return fstackRt(name);
    if (FRAME_FN.test(name)) return frameRt(name);
    if (VIEW_FN.test(name)) return viewRt(name);
    if (TABLE_RT.test(name)) { const f = tableRt(name, lowered.tables); return f.array !== undefined && byteArray(lowered.arrays[f.array]) ? byteSlots(f) : f; }
    if (name === "wasi.stop") return { ...wasiStop(lowered.stops ?? []), name };
    // Bytes, the module's own record (C291).
    // File info, its Instant and File kind (C310).
    if (/^wasi\.fileInfo(\.raw)?$/.test(name)) {
      const info = lowered.records.find((r) => r.key === FILE_INFO_T), kind = lowered.data.find((d) => d.key === FILE_KIND_T);
      if (!info || !kind || !isRecord(info.fields[2].t) || (info.fields[1].t !== "int" && info.fields[1].t !== "i64")) throw new Error(`${name}: the module's File info isn't as file info makes it`);
      const f = runtime(name);
      const i64 = info.fields[1].t === "i64";
      return { ...f, name, uses: i64 ? f.uses.filter((x) => x !== "int.of") : f.uses, body: i64 ? f.body.replace("i64.load\n      call $int.of", "i64.load") : f.body, types: { Info: info, Instant: info.fields[2].t, Kind: kind } };
    }
    if (name === "bytes.list" || /^array\.ofBytes\.a\d+$/.test(name)) return bytesRt(name);
    if (/^wasi\.((read|write)Bytes|offerFile|askForFile)(\.raw)?$/.test(name)) { const b = lowered.records.find((r) => r.key === BYTES_T); if (!b) throw new Error(`${name}: the module has no Bytes`); return { ...runtime(name), name, types: { Bytes: b } }; }
    const f = runtime(name);
    return f.array !== undefined && byteArray(lowered.arrays[f.array]) ? byteSlots(f) : f;
  };
  const need = (name: string) => {
    if (rtNames.includes(name)) return;
    if (name.startsWith("wasi_")) { if (!wasiImports.includes(name)) wasiImports.push(name); return; }
    if (/^(Text(List|Option)|Int(List|Option)|Bytes)\./.test(name)) return;
    rtNames.push(name);
    // (A fold's stack's use nothing, and its types are laid out below.)
    if (!FSTACK.test(name)) rt(name).uses.forEach(need);
  };
  // A fold's stack (scalar.ts framesOf, C327d), as C's (c.ts stackOf):
  // one struct a fold, its values in a growable array, pushed on the way
  // down and popped on the way up, not a frame struct each. The stack a
  // fold emptied waits in a global for the next fold of its type, and
  // `done` is one struct made once, so a shallow fold makes nothing. Its
  // frame case is the stack (case 1, its items and how many), the empty
  // one `done` (case 0). Not where a function giving several answers
  // takes it, as core-js.ts's.
  const several = new Set<string>();
  const framesIn = (e: SExpr) => { const t = (e as { t?: LType }).t; if (t && isData(t) && t.inner && t.key.endsWith(".frames")) several.add(t.key); kids(e).forEach(framesIn); };
  for (const g of funcs0) if (g.multi) framesIn(g.body);
  const noStacks = typeof process !== "undefined" && !!process.env.NO_FOLD_STACKS;
  const stackOf = (t: LType): boolean => isData(t) && !!t.inner && t.key.endsWith(".frames") && t.cases.length === 2 && !t.cases[0].fields.length && t.cases[1].fields.length === 2 && t.cases[1].fields[1].t === t && isData(t.cases[1].fields[0].t) && !several.has(t.key) && !noStacks;
  const stacks = lowered.data.filter(stackOf);
  // A deep loop's frames, a spare list a case (C327g part 2b, frame-spares.ts).
  const noSpares = shader || (typeof process !== "undefined" && !!process.env.NO_FRAME_SPARES);
  const spared = noSpares ? [] : frameSpares(funcs, lowered.data, (d) => several.has(d.key));
  const spares = spared.flatMap((d) => d.cases.slice(1).map((_, c) => ({ d, c: c + 1 })));
  const spareAt = (d: DType, c: number) => spares.findIndex((x) => x.d === d && x.c === c);
  // With TERS_COUNT_MAKES, each place that makes a struct (a record, a
  // case, a closure) counts what it makes in an exported i64 global,
  // `made.<k>`, the module's `made` naming each (C327g: structs made, not
  // time; compiler/gaps/made.ts reads them).
  // A case with no fields (an empty list, `none`, a deep loop's `done`)
  // is one struct made once, in a global, as a fold stack's `done` is
  // (C327g): nothing can tell two apart, nothing writes them.
  const noNils = typeof process !== "undefined" && !!process.env.NO_NIL_GLOBALS;
  const nils: { t: DType; c: number }[] = [], nilAt = new Map<string, number>();
  const nilKey = (e: SExpr): string | null => (e.k === "new" && !e.args.length && !stackOf(e.t) && !noNils ? `${e.t.key}\u0000${e.c}` : null);
  for (const f of funcs) (function walk(e: SExpr) { const k = nilKey(e); if (k !== null && !nilAt.has(k)) { nilAt.set(k, nils.length); nils.push({ t: (e as { t: DType }).t, c: (e as { c: number }).c }); } kids(e).forEach(walk); })(f.body);
  const counting = typeof process !== "undefined" && !!process.env.TERS_COUNT_MAKES;
  const made: string[] = [], madeAt = new Map<string, number>();
  const site = (e: SExpr, f: SFunc): string | null => e.k === "make" ? `make ${e.t.name ?? e.t.key} in ${f.name}` : e.k === "new" && !stackOf(e.t) && nilKey(e) === null ? `new ${e.t.name ?? e.t.key}.${e.c} in ${f.name}` : e.k === "closure" ? `closure ${funcs[e.fn].name} in ${f.name}` : null;
  if (counting) for (const { d, c } of spares) { const k = `new ${d.name ?? d.key}.${c} (fresh frame)`; madeAt.set(k, made.length); made.push(k); }
  if (counting) for (const f of funcs) (function walk(e: SExpr) { const k = site(e, f); if (k !== null && !madeAt.has(k)) { madeAt.set(k, made.length); made.push(k); } kids(e).forEach(walk); })(f.body);
  const fstack = (op: "push" | "top" | "pop", t: DType) => `fstack.${op}.${lowered.data.findIndex((x) => x.key === t.key)}`;
  const rtCalls = (e: SExpr): void => {
    if (e.k === "new" && stackOf(e.t) && e.c === 1) need(fstack("push", e.t));
    if (e.k === "field" && stackOf(e.t)) need(fstack(e.i === 0 ? "top" : "pop", e.t));
    // (derivative(f) carried by f is printed in place, I245.)
    if (e.k === "rt" && e.fn !== "derived") { if (STACK.test(e.fn)) stackArity.set(e.fn, e.args.length); need(e.fn); if (stepped(e)) need("i64.box"); }
    if (e.k === "op" && e.op === "mod") need("number.mod");
    if (e.k === "op" && INT32_RT.includes(e.op)) need(`int32.${e.op}`);
    kids(e).forEach(rtCalls);
  };
  // neighbours on a grid's `grid found` (C293), as c.ts gridC writes it:
  // each place's neighbours, the places j other than i whose squared
  // differences, added part by part as the definition adds them, are no
  // more than reach squared, in order. Each place's cell, a little wider
  // than reach, is hashed to one of 2n or more buckets, the places sorted
  // by bucket (counting), and each place looks through the buckets of the
  // cells around its own for the places in those cells. Places of up to 3
  // Float64 parts in an array, the lists Ints in arrays; otherwise as
  // compiled. The function's body becomes a call to `grid.found.<i>`.
  const gridded = new Map<number, { pa: AType; r: AType; inner: AType; rec?: RType; D: number }>();
  if (!shader && !int32) funcs.forEach((f, i) => {
    const pa = f.params[0], r = f.result;
    if ((f as ViewFunc).viewSlots || f.partial || f.spends || f.params.length !== 5 || originalOf(f.def) !== GRID_FOUND || !isArray(pa) || f.params[4] !== "f64" || !isArray(r) || !isArray(r.item) || r.item.item !== "int") return;
    const inner = r.item;
    if ([pa, r, inner].some((a) => versioned.has(a.index) || colArrays.has(a.index))) return;
    const pt = pa.item;
    const rec = isRecord(pt) && !pt.mutable && pt.fields.length <= 3 && pt.fields.every((x) => x.t === "f64") ? pt : undefined;
    const D = pt === "f64" ? 1 : rec ? rec.fields.length : 0;
    if (!D) return;
    gridded.set(i, { pa, r, inner, rec, D });
    funcs[i] = { ...f, body: { k: "rt", fn: `grid.found.${i}`, args: [{ k: "local", i: 0 }, { k: "local", i: 4 }] } };
  });
  const gridRt = (i: number): RtFn => {
    const { pa, r, inner, rec, D } = gridded.get(i)!;
    const of = (a: AType, x: string) => ({ ...a, key: `${x}:${a.key}` });
    const narrow = (k: number) => !!rec && k === 0 && isFloat32(rec);
    const read = (k: number) => (rec ? [`struct.get $Prec ${k}`, ...(narrow(k) ? ["f64.promote_f32"] : [])] : []);
    const loop = (v: string, to: string[], body: string[], from = ["i32.const 0"]) => [...from, `local.set $${v}`, "block void", "loop void", `local.get $${v}`, ...to, "i32.ge_u", "br_if 1", ...body, `local.get $${v}`, "i32.const 1", "i32.add", `local.set $${v}`, "br 0", "end", "end"];
    const each = (f: (k: number) => string[]) => Array.from({ length: D }, (_, k) => f(k)).flat();
    // A cell's bucket: its parts mixed (Fibonacci hashing), the top bits.
    const bucket = (part: (k: number) => string[]) => ["i64.const 0", ...each((k) => [...part(k), "i64.xor", "i64.const -7046029254386353131", "i64.mul"]), "i64.const 64", "local.get $bits", "i64.extend_i32_u", "i64.sub", "i64.shr_u", "i32.wrap_i64"];
    const at = (arr: string, j: string, k: number) => [`local.get $${arr}`, `local.get $${j}`, `i32.const ${D}`, "i32.mul", ...(k ? [`i32.const ${k}`, "i32.add"] : [])];
    const sq = (k: number) => [...at("x", "i", k), "array.get $gF", ...at("x", "j", k), "array.get $gF", "f64.sub", "local.tee $d", "local.get $d", "f64.mul"];
    const made = (I: string, n: string, bytes: boolean) => ["i32.const 0", `local.get $${n}`, "i32.const 0", ...(bytes ? ["ref.null $bytes"] : []), `struct.new $${I}buf`, "i32.const 0", `local.get $${n}`, `struct.new $${I}arr`];
    const body = [
      "local.get $a", "struct.get $Parr 2", "local.set $n",
      "local.get $a", "struct.get $Parr 0", "struct.get $Pbuf 0", "local.set $its",
      "local.get $a", "struct.get $Parr 1", "local.set $base",
      "local.get $r", "local.get $r", "f64.mul", "local.set $r2",
      "local.get $r", "f64.const 1.00000095367431640625", "f64.mul", "local.set $cell",
      "i32.const 16", "local.set $nb", "i32.const 4", "local.set $bits",
      "block void", "loop void", "local.get $nb", "local.get $n", "i32.const 1", "i32.shl", "i32.ge_u", "br_if 1",
      "local.get $nb", "i32.const 1", "i32.shl", "local.set $nb", "local.get $bits", "i32.const 1", "i32.add", "local.set $bits", "br 0", "end", "end",
      "local.get $n", `i32.const ${D}`, "i32.mul", "array.new_default $gF", "local.set $x",
      "local.get $n", `i32.const ${D}`, "i32.mul", "array.new_default $gI", "local.set $c",
      `i32.const ${D}`, "array.new_default $gI", "local.set $t",
      "local.get $n", "array.new_default $gU", "local.set $h",
      "local.get $nb", "i32.const 1", "i32.add", "array.new_default $gU", "local.set $st",
      "local.get $n", "array.new_default $gU", "local.set $ord",
      "local.get $n", "array.new_default $gU", "local.set $near",
      // Each place's parts and cell, and its bucket counted.
      ...loop("i", ["local.get $n"], [
        "local.get $its", "local.get $base", "local.get $i", "i32.add", "array.get $Pitems", "local.set $it",
        ...each((k) => [
          ...at("x", "i", k), "local.get $it", ...read(k), "array.set $gF",
          ...at("c", "i", k), "local.get $it", ...read(k), "local.get $cell", "f64.div", "f64.floor", "i64.trunc_sat_f64_s", "array.set $gI",
        ]),
        "local.get $h", "local.get $i", ...bucket((k) => [...at("c", "i", k), "array.get $gI"]), "local.tee $b", "array.set $gU",
        "local.get $st", "local.get $b", "local.get $st", "local.get $b", "array.get $gU", "i32.const 1", "i32.add", "array.set $gU",
      ]),
      // Each bucket's end; then the places put in from the last, so that
      // each bucket runs, in order, from its start to the next one's.
      ...loop("q", ["local.get $nb"], ["local.get $st", "local.get $q", "local.get $st", "local.get $q", "i32.const 1", "i32.sub", "array.get $gU", "local.get $st", "local.get $q", "array.get $gU", "i32.add", "array.set $gU"], ["i32.const 1"]),
      "local.get $st", "local.get $nb", "local.get $n", "array.set $gU",
      "local.get $n", "local.set $i",
      "block void", "loop void", "local.get $i", "i32.eqz", "br_if 1", "local.get $i", "i32.const 1", "i32.sub", "local.set $i",
      "local.get $h", "local.get $i", "array.get $gU", "local.set $b",
      "local.get $st", "local.get $b", "local.get $st", "local.get $b", "array.get $gU", "i32.const 1", "i32.sub", "local.tee $q", "array.set $gU",
      "local.get $ord", "local.get $q", "local.get $i", "array.set $gU", "br 0", "end", "end",
      "local.get $n", "array.new_default $Oitems", "local.set $ob",
      ...loop("i", ["local.get $n"], [
        "i32.const 0", "local.set $m",
        ...loop("o", [`i32.const ${3 ** D}`], [
          // The cell o steps away, and the places in its bucket that are in it.
          "local.get $o", "local.set $w",
          ...each((k) => ["local.get $t", `i32.const ${k}`, ...at("c", "i", k), "array.get $gI", "local.get $w", "i32.const 3", "i32.rem_u", "i64.extend_i32_u", "i64.add", "i64.const 1", "i64.sub", "array.set $gI", "local.get $w", "i32.const 3", "i32.div_u", "local.set $w"]),
          ...bucket((k) => ["local.get $t", `i32.const ${k}`, "array.get $gI"]), "local.set $b",
          "local.get $st", "local.get $b", "i32.const 1", "i32.add", "array.get $gU", "local.set $hi",
          ...loop("q", ["local.get $hi"], [
            "local.get $ord", "local.get $q", "array.get $gU", "local.tee $j", "local.get $i", "i32.ne",
            ...each((k) => [...at("c", "j", k), "array.get $gI", "local.get $t", `i32.const ${k}`, "array.get $gI", "i64.eq", "i32.and"]),
            "if void",
            ...sq(0), ...Array.from({ length: D - 1 }, (_, k) => [...sq(k + 1), "f64.add"]).flat(),
            "local.set $s",
            "local.get $r2", "local.get $s", "f64.lt", "i32.eqz",
            "if void",
            // Kept, in order: the ones past it moved up one.
            "local.get $m", "local.set $z", "local.get $m", "i32.const 1", "i32.add", "local.set $m",
            "block void", "loop void", "local.get $z", "i32.eqz", "br_if 1", "local.get $near", "local.get $z", "i32.const 1", "i32.sub", "array.get $gU", "local.get $j", "i32.le_u", "br_if 1",
            "local.get $near", "local.get $z", "local.get $near", "local.get $z", "i32.const 1", "i32.sub", "array.get $gU", "array.set $gU",
            "local.get $z", "i32.const 1", "i32.sub", "local.set $z", "br 0", "end", "end",
            "local.get $near", "local.get $z", "local.get $j", "array.set $gU",
            "end", "end",
          ], ["local.get $st", "local.get $b", "array.get $gU"]),
        ]),
        "local.get $m", "array.new_default $Iitems", "local.set $ib",
        ...loop("q", ["local.get $m"], ["local.get $ib", "local.get $q", "local.get $near", "local.get $q", "array.get $gU", "ref.i31", "array.set $Iitems"]),
        "local.get $ob", "local.get $i", "local.get $ib", ...made("I", "m", byteArray(inner)), "array.set $Oitems",
      ]),
      "local.get $ob", ...made("O", "n", byteArray(r)),
    ];
    const scratch = (key: string) => ({ key, name: key, fields: [] }) as unknown as RType;
    const types: Record<string, unknown> = {
      Parr: pa, Pbuf: of(pa, "buf"), Pitems: of(pa, "items"), Oarr: r, Obuf: of(r, "buf"), Oitems: of(r, "items"), Iarr: inner, Ibuf: of(inner, "buf"), Iitems: of(inner, "items"),
      gF: scratch("grid.f64s"), gI: scratch("grid.i64s"), gU: scratch("grid.i32s"), ...(rec ? { Prec: rec } : {}),
    };
    const i32s = ["n", "base", "nb", "bits", "i", "j", "q", "o", "w", "m", "z", "b", "hi"].map((n) => [n, "i32"] as [string, VT]);
    const refs = [["its", "Pitems"], ["x", "gF"], ["c", "gI"], ["t", "gI"], ["h", "gU"], ["st", "gU"], ["ord", "gU"], ["near", "gU"], ["ob", "Oitems"], ["ib", "Iitems"]] as unknown as [string, VT][];
    return {
      name: `grid.found.${i}`, params: [["a", "Parr" as VT], ["r", "f64"]], result: "Oarr" as VT, uses: [], types,
      locals: [...i32s, ...(["r2", "cell", "s", "d"].map((n) => [n, "f64"] as [string, VT])), ["it", (rec ? "Prec" : "f64") as VT], ...refs],
      body: body.join("\n"),
    };
  };
  // An array's views held by value in a loop (C327c2, wasm-views.ts):
  // not where the view is the version (C285) or the buffer is columns.
  const bufTypes = new Map<number, AType>();
  const bufOf = (a: AType) => { if (!bufTypes.has(a.index)) bufTypes.set(a.index, { ...a, key: `buf:${a.key}` }); return bufTypes.get(a.index)!; };
  if (!shader && !int32 && !(typeof process !== "undefined" && process.env.NO_WASM_VIEWS)) funcs.forEach((f, i) => { const g = viewsByValue(f, i, (a) => !versioned.has(a.index) && !colArrays.has(a.index), bufOf, (j) => (funcs[j].partial ? null : arrayCall(funcs[j]))); if (g) funcs[i] = g; });
  funcs.forEach((f) => { rtCalls(f.body); (f as ViewFunc).viewEntry?.forEach(([, x]) => rtCalls(x)); });
  if (math) maths.forEach((op) => op !== "stop" && need(`math.${op}`));
  if (wasi && maths.includes("stop")) need("wasi.stop");
  // The world's operations used, imported from "world" in the order first
  // used, then "reason" (the last failure's) when one can fail.
  const worldOps: Extract<SExpr, { k: "world" }>[] = [];
  const worldCalls = (e: SExpr): void => { if (e.k === "world" && !worldOps.some((x) => x.op === e.op)) worldOps.push(e); kids(e).forEach(worldCalls); };
  funcs.forEach((f) => worldCalls(f.body));
  const main = wasi ? funcs.find((f) => (opts.main ? f.def === opts.main : f.name === "main") && !f.inner && !f.budgeted) : undefined;
  if (wasi && (!main || main.params.length > 1)) throw new Error("a WASI command needs a main that takes the arguments, or nothing");
  if (wasi) {
    worldOps.forEach((x) => need(`wasi.${x.op}`));
    if (worldOps.some((x) => x.aborts)) need("wasi.reason");
    if (main!.params.length) need("wasi.args");
    need("wasi.line");
    need("wasi_proc_exit");
  }
  // Ints (W5): an i31, a $big or a $huge; the host makes and reads them with toInt and fromInt.
  // A runtime function on magnitudes alone (text.readNumber) needs their
  // array type too.
  const ints = !int32 && rtNames.some((n) => { const f = rt(n); const ts = [...f.params.map(([, t]) => t), f.result, ...(f.locals ?? []).map(([, t]) => t)]; return ts.includes("int") || ts.includes("mag"); })
    || funcs.some((f) => [...f.params, ...f.locals, f.result].includes("int") || mentions(f.body, "int"))
    || lowered.records.some((x) => x.fields.some((y) => y.t === "int")) || lowered.data.some((d) => d.cases.some((c) => c.fields.some((y) => y.t === "int")));
  if (ints) ["int.of", "int.small", ...(wasi ? [] : ["int.limbs", "int.limb", "int.huge", "int.setLimb"])].forEach(need);
  const texty = rtNames.some((n) => { const f = rt(n); return [...f.params, ...f.locals, ["", f.result] as const].some(([, t]) => t === "text" || t === "list" || t === "option") || /\$bytes|\$text\./.test(f.body); }) || worldOps.length > 0 || funcs.some((f) => [...f.locals, f.result].includes("text") || mentionsText(f.body));
  // The host makes and reads texts through these.
  if (texty) ["text.new", "text.put", "text.put4", "text.size", "text.byte"].forEach(need);
  // The host reads a Float64's text with Number.text: on a Text (I222),
  // not on the array the runtime's own functions use.
  if (rtNames.includes("number.js.raw")) need("number.js");
  const rts: RtFn[] = rtNames.map(rt);
  // A small one called with locals, put in place (G3g, wasm-rt.ts inlined).
  const rtOf = new Map(rts.map((g) => [g.name, g])), noInline = typeof process !== "undefined" && !!process.env.NO_INLINE_RT;
  const inPlace = (e: SExpr, names: (i: number) => string) => {
    if (e.k !== "rt" || noInline || !e.args.every((a) => a.k === "local")) return null;
    const g = rtOf.get(e.fn), at = e.args.map((a) => (a as { i: number }).i);
    return g ? inlined(g, resolver(g), at, at.map(names)) : null;
  };
  // Ryū's tables, for number.js: an i64 array type and a global holding them.
  const ryu = rtNames.includes("number.mulshift");
  const worldReason = worldOps.some((x) => x.aborts);
  const worldBase = hosts.length;
  const worldIndex = (op: string) => (wasi ? rtIndex(`wasi.${op}`) : worldBase + worldOps.findIndex((x) => x.op === op));
  const reasonIndex = () => (wasi ? rtIndex("wasi.reason") : worldBase + worldOps.length);
  const imports = worldBase + (wasi ? wasiImports.length : worldOps.length + (worldReason ? 1 : 0));
  const fnIndex = (i: number) => imports + i;
  // A generic definition lowered at several types (plus on Vec and on
  // Colour) is exported under its name once, then with the types it's at.
  // A generic definition's later copies are named by their inputs' types;
  // where those read the same (`length` at List Instr and at List Int both
  // read List), by a count too, since export names must differ (C92).
  const exportNames = new Map<SFunc, string>(), taken = new Set<string>();
  const exportName = (f: SFunc): string => {
    if (exportNames.size === 0) for (const g of funcs) {
      let n = taken.has(g.name) ? `${g.name}(${g.params.map((t) => (t === "f64" ? "Float64" : t === "i32" ? "Bool" : t === "int" || t === "int32" ? "Int" : t === "text" ? "Text" : t === "host" ? "Cell" : t === "i64" ? "Word64" : isFn(t) ? "Function" : t.name)).join(", ")})` : g.name;
      for (let k = 2, base = n; taken.has(n); k++) n = `${base} ${k}`;
      taken.add(n);
      exportNames.set(g, n);
    }
    return exportNames.get(f)!;
  };

  // ---- binary
  const u = (n: number): number[] => { const out: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };
  const s = (n: number): number[] => {
    const out: number[] = [];
    for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && b & 0x40)) { out.push(b); return out; } out.push(b | 0x80); }
  };
  const str = (x: string) => { const b = [...new TextEncoder().encode(x)]; return [...u(b.length), ...b]; };
  const vec = (items: number[][]) => [...u(items.length), ...items.flat()];
  const section = (id: number, body: number[]) => [id, ...u(body.length), ...body];
  const f64 = (v: number) => [...new Uint8Array(new Float64Array([v]).buffer)];
  const sBig = (n: bigint): number[] => {
    const out: number[] = [];
    for (;;) { const b = Number(n & 0x7fn); n >>= 7n; if ((n === 0n && !(b & 0x40)) || (n === -1n && b & 0x40)) { out.push(b); return out; } out.push(b | 0x80); }
  };

  // Types: the structs first, as one recursion group: each record's, and
  // for each data type its base and then its cases'. Then one function
  // type per distinct signature. A value of either is a nullable
  // reference, so a local of one starts as null and `ref.null` is its zero.
  const recs = lowered.records, datas = lowered.data;
  // A type in the group: a struct, or (`func`) a closure's code's type.
  // A field with `code` holds a closure's code, a (ref $code) of that index.
  // `bytes`: Text's array.
  // `items`: an Array's items (C66), a mutable array of the item type;
  // a field with `ref` holds a (nullable) reference to that type.
  const structs: { name: string; fields: { name: string; t: MType; code?: number; ref?: number; narrow?: true; mut?: true }[]; sup?: number; final: boolean; func?: FType; maker?: { self: FType; result: FType }; bytes?: true; i64s?: true; u32s?: true; refs?: true; mutable?: true; items?: MType; narrowItems?: true }[] = [];
  if (texty) structs.push({ name: "bytes", fields: [], final: true, bytes: true });
  // A Text (I222): its bytes' array, where in it the text starts, its
  // size, its characters (-1 till counted), and the array's fill when it
  // has room to grow (wasm-rt.ts text.concat).
  if (texty) structs.push({ name: "text", fields: [{ name: "b", t: "i32", ref: 0 }, { name: "o", t: "i32" }, { name: "n", t: "i32" }, { name: "k", t: "i32" }, { name: "f", t: "i32", ref: 1 }], final: true, mutable: true });
  const bytesIndex = 0, textIndex = 1, i64sIndex = structs.length;
  if (ryu) structs.push({ name: "i64s", fields: [], final: true, i64s: true });
  const bigIndex = structs.length;
  if (ints) structs.push({ name: "big", fields: [{ name: "v", t: "i64" }], final: true });
  // Past an i64 (W5b): a $huge, its sign and its magnitude's 32-bit limbs.
  // The handler stack's array (L213c8).
  const stack = rtNames.some((n) => STACK.test(n));
  const u32sIndex = structs.length, hugeIndex = u32sIndex + 1;
  if (ints) structs.push({ name: "u32s", fields: [], final: true, u32s: true }, { name: "huge", fields: [{ name: "neg", t: "i32" }, { name: "mag", t: "mag" }], final: true });
  const hstackIndex = structs.length;
  if (stack) structs.push({ name: "hstack", fields: [], final: true, refs: true });
  const recIndex = new Map<string, number>(), baseIndex = new Map<string, number>();
  // neighbours on a grid's scratch arrays (gridRt).
  if (gridded.size) for (const [key, items] of [["grid.f64s", "f64"], ["grid.i64s", "i64"], ["grid.i32s", "i32"]] as const) { recIndex.set(key, structs.length); structs.push({ name: key, fields: [], final: true, items }); }
  const ident = (x: string) => x.replace(/[^\w]+/g, "_");
  // A Float32's value is held as an f32 (C309): a binary32 already, so
  // demoted where it is made and promoted where it is read, exactly.
  // (A Bytes on WASI: its list, made when first read, and its bytes, C345.)
  const rawField = rawBytes && texty;
  for (const r of recs) { recIndex.set(r.key, structs.length); structs.push({ name: `${ident(r.name)}${structs.length}`, fields: isFloat32(r) ? [{ ...r.fields[0], narrow: true }] : rawField && r.key === BYTES_T ? [{ ...r.fields[0], mut: true }, { name: "raw", t: "i32", ref: bytesIndex }] : r.fields, final: true, ...(r.mutable ? { mutable: true as const } : {}) }); }
  const CASE = { name: "case", t: "i32" as const };
  const stackItems = new Map<string, number>();
  for (const d of datas) {
    const b = structs.length, name = `${ident(d.name)}${b}`;
    baseIndex.set(d.key, b);
    structs.push({ name, fields: [CASE], final: false });
    if (stackOf(d)) {
      // A fold's stack: done, then the stack itself, then its items.
      structs.push({ name: `${name}.done`, fields: [CASE], sup: b, final: true });
      structs.push({ name: `${name}.stack`, fields: [CASE, { name: "items", t: "i32", ref: b + 3, mut: true }, { name: "n", t: "i32", mut: true }], sup: b, final: true });
      stackItems.set(d.key, b + 3);
      structs.push({ name: `${name}.items`, fields: [], final: true, items: d.cases[1].fields[0].t });
      continue;
    }
    const spare = spared.includes(d);
    for (const c of d.cases) structs.push({ name: `${name}.${ident(c.name)}`, fields: [CASE, ...(spare ? c.fields.map((x) => ({ ...x, mut: true as const })) : c.fields)], sup: b, final: true });
  }
  // A function type: its closure's struct, holding the code, then the
  // code's type, taking the closure and the inputs; each closure's own
  // struct (a shape) adds what it captured.
  // A function type whose closures carry a derivative (I245) holds, after
  // the code, its maker (`d`): given the closure, the derivative's
  // closure; null on a closure with none.
  const derived = lowered.derived ?? new Map<string, FType>();
  const cloIndex = new Map<string, number>();
  for (const t of lowered.fns) {
    const c = structs.length, dt = derived.get(t.key);
    cloIndex.set(t.key, c);
    structs.push({ name: `fn${c}`, fields: [{ name: "code", t: "i32", code: c + 1 }, ...(dt ? [{ name: "d", t: "i32" as const, ref: c + 2 }] : [])], final: false });
    structs.push({ name: `fn${c}.code`, fields: [], final: true, func: t });
    if (dt) structs.push({ name: `fn${c}.maker`, fields: [], final: true, maker: { self: t, result: dt } });
  }
  // Where a closure's captures start: after its code, and its maker.
  const capsAt = (t: FType) => (derived.has(t.key) ? 2 : 1);
  const shapeIndex = lowered.shapes.map((sh, i) => {
    const c = cloIndex.get(sh.t.key)!;
    structs.push({ name: `fn${c}.closure${i}`, fields: [{ name: "code", t: "i32", code: c + 1 }, ...(derived.has(sh.t.key) ? [{ name: "d", t: "i32" as const, ref: c + 2 }] : []), ...sh.caps.map((t, j) => ({ name: `c${j}`, t }))], sup: c, final: true });
    return structs.length - 1;
  });
  // An Array (C66): its items, its buffer (the items, and the lowest and
  // highest slots in use, which pushes change) and the view, which is the
  // value: the buffer, a start and a length.
  const arrIndex = new Map<string, number>();
  for (const a of lowered.arrays) {
    // Its columns first, when it's kept so (colArrays): the buffer's fields past its own.
    const cols = (colArrays.get(a.index) ?? []).map((t, f) => { recIndex.set(`col.${a.index}.${f}`, structs.length); structs.push({ name: `col${a.index}.${f}`, fields: [], final: true, items: t, ...(colNarrow.get(a.index)![f] ? { narrowItems: true as const } : {}) }); return { name: `c${f}`, t: "i32" as const, ref: structs.length - 1 }; });
    const k = structs.length;
    structs.push({ name: `items${a.index}`, fields: [], final: true, items: a.item });
    // An Int array's buffer has its bytes too (L189f2b, wasm-rt.ts byteSlots).
    structs.push({ name: `buf${a.index}`, fields: [{ name: "items", t: "i32", ref: k }, { name: "lo", t: "i32" }, { name: "hi", t: "i32" }, { name: "shared", t: "i32" }, ...(byteArray(a) ? [{ name: "bytes", t: "i32" as const, ref: bytesIndex }] : []), ...cols], final: true, mutable: true });
    const noted = versioned.has(a.index);
    structs.push({ name: `array${a.index}`, fields: [{ name: "buf", t: "i32", ref: k + 1 }, { name: "start", t: "i32" }, { name: "n", t: "i32" }, ...(noted ? [{ name: "note", t: "i32" as const, ref: k + 3 }] : [])], final: true, ...(noted ? { mutable: true as const } : {}) });
    // Its note (C285): the newer array, the slot and what was there.
    if (noted) structs.push({ name: `note${a.index}`, fields: [{ name: "next", t: "i32", ref: k + 2 }, { name: "slot", t: "i32" }, { name: "old", t: a.item }], final: true, mutable: true });
    arrIndex.set(a.key, k + 2);
    // Its buffer, where a loop holds a view by value (C327c2).
    arrIndex.set(`buf:${a.key}`, k + 1);
    arrIndex.set(`items:${a.key}`, k);
  }
  // A table (C63j, wasm-table.ts): each slot's state, its keys and its
  // values, the store holding them, a version (the newest holds the store,
  // an older one the change from the next) and the versions a reroot walks.
  const tblIndex = new Map<number, number>();
  const TBL: Record<string, number> = { tst: -4, tkeys: -3, tvals: -2, tstore: -1, tbl: 0, table: 0, tpath: 1 };
  for (const t of lowered.tables) {
    const k = structs.length, n = `table.${t.index}`;
    structs.push({ name: `${n}.st`, fields: [], final: true, items: "i32" });
    structs.push({ name: `${n}.keys`, fields: [], final: true, items: t.keyT });
    structs.push({ name: `${n}.vals`, fields: [], final: true, items: t.value });
    structs.push({ name: `${n}.store`, fields: [{ name: "st", t: "i32", ref: k }, { name: "ks", t: "i32", ref: k + 1 }, { name: "vs", t: "i32", ref: k + 2 }, { name: "n", t: "i32" }, { name: "used", t: "i32" }, { name: "direct", t: "i32" }], final: true, mutable: true });
    structs.push({ name: n, fields: [{ name: "cur", t: "i32", ref: k + 3 }, { name: "next", t: "i32", ref: k + 4 }, { name: "key", t: t.keyT }, { name: "had", t: "i32" }, { name: "old", t: t.value }], final: true, mutable: true });
    structs.push({ name: `${n}.path`, fields: [], final: true, items: t });
    tblIndex.set(t.index, k + 4);
    // Its parts as types a runtime function's signature can name.
    for (const [part, off] of Object.entries(TBL)) if (part !== "tbl" && part !== "table") recIndex.set(`${n}.${part}`, k + 4 + off);
  }
  const arrayOf = (f?: RtFn): AType => { const a = f?.array !== undefined ? lowered.arrays[f.array] : undefined; if (!a) throw new Error(`${f?.name}: no array type`); return a; };
  const caseIndex = (d: DType, c: number) => baseIndex.get(d.key)! + 1 + c;
  const isRec = (t: MType): t is RType | DType | FType | AType | TType => typeof t !== "string";
  // The runtime's names for types and functions.
  // `list` in a runtime function is the list type it names (List Text if none).
  const listOf = (f?: RtFn) => {
    const key = f?.array !== undefined ? arrayOf(f).list?.key ?? "" : f?.list ?? LIST_TEXT, d = datas.find((x) => x.key === key);
    if (!d) throw new Error(`the runtime's ${key} isn't one of the module's types`);
    return d;
  };
  const optionOf = () => {
    const d = datas.find((x) => x.key === OPTION_TEXT);
    if (!d) throw new Error("the runtime's Optional Text isn't one of the module's types");
    return d;
  };
  const resolver = (f?: RtFn) => ({
    type: (n: string) => (typeof f?.types?.[n] === "number" ? f.types[n] as number : f?.table !== undefined && TBL[n] !== undefined ? tblIndex.get(f.table)! + TBL[n] : f?.types?.[n] ? refIndex(f.types[n] as RType) : /\.c\d+$/.test(n) && f?.types?.[n.replace(/\.c\d+$/, "")] ? caseIndex(f.types[n.replace(/\.c\d+$/, "")] as DType, Number(n.slice(n.lastIndexOf(".c") + 2))) : n === "arr" ? arrIndex.get(arrayOf(f).key)! : n === "buf" ? arrIndex.get(arrayOf(f).key)! - 1 : n === "items" ? arrIndex.get(arrayOf(f).key)! - 2 : n === "note" ? arrIndex.get(arrayOf(f).key)! + 1 : n === "bytes" ? bytesIndex : n === "text" ? textIndex : n === "i64s" ? i64sIndex : n === "big" ? bigIndex : n === "u32s" ? u32sIndex : n === "huge" ? hugeIndex : n === "hstack" ? hstackIndex : n === "option" ? baseIndex.get(OPTION_TEXT)! : n === "list" ? baseIndex.get(listOf(f).key)! : caseIndex(listOf(f), n === "list.nil" ? 0 : 1)),
    func: (n: string) => {
      if (n.startsWith("wasi_")) return worldBase + wasiImports.indexOf(n);
      if (n === "main") return fnIndex(funcs.indexOf(main!));
      const h = helpers.findIndex((x) => x.name === n);
      return h >= 0 ? fnIndex(funcs.length + h) : rtIndex(n);
    },
    global: (n: string) => (typeof f?.types?.[`global ${n}`] === "number" ? f.types[`global ${n}`] as number : n === "reason" ? reasonG : n === "pow5" ? pow5G : n === "msp" ? mspG : n === "none" ? noneG : n === "hs" ? stackG : n === "hn" ? stackG + 1 : /^r[0-3]$/.test(n) ? randG + Number(n[1]) : 0),
    memory: (n: string) => ({ index: 0, base: n === "math" ? MATH_AT : 0 }),
    at: (n: string) => { if (n !== "buf") throw new Error(`no address @${n}`); return math ? MATH_AT + 65536 : MATH_AT; },
    valtype: (t: VT) => {
      if (t === "list") return { bytes: typeOf(listOf(f)), text: `(ref null $${structs[baseIndex.get(listOf(f).key)!].name})` };
      if (t === "option") return { bytes: typeOf(optionOf()), text: `(ref null $${structs[baseIndex.get(OPTION_TEXT)!].name})` };
      if (t === "void") throw new Error("nothing isn't a value type");
      // A type the function names itself (a data type a table's key walks, C243).
      if (f?.types?.[t] && typeof f.types[t] !== "number" && isRec(f.types[t] as MType)) { const m = f.types[t] as MType; return { bytes: typeOf(m), text: `(ref null $${structs[refIndex(m as RType)].name})` }; }
      if (typeof f?.types?.[t] === "number") { const k = f.types[t] as number; return { bytes: [0x63, ...s(k)], text: `(ref null $${structs[k].name})` }; }
      if (f?.table !== undefined && TBL[t] !== undefined) { const k = tblIndex.get(f.table)! + TBL[t]; return { bytes: [0x63, ...s(k)], text: `(ref null $${structs[k].name})` }; }
      if (t === "key" || t === "value") {
        const m = t === "key" ? lowered.tables[f!.table!].keyT : lowered.tables[f!.table!].value;
        return { bytes: typeOf(m), text: m === "text" ? "(ref null $text)" : isRec(m) ? `(ref null $${structs[refIndex(m)].name})` : m === "int" || m === "host" ? "eqref" : m as string };
      }
      if (t === "array" || t === "item") {
        const m = t === "array" ? arrayOf(f) : arrayOf(f).item;
        return { bytes: typeOf(m), text: m === "text" ? "(ref null $text)" : isRec(m) ? `(ref null $${structs[refIndex(m)].name})` : m === "int" || m === "host" ? "eqref" : m as string };
      }
      if (t === "buf" || t === "items" || t === "note") { const k = arrIndex.get(arrayOf(f).key)! + (t === "buf" ? -1 : t === "items" ? -2 : 1); return { bytes: [0x63, ...s(k)], text: `(ref null $${structs[k].name})` }; }
      return { bytes: typeOf(t as MType), text: t === "text" ? "(ref null $text)" : t === "raw" ? "(ref null $bytes)" : t === "int" ? "eqref" : t === "mag" ? "(ref null $u32s)" : t as string };
    },
  });
  const resolve = resolver();
  const rtIndex = (n: string) => fnIndex(funcs.length + helpers.length + rts.findIndex((f) => f.name === n));
  const refIndex = (t: RType | DType | FType | AType | TType) => (isTable(t) ? tblIndex.get(t.index)! : isArray(t) ? arrIndex.get(t.key)! : isData(t) ? baseIndex.get(t.key)! : isFn(t) ? cloIndex.get(t.key)! : recIndex.get(t.key)!);
  const typeOf = (t: MType): number[] => (t === "text" ? [0x63, ...s(textIndex)] : t === "raw" ? [0x63, ...s(bytesIndex)] : isRec(t) ? [0x63, ...s(refIndex(t))] : t === "int" || t === "host" ? [0x63, 0x6d] : t === "mag" ? [0x63, ...s(u32sIndex)] : [VAL[t as keyof typeof VAL]]);
  const keyOf = (t: MType) => (isRec(t) ? t.key : t);
  // A partial function (one answer or none) gives a status after its
  // answer: 0 for an answer, 1 for none.
  // A null result: nothing (a world operation that gives the unit).
  const sigs: { key: string; params: MType[]; result: MType | null; partial?: boolean }[] = [];
  const sig = (params: MType[], result: MType | null, partial?: boolean) => {
    const key = `${params.map(keyOf).join(",")}>${result === null ? "" : keyOf(result)}${partial ? "!" : ""}`;
    if (!sigs.some((x) => x.key === key)) sigs.push({ key, params, result, partial });
    return structs.length + sigs.findIndex((x) => x.key === key);
  };
  const hostSig = hosts.map((op) => sig(Array(HOST[op]!.params).fill("f64"), "f64"));
  // A world operation giving the unit gives nothing (the module makes it);
  // one that can fail gives a status after.
  const isUnit = (t: LType) => isRec(t) && !isData(t) && !isFn(t) && !isArray(t) && !isTable(t) && t.fields.length === 0;
  const worldSig = wasi ? [] : worldOps.map((x) => sig(x.args.map((_, j) => x.ins?.[j] ?? ("text" as LType)), isUnit(x.t) ? null : x.t, x.aborts));
  const reasonSig = worldReason && !wasi ? sig([], "text") : 0;
  const wasiSig = wasiImports.map((n) => sig(WASI_IMPORTS[n.slice(5)].params, WASI_IMPORTS[n.slice(5)].result));
  // A closure's code has its function type's code type, so call_ref takes it.
  const codeOf = new Map<number, FType>();
  // And a derivative's maker its type's maker type (I245).
  const makerOf = new Map<number, FType>();
  const closures = (e: SExpr): void => { if (e.k === "closure") { codeOf.set(e.fn, e.t); if (e.d !== undefined) makerOf.set(e.d, e.t); } kids(e).forEach(closures); };
  funcs.forEach((f) => closures(f.body));
  const funcSig = funcs.map((f, i) => (codeOf.has(i) ? cloIndex.get(codeOf.get(i)!.key)! + 1 : makerOf.has(i) ? cloIndex.get(makerOf.get(i)!.key)! + 2 : sig(f.params, f.result, f.partial)));
  const declared = [...codeOf.keys(), ...makerOf.keys()];
  // For the host, which can't look inside a struct: a reader for each
  // field of each record, exported as `Colour.red`; for each data type
  // `List.case`, the number of a value's case, and for each case a maker
  // (`List.cons`) and its fields' readers (`List.cons.head`).
  const helpers: { name: string; key: string; params: LType[]; result: LType; code: number[]; wat: string[] }[] = [];
  for (const r of recs) {
    const k = recIndex.get(r.key)!;
    helpers.push({ name: `${r.name}.${r.case ?? "make"}`, key: r.key, params: r.fields.map((x) => x.t), result: r, code: [...r.fields.flatMap((_, j) => [0x20, ...u(j)]), ...(isFloat32(r) ? [0xb6] : []), ...(rawField && r.key === BYTES_T ? [0xd0, ...s(bytesIndex)] : []), 0xfb, 0x00, ...u(k)], wat: [...r.fields.map((_, j) => `local.get ${j}`), ...(isFloat32(r) ? ["f32.demote_f64"] : []), ...(rawField && r.key === BYTES_T ? ["ref.null $bytes"] : []), `struct.new $${structs[k].name}`] });
  }
  for (const r of recs) r.fields.forEach((x, j) => helpers.push({ name: `${r.name}.${x.name}`, key: r.key, params: [r], result: x.t, code: [0x20, 0x00, 0xfb, 0x02, ...u(recIndex.get(r.key)!), ...u(j), ...(isFloat32(r) ? [0xbb] : [])], wat: ["local.get 0", `struct.get $${structs[recIndex.get(r.key)!].name} ${j}`, ...(isFloat32(r) ? ["f64.promote_f32"] : [])] }));
  for (const d of datas) {
    if (d.inner) continue;
    const b = baseIndex.get(d.key)!;
    helpers.push({ name: `${d.name}.case`, key: d.key, params: [d], result: "i32", code: [0x20, 0x00, 0xfb, 0x02, ...u(b), 0x00], wat: ["local.get 0", `struct.get $${structs[b].name} 0`] });
    d.cases.forEach((c, ci) => {
      const k = caseIndex(d, ci), sn = `$${structs[k].name}`;
      helpers.push({
        name: `${d.name}.${c.name}`, key: d.key, params: c.fields.map((x) => x.t), result: d,
        code: [0x41, ...s(ci), ...c.fields.flatMap((_, j) => [0x20, ...u(j)]), 0xfb, 0x00, ...u(k)],
        wat: [`i32.const ${ci}`, ...c.fields.map((_, j) => `local.get ${j}`), `struct.new ${sn}`],
      });
      c.fields.forEach((x, j) => helpers.push({
        name: `${d.name}.${c.name}.${x.name}`, key: d.key, params: [d], result: x.t,
        code: [0x20, 0x00, 0xfb, 0x16, ...s(k), 0xfb, 0x02, ...u(k), ...u(j + 1)],
        wat: ["local.get 0", `ref.cast (ref ${sn})`, `struct.get ${sn} ${j + 1}`],
      }));
    });
  }
  // Global 0 the fuel left (when something spends), then the reason of
  // the last abort: the host reads it with Abort.reason when a function
  // gives status 2.
  const fuel = funcs.some((f) => f.spends || budgets(f.body)) || (int32 && rtNames.some((n) => /^int32\.i(add|sub|mul|neg|abs|pow|whole)$/.test(n)));
  // $none, a shader's flag (after the others).
  const flags = flagging && funcs.some((f) => flagged(f.body));
  const aborts = funcs.some((f) => mentions(f.body, "abort")) || worldReason;
  const reasonG = fuel ? 1 : 0, pow5G = (fuel ? 1 : 0) + (aborts ? 1 : 0), mspG = pow5G + (ryu ? 1 : 0);
  // Another operation that never returns (C34) leaves the operation, a
  // value of its effect's type, in $escape on its way out, as an eqref.
  const escapes = lowered.escapes.length > 0, escapeG = mspG + (math ? 1 : 0), noneG = escapeG + (escapes ? 1 : 0);
  // Random's generator under `seeded` (C106): four words, $r0 to $r3.
  const rand = rtNames.some((n) => n.startsWith("rand.")), randG = noneG + (flags ? 1 : 0);
  // A definition's value worked out once (C173): what a function of no
  // inputs gives is kept in a global of its own the first time it is
  // called, as the core IR's JavaScript keeps it (core-js.ts, `$v ??=`);
  // bounce's Clifford table was made again for every step. Only records,
  // data and texts, which nothing changes in place; a value that is null
  // is worked out again, as before. And arrays (C30), which don't change
  // either: a push writes only a slot no other view has taken, and
  // replace at copies (wasm-rt.ts ARRAYS); a table read by position was
  // made again for every read.
  // But not an array of a type written in place (owned-arrays.ts): each
  // naming gives a new one, as one-holder.ts reads it (G3f: the moths'
  // `empty grid`, filed into every tick).
  const written = new Set<number>();
  const writes = (e: SExpr): void => { if (e.k === "rt") { const m = /^array\.(replaceOwned|pushFrontOwned|pushOwned)\.a(\d+)$/.exec(e.fn); if (m) written.add(Number(m[2])); } kids(e).forEach(writes); };
  funcs.forEach((f) => writes(f.body));
  const kept = new Map<number, number>();
  funcs.forEach((f, i) => { if (f.value && !f.params.length && !f.partial && !f.spends && (f.result === "text" || isRecord(f.result) || isData(f.result) || (isArray(f.result) && (!written.has(f.result.index) || emptyArray(f.body))))) kept.set(i, randG + (rand ? 4 : 0) + kept.size); });
  const stackG = randG + (rand ? 4 : 0) + kept.size;
  // Each fold stack's two (C327d): the one waiting, and done.
  const stackGlobals = stackG + (stack ? 2 : 0);
  if (aborts) helpers.push({ name: "Abort.reason", key: "", params: [], result: "text", code: [0x23, ...u(reasonG)], wat: ["global.get $reason"] });
  // For the world's host: lists and optionals of texts, by fixed names
  // (TextList.cons, TextOption.some), whatever else the module has; for
  // the files `with open file` keeps (L213c9), Option Int and Bytes, whose
  // List Int it reads too (IntList.case, IntList.cons.head …).
  for (const [key, as] of [[LIST_TEXT, "TextList"], [OPTION_TEXT, "TextOption"], [OPTION_INT, "IntOption"], [LIST_INT, "IntList"]] as const) {
    const d = datas.find((x) => x.key === key);
    if (!d) continue;
    const b = baseIndex.get(d.key)!;
    if (as === "IntList") helpers.push({ name: `${as}.case`, key: d.key, params: [d], result: "i32", code: [0x20, 0x00, 0xfb, 0x02, ...u(b), 0x00], wat: ["local.get 0", `struct.get $${structs[b].name} 0`] });
    d.cases.forEach((c, ci) => {
      const k = caseIndex(d, ci), sn = `$${structs[k].name}`;
      helpers.push({ name: `${as}.${c.name}`, key: d.key, params: c.fields.map((x) => x.t), result: d, code: [0x41, ...s(ci), ...c.fields.flatMap((_, j) => [0x20, ...u(j)]), 0xfb, 0x00, ...u(k)], wat: [`i32.const ${ci}`, ...c.fields.map((_, j) => `local.get ${j}`), `struct.new ${sn}`] });
      if (as === "IntList") c.fields.forEach((x, j) => helpers.push({ name: `${as}.${c.name}.${x.name}`, key: d.key, params: [d], result: x.t, code: [0x20, 0x00, 0xfb, 0x16, ...s(k), 0xfb, 0x02, ...u(k), ...u(j + 1)], wat: ["local.get 0", `ref.cast (ref ${sn})`, `struct.get ${sn} ${j + 1}`] }));
    });
  }
  const bytesRec = recs.find((r) => r.key === BYTES_T);
  if (bytesRec) {
    const k = recIndex.get(bytesRec.key)!;
    helpers.push({ name: "Bytes.make", key: bytesRec.key, params: [bytesRec.fields[0].t], result: bytesRec, code: [0x20, 0x00, ...(rawField ? [0xd0, ...s(bytesIndex)] : []), 0xfb, 0x00, ...u(k)], wat: ["local.get 0", ...(rawField ? ["ref.null $bytes"] : []), `struct.new $${structs[k].name}`] });
    helpers.push({ name: "Bytes.items", key: bytesRec.key, params: [bytesRec], result: bytesRec.fields[0].t, code: [0x20, 0x00, 0xfb, 0x02, ...u(k), 0x00], wat: ["local.get 0", `struct.get $${structs[k].name} 0`] });
  }
  // File info (C310), for the host's file info: made from its kind, its
  // size and its Instant; FileInfo.make64 where the size is an i64.
  const infoRec = recs.find((r) => r.key === FILE_INFO_T), kindD = datas.find((d) => d.key === FILE_KIND_T);
  if (infoRec && kindD && isRecord(infoRec.fields[2].t) && baseIndex.has(kindD.key)) {
    const k = recIndex.get(infoRec.key)!, at = infoRec.fields[2].t, ak = recIndex.get(at.key)!;
    helpers.push({ name: infoRec.fields[1].t === "i64" ? "FileInfo.make64" : "FileInfo.make", key: infoRec.key, params: infoRec.fields.map((x) => x.t), result: infoRec, code: [0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0xfb, 0x00, ...u(k)], wat: ["local.get 0", "local.get 1", "local.get 2", `struct.new $${structs[k].name}`] });
    helpers.push({ name: "Instant.make", key: at.key, params: at.fields.map((x) => x.t), result: at, code: [0x20, 0x00, 0xfb, 0x00, ...u(ak)], wat: ["local.get 0", `struct.new $${structs[ak].name}`] });
    kindD.cases.forEach((_, ci) => { const c = caseIndex(kindD, ci); helpers.push({ name: `FileKind.${ci}`, key: kindD.key, params: [], result: kindD, code: [0x41, ...s(ci), 0xfb, 0x00, ...u(c)], wat: [`i32.const ${ci}`, `struct.new $${structs[c].name}`] }); });
  }
  // A Locale (C315), for the host's my locale: made from its name.
  const localeRec = recs.find((r) => r.key === LOCALE_T);
  if (localeRec) {
    const k = recIndex.get(localeRec.key)!;
    helpers.push({ name: "Locale.make", key: localeRec.key, params: [localeRec.fields[0].t], result: localeRec, code: [0x20, 0x00, 0xfb, 0x00, ...u(k)], wat: ["local.get 0", `struct.new ${structs[k].name}`] });
  }
  helpers.forEach((x, k) => { if (helpers.findIndex((y) => y.name === x.name) !== k) x.name = `${x.name}(${x.key})`; });
  const helperSig = helpers.map((x) => sig(x.params, x.result));
  // _start: main, given the arguments; an abort's reason to standard
  // error and exit 1, else the exit code from an Int or a Float64, or 0.
  if (wasi) {
    const m = main!, r = m.result;
    rts.push({
      name: "wasi.start", params: [], result: "void", locals: m.partial ? [["st", "i32"]] : [], uses: [],
      body: [
        ...(m.params.length ? ["call $wasi.args"] : []), "call $main",
        ...(m.partial ? ["local.set $st", "local.get $st", "if void", ...(aborts ? ["local.get $st", "i32.const 2", "i32.eq", "if void", "i32.const 2", "global.get $reason", "call $wasi.line", "end"] : []), "i32.const 1", "call $wasi_proc_exit", "unreachable", "end"] : []),
        ...(r === "int" ? ["call $int.small", "i32.wrap_i64"] : r === "f64" ? ["i32.trunc_sat_f64_s"] : ["drop", "i32.const 0"]),
        "call $wasi_proc_exit",
      ].join("\n"),
    });
  }
  const rtType = (f: RtFn, t: VT): MType | null => (f.types?.[t] ? f.types[t] as MType : t === "table" ? lowered.tables[f.table!] : t === "key" ? lowered.tables[f.table!].keyT : t === "value" ? lowered.tables[f.table!].value : t === "list" ? listOf(f) : t === "option" ? optionOf() : t === "void" ? null : t === "array" ? arrayOf(f) : t === "item" ? arrayOf(f).item : t === "buf" ? bufOf(arrayOf(f)) : t === "items" ? null : t === "tstore" || t === "tkeys" || t === "tvals" || t === "tst" || t === "tpath" ? { key: `table.${f.table}.${t}`, name: t, fields: [] } as unknown as RType : t as MType);
  const rtSig = rts.map((f) => sig(f.params.map(([, t]) => rtType(f, t)!), rtType(f, f.result), f.partial));
  const rtCode = rts.map((f) => assemble(f, resolver(f)));
  const struct = (x: (typeof structs)[number]) => {
    if (x.bytes) return [0x5e, 0x78, 0x01];
    if (x.i64s) return [0x5e, 0x7e, 0x00];
    if (x.u32s) return [0x5e, 0x7f, 0x01];
    if (x.refs) return [0x5e, 0x6d, 0x01];
    if (x.items) return [0x5e, ...(x.narrowItems ? [0x7d] : typeOf(x.items)), 0x01];
    if (x.func) return [0x60, ...vec([x.func, ...x.func.params].map(typeOf)), ...vec([typeOf(x.func.result), ...(x.func.partial ? [[0x7f]] : [])])];
    if (x.maker) return [0x60, ...vec([typeOf(x.maker.self)]), ...vec([typeOf(x.maker.result)])];
    const body = [0x5f, ...vec(x.fields.map((y) => [...(y.code !== undefined ? [0x64, ...s(y.code)] : y.ref !== undefined ? [0x63, ...s(y.ref)] : y.narrow ? [0x7d] : typeOf(y.t)), x.mutable || y.mut ? 0x01 : 0x00]))];
    return x.final && x.sup === undefined ? body : [x.final ? 0x4f : 0x50, ...vec(x.sup === undefined ? [] : [u(x.sup)]), ...body];
  };
  const typeSec = vec([
    ...(structs.length ? [[0x4e, ...vec(structs.map(struct))]] : []),
    ...sigs.map((x) => [0x60, ...vec(x.params.map(typeOf)), ...vec([...(x.result === null ? [] : [typeOf(x.result)]), ...(x.partial ? [[0x7f]] : [])])]),
  ]);
  const importSec = vec([
    ...hosts.map((op, i) => [...str("Math"), ...str(HOST[op]!.name), 0x00, ...u(hostSig[i])]),
    ...worldOps.filter(() => !wasi).map((x, i) => [...str("world"), ...str(x.op), 0x00, ...u(worldSig[i])]),
    ...(worldReason && !wasi ? [[...str("world"), ...str("reason"), 0x00, ...u(reasonSig)]] : []),
    ...wasiImports.map((n, i) => [...str("wasi_snapshot_preview1"), ...str(n.slice(5)), 0x00, ...u(wasiSig[i])]),
  ]);
  const funcSec = vec([...funcSig, ...helperSig, ...rtSig].map((t) => u(t)));
  // The runtime functions the host uses, by these names.
  const RT_EXPORTS: Record<string, string> = { "text.new": "Text.new", "text.put": "Text.put", "text.put4": "Text.put4", "text.size": "Text.size", "text.byte": "Text.byte", "wasi.start": "_start", "number.js": "Number.text", "int.of": "Int.of", "int.small": "Int.get", "int.limbs": "Int.limbs", "int.limb": "Int.limb", "int.huge": "Int.huge", "int.setLimb": "Int.setLimb" };
  const rtExports = rts.filter((f) => RT_EXPORTS[f.name]);
  // Only what can be called from outside a budget is exported.
  const entries = funcs.map((f, i) => [f, i] as const).filter(([f]) => !f.budgeted && !f.inner);
  const exportSecOf = () => vec([
    ...entries.map(([f, i]) => [...str(exportName(f)), 0x00, ...u(fnIndex(i))]),
    ...helpers.map((x, k) => [...str(x.name), 0x00, ...u(fnIndex(funcs.length + k))]),
    ...rtExports.map((f) => [...str(RT_EXPORTS[f.name]), 0x00, ...u(rtIndex(f.name))]),
    ...(wasi ? [[...str("memory"), 0x02, 0x00]] : []),
    ...made.map((_, k) => [...str(`made.${k}`), 0x03, ...u(madeBase + k)]),
  ]);
  // global 0: the fuel left, an f64. Outside any budget it's infinite, so
  // what the checker couldn't see end just runs (only `data` calls it there).
  const globalsBefore = [
    ...(fuel ? [[0x7c, 0x01, 0x44, ...f64(Infinity), 0x0b]] : []),
    ...(aborts ? [[0x63, ...s(textIndex), 0x01, 0xd0, ...s(textIndex), 0x0b]] : []),
    ...(ryu ? [[0x64, ...s(i64sIndex), 0x00, ...POW5.flatMap((v) => [0x42, ...sBig(v)]), 0xfb, 0x08, ...u(i64sIndex), ...u(POW5.length), 0x0b]] : []),
    // The math functions' stack pointer, from the end of their page down.
    ...(math ? [[0x7f, 0x01, 0x41, ...s(65536), 0x0b]] : []),
    ...(escapes ? [[0x6d, 0x01, 0xd0, 0x6d, 0x0b]] : []),
    ...(flags ? [[0x7f, 0x01, 0x41, 0x00, 0x0b]] : []),
    ...(rand ? [0, 1, 2, 3].map(() => [0x7f, 0x01, 0x41, 0x00, 0x0b]) : []),
    ...[...kept.keys()].map((i) => { const t = funcs[i].result as MType; return [...typeOf(t), 0x01, 0xd0, ...s(t === "text" ? textIndex : refIndex(t as RType)), 0x0b]; }),
    ...(stack ? [[0x64, ...s(hstackIndex), 0x00, 0x41, ...s(SLOTS), 0xfb, 0x07, ...u(hstackIndex), 0x0b], [0x7f, 0x01, 0x41, 0x00, 0x0b]] : []),
    ...stacks.flatMap((d) => { const k = caseIndex(d, 1), z = caseIndex(d, 0); return [[0x63, ...s(k), 0x01, 0xd0, ...s(k), 0x0b], [0x64, ...s(z), 0x00, 0x41, 0x00, 0xfb, 0x00, ...u(z), 0x0b]]; }),
    ...nils.map(({ t, c }) => { const k = caseIndex(t, c); return [0x64, ...s(k), 0x00, 0x41, ...s(c), 0xfb, 0x00, ...u(k), 0x0b]; }),
    ...spares.map(({ d }) => [0x63, ...s(baseIndex.get(d.key)!), 0x01, 0x41, 0x00, 0xfb, 0x00, ...u(caseIndex(d, 0)), 0x0b]),
  ];
  const madeBase = globalsBefore.length, spareBase = madeBase - spares.length, nilBase = spareBase - nils.length;
  if (spareBase !== stackGlobals + 2 * stacks.length + nils.length) throw new Error("the frames' spare globals aren't where their functions read them");
  const globalSec = vec([...globalsBefore, ...made.map(() => [0x7e, 0x01, 0x42, 0x00, 0x0b])]);
  // A made struct counted: made.<k> += 1, the struct left on the stack.
  const count = (e: SExpr, f: SFunc): number[] => { const k = counting ? madeAt.get(site(e, f) ?? "") : undefined; if (k === undefined) return []; const g = u(madeBase + k); return [0x23, ...g, 0x42, 0x01, 0x7c, 0x24, ...g]; };
  const zero = (t: MType) => (t === "text" ? [0xd0, ...s(textIndex)] : isRec(t) ? [0xd0, ...s(refIndex(t))] : t === "f64" ? [0x44, ...f64(0)] : t === "int" || t === "host" ? [0xd0, 0x6d] : t === "mag" ? [0xd0, ...s(u32sIndex)] : t === "i64" ? [0x42, 0x00] : [0x41, 0x00]);
  // fuel = fuel - 1; if fuel < 0, return zero (a partial function: and
  // no answer, which the nearest handler sees)
  const spend = (f: SFunc) => (f.spends ? [0x23, 0x00, 0x44, ...f64(1), 0xa1, 0x24, 0x00, 0x23, 0x00, 0x44, ...f64(0), 0x63, 0x04, 0x40, ...zero(f.result), ...(f.partial ? [0x41, 0x01] : []), 0x0f, 0x0b] : []);
  // Whether f needs a local for a status: it's partial, or has no answer
  // somewhere, or tries something that may have none.
  // Remembered per node: a body's nodes can be shared (a value used in two
  // places is one node), so walking it as a tree went over the ray
  // marcher's motor exponentially often, minutes in the editor.
  // (A view held by value's read is the array's, written again here, C327c2.)
  const rtPartial = (n: string) => !!(VIEW_FN.test(n) || FRAME_FN.test(n) || n.startsWith("grid.found.") ? rt(n) : runtime(n)).partial;
  const fails = new WeakMap<SExpr, boolean>();
  const failing = (e: SExpr): boolean => {
    let r = fails.get(e);
    if (r === undefined) fails.set(e, r = e.k === "fail" || (e.k === "world" && e.aborts) || e.k === "attempt" || e.k === "abort" || e.k === "handle" || (e.k === "call" && !!funcs[e.fn].partial) || (e.k === "apply" && !!e.t.partial) || (e.k === "rt" && e.fn !== "derived" && rtPartial(e.fn)) || kids(e).some(failing));
    return r;
  };
  const statusOf = (f: SFunc) => (f.partial || failing(f.body) ? f.locals.length : -1);

  // f's code. `d` is how many blocks are open around e, and `fl` the
  // block a status goes to when there's no answer (counted from the
  // outside; -1: none). A partial call's status is checked there: on to fl
  // if it isn't 0. With nowhere to go (a function of no Choice, called
  // through a closure under a budget that ran out) it's a trap, a runtime
  // error rather than a wrong answer.
  // An Int operation on locals and small literals (C207e): inline while
  // both are i31s and the answer is one, else the runtime's. An i31 is
  // the only Int of its value (int.of), so `ref.eq` says two are equal
  // when either is one. Each instruction as text and as bytes.
  type Ins = [string, number[]];
  const INT_FAST: Record<string, number> = { "int.add": 0x6a, "int.sub": 0x6b, "int.equal": 0, "int.less": 0x48 };
  const intFast = (e: SExpr, lget: (i: number) => Ins, call: Ins): Ins[] | null => {
    if (int32 || e.k !== "rt" || INT_FAST[e.fn] === undefined || e.args.length !== 2) return null;
    const os = e.args.map((a) => (a.k === "local" ? { get: [lget(a.i)] as Ins[] } : a.k === "int" && small(a.v) ? { v: a.v } : null));
    if (os.some((o) => !o)) return null;
    const [a, b] = os as ({ get: Ins[] } | { v: bigint })[];
    const lit = (o: { v: bigint }): Ins => [`i32.const ${o.v}`, [0x41, ...sBig(o.v)]];
    const get = (o: typeof a): Ins[] => ("v" in o ? [lit(o), ["ref.i31", [0xfb, 0x1c]]] : o.get);
    const val = (o: typeof a): Ins[] => ("v" in o ? [lit(o)] : [...o.get, ["ref.cast i31", [0xfb, 0x16, 0x6c]], ["i31.get_s", [0xfb, 0x1d]]]);
    const test = (o: typeof a): Ins[] => ("v" in o ? [] : [...o.get, ["ref.test i31", [0xfb, 0x14, 0x6c]]]);
    const both: Ins[] = [...test(a), ...test(b), ...("v" in a || "v" in b ? [] : [["i32.and", [0x71]] as Ins])];
    const IF = (t: "i32" | "eqref"): Ins => [`if (result ${t})`, [0x04, t === "i32" ? 0x7f : 0x6d]], ELSE: Ins = ["else", [0x05]], END: Ins = ["end", [0x0b]];
    const slow: Ins[] = [...get(a), ...get(b), call];
    const guarded = (t: "i32" | "eqref", fast: Ins[]): Ins[] => (both.length ? [...both, IF(t), ...fast, ELSE, ...slow, END] : fast);
    if (e.fn === "int.equal") {
      const eq: Ins[] = [...get(a), ...get(b), ["ref.eq", [0xd3]]];
      return "v" in a || "v" in b ? eq : [...eq, IF("i32"), ["i32.const 1", [0x41, 1]], ELSE, ...test(a), ...test(b), ["i32.or", [0x72]], IF("i32"), ["i32.const 0", [0x41, 0]], ELSE, ...slow, END, END];
    }
    const op: Ins = [e.fn === "int.add" ? "i32.add" : e.fn === "int.sub" ? "i32.sub" : "i32.lt_s", [INT_FAST[e.fn]]];
    if (e.fn === "int.less") return guarded("i32", [...val(a), ...val(b), op]);
    // The sum of two i31s fits an i32; it's an i31 when shifting it out and back keeps it.
    const r: Ins[] = [...val(a), ...val(b), op];
    return guarded("eqref", [...r, ["i32.const 1", [0x41, 1]], ["i32.shl", [0x74]], ["i32.const 1", [0x41, 1]], ["i32.shr_s", [0x75]], ...r, ["i32.eq", [0x46]], IF("eqref"), ...r, ["ref.i31", [0xfb, 0x1c]], ELSE, ...slow, END]);
  };
  const I64_OPS: Record<string, number> = { "i64.eq": 0x51, "i64.less": 0x53, "i64.and": 0x83, "i64.shr": 0x87 };
  // A function that calls itself last (and spends no fuel, and always
  // answers) runs as a loop: its body in a `loop`, the call its inputs set
  // and a branch back (C60 w2: drift's map, a tail call an item).
  const selfTail = (f: SFunc, i: number) => !f.partial && !f.spends && (function has(e: SExpr): boolean { return (e.k === "call" && e.tail && e.fn === i) || kids(e).some(has); })(f.body);
  function coder(f: SFunc) {
    const st = statusOf(f), self = funcs.indexOf(f), looped = selfTail(f, self);
    const to = (d: number, fl: number) => { if (fl < 0) throw new Error(`${f.name}: no answer, and nowhere to say so`); return u(d - 1 - fl); };
    const check = (d: number, fl: number) => (fl < 0 ? [0x04, 0x40, 0x00, 0x0b] : [0x22, ...u(st), 0x20, ...u(st), 0x0d, ...to(d, fl), 0x1a]);
    // After a handler's block, the status on the stack: the one it handles
    // (1: no answer, 2: an abort) stays, any other goes on out to fl.
    const on = (mine: number, d: number, fl: number) => (fl < 0 ? [0x1a] : [0x21, ...u(st), 0x20, ...u(st), 0x20, ...u(st), 0x41, mine, 0x47, 0x0d, ...to(d, fl), 0x1a]);
    // An attempt's no answer when a with fuel ran out: none out to fl, so
    // the with fuel gives its otherwise (I294). Outside any, the fuel is
    // infinite; a with fuel puts back the fuel it was under.
    const outOfFuel = (d: number, fl: number) => (!fuel || fl < 0 ? [] : [0x23, 0x00, 0x44, ...f64(0), 0x63, 0x04, 0x40, 0x41, 0x01, 0x0c, ...to(d + 1, fl), 0x0b]);
    return function code(e: SExpr, d: number, fl: number): number[] {
    const code1 = (x: SExpr) => code(x, d, fl);
    switch (e.k) {
      case "num": return [0x44, ...f64(e.v)];
      // An Int: an i31 while it fits, else a $big.
      // Past an i64 (a literal Int as big as 1e300, C101): a $huge of its
      // sign and its magnitude's 32-bit limbs, the lowest first.
      case "int": return int32 ? [0x41, ...sBig(e.v)] : small(e.v) ? [0x41, ...sBig(e.v), 0xfb, 0x1c] : inI64(e.v) ? [0x42, ...sBig(e.v), 0xfb, 0x00, ...u(bigIndex)]
        : [0x41, e.v < 0n ? 1 : 0, ...limbs(e.v).flatMap((l) => [0x41, ...sBig(BigInt(l))]), 0xfb, 0x08, ...u(u32sIndex), ...u(limbs(e.v).length), 0xfb, 0x00, ...u(hugeIndex)];
      case "text": { const b = textBytes(e.v); return [...b.flatMap((x) => [0x41, ...s(x)]), 0xfb, 0x08, ...u(bytesIndex), ...u(b.length), 0x41, 0x00, 0x41, ...s(b.length), 0x41, ...s([...e.v].length), 0xd0, ...s(textIndex), 0xfb, 0x00, ...u(textIndex)]; }
      case "rt": {
        if (e.fn === "i64.lit" && e.args[0].k === "int") return [0x42, ...sBig(e.args[0].v)];
        // derivative(f) carried by f (I245): f's maker, given f.
        if (e.fn === "derived" && e.args[0].k === "local") {
          const x = e.args[0].i, c = cloIndex.get((f.locals[x] as FType).key)!;
          return [0x20, ...u(x), 0x20, ...u(x), 0xfb, 0x02, ...u(c), 0x01, 0x14, ...u(c + 2)];
        }
        // A loop's i64 compares, masks and shifts as instructions, no call.
        const op = I64_OPS[e.fn];
        if (op !== undefined && e.args.length === 2) return [...e.args.flatMap(code1), op];
        // k·x + c (C207q): x against the bounds k and c give, worked out
        // here, then x · k + c, or i64's least for the round as written.
        if (e.fn === "i64.muladdv") {
          const [, kk, cc] = e.args.map((a) => (a.k === "rt" && a.fn === "i64.lit" && a.args[0].k === "int" ? a.args[0].v : null));
          if (e.args[0].k === "local" && kk !== null && cc !== null) {
            const MAX = (1n << 63n) - 1n, MIN = -(1n << 63n), q = (a: bigint) => a / kk!;
            const xs = code1(e.args[0]);
            return [...xs, 0x42, ...sBig(q(MAX - cc!)), 0x55, ...xs, 0x42, ...sBig(q(MIN - cc!)), 0x53, 0x72, 0x04, 0x7e, 0x42, ...sBig(I64_LEAST), 0x05, ...xs, 0x42, ...sBig(kk), 0x7e, 0x42, ...sBig(cc!), 0x7c, 0x0b];
          }
        }
        const fast = intFast(e, (i) => ["", [0x20, ...u(i)]], ["", [0x10, ...u(resolve.func(e.fn))]]);
        if (fast) return fast.flatMap((x) => x[1]);
        const put = inPlace(e, String);
        if (put) return put.code;
      }
      return [...e.args.flatMap(code1), 0x10, ...u(resolve.func(e.fn)), ...(/^(handler|htake):/.test(e.fn) ? [0xfb, 0x16, ...s(cloIndex.get((e.host!.t as FType).key)!)] : []), ...(rtPartial(e.fn) ? check(d, fl) : [])];
      case "bool": return [0x41, ...s(e.v ? 1 : 0)];
      case "local": return [0x20, ...u(e.i)];
      case "let":
        // A loop's value stepped past an i64 (C207k): the round again as written.
        if (stepped(e.value)) {
          const again = [0x04, 0x40, ...f.params.flatMap((_, j) => [0x20, ...u(j), 0x10, ...u(resolve.func("i64.box"))]), 0x10, ...u(fnIndex(f.bail!)), ...(funcs[f.bail!].partial && !f.partial ? [0x04, 0x40, 0x00, 0x0b] : []), 0x0f, 0x0b];
          // a ± b of locals and literals inline (C207w): past an i64 when
          // the answer's sign is neither's (a + b) or not a's where a and
          // b differ in sign (a − b), as wasm-rt.ts's $i64.addv tests it.
          const v = e.value as SExpr & { k: "rt" }, simple = (x: SExpr) => x.k === "local" || (x.k === "rt" && x.fn === "i64.lit" && x.args[0].k === "int");
          if ((v.fn === "i64.addv" || v.fn === "i64.subv") && v.args.every(simple)) {
            const [a, b] = v.args.map(code1), r = [0x20, ...u(e.i)];
            return [...a, ...b, v.fn === "i64.addv" ? 0x7c : 0x7d, 0x21, ...u(e.i), ...a, ...r, 0x85, ...(v.fn === "i64.addv" ? [...b, ...r] : [...a, ...b]), 0x85, 0x83, 0x42, 0x00, 0x53, ...again, ...code1(e.body)];
          }
          return [...code1(e.value), 0x22, ...u(e.i), 0x42, ...sBig(I64_LEAST), 0x51, ...again, ...code1(e.body)];
        }
        return [...code1(e.value), ...(e.i < 0 ? [0x1a] : [0x21, ...u(e.i)]), ...code1(e.body)];
      case "if": return [...code1(e.cond), 0x04, ...typeOf(e.t), ...code(e.then, d + 1, fl), 0x05, ...code(e.else, d + 1, fl), 0x0b];
      case "call": {
        // A tail call only to a function that gives what this one gives.
        const g = funcs[e.fn], tail = e.tail && !!g.partial === !!f.partial;
        const k = kept.get(e.fn);
        if (k !== undefined) return [0x23, ...u(k), 0xd1, 0x04, 0x40, 0x10, ...u(fnIndex(e.fn)), 0x24, ...u(k), 0x0b, 0x23, ...u(k)];
        if (looped && e.tail && e.fn === self) { const to = (f as ViewFunc).viewSlots ?? e.args.map((_, j) => j); return [...e.args.flatMap(code1), ...e.args.flatMap((_, j) => [0x21, ...u(to[e.args.length - 1 - j])]), 0x0c, ...u(d - 1)]; }
        return [...e.args.flatMap(code1), tail ? 0x12 : 0x10, ...u(fnIndex(e.fn)), ...(g.partial && !tail ? check(d, fl) : [])];
      }
      case "make": return [...e.args.flatMap(code1), ...(isFloat32(e.t) ? [0xb6] : []), ...(rawField && e.t.key === BYTES_T ? [0xd0, ...s(bytesIndex)] : []), 0xfb, 0x00, ...u(recIndex.get(e.t.key)!), ...count(e, f)];
      case "get": return [...code1(e.rec), 0xfb, 0x02, ...u(recIndex.get(e.t.key)!), ...u(e.i), ...(isFloat32(e.t) ? [0xbb] : [])];
      case "new":
        if (stackOf(e.t)) return e.c === 0 ? [0x23, ...u(stackGlobals + 2 * stacks.findIndex((x) => x.key === e.t.key) + 1)] : [...e.args.flatMap(code1), 0x10, ...u(rtIndex(fstack("push", e.t)))];
        { const nk = nilKey(e); const ni = nk === null ? undefined : nilAt.get(nk); if (ni !== undefined) return [0x23, ...u(nilBase + ni)]; }
        return [0x41, ...s(e.c), ...e.args.flatMap(code1), 0xfb, 0x00, ...u(caseIndex(e.t, e.c)), ...count(e, f)];
      // The items in order on the stack, then from the last: each into
      // `item`, made into a cons onto `acc` (L181b).
      case "list": {
        const [nil, cons] = listSteps(e);
        const step = [0x21, ...u(e.item), ...code1(cons), 0x21, ...u(e.acc)];
        return [...e.items.flatMap(code1), ...code1(nil), 0x21, ...u(e.acc), ...e.items.flatMap(() => step), 0x20, ...u(e.acc)];
      }
      // ref.cast to the case, then its field (after the case's number).
      case "field": {
        if (stackOf(e.t)) return [...code1(e.rec), 0x10, ...u(rtIndex(fstack(e.i === 0 ? "top" : "pop", e.t)))];
        const k = caseIndex(e.t, e.c); return [...code1(e.rec), 0xfb, 0x16, ...s(k), 0xfb, 0x02, ...u(k), ...u(e.i + 1)];
      }
      case "tag": return [...code1(e.rec), 0xfb, 0x02, ...u(baseIndex.get(e.t.key)!), 0x00];
      case "closure": {
        const maker = !derived.has(e.t.key) ? [] : e.d !== undefined ? [0xd2, ...u(fnIndex(e.d))] : [0xd0, ...s(cloIndex.get(e.t.key)! + 2)];
        return [0xd2, ...u(fnIndex(e.fn)), ...maker, ...e.caps.flatMap(code1), 0xfb, 0x00, ...u(shapeIndex[e.shape]), ...count(e, f)];
      }
      // What a closure captured: the closure is the code's first input.
      case "cap": return [0x20, 0x00, 0xfb, 0x16, ...s(shapeIndex[e.shape]), 0xfb, 0x02, ...u(shapeIndex[e.shape]), ...u(e.i + capsAt(e.t))];
      case "apply": {
        const c = cloIndex.get(e.t.key)!;
        const tail = e.tail && !!e.t.partial === !!f.partial;
        return [...code1(e.fn), 0x21, ...u(e.tmp), 0x20, ...u(e.tmp), ...e.args.flatMap(code1), 0x20, ...u(e.tmp), 0xfb, 0x02, ...u(c), 0x00, tail ? 0x15 : 0x14, ...u(c + 1), ...(e.t.partial && !tail ? check(d, fl) : [])];
      }
      case "case": {
        // block $done; n blocks, innermost first jumped to by br_table on the
        // case's number; after the end of block j, arm j, then br $done.
        const n = e.arms.length, b = baseIndex.get(e.t.key)!;
        const there = e.scrut.k === "local" && e.scrut.i === e.s;
        const out = [...(there ? [] : [...code1(e.scrut), 0x21, ...u(e.s)]), 0x02, ...typeOf(e.result)];
        for (let j = 0; j < n; j++) out.push(0x02, 0x40);
        out.push(0x20, ...u(e.s), 0xfb, 0x02, ...u(b), 0x00, 0x0e, ...vec(e.arms.map((_, j) => u(j))), ...u(n - 1));
        e.arms.forEach((a, j) => out.push(0x0b, ...(a ? code(a, d + n - j, fl) : [0x00]), ...(j < n - 1 ? [0x0c, ...u(n - 1 - j)] : [])));
        return [...out, 0x0b];
      }
      case "budget": {
        // With `data`, running out is no answer (the functions that spend
        // are partial), so a budget is an attempt that sets the fuel:
        // save = fuel; fuel = n; block $done (block $none body; fuel = save; br $done) fuel = save; otherwise
        if (failing(e.body)) return [
          0x23, 0x00, 0x21, ...u(e.save), 0x44, ...f64(e.n), 0x24, 0x00,
          0x02, ...typeOf(e.t), 0x02, 0x7f, ...code(e.body, d + 2, d + 1), 0x20, ...u(e.save), 0x24, 0x00, 0x0c, 0x01, 0x0b,
          0x21, ...u(st), 0x20, ...u(e.save), 0x24, 0x00, 0x20, ...u(st), ...on(1, d + 1, fl), ...code(e.otherwise, d + 1, fl), 0x0b,
        ];
        // Otherwise: res = body; (if fuel < 0 then otherwise else res); fuel = save
        return [
          0x23, 0x00, 0x21, ...u(e.save), 0x44, ...f64(e.n), 0x24, 0x00, ...code1(e.body), 0x21, ...u(e.res),
          0x23, 0x00, 0x44, ...f64(0), 0x63, 0x04, ...typeOf(e.t), ...code(e.otherwise, d + 1, fl), 0x05, 0x20, ...u(e.res), 0x0b,
          0x20, ...u(e.save), 0x24, 0x00,
        ];
      }
      case "fail": return [0x41, 0x01, 0x0c, ...to(d, fl)];
      case "attempt": {
        // A shader's: the flag saved and cleared, the search, the flag read
        // into the status local and put back, then ok or otherwise by it.
        if (flagging) return [
          0x23, ...u(noneG), 0x41, 0x00, 0x24, ...u(noneG), ...code1(e.body), 0x21, ...u(e.res),
          0x23, ...u(noneG), 0x21, ...u(st), 0x24, ...u(noneG),
          0x20, ...u(st), 0x04, ...typeOf(e.t), ...code(e.otherwise, d + 1, fl), 0x05, ...code(e.ok, d + 1, fl), 0x0b,
        ];
        // block $done (block $none (result i32) body; res = it; ok; br $done) drop; otherwise
        // With the fuel run out, no answer is no answer out here too: the
        // whole with fuel has none (SPEC 5.6, I294).
        return [0x02, ...typeOf(e.t), 0x02, 0x7f, ...code(e.body, d + 2, d + 1), 0x21, ...u(e.res), ...code(e.ok, d + 2, fl), 0x0c, 0x01, 0x0b, ...on(1, d + 1, fl), ...outOfFuel(d + 1, fl), ...code(e.otherwise, d + 1, fl), 0x0b];
      }
      // abort(reason): the reason in its global, then status 2.
      case "abort": return [...code1(e.reason), 0x24, ...u(e.esc ? escapeG : reasonG), ...(fl < 0 ? [0x00] : [0x41, ...s(2 + (e.esc ?? 0)), 0x0c, ...to(d, fl)])];
      // A handler's release (L213a7): block $done (block $out (result i32)
      // body; release; drop; br $done) status saved; release; drop; status
      // on out.
      case "released": {
        const rel = (dd: number) => [...code(e.release, dd, fl < 0 ? fl : fl), 0x1a];
        if (fl < 0) return [...code1(e.body), ...rel(d)];
        return [
          0x02, ...typeOf(e.t), 0x02, 0x7f, ...code(e.body, d + 2, d + 1), ...rel(d + 2), 0x0c, 0x01, 0x0b,
          0x21, ...u(e.st!), ...rel(d + 1), 0x20, ...u(e.st!), 0x0c, ...to(d + 1, fl), 0x0b,
        ];
      }
      case "handle": {
        // As an attempt for status 2, which puts the fuel back as it was
        // when the handler started, as the evaluator does; the reason is the arm's.
        const fuelBack = fuel ? [0x20, ...u(e.save), 0x24, 0x00] : [];
        return [
          ...(fuel ? [0x23, 0x00, 0x21, ...u(e.save)] : []),
          0x02, ...typeOf(e.t), 0x02, 0x7f, ...code(e.body, d + 2, d + 1), 0x0c, 0x01, 0x0b, ...on(2 + (e.esc ?? 0), d + 1, fl),
          ...fuelBack, ...(e.esc ? [0x23, ...u(escapeG), 0xfb, 0x17, ...s(refIndex(lowered.escapes[e.esc - 1]))] : [0x23, ...u(reasonG)]), 0x21, ...u(e.reason), ...code(e.arm, d + 1, fl), 0x0b,
        ];
      }
      case "world": {
        // A failure (status 2): its reason from the world, then on out as an abort.
        const call = [...e.args.flatMap(code1), 0x10, ...u(worldIndex(e.op))];
        const failed = !e.aborts ? [] : fl < 0 ? [0x04, 0x40, 0x00, 0x0b] : [0x21, ...u(st), 0x20, ...u(st), 0x04, 0x40, 0x10, ...u(reasonIndex()), 0x24, ...u(reasonG), 0x41, 0x02, 0x0c, ...to(d + 1, fl), 0x0b];
        return [...call, ...failed, ...(isUnit(e.t) ? [0xfb, 0x00, ...u(recIndex.get((e.t as RType).key)!)] : [])];
      }
      // A box's field set (W4d), then what comes after.
      case "set": return [...code1(e.rec), ...code1(e.value), 0xfb, 0x05, ...u(recIndex.get(e.t.key)!), ...u(e.i), ...code1(e.then)];
      case "zero": return [...(flagging && e.none ? [0x41, 0x01, 0x24, ...u(noneG)] : []), ...zero(e.t)];
      case "choose": case "search": throw new Error(`${f.name}: ${e.k} is lowered away before WebAssembly`);
      case "op": {
        const args = e.args.flatMap(code1);
        if (INT32_RT.includes(e.op)) return [...args, 0x10, ...u(rtIndex(`int32.${e.op}`))];
        if (hostIndex.has(e.op)) return [...args, 0x10, ...u(hostIndex.get(e.op)!)];
        if (e.op === "stop") return [...args, 0x10, ...u(rtIndex("wasi.stop"))];
        if (math && HOST[e.op]) return [...args, 0x10, ...u(rtIndex(`math.${e.op}`))];
        if (e.op === "mod") return [...args, 0x10, ...u(rtIndex("number.mod"))];
        return [...args, ...[INSTR[e.op]![0]].flat()];
      }
    }
    };
  }
  const helperCode = helpers.map((x) => { const body = [0x00, ...x.code, 0x0b]; return [...u(body.length), ...body]; });
  const codeSec = vec([...funcs.map((f) => {
    // Locals past the parameters, grouped by runs of the same type.
    const extra = [...f.locals.slice(f.params.length), ...(statusOf(f) >= 0 ? ["i32" as const] : [])];
    const groups: number[][] = [];
    for (let i = 0; i < extra.length;) {
      let j = i;
      while (j < extra.length && extra[j] === extra[i]) j++;
      groups.push([...u(j - i), ...typeOf(extra[i])]);
      i = j;
    }
    // A partial function's body is in a block a status goes to:
    // block $none (result i32) body; 0; return end; status = it; zero; status
    const st = statusOf(f), code = coder(f);
    const main = f.partial ? [0x02, 0x7f, ...code(f.body, 1, 0), 0x41, 0x00, 0x0f, 0x0b, 0x21, ...u(st), ...zero(f.result), 0x20, ...u(st)] : selfTail(f, funcs.indexOf(f)) ? [...((f as ViewFunc).viewEntry ?? []).flatMap(([i, x]) => [...code(x, 0, -1), 0x21, ...u(i)]), 0x03, ...typeOf(f.result as MType), ...code(f.body, 1, -1), 0x0b] : code(f.body, 0, -1);
    const body = [...vec(groups), ...spend(f), ...main, 0x0b];
    return [...u(body.length), ...body];
  }), ...helperCode, ...rtCode.map((c) => [...u(c.code.length), ...c.code])]);

  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, typeSec), ...(imports ? section(2, importSec) : []), ...section(3, funcSec),
    // WASI's memory, with the math functions' page when they're used.
    ...(wasi ? section(5, vec([[0x00, math ? 0x02 : 0x01]])) : []),
    ...(fuel || aborts || ryu || math || escapes || flags || rand || kept.size || stack || stacks.length || nils.length || spares.length || made.length ? section(6, globalSec) : []), ...section(7, exportSecOf()),
    // ref.func needs the functions declared: one declarative segment.
    ...(declared.length ? section(9, vec([[0x03, 0x00, ...vec(declared.map((i) => u(fnIndex(i))))]])) : []),
    ...section(10, codeSec),
    // fdlibm's tables, in the math functions' page.
    ...(math ? section(11, vec([[0x00, 0x41, ...s(MATH_AT + MATH_DATA_AT), 0x0b, ...vec(MATH_DATA.map((b) => [b]))]])) : []),
    // Each function's name, for a profiler (TERS_WASM_NAMES set): the
    // custom "name" section's function names.
    ...(typeof process !== "undefined" && process.env.TERS_WASM_NAMES ? section(0, [...str("name"), ...section(1, vec([...funcs.map((f) => f.name), ...helpers.map((x) => x.name), ...rts.map((f) => f.name)].map((x, i) => [...u(fnIndex(i)), ...str(x)])))]) : []),
  ]);

  // ---- text, for reading
  const id = (f: SFunc) => `$${f.name.replace(/[^\w]+/g, "_")}${funcs.indexOf(f)}`;
  const local = (f: SFunc, i: number) => `$${i < f.params.length ? "p" : "l"}${i}`;
  const sname = (i: number) => `$${structs[i].name}`;
  const recName = (r: RType | DType | FType | AType | TType) => sname(refIndex(r));
  const ty = (t: MType) => (t === "text" ? "(ref null $text)" : t === "raw" ? "(ref null $bytes)" : isRec(t) ? `(ref null ${recName(t)})` : t === "int" || t === "host" ? "eqref" : t === "mag" ? "(ref null $u32s)" : t === "int32" ? "i32" : t);
  const zeroText = (t: MType) => (t === "text" ? "ref.null $text" : isRec(t) ? `ref.null ${recName(t)}` : t === "int" || t === "host" ? "ref.null eq" : t === "mag" ? "ref.null $u32s" : `${t === "int32" ? "i32" : t}.const 0`);
  // As code(): `ld` blocks open around e, a status for none goes to fl.
  function wat(e: SExpr, f: SFunc, d: string, ld: number, fl: number): string {
    const w = (x: SExpr) => wat(x, f, d, ld, fl);
    const st = local(f, statusOf(f));
    const to = (ld2: number) => ld2 - 1 - fl;
    const check = (ld2: number) => (fl < 0 ? [`${d}(if (then unreachable)) ;; no answer, nowhere to go`] : [`${d}local.tee ${st}`, `${d}local.get ${st}`, `${d}br_if ${to(ld2)} ;; no answer`, `${d}drop`]);
    const on = (mine: number, dd: string, ld2: number) => (fl < 0 ? [`${dd}drop`] : [`${dd}local.set ${st}`, `${dd}local.get ${st}`, `${dd}local.get ${st}`, `${dd}i32.const ${mine}`, `${dd}i32.ne`, `${dd}br_if ${to(ld2)} ;; not mine: on out`, `${dd}drop`]);
    switch (e.k) {
      case "num": return `${d}f64.const ${e.v}`;
      case "int": return int32 ? `${d}i32.const ${e.v}` : small(e.v) ? `${d}i32.const ${e.v}\n${d}ref.i31` : inI64(e.v) ? `${d}i64.const ${e.v}\n${d}struct.new $big`
        : [`${d}i32.const ${e.v < 0n ? 1 : 0}`, ...limbs(e.v).map((l) => `${d}i32.const ${l}`), `${d}array.new_fixed $u32s ${limbs(e.v).length}`, `${d}struct.new $huge`].join("\n");
      case "text": { const b = textBytes(e.v); return `${d}(struct.new $text (array.new_fixed $bytes ${b.length}${b.map((x) => ` (i32.const ${x})`).join("")}) (i32.const 0) (i32.const ${b.length}) (i32.const ${[...e.v].length}) (ref.null $text)) ;; ${JSON.stringify(e.v)}`; }
      case "rt": {
        if (e.fn === "i64.lit" && e.args[0].k === "int") return `${d}i64.const ${e.args[0].v}`;
        if (e.fn === "derived" && e.args[0].k === "local") {
          const x = local(f, e.args[0].i), c = cloIndex.get((f.locals[e.args[0].i] as FType).key)!;
          return [`${d}local.get ${x}`, `${d}local.get ${x}`, `${d}struct.get ${sname(c)} 1`, `${d}call_ref ${sname(c + 2)}`].join("\n");
        }
        const fast = intFast(e, (i) => [`local.get ${local(f, i)}`, []], [`call $${e.fn}`, []]);
        if (fast) return fast.map((x) => `${d}${x[0]}`).join("\n");
        const put = inPlace(e, (i) => local(f, i));
        if (put) return put.wat.map((x) => `${d}${x}`).join("\n");
      }
      return [...e.args.map(w), `${d}call $${e.fn}`, ...(/^(handler|htake):/.test(e.fn) ? [`${d}ref.cast (ref ${sname(cloIndex.get((e.host!.t as FType).key)!)})`] : []), ...(rtPartial(e.fn) ? check(ld) : [])].join("\n");
      case "bool": return `${d}i32.const ${e.v ? 1 : 0}`;
      case "local": return `${d}local.get ${local(f, e.i)}`;
      case "let":
        if (stepped(e.value)) return `${w(e.value)}\n${d}local.tee ${local(f, e.i)}\n${d}i64.const ${I64_LEAST}\n${d}i64.eq\n${d}(if (then ${f.params.map((_, j) => `local.get ${local(f, j)} call $i64.box `).join("")}call ${id(funcs[f.bail!])} ${funcs[f.bail!].partial && !f.partial ? "(if (then unreachable)) " : ""}return)) ;; past an i64: as written\n${w(e.body)}`;
        return `${w(e.value)}\n${d}${e.i < 0 ? "drop" : `local.set ${local(f, e.i)}`}\n${w(e.body)}`;
      case "if": return `${w(e.cond)}\n${d}(if (result ${ty(e.t)})\n${d}  (then\n${wat(e.then, f, d + "    ", ld + 1, fl)})\n${d}  (else\n${wat(e.else, f, d + "    ", ld + 1, fl)}))`;
      case "call": {
        const g = funcs[e.fn], tail = e.tail && !!g.partial === !!f.partial;
        // A loop's next round (C327c2): its inputs and its views' locals set.
        const to = (f as ViewFunc).viewSlots;
        if (to && e.tail && g === f) return [...e.args.map(w), ...e.args.map((_, j) => `${d}local.set ${local(f, to[e.args.length - 1 - j])}`), `${d}br $self`].join("\n");
        if (kept.has(e.fn)) return [`${d}global.get $kept${e.fn}`, `${d}ref.is_null`, `${d}(if (then call ${id(g)} global.set $kept${e.fn}))`, `${d}global.get $kept${e.fn}`].join("\n");
        return [...e.args.map(w), `${d}${tail ? "return_call" : "call"} ${id(g)}`, ...(g.partial && !tail ? check(ld) : [])].join("\n");
      }
      case "make": return [...e.args.map(w), ...(isFloat32(e.t) ? [`${d}f32.demote_f64`] : []), ...(rawField && e.t.key === BYTES_T ? [`${d}ref.null $bytes`] : []), `${d}struct.new ${recName(e.t)}`].join("\n");
      case "get": return `${w(e.rec)}\n${d}struct.get ${recName(e.t)} ${e.i}${isFloat32(e.t) ? `\n${d}f64.promote_f32` : ""}`;
      case "new":
        if (stackOf(e.t)) return e.c === 0 ? `${d}global.get $done${stacks.findIndex((x) => x.key === e.t.key)}` : [...e.args.map(w), `${d}call $${fstack("push", e.t)}`].join("\n");
        { const nk = nilKey(e); const ni = nk === null ? undefined : nilAt.get(nk); if (ni !== undefined) return `${d}global.get $nil${ni}`; }
        return [`${d}i32.const ${e.c}`, ...e.args.map(w), `${d}struct.new ${sname(caseIndex(e.t, e.c))}`].join("\n");
      case "list": {
        const [nil, cons] = listSteps(e);
        const step = [`${d}local.set ${local(f, e.item)}`, w(cons), `${d}local.set ${local(f, e.acc)}`].join("\n");
        return [...e.items.map(w), w(nil), `${d}local.set ${local(f, e.acc)}`, ...e.items.map(() => step), `${d}local.get ${local(f, e.acc)}`].join("\n");
      }
      case "field": {
        if (stackOf(e.t)) return `${w(e.rec)}\n${d}call $${fstack(e.i === 0 ? "top" : "pop", e.t)}`;
        const k = sname(caseIndex(e.t, e.c)); return `${w(e.rec)}\n${d}ref.cast (ref ${k})\n${d}struct.get ${k} ${e.i + 1}`;
      }
      case "tag": return `${w(e.rec)}\n${d}struct.get ${recName(e.t)} 0`;
      case "closure": {
        const maker = !derived.has(e.t.key) ? [] : [e.d !== undefined ? `${d}ref.func ${id(funcs[e.d])}` : `${d}ref.null ${sname(cloIndex.get(e.t.key)! + 2)}`];
        return [`${d}ref.func ${id(funcs[e.fn])}`, ...maker, ...e.caps.map(w), `${d}struct.new ${sname(shapeIndex[e.shape])}`].join("\n");
      }
      case "cap": return [`${d}local.get ${local(f, 0)}`, `${d}ref.cast (ref ${sname(shapeIndex[e.shape])})`, `${d}struct.get ${sname(shapeIndex[e.shape])} ${e.i + capsAt(e.t)}`].join("\n");
      case "apply": {
        const c = cloIndex.get(e.t.key)!, t = local(f, e.tmp), tail = e.tail && !!e.t.partial === !!f.partial;
        return [w(e.fn), `${d}local.set ${t}`, `${d}local.get ${t}`, ...e.args.map(w), `${d}local.get ${t}`, `${d}struct.get ${sname(c)} 0`, `${d}${tail ? "return_call_ref" : "call_ref"} ${sname(c + 1)}`, ...(e.t.partial && !tail ? check(ld) : [])].join("\n");
      }
      case "case": {
        const there = e.scrut.k === "local" && e.scrut.i === e.s;
        const n = e.arms.length, lines = [...(there ? [] : [w(e.scrut), `${d}local.set ${local(f, e.s)}`]), `${d}(block (result ${ty(e.result)})`];
        for (let j = n - 1; j >= 0; j--) lines.push(`${d}${"  ".repeat(n - j)}(block ;; ${e.t.cases[j].name}`);
        const inner = d + "  ".repeat(n + 1);
        lines.push(`${inner}local.get ${local(f, e.s)}`, `${inner}struct.get ${recName(e.t)} 0`, `${inner}br_table ${e.arms.map((_, j) => j).join(" ")} ${n - 1})`);
        e.arms.forEach((a, j) => {
          const dd = d + "  ".repeat(n - j);
          lines.push(a ? wat(a, f, dd, ld + n - j, fl) : `${dd}unreachable`);
          lines.push(j < n - 1 ? `${dd}br ${n - 1 - j})` : `${dd.slice(2)})`);
        });
        return lines.join("\n");
      }
      case "budget": {
        const save = [`${d}global.get $fuel`, `${d}local.set ${local(f, e.save)}`, `${d}f64.const ${e.n}`, `${d}global.set $fuel`];
        if (failing(e.body)) return [
          ...save, `${d}(block (result ${ty(e.t)})`, `${d}  (block (result i32) ;; no answer, or ran out`, wat(e.body, f, d + "    ", ld + 2, ld + 1),
          `${d}    local.get ${local(f, e.save)}`, `${d}    global.set $fuel`, `${d}    br 1)`, `${d}  local.set ${st}`, `${d}  local.get ${local(f, e.save)}`, `${d}  global.set $fuel`, `${d}  local.get ${st}`, ...on(1, d + "  ", ld + 1),
          wat(e.otherwise, f, d + "  ", ld + 1, fl) + ")",
        ].join("\n");
        return [
          ...save, w(e.body), `${d}local.set ${local(f, e.res)}`,
          `${d}global.get $fuel`, `${d}f64.const 0`, `${d}f64.lt`, `${d}(if (result ${ty(e.t)})`, `${d}  (then`, wat(e.otherwise, f, d + "    ", ld + 1, fl) + ")", `${d}  (else`, `${d}    local.get ${local(f, e.res)}))`,
          `${d}local.get ${local(f, e.save)}`, `${d}global.set $fuel`,
        ].join("\n");
      }
      case "fail": return `${d}i32.const 1\n${d}br ${to(ld)} ;; no answer`;
      case "attempt": if (flagging) return [
        `${d}global.get $none`, `${d}i32.const 0`, `${d}global.set $none`, w(e.body), `${d}local.set ${local(f, e.res)}`,
        `${d}global.get $none`, `${d}local.set ${st}`, `${d}global.set $none`,
        `${d}local.get ${st}`, `${d}(if (result ${ty(e.t)}) ;; no answer`, `${d}  (then`, wat(e.otherwise, f, d + "    ", ld + 1, fl) + ")", `${d}  (else`, wat(e.ok, f, d + "    ", ld + 1, fl) + "))",
      ].join("\n");
      return [
        `${d}(block (result ${ty(e.t)})`, `${d}  (block (result i32) ;; no answer`, wat(e.body, f, d + "    ", ld + 2, ld + 1), `${d}    local.set ${local(f, e.res)}`, wat(e.ok, f, d + "    ", ld + 2, fl), `${d}    br 1)`,
        ...on(1, d + "  ", ld + 1),
        ...(fuel && fl >= 0 ? [`${d}  global.get $fuel`, `${d}  f64.const 0`, `${d}  f64.lt`, `${d}  (if (then i32.const 1 br ${to(ld + 2)})) ;; the fuel ran out: none out here too`] : []),
        wat(e.otherwise, f, d + "  ", ld + 1, fl) + ")",
      ].join("\n");
      case "abort": return [w(e.reason), `${d}global.set $${e.esc ? "escape" : "reason"}`, ...(fl < 0 ? [`${d}unreachable ;; an abort, nowhere to go`] : [`${d}i32.const ${2 + (e.esc ?? 0)}`, `${d}br ${to(ld)} ;; aborted`])].join("\n");
      case "released": {
        const rel = (dd: string, l: number) => [wat(e.release, f, dd, l, fl), `${dd}drop`];
        if (fl < 0) return [w(e.body), ...rel(d, ld)].join("\n");
        return [
          `${d}(block (result ${ty(e.t)})`, `${d}  (block (result i32) ;; ended with no answer or an abort`, wat(e.body, f, d + "    ", ld + 2, ld + 1), ...rel(d + "    ", ld + 2), `${d}    br 1)`,
          `${d}  local.set ${local(f, e.st!)}`, ...rel(d + "  ", ld + 1), `${d}  local.get ${local(f, e.st!)}`, `${d}  br ${to(ld + 1)})`,
        ].join("\n");
      }
      case "handle": return [
        ...(fuel ? [`${d}global.get $fuel`, `${d}local.set ${local(f, e.save)}`] : []),
        `${d}(block (result ${ty(e.t)})`, `${d}  (block (result i32) ;; aborted`, wat(e.body, f, d + "    ", ld + 2, ld + 1), `${d}    br 1)`,
        ...on(2 + (e.esc ?? 0), d + "  ", ld + 1),
        ...(fuel ? [`${d}  local.get ${local(f, e.save)}`, `${d}  global.set $fuel`] : []),
        ...(e.esc ? [`${d}  global.get $escape`, `${d}  ref.cast ${ty(lowered.escapes[e.esc - 1])}`] : [`${d}  global.get $reason`]), `${d}  local.set ${local(f, e.reason)}`,
        wat(e.arm, f, d + "  ", ld + 1, fl) + ")",
      ].join("\n");
      case "world": return [
        ...e.args.map(w), `${d}call $${wasi ? "wasi" : "world"}.${e.op}`,
        ...(!e.aborts ? [] : fl < 0 ? [`${d}(if (then unreachable)) ;; failed, nowhere to go`] : [`${d}local.set ${st}`, `${d}local.get ${st}`, `${d}(if (then call $${wasi ? "wasi" : "world"}.reason global.set $reason i32.const 2 br ${to(ld + 1)})) ;; failed`]),
        ...(isUnit(e.t) ? [`${d}struct.new ${recName(e.t as RType)}`] : []),
      ].join("\n");
      case "set": return [w(e.rec), w(e.value), `${d}struct.set ${recName(e.t)} ${e.i}`, w(e.then)].join("\n");
      case "zero": return `${flagging && e.none ? `${d}i32.const 1\n${d}global.set $none\n` : ""}${d}${zeroText(e.t)}`;
      case "choose": case "search": throw new Error(`${f.name}: ${e.k} is lowered away before WebAssembly`);
      case "op": return [...e.args.map(w), `${d}${INT32_RT.includes(e.op) ? `call $int32.${e.op}` : hostIndex.has(e.op) ? `call $Math.${e.op}` : e.op === "stop" ? "call $wasi.stop" : math && HOST[e.op] ? `call $math.${e.op}` : e.op === "mod" ? "call $number.mod" : INSTR[e.op]![1]}`].join("\n");
    }
  }
  const text = [
    "(module",
    ...(structs.length ? ["  (rec"] : []),
    ...structs.map((x) => {
      if (x.bytes) return "    (type $bytes (array (mut i8)))";
      if (x.i64s) return "    (type $i64s (array i64))";
      if (x.u32s) return "    (type $u32s (array (mut i32)))";
      if (x.refs) return "    (type $hstack (array (mut eqref)))";
      if (x.items) return `    (type $${x.name} (array (mut ${x.narrowItems ? "f32" : ty(x.items)})))`;
      if (x.func) return `    (type $${x.name} (func (param ${[x.func, ...x.func.params].map(ty).join(" ")}) (result ${ty(x.func.result)}${x.func.partial ? " i32" : ""})))`;
      if (x.maker) return `    (type $${x.name} (func (param ${ty(x.maker.self)}) (result ${ty(x.maker.result)})))`;
      const fty = (y: (typeof x.fields)[number]) => (y.ref !== undefined ? `(ref null ${sname(y.ref)})` : y.narrow ? "f32" : ty(y.t));
      const body = `(struct${x.fields.map((y) => ` (field $${ident(y.name)} ${y.code !== undefined ? `(ref ${sname(y.code)})` : x.mutable || y.mut ? `(mut ${fty(y)})` : fty(y)})`).join("")})`;
      return `    (type $${x.name} ${x.final && x.sup === undefined ? body : `(sub${x.final ? " final" : ""}${x.sup === undefined ? "" : ` ${sname(x.sup)}`} ${body})`})`;
    }),
    ...(structs.length ? ["  )"] : []),
    ...hosts.map((op) => `  (import "Math" "${HOST[op]!.name}" (func $Math.${op} (param${" f64".repeat(HOST[op]!.params)}) (result f64)))`),
    ...worldOps.filter(() => !wasi).map((x) => `  (import "world" "${x.op}" (func $world.${x.op}${x.args.length ? ` (param${x.args.map((_, j) => ` ${ty((x.ins?.[j] ?? "text") as MType)}`).join("")})` : ""}${isUnit(x.t) && !x.aborts ? "" : ` (result${isUnit(x.t) ? "" : ` ${ty(x.t)}`}${x.aborts ? " i32" : ""})`}))`),
    ...(worldReason && !wasi ? [`  (import "world" "reason" (func $world.reason (result (ref null $text))))`] : []),
    ...wasiImports.map((n) => { const t = WASI_IMPORTS[n.slice(5)]; return `  (import "wasi_snapshot_preview1" "${n.slice(5)}" (func $${n} (param ${t.params.join(" ")})${t.result ? ` (result ${t.result})` : ""}))`; }),
    ...(wasi ? [`  (memory (export "memory") ${math ? 2 : 1})`] : []),
    ...(fuel ? ["  (global $fuel (mut f64) (f64.const inf))"] : []),
    ...(aborts ? ["  (global $reason (mut (ref null $text)) (ref.null $text))"] : []),
    ...(ryu ? [`  (global $pow5 (ref $i64s) (array.new_fixed $i64s ${POW5.length}${POW5.map((v) => ` (i64.const ${v})`).join("")}))`] : []),
    ...(math ? ["  (global $msp (mut i32) (i32.const 65536))", `  (data (i32.const ${MATH_AT + MATH_DATA_AT}) "${MATH_DATA.map((b) => `\\${b.toString(16).padStart(2, "0")}`).join("")}")`] : []),
    ...(escapes ? ["  (global $escape (mut eqref) (ref.null eq))"] : []),
    ...(flags ? ["  (global $none (mut i32) (i32.const 0))"] : []),
    ...(rand ? [0, 1, 2, 3].map((k) => `  (global $r${k} (mut i32) (i32.const 0))`) : []),
    ...[...kept.keys()].map((i) => `  (global $kept${i} (mut ${ty(funcs[i].result as MType)}) (${zeroText(funcs[i].result as MType)}))`),
    ...(stack ? [`  (global $hs (ref $hstack) (array.new_default $hstack (i32.const ${SLOTS})))`, "  (global $hn (mut i32) (i32.const 0))"] : []),
    ...stacks.flatMap((d, j) => { const k = sname(caseIndex(d, 1)), z = sname(caseIndex(d, 0)); return [`  (global $spare${j} (mut (ref null ${k})) (ref.null ${k}))`, `  (global $done${j} (ref ${z}) (struct.new ${z} (i32.const 0)))`]; }),
    ...nils.map(({ t, c }, j) => { const k = sname(caseIndex(t, c)); return `  (global $nil${j} (ref ${k}) (struct.new ${k} (i32.const ${c})))`; }),
    ...spares.map(({ d }, j) => `  (global $fspare${j} (mut (ref null ${sname(baseIndex.get(d.key)!)})) (struct.new ${sname(caseIndex(d, 0))} (i32.const 0)))`),
    ...(declared.length ? [`  (elem declare func${declared.map((i) => ` ${id(funcs[i])}`).join("")})`] : []),
    ...funcs.map((f, i) => {
      const ps = f.params.map((t, i) => ` (param ${local(f, i)} ${ty(t)})`).join("");
      const st = statusOf(f);
      const ls = [...f.locals.slice(f.params.length), ...(st >= 0 ? ["i32" as const] : [])].map((t, j) => ` (local ${local(f, f.params.length + j)} ${ty(t)})`).join("");
      const none = zeroText(f.result) + (f.partial ? " i32.const 1" : "");
      const spends = f.spends ? `    global.get $fuel\n    f64.const 1\n    f64.sub\n    global.set $fuel\n    global.get $fuel\n    f64.const 0\n    f64.lt\n    (if (then ${none} return))\n` : "";
      const body = f.partial
        ? `    (block (result i32) ;; no answer\n${wat(f.body, f, "      ", 1, 0)}\n      i32.const 0\n      return)\n    local.set ${local(f, st)}\n    ${zeroText(f.result)}\n    local.get ${local(f, st)}`
        : (f as ViewFunc).viewSlots ? [...(f as ViewFunc).viewEntry!.map(([i, x]) => `${wat(x, f, "    ", 0, -1)}\n    local.set ${local(f, i)}`), `    (loop $self (result ${ty(f.result)})`, `${wat(f.body, f, "      ", 1, -1)})`].join("\n")
        : wat(f.body, f, "    ", 0, -1);
      return `  ;; ${f.name}\n  (func ${id(f)}${f.budgeted || f.inner ? "" : ` (export "${exportName(f)}")`}${codeOf.has(i) ? ` (type ${sname(cloIndex.get(codeOf.get(i)!.key)! + 1)})` : makerOf.has(i) ? ` (type ${sname(cloIndex.get(makerOf.get(i)!.key)! + 2)})` : ""}${ps} (result ${ty(f.result)}${f.partial ? " i32" : ""})${ls}\n${spends}${body})`;
    }),
    ...helpers.map((x) => `  (func (export "${x.name}")${x.params.map((t) => ` (param ${ty(t)})`).join("")} (result ${ty(x.result)})\n${x.wat.map((l) => `    ${l}`).join("\n")})`),
    ...rtCode.map((c, k) => c.wat.replace(`(func $${rts[k].name}`, `(func $${rts[k].name}${RT_EXPORTS[rts[k].name] ? ` (export "${RT_EXPORTS[rts[k].name]}")` : ""}`)),
    ")",
  ].join("\n");

  const floats = shader ? [] : entries.filter(([f]) => f.result === "f64").map(([f]) => ({ name: exportName(f), partial: !!f.partial }));
  return { bytes, wat: text + "\n", ...(counting ? { made } : {}), exports: [...entries.map(([f]) => exportName(f)), ...helpers.map((x) => x.name), ...rtExports.map((f) => RT_EXPORTS[f.name])], floats, ...(lowered.stops?.length ? { stops: lowered.stops } : {}), ...(opts.hosts && worldOps.some((x) => x.op.startsWith("host:")) ? { hosts: opts.hosts } : {}) };
}

// The library's `grid found` (neighbours on a grid), which gridRt writes.
const GRID_FOUND = PRELUDE_DEFS["grid found"];

// A loop's value stepped (C207k, untagged-ints.ts valueLoop): i64's least
// when it went past an i64.
const I64_LEAST = -(2n ** 63n);
// Only the locals something reads (C254): a let nothing reads is its
// value dropped (local -1), and the locals nothing names are not declared,
// the rest numbered again after the inputs.
function onlyRead(f: SFunc): SFunc {
  const named = new Map<number, number>(), bound = new Map<number, number>();
  const add = (m: Map<number, number>, i: number) => m.set(i, (m.get(i) ?? 0) + 1);
  mapLocals(f.body, (i) => (add(named, i), i));
  const lets = (e: SExpr): void => { if (e.k === "let" && !stepped(e.value)) add(bound, e.i); kids(e).forEach(lets); };
  lets(f.body);
  const unread = (i: number) => i >= f.params.length && named.get(i) === bound.get(i);
  const drop = (e: SExpr): SExpr => { const x = mapKids(e, drop); return x.k === "let" && x.i >= 0 && !stepped(x.value) && unread(x.i) ? { ...x, i: -1 } : x; };
  const body = drop(f.body), kept = new Map<number, number>(f.params.map((_, j) => [j, j]));
  mapLocals(body, (i) => (i >= 0 && !kept.has(i) && kept.set(i, -1), i));
  const order = [...kept.keys()].filter((i) => i >= f.params.length).sort((a, b) => a - b);
  order.forEach((i, j) => kept.set(i, f.params.length + j));
  if (order.length === f.locals.length - f.params.length) return body === f.body ? f : { ...f, body };
  return { ...f, locals: [...f.locals.slice(0, f.params.length), ...order.map((i) => f.locals[i])], body: mapLocals(body, (i) => (i < 0 ? i : kept.get(i)!)) };
}

const stepped = (e: SExpr) => e.k === "rt" && /^i64\.(addv|subv|mulv|muladdv)$/.test(e.fn);
const uses = (e: SExpr, op: Op): boolean => (e.k === "op" && e.op === op) || kids(e).some((k) => uses(k, op));
const mentionsText = (e: SExpr): boolean => e.k === "text" || kids(e).some(mentionsText);
const budgets = (e: SExpr): boolean => e.k === "budget" || kids(e).some(budgets);
const mentions = (e: SExpr, k: SExpr["k"]): boolean => e.k === k || kids(e).some((x) => mentions(x, k));

// Instantiate with the host's Math. Bool results come back as 0 or 1.
// `rt`: the console and files, as for the evaluator (run.ts Runtime); an
// operation the world doesn't have fails saying so, as there.
export async function instantiate(m: Module, rt: Runtime = { print: () => {} }): Promise<Record<string, (...xs: number[]) => number>> {
  let ex: Record<string, (...xs: unknown[]) => unknown> = {};
  const { instance } = await WebAssembly.instantiate(m.bytes, { Math: { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, pow: Math.pow, atan2: Math.atan2, stop: (i: number) => { throw stopped(m, i); } }, world: worldOf(rt, () => ex, m.hosts) });
  ex = instance.exports as unknown as typeof ex;
  if (!m.floats?.length) return instance.exports as unknown as Record<string, (...xs: number[]) => number>;
  // A Float64 handed back to the host is a use of it: too big, it stops.
  const out: Record<string, unknown> = { ...ex };
  const fin = (x: number) => { if (x - x !== 0) throw new Aborted(STOPS[STOPS.length - 1]); return x; };
  for (const { name, partial } of m.floats) {
    const f = ex[name];
    out[name] = partial ? (...xs: unknown[]) => { const r = f(...xs) as [number, number]; if (r[1] === 0) fin(r[0]); return r; } : (...xs: unknown[]) => fin(f(...xs) as number);
  }
  return out as Record<string, (...xs: number[]) => number>;
}

// The imports from "world": texts in and out through the module's own
// makers. One that fails gives status 2 after its answer, and the reason
// the module then asks for.
function worldOf(rt: Runtime, exports: () => Record<string, (...xs: unknown[]) => unknown>, hosts?: HostOps) {
  let reason = "";
  const w = <K extends keyof World>(k: K): World[K] => {
    const f = rt.world?.[k];
    if (!f) return (() => { throw new Error(`this runtime can't ${k === "error" ? "write to standard error" : k}`); }) as unknown as World[K];
    return bordered(rt.world!, k, f);
  };
  const text = (t: unknown) => fromText(exports(), t), make = (v: string) => toText(exports(), v);
  const tried = <T>(f: () => T): [T | null, number] => { try { return [f(), 0]; } catch (e) { reason = (e as Error).message; return [null, 2]; } };
  const unit = (f: () => void) => tried(f)[1];
  // Bytes made and read by the module's helpers, as keptBytes makes them.
  const bytesMade = (b: Uint8Array) => {
    const ex = exports();
    let l = ex["IntList.nil"]();
    for (let i = b.length - 1; i >= 0; i--) l = ex["IntList.cons"](toInt(ex, BigInt(b[i])), l);
    return ex["Bytes.make"](l);
  };
  const plainBytes = (b: unknown) => {
    const ex = exports(), nil = ex["IntList.case"](ex["IntList.nil"]()), out: number[] = [];
    for (let l = ex["Bytes.items"](b); ex["IntList.case"](l) !== nil; l = ex["IntList.cons.tail"](l)) out.push(Number(fromInt(ex, ex["IntList.cons.head"](l))));
    return Uint8Array.from(out);
  };
  return {
    // A seed for Random's generator, 32 bits (C136).
    randomSeed: () => (rt.world?.randomSeed ?? (() => Math.floor(Math.random() * 4294967296)))(),
    // A stop with a reason (L51c): the program ends, as an overflow's stop.
    stopWith: (t: unknown) => { throw new Aborted(text(t)); },
    print: (t: unknown) => rt.print(text(t)),
    printError: (t: unknown) => w("error")(text(t)),
    // A line of Log nothing handles (L213a6, a release's).
    logLine: (t: unknown) => w("log")(text(t)),
    readInput: () => tried(() => make(w("input")())),
    readLine: () => tried(() => { const l = w("readLine")(), ex = exports(); return l === null ? ex["TextOption.none"]() : ex["TextOption.some"](make(l)); }),
    readFile: (p: unknown) => tried(() => make(w("readFile")(text(p)))),
    writeFile: (p: unknown, t: unknown) => unit(() => w("writeFile")(text(p), text(t))),
    appendFile: (p: unknown, t: unknown) => unit(() => w("appendFile")(text(p), text(t))),
    // A file's bytes as they are (C291b).
    readBytes: (p: unknown) => tried(() => bytesMade(w("readBytes")!(text(p)))),
    writeBytes: (p: unknown, b: unknown) => unit(() => w("writeBytes")!(text(p), plainBytes(b))),
    // A file handed to the person and one they choose (L271a), as
    // core-rt.ts asks the world for them.
    offerFile: (n: unknown, b: unknown) => unit(() => w("offerFile")!(text(n), plainBytes(b))),
    askForFile: (k: unknown) => tried(() => bytesMade(w("askForFile")!(text(k)))),
    fileExists: (p: unknown) => (w("fileExists")(text(p)) ? 1 : 0),
    // A file's kind, size and time last changed (C310), made by the
    // module's helpers; File kind's cases in the order std.ts gives them.
    fileInfo: (p: unknown) => tried(() => {
      const ex = exports(), x = w("fileInfo")!(text(p)), wide = "FileInfo.make64" in ex;
      const kind = ex[`FileKind.${["file", "folder", "link", "special"].indexOf(x.kind)}`]();
      return ex[wide ? "FileInfo.make64" : "FileInfo.make"](kind, wide ? BigInt(x.size) : toInt(ex, BigInt(x.size)), ex["Instant.make"](x.modified));
    }),
    // An environment variable (L253), as run.ts answers it.
    environmentVariable: (n: unknown) => { const v = rt.world?.environmentVariable?.(text(n)) ?? null, ex = exports(); return v === null ? ex["TextOption.none"]() : ex["TextOption.some"](make(v.normalize("NFC"))); },
    // The person's time zone and locale, and a file to the platform's app
    // (C315), as run.ts answers them.
    myTimeZone: () => make((rt.world?.timeZone ?? hostZone)()),
    myLocale: () => exports()["Locale.make"](make((rt.world?.locale ?? hostLocale)())),
    openOutside: (p: unknown) => unit(() => w("openOutside")!(text(p))),
    // A zone's offset (L188): the host's Intl, NaN for a zone it doesn't know.
    zoneOffset: (z: unknown, s: number) => zoneOffset(text(z), s)[0] ?? NaN,
    listFolder: (p: unknown) => tried(() => textList(exports(), w("listFolder")(text(p)))),
    reason: () => make(reason),
    // The files `with open file` keeps open (L213c9), as run.ts answers
    // them: what goes wrong is an answer (none, false), never a throw.
    keptOpen: (p: unknown) => { const ex = exports(); try { return ex["IntOption.some"](toInt(ex, BigInt(w("openFile")!(text(p))))); } catch { return ex["IntOption.none"](); } },
    keptLine: (f: unknown) => { const ex = exports(); let l: string | null = null; try { l = w("fileLine")!(Number(fromInt(ex, f))); } catch { /* none */ } return l === null ? ex["TextOption.none"]() : ex["TextOption.some"](make(l.normalize("NFC"))); },
    keptAddLine: (f: unknown, t: unknown) => { try { w("fileAddLine")!(Number(fromInt(exports(), f)), text(t)); return 1; } catch { return 0; } },
    keptBytes: (f: unknown, n: unknown) => {
      const ex = exports();
      let b: Uint8Array | null = null;
      try { b = w("fileBytes")!(Number(fromInt(ex, f)), Math.max(0, Number(fromInt(ex, n)))); } catch { /* none */ }
      let l = ex["IntList.nil"]();
      for (let i = (b?.length ?? 0) - 1; i >= 0; i--) l = ex["IntList.cons"](toInt(ex, BigInt(b![i])), l);
      return ex["Bytes.make"](l);
    },
    keptAddBytes: (f: unknown, b: unknown) => {
      const ex = exports(), nil = ex["IntList.case"](ex["IntList.nil"]()), out: number[] = [];
      for (let l = ex["Bytes.items"](b); ex["IntList.case"](l) !== nil; l = ex["IntList.cons.tail"](l)) out.push(Number(fromInt(ex, ex["IntList.cons.head"](l))));
      try { w("fileAddBytes")!(Number(fromInt(ex, f)), Uint8Array.from(out)); return 1; } catch { return 0; }
    },
    keptClose: (f: unknown) => { try { w("closeFile")!(Number(fromInt(exports(), f))); } catch { /* closing can't fail */ } },
    // The program's own operations (L69b2): hosts/js.js's answers, checked
    // at hosts.ts's border, a wrong one failing with the reason.
    ...Object.fromEntries(Object.entries(hosts ?? {}).map(([k, h]) => {
      const inn = (s: Shape, x: unknown): unknown => (s.k === "text" ? text(x) : s.k === "int" ? norm(fromInt(exports(), x)) : s.k === "bool" ? { tag: x ? TRUE : FALSE, fields: [] } : x);
      const ask = (xs: unknown[]) => answerByShapes(h, rt.hosts ?? {}, h.op, xs.map((x, j) => inn(h.ins[j], x)) as never[]);
      const out = (v: unknown): unknown => (h.out.k === "text" ? make(v as string) : h.out.k === "int" ? toInt(exports(), BigInt(v as number | bigint)) : h.out.k === "bool" ? ((v as { tag: Id }).tag === TRUE ? 1 : 0) : v);
      return [`host:${k}`, h.out.k === "unit" ? (...xs: unknown[]) => unit(() => { ask(xs); }) : (...xs: unknown[]) => tried(() => out(ask(xs)))];
    })),
  };
}

// A list of texts, built from its end with TextList.nil and TextList.cons.
export function textList(ex: Record<string, (...xs: never[]) => unknown>, xs: string[]): unknown {
  let l = (ex["TextList.nil"] as () => unknown)();
  for (let i = xs.length - 1; i >= 0; i--) l = (ex["TextList.cons"] as (h: unknown, t: unknown) => unknown)(toText(ex, xs[i]), l);
  return l;
}

// A program's main in WebAssembly, as run.ts runProgram runs it: given
// the arguments (a list of texts) or nothing, it gives the exit code (an
// Int or a Float64), or anything else for 0; an Abort nothing handled
// writes its reason to standard error and exits with 1.
export async function runMain(lowered: CoreIR, m: Module, name: string, args: string[], rt: Runtime): Promise<number> {
  const f = lowered.funcs.find((g) => g.name === name && !g.inner && !g.budgeted);
  if (!f || f.params.length > 1) throw new Error(`${name}: not compiled, or not a main`);
  const ex = (await instantiate(m, rt)) as unknown as Record<string, (...xs: unknown[]) => unknown>;
  let got: unknown;
  // A Float64 with no answer or too big (L125c2): the host's stop threw.
  try { got = ex[name](...(f.params.length ? [textList(ex, args)] : [])); } catch (e) { if (!(e instanceof Aborted)) throw e; (rt.world?.error ?? rt.print)(e.reason); return 1; }
  const [v, st] = f.partial ? (got as [unknown, number]) : [got, 0];
  if (st === 2) { (rt.world?.error ?? rt.print)(fromText(ex, ex["Abort.reason"]())); return 1; }
  if (st !== 0) throw new Error(`${name} had no answer`);
  return f.result === "f64" ? Number(v) : f.result === "int" ? Number(fromInt(ex, v)) : 0;
}

// An Int across the boundary: an i64 through Int.of and Int.get, past
// that a $huge's sign and 32-bit limbs.
export function toInt(ex: Record<string, (...xs: never[]) => unknown>, v: bigint): unknown {
  if (v >= -(2n ** 63n) && v < 2n ** 63n) return (ex["Int.of"] as (x: bigint) => unknown)(v);
  const limbs: number[] = [];
  for (let m = v < 0n ? -v : v; m; m >>= 32n) limbs.push(Number(m & 0xffffffffn) | 0);
  const x = (ex["Int.huge"] as (neg: number, n: number) => unknown)(v < 0n ? 1 : 0, limbs.length);
  limbs.forEach((l, i) => (ex["Int.setLimb"] as (x: unknown, i: number, l: number) => void)(x, i, l));
  return x;
}
export function fromInt(ex: Record<string, (...xs: never[]) => unknown>, x: unknown): bigint {
  const n = (ex["Int.limbs"] as (x: unknown) => number)(x);
  if (n === 0) return (ex["Int.get"] as (x: unknown) => bigint)(x);
  let m = 0n;
  for (let i = Math.abs(n) - 1; i >= 0; i--) m = (m << 32n) | BigInt((ex["Int.limb"] as (x: unknown, i: number) => number)(x, i) >>> 0);
  return n < 0 ? -m : m;
}

// Text across the boundary: a JS string into the module's UTF-8 array, and back.
export function toText(ex: Record<string, (...xs: never[]) => unknown>, v: string): unknown {
  const b = new TextEncoder().encode(v), t = (ex["Text.new"] as (n: number) => unknown)(b.length);
  const put = ex["Text.put"] as (t: unknown, i: number, x: number) => void, put4 = ex["Text.put4"] as (t: unknown, i: number, x: number) => void;
  // Four bytes a call (one i32, low byte first), then the rest one by one.
  const words = new DataView(b.buffer, b.byteOffset, b.byteLength), whole = b.length & ~3;
  for (let i = 0; i < whole; i += 4) put4(t, i, words.getInt32(i, true));
  for (let i = whole; i < b.length; i++) put(t, i, b[i]);
  return t;
}
export function fromText(ex: Record<string, (...xs: never[]) => unknown>, t: unknown): string {
  const n = (ex["Text.size"] as (t: unknown) => number)(t), byte = ex["Text.byte"] as (t: unknown, i: number) => number;
  return new TextDecoder().decode(Uint8Array.from({ length: n }, (_, i) => byte(t, i)));
}

export { OPS };
