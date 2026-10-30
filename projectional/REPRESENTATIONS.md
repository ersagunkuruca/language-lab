# Representations in the language (design note for BACKLOG L108, 2026-10-30)

Ersagun, 2026-10-30: "aren't we going to have the multiple representations
the part of the language at all? Are they gonna stay only as a part of the
compiler?"

## Short answer

They should be part of the language, and most of one already is. Only
the declaration that ties the pieces together is outside it today.

Every piece a representation is made of is already an ordinary
definition (NUMBERS.md, src/lang/represent.ts):

- the meaning, `meaning : R → T`;
- the jobs done at R: each constructor of T, `match`, `fold`, and any
  function on T that R can do faster.

What is not language is the record that says "these definitions are a
representation of T, at these costs". It lives in a JSON side table
(examples/numbers/representations.json) or in TypeScript
(src/lang/library-reps.ts). A program can't write one, the editor can't
show one as code, and a module can't publish one.

The proposal is to write that record in the language, the way an
implementation of an interface already is:

```
representation int of Nat = representation(
  meaning: (i) → nat(i),           -- Int → Nat, an ordinary definition
  zero: 0, succ: (i) → i + 1,
  match: (i, zero case, succ case) → if i = 0 then zero case() else succ case(i − 1),
  fold: …,
  add: int add, multiply: int multiply,
  costs: costs(add: log n, multiply: log² n, space: log n, …))
```

It is one more definition in the program, with no new node kind: a call of
a std record constructor, typed so that each job has T's job's type at R.
That is the same check `trig at fixed = trig(…)` gets (INTERFACES.md).

**What stays the compiler's.** Choosing a representation stays invisible
at the place a value is used. Ersagun ruled out annotations and hints
(2026-10-29, C56), and that holds here too. The chooser picks per value
from the jobs a program uses and their costs, as it does now. The program
says which representations exist and what they cost; the compiler says
which one each value gets. A program may still pin one, as it can today
(`approximate` representations such as Float32 are only ever asked for).

## Why this shape

- **One system.** A representation is to a type what an implementation is
  to an interface, and its costs are the costs ways already have (WAYS.md,
  L96c). The chooser and Knuth's way picker are the same kind of search
  (pick the cheapest set that covers the jobs), and could become one.
- **Laws are checkable in the language.** "R's add agrees with T's add
  through meaning" is a law between two definitions, so it is a T7 law
  check like any pair of ways. Today it is a TypeScript test.
- **Modules can publish them.** A library's Map-as-tree or
  List-as-array becomes an export like any other definition, hashed and
  shared (L68).
- **The editor shows it as code.** The program's own representations
  appear as definitions. Where a value got one, the editor can say so (the
  Program tab already lists what was chosen), without anything written at
  the use.

## What doesn't change

- No program changes. `List`, `Nat`, `Map` keep their meaning; only where
  the representation table comes from changes.
- `represent` (the rewrite) and `choose` (the chooser) keep working on the
  same `Representation` records. They are read off the definitions
  instead of the JSON.
- Representations that are pure compiler technique (destination passing,
  C30's `$into`, C56's "owned, in place") stay in the compiler. They are
  not a different meaning at a different type. They are how one
  representation is laid out on one target. TWO LANDSCAPES (Ersagun
  2026-10-24) is the line: what a representation *is* belongs to the
  language; how a target hosts it belongs to the target.

## Steps

1. **L108a, built.** std's `Representation t r`, with one constructor,
   `representation(meaning, space, jobs)`. Its jobs are a `List (Job t r)`:
   - `job(add, add′, logarithmic)`: t's job done at r by another
     definition;
   - `as written(nat, linear)`: t's job done by its own definition;
   - `match by(f, constant)` and `fold by(f, linear)`, with
     `match as written` and `fold as written` for t's own.
   Each job carries a `Cost`, which is the ladder: constant, logarithmic,
   polylogarithmic, linear, linearithmic or quadratic. A meaning of
   `(n) => n` is t itself. The checker says when a job's definition
   doesn't have t's job's type with r for t ("this does (Nat) -> Nat's job
   at Int, so its type is (Int) -> Int"). `representationsIn`
   (represent.ts) reads a program's representation definitions into the
   records the chooser and the rewrite already took. Numbers' `unary`,
   `binary` and `int` are now definitions in the example; they read back
   identical to the old representations.json, which is gone, and lab and
   the tests take them from the program.
2. **L108b.** The library's Map and Set trees (library-reps.ts) move into
   the prelude as definitions, and the side table goes.
3. **L108c.** A program pins a representation for one value or one
   definition. This is a definition of its own, not a hint at the use. The
   editor shows what was chosen next to the value's type.
4. **L108d, after T7.** Each job's law through `meaning` is checked as a
   law in the language.
5. **With C30.** Lists as arrays becomes a row written this way (`array
   of List`), so every target can use it, not only compiled JS.

## Prior art (to credit when built)

- Hoare, "Proof of correctness of data representations" (1972): the
  abstraction function, here `meaning`.
- Haskell's type classes with associated data and GHC's rewrite rules:
  the jobs-as-a-record shape, and the compiler choosing.
- Unison's abilities and Lean's `@[implemented_by]`: a definition given a
  faster body that must agree with the meaning.
- Self and V8's hidden classes, and Clojure's transients: one meaning, a
  storage picked from how it is used.
