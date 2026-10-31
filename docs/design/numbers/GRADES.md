# Which parts of a multivector can be nonzero (design note, 2026-10-31)

**Status (2026-10-31).** BACKLOG L43 ("grade inference"), from
CLIFFORD-DEMOS-2026-10-31 B3. L43b is built: `src/lang/grades.ts`
(`bladeMask`, `describeMask`), for algebras a definition writes down,
with a function's inputs every part unless the caller gives masks.
Bounce's algebra arrives inside a `Space`, so it needs the per-space
copies stage.ts makes (I86) before masks reach it. L43c to L43e are on
the row. Ersagun answered the question at the end (2026-10-31): a wrong
grade is a type error, each blade combination its own type.

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
| L43c | Compiled JS (then WGSL) stores and multiplies only the masked parts, with L41 | C | M |
| L43d | The editor shows a value's mask in words | E | S |
| L43e | Masks are types: named masks (`Vector of`, `Rotor of`, ...) in std, checked where a definition or a field names one, and a part read outside a value's mask refused (Ersagun's answer) | L | M |

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
