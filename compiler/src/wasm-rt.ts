// The WebAssembly runtime for Int and Text (docs/design/targets/WASM.md, stage
// W3): small functions written in WebAssembly's own text format, one
// instruction per line, which wasm.ts adds to a module that uses them.
// A tiny assembler turns each line into bytes, so the text a module prints
// is exactly what runs.
//
// Text is an immutable UTF-8 byte array, `(array (mut i8))` (mutable only
// while it's being filled). A character position counts characters, so a
// position is found by walking from the start, as std.ts does for text
// outside the Basic Multilingual Plane; UTF-8's byte order is code-point
// order, so comparing is comparing bytes. An Int is an i31, an i64 in a
// $big, or past that a $huge of 32-bit limbs (W5b); the int64.* functions
// compute on the i64 and trap when the answer doesn't fit, and the int.*
// natives take the limbs then.
//
// The functions match std.ts and text.ts: slice clamps, split is
// JavaScript's (non-overlapping, left to right), show is std.ts's show.

import { MATH } from "./wasm-math.ts";
import { STOPS } from "./stops.ts";

// A value type, as the runtime functions name them: `text` is a
// reference to the byte array, `list` to a List Text of the module.
// `option` an Optional Text, and `void` a result of nothing.
// `int` an Int (W5): an i31 while it fits in 31 bits, a $big, a $huge;
// `i64` a plain machine word, which the functions below compute with.
// `mag` a big Int's magnitude, an array of 32-bit limbs.
// An array function's (C66) own types: the view, its item, its buffer and the buffer's items.
export type VT = "i32" | "i64" | "int" | "mag" | "f64" | "text" | "list" | "option" | "void" | "array" | "item" | "buf" | "items";

export interface RtFn {
  name: string;
  params: [string, VT][];
  result: VT;
  locals: [string, VT][];
  body: string;
  // Types and functions it refers to besides the text array, and imports.
  uses: string[];
  // The list type `list` stands for, by key (List Text when not given).
  list?: string;
  // An array function's copy (C66): the Array type it is for, by its
  // place in Lowered.arrays (`array.push.a0`); `list` is then List of its items.
  array?: number;
  // A builtin with no answer or one (Choice): it gives its answer and a
  // status, 0 for an answer and 1 for none, as the module's own
  // one-answer functions do (wasm.ts).
  partial?: true;
  // Takes and gives its Ints as they are (int.of …); any other function
  // with an Int is written on i64s and called through a wrapper.
  native?: true;
}

// Immediates each instruction takes.
type Imm = "local" | "func" | "type" | "label" | "labels" | "i32" | "i64" | "f64" | "bt" | "u" | "global";
const OPS: Record<string, [number[], Imm[]]> = {
  "unreachable": [[0x00], []], "block": [[0x02], ["bt"]], "loop": [[0x03], ["bt"]], "if": [[0x04], ["bt"]], "else": [[0x05], []], "end": [[0x0b], []],
  "br": [[0x0c], ["label"]], "br_if": [[0x0d], ["label"]], "br_table": [[0x0e], ["labels"]], "return": [[0x0f], []], "call": [[0x10], ["func"]], "drop": [[0x1a], []], "select": [[0x1b], []],
  "local.get": [[0x20], ["local"]], "local.set": [[0x21], ["local"]], "local.tee": [[0x22], ["local"]],
  "i32.const": [[0x41], ["i32"]], "i64.const": [[0x42], ["i64"]], "f64.const": [[0x44], ["f64"]],
  "i32.eqz": [[0x45], []], "i32.eq": [[0x46], []], "i32.ne": [[0x47], []], "i32.lt_s": [[0x48], []], "i32.lt_u": [[0x49], []], "i32.gt_s": [[0x4a], []], "i32.gt_u": [[0x4b], []],
  "i32.le_s": [[0x4c], []], "i32.le_u": [[0x4d], []], "i32.ge_s": [[0x4e], []], "i32.ge_u": [[0x4f], []],
  "i64.eqz": [[0x50], []], "i64.eq": [[0x51], []], "i64.ne": [[0x52], []], "i64.lt_s": [[0x53], []], "i64.gt_s": [[0x55], []], "i64.le_s": [[0x57], []], "i64.ge_s": [[0x59], []],
  "f64.eq": [[0x61], []], "f64.ne": [[0x62], []], "f64.lt": [[0x63], []], "f64.gt": [[0x64], []], "f64.le": [[0x65], []], "f64.ge": [[0x66], []],
  "i32.add": [[0x6a], []], "i32.sub": [[0x6b], []], "i32.mul": [[0x6c], []], "i32.div_u": [[0x6e], []], "i32.rem_u": [[0x70], []], "i32.and": [[0x71], []], "i32.or": [[0x72], []], "i32.xor": [[0x73], []],
  "i64.add": [[0x7c], []], "i64.sub": [[0x7d], []], "i64.mul": [[0x7e], []], "i64.div_s": [[0x7f], []], "i64.div_u": [[0x80], []], "i64.rem_s": [[0x81], []], "i64.rem_u": [[0x82], []],
  "i64.and": [[0x83], []], "i64.or": [[0x84], []], "i64.xor": [[0x85], []], "i64.shl": [[0x86], []], "i64.shr_s": [[0x87], []], "i64.shr_u": [[0x88], []],
  "i64.lt_u": [[0x54], []], "i64.gt_u": [[0x56], []], "i64.le_u": [[0x58], []], "i64.ge_u": [[0x5a], []],
  "i64.reinterpret_f64": [[0xbd], []], "f64.reinterpret_i64": [[0xbf], []], "f64.convert_i64_u": [[0xba], []], "i32.shl": [[0x74], []], "i32.clz": [[0x67], []], "i32.shr_u": [[0x76], []], "i32.shr_s": [[0x75], []], "i32.div_s": [[0x6d], []],
  "f64.sqrt": [[0x9f], []], "f64.convert_i32_s": [[0xb7], []], "i32.trunc_f64_s": [[0xaa], []],
  "f64.abs": [[0x99], []], "f64.neg": [[0x9a], []], "f64.floor": [[0x9c], []], "f64.add": [[0xa0], []], "f64.sub": [[0xa1], []], "f64.mul": [[0xa2], []], "f64.div": [[0xa3], []],
  "i32.wrap_i64": [[0xa7], []], "i64.extend_i32_s": [[0xac], []], "i64.extend_i32_u": [[0xad], []], "i64.trunc_f64_s": [[0xb0], []], "f64.convert_i64_s": [[0xb9], []],
  // Linear memory (WASI's buffers), aligned naturally, at offset 0.
  "i32.load": [[0x28, 0x02, 0x00], []], "i64.load": [[0x29, 0x03, 0x00], []], "i32.load8_u": [[0x2d, 0x00, 0x00], []],
  "i32.store": [[0x36, 0x02, 0x00], []], "i32.store8": [[0x3a, 0x00, 0x00], []], "memory.size": [[0x3f, 0x00], []], "memory.grow": [[0x40, 0x00], []],
  "f64.load": [[0x2b, 0x03, 0x00], []], "f64.store": [[0x39, 0x03, 0x00], []], "i64.store": [[0x37, 0x03, 0x00], []],
  "i32.trunc_sat_f64_s": [[0xfc, 0x02], []], "global.get": [[0x23], ["global"]], "global.set": [[0x24], ["global"]],
  "ref.is_null": [[0xd1], []], "ref.null": [[0xd0], ["type"]],
  "ref.test": [[0xfb, 0x14], ["type"]], "ref.i31": [[0xfb, 0x1c], []], "i31.get_s": [[0xfb, 0x1d], []],
  "struct.new": [[0xfb, 0x00], ["type"]], "struct.get": [[0xfb, 0x02], ["type", "u"]], "struct.set": [[0xfb, 0x05], ["type", "u"]], "ref.cast": [[0xfb, 0x16], ["type"]],
  "array.new_default": [[0xfb, 0x07], ["type"]], "array.new_fixed": [[0xfb, 0x08], ["type", "u"]], "array.get_u": [[0xfb, 0x0d], ["type"]], "array.get": [[0xfb, 0x0b], ["type"]], "array.new": [[0xfb, 0x06], ["type"]],
  "array.set": [[0xfb, 0x0e], ["type"]], "array.len": [[0xfb, 0x0f], []], "array.copy": [[0xfb, 0x11], ["type", "type"]],
};

export interface Resolve {
  // A type by name ($bytes, $list, $list.cons …), as an index.
  type(name: string): number;
  func(name: string): number;
  // A global by name (`reason`).
  global(name: string): number;
  // A memory by name: 0 is WASI's, $math (wasm-math.ts) its own.
  memory(name: string): number;
  // A block type or local type: bytes and text.
  valtype(t: VT): { bytes: number[]; text: string };
}

const ABSTRACT: Record<string, number> = { i31: -20, eq: -19 };
const u = (n: number): number[] => { const out: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };
const sLeb = (n: bigint): number[] => {
  const out: number[] = [];
  for (;;) { const b = Number(n & 0x7fn); n >>= 7n; if ((n === 0n && !(b & 0x40)) || (n === -1n && b & 0x40)) { out.push(b); return out; } out.push(b | 0x80); }
};

// The function's code (locals and body) as bytes, and its text.
export function assemble(f: RtFn, r: Resolve): { code: number[]; wat: string } {
  const names = [...f.params, ...f.locals].map(([n]) => n);
  const out: number[] = [];
  const lines = f.body.split("\n").map((l) => l.replace(/;;.*/, "").trim()).filter(Boolean);
  for (const line of lines) {
    const [op, ...args] = line.split(/\s+/);
    const spec = OPS[op];
    if (!spec) throw new Error(`${f.name}: no instruction ${op}`);
    // A load or store naming its memory and offset: `f64.load $math 8`.
    if (args.length === 2 && /\.(load|store)/.test(op)) {
      const [code, align] = spec[0], m = r.memory(args[0].slice(1));
      out.push(code, m ? align | 0x40 : align, ...(m ? u(m) : []), ...u(Number(args[1])));
      continue;
    }
    out.push(...spec[0]);
    spec[1].forEach((kind, i) => {
      const a = args[i];
      if (a === undefined) throw new Error(`${f.name}: ${op} needs ${kind}`);
      switch (kind) {
        case "local": { const j = names.indexOf(a.slice(1)); if (j < 0) throw new Error(`${f.name}: no local ${a}`); out.push(...u(j)); break; }
        case "func": out.push(...u(r.func(a.slice(1)))); break;
        case "global": out.push(...u(r.global(a.slice(1)))); break;
        case "type": {
          // An abstract heap type (i31, eq) is written without a $.
          const t = a.startsWith("$") ? r.type(a.slice(1)) : ABSTRACT[a];
          if (t === undefined) throw new Error(`${f.name}: no type ${a}`);
          out.push(...(op === "ref.cast" || op === "ref.null" || op === "ref.test" ? sLeb(BigInt(t)) : u(t)));
          break;
        }
        case "label": case "u": out.push(...u(Number(a))); break;
        case "labels": out.push(...u(args.length - 1), ...args.flatMap((x) => u(Number(x)))); break;
        case "i32": case "i64": out.push(...sLeb(BigInt(a))); break;
        case "f64": out.push(...new Uint8Array(new Float64Array([Number(a)]).buffer)); break;
        case "bt": out.push(...(a === "void" ? [0x40] : r.valtype(a as VT).bytes)); break;
      }
    });
  }
  // Locals in runs of one type.
  const groups: number[][] = [];
  for (const [, t] of f.locals) {
    const b = r.valtype(t).bytes;
    const last = groups[groups.length - 1];
    if (last && last.slice(1).join() === b.join() && last[0] < 127) last[0]++;
    else groups.push([1, ...b]);
  }
  const code = [...u(groups.length), ...groups.flat(), ...out, 0x0b];
  const wat = [
    `  (func $${f.name}${f.params.map(([n, t]) => ` (param $${n} ${r.valtype(t).text})`).join("")} ${f.result === "void" ? (f.partial ? " (result i32)" : "") : ` (result ${r.valtype(f.result).text}${f.partial ? " i32" : ""})`}${f.locals.map(([n, t]) => ` (local $${n} ${r.valtype(t).text})`).join("")}`,
    ...lines.map((l) => {
      const [op, ...args] = l.split(/\s+/);
      if (args.length === 2 && /\.(load|store)/.test(op)) return `    ${op} ${args[0]} offset=${args[1]}`;
      return `    ${op}${args.length ? " " + args.map((a) => (a === "void" ? "" : /^[a-z][a-z0-9]*$/.test(a) && OPS[op]?.[1].includes("bt") ? `(result ${r.valtype(a as VT).text})` : (op === "ref.test" || op === "ref.cast") && !a.startsWith("(") ? `(ref ${a})` : a)).filter(Boolean).join(" ") : ""}`;
    }),
    "  )",
  ].join("\n");
  return { code, wat };
}

// Instructions for a text constant (array.new_fixed), from its UTF-8 bytes.
export const textBytes = (v: string) => [...new TextEncoder().encode(v)];

// ---- the functions, by name

// Ryū's tables (number.js): for i ≥ 0, 2^(pow5bits(i) − 1 + 125) / 5^i
// rounded up, then 5^i in its top 125 bits, each 128 bits as (low, high)
// 64-bit halves, made here with BigInt and put in the module once.
const POW5_INV_ROWS = 342, POW5_ROWS = 326;
const bitlength = (n: bigint) => n.toString(2).length;
export const POW5: bigint[] = (() => {
  const out: bigint[] = [];
  const half = (v: bigint) => out.push(BigInt.asIntN(64, v & ((1n << 64n) - 1n)), BigInt.asIntN(64, v >> 64n));
  for (let i = 0; i < POW5_INV_ROWS; i++) { const p = 5n ** BigInt(i); half((1n << BigInt(bitlength(p) - 1 + 125)) / p + 1n); }
  for (let i = 0; i < POW5_ROWS; i++) { const p = 5n ** BigInt(i), b = bitlength(p); half(b < 125 ? p << BigInt(125 - b) : p >> BigInt(b - 125)); }
  return out;
})();
// A text constant, one byte per line.
const lit = (t: string) => [...textBytes(t).map((b) => `i32.const ${b}`), `array.new_fixed $bytes ${textBytes(t).length}`].join("\n");
// One digit dropped from vr, vp and vm, keeping the last one and whether those before were zeros.
const drop = ["local.get $vrTZ", "local.get $last", "i32.eqz", "i32.and", "local.set $vrTZ", "local.get $vr", "i64.const 10", "i64.rem_u", "i32.wrap_i64", "local.set $last",
  ...["vr", "vp", "vm"].flatMap((v) => [`local.get $${v}`, "i64.const 10", "i64.div_u", `local.set $${v}`]), "local.get $removed", "i32.const 1", "i32.add", "local.set $removed"].join("\n");

