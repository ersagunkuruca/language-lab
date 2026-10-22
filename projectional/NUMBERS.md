# Numbers, and programs that don't say how their data is stored

Two requests that turn out to have one answer:

1. More number systems: fractions, big integers, complex numbers, continued
   fractions (finite and infinite), vectors, matrices, tensors, and Clifford
   algebras as the one home for complex, split-complex and dual numbers and
   quaternions.
2. Keep the mathematical definitions (`Nat = zero | succ(Nat)`,
   `List = nil | cons`) as the program, and let the compiler run them on
   something fast (binary, machine integers, arrays, ropes), choosing by
   cost. Users' own types should get several representations too.

The answer is to **separate what a value means from how it is stored**,
and to do it with things the language already has. A type is its meaning.
A representation is another type plus a function that says what its
values mean. Every number system below is one meaning with a few
representations.

This document is the plan. A working proof of concept is included: Peano
naturals with a binary representation, the program rewritten onto it, and a
chooser that picks by cost.

```sh
npm run numbers                     # the demo: one program, two representations
node --test test/numbers.test.ts    # the laws, the rewrite, encoding by running backwards
cd ../compiler && npm test          # includes the rewritten program, compiled
```

## Short answers

- **Is this a new language feature?** No new node kinds. A representation
  is an ordinary data type, an ordinary function `meaning : R → T` (the
  *abstraction function*, Hoare 1972), and ordinary definitions that do T's
  jobs on R. What ties them together is a side table keyed by ids
  (`representations.json`), like names, comments and hints.
- **What does the program look like?** Exactly as it does now. `factorial`
  is written on Peano naturals and never mentions binary. The rewrite onto
  binary is code → code (`src/lang/represent.ts`): the result is an
  ordinary program that the evaluator runs and the compiler compiles.
- **Who makes sure the fast version is right?** Laws:
  `meaning(add′(a, b)) = add(meaning(a), meaning(b))`. Today they are
  tested, the same way the compiler is tested against the evaluator. The
  evaluator always runs the definition, so it stays the meaning of the
  program.
- **Converting into a representation?** Free: it's `meaning` run backwards.
  `meaning` is usually many-to-one (binary with leading zeros, fractions
  not in lowest terms), so its inverse has many answers, and the canonical
  one comes first. **The canonical spelling of a value is the first answer
  of its meaning run backwards**, the same rule that makes `√4 = 2` and that
  picks a page's canonical URL in `invertible/`.
- **How does the compiler know complexity?** For now each representation
  says what each job costs (`add`: `log n` in binary, `n` in unary). Later
  the costs of most code can be worked out, because the language has no
  loops: a fold is linear in the size of what it folds, and the size of a
  value depends on its representation (n nodes for unary n, log n for
  binary).
- **Complex numbers, quaternions?** Not types. One library for Clifford
  algebras `Cl(p, q, r)`, with complex numbers, split-complex numbers, dual
  numbers and quaternions as particular algebras. A quaternion is really a
  *representation*: four numbers storing a rotor of `Cl(3, 0)`, which in
  general would need eight.
- **How does `+` work on all of these?** Names are presentation. Many
  definitions can be displayed as `+`; the palette offers the one that fits
  the types, and the program stores its id. Generic code takes its
  operations as an argument, which the editor fills in when exactly one
  candidate fits. No type classes.
