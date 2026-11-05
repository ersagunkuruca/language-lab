# Which parts of a multivector can be nonzero (design note, 2026-10-31)

**Status (2026-10-31).** BACKLOG L43 ("grade inference"), from
CLIFFORD-DEMOS-2026-10-31 B3. L43b is built: `src/lang/grades.ts`
(`bladeMask`, `describeMask`), for algebras a definition writes down,
with a function's inputs every part unless the caller gives masks.
Bounce's algebra arrives inside a `Space`, so it needs the per-space
copies stage.ts makes (I86) before masks reach it. L43c to L43e are on
the row. Ersagun answered the question at the end (2026-10-31): a wrong
grade is a type error, each blade combination its own type. L43e's first
step is built: `lab check` refuses reading a part a value can't have
(`gradeMistakes` in grades.ts), since that part is always 0.

## The problem

In Bounce a position, a spin and a rotor are all `Solid`, the whole
8-part multivector of `Cl(3, 0)`. A position needs 3 of the 8 parts and a
rotor 4, so every vector carries 5 zeros, and every product multiplies
them. Nothing stops a rotor going where a vector goes either, but that
is the smaller half: the program is right, it is only slow.

## Why not units

The row said "on the units machinery", and units.ts was the first place
to look. It doesn't fit. A unit is a vector of exponents, and every rule
is linear (a product adds exponents), so inference is solving linear
equations. Grades aren't linear: a vector times a vector is a scalar plus
a bivector, so the answer is a set, and `+` takes a union. That is
abstract interpretation over a finite lattice, not a linear system.

## The idea: a blade mask per value, inferred

For an algebra known before running (`clifford algebra(squares, basis)`
on literals, which stage.ts already evaluates, C65), each value of the
algebra's type gets a **blade mask**: the set of blades its part can be
nonzero on. There are 2ⁿ blades, so for the algebras the demos use
(n ≤ 5) a mask is one 32-bit number. It is finer than grades, and
exactly as cheap.

| expression | its mask |
|---|---|
| a literal or a record built by position | the positions not written as the literal 0 |
| `a + b`, `a − b` | mask(a) ∪ mask(b) |
| `s · a`, `−a` for a number s | mask(a) |
| `clifford product(al, a, b)` | every blade of `i · j` for i in mask(a), j in mask(b) whose table entry isn't 0 |
| `clifford reverse`, `involute`, `inverse` | mask(a) |
| `clifford exp(al, b)` | the closure of {1} ∪ mask(b) under products (a fixpoint: masks only grow, and there are 2ⁿ blades) |
| `clifford part`, `with part` (I81) | read: a number. With part: mask(x) ∪ {that blade} |
| a function's input | the union of what its callers give (whole-program, as stage.ts specialises) |
| a recursion or a fold | the fixpoint, starting from the empty mask |

Because the table is known, the product rule is exact, not an estimate
from grades: in PGA a product that would land on e₀e₀ = 0 drops out by
itself, which grade arithmetic alone can't see.