const R: Record<string, Omit<RtFn, "name">> = {
  // a ++ b
  "text.concat": {
    params: [["a", "text"], ["b", "text"]], result: "text", locals: [["r", "text"]], uses: [],
    body: `
      local.get $a
      array.len
      local.get $b
      array.len
      i32.add
      array.new_default $bytes
      local.set $r
      local.get $r
      i32.const 0
      local.get $a
      i32.const 0
      local.get $a
      array.len
      array.copy $bytes $bytes
      local.get $r
      local.get $a
      array.len
      local.get $b
      i32.const 0
      local.get $b
      array.len
      array.copy $bytes $bytes
      local.get $r`,
  },
  // The number of characters: the bytes that start one.
  "text.length": {
    params: [["t", "text"]], result: "int", locals: [["i", "i32"], ["n", "i32"]], uses: [],
    body: `
      block void
      loop void
        local.get $i
        local.get $t
        array.len
        i32.ge_u
        br_if 1
        local.get $t
        local.get $i
        array.get_u $bytes
        i32.const 192
        i32.and
        i32.const 128
        i32.ne
        local.get $n
        i32.add
        local.set $n
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br 0
      end
      end
      local.get $n
      i64.extend_i32_u`,
  },
  // Where character k starts, in bytes; the length if there are fewer.
  "text.offset": {
    params: [["t", "text"], ["k", "i32"]], result: "i32", locals: [["i", "i32"], ["c", "i32"]], uses: [],
    body: `
      block void
      loop void
        local.get $i
        local.get $t
        array.len
        i32.ge_u
        br_if 1
        local.get $t
        local.get $i
        array.get_u $bytes
        i32.const 192
        i32.and
        i32.const 128
        i32.ne
        if void
          local.get $c
          local.get $k
          i32.eq
          br_if 2
          local.get $c
          i32.const 1
          i32.add
          local.set $c
        end
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br 0
      end
      end
      local.get $i`,
  },
  // An Int position, clamped to 0 … hi.
  "text.clamp": {
    params: [["x", "i64"], ["hi", "i32"]], result: "i32", locals: [], uses: [],
    body: `
      local.get $x
      i64.const 0
      i64.lt_s
      if i32
        i32.const 0
      else
        local.get $x
        local.get $hi
        i64.extend_i32_u
        i64.gt_s
        if i32
          local.get $hi
        else
          local.get $x
          i32.wrap_i64
        end
      end`,
  },
  // The characters from `from` up to, not including, `to`, clamped (text.ts slice).
  "text.slice": {
    params: [["t", "text"], ["from", "int"], ["to", "int"]], result: "text", locals: [["a", "i32"], ["b", "i32"], ["r", "text"]], uses: ["text.clamp", "text.offset"],
    body: `
      local.get $from
      local.get $t
      array.len
      call $text.clamp
      local.set $a
      local.get $to
      local.get $t
      array.len
      call $text.clamp
      local.set $b
      local.get $b
      local.get $a
      i32.le_u
      if text
        i32.const 0
        array.new_default $bytes
      else
        local.get $t
        local.get $a
        call $text.offset
        local.set $a
        local.get $t
        local.get $b
        call $text.offset
        local.set $b
        local.get $b
        local.get $a
        i32.sub
        array.new_default $bytes
        local.set $r
        local.get $r
        i32.const 0
        local.get $t
        local.get $a
        local.get $b
        local.get $a
        i32.sub
        array.copy $bytes $bytes
        local.get $r
      end`,
  },
  // The same bytes.
  "text.equal": {
    params: [["a", "text"], ["b", "text"]], result: "i32", locals: [["i", "i32"]], uses: [],
    body: `
      local.get $a
      array.len
      local.get $b
      array.len
      i32.ne
      if void
        i32.const 0
        return
      end
      block void
      loop void
        local.get $i
        local.get $a
        array.len
        i32.ge_u
        br_if 1
        local.get $a
        local.get $i
        array.get_u $bytes
        local.get $b
        local.get $i
        array.get_u $bytes
        i32.ne
        if void
          i32.const 0
          return
        end
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br 0
      end
      end
      i32.const 1`,
  },
  // Code-point order, which is UTF-8's byte order.
  "text.less": {
    params: [["a", "text"], ["b", "text"]], result: "i32", locals: [["i", "i32"], ["x", "i32"], ["y", "i32"]], uses: [],
    body: `
      block void
      loop void
        local.get $i
        local.get $a
        array.len
        i32.ge_u
        if void
          local.get $i
          local.get $b
          array.len
          i32.lt_u
          return
        end
        local.get $i
        local.get $b
        array.len
        i32.ge_u
        if void
          i32.const 0
          return
        end
        local.get $a
        local.get $i
        array.get_u $bytes
        local.set $x
        local.get $b
        local.get $i
        array.get_u $bytes
        local.set $y
        local.get $x
        local.get $y
        i32.ne
        if void
          local.get $x
          local.get $y
          i32.lt_u
          return
        end
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br 0
      end
      end
      unreachable`,
  },
  // Decimal digits, as std.ts's show of an Int. Kept at or below zero
  // while dividing, so the smallest i64 has its digits too.
  "int64.show": {
    params: [["n", "i64"]], result: "text", locals: [["m", "i64"], ["buf", "text"], ["i", "i32"], ["r", "text"]], uses: [],
    body: `
      i32.const 20
      array.new_default $bytes
      local.set $buf
      i32.const 20
      local.set $i
      local.get $n
      i64.const 0
      i64.gt_s
      if i64
        i64.const 0
        local.get $n
        i64.sub
      else
        local.get $n
      end
      local.set $m
      loop void
        local.get $i
        i32.const 1
        i32.sub
        local.set $i
        local.get $buf
        local.get $i
        i32.const 48
        i64.const 0
        local.get $m
        i64.const 10
        i64.rem_s
        i64.sub
        i32.wrap_i64
        i32.add
        array.set $bytes
        local.get $m
        i64.const 10
        i64.div_s
        local.tee $m
        i64.eqz
        i32.eqz
        br_if 0
      end
      local.get $n
      i64.const 0
      i64.lt_s
      if void
        local.get $i
        i32.const 1
        i32.sub
        local.set $i
        local.get $buf
        local.get $i
        i32.const 45
        array.set $bytes
      end
      i32.const 20
      local.get $i
      i32.sub
      array.new_default $bytes
      local.set $r
      local.get $r
      i32.const 0
      local.get $buf
      local.get $i
      i32.const 20
      local.get $i
      i32.sub
      array.copy $bytes $bytes
      local.get $r`,
  },
  // On i64s, overflow is a trap: int.add and the rest take the limbs then.
  "int64.add": {
    params: [["a", "i64"], ["b", "i64"]], result: "i64", locals: [["r", "i64"]], uses: [],
    body: `
      local.get $a
      local.get $b
      i64.add
      local.set $r
      local.get $a
      local.get $r
      i64.xor
      local.get $b
      local.get $r
      i64.xor
      i64.and
      i64.const 0
      i64.lt_s
      if void
        unreachable
      end
      local.get $r`,
  },
  "int64.sub": {
    params: [["a", "i64"], ["b", "i64"]], result: "i64", locals: [["r", "i64"]], uses: [],
    body: `
      local.get $a
      local.get $b
      i64.sub
      local.set $r
      local.get $a
      local.get $b
      i64.xor
      local.get $a
      local.get $r
      i64.xor
      i64.and
      i64.const 0
      i64.lt_s
      if void
        unreachable
      end
      local.get $r`,
  },
  // a·b, checked by dividing back (and the one case that division can't see).
  "int64.mul": {
    params: [["a", "i64"], ["b", "i64"]], result: "i64", locals: [["r", "i64"]], uses: [],
    body: `
      local.get $a
      local.get $b
      i64.mul
      local.set $r
      local.get $a
      i64.eqz
      if void
        i64.const 0
        return
      end
      local.get $a
      i64.const -1
      i64.eq
      local.get $b
      i64.const -9223372036854775808
      i64.eq
      i32.and
      if void
        unreachable
      end
      local.get $r
      local.get $a
      i64.div_s
      local.get $b
      i64.ne
      if void
        unreachable
      end
      local.get $r`,
  },
  "int64.neg": {
    params: [["a", "i64"]], result: "i64", locals: [], uses: [],
    body: `
      local.get $a
      i64.const -9223372036854775808
      i64.eq
      if void
        unreachable
      end
      i64.const 0
      local.get $a
      i64.sub`,
  },
  "int64.less": { params: [["a", "i64"], ["b", "i64"]], result: "i32", locals: [], uses: [], body: "local.get $a\nlocal.get $b\ni64.lt_s" },
  "int64.equal": { params: [["a", "i64"], ["b", "i64"]], result: "i32", locals: [], uses: [], body: "local.get $a\nlocal.get $b\ni64.eq" },
  "int64.toNumber": { params: [["a", "i64"]], result: "f64", locals: [], uses: [], body: "local.get $a\nf64.convert_i64_s" },
  "int64.abs": {
    params: [["a", "i64"]], result: "i64", locals: [], uses: ["int64.neg"],
    body: `
      local.get $a
      i64.const 0
      i64.lt_s
      if i64
        local.get $a
        call $int64.neg
      else
        local.get $a
      end`,
  },
  // JavaScript's String of any Float64: the shortest digits that read back
  // as it, laid out as JavaScript lays them out (number.layout). The
  // digits are Ryū's (Ulf Adams, "Ryū: fast float-to-string conversion",
  // PLDI 2018; d2s.c, Apache 2.0 or Boost licence), adapted: its tables
  // are the global $pow5 (POW5 below), its 128-bit products number.mulshift.
  "number.js": {
    params: [["x", "f64"]], result: "text",
    locals: [["bits", "i64"], ["ieeeM", "i64"], ["ieeeE", "i32"], ["e2", "i32"], ["m2", "i64"], ["even", "i32"], ["mv", "i64"], ["mmShift", "i64"],
      ["q", "i32"], ["e10", "i32"], ["k", "i32"], ["i", "i32"], ["row", "i32"], ["j", "i32"], ["vr", "i64"], ["vp", "i64"], ["vm", "i64"],
      ["vmTZ", "i32"], ["vrTZ", "i32"], ["removed", "i32"], ["last", "i32"]],
    uses: ["number.mulshift", "number.pow5factor", "number.layout"],
    body: `
      local.get $x
      local.get $x
      f64.ne
      if void
        ${lit("NaN")}
        return
      end
      local.get $x
      f64.const 0
      f64.eq
      if void
        ${lit("0")}
        return
      end
      ;; the infinities: x − x isn't 0
      local.get $x
      local.get $x
      f64.sub
      f64.const 0
      f64.ne
      if void
        local.get $x
        f64.const 0
        f64.lt
        if text
          ${lit("-Infinity")}
        else
          ${lit("Infinity")}
        end
        return
      end
      ;; x = m2 · 2^e2, and the halfway points to its neighbours (mv ± 2) with two more bits
      local.get $x
      i64.reinterpret_f64
      local.tee $bits
      i64.const 4503599627370495
      i64.and
      local.set $ieeeM
      local.get $bits
      i64.const 52
      i64.shr_u
      i32.wrap_i64
      i32.const 2047
      i32.and
      local.tee $ieeeE
      i32.eqz
      if void
        i32.const -1076
        local.set $e2
        local.get $ieeeM
        local.set $m2
      else
        local.get $ieeeE
        i32.const 1077
        i32.sub
        local.set $e2
        local.get $ieeeM
        i64.const 4503599627370496
        i64.or
        local.set $m2
      end
      local.get $m2
      i64.const 1
      i64.and
      i64.eqz
      local.set $even
      local.get $m2
      i64.const 2
      i64.shl
      local.set $mv
      local.get $ieeeM
      i64.eqz
      i32.eqz
      local.get $ieeeE
      i32.const 1
      i32.le_u
      i32.or
      i64.extend_i32_u
      local.set $mmShift
      ;; to base 10: e10, and the table row and shift for the product
      local.get $e2
      i32.const 0
      i32.ge_s
      if void
        ;; q = log10(2^e2) − (e2 > 3), k = 125 + pow5bits(q) − 1, j = q + k − e2
        local.get $e2
        i32.const 78913
        i32.mul
        i32.const 18
        i32.shr_u
        local.get $e2
        i32.const 3
        i32.gt_s
        i32.sub
        local.tee $q
        local.set $e10
        local.get $q
        i32.const 1217359
        i32.mul
        i32.const 19
        i32.shr_u
        i32.const 125
        i32.add
        local.set $k
        local.get $q
        local.get $k
        i32.add
        local.get $e2
        i32.sub
        local.set $j
        local.get $q
        i32.const 1
        i32.shl
        local.set $row
      else
        ;; q = log10(5^−e2) − (−e2 > 1), i = −e2 − q, k = pow5bits(i) − 125, j = q − k
        i32.const 0
        local.get $e2
        i32.sub
        local.tee $i
        i32.const 732923
        i32.mul
        i32.const 20
        i32.shr_u
        local.get $i
        i32.const 1
        i32.gt_s
        i32.sub
        local.tee $q
        local.get $e2
        i32.add
        local.set $e10
        local.get $i
        local.get $q
        i32.sub
        local.tee $i
        i32.const 1217359
        i32.mul
        i32.const 19
        i32.shr_u
        i32.const 1
        i32.add
        i32.const 125
        i32.sub
        local.set $k
        local.get $q
        local.get $k
        i32.sub
        local.set $j
        local.get $i
        i32.const 1
        i32.shl
        i32.const ${2 * POW5_INV_ROWS}
        i32.add
        local.set $row
      end
      local.get $mv
      local.get $row
      local.get $j
      call $number.mulshift
      local.set $vr
      local.get $mv
      i64.const 2
      i64.add
      local.get $row
      local.get $j
      call $number.mulshift
      local.set $vp
      local.get $mv
      i64.const 1
      i64.sub
      local.get $mmShift
      i64.sub
      local.get $row
      local.get $j
      call $number.mulshift
      local.set $vm
      ;; whether the digits dropped below are all zeros (exact ties)
      local.get $e2
      i32.const 0
      i32.ge_s
      if void
        local.get $q
        i32.const 21
        i32.le_s
        if void
          local.get $mv
          i64.const 5
          i64.rem_u
          i64.eqz
          if void
            local.get $mv
            call $number.pow5factor
            local.get $q
            i32.ge_s
            local.set $vrTZ
          else
            local.get $even
            if void
              local.get $mv
              i64.const 1
              i64.sub
              local.get $mmShift
              i64.sub
              call $number.pow5factor
              local.get $q
              i32.ge_s
              local.set $vmTZ
            else
              local.get $vp
              local.get $mv
              i64.const 2
              i64.add
              call $number.pow5factor
              local.get $q
              i32.ge_s
              i64.extend_i32_u
              i64.sub
              local.set $vp
            end
          end
        end
      else
        local.get $q
        i32.const 1
        i32.le_s
        if void
          i32.const 1
          local.set $vrTZ
          local.get $even
          if void
            local.get $mmShift
            i32.wrap_i64
            local.set $vmTZ
          else
            local.get $vp
            i64.const 1
            i64.sub
            local.set $vp
          end
        else
          local.get $q
          i32.const 63
          i32.lt_s
          if void
            local.get $mv
            i64.const 1
            local.get $q
            i64.extend_i32_u
            i64.shl
            i64.const 1
            i64.sub
            i64.and
            i64.eqz
            local.set $vrTZ
          end
        end
      end
      ;; drop digits while the interval still holds a shorter number
      block void
        loop void
          local.get $vp
          i64.const 10
          i64.div_u
          local.get $vm
          i64.const 10
          i64.div_u
          i64.le_u
          br_if 1
          local.get $vmTZ
          local.get $vm
          i64.const 10
          i64.rem_u
          i64.eqz
          i32.and
          local.set $vmTZ
${drop}
          br 0
        end
      end
      local.get $vmTZ
      if void
        block void
          loop void
            local.get $vm
            i64.const 10
            i64.rem_u
            i64.eqz
            i32.eqz
            br_if 1
${drop}
            br 0
          end
        end
      end
      ;; an exact tie rounds to even
      local.get $vrTZ
      local.get $last
      i32.const 5
      i32.eq
      i32.and
      local.get $vr
      i64.const 1
      i64.and
      i64.eqz
      i32.and
      if void
        i32.const 4
        local.set $last
      end
      local.get $vr
      local.get $vr
      local.get $vm
      i64.eq
      local.get $even
      i32.eqz
      local.get $vmTZ
      i32.eqz
      i32.or
      i32.and
      local.get $last
      i32.const 5
      i32.ge_u
      i32.or
      i64.extend_i32_u
      i64.add
      local.get $e10
      local.get $removed
      i32.add
      local.get $x
      f64.const 0
      f64.lt
      call $number.layout`,
  },
  // (m · the table's 128-bit row) >> j, as Ryū's mulShift64.
  "number.mulshift": {
    params: [["m", "i64"], ["row", "i32"], ["j", "i32"]], result: "i64", locals: [["lo", "i64"], ["hi", "i64"], ["sum", "i64"], ["top", "i64"], ["s", "i64"]], uses: ["number.mulhi"],
    body: `
      global.get $pow5
      local.get $row
      array.get $i64s
      local.set $lo
      global.get $pow5
      local.get $row
      i32.const 1
      i32.add
      array.get $i64s
      local.set $hi
      ;; the product's bits 64 to 191 as top:sum
      local.get $m
      local.get $lo
      call $number.mulhi
      local.get $m
      local.get $hi
      i64.mul
      i64.add
      local.tee $sum
      local.get $m
      local.get $hi
      i64.mul
      i64.lt_u
      i64.extend_i32_u
      local.get $m
      local.get $hi
      call $number.mulhi
      i64.add
      local.set $top
      local.get $j
      i32.const 64
      i32.sub
      i64.extend_i32_u
      local.tee $s
      i64.const 64
      i64.ge_u
      if i64
        local.get $top
        local.get $s
        i64.const 64
        i64.sub
        i64.shr_u
      else
        local.get $s
        i64.eqz
        if i64
          local.get $sum
        else
          local.get $sum
          local.get $s
          i64.shr_u
          local.get $top
          i64.const 64
          local.get $s
          i64.sub
          i64.shl
          i64.or
        end
      end`,
  },
  // The high 64 bits of a · b, unsigned, from 32-bit halves.
  "number.mulhi": {
    params: [["a", "i64"], ["b", "i64"]], result: "i64", locals: [["a0", "i64"], ["a1", "i64"], ["b0", "i64"], ["b1", "i64"], ["p01", "i64"], ["p10", "i64"], ["mid", "i64"]], uses: [],
    body: `
      local.get $a
      i64.const 4294967295
      i64.and
      local.set $a0
      local.get $a
      i64.const 32
      i64.shr_u
      local.set $a1
      local.get $b
      i64.const 4294967295
      i64.and
      local.set $b0
      local.get $b
      i64.const 32
      i64.shr_u
      local.set $b1
      local.get $a0
      local.get $b1
      i64.mul
      local.set $p01
      local.get $a1
      local.get $b0
      i64.mul
      local.set $p10
      local.get $a0
      local.get $b0
      i64.mul
      i64.const 32
      i64.shr_u
      local.get $p01
      i64.const 4294967295
      i64.and
      i64.add
      local.get $p10
      i64.const 4294967295
      i64.and
      i64.add
      local.set $mid
      local.get $a1
      local.get $b1
      i64.mul
      local.get $p01
      i64.const 32
      i64.shr_u
      i64.add
      local.get $p10
      i64.const 32
      i64.shr_u
      i64.add
      local.get $mid
      i64.const 32
      i64.shr_u
      i64.add`,
  },
  // How many times 5 divides v (not 0).
  "number.pow5factor": {
    params: [["v", "i64"]], result: "i32", locals: [["n", "i32"]], uses: [],
    body: `
      block void
        loop void
          local.get $v
          i64.const 5
          i64.rem_u
          i64.eqz
          i32.eqz
          br_if 1
          local.get $v
          i64.const 5
          i64.div_u
          local.set $v
          local.get $n
          i32.const 1
          i32.add
          local.set $n
          br 0
        end
      end
      local.get $n`,
  },
  // Digits d times 10^e as JavaScript's Number::toString lays them out
  // (ECMA-262): n = e + the number of digits; whole up to 21 digits, a
  // point inside, 0.000ddd down to n = −5, else d.ddde±x.
  "number.layout": {
    params: [["d", "i64"], ["e", "i32"], ["neg", "i32"]], result: "text", locals: [["s", "text"], ["k", "i32"], ["n", "i32"], ["out", "text"]], uses: ["int64.show", "text.concat", "text.bytes"],
    body: `
      local.get $d
      call $int64.show
      local.tee $s
      array.len
      local.tee $k
      local.get $e
      i32.add
      local.set $n
      local.get $k
      local.get $n
      i32.le_s
      local.get $n
      i32.const 21
      i32.le_s
      i32.and
      if void
        local.get $s
        i32.const 48
        local.get $n
        local.get $k
        i32.sub
        array.new $bytes
        call $text.concat
        local.set $out
      else
        local.get $n
        i32.const 0
        i32.gt_s
        local.get $n
        i32.const 21
        i32.le_s
        i32.and
        if void
          local.get $s
          i32.const 0
          local.get $n
          call $text.bytes
          i32.const 46
          array.new_fixed $bytes 1
          call $text.concat
          local.get $s
          local.get $n
          local.get $k
          call $text.bytes
          call $text.concat
          local.set $out
        else
          local.get $n
          i32.const -6
          i32.gt_s
          local.get $n
          i32.const 0
          i32.le_s
          i32.and
          if void
            i32.const 48
            i32.const 46
            array.new_fixed $bytes 2
            i32.const 48
            i32.const 0
            local.get $n
            i32.sub
            array.new $bytes
            call $text.concat
            local.get $s
            call $text.concat
            local.set $out
          else
            local.get $s
            i32.const 0
            i32.const 1
            call $text.bytes
            local.set $out
            local.get $k
            i32.const 1
            i32.gt_s
            if void
              local.get $out
              i32.const 46
              array.new_fixed $bytes 1
              call $text.concat
              local.get $s
              i32.const 1
              local.get $k
              call $text.bytes
              call $text.concat
              local.set $out
            end
            ;; e, the sign (+ or −), the exponent's digits
            local.get $out
            i32.const 101
            i32.const 43
            i32.const 2
            local.get $n
            i32.const 1
            i32.lt_s
            i32.mul
            i32.add
            array.new_fixed $bytes 2
            call $text.concat
            local.get $n
            i32.const 1
            i32.sub
            local.tee $n
            i32.const 0
            i32.lt_s
            if void
              i32.const 0
              local.get $n
              i32.sub
              local.set $n
            end
            local.get $n
            i64.extend_i32_u
            call $int64.show
            call $text.concat
            local.set $out
          end
        end
      end
      local.get $neg
      if text
        i32.const 45
        array.new_fixed $bytes 1
        local.get $out
        call $text.concat
      else
        local.get $out
      end`,
  },
  // Bytes a to b of t (the digits above are ASCII).
  "text.bytes": {
    params: [["t", "text"], ["a", "i32"], ["b", "i32"]], result: "text", locals: [["r", "text"]], uses: [],
    body: `
      local.get $b
      local.get $a
      i32.sub
      array.new_default $bytes
      local.tee $r
      i32.const 0
      local.get $t
      local.get $a
      local.get $b
      local.get $a
      i32.sub
      array.copy $bytes $bytes
      local.get $r`,
  },
  // Big Ints (W5b). A magnitude is an (array (mut i32)) of 32-bit limbs,
  // least significant first, with no zero limb at the top (0 is empty).
  // An Int past an i64 is a $huge: its sign (1 for negative) and its
  // magnitude; one that fits stays an i31 or a $big, so each value has one
  // form. Schoolbook arithmetic, as in Knuth's Seminumerical Algorithms
  // (TAOCP vol. 2, 4.3.1); show and read go by 10⁹ at a time.
  "mag.at": {
    params: [["a", "mag"], ["i", "i32"]], result: "i64", locals: [], uses: [],
    body: `
      local.get $i
      local.get $a
      array.len
      i32.lt_u
      if i64
        local.get $a
        local.get $i
        array.get $u32s
        i64.extend_i32_u
      else
        i64.const 0
      end`,
  },
  "mag.trim": {
    params: [["a", "mag"]], result: "mag", locals: [["n", "i32"], ["r", "mag"]], uses: [],
    body: `
      local.get $a
      array.len
      local.set $n
      block void
        loop void
          local.get $n
          i32.eqz
          br_if 1
          local.get $a
          local.get $n
          i32.const 1
          i32.sub
          array.get $u32s
          br_if 1
          local.get $n
          i32.const 1
          i32.sub
          local.set $n
          br 0
        end
      end
      local.get $n
      local.get $a
      array.len
      i32.eq
      if mag
        local.get $a
      else
        local.get $n
        array.new_default $u32s
        local.tee $r
        i32.const 0
        local.get $a
        i32.const 0
        local.get $n
        array.copy $u32s $u32s
        local.get $r
      end`,
  },
  // An unsigned 64-bit u's magnitude.
  "mag.of": {
    params: [["u", "i64"]], result: "mag", locals: [], uses: ["mag.trim"],
    body: `
      local.get $u
      i32.wrap_i64
      local.get $u
      i64.const 32
      i64.shr_u
      i32.wrap_i64
      array.new_fixed $u32s 2
      call $mag.trim`,
  },
  "mag.add": {
    params: [["a", "mag"], ["b", "mag"]], result: "mag", locals: [["n", "i32"], ["i", "i32"], ["r", "mag"], ["carry", "i64"], ["s", "i64"]], uses: ["mag.at", "mag.trim"],
    body: `
      local.get $a
      array.len
      local.tee $n
      local.get $b
      array.len
      local.tee $i
      local.get $n
      local.get $i
      i32.gt_u
      select
      i32.const 1
      i32.add
      local.tee $n
      array.new_default $u32s
      local.set $r
      i32.const 0
      local.set $i
      block void
        loop void
          local.get $i
          local.get $n
          i32.ge_u
          br_if 1
          local.get $a
          local.get $i
          call $mag.at
          local.get $b
          local.get $i
          call $mag.at
          i64.add
          local.get $carry
          i64.add
          local.set $s
          local.get $r
          local.get $i
          local.get $s
          i32.wrap_i64
          array.set $u32s
          local.get $s
          i64.const 32
          i64.shr_u
          local.set $carry
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br 0
        end
      end
      local.get $r
      call $mag.trim`,
  },
  // a − b, for a ≥ b.
  "mag.sub": {
    params: [["a", "mag"], ["b", "mag"]], result: "mag", locals: [["n", "i32"], ["i", "i32"], ["r", "mag"], ["borrow", "i64"], ["s", "i64"]], uses: ["mag.at", "mag.trim"],
    body: `
      local.get $a
      array.len
      local.tee $n
      array.new_default $u32s
      local.set $r
      block void
        loop void
          local.get $i
          local.get $n
          i32.ge_u
          br_if 1
          local.get $a
          local.get $i
          call $mag.at
          local.get $b
          local.get $i
          call $mag.at
          i64.sub
          local.get $borrow
          i64.sub
          local.tee $s
          i64.const 0
          i64.lt_s
          i64.extend_i32_u
          local.set $borrow
          ;; a negative difference wraps to it plus 2³²
          local.get $r
          local.get $i
          local.get $s
          i32.wrap_i64
          array.set $u32s
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br 0
        end
      end
      local.get $r
      call $mag.trim`,
  },
  // −1, 0 or 1 as a is less than, equal to or more than b.
  "mag.cmp": {
    params: [["a", "mag"], ["b", "mag"]], result: "i32", locals: [["i", "i32"], ["n", "i32"], ["x", "i32"], ["y", "i32"]], uses: [],
    body: `
      local.get $a
      array.len
      local.tee $i
      local.get $b
      array.len
      local.tee $n
      i32.ne
      if void
        local.get $i
        local.get $n
        i32.lt_u
        if i32
          i32.const -1
        else
          i32.const 1
        end
        return
      end
      block void
        loop void
          local.get $i
          i32.eqz
          br_if 1
          local.get $i
          i32.const 1
          i32.sub
          local.set $i
          local.get $a
          local.get $i
          array.get $u32s
          local.tee $x
          local.get $b
          local.get $i
          array.get $u32s
          local.tee $y
          i32.ne
          if void
            local.get $x
            local.get $y
            i32.lt_u
            if i32
              i32.const -1
            else
              i32.const 1
            end
            return
          end
          br 0
        end
      end
      i32.const 0`,
  },
  "mag.mul": {
    params: [["a", "mag"], ["b", "mag"]], result: "mag", locals: [["la", "i32"], ["lb", "i32"], ["i", "i32"], ["j", "i32"], ["r", "mag"], ["ai", "i64"], ["carry", "i64"], ["t", "i64"]], uses: ["mag.trim"],
    body: `
      local.get $a
      array.len
      local.tee $la
      local.get $b
      array.len
      local.tee $lb
      i32.add
      array.new_default $u32s
      local.set $r
      block void
        loop void
          local.get $i
          local.get $la
          i32.ge_u
          br_if 1
          local.get $a
          local.get $i
          array.get $u32s
          i64.extend_i32_u
          local.set $ai
          i64.const 0
          local.set $carry
          i32.const 0
          local.set $j
          block void
            loop void
              local.get $j
              local.get $lb
              i32.ge_u
              br_if 1
              ;; ai·b[j] + r[i+j] + carry fits in 64 bits
              local.get $ai
              local.get $b
              local.get $j
              array.get $u32s
              i64.extend_i32_u
              i64.mul
              local.get $r
              local.get $i
              local.get $j
              i32.add
              array.get $u32s
              i64.extend_i32_u
              i64.add
              local.get $carry
              i64.add
              local.set $t
              local.get $r
              local.get $i
              local.get $j
              i32.add
              local.get $t
              i32.wrap_i64
              array.set $u32s
              local.get $t
              i64.const 32
              i64.shr_u
              local.set $carry
              local.get $j
              i32.const 1
              i32.add
              local.set $j
              br 0
            end
          end
          local.get $r
          local.get $i
          local.get $lb
          i32.add
          local.get $carry
          i32.wrap_i64
          array.set $u32s
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br 0
        end
      end
      local.get $r
      call $mag.trim`,
  },
  // a divided by a small d (unsigned, not 0), and what's left.
  "mag.divsmall": {
    params: [["a", "mag"], ["d", "i32"]], result: "mag", locals: [["i", "i32"], ["r", "mag"], ["rem", "i64"], ["cur", "i64"], ["dd", "i64"]], uses: ["mag.trim"],
    body: `
      local.get $d
      i64.extend_i32_u
      local.set $dd
      local.get $a
      array.len
      local.tee $i
      array.new_default $u32s
      local.set $r
      block void
        loop void
          local.get $i
          i32.eqz
          br_if 1
          local.get $i
          i32.const 1
          i32.sub
          local.set $i
          local.get $rem
          i64.const 32
          i64.shl
          local.get $a
          local.get $i
          array.get $u32s
          i64.extend_i32_u
          i64.or
          local.tee $cur
          local.get $dd
          i64.rem_u
          local.set $rem
          local.get $r
          local.get $i
          local.get $cur
          local.get $dd
          i64.div_u
          i32.wrap_i64
          array.set $u32s
          br 0
        end
      end
      local.get $r
      call $mag.trim`,
  },
  "mag.modsmall": {
    params: [["a", "mag"], ["d", "i32"]], result: "i32", locals: [["i", "i32"], ["rem", "i64"], ["dd", "i64"]], uses: [],
    body: `
      local.get $d
      i64.extend_i32_u
      local.set $dd
      local.get $a
      array.len
      local.set $i
      block void
        loop void
          local.get $i
          i32.eqz
          br_if 1
          local.get $i
          i32.const 1
          i32.sub
          local.set $i
          local.get $rem
          i64.const 32
          i64.shl
          local.get $a
          local.get $i
          array.get $u32s
          i64.extend_i32_u
          i64.or
          local.get $dd
          i64.rem_u
          local.set $rem
          br 0
        end
      end
      local.get $rem
      i32.wrap_i64`,
  },
  // a's limbs shifted left by s (0 to 31) into n limbs: Knuth's D1.
  "mag.scaled": {
    params: [["a", "mag"], ["s", "i32"], ["n", "i32"]], result: "mag", locals: [["r", "mag"], ["i", "i32"]], uses: ["mag.at"],
    body: `
      local.get $n
      array.new_default $u32s
      local.set $r
      block void
        loop void
          local.get $i
          local.get $n
          i32.ge_u
          br_if 1
          local.get $r
          local.get $i
          local.get $a
          local.get $i
          call $mag.at
          i64.const 32
          i64.shl
          local.get $a
          local.get $i
          i32.const 1
          i32.sub
          call $mag.at
          i64.or
          local.get $s
          i64.extend_i32_u
          i64.shl
          i64.const 32
          i64.shr_u
          i32.wrap_i64
          array.set $u32s
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br 0
        end
      end
      local.get $r`,
  },
  // u's quotient by v (rem 0) or its remainder (rem 1), v not 0: Knuth's
  // algorithm D (TAOCP vol. 2, 4.3.1), as Hacker's Delight's divmnu
  // writes it, with 32-bit limbs and 64-bit arithmetic. A one-limb v
  // takes mag.divsmall.
  "mag.divrem": {
    params: [["u", "mag"], ["v", "mag"], ["rem", "i32"]], result: "mag",
    locals: [["m", "i32"], ["n", "i32"], ["s", "i32"], ["j", "i32"], ["i", "i32"], ["un", "mag"], ["vn", "mag"], ["q", "mag"], ["r", "mag"], ["vtop", "i64"], ["vsec", "i64"], ["qhat", "i64"], ["rhat", "i64"], ["p", "i64"], ["t", "i64"], ["k", "i64"]],
    uses: ["mag.at", "mag.trim", "mag.cmp", "mag.of", "mag.divsmall", "mag.modsmall", "mag.scaled"],
    body: `
      local.get $u
      local.get $v
      call $mag.cmp
      i32.const 0
      i32.lt_s
      if void
        local.get $rem
        if mag
          local.get $u
        else
          i32.const 0
          array.new_default $u32s
        end
        return
      end
      local.get $v
      array.len
      local.tee $n
      i32.const 1
      i32.eq
      if void
        local.get $rem
        if mag
          local.get $u
          local.get $v
          i32.const 0
          array.get $u32s
          call $mag.modsmall
          i64.extend_i32_u
          call $mag.of
        else
          local.get $u
          local.get $v
          i32.const 0
          array.get $u32s
          call $mag.divsmall
        end
        return
      end
      local.get $u
      array.len
      local.set $m
      ;; D1: shift so v's top limb has its top bit set.
      local.get $v
      local.get $n
      i32.const 1
      i32.sub
      array.get $u32s
      i32.clz
      local.set $s
      local.get $v
      local.get $s
      local.get $n
      call $mag.scaled
      local.tee $vn
      local.get $n
      i32.const 1
      i32.sub
      array.get $u32s
      i64.extend_i32_u
      local.set $vtop
      local.get $vn
      local.get $n
      i32.const 2
      i32.sub
      array.get $u32s
      i64.extend_i32_u
      local.set $vsec
      local.get $u
      local.get $s
      local.get $m
      i32.const 1
      i32.add
      call $mag.scaled
      local.set $un
      local.get $m
      local.get $n
      i32.sub
      i32.const 1
      i32.add
      array.new_default $u32s
      local.set $q
      local.get $m
      local.get $n
      i32.sub
      local.set $j
      block void
        loop void
          local.get $j
          i32.const 0
          i32.lt_s
          br_if 1
          ;; D3: guess q̂ from the top two limbs, then correct it.
          local.get $un
          local.get $j
          local.get $n
          i32.add
          array.get $u32s
          i64.extend_i32_u
          i64.const 32
          i64.shl
          local.get $un
          local.get $j
          local.get $n
          i32.add
          i32.const 1
          i32.sub
          array.get $u32s
          i64.extend_i32_u
          i64.or
          local.tee $t
          local.get $vtop
          i64.div_u
          local.set $qhat
          local.get $t
          local.get $qhat
          local.get $vtop
          i64.mul
          i64.sub
          local.set $rhat
          block void
            loop void
              local.get $qhat
              i64.const 4294967296
              i64.ge_u
              if i32
                i32.const 1
              else
                local.get $qhat
                local.get $vsec
                i64.mul
                local.get $rhat
                i64.const 32
                i64.shl
                local.get $un
                local.get $j
                local.get $n
                i32.add
                i32.const 2
                i32.sub
                array.get $u32s
                i64.extend_i32_u
                i64.or
                i64.gt_u
              end
              i32.eqz
              br_if 1
              local.get $qhat
              i64.const 1
              i64.sub
              local.set $qhat
              local.get $rhat
              local.get $vtop
              i64.add
              local.tee $rhat
              i64.const 4294967296
              i64.lt_u
              br_if 0
            end
          end
          ;; D4: multiply and subtract.
          i64.const 0
          local.set $k
          i32.const 0
          local.set $i
          block void
            loop void
              local.get $i
              local.get $n
              i32.ge_u
              br_if 1
              local.get $qhat
              local.get $vn
              local.get $i
              array.get $u32s
              i64.extend_i32_u
              i64.mul
              local.set $p
              local.get $un
              local.get $i
              local.get $j
              i32.add
              array.get $u32s
              i64.extend_i32_u
              local.get $k
              i64.sub
              local.get $p
              i64.const 4294967295
              i64.and
              i64.sub
              local.set $t
              local.get $un
              local.get $i
              local.get $j
              i32.add
              local.get $t
              i32.wrap_i64
              array.set $u32s
              local.get $p
              i64.const 32
              i64.shr_u
              local.get $t
              i64.const 32
              i64.shr_s
              i64.sub
              local.set $k
              local.get $i
              i32.const 1
              i32.add
              local.set $i
              br 0
            end
          end
          local.get $un
          local.get $j
          local.get $n
          i32.add
          array.get $u32s
          i64.extend_i32_u
          local.get $k
          i64.sub
          local.set $t
          local.get $un
          local.get $j
          local.get $n
          i32.add
          local.get $t
          i32.wrap_i64
          array.set $u32s
          local.get $q
          local.get $j
          local.get $qhat
          i32.wrap_i64
          array.set $u32s
          ;; D6: q̂ was one too many (rarely): add v back.
          local.get $t
          i64.const 0
          i64.lt_s
          if void
            local.get $q
            local.get $j
            local.get $qhat
            i32.wrap_i64
            i32.const 1
            i32.sub
            array.set $u32s
            i64.const 0
            local.set $k
            i32.const 0
            local.set $i
            block void
              loop void
                local.get $i
                local.get $n
                i32.ge_u
                br_if 1
                local.get $un
                local.get $i
                local.get $j
                i32.add
                array.get $u32s
                i64.extend_i32_u
                local.get $vn
                local.get $i
                array.get $u32s
                i64.extend_i32_u
                i64.add
                local.get $k
                i64.add
                local.set $t
                local.get $un
                local.get $i
                local.get $j
                i32.add
                local.get $t
                i32.wrap_i64
                array.set $u32s
                local.get $t
                i64.const 32
                i64.shr_u
                local.set $k
                local.get $i
                i32.const 1
                i32.add
                local.set $i
                br 0
              end
            end
            local.get $un
            local.get $j
            local.get $n
            i32.add
            local.get $un
            local.get $j
            local.get $n
            i32.add
            array.get $u32s
            local.get $k
            i32.wrap_i64
            i32.add
            array.set $u32s
          end
          local.get $j
          i32.const 1
          i32.sub
          local.set $j
          br 0
        end
      end
      local.get $rem
      i32.eqz
      if void
        local.get $q
        call $mag.trim
        return
      end
      ;; D8: the remainder is un shifted back right by s.
      local.get $n
      array.new_default $u32s
      local.set $r
      i32.const 0
      local.set $i
      block void
        loop void
          local.get $i
          local.get $n
          i32.ge_u
          br_if 1
          local.get $r
          local.get $i
          local.get $un
          local.get $i
          i32.const 1
          i32.add
          call $mag.at
          i64.const 32
          i64.shl
          local.get $un
          local.get $i
          call $mag.at
          i64.or
          local.get $s
          i64.extend_i32_u
          i64.shr_u
          i32.wrap_i64
          array.set $u32s
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br 0
        end
      end
      local.get $r
      call $mag.trim`,
  },
  // a·m + c, for small m and c (unsigned).
  "mag.muladd": {
    params: [["a", "mag"], ["m", "i32"], ["c", "i32"]], result: "mag", locals: [["n", "i32"], ["i", "i32"], ["r", "mag"], ["carry", "i64"], ["t", "i64"]], uses: ["mag.trim"],
    body: `
      local.get $c
      i64.extend_i32_u
      local.set $carry
      local.get $a
      array.len
      local.tee $n
      i32.const 1
      i32.add
      array.new_default $u32s
      local.set $r
      block void
        loop void
          local.get $i
          local.get $n
          i32.ge_u
          br_if 1
          local.get $a
          local.get $i
          array.get $u32s
          i64.extend_i32_u
          local.get $m
          i64.extend_i32_u
          i64.mul
          local.get $carry
          i64.add
          local.set $t
          local.get $r
          local.get $i
          local.get $t
          i32.wrap_i64
          array.set $u32s
          local.get $t
          i64.const 32
          i64.shr_u
          local.set $carry
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br 0
        end
      end
      local.get $r
      local.get $n
      local.get $carry
      i32.wrap_i64
      array.set $u32s
      local.get $r
      call $mag.trim`,
  },
  // a · 2^k.
  "mag.shl": {
    params: [["a", "mag"], ["k", "i32"]], result: "mag", locals: [["n", "i32"], ["w", "i32"], ["i", "i32"], ["r", "mag"], ["v", "i64"]], uses: ["mag.trim"],
    body: `
      local.get $k
      i32.const 5
      i32.shr_u
      local.set $w
      local.get $a
      array.len
      local.tee $n
      local.get $w
      i32.add
      i32.const 1
      i32.add
      array.new_default $u32s
      local.set $r
      block void
        loop void
          local.get $i
          local.get $n
          i32.ge_u
          br_if 1
          local.get $a
          local.get $i
          array.get $u32s
          i64.extend_i32_u
          local.get $k
          i32.const 31
          i32.and
          i64.extend_i32_u
          i64.shl
          local.set $v
          local.get $r
          local.get $i
          local.get $w
          i32.add
          local.get $r
          local.get $i
          local.get $w
          i32.add
          array.get $u32s
          local.get $v
          i32.wrap_i64
          i32.or
          array.set $u32s
          local.get $r
          local.get $i
          local.get $w
          i32.add
          i32.const 1
          i32.add
          local.get $v
          i64.const 32
          i64.shr_u
          i32.wrap_i64
          array.set $u32s
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br 0
        end
      end
      local.get $r
      call $mag.trim`,
  },
  // The Float64 nearest a (ties to even, Infinity past the largest), as
  // JavaScript's Number of a BigInt: its top 64 bits, any bit below
  // kept as the last one, rounded once, then scaled by a power of two.
  "mag.toNumber": {
    params: [["a", "mag"]], result: "f64", locals: [["n", "i32"], ["lz", "i32"], ["i", "i32"], ["top", "i64"], ["lo", "i64"], ["e", "i32"]], uses: ["mag.at"],
    body: `
      local.get $a
      array.len
      local.tee $n
      i32.const 2
      i32.le_u
      if void
        local.get $a
        i32.const 0
        call $mag.at
        local.get $a
        i32.const 1
        call $mag.at
        i64.const 32
        i64.shl
        i64.or
        f64.convert_i64_u
        return
      end
      local.get $a
      local.get $n
      i32.const 1
      i32.sub
      array.get $u32s
      i32.clz
      local.set $lz
      local.get $a
      local.get $n
      i32.const 3
      i32.sub
      call $mag.at
      local.set $lo
      local.get $a
      local.get $n
      i32.const 1
      i32.sub
      call $mag.at
      local.get $lz
      i32.const 32
      i32.add
      i64.extend_i32_u
      i64.shl
      local.get $a
      local.get $n
      i32.const 2
      i32.sub
      call $mag.at
      local.get $lz
      i64.extend_i32_u
      i64.shl
      i64.or
      local.get $lo
      i32.const 32
      local.get $lz
      i32.sub
      i64.extend_i32_u
      i64.shr_u
      i64.or
      local.set $top
      ;; the bits below the top 64: those of lo, and every lower limb
      local.get $lo
      i64.const 1
      i32.const 32
      local.get $lz
      i32.sub
      i64.extend_i32_u
      i64.shl
      i64.const 1
      i64.sub
      i64.and
      i64.eqz
      i32.eqz
      local.set $i
      block void
        loop void
          local.get $i
          br_if 1
          local.get $e
          local.get $n
          i32.const 3
          i32.sub
          i32.ge_u
          br_if 1
          local.get $a
          local.get $e
          array.get $u32s
          i32.const 0
          i32.ne
          local.set $i
          local.get $e
          i32.const 1
          i32.add
          local.set $e
          br 0
        end
      end
      local.get $top
      local.get $i
      i64.extend_i32_u
      i64.or
      f64.convert_i64_u
      local.get $n
      i32.const 5
      i32.shl
      local.get $lz
      i32.sub
      i32.const 64
      i32.sub
      local.tee $e
      i32.const 1023
      i32.gt_s
      if f64
        f64.const 1e308
        f64.const 10
        f64.mul
      else
        local.get $e
        i32.const 1023
        i32.add
        i64.extend_i32_u
        i64.const 52
        i64.shl
        f64.reinterpret_i64
      end
      f64.mul`,
  },
  // a's digits, 10⁹ at a time from the end.
  "mag.show": {
    params: [["a", "mag"]], result: "text", locals: [["m", "mag"], ["c", "i32"], ["out", "text"], ["s", "text"]], uses: ["mag.modsmall", "mag.divsmall", "int64.show", "text.concat"],
    body: `
      local.get $a
      local.set $m
      i32.const 0
      array.new_default $bytes
      local.set $out
      block void
        loop void
          local.get $m
          i32.const 1000000000
          call $mag.modsmall
          local.set $c
          local.get $m
          i32.const 1000000000
          call $mag.divsmall
          local.set $m
          local.get $c
          i64.extend_i32_u
          call $int64.show
          local.set $s
          local.get $m
          array.len
          i32.eqz
          if void
            local.get $s
            local.get $out
            call $text.concat
            local.set $out
            br 2
          end
          i32.const 48
          i32.const 9
          local.get $s
          array.len
          i32.sub
          array.new $bytes
          local.get $s
          call $text.concat
          local.get $out
          call $text.concat
          local.set $out
          br 0
        end
      end
      local.get $out`,
  },
  // Whether x is below 0, and its magnitude.
  "int.negative": {
    params: [["x", "int"]], result: "i32", locals: [], uses: [], native: true,
    body: `
      local.get $x
      ref.test i31
      if i32
        local.get $x
        ref.cast i31
        i31.get_s
        i32.const 0
        i32.lt_s
      else
        local.get $x
        ref.test $big
        if i32
          local.get $x
          ref.cast $big
          struct.get $big 0
          i64.const 0
          i64.lt_s
        else
          local.get $x
          ref.cast $huge
          struct.get $huge 0
        end
      end`,
  },
  "int.mag": {
    params: [["x", "int"]], result: "mag", locals: [["v", "i64"]], uses: ["int.small", "mag.of"], native: true,
    body: `
      local.get $x
      ref.test $huge
      if mag
        local.get $x
        ref.cast $huge
        struct.get $huge 1
      else
        local.get $x
        call $int.small
        local.tee $v
        i64.const 0
        i64.lt_s
        if i64
          i64.const 0
          local.get $v
          i64.sub
        else
          local.get $v
        end
        call $mag.of
      end`,
  },
  // The Int with this sign and magnitude, in its one form.
  "int.norm": {
    params: [["neg", "i32"], ["m", "mag"]], result: "int", locals: [["u", "i64"]], uses: ["mag.at", "int.of"], native: true,
    body: `
      local.get $m
      array.len
      i32.const 2
      i32.le_u
      if void
        local.get $m
        i32.const 0
        call $mag.at
        local.get $m
        i32.const 1
        call $mag.at
        i64.const 32
        i64.shl
        i64.or
        local.set $u
        local.get $neg
        if void
          local.get $u
          i64.const -9223372036854775808
          i64.le_u
          if void
            i64.const 0
            local.get $u
            i64.sub
            call $int.of
            return
          end
        else
          local.get $u
          i64.const 0
          i64.ge_s
          if void
            local.get $u
            call $int.of
            return
          end
        end
      end
      local.get $neg
      local.get $m
      struct.new $huge`,
  },
  // Sign and magnitude plus sign and magnitude.
  "int.addsm": {
    params: [["na", "i32"], ["ma", "mag"], ["nb", "i32"], ["mb", "mag"]], result: "int", locals: [["c", "i32"]], uses: ["mag.add", "mag.sub", "mag.cmp", "int.norm"], native: true,
    body: `
      local.get $na
      local.get $nb
      i32.eq
      if void
        local.get $na
        local.get $ma
        local.get $mb
        call $mag.add
        call $int.norm
        return
      end
      local.get $ma
      local.get $mb
      call $mag.cmp
      local.tee $c
      i32.eqz
      if void
        i32.const 0
        ref.i31
        return
      end
      local.get $c
      i32.const 0
      i32.gt_s
      if int
        local.get $na
        local.get $ma
        local.get $mb
        call $mag.sub
        call $int.norm
      else
        local.get $nb
        local.get $mb
        local.get $ma
        call $mag.sub
        call $int.norm
      end`,
  },
  "int.add": {
    params: [["a", "int"], ["b", "int"]], result: "int", locals: [["x", "i64"], ["y", "i64"], ["r", "i64"]], uses: ["int.small", "int.of", "int.negative", "int.mag", "int.addsm"], native: true,
    body: `
      local.get $a
      ref.test $huge
      local.get $b
      ref.test $huge
      i32.or
      i32.eqz
      if void
        local.get $a
        call $int.small
        local.tee $x
        local.get $b
        call $int.small
        local.tee $y
        i64.add
        local.set $r
        ;; no overflow: the answer has the sign of one of them
        local.get $x
        local.get $r
        i64.xor
        local.get $y
        local.get $r
        i64.xor
        i64.and
        i64.const 0
        i64.ge_s
        if void
          local.get $r
          call $int.of
          return
        end
      end
      local.get $a
      call $int.negative
      local.get $a
      call $int.mag
      local.get $b
      call $int.negative
      local.get $b
      call $int.mag
      call $int.addsm`,
  },
  "int.sub": {
    params: [["a", "int"], ["b", "int"]], result: "int", locals: [["x", "i64"], ["y", "i64"], ["r", "i64"]], uses: ["int.small", "int.of", "int.negative", "int.mag", "int.addsm"], native: true,
    body: `
      local.get $a
      ref.test $huge
      local.get $b
      ref.test $huge
      i32.or
      i32.eqz
      if void
        local.get $a
        call $int.small
        local.tee $x
        local.get $b
        call $int.small
        local.tee $y
        i64.sub
        local.set $r
        local.get $x
        local.get $y
        i64.xor
        local.get $x
        local.get $r
        i64.xor
        i64.and
        i64.const 0
        i64.ge_s
        if void
          local.get $r
          call $int.of
          return
        end
      end
      local.get $a
      call $int.negative
      local.get $a
      call $int.mag
      local.get $b
      call $int.negative
      i32.eqz
      local.get $b
      call $int.mag
      call $int.addsm`,
  },
  "int.mul": {
    params: [["a", "int"], ["b", "int"]], result: "int", locals: [], uses: ["int.small", "int.of", "int.negative", "int.mag", "mag.mul", "int.norm"], native: true,
    body: `
      local.get $a
      ref.test i31
      local.get $b
      ref.test i31
      i32.and
      if void
        local.get $a
        call $int.small
        local.get $b
        call $int.small
        i64.mul
        call $int.of
        return
      end
      local.get $a
      call $int.negative
      local.get $b
      call $int.negative
      i32.xor
      local.get $a
      call $int.mag
      local.get $b
      call $int.mag
      call $mag.mul
      call $int.norm`,
  },
  "int.neg": {
    params: [["a", "int"]], result: "int", locals: [["x", "i64"]], uses: ["int.small", "int.of", "int.norm", "mag.of"], native: true,
    body: `
      local.get $a
      ref.test $huge
      if int
        local.get $a
        ref.cast $huge
        struct.get $huge 0
        i32.eqz
        local.get $a
        ref.cast $huge
        struct.get $huge 1
        call $int.norm
      else
        local.get $a
        call $int.small
        local.tee $x
        i64.const -9223372036854775808
        i64.eq
        if int
          i32.const 0
          local.get $x
          call $mag.of
          struct.new $huge
        else
          i64.const 0
          local.get $x
          i64.sub
          call $int.of
        end
      end`,
  },
  "int.abs": {
    params: [["a", "int"]], result: "int", locals: [], uses: ["int.negative", "int.neg"], native: true,
    body: `
      local.get $a
      call $int.negative
      if int
        local.get $a
        call $int.neg
      else
        local.get $a
      end`,
  },
  "int.less": {
    params: [["a", "int"], ["b", "int"]], result: "i32", locals: [["na", "i32"], ["nb", "i32"], ["c", "i32"]], uses: ["int.small", "int.negative", "int.mag", "mag.cmp"], native: true,
    body: `
      local.get $a
      ref.test $huge
      local.get $b
      ref.test $huge
      i32.or
      i32.eqz
      if void
        local.get $a
        call $int.small
        local.get $b
        call $int.small
        i64.lt_s
        return
      end
      local.get $a
      call $int.negative
      local.tee $na
      local.get $b
      call $int.negative
      local.tee $nb
      i32.ne
      if void
        local.get $na
        return
      end
      local.get $a
      call $int.mag
      local.get $b
      call $int.mag
      call $mag.cmp
      local.set $c
      local.get $na
      if i32
        local.get $c
        i32.const 0
        i32.gt_s
      else
        local.get $c
        i32.const 0
        i32.lt_s
      end`,
  },
  "int.equal": {
    params: [["a", "int"], ["b", "int"]], result: "i32", locals: [], uses: ["int.small", "int.negative", "int.mag", "mag.cmp"], native: true,
    body: `
      local.get $a
      ref.test $huge
      local.get $b
      ref.test $huge
      i32.or
      i32.eqz
      if void
        local.get $a
        call $int.small
        local.get $b
        call $int.small
        i64.eq
        return
      end
      local.get $a
      call $int.negative
      local.get $b
      call $int.negative
      i32.eq
      local.get $a
      call $int.mag
      local.get $b
      call $int.mag
      call $mag.cmp
      i32.eqz
      i32.and`,
  },
  "int.toNumber": {
    params: [["a", "int"]], result: "f64", locals: [], uses: ["int.small", "int.mag", "mag.toNumber"], native: true,
    body: `
      local.get $a
      ref.test $huge
      if f64
        local.get $a
        call $int.mag
        call $mag.toNumber
        f64.const -1
        f64.const 1
        local.get $a
        ref.cast $huge
        struct.get $huge 0
        select
        f64.mul
      else
        local.get $a
        call $int.small
        f64.convert_i64_s
      end`,
  },
  "int.show": {
    params: [["a", "int"]], result: "text", locals: [], uses: ["int.small", "int64.show", "mag.show", "text.concat"], native: true,
    body: `
      local.get $a
      ref.test $huge
      if text
        local.get $a
        ref.cast $huge
        struct.get $huge 0
        if text
          i32.const 45
          array.new_fixed $bytes 1
        else
          i32.const 0
          array.new_default $bytes
        end
        local.get $a
        ref.cast $huge
        struct.get $huge 1
        call $mag.show
        call $text.concat
      else
        local.get $a
        call $int.small
        call $int64.show
      end`,
  },
  // The whole part of x, past 2⁶³ from its bits: its significand moved up.
  "int.wholePart": {
    params: [["x", "f64"]], result: "int", locals: [["y", "f64"], ["bits", "i64"], ["st", "i32"]], uses: ["int64.wholePart", "int.of", "mag.of", "mag.shl", "int.norm"], partial: true, native: true,
    body: `
      local.get $x
      f64.floor
      local.tee $y
      f64.abs
      f64.const 9.2e18
      f64.ge
      local.get $y
      local.get $y
      f64.sub
      f64.const 0
      f64.eq
      i32.and
      if void
        local.get $y
        f64.const 0
        f64.lt
        local.get $y
        i64.reinterpret_f64
        local.tee $bits
        i64.const 4503599627370495
        i64.and
        i64.const 4503599627370496
        i64.or
        call $mag.of
        local.get $bits
        i64.const 52
        i64.shr_u
        i32.wrap_i64
        i32.const 2047
        i32.and
        i32.const 1075
        i32.sub
        call $mag.shl
        call $int.norm
        i32.const 0
        return
      end
      local.get $x
      call $int64.wholePart
      local.set $st
      call $int.of
      local.get $st`,
  },
  // Up to 18 digits as an i64; more, 32 bits at a time.
  "int.read": {
    params: [["t", "text"]], result: "int", locals: [["i", "i32"], ["n", "i32"], ["neg", "i32"], ["c", "i32"], ["m", "mag"], ["st", "i32"]], uses: ["int64.read", "int.of", "mag.muladd", "int.norm"], partial: true, native: true,
    body: `
      local.get $t
      array.len
      local.set $n
      local.get $n
      if void
        local.get $t
        i32.const 0
        array.get_u $bytes
        i32.const 45
        i32.eq
        local.set $neg
      end
      local.get $n
      local.get $neg
      i32.sub
      i32.const 18
      i32.le_u
      if void
        local.get $t
        call $int64.read
        local.set $st
        call $int.of
        local.get $st
        return
      end
      local.get $neg
      local.set $i
      ;; no zeros in front
      local.get $t
      local.get $i
      array.get_u $bytes
      i32.const 48
      i32.eq
      if void
        ref.null eq
        i32.const 1
        return
      end
      i32.const 0
      array.new_default $u32s
      local.set $m
      block void
        loop void
          local.get $i
          local.get $n
          i32.ge_u
          br_if 1
          local.get $t
          local.get $i
          array.get_u $bytes
          i32.const 48
          i32.sub
          local.tee $c
          i32.const 9
          i32.gt_u
          if void
            ref.null eq
            i32.const 1
            return
          end
          local.get $m
          i32.const 10
          local.get $c
          call $mag.muladd
          local.set $m
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br 0
        end
      end
      local.get $neg
      local.get $m
      call $int.norm
      i32.const 0`,
  },
  // An Int from an i64, and back: an i31 while it fits in 31 bits, else a
  // $big holding the i64 (a $huge has its own, int.norm).
  "int.of": {
    params: [["v", "i64"]], result: "int", locals: [], uses: [], native: true,
    body: `
      local.get $v
      i64.const 1073741824
      i64.add
      i64.const 2147483648
      i64.lt_u
      if int
        local.get $v
        i32.wrap_i64
        ref.i31
      else
        local.get $v
        struct.new $big
      end`,
  },
  "int.small": {
    params: [["x", "int"]], result: "i64", locals: [], uses: [], native: true,
    body: `
      local.get $x
      ref.test i31
      if i64
        local.get $x
        ref.cast i31
        i31.get_s
        i64.extend_i32_s
      else
        local.get $x
        ref.cast $big
        struct.get $big 0
      end`,
  },
  // The host's way to a $huge, which doesn't fit Int.get's i64: its limb
  // count, negative when it's negative (0 when it isn't a $huge), and its
  // limbs; and to make one, limb by limb, least significant first.
  "int.limbs": {
    params: [["x", "int"]], result: "i32", locals: [["n", "i32"]], uses: [], native: true,
    body: `
      local.get $x
      ref.test $huge
      if i32
        local.get $x
        ref.cast $huge
        struct.get $huge 1
        array.len
        local.set $n
        i32.const 0
        local.get $n
        i32.sub
        local.get $n
        local.get $x
        ref.cast $huge
        struct.get $huge 0
        select
      else
        i32.const 0
      end`,
  },
  "int.limb": {
    params: [["x", "int"], ["i", "i32"]], result: "i32", locals: [], uses: [], native: true,
    body: `
      local.get $x
      ref.cast $huge
      struct.get $huge 1
      local.get $i
      array.get $u32s`,
  },
  "int.huge": {
    params: [["neg", "i32"], ["n", "i32"]], result: "int", locals: [], uses: [], native: true,
    body: `
      local.get $neg
      local.get $n
      array.new_default $u32s
      struct.new $huge`,
  },
  "int.setLimb": {
    params: [["x", "int"], ["i", "i32"], ["v", "i32"]], result: "void", locals: [], uses: [], native: true,
    body: `
      local.get $x
      ref.cast $huge
      struct.get $huge 1
      local.get $i
      local.get $v
      array.set $u32s`,
  },
  // std.ts's show of a Float64: a whole number as its digits, any other
  // rounded to 9 places, written as JavaScript writes it: plain decimals
  // of at most 15 digits directly (which is then exactly what JavaScript
  // writes), otherwise by number.js.
  "number.show": {
    params: [["x", "f64"]], result: "text", locals: [["y", "f64"], ["r", "f64"], ["n", "i64"], ["m", "i64"], ["f", "i64"], ["buf", "text"], ["i", "i32"], ["out", "text"], ["y_text", "text"]],
    uses: ["int64.show", "text.concat", "number.js", "number.tiny"],
    body: `
      local.get $x
      f64.floor
      local.get $x
      f64.eq
      if void
        local.get $x
        f64.abs
        f64.const 9007199254740992
        f64.lt
        if void
          local.get $x
          i64.trunc_f64_s
          call $int64.show
          return
        end
        local.get $x
        call $number.js
        return
      end
      local.get $x
      local.get $x
      f64.ne
      if void
        local.get $x
        call $number.js
        return
      end
      ;; Math.round(x·1e9): ties toward +∞
      local.get $x
      f64.const 1e9
      f64.mul
      local.tee $y
      f64.floor
      local.set $r
      local.get $y
      local.get $r
      f64.sub
      f64.const 0.5
      f64.ge
      if void
        local.get $r
        f64.const 1
        f64.add
        local.set $r
      end
      local.get $r
      f64.abs
      f64.const 9.2e18
      f64.ge
      if void
        local.get $r
        f64.const 1e9
        f64.div
        call $number.js
        return
      end
      ;; below 1e-6 (and not 0), JavaScript writes 5.5e-7
      local.get $r
      f64.abs
      f64.const 1000
      f64.lt
      local.get $r
      f64.const 0
      f64.ne
      i32.and
      if void
        local.get $r
        call $number.tiny
        return
      end
      ;; rounded to 0 (x below 5e-10)
      local.get $r
      f64.const 0
      f64.eq
      if void
        i64.const 0
        call $int64.show
        return
      end
      ;; more than 15 digits after the zeros at the end go: JavaScript's
      ;; shortest form may have fewer
      local.get $r
      f64.abs
      i64.trunc_f64_s
      local.set $m
      block void
        loop void
          local.get $m
          i64.const 10
          i64.rem_u
          i64.const 0
          i64.ne
          br_if 1
          local.get $m
          i64.const 10
          i64.div_u
          local.set $m
          br 0
        end
      end
      local.get $m
      i64.const 1000000000000000
      i64.ge_u
      if void
        local.get $r
        f64.const 1e9
        f64.div
        call $number.js
        return
      end
      local.get $r
      i64.trunc_f64_s
      local.tee $n
      i64.const 0
      i64.lt_s
      if i64
        i64.const 0
        local.get $n
        i64.sub
      else
        local.get $n
      end
      local.tee $m
      i64.const 1000000000
      i64.rem_u
      local.set $f
      ;; the whole part, with its sign
      local.get $n
      i64.const 0
      i64.lt_s
      if text
        i32.const 45
        array.new_fixed $bytes 1
      else
        i32.const 0
        array.new_default $bytes
      end
      local.get $m
      i64.const 1000000000
      i64.div_u
      call $int64.show
      call $text.concat
      local.set $out
      local.get $f
      i64.eqz
      if void
        local.get $out
        return
      end
      ;; "." and nine digits, without the zeros at the end
      i32.const 10
      array.new_default $bytes
      local.set $buf
      local.get $buf
      i32.const 0
      i32.const 46
      array.set $bytes
      i32.const 10
      local.set $i
      loop void
        local.get $i
        i32.const 1
        i32.sub
        local.set $i
        local.get $buf
        local.get $i
        local.get $f
        i64.const 10
        i64.rem_u
        i32.wrap_i64
        i32.const 48
        i32.add
        array.set $bytes
        local.get $f
        i64.const 10
        i64.div_u
        local.set $f
        local.get $i
        i32.const 1
        i32.gt_u
        br_if 0
      end
      i32.const 10
      local.set $i
      block void
      loop void
        local.get $buf
        local.get $i
        i32.const 1
        i32.sub
        array.get_u $bytes
        i32.const 48
        i32.ne
        br_if 1
        local.get $i
        i32.const 1
        i32.sub
        local.set $i
        br 0
      end
      end
      local.get $i
      array.new_default $bytes
      local.set $y_text
      local.get $y_text
      i32.const 0
      local.get $buf
      i32.const 0
      local.get $i
      array.copy $bytes $bytes
      local.get $out
      local.get $y_text
      call $text.concat`,
  },
  // r·10⁻⁹ for a whole r of 1 to 999 (and its sign), as JavaScript writes
  // it: r's digits without the zeros at the end, a point after the first,
  // then e-7, e-8 or e-9.
  "number.tiny": {
    params: [["r", "f64"]], result: "text", locals: [["d", "text"], ["n", "i32"], ["out", "text"], ["part", "text"]], uses: ["int64.show", "text.concat"],
    body: `
      local.get $r
      f64.abs
      i64.trunc_f64_s
      call $int64.show
      local.tee $d
      array.len
      local.set $n
      block void
        loop void
          local.get $d
          local.get $n
          i32.const 1
          i32.sub
          array.get_u $bytes
          i32.const 48
          i32.ne
          br_if 1
          local.get $n
          i32.const 1
          i32.sub
          local.set $n
          br 0
        end
      end
      local.get $r
      f64.const 0
      f64.lt
      if text
        i32.const 45
        array.new_fixed $bytes 1
      else
        i32.const 0
        array.new_default $bytes
      end
      local.get $d
      i32.const 0
      array.get_u $bytes
      array.new_fixed $bytes 1
      call $text.concat
      local.set $out
      local.get $n
      i32.const 1
      i32.gt_u
      if void
        local.get $n
        array.new_default $bytes
        local.tee $part
        i32.const 0
        i32.const 46
        array.set $bytes
        local.get $part
        i32.const 1
        local.get $d
        i32.const 1
        local.get $n
        i32.const 1
        i32.sub
        array.copy $bytes $bytes
        local.get $out
        local.get $part
        call $text.concat
        local.set $out
      end
      local.get $out
      i32.const 101
      i32.const 45
      i32.const 58
      local.get $d
      array.len
      i32.sub
      array.new_fixed $bytes 3
      call $text.concat`,
  },
  // IEEE remainder of x by y with x's sign, which is JavaScript's x % y
  // and WebAssembly lacks: adapted from musl's fmod (src/math/fmod.c, MIT
  // licence), shifting y's significand along x's, so it's exact.
  "number.fmod": {
    params: [["x", "f64"], ["y", "f64"]], result: "f64", locals: [["ux", "i64"], ["uy", "i64"], ["ex", "i64"], ["ey", "i64"], ["sx", "i64"], ["i", "i64"]], uses: [],
    body: `
      local.get $x
      i64.reinterpret_f64
      local.tee $ux
      i64.const 52
      i64.shr_u
      i64.const 2047
      i64.and
      local.set $ex
      local.get $y
      i64.reinterpret_f64
      local.tee $uy
      i64.const 52
      i64.shr_u
      i64.const 2047
      i64.and
      local.set $ey
      local.get $ux
      i64.const 63
      i64.shr_u
      local.set $sx
      ;; y zero or NaN, or x infinite or NaN: NaN
      local.get $uy
      i64.const 1
      i64.shl
      i64.eqz
      local.get $y
      local.get $y
      f64.ne
      i32.or
      local.get $ex
      i64.const 2047
      i64.eq
      i32.or
      if void
        local.get $x
        local.get $y
        f64.mul
        local.get $x
        local.get $y
        f64.mul
        f64.div
        return
      end
      ;; |x| <= |y|
      local.get $ux
      i64.const 1
      i64.shl
      local.get $uy
      i64.const 1
      i64.shl
      i64.le_u
      if void
        local.get $ux
        i64.const 1
        i64.shl
        local.get $uy
        i64.const 1
        i64.shl
        i64.eq
        if void
          f64.const 0
          local.get $x
          f64.mul
          return
        end
        local.get $x
        return
      end
      ;; the significands, normalized
      local.get $ex
      i64.eqz
      if void
        local.get $ux
        i64.const 12
        i64.shl
        local.set $i
        block void
          loop void
            local.get $i
            i64.const 63
            i64.shr_u
            i64.eqz
            i32.eqz
            br_if 1
            local.get $ex
            i64.const 1
            i64.sub
            local.set $ex
            local.get $i
            i64.const 1
            i64.shl
            local.set $i
            br 0
          end
        end
        local.get $ux
        i64.const 1
        local.get $ex
        i64.sub
        i64.shl
        local.set $ux
      else
        local.get $ux
        i64.const 4503599627370495
        i64.and
        i64.const 4503599627370496
        i64.or
        local.set $ux
      end
      local.get $ey
      i64.eqz
      if void
        local.get $uy
        i64.const 12
        i64.shl
        local.set $i
        block void
          loop void
            local.get $i
            i64.const 63
            i64.shr_u
            i64.eqz
            i32.eqz
            br_if 1
            local.get $ey
            i64.const 1
            i64.sub
            local.set $ey
            local.get $i
            i64.const 1
            i64.shl
            local.set $i
            br 0
          end
        end
        local.get $uy
        i64.const 1
        local.get $ey
        i64.sub
        i64.shl
        local.set $uy
      else
        local.get $uy
        i64.const 4503599627370495
        i64.and
        i64.const 4503599627370496
        i64.or
        local.set $uy
      end
      ;; x mod y, a bit at a time
      block void
        loop void
          local.get $ex
          local.get $ey
          i64.gt_s
          i32.eqz
          br_if 1
          local.get $ux
          local.get $uy
          i64.sub
          local.tee $i
          i64.const 63
          i64.shr_u
          i64.eqz
          if void
            local.get $i
            i64.eqz
            if void
              f64.const 0
              local.get $x
              f64.mul
              return
            end
            local.get $i
            local.set $ux
          end
          local.get $ux
          i64.const 1
          i64.shl
          local.set $ux
          local.get $ex
          i64.const 1
          i64.sub
          local.set $ex
          br 0
        end
      end
      local.get $ux
      local.get $uy
      i64.sub
      local.tee $i
      i64.const 63
      i64.shr_u
      i64.eqz
      if void
        local.get $i
        i64.eqz
        if void
          f64.const 0
          local.get $x
          f64.mul
          return
        end
        local.get $i
        local.set $ux
      end
      block void
        loop void
          local.get $ux
          i64.const 52
          i64.shr_u
          i64.eqz
          i32.eqz
          br_if 1
          local.get $ux
          i64.const 1
          i64.shl
          local.set $ux
          local.get $ex
          i64.const 1
          i64.sub
          local.set $ex
          br 0
        end
      end
      ;; scaled back, with x's sign
      local.get $ex
      i64.const 0
      i64.gt_s
      if i64
        local.get $ux
        i64.const 4503599627370496
        i64.sub
        local.get $ex
        i64.const 52
        i64.shl
        i64.or
      else
        local.get $ux
        i64.const 1
        local.get $ex
        i64.sub
        i64.shr_u
      end
      local.get $sx
      i64.const 63
      i64.shl
      i64.or
      f64.reinterpret_i64`,
  },
  // std.ts's mod: ((a % b) + b) % b, the remainder with b's sign.
  "number.mod": {
    params: [["a", "f64"], ["b", "f64"]], result: "f64", locals: [], uses: ["number.fmod"],
    body: "local.get $a\nlocal.get $b\ncall $number.fmod\nlocal.get $b\nf64.add\nlocal.get $b\ncall $number.fmod",
  },
  // For the host, which can't make or read an array itself: a text of n
  // bytes to fill, filling one, and reading one back.
  "text.new": { params: [["n", "i32"]], result: "text", locals: [], uses: [], body: "local.get $n\narray.new_default $bytes" },
  "text.put": { params: [["t", "text"], ["i", "i32"], ["b", "i32"]], result: "i32", locals: [], uses: [], body: "local.get $t\nlocal.get $i\nlocal.get $b\narray.set $bytes\ni32.const 0" },
  // Where the character that ends at byte i (> 0) starts: back over
  // UTF-8's continuation bytes (10xxxxxx).
  "text.before": {
    params: [["t", "text"], ["i", "i32"]], result: "i32", locals: [], uses: [],
    body: `
      block void
        loop void
          local.get $i
          i32.const 1
          i32.sub
          local.set $i
          local.get $i
          i32.eqz
          br_if 1
          local.get $t
          local.get $i
          array.get_u $bytes
          i32.const 192
          i32.and
          i32.const 128
          i32.eq
          br_if 0
        end
      end
      local.get $i`,
  },
  // Bytes i to i + 3 from w, low byte first (the host fills a text four at a time).
  "text.put4": {
    params: [["t", "text"], ["i", "i32"], ["w", "i32"]], result: "i32", locals: [], uses: [],
    body: [0, 1, 2, 3].map((k) => `local.get $t\nlocal.get $i\ni32.const ${k}\ni32.add\nlocal.get $w\ni32.const ${8 * k}\ni32.shr_u\narray.set $bytes`).join("\n") + "\ni32.const 0",
  },
  "text.size": { params: [["t", "text"]], result: "i32", locals: [], uses: [], body: "local.get $t\narray.len" },
  "text.byte": { params: [["t", "text"], ["i", "i32"]], result: "i32", locals: [], uses: [], body: "local.get $t\nlocal.get $i\narray.get_u $bytes" },
  // range(n): 0, 1, …, n − 1 (std.ts, run.ts), built from the end. Int's and Float64's.
  "int.range": {
    params: [["n", "int"]], result: "list", locals: [["acc", "list"]], uses: ["int.of"], list: "std.list<type.int<>>",
    body: `
      i32.const 0
      struct.new $list.nil
      local.set $acc
      block void
      loop void
        local.get $n
        i64.const 0
        i64.le_s
        br_if 1
        local.get $n
        i64.const 1
        i64.sub
        local.set $n
        i32.const 1
        local.get $n
        call $int.of
        local.get $acc
        struct.new $list.cons
        local.set $acc
        br 0
      end
      end
      local.get $acc`,
  },
  "number.range": {
    params: [["x", "f64"]], result: "list", locals: [["acc", "list"], ["i", "f64"]], uses: [], list: "std.list<type.number<>>",
    body: `
      i32.const 0
      struct.new $list.nil
      local.set $acc
      ;; Array.from({ length: n }): whole, at least 0 (NaN is 0)
      local.get $x
      f64.floor
      local.set $i
      block void
      loop void
        local.get $i
        f64.const 0
        f64.gt
        i32.eqz
        br_if 1
        local.get $i
        f64.const 1
        f64.sub
        local.set $i
        i32.const 1
        local.get $i
        local.get $acc
        struct.new $list.cons
        local.set $acc
        br 0
      end
      end
      local.get $acc`,
  },
  // characters(t): a List Text of its characters, built from the end.
  "text.characters": {
    params: [["t", "text"]], result: "list", locals: [["i", "i32"], ["end", "i32"], ["acc", "list"], ["c", "text"]], uses: [],
    body: `
      i32.const 0
      struct.new $list.nil
      local.set $acc
      local.get $t
      array.len
      local.tee $i
      local.set $end
      block void
      loop void
        local.get $i
        i32.eqz
        br_if 1
        local.get $i
        i32.const 1
        i32.sub
        local.set $i
        local.get $t
        local.get $i
        array.get_u $bytes
        i32.const 192
        i32.and
        i32.const 128
        i32.ne
        if void
          local.get $end
          local.get $i
          i32.sub
          array.new_default $bytes
          local.set $c
          local.get $c
          i32.const 0
          local.get $t
          local.get $i
          local.get $end
          local.get $i
          i32.sub
          array.copy $bytes $bytes
          i32.const 1
          local.get $c
          local.get $acc
          struct.new $list.cons
          local.set $acc
          local.get $i
          local.set $end
        end
        br 0
      end
      end
      local.get $acc`,
  },
  // split(t, by): JavaScript's, the pieces between the matches, left to
  // right without overlapping. The pieces are gathered newest first, then
  // turned around.
  "text.split": {
    params: [["t", "text"], ["by", "text"]], result: "list", locals: [["i", "i32"], ["j", "i32"], ["start", "i32"], ["n", "i32"], ["rev", "list"], ["acc", "list"], ["p", "text"]], uses: ["text.characters"],
    body: `
      local.get $by
      array.len
      local.tee $n
      i32.eqz
      if void
        local.get $t
        call $text.characters
        return
      end
      i32.const 0
      struct.new $list.nil
      local.set $rev
      block void
      loop void
        ;; does by match at i?
        local.get $i
        local.get $n
        i32.add
        local.get $t
        array.len
        i32.gt_u
        br_if 1
        i32.const 0
        local.set $j
        block void
        loop void
          local.get $j
          local.get $n
          i32.ge_u
          br_if 1
          local.get $t
          local.get $i
          local.get $j
          i32.add
          array.get_u $bytes
          local.get $by
          local.get $j
          array.get_u $bytes
          i32.ne
          br_if 1
          local.get $j
          i32.const 1
          i32.add
          local.set $j
          br 0
        end
        end
        local.get $j
        local.get $n
        i32.eq
        if void
          local.get $i
          local.get $start
          i32.sub
          array.new_default $bytes
          local.set $p
          local.get $p
          i32.const 0
          local.get $t
          local.get $start
          local.get $i
          local.get $start
          i32.sub
          array.copy $bytes $bytes
          i32.const 1
          local.get $p
          local.get $rev
          struct.new $list.cons
          local.set $rev
          local.get $i
          local.get $n
          i32.add
          local.tee $i
          local.set $start
        else
          local.get $i
          i32.const 1
          i32.add
          local.set $i
        end
        br 0
      end
      end
      ;; the last piece
      local.get $t
      array.len
      local.get $start
      i32.sub
      array.new_default $bytes
      local.set $p
      local.get $p
      i32.const 0
      local.get $t
      local.get $start
      local.get $t
      array.len
      local.get $start
      i32.sub
      array.copy $bytes $bytes
      i32.const 1
      local.get $p
      local.get $rev
      struct.new $list.cons
      local.set $rev
      ;; turned around
      i32.const 0
      struct.new $list.nil
      local.set $acc
      block void
      loop void
        local.get $rev
        struct.get $list 0
        i32.eqz
        br_if 1
        i32.const 1
        local.get $rev
        ref.cast $list.cons
        struct.get $list.cons 1
        local.get $acc
        struct.new $list.cons
        local.set $acc
        local.get $rev
        ref.cast $list.cons
        struct.get $list.cons 2
        local.set $rev
        br 0
      end
      end
      local.get $acc`,
  },
  // joinAll(parts, by): the parts with `by` between them; the length first.
  "text.joinAll": {
    params: [["l", "list"], ["by", "text"]], result: "text", locals: [["n", "i32"], ["k", "i32"], ["p", "list"], ["r", "text"], ["at", "i32"], ["x", "text"]], uses: [],
    body: `
      local.get $l
      local.set $p
      block void
      loop void
        local.get $p
        struct.get $list 0
        i32.eqz
        br_if 1
        local.get $p
        ref.cast $list.cons
        struct.get $list.cons 1
        array.len
        local.get $n
        i32.add
        local.set $n
        local.get $k
        i32.const 1
        i32.add
        local.set $k
        local.get $p
        ref.cast $list.cons
        struct.get $list.cons 2
        local.set $p
        br 0
      end
      end
      local.get $k
      i32.eqz
      if void
        i32.const 0
        array.new_default $bytes
        return
      end
      local.get $n
      local.get $k
      i32.const 1
      i32.sub
      local.get $by
      array.len
      i32.mul
      i32.add
      array.new_default $bytes
      local.set $r
      local.get $l
      local.set $p
      block void
      loop void
        local.get $p
        ref.cast $list.cons
        struct.get $list.cons 1
        local.set $x
        local.get $r
        local.get $at
        local.get $x
        i32.const 0
        local.get $x
        array.len
        array.copy $bytes $bytes
        local.get $at
        local.get $x
        array.len
        i32.add
        local.set $at
        local.get $p
        ref.cast $list.cons
        struct.get $list.cons 2
        local.tee $p
        struct.get $list 0
        i32.eqz
        br_if 1
        local.get $r
        local.get $at
        local.get $by
        i32.const 0
        local.get $by
        array.len
        array.copy $bytes $bytes
        local.get $at
        local.get $by
        array.len
        i32.add
        local.set $at
        br 0
      end
      end
      local.get $r`,
  },
  // ---- builtins with no answer or one: an answer and a status (0), or a
  // zero and 1. A Choice builtin's status is what wasm.ts branches on.
  // Rounding down, the remainder with the divisor's sign (int.ts).
  "int64.quotient": {
    params: [["a", "i64"], ["b", "i64"]], result: "i64", locals: [["q", "i64"], ["r", "i64"]], uses: [], partial: true,
    body: `
      local.get $b
      i64.eqz
      if void
        i64.const 0
        i32.const 1
        return
      end
      local.get $a
      local.get $b
      i64.div_s ;; the smallest i64 over -1 would trap: int.quotient takes the limbs
      local.set $q
      local.get $a
      local.get $b
      i64.rem_s
      local.tee $r
      i64.const 0
      i64.ne
      local.get $r
      local.get $b
      i64.xor
      i64.const 0
      i64.lt_s
      i32.and
      if void
        local.get $q
        i64.const 1
        i64.sub
        local.set $q
      end
      local.get $q
      i32.const 0`,
  },
  "int64.remainder": {
    params: [["a", "i64"], ["b", "i64"]], result: "i64", locals: [["r", "i64"]], uses: [], partial: true,
    body: `
      local.get $b
      i64.eqz
      if void
        i64.const 0
        i32.const 1
        return
      end
      local.get $a
      local.get $b
      i64.rem_s
      local.tee $r
      i64.const 0
      i64.ne
      local.get $r
      local.get $b
      i64.xor
      i64.const 0
      i64.lt_s
      i32.and
      if i64
        local.get $r
        local.get $b
        i64.add
      else
        local.get $r
      end
      i32.const 0`,
  },
  // Floor division (int.ts): the i64 way while both fit, but for the
  // smallest i64 over -1, else the limbs; with the signs apart and a
  // remainder, the quotient is one further down.
  "int.quotient": {
    params: [["a", "int"], ["b", "int"]], result: "int", locals: [["st", "i32"], ["na", "i32"], ["nb", "i32"], ["q", "mag"]], uses: ["int.small", "int.of", "int.negative", "int.mag", "int.norm", "int64.quotient", "mag.divrem", "mag.add", "mag.of"], native: true, partial: true,
    body: `
      local.get $a
      ref.test $huge
      local.get $b
      ref.test $huge
      i32.or
      i32.eqz
      if void
        local.get $a
        call $int.small
        i64.const -9223372036854775808
        i64.ne
        local.get $b
        call $int.small
        i64.const -1
        i64.ne
        i32.or
        if void
          local.get $a
          call $int.small
          local.get $b
          call $int.small
          call $int64.quotient
          local.set $st
          call $int.of
          local.get $st
          return
        end
      end
      local.get $a
      call $int.negative
      local.set $na
      local.get $b
      call $int.negative
      local.set $nb
      local.get $a
      call $int.mag
      local.get $b
      call $int.mag
      i32.const 0
      call $mag.divrem
      local.set $q
      local.get $na
      local.get $nb
      i32.ne
      if void
        local.get $a
        call $int.mag
        local.get $b
        call $int.mag
        i32.const 1
        call $mag.divrem
        array.len
        if void
          local.get $q
          i64.const 1
          call $mag.of
          call $mag.add
          local.set $q
        end
      end
      local.get $na
      local.get $nb
      i32.xor
      local.get $q
      call $int.norm
      i32.const 0`,
  },
  // The greatest common divisor of a and b, at least 0 (gcd(0, 0) is 0):
  // Euclid's algorithm (textbook), on i64s while both fit, else on
  // magnitudes with mag.divrem's remainder. For a fraction's lowest terms
  // (std.ts's lowest terms, which the lowering writes with this).
  "int.gcd": {
    params: [["a", "int"], ["b", "int"]], result: "int", locals: [["x", "i64"], ["y", "i64"], ["t", "i64"], ["u", "mag"], ["v", "mag"], ["w", "mag"]], uses: ["int.small", "int.of", "int.mag", "int.norm", "mag.divrem"], native: true,
    body: `
      local.get $a
      ref.test $huge
      local.get $b
      ref.test $huge
      i32.or
      i32.eqz
      if void
        local.get $a
        call $int.small
        local.set $x
        local.get $b
        call $int.small
        local.set $y
        local.get $x
        i64.const -9223372036854775808
        i64.ne
        local.get $y
        i64.const -9223372036854775808
        i64.ne
        i32.and
        if void
          local.get $x
          i64.const 0
          i64.lt_s
          if void
            i64.const 0
            local.get $x
            i64.sub
            local.set $x
          end
          local.get $y
          i64.const 0
          i64.lt_s
          if void
            i64.const 0
            local.get $y
            i64.sub
            local.set $y
          end
          block void
            loop void
              local.get $y
              i64.eqz
              br_if 1
              local.get $x
              local.get $y
              i64.rem_u
              local.set $t
              local.get $y
              local.set $x
              local.get $t
              local.set $y
              br 0
            end
          end
          local.get $x
          call $int.of
          return
        end
      end
      local.get $a
      call $int.mag
      local.set $u
      local.get $b
      call $int.mag
      local.set $v
      block void
        loop void
          local.get $v
          array.len
          i32.eqz
          br_if 1
          local.get $u
          local.get $v
          i32.const 1
          call $mag.divrem
          local.set $w
          local.get $v
          local.set $u
          local.get $w
          local.set $v
          br 0
        end
      end
      i32.const 0
      local.get $u
      call $int.norm`,
  },
  // a over g, g at least 0 and dividing a (int.gcd's); 0 when g is 0.
  "int.exact": {
    params: [["a", "int"], ["g", "int"]], result: "int", locals: [], uses: ["int.small", "int.of", "int.negative", "int.mag", "int.norm", "mag.divrem"], native: true,
    body: `
      local.get $a
      ref.test $huge
      local.get $g
      ref.test $huge
      i32.or
      i32.eqz
      if void
        local.get $g
        call $int.small
        i64.eqz
        if void
          i32.const 0
          ref.i31
          return
        end
        local.get $a
        call $int.small
        local.get $g
        call $int.small
        i64.div_s
        call $int.of
        return
      end
      local.get $a
      call $int.negative
      local.get $a
      call $int.mag
      local.get $g
      call $int.mag
      i32.const 0
      call $mag.divrem
      call $int.norm`,
  },
  // The remainder has b's sign (int.ts).
  "int.remainder": {
    params: [["a", "int"], ["b", "int"]], result: "int", locals: [["st", "i32"], ["r", "mag"]], uses: ["int.small", "int.of", "int.negative", "int.mag", "int.norm", "int64.remainder", "mag.divrem", "mag.sub"], native: true, partial: true,
    body: `
      local.get $a
      ref.test $huge
      local.get $b
      ref.test $huge
      i32.or
      i32.eqz
      if void
        local.get $a
        call $int.small
        local.get $b
        call $int.small
        call $int64.remainder
        local.set $st
        call $int.of
        local.get $st
        return
      end
      local.get $a
      call $int.mag
      local.get $b
      call $int.mag
      i32.const 1
      call $mag.divrem
      local.tee $r
      array.len
      i32.eqz
      if void
        i32.const 0
        ref.i31
        i32.const 0
        return
      end
      local.get $a
      call $int.negative
      local.get $b
      call $int.negative
      i32.ne
      if void
        local.get $b
        call $int.mag
        local.get $r
        call $mag.sub
        local.set $r
      end
      local.get $b
      call $int.negative
      local.get $r
      call $int.norm
      i32.const 0`,
  },
  // By squaring; a is squared only when a higher power is still to come.
  // A power past an i64 has an answer only for 0, 1 and -1 (any other
  // wouldn't fit in memory: a trap).
  "int.power": {
    params: [["a", "int"], ["n", "int"]], result: "int", locals: [["e", "i64"], ["r", "int"], ["x", "i64"]], uses: ["int.small", "int.of", "int.negative", "int.mul", "int.limb"], native: true, partial: true,
    body: `
      local.get $n
      call $int.negative
      if void
        ref.null eq
        i32.const 1
        return
      end
      local.get $n
      ref.test $huge
      if void
        local.get $a
        ref.test $huge
        if void
          unreachable
        end
        local.get $a
        call $int.small
        local.tee $x
        i64.const 0
        i64.eq
        local.get $x
        i64.const 1
        i64.eq
        i32.or
        if void
          local.get $a
          i32.const 0
          return
        end
        local.get $x
        i64.const -1
        i64.ne
        if void
          unreachable
        end
        local.get $n
        i32.const 0
        call $int.limb
        i32.const 1
        i32.and
        if int
          local.get $a
        else
          i32.const 1
          ref.i31
        end
        i32.const 0
        return
      end
      local.get $n
      call $int.small
      local.set $e
      i32.const 1
      ref.i31
      local.set $r
      block void
      loop void
        local.get $e
        i64.eqz
        br_if 1
        local.get $e
        i64.const 1
        i64.and
        i64.eqz
        i32.eqz
        if void
          local.get $r
          local.get $a
          call $int.mul
          local.set $r
        end
        local.get $e
        i64.const 1
        i64.shr_u
        local.tee $e
        i64.eqz
        br_if 1
        local.get $a
        local.get $a
        call $int.mul
        local.set $a
        br 0
      end
      end
      local.get $r
      i32.const 0`,
  },
  // Rounds down; Infinity and NaN have no answer (x − x isn't 0).
  "int64.wholePart": {
    params: [["x", "f64"]], result: "i64", locals: [], uses: [], partial: true,
    body: `
      local.get $x
      local.get $x
      f64.sub
      f64.const 0
      f64.ne
      if void
        i64.const 0
        i32.const 1
        return
      end
      local.get $x
      f64.floor
      i64.trunc_f64_s ;; int.wholePart takes the limbs past 2⁶³
      i32.const 0`,
  },
  // Only what show writes: -?(0|[1-9][0-9]*), not -0. Kept at or below
  // zero while reading, so the smallest i64 reads too.
  "int64.read": {
    params: [["t", "text"]], result: "i64", locals: [["i", "i32"], ["n", "i32"], ["neg", "i32"], ["c", "i32"], ["m", "i64"]], uses: ["int64.mul", "int64.sub", "int64.neg"], partial: true,
    body: `
      local.get $t
      array.len
      local.set $n
      local.get $n
      if void
        local.get $t
        i32.const 0
        array.get_u $bytes
        i32.const 45
        i32.eq
        if void
          i32.const 1
          local.set $neg
          i32.const 1
          local.set $i
        end
      end
      local.get $i
      local.get $n
      i32.ge_u
      if void
        i64.const 0
        i32.const 1
        return
      end
      local.get $t
      local.get $i
      array.get_u $bytes
      i32.const 48
      i32.eq
      if void
        local.get $i
        i32.const 1
        i32.add
        local.get $n
        i32.ne
        local.get $neg
        i32.or
        if void
          i64.const 0
          i32.const 1
          return
        end
      end
      block void
      loop void
        local.get $i
        local.get $n
        i32.ge_u
        br_if 1
        local.get $t
        local.get $i
        array.get_u $bytes
        i32.const 48
        i32.sub
        local.tee $c
        i32.const 9
        i32.gt_u
        if void
          i64.const 0
          i32.const 1
          return
        end
        local.get $m
        i64.const 10
        call $int64.mul
        local.get $c
        i64.extend_i32_u
        call $int64.sub
        local.set $m
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br 0
      end
      end
      local.get $neg
      if i64
        local.get $m
      else
        local.get $m
        call $int64.neg
      end
      i32.const 0`,
  },
  // The first byte where part's bytes start, as characters before it.
  // UTF-8 can't match inside a character, so bytes find what characters do.
  "text.find": {
    params: [["t", "text"], ["p", "text"]], result: "int", locals: [["i", "i32"], ["j", "i32"], ["last", "i32"], ["k", "i32"]], uses: [], partial: true,
    body: `
      local.get $t
      array.len
      local.get $p
      array.len
      i32.sub
      local.set $last
      block void ;; found at i
      loop void
        local.get $i
        local.get $last
        i32.gt_s
        if void
          i64.const 0
          i32.const 1
          return
        end
        i32.const 0
        local.set $j
        block void ;; not at i
        loop void
          local.get $j
          local.get $p
          array.len
          i32.ge_u
          br_if 3
          local.get $t
          local.get $i
          local.get $j
          i32.add
          array.get_u $bytes
          local.get $p
          local.get $j
          array.get_u $bytes
          i32.ne
          br_if 1
          local.get $j
          i32.const 1
          i32.add
          local.set $j
          br 0
        end
        end
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br 0
      end
      end
      i32.const 0
      local.set $j
      block void
      loop void
        local.get $j
        local.get $i
        i32.ge_u
        br_if 1
        local.get $t
        local.get $j
        array.get_u $bytes
        i32.const 192
        i32.and
        i32.const 128
        i32.ne
        local.get $k
        i32.add
        local.set $k
        local.get $j
        i32.const 1
        i32.add
        local.set $j
        br 0
      end
      end
      local.get $k
      i64.extend_i32_u
      i32.const 0`,
  },
  // A one-character text's code point: its first byte says how many bytes
  // the character has, which must be all of them.
  "text.code": {
    params: [["t", "text"]], result: "int", locals: [["n", "i32"], ["c", "i32"], ["k", "i32"], ["i", "i32"]], uses: [], partial: true,
    body: `
      local.get $t
      array.len
      local.tee $n
      i32.eqz
      if void
        i64.const 0
        i32.const 1
        return
      end
      local.get $t
      i32.const 0
      array.get_u $bytes
      local.tee $c
      i32.const 128
      i32.lt_u
      if void
        i32.const 1
        local.set $k
      else
        local.get $c
        i32.const 224
        i32.lt_u
        if void
          i32.const 2
          local.set $k
          local.get $c
          i32.const 31
          i32.and
          local.set $c
        else
          local.get $c
          i32.const 240
          i32.lt_u
          if void
            i32.const 3
            local.set $k
            local.get $c
            i32.const 15
            i32.and
            local.set $c
          else
            i32.const 4
            local.set $k
            local.get $c
            i32.const 7
            i32.and
            local.set $c
          end
        end
      end
      local.get $n
      local.get $k
      i32.ne
      if void
        i64.const 0
        i32.const 1
        return
      end
      i32.const 1
      local.set $i
      block void
      loop void
        local.get $i
        local.get $k
        i32.ge_u
        br_if 1
        local.get $c
        i32.const 6
        i32.shl
        local.get $t
        local.get $i
        array.get_u $bytes
        i32.const 63
        i32.and
        i32.or
        local.set $c
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br 0
      end
      end
      local.get $c
      i64.extend_i32_u
      i32.const 0`,
  },
  // A code point's character in UTF-8; past U+10FFFF, below 0 and the
  // surrogates have none.
  "text.fromCode": {
    params: [["n", "int"]], result: "text", locals: [["c", "i32"]], uses: [], partial: true,
    body: `
      local.get $n
      i64.const 1114111
      i64.gt_u
      if void
        ref.null $bytes
        i32.const 1
        return
      end
      local.get $n
      i32.wrap_i64
      local.tee $c
      i32.const 55296
      i32.sub
      i32.const 2048
      i32.lt_u
      if void
        ref.null $bytes
        i32.const 1
        return
      end
      local.get $c
      i32.const 128
      i32.lt_u
      if text
        local.get $c
        array.new_fixed $bytes 1
      else
        local.get $c
        i32.const 2048
        i32.lt_u
        if text
          local.get $c
          i32.const 6
          i32.shr_u
          i32.const 192
          i32.or
          local.get $c
          i32.const 63
          i32.and
          i32.const 128
          i32.or
          array.new_fixed $bytes 2
        else
          local.get $c
          i32.const 65536
          i32.lt_u
          if text
            local.get $c
            i32.const 12
            i32.shr_u
            i32.const 224
            i32.or
            local.get $c
            i32.const 6
            i32.shr_u
            i32.const 63
            i32.and
            i32.const 128
            i32.or
            local.get $c
            i32.const 63
            i32.and
            i32.const 128
            i32.or
            array.new_fixed $bytes 3
          else
            local.get $c
            i32.const 18
            i32.shr_u
            i32.const 240
            i32.or
            local.get $c
            i32.const 12
            i32.shr_u
            i32.const 63
            i32.and
            i32.const 128
            i32.or
            local.get $c
            i32.const 6
            i32.shr_u
            i32.const 63
            i32.and
            i32.const 128
            i32.or
            local.get $c
            i32.const 63
            i32.and
            i32.const 128
            i32.or
            array.new_fixed $bytes 4
          end
        end
      end
      i32.const 0`,
  },
};

