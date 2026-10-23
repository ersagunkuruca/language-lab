// WebAssembly for the scalar profile (scalar.ts): Number is f64, Bool is
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
// No dependencies: the binary format is small enough to write directly
// (https://webassembly.github.io/spec/core/binary/), and a text version is
// printed alongside it for reading.

import { S, STD_IMPL } from "../../projectional/src/lang/std.ts";
import { OPS, type LType, type Lowered, type Op, type SExpr, type SFunc, type SType } from "./scalar.ts";

const VAL: Record<SType, number> = { f64: 0x7c, i32: 0x7f };
// WebAssembly takes no records yet: the scalar profile's records are refused
// before anything is printed, so every type here is a scalar one.
const scalar = (t: LType) => t as SType;
const HOST: Partial<Record<Op, { name: string; params: number }>> = {
  sin: { name: "sin", params: 1 }, cos: { name: "cos", params: 1 }, tan: { name: "tan", params: 1 },
  exp: { name: "exp", params: 1 }, log: { name: "log", params: 1 }, pow: { name: "pow", params: 2 }, atan2: { name: "atan2", params: 2 },
  mod: { name: "mod", params: 2 },
};
// The evaluator's own mod (std.ts), imported like Math's, so WASM agrees with it.
const MOD = STD_IMPL[S.mod] as (a: number, b: number) => number;
// float32: to f32 and back, which rounds to the nearest binary32 value.
const INSTR: Partial<Record<Op, [number | number[], string]>> = {
  add: [0xa0, "f64.add"], sub: [0xa1, "f64.sub"], mul: [0xa2, "f64.mul"], div: [0xa3, "f64.div"],
  neg: [0x9a, "f64.neg"], abs: [0x99, "f64.abs"], sqrt: [0x9f, "f64.sqrt"], floor: [0x9c, "f64.floor"],
  float32: [[0xb6, 0xbb], "f32.demote_f64 f64.promote_f32"],
  less: [0x63, "f64.lt"], equal: [0x61, "f64.eq"], beq: [0x46, "i32.eq"], and: [0x71, "i32.and"], or: [0x72, "i32.or"], not: [0x45, "i32.eqz"],
};

export interface Module { bytes: Uint8Array; wat: string; exports: string[] }

