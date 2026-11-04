// A product shifted down by a literal, floor(a · b / 2ᵏ) for 0 ≤ k < 64,
// is one runtime call on WebAssembly and C (L89, FIXED-POINT.md step 3):
// when a and b fit 64 bits it takes the 128-bit product and shifts it, so
// Fixed's · (`(a · b) shifted down 32`) never makes the Int of its product.
// Past 64 bits, or when the answer doesn't fit them, it is the product
// and the shift as before.

import type { CoreIR, SExpr } from "./scalar.ts";
import { mapKids } from "./scalar.ts";

const fuse = (e: SExpr): SExpr => {
  const r = mapKids(e, fuse);
  if (r.k !== "rt" || r.fn !== "int.shiftDown") return r;
  const [p, k] = r.args;
  if (p?.k !== "rt" || p.fn !== "int.mul" || k?.k !== "int" || k.v < 0n || k.v >= 64n) return r;
  return { k: "rt", fn: "int.mulShift", args: [p.args[0], p.args[1], k] };
};

export function wideProducts(ir: CoreIR): void {
  for (const f of ir.funcs) f.body = fuse(f.body);
}
