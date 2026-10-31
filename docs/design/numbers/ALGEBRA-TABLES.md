# A type's `·` from a table (design note, 2026-10-26)

BACKLOG L40b, from LANGUAGE-REVIEW-2026-10-24 "The one idea: a type's
arithmetic is an algebra, and an algebra is a table". This note says how it
would be written in the language, and puts one question to Ersagun first,
because the answer changes more than tables.

**Status (2026-10-30).** Answered and built: Ersagun chose interfaces
(INTERFACES.md, L40h), tables are std `Table` with the prelude's
`table product` (L40d), and quaternions and `Cl(p, q, r)` are tables
(L42a, L43a). Geometry on top of them, rotors from `clifford exp`,
reflections, projections and PGA motors, is L44b (MATRICES.md layer 2).
The outer product, the left contraction, grade selection, the dual by
complement and the regressive product are I89, each a table with lines
left out or a reweighing of the blades.
Open: table products expanded at compile time (L41).

## The idea, briefly

Complex numbers, dual numbers, quaternions, Clifford algebras and square
matrices are all a record of a few numbers with a product that is fixed by
how the basis elements multiply: `i · i = −1` for Complex, `ε · ε = 0` for
dual numbers, Hamilton's `i · j = k` and so on for quaternions. `+` and `−`
are part by part, which records of Float64s already have. Only `·` needs
the table. So these are not five features. They are five tables given to
one library function.

## How a table is written: nothing new

A table is a list of lines, each saying what two basis elements multiply
to, written as values of the type itself (std.ts `Table entry`):

```
complex table = [times(1, 1, 1), times(1, i, i), times(i, 1, i), times(i, i, −1)]
```

and the product is a fold over it, written in the language (the prelude's
`table product`): the sum over the lines of a's part along the left
element, times b's part along the right one, times what they give. A part
along a basis element is the two records' parts multiplied pairwise and
added (`total(zip parts(·, a, e))`), which reads off a coordinate because
the basis is the records with one part 1. Because a line gives a whole
element, a product that is a sum of basis elements needs nothing more.

Dual numbers are the same with `ε · ε` left out (a zero product needs no
line), and quaternions are sixteen entries. `Cl(p, q, r)` is a definition
that builds the table from the signature (blades as bit masks, a sign from
counting swaps, as ganja.js does). Nothing here is a new node kind.

On the GPU a fold over a list doesn't lower today. Expanding it when the
table is known before the shader is compiled, and dropping the zero terms,
is L41 (with lane C, like the gradient's expansion in C9). Until then the
prelude's hand-written `multiply complex` stays what the GPU runs, and a
test checks it equals the table's product.

## The question: how does a type say what its `·` is?

**Answered (Ersagun, 2026-10-27):** by a separate implementation, found by
its type, resolved before running so it costs nothing. INTERFACES.md has
the design. Built in L40h: a type gives its `+ − · −x` with a definition
of type `Arithmetic T`, and the PRELUDE_AT list below is gone. The three
options below are kept as the question was asked.

Today arith.ts has a fixed list: at Rational and Complex, the generic
`+ − · −x <` are the prelude's `add fractions`, `multiply complex` and so
on (arith.ts PRELUDE_AT). A type you write yourself can't join. For tables
to be more than a prelude detail, a type has to be able to say "my `·` is
this". Three ways:

1. **A field on the type's definition (recommended).** The typedef node
   gets an optional entry, "its operations", naming the definitions that
   are its `+ − · −x <`. Then `times = table product(quaternion table)` and
   the quaternion type pointing at it makes `a · b` work on quaternions,
   and so does any other way of writing it: a polynomial type, intervals.
   PRELUDE_AT becomes Rational's and Complex's own entries. It is what
   Haskell's `instance Num` says, held by id, so renaming or translating a
   definition changes nothing. Cost: one more optional field on a node
   kind, and the editor needs a way to set it (lane E), the way it sets a
   field's type.

2. **By name in the type's module.** A type's `+ − ·` would be the
   definitions beside it called `plus`, `minus`, `times`, `negate` and
   `less`. Nothing new in the model, but it breaks a rule the project
   keeps: names are presentation (a side table the editor can rename or
   translate), and identity is the id. Renaming `times` would quietly
   change what `·` means.

3. **Prelude only.** Tables stay an internal way to write the prelude's
   number types (Complex, then dual numbers and quaternions). Smallest, but
   a programmer's own algebra (PGA for geometry, say) can't use `·`.

Whichever it is, a type's own operations come before the record rule: a
record of Float64s gets `·` part by part today, which is right for colours
and wrong for quaternions.

## What would be built, in order

1. The rule from the answer (for 1: an optional `ops` on typedef nodes,
   which the checker and arith.ts read; PRELUDE_AT becomes Rational's and
   Complex's entries).
2. `Table entry`, `table product`, and Complex's table in the prelude,
   tested against `multiply complex`, evaluated and compiled. **Built
   (L40d).**
3. Dual numbers as a table, tested against derive.ts's derivatives (L45).
4. Quaternions as a table, then `Cl(p, q, r)` (L42, L43). **Built** (L42
   step 1): the prelude's `clifford table(squares, basis)` builds the
   table in the language, with blades as lists of Bools, a −1 for each
   swap, and the shared vectors' squares. `[−1, −1]` is the quaternions,
   equal to Hamilton's product; `[−1]` is Complex, `[0]` Dual, `[1]`
   split-complex, `[1, 1, 1]` Cl(3, 0) and `[1, 1, 1, 0]` PGA. A
   quaternion record whose `arithmetic` uses the table gets the one `·`
   (test/clifford.test.ts). `clifford reverse(squares, basis, x)` is x̃,
   so a rotor R turns a vector v into R · v · R̃; Cl(3, 0)'s rotors
   1, e₂₃, e₁₃, e₁₂ multiply as the quaternions (L43a). Next: a PGA motor in the ray marcher, which
   needs L41's expansion of the fold on the GPU.
5. L41 with lane C: tables expanded before the GPU, so all of these run in
   shaders.

Prior art to credit when built: structure constants of an algebra (the
standard construction), ganja.js's generated Clifford algebras (Steven De
Keninck), Haskell's `Num` instances.
