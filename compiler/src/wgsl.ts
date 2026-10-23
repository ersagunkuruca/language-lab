// WGSL for the scalar profile (scalar.ts): the same lowering wasm.ts
// prints, printed a second time for the GPU. Number is `f32` (GPUs have no
// f64 to speak of, so results are close to the evaluator's, not equal),
// Bool is `bool`, a record is a `struct`, a let is a `let`, and `if` is an
// `if` statement. Lower with `{ records: true }` to have records.
//
// A record of two to four Numbers (a point, a direction, a colour) is
// stored as a WGSL vector instead, `vec2f` to `vec4f`, its fields in order
// as .x .y .z .w. The program doesn't say "vector": that's how this target
// stores such a record, the way Peano naturals are stored as Ints
// (projectional/NUMBERS.md). Building one whose parts each do the same
// thing to the same part of other vectors, which is how arithmetic on a
// record is written field by field, prints as one vector expression:
// `colour(red(a) + t · (red(b) − red(a)), …green…, …blue…)` is
// `mix(a, b, t)`. This is superword-level parallelism (Larsen and
// Amarasinghe, PLDI 2000) on a tree instead of a basic block. A sum of the
// parts' products is `dot`, its square root `length`, a vector over its
// length `normalize`, and `smaller`/`larger`/`clamp` written as ifs are
// `min`/`max`/`clamp`. On today's GPUs the speed-up is small (each thread
// is scalar, and drivers split vector maths into parts again); what it
// buys is the built-ins (dot, normalize, mix) and a shader that reads like
// the maths. A record whose fields aren't all Numbers is still a struct.
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
// treat NaN and infinities loosely.
//
// Nothing that might not finish gets here (scalar.ts refuses Diverge
// outside a budget). A budget is one private f32, `lab_fuel`: a function
// the checker couldn't see end takes one from it on each call and each
// round of its loop, and once it's below 0 returns at once with a zero
// value, so everything under the budget unwinds quickly. The budget then
// gives its fallback.
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
// Records of 2 to 4 Numbers are vectors; their fields are these.
const XYZW = ["x", "y", "z", "w"];
export function vectorWidth(t: LType): number {
  return typeof t !== "string" && t.fields.length >= 2 && t.fields.length <= 4 && t.fields.every((f) => f.t === "f64") ? t.fields.length : 0;
}

// The same operation on every part of a vector, written once.
type VOp = Op | "min" | "max";
type V =
  | { k: "whole"; e: SExpr }        // an expression whose value is a vector
  | { k: "splat"; e: SExpr }        // one Number for every part
  | { k: "lit"; vs: number[] }      // a number for each part
  | { k: "op"; op: VOp; args: V[] };
