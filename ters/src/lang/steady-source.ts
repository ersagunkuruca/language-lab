// The steady module (BACKLOG L210, SPEC §3.2): sin, cos, tan, exp, log and pow on
// Float64, written in Ters, so that a program that uses them gets the same
// bits on every machine. The builtins (`sin`, `exp`, ...) are each
// platform's own (JavaScript's Math, C's libm, a GPU's) and only agree
// within a few ulp. These use nothing but + − · /, comparisons and floor,
// which IEEE 754 rounds the same way everywhere, so the evaluator,
// compiled JavaScript, WebAssembly and C all give the same answer. A
// lockstep game or a replay calls `steady sin` where it needs the bits to
// agree. Only a program that calls them carries them.
//
// Each one is fdlibm's algorithm step for step (Sun Microsystems, 1993),
// as V8 carries it (compiler/math/ieee754.cc): the same constants, the same
// order of operations and the same branches. So the answers are fdlibm's
// to the bit, which is also what V8's Math.exp and Math.log give (the
// test checks that). fdlibm reads a number's bits (its high word) where
// Ters has no bits of a Float64. Each such test is written here as the
// comparison it stands for: "high word of |x| < H" is |x| < the number
// whose high word is H and low word 0, worked out below when the module
// is built. An exponent is found by halving or doubling by powers of two,
// which is exact.
//
// Left (L210): sin, cos and tan reduce their argument as fdlibm does up to
// 2^20·π/2 (|x| below 1,647,100), with a π/2 in up to three parts. Past
// that fdlibm uses Payne and Hanek's reduction, which isn't written yet,
// so there they stop with a reason rather than give a wrong answer. atan2, asin, acos
// and the rest follow, and so does the number type that carries
// these (after L204).
//
// Adapted, credited in docs/language/CREDITS.md: fdlibm's e_exp.c,
// e_log.c, k_sin.c, k_cos.c, k_tan.c, e_rem_pio2.c, s_sin.c, s_cos.c,
// s_tan.c and e_pow.c, as V8
// ports them (src/base/ieee754.cc, BSD licence), whose notices follow.
//
// ====================================================
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this
// software is freely granted, provided that this notice
// is preserved.
// ====================================================
//
// The original source code covered by the above license above has been
// modified significantly by Google Inc.
// Copyright 2016 the V8 project authors. All rights reserved.

import { merge, type Id } from "../model.ts";
import { B, prelude } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { FALSE, S, std, TRUE, tupleVariant } from "./std.ts";

// The double whose high word is `hi` and low word 0.
const word = (hi: number): number => {
  const v = new DataView(new ArrayBuffer(8));
  v.setUint32(0, hi >>> 0);
  v.setUint32(4, 0);
  return v.getFloat64(0);
};
// |x| < this ⟺ the high word of |x| is less than `hi`.
const below = word;
// |x| < this ⟺ the high word of |x| is at most `hi`.
const atMost = (hi: number) => word(hi + 1);

