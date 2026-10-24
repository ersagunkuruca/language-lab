// The WebAssembly runtime for Int and Text (projectional/WASM.md, stage
// W3): small functions written in WebAssembly's own text format, one
// instruction per line, which wasm.ts adds to a module that uses them.
// A tiny assembler turns each line into bytes, so the text a module prints
// is exactly what runs.
//
// Text is an immutable UTF-8 byte array, `(array (mut i8))` (mutable only
// while it's being filled). A character position counts characters, so a
// position is found by walking from the start, as std.ts does for text
// outside the Basic Multilingual Plane; UTF-8's byte order is code-point
// order, so comparing is comparing bytes. Int is an i64, and an operation
// whose answer doesn't fit traps: a runtime error, not a wrong answer
// (big Ints are stage W5).
//
// The functions match std.ts and text.ts: slice clamps, split is
// JavaScript's (non-overlapping, left to right), show is std.ts's show.

// A value type, as the runtime functions name them: `text` is a
// reference to the byte array, `list` to a List Text of the module.
// `option` an Optional Text, and `void` a result of nothing.
export type VT = "i32" | "i64" | "f64" | "text" | "list" | "option" | "void";

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
  // A builtin with no answer or one (Choice): it gives its answer and a
  // status, 0 for an answer and 1 for none, as the module's own
  // one-answer functions do (wasm.ts).
  partial?: true;
}

// Immediates each instruction takes.
type Imm = "local" | "func" | "type" | "label" | "i32" | "i64" | "f64" | "bt" | "u" | "global";
const OPS: Record<string, [number[], Imm[]]> = {
  "unreachable": [[0x00], []], "block": [[0x02], ["bt"]], "loop": [[0x03], ["bt"]], "if": [[0x04], ["bt"]], "else": [[0x05], []], "end": [[0x0b], []],
  "br": [[0x0c], ["label"]], "br_if": [[0x0d], ["label"]], "return": [[0x0f], []], "call": [[0x10], ["func"]], "drop": [[0x1a], []], "select": [[0x1b], []],
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
  "i64.reinterpret_f64": [[0xbd], []], "f64.reinterpret_i64": [[0xbf], []], "f64.convert_i64_u": [[0xba], []], "i32.shl": [[0x74], []], "i32.shr_u": [[0x76], []],
  "f64.abs": [[0x99], []], "f64.neg": [[0x9a], []], "f64.floor": [[0x9c], []], "f64.add": [[0xa0], []], "f64.sub": [[0xa1], []], "f64.mul": [[0xa2], []], "f64.div": [[0xa3], []],
  "i32.wrap_i64": [[0xa7], []], "i64.extend_i32_s": [[0xac], []], "i64.extend_i32_u": [[0xad], []], "i64.trunc_f64_s": [[0xb0], []], "f64.convert_i64_s": [[0xb9], []],
  // Linear memory (WASI's buffers), aligned naturally, at offset 0.
  "i32.load": [[0x28, 0x02, 0x00], []], "i64.load": [[0x29, 0x03, 0x00], []], "i32.load8_u": [[0x2d, 0x00, 0x00], []],
  "i32.store": [[0x36, 0x02, 0x00], []], "i32.store8": [[0x3a, 0x00, 0x00], []], "memory.size": [[0x3f, 0x00], []], "memory.grow": [[0x40, 0x00], []],
  "i32.trunc_sat_f64_s": [[0xfc, 0x02], []], "global.get": [[0x23], ["global"]], "global.set": [[0x24], ["global"]],
  "ref.is_null": [[0xd1], []], "ref.null": [[0xd0], ["type"]],
  "struct.new": [[0xfb, 0x00], ["type"]], "struct.get": [[0xfb, 0x02], ["type", "u"]], "ref.cast": [[0xfb, 0x16], ["type"]],
  "array.new_default": [[0xfb, 0x07], ["type"]], "array.new_fixed": [[0xfb, 0x08], ["type", "u"]], "array.get_u": [[0xfb, 0x0d], ["type"]],
  "array.set": [[0xfb, 0x0e], ["type"]], "array.len": [[0xfb, 0x0f], []], "array.copy": [[0xfb, 0x11], ["type", "type"]],
};

