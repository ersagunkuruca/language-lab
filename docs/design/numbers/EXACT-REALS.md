# Exact reals: √2 as the number where x² = 2 (design note, 2026-10-27)

BACKLOG L88. **Steps 1 to 3 are built** (`src/lang/poly.ts`,
`src/lang/factor.ts`, `src/lang/algebraic.ts`, `test/algebraic.test.ts`):
`square root(2) · square root(2)` is 2, evaluated and compiled to
JavaScript, and `x · x = 2` run backwards gives −√2 and √2 exactly.
Step 4, `Real`, waits for a program that needs π exactly. Ersagun, 2026-10-26: "sqrt(2) is the number where x^2=2...
run that backwards, and extract as much precision out of that as needed...
when asked to take even powers of it we just simplify the definition and
go right to an integer."

## Short answer

Two number types, built in this order:

1. **`Algebraic`: a number held by the equation it solves.** √2 is kept
   as "the root of x² − 2 between 1 and 2". That is a polynomial with Int
   coefficients and an interval with fraction ends that holds only that
   one root.
   - `+ − · ÷` give another such pair. √2 · √2 comes out as the root of a
     polynomial whose root in the interval is exactly 2, so the result
     *is* the Int 2. That is Ersagun's "go right to an integer".
   - `=` and `<` always finish. Equality of algebraic numbers is decidable,
     so these comparisons carry no `Diverge`.
   - Digits come from narrowing the interval with exact fraction
     arithmetic, as many as asked for: "extract as much precision as
     needed".
