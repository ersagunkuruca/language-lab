# Mathematics as libraries (2026-11-03)

Ersagun asked (2026-11-03 09:28): we added Clifford algebras and other
number systems. Should they have been part of the language, or outside
it? Perhaps the language only needs a way to add them, so that once a
library is added a multivector is still a number, and its operations
work and perform the same. Otherwise it is a slippery slope: fields,
rings, groups, manifolds, primes, analytic continuation, integrals,
category theory. He added that "they are inseparable" is also an
acceptable answer.

This note gives the answer, an audit of where the mathematics is today,
one measurement, and rows in BACKLOG.md. It changes no code.

## The answer

**Mathematics belongs in libraries. The core should keep only what the
machine has (Float64, Int, Text, Float32 rounding) and the mechanisms
that make a library type feel and run like a built-in one.** Nothing in
the list above needs to be in the core, and Clifford algebras did not
need to be either.

Most of the work is already done this way, which is the good news. The
Clifford product, sandwich, exp, duals and grades, Complex's arithmetic,
Dual numbers, Fixed's CORDIC, Rational and the matrix types are all
written in the language, in the prelude (`ters/src/lang/prelude-source.ts`).
The speed comes from general mechanisms: interfaces resolved before the
program runs (INTERFACES.md), staging of calls given known data (C65,
`stage.ts`), and reading a function as a matrix (`linear.ts`). None of
those three knows what a multivector is.

What is not yet true is that **any** library gets the same treatment as
the prelude. About a dozen places in the checker, the evaluator, the
compiler and the editor name the prelude's number types or the prelude's
Clifford functions directly. Those are the slope Ersagun is worried
about, and each of them can be replaced by a general mechanism. So the
answer is not "move the mathematics out", which is mostly done. It is:
**stop the core from knowing which library it is talking to.**
Ersagun's second message adds the one mechanism the core is missing:
generalization, as embeddings that keep the operations (see
"Generalization as a language feature").

Only two pieces are close to inseparable, and neither is mathematics in
Ersagun's sense:

- The machine numbers. Float64 and Int are what the hardware and every
  target offer. Their operations are builtins on every target
  (`compiler/src/builtins.ts`, with fdlibm in `wasm-math.ts` for WASM).
  That is the floor every library stands on, as it is in Julia, Haskell,
  Swift and Lean.
