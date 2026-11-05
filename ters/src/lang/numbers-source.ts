// The numbers module (BACKLOG L207): the library's number types written in
// the language, out of std.ts, each with its + − · ÷, its Trig and its
// embedding as implementations found by its type. Dual (L207a),
// Complex (L207b) and Mat2 to Mat4 (L207c), Matrix (L207d) and Fixed (L207e) so far;
// Rational follows.
//
// Dual numbers (INTERFACES.md step 3): value + slope·ε with ε² = 0, so a
// function given dual(x, 1) gives its value and its slope at x. + and −
// are part by part, · is the product rule, (a + a′ε)(b + b′ε) = ab +
// (ab′ + a′b)ε, and Trig is the chain rule. The textbook construction
// (W. K. Clifford, 1873; forward-mode automatic differentiation,
// Wengert 1964).

import { merge, type Id } from "../model.ts";
import { B, prelude } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { ABORT_OP, ARITH, ARITHMETIC_V, CHECK_OP, ORDERED_V, CONS, LIST, NIL, PAIR_V, tupleType, DIVISION_V, EMBEDDING_V, INT_OPS, LITERAL_V, S, SHOWN_V, TIMES_V, TRIG_POLAR, TRIG_UNPOLAR, TRIG_V, std } from "./std.ts";
import { INT, NUMBER } from "./types.ts";

