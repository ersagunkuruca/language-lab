// WGSL for the scalar profile (scalar.ts): the same lowering wasm.ts
// prints, printed a second time for the GPU. Number is `f32` (GPUs have no
// f64 to speak of, so results are close to the evaluator's, not equal),
// Bool is `bool`, a record is a `struct`, a let is a `let`, and `if` is an
// `if` statement. Lower with `{ records: true }` to have records.
//
// The one rule a shader adds: no recursion, because a GPU has no call
// stack (WGSL forbids a function that reaches itself). A call to itself as
// the very last step is fine, though: that's a loop, so it's printed as
// one (`loop { … continue; }` with the parameters as `var`s). That is how
// the language writes loops anyway, so a ray marcher written as tail
// recursion runs on the GPU as the loop it is. Any other recursion, and
// anything calling it, is refused with the reason, next to the scalar
// profile's own refusals.
//
// What isn't exactly the evaluator's, besides f32: WGSL's `pow` is
// undefined for a negative base, so `pow` goes through a small function
// that gives what JavaScript gives for whole exponents; and a GPU may
// treat NaN and infinities loosely. A loop that never ends (Diverge) can
// make the browser reset the GPU instead of hanging.
//
// The text follows the WGSL spec, https://www.w3.org/TR/WGSL/.

import type { Id } from "../../projectional/src/model.ts";
import type { LType, Lowered, Op, RType, SExpr, SFunc } from "./scalar.ts";

export interface ShaderFunc { def: Id; name: string; wgsl: string; params: LType[]; result: LType }
// structs: the WGSL name of each record type and of its fields.
export interface Shader { wgsl: string; funcs: ShaderFunc[]; refused: Map<Id, string>; structs: Map<string, { name: string; fields: string[] }> }
const INFIX: Partial<Record<Op, string>> = {
  add: "+", sub: "-", mul: "*", div: "/", less: "<", equal: "==", beq: "==", and: "&&", or: "||",
};
const CALL: Partial<Record<Op, string>> = {
  sqrt: "sqrt", abs: "abs", floor: "floor", sin: "sin", cos: "cos", tan: "tan", exp: "exp", log: "log", atan2: "atan2",
};

// JavaScript's pow for a negative base and a whole exponent; WGSL leaves
// pow(x, y) undefined for x < 0, and for x = 0 when y ≤ 0.
const POW = `fn lab_pow(x: f32, y: f32) -> f32 {
  if (y == 0.0) { return 1.0; }
  if (x > 0.0) { return pow(x, y); }
  if (x == 0.0) { return select(1.0 / x, 0.0, y > 0.0); }
  if (floor(y) != y) { return sqrt(x); } // NaN, as in JavaScript
  let r = pow(-x, y);
  return select(-r, r, floor(y * 0.5) == y * 0.5);
}`;

