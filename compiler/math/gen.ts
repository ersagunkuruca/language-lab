// Writes ../src/wasm-math.ts: sin, cos, tan, exp, log, pow and atan2 for
// WebAssembly with no JavaScript host, as V8 computes them (so as Node's
// Math does): V8's port of fdlibm (ieee754.cc here, Sun's and V8's
// notices kept) compiled by clang to WebAssembly's assembly, then turned
// into wasm-rt.ts's runtime functions. Run with clang 18 on the path:
//   node math/gen.ts
// The functions keep their numbers in a memory of their own (memory 1):
// fdlibm's tables at the bottom, a stack for its arrays from the top.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const asm = execFileSync("clang++", [
  "--target=wasm32", "-O2", "-mno-sign-ext", "-mno-nontrapping-fptoint", "-mno-bulk-memory", "-mno-multivalue",
  "-nostdlib", "-nostdinc", "-fno-exceptions", "-std=c++17", "-I", join(here, "inc"), "-S", "-o", "-", join(here, "ieee754.cc"),
], { encoding: "utf8", maxBuffer: 1 << 26 });

// The functions asked for, and what they call.
const ROOTS = ["sin", "cos", "tan", "exp", "log", "pow", "atan2"];
const short = (sym: string) => {
  const m = /^_ZN2v84base7ieee754(?:12_GLOBAL__N_1)?\d+(?:__ieee754_|__kernel_)?([a-z0-9_]+?)(?:_pio2)?E/.exec(sym) ?? /^_Z\d+([a-z]+?)di$/.exec(sym);
  if (!m) throw new Error(`a name: ${sym}`);
  const name = sym.includes("rem_pio2") ? "rem_pio2" : sym.includes("__kernel_") ? `kernel_${m[1]}` : m[1];
  return `math.${name}`;
};

// Data: each symbol at the next address its alignment allows, from 16.
const data: number[] = [];
const addr = new Map<string, number>();
const lines = asm.split("\n");
for (let i = 0, sym = ""; i < lines.length; i++) {
  const l = lines[i].replace(/#.*/, "").trim();
  if (l.startsWith(".section")) sym = /\.(rodata|data|bss)\./.test(l) ? "-" : "";
  if (!sym) continue;
  let m;
  if ((m = /^\.p2align\s+(\d+)/.exec(l))) { while ((16 + data.length) % (1 << Number(m[1]))) data.push(0); }
  else if ((m = /^([\w.]+):$/.exec(l))) { sym = m[1]; addr.set(sym, 16 + data.length); }
  else if ((m = /^\.int(8|32|64)\s+(\S+)/.exec(l))) {
    let v = BigInt.asUintN(Number(m[1]), BigInt(m[2]));
    for (let k = 0; k < Number(m[1]) / 8; k++, v >>= 8n) data.push(Number(v & 0xffn));
  } else if ((m = /^\.zero\s+(\d+)/.exec(l))) data.push(...Array(Number(m[1])).fill(0));
}

// A hex float (0x1.5d93a5acfd57cp-33) as a number JavaScript reads back.
const hexFloat = (t: string) => {
  if (/^-?inf/.test(t)) return t.startsWith("-") ? "-Infinity" : "Infinity";
  if (/^-?nan/.test(t)) return "NaN";
  const m = /^(-?)0x([0-9a-f]+)(?:\.([0-9a-f]*))?p([-+]?\d+)$/i.exec(t);
  if (!m) throw new Error(`a number: ${t}`);
  const frac = m[3] ?? "", mant = BigInt(`0x${m[2]}${frac}`), e = Number(m[4]) - 4 * frac.length;
  // Exact: the mantissa has at most 53 bits, and a power of two scales exactly.
  let v = Number(mant) * 2 ** Math.max(e, -1022);
  if (e < -1022) v *= 2 ** (e + 1022);
  return `${m[1]}${v}`;
};

interface Fn { name: string; params: string[]; result: string; locals: string[]; body: string[]; calls: Set<string> }
const fns = new Map<string, Fn>();
const LOADS = /^(f64|i32|i64)\.(load|store)$/;
for (let i = 0; i < lines.length; i++) {
  const head = /^(_Z\w+):/.exec(lines[i]);
  if (!head || !lines[i + 1]?.includes(".functype")) continue;
  const f: Fn = { name: short(head[1]), params: [], result: "void", locals: [], body: [], calls: new Set() };
  for (i++; i < lines.length; i++) {
    const l = lines[i].replace(/#.*/, "").trim();
    if (!l || l.startsWith(".LBB")) continue;
    let m;
    if ((m = /^\.functype\s+\S+\s+\(([^)]*)\)\s+->\s+\(([^)]*)\)/.exec(l))) { f.params = m[1].split(",").map((x) => x.trim()).filter(Boolean); f.result = m[2].trim() || "void"; continue; }
    if ((m = /^\.local\s+(.*)/.exec(l))) { f.locals = m[1].split(",").map((x) => x.trim()); continue; }
    if (l === "end_function") break;
    const [op, ...rest] = l.split(/\s+/);
    const arg = rest.join(" ");
    const value = (a: string) => { const [, s, off] = /^([\w.]+)([-+]\d+)?$/.exec(a)!; if (!addr.has(s)) throw new Error(`no data ${s}`); return addr.get(s)! + Number(off ?? 0); };
    if (op === "block" || op === "loop" || op === "if") f.body.push(`${op} ${arg || "void"}`);
    else if (op === "end_block" || op === "end_loop" || op === "end_if") f.body.push("end");
    else if (/^local\.(get|set|tee)$/.test(op)) f.body.push(`${op} $l${arg}`);
    else if (/^global\.(get|set)$/.test(op)) { if (arg !== "__stack_pointer") throw new Error(`global ${arg}`); f.body.push(`${op} $msp`); }
    else if (op === "i32.const") f.body.push(`i32.const ${/^-?\d+$/.test(arg) ? arg : value(arg)}`);
    else if (op === "i64.const") f.body.push(`i64.const ${arg}`);
    else if (op === "f64.const") f.body.push(`f64.const ${hexFloat(arg)}`);
    else if (LOADS.test(op)) f.body.push(`${op} $math ${/^\d+$/.test(arg.split(":")[0]) ? arg.split(":")[0] : value(arg.split(":")[0])}`);
    else if (op === "f64.select" || op === "i32.select" || op === "i64.select") f.body.push("select");
    else if (op === "br_table") f.body.push(`br_table ${arg.replace(/[{},]/g, " ").trim().split(/\s+/).join(" ")}`);
    else if (op === "call") { const c = short(arg); f.calls.add(c); f.body.push(`call $${c}`); }
    else f.body.push(arg ? `${op} ${arg}` : op);
  }
  fns.set(f.name, f);
}