2. **`Real`, later: a number held by a way to narrow it.** π, e and
   sin(1) solve no polynomial with Int coefficients. A real is a lazy
   sequence of nested fraction intervals, made with a cell the way the
   continued fractions already are (NUMBERS.md, "Infinite continued
   fractions"). `=` and `<` on it can run forever, so they carry
   `Diverge` and `with fuel` makes that "undecided", as they already do
   for continued fractions.

`Algebraic` comes first because it covers what Ersagun asked for (roots,
powers, exact simplification) with comparisons that always answer, and
because it needs nothing the language doesn't have. It is one more member
of the Numbers family next to Int, Rational and Complex. `Real` is the
general case, paid for with `Diverge`.

## Why this is "running x² = 2 backwards"

The language already reads `x · x = 2` as a relation. Run backwards over
Float64 it gives ±1.4142135623730951 (relate.ts), and over Int it gives
nothing. Over `Algebraic` the answer is the relation itself, pinned to
one root. `square root(2)` at `Algebraic` is `root of(x² − 2, between 1
and 2)`, and every operation after it is solving one more equation.

The same thing, in the user's terms:

- **A definition, not a decimal.** `√2` prints as `√2`, or as `the root
  of x² − 2 near 1.414` when it has no short name. The digits are worked
  out when they are shown.
- **Precision on demand.** `digits(√2, 50)` halves the interval until it
  is narrower than 10⁻⁵⁰, keeping the half where x² − 2 changes sign.
  Everything is exact fraction arithmetic (Rational and Int, which never
  overflow), so the digits are right, not close.
- **Even powers simplify.** `(√2)⁴` is a root of a polynomial with 4 as a
  root in its interval, so it is the Int 4. Any result that turns out
  rational becomes a Rational or an Int, so it prints and compares as one.

## How it works

The standard construction (Loos 1982; the same as Mathematica's `Root`
objects and Sage's `QQbar`/`AA`):

- **The value.** A pair `(p, I)`. `p` is a square-free polynomial with Int
  coefficients. `I` is an interval with fraction ends that holds exactly
  one root of `p`. Sturm's theorem counts the roots in an interval exactly,
  so "exactly one" can be checked.
- **Sum and product by resultants.** If α is a root of p and β of q, then
  α + β is a root of `Res_y(p(y), q(x − y))` and α · β of
  `Res_y(p(y), yⁿ q(x/y))`. Interval arithmetic on I and J gives an
  interval round the answer, which is narrowed until it holds one root of
  the new polynomial. Negation, inverse and k-th roots are substitutions
  in p.
- **Simplifying.** After each operation, look for the simplest fraction in
  the interval (Stern–Brocot) and check whether it is an exact root. If it
  is, the result is that fraction: √2 · √2 is 2, and √8 / √2 is 2.
  Otherwise the polynomial is made square-free with a gcd. Reducing to the
  minimal polynomial (factoring over the integers) only matters when
  degrees grow; it can come later.
- **Equality and order.** α = β exactly when α − β has 0 as its root:
  0 is a root of its polynomial and lies in its isolating interval.
  Otherwise the intervals are narrowed until they come apart, which always
  happens for two different algebraic numbers. So `<` always finishes too.

Polynomials are ordinary data: a list of Int coefficients.
- Resultants, Sturm sequences and the gcd can be written in the language,
  as Gosper's continued-fraction arithmetic is (cells-programs.ts).
- They can also sit in TypeScript beside int.ts, the way Int's BigInt
  arithmetic does.
- Recommended: TypeScript, behind the same kind of builtin Int's
  operations use. These loops are hot, and every target needs them.

## What changes where

- **The type.** `Algebraic` joins the Numbers, so the one `+ − · −x <`
  resolves to its operations (arith.ts, as Rational and Complex do now).
  A literal can be an Algebraic where one is needed. Moving to and from
  other number types is explicit, as for the other Numbers: `as float64(α)`
  narrows the interval to the nearest Float64, and Int and Rational go in
  for free.
- **The new operations.** `square root`, `k-th root` and `root of(p, I)`
  at Algebraic. Also `digits(α, n)`, and `show`.
- **Running backwards.** `x · x = 2` asked at Algebraic gives both roots,
  `−√2` and `√2`, as one Choice. This is the relation's own answer, so
  relate.ts doesn't need a new trick. A polynomial equation of any degree
  gives its real roots, isolated by Sturm's theorem.
- **Targets.** The evaluator and compiled JS first, sharing one TypeScript
  module as Int does. On the GPU an Algebraic known before compiling
  becomes its Float64 (√2 in a shader is a constant). One computed in the
  shader is refused with a reason. WASM and C get it through the same
  BigInt-backed path as Int, when a program needs it. That is a hosting
  choice and doesn't change the language.

## The rest: `Real` (step 4)

A computable real is a function from a precision n to a fraction interval
of width at most 2⁻ⁿ. In the language that is a lazy, remembered sequence
of nested intervals: a data type with a `Cell` in a field, as `CF` is.
Arithmetic narrows its inputs as far as the output needs. Every Algebraic
is a Real. π, e and the results of `exp`, `sin` and `log` are Reals.
Comparison carries `Diverge`: the effect system says what floating point
hides, as NUMBERS.md puts it. Prior art: Boehm's constructive reals, used
in Android's calculator (Boehm, "Towards an API for the real numbers",
PLDI 2020). Earlier ones are iRRAM (Müller) and Edalat and Potts' exact
real arithmetic.

## Steps

1. **Polynomials over Int. Built** (poly.ts, beside int.ts): resultant, Sturm
   count, square-free part, exact evaluation at a fraction.
2. **`Algebraic` as a Number. Built.** Values are the minimal polynomial
   (factored by Zassenhaus's method, factor.ts) and which real root,
   so each number has one spelling.
   - Its arithmetic, the simplification to Rational or Int, `=` and `<`.
   - `square root` and `k-th root`, `digits`, and `show`.
   - Tests: √2 · √2 is 2, (√2)⁴ is 4, √2 + √3 has `x⁴ − 10x² + 1` and
     prints 3.146…, and √2 < 1.415 is true.
   - Evaluated and compiled.
3. **Backwards at Algebraic. Built** (relate.ts, `exactRoots`). An
   Algebraic `+ − · −x` with an unknown input is also an equation, kept
   apart from the numeric solver's. With one unknown left, the equations
   become one polynomial with fraction coefficients: every other unknown
   is the output of an operation, so it is replaced by what it is made
   of. Its real roots are the answers, exactly and smallest first
   (algebraic.ts `realRoots`: Sturm isolation, then the minimal
   polynomial). So `x · x = 2` gives −√2 and √2, `x · x + x = 12` gives
   −4 and 3, and `x · x = −1` gives none. Not yet: a coefficient that
   isn't a fraction (`√2 · x = 2`), which needs norms by resultants, and
   two unknowns at once.
4. **`Real`** when a program needs π exactly.

## Prior art

- Rüdiger Loos, "Computing in algebraic extensions" (in *Computer Algebra:
  Symbolic and Algebraic Computation*, 1982): algebraic numbers as
  polynomial and isolating interval, with arithmetic by resultants.
- Sturm's theorem (Charles Sturm, 1829): counting real roots in an interval.
- Mathematica's `Root` objects and Sage's `QQbar` / `AA`: the same
  representation in use.
- Henri Cohen, *A Course in Computational Algebraic Number Theory* (1993),
  for the algorithms.
- Hans-J. Boehm, "Towards an API for the real numbers" (PLDI 2020), and
  Gosper's continued fractions (HAKMEM, 1972), already credited, for
  `Real`.