export function buildSteady(): Module {
  const k = new Lang();
  const L = (v: number) => k.lit(v);
  const add = (a: Id, b: Id) => k.call(B.add, a, b);
  const sub = (a: Id, b: Id) => k.call(B.sub, a, b);
  const mul = (a: Id, b: Id) => k.call(B.mul, a, b);
  const div = (a: Id, b: Id) => k.call(B.div, a, b);
  const neg = (a: Id) => k.call(B.neg, a);
  const lt = (a: Id, b: Id) => k.call(S.less, a, b);
  const ge = (a: Id, b: Id) => k.call(S.not, lt(a, b));
  const gt = (a: Id, b: Id) => lt(b, a);
  const le = (a: Id, b: Id) => k.call(S.not, lt(b, a));
  const eq = (a: Id, b: Id) => k.call(S.equal, a, b);
  const and = (a: Id, b: Id) => k.call(S.and, a, b);
  const or = (a: Id, b: Id) => k.call(S.or, a, b);
  const not = (a: Id) => k.call(S.not, a);
  const abs = (a: Id) => k.call(S.abs, a);
  const floor = (a: Id) => k.call(S.floor, a);
  const iff = (c: Id, t: Id, e: Id) => k.if(c, t, e);
  const let_ = (name: string, v: Id, body: (x: Id) => Id) => k.let(name, v, body);
  // a + b·(c + d·(…)), as fdlibm writes its polynomials: z*(C1+z*(C2+…)).
  const horner = (z: Id, cs: number[]): Id => cs.length === 1 ? L(cs[0]) : add(L(cs[0]), mul(z, horner(z, cs.slice(1))));
  // Towards zero, as C's (int) cast.
  const trunc = (v: Id) => let_("v", v, (x) => iff(lt(x, L(0)), neg(floor(neg(x))), floor(x)));
  const defs: Id[] = [];
  const def = (name: string, params: string[], body: (...ps: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); defs.push(d); return d; };

  // 2^n for a whole n from -1022 to 1023, by its binary digits: each step
  // multiplies by a power of two, which is exact.
  const BITS = [512, 256, 128, 64, 32, 16, 8, 4, 2, 1];
  const powers = (n: Id, up: boolean): Id => {
    const step = (i: number, p: Id, r: Id): Id => i === BITS.length ? p
      : let_("p", iff(ge(r, L(BITS[i])), mul(p, L(up ? 2 ** BITS[i] : 2 ** -BITS[i])), p), (p2) =>
        let_("r", iff(ge(r, L(BITS[i])), sub(r, L(BITS[i])), r), (r2) => step(i + 1, p2, r2)));
    return let_("p", L(1), (p) => let_("r", n, (r) => step(0, p, r)));
  };
  const twoTo = def("steady two to", ["n"], (n) => iff(lt(n, L(0)), powers(neg(n), false), powers(n, true)));
  // x · 2^n for any whole n that keeps it finite, in two steps where 2^n
  // itself isn't a Float64.
  const scaled = def("steady scaled", ["x", "n"], (x, n) => iff(gt(n, L(1023)), mul(mul(x, k.call(twoTo, L(1023))), k.call(twoTo, sub(n, L(1023)))),
    iff(lt(n, L(-1022)), mul(mul(x, k.call(twoTo, L(-1022))), k.call(twoTo, add(n, L(1022)))), mul(x, k.call(twoTo, n)))));
  // The exponent of a positive x: the whole e with 2^e ≤ x < 2^(e+1),
  // fdlibm's (hx >> 20) − 1023 for a normal x. Subnormals too (down to
  // −1074): 512 twice covers them.
  const DOWN = [512, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];
  const exponent = def("steady exponent", ["x"], (x) => {
    const upward = (i: number, m: Id, e: Id): Id => i === BITS.length ? e
      : let_("m", iff(ge(m, L(2 ** BITS[i])), mul(m, L(2 ** -BITS[i])), m), (m2) =>
        let_("e", iff(ge(m, L(2 ** BITS[i])), add(e, L(BITS[i])), e), (e2) => upward(i + 1, m2, e2)));
    const downward = (i: number, m: Id, e: Id): Id => i === DOWN.length ? e
      : let_("m", iff(lt(m, L(2 ** (1 - DOWN[i]))), mul(m, L(2 ** DOWN[i])), m), (m2) =>
        let_("e", iff(lt(m, L(2 ** (1 - DOWN[i]))), sub(e, L(DOWN[i])), e), (e2) => downward(i + 1, m2, e2)));
    return let_("e", L(0), (e) => iff(ge(x, L(1)), upward(0, x, e), downward(0, x, e)));
  });
  // The exponent field as fdlibm reads it for rem_pio2's cancellation
  // test: a zero or a subnormal reads as −1023.
  const field = (v: Id) => let_("a", abs(v), (a) => iff(lt(a, L(2 ** -1022)), L(-1023), k.call(exponent, a)));

  // exp (fdlibm e_exp.c).
  const ln2HI = 6.93147180369123816490e-01, ln2LO = 1.90821492927058770002e-10, invln2 = 1.44269504088896338700e+00;
  const P = [1.66666666666666019037e-01, -2.77777777770155933842e-03, 6.61375632143793436117e-05, -1.65339022054652515390e-06, 4.13813679705723846039e-08];
  const o_threshold = 7.09782712893383973096e+02, u_threshold = -7.45133219101941108420e+02;
  const twom1000 = 2 ** -1000, two1023 = 2 ** 1023, E = 2.718281828459045;
  // x reduced to r = hi − lo, x = k·ln2 + r: then e^r, times 2^k.
  // Its inputs are let first: each is read in more than one place.
  const expCore = (x0: Id, k0: Id, hi0: Id, lo0: Id) => let_("x", x0, (x) => let_("k", k0, (kk) => let_("hi", hi0, (hi) => let_("lo", lo0, (lo) => let_("t", mul(x, x), (t) =>
    let_("c", sub(x, mul(t, horner(t, P))), (c) =>
      iff(eq(kk, L(0)), sub(L(1), sub(div(mul(x, c), sub(c, L(2))), x)),
        let_("y", sub(L(1), sub(sub(lo, div(mul(x, c), sub(L(2), c))), hi)), (y) =>
          iff(ge(kk, L(-1021)),
            iff(eq(kk, L(1024)), mul(mul(y, L(2)), L(two1023)), mul(y, k.call(twoTo, kk))),
            mul(mul(y, k.call(twoTo, add(kk, L(1000)))), L(twom1000)))))))))));
  const exp = def("steady exp", ["x"], (x) => let_("ax", abs(x), (ax) =>
    // Past 709.78…, e^x isn't a Float64: the builtin's own overflow, so a
    // too large x stops the same way exp does. Below −745.13…, 0.
    iff(and(ge(ax, L(below(0x40862E42))), gt(x, L(o_threshold))), k.call(B.exp, x),
      iff(and(ge(ax, L(below(0x40862E42))), lt(x, L(u_threshold))), L(0),
        iff(ge(ax, L(atMost(0x3FD62E42))),
          iff(lt(ax, L(below(0x3FF0A2B2))),
            iff(eq(x, L(1)), L(E),
              let_("sign", iff(lt(x, L(0)), L(-1), L(1)), (sg) =>
                let_("hi", iff(lt(x, L(0)), add(x, L(ln2HI)), sub(x, L(ln2HI))), (hi) =>
                  let_("lo", iff(lt(x, L(0)), L(-ln2LO), L(ln2LO)), (lo) => expCore(sub(hi, lo), sg, hi, lo))))),
            let_("k", trunc(add(mul(L(invln2), x), iff(lt(x, L(0)), L(-0.5), L(0.5)))), (kk) =>
              let_("hi", sub(x, mul(kk, L(ln2HI))), (hi) =>
                let_("lo", mul(kk, L(ln2LO)), (lo) => expCore(sub(hi, lo), kk, hi, lo))))),
          iff(lt(ax, L(below(0x3E300000))), add(L(1), x), expCore(x, L(0), L(0), L(0))))))));

  // log (fdlibm e_log.c).
  const ln2_hi = 6.93147180369123816490e-01, ln2_lo = 1.90821492927058770002e-10;
  const Lg = [6.666666666666735130e-01, 3.999999999940941908e-01, 2.857142874366239149e-01, 2.222219843214978396e-01, 1.818357216161805012e-01, 1.531383769920937332e-01, 1.479819860511658591e-01];
  const log = def("steady log", ["x"], (x) =>
    // log of 0 or less has no answer, as the builtin's.
    iff(le(x, L(0)), k.call(B.log, x),
      let_("e", k.call(exponent, x), (e) =>
        let_("m", k.call(scaled, x, neg(e)), (m) =>
          // The top 20 bits of the fraction: fdlibm's hx & 0xfffff.
          let_("hx", floor(mul(sub(m, L(1)), L(2 ** 20))), (hx) =>
            let_("halve", ge(hx, L(0x6A09C)), (halve) =>
              let_("k", iff(halve, add(e, L(1)), e), (kk) =>
                let_("f", sub(iff(halve, div(m, L(2)), m), L(1)), (f) =>
                  let_("dk", kk, (dk) =>
                    iff(or(eq(hx, L(0)), or(eq(hx, L(0xFFFFE)), eq(hx, L(0xFFFFF)))),
                      iff(eq(f, L(0)), iff(eq(kk, L(0)), L(0), add(mul(dk, L(ln2_hi)), mul(dk, L(ln2_lo)))),
                        let_("R", mul(mul(f, f), sub(L(0.5), mul(L(0.33333333333333333), f))), (R) =>
                          iff(eq(kk, L(0)), sub(f, R), sub(mul(dk, L(ln2_hi)), sub(sub(R, mul(dk, L(ln2_lo))), f))))),
                      let_("s", div(f, add(L(2), f)), (s) =>
                        let_("z", mul(s, s), (z) =>
                          let_("w", mul(z, z), (w) =>
                            let_("t1", mul(w, add(L(Lg[1]), mul(w, add(L(Lg[3]), mul(w, L(Lg[5])))))), (t1) =>
                              let_("t2", mul(z, add(L(Lg[0]), mul(w, add(L(Lg[2]), mul(w, add(L(Lg[4]), mul(w, L(Lg[6])))))))), (t2) =>
                                let_("R", add(t2, t1), (R) =>
                                  iff(and(ge(hx, L(0x6147A)), le(hx, L(0x6B851))),
                                    let_("hfsq", mul(mul(L(0.5), f), f), (hfsq) =>
                                      iff(eq(kk, L(0)), sub(f, sub(hfsq, mul(s, add(hfsq, R)))),
                                        sub(mul(dk, L(ln2_hi)), sub(sub(hfsq, add(mul(s, add(hfsq, R)), mul(dk, L(ln2_lo)))), f)))),
                                    iff(eq(kk, L(0)), sub(f, mul(s, sub(f, R))),
                                      sub(mul(dk, L(ln2_hi)), sub(sub(mul(s, sub(f, R)), mul(dk, L(ln2_lo))), f))))))))))))))))))));

  // The kernels on [−π/4, π/4], x + y the argument (fdlibm k_sin.c, k_cos.c).
  const Sc = [-1.66666666666666324348e-01, 8.33333333332248946124e-03, -1.98412698298579493134e-04, 2.75573137070700676789e-06, -2.50507602534068634195e-08, 1.58969099521155010221e-10];
  const Cc = [4.16666666666666019037e-02, -1.38888888888741095749e-03, 2.48015872894767294178e-05, -2.75573143513906633035e-07, 2.08757232129817482790e-09, -1.13596475577881948265e-11];
  const kSin = def("steady sine kernel", ["x", "y", "with y"], (x, y, iy) =>
    iff(lt(abs(x), L(below(0x3E400000))), x,
      let_("z", mul(x, x), (z) => let_("v", mul(z, x), (v) => let_("r", horner(z, Sc.slice(1)), (r) =>
        iff(iy, sub(x, sub(sub(mul(z, sub(mul(L(0.5), y), mul(v, r))), y), mul(v, L(Sc[0])))),
          add(x, mul(v, add(L(Sc[0]), mul(z, r))))))))));
  const kCos = def("steady cosine kernel", ["x", "y"], (x, y) => let_("ax", abs(x), (ax) =>
    iff(lt(ax, L(below(0x3E400000))), L(1),
      let_("z", mul(x, x), (z) => let_("r", mul(z, horner(z, Cc)), (r) =>
        iff(lt(ax, L(below(0x3FD33333))), sub(L(1), sub(mul(L(0.5), z), sub(mul(z, r), mul(x, y)))),
          // qx: |x|/4 with the low word cleared; |x| is in [0.3, 0.79] here,
          // so its exponent is −2 below 0.5 and −1 from there.
          let_("qx", iff(ge(ax, L(atMost(0x3FE90000))), L(0.28125),
            let_("q", iff(lt(ax, L(0.5)), L(2 ** 22), L(2 ** 21)), (q) => div(div(floor(mul(ax, q)), q), L(4)))), (qx) =>
            let_("iz", sub(mul(L(0.5), z), qx), (iz) => sub(sub(L(1), qx), sub(iz, sub(mul(z, r), mul(x, y))))))))))));

  // x − n·π/2 as y0 + y1, with n (fdlibm e_rem_pio2.c): a tuple (n, y0, y1).
  const invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11;
  const pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21, pio2_3t = 8.47842766036889956997e-32;
  const npio2_hw = [0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
    0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
    0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB];
  const three = (n: Id, y0: Id, y1: Id) => k.call(tupleVariant(3), n, y0, y1);
  // Whether |x|'s high word is n·π/2's (n from 1 to 31), where the quick
  // check can't rule out a cancellation.
  const sameWord = (n: Id, ax: Id): Id => npio2_hw.slice(0, 31).reduceRight((rest: Id, hw, i) =>
    iff(eq(n, L(i + 1)), and(ge(ax, L(word(hw))), lt(ax, L(word(hw + 1)))), rest), k.x(FALSE));
  const pair = (a: Id, b: Id) => k.call(tupleVariant(2), a, b);
  // fdlibm's two more rounds of π/2 when the first cancels: (r, w).
  const rounds = (n: Id, ax: Id, r: Id, w: Id): Id => let_("j", k.call(exponent, ax), (j) =>
    iff(le(sub(j, field(sub(r, w))), L(16)), pair(r, w),
      let_("w2", mul(n, L(pio2_2)), (w2a) =>
        let_("r2", sub(r, w2a), (r2) =>
          let_("w2", sub(mul(n, L(pio2_2t)), sub(sub(r, r2), w2a)), (w2) =>
            iff(le(sub(j, field(sub(r2, w2))), L(49)), pair(r2, w2),
              let_("w3", mul(n, L(pio2_3)), (w3a) =>
                let_("r3", sub(r2, w3a), (r3) => pair(r3, sub(mul(n, L(pio2_3t)), sub(sub(r2, r3), w3a)))))))))));
  // The medium case: |x| up to 2^20·π/2.
  const medium = (x: Id, ax: Id): Id => let_("n", floor(add(mul(ax, L(invpio2)), L(0.5))), (n) =>
    let_("r", sub(ax, mul(n, L(pio2_1))), (r) =>
      let_("w", mul(n, L(pio2_1t)), (w) =>
        k.match(iff(and(lt(n, L(32)), not(sameWord(n, ax))), pair(r, w), rounds(n, ax, r, w)), [
          { variant: tupleVariant(2), names: ["r", "w"], body: ([rr, ww]) => let_("y0", sub(rr, ww), (y0) => let_("y1", sub(sub(rr, y0), ww), (y1) =>
            iff(lt(x, L(0)), three(neg(n), neg(y0), neg(y1)), three(n, y0, y1)))) },
        ]))));
  // |x| below 3π/4: n is ±1.
  const nearOne = (x: Id, ax: Id): Id => let_("near", and(ge(ax, L(word(0x3FF921FB))), lt(ax, L(word(0x3FF921FC)))), (near) =>
    iff(gt(x, L(0)),
      let_("z", sub(x, L(pio2_1)), (z) => iff(not(near),
        let_("y0", sub(z, L(pio2_1t)), (y0) => three(L(1), y0, sub(sub(z, y0), L(pio2_1t)))),
        let_("z2", sub(z, L(pio2_2)), (z2) => let_("y0", sub(z2, L(pio2_2t)), (y0) => three(L(1), y0, sub(sub(z2, y0), L(pio2_2t))))))),
      let_("z", add(x, L(pio2_1)), (z) => iff(not(near),
        let_("y0", add(z, L(pio2_1t)), (y0) => three(L(-1), y0, add(sub(z, y0), L(pio2_1t)))),
        let_("z2", add(z, L(pio2_2)), (z2) => let_("y0", add(z2, L(pio2_2t)), (y0) => three(L(-1), y0, add(sub(z2, y0), L(pio2_2t)))))))));
  const reduced = def("steady reduced", ["x"], (x) => let_("ax", abs(x), (ax) =>
    iff(lt(ax, L(atMost(0x3FE921FB))), three(L(0), x, L(0)),
      iff(lt(ax, L(below(0x4002D97C))), nearOne(x, ax),
        iff(lt(ax, L(atMost(0x413921FB))), medium(x, ax),
          k.call(S.stop, k.lit("steady sin, cos and tan take |x| below 1,647,100 for now (Payne and Hanek's reduction is BACKLOG L210)")))))));
  // n mod 4, for a negative n too (C's n & 3).
  const quarter = (n: Id) => sub(n, mul(L(4), floor(div(n, L(4)))));
  const byQuarter = (x: Id, small: Id, arms: (y0: Id, y1: Id) => [Id, Id, Id, Id]) =>
    iff(lt(abs(x), L(atMost(0x3FE921FB))), small, k.match(k.call(reduced, x), [
      { variant: tupleVariant(3), names: ["n", "y0", "y1"], body: ([n, y0, y1]) => let_("q", quarter(n), (q) => {
        const [a, b, c, d] = arms(y0, y1);
        return iff(eq(q, L(0)), a, iff(eq(q, L(1)), b, iff(eq(q, L(2)), c, d)));
      }) },
    ]));
  const yes = () => k.x(TRUE), no = () => k.x(FALSE);
  const sin = def("steady sin", ["x"], (x) => byQuarter(x, k.call(kSin, x, L(0), no()), (y0, y1) =>
    [k.call(kSin, y0, y1, yes()), k.call(kCos, y0, y1), neg(k.call(kSin, y0, y1, yes())), neg(k.call(kCos, y0, y1))]));
  const cos = def("steady cos", ["x"], (x) => byQuarter(x, k.call(kCos, x, L(0)), (y0, y1) =>
    [k.call(kCos, y0, y1), neg(k.call(kSin, y0, y1, yes())), neg(k.call(kCos, y0, y1)), k.call(kSin, y0, y1, yes())]));

  // tan (fdlibm k_tan.c, s_tan.c). `odd` is 1, or −1 for −1/tan.
  const Tt = [3.33333333333334091986e-01, 1.33333333333201242699e-01, 5.39682539762260521377e-02, 2.18694882948595424599e-02, 8.86323982359930005737e-03, 3.59207910759131235356e-03,
    1.45620945432529025516e-03, 5.88041240820264096874e-04, 2.46463134818469906812e-04, 7.81794442939557092300e-05, 7.14072491382608190305e-05, -1.85586374855275456654e-05, 2.59073051863633712884e-05];
  const pio4 = 7.85398163397448278999e-01, pio4lo = 3.06161699786838301793e-17;
  // v with its low word cleared (SET_LOW_WORD(v, 0)): towards zero, to the
  // 20 fraction bits of the high word. A subnormal's high word holds its
  // top bits at 2^−1042.
  const lowCleared = def("steady low word cleared", ["v"], (v) => let_("a", abs(v), (a) => iff(eq(a, L(0)), L(0),
    let_("e", iff(lt(a, L(2 ** -1022)), L(-1022), k.call(exponent, a)), (e) =>
      let_("t", k.call(scaled, floor(k.call(scaled, a, sub(L(20), e))), sub(e, L(20))), (t) => iff(lt(v, L(0)), neg(t), t))))));
  // −1/w worked out carefully, w = z0 + v with z0 = w's low word cleared.
  const minusOver = (w0: Id, v0: Id) => let_("w", w0, (w) => let_("v", v0, (v) =>
    let_("a", div(L(-1), w), (a) => let_("t", k.call(lowCleared, a), (t) =>
      let_("s", add(L(1), mul(t, k.call(lowCleared, w))), (s0) => add(t, mul(a, add(s0, mul(t, v)))))))));
  const kTan = def("steady tangent kernel", ["x", "y", "odd"], (x0, y0, iy) => let_("ax", abs(x0), (ax) =>
    iff(lt(ax, L(below(0x3E300000))),
      iff(and(eq(x0, L(0)), eq(iy, L(-1))), div(L(1), ax),
        iff(eq(iy, L(1)), x0,
          let_("w", add(x0, y0), (w) => minusOver(w, sub(y0, sub(k.call(lowCleared, w), x0)))))),
      let_("big", ge(ax, L(word(0x3FE59428))), (big) =>
        let_("x", iff(big, add(sub(L(pio4), abs(x0)), sub(L(pio4lo), iff(lt(x0, L(0)), neg(y0), y0))), x0), (x) =>
          let_("y", iff(big, L(0), y0), (y) =>
            let_("z", mul(x, x), (z) => let_("w", mul(z, z), (w) =>
              let_("r", horner(w, [Tt[1], Tt[3], Tt[5], Tt[7], Tt[9], Tt[11]]), (r1) =>
                let_("v", mul(z, horner(w, [Tt[2], Tt[4], Tt[6], Tt[8], Tt[10], Tt[12]])), (v) =>
                  let_("s", mul(z, x), (s0) =>
                    let_("r", add(add(y, mul(z, add(mul(s0, add(r1, v)), y))), mul(L(Tt[0]), s0)), (r) =>
                      let_("w", add(x, r), (ww) =>
                        iff(big, mul(iff(lt(x0, L(0)), L(-1), L(1)), sub(iy, mul(L(2), sub(x, sub(div(mul(ww, ww), add(ww, iy)), r))))),
                          iff(eq(iy, L(1)), ww, minusOver(ww, sub(r, sub(k.call(lowCleared, ww), x))))))))))))))))));
  const tan = def("steady tan", ["x"], (x) =>
    iff(lt(abs(x), L(atMost(0x3FE921FB))), k.call(kTan, x, L(0), L(1)), k.match(k.call(reduced, x), [
      { variant: tupleVariant(3), names: ["n", "y0", "y1"], body: ([n, y0, y1]) =>
        k.call(kTan, y0, y1, sub(L(1), mul(L(2), sub(n, mul(L(2), floor(div(n, L(2)))))))) },
    ])));

  // pow (fdlibm e_pow.c): log2 x worked out in two parts, times y in two
  // parts, then 2 to that. The bit tests on y become: y is an odd or even
  // whole number. What has no answer (a negative x to a fraction, 0 to a
  // negative) and what overflows are the builtin's own, so they end as
  // x ^ y does.
  const PL = [5.99999999999994648725e-01, 4.28571428578550184252e-01, 3.33333329818377432918e-01, 2.72728123808534006489e-01, 2.30660745775561754067e-01, 2.06975017800338417784e-01];
  const lg2 = 6.93147180559945286227e-01, lg2_h = 6.93147182464599609375e-01, lg2_l = -1.90465429995776804525e-09, ovt = 8.0085662595372944372e-0017;
  const cp = 9.61796693925975554329e-01, cp_h = 9.61796700954437255859e-01, cp_l = -7.02846165095275826516e-09;
  const ivln2 = 1.44269504088896338700e+00, ivln2_h = 1.44269502162933349609e+00, ivln2_l = 1.92596299112661746887e-08;
  const dp_h = [0, 5.84962487220764160156e-01], dp_l = [0, 1.35003920212974897128e-08];
  const cleared = (v: Id) => k.call(lowCleared, v);
  // log2 |x| as t1 + t2, t1's low word cleared.
  const log2Parts = (ax: Id, body: (t1: Id, t2: Id) => Id): Id => let_("e", k.call(exponent, ax), (e) =>
    let_("m", k.call(scaled, ax, neg(e)), (m) =>
      let_("j", floor(mul(sub(m, L(1)), L(2 ** 20))), (j) =>
        let_("kk", iff(le(j, L(0x3988E)), L(0), iff(lt(j, L(0xBB67A)), L(1), L(2))), (kk) =>
          // kk 2: as 0, with x halved and n one more.
          let_("n", iff(eq(kk, L(2)), add(e, L(1)), e), (n) =>
            let_("ix", iff(eq(kk, L(2)), add(L(0x3fe00000), j), add(L(0x3ff00000), j)), (ix) =>
              let_("a", iff(eq(kk, L(2)), div(m, L(2)), m), (a) =>
                let_("one", eq(kk, L(1)), (isOne) =>
                  let_("bp", iff(isOne, L(1.5), L(1)), (bp) =>
                    let_("u", sub(a, bp), (u) =>
                      let_("v", div(L(1), add(a, bp)), (v) =>
                        let_("ss", mul(u, v), (ss) =>
                          let_("s_h", cleared(ss), (s_h) =>
                            // t_h: the double whose high word is
                            // ((ix >> 1) | 0x20000000) + 0x80000 + (k << 18).
                            let_("H", add(add(add(floor(div(ix, L(2))), L(0x20000000)), L(0x80000)), iff(isOne, L(2 ** 18), L(0))), (H) =>
                              let_("E", floor(div(H, L(2 ** 20))), (E) =>
                                let_("t_h", k.call(scaled, add(L(1), div(sub(H, mul(E, L(2 ** 20))), L(2 ** 20))), sub(E, L(1023))), (t_h) =>
                                  let_("t_l", sub(a, sub(t_h, bp)), (t_l) =>
                                    let_("s_l", mul(v, sub(sub(u, mul(s_h, t_h)), mul(s_h, t_l))), (s_l) =>
                                      let_("s2", mul(ss, ss), (s2) =>
                                        let_("r", add(mul(mul(s2, s2), horner(s2, PL)), mul(s_l, add(s_h, ss))), (r) =>
                                          let_("s2h", mul(s_h, s_h), (s2h) =>
                                            let_("t_h", cleared(add(add(L(3), s2h), r)), (t_h2) =>
                                              let_("t_l", sub(r, sub(sub(t_h2, L(3)), s2h)), (t_l2) =>
                                                let_("u", mul(s_h, t_h2), (u2) =>
                                                  let_("v", add(mul(s_l, t_h2), mul(t_l2, ss)), (v2) =>
                                                    let_("p_h", cleared(add(u2, v2)), (p_h) =>
                                                      let_("p_l", sub(v2, sub(p_h, u2)), (p_l) =>
                                                        let_("z_h", mul(L(cp_h), p_h), (z_h) =>
                                                          let_("z_l", add(add(mul(L(cp_l), p_h), mul(p_l, L(cp))), iff(isOne, L(dp_l[1]), L(dp_l[0]))), (z_l) =>
                                                            let_("dph", iff(isOne, L(dp_h[1]), L(dp_h[0])), (dph) =>
                                                              let_("t1", cleared(add(add(add(z_h, z_l), dph), n)), (t1) =>
                                                                body(t1, sub(z_l, sub(sub(sub(t1, n), dph), z_h))))))))))))))))))))))))))))))))));
  // |x| within 2^−20 of 1 and |y| past 2^31: log2 by its series.
  const log2Near = (ax: Id, body: (t1: Id, t2: Id) => Id): Id => let_("t", sub(ax, L(1)), (t) =>
    let_("w", mul(mul(t, t), sub(L(0.5), mul(t, sub(L(0.3333333333333333333333), mul(t, L(0.25)))))), (w) =>
      let_("u", mul(L(ivln2_h), t), (u) =>
        let_("v", sub(mul(t, L(ivln2_l)), mul(w, L(ivln2))), (v) =>
          let_("t1", cleared(add(u, v)), (t1) => body(t1, sub(v, sub(t1, u))))))));
  // z · 2^n rounded once, for a z near 1.
  const timesTwoTo = (z0: Id, n: Id) => let_("z", z0, (z) => iff(gt(n, L(1023)), mul(mul(z, L(2)), k.call(twoTo, sub(n, L(1)))),
    iff(lt(n, L(-1022)), mul(mul(z, k.call(twoTo, add(n, L(54)))), L(2 ** -54)), mul(z, k.call(twoTo, n)))));
  // s · 2^(y·(t1 + t2)), or the builtin's overflow, or 0.
  const powTail = (x: Id, y: Id, sg: Id, t1: Id, t2: Id): Id => let_("y1", cleared(y), (y1) =>
    let_("p_l", add(mul(sub(y, y1), t1), mul(y, t2)), (p_l) =>
      let_("p_h", mul(y1, t1), (p_h) =>
        let_("z", add(p_l, p_h), (z) =>
          iff(or(gt(z, L(1024)), and(eq(z, L(1024)), gt(add(p_l, L(ovt)), sub(z, p_h)))), k.call(B.pow, x, y),
            iff(or(lt(z, L(-1075)), and(eq(z, L(-1075)), le(p_l, sub(z, p_h)))), L(0),
              let_("n", iff(ge(abs(z), L(atMost(0x3fe00000))), let_("nn", floor(add(abs(z), L(0.5))), (nn) => iff(lt(z, L(0)), neg(nn), nn)), L(0)), (n) =>
                let_("p_h", sub(p_h, n), (ph) =>
                  let_("t", cleared(add(p_l, ph)), (t) =>
                    let_("u", mul(t, L(lg2_h)), (u) =>
                      let_("v", add(mul(sub(p_l, sub(t, ph)), L(lg2)), mul(t, L(lg2_l))), (v) =>
                        let_("z", add(u, v), (z2) =>
                          let_("w", sub(v, sub(z2, u)), (w) =>
                            let_("t", mul(z2, z2), (tt) =>
                              let_("t1", sub(z2, mul(tt, horner(tt, P))), (tz) =>
                                let_("r", div(mul(z2, tz), sub(sub(tz, L(2)), add(w, mul(z2, w)))), (r) =>
                                  mul(sg, timesTwoTo(sub(L(1), sub(r, z2)), n))))))))))))))))));
  const pow = def("steady pow", ["x", "y"], (x, y) => let_("ax", abs(x), (ax) => let_("ay", abs(y), (ay) =>
    // y an odd whole number, or an even one (fdlibm's yisint 1 and 2).
    let_("whole", eq(floor(y), y), (whole) => let_("odd", and(whole, not(eq(floor(div(y, L(2))), div(y, L(2))))), (odd) =>
      iff(eq(y, L(0)), L(1),
        iff(eq(y, L(1)), x, iff(eq(y, L(-1)), div(L(1), x), iff(eq(y, L(2)), mul(x, x),
          iff(and(eq(y, L(0.5)), ge(x, L(0))), k.call(B.sqrt, x),
            iff(or(eq(ax, L(0)), eq(ax, L(1))),
              iff(and(lt(x, L(0)), not(whole)), k.call(B.pow, x, y),
                let_("z", iff(lt(y, L(0)), div(L(1), ax), ax), (z) => iff(and(lt(x, L(0)), odd), neg(z), z))),
              iff(and(lt(x, L(0)), not(whole)), k.call(B.pow, x, y),
                let_("s", iff(and(lt(x, L(0)), odd), L(-1), L(1)), (sg) =>
                  // past 2^64 it must over- or underflow; past 2^31 too, unless x is near 1.
                  iff(ge(ay, L(atMost(0x41e00000))),
                    iff(or(and(ge(ay, L(atMost(0x43f00000))), or(and(lt(ax, L(1)), lt(y, L(0))), and(ge(ax, L(1)), gt(y, L(0))))),
                      or(and(lt(ax, L(below(0x3fefffff))), lt(y, L(0))), and(ge(ax, L(atMost(0x3ff00000))), gt(y, L(0))))), k.call(B.pow, x, y),
                      iff(or(ge(ay, L(atMost(0x43f00000))), or(lt(ax, L(below(0x3fefffff))), ge(ax, L(atMost(0x3ff00000))))), L(0),
                        log2Near(ax, (t1, t2) => powTail(x, y, sg, t1, t2)))),
                    log2Parts(ax, (t1, t2) => powTail(x, y, sg, t1, t2))))))))))))))));

  const offered = [sin, cos, tan, exp, log, pow];
  const comments: Record<Id, string> = {
    [sin]: "sin x with the same bits on every machine: fdlibm's, written in Ters (sin is the platform's own, within a few ulp).",
    [cos]: "cos x with the same bits on every machine: fdlibm's, written in Ters.",
    [tan]: "tan x with the same bits on every machine: fdlibm's, written in Ters. No answer where cos x is 0.",
    [pow]: "x to the power y with the same bits on every machine: fdlibm's, written in Ters. No answer where x ^ y has none.",
    [exp]: "e^x with the same bits on every machine: fdlibm's, written in Ters.",
    [log]: "The natural log of x with the same bits on every machine: fdlibm's, written in Ters. No answer for x ≤ 0.",
  };
  const p = publish(merge(prelude, std, k.code), k.names, offered, merge(prelude, std));
  if (!p.ok) throw new Error(`the steady module can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("steady", p.code, p.names, offered.map(at), p.pins, notes);
}
