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
    JSON.stringify(plainValue(b), (_, v) => { if (typeof v === "number") out.push(v); return v; });
    return out;
  };
  for (const world of ["Flat", "Solid"]) {
    const a = steps(masked, world), b = steps(all, world);
    assert.equal(a.length, b.length);
    a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9, `${world}: ${x} against ${b[i]}`));
  }
});