// A function with an Int that isn't native is two: `name.i64`, its body
// on i64s, and `name`, which takes and gives Ints and converts (int.small,
// int.of) around a call to it. Inside the bodies every call is to the i64
// one.

// std's Array (C66): a view, a start and a length, on a buffer with free
// room at both ends ($buf: its items, and the lowest and highest slots in
// use), as compiled JS keeps it (runtime.js, C30d1: Ersagun's two-ended
// array list; deques, gap buffers and Go's slices are the prior art). A
// push writes into the free slot past the view's end when no other view
// has taken it, and copies the view into a new buffer otherwise, so an
// array never changes. One copy of each per item type: `array.push.a0`.
const ARRAYS: Record<string, Omit<RtFn, "name">> = {
  "array.empty": {
    params: [], result: "array", locals: [], uses: [],
    body: `
      i32.const 8
      array.new_default $items
      i32.const 4
      i32.const 4
      struct.new $buf
      i32.const 4
      i32.const 0
      struct.new $arr`,
  },
  "array.of": {
    params: [["l", "list"]], result: "array", locals: [["n", "i32"], ["p", "list"], ["it", "items"], ["i", "i32"], ["room", "i32"]], uses: [],
    body: `
      local.get $l
      local.set $p
      block void
      loop void
        local.get $p
        struct.get $list 0
        i32.eqz
        br_if 1
        local.get $n
        i32.const 1
        i32.add
        local.set $n
        local.get $p
        ref.cast $list.cons
        struct.get $list.cons 2
        local.set $p
        br 0
      end
      end
      local.get $n
      i32.const 4
      local.get $n
      i32.const 4
      i32.gt_u
      select
      local.set $room
      local.get $n
      local.get $room
      i32.const 1
      i32.shl
      i32.add
      array.new_default $items
      local.set $it
      local.get $l
      local.set $p
      block void
      loop void
        local.get $p
        struct.get $list 0
        i32.eqz
        br_if 1
        local.get $it
        local.get $room
        local.get $i
        i32.add
        local.get $p
        ref.cast $list.cons
        struct.get $list.cons 1
        array.set $items
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        local.get $p
        ref.cast $list.cons
        struct.get $list.cons 2
        local.set $p
        br 0
      end
      end
      local.get $it
      local.get $room
      local.get $room
      local.get $n
      i32.add
      struct.new $buf
      local.get $room
      local.get $n
      struct.new $arr`,
  },
  "array.items": {
    params: [["a", "array"]], result: "list", locals: [["it", "items"], ["s", "i32"], ["i", "i32"], ["acc", "list"]], uses: [],
    body: `
      local.get $a
      struct.get $arr 0
      struct.get $buf 0
      local.set $it
      local.get $a
      struct.get $arr 1
      local.set $s
      local.get $a
      struct.get $arr 2
      local.set $i
      i32.const 0
      struct.new $list.nil
      local.set $acc
      block void
      loop void
        local.get $i
        i32.eqz
        br_if 1
        local.get $i
        i32.const 1
        i32.sub
        local.set $i
        i32.const 1
        local.get $it
        local.get $s
        local.get $i
        i32.add
        array.get $items
        local.get $acc
        struct.new $list.cons
        local.set $acc
        br 0
      end
      end
      local.get $acc`,
  },
  "array.length": {
    params: [["a", "array"]], result: "int", locals: [], uses: [],
    body: `
      local.get $a
      struct.get $arr 2
      i64.extend_i32_s`,
  },
  // No answer past the end; an item type's zero, read from a new array of
  // one, stands in for the answer.
  "array.at": {
    params: [["a", "array"], ["k", "int"]], result: "item", locals: [], uses: [], partial: true,
    body: `
      local.get $k
      i64.const 0
      i64.lt_s
      local.get $k
      local.get $a
      struct.get $arr 2
      i64.extend_i32_s
      i64.ge_s
      i32.or
      if void
        i32.const 1
        array.new_default $items
        i32.const 0
        array.get $items
        i32.const 1
        return
      end
      local.get $a
      struct.get $arr 0
      struct.get $buf 0
      local.get $a
      struct.get $arr 1
      local.get $k
      i32.wrap_i64
      i32.add
      array.get $items
      i32.const 0`,
  },
  // The first item; no answer when empty (C30d), as `at` past the end.
  "array.first": {
    params: [["a", "array"]], result: "item", locals: [], uses: [], partial: true,
    body: `
      local.get $a
      struct.get $arr 2
      i32.eqz
      if void
        i32.const 1
        array.new_default $items
        i32.const 0
        array.get $items
        i32.const 1
        return
      end
      local.get $a
      struct.get $arr 0
      struct.get $buf 0
      local.get $a
      struct.get $arr 1
      array.get $items
      i32.const 0`,
  },
  // The items after the first: a view one later on the same buffer (the
  // empty array's rest is itself).
  "array.rest": {
    params: [["a", "array"]], result: "array", locals: [], uses: [],
    body: `
      local.get $a
      struct.get $arr 2
      i32.eqz
      if void
        local.get $a
        return
      end
      local.get $a
      struct.get $arr 0
      local.get $a
      struct.get $arr 1
      i32.const 1
      i32.add
      local.get $a
      struct.get $arr 2
      i32.const 1
      i32.sub
      struct.new $arr`,
  },
  // push at the front: into the free slot before the view's start when no
  // other view has taken it, else a copy with room on both sides.
  "array.pushFront": {
    params: [["a", "array"], ["x", "item"]], result: "array", locals: [["b", "buf"], ["s", "i32"], ["n", "i32"], ["it", "items"], ["room", "i32"]], uses: [],
    body: `
      local.get $a
      struct.get $arr 0
      local.set $b
      local.get $a
      struct.get $arr 1
      local.set $s
      local.get $a
      struct.get $arr 2
      local.set $n
      ;; the slot before the start is free and in the buffer: write it
      local.get $s
      local.get $b
      struct.get $buf 1
      i32.eq
      local.get $s
      i32.const 0
      i32.gt_u
      i32.and
      if void
        local.get $b
        struct.get $buf 0
        local.get $s
        i32.const 1
        i32.sub
        local.get $x
        array.set $items
        local.get $b
        local.get $s
        i32.const 1
        i32.sub
        struct.set $buf 1
        local.get $b
        local.get $s
        i32.const 1
        i32.sub
        local.get $n
        i32.const 1
        i32.add
        struct.new $arr
        return
      end
      ;; else the view's items into a new buffer, with room on both sides
      local.get $n
      i32.const 4
      local.get $n
      i32.const 4
      i32.gt_u
      select
      local.set $room
      local.get $n
      local.get $room
      i32.const 1
      i32.shl
      i32.add
      array.new_default $items
      local.tee $it
      local.get $room
      local.get $b
      struct.get $buf 0
      local.get $s
      local.get $n
      array.copy $items $items
      local.get $it
      local.get $room
      i32.const 1
      i32.sub
      local.get $x
      array.set $items
      local.get $it
      local.get $room
      i32.const 1
      i32.sub
      local.get $room
      local.get $n
      i32.add
      struct.new $buf
      local.get $room
      i32.const 1
      i32.sub
      local.get $n
      i32.const 1
      i32.add
      struct.new $arr`,
  },
  "array.push": {
    params: [["a", "array"], ["x", "item"]], result: "array", locals: [["b", "buf"], ["s", "i32"], ["n", "i32"], ["e", "i32"], ["it", "items"], ["room", "i32"]], uses: [],
    body: `
      local.get $a
      struct.get $arr 0
      local.set $b
      local.get $a
      struct.get $arr 1
      local.set $s
      local.get $a
      struct.get $arr 2
      local.set $n
      local.get $s
      local.get $n
      i32.add
      local.set $e
      ;; the slot past the end is free and in the buffer: write it
      local.get $e
      local.get $b
      struct.get $buf 2
      i32.eq
      local.get $e
      local.get $b
      struct.get $buf 0
      array.len
      i32.lt_u
      i32.and
      if void
        local.get $b
        struct.get $buf 0
        local.get $e
        local.get $x
        array.set $items
        local.get $b
        local.get $e
        i32.const 1
        i32.add
        struct.set $buf 2
        local.get $b
        local.get $s
        local.get $n
        i32.const 1
        i32.add
        struct.new $arr
        return
      end
      ;; else the view's items into a new buffer, with room on both sides
      local.get $n
      i32.const 4
      local.get $n
      i32.const 4
      i32.gt_u
      select
      local.set $room
      local.get $n
      local.get $room
      i32.const 1
      i32.shl
      i32.add
      array.new_default $items
      local.tee $it
      local.get $room
      local.get $b
      struct.get $buf 0
      local.get $s
      local.get $n
      array.copy $items $items
      local.get $it
      local.get $room
      local.get $n
      i32.add
      local.get $x
      array.set $items
      local.get $it
      local.get $room
      local.get $room
      local.get $n
      i32.add
      i32.const 1
      i32.add
      struct.new $buf
      local.get $room
      local.get $n
      i32.const 1
      i32.add
      struct.new $arr`,
  },
};
const hasInt = (f: Omit<RtFn, "name">) => !f.native && [...f.params.map(([, t]) => t), f.result].includes("int");
const raw = (n: string) => { const f = R[n] ?? WASI[n] ?? MATH[n]; return f && hasInt(f) ? `${n}.i64` : n; };
export const runtime = (name: string): RtFn => {
  // An array function's copy for one item type (C66): the template, told which.
  const at = /^(array\.\w+)\.a(\d+)(\.i64)?$/.exec(name);
  if (at) {
    const f = { ...ARRAYS[at[1]], array: Number(at[2]) };
    if (!ARRAYS[at[1]]) throw new Error(`no runtime function ${name}`);
    if (at[3] || !hasInt(f)) {
      const i64 = (t: VT): VT => (at[3] && t === "int" ? "i64" : t);
      return { ...f, name, params: f.params.map(([n, t]) => [n, i64(t)]), result: i64(f.result) };
    }
    return {
      name, params: f.params, result: f.result, locals: f.partial ? [["st", "i32"]] : [], uses: [`${name}.i64`, "int.small", "int.of"], array: f.array, partial: f.partial,
      body: [
        ...f.params.flatMap(([n, t]) => [`local.get $${n}`, ...(t === "int" ? ["call $int.small"] : [])]),
        `call $${name}.i64`,
        ...(f.partial ? ["local.set $st"] : []),
        ...(f.result === "int" ? ["call $int.of"] : []),
        ...(f.partial ? ["local.get $st"] : []),
      ].join("\n"),
    };
  }
  const base = name.endsWith(".i64") ? name.slice(0, -4) : name;
  const f = R[base] ?? WASI[base] ?? MATH[base];
  if (!f || (base !== name && !hasInt(f))) throw new Error(`no runtime function ${name}`);
  const body = f.body.replace(/call \$([\w.]+)/g, (_, n: string) => `call $${raw(n)}`), uses = f.uses.map(raw);
  if (base !== name) {
    const i64 = (t: VT): VT => (t === "int" ? "i64" : t);
    return { ...f, name, params: f.params.map(([n, t]) => [n, i64(t)]), result: i64(f.result), body, uses };
  }
  if (!hasInt(f)) return { ...f, name, body, uses };
  return {
    name, params: f.params, result: f.result, locals: f.partial ? [["st", "i32"]] : [], uses: [`${name}.i64`, "int.small", "int.of"], list: f.list, partial: f.partial,
    body: [
      ...f.params.flatMap(([n, t]) => [`local.get $${n}`, ...(t === "int" ? ["call $int.small"] : [])]),
      `call $${name}.i64`,
      ...(f.partial ? ["local.set $st"] : []),
      ...(f.result === "int" ? ["call $int.of"] : []),
      ...(f.partial ? ["local.get $st"] : []),
    ].join("\n"),
  };
};
export const RUNTIME = Object.keys(R);

