// JavaScript for the scalar profile (scalar.ts): the lowering wasm.ts and
// wgsl.ts print, printed a third time, for a CPU without WebGPU. Float64 is
// a JavaScript number (f64, so results are the evaluator's), Bool is a
// boolean, and a record is an array of its fields. Unlike WebAssembly here,
// it takes records, so a picture whose colour is a record can still be
// drawn on the CPU, frame after frame (editor/picture.ts).
//
// A call to itself as the last step is a loop, as in WGSL; other recursion
// just recurses. Lower with `{ records: true }` to have records. A budget
// (with fuel) is one variable, `fuel`, spent as in WGSL and WebAssembly.

import { noData, type LType, type Lowered, type Op, type RType, type SExpr, type SFunc } from "./scalar.ts";

const INFIX: Partial<Record<Op, string>> = {
  add: "+", sub: "-", mul: "*", div: "/", less: "<", equal: "===", beq: "===", and: "&&", or: "||", iless: "<", ieq: "===",
};
// An Int held in 32 bits (C66c), as in WGSL: wrapped as an i32 wraps, and
// past 32 bits it gives up as a budget running out does (wgsl.ts).
const INT = `const $big = (r) => { if (r > 2147483647 || r < -2147483648) fuel = -1; };
const $iadd = (a, b) => { $big(a + b); return (a + b) | 0; };
const $isub = (a, b) => { $big(a - b); return (a - b) | 0; };
const $imul = (a, b) => { $big(a * b); return Math.imul(a, b); };
const $ineg = (a) => { $big(-a); return -a | 0; };
const $iabs = (a) => { $big(Math.abs(a)); return Math.abs(a) | 0; };
const $iquot = (a, b) => { if (b === 0) { none = true; return 0; } $big(Math.floor(a / b)); return Math.floor(a / b) | 0; };
const $irem = (a, b) => { if (b === 0) { none = true; return 0; } const r = a % b; return r !== 0 && (r < 0) !== (b < 0) ? r + b : r === 0 ? 0 : r; };
const $ipow = (a, n) => { if (n < 0) { none = true; return 0; } let r = 1, b = a, k = n; while (k > 0) { if (k & 1) r = $imul(r, b); k >>= 1; if (k > 0) b = $imul(b, b); } return r; };
const $iwhole = (x) => { if (!Number.isFinite(x)) { none = true; return 0; } const f = Math.floor(x); if (f < -2147483648 || f >= 2147483648) { fuel = -1; return 0; } return f === 0 ? 0 : f; };
`;
const INT_CALL: Partial<Record<Op, string>> = { iadd: "$iadd", isub: "$isub", imul: "$imul", ineg: "$ineg", iabs: "$iabs", iquot: "$iquot", irem: "$irem", ipow: "$ipow", iwhole: "$iwhole" };
const MATH: Partial<Record<Op, string>> = {
  sqrt: "sqrt", abs: "abs", floor: "floor", float32: "fround", sin: "sin", cos: "cos", tan: "tan", exp: "exp", log: "log", pow: "pow", atan2: "atan2",
};