export interface Resolve {
  // A type by name ($bytes, $list, $list.cons …), as an index.
  type(name: string): number;
  func(name: string): number;
  // A global by name (`reason`).
  global(name: string): number;
  // A block type or local type: bytes and text.
  valtype(t: VT): { bytes: number[]; text: string };
}

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
    out.push(...spec[0]);
    spec[1].forEach((kind, i) => {
      const a = args[i];
      if (a === undefined) throw new Error(`${f.name}: ${op} needs ${kind}`);
      switch (kind) {
        case "local": { const j = names.indexOf(a.slice(1)); if (j < 0) throw new Error(`${f.name}: no local ${a}`); out.push(...u(j)); break; }
        case "func": out.push(...u(r.func(a.slice(1)))); break;
        case "global": out.push(...u(r.global(a.slice(1)))); break;
        case "type": { const t = r.type(a.slice(1)); out.push(...(op === "ref.cast" || op === "ref.null" ? sLeb(BigInt(t)) : u(t))); break; }
        case "label": case "u": out.push(...u(Number(a))); break;
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
      return `    ${op}${args.length ? " " + args.map((a) => (a === "void" ? "" : /^[a-z]+$/.test(a) && OPS[op]?.[1].includes("bt") ? `(result ${r.valtype(a as VT).text})` : a)).filter(Boolean).join(" ") : ""}`;
    }),
    "  )",
  ].join("\n");
  return { code, wat };
}

// Instructions for a text constant (array.new_fixed), from its UTF-8 bytes.
export const textBytes = (v: string) => [...new TextEncoder().encode(v)];