// ---- the world over WASI (docs/design/targets/WASM.md, W3b-2)
//
// For a module run as a WASI command (wasmtime, node:wasi): the world's
// operations written over wasi_snapshot_preview1, as wasm.ts's "world"
// imports are over JavaScript. They give and fail the same way: an
// operation that fails sets the module's `reason` global, worded as Node's
// world (ters/src/lang/world.ts) words it, and gives status 2.
// WASI hands bytes over through linear memory: 0 to 127 is for its small
// results, and 128 on the buffer, grown to fit. Paths are relative to the
// first folder the host gives the program (fd 3), WASI's sandbox.

// The imports used, by WASI's names, with their types.
export const WASI_IMPORTS: Record<string, { params: ("i32" | "i64")[]; result: "i32" | null }> = {
  fd_write: { params: ["i32", "i32", "i32", "i32"], result: "i32" },
  fd_read: { params: ["i32", "i32", "i32", "i32"], result: "i32" },
  fd_close: { params: ["i32"], result: "i32" },
  fd_readdir: { params: ["i32", "i32", "i32", "i64", "i32"], result: "i32" },
  path_open: { params: ["i32", "i32", "i32", "i32", "i32", "i64", "i64", "i32", "i32"], result: "i32" },
  path_filestat_get: { params: ["i32", "i32", "i32", "i32", "i32"], result: "i32" },
  args_sizes_get: { params: ["i32", "i32"], result: "i32" },
  args_get: { params: ["i32", "i32"], result: "i32" },
  proc_exit: { params: ["i32"], result: null },
};
// WASI's errors (wasi_snapshot_preview1 errno) and rights.
const E = { ACCES: 2, ISDIR: 31, NOENT: 44, NOTDIR: 54, PERM: 63, NOTCAPABLE: 76 };
const RIGHT = { READ: 0x2, SEEK: 0x4, WRITE: 0x40, READDIR: 0x4000, FILESTAT: 0x200000 };
// Status 2 after a failed open: the result's zero, then the reason.
const failed = (zero: string, path = "local.get $path") => `
  ${zero}
  i32.const 0
  local.get $fd
  i32.sub
  ${path}
  call $wasi.fail
  return`;
