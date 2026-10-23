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
export type VT = "i32" | "i64" | "f64" | "text" | "list";

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
}

// Immediates each instruction takes.
type Imm = "local" | "func" | "type" | "label" | "i32" | "i64" | "f64" | "bt" | "u";
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
  "i64.and": [[0x83], []], "i64.or": [[0x84], []], "i64.xor": [[0x85], []],
  "f64.abs": [[0x99], []], "f64.neg": [[0x9a], []], "f64.floor": [[0x9c], []], "f64.add": [[0xa0], []], "f64.sub": [[0xa1], []], "f64.mul": [[0xa2], []], "f64.div": [[0xa3], []],
  "i32.wrap_i64": [[0xa7], []], "i64.extend_i32_s": [[0xac], []], "i64.extend_i32_u": [[0xad], []], "i64.trunc_f64_s": [[0xb0], []], "f64.convert_i64_s": [[0xb9], []],
  "ref.is_null": [[0xd1], []],
  "struct.new": [[0xfb, 0x00], ["type"]], "struct.get": [[0xfb, 0x02], ["type", "u"]], "ref.cast": [[0xfb, 0x16], ["type"]],
  "array.new_default": [[0xfb, 0x07], ["type"]], "array.new_fixed": [[0xfb, 0x08], ["type", "u"]], "array.get_u": [[0xfb, 0x0d], ["type"]],
  "array.set": [[0xfb, 0x0e], ["type"]], "array.len": [[0xfb, 0x0f], []], "array.copy": [[0xfb, 0x11], ["type", "type"]],
};

export interface Resolve {
  // A type by name ($bytes, $list, $list.cons …), as an index.
  type(name: string): number;
  func(name: string): number;
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
        case "type": { const t = r.type(a.slice(1)); out.push(...(op === "ref.cast" ? sLeb(BigInt(t)) : u(t))); break; }
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
    `  (func $${f.name}${f.params.map(([n, t]) => ` (param $${n} ${r.valtype(t).text})`).join("")} (result ${r.valtype(f.result).text})${f.locals.map(([n, t]) => ` (local $${n} ${r.valtype(t).text})`).join("")}`,
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
    uses: ["int.show", "text.concat", "host.show"],
    body: `
      local.get $x
      f64.floor
      local.get $x
      f64.eq
      if void
        local.get $x
        f64.abs
        f64.const 9.2e18
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
      f64.const 1e15
      f64.ge
      local.get $r
      f64.abs
      f64.const 1000
      f64.lt
      local.get $r
      f64.const 0
      f64.ne
      i32.and
      i32.or
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
};

export const runtime = (name: string): RtFn => {
  const f = R[name];
  if (!f) throw new Error(`no runtime function ${name}`);
  return { name, ...f };
};
export const RUNTIME = Object.keys(R);