export function emitWgsl(lowered: Lowered): Shader {
  const { funcs } = lowered;
  const refused = new Map(lowered.refused);
  const bad = new Map<number, string>();

  // Numbers a shader can't write down.
  funcs.forEach((f, i) => {
    const n = numbers(f.body).find((v) => !Number.isFinite(v) || Math.abs(v) > 3.4e38);
    if (n !== undefined) bad.set(i, `uses ${n}, which a shader's f32 can't hold`);
  });

  // Recursion: edges of the call graph, leaving out calls to itself in tail
  // position (those become loops). A function on a cycle is refused.
  const edges = funcs.map((f, i) => calls(f.body).filter((c) => !(c.fn === i && c.tail)).map((c) => c.fn));
  funcs.forEach((f, i) => {
    if (bad.has(i)) return;
    // Is i reachable from its own callees?
    const seen = new Set<number>(), todo = [...edges[i]];
    while (todo.length) {
      const j = todo.pop()!;
      if (j === i) { bad.set(i, "is recursive in a way that isn't a loop (a GPU has no call stack; only calling itself as the last step becomes a loop)"); return; }
      if (!seen.has(j)) { seen.add(j); todo.push(...edges[j]); }
    }
  });
  // And whatever calls a refused function, until nothing changes.
  for (let changed = true; changed;) {
    changed = false;
    funcs.forEach((f, i) => {
      if (bad.has(i)) return;
      const j = edges[i].find((j) => bad.has(j));
      if (j !== undefined) { bad.set(i, `calls ${funcs[j].name}, which ${bad.get(j)}`); changed = true; }
    });
  }
  for (const [i, why] of bad) refused.set(funcs[i].def, why);

  const kept = funcs.map((_, i) => i).filter((i) => !bad.has(i));
  const used = new Set<string>();
  const ident = (name: string, suffix: string) => {
    let base = name.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "f";
    if (/^\d/.test(base)) base = `f_${base}`;
    let n = `${base}${suffix}`;
    while (used.has(n)) n += "_";
    used.add(n);
    return n;
  };
  const wname = new Map(kept.map((i) => [i, ident(funcs[i].name, `_${i}`)]));

  // Structs for the records the kept functions use, each after the ones
  // its fields need.
  const structs = new Map<string, { name: string; fields: string[] }>();
  const structText: string[] = [];
  const struct = (r: RType): string => {
    if (!structs.has(r.key)) {
      const ts = r.fields.map((f) => tname(f.t));
      const fieldNames = new Set<string>();
      const fields = r.fields.map((f) => {
        let n = f.name.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "f";
        if (/^\d/.test(n)) n = `f_${n}`;
        while (fieldNames.has(n) || n === "self") n += "_";
        fieldNames.add(n);
        return n;
      });
      const name = ident(r.name, `_${structs.size}`);
      structs.set(r.key, { name, fields });
      structText.push(`// ${r.name}\nstruct ${name} {\n${fields.map((n, j) => `  ${n}: ${ts[j]},`).join("\n")}\n}`);
    }
    return structs.get(r.key)!.name;
  };
  function tname(t: LType): string {
    return t === "f64" ? "f32" : t === "i32" ? "bool" : struct(t);
  }
  for (const i of kept) for (const t of [...funcs[i].locals, funcs[i].result]) tname(t);

  const text = kept.map((i) => func(funcs[i], i));
  const needsPow = kept.some((i) => usesOp(funcs[i].body, "pow"));
  const wgsl = [
    "// Generated from the scalar profile by compiler/src/wgsl.ts.",
    ...(needsPow ? [POW] : []),
    ...structText,
    ...text,
  ].join("\n\n") + "\n";
  return {
    wgsl,
    funcs: kept.map((i) => ({ def: funcs[i].def, name: funcs[i].name, wgsl: wname.get(i)!, params: funcs[i].params, result: funcs[i].result })),
    refused,
    structs,
  };

  function func(f: SFunc, i: number): string {
    const loops = calls(f.body).some((c) => c.fn === i && c.tail);
    const local = (j: number) => (j < f.params.length ? `p${j}` : `l${j}`);
    let temps = 0;
    const temp = () => `t${temps++}`;

    // An expression, with the statements it needs first (an `if` in the
    // middle of an expression becomes a `var` set by an if statement).
    function ex(e: SExpr, pre: string[], d: string): string {
      switch (e.k) {
        case "num": return num(e.v);
        case "bool": return String(e.v);
        case "local": return local(e.i);
        case "let":
          pre.push(`${d}let ${local(e.i)} = ${bare(ex(e.value, pre, d))};`);
          return ex(e.body, pre, d);
        case "if": {
          const c = ex(e.cond, pre, d), t = temp();
          pre.push(`${d}var ${t}: ${tname(e.t)};`, `${d}if (${bare(c)}) {`, ...block(e.then, { set: t }, d + "  "), `${d}} else {`, ...block(e.else, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "make": return `${tname(e.t)}(${e.args.map((a) => bare(ex(a, pre, d))).join(", ")})`;
        case "get": {
          const r = ex(e.rec, pre, d);
          struct(e.t);
          return `${r}.${structs.get(e.t.key)!.fields[e.i]}`;
        }
        case "call": return `${wname.get(e.fn)}(${e.args.map((a) => bare(ex(a, pre, d))).join(", ")})`;
        case "op": {
          const xs = e.args.map((a) => ex(a, pre, d));
          if (INFIX[e.op]) return `(${xs[0]} ${INFIX[e.op]} ${xs[1]})`;
          if (e.op === "neg") return `(-${xs[0]})`;
          if (e.op === "not") return `(!${xs[0]})`;
          if (e.op === "pow") {
            const y = e.args[1];
            // x², x³, x⁴ as products, which is what they are.
            if (y.k === "num" && [2, 3, 4].includes(y.v) && e.args[0].k === "local") return `(${Array(y.v).fill(xs[0]).join(" * ")})`;
            return `lab_pow(${xs.map(bare).join(", ")})`;
          }
          return `${CALL[e.op]}(${xs.map(bare).join(", ")})`;
        }
      }
    }

    // Statements that end by returning e's value, or setting a variable to it.
    function block(e: SExpr, to: { set: string } | "return", d: string): string[] {
      const out: string[] = [];
      if (e.k === "let") {
        out.push(`${d}let ${local(e.i)} = ${bare(ex(e.value, out, d))};`);
        return [...out, ...block(e.body, to, d)];
      }
      if (e.k === "if") {
        const c = ex(e.cond, out, d);
        return [...out, `${d}if (${bare(c)}) {`, ...block(e.then, to, d + "  "), `${d}} else {`, ...block(e.else, to, d + "  "), `${d}}`];
      }
      if (to === "return" && e.k === "call" && e.fn === i && e.tail) {
        // The loop's next round: new values for the parameters, all
        // computed before any is changed.
        const xs = e.args.map((a) => ex(a, out, d));
        const ts = xs.map((x, j) => (x === `p${j}` ? null : { t: temp(), x, j }));
        for (const t of ts) if (t) out.push(`${d}let ${t.t} = ${bare(t.x)};`);
        for (const t of ts) if (t) out.push(`${d}p${t.j} = ${t.t};`);
        return [...out, `${d}continue;`];
      }
      const x = ex(e, out, d);
      return [...out, to === "return" ? `${d}return ${bare(x)};` : `${d}${to.set} = ${bare(x)};`];
    }

    const sig = `fn ${wname.get(i)}(${f.params.map((t, j) => `${loops ? "a" : "p"}${j}: ${tname(t)}`).join(", ")}) -> ${tname(f.result)}`;
    const body = loops
      ? [...f.params.map((t, j) => `  var p${j} = a${j};`), "  loop {", ...block(f.body, "return", "    "), "  }"]
      : block(f.body, "return", "  ");
    return [`// ${f.name}`, `${sig} {`, ...body, "}"].join("\n");
  }
}

// x without the parentheses around all of it, if it has them.
function bare(x: string): string {
  if (!x.startsWith("(") || !x.endsWith(")")) return x;
  let depth = 0;
  for (let j = 0; j < x.length - 1; j++) {
    if (x[j] === "(") depth++;
    else if (x[j] === ")" && --depth === 0) return x;
  }
  return x.slice(1, -1);
}

// A number as a WGSL float literal.
function num(v: number): string {
  const s = String(Math.abs(v));
  const lit = /[.e]/.test(s) ? s : `${s}.0`;
  return v < 0 || Object.is(v, -0) ? `(-${lit})` : lit;
}

function calls(e: SExpr): Extract<SExpr, { k: "call" }>[] {
  return [...(e.k === "call" ? [e] : []), ...kids(e).flatMap(calls)];
}
function numbers(e: SExpr): number[] {
  return [...(e.k === "num" ? [e.v] : []), ...kids(e).flatMap(numbers)];
}
function usesOp(e: SExpr, op: Op): boolean {
  return (e.k === "op" && e.op === op) || kids(e).some((k) => usesOp(k, op));
}
function kids(e: SExpr): SExpr[] {
  switch (e.k) {
    case "op": case "call": case "make": return e.args;
    case "get": return [e.rec];
    case "if": return [e.cond, e.then, e.else];
    case "let": return [e.value, e.body];
    default: return [];
  }
}
