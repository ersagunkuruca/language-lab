# What `Number` should mean (design note, 2026-10-26)

Ersagun, 2026-10-26: "I don't like the fact that we use JS's definition of
Number. Let's rename it Float or Float64 or something. We probably need
Number to be either what a literal like 123432 is (which can be cast down to
anything, like Haskell) or the general name of numbers as in mathematics."

Step 1 (BACKLOG L85) renamed the floating-point type to `Float64`: the
IEEE 754 name of what it is, with its width, so the GPU's 32-bit floats can
be shown as `Float32` beside it (they already are a representation by that
name, float32.ts). Plain `Float` would hide the width, and a shader's floats
are a different width. This note is step 2: what the freed name should mean.
Ersagun liked it (2026-10-26), and points 1 and 2 of the recommendation are
built (L86), and so is point 3, a whole literal defaulting to Int (L86b). See
"What's built" at the end.

## Where we are

- Four number types: `Int` (whole, any size), `Rational` (exact fraction),
  `Float64`, `Complex`, and records of `Float64` (vectors, colours).
- One `+ − · −x <` for all of them (#348): the checker gives an operation a
  type variable that may only be a number type (the `arith` constraint, and
  `ordered` for `<`), and arith.ts picks each type's own operation before
  anything runs (monomorphisation). A type still open at the end defaults
  to `Float64`, as Haskell defaults `Num`.
- A literal has one type, fixed by how it's written: `3` is a `Float64`
  unless written as an Int, `1/2` is a `Rational`. So `3` can't be an Int
  without saying so, and `whole part(3)` or `as float64(n)` show up.

## The two readings

**A. `Number` is the type of a plain literal.** `123432` would be "some
number", turned into whichever number type its use needs: Haskell writes a
literal as `fromInteger 123432 :: Num a => a` (and `0.5` as
`fromRational`), Haskell 2010 report §6.4.1. The literal stays exact until
the type is known; nothing converts at run time.

**B. `Number` is the general name, as in mathematics.** Int, Rational,
Float64 and Complex are all Numbers; `Number` names the family, the
constraint every generic `+` already carries. A generic function's type
would read `(a, a) -> a, a is a Number` instead of "a number type".

## Recommendation: B, which brings A along

They aren't rivals. In Haskell, `Num` is the family (B), and a literal's
type is "some `Num`" (A): the literal is just the smallest program whose
type is the family. Do the same here:

1. `Number` names the family: the `arith` constraint, shown as "a is a
   Number" in types, errors and the palette. `Ordered Number` (or "a Number
   with <") for `ordered`, which leaves out Complex. No new mechanism: this
   is the constraint #348 already checks and resolves.
2. A plain literal gets that type: `3 : a, a is a Number`, so `3` is an Int
   where an Int is needed, a Float64 where a Float64 is, a Rational or a
   Complex likewise, with no `as float64` in between. `0.5` is a Number
   too, but not an Int: it can be Rational, Float64 or Complex (Haskell's
   `Fractional`).
3. When nothing decides, the default is exact where it can be: a whole
   literal defaults to `Int`, a literal with a fraction part to `Float64`
   (Haskell defaults to `Integer` and `Double`). That is one change of
   meaning: `show(2 + 3)` alone is the Int `5` where today it's the Float64
   `5`, and they print the same.

Why this fits the language and not a target: the name and the rule come
from mathematics (a numeral names a number before it names a machine
format), and each target only meets types that are already fixed, the way
arith.ts already hands them a resolved program. JavaScript's `number`,
WASM's `f64` and C's `double` stay the hosting of `Float64`, and none of
them leaks into what `Number` means (TWO LANDSCAPES).

## What it would touch

- infer.ts: a plain `lit` gets a fresh variable with the `arith` (or
  fractional) constraint instead of `Float64`; arith.ts defaults Int for a
  whole literal and fixes the literal's value to the chosen type (a BigInt,
  a ratio, a complex with 0i). Saved programs keep working: a literal
  already marked `of: "type.int"` or `"type.number"` stays what it says.
- relate.ts (running backwards) and the compiler see only resolved types,
  as now.
- Type display, error messages, palette and docs say "is a Number".
- Tests that pin `Float64` for an unconstrained literal change to `Int`.

Credit: Haskell's numeric literals and defaulting (Haskell 2010 report
§6.4.1 and §4.3.4), as the generic `+` already credits Haskell's `Num`.

## What's built (L86, 2026-10-26)

- Types, errors and the palette say "a is a Number", and "a Number with <"
  where `<` is used (Int, Rational or Float64).
- A plain literal gets a fresh variable with the `arith` constraint, and a
  literal with a fraction part also the `fractional` one (types.ts), so
  `0.5` at an Int is the error "a number with a fraction part can't be an
  Int".
- arith.ts turns each literal into its type's own before anything runs:
  an Int literal, a ratio, a complex with 0i, a record with the number in
  every part, or a Float64. The evaluator, running backwards and every
  compiler target see only literals whose type is fixed.
- A number type nothing fixes is Int when a whole literal gave it, and
  Float64 otherwise (L86b; types.ts `whole`, arith.ts `otherwise`). So
  `inc(x) = x + 1` on its own is `(Int) -> Int`, and `inc(2.5)` uses a
  Float64 copy of it. A record of Float64s stays one. Tests that meant
  Float64 for a bare whole literal now write it at Float64.
- In the editor, typing `3` where an Int goes gives an Int literal.
- A GPU program's entry point that is generic over numbers (a plain
  literal makes `halfway(a) = mix(a, 10, 0.5)` one) is lowered at
  Float64, the default Haskell gives an ambiguous number at the top
  (compiler/src/scalar.ts).