- Algebraic numbers. Their arithmetic is TypeScript in the core
  (`poly.ts`, `factor.ts` with Zassenhaus's method, `algebraic.ts`), run
  as builtins. It could be written in the language, but it would be much
  slower in the evaluator and it is not needed on the GPU. The honest
  shape is that `Algebraic` is a library type whose operations have a host
  implementation, registered the way jets are (below), with the
  in-language meaning as the reference when someone writes it.

## Audit: where the mathematics is today

### Already libraries (written in the language)

| what | where | notes |
|---|---|---|
| Clifford algebras Cl(p, q, r): table, product, outer, inner, regressive, reverse, duals, versor inverse, sandwich, exp, grades, parts by blade | prelude-source.ts (from line 667) | Ops are in-language. The `Algebra` record type and `Table entry` are std.ts types |
| Table product (complex, dual, quaternions, Clifford, small matrices from one multiplication table) | prelude-source.ts line 332 | ALGEBRA-TABLES.md |
| Complex arithmetic, principal sqrt, log, pow, asin, acos (L127) | prelude-source.ts lines 263 to 330 | The type is std.ts |
| Dual numbers, Trig at Dual by the chain rule | prelude-source.ts line 437 | The type is std.ts |
| Fixed point, CORDIC trig, Steele and White's shortest show | prelude-source.ts lines 487 to 660 | Literal rounding is in arith.ts |
| Rational arithmetic | prelude-source.ts line 234 | The type is std.ts; ordering is in run.ts and compile.ts |
| Matrices of any size: product, solve, determinant, inverse, least squares | prelude-source.ts line 1463 | `Matrix` is std.ts |
| Vectors (any record of Float64s) | vectors-source.ts, its own module | Uses the parts builtins only |
| Trig, Arithmetic, Ordered, Division as interfaces with implementations | std.ts types, prelude implementations | Resolved before running, no dispatch at run time |

### Mechanisms that are general (the right kind of core)

| mechanism | where | knows about mathematics? |
|---|---|---|
| Interfaces and implementations, monomorphised | arith.ts, infer.ts | No, except the lists below |
| Staging calls given known data (C65) | stage.ts | No: it evaluates any call whose data is written down |
| Reading a function as an affine map, stored as a matrix on the GPU | linear.ts, wgsl.ts | No: any record of Float64s |
| Representations and ways chosen by cost | represent.ts, ways.ts, library-reps.ts | No |
| Differentiation by walking the graph | derive.ts | Float64 operations only |
| Parts builtins: map parts, zip parts, total | std.ts | No: any record of Float64s |

### Special cases: the core naming a library's types or functions

These are what stop a library outside the prelude from being as good as
the prelude. Each is a row below.

| special case | where | what it does |
|---|---|---|
| The list of number types | types.ts `requireArith` (line 283), infer.ts `isNumberType` (line 114) and its error text (line 108) | Rational, Algebraic, Fixed and Complex are named. A type whose id starts with `std.` skips the interface lookup entirely |
| Literals at library number types | arith.ts `DATA_NUMBERS` (line 63), lines 398 to 431; infer.ts line 661 | `2.5` at Complex, Rational, Dual, Fixed, Algebraic, and `1` at Mat2 to Mat4, are built by naming each type's constructor |
| Matrix sizes | types.ts `MATRIX_SIZE` | Mat2 to Mat4 by id, for "a plain number is that many times the identity" |
| Showing values | run.ts `showValue` (lines 1136 to 1139), scalar.ts (lines 1239 to 1251) | Rational as `p/q`, Complex as `a + bi`, Fixed's exact digits, each named |
| Ordering | run.ts `compareValues` (line 136), compile.ts `orderOf` (line 369) | Rational and Algebraic named |
| Solving backwards | relate.ts line 1396 | Rational named for exact roots |
| Clifford grade masks | grades.ts lines 80 to 85 and 110 | Finds the prelude's `clifford product`, `clifford sandwich` and 15 others **by their names in the library**, and the algebra by std's `Algebra` constructor |
| The evaluator's fast product | jets.ts `TABLE_PRODUCT` | The prelude's table product by its hash, run as native code |
| The editor | editor/typed.ts lines 519, 1007 to 1012, 1237 | Rational, Fixed, Algebraic named for literals and display |
| Algebraic numbers | algebraic.ts, poly.ts, factor.ts; 18 `algebraic.*` builtins in std.ts | The whole type is host code |
| The types themselves | std.ts: Rational, Complex, Algebraic, Dual, Fixed, Mat2 to Mat4, Matrix, Algebra, Table entry, Trig, Extended | Declared in TypeScript, in the module every program loads |

On the targets, nothing about Clifford, Complex or matrices is hard-coded
per target. The per-target records (`builtins.ts`) are Float64, Int, Text
and data operations only. Fixed and Algebraic are refused on WASM and C
(scalar.ts line 1239), which is a target gap, not a special case.

## The measurement

Is a library-defined multivector as fast as the prelude's? I wrote the
same product two ways in one program, Cl(3, 0, 1) on a record of 16
Float64s, and ran each in a loop that multiplies by a motor known when
compiling (the loop is `product n times`, 1 to 5 million steps):

- **prelude**: `clifford product` from the prelude.
- **own library**: the program's own `Line(e, f, g)` type, a 192-line
  multiplication table written as a list (worked out once from the
  prelude's product), and its own fold over it. It uses only `zip parts`,
  `map parts` and `total`. Nothing in it is from the prelude, so none of
  the special cases above can apply.

The scratch script was `compiler/bench-mv.tmp.ts` (not committed).
Nanoseconds per product, two runs each:

| target | prelude | own library | ratio |
|---|---|---|---|
| compiled JavaScript | 22.8, 23.4 | 24.8, 27.9 | 1.1 to 1.2× |
| WebAssembly | 16.1, 16.1 | 25.3, 20.7 | 1.3 to 1.6× |
| C (`-O2`) | 9.6, 8.6 | 11.7, 14.9 | 1.2 to 1.7× |
| evaluator (editor preview) | 67 µs, 74 µs | 5,550 µs, 5,680 µs | **about 80×** |

Both compiled versions are straight-line arithmetic with the motor's
numbers folded in: staging (C65) unrolled the program's own table as well
as it unrolled the prelude's, with no list left. That is the claim
holding: **on JS, WASM and C a library written outside the prelude is
already within 2× of the built-in one**, and close to what a person would
write by hand.

The remaining gap on compiled targets is entirely the grade masks. The
prelude's version knows that 4 of the 16 parts stay 0 (grades.ts found
its `clifford product` by name) and drops them; the program's own version
computes all 16. On the evaluator the gap is the jet: the prelude's
`table product` runs as native code found by its hash, and the program's
own fold is interpreted.

A second check failed in an instructive way: a verbatim copy of the
prelude's 14 Clifford definitions under new ids (as a third-party library
would be) does not type-check today. The checker reports "my times works
only on records of Float64s" and a pinned-signature mismatch, because the
copy's types are not `std.` types and the prelude is checked against
signatures the copy did not get. I did not trace it to the end; L202
below makes it a test. **Since (L202, 2026-11-03):** the copy, all 21
`clifford …` definitions under new ids, checks and gives the prelude's
answers evaluated and compiled, in Cl(3, 0) and PGA
(ters/test/library-copy.test.ts). The speed gaps stay L203 (grade masks by
name) and L206 (jets by hash).