// A file opened as a folder or the other way is told apart first, since
// WASI hosts differ in what they say then: Node's world's words.
const open = (oflags: number, rights: number, fdflags: number, zero: string) => `
  local.get $path
  call $wasi.kind
  i32.const ${oflags & 2 ? 1 : 2}
  i32.eq
  if void
    ${zero}
    i32.const ${oflags & 2 ? E.NOTDIR : E.ISDIR}
    local.get $path
    call $wasi.fail
    return
  end
  local.get $path
  i32.const ${oflags}
  i64.const ${rights}
  i32.const ${fdflags}
  call $wasi.open
  local.tee $fd
  i32.const 0
  i32.lt_s
  if void
    ${failed(zero)}
  end`;
const loopTo = (cond: string, body: string) => `
  block void
    loop void
      ${cond}
      br_if 1
      ${body}
      br 0
    end
  end`;

const WASI: Record<string, Omit<RtFn, "name">> = {
  // Memory for n bytes of buffer.
  "wasi.room": {
    params: [["n", "i32"]], result: "void", locals: [["want", "i32"]], uses: [],
    body: `
      local.get $n
      i32.const 128
      i32.add
      local.tee $want
      memory.size
      i32.const 16
      i32.shl
      i32.gt_u
      if void
        local.get $want
        memory.size
        i32.const 16
        i32.shl
        i32.sub
        i32.const 65535
        i32.add
        i32.const 16
        i32.shr_u
        memory.grow
        drop
      end`,
  },
  // t's bytes into the buffer; how many.
  "wasi.put": {
    params: [["t", "text"]], result: "i32", locals: [["n", "i32"], ["i", "i32"]], uses: ["wasi.room"],
    body: `
      local.get $t
      array.len
      local.tee $n
      call $wasi.room
      ${loopTo("local.get $i\nlocal.get $n\ni32.ge_u", `
      local.get $i
      i32.const 128
      i32.add
      local.get $t
      local.get $i
      array.get_u $bytes
      i32.store8
      local.get $i
      i32.const 1
      i32.add
      local.set $i`)}
      local.get $n`,
  },
  // The n bytes at p as a text.
  "wasi.take": {
    params: [["p", "i32"], ["n", "i32"]], result: "text", locals: [["r", "text"], ["i", "i32"]], uses: [],
    body: `
      local.get $n
      array.new_default $bytes
      local.set $r
      ${loopTo("local.get $i\nlocal.get $n\ni32.ge_u", `
      local.get $r
      local.get $i
      local.get $p
      local.get $i
      i32.add
      i32.load8_u
      array.set $bytes
      local.get $i
      i32.const 1
      i32.add
      local.set $i`)}
      local.get $r`,
  },
  // All of t to fd; WASI's error, or 0.
  "wasi.write": {
    params: [["fd", "i32"], ["t", "text"]], result: "i32", locals: [["left", "i32"], ["p", "i32"], ["e", "i32"], ["w", "i32"]], uses: ["wasi.put", "wasi_fd_write"],
    body: `
      local.get $t
      call $wasi.put
      local.set $left
      i32.const 128
      local.set $p
      ${loopTo("local.get $left\ni32.eqz", `
      i32.const 0
      local.get $p
      i32.store
      i32.const 4
      local.get $left
      i32.store
      local.get $fd
      i32.const 0
      i32.const 1
      i32.const 8
      call $wasi_fd_write
      local.tee $e
      if void
        local.get $e
        return
      end
      i32.const 8
      i32.load
      local.set $w
      local.get $p
      local.get $w
      i32.add
      local.set $p
      local.get $left
      local.get $w
      i32.sub
      local.set $left`)}
      i32.const 0`,
  },
  // t and a newline to fd.
  "wasi.line": {
    params: [["fd", "i32"], ["t", "text"]], result: "void", locals: [], uses: ["wasi.write", "text.concat"],
    body: `
      local.get $fd
      local.get $t
      ${lit("\n")}
      call $text.concat
      call $wasi.write
      drop`,
  },
  // The program stops with STOPS[i] (L125c2): its reason to standard
  // error, then exit 1, as an Abort nothing handled does.
  "wasi.stop": {
    params: [["i", "f64"]], result: "f64", locals: [], uses: ["wasi.line", "wasi_proc_exit"],
    body: `
      ${STOPS.map((why, i) => `local.get $i\n      f64.const ${i}\n      f64.eq\n      if void\n        i32.const 2\n        ${lit(why)}\n        call $wasi.line\n      end`).join("\n      ")}
      i32.const 1
      call $wasi_proc_exit
      unreachable`,
  },
  "wasi.print": { params: [["t", "text"]], result: "void", locals: [], uses: ["wasi.line"], body: "i32.const 1\nlocal.get $t\ncall $wasi.line" },
  "wasi.printError": { params: [["t", "text"]], result: "void", locals: [], uses: ["wasi.line"], body: "i32.const 2\nlocal.get $t\ncall $wasi.line" },
  // Error e on path: its reason, as Node's world gives it, and status 2.
  "wasi.fail": {
    params: [["e", "i32"], ["path", "text"]], result: "i32", locals: [], uses: ["text.concat"],
    body: `
      local.get $e
      i32.const ${E.NOENT}
      i32.eq
      if text
        ${lit("no such file or folder: ")}
        local.get $path
        call $text.concat
      else
        local.get $e
        i32.const ${E.ISDIR}
        i32.eq
        if text
          local.get $path
          ${lit(" is a folder, not a file")}
          call $text.concat
        else
          local.get $e
          i32.const ${E.NOTDIR}
          i32.eq
          if text
            local.get $path
            ${lit(" is not a folder")}
            call $text.concat
          else
            local.get $e
            i32.const ${E.ACCES}
            i32.eq
            local.get $e
            i32.const ${E.PERM}
            i32.eq
            i32.or
            local.get $e
            i32.const ${E.NOTCAPABLE}
            i32.eq
            i32.or
            if text
              ${lit("not allowed to use ")}
              local.get $path
              call $text.concat
            else
              ${lit("could not use ")}
              local.get $path
              call $text.concat
            end
          end
        end
      end
      global.set $reason
      i32.const 2`,
  },
  "wasi.reason": { params: [], result: "text", locals: [], uses: [], body: "global.get $reason" },
  // What's at path: 0 nothing, 1 a file (or anything but a folder), 2 a folder.
  "wasi.kind": {
    params: [["path", "text"]], result: "i32", locals: [["n", "i32"]], uses: ["wasi.put", "wasi_path_filestat_get"],
    body: `
      local.get $path
      call $wasi.put
      local.set $n
      i32.const 3
      i32.const 1
      i32.const 128
      local.get $n
      i32.const 8
      call $wasi_path_filestat_get
      if i32
        i32.const 0
      else
        i32.const 1
        i32.const 24
        i32.load8_u
        i32.const 3
        i32.eq
        i32.add
      end`,
  },
  // path opened from the program's folder: its fd, or minus WASI's error.
  "wasi.open": {
    params: [["path", "text"], ["oflags", "i32"], ["rights", "i64"], ["fdflags", "i32"]], result: "i32", locals: [["n", "i32"], ["e", "i32"]], uses: ["wasi.put", "wasi_path_open"],
    body: `
      local.get $path
      call $wasi.put
      local.set $n
      i32.const 3
      i32.const 1
      i32.const 128
      local.get $n
      local.get $oflags
      local.get $rights
      i64.const 0
      local.get $fdflags
      i32.const 8
      call $wasi_path_open
      local.tee $e
      if i32
        i32.const 0
        local.get $e
        i32.sub
      else
        i32.const 8
        i32.load
      end`,
  },
  // Everything left on fd into the buffer: how many bytes; WASI's error at 16.
  "wasi.readAll": {
    params: [["fd", "i32"]], result: "i32", locals: [["got", "i32"], ["e", "i32"], ["r", "i32"]], uses: ["wasi.room", "wasi_fd_read"],
    body: `
      i32.const 16
      i32.const 0
      i32.store
      block void
        loop void
          local.get $got
          i32.const 65536
          i32.add
          call $wasi.room
          i32.const 0
          local.get $got
          i32.const 128
          i32.add
          i32.store
          i32.const 4
          i32.const 65536
          i32.store
          local.get $fd
          i32.const 0
          i32.const 1
          i32.const 8
          call $wasi_fd_read
          local.tee $e
          if void
            i32.const 16
            local.get $e
            i32.store
            br 2
          end
          i32.const 8
          i32.load
          local.tee $r
          i32.eqz
          br_if 1
          local.get $got
          local.get $r
          i32.add
          local.set $got
          br 0
        end
      end
      local.get $got`,
  },
  "wasi.readFile": {
    params: [["path", "text"]], result: "text", partial: true, locals: [["fd", "i32"], ["n", "i32"], ["e", "i32"]], uses: ["wasi.kind", "wasi.open", "wasi.fail", "wasi.readAll", "wasi.take", "wasi_fd_close"],
    body: `
      ${open(0, RIGHT.READ | RIGHT.SEEK | RIGHT.FILESTAT, 0, "ref.null $bytes")}
      local.get $fd
      call $wasi.readAll
      local.set $n
      local.get $fd
      call $wasi_fd_close
      drop
      i32.const 16
      i32.load
      local.tee $e
      if void
        ref.null $bytes
        local.get $e
        local.get $path
        call $wasi.fail
        return
      end
      i32.const 128
      local.get $n
      call $wasi.take
      i32.const 0`,
  },
  "wasi.readInput": {
    params: [], result: "text", partial: true, locals: [["n", "i32"], ["e", "i32"]], uses: ["wasi.readAll", "wasi.fail", "wasi.take"],
    body: `
      i32.const 0
      call $wasi.readAll
      local.set $n
      i32.const 16
      i32.load
      local.tee $e
      if void
        ref.null $bytes
        local.get $e
        ${lit("standard input")}
        call $wasi.fail
        return
      end
      i32.const 128
      local.get $n
      call $wasi.take
      i32.const 0`,
  },
  // A byte at a time, so what's after the line stays for the next read.
  // None at the end of the input; a line's \r\n is its end, as Node's world has it.
  "wasi.readLine": {
    params: [], result: "option", partial: true, locals: [["got", "i32"], ["e", "i32"]], uses: ["wasi.room", "wasi.fail", "wasi.take", "wasi_fd_read", "TextOption.none", "TextOption.some"],
    body: `
      block void
        loop void
          local.get $got
          i32.const 1
          i32.add
          call $wasi.room
          i32.const 0
          local.get $got
          i32.const 128
          i32.add
          i32.store
          i32.const 4
          i32.const 1
          i32.store
          i32.const 0
          i32.const 0
          i32.const 1
          i32.const 8
          call $wasi_fd_read
          local.tee $e
          if void
            ref.null $option
            local.get $e
            ${lit("standard input")}
            call $wasi.fail
            return
          end
          i32.const 8
          i32.load
          i32.eqz
          if void
            local.get $got
            i32.eqz
            if void
              call $TextOption.none
              i32.const 0
              return
            end
            br 2
          end
          local.get $got
          i32.const 128
          i32.add
          i32.load8_u
          i32.const 10
          i32.eq
          br_if 1
          local.get $got
          i32.const 1
          i32.add
          local.set $got
          br 0
        end
      end
      local.get $got
      if void
        local.get $got
        i32.const 127
        i32.add
        i32.load8_u
        i32.const 13
        i32.eq
        if void
          local.get $got
          i32.const 1
          i32.sub
          local.set $got
        end
      end
      i32.const 128
      local.get $got
      call $wasi.take
      call $TextOption.some
      i32.const 0`,
  },
  "wasi.writeFile": {
    params: [["path", "text"], ["t", "text"]], result: "i32", locals: [["fd", "i32"], ["e", "i32"]], uses: ["wasi.kind", "wasi.open", "wasi.fail", "wasi.write", "wasi_fd_close"],
    body: `
      ${open(1 | 8, RIGHT.WRITE | RIGHT.SEEK, 0, "")}
      local.get $fd
      local.get $t
      call $wasi.write
      local.set $e
      local.get $fd
      call $wasi_fd_close
      drop
      local.get $e
      if void
        local.get $e
        local.get $path
        call $wasi.fail
        return
      end
      i32.const 0`,
  },
  "wasi.appendFile": {
    params: [["path", "text"], ["t", "text"]], result: "i32", locals: [["fd", "i32"], ["e", "i32"]], uses: ["wasi.kind", "wasi.open", "wasi.fail", "wasi.write", "wasi_fd_close"],
    body: `
      ${open(1, RIGHT.WRITE, 1, "")}
      local.get $fd
      local.get $t
      call $wasi.write
      local.set $e
      local.get $fd
      call $wasi_fd_close
      drop
      local.get $e
      if void
        local.get $e
        local.get $path
        call $wasi.fail
        return
      end
      i32.const 0`,
  },
  "wasi.fileExists": {
    params: [["path", "text"]], result: "i32", locals: [["n", "i32"]], uses: ["wasi.put", "wasi_path_filestat_get"],
    body: `
      local.get $path
      call $wasi.put
      local.set $n
      i32.const 3
      i32.const 1
      i32.const 128
      local.get $n
      i32.const 8
      call $wasi_path_filestat_get
      i32.eqz`,
  },
  // Which of the bytes at a (an of them) and at b comes first: -1, 0 or 1.
  "wasi.compare": {
    params: [["a", "i32"], ["an", "i32"], ["b", "i32"], ["bn", "i32"]], result: "i32", locals: [["i", "i32"], ["x", "i32"], ["y", "i32"]], uses: [],
    body: `
      block void
        loop void
          local.get $i
          local.get $an
          i32.ge_u
          local.get $i
          local.get $bn
          i32.ge_u
          i32.or
          br_if 1
          local.get $a
          local.get $i
          i32.add
          i32.load8_u
          local.set $x
          local.get $b
          local.get $i
          i32.add
          i32.load8_u
          local.set $y
          local.get $x
          local.get $y
          i32.ne
          if void
            i32.const 1
            i32.const -1
            local.get $x
            local.get $y
            i32.gt_u
            select
            return
          end
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br 0
        end
      end
      local.get $an
      local.get $bn
      i32.gt_u
      local.get $an
      local.get $bn
      i32.lt_u
      i32.sub`,
  },
  // A folder's names but . and .., sorted (as Node's world sorts them,
  // which for UTF-8 is byte order). WASI gives them in no order: the list
  // is built from its end, each time the greatest name before the last one taken.
  "wasi.listFolder": {
    params: [["path", "text"]], result: "list", partial: true,
    locals: [["fd", "i32"], ["e", "i32"], ["size", "i32"], ["used", "i32"], ["p", "i32"], ["n", "i32"], ["best", "i32"], ["bn", "i32"], ["last", "i32"], ["ln", "i32"], ["l", "list"]],
    uses: ["wasi.kind", "wasi.open", "wasi.fail", "wasi.room", "wasi.compare", "wasi.take", "wasi_fd_readdir", "wasi_fd_close", "TextList.nil", "TextList.cons"],
    body: `
      ${open(2, RIGHT.READDIR, 0, "ref.null $list")}
      i32.const 4096
      local.set $size
      block void
        loop void
          local.get $size
          call $wasi.room
          local.get $fd
          i32.const 128
          local.get $size
          i64.const 0
          i32.const 8
          call $wasi_fd_readdir
          local.tee $e
          if void
            local.get $fd
            call $wasi_fd_close
            drop
            ref.null $list
            local.get $e
            local.get $path
            call $wasi.fail
            return
          end
          i32.const 8
          i32.load
          local.tee $used
          local.get $size
          i32.lt_u
          br_if 1
          local.get $size
          i32.const 2
          i32.mul
          local.set $size
          br 0
        end
      end
      local.get $fd
      call $wasi_fd_close
      drop
      call $TextList.nil
      local.set $l
      i32.const -1
      local.set $last
      block void
        loop void
          i32.const -1
          local.set $best
          i32.const 0
          local.set $p
          block void
            loop void
              local.get $p
              i32.const 24
              i32.add
              local.get $used
              i32.gt_u
              br_if 1
              local.get $p
              i32.const 144
              i32.add
              i32.load
              local.set $n
              ;; skip . and ..
              local.get $p
              i32.const 152
              i32.add
              i32.load8_u
              i32.const 46
              i32.eq
              local.get $n
              i32.const 1
              i32.eq
              local.get $n
              i32.const 2
              i32.eq
              local.get $p
              i32.const 153
              i32.add
              i32.load8_u
              i32.const 46
              i32.eq
              i32.and
              i32.or
              i32.and
              i32.eqz
              if void
                ;; before the last taken, and after the best so far
                local.get $last
                i32.const 0
                i32.lt_s
                if i32
                  i32.const 1
                else
                  local.get $p
                  i32.const 152
                  i32.add
                  local.get $n
                  local.get $last
                  i32.const 152
                  i32.add
                  local.get $ln
                  call $wasi.compare
                  i32.const 0
                  i32.lt_s
                end
                if void
                  local.get $best
                  i32.const 0
                  i32.lt_s
                  if i32
                    i32.const 1
                  else
                    local.get $p
                    i32.const 152
                    i32.add
                    local.get $n
                    local.get $best
                    i32.const 152
                    i32.add
                    local.get $bn
                    call $wasi.compare
                    i32.const 0
                    i32.gt_s
                  end
                  if void
                    local.get $p
                    local.set $best
                    local.get $n
                    local.set $bn
                  end
                end
              end
              local.get $p
              i32.const 24
              i32.add
              local.get $n
              i32.add
              local.set $p
              br 0
            end
          end
          local.get $best
          i32.const 0
          i32.lt_s
          br_if 1
          local.get $best
          i32.const 152
          i32.add
          local.get $bn
          call $wasi.take
          local.get $l
          call $TextList.cons
          local.set $l
          local.get $best
          local.set $last
          local.get $bn
          local.set $ln
          br 0
        end
      end
      local.get $l
      i32.const 0`,
  },
  // The program's arguments after its own name, as a List Text.
  "wasi.args": {
    params: [], result: "list", locals: [["argc", "i32"], ["i", "i32"], ["p", "i32"], ["n", "i32"], ["l", "list"]], uses: ["wasi.room", "wasi.take", "wasi_args_sizes_get", "wasi_args_get", "TextList.nil", "TextList.cons"],
    body: `
      i32.const 0
      i32.const 4
      call $wasi_args_sizes_get
      drop
      i32.const 0
      i32.load
      local.tee $argc
      i32.const 4
      i32.mul
      i32.const 4
      i32.load
      i32.add
      call $wasi.room
      i32.const 128
      i32.const 128
      local.get $argc
      i32.const 4
      i32.mul
      i32.add
      call $wasi_args_get
      drop
      call $TextList.nil
      local.set $l
      local.get $argc
      local.set $i
      ${loopTo("local.get $i\ni32.const 1\ni32.le_u", `
      local.get $i
      i32.const 1
      i32.sub
      local.tee $i
      i32.const 4
      i32.mul
      i32.const 128
      i32.add
      i32.load
      local.set $p
      i32.const 0
      local.set $n
      ${loopTo("local.get $p\nlocal.get $n\ni32.add\ni32.load8_u\ni32.eqz", `
      local.get $n
      i32.const 1
      i32.add
      local.set $n`)}
      local.get $p
      local.get $n
      call $wasi.take
      local.get $l
      call $TextList.cons
      local.set $l`)}
      local.get $l`,
  },
};
