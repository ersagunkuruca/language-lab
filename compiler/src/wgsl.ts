// WGSL for the scalar profile (scalar.ts): the same lowering wasm.ts
// prints, printed a second time for the GPU. Float64 is `f32` (GPUs have no
// f64 to speak of, so results are close to the evaluator's, not equal),
// Bool is `bool`, a record is a `struct`, a let is a `let`, and `if` is an
// `if` statement. Lower with `{ records: true }` to have records, and with
// `{ shader: true }` to have Ints as `i32` (C66c): past 32 bits, an Int
// gives up as a budget running out does (INT_HELPERS below). With it, a
// search with one answer or none under `first` or `count` is the flag
// `lab_none` (scalar.ts `shader`), and std's Array is `array<T, N>`, its
// size fixed where it's made (`sizesOf` below).
//
// A record of two to four Float64s (a point, a direction, a colour) is
// stored as a WGSL vector instead, `vec2f` to `vec4f`, its fields in order
// as .x .y .z .w. The program doesn't say "vector": that's how this target
// stores such a record, the way Peano naturals are stored as Ints
// (docs/design/numbers/NUMBERS.md). Building one whose parts each do the same
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
// the maths. A record whose fields aren't all Float64s is still a struct.
//
// A vector whose parts are each one other vector's parts times constants,
// plus constants, is a matrix times that vector (MATRICES.md layer 1,
// C30c): a shear is `mat3x3f(…) * p0`, and a linear function applied to
// another is one matrix, folded when the shader is printed.
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

import type { Id } from "../../ters/src/model.ts";
import { isArray, isRecord, noData, unchecked, type LType, type Lowered, type Op, type RType, type SExpr, type SFunc, type DType, type FType, type WType, type AType } from "./scalar.ts";

// A shader has no data with several cases (`data` in scalar.ts is for WebAssembly).
type GType = Exclude<LType, DType | FType | WType | AType>;
export interface ShaderFunc { def: Id; name: string; wgsl: string; params: GType[]; result: GType }
// structs: the WGSL name of each record type and of its fields.
// matrices: the functions (indices in lowered.funcs) that print a linear
// map as a matrix (C30c); its sums are in another order, so they are close
// to Float32's, not exact.
export interface Shader { wgsl: string; funcs: ShaderFunc[]; refused: Map<Id, string>; structs: Map<string, { name: string; fields: string[] }>; matrices: Set<number> }
const INFIX: Partial<Record<Op, string>> = {
  add: "+", sub: "-", mul: "*", div: "/", less: "<", equal: "==", beq: "==", and: "&&", or: "||", iless: "<", ieq: "==",
};
// An Int in a shader is an i32 (C66c). WGSL's i32 arithmetic wraps; a
// result past 32 bits isn't the evaluator's, so it gives up as a budget
// running out does: lab_fuel goes below 0, the budget around it gives its
// fallback, and outside any budget the answer isn't the evaluator's (as
// outside a budget anywhere). The overflow tests are Hacker's Delight's
// (Warren, 2-13): a sum overflows when both inputs' signs differ from its.
const INT_CALL: Partial<Record<Op, string>> = { iadd: "lab_iadd", isub: "lab_isub", imul: "lab_imul", ineg: "lab_ineg", iabs: "lab_iabs", iquot: "lab_iquot", irem: "lab_irem", ipow: "lab_ipow", iwhole: "lab_iwhole" };
// The ones that may have no answer, which set lab_none (scalar.ts `shader`).
const NONE_OPS = new Set<Op>(["iquot", "irem", "ipow", "iwhole"]);
const INT_HELPERS: Partial<Record<Op, string>> = {
  iadd: `fn lab_iadd(a: i32, b: i32) -> i32 {
  let r = a + b;
  if (((a ^ r) & (b ^ r)) < 0i) { lab_fuel = -1.0; }
  return r;
}`,
  isub: `fn lab_isub(a: i32, b: i32) -> i32 {
  let r = a - b;
  if (((a ^ b) & (a ^ r)) < 0i) { lab_fuel = -1.0; }
  return r;
}`,
  imul: `fn lab_imul(a: i32, b: i32) -> i32 {
  let r = a * b;
  // r / a undoes the product unless it wrapped; −1 × the lowest i32 wraps to itself.
  if (a != 0i && (r / a != b || (a == -1i && b == -2147483647i - 1i))) { lab_fuel = -1.0; }
  return r;
}`,
  ineg: `fn lab_ineg(a: i32) -> i32 {
  if (a == -2147483647i - 1i) { lab_fuel = -1.0; }
  return -a;
}`,
  iabs: `fn lab_iabs(a: i32) -> i32 {
  if (a == -2147483647i - 1i) { lab_fuel = -1.0; }
  return abs(a);
}`,
  // Rounded down, as the evaluator's (int.ts): WGSL's / and % round toward 0.
  iquot: `fn lab_iquot(a: i32, b: i32) -> i32 {
  if (b == 0i) { lab_none = true; return 0i; }
  if (b == -1i && a == -2147483647i - 1i) { lab_fuel = -1.0; return a; }
  let q = a / b;
  if (q * b != a && ((a < 0i) != (b < 0i))) { return q - 1i; }
  return q;
}`,
  irem: `fn lab_irem(a: i32, b: i32) -> i32 {
  if (b == 0i) { lab_none = true; return 0i; }
  if (b == -1i) { return 0i; }
  let r = a % b;
  if (r != 0i && ((r < 0i) != (b < 0i))) { return r + b; }
  return r;
}`,
  // By squaring; none for a negative power.
  ipow: `fn lab_ipow(a: i32, n: i32) -> i32 {
  if (n < 0i) { lab_none = true; return 0i; }
  var r = 1i;
  var b = a;
  var k = n;
  loop {
    if (k == 0i) { break; }
    if ((k & 1i) == 1i) { r = lab_imul(r, b); }
    k = k >> 1u;
    if (k > 0i) { b = lab_imul(b, b); }
  }
  return r;
}`,
  iwhole: `fn lab_iwhole(x: f32) -> i32 {
  // NaN or infinite, by the bits: a GPU may take x != x to be false.
  if ((bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u) { lab_none = true; return 0i; }
  let f = floor(x);
  if (f < -2147483648.0 || f >= 2147483648.0) { lab_fuel = -1.0; return 0i; }
  return i32(f);
}`,
};
// Records of 2 to 4 Float64s are vectors; their fields are these.
const XYZW = ["x", "y", "z", "w"];
export function vectorWidth(t: LType): number {
  return isRecord(t) && t.fields.length >= 2 && t.fields.length <= 4 && t.fields.every((f) => f.t === "f64") ? t.fields.length : 0;
}