export function emitWasm(lowered: Lowered): Module {
  const { funcs } = lowered;
  // Host functions used, in a fixed order: they take the first indices.
  const hosts = (Object.keys(HOST) as Op[]).filter((op) => funcs.some((f) => uses(f.body, op)));
  const hostIndex = new Map(hosts.map((op, i) => [op, i]));
  const fnIndex = (i: number) => hosts.length + i;
  const exportName = (f: SFunc) => f.name;

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

  // Function types: one per distinct signature.
  const sigs: string[] = [];
  const sig = (params: SType[], result: SType) => {
    const key = `${params.join(",")}>${result}`;
    if (!sigs.includes(key)) sigs.push(key);
    return sigs.indexOf(key);
  };
  const hostSig = hosts.map((op) => sig(Array(HOST[op]!.params).fill("f64"), "f64"));
  const funcSig = funcs.map((f) => sig(f.params.map(scalar), scalar(f.result)));
  const typeSec = vec(sigs.map((k) => {
    const [ps, r] = k.split(">");
    return [0x60, ...vec(ps ? ps.split(",").map((p) => [VAL[p as SType]]) : []), ...vec([[VAL[r as SType]]])];
  }));
  const importSec = vec(hosts.map((op, i) => [...str("Math"), ...str(HOST[op]!.name), 0x00, ...u(hostSig[i])]));
  const funcSec = vec(funcSig.map((t) => u(t)));
  // Only what can be called from outside a budget is exported.
  const entries = funcs.map((f, i) => [f, i] as const).filter(([f]) => !f.budgeted);
  const exportSec = vec(entries.map(([f, i]) => [...str(exportName(f)), 0x00, ...u(fnIndex(i))]));
  const fuel = funcs.some((f) => f.spends || budgets(f.body));
  // global 0: the fuel left, an f64 starting at 0.
  const globalSec = vec([[0x7c, 0x01, 0x44, ...f64(0), 0x0b]]);
  const zero = (t: SType) => (t === "f64" ? [0x44, ...f64(0)] : [0x41, 0x00]);
  // fuel = fuel - 1; if fuel < 0, return zero
  const spend = (f: SFunc) => (f.spends ? [0x23, 0x00, 0x44, ...f64(1), 0xa1, 0x24, 0x00, 0x23, 0x00, 0x44, ...f64(0), 0x63, 0x04, 0x40, ...zero(scalar(f.result)), 0x0f, 0x0b] : []);

  function code(e: SExpr): number[] {
    switch (e.k) {
      case "num": return [0x44, ...f64(e.v)];
      case "bool": return [0x41, ...s(e.v ? 1 : 0)];
      case "local": return [0x20, ...u(e.i)];
      case "let": return [...code(e.value), 0x21, ...u(e.i), ...code(e.body)];
      case "if": return [...code(e.cond), 0x04, VAL[scalar(e.t)], ...code(e.then), 0x05, ...code(e.else), 0x0b];
      case "call": return [...e.args.flatMap(code), e.tail ? 0x12 : 0x10, ...u(fnIndex(e.fn))];
      case "make": case "get": throw new Error("WebAssembly takes no records yet");
      case "budget": {
        // save = fuel; fuel = n; res = body; (if fuel < 0 then otherwise else res); fuel = save
        return [
          0x23, 0x00, 0x21, ...u(e.save), 0x44, ...f64(e.n), 0x24, 0x00, ...code(e.body), 0x21, ...u(e.res),
          0x23, 0x00, 0x44, ...f64(0), 0x63, 0x04, VAL[e.t as SType], ...code(e.otherwise), 0x05, 0x20, ...u(e.res), 0x0b,
          0x20, ...u(e.save), 0x24, 0x00,
        ];
      }
      case "op": {
        const args = e.args.flatMap(code);
        if (hostIndex.has(e.op)) return [...args, 0x10, ...u(hostIndex.get(e.op)!)];
        return [...args, ...[INSTR[e.op]![0]].flat()];
      }
    }
  }
  const codeSec = vec(funcs.map((f) => {
    // Locals past the parameters, grouped by runs of the same type.
    const extra = f.locals.slice(f.params.length);
    const groups: number[][] = [];
    for (let i = 0; i < extra.length;) {
      let j = i;
      while (j < extra.length && extra[j] === extra[i]) j++;
      groups.push([...u(j - i), VAL[scalar(extra[i])]]);
      i = j;
    }
    const body = [...vec(groups), ...spend(f), ...code(f.body), 0x0b];
    return [...u(body.length), ...body];
  }));

  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, typeSec), ...(hosts.length ? section(2, importSec) : []), ...section(3, funcSec),
    ...(fuel ? section(6, globalSec) : []), ...section(7, exportSec), ...section(10, codeSec),
  ]);

  // ---- text, for reading
  const id = (f: SFunc) => `$${f.name.replace(/[^\w]+/g, "_")}${funcs.indexOf(f)}`;
  const local = (f: SFunc, i: number) => `$${i < f.params.length ? "p" : "l"}${i}`;
  function wat(e: SExpr, f: SFunc, d: string): string {
    switch (e.k) {
      case "num": return `${d}f64.const ${e.v}`;
      case "bool": return `${d}i32.const ${e.v ? 1 : 0}`;
      case "local": return `${d}local.get ${local(f, e.i)}`;
      case "let": return `${wat(e.value, f, d)}\n${d}local.set ${local(f, e.i)}\n${wat(e.body, f, d)}`;
      case "if": return `${wat(e.cond, f, d)}\n${d}(if (result ${e.t})\n${d}  (then\n${wat(e.then, f, d + "    ")})\n${d}  (else\n${wat(e.else, f, d + "    ")}))`;
      case "call": return [...e.args.map((a) => wat(a, f, d)), `${d}${e.tail ? "return_call" : "call"} ${id(funcs[e.fn])}`].join("\n");
      case "make": case "get": throw new Error("WebAssembly takes no records yet");
      case "budget": return [
        `${d}global.get $fuel`, `${d}local.set ${local(f, e.save)}`, `${d}f64.const ${e.n}`, `${d}global.set $fuel`, wat(e.body, f, d), `${d}local.set ${local(f, e.res)}`,
        `${d}global.get $fuel`, `${d}f64.const 0`, `${d}f64.lt`, `${d}(if (result ${e.t})`, `${d}  (then`, wat(e.otherwise, f, d + "    ") + ")", `${d}  (else`, `${d}    local.get ${local(f, e.res)}))`,
        `${d}local.get ${local(f, e.save)}`, `${d}global.set $fuel`,
      ].join("\n");
      case "op": return [...e.args.map((a) => wat(a, f, d)), `${d}${hostIndex.has(e.op) ? `call $Math.${e.op}` : INSTR[e.op]![1]}`].join("\n");
    }
  }
  const text = [
    "(module",
    ...hosts.map((op) => `  (import "Math" "${HOST[op]!.name}" (func $Math.${op} (param${" f64".repeat(HOST[op]!.params)}) (result f64)))`),
    ...(fuel ? ["  (global $fuel (mut f64) (f64.const 0))"] : []),
    ...funcs.map((f) => {
      const ps = f.params.map((t, i) => ` (param ${local(f, i)} ${t})`).join("");
      const ls = f.locals.slice(f.params.length).map((t, j) => ` (local ${local(f, f.params.length + j)} ${t})`).join("");
      const spends = f.spends ? `    global.get $fuel\n    f64.const 1\n    f64.sub\n    global.set $fuel\n    global.get $fuel\n    f64.const 0\n    f64.lt\n    (if (then ${f.result}.const 0 return))\n` : "";
      return `  ;; ${f.name}\n  (func ${id(f)}${f.budgeted ? "" : ` (export "${exportName(f)}")`}${ps} (result ${f.result})${ls}\n${spends}${wat(f.body, f, "    ")})`;
    }),
    ")",
  ].join("\n");

  return { bytes, wat: text + "\n", exports: entries.map(([f]) => exportName(f)) };
}

function uses(e: SExpr, op: Op): boolean {
  switch (e.k) {
    case "op": return e.op === op || e.args.some((a) => uses(a, op));
    case "if": return uses(e.cond, op) || uses(e.then, op) || uses(e.else, op);
    case "let": return uses(e.value, op) || uses(e.body, op);
    case "call": return e.args.some((a) => uses(a, op));
    case "budget": return uses(e.body, op) || uses(e.otherwise, op);
    default: return false;
  }
}
function budgets(e: SExpr): boolean {
  switch (e.k) {
    case "budget": return true;
    case "op": case "call": return e.args.some(budgets);
    case "if": return budgets(e.cond) || budgets(e.then) || budgets(e.else);
    case "let": return budgets(e.value) || budgets(e.body);
    default: return false;
  }
}

// Instantiate with the host's Math. Bool results come back as 0 or 1.
export async function instantiate(m: Module): Promise<Record<string, (...xs: number[]) => number>> {
  const { instance } = await WebAssembly.instantiate(m.bytes, { Math: { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, pow: Math.pow, atan2: Math.atan2, mod: MOD } });
  return instance.exports as unknown as Record<string, (...xs: number[]) => number>;
}

export { OPS };