## What the core must give libraries

In priority order, and with what exists already:

1. **Operators through interfaces.** Built: `+ − · −x < ÷` are
   `Arithmetic`, `Ordered` and `Division`, and Trig is an interface. What
   is missing is that the checker still lists the number types by name
   and lets `std.` types skip the lookup. Once it doesn't, a library's
   Quaternion is a number in exactly the sense Complex is.
2. **Literals through an interface.** INTERFACES.md already names this
   ("from a fraction"). A library type says how a written number becomes
   one of its values, and arith.ts calls that instead of picking a
   constructor by type.
3. **Showing through an interface.** The evaluator, the compiler and the
   editor each show Rational, Complex and Fixed by name. One `Show` (or
   "shown as") implementation per type replaces all three.
4. **Staging and inlining for anyone.** Built (C65): this is why the
   measurement is good on compiled targets. The evaluator does not stage,
   which is why it needs a jet; once it stages known-data calls too (or
   compiles definitions, L118c), the jet can go.
5. **Sparsity for anyone.** Grade masks are the general idea "which parts
   of a record can be nonzero", worked out from a multiplication table or
   from the arithmetic itself. They should be read from the table and the
   code, not from the prelude's function names. This is the only measured
   speed difference on compiled targets.
6. **Host implementations registered by the library.** A jet (or
   Algebraic's polynomial code) is a host way to compute what an
   in-language definition means. The library should declare it next to
   the definition, and the core should check it against the definition
   (test/jets.test.ts already does this), rather than the core holding a
   list of library hashes.
7. **Representations and ways chosen by the compiler.** Built
   (REPRESENTATIONS.md, WAYS.md), and already written in the language.
8. **Editor display.** The editor should get a type's literal and display
   from the same interfaces, not from its own list.

With these, the number types can leave std.ts and become a published
`numbers` module beside `vectors` and `trees`, with their ids kept so
saved programs keep opening (L184).

## Generalization as a language feature

Ersagun's second message (09:38): Clifford algebras generalize complex
numbers the way integers generalize naturals, and unless "generalization"
is a language feature we can't get the full benefit of a small
mathematical core.

I think he is right, and that it is the missing mechanism on the list
above. It also fits what the language already has. Here is the shape I
recommend.

**A generalization is an embedding: a map ι from the smaller structure A
into the larger one B that keeps the operations**, so ι(a + b) = ι(a) +
ι(b) and ι(a · b) = ι(a) · ι(b). Naturals into Int, Int into Rational,
Float64 into Complex, Complex into Cl(0, 1) or into the even part of
Cl(2, 0), quaternions into the even part of Cl(3, 0), a rotor into a full
multivector.

The language already has this object under another name. A
representation is a type R with `meaning: R → T` (REPRESENTATIONS.md).
**An embedding is a representation whose meaning keeps the operations.**
"A Complex that is really a Float64" is the Complex type represented by
Float64 through ι. So the feature costs one new law on an existing
definition, not a new kind of node, which keeps Ersagun's uniformity
rule.

What it gives, in feel and in speed:

- **Feel: the small number works where the big one is wanted.** `2 ·
  rotor`, `1 + x·i` and `rotor + 0.5` type-check, because the checker
  can insert the embedding. Literals are the first case of this: there is
  exactly one ring map from Int into any ring, which is why `fromInteger`
  works in Haskell. The literal interface of L204 is then not a special
  feature; it is the embedding from Int (and from fractions, into
  anything with ÷).
- **Speed: a big value that stays in a small part is stored as the small
  type.** This is what grade masks already do for Clifford algebras: a
  value the compiler can show stays in the even part of Cl(3, 0) is
  stored as 4 numbers, not 8. With embeddings that becomes general: the
  compiler sees that a Complex never gets an imaginary part and keeps a
  Float64, or that a multivector stays a rotor and keeps a quaternion.
  The compiler chooses, as it does for every representation, so nothing
  is pinned by the program (Ersagun's "no explicit selection").
  The measured speed gap above (grade masks by name) closes as a special
  case of this.
- **Laws carry over.** An embedding's law is checked like any other law
  in the language (T7, L108d), so a library that declares one is tested
  against it.

Constructions fit on top. Each well-known way of building a bigger
structure from a smaller one is an ordinary library function from
algebras to algebras, together with its embedding:

| construction | example | in Ters |
|---|---|---|
| differences (Grothendieck) | naturals to Int | a library type and its embedding |
| fractions | Int to Rational | the same |
| quotient of polynomials | Rational to Rational(√2), the algebraic numbers | a table from a polynomial |
| Cayley–Dickson doubling | Float64 to Complex to quaternions to octonions | a table from a table |
| Clifford algebra | Cl(p, q, r) from a signature | `clifford table`, which already exists |
| completion | Rational to the reals | lazy intervals (L88 step 4) |

`clifford table(squares, basis)` is already a construction of this kind;
it just doesn't say what it embeds. Because staging (C65) works out
tables given as data when compiling, a construction run at compile time
costs nothing when the program runs.

Two things to be careful about:

1. **Not every embedding is unique.** Complex goes into Cl(3, 0) in many
   ways (any unit bivector can be i). Int into a ring, and Float64 into
   Complex, are unique. So the checker should insert an embedding by
   itself only when it is the only one (the canonical ones), and a
   program names the others, as Mathlib distinguishes coercions from
   chosen maps.
2. **Towers are not lines.** Scheme's numeric tower is a single chain;
   real mathematics is a graph (Int goes into Rational and into Fixed,
   which don't go into each other). Two paths from A to B must give the
   same map, which Lean and Mathlib call the diamond problem. The checker
   can refuse a program where two canonical paths disagree, and the laws
   test it.

So the recommendation becomes: **the small core is the machine numbers,
interfaces, staging, representations, and embeddings as representations
that keep the operations. Everything else, including Complex and
Clifford, is library constructions with their embeddings.** Rows L208 and
L209 below. How embeddings go into Ters, in steps: EMBEDDINGS.md (L208a).

## Should Clifford stay in the standard library?

Yes, as a library that ships with the language, the way Julia ships
`Complex` and `Rational` in Base but written in Julia. Libraries that come
with a language are a choice about what users get by default, not about
the core. What matters is that the standard library has no powers a user
library lacks. Today the prelude does have three (grade masks by name,
the jet by hash, the `std.` checker paths), and the rows below remove
them.

The slope Ersagun names (fields, groups, manifolds, integrals, category
theory) is then the library's problem, where it belongs. Lean's Mathlib
is the extreme of this: Lean's core has almost no algebra, and the whole
hierarchy of rings and fields is a library of type classes.

## Prior art (influences)

- **Julia**: multiple dispatch with specialisation per concrete type, so
  `Complex{Float64}` and `Rational`, defined in Julia in Base, run like
  built-ins; Clifford algebras are packages (Grassmann.jl,
  CliffordAlgebras.jl). The closest to what this note recommends.
  Influence.
- **Haskell's `Num` and `fromInteger`**: arithmetic and literals through a
  type class, so `2.5` at a user's type works; GHC's specialisation and
  rewrite rules make it fast. The literal interface (row L204) is this
  idea. Influence.
- **Lean 4 and Mathlib**: a small core, and the algebraic hierarchy
  (monoids to fields and beyond) entirely in a library through type
  classes. The answer to the slippery slope. Influence.
- **Swift Numerics**: `Complex` was kept out of the standard library and
  shipped as a package, made fast by cross-module inlining and generic
  specialisation. Influence.
- **ganja.js** (Steven De Keninck): generates the product code for any
  Cl(p, q, r) from its signature. Our staging does the same from the
  table at compile time; already credited for the Clifford work. Prior
  art.
- **Scheme's numeric tower** (R7RS §6.2): integers, rationals, reals and
  complex numbers as nested sets, with arithmetic moving a value up as
  needed. Prior art for generalization as a feature; a single chain where
  we need a graph. Influence.
- **Lean 4's coercions and Mathlib's `algebraMap`**: canonical maps
  inserted by the checker, chosen maps named, and the "diamond" rule that
  two paths must agree. Influence on the two cautions above.
- **Cayley–Dickson doubling, Grothendieck groups, fields of fractions,
  quotient rings**: textbook constructions, named so the table reads;
  not credited as anyone's code.
- **Jets** (Urbit) and Unison's builtins by hash: a host implementation
  standing in for a definition that stays the meaning. Already credited in
  jets.ts and CREDITS.md. Influence.

## Rows added to BACKLOG.md

In priority order (L208 and L209 come from Ersagun's second message). The test comes first, since it fails today and says
when the work is done.

| id | item | pri | size |
|---|---|---|---|
| L202 | A library outside the prelude is as good as the prelude: a test with a copy of the Clifford functions under new ids, and a program's own table product, that type-check, run, and compile to the same code and speed (within 1.2×) as the prelude's on JS, WASM and C, and within 2× in the evaluator. Fails today | P2 | M |
| L203 | Grade masks for any library: grades.ts reads which parts can be nonzero from the table and the code, not from the prelude's `clifford …` names and std's `Algebra` constructor | P2 | M |
| L204 | Number types by interface only: types.ts `requireArith`, infer.ts `isNumberType`, arith.ts `DATA_NUMBERS` and the per-type literal constructors become Arithmetic, Ordered and a new literal interface ("from a fraction"); `std.` types stop skipping the lookup; `MATRIX_SIZE` goes. Rational's and Algebraic's ordering in run.ts and compile.ts goes through Ordered | P2 | L |
| L205 | Showing by interface: run.ts `showValue`, scalar.ts's show and the editor show Rational, Complex and Fixed through each type's own show implementation, not by name | P2 | M |
| L206 | The evaluator's speed without jets by hash: stage known-data calls in the evaluator (stage.ts) or let a library declare its host implementation beside the definition; retire jets.ts's list. Measure with L202 | P3 | M |
| L207 | The number types leave std.ts for a published `numbers` module written in the language (Rational, Complex, Dual, Fixed, Mat2 to Mat4, Matrix, Algebra, Table entry, Trig, Extended), ids kept for saved programs (L184). After L204 and L205. Algebraic stays host code, registered by the module | P3 | L |
| L208 | Generalization as a feature (Ersagun 2026-11-03): an embedding is a representation whose meaning keeps the operations; the checker inserts only canonical (unique) ones, others are named; two canonical paths must agree; laws checked (T7). Design note first, including literals as the embedding from Int (folds into L204) | P2 | L |
| L209 | Values stored in the smallest structure they stay in, chosen by the compiler through embeddings: a Complex with no imaginary part as a Float64, a multivector that stays a rotor as a quaternion. Generalizes L203's grade masks. After L208 | P3 | L |
| E237 | The editor's literals and display for library number types through L204's and L205's interfaces, not editor/typed.ts's list (`EXOTIC`, the Rational literal paths) | P3 | M |