Each operation's table of masks is worked out from the blades and the
squares, as the prelude defines the operation: eₐ eᵦ lands on A Δ B and
is 0 when a vector both share squares to 0; the outer product keeps the
pairs with no vector in common, the inner product those with A inside B;
the dual is the complement. Working them out by running each operation
on the basis elements took 14 seconds on Spacetime's 16 parts; this
takes 0.2 (L43c's first step), and grades.test.ts checks both give the
same tables.

In Bounce a position would come out as {e₁, e₂, e₃} and a rotor as {1,
e₁₂, e₁₃, e₂₃}; a rotor times a position as {e₁, e₂, e₃, e₁₂₃}, and the
whole sandwich R x R̃ back as {e₁, e₂, e₃} only if the rule knows R R̃ is
a scalar, which a mask alone doesn't. So L43b also needs one rule for the
sandwich: `clifford sandwich(al, r, x)` gives the blades of mask(x)'s
grades when r is a versor, as a versor's action keeps grades. With up to three
basis vectors every even element is one (a scaled rotor); beyond that the
rule falls back to the product rule.

## What uses it

1. **The compiler stores only the masked parts.** A value whose mask is
   {e₁, e₂, e₃} is three numbers, and a product of two masked values is
   the products of the masked pairs only, zero terms dropped. That is
   L41's expansion with masks as its input, and it is a representation
   the compiler chooses, as Ersagun asked: nothing to write, nothing to
   select (L108). This is where the 4-of-8 saving comes from.
2. **The editor says what a value is.** Hovering a value of an algebra's
   type shows its mask in words: "a vector", "a rotor (even)", "a point"
   when the algebra names its blades, otherwise the blades.
3. **A check: masks are types** (Ersagun's answer below). A wrong grade
   is a type error.

## Steps

| step | what | lane | size |
|---|---|---|---|
| L43b | `src/lang/grades.ts`: blade masks over a program whose algebras are known before running, the table above; tested on Bounce, Constructions and Spacetime | L | M |
| L43c | Compiled JS (then WGSL) stores and multiplies only the masked parts, with L41 (built so far: the mask tables from the blades, #942; staging multiplies only the masked parts, see "In the compiler" below; next, storing only them) | C | M |
| L43d | The editor shows a value's mask in words | E | S |
| L43e | Masks are types (built: a part read outside a value's mask is refused by `lab check`; named masks `Scalar of`, `Vector of`, `Bivector of`, `Trivector of` and `Rotor of` on record fields, checked where a value is put in and known where it is read): named masks (`Vector of`, `Rotor of`, ...) in std, checked where a definition or a field names one, and a part read outside a value's mask refused (Ersagun's answer) | L | M |

## Any library's algebra (L203, plan 2026-11-05)

Today the reading knows the prelude's Clifford operations by id (or, since
L203a, by their meaning's hash), and an algebra by std's `Algebra`
constructor. A library of its own, written differently, gets every part.
What the operations share is not their names but one mechanism: each
bilinear one is `table product(T, a, b)` over a table T of lines
`times(e, f, g)` (the structure constants), and the linear ones are folds
over the algebra's known blades. So the general reading follows the code
through known data:

1. **Known values.** A new kind of reading result, a value known before
   running: a definition with no inputs that runs (stage.ts already
   evaluates such tables, C65), a literal, a record of known parts, and a
   field of a known record (`parts(al, …)` taking an algebra apart). A
   call whose inputs are all known runs (pure only), so `clifford table
   where(squares, basis, wanted)` is a known table too.
2. **`table product` with a known table.** mask(table product(T, a, b))
   is the union of nz(g) over T's lines (e, f, g) where mask(a) meets
   nz(e) and mask(b) meets nz(f), nz being a known record's nonzero
   parts. That is the product rule above, read from the table instead of
   from the blades, and it covers the product, the outer and inner
   products, the sandwich and the reflection without their names. Each
   table's pair masks are worked out once, by the table's identity.
3. **Folds over known lists.** A fold over a known list is read line by
   line, each item known, the results joined (reverse, involute, dual and
   anything a library writes the same way). An unknown list stays as
   today (the fixpoint over its item).
4. **Masks per record, not per algebra.** A mask is over a record of
   Float64s' parts; blades and grades are needed only by named masks and
   the sandwich's grade rule, which stay with an algebra the program
   writes down. A library without one still gets its products' masks,
   and the sandwich falls back to the product rule (wider, still sound).

Every rule over-approximates, so a mask is still never too small, and
grades.test.ts's tables stay the check: the general reading must give the
same masks as the named one on Bounce, Constructions and Spacetime before
the names go. Step 4 retires `CL`.

**L203b, built (steps 1 to 3).** grades.ts reads a value known before
running (`known`): the algebra's own value, taken apart by a match, and a
definition's value that runs when a match or a fold takes it apart. A
match on known data runs only its case's arm, and a fold over known data
reads each case with its fields known and its recursive fields' results
folded first, so a table's lines are read one by one. `zip parts` with ·
(a zero on either side gives zero) keeps the parts both have, `map parts`
of a function that zeroes any part (a weight known to be 0) keeps none,
and `total` is zero when no part is on. So a product a program writes
itself, its own fold over the algebra's table, has the prelude's masks
(grades.test.ts); step 2's rule comes out of reading `table product`'s
own code, with no name for it. The prelude's operations are still read by
their names (faster); step 4 is left.

**L203c, built (step 4, first half).** The geometric, outer and inner
products, the reverse and the involution are read from their own code,
not by name. The outer and inner products build their table with
`clifford table where(squares, basis, wanted)`, so the reading runs a
call when every input is known (a function written in place counts when
it reads nothing around it), the callee's type says it is pure, and it
isn't one that may not stop; the table is then known and step 2's fold
reads it. A call's inputs are read once, and a library call given no
function is kept by what its inputs are, so reading through the code is
faster than the names were (Constructions' masks 894 ms to 192 ms).
Bounce, Spacetime and Constructions compile to the same JavaScript.
Still read by name: the duals, the regressive product and the versor
inverse, whose code finds a blade's element in the known list or checks
a number, which the reading doesn't follow yet (it gives every part in
PGA); and, because their rules are sharper than their code, the sandwich
and the reflection (they keep grades, a cancellation a fold over the
table can't see), the projection, the exponential (a closure under the
product) and `part` and `with part` (a blade from literal vectors). Left
of step 4: those, and masks over any record of Float64s, for a library
with no `Algebra`.

## In the compiler (L43c)

`valueMasks` (grades.ts) works out each definition's input masks from all
of its callers, to a fixed point, with one summary per definition: a
definition called from outside (an export) or used as a value has inputs
of every part, as does one called from inside a lambda handed on or from
a place the reading didn't reach. Then each node a definition reads gets
the union of what it was each time.

The compiler passes the exports to `stageProgram`, and a multivector
arriving later at a staged call (stage.ts `later`) has a known 0 in each
part outside its mask, so the products drop those terms. The PGA fixture's
`moved n times`, given only points, sandwiches with 32 products instead of
96 (compiler/test/stage.test.ts); Spacetime's compiled program has 2656
instead of 3168. The masks are those of the program as given; the copies
staging makes for data known at a call (I86) don't have them yet, which
is what Bounce needs.

Shaders too (scalar.ts gives its roots as the open definitions): the
GPU version of the same fixture has 32 products in its WGSL instead of
96. Only what the open definitions reach counts, so a definition no one
runs widens nothing.

Still to do: storing only the masked parts (a record per mask, a smaller
struct on the GPU).

## Ersagun's answer: each blade combination is its own type

The question was "should a wrong grade be a type error?", with two
options: masks inferred only, or declared masks checked. Ersagun
(2026-10-31): "I think we need to make each blade combination a different
type and make each operation between them keep track of the correct
types. That's the only solution I can think of that would get rid of the
bivector vs vector confusion."

That is the blade mask, made a type. A mask is the set of blades a value
can be nonzero on, so "each blade combination a different type" is one
type per mask, and the table above is how each operation keeps track of
it (vector · vector is scalar + bivector; a rotor's sandwich keeps a
vector a vector). The compiler infers it, so nothing has to be written
(Ersagun's "the compiler chooses", L108), and it is checked:

- **Where a mask is named.** std gains named masks over an algebra's
  type, `Vector of space`, `Bivector of space`, `Rotor of space` (the
  even part), and an algebra can name its own (`Point` in PGA). A
  definition's input, a record's field or a list's items written with
  one refuse a value whose inferred mask isn't inside it: a rotor where a
  `Vector of space` goes is a type error, with both masks in words.
- **Where a part is read.** `clifford part(e₁₂, x)` when x's mask has no
  e₁₂ is always 0, so it is refused as a mistake.
- **Not on mixing.** Adding a vector and a bivector is meaningful in the
  algebra (a product of two vectors is exactly that), so `+` gives the
  union and stays allowed. What can't happen any more is that mixed value
  silently going where a vector was named.

On the GPU each mask becomes its own struct with only its parts: a
Cl(3, 0) vector is a `vec3`, a bivector a different struct of three, a
rotor four, and a product of two masked values computes only the pairs
whose table entry isn't 0 (L43c with L41). Zero parts are never stored
or multiplied, which is where the 4-of-8 saving comes from.

## Prior art

- Gaalop (Dietmar Hildenbrand's Geometric Algebra Algorithms Optimizer)
  works out symbolically which blades of each result can be nonzero and
  generates code for those only. This note is that, done by the
  language's own checker.
- Versor (Pablo Colapinto) and Garamon (Breuils, Nozick and Fuchs) carry
  blade lists as compile-time types in C++, and klein (Jeremy Ong) has a
  type per PGA grade.
- ganja.js (Steven De Keninck) generates its products from the table, as
  `clifford algebra` does.
- Abstract interpretation over a finite lattice (Cousot and Cousot, POPL
  1977) for the fixpoints.
