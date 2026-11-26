// The signals module (BACKLOG L272): what a tuner, a looper and a pitch
// finder do to a block of samples, written in the language on the numbers
// module's Complex. A list of Complex is two columns of Float64s where the
// compiler stores it so (C60), so nothing here says how it is laid out.
//
// The FFT is Cooley and Tukey's radix-2 split (J. W. Cooley and J. W.
// Tukey, "An algorithm for the machine calculation of complex Fourier
// series", 1965): a list of even length is its even and odd items'
// transforms put together, and an odd length is the transform as defined,
// so any length works and a power of two is n log n. Correlation by FFT is
// the Wiener–Khinchin theorem: the transform of a signal's autocorrelation
// is its power spectrum. The window is Hann's (Blackman and Tukey, 1958),
// and a peak between samples is read off the parabola through it and its
// neighbours (quadratic interpolation, J. O. Smith, "Spectral Audio Signal
// Processing", 2011).

import { merge, type Id, nodeIds } from "../model.ts";
import { B, prelude } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { ARITH, ARRAY_OPS, CONS, INT_OPS, NIL, PAIR_V, S, std } from "./std.ts";

export function buildSignals(pre: Module, nums: Module): Module {
  const k = new Lang(merge(prelude, std, pre.code, nums.code));
  const from = (m: Module) => (name: string) => {
    const d = m.code.defs.find((x) => m.names[x] === name);
    if (!d) throw new Error(`signals: no ${name}`);
    return d;
  };
  const lib = from(pre), num = from(nums);
  const map = lib("map"), length = lib("length"), append = lib("append"), zipped = lib("zipped"), take = lib("take"), numbered = lib("numbered"), sum = lib("sum");
  const polar = num("from polar"), conj = num("complex conjugate"), asComplex = num("as complex");
  const complexV = nodeIds(nums.code.nodes).find((d) => nums.code.nodes[d].kind === "variant" && nums.names[d] === "complex")!;

  const f = { add: (a: Id, b: Id) => k.call(B.add, a, b), sub: (a: Id, b: Id) => k.call(B.sub, a, b), mul: (a: Id, b: Id) => k.call(B.mul, a, b), div: (a: Id, b: Id) => k.call(B.div, a, b) };
  const i = { add: (a: Id, b: Id) => k.call(INT_OPS.add, a, b), sub: (a: Id, b: Id) => k.call(INT_OPS.sub, a, b), mul: (a: Id, b: Id) => k.call(INT_OPS.mul, a, b), less: (a: Id, b: Id) => k.call(INT_OPS.less, a, b), float: (a: Id) => k.call(INT_OPS.toNumber, a) };
  const tau = () => k.lit(2 * Math.PI);
  // a / b where b is 0 only for an empty list, which gives 0: written so
  // the checker reads the guard and the division has an answer (L125b).
  const over = (a: Id, b: Id, name: string) => k.let(name, b, (d) => k.if(k.call(S.equal, d, k.lit(0)), k.lit(0), f.div(a, d)));
  const re = (z: Id, body: (re: Id, im: Id) => Id) => k.match(z, [{ variant: complexV, names: ["re", "im"], body: ([a, b]) => body(a, b) }]);
  const pairOf = (p: Id, names: [string, string], body: (a: Id, b: Id) => Id) => k.match(p, [{ variant: PAIR_V, names, body: ([a, b]) => body(a, b) }]);

  // e^(sign·2πi·k/n), the root of unity a transform turns by.
  const turn = (sign: number, kk: Id, n: Id) => k.call(polar, k.lit(1), f.mul(k.lit(sign), over(f.mul(tau(), i.float(kk)), i.float(n), "length")));

  // The transform as written, for a length with no 2 in it: item k is
  // Σ x_j · e^(−2πi·jk/n).
  const dft = k.def("discrete fourier transform");
  k.define(dft, k.fn(["items"], (xs) => k.let("n", k.call(length, xs), (n) =>
    k.call(map, k.call(INT_OPS.range, n), k.fn(["k"], (kk) =>
      k.call(sum, k.call(map, k.call(numbered, xs), k.fn(["numbered item"], (p) =>
        pairOf(p, ["j", "x"], (j, x) => k.call(ARITH.mul, x, turn(-1, i.mul(j, kk), n)))))))))));

  // The fft of the n items of an array from `start`, `step` apart, as an
  // array: its even items' and odd items' transforms are the ones `step`
  // twice as far apart, so the items are never copied out into lists,
  // and each half is filled where it is made (fill-arrays.ts). An item is
  // there by the parameters, so `item at` never fails: the 0 is never
  // read. The roots of unity are worked out once, for the whole length:
  // e^(−2πi·k/n) is the whole's root k·step, the same bits, since
  // 2π·(k·step)/(n·step) rounds as 2π·k/n does for a power of two step.
  // So the same sums of the same products in the same order as on a
  // list, n/2 roots made instead of n/2 at every level. A pair is put
  // together at once, and each product worked out where it is added and
  // where it is taken away, as the list's turned odd item was used twice.
  const itemOf = (xs: Id, j: Id) => k.call(S.first, k.thunk(() => k.call(ARRAY_OPS.at, xs, j)), k.thunk(() => k.call(complexV, k.lit(0), k.lit(0))));
  const filled = (n: Id, name: string, f: (j: Id) => Id) => k.call(ARRAY_OPS.of, k.call(map, k.call(INT_OPS.range, n), k.fn([name], f)));
  const fftAt = k.def("fft of array");
  // Item j of a half's pair put together: a + b·root or a − b·root.
  const both = (j: Id, h: () => Id, a: (kk: Id) => Id, b: (kk: Id) => Id, root: (kk: Id) => Id) => k.if(i.less(j, h()),
    k.call(ARITH.add, a(j), k.call(ARITH.mul, b(j), root(j))),
    k.let("k", i.sub(j, h()), (kk) => k.call(ARITH.sub, a(kk), k.call(ARITH.mul, b(kk), root(kk)))));
  k.define(fftAt, k.fn(["items", "roots", "start", "step", "n"], (xs, roots, start, step, n) =>
    k.if(i.less(n, k.int(2)), filled(n, "j", () => itemOf(xs, start)),
      k.if(k.call(S.equal, n, k.int(2)),
        k.let("first", itemOf(xs, start), (x0) => k.let("second", itemOf(xs, i.add(start, step)), (x1) => k.let("root", itemOf(roots, k.int(0)), (r) =>
          filled(n, "j", (j) => both(j, () => k.int(1), () => x0, () => x1, () => r))))),
        k.if(k.call(S.equal, k.call(INT_OPS.bitAnd, n, k.int(1)), k.int(1)),
          k.call(ARRAY_OPS.of, k.call(dft, k.call(map, k.call(INT_OPS.range, n), k.fn(["j"], (j) => itemOf(xs, i.add(start, i.mul(j, step))))))),
          k.let("half", k.call(INT_OPS.shiftDown, n, k.int(1)), (h) =>
            k.let("evens' transform", k.call(fftAt, xs, roots, start, i.mul(step, k.int(2)), h), (fe) =>
              k.let("odds' transform", k.call(fftAt, xs, roots, i.add(start, step), i.mul(step, k.int(2)), h), (fo) =>
                filled(n, "j", (j) => both(j, () => h, (kk) => itemOf(fe, kk), (kk) => itemOf(fo, kk), (kk) => itemOf(roots, i.mul(kk, step))))))))))));

  const fft = k.def("fft");
  k.define(fft, k.fn(["items"], (xs) => k.let("n", k.call(length, xs), (n) =>
    k.if(i.less(n, k.int(2)), xs,
      k.if(k.call(S.equal, k.call(INT_OPS.bitAnd, n, k.int(1)), k.int(1)), k.call(dft, xs),
        k.call(ARRAY_OPS.items, k.call(fftAt, k.call(ARRAY_OPS.of, xs), filled(k.call(INT_OPS.shiftDown, n, k.int(1)), "k", (kk) => turn(-1, kk, n)), k.int(0), k.int(1), n)))))));

  // The inverse by the forward one: conj(fft(conj(X))) / n.
  const ifft = k.def("inverse fft");
  k.define(ifft, k.fn(["spectrum"], (xs) => k.let("1 / n", over(k.lit(1), i.float(k.call(length, xs)), "n"), (inv) =>
    k.call(map, k.call(fft, k.call(map, xs, conj)), k.fn(["z"], (z) => re(z, (a, b) =>
      k.call(complexV, f.mul(a, inv), f.mul(k.call(B.neg, b), inv))))))));

  const spectrum = k.def("spectrum");
  k.define(spectrum, k.fn(["samples"], (xs) => k.call(fft, k.call(map, xs, asComplex))));

  // The smallest power of two at least n.
  const doubling = k.def("doubled until");
  k.define(doubling, k.fn(["p", "n"], (p, n) => k.if(i.less(p, n), k.call(doubling, i.mul(p, k.int(2)), n), p)));
  const pow2 = k.def("power of two at least");
  k.define(pow2, k.fn(["n"], (n) => k.call(doubling, k.int(1), n)));

  // xs, then zeros up to `size` items.
  const padded = k.def("padded to");
  k.define(padded, k.fn(["samples", "size"], (xs, size) => k.call(append, xs,
    k.call(map, k.call(INT_OPS.range, i.sub(size, k.call(length, xs))), k.fn(["i"], () => k.lit(0))))));

  const hann = k.def("hann window");
  k.define(hann, k.fn(["n"], (n) => k.call(map, k.call(INT_OPS.range, n), k.fn(["i"], (ii) =>
    k.if(i.less(n, k.int(2)), k.lit(1),
      f.sub(k.lit(0.5), f.mul(k.lit(0.5), k.call(B.cos, over(f.mul(tau(), i.float(ii)), i.float(i.sub(n, k.int(1))), "n − 1")))))))));

  const windowed = k.def("hann windowed");
  k.define(windowed, k.fn(["samples"], (xs) => k.call(map, k.call(zipped, xs, k.call(hann, k.call(length, xs))), k.fn(["both"], (b) =>
    pairOf(b, ["x", "w"], (x, w) => f.mul(x, w))))));

  // Σ_i a[i + lag] · b[i] for lags 0 to length(a) − 1, by FFT: where b
  // turns up in a, and how strongly. Both are padded to a power of two
  // at least their lengths added, so nothing wraps around.
  const xcorr = k.def("cross correlation");
  k.define(xcorr, k.fn(["a", "b"], (a, b) => k.let("size", k.call(pow2, i.add(k.call(length, a), k.call(length, b))), (size) =>
    k.call(take, k.call(map, k.call(ifft, k.call(map, k.call(zipped, k.call(spectrum, k.call(padded, a, size)), k.call(spectrum, k.call(padded, b, size))), k.fn(["both"], (p) =>
      pairOf(p, ["x", "y"], (x, y) => k.call(ARITH.mul, x, k.call(conj, y)))))), k.fn(["z"], (z) => re(z, (r) => r))), k.call(length, a)))));

  const acorr = k.def("autocorrelation");
  // One transform, not two: the power spectrum |X|² back again.
  k.define(acorr, k.fn(["samples"], (xs) => k.let("size", k.call(pow2, i.mul(k.int(2), k.call(length, xs))), (size) =>
    k.call(take, k.call(map, k.call(ifft, k.call(map, k.call(spectrum, k.call(padded, xs, size)), k.fn(["z"], (z) =>
      re(z, (a, b) => k.call(complexV, f.add(f.mul(a, a), f.mul(b, b)), k.lit(0)))))), k.fn(["z"], (z) => re(z, (r) => r))), k.call(length, xs)))));

  // Where the top of the parabola through three neighbouring values is,
  // from the middle one: between −½ and ½ when the middle is the highest.
  const vertex = k.def("parabola peak offset");
  k.define(vertex, k.fn(["before", "at", "after"], (a, b, c) => k.let("curve", f.add(f.sub(a, f.mul(k.lit(2), b)), c), (d) =>
    k.if(k.call(S.equal, d, k.lit(0)), k.lit(0), f.div(f.mul(k.lit(0.5), f.sub(a, c)), d)))));

  // The places where a value is higher than both neighbours, each read
  // between samples off its parabola: a list of (place, height).
  const peaks = k.def("peaks");
  const peaksFrom = k.def("peaks from");
  k.define(peaksFrom, k.fn(["place", "before", "at", "rest"], (p, a, b, rest) => k.match(rest, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["after", "rest after"], body: ([c, more]) => k.let("the rest's peaks", k.call(peaksFrom, i.add(p, k.int(1)), b, c, more), (later) =>
      k.if(k.call(S.and, k.call(S.less, a, b), k.call(S.not, k.call(S.less, b, c))),
        k.let("offset", k.call(vertex, a, b, c), (o) =>
          k.call(CONS, k.call(PAIR_V, f.add(i.float(p), o), f.sub(b, f.mul(k.lit(0.25), f.mul(f.sub(a, c), o)))), later)),
        later)) },
  ])));
  k.define(peaks, k.fn(["values"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["first", "rest"], body: ([a, r]) => k.match(r, [
      { variant: NIL, names: [], body: () => NIL },
      { variant: CONS, names: ["second", "after"], body: ([b, more]) => k.call(peaksFrom, k.int(1), a, b, more) },
    ]) },
  ])));

  const offered = [fft, ifft, spectrum, hann, windowed, xcorr, acorr, peaks, vertex, pow2, padded];
  const helpers = [fftAt, dft, doubling, peaksFrom];
  const comments: Record<Id, string> = {
    [fft]: "The discrete Fourier transform of a list of complex numbers: item k is Σ x_j·e^(−2πi·jk/n). Any length; a power of two takes n log n steps. Cooley and Tukey's radix-2 split (1965).",
    [ifft]: "The inverse of fft: inverse fft(fft(xs)) is xs again.",
    [spectrum]: "The fft of real samples: item k is how much of k cycles per length there is, as a complex number (its modulus the amount, its angle the phase).",
    [hann]: "n weights rising from 0 to 1 and back, ½ − ½cos(2πi/(n − 1)): a block multiplied by them has no edges, so its spectrum doesn't smear. Hann's window (Blackman and Tukey, 1958).",
    [windowed]: "The samples multiplied by a Hann window as long as they are.",
    [xcorr]: "For each lag from 0 to length(a) − 1, Σ a[i + lag]·b[i]: how strongly b turns up in a that many samples late. By FFT (Wiener–Khinchin), so n log n.",
    [acorr]: "The cross correlation of the samples with themselves: high at a lag the signal repeats after, so a note's period is its first high lag past 0.",
    [peaks]: "Every place a value is higher than both its neighbours, as (place, height), each read between samples off the parabola through the three (quadratic interpolation).",
    [vertex]: "Where the top of the parabola through three evenly spaced values is, from the middle one: 0 when the middle is the top, between −½ and ½ when it is the highest of the three.",
    [pow2]: "The smallest power of two that is at least n: the length an FFT is quickest at.",
    [padded]: "The samples with zeros after them, to size items in all.",
    [fftAt]: "The fft of n items of an array, from start, step apart, as an array, by the whole length's roots of unity. A helper of fft. Not offered.",
    [dft]: "The transform as written, n² steps. A helper of fft for lengths with no 2 in them. Not offered.",
    [doubling]: "A helper of power of two at least. Not offered.",
    [peaksFrom]: "A helper of peaks. Not offered.",
  };
  const p = publish(merge(prelude, std, pre.code, nums.code, k.code), k.names, [...offered, ...helpers], merge(prelude, std, pre.code, nums.code));
  if (!p.ok) throw new Error(`the signals module can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("signals", p.code, p.names, offered.map(at), { ...pre.pins, ...nums.pins, ...p.pins }, notes, helpers.map(at));
}
