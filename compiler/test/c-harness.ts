// The C harness the C tests share (c.test.ts, and fuzz.test.ts): the
// program built with the warnings the tests keep, each call's inputs
// written to its standard input and its answers read back, with the cells
// still live after each.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bool, type Value } from "../../ters/src/lang/run.ts";
import { norm } from "../../ters/src/lang/int.ts";
import { TRUE } from "../../ters/src/lang/std.ts";
import { isRecord, type DType, type LType, type CoreIR, type RType } from "../src/scalar.ts";
import { CFLAGS, emitC } from "../src/c.ts";

export const cc = process.env.CC ?? "cc";
let have = true;
try { execFileSync(cc, ["--version"], { stdio: "ignore" }); } catch { have = false; }
export const skip = have ? false : `no C compiler (${cc})`;
export const dir = mkdtempSync(join(tmpdir(), "native-"));
let builds = 0;

type Data = { tag: string; fields: Value[] };
export const hex = (x: number) => new BigUint64Array(new Float64Array([x]).buffer)[0].toString(16);
const unhex = (w: string) => new Float64Array(new BigUint64Array([BigInt(`0x${w}`)]).buffer)[0];
// A value as the harness reads it; data along its last field with a loop.
export function encode(v: Value, t: LType, out: string[]): void {
  if (t === "f64") { out.push(hex(v as number)); return; }
  if (t === "i32") { out.push((v as Data).tag === TRUE ? "1" : "0"); return; }
  if (t === "int") { out.push(String(v)); return; }
  if (t === "text") { out.push(`x${Buffer.from(v as string).toString("hex")}`); return; }
  if (isRecord(t)) { t.fields.forEach((f, j) => encode((v as Data).fields[j], f.t, out)); return; }
  const d = t as DType;
  for (let x = v as Data; ;) {
    const j = d.cases.findIndex((c) => c.variant === x.tag), c = d.cases[j];
    out.push(String(j));
    const self = c.fields.length > 0 && c.fields.at(-1)!.t === d;
    c.fields.forEach((f, k) => { if (!(self && k === c.fields.length - 1)) encode(x.fields[k], f.t, out); });
    if (!self) return;
    x = x.fields.at(-1) as Data;
  }
}
export function decode(ws: string[], t: LType): Value {
  if (t === "f64") return unhex(ws.shift()!);
  if (t === "i32") return bool(ws.shift() === "1");
  if (t === "int") return norm(BigInt(ws.shift()!));
  if (t === "text") return Buffer.from(ws.shift()!.slice(1), "hex").toString();
  if (isRecord(t)) return { tag: (t as RType).variant, fields: t.fields.map((f) => decode(ws, f.t)) };
  const d = t as DType, top: Data = { tag: "", fields: [] };
  for (let into = top; ;) {
    const c = d.cases[Number(ws.shift())];
    const self = c.fields.length > 0 && c.fields.at(-1)!.t === d;
    const x: Data = { tag: c.variant, fields: c.fields.map((f, k) => (self && k === c.fields.length - 1 ? null : decode(ws, f.t))) as Value[] };
    into.fields.push(x);
    if (!self) return top.fields[0];
    x.fields.pop();
    into = x;
  }
}

// The program built, and a function that makes the calls and gives back
// each answer, with the cells still live after it.
export const compile = (c: string) => {
  const src = join(dir, `p${builds}.c`), exe = join(dir, `p${builds++}`);
  writeFileSync(src, c);
  // GCC can't see that a cell freed at count 1 is never a static one (whose count is 0): -Wno-free-nonheap-object.
  execFileSync(cc, [...CFLAGS, "-pthread", "-Wall", "-Werror", "-Wno-unknown-warning-option", "-Wno-unused-function", "-Wno-maybe-uninitialized", "-Wno-free-nonheap-object", "-Wno-unused-but-set-variable", "-Wno-unused-variable", "-Wno-unknown-pragmas", ...(process.env.NATIVE_CFLAGS ?? "").split(" ").filter(Boolean), "-o", exe, src, "-lm"]);
  return exe;
};
// sin, cos and the rest are fdlibm's here, the same bits as the evaluator's
// (Node's Math), so a test can compare to the bit; the platform's libm,
// within a few ulp (C144), is checked by c.test.ts on its own.
export function build(lowered: CoreIR, math: "platform" | "fdlibm" = "fdlibm") {
  const exe = compile(emitC(lowered, { harness: true, math }).c);
  return (calls: [number, Value[]][]) => {
    const input = calls.map(([i, xs]) => { const out = [String(i)]; xs.forEach((x, j) => encode(x, lowered.funcs[i].params[j], out)); return out.join(" "); }).join("\n") + "\n";
    const lines = execFileSync(exe, { input, maxBuffer: 1 << 28 }).toString().trim().split("\n");
    return lines.map((l, k) => {
      const ws = l.trim().split(/\s+/);
      const live = Number(ws.pop()!.slice(1));
      // "?": no answer (a function with one answer or none).
      // "!": aborted, with the reason.
      const value = ws[0] === "?" ? undefined : ws[0] === "!" ? { aborted: decode(ws.slice(1), "text") } : decode(ws, lowered.funcs[calls[k][0]].result);
      return { value: value as Value, live };
    });
  };
}