// On the prelude, whose laws give Trig's fields Dual leaves to their ways.
export function buildNumbers(pre: Module): Module {
  const k = new Lang(merge(prelude, std, pre.code));
  // The prelude's own definitions, by name.
  const lib = (name: string) => pre.code.defs.find((d) => pre.names[d] === name)!;
  const n = { add: (a: Id, b: Id) => k.call(B.add, a, b), sub: (a: Id, b: Id) => k.call(B.sub, a, b), mul: (a: Id, b: Id) => k.call(B.mul, a, b), div: (a: Id, b: Id) => k.call(B.div, a, b) };

  // A record of two Float64s, the same shape as Complex, so it says it is
  // its own type.
  const T = k.type("Dual", [], [["dual", [["value", () => k.tref(NUMBER)], ["slope", () => k.tref(NUMBER)]]]], "dual numbers");
  const DV = T.v.dual;
  const du = (v: Id, f: (a: Id, a1: Id) => Id, names = ["value", "slope"]) => k.match(v, [{ variant: DV, names, body: ([a, b]) => f(a, b) }]);
  const D = (a: Id, b: Id) => k.call(DV, a, b);
  const twoD = (name: string, f: (a: Id, a1: Id, b: Id, b1: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["x", "y"], (x, y) => du(x, (a, a1) => du(y, (b, b1) => f(a, a1, b, b1), ["value₂", "slope₂"]))));
    return d;
  };
  const oneD = (name: string, f: (a: Id, a1: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["x"], (x) => du(x, f)));
    return d;
  };
  const addD = twoD("add duals", (a, a1, b, b1) => D(n.add(a, b), n.add(a1, b1)));
  const subD = twoD("subtract duals", (a, a1, b, b1) => D(n.sub(a, b), n.sub(a1, b1)));
  const mulD = twoD("multiply duals", (a, a1, b, b1) => D(n.mul(a, b), n.add(n.mul(a, b1), n.mul(a1, b))));
  const negD = oneD("negate dual", (a, a1) => D(k.call(B.neg, a), k.call(B.neg, a1)));
  const divD = twoD("divide duals", (a, a1, b, b1) => k.if(k.call(S.equal, b, k.lit(0)), k.call(S.fail),
    D(n.div(a, b), n.div(n.sub(n.mul(a1, b), n.mul(a, b1)), n.mul(b, b)))));
  const sinD = oneD("dual sin", (a, a1) => D(k.call(B.sin, a), n.mul(k.call(B.cos, a), a1)));
  const cosD = oneD("dual cos", (a, a1) => D(k.call(B.cos, a), k.call(B.neg, n.mul(k.call(B.sin, a), a1))));
  // tan′ = 1 + tan², which needs no division (cos is never exactly 0 at a Float64).
  const tanD = oneD("dual tan", (a, a1) => k.let("tan", k.call(B.tan, a), (t) => D(t, n.mul(a1, n.add(k.lit(1), n.mul(t, t))))));
  const expD = oneD("dual exp", (a, a1) => k.let("eᵃ", k.call(B.exp, a), (e) => D(e, n.mul(e, a1))));
  const logD = oneD("dual log", (a, a1) => D(k.call(B.log, a), n.div(a1, a)));
  // Unpolar by the chain rule: for r = √(x² + y²), r′ = (x·x′ + y·y′)/r,
  // and atan2(y, x)′ = (x·y′ − y·x′)/r².
  const unpolarD = k.def("dual unpolar");
  const xy = (x: Id, y: Id, f: (a: Id, a1: Id, b: Id, b1: Id) => Id) => du(x, (a, a1) => du(y, (b, b1) => f(a, a1, b, b1), ["y value", "y slope"]), ["x value", "x slope"]);
  const sq = (a: Id, b: Id) => n.add(n.mul(a, a), n.mul(b, b));
  // At the origin the slopes are taken as 0, as atan2(0, 0) is taken as 0.
  k.define(unpolarD, k.fn(["length", "angle", "x", "y"], (r, t, x, y) => k.and(
    k.equal(r, xy(x, y, (a, a1, b, b1) => k.let("r", k.call(B.sqrt, sq(a, b)), (rr) => D(rr, k.if(k.call(S.equal, rr, k.lit(0)), k.lit(0), n.div(n.add(n.mul(a, a1), n.mul(b, b1)), rr)))))),
    k.equal(t, xy(x, y, (a, a1, b, b1) => k.let("r²", sq(a, b), (r2) => D(k.call(B.atan2, b, a), k.if(k.call(S.equal, r2, k.lit(0)), k.lit(0), n.div(n.sub(n.mul(a, b1), n.mul(b, a1)), r2)))))))));
  k.results(unpolarD, "length", "angle");
  const slopeAt = k.def("slope by duals");
  k.define(slopeAt, k.fn(["f", "x"], (f, x) => du(k.call(f, D(x, k.lit(1))), (_, a1) => a1)));
  const dualTable = k.def("dual table");
  k.define(dualTable, k.list(...([[1, 0, 1, 0, 1, 0], [1, 0, 0, 1, 0, 1], [0, 1, 1, 0, 0, 1]] as const).map(([a, b, c, d, e, f]) =>
    k.call(TIMES_V, D(k.lit(a), k.lit(b)), D(k.lit(c), k.lit(d)), D(k.lit(e), k.lit(f))))));
  const showD = oneD("show dual", (a, a1) => k.call(S.concat, k.call(S.show, a), k.call(S.concat,
    k.if(k.call(S.less, a1, k.lit(0)), k.lit(" − "), k.lit(" + ")), k.call(S.concat, k.call(S.show, k.call(S.abs, a1)), k.lit("ε")))));
  // A Float64 as a dual number with no derivative part, named so the
  // embedding (and a literal at Dual, through it) is a plain call.
  const asD = k.def("as dual");
  k.define(asD, k.fn(["x"], (x) => D(x, k.lit(0))));


  // Complex (L207b): one case of two Float64s. A record of Float64s, so
  // the parts builtins and the vectors module work on it (its magnitude
  // is |z|), but a number type of its own: · is the complex product, and
  // there is no <.
  // A unique name, as Dual has: a program's own record of two Float64s
  // (tumble's Spot) would otherwise hash as Complex and be taken for it.
  const TC = k.type("Complex", [], [["complex", [["re", () => k.tref(NUMBER)], ["im", () => k.tref(NUMBER)]]]], "complex numbers");
  const CV = TC.v.complex;
  // Complex numbers: a record of two Float64s, re + im·i. + − ·
  // and −x at Complex are these (arith.ts), so they aren't offered on
  // their own; · is (a + bi)(c + di) = (ac − bd) + (ad + bc)i.
  const cx = (v: Id, f: (re: Id, im: Id) => Id, names = ["re", "im"]) => k.match(v, [{ variant: CV, names, body: ([a, b]) => f(a, b) }]);
  const twoC = (name: string, f: (a: Id, b: Id, c: Id, d: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["z", "w"], (z, w) => cx(z, (a, b) => cx(w, (c, e) => f(a, b, c, e), ["re₂", "im₂"]))));
    return d;
  };
  const C = (re: Id, im: Id) => k.call(CV, re, im);
  const addC = twoC("add complex", (a, b, c, d) => C(n.add(a, c), n.add(b, d)));
  const subC = twoC("subtract complex", (a, b, c, d) => C(n.sub(a, c), n.sub(b, d)));
  const mulC = twoC("multiply complex", (a, b, c, d) => C(n.sub(n.mul(a, c), n.mul(b, d)), n.add(n.mul(a, d), n.mul(b, c))));
  const negC = k.def("negate complex");
  k.define(negC, k.fn(["z"], (z) => cx(z, (a, b) => C(k.call(B.neg, a), k.call(B.neg, b)))));
  const asC = k.def("as complex");
  k.define(asC, k.fn(["x"], (x) => C(x, k.lit(0))));
  const unitI = k.def("i");
  k.define(unitI, C(k.lit(0), k.lit(1)));
  const conjC = k.def("complex conjugate");
  k.define(conjC, k.fn(["z"], (z) => cx(z, (a, b) => C(a, k.call(B.neg, b)))));
  const modulus = k.def("modulus");
  k.define(modulus, k.fn(["z"], (z) => cx(z, (a, b) => k.call(B.sqrt, n.add(n.mul(a, a), n.mul(b, b))))));
  const angle = k.def("angle of");
  k.define(angle, k.fn(["z"], (z) => cx(z, (a, b) => k.call(B.atan2, b, a))));
  const polar = k.def("from polar");
  k.define(polar, k.fn(["size", "angle"], (r, t) => C(n.mul(r, k.call(B.cos, t)), n.mul(r, k.call(B.sin, t)))));
  const divC = twoC("divide complex", (a, b, c, d) => k.let("c² + d²", n.add(n.mul(c, c), n.mul(d, d)), (m) =>
    k.if(k.call(S.equal, m, k.lit(0)), k.call(S.fail), C(n.div(n.add(n.mul(a, c), n.mul(b, d)), m), n.div(n.sub(n.mul(b, c), n.mul(a, d)), m)))));
  const expC = k.def("complex exp");
  k.define(expC, k.fn(["z"], (z) => cx(z, (a, b) => k.let("eᵃ", k.call(B.exp, a), (e) => C(n.mul(e, k.call(B.cos, b)), n.mul(e, k.call(B.sin, b)))))));
  // What Float64 has no answer for, on Complex (BACKLOG L127): principal
  // values, each branch cut's points taken from above (counter-clockwise),
  // as C99's csqrt, clog, cpow, casin and cacos give for a +0 imaginary
  // part, so √−4 is 2i, log(−1) is iπ and asin(2) is π/2 + 1.317i. asin
  // and acos pick, of the two logs w and 1/w that give them, the one whose
  // input is the larger, so nothing cancels (Kahan, "Branch cuts for
  // complex elementary functions", 1987, on why that matters).
  const zero = () => C(k.lit(0), k.lit(0));
  const csqrt = k.def("complex sqrt");
  k.define(csqrt, k.fn(["z"], (z) => cx(z, (a, b) => k.let("r", k.call(modulus, z), (r) => {
    const half = (x: Id) => k.call(B.sqrt, k.call(lib("larger"), n.div(x, k.lit(2)), k.lit(0)));
    return k.let("im", half(n.sub(r, a)), (im) => C(half(n.add(r, a)), k.if(k.call(S.less, b, k.lit(0)), k.call(B.neg, im), im)));
  }))));
  const clog = k.def("complex log");
  k.define(clog, k.fn(["z"], (z) => cx(z, (a, b) => C(k.call(B.log, k.call(modulus, z)), k.call(B.atan2, b, a)))));
  const cpow = k.def("complex power");
  k.define(cpow, k.fn(["z", "w"], (z, w) => k.if(k.call(S.equal, z, zero()),
    cx(w, (c) => k.if(k.call(S.less, k.lit(0), c), zero(), k.call(S.fail)), ["re₂", "im₂"]),
    k.call(expC, k.call(mulC, w, k.call(clog, z))))));
  // −i · log(w), from w and its reciprocal's sum: the larger one's log
  // (its input is at least 1 away from 0, so there is always an answer).
  const minusILog = (w: Id, v: Id) => k.let("up", w, (up) => k.let("down", v, (down) => k.let("log", k.call(S.first,
    k.thunk(() => k.if(k.call(S.less, k.call(modulus, up), k.call(modulus, down)), k.call(negC, k.call(clog, down)), k.call(clog, up))),
    k.thunk(zero)), (l) => cx(l, (p, q) => C(q, k.call(B.neg, p)), ["p", "q"]))));
  // √(1 − z²), from above on the cut: for a real z above 1, −i√(z² − 1).
  const rootOneMinus = (z: Id, a: Id, b: Id) => k.let("s", k.call(csqrt, k.call(subC, C(k.lit(1), k.lit(0)), k.call(mulC, z, z))), (s) =>
    k.if(k.and(k.call(S.equal, b, k.lit(0)), k.call(S.less, k.lit(0), a)), k.call(conjC, s), s));
  const casin = k.def("complex asin");
  k.define(casin, k.fn(["z"], (z) => cx(z, (a, b) => k.let("s", rootOneMinus(z, a, b), (s) =>
    k.let("iz", C(k.call(B.neg, b), a), (iz) => minusILog(k.call(addC, s, iz), k.call(subC, s, iz)))))));
  const cacos = k.def("complex acos");
  k.define(cacos, k.fn(["z"], (z) => cx(z, (a, b) => k.let("s", rootOneMinus(z, a, b), (s) =>
    k.let("is", cx(s, (c, d) => C(k.call(B.neg, d), c), ["re₂", "im₂"]), (is) => minusILog(k.call(addC, z, is), k.call(subC, z, is)))))));
  const showC = k.def("show complex");
  k.define(showC, k.fn(["z"], (z) => cx(z, (a, b) => k.call(S.concat, k.call(S.show, a), k.call(S.concat,
    k.if(k.call(S.less, b, k.lit(0)), k.lit(" − "), k.lit(" + ")), k.call(S.concat, k.call(S.show, k.call(S.abs, b)), k.lit("i")))))));

  const complexTable = k.def("complex table");
  k.define(complexTable, k.list(...([[1, 0, 1, 0, 1, 0], [1, 0, 0, 1, 0, 1], [0, 1, 1, 0, 0, 1], [0, 1, 0, 1, -1, 0]] as const).map(([a, b, c, d, e, f]) =>
    k.call(TIMES_V, C(k.lit(a), k.lit(b)), C(k.lit(c), k.lit(d)), C(k.lit(e), k.lit(f))))));
  // Complex laws (POLAR.md L97e), tests in the language (T7): each performs
  // Check, so `lab test` and test/prelude-laws.test.ts run them on small
  // complex numbers. The first is from polar against modulus and angle
  // of; the second is Trig's polar and unpolar fields, one direction
  // undoing the other.
  const expect = (holds: Id, what: string) => k.call(CHECK_OP, holds, k.lit(what));
  // Two complex numbers near part by part: what the laws below check.
  const nearC = (w: Id, z: Id) => cx(w, (a, b) => cx(z, (c, d) => k.and(k.call(lib("near"), a, c), k.call(lib("near"), b, d)), ["re2", "im2"]));
  const lawFromPolar = k.def("from polar undoes modulus and angle");
  k.define(lawFromPolar, k.fn(["z"], (z) => expect(nearC(k.call(polar, k.call(modulus, z), k.call(angle, z)), z), "from polar(modulus z, angle of z) is near z")));
  const lawPolar = k.def("polar undoes unpolar");
  k.define(lawPolar, k.fn(["z"], (z) => cx(z, (a, b) =>
    k.solve(TRIG_UNPOLAR, { 0: a, 1: b, out: k.true }, { 2: "length", 3: "angle" }, ({ 2: r, 3: t }) =>
      k.solve(TRIG_POLAR, { 0: r, 1: t, out: k.true }, { 2: "x", 3: "y" }, ({ 2: x, 3: y }) =>
        expect(nearC(C(x, y), z), "polar(unpolar(x, y)) is near (x, y)"))))));

  // Small matrices (BACKLOG L44, L207c): Mat2, Mat3 and Mat4, records of
  // Float64s in rows (m11, m12, …). + − part by part, · the matrix product
  // from the matrix-unit table (E_ij · E_jl = E_il, the prelude's matrix
  // table), and a literal is that many times the identity, so 2 + m adds 2
  // down the diagonal. Each says it is its own type, as they share shapes
  // with other records of Float64s.
  const sizes = [2, 3, 4] as const;
  const mats = sizes.map((size) => k.type(`Mat${size}`, [], [[`mat${size}`, Array.from({ length: size * size }, (_, i) => [`m${Math.floor(i / size) + 1}${(i % size) + 1}`, () => k.tref(NUMBER)] as [string, () => Id])]], `${size} × ${size} matrices`));
  const matV = (i: number) => mats[i].v[`mat${sizes[i]}`];
  const matTables = sizes.map((size, i) => {
    const units = k.list(...Array.from({ length: size }, (_, r) => k.list(...Array.from({ length: size }, (_, c) =>
      k.call(matV(i), ...Array.from({ length: size * size }, (_, e) => k.lit(e === r * size + c ? 1 : 0)))))));
    const d = k.def(`mat${size} table`); k.define(d, k.call(lib("matrix table"), units)); return d;
  });
  // + − and −x part by part, at any record of Float64s.
  const partwise = (name: string, op: Id) => { const d = k.def(name); k.define(d, k.fn(["a", "b"], (a, b) => k.call(S.zipParts, op, a, b))); return d; };
  const addParts = partwise("add parts", B.add), subParts = partwise("subtract parts", B.sub);
  const negParts = k.def("negate parts");
  k.define(negParts, k.fn(["a"], (a) => k.call(S.mapParts, k.x(B.neg), a)));
  const matProducts = matTables.map((t, i) => { const d = k.def(`multiply mat${sizes[i]}`); k.define(d, k.fn(["a", "b"], (a, b) => k.call(lib("table product"), k.x(t), a, b))); return d; });
  // A number at a matrix is that many times the identity (L204c): 2 is
  // 2 down the diagonal and 0 elsewhere.
  const matLiterals = sizes.map((size, i) => {
    const d = k.def(`literal at mat${size}`);
    k.define(d, k.call(LITERAL_V, k.fn(["top", "bottom"], (t, b) => k.let("x", k.call(lib("divided or"), k.call(INT_OPS.toNumber, t), k.call(INT_OPS.toNumber, b), k.lit(0)), (x) =>
      k.call(matV(i), ...Array.from({ length: size * size }, (_, c) => (c % (size + 1) === 0 ? x : k.lit(0))))))));
    return d;
  });

  // Matrix (BACKLOG L44, MATRICES.md step 3, L207d): its row and column
  // counts and its items row by row, one flat list, as BLAS, LAPACK and
  // NumPy store a dense matrix (row-major). The size isn't in the type
  // (that needs numbers in types), so a mismatch is found when the program
  // runs and the message names both sizes. A square matrix's LU factors
  // (L44g), kept to solve it for many right-hand sides: the rows in the
  // order elimination took them as pivots, each pivot's row of U, and the
  // multipliers it took off each row below, by that row's place.
  const MX = k.type("Matrix", ["a"], [["matrix", [["rows", () => k.tref(INT)], ["columns", () => k.tref(INT)], ["items", (_t, [a]) => k.tref(LIST, k.tref(a))]]]], "matrices of any size");
  const LU = k.type("LU factors", [], [["lu factors", [["pivots", () => k.tref(LIST, k.tref(INT))], ["uppers", () => k.tref(LIST, k.tref(LIST, k.tref(NUMBER)))], ["multipliers", () => k.tref(LIST, k.tref(LIST, k.tref(tupleType(2), k.tref(INT), k.tref(NUMBER))))]]]], "LU factors");
  const MXV = MX.v.matrix, LUV = LU.v["lu factors"];
  const def = (name: string, params: string[], body: (...ps: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const entry = (e: Id, f: (key: Id, value: Id) => Id, names = ["key", "value"]) => k.match(e, [{ variant: PAIR_V, names, body: ([a, b]) => f(a, b) }]);
  const [allPass, append, dividedOr, drop, flatMap, flatten, itemAt, length, map, numbered, sortBy, take, zipped] = ["all pass", "append", "divided or", "drop", "flat map", "flatten", "item at", "length", "map", "numbered", "sort by", "take", "zipped"].map(lib);
  // Matrices of any size (L44, MATRICES.md step 3, Matrix): the
  // items row by row in one list. Products, sums and a matrix times a
  // vector are for every number type, as + and × are; a size mismatch
  // stops with both sizes, as NumPy's "shapes (2,3) and (2,2) not
  // aligned" does. solved(m, b) is the x with m·x = b, by Gaussian
  // elimination with partial pivoting (the largest pivot first, as
  // LAPACK's gesv does), at Float64; a singular matrix has no answer.
  const M = (r: Id, c: Id, xs: Id) => k.call(MXV, r, c, xs);
  const matOf = (m: Id, f: (r: Id, c: Id, xs: Id) => Id) => k.match(m, [{ variant: MXV, names: ["rows", "columns", "items"], body: ([r, c, xs]) => f(r, c, xs) }]);
  const iLess = (a: Id, b: Id) => k.call(INT_OPS.less, a, b);
  const iSame = (a: Id, b: Id) => k.equal(a, b);
  const iMul = (a: Id, b: Id) => k.call(INT_OPS.mul, a, b);
  const iAdd = (a: Id, b: Id) => k.call(INT_OPS.add, a, b);
  const texts = (...parts: Id[]) => parts.reduceRight((acc, t) => k.call(S.concat, t, acc));
  const sizeText = (r: Id, c: Id) => texts(k.call(INT_OPS.show, r), k.lit(" × "), k.call(INT_OPS.show, c));
  // Two lists' items multiplied pairwise and added, its own walk.
  const listDot = k.def("matrix dot");
  k.define(listDot, k.fn(["first", "second"], (xs, ys) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["x", "xs rest"], body: ([x, xr]) => k.match(ys, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["y", "ys rest"], body: ([y, yr]) => k.call(ARITH.add, k.call(ARITH.mul, x, y), k.call(listDot, xr, yr)) },
    ]) },
  ])));
  const rowsOf = def("matrix rows", ["matrix"], (m) => matOf(m, (r, c, xs) => k.call(map, k.call(INT_OPS.range, r), k.fn(["i"], (i) => k.call(take, k.call(drop, xs, iMul(i, c)), c)))));
  const matrixOfRows = def("matrix of rows", ["rows"], (rs) => k.match(rs, [
    { variant: NIL, names: [], body: () => M(k.int(0), k.int(0), k.x(NIL)) },
    { variant: CONS, names: ["first", "rest"], body: ([first]) => k.let("columns", k.call(length, first), (c) =>
      k.if(k.call(allPass, rs, k.fn(["row"], (row) => iSame(k.call(length, row), c))),
        M(k.call(length, rs), c, k.call(flatten, rs)),
        k.call(ABORT_OP, texts(k.lit("matrix of rows: the rows aren't all "), k.call(INT_OPS.show, c), k.lit(" long"))))) },
  ]));
  const rowCount = def("row count", ["matrix"], (m) => matOf(m, (r) => r));
  const columnCount = def("column count", ["matrix"], (m) => matOf(m, (_r, c) => c));
  const matrixEntry = def("matrix entry", ["matrix", "row", "column"], (m, i, j) => matOf(m, (r, c, xs) =>
    k.if(k.call(S.or, k.call(S.or, iLess(i, k.int(0)), k.call(S.not, iLess(i, r))), k.call(S.or, iLess(j, k.int(0)), k.call(S.not, iLess(j, c)))), k.call(S.fail),
      k.match(k.call(drop, xs, iAdd(iMul(i, c), j)), [
        { variant: CONS, names: ["item", "rest"], body: ([x]) => x },
      ], k.call(S.fail)))));
  const transposed = def("transposed", ["matrix"], (m) => matOf(m, (r, c, xs) => M(c, r,
    k.call(flatMap, k.call(INT_OPS.range, c), k.fn(["j"], (j) => k.call(flatMap, k.call(INT_OPS.range, r), k.fn(["i"], (i) => k.call(take, k.call(drop, xs, iAdd(iMul(i, c), j)), k.int(1)))))))));
  const identityMatrix = def("identity matrix", ["size"], (n) => M(n, n,
    k.call(flatMap, k.call(INT_OPS.range, n), k.fn(["i"], (i) => k.call(map, k.call(INT_OPS.range, n), k.fn(["j"], (j) => k.if(iSame(i, j), k.lit(1), k.lit(0))))))));
  const matrixScaled = def("matrix scaled", ["matrix", "by"], (m, s) => matOf(m, (r, c, xs) => M(r, c, k.call(map, xs, k.fn(["x"], (x) => k.call(ARITH.mul, s, x))))));
  const mismatch = (what: string, r1: Id, c1: Id, r2: Id, c2: Id) => k.call(ABORT_OP, texts(k.lit(`${what}: a `), sizeText(r1, c1), k.lit(" matrix and a "), sizeText(r2, c2), k.lit(" one")));
  const matrixSum = def("matrix sum", ["first", "second"], (a, b) => matOf(a, (r1, c1, xs) => matOf(b, (r2, c2, ys) =>
    k.if(k.call(S.and, iSame(r1, r2), iSame(c1, c2)),
      M(r1, c1, k.call(map, k.call(zipped, xs, ys), k.fn(["pair"], (p) => entry(p, (x, y) => k.call(ARITH.add, x, y), ["x", "y"])))),
      mismatch("matrix sum", r1, c1, r2, c2)))));
  const matrixProduct = def("matrix product", ["first", "second"], (a, b) => matOf(a, (r1, c1, _xs) => matOf(b, (r2, c2, _ys) =>
    k.if(iSame(c1, r2),
      k.let("columns", k.call(rowsOf, k.call(transposed, b)), (cols) =>
        M(r1, c2, k.call(flatMap, k.call(rowsOf, a), k.fn(["row"], (row) => k.call(map, cols, k.fn(["column"], (col) => k.call(listDot, row, col))))))),
      mismatch("matrix product", r1, c1, r2, c2)))));
  const matrixTimesVector = def("matrix times vector", ["matrix", "vector"], (m, v) => matOf(m, (r, c) =>
    k.if(iSame(c, k.call(length, v)),
      k.call(map, k.call(rowsOf, m), k.fn(["row"], (row) => k.call(listDot, row, v))),
      k.call(ABORT_OP, texts(k.lit("matrix times vector: a "), sizeText(r, c), k.lit(" matrix and a vector of "), k.call(INT_OPS.show, k.call(length, v)))))));
  // Elimination: the row with the largest first item is the pivot; the
  // others lose their first column, less a multiple of the pivot's. It
  // counts down the rows, so it ends; a pivot of 0 has no answer (divide
  // has none). Back substitution then reads the triangle from the bottom.
  const headOr0 = (row: Id) => k.match(row, [{ variant: CONS, names: ["first", "rest"], body: ([x]) => x }], k.lit(0));
  const tailOf = (row: Id) => k.match(row, [{ variant: CONS, names: ["first", "rest"], body: ([, rest]) => rest }], k.x(NIL));
  const eliminated = k.def("eliminated");
  k.define(eliminated, k.fn(["rows", "count"], (rs, n) => k.if(iLess(n, k.int(1)), k.x(NIL),
    k.match(k.call(sortBy, rs, k.fn(["row"], (row) => k.call(B.sub, k.lit(0), k.call(S.abs, headOr0(row))))), [
      { variant: NIL, names: [], body: () => k.x(NIL) },
      { variant: CONS, names: ["pivot", "others"], body: ([p, others]) => k.let("pivot first", headOr0(p), (a) =>
        k.call(CONS, p, k.call(eliminated, k.call(map, others, k.fn(["row"], (row) => k.let("factor", k.call(B.div, headOr0(row), a), (f) =>
          k.call(map, k.call(zipped, tailOf(row), tailOf(p)), k.fn(["pair"], (pr) => entry(pr, (x, y) => k.call(B.sub, x, k.call(B.mul, f, y)), ["x", "y"])))))),
          k.call(INT_OPS.sub, n, k.int(1))))) },
    ]))));
  const backSubstituted = k.def("back substituted");
  k.define(backSubstituted, k.fn(["triangle"], (t) => k.match(t, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["row", "below"], body: ([row, below]) => k.let("found", k.call(backSubstituted, below), (xs) =>
      k.let("coefficients", tailOf(row), (cs) => k.let("known", k.call(length, xs), (n) =>
        k.call(CONS, k.call(B.div, k.call(B.sub, k.call(itemAt, k.call(drop, cs, n), k.int(0), k.lit(0)), k.call(listDot, k.call(take, cs, n), xs)), headOr0(row)), xs)))) },
  ])));
  const solved = def("solved", ["matrix", "vector"], (m, v) => matOf(m, (r, c) =>
    k.if(k.call(S.and, iSame(r, c), iSame(r, k.call(length, v))),
      k.call(backSubstituted, k.call(eliminated, k.call(map, k.call(zipped, k.call(rowsOf, m), v), k.fn(["pair"], (p) => entry(p, (row, b) => k.call(append, row, k.call(CONS, b, k.x(NIL))), ["row", "b"]))), r)),
      k.call(ABORT_OP, texts(k.lit("solved: a "), sizeText(r, c), k.lit(" matrix and a vector of "), k.call(INT_OPS.show, k.call(length, v)), k.lit("; it needs a square matrix and one item per row"))))));
  // Elimination kept (L44g): `factored` does solved's elimination once and
  // keeps what it did, LAPACK's getrf: the pivots in the order taken, each
  // pivot's row (U), and the multiple of it taken off each row below (L),
  // by that row's place in the matrix. `solved with` then does to a vector
  // what elimination did to the matrix's last column (getrs), and reads
  // the triangle back as solved does: one elimination for many vectors.
  const factorsOf = k.def("factors of rows");
  const placed = (pr: Id, f: (place: Id, row: Id) => Id) => entry(pr, f, ["place", "row"]);
  k.define(factorsOf, k.fn(["rows", "count"], (rs, n) => k.if(iLess(n, k.int(1)), k.call(LUV, k.x(NIL), k.x(NIL), k.x(NIL)),
    k.match(k.call(sortBy, rs, k.fn(["pair"], (pr) => placed(pr, (_i, row) => k.call(B.sub, k.lit(0), k.call(S.abs, headOr0(row)))))), [
      { variant: NIL, names: [], body: () => k.call(LUV, k.x(NIL), k.x(NIL), k.x(NIL)) },
      { variant: CONS, names: ["pivot", "others"], body: ([pp, others]) => placed(pp, (i, p) => k.let("pivot first", headOr0(p), (a) =>
        k.let("factors", k.call(map, others, k.fn(["pair"], (pr) => placed(pr, (j, row) => k.call(PAIR_V, j, k.call(B.div, headOr0(row), a))))), (fs) =>
          k.match(k.call(factorsOf, k.call(map, others, k.fn(["pair"], (pr) => placed(pr, (j, row) => k.let("factor", k.call(B.div, headOr0(row), a), (f) =>
            k.call(PAIR_V, j, k.call(map, k.call(zipped, tailOf(row), tailOf(p)), k.fn(["pair"], (xy) => entry(xy, (x, y) => k.call(B.sub, x, k.call(B.mul, f, y)), ["x", "y"])))))))), k.call(INT_OPS.sub, n, k.int(1))), [
            { variant: LUV, names: ["pivots", "uppers", "multipliers"], body: ([ps, us, ms]) => k.call(LUV, k.call(CONS, i, ps), k.call(CONS, p, us), k.call(CONS, fs, ms)) },
          ])))) },
    ]))));
  const factored = def("factored", ["matrix"], (m) => matOf(m, (r, c) => k.if(iSame(r, c), k.call(factorsOf, k.call(numbered, k.call(rowsOf, m)), r),
    k.call(ABORT_OP, texts(k.lit("factored: a "), sizeText(r, c), k.lit(" matrix; it needs a square one"))))));
  // The vector's item at a place, among (place, item) pairs.
  const atPlace = k.def("item at place");
  k.define(atPlace, k.fn(["pairs", "place"], (ps, i) => k.match(ps, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["pair", "rest"], body: ([pr, rest]) => entry(pr, (j, x) => k.if(iSame(j, i), x, k.call(atPlace, rest, i)), ["place", "item"]) },
  ])));
  // Forward: each pivot's item, the rows below it less its multiple.
  const forward = k.def("forward substituted");
  k.define(forward, k.fn(["pivots", "multipliers", "vector"], (ps, ms, bs) => k.match(ps, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["pivot", "later"], body: ([i, later]) => k.let("y", k.call(atPlace, bs, i), (y) => k.match(ms, [
      { variant: NIL, names: [], body: () => k.call(CONS, y, k.x(NIL)) },
      { variant: CONS, names: ["below", "more"], body: ([below, more]) => k.call(CONS, y, k.call(forward, later, more,
        k.call(map, below, k.fn(["pair"], (pr) => entry(pr, (j, f) => k.call(PAIR_V, j, k.call(B.sub, k.call(atPlace, bs, j), k.call(B.mul, f, y))), ["place", "factor"]))))) },
    ])) },
  ])));
  const solvedWith = def("solved with", ["factors", "vector"], (lu, v) => k.match(lu, [{ variant: LUV, names: ["pivots", "uppers", "multipliers"], body: ([ps, us, ms]) =>
    k.if(iSame(k.call(length, ps), k.call(length, v)),
      k.call(backSubstituted, k.call(map, k.call(zipped, us, k.call(forward, ps, ms, k.call(numbered, v))), k.fn(["pair"], (p) => entry(p, (row, y) => k.call(append, row, k.call(CONS, y, k.x(NIL))), ["row", "y"])))),
      k.call(ABORT_OP, texts(k.lit("solved with: factors of a "), sizeText(k.call(length, ps), k.call(length, ps)), k.lit(" matrix and a vector of "), k.call(INT_OPS.show, k.call(length, v))))) }]));
  // The determinant and the inverse (L44e), at Float64. The determinant is
  // the elimination's pivots multiplied, the sign turned for each row a
  // pivot was moved past (partial pivoting, as LAPACK's getrf); a 0 pivot
  // is a singular matrix, so 0. The inverse is solved once per column of
  // the identity, so a singular matrix has no answer.
  const determinantOf = k.def("determinant of rows");
  const reducedBy = (p: Id, a: Id) => k.fn(["row"], (row) => k.let("factor", k.call(dividedOr, headOr0(row), a, k.lit(0)), (f) =>
    k.call(map, k.call(zipped, tailOf(row), tailOf(p)), k.fn(["pair"], (pr) => entry(pr, (x, y) => k.call(B.sub, x, k.call(B.mul, f, y)), ["x", "y"])))));
  const odd = (i: Id) => k.let("place", k.call(INT_OPS.toNumber, i), (x) => k.call(S.not, k.call(S.equal, k.call(B.mul, k.call(S.floor, k.call(B.mul, x, k.lit(0.5))), k.lit(2)), x)));
  const pivotStep = (rs: Id, n: Id, i: Id, p: Id) => k.let("pivot first", headOr0(p), (a) => k.if(k.call(S.equal, a, k.lit(0)), k.lit(0),
    k.let("rest", k.call(determinantOf, k.call(map, k.call(append, k.call(take, rs, i), k.call(drop, rs, k.call(INT_OPS.add, i, k.int(1)))), reducedBy(p, a)), k.call(INT_OPS.sub, n, k.int(1))), (d) =>
      k.if(odd(i), k.call(B.sub, k.lit(0), k.call(B.mul, a, d)), k.call(B.mul, a, d)))));
  k.define(determinantOf, k.fn(["rows", "count"], (rs, n) => k.if(iLess(n, k.int(1)), k.lit(1),
    k.match(k.call(sortBy, k.call(numbered, rs), k.fn(["pair"], (pr) => entry(pr, (_i, row) => k.call(B.sub, k.lit(0), k.call(S.abs, headOr0(row))), ["position", "row"]))), [
      { variant: NIL, names: [], body: () => k.lit(1) },
      { variant: CONS, names: ["pivot", "others"], body: ([pp]) => entry(pp, (i, p) => pivotStep(rs, n, i, p), ["position", "row"]) },
    ]))));
  const determinant = def("determinant", ["matrix"], (m) => matOf(m, (r, c) => k.if(iSame(r, c), k.call(determinantOf, k.call(rowsOf, m), r),
    k.call(ABORT_OP, texts(k.lit("determinant: a "), sizeText(r, c), k.lit(" matrix; it needs a square one"))))));
  const inverted = def("inverted", ["matrix"], (m) => matOf(m, (r, c) => k.if(iSame(r, c),
    k.call(transposed, k.call(matrixOfRows, k.call(map, k.call(rowsOf, k.call(identityMatrix, r)), k.fn(["column"], (e) => k.call(solved, m, e))))),
    k.call(ABORT_OP, texts(k.lit("inverted: a "), sizeText(r, c), k.lit(" matrix; it needs a square one"))))));
  // The best fit when there are more equations than unknowns (L44f): the
  // x making m·x nearest b, by the normal equations mᵀm·x = mᵀb (Gauss,
  // 1809; Legendre, 1805). Squaring m loses accuracy LAPACK's QR (gels)
  // keeps, a later way of the same function.
  const leastSquares = def("least squares", ["matrix", "vector"], (m, v) => matOf(m, (r, c) =>
    k.if(iSame(r, k.call(length, v)),
      k.let("flipped", k.call(transposed, m), (t) => k.call(solved, k.call(matrixProduct, t, m), k.call(matrixTimesVector, t, v))),
      k.call(ABORT_OP, texts(k.lit("least squares: a "), sizeText(r, c), k.lit(" matrix and a vector of "), k.call(INT_OPS.show, k.call(length, v)), k.lit("; it needs one item per row"))))));

  // Fixed (FIXED-POINT.md, BACKLOG L89, L207e): a number counted in steps
  // of 2⁻³², an Int of steps, so it has the same bits on every target and
  // the same step size everywhere in a big world.
  const FX = k.type("Fixed", [], [["fixed", [["steps", () => k.tref(INT)]]]], "fixed-point numbers");
  const FXV = FX.v.fixed;
  // Fixed (FIXED-POINT.md, BACKLOG L89): an Int counting steps of 2⁻³². + −
  // and −x are the Int's own; a · b is the steps' product shifted down 32,
  // rounded towards −∞, the same on every machine; < is the Int's. Doom's
  // fixed_t (16.16, id Software, 1993) is the classic one.
  const fx = (v: Id, f: (s: Id) => Id, name = "steps") => k.match(v, [{ variant: FXV, names: [name], body: ([s]) => f(s) }]);
  const F = (s: Id) => k.call(FXV, s);
  const twoX = (name: string, f: (a: Id, b: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["x", "y"], (x, y) => fx(x, (a) => fx(y, (b) => f(a, b), "steps₂"))));
    return d;
  };
  const addX = twoX("add fixed", (a, b) => F(k.call(INT_OPS.add, a, b)));
  const subX = twoX("subtract fixed", (a, b) => F(k.call(INT_OPS.sub, a, b)));
  const mulX = twoX("multiply fixed", (a, b) => F(k.call(INT_OPS.shiftDown, k.call(INT_OPS.mul, a, b), k.int(32))));
  const lessX = twoX("fixed less than", (a, b) => k.call(INT_OPS.less, a, b));
  const negX = k.def("negate fixed");
  k.define(negX, k.fn(["x"], (x) => fx(x, (a) => F(k.call(INT_OPS.neg, a)))));
  const asFixed = k.def("as fixed");
  k.define(asFixed, k.fn(["whole"], (w) => F(k.call(INT_OPS.shiftDown, w, k.int(-32)))));
  const fixedF = k.def("as float64");
  k.define(fixedF, k.fn(["x"], (x) => fx(x, (a) => n.div(k.call(INT_OPS.toNumber, a), k.lit(2 ** 32)))));
  // a ÷ b: floor(a · 2³² / b), no answer when b is 0, as at Rational.
  const divX = twoX("divide fixed", (a, b) => k.if(k.call(S.equal, b, k.int(0)), k.call(S.fail),
    F(k.call(INT_OPS.quotient, k.call(INT_OPS.shiftDown, a, k.int(-32)), b))));
  // The shortest decimal that reads back to the same steps: Steele and
  // White's free-format digits (1990), in integers. r is what is left of
  // the fraction and m half a step, both in units of 2⁻³³; each digit
  // multiplies both by 10, and the digits stop once what is left is
  // within half a step of either end. Ten digits always suffice for
  // steps of 2⁻³², so it is a fold over ten, and m = 0 marks done.
  const z = { add: (a: Id, b: Id) => k.call(INT_OPS.add, a, b), sub: (a: Id, b: Id) => k.call(INT_OPS.sub, a, b), mul: (a: Id, b: Id) => k.call(INT_OPS.mul, a, b), less: (a: Id, b: Id) => k.call(INT_OPS.less, a, b), up: (a: Id, n: number) => k.call(INT_OPS.shiftDown, a, k.int(-n)), down: (a: Id, n: number) => k.call(INT_OPS.shiftDown, a, k.int(n)) };
  const unit = () => z.up(k.int(1), 33);
  const state = (text: Id, r: Id, m: Id) => k.call(PAIR_V, text, k.call(PAIR_V, r, m));
  const fractionDigits = k.def("fraction digits");
  k.define(fractionDigits, k.fn(["fraction"], (fr) => k.match(k.fold(k.call(INT_OPS.range, k.int(10)), [
    { variant: NIL, names: [], body: () => state(k.lit(""), z.mul(k.int(2), fr), k.int(1)) },
    { variant: CONS, names: ["place", "places"], results: [null, "digits so far"], body: (_, [, sofar]) => k.match(sofar!, [
      { variant: PAIR_V, names: ["text", "left"], body: ([text, left]) => k.match(left, [
        { variant: PAIR_V, names: ["r", "m"], body: ([r, m]) => k.if(k.call(S.equal, m, k.int(0)), sofar!,
          k.let("r₁₀", z.mul(r, k.int(10)), (r10) => k.let("m₁₀", z.mul(m, k.int(10)), (m10) => k.let("digit", z.down(r10, 33), (d) =>
            k.let("rest", z.sub(r10, z.up(d, 33)), (rest) => k.let("low", z.less(rest, m10), (low) => k.let("high", z.less(z.sub(unit(), m10), rest), (high) =>
              k.if(k.call(S.or, low, high),
                state(k.call(S.concat, text, k.call(INT_OPS.show, k.if(k.call(S.and, low, k.call(S.or, k.call(S.not, high), z.less(z.mul(k.int(2), rest), unit()))), d, z.add(d, k.int(1))))), k.int(0), k.int(0)),
                state(k.call(S.concat, text, k.call(INT_OPS.show, d)), rest, m10))))))))) },
      ]) },
    ]) },
  ]), [{ variant: PAIR_V, names: ["digits", "done"], body: ([ds]) => ds }])));
  const showSteps = k.def("show fixed steps");
  k.define(showSteps, k.fn(["steps"], (s) => k.let("whole", z.down(s, 32), (w) => k.let("fraction", z.sub(s, z.up(w, 32)), (fr) =>
    k.if(k.call(S.equal, fr, k.int(0)), k.call(INT_OPS.show, w),
      k.call(S.concat, k.call(INT_OPS.show, w), k.call(S.concat, k.lit("."), k.call(fractionDigits, fr))))))));
  const showX = k.def("show fixed");
  k.define(showX, k.fn(["x"], (x) => fx(x, (s) => k.if(z.less(s, k.int(0)),
    k.call(S.concat, k.lit("-"), k.call(showSteps, k.call(INT_OPS.neg, s))), k.call(showSteps, s)))));

  // Trig at Fixed, all in Ints, so the same bits on every machine.
  // sin and cos are CORDIC (Volder, 1959): the angle, brought into
  // [−π/2, π/2], is turned to 0 by ±atan(2⁻ⁱ) for i = 0 … 31, and (K, 0)
  // turned the same way ends at (cos, sin), each turn only shifts and
  // adds. exp is e^r · 2ᵏ for x = k·ln 2 + r, e^r by its series; log is
  // e·ln 2 + 2·atanh((m − 1)/(m + 1)) for x = m · 2ᵉ with m in [1, 2).
  // The divisions are by numbers that are never 0, so `first` gives the
  // one answer; the defaults only say so to the checker.
  const ONE = 2 ** 32, PI = 13493037705, HALF_PI = 6746518852, TWO_PI = 26986075409, K_GAIN = 2608131496;
  const LN2 = 2977044472n, LN2_64 = 12786308645202655660n;
  const ATANS = [3373259426, 1991351318, 1052175346, 534100635, 268086748, 134174063, 67103403, 33553749, 16777131, 8388597, 4194303, 2097152, 1048576, 524288, 262144, 131072, 65536, 32768, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2];
  const only = (body: () => Id, otherwise: () => Id) => k.call(S.first, k.thunk(body), k.thunk(otherwise));
  const quot = (a: Id, b: Id) => k.call(INT_OPS.quotient, a, b);
  const shift = (a: Id, by: Id) => k.call(INT_OPS.shiftDown, a, by);
  const triple = (a: Id, b: Id, c: Id) => k.call(PAIR_V, a, k.call(PAIR_V, b, c));
  const third = (t: Id, f: (a: Id, b: Id, c: Id) => Id, names = ["a", "b", "c"]) => k.match(t, [{ variant: PAIR_V, names: [names[0], "rest"], body: ([a, r]) => k.match(r, [{ variant: PAIR_V, names: [names[1], names[2]], body: ([b, c]) => f(a, b, c) }]) }]);
  const cordic = k.def("cordic");
  // The table from i = 31 down to 0: a fold reaches the last item first.
  k.define(cordic, k.fn(["angle"], (angle) => k.fold(k.list(...ATANS.map((t, j) => k.call(PAIR_V, k.int(j), k.int(t))).reverse()), [
    { variant: NIL, names: [], body: () => triple(k.int(K_GAIN), k.int(0), angle) },
    { variant: CONS, names: ["turn", "turns"], results: [null, "turned"], body: ([turn], [, done]) => k.match(turn, [
      { variant: PAIR_V, names: ["i", "atan"], body: ([j, at]) => third(done!, (x, y, z0) => k.if(z.less(z0, k.int(0)),
        triple(z.add(x, shift(y, j)), z.sub(y, shift(x, j)), z.add(z0, at)),
        triple(z.sub(x, shift(y, j)), z.add(y, shift(x, j)), z.sub(z0, at))), ["x", "y", "left"]) },
    ]) },
  ])));
  // (cos, sin) of an angle in steps.
  const sinCos = k.def("fixed cosine and sine");
  k.define(sinCos, k.fn(["angle"], (angle) => k.let("turns", only(() => quot(angle, k.int(TWO_PI)), () => k.int(0)), (t) =>
    k.let("r", z.sub(angle, z.mul(t, k.int(TWO_PI))), (r0) => k.let("r₂", k.if(z.less(k.int(PI), r0), z.sub(r0, k.int(TWO_PI)), r0), (r) => {
      const at = (a: Id, flip: boolean) => third(k.call(cordic, a), (c, sn) => k.call(PAIR_V, flip ? k.call(INT_OPS.neg, c) : c, sn), ["cos", "sin", "left"]);
      return k.if(z.less(k.int(HALF_PI), r), at(z.sub(k.int(PI), r), true),
        k.if(z.less(r, k.int(-HALF_PI)), at(z.sub(k.int(-PI), r), true), at(r, false)));
    })))));
  const cs = (x: Id, f: (c: Id, sn: Id) => Id) => fx(x, (st) => k.match(k.call(sinCos, st), [{ variant: PAIR_V, names: ["cos", "sin"], body: ([c, sn]) => f(c, sn) }]));
  const sinX = k.def("fixed sin");
  k.define(sinX, k.fn(["x"], (x) => cs(x, (_, sn) => F(sn))));
  const cosX = k.def("fixed cos");
  k.define(cosX, k.fn(["x"], (x) => cs(x, (c) => F(c))));
  const tanX = k.def("fixed tan");
  k.define(tanX, k.fn(["x"], (x) => cs(x, (c, sn) => F(only(() => quot(z.up(sn, 32), c), () => z.up(sn, 32))))));
  const expX = k.def("fixed exp");
  k.define(expX, k.fn(["x"], (x) => fx(x, (st) => F(only(() => k.let("k", quot(st, k.int(LN2)), (kk) => k.let("r", z.sub(st, z.mul(kk, k.int(LN2))), (r) =>
    shift(k.fold(k.call(INT_OPS.range, k.int(14)), [
      { variant: NIL, names: [], body: () => k.int(ONE) },
      { variant: CONS, names: ["n", "ns"], results: [null, "the rest of the series"], body: ([nn], [, acc]) =>
        z.add(k.int(ONE), quot(z.down(z.mul(r, acc!), 32), z.add(nn, k.int(1)))) },
    ]), k.call(INT_OPS.neg, kk)))), () => k.int(0))))));
  // The number of bits of a positive Int, by halving the range 17 times
  // (up to 2¹⁶ bits).
  const bits = k.def("bit length");
  k.define(bits, k.fn(["n"], (nn) => k.match(k.fold(k.call(INT_OPS.range, k.int(17)), [
    { variant: NIL, names: [], body: () => k.call(PAIR_V, k.int(0), k.int(65536)) },
    { variant: CONS, names: ["step", "steps"], results: [null, "narrowed"], body: (_, [, lh]) => k.match(lh!, [
      { variant: PAIR_V, names: ["low", "high"], body: ([lo, hi]) => k.let("middle", z.down(z.add(lo, hi), 1), (mid) =>
        k.if(k.call(S.equal, shift(nn, mid), k.int(0)), k.call(PAIR_V, lo, mid), k.call(PAIR_V, mid, hi))) },
    ]) },
  ]), [{ variant: PAIR_V, names: ["low", "high"], body: ([, hi]) => hi }])));
  const logX = k.def("fixed log");
  k.define(logX, k.fn(["x"], (x) => fx(x, (st) => F(k.if(z.less(st, k.int(1)), k.int(0), only(() =>
    k.let("e", z.sub(k.call(bits, st), k.int(33)), (e) => k.let("m", shift(st, e), (m) =>
      k.let("t", quot(z.up(z.sub(m, k.int(ONE)), 32), z.add(m, k.int(ONE))), (t) => k.let("t²", z.down(z.mul(t, t), 32), (t2) =>
        z.add(z.down(z.mul(e, k.int(LN2_64)), 32), z.mul(k.int(2), z.down(z.mul(t, k.fold(k.call(INT_OPS.range, k.int(12)), [
          { variant: NIL, names: [], body: () => k.int(0) },
          { variant: CONS, names: ["j", "js"], results: [null, "the rest of the series"], body: ([j], [, acc]) =>
            z.add(quot(k.int(ONE), z.add(z.mul(k.int(2), j), k.int(1))), z.down(z.mul(t2, acc!), 32)) },
        ])), 32))))))), () => k.int(0)))))));
  // Unpolar is CORDIC's other mode, vectoring (L97c2): (x, y), brought
  // into the right half-plane, is turned onto the x axis by ±atan(2⁻ⁱ),
  // which adds up to the angle, and x ends as the length over K. Each of
  // length and angle runs it once.
  const vector = k.def("cordic vector");
  k.define(vector, k.fn(["x", "y"], (x0, y0) => k.fold(k.list(...ATANS.map((t, j) => k.call(PAIR_V, k.int(j), k.int(t))).reverse()), [
    { variant: NIL, names: [], body: () => triple(x0, y0, k.int(0)) },
    { variant: CONS, names: ["turn", "turns"], results: [null, "turned"], body: ([turn], [, done]) => k.match(turn, [
      { variant: PAIR_V, names: ["i", "atan"], body: ([j, at]) => third(done!, (x, y, z0) => k.if(z.less(y, k.int(0)),
        triple(z.sub(x, shift(y, j)), z.add(y, shift(x, j)), z.sub(z0, at)),
        triple(z.add(x, shift(y, j)), z.sub(y, shift(x, j)), z.add(z0, at))), ["x", "y", "angle"]) },
    ]) },
  ])));
  // (x, y) in steps, mirrored through 0 when x < 0 (then the angle is π
  // more, or less when y < 0): what `cordic vector` reads.
  const halfPlane = (sx: Id, sy: Id, f: (len: Id, ang: Id) => Id) => {
    const at = (a: Id, b: Id, off: number) => third(k.call(vector, a, b), (len, _, ang) => f(z.down(z.mul(len, k.int(K_GAIN)), 32), off ? z.add(ang, k.int(off)) : ang), ["x", "y", "angle"]);
    return k.if(z.less(sx, k.int(0)), k.if(z.less(sy, k.int(0)), at(k.call(INT_OPS.neg, sx), k.call(INT_OPS.neg, sy), -PI), at(k.call(INT_OPS.neg, sx), k.call(INT_OPS.neg, sy), PI)), at(sx, sy, 0));
  };
  const unpolarX = k.def("fixed unpolar");
  k.define(unpolarX, k.fn(["length", "angle", "x", "y"], (r, t, x, y) => k.and(
    k.equal(r, fx(x, (sx) => fx(y, (sy) => halfPlane(sx, sy, (len) => F(len)), "y steps"), "x steps")),
    k.equal(t, fx(x, (sx) => fx(y, (sy) => halfPlane(sx, sy, (_, ang) => F(ang)), "y steps"), "x steps")))));
  k.results(unpolarX, "length", "angle");
  // √x: the whole square root of x's steps · 2³² by Newton's method from
  // above (Heron's), which only goes down and stops at the floor; no
  // answer below 0.
  const sqrtX = k.def("square root fixed");
  k.define(sqrtX, k.fn(["x"], (x) => fx(x, (st) => k.if(z.less(st, k.int(0)), k.call(S.fail), k.if(k.call(S.equal, st, k.int(0)), F(k.int(0)),
    k.let("n", z.up(st, 32), (nn) => F(k.fold(k.call(INT_OPS.range, k.int(12)), [
      { variant: NIL, names: [], body: () => shift(k.int(1), k.call(INT_OPS.neg, z.down(z.add(k.call(bits, nn), k.int(1)), 1))) },
      { variant: CONS, names: ["step", "steps"], results: [null, "closer"], body: (_, [, g]) => k.let("next", z.down(z.add(g!, quot(nn, g!)), 1), (nx) =>
        k.if(z.less(nx, g!), nx, g!)) },
    ]))))))));
  // asin and acos at Fixed (L97c3): the angle of (√(1 − s²), s) and of
  // (c, √(1 − c²)) by CORDIC's vectoring, with Fixed's own exact square
  // root, so asin(1) is π/2 to the step. Outside [−1, 1] the square root
  // has no answer and the angle is 0's.
  const cut = (v: Id) => only(() => k.call(sqrtX, k.call(ARITH.sub, F(k.int(ONE)), k.call(ARITH.mul, v, v))), () => F(k.int(0)));
  const angleOf = (x: Id, y: Id) => fx(x, (sx) => fx(y, (sy) => halfPlane(sx, sy, (_, ang) => F(ang)), "y steps"), "x steps");
  const asinX = k.def("fixed asin");
  k.define(asinX, k.fn(["s"], (sv) => angleOf(cut(sv), sv)));
  const acosX = k.def("fixed acos");
  k.define(acosX, k.fn(["c"], (cv) => angleOf(cv, cut(cv))));
  // Polar at Fixed is CORDIC's rotating mode (L97d): (cos, sin) of the
  // angle, each times the length with Fixed's own ·. sin and cos are
  // Trig's ways from it, length 1, which gives the same bits as `fixed
  // sin` and `fixed cos` (1 · s is s to the step). Each result runs the
  // rotation on its own until a direction that reads one drops the other
  // (C55).
  const polarX = k.def("fixed polar");
  k.define(polarX, k.fn(["length", "angle", "x", "y"], (r, t, x, y) => k.and(
    k.equal(x, cs(t, (c) => k.call(mulX, r, F(c)))),
    k.equal(y, cs(t, (_, sn) => k.call(mulX, r, F(sn)))))));
  k.results(polarX, "x", "y");
  const trigX = k.def("trig at fixed");
  k.define(trigX, k.call(TRIG_V, ...[S.byItsWays, S.byItsWays, tanX, expX, logX, polarX, unpolarX, asinX, acosX].map((d) => k.x(d))));

  const fixedLiteral = k.def("fixed literal");
  k.define(fixedLiteral, k.fn(["top", "bottom"], (t, b) => F(k.call(S.first,
    k.thunk(() => k.call(INT_OPS.quotient, k.call(INT_OPS.add, k.call(INT_OPS.mul, t, k.int(2 ** 33)), b), k.call(INT_OPS.mul, b, k.int(2)))),
    k.thunk(() => k.int(0))))));

  const impl = (name: string, v: Id, ops: Id[]) => { const d = k.def(name); k.define(d, k.call(v, ...ops.map((o) => k.x(o)))); return d; };
  const trigD = k.def("trig at dual");
  k.define(trigD, k.call(TRIG_V, ...[sinD, cosD, tanD, expD, logD].map((d) => k.x(d)), k.x(S.byItsWays), k.x(unpolarD), k.x(S.byItsWays), k.x(S.byItsWays)));
  const embedD = k.def("float64 in dual");
  k.define(embedD, k.call(EMBEDDING_V, k.x(asD)));
  const embedC = k.def("float64 in complex");
  k.define(embedC, k.call(EMBEDDING_V, k.x(asC)));
  const impls = [
    impl("arithmetic at complex", ARITHMETIC_V, [addC, subC, mulC, negC]),
    impl("division at complex", DIVISION_V, [divC]),
    impl("shown at complex", SHOWN_V, [showC]),
    impl("arithmetic at dual", ARITHMETIC_V, [addD, subD, mulD, negD]),
    impl("division at dual", DIVISION_V, [divD]),
    trigD,
    ...matProducts.map((m, i) => impl(`arithmetic at mat${sizes[i]}`, ARITHMETIC_V, [addParts, subParts, m, negParts])),
    ...matLiterals,
    impl("arithmetic at fixed", ARITHMETIC_V, [addX, subX, mulX, negX]),
    impl("literal at fixed", LITERAL_V, [fixedLiteral]),
    impl("ordered at fixed", ORDERED_V, [lessX]),
    impl("division at fixed", DIVISION_V, [divX]),
    impl("shown at fixed", SHOWN_V, [showX]),
    trigX,
  ];

  const offered = [TC.def, embedC, asC, unitI, conjC, modulus, angle, polar, expC, csqrt, clog, cpow, casin, cacos, complexTable, T.def, embedD, asD, slopeAt, dualTable, ...mats.map((m) => m.def), MX.def, LU.def, matrixOfRows, rowsOf, rowCount, columnCount, matrixEntry, transposed, identityMatrix, matrixScaled, matrixSum, matrixProduct, matrixTimesVector, solved, factored, solvedWith, determinant, inverted, leastSquares, FX.def, asFixed, fixedF, sqrtX];
  const laws = [lawFromPolar, lawPolar];
  const helpers = [addC, subC, mulC, negC, divC, showC, addD, subD, mulD, negD, divD, sinD, cosD, tanD, expD, logD, unpolarD, showD, ...matTables, addParts, subParts, negParts, ...matProducts, listDot, eliminated, backSubstituted, determinantOf, addX, subX, mulX, lessX, negX, divX, showX, fractionDigits, showSteps, cordic, sinCos, sinX, cosX, tanX, expX, bits, logX, vector, unpolarX, asinX, acosX, polarX, fixedLiteral];
  const comments: Record<Id, string> = {
    [TC.def]: "A complex number re + im·i, a record of two Float64s. The same + − · work on it (· is the complex product); it has no <.",
    [embedC]: "Float64 in Complex: x as x + 0i.",
    [asC]: "The Float64 x as a complex number, x + 0i.",
    [unitI]: "i, the square root of −1: i · i is −1.",
    [conjC]: "a − bi for a + bi: the same point mirrored across the real line. z · conjugate(z) is |z|².",
    [modulus]: "|z|, how far z is from 0 (the vectors module's magnitude says the same).",
    [angle]: "The angle from the positive real line to z, in radians, between −π and π (atan2).",
    [polar]: "The complex number size away from 0 at this angle: size·(cos angle + i sin angle).",
    [divC]: "z ÷ w for complex numbers; no answer when w is 0. Not offered: the one divide works on every number but Int; kept so programs saved before still open.",
    [expC]: "e to the z: eᵃ(cos b + i sin b) for a + bi, Euler's formula (textbook). complex exp(i · π) is −1.",
    [csqrt]: "√z for a complex number, the root with a real part of 0 or more: complex sqrt(−4) is 2i. Float64's sqrt has no answer below 0; this one always has.",
    [clog]: "log z for a complex number: log|z| + i·(its angle, between −π and π). complex log(−1) is iπ. No answer at 0.",
    [cpow]: "z to the power w, e^(w · log z), the principal value: complex power(−8, 1/3) is 1 + 1.732i. 0 to a power with a real part above 0 is 0; to any other, no answer.",
    [casin]: "asin z for a complex number, the principal value: complex asin(2) is π/2 + 1.317i. Float64's asin has no answer outside −1 to 1; this one always has.",
    [cacos]: "acos z for a complex number, the principal value: complex acos(2) is −1.317i. Float64's acos has no answer outside −1 to 1; this one always has.",
    [showC]: "A complex number as 3 + 4i or 3 − 4i. Not offered: the one show shows every number; kept so programs saved before still open.",
    [addC]: "What + is at Complex. Not offered on its own: + is.",
    [subC]: "What − is at Complex. Not offered on its own: − is.",
    [complexTable]: "Complex's multiplication table: 1 · 1 = 1, 1 · i = i, i · 1 = i, i · i = −1. table product(complex table, z, w) is z · w.",
    [mulC]: "What · is at Complex: (a + bi)(c + di) = (ac − bd) + (ad + bc)i. Not offered on its own: · is.",
    [negC]: "What −x is at Complex. Not offered on its own: − is.",
    [T.def]: "A dual number, value + slope·ε where ε · ε is 0: a record of two Float64s. The same + − · work on it, · by the product rule, and sin, cos, tan, exp and log by the chain rule, so f(dual(x, 1)) carries f′(x) along with f(x) (forward-mode automatic differentiation).",
    [embedD]: "Float64 in Dual: x as the dual number x + 0ε, a constant, whose slope is 0.",
    [asD]: "The Float64 x as a dual number whose derivative part is 0: a constant.",
    [addD]: "What + is at Dual. Not offered on its own: + is.",
    [subD]: "What − is at Dual. Not offered on its own: − is.",
    [mulD]: "What · is at Dual, the product rule: (a + a′ε)(b + b′ε) = ab + (ab′ + a′b)ε, since ε · ε is 0. Not offered on its own: · is.",
    [negD]: "What −x is at Dual. Not offered on its own: − is.",
    [divD]: "x ÷ y for dual numbers, the quotient rule; no answer when y's value is 0. Not offered: the one divide works on every number but Int; kept so programs saved before still open.",
    [sinD]: "sin at Dual, by the chain rule: sin(a + a′ε) = sin a + cos a · a′ε. Not offered on its own: sin is.",
    [cosD]: "cos at Dual: cos a − sin a · a′ε. Not offered on its own: cos is.",
    [tanD]: "tan at Dual: tan a + a′/cos² a · ε. Not offered on its own: tan is.",
    [expD]: "exp at Dual: eᵃ + eᵃ · a′ε. Not offered on its own: exp is.",
    [logD]: "log at Dual: log a + a′/a · ε. Not offered on its own: log is.",
    [trigD]: "How Dual does Trig: the chain rule for each. Found by its type, so not offered: sin is.",
    [slopeAt]: "f′(x), worked out by giving f the dual number x + 1ε and reading the slope of what comes back (forward-mode automatic differentiation). f must work on duals: write it with the generic + − · and Trig. derivative(f) gives the same number by differentiating f's code.",
    [dualTable]: "Dual numbers' multiplication table: 1 · 1 = 1, 1 · ε = ε, ε · 1 = ε, and ε · ε = 0, which needs no line. table product(dual table, x, y) is x · y.",
    [showD]: "A dual number as 3 + 2ε. Not offered: the one show shows every number; kept so programs saved before still open.",
    [mats[0].def]: "A 2 × 2 matrix of Float64s, in rows: mat2(m11, m12, m21, m22). + and − go part by part, · is the matrix product, and a plain number is that many times the identity, so m + 1 adds 1 down the diagonal.",
    [mats[1].def]: "A 3 × 3 matrix of Float64s, in rows. + and − go part by part, · is the matrix product, and a plain number is that many times the identity.",
    [mats[2].def]: "A 4 × 4 matrix of Float64s, in rows, the size of a 3D transform. + and − go part by part, · is the matrix product, and a plain number is that many times the identity.",
    [MX.def]: "A matrix of any size: its row and column counts and its items row by row. Built with matrix of rows; a size mismatch stops the program and names both sizes, as the size isn't in the type.",
    [LU.def]: "A square matrix's Gaussian elimination, done once by factored and kept: the pivots in the order taken, each pivot's row of U and the multiples taken off the rows below. solved with uses it to solve the matrix for any vector.",
    [matrixOfRows]: "The matrix with these rows: matrix of rows([[1, 2, 3], [4, 5, 6]]) is 2 × 3. Rows of different lengths stop the program.",
    [rowsOf]: "The matrix's rows, each a list, top to bottom.",
    [rowCount]: "How many rows the matrix has.",
    [columnCount]: "How many columns the matrix has.",
    [matrixEntry]: "The item at a row and a column, counting from 0; no answer outside the matrix.",
    [transposed]: "The matrix flipped across its diagonal: row i is column i.",
    [identityMatrix]: "The size × size matrix with 1 on its diagonal and 0 elsewhere, for any number type.",
    [matrixScaled]: "Every item times the number.",
    [matrixSum]: "The two matrices added item by item. Different sizes stop the program, with both sizes.",
    [matrixProduct]: "The first matrix times the second: row by column, for any number type. The first's columns must be the second's rows, or the program stops with both sizes.",
    [matrixTimesVector]: "The matrix times the list as a column: one item per row. The list must have one item per column, or the program stops with both sizes.",
    [factored]: "A square Float64 matrix's LU factors, its Gaussian elimination with partial pivoting done once and kept, for solved with: factor once, then solve for many vectors. A singular matrix's factors have a 0 pivot, and solved with has no answer with them.",
    [solvedWith]: "The list x with matrix times vector(m, x) = b, from m's factors (factored): the elimination solved does, done once for all the vectors solved this way. No answer when the matrix is singular (a pivot is 0).",
    [solved]: "The list x with matrix times vector(m, x) = b, for a square Float64 matrix, by Gaussian elimination with partial pivoting. No answer when the matrix is singular (a pivot is 0).",
    [determinant]: "The determinant of a square Float64 matrix: 0 when it is singular. Other sizes stop the program.",
    [leastSquares]: "The x making matrix times vector(m, x) nearest the vector, by least squares, for a Float64 matrix with at least as many rows as columns: a line through points. No answer when the columns aren't independent.",
    [inverted]: "The inverse of a square Float64 matrix: matrix product(m, inverted(m)) is the identity. No answer when the matrix is singular.",
    [listDot]: "A helper of the matrix operations. Not offered.",
    [eliminated]: "A helper of the matrix operations. Not offered.",
    [backSubstituted]: "A helper of the matrix operations. Not offered.",
    [determinantOf]: "A helper of the matrix operations. Not offered.",
    [FX.def]: "A fixed-point number: an Int counting steps of 2⁻³², so 1.5 is fixed(6442450944). The same + − · < work on it, with · rounded down to a step, and the answer has the same bits on every machine. A step is 2⁻³² anywhere, so a position far from the origin keeps its precision (FIXED-POINT.md).",
    [asFixed]: "A whole number as a Fixed, exactly.",
    [fixedF]: "A Fixed as the nearest Float64, for drawing or printing. Past 2⁵³ steps (about 2 million) it drops the last bits; the Fixed keeps them.",
    [showX]: "A Fixed as text: the shortest decimal that reads back to the same steps, so 0.1 shows as 0.1 and every step shows differently. Not offered: the one show shows every number; kept so programs saved before still open.",
    [divX]: "a ÷ b for Fixed, rounded down to a step; no answer when b is 0. Not offered: the one divide works on every number but Int; kept so programs saved before still open.",
    [sqrtX]: "√x for Fixed, rounded down to a step, the same bits on every machine; no answer below 0.",
    [trigX]: "How Fixed does Trig: CORDIC and series, all in Ints, so the same bits on every machine. Found by its type, so not offered: sin is.",
  };
  const p = publish(merge(prelude, std, pre.code, k.code), k.names, [...offered, ...impls, ...helpers, ...laws], merge(prelude, std, pre.code));
  if (!p.ok) throw new Error(`the numbers module can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("numbers", p.code, p.names, offered.map(at), { ...pre.pins, ...p.pins }, notes, [...impls, ...helpers, ...laws].map(at));
}