// The source of a function returning every function of the profile, by
// name, and the names.
export function emitJs(lowered: Lowered): { js: string; names: Map<number, string> } {
  const { funcs } = lowered;
  const names = new Map(funcs.map((f, i) => [i, `f${i}`]));
  const text = funcs.map((f, i) => func(f, i));
  const js = `let fuel = 0, none = false;\n${INT}\n${text.join("\n\n")}\nreturn { ${funcs.map((_, i) => names.get(i)).join(", ")} };\n`;
  return { js, names };

  function func(f: SFunc, i: number): string {
    const loops = calls(f.body).some((c) => c.fn === i && c.tail);
    const local = (j: number) => (j < f.params.length ? `p${j}` : `l${j}`);
    let temps = 0;
    const temp = () => `t${temps++}`;

    // An expression, with the statements it needs first.
    function ex(e: SExpr, pre: string[], d: string): string {
      switch (e.k) {
        case "int": return `(${e.v})`;
        // std's Array in a shader (C66c), here a JavaScript array.
        case "rt": {
          const op = /^array\.(\w+)\./.exec(e.fn)?.[1], xs = e.args.map((a) => ex(a, pre, d));
          if (op === "of") return `[${xs.join(", ")}]`;
          if (op === "empty") return "[]";
          if (op === "push") return `[...${xs[0]}, ${xs[1]}]`;
          if (op === "length") return `${xs[0]}.length`;
          if (op === "at") {
            const item = lowered.arrays[Number(/\.a(\d+)$/.exec(e.fn)![1])].item, a = temp(), k = temp();
            pre.push(`${d}const ${a} = ${xs[0]}, ${k} = ${xs[1]};`, `${d}if (${k} < 0 || ${k} >= ${a}.length) none = true;`);
            return `(${k} >= 0 && ${k} < ${a}.length ? ${a}[${k}] : ${zero(item)})`;
          }
          throw new Error(`${e.fn} isn't in shaders`);
        }
        // No answer, and a zero to go on with; first or count by the flag (wgsl.ts).
        case "zero": if (e.none) pre.push(`${d}none = true;`); return zero(e.t);
        case "attempt": {
          const s = temp(), r = temp(), t = temp(), res = local(e.res);
          pre.push(`${d}const ${s} = none;`, `${d}none = false;`, `${d}let ${res};`, ...block(e.body, { set: res }, d));
          pre.push(`${d}const ${r} = none;`, `${d}none = ${s};`, `${d}let ${t};`, `${d}if (${r}) {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}} else {`, ...block(e.ok, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "num": return Object.is(e.v, -0) ? "(-0)" : e.v < 0 ? `(${e.v})` : String(e.v);
        case "bool": return String(e.v);
        case "local": return local(e.i);
        case "let":
          pre.push(`${d}const ${local(e.i)} = ${ex(e.value, pre, d)};`);
          return ex(e.body, pre, d);
        case "if": {
          const c = ex(e.cond, pre, d), t = temp();
          pre.push(`${d}let ${t};`, `${d}if (${c}) {`, ...block(e.then, { set: t }, d + "  "), `${d}} else {`, ...block(e.else, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "make": return `[${e.args.map((a) => ex(a, pre, d)).join(", ")}]`;
        case "get": return `${ex(e.rec, pre, d)}[${e.i}]`;
        case "call": return `${names.get(e.fn)}(${e.args.map((a) => ex(a, pre, d)).join(", ")})`;
        case "budget": {
          const s = temp(), t = temp();
          pre.push(`${d}const ${s} = fuel;`, `${d}fuel = ${e.n};`, `${d}let ${t};`, ...block(e.body, { set: t }, d));
          pre.push(`${d}if (fuel < 0) {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}}`, `${d}fuel = ${s};`);
          return t;
        }
        case "op": {
          const xs = e.args.map((a) => ex(a, pre, d));
          if (INFIX[e.op]) return `(${xs[0]} ${INFIX[e.op]} ${xs[1]})`;
          if (e.op === "neg") return `(-${xs[0]})`;
          if (e.op === "not") return `(!${xs[0]})`;
          if (e.op === "itof") return xs[0];
          if (INT_CALL[e.op]) return `${INT_CALL[e.op]}(${xs.join(", ")})`;
          return `Math.${MATH[e.op]}(${xs.join(", ")})`;
        }
        default: return noData(e);
      }
    }

    // Statements that end by returning e's value, or setting a variable to it.
    function block(e: SExpr, to: { set: string } | "return", d: string): string[] {
      const out: string[] = [];
      if (e.k === "let") {
        out.push(`${d}const ${local(e.i)} = ${ex(e.value, out, d)};`);
        return [...out, ...block(e.body, to, d)];
      }
      if (e.k === "if") {
        const c = ex(e.cond, out, d);
        return [...out, `${d}if (${c}) {`, ...block(e.then, to, d + "  "), `${d}} else {`, ...block(e.else, to, d + "  "), `${d}}`];
      }
      if (to === "return" && e.k === "call" && e.fn === i && e.tail) {
        // The loop's next round: every new value computed before any is set.
        const xs = e.args.map((a) => ex(a, out, d));
        const ts = xs.map((x, j) => (x === `p${j}` ? null : { t: temp(), x, j }));
        for (const t of ts) if (t) out.push(`${d}const ${t.t} = ${t.x};`);
        for (const t of ts) if (t) out.push(`${d}p${t.j} = ${t.t};`);
        return [...out, `${d}continue;`];
      }
      const x = ex(e, out, d);
      return [...out, to === "return" ? `${d}return ${x};` : `${d}${to.set} = ${x};`];
    }

    // One from the budget per call, and per round of the loop.
    const spend = (d: string) => (f.spends ? [`${d}fuel -= 1;`, `${d}if (fuel < 0) return ${zero(f.result)};`] : []);
    const body = loops ? ["  for (;;) {", ...spend("    "), ...block(f.body, "return", "    "), "  }"] : [...spend("  "), ...block(f.body, "return", "  ")];
    return [`// ${f.name.replace(/\n/g, " ")}`, `function ${names.get(i)}(${f.params.map((_, j) => `p${j}`).join(", ")}) {`, ...body, "}"].join("\n");
  }
}

// The functions themselves, by definition id.
export function loadJs(lowered: Lowered): Map<string, (...xs: number[]) => unknown> {
  const { js, names } = emitJs(lowered);
  const all = new Function(js)() as Record<string, (...xs: number[]) => unknown>;
  return new Map(lowered.funcs.map((f, i) => [f.def, all[names.get(i)!]]));
}

// What a function that ran out gives, which the budget around it replaces.
function zero(t: LType): string {
  return t === "f64" || t === "int32" ? "0" : t === "i32" ? "false" : `[${(t as RType).fields.map((x) => zero(x.t)).join(", ")}]`;
}

function calls(e: SExpr): Extract<SExpr, { k: "call" }>[] {
  switch (e.k) {
    case "call": return [e, ...e.args.flatMap(calls)];
    case "op": case "make": return e.args.flatMap(calls);
    case "get": return calls(e.rec);
    case "if": return [...calls(e.cond), ...calls(e.then), ...calls(e.else)];
    case "let": return [...calls(e.value), ...calls(e.body)];
    case "budget": return [...calls(e.body), ...calls(e.otherwise)];
    case "attempt": return [...calls(e.body), ...calls(e.ok), ...calls(e.otherwise)];
    case "rt": return e.args.flatMap(calls);
    default: return [];
  }
}