const keep = new Set<string>();
const visit = (n: string) => { if (keep.has(n)) return; keep.add(n); fns.get(n)!.calls.forEach(visit); };
ROOTS.forEach((r) => visit(`math.${r}`));

const out = [...keep].map((n) => {
  const f = fns.get(n)!, np = f.params.length;
  return `  "${n}": {
    params: [${f.params.map((t, j) => `["l${j}", "${t}"]`).join(", ")}], result: "${f.result}", locals: [${f.locals.map((t, j) => `["l${np + j}", "${t}"]`).join(", ")}], uses: [${[...f.calls].map((c) => `"${c}"`).join(", ")}],
    body: \`
${f.body.map((x) => `      ${x}`).join("\n")}\`,
  },`;
});

writeFileSync(join(here, "../src/wasm-math.ts"), `// Generated by math/gen.ts from math/ieee754.cc, V8's port of fdlibm
// (Copyright (C) 1993 by Sun Microsystems, Inc.: "Permission to use, copy,
// modify, and distribute this software is freely granted, provided that
// this notice is preserved"; modified by the V8 project authors, BSD
// licence), compiled by clang. Don't edit: change gen.ts and run it.
//
// sin, cos, tan, exp, log, pow and atan2 as V8 (so Node's Math) computes
// them, for WebAssembly with no JavaScript host: the same bits on every
// input. They keep fdlibm's tables and a stack in memory 1, $math.

import type { RtFn } from "./wasm-rt.ts";

// The tables, at MATH_DATA_AT in $math; the stack grows down from its
// end (one page).
export const MATH_DATA_AT = 16;
export const MATH_DATA = [${data.join(", ")}];

export const MATH: Record<string, Omit<RtFn, "name">> = {
${out.join("\n")}
};
`);
console.log(`${keep.size} functions, ${data.length} bytes of tables`);
