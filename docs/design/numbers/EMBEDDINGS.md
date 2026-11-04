# Embeddings: generalization as a feature (design note for BACKLOG L208, 2026-11-03)

Ersagun (2026-11-03 09:38): Clifford algebras generalize complex numbers
the way integers generalize naturals, and unless generalization is a
language feature a small mathematical core gives only part of its
benefit. MATHEMATICS-AS-LIBRARIES-2026-11-03.md ("Generalization as a
language feature") gave the shape. This note says how it goes into Ters,
in steps, with nothing built yet.

## Short answer

An **embedding** of A into B is a function `ι : A → B` that keeps the
operations: ι(x + y) = ι(x) + ι(y), ι(x · y) = ι(x) · ι(y), ι(−x) = −ι(x),
and for an order, x < y exactly when ι(x) < ι(y). Int into Rational,
Float64 into Complex, Complex into the even part of Cl(0, 1).

It is one std record, written like an implementation of an interface:

```
embedding float64 in complex = embedding(map: (x) → complex(x, 0))
```

`Embedding a b` has one field, `map : (a) → b`. With it the language
gets three things, each a step below:

1. **The laws are checked.** `lab test` checks the laws above for every
   operation both types have (the Arithmetic and Ordered implementations
   they share), on generated values, the way rep-laws.ts checks a
   representation's jobs through `meaning` (L108d).
2. **The checker inserts it.** Where an A is given and a B is wanted, and
   the declared embedding is the only one from A to B, the checker calls
   its map there. `2 · rotor`, `x + 1·i` and `rotor + 0.5` then check.
   Literals are the first case: an Int literal at any type with an
   embedding from Int (L204's literal interface becomes this).
3. **The compiler keeps the small type.** An embedding is a
   representation of B by A whose meaning is ι (REPRESENTATIONS.md): a B
   that the compiler can show stays in ι's image is stored as an A. A
   Complex that never gets an imaginary part stays a Float64, a
   multivector that stays a rotor stays four numbers. Grade masks
   (GRADES.md, L43c) are this, by name, for Clifford algebras today.

No new node kind: a definition whose body calls a std constructor, as an
implementation and a representation already are (Ersagun's uniformity
rule).

## Decisions in this note

**Only canonical embeddings are inserted.** Int has exactly one ring map
into any ring, and Float64 one into Complex, but Complex goes into Cl(3, 0)
in many ways (any unit bivector can be i). So:

- `embedding(map: …)` declares *the* embedding from A to B, at most one
  per pair (the same rule and message as an implementation, "a type has
  one implementation of an interface, so keep one"). The checker may
  insert it.
- Any other map that keeps the operations is an ordinary function, called
  by name. Its laws can still be written as a law (T7).

**Paths must agree (the diamond rule).** Embeddings compose: Int to
Rational to Complex is an embedding from Int to Complex. Mathematics is a
graph, not Scheme's single tower (Int goes into Rational and into Fixed,
which don't go into each other). When two canonical paths lead from A to B,
the checker refuses the program unless a direct `embedding` from A to B is
declared, and the laws test then checks that the direct one agrees with
each path on generated values. The checker can't decide whether two maps
are equal, so the declaration makes the choice visible and the test makes
it trustworthy.

**Where the checker inserts one.** Only where both types are already known
when a unification fails: an argument given at a parameter's type, a
field, a returned value. A variable is never solved to "something A embeds
into": that would make inference depend on order, and HM's principal
types would go. For an operation with two sides (+ − · <, written
`add(a, b)`), when the sides are A and B and one embeds into the other, the
smaller is lifted to the larger; when neither does, it is an error as
today. This is the job of Lean 4's `binop%` elaborator, which finds the
largest type of a tree of operations and lifts the leaves to it.

**Open: whether an inserted embedding is shown in the editor.** It is a
call the program didn't write. Ersagun ruled out compiler hints for
stable references and representations (2026-10-29); an embedding is
different, since it changes which function runs. The proposal is to show
it as the type does today when hovered, not as a mark on the code, and to
ask him before E work starts.

## Steps

- **L208a, this note.**
- **L208b** (done). std's `Embedding a b` and the check of a declaration: `map`'s
  type, one per pair, both types closed. `lab test` checks its laws for
  every Arithmetic and Ordered operation the two types share (rep-laws.ts
  generates the values). The library declares Int into Rational, Int and
  Rational into Float64 (a lossy one: its laws hold only approximately, as
  Float32's do, so it is checked with near, L197), Float64 into Complex,
  Float64 into Dual.
- **L208c** (done for arguments and + − · <, and since L208c2 for a function's result: a function given where one with the same inputs and a larger result is wanted, `half of(length)`, is lifted, a lambda's body where it is and a named function as (x) → map(f(x)); since L208c3 an input whose wanted type an earlier input fixed, `inverse(half, count)`; since L208c4 a pinned definition's own result, a Float64 pinned whose body now gives an Int; a literal is left, with e). The checker inserts a canonical embedding where a known A is
  given for a known B (infer.ts, at the unify of an argument, field or
  result), and lifts the smaller side of + − · < (arith.ts). Every engine
  then just runs a call, so no compiler work.
- **L208d** (done, src/lang/diamonds.ts; a path is read with each stretch a declared embedding crosses replaced by it, so the library's Int into Float64 settles Int into Complex and Dual). The diamond rule: paths composed through the declared
  embeddings, refused when two disagree in source and no direct one is
  declared; the laws test compares the direct one with each path.
- **L208e** (with L204b; e1 done: a literal at Complex or Dual is map(x) of the embedding from Float64, a plain call of `as complex` or `as dual`, so a shader still lowers it; at Rational, Algebraic and Fixed a literal is their Literal implementation's since L204d, so arith.ts builds no number's constructor). Literals as the embedding from Int, and from
  fractions into anything with ÷; `DATA_NUMBERS` and the per-type literal
  constructors in arith.ts go.
- **L208g** (done). Searches see the lifts: relate's evaluator resolves the resolved code again, and the lifts are no longer listed by then, so none is wrapped twice; a named map is called by name.
- **L208f** (now L209's first step; Compiler lane, after L43c). An embedding is a representation
  of B by A with meaning ι: the compiler keeps a B that stays in the image
  as an A. Needs the image analysis that grade masks do by name (which
  cases of a value can be non-zero); grade masks become its first user.

## Prior art (influences)

- **Lean 4 coercions and Mathlib's `algebraMap`**: canonical maps inserted
  by the elaborator, chosen ones named, and the rule that two paths must
  agree ("diamonds"). Lean's `binop%` elaborator lifts the leaves of a
  tree of arithmetic to its largest type. Influence on all of the
  decisions above.
- **Haskell's `fromInteger`**: an Int literal at any `Num` type through the
  one map from the integers (Wadler and Blott, POPL 1989). Influence on
  L208e.
- **Scheme's numeric tower** (R7RS §6.2): numbers lifted up a single chain
  as needed. Prior art; we need a graph.
- **Coercive subtyping** (Zhaohui Luo, "Coercive subtyping", Journal of
  Logic and Computation 9(1), 1999): a coercion is a function inserted at a
  type mismatch, and coercions must compose coherently. Influence on the
  diamond rule.
