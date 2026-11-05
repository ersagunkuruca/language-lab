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
  const { emitWgsl } = await import("../src/wgsl.ts");
  const { loadJs } = await import("../src/js-scalar.ts");
  const p = load("raymarch");
  const colour = p.code.defs.find((d) => p.pres.names[d] === "colour")!;
  const drawn = (every: boolean) => {
    if (every) process.env.NO_ZP = "1"; else delete process.env.NO_ZP;
    try {
      const ir = lowerPicture({ ...p.code }, p.info, p.pres.names, { colour });
      const f = loadJs(ir).get(colour)!, out: unknown[] = [];
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) out.push(f(i / 6 - 1, j / 6 - 1, 1.5));
      return { wgsl: emitWgsl(ir), out: JSON.stringify(out) };
    } finally { delete process.env.NO_ZP; }
  };
  const all = drawn(true), masked = drawn(false);
  assert.deepEqual([...masked.wgsl.refused.values()], []);
  // The widest Pga struct the shader makes a value of.
  const widest = (s: string) => {
    const sizes = new Map([...s.matchAll(/struct (Pga\w*) \{([^}]*)\}/g)].map((m) => [m[1], m[2].split(":").length - 1]));
    return Math.max(0, ...[...s.matchAll(/(Pga\w*)\(/g)].map((m) => sizes.get(m[1]) ?? 0));
  };
  assert.equal(widest(all.wgsl.wgsl), 16);
  assert.ok(widest(masked.wgsl.wgsl) < 8, `widest Pga struct ${widest(masked.wgsl.wgsl)}`);
  assert.equal(masked.out, all.out);
});