// ---- the functions, by name

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
    params: [["t", "text"]], result: "i64", locals: [["i", "i32"], ["n", "i32"]], uses: [],
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
    params: [["t", "text"], ["from", "i64"], ["to", "i64"]], result: "text", locals: [["a", "i32"], ["b", "i32"], ["r", "text"]], uses: ["text.clamp", "text.offset"],
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
  "int.show": {
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
  // Overflow is a trap: the answer would need a big Int (W5).
  "int.add": {
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
  "int.sub": {
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
  "int.mul": {
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
  "int.neg": {
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
  "int.less": { params: [["a", "i64"], ["b", "i64"]], result: "i32", locals: [], uses: [], body: "local.get $a\nlocal.get $b\ni64.lt_s" },
  "int.equal": { params: [["a", "i64"], ["b", "i64"]], result: "i32", locals: [], uses: [], body: "local.get $a\nlocal.get $b\ni64.eq" },
  "int.toNumber": { params: [["a", "i64"]], result: "f64", locals: [], uses: [], body: "local.get $a\nf64.convert_i64_s" },
  "int.abs": {
    params: [["a", "i64"]], result: "i64", locals: [], uses: ["int.neg"],
    body: `
      local.get $a
      i64.const 0
      i64.lt_s
      if i64
        local.get $a
        call $int.neg
      else
        local.get $a
      end`,
  },
  // std.ts's show of a Number: a whole number as its digits, any other
  // rounded to 9 places, written as JavaScript writes it. Done here where
  // that's plain decimals of at most 15 digits (which is then exactly what
  // JavaScript writes), and by the host's `show` otherwise.
  "number.show": {
    params: [["x", "f64"]], result: "text", locals: [["y", "f64"], ["r", "f64"], ["n", "i64"], ["m", "i64"], ["f", "i64"], ["buf", "text"], ["i", "i32"], ["out", "text"], ["y_text", "text"]],
    uses: ["int.show", "text.concat", "host.show", "number.tiny"],
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
          call $int.show
          return
        end
        local.get $x
        call $host.show
        return
      end
      local.get $x
      local.get $x
      f64.ne
      if void
        local.get $x
        call $host.show
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
        local.get $x
        call $host.show
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
        call $int.show
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
        local.get $x
        call $host.show
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
      call $int.show
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
    params: [["r", "f64"]], result: "text", locals: [["d", "text"], ["n", "i32"], ["out", "text"], ["part", "text"]], uses: ["int.show", "text.concat"],
    body: `
      local.get $r
      f64.abs
      i64.trunc_f64_s
      call $int.show
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
  "text.size": { params: [["t", "text"]], result: "i32", locals: [], uses: [], body: "local.get $t\narray.len" },
  "text.byte": { params: [["t", "text"], ["i", "i32"]], result: "i32", locals: [], uses: [], body: "local.get $t\nlocal.get $i\narray.get_u $bytes" },
  // range(n): 0, 1, …, n − 1 (std.ts, run.ts), built from the end. Int's and Number's.
  "int.range": {
    params: [["n", "i64"]], result: "list", locals: [["acc", "list"]], uses: [], list: "std.list<type.int<>>",
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
  "int.quotient": {
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
      i64.div_s ;; the smallest i64 over -1 traps: that needs a big Int
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
  "int.remainder": {
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
  // By squaring, each product checked; a is squared only when a higher
  // power is still to come, so it overflows only when the answer would.
  "int.power": {
    params: [["a", "i64"], ["n", "i64"]], result: "i64", locals: [["r", "i64"]], uses: ["int.mul"], partial: true,
    body: `
      local.get $n
      i64.const 0
      i64.lt_s
      if void
        i64.const 0
        i32.const 1
        return
      end
      i64.const 1
      local.set $r
      block void
      loop void
        local.get $n
        i64.eqz
        br_if 1
        local.get $n
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
        local.get $n
        i64.const 1
        i64.shr_u
        local.tee $n
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
  "int.wholePart": {
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
      i64.trunc_f64_s ;; past 2⁶³ traps: that needs a big Int
      i32.const 0`,
  },
  // Only what show writes: -?(0|[1-9][0-9]*), not -0. Kept at or below
  // zero while reading, so the smallest i64 reads too.
  "int.read": {
    params: [["t", "text"]], result: "i64", locals: [["i", "i32"], ["n", "i32"], ["neg", "i32"], ["c", "i32"], ["m", "i64"]], uses: ["int.mul", "int.sub", "int.neg"], partial: true,
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
        call $int.mul
        local.get $c
        i64.extend_i32_u
        call $int.sub
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
        call $int.neg
      end
      i32.const 0`,
  },
  // The first byte where part's bytes start, as characters before it.
  // UTF-8 can't match inside a character, so bytes find what characters do.
  "text.find": {
    params: [["t", "text"], ["p", "text"]], result: "i64", locals: [["i", "i32"], ["j", "i32"], ["last", "i32"], ["k", "i32"]], uses: [], partial: true,
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
    params: [["t", "text"]], result: "i64", locals: [["n", "i32"], ["c", "i32"], ["k", "i32"], ["i", "i32"]], uses: [], partial: true,
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
    params: [["n", "i64"]], result: "text", locals: [["c", "i32"]], uses: [], partial: true,
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

export const runtime = (name: string): RtFn => {
  const f = R[name] ?? WASI[name];
  if (!f) throw new Error(`no runtime function ${name}`);
  return { name, ...f };
};
export const RUNTIME = Object.keys(R);

// ---- the world over WASI (projectional/WASM.md, W3b-2)
//
// For a module run as a WASI command (wasmtime, node:wasi): the world's
// operations written over wasi_snapshot_preview1, as wasm.ts's "world"
// imports are over JavaScript. They give and fail the same way: an
// operation that fails sets the module's `reason` global, worded as Node's
// world (projectional/src/lang/world.ts) words it, and gives status 2.
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
// A text constant, as instructions.
const lit = (v: string) => { const b = textBytes(v); return [...b.map((x) => `i32.const ${x}`), `array.new_fixed $bytes ${b.length}`].join("\n"); };
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
  // The show of a Number number.show leaves to the host (one needing 15
  // or more digits, or past 2^53): with no JavaScript it traps for now.
  "host.show": { params: [["x", "f64"]], result: "text", locals: [], uses: [], body: "unreachable" },
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