// The same operation on every part of a vector, written once.
type VOp = Op | "min" | "max";
type V =
  | { k: "whole"; e: SExpr }        // an expression whose value is a vector
  | { k: "splat"; e: SExpr }        // one Float64 for every part
  | { k: "lit"; vs: number[] }      // a number for each part
  | { k: "op"; op: VOp; args: V[] };
const ELEMENTWISE = new Set<Op>(["add", "sub", "mul", "div", "neg", "sqrt", "abs", "floor", "sin", "cos", "tan", "exp", "log", "atan2"]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Operations of constants the matrix reading folds (C30c).
const FOLD: Partial<Record<Op, (...xs: number[]) => number>> = {
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, atan2: Math.atan2,
};
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

// Rounding to Float32 is what every f32 operation does already, so a
// shader drops it, and the patterns below (dot, mix, clamp) see the
// arithmetic as written.
function unrounded(e: SExpr): SExpr {
  switch (e.k) {
    case "num": case "bool": case "local": case "int": case "zero": return e;
    case "attempt": return { ...e, body: unrounded(e.body), ok: unrounded(e.ok), otherwise: unrounded(e.otherwise) };
    case "op": return e.op === "float32" ? unrounded(e.args[0]) : { ...e, args: e.args.map(unrounded) };
    case "if": return { ...e, cond: unrounded(e.cond), then: unrounded(e.then), else: unrounded(e.else) };
    case "let": return { ...e, value: unrounded(e.value), body: unrounded(e.body) };
    case "call": case "make": case "rt": return { ...e, args: e.args.map(unrounded) };
    case "get": return { ...e, rec: unrounded(e.rec) };
    case "budget": return { ...e, body: unrounded(e.body), otherwise: unrounded(e.otherwise) };
    default: return noData(e);
  }
}

export function emitWgsl(lowered: Lowered): Shader {
  if (lowered.data.length || lowered.fns.length) throw new Error("a shader can't have data types with several cases: lower without `data`");
  // No finiteness checks (L125c2): a GPU can't stop, and WGSL may assume
  // there's nothing but finite floats, which is Float64's meaning.
  const funcs = lowered.funcs.map((f) => ({ ...f, body: unrounded(unchecked(f.body)) }));
  const refused = new Map(lowered.refused);
  const bad = new Map<number, string>();

  // Float64s a shader can't write down.
  funcs.forEach((f, i) => {
    const n = numbers(f.body).find((v) => !Number.isFinite(v) || Math.abs(v) > 3.4e38);
    if (n !== undefined) bad.set(i, `uses ${n}, which a shader's f32 can't hold`);
  });

  // Arrays (C66c): a shader's array has its size where it's made (written
  // out, empty, or pushed onto), and WGSL's array<T, N> says it. Each
  // function's array locals and answer get theirs from the code. A function
  // that takes an array as an input gets a copy per size it is called with
  // (C66d), as C++ templates and Futhark's size-specialised functions do:
  // its instance `i@3,2` is i with arrays of 3 and 2 items for its array
  // inputs. One whose size depends on the way it went is refused with the
  // reason.
  type Inst = { fn: number; key: string; locals: Map<number, number>; result?: number };
  const insts = new Map<string, Inst>();
  const sizing = new Set<string>();
  const arrayParams = (i: number) => funcs[i].params.some(isArray);
  // The instance a call runs: its callee at the sizes of its array inputs.
  const keyOf = (fn: number, sizes: number[]) => (sizes.length ? `${fn}@${sizes.join(",")}` : `${fn}`);
  const callKey = (locals: Map<number, number>, e: Extract<SExpr, { k: "call" }>) =>
    keyOf(e.fn, funcs[e.fn].params.flatMap((t, j) => (isArray(t) ? [szOf(locals, e.args[j])] : [])));
  // The size of e, an array, in a function whose array locals' sizes are known.
  const szOf = (locals: Map<number, number>, e: SExpr): number => {
    const sz = (x: SExpr) => szOf(locals, x);
    switch (e.k) {
      case "local": { const n = locals.get(e.i); if (n === undefined) throw new Error("uses an array before its size is known"); return n; }
      case "let": return sz(e.body);
      case "if": case "attempt": case "budget": {
        const [a, b] = e.k === "if" ? [sz(e.then), sz(e.else)] : e.k === "attempt" ? [sz(e.ok), sz(e.otherwise)] : [sz(e.body), sz(e.otherwise)];
        if (a !== b) throw new Error(`gives an array of ${a} items one way and of ${b} another (a shader's array has one size)`);
        return a;
      }
      case "call": { const r = sizesOf(callKey(locals, e)).result; if (r === undefined) throw new Error(`uses ${funcs[e.fn].name}'s array`); return r; }
      case "rt": {
        const op = /^array\.(\w+)\./.exec(e.fn)?.[1];
        if (op === "of") return e.args.length;
        if (op === "empty") return 0;
        if (op === "push" || op === "pushFront") return sz(e.args[0]) + 1;
        if (op === "rest") return Math.max(sz(e.args[0]) - 1, 0);
        throw new Error("keeps an array in an array");
      }
      default: throw new Error("uses an array where a shader can't tell its size");
    }
  };
  // A function given every way of calling it, at most this many sizes.
  const COPIES = 16;
  const sizesOf = (key: string): Inst => {
    if (insts.has(key)) return insts.get(key)!;
    const [fn, at] = key.split("@");
    const i = Number(fn), f = funcs[i];
    if (sizing.has(key)) throw new Error("makes an array whose size depends on how far it recurses");
    if (at && [...insts.values()].filter((x) => x.fn === i).length >= COPIES) throw new Error(`is called with arrays of more than ${COPIES} sizes`);
    sizing.add(key);
    const locals = new Map<number, number>();
    const given = at ? at.split(",").map(Number) : [];
    f.params.forEach((t, j) => { if (isArray(t)) locals.set(j, given.shift()!); });
    const walk = (e: SExpr) => {
      if (e.k === "let") { walk(e.value); if (isArray(f.locals[e.i])) locals.set(e.i, szOf(locals, e.value)); walk(e.body); return; }
      if (e.k === "attempt") { walk(e.body); if (isArray(f.locals[e.res])) locals.set(e.res, szOf(locals, e.body)); walk(e.ok); walk(e.otherwise); if (isArray(e.t)) szOf(locals, e); return; }
      if (e.k === "make" && e.t.fields.some((x) => isArray(x.t))) throw new Error("keeps an array in a record");
      kids(e).forEach(walk);
      // Every array the printer will need the size of.
      if ((e.k === "if" || e.k === "budget") && isArray(e.t)) szOf(locals, e);
      if (e.k === "rt" && /^array\.(push|pushFront|rest|length|at)\./.test(e.fn)) szOf(locals, e.args[0]);
      // Every instance a call runs. Calling itself as the last step is a
      // loop, which reuses its inputs, so their sizes must stay the same.
      if (e.k === "call") {
        const k = callKey(locals, e);
        if (e.fn === i && e.tail && k !== key) throw new Error("calls itself with arrays of other sizes (a loop's arrays keep their size)");
        if (!sizing.has(k)) {
          try { sizesOf(k); } catch (err) { if (!(err instanceof Error) || e.fn === i) throw err; throw new Error(`calls ${funcs[e.fn].name}, which ${err.message}`); }
        }
      }
    };
    walk(f.body);
    const r: Inst = { fn: i, key, locals, ...(isArray(f.result) ? { result: szOf(locals, f.body) } : {}) };
    sizing.delete(key);
    insts.set(key, r);
    return r;
  };
  // Each function that takes no array is sized on its own, and with it the
  // copies it calls; one that takes an array, by what calls it.
  funcs.forEach((f, i) => {
    if (bad.has(i) || arrayParams(i)) return;
    try { sizesOf(`${i}`); } catch (e) { if (!(e instanceof Error)) throw e; bad.set(i, e.message); }
  });
  funcs.forEach((f, i) => {
    if (!bad.has(i) && arrayParams(i) && ![...insts.values()].some((x) => x.fn === i)) bad.set(i, "takes an array as an input, and nothing here calls it (a shader's array has its size where it's made, so each call gets a copy for its size)");
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
  // The copies to write: every instance of a kept function (a function with
  // no array inputs is its own one copy).
  const keptSet = new Set(kept);
  const copies = [...insts.values()].filter((x) => keptSet.has(x.fn)).sort((a, b) => a.fn - b.fn || a.key.localeCompare(b.key));
  for (const i of kept) if (!insts.has(`${i}`) && !arrayParams(i)) copies.push({ fn: i, key: `${i}`, locals: new Map() });
  const wname = new Map(copies.map((x) => [x.key, ident(funcs[x.fn].name, `_${x.key.replace("@", "_n").replace(/,/g, "_")}`)]));

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
  // An array's type needs its size, n (an empty one is held in one slot).
  function tname(t: LType, n?: number): string {
    if (isArray(t)) {
      if (n === undefined) throw new Error("an array's WGSL type needs its size");
      return `array<${tname(t.item)}, ${Math.max(1, n)}>`;
    }
    return t === "f64" ? "f32" : t === "i32" ? "bool" : t === "int32" ? "i32" : struct(t as RType);
  }
  for (const i of kept) for (const t of [...funcs[i].locals, funcs[i].result]) if (!isArray(t)) tname(t);

  // The parts of a vector, each doing the same thing to the same part of
  // other vectors (or to one Float64 shared by all), as one vector
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
        case "num": case "bool": case "int": return e;
        case "let": case "budget": case "attempt": case "zero": case "rt": return null;
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
        default: return noData(e);
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

  // Linear maps as matrices (MATRICES.md layer 1, C30c). A vector whose
  // parts are each a sum of one other vector's parts times constants, plus
  // a constant, is `mat * v + b`: `vec3f(p0.x + 0.5 * p0.y, p0.y, p0.z)` is
  // `mat3x3f(…) * p0`. The reading looks through calls, so a function
  // applied to another, turn(shear(v)), is one matrix (A·B, folded now),
  // and v is computed once. This is the same reading linear.ts does on the
  // program's graph (C30b uses it for compiled JS), done here on the
  // lowered tree, where the calls the shader makes are. Prior art: the
  // matrix of a linear map and of a composition (textbook); GPUs run
  // matrix times vector as one built-in.
  type Aff = { c: Map<number, number>; k: number };
  type AV = Aff | AV[];
  function affine(top: SExpr, f: SFunc): { base: SExpr; m: number; rows: Aff[] } | null {
    let base: SExpr | null = null, m = 0;
    const konst = (k: number): Aff => ({ c: new Map(), k });
    const isK = (a: AV | null): a is Aff => a !== null && !Array.isArray(a) && [...a.c.values()].every((x) => x === 0);
    const scale = (w: number, a: Aff): Aff => ({ c: new Map([...a.c].map(([j, x]) => [j, w * x])), k: w * a.k });
    const plus = (a: Aff, b: Aff, sgn: number): Aff => {
      const c = new Map(a.c);
      for (const [j, x] of b.c) c.set(j, (c.get(j) ?? 0) + sgn * x);
      return { c, k: a.k + sgn * b.k };
    };
    // The outer function's vector, read as its parts.
    // (Not one that reads a let this reading has looked through: that let
    // isn't printed when the matrix is.)
    const opaque = (e: SExpr, t: LType | undefined, env: Map<number, AV>): AV | null => {
      const w = t ? vectorWidth(t) : 0;
      if (!w || (base && (!same(base, e) || m !== w))) return null;
      if (reads(e).some((i) => env.has(i))) return null;
      base = e; m = w;
      return Array.from({ length: w }, (_, j) => ({ c: new Map([[j, 1]]), k: 0 }));
    };
    const scalar = (a: AV | null): Aff | null => (a && !Array.isArray(a) ? a : null);
    let depth = 0;
    const val = (e: SExpr, env: Map<number, AV>, inner: boolean): AV | null => {
      switch (e.k) {
        case "num": return konst(e.v);
        case "local": return env.get(e.i) ?? (inner ? null : opaque(e, f.locals[e.i], env));
        case "let": {
          const v = val(e.value, env, inner);
          return v && val(e.body, new Map(env).set(e.i, v), inner);
        }
        case "make": { const xs = e.args.map((a) => val(a, env, inner)); return xs.every((x) => x) ? (xs as AV[]) : null; }
        case "get": {
          const r = val(e.rec, env, inner) ?? (inner ? null : opaque(e.rec, e.t, env));
          return Array.isArray(r) ? r[e.i] ?? null : null;
        }
        case "op": {
          const xs = e.args.map((a) => scalar(val(a, env, inner)));
          if (!xs.every((x) => x)) return null;
          const [a, b] = xs as Aff[];
          if (e.op === "add" && b) return plus(a, b, 1);
          if (e.op === "sub" && b) return plus(a, b, -1);
          if (e.op === "neg" && !b) return scale(-1, a);
          if (e.op === "mul" && b) return isK(a) ? scale(a.k, b) : isK(b) ? scale(b.k, a) : null;
          if (e.op === "div" && b && isK(b) && b.k !== 0) return scale(1 / b.k, a);
          // Any other operation of constants, folded: cos(π / 6) is a number.
          const m = FOLD[e.op];
          return m && xs.every(isK) ? konst(m(...(xs as Aff[]).map((x) => x.k))) : null;
        }
        case "call": {
          const g = funcs[e.fn];
          if (bad.has(e.fn) || depth > 8 || calls(g.body).some((c) => c.fn === e.fn)) return null;
          const args = e.args.map((a, j) => val(a, env, inner) ?? (inner ? null : opaque(a, g.params[j], env)));
          if (!args.every((x) => x)) return null;
          depth++;
          const out = val(g.body, new Map(args.map((x, j) => [j, x!])), true);
          depth--;
          return out;
        }
        default: return null;
      }
    };
    const out = val(top, new Map(), false);
    if (!Array.isArray(out) || !base || !out.every((x) => x && !Array.isArray(x))) return null;
    const rows = out as Aff[];
    if (![...rows.flatMap((r) => [...r.c.values(), r.k])].every((x) => Number.isFinite(x) && Math.abs(x) <= 3.4e38)) return null;
    return { base, m, rows };
  }
  // A matrix pays when some part mixes two or more of the input's parts
  // (otherwise the parts, or `lift`'s vector expression, say it plainly).
  const mixes = (a: { rows: Aff[] }) => a.rows.some((r) => [...r.c.values()].filter((x) => x !== 0).length >= 2);

  const matrices = new Set<number>();
  const text = copies.map((x) => func(funcs[x.fn], x));
  const needsPow = kept.some((i) => usesOp(funcs[i].body, "pow"));
  const needsMod = kept.some((i) => usesOp(funcs[i].body, "mod"));
  // power multiplies with lab_imul.
  const intOps = (Object.keys(INT_HELPERS) as Op[]).filter((op) => kept.some((i) => usesOp(funcs[i].body, op) || (op === "imul" && usesOp(funcs[i].body, "ipow"))));
  const flags = (e: SExpr): boolean => e.k === "attempt" || (e.k === "zero" && !!e.none) || (e.k === "op" && NONE_OPS.has(e.op)) || (e.k === "rt" && /^array\.at\./.test(e.fn)) || kids(e).some(flags);
  const needsNone = kept.some((i) => flags(funcs[i].body));
  const needsFuel = intOps.length > 0 || kept.some((i) => funcs[i].spends || budgets(funcs[i].body));
  const wgsl = [
    "// Generated from the scalar profile by compiler/src/wgsl.ts.",
    ...(needsPow ? [POW] : []),
    ...(needsMod ? [MOD] : []),
    ...(needsFuel ? ["// What's left of the innermost budget: below 0 once it ran out.\nvar<private> lab_fuel: f32;"] : []),
    ...(needsNone ? ["// Set when a search has no answer; `first` looks at it (scalar.ts `shader`).\nvar<private> lab_none: bool;"] : []),
    ...intOps.map((op) => INT_HELPERS[op]),
    ...structText,
    ...text,
  ].join("\n\n") + "\n";
  return {
    wgsl,
    // Only what can be called from outside a budget is a place to start.
    // A search with no answer outside any `first` isn't one either.
    funcs: kept.filter((i) => !funcs[i].budgeted && !funcs[i].partial && !isArray(funcs[i].result) && !arrayParams(i)).map((i) => ({ def: funcs[i].def, name: funcs[i].name, wgsl: wname.get(`${i}`)!, params: funcs[i].params as GType[], result: funcs[i].result as GType })),
    refused,
    structs,
    matrices,
  };

  function func(f: SFunc, inst: Inst): string {
    const i = inst.fn;
    const loops = calls(f.body).some((c) => c.fn === i && c.tail);
    // Sizes of the array locals, and the type of e (an array: with its size).
    const L = inst.locals;
    const ty = (t: LType, e: SExpr) => tname(t, isArray(t) ? szOf(L, e) : undefined);
    const local = (j: number) => (j < f.params.length ? `p${j}` : `l${j}`);
    let temps = 0;
    const temp = () => `t${temps++}`;

    // An expression, with the statements it needs first (an `if` in the
    // middle of an expression becomes a `var` set by an if statement).
    function ex(e: SExpr, pre: string[], d: string): string {
      switch (e.k) {
        case "num": return num(e.v);
        // No answer (`fail`): the flag, and a zero to go on with.
        case "zero":
          if (e.none) pre.push(`${d}lab_none = true;`);
          return `${tname(e.t)}()`;
        // first with a fallback, or count: the search with the flag clear,
        // then the answer or the fallback by the flag, put back as it was.
        case "attempt": {
          const s = temp(), r = temp(), t = temp(), res = local(e.res);
          pre.push(`${d}let ${s} = lab_none;`, `${d}lab_none = false;`, `${d}var ${res}: ${tname(f.locals[e.res], L.get(e.res))};`, ...block(e.body, { set: res }, d));
          pre.push(`${d}let ${r} = lab_none;`, `${d}lab_none = ${s};`, `${d}var ${t}: ${ty(e.t, e)};`, `${d}if (${r}) {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}} else {`, ...block(e.ok, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        // std's Array (C66c): array<T, N>, its size where it's made.
        case "rt": {
          const op = /^array\.(\w+)\./.exec(e.fn)?.[1];
          const at = lowered.arrays[Number(/\.a(\d+)$/.exec(e.fn)![1])];
          if (op === "of") return `${tname(at, e.args.length)}(${e.args.map((a) => bare(ex(a, pre, d))).join(", ")})`;
          if (op === "empty") return `${tname(at, 0)}()`;
          if (op === "push") {
            const n = szOf(L, e.args[0]), a = temp();
            pre.push(`${d}let ${a} = ${bare(ex(e.args[0], pre, d))};`);
            const x = bare(ex(e.args[1], pre, d));
            return `${tname(at, n + 1)}(${[...Array.from({ length: n }, (_, j) => `${a}[${j}]`), x].join(", ")})`;
          }
          if (op === "pushFront") {
            const n = szOf(L, e.args[0]), a = temp();
            pre.push(`${d}let ${a} = ${bare(ex(e.args[0], pre, d))};`);
            const x = bare(ex(e.args[1], pre, d));
            return `${tname(at, n + 1)}(${[x, ...Array.from({ length: n }, (_, j) => `${a}[${j}]`)].join(", ")})`;
          }
          if (op === "rest") {
            const n = szOf(L, e.args[0]), a = temp();
            pre.push(`${d}let ${a} = ${bare(ex(e.args[0], pre, d))};`);
            return n ? `${tname(at, n - 1)}(${Array.from({ length: n - 1 }, (_, j) => `${a}[${j + 1}]`).join(", ")})` : a;
          }
          if (op === "length") { ex(e.args[0], pre, d); return `${szOf(L, e.args[0])}i`; }
          if (op === "at") {
            // No answer past the end: the flag (scalar.ts `shader`). A var,
            // which WGSL lets a computed index read.
            const n = szOf(L, e.args[0]), a = temp(), k = temp();
            pre.push(`${d}var ${a} = ${bare(ex(e.args[0], pre, d))};`, `${d}let ${k} = ${bare(ex(e.args[1], pre, d))};`);
            pre.push(`${d}if (${k} < 0i || ${k} >= ${n}i) { lab_none = true; }`);
            return n ? `${a}[clamp(${k}, 0i, ${n - 1}i)]` : `${tname(at.item)}()`;
          }
          throw new Error(`${e.fn} isn't in shaders`);
        }
        case "int": return e.v === -(2n ** 31n) ? "(-2147483647i - 1i)" : `${e.v}i`;
        case "bool": return String(e.v);
        case "local": return local(e.i);
        case "let": {
          // Lets that end in a vector made from one vector's parts: the
          // matrix, and none of the lets (staged code, stage.ts, is this).
          let tail: SExpr = e;
          while (tail.k === "let") tail = tail.body;
          const t = tail.k === "make" ? tail.t : tail.k === "call" ? funcs[tail.fn].result : null;
          const a = t && vectorWidth(t) ? affine(e, f) : null;
          if (a && mixes(a)) return matrix(a, pre, d);
          pre.push(`${d}let ${local(e.i)} = ${bare(ex(e.value, pre, d))};`);
          return ex(e.body, pre, d);
        }
        case "if": {
          const m = minmax(e);
          if (m) return `${m.op}(${m.args.map((a) => bare(ex(a, pre, d))).join(", ")})`;
          const c = ex(e.cond, pre, d), t = temp();
          pre.push(`${d}var ${t}: ${ty(e.t, e)};`, `${d}if (${bare(c)}) {`, ...block(e.then, { set: t }, d + "  "), `${d}} else {`, ...block(e.else, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "make": {
          const v = vectorWidth(e.t) ? lift(e.args) : null;
          // wide: a record whose parts are all one Float64 is that Float64 spread.
          if (v) return vtext(v, e.args.length, pre, d, true);
          const a = vectorWidth(e.t) ? affine(e, f) : null;
          if (a && mixes(a)) return matrix(a, pre, d);
          return `${tname(e.t)}(${e.args.map((a) => bare(ex(a, pre, d))).join(", ")})`;
        }
        case "get": {
          const r = ex(e.rec, pre, d);
          struct(e.t);
          return `${r}.${structs.get(e.t.key)!.fields[e.i]}`;
        }
        case "call": {
          // A linear function of a linear function (or of staged code): one matrix.
          const a = vectorWidth(funcs[e.fn].result) && e.args.some((x) => x.k === "call" || x.k === "let") ? affine(e, f) : null;
          if (a && !a.rows.every((r) => r.c.size === 0)) return matrix(a, pre, d);
          return `${wname.get(callKey(L, e))}(${e.args.map((a) => bare(ex(a, pre, d))).join(", ")})`;
        }
        case "budget": {
          const s = temp(), t = temp();
          pre.push(`${d}let ${s} = lab_fuel;`, `${d}lab_fuel = ${num(e.n)};`, `${d}var ${t}: ${ty(e.t, e)};`, ...block(e.body, { set: t }, d));
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
          if (e.op === "itof") return `f32(${bare(xs[0])})`;
          if (INT_CALL[e.op]) return `${INT_CALL[e.op]}(${xs.map(bare).join(", ")})`;
          if (e.op === "pow") {
            const y = e.args[1];
            // x², x³, x⁴ as products, which is what they are.
            if (y.k === "num" && [2, 3, 4].includes(y.v) && e.args[0].k === "local") return `(${Array(y.v).fill(xs[0]).join(" * ")})`;
            return `lab_pow(${xs.map(bare).join(", ")})`;
          }
          return `${CALL[e.op]}(${xs.map(bare).join(", ")})`;
        }
        default: return noData(e);
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

    // mat * v + b; WGSL's matCxR takes its columns in order.
    function matrix(a: { base: SExpr; m: number; rows: Aff[] }, pre: string[], d: string): string {
      matrices.add(i);
      const n = a.rows.length;
      const cols = Array.from({ length: a.m }, (_, j) => a.rows.map((r) => num((r.c.get(j) ?? 0) + 0)));
      const off = a.rows.some((r) => r.k !== 0) ? ` + vec${n}f(${a.rows.map((r) => num(r.k + 0)).join(", ")})` : "";
      return `(mat${a.m}x${n}f(${cols.flat().join(", ")}) * ${ex(a.base, pre, d)}${off})`;
    }
    // A vector expression's text. `wide` where a function needs a vector
    // (min, mix, …): a single Float64 is then spread over the parts.
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
    const rt = tname(f.result, inst.result);
    const spend = (d: string) => (f.spends ? [`${d}lab_fuel = lab_fuel - 1.0;`, `${d}if (lab_fuel < 0.0) { return ${rt}(); }`] : []);
    const sig = `fn ${wname.get(inst.key)}(${f.params.map((t, j) => `${loops ? "a" : "p"}${j}: ${tname(t, L.get(j))}`).join(", ")}) -> ${rt}`;
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

// The locals e reads.
function reads(e: SExpr): number[] {
  return [...(e.k === "local" ? [e.i] : []), ...kids(e).flatMap(reads)];
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
    case "num": case "bool": case "int": case "zero": return e;
    case "attempt": return { ...e, body: put(e.body, i, v), ok: put(e.ok, i, v), otherwise: put(e.otherwise, i, v) };
    case "op": case "call": case "make": case "rt": return { ...e, args: e.args.map((a) => put(a, i, v)) };
    case "get": return { ...e, rec: put(e.rec, i, v) };
    case "if": return { ...e, cond: put(e.cond, i, v), then: put(e.then, i, v), else: put(e.else, i, v) };
    case "let": return { ...e, value: put(e.value, i, v), body: put(e.body, i, v) };
    case "budget": return { ...e, body: put(e.body, i, v), otherwise: put(e.otherwise, i, v) };
    default: return noData(e);
  }
}
function gets(e: SExpr): Extract<SExpr, { k: "get" }>[] {
  return [...(e.k === "get" ? [e] : []), ...kids(e).flatMap(gets)];
}
function hasWhole(v: V): boolean {
  return v.k === "whole" || (v.k === "op" && v.args.some(hasWhole));
}
function hasRt(e: SExpr): boolean {
  return e.k === "rt" || kids(e).some(hasRt);
}
function kids(e: SExpr): SExpr[] {
  switch (e.k) {
    case "rt": return e.args;
    case "op": case "call": case "make": return e.args;
    case "get": return [e.rec];
    case "if": return [e.cond, e.then, e.else];
    case "let": return [e.value, e.body];
    case "budget": return [e.body, e.otherwise];
    case "attempt": return [e.body, e.ok, e.otherwise];
    default: return [];
  }
}