const ELEMENTWISE = new Set<Op>(["add", "sub", "mul", "div", "neg", "sqrt", "abs", "floor", "sin", "cos", "tan", "exp", "log", "atan2"]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const CALL: Partial<Record<Op, string>> = {
  sqrt: "sqrt", abs: "abs", floor: "floor", sin: "sin", cos: "cos", tan: "tan", exp: "exp", log: "log", atan2: "atan2", mod: "lab_mod",
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

// The evaluator's mod: the remainder takes the sign of b (WGSL's % takes
// a's), so mod(−1, 3) is 2, as in std.ts.
const MOD = `fn lab_mod(a: f32, b: f32) -> f32 {
  return a - b * floor(a / b);
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
    const width = vectorWidth(r);
    if (width && !structs.has(r.key)) {
      structs.set(r.key, { name: `vec${width}f`, fields: XYZW.slice(0, width) });
      structText.push(`// ${r.name} is a vec${width}f: ${r.fields.map((f, j) => `${f.name} is .${XYZW[j]}`).join(", ")}.`);
    }
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

  // The parts of a vector, each doing the same thing to the same part of
  // other vectors (or to one Number shared by all), as one vector
  // expression; null if they don't.
  function lift(cs: SExpr[], depth = 0): V | null {
    cs = cs.map(unlet);
    const n = cs.length, c = cs[0];
    if (cs.every((x, j) => x.k === "get" && vectorWidth(x.t) === n && x.i === j && same(x.rec, (c as typeof x).rec))) return { k: "whole", e: (c as Extract<SExpr, { k: "get" }>).rec };
    if (cs.every((x) => same(x, c))) return { k: "splat", e: c };
    if (cs.every((x) => x.k === "num")) return { k: "lit", vs: cs.map((x) => (x as { v: number }).v) };
    // The same function on each part: look inside it, when it's one
    // expression that uses each input once (clamp, smaller, …).
    if (depth < 8 && cs.every((x) => x.k === "call" && x.fn === (c as typeof x).fn)) {
      const ys = cs.map((x) => inline(x as Extract<SExpr, { k: "call" }>));
      return ys.every((y) => y) ? lift(ys as SExpr[], depth + 1) : null;
    }
    const ops = cs.map((x) => (x.k === "op" && ELEMENTWISE.has(x.op) ? { op: x.op as VOp, args: x.args } : minmax(x)));
    const o = ops[0];
    if (!o || !ops.every((p) => p && p.op === o.op && p.args.length === o.args.length)) return null;
    const args = o.args.map((_, j) => lift(ops.map((p) => p!.args[j]), depth));
    return args.every((a) => a) ? { k: "op", op: o.op, args: args as V[] } : null;
  }
  // A call's body with its inputs put in, if the body is one expression
  // (no lets, no loop) that uses each input at most once.
  function inline(c: Extract<SExpr, { k: "call" }>): SExpr | null {
    const f = funcs[c.fn];
    if (bad.has(c.fn) || calls(f.body).some((x) => x.fn === c.fn)) return null;
    const uses = new Map<number, number>();
    const put = (e: SExpr): SExpr | null => {
      switch (e.k) {
        case "local":
          if (e.i >= f.params.length) return null;
          uses.set(e.i, (uses.get(e.i) ?? 0) + 1);
          return c.args[e.i];
        case "num": case "bool": return e;
        case "let": case "budget": return null;
        case "if": {
          const m = minmax(e);
          if (m) {
            // Each side is used once, by min or max.
            const [a, b] = m.args.map(put);
            if (!a || !b) return null;
            const [then, other] = m.op === "min" ? [a, b] : [b, a];
            return { ...e, cond: { k: "op", op: "less", args: [a, b] }, then, else: other };
          }
          const [x, y, z] = [put(e.cond), put(e.then), put(e.else)];
          return x && y && z ? { ...e, cond: x, then: y, else: z } : null;
        }
        case "get": { const r = put(e.rec); return r && { ...e, rec: r }; }
        case "op": case "call": case "make": { const xs = e.args.map(put); return xs.every((x) => x) ? { ...e, args: xs as SExpr[] } : null; }
      }
    };
    const body = put(f.body);
    const atom = (e: SExpr) => e.k === "local" || e.k === "num" || e.k === "bool";
    return body && [...uses].every(([j, k]) => k === 1 || atom(c.args[j])) ? body : null;
  }
  // smaller and larger, written as `if a < b then a else b` (or b, a).
  // A sum of one term per part of a vector, each the same thing on that
  // part: dot(a, b) for a sum of products, dot(v, 1) for a plain sum.
  function dotOf(e: SExpr): { n: number; dot: V[]; length?: undefined } | null {
    const terms: SExpr[] = [];
    const flat = (x: SExpr) => (x.k === "op" && x.op === "add" ? x.args.forEach(flat) : terms.push(x));
    flat(e);
    const n = terms.length;
    if (n < 2 || n > 4) return null;
    const part = (x: SExpr): number => {
      const ps = new Set(gets(x).filter((g) => vectorWidth(g.t) === n).map((g) => g.i));
      return ps.size === 1 ? [...ps][0] : -1;
    };
    terms.splice(0, n, ...terms.map(unlet));
    const ordered: SExpr[] = [];
    for (const t of terms) { const j = part(t); if (j < 0 || ordered[j]) return null; ordered[j] = t; }
    const v = lift(ordered);
    if (!v || !hasWhole(v)) return null;
    return { n, dot: v.k === "op" && v.op === "mul" ? v.args : [v, { k: "splat", e: { k: "num", v: 1 } }] };
  }
  // √(x · x + y · y + z · z) of a vector is its length.
  function lengthOf(e: SExpr | null): { n: number; length: V; dot?: undefined } | null {
    if (e?.k !== "op" || e.op !== "sqrt") return null;
    const a = e.args[0];
    const p = dotOf((a.k === "call" && inline(a)) || a);
    return p && same(p.dot[0], p.dot[1]) ? { n: p.n, length: p.dot[0] } : null;
  }

  const text = kept.map((i) => func(funcs[i], i));
  const needsPow = kept.some((i) => usesOp(funcs[i].body, "pow"));
  const needsMod = kept.some((i) => usesOp(funcs[i].body, "mod"));
  const needsFuel = kept.some((i) => funcs[i].spends || budgets(funcs[i].body));
  const wgsl = [
    "// Generated from the scalar profile by compiler/src/wgsl.ts.",
    ...(needsPow ? [POW] : []),
    ...(needsMod ? [MOD] : []),
    ...(needsFuel ? ["// What's left of the innermost budget: below 0 once it ran out.\nvar<private> lab_fuel: f32;"] : []),
    ...structText,
    ...text,
  ].join("\n\n") + "\n";
  return {
    wgsl,
    // Only what can be called from outside a budget is a place to start.
    funcs: kept.filter((i) => !funcs[i].budgeted).map((i) => ({ def: funcs[i].def, name: funcs[i].name, wgsl: wname.get(i)!, params: funcs[i].params, result: funcs[i].result })),
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
          const m = minmax(e);
          if (m) return `${m.op}(${m.args.map((a) => bare(ex(a, pre, d))).join(", ")})`;
          const c = ex(e.cond, pre, d), t = temp();
          pre.push(`${d}var ${t}: ${tname(e.t)};`, `${d}if (${bare(c)}) {`, ...block(e.then, { set: t }, d + "  "), `${d}} else {`, ...block(e.else, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "make": {
          const v = vectorWidth(e.t) ? lift(e.args) : null;
          // wide: a record whose parts are all one Number is that Number spread.
          if (v) return vtext(v, e.args.length, pre, d, true);
          return `${tname(e.t)}(${e.args.map((a) => bare(ex(a, pre, d))).join(", ")})`;
        }
        case "get": {
          const r = ex(e.rec, pre, d);
          struct(e.t);
          return `${r}.${structs.get(e.t.key)!.fields[e.i]}`;
        }
        case "call": return `${wname.get(e.fn)}(${e.args.map((a) => bare(ex(a, pre, d))).join(", ")})`;
        case "budget": {
          const s = temp(), t = temp();
          pre.push(`${d}let ${s} = lab_fuel;`, `${d}lab_fuel = ${num(e.n)};`, `${d}var ${t}: ${tname(e.t)};`, ...block(e.body, { set: t }, d));
          pre.push(`${d}if (lab_fuel < 0.0) {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}}`, `${d}lab_fuel = ${s};`);
          return t;
        }
        case "op": {
          const v = e.op === "add" ? dotOf(e) : e.op === "sqrt" ? lengthOf(e) : null;
          if (v) return v.length ? `length(${bare(vtext(v.length, v.n, pre, d, true))})` : `dot(${v.dot.map((x) => bare(vtext(x, v.n, pre, d, true))).join(", ")})`;
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
      if (e.k === "if" && !minmax(e)) {
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

    // A vector expression's text. `wide` where a function needs a vector
    // (min, mix, …): a single Number is then spread over the parts.
    function vtext(v: V, n: number, pre: string[], d: string, wide = false): string {
      const vec = `vec${n}f`;
      switch (v.k) {
        case "whole": return ex(v.e, pre, d);
        case "splat": { const x = ex(v.e, pre, d); return wide ? `${vec}(${bare(x)})` : x; }
        case "lit": return `${vec}(${v.vs.map((x) => bare(num(x))).join(", ")})`;
        case "op": {
          const w = (x: V) => bare(vtext(x, n, pre, d, true));
          const [a, b] = v.args;
          // a + t · (b′ − a) is mix(a, b′, t).
          if (v.op === "add" && b.k === "op" && b.op === "mul") {
            const [t, diff] = b.args[1].k === "op" && b.args[1].op === "sub" ? b.args : [b.args[1], b.args[0]];
            if (t.k === "splat" && diff.k === "op" && diff.op === "sub" && same(diff.args[1], a)) return `mix(${w(a)}, ${w(diff.args[0])}, ${bare(ex(t.e, pre, d))})`;
          }
          // min(max(x, lo), hi) is clamp(x, lo, hi).
          if (v.op === "min" && a.k === "op" && a.op === "max") return `clamp(${w(a.args[0])}, ${w(a.args[1])}, ${w(b)})`;
          // x / |x| is normalize(x).
          if (v.op === "div" && b.k === "splat") {
            const l = lengthOf(b.e.k === "call" ? inline(b.e) : b.e);
            if (l && same(l.length, a)) return `normalize(${w(a)})`;
          }
          if (v.op === "min" || v.op === "max") return `${v.op}(${v.args.map(w).join(", ")})`;
          if (INFIX[v.op]) return `(${vtext(a, n, pre, d)} ${INFIX[v.op]} ${vtext(b, n, pre, d)})`;
          if (v.op === "neg") return `(-${vtext(a, n, pre, d)})`;
          return `${CALL[v.op]}(${v.args.map(w).join(", ")})`;
        }
      }
    }

    // One from the budget per call, and per round of the loop.
    const spend = (d: string) => (f.spends ? [`${d}lab_fuel = lab_fuel - 1.0;`, `${d}if (lab_fuel < 0.0) { return ${tname(f.result)}(); }`] : []);
    const sig = `fn ${wname.get(i)}(${f.params.map((t, j) => `${loops ? "a" : "p"}${j}: ${tname(t)}`).join(", ")}) -> ${tname(f.result)}`;
    const body = loops
      ? [...f.params.map((t, j) => `  var p${j} = a${j};`), "  loop {", ...spend("    "), ...block(f.body, "return", "    "), "  }"]
      : [...spend("  "), ...block(f.body, "return", "  ")];
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
function budgets(e: SExpr): boolean {
  return e.k === "budget" || kids(e).some(budgets);
}
function usesOp(e: SExpr, op: Op): boolean {
  return (e.k === "op" && e.op === op) || kids(e).some((k) => usesOp(k, op));
}
// smaller and larger, written as `if a < b then a else b` (or b, a).
function minmax(e: SExpr): { op: "min" | "max"; args: SExpr[] } | null {
  if (e.k !== "if" || e.t !== "f64" || e.cond.k !== "op" || e.cond.op !== "less") return null;
  const [a, b] = e.cond.args;
  if (same(e.then, a) && same(e.else, b)) return { op: "min", args: [a, b] };
  if (same(e.then, b) && same(e.else, a)) return { op: "max", args: [a, b] };
  return null;
}
// e without its lets of something cheap (a variable, a number, a part of
// a variable), of something used once, or of what a min or max then uses
// once: what a part looks like when written by hand, so the parts
// `map parts` writes line up for lift.
function unlet(e: SExpr): SExpr {
  if (e.k !== "let") return e;
  const v = e.value;
  const cheap = v.k === "local" || v.k === "num" || v.k === "bool" || (v.k === "get" && v.rec.k === "local");
  return cheap || uses(e.body, e.i) <= 1 || minmax(e.body) ? unlet(put(e.body, e.i, v)) : e;
}
function uses(e: SExpr, i: number): number {
  return (e.k === "local" && e.i === i ? 1 : 0) + kids(e).reduce((n, k) => n + uses(k, i), 0);
}
// e with local i replaced by v.
function put(e: SExpr, i: number, v: SExpr): SExpr {
  switch (e.k) {
    case "local": return e.i === i ? v : e;
    case "num": case "bool": return e;
    case "op": case "call": case "make": return { ...e, args: e.args.map((a) => put(a, i, v)) };
    case "get": return { ...e, rec: put(e.rec, i, v) };
    case "if": return { ...e, cond: put(e.cond, i, v), then: put(e.then, i, v), else: put(e.else, i, v) };
    case "let": return { ...e, value: put(e.value, i, v), body: put(e.body, i, v) };
    case "budget": return { ...e, body: put(e.body, i, v), otherwise: put(e.otherwise, i, v) };
  }
}
function gets(e: SExpr): Extract<SExpr, { k: "get" }>[] {
  return [...(e.k === "get" ? [e] : []), ...kids(e).flatMap(gets)];
}
function hasWhole(v: V): boolean {
  return v.k === "whole" || (v.k === "op" && v.args.some(hasWhole));
}
function kids(e: SExpr): SExpr[] {
  switch (e.k) {
    case "op": case "call": case "make": return e.args;
    case "get": return [e.rec];
    case "if": return [e.cond, e.then, e.else];
    case "let": return [e.value, e.body];
    case "budget": return [e.body, e.otherwise];
    default: return [];
  }
}
