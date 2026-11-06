// Parts known to be 0 on the core IR (zero-parts.ts, L43f1): Bounce's
// bodies get the masks their physics has, through its cells, lists and
// closures, and its compiled steps answer as they did with every part, but
// for the rounding the dropped parts carried (a reflected velocity's
// trivector part was about 1e-17, from terms that cancel exactly).

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { lowerCore, loadCoreJs, plainValue } from "../src/core-js.ts";
import { kids, type SExpr } from "../src/scalar.ts";

test("Bounce's compiled step multiplies only the parts its vectors, bivectors and rotors have, and answers the same", () => {
  const p = load("bounce");
  const main = p.code.defs.find((d) => p.pres.names[d] === "main")!;
  const lowered = (every: boolean) => {
    if (every) process.env.NO_ZP = "1"; else delete process.env.NO_ZP;
    try { return lowerCore(p.code, p.info, p.pres.names, [main]); } finally { delete process.env.NO_ZP; }
  };
  const muls = (ir: ReturnType<typeof lowerCore>) => { let n = 0; const w = (e: SExpr) => { if (e.k === "op" && e.op === "mul") n++; kids(e).forEach(w); }; ir.funcs.forEach((f) => w(f.body)); return n; };
  const all = lowered(true), masked = lowered(false);
  assert.ok(muls(masked) < muls(all) * 0.45, `${muls(masked)} multiplications against ${muls(all)}`);
  const steps = (ir: ReturnType<typeof lowerCore>, world: string) => {
    const fns = loadCoreJs(ir, { print: () => {} });
    const at = (n: string) => ir.funcs.findIndex((f) => f.name === n);
    let b = fns[at(`${world.toLowerCase()} bodies`)]();
    for (let i = 0; i < 200; i++) b = fns[at(`step at ${world} at ${world.toLowerCase()}`)](b);
    const out: number[] = [];
    // A smaller record leaves out the parts that are 0: only the others
    // are compared (with every part, they are about 1e-17 or 0).
    JSON.stringify(plainValue(b), (_, v) => { if (typeof v === "number" && Math.abs(v) > 1e-12) out.push(v); return v; });
    return out;
  };
  for (const world of ["Flat", "Solid"]) {
    const a = steps(masked, world), b = steps(all, world);
    assert.equal(a.length, b.length);
    a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9, `${world}: ${x} against ${b[i]}`));
  }
});

// On the GPU too (L43): a picture's lowering leaves out the parts known to
// be 0, so raymarch's motors and points are structs of the parts they
// have, not all 16 of the projective algebra's, and it draws the same.
test("raymarch's picture holds its multivectors in smaller structs and draws the same", async () => {
  const { lowerPicture } = await import("../../editor/picture.ts");
  const { emitWgsl, shaderTidied } = await import("../src/wgsl.ts");
  const { loadJs } = await import("../src/js-scalar.ts");
  const p = load("raymarch");
  const colour = p.code.defs.find((d) => p.pres.names[d] === "colour")!;
  const drawn = (every: boolean) => {
    if (every) process.env.NO_ZP = "1"; else delete process.env.NO_ZP;
    try {
      const ir = lowerPicture({ ...p.code }, p.info, p.pres.names, { colour });
      const pixels = (ir2: typeof ir) => { const f = loadJs(ir2).get(colour)!, out: unknown[] = []; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) out.push(f(i / 6 - 1, j / 6 - 1, 1.5)); return JSON.stringify(out); };
      // The shader's tidied functions (C175) draw the same, bit for bit.
      const out = pixels(ir), tidy = shaderTidied({ ...ir, funcs: ir.funcs.map((g) => ({ ...g, locals: [...g.locals] })) });
      assert.equal(pixels(tidy), out);
      return { wgsl: emitWgsl(ir), out };
    } finally { delete process.env.NO_ZP; }
  };
  const all = drawn(true), masked = drawn(false);
  assert.deepEqual([...masked.wgsl.refused.values()], []);
  // The widest Pga struct the shader makes a value of.
  const widest = (s: string) => {
    const sizes = new Map([...s.matchAll(/struct (Pga\w*) \{([^}]*)\}/g)].map((m) => [m[1], m[2].split(":").length - 1]));
    return Math.max(0, ...[...s.matchAll(/(Pga\w*)\(/g)].map((m) => sizes.get(m[1]) ?? 0));
  };
  // Every part kept, the shader still builds no 16-part one: each is read
  // in a few parts where it's built (C175, record-parts.ts).
  assert.ok(widest(all.wgsl.wgsl) < 16, `widest Pga struct ${widest(all.wgsl.wgsl)}`);
  assert.ok(widest(masked.wgsl.wgsl) < 8, `widest Pga struct ${widest(masked.wgsl.wgsl)}`);
  assert.equal(masked.out, all.out);
});

// Embeddings (L209, EMBEDDINGS.md): a Complex that stays in the image of
// Float64's embedding, one with no imaginary part, is kept as a Float64.
test("a Complex with no imaginary part is a Float64 in compiled JavaScript", async () => {
  const { Lang } = await import("../../ters/src/lang/dsl.ts");
  const { infer } = await import("../../ters/src/lang/infer.ts");
  const { base, baseNames, checkOptions } = await import("../../ters/src/lang/load.ts");
  const { LIBRARY } = await import("../../ters/src/lang/library.ts");
  const { ARITH } = await import("../../ters/src/lang/std.ts");
  const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
  const k = new Lang(LIBRARY.code);
  const sq = k.def("sq");
  k.define(sq, k.fn(["z"], (z) => k.call(ARITH.mul, z, z)));
  const g = k.def("g");
  k.define(g, k.fn(["x"], (x) => k.call(lib("modulus"), k.call(sq, k.call(sq, k.call(lib("as complex"), x))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const ir = lowerCore(code, info, names, [g]);
  const at = ir.funcs.findIndex((f) => f.def === g);
  // What g reaches makes no record: the square of a real is a Float64.
  const reached = new Set<number>(), walk = (i: number) => { if (reached.has(i)) return; reached.add(i); const w = (e: SExpr) => { if (e.k === "call") walk(e.fn); kids(e).forEach(w); }; w(ir.funcs[i].body); };
  walk(at);
  const makes = [...reached].flatMap((i) => { const out: string[] = []; const w = (e: SExpr) => { if (e.k === "make") out.push(e.t.name); kids(e).forEach(w); }; w(ir.funcs[i].body); return out; });
  assert.deepEqual(makes, []);
  assert.equal(loadCoreJs(ir, { print: () => {} })[at](3), 81);
});