- **Infinite continued fractions?** Done, through an effect: a data type
  with a cell in a field, `term(whole: Int, rest: Cell CF)`, where the rest
  is a `formula`, computed when first read and then remembered (LANGUAGE.md,
  "Cells"). No new kind of node. Exact real arithmetic on them is Gosper's
  algorithm, written in the language (`src/lang/cells-programs.ts`, live
  at [reactive.html](https://ersagunkuruca.github.io/language-lab/reactive.html)).
  Comparing two exact reals might never finish: √2 · √2 never gives its
  first term, and `with fuel` turns that into "undecided".
- **Derivatives?** Dual numbers (`Cl(0, 0, 1)`, ε² = 0) are a
  representation of `Number` that carries a slope. Running a function on
  them is forward-mode automatic differentiation: a second implementation
  of `derivative`, to test `derive.ts` against.

## The proof of concept

`examples/numbers` (first typed in through the builder, now JSON) has three parts, all
ordinary definitions.

The meaning, and a program written against it:

```
type Nat
  | zero
  | succ(pred: Nat)

multiply(a, b) =
  fold a
    zero → zero
    succ(m) with ‹m × b› → add(b, ‹m × b›)

factorial(n) =
  fold n
    zero → one
    succ(m) with ‹m!› → multiply(succ(m), ‹m!›)

‹is even›(n) =
  match n
    zero → true
    succ(m) → not ‹is even›(m)
```

A representation: little-endian bits, never a leading zero, and what they
mean:

```
type Binary
  | empty
  | even(half: Binary)      ← 2·half
  | odd(half: Binary)       ← 2·half + 1

meaning : (Binary) -> Nat
meaning(bits) =
  fold bits
    empty → zero
    even(half) with h → double(h)
    odd(half) with h → succ(double(h))
```

and definitions that do Nat's jobs on `Binary`: `zero′`, `succ′`, `add′`,
`multiply′`, `number′`, and the two that make *any* Nat code run on
binary, a match and a fold:

```
‹match Nat′›(n, ‹if zero›, ‹if succ›) =
  match n
    empty → ‹if zero›()
    otherwise → ‹if succ›(pred′(n))

‹fold Nat′›(n, ‹if zero›, ‹if succ›) =
  apply fold n
    empty → (from, r) => r
    even(h) with ‹run h› → (from, r) => ‹run h›(add′(from, h), ‹run h›(from, r))
    odd(h) with ‹run h› → (from, r) => ‹if succ›(add′(from, twice′(h)), ‹run h›(add′(from, h), ‹run h›(from, r)))
    to (zero′, ‹if zero›())
```

`fold Nat′` is the interesting one. A fold over Nat must run its `succ`
case n times, whatever the representation. Done naively on binary
(recursing on `pred′`), the checker can't see that it ends, so it would
get `Diverge`. Written as a fold over the *bits* that builds "run the succ
case for indices from … from + n − 1" (twice the half, plus one more for
odd), it is structural recursion over `Binary`, so the checker proves it
total, and so is every fold over Nat that runs through it.

The chooser reads the jobs `main` uses and their costs:

```
          nat   number  match  zero  succ  fold  multiply  add    space
unary     n     n       1      1     1     n     n²        n      n
binary    n     log n   1      1     1     n     log² n    log n  log n

chosen: binary
```

and `represent` rewrites the program. The same nodes keep their ids (so
names and comments stay attached), and their types change:

```
factorial : (Binary) -> Binary
factorial(n) = ‹fold Nat′›(n, () => one, (m, ‹m!›) => multiply′(succ′(m), ‹m!›))
```

| | unary (the definition) | binary, evaluated | binary, compiled |
|---|---:|---:|---:|
| `small`: 6!, 2¹⁰, is 7 even | 110 ms | 5 ms | |
| `main`: 18!, 2⁵⁰, is 100 even | 6.4 × 10¹⁵ succ nodes for 18! alone | 45 ms | 3.5 ms |

The tests check, for every pair up to 9, that each primed definition agrees
with the one it replaces through `meaning` and never makes a leading zero;
that `match Nat′` and `fold Nat′` see the same cases as Nat; that the
rewritten program prints what the original prints; and that it compiles
(`compiler/test/represent.test.ts`).

Encoding is `meaning` run backwards by the relational interpreter, with
nothing written for it:

```
meaning(?) = 6:
  canonical  even(odd(odd(empty)))
  also       even(odd(odd(even(empty))))           ← a leading zero
  also       even(odd(odd(even(even(empty)))))
```

## The design

### Meaning and representation

A **type is its meaning**. `Nat = zero | succ(Nat)` says what a natural
number *is*, and every definition on Nat says what it computes. That is the
program, and the evaluator always runs it that way.

A **representation** of T is:

| part | what it is | required? |
|---|---|---|
| a type R | ordinary data type, or a builtin (JS number, BigInt, array) | yes |
| `meaning : R → T` | ordinary function; the abstraction function | yes |
| T's constructors on R | `succ′ : R → R`, one per variant | yes |
| T's `match` and `fold` on R | functions taking one function per case, in the type's order | yes |
| any function on T | `add′` for `add`, and so on | no: unimplemented ones run their definition through the match and fold above |
| `equal` | only if R is not canonical | see below |
| costs | per job, plus space | yes, for now |

Constructors plus match plus fold are exactly what a type *is* to the code
that uses it, so with those three any program on T runs on R. This is
Wadler's *views* (1987) put to work: matching on `succ(m)` when the value
is binary is a call to the view. Everything else is optional speed.

Equivalence between two representations needs no declaration of its own:
two representations of T are equivalent because both have a `meaning`
into T. Converting from one to the other is one's `meaning` forward, then
the other's backwards. When the backwards direction is too slow for real
use (it's a search), the representation provides a direct `encode` and the
law `meaning(encode(x)) = x` is tested like the others.

### Canonical spellings and quotient types

`meaning` is usually many-to-one. Binary with leading zeros; `2/4` and
`1/2`; a rope with different internal splits; a multivector stored densely
or sparsely. That's fine, and it is the same situation as `x²` and its two
square roots: the inverse has several answers and one is canonical.

A representation is **canonical** when its operations only ever produce
one spelling per meaning (the binary one never makes a leading zero,
fractions are always in lowest terms). Then structural equality and the
content hash are still correct. Otherwise it must implement `equal`, and
it can't be hashed by structure. The flag is in the side table and the
tests check it.

This also gives the language **quotient types** without adding them. The
rationals are pairs of integers *up to* `a/b = c/d when ad = bc`. Here the
meaning type is "pair of integers", the representation keeps lowest terms,
and the canonical spelling is the first answer of the meaning run
backwards.

### Laws, and what can go wrong

For each implemented job: `meaning(f′(x…)) = f(meaning(x)…)`. For a
constructor or match it's the same square. These are properties, tested
on enumerated small values (exactly what `test/numbers.test.ts` does), the
way the solver's laws are checked numerically.

Later, for folds, many of these can be proved rather than tested: the law
for a fold follows by fusion from the laws for the constructors. That's
the step from "tested" to "can't be wrong", and it belongs with the
compiler's mode analysis (stage 1b), since both are static analyses of
folds.

**Approximate representations** break laws on purpose. Floats represent
reals, but `meaning(a ⊕ b) ≠ meaning(a) + meaning(b)` exactly. So a
representation can be marked approximate, its laws are tested with a
tolerance, and the chooser never picks an approximate representation for a
type the program declared exact. Today's `Number` is the real numbers
represented approximately by float64. That stays the default for decimals,
and now it's said out loud.

### Costs and the chooser

Each representation lists the cost of each job, on a ladder: `1`,
`log n`, `log² n`, `n`, `n log n`, `n²`, where n is the number (or the
length, for lists). The chooser finds the jobs a program uses (following
calls, but not into a function a representation replaces) and picks the
representation whose worst job is cheapest, then the cheapest in total,
then the smallest in space.

That's deliberately simple, and it's honest about what's declared. The
roadmap replaces declared costs with worked-out ones:

- **Costs of folds can be computed.** No loops means total code is folds
  and checked structural recursion. A fold costs (size of the value) ×
  (cost of the case bodies). The size depends on the representation: unary
  n has n nodes, binary n has log n. So the cost of `add` (one fold over
  `a`) is `n` in unary, and `add′` (structural recursion over the bits) is
  `log n`. This is the resource-analysis line of work (RAML, Hoffmann et
  al.), made easy by having folds instead of loops.
- **Declared costs get checked.** A benchmark harness runs each job at
  growing sizes and fits the exponent, so a wrong declaration fails a
  test, like a wrong law.

**Where the choice lives.** Per program, in a side table, like the
style of view. The default is the chooser's pick, and the editor shows the
cost table and lets you override it. Later, per value flow instead of per
type: one part of a program might keep a number in unary because it only
ever counts down from 3, while another needs binary. Conversions at the
boundaries have costs too, which makes this a small optimization problem
over the data-flow graph. The coarse version comes first.

### Folds run the way their value is stored

The compiler makes one decision on its own today: a `fold` without
`Choice` becomes a loop (a spine array for lists and other chains, an
explicit stack for trees, `parts` for trees nested in containers;
COMPILER.md, "Folds are loops"). That is the stackless half of the
Peano problem, and it was built as a special case in the code generator.
It belongs in the representation table, because *how a fold runs is a job
of the representation*, like `add` or `match`. The loop the compiler makes
today is the fold of one particular representation: objects linked by
fields, which is the definition stored as it is written. Call it `cells`.

Other representations run the same fold differently:

| representation | of | stored as | `meaning` | its `fold` runs as | |
|---|---|---|---|---|---|
| `cells` | any data type | one object per case | itself | spine loop (chains), explicit stack (trees), `parts` (nested) | today's loops |
| `text` | `List Text` of single characters | a JS string | `characters` | one pass over the code points, from the end | built |
| `counted` | `List Number` from `range` | a number n | `range` | a counted loop from n − 1 down to 0 | built (`range` and Int `range`) |
| `binary` | `Nat` | `Binary` | `meaning` (a definition) | `fold Nat′` (a definition) | PR #30, whole program |
| `int` | `Nat` | an `Int` | `natural` (a definition) | `fold Nat (Int)` (a definition): a fold over `range(n)`, so a counted loop | built, whole program |
| `array` | `List a` | a JS array | `items` | an index loop | later |
| `build` | `List a` | a function of `cons` and `nil` | `build` | apply it | later |

**The rule is the law read backwards.** Every representation promises
`meaning(fold′(x)) = fold(meaning(x))`, and for a fold, whose result isn't
in T, simply `fold′(x) = fold(meaning(x))`. So wherever a fold's input is
*made by* a representation's `meaning`, the fold can run on the
representation instead, and the structure in between is never built:

```
fold characters(line)          the definition: a list of one-character texts,
  nil → …                       then a spine array, then the loop
  cons(c) with after → …

text′s fold of line            the same arms, run on the string's code points
                                from the end: no list, no array
```

That is **deforestation** (Wadler, 1990), in the form GHC uses, **short-cut
fusion** (Gill, Launchbury and Peyton Jones, *A short cut to
deforestation*, 1993): `foldr k z (build g) = g k z`. In this table,
`build` is the `meaning` of the `build` representation (a list stored as
the function that folds it, Church's encoding), and the foldr/build rule is
its fold job. Stream fusion (Coutts, Leshchinskiy and Stewart, 2007) is
another row of the same table, with a step function as the storage. None
of them needs a rule of its own: each is a representation, and fusion is
what choosing it for one value means.

**Chosen per value, not per type.** The chooser of PR #30 picks one
representation per type for the whole program. Fusion picks one for a
single value: in calc's `tokens`, the `characters(line)` that is folded is
`text`, and every other list in calc stays `cells`. This is the simplest
case of "choice per value flow" (roadmap stage 7): a value made by a
`meaning` and consumed once, by the fold it is made for, so there is no
conversion at any boundary. The conditions are:

1. The fold has no `Choice` (as today; a fold with `Choice` is a generator).
2. Each arm uses a recursive field only through its folded result. An arm
   that reads the raw rest of the list needs that rest as a list, which
   `text` doesn't have without building it. (Later, the representation can
   provide it as `meaning` of a slice, built only when read.)
3. The producer is pure (`characters` and `range` are).

**Where it lives.** The table is in `src/lang/represent.ts`, next to the
user representations. A builtin row names its jobs by template (`"loop"`,
`"text.reverse"`) instead of by definition, because its code is a loop in
the target language, not a definition in this one. `foldPlan(code, fold)`
returns which representation runs a fold and on what. The compiler keeps
one emitter per template and no longer decides how a fold runs, so the
next backends ask the same question: in WGSL, `fold(range(n))` becomes a
GPU loop through the `counted` row, with no list to store. A
representation whose fold is a definition (`binary`) takes the code → code
route that `represent` already has: `fold(meaning(x))` becomes a call of
`fold Nat′` on `x`, for that one value.

**What makes it correct.** The evaluator keeps running the definition,
building the list. The compiled program runs the representation. So the
differential tests (evaluator against compiled, for every example) are the
law tests for each row, and each row gets its own cases at its edges: empty
text, characters outside the basic plane, `range(0)`.

**Steps**, each its own PR, measured on calc where it applies:

1. The table and `foldPlan`, with `cells` as the only row, and the compiler
   asking it. The compiled output doesn't change.
2. `text`: a fold over `characters(t)`. This is the fusion GAPS.md G7
   left for here; the measure is calc's tokenizer. **Done**: the fold in
   calc's `tokens` runs on the line, with no list of characters and no
   spine array. Compiled calc on 4,000 lines went from about 35 ms to
   about 31 ms (best of 40 runs, the ideal takes about 21 ms). The rest
   of the tokenizer's cost is the token list it builds and `keep`'s second
   one, which is the `build` row's job.
3. `counted`: a fold over `range(n)`. **Done**, for `range` on Number
   and on Int, without `Choice`. `queens` folds over `range` with
   `Choice`, which is a generator and still builds the list; a fold with
   `Choice` asking the table too is a later step.
4. User representations per value: `fold(meaning(x))` → `fold′(x)` when
   `meaning` is a definition, tested on `binary`.
5. Later, when a program needs them: `build` for user functions that make
   a list from `cons` and `nil` (so `keep` over a list made by a fold runs
   in one pass), and `array`.

**Peano `Nat` stored as an `Int` (done).** This one needs no template. It
is a representation written in the language, in `examples/numbers` next
to `binary`, and chosen for the whole program by the chooser of PR #30:

```
natural(i) =                          ← meaning: Int → Nat
  fold range(i)
    nil → zero
    cons(j, rest) with r → succ(r)

‹fold Nat (Int)›(n, ‹if zero›, ‹if succ›) =
  fold range(n)
    nil → ‹if zero›()
    cons(i, rest) with r → ‹if succ›(n − 1 − i, r)
```

`zero` is `0`, `succ` adds one, `match` tests for 0, and `add` and
`multiply` are Int's own. Both definitions are folds, so the checker proves
them total, unlike a recursion that counts down. A fold over a Nat calls
`fold Nat (Int)`, whose fold over `range(n)` the compiler runs on n
(`counted`, above), so the control (a loop) and the data (an Int) come
from one entry in the table. The program still says `zero` and `succ`.
The chooser now picks `int` for `numbers`' `main` (its `number` job is 1,
against binary's log n). `main` (18!, 2⁵⁰, is 100 even) takes about 6 ms
evaluated, against about 13 to 45 ms on binary, and about 0.03 ms compiled,
against 0.09 ms. `lab run` and `lab compile` still run the definition, so
choosing a representation there is the next step for this row.

## Number systems, one by one

Each row is a meaning, written as ordinary definitions in std, and the
representations behind it. "Backwards" is what running the arithmetic
backwards gives in that system, which differs a lot: over the reals an
equation has a continuum of answers and the solver finds closed forms or
isolated roots; over the integers the answers can be listed.

| system | meaning (the definition) | representations | backwards |
|---|---|---|---|
| **Nat** | `zero \| succ(Nat)` | binary (above); JS integer when range analysis shows it fits; BigInt otherwise | unification on Peano, which is simple but linear; on binary, Kiselyov et al.'s relational arithmetic (2008), which uses the same little-endian bits for exactly this reason. `x · y = 12` lists factorizations |
| **Int** | `from(Nat) \| ‹minus one minus›(Nat)` (Lean's, one spelling per integer) | JS integer / BigInt, with the small-integer fast path every Lisp has | listing for bounded unknowns; linear Diophantine equations solved exactly |
| **Rational** | pair of Int and positive Nat, up to `ad = bc` | lowest-terms pair of BigInts (canonical); finite continued fraction | linear elimination is already exact over rationals in the solver |
| **Real** | the limit of a sequence of rationals (a computable real) | float64 (approximate, the default); lazy continued fraction; interval arithmetic | the existing solver; on exact reals, each step of root isolation is `Diverge` |
| **Continued fraction** | `end \| term(whole: Int, rest: () → CF)` | itself; Gosper's arithmetic works on it directly | `x = [1; 2, 2, …]` is a fixed point: `x = 1 + 1/(1 + x)` solved by the solver |
| **Complex, split-complex, dual, quaternion** | elements of `Cl(0,1)`, `Cl(1,0)`, `Cl(0,0,1)`, even part of `Cl(3,0)` | see Clifford below | the product is bilinear, so `a · x = b` is a linear block |
| **Vectors, matrices, tensors** | a function from index to scalar, with a shape | dense, strided, diagonal, sparse, identity, broadcast | linear equations; shapes are inferred |
| **List** | `nil \| cons(a, List a)` | cons cells (the definition); array; rope or finger tree | unification, as now |

Three decisions in that table deserve to be said plainly:

- **Integers never overflow.** `Int` is unbounded by definition. A machine
  integer is a representation, chosen where range analysis proves it fits,
  with BigInt as the fallback. Overflow joins the error table as
  "impossible by construction".
- **Exactness is a meaning, floats are a representation.** `Rational` and
  `Real` are different meanings. `1/3` is a Rational until something makes
  it irrational. Mixing them goes through an explicit conversion, which
  the palette offers.
- **List is in this table.** Lists are the same problem as Nat (a Peano
  list is a unary number with labels), so they get the same treatment:
  `index`, `length`, `append` and `split` are jobs with costs, and arrays
  and ropes are representations. Code that conses and matches keeps
  working on all of them.

### Infinite continued fractions, and data that goes on forever

A continued fraction is `a₀ + 1/(a₁ + 1/(a₂ + …))`, written `[a₀; a₁, a₂, …]`.
Finite ones are exactly the rationals. Infinite ones are the irrationals,
and many have patterns: `√2 = [1; 2, 2, 2, …]`, the golden ratio is
`[1; 1, 1, …]`, `e = [2; 1, 2, 1, 1, 4, 1, 1, 6, …]`.

**Update (2026-10-22): this is built, with an effect instead of a
function field.** A field of type `() → CF` would compute the rest every
time it is called (call-by-name), so a number used twice, like `x` in
`x + x` or `√2` in `√2 · √2`, would compute its terms twice, and Gosper's
algorithm on shared inputs gets exponential. What's wanted is call-by-need:
computed once, on demand. That needs a place to keep the result, which is
state, which is an effect. The Cells effect (LANGUAGE.md, "Cells") is that
place, and the same handler is Solid.js-style reactivity:

```
type CF
  | end
  | term(whole: Int, rest: Cell CF)

‹root terms›(n, a0, m, d, a) = term(a, formula(() => … root terms(n, a0, m′, d′, a′)))
```

`formula` doesn't run its action; the first `read` of the cell does, and
later reads get the remembered value. A rest that depends on a cell the
page can write (`√n` with `n` on a slider) is recomputed when `n` changes,
so lazy numbers are also reactive ones. The original plan, kept for the
record:

The language has no lazy data today. The plan adds none as a node kind: a
field can hold a function, so "the rest, when you ask" is a field of type
`() → CF`:

```
type CF
  | end
  | term(whole: Int, rest: () → CF)

‹root two› = term(1, () => twos)
twos = term(2, () => twos)
```

Two things follow:

- **The checker needs the other half of totality.** A fold over a `CF`
  might never end, and the checker already says so (`Diverge`). Producing
  one is fine as long as each step makes a term before recursing:
  *guarded corecursion*, the dual of the structural check `infer.ts`
  already does. Code that produces infinite data productively gets no
  effect; consuming all of it gets `Diverge`, and `with fuel` turns that
  into `Choice`. No new mechanism.
- **Arithmetic is Gosper's algorithm** (1972): `x + y`, `x · y` and any
  `(axy + bx + cy + d)/(exy + fx + gy + h)` consume terms of the inputs and
  produce terms of the result, lazily, as ordinary definitions over `CF`.
  This makes `CF` a representation of the exact reals.

**Comparisons might never finish.** Is `√2 · √2` less than 2? Both
continued fractions agree on every term you look at. Equality of exact
reals is undecidable, so `less` on them has `Diverge` in its type, and a
caller handles it with `with fuel` like Newton's method. The effect system
reports something true about the mathematics that floating point quietly
hides.

### Clifford algebras: one library instead of four types

A Clifford (geometric) algebra `Cl(p, q, r)` has n = p + q + r basis
vectors `e₁ … eₙ`, of which p square to +1, q to −1 and r to 0. Its elements
(multivectors) are sums of *blades*, products of distinct basis vectors,
so there are 2ⁿ coefficients. Everything people use is one of these:

| algebra | what it is | elements used |
|---|---|---|
| `Cl(0, 1)` | complex numbers, `i = e₁` | all |
| `Cl(1, 0)` | split-complex (hyperbolic) numbers, `j² = +1` | all |
| `Cl(0, 0, 1)` | dual numbers, `ε² = 0`: forward-mode derivatives | all |
| `Cl(0, 2)` | quaternions | all |
| even part of `Cl(3, 0)` | quaternions again, as 3D rotors | grades 0 and 2 |
| `Cl(3, 0)` | 3D vectors, with the cross product as a bivector | grade 1 for vectors |
| `Cl(3, 0, 1)` | projective geometric algebra: rotations and translations in one | motors |
| `Cl(4, 1)` | conformal geometric algebra: circles and spheres are elements | any |

**One library, written in the language.** A blade is a set of basis
vectors (a bitmask). The geometric product of two blades is their
symmetric difference, times a sign from reordering (count the swaps) and
the squares of the shared vectors from the signature. That's a few short
definitions, and the full product is a fold over the blades of each side.
The algebra is a value (`algebra(p, q, r)`, a record of its operations),
and its element type is `Multivector A`, where `A` is the def that
created the algebra. Mixing a `Cl(3, 0)` element with a `Cl(0, 2)` one is
a type error, with nothing new in the type system: `A` is an ordinary
type constant.

**Quaternions are a representation.** A rotor in 3D has only grades 0 and
2: four coefficients out of eight. Its meaning is a multivector, and the
representation stores the four that can be nonzero, so the product of two
rotors is the Hamilton product, sixteen multiplications. The same goes
for complex numbers as the even part of `Cl(2, 0)`, and for every
"vectors only" or "bivectors only" value. So the chooser picks dense
2ⁿ storage, a grade-restricted one, or a sparse map, from which grades
the program can produce. Grades can be inferred like units: the product of
two grade-1 values has grades {0, 2}. That inference is the units
machinery in `src/units.ts` again, with sets of grades instead of
exponent vectors.

**Running backwards.** The geometric product is linear in each side. With
`a` known, `a · x = b` is a square linear block of 2ⁿ equations, and the
solver eliminates it, so division by a multivector (where it exists) needs
no definition: it is multiplication run backwards. Where `a` has no
inverse (a null vector), the block is singular and the solver says
"underdetermined", which is the right answer.

**Derivatives.** Each Clifford operation is built from scalar `+` and `·`,
so `derive.ts` differentiates it through the chain rule like any other
function. The interesting reverse fact: dual numbers are themselves a
Clifford algebra, and running any function on them computes its
derivative. That gives `derivative` a second, independent implementation
to test the first against.

### Vectors, matrices and tensors

The **meaning** of a tensor is a function from an index to a scalar, plus a
shape. So `transpose` is "swap the index", which costs nothing in meaning,
and a representation decides whether it costs anything at run time.

- **One operation.** Contraction over named indices (`einsum`) plus
  elementwise map covers matrix product, trace, dot and outer products,
  batched anything, and transposes. The library is that one operation and
  conveniences that call it, not forty special functions.
- **Representations:** dense row-major, strided (so transpose and slicing
  are free), diagonal, sparse, identity, broadcast (a scalar or vector
  pretending to be bigger). The chooser picks from the jobs, as above; a
  diagonal times a dense matrix is one multiplication per element.
- **Shapes are inferred.** Each axis length is an unknown, and operations
  give equations between them (matrix product: inner lengths equal). Those
  are linear equations over integers, which is what `units.ts` already
  solves for dimension vectors. A shape mismatch becomes a type error the
  editor prevents, the way it prevents a unit mismatch.
- **Geometric vectors are not arrays.** A position in space is a grade-1
  element of `Cl(3, 0)`; a row of a dataset is a rank-1 tensor. Both store
  three numbers, but adding a position to a color is a mistake. Converting
  is an explicit `coordinates` function.

### `+` for every number system: names are presentation

The language has no type classes, and the plan doesn't add any. Two
observations make them unnecessary:

1. **Overloading is a display matter.** References are ids picked from a
   palette. `+` on rationals and `+` on multivectors are different
   definitions, and both can be *displayed* as `+`. The palette offers the
   one whose type fits the hole (it already filters by type). Ambiguity
   never reaches the program, because the program stores the id.
2. **Generic code takes its operations as an argument.** `sum of(list,
   ring)` takes a record `ring(zero, add, multiply)`. When you call it, the
   editor fills the `ring` argument if exactly one known record fits the
   types, and hides it in the view. This is Agda's instance arguments or
   Scala's implicits, resolved once at edit time and stored as an ordinary
   argument. So there are no resolution rules at run time and nothing to
   go wrong silently.

A ring record is also a meaning with representations, so this composes:
`sum of` on binary naturals is `sum of` with the Nat ring, rewritten onto
binary.

### Units

Units become a type index on any number system: `Rational m`,
`Multivector Cl3 m/s`. The dimension vectors in `src/units.ts` stay as they
are, and the typed core's `Number` gains them as a parameter (the "units as
a type parameter" item in LANGUAGE.md). Clifford coefficients share one
unit per multivector, except that grades can carry different units in
physics (`Cl(3, 0)` electromagnetism). That's a later refinement, and the
plan doesn't depend on it.

## How this meets the rest of the language

- **Running backwards** (`relate.ts`). The domain decides what backwards
  means. Reals: the solver, as now. Integers and naturals: answers can be
  listed, so unification and enumeration, which on binary is
  Kiselyov's relational arithmetic. Rationals: the solver's elimination is
  already exact. Multivectors: linear blocks. Continued fractions: lazily,
  term by term. A representation can also make backwards *faster*: `x + y =
  1000` over Peano naturals takes a thousand unification steps per answer;
  over binary, ten.
- **Derivatives** (`derive.ts`). Unchanged for the code it handles today.
  Representations that are approximate (float) or exact (CF) of the same
  real function have the same derivative, since `derive.ts` works on the
  meaning. Dual numbers give a second implementation to test against.
- **The compiler.** Choosing a representation is a code → code pass before
  code generation, which is how `COMPILER.md` already treats program
  transformations. Nothing new in the code generator: the rewritten
  program compiles as it is (`compiler/test/represent.test.ts`). Builtin
  representations (JS numbers, BigInt, typed arrays) are where the compiler
  needs new templates.
- **The editor.** A representation picker per type, showing the cost table.
  Any definition can be opened in any representation, which is the
  rewritten view (`factorial` on `Binary` above), read-only, because the
  program is the definition.

## Roadmap

In order. Each stage says when to start it.

| stage | what | start when |
|---|---|---|
| 0 | representations as side tables; `represent` (code → code) and `choose` (declared costs); laws as tests; Peano Nat with binary (this PR) | done |
| 1 | **Builtin representations and real integers.** Nat and Int in std as definitions, represented by JS integers with a BigInt fallback; Nat literals; Rational as lowest-terms pairs; the compiler's templates for them; integer overflow joins the error table as impossible | **partly done**: `Int` is a builtin type with JS number / BigInt values, literals, operations, compiler templates, and overflow is in the error table as impossible (LANGUAGE.md). Still to do: Int's definition as data (match and fold on it as a view), Nat, Rational |
| 2 | **Overloading by name.** Several defs displayed as `+`, the palette picks by type; operation records as arguments the editor fills | with stage 1, since Int and Rational need `+` |
| 3 | **Lists as arrays and ropes.** `length`, `index`, `append`, `split` as jobs; array and rope representations; the editor's representation picker | a program in the editor is slow because of list length or indexing |
| 4 | **Clifford algebras.** The library in the language; complex, dual, quaternion as named algebras; grade-restricted representations, with quaternions as the rotor representation; division as the product run backwards | after 2 (it needs `·` on multivectors to be the same `·`) |
| 5 | **Infinite data.** ~~Function-typed fields as lazy data~~ `Cell` fields as lazy, remembered data (done, the Cells effect); guarded corecursion in the checker; ~~continued fractions with Gosper's arithmetic~~ (done as a program: `+ − × ÷` of two CFs, √n, e, rationals); exact reals as a representation of `Real`, with `Diverge` comparisons | **partly done**; the rest when anyone wants an exact real as a number type, or a stream |
| 6 | **Tensors.** Contraction + map, the representations above, shape inference on the units machinery | a numeric example needs a matrix bigger than 3 × 3 |
| 7 | **Costs worked out, laws proved.** Cost inference from folds and representation sizes, checked by fitted benchmarks; laws for folds proved by fusion; choice per value flow, with conversion costs | the declared costs turn out wrong, or a program needs two representations of one type |
| 8 | **Dual numbers as a second `derivative`**, to test `derive.ts` against | with stage 4 |

## What's still rough

- **The rewrite can lose a totality proof.** `is even` is structural on
  Nat, but after the rewrite its recursion goes through `match Nat′`'s
  function argument, and the checker gives it `Diverge`. The meaning is
  total, and the laws make the rewrite correct, so the compiler should keep
  the effects of the original. For now the rewritten program's type is
  less precise than it should be.
- ~~**The evaluator recurses on the JS stack.**~~ Fixed: the evaluator is
  now a machine with its continuation on the heap (LANGUAGE.md, "How it
  runs"), so `is even` of any size runs.
- **One representation per type, per program**, as said above.
- **Costs are declared.** Stage 7 makes them checked, then computed.
- **Representation rewrites inside a user's own types** (a record with a
  Nat field) rewrite the field's type, but nothing tests it yet.

## Files

```
NUMBERS.md                        this plan
src/lang/represent.ts             Representation, represent() (the rewrite), choose() (the chooser)
src/lang/numbers-demo.ts          npm run numbers
examples/numbers/                 the example as code.json + names + comments + representations.json
test/numbers.test.ts              laws, the rewrite, encoding by running meaning backwards
../compiler/test/represent.test.ts the rewritten program compiles and agrees with the evaluator
```

## Prior art

- **Abstraction functions and data refinement**: Hoare, "Proof of
  correctness of data representations" (1972). The law here is his.
- **Views**: Wadler (1987), pattern matching on an abstract type through a
  representation. `match Nat′` is one.
- **Relational binary arithmetic**: Kiselyov, Byrd, Friedman, Shan, "Pure,
  declarative, and constructive arithmetic relations" (2008).
- **Exact real arithmetic with continued fractions**: Gosper (HAKMEM,
  1972); Vuillemin (1990).
- **Geometric algebra**: Hestenes; Dorst, Fontijne, Mann, *Geometric Algebra
  for Computer Science*; Gunn and De Keninck on projective GA.
- **Implicit arguments**: Agda's instance arguments, Scala's implicits,
  here resolved at edit time.
- **Resource analysis**: Hoffmann, Aehlig, Hofmann, RAML (automatic
  amortized resource analysis).
- **Deforestation and fusion**: Wadler, "Deforestation: transforming
  programs to eliminate trees" (1990); Gill, Launchbury, Peyton Jones, "A
  short cut to deforestation" (1993), the foldr/build rule; Coutts,
  Leshchinskiy, Stewart, "Stream fusion" (2007). Here each is a
  representation, and fusion is choosing one for a single value.
- **Transport between representations**: the univalence idea in homotopy
  type theory, of which this is the practical, tested version.
