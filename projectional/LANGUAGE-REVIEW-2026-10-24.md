# Language review, 2026-10-24: why it reads as contrived, and numbers as one system

Ersagun asked (2026-10-24, 06:28): *"what happened to the language? It still
looks fairly contrived to me. Is it gonna be better? Are we gonna get big
integers, fractions, vectors, matrices, tensors, complex numbers, Clifford
algebras?"*

This review answers both halves. Part 1 reads the language as a programmer
meets it and says plainly what makes it look contrived, with the place in
the examples that shows each thing. Part 2 designs the numeric tower on top
of the meaning/representation split of [NUMBERS.md](NUMBERS.md), as one
system. The plan at the end is a list of small PRs; nothing here is built
yet, and the items go into BACKLOG.md's L section as proposals.

**How it was read.** Every example's own definitions were printed in the
blocks notation, the text the editor shows under the graph (`renderBlocks`,
the same function the editor calls), and read top to bottom like code in
any other language. The quotes below are that output, unedited. The
prelude, the vectors and html modules, std.ts, the tutorial, the two
reviews, NOTES.md and BACKLOG.md were read alongside.

## The short answer

**Yes, it can get much better, and most of what looks contrived is
notation, not the core.** The core (a typed tree, holes, effects in types,
`Choice`, folds, running backwards, derivatives, content hashes) is sound
and unusual, and it held up across thirty-odd PRs of targets. What a
programmer *sees* is the tree printed almost raw: integer arithmetic as
`add(n, 1)`, comparisons as `not (y < x)`, a destructuring as a match with
one case, a step done for its effect as `‹?q8pk› = …`, and every handler's
argument wrapped in `() =>`. Each of those can be fixed as a view, with no
new node kind, which is what the uniformity rule asks for anyway.

Two things are not notation and need language work: **one arithmetic for
every number type** (today Int and Number are parallel worlds, and vectors
went their own way), and **`Diverge` turning up where nothing diverges**,
which forces `first(() => …, () => …)` and `with fuel` wrappers into
programs that don't need them.

**Numbers:** big integers already exist and never overflow, in the
evaluator and in compiled JavaScript, WebAssembly and native code. Vectors
exist as a module over any record of Numbers, and run as GPU vectors.
Float32 exists as a representation. Fractions, complex numbers, matrices,
tensors and Clifford algebras don't exist yet, and Part 2 shows how they
come as one system: **an algebra is a type's arithmetic, given by a table
of how its basis elements multiply**, and one `+` and one `·` read that
table. Complex numbers, dual numbers, quaternions, every Clifford algebra
and small matrices are all tables; fractions are a type with exact meaning;
tensors are the general case and come last, after lists as arrays.

**Why it stalled:** NUMBERS.md's stage 1 (Rational) and stage 2 (one `+`)
were planned on 2026-10-22 and then sat at P3 (BACKLOG L19). The backlog's
priority rules rank bugs, removing special cases, writing programs in the
editor, and then more targets. Nothing in them ranks "a programmer has to
write around the language", and no recurring practice looks for it: the
bigger-program rounds measure the compiler against hand-written code, QA
measures the editor, and the reviews measure soundness. So the work that
arrived was targets, because targets had a source and a measure. The plan
below proposes one.

## What exists today

| | status | where |
|---|---|---|
| Big integers | **done.** `Int` never overflows: a JS number while safe, BigInt beyond; in WASM an `i31ref`, an `i64`, then 32-bit limbs; in native code a tagged word, then a limb cell (Knuth's algorithm D for division) | src/lang/int.ts, WASM.md "Int", NATIVE.md, #39, #301, #304, #305 |
| Floating point | `Number` is the reals represented by float64, said out loud; equality to 1e-9 relative, whole numbers exactly | NUMBERS.md, NOTES.md |
| Float32 | **done** as an approximate representation of `Number`, not a type: every job rounds, and the GPU's `+ − ×` agree exactly | src/lang/float32.ts, #220 to #226 |
| Vectors | **done** as a module: `plus minus times scale dot magnitude distance unit mix clamp reflect`, written once for every record whose fields are all Numbers, through three builtins (`map parts`, `zip parts`, `total`); GPU `vec2f` to `vec4f`; `gradient` gives one Vec | library/vectors.json, src/lang/vectors-source.ts, #121, #128, #134 |
| Derivatives | **done**: `derivative` and `gradient` read off any function, through lets, matches, folds and records | src/lang/derive.ts, #123, #134 |
| Peano `Nat` | a proof of concept: the program says `zero` and `succ`, and runs on binary or on an `Int` | examples/numbers, #30 |
| Exact reals | as a program: continued fractions with Gosper's arithmetic, lazily through cells | src/lang/cells-programs.ts |
| Fractions | **not built** (NUMBERS.md stage 1) | |
| One `+` | **not built** (NUMBERS.md stage 2) | |
| Complex, dual, quaternion, Clifford | **not built** (stage 4) | |
| Matrices, tensors | **not built** (stage 6) | |

---

# Part 1: Why the language reads as contrived

Each item says what the examples show, why, and the fix. **View** means the
fix is a way of drawing the same tree (a projection, like the `[x, y]` list
or the flat steps already are). **Language** means the checker, the
library or the semantics change.

## 1. Two arithmetics, and the integer one has no symbols

`ledger`, `calc`, `chapters` and `wc` work in `Int` (money in cents, line
numbers, counts). Their arithmetic reads like this:

```
entries(rest, add(n, 1))
total(name, add(cents(t), cents), add(count(t), 1))
fold range(subtract(width, length(t)))
if ‹less than›(0, errors) then 1 else 0
if ‹less than›(1, size) and slice(line, 0, 2) = "# " then …
```

while `Number` code in the same programs reads `n + 1` and `a < b`. The
reason is one missing table entry: the blocks notation
(`styles/blocks.json`) gives glyphs to `builtin.add`, `builtin.less` and
the rest of Number's builtins, and Int's are `builtin.int.add`,
`builtin.int.less` with no entry. So a reader sees two languages, and a
writer avoids the second: `countdown` keeps whole numbers in `Number` and
tests divisibility with `mod(x, y) = 0`, and `raymarch` counts its steps in
`Number`, which is part of why it needs `with fuel` (item 7).

**Fix (view, size S):** glyphs for every Int builtin, the same ones Number
has. It changes no meaning hash. The deeper fix, one `+` for every number
type, is Part 2.

## 2. One comparison, and no smaller or larger

There is `<` and nothing else, so every other comparison is a negation or
a swap, and every program that needs a minimum writes its own:

```
plus → not (y < x)                                        countdown
digit(c) = not ‹comes before›(c, "0") and not ‹comes before›("9", c)   calc
smaller(a, b) = if a < b then a else b                    raymarch
larger(a, b) = if a < b then b else a                     raymarch
louder(a, b) = if a < b then b else a                     pedal
```

**Fix (library + view, size S):** `≤`, `>`, `≥` as prelude definitions
over `<` (so they run backwards and differentiate with no new rules), with
glyphs; `smaller` and `larger` (min and max) in the prelude, which shaders
already compile to `min` and `max`. Text gets the same three over `comes
before`.

## 3. Returning two things means declaring a type, and taking it apart means a match

`countdown` declares `Halves` and `Found`, `calc` declares `Parsed`,
`chapters` declares `Pile`, `wc` declares `Report`, each only so a function
can return two values. Reading them back is a match with one case, nested
once per value:

```
match results(front)
  found(expr, value) →
    match results(back)
      found(expr₂, value₂) → join(‹one of›([plus, minus, times, over]), expr, value, expr₂, value₂)

‹seen from›(centre, point) =
  match centre
    pair(cx, cy) →
      match point
        pair(x, y) → pair(x − cx, y − cy)
```

**Fix (view, size M):** a match with exactly one case, on a type with one
case, drawn as a destructuring let: `found(expr, value) = results(front)`,
`pair(cx, cy) = centre`. It is the same match node; the checker already
knows a one-case constructor taken apart always matches (L11d). Pair
already exists, so two-value returns need no new type once taking one apart
is one line.

## 4. No nested patterns, so parsing is a staircase

`ledger`'s `parse` reads four fields from a split line in five levels of
match, with the same error arm five times:

```
match split(line, ",")
  nil → ‹bad line›(n)
  cons(date, ‹after date›) →
    match ‹after date›
      nil → ‹bad line›(n)
      cons(account, ‹after account›) →
        match ‹after account›
          …
                    nil → entry(date, account, amount(cents, n), memo)
                    cons(head, tail) → ‹bad line›(n)
```

`chapters`' and `ledger`'s `main` do the same with the command line (the
usage message written twice), and `calc`'s tokenizer matches a list and
then its head in two steps.

**Fix (view, size L, a design note first):** nested patterns drawn over
nested matches: `[date, account, cents, memo] → entry(…)`, `otherwise →
‹bad line›(n)`. The tree stays nested matches (so backwards, folds and the
compiler see nothing new); the view groups a chain of matches whose inner
scrutinee is a field of the outer one, and the editor offers "match deeper"
on a field. Prior art: every ML; Wadler's views for the idea that patterns
can be a projection.

## 5. Field reads look like calls, and effect steps look like lets

```
across = √(x(p) · x(p) + z(p) · z(p)) − radius                raymarch
if name(t) = name then cons(total(name, add(cents(t), cents), add(count(t), 1)), rest)   ledger

usage() =                                                      ledger
  ‹?q8pk› = ‹print error›("usage: ledger file.csv")
  2
```

A field read is a function call, which is right (it's how the field runs
backwards), but `p.x` is what everyone reads. A step done only for its
effect is an unnamed dot, which the graph draws hollow and the text prints
as a let with its internal handle.

**Fix (view, size S each):** a field read drawn as `p.x` (the `set` path
already prints `p.home.city`); an unnamed dot that nothing reads drawn as a
plain step, as the flat-steps view already does for `print`.

## 6. Every handler argument is wrapped in `() =>`

```
first(() => queens(8), () => nil)
count(() => queens(8))
optional(() => heading(line))
text(() => "Pedal")                        a constant, in a thunk
first(() => conjugate(‹linear light›, ‹twice the light›)(stored), () => 0)
```

The thunks are honest (the handler decides when, and whether, the action
runs), but they are the most frequent piece of punctuation in the
examples. TUTORIAL.md's open item 2 already proposes drawing a zero-input
frame as its contents.

**Fix (view, size M):** a parameter whose type is an action (a function of
no inputs) is drawn by name, like Scala's by-name parameters:
`first(queens(8), else nil)`, `count(queens(8))`. The tree keeps the
lambda. Constants in a page (`text(() => "Pedal")`) get the html module's
`words("Pedal")`, which exists and which `pedal` doesn't use (it was
written against the lower-level `element` before the module).

## 7. `Diverge` where nothing diverges

This is the one that changes how programs are written:

- `calc`'s whole parser is `-[Diverge, Abort]->`: `sum` calls `product`,
  which returns the rest of the tokens inside a `Parsed` record, and the
  size-change check can't see that the rest is smaller.
- `raymarch`'s `march` and `shadow` count steps up to 120 and 64. The
  checker can't trust a count (the comment in `colour` explains it, NaN
  included), so they are `Diverge`, and `colour` wraps the whole trace in
  `first(() => ‹with fuel›(1000, …), () => rgb(1, 0, 1))`.
- `conjugate` and `inverse` carry `Choice, Diverge`, so `pedal`'s `drive`,
  `conjugate`'s `brighter` and `multiband` all say `first(() =>
  conjugate(…)(x), () => x)`, a fallback nobody expects to run.
- `queens`' `safe` threads a distance through a fold by folding to a
  *function* and applying it: `apply fold placed … to (1)`. A fold with an
  accumulator is a common need, and this is the only total way to say it.

**Fixes (language):**

- *Bounded counting is total.* Recursion where an `Int` argument moves
  towards a bound it is compared against (`120 < steps` guarding `steps +
  1`) terminates; the measure is `120 − steps`. The checker can find it
  from the guard, as Dafny and Lean find a `decreases` measure, and an Int
  step count (item 1) makes raymarch's `with fuel` unnecessary. Size M.
- *Smaller through a record.* A recursive call's result field that is a
  suffix of the input (`rest(p)` in calc) is a size relation the checker
  can carry (sized types). Size L, research; calc is the test.
- *`conjugate(f, g)` without `Choice` when `f` is one-to-one in its mode.*
  MODES.md already knows when `inverse` has exactly one answer (L11d); the
  type should follow, as BACKLOG L29 says for `inverse`. Size M.
- *A fold with an accumulator* drawn as `fold placed from 1` over the
  function-folding tree that exists (a view of `apply fold … to`), so
  `safe` reads as what it is. Size M.

## 8. The text view sometimes prints the wrong program

Two bugs, found while reading:

- In `calc`'s `‹sum rest›`, the condition of an `if` is itself a match
  (`match t: symbol(m) → m = "+" or m = "-"; otherwise → false`). The text
  prints it as `if ‹match›`, and prints the then-branch's let
  (`right = product(more)`) between the condition and `then`:

  ```
  if ‹match›
    right = product(more)
    then ‹sum rest›(…)
  ```

- In `‹run line›`, the steps of the then- and else-branches print before
  the words `then` and `else`:

  ```
  else if t = symbol("?")
    print(parenthesized(‹whole expression›(more)))
    then bindings
    print(show(evaluate(‹whole expression›(ts), bindings)))
    else bindings
  ```

A reader can't tell what these programs do from the text. **Bugs (P1, lane
E or whoever owns src/lang/render.ts), size S each.**

## 9. Smaller things a programmer notices

- **Types print effect rows in full.** `button : (Text, (Event)
  -[Cells, Console, Diverge, Files, Network, Update, Abort, Log, Random,
  Time]-> Unit) -> Html`. The second review (§5) proposed a named row ("what
  a page may do"); it would print as `-[Page]->`.
- **A constrained type variable prints as plain `a`.** `sphere : (a,
  Number) -> Number` means "any record of Numbers", which the type doesn't
  say. It should print as `Numbers a` or similar.
- **`newline = first(() => character(10), () => "")`** in `ledger`, where
  `"\n"` works in `calc` and `chapters`. Probably written around the
  editor's text entry when ledger was built in the editor; worth checking.
- **`‹one of›([true, false])`** is how `countdown` says "either". Fine as
  the meaning, but `either` would read better.
- **Html with CSS in strings** (`styled("display: grid; …", …)`). Honest
  for now; not a language problem.

## 10. What is good, and should stay

So this isn't read as "everything is wrong". The examples that read best
are the ones where the core shows: `queens` (search with no search code),
`fall` and `rotate` (equations that run in any direction), `converter` (a
field is `inverse(view, typed)`, and no parser was written), `raymarch`'s
normals as `gradient`, `conjugate(f, g)`, `insert` and `sort` as folds, and
`effects` (a handler is a match). Names, comments and layout outside the
code, holes with types, and content-hashed libraries are as good as they
were.

## Why the language stalled behind targets

Since 2026-10-22 the merged work went to shaders, web pages, WebAssembly,
native code, audio and the editor. That wasn't neglect by anyone; it is
what the process selects:

1. **The priority criteria** (WORKFLOW.md) rank bugs, removing special
   cases, writing programs in the editor, and serving more targets. A
   language gap that a program writes around (items 1 to 7) is none of
   these, so it lands at P3, where WORKFLOW.md's own example is "Clifford
   algebras". NUMBERS.md stages 1 and 2 have been BACKLOG L19, P3, since the
   backlog was made.
2. **The recurring practices measure other things.** The bigger-program
   rounds (compiler/GAPS.md) compare the compiler's output with ideal
   JavaScript, so they produce compiler items. QA produces editor items.
   The reviews look for unsound claims. None asks "where did this program
   bend around the language?", and the examples show it bent a lot
   (`Halves`, `Found`, `Parsed`, `louder`, `newline`, `with fuel`).
3. **Targets have a measure; notation doesn't.** "Countdown 117 ms native"
   is a number. "`add(n, 1)` reads badly" isn't, so it never wins a
   ranking.

**Proposal:** each bigger-program round also records **language gaps**
next to compiler gaps: every place the program declares a type, defines a
helper, or wraps a call only because the language lacks something. And a
priority rule: *a gap that two examples write around is P2*. By that rule,
items 1, 2, 3, 6 and 7 above are P2 today.

---

# Part 2: Numbers as one system

## What of NUMBERS.md still holds

Almost all of it. Keep:

- **A type is its meaning; a representation is an ordinary type with a
  `meaning` function**, in a side table, with no new node kinds. Float32
  proved the pattern for approximate representations, and the compiler lane
  confirms every back end sees a representation as ordinary data, so a new
  number system written as meaning plus representation costs the back ends
  nothing; only new builtins do.
- **Int never overflows.** Done.
- **Exactness is a meaning, floats are a representation.** `Rational` is
  not `Number`.
- **Clifford is one library**, quaternions are the rotor representation of
  `Cl(3, 0)`, division is the product run backwards, and dual numbers are a
  second `derivative` to test the first against.
- **Tensors mean "index to scalar, with a shape"**, one contraction
  operation, shapes inferred on the units machinery.

**Change one thing: how `+` works.** NUMBERS.md stage 2 says each type has
its own `+` definition, all *displayed* as `+`, the palette picks one by
type and the program stores its id; generic code takes a record of
operations that the editor fills in and hides. Two days of code argue
against the second half:

- The **vectors module didn't do it.** Writing `dot`, `magnitude` and
  `unit` against a passed-in record would have meant a record argument on
  every call. Instead it added a constrained type variable ("any record of
  Numbers", `Scheme.numbers` in types.ts) and three structural builtins,
  and every record of Numbers got the whole module for free. That is the
  better design, and it is already a small, closed type class.
- **Int and Number already are "overloading by name"**, and item 1 is what
  it looks like in practice: two ids, two notations, programs avoiding one.
- **Generic numeric code is the point of a numeric tower**: `sum`, a
  matrix product over any ring, Gaussian elimination over `Rational` or
  `Number`, a polynomial over the complex numbers, `derivative` over dual
  numbers. With records, each of these takes and passes a dictionary.

So: **one `+`, one `−`, one `·`, one `÷` in every program, generic over a
closed set of algebraic structures that the language fixes, with each
number type's arithmetic given in a side table.** It is a type class,
honestly named: one built-in family of classes that users fill in for their
types but can't extend with new classes, which is Elm's `number` and
`comparable` taken further, and the opposite of Haskell's open classes.
Names-are-presentation stays for the operations that *mix* types
(`2 · v` is `scale`, drawn as `·`; matrix times vector is drawn as `·`).

This is the decision to put to Ersagun; the rest follows from it.

## The one idea: a type's arithmetic is an algebra, and an algebra is a table

Every number system on the list is one of these, all over a scalar type
`K` (Int, Rational, Number):

| structure | operations | examples |
|---|---|---|
| **additive** | `0`, `+`, `−` | everything below |
| **module over K** | the above and `scale(k, x)`, drawn `k · x` | vectors, colours, matrices as vectors, polynomials |
| **ring** | the above and `1`, `·` | Int, Rational, Number, Complex, dual numbers, quaternions, every Clifford algebra, square matrices, truncated polynomials |
| **field** | the above and `÷` that has no answer only for 0 | Rational, Number, Complex |
| **ordered** | `<` (and `≤ > ≥`, `smaller`, `larger`) | Int, Rational, Number; not Complex |

The scalar types (Int, Rational, Number) have their own operations,
written as builtins or definitions. **Every other type on the list is a
fixed number of coefficients in K plus a product, and the product is
bilinear, so it is fully given by how the basis elements multiply**: the
*structure constants* of the algebra, a table. Addition and scaling are
part by part, which the vectors module already does. Only the product
needs the table.

For everything on Ersagun's list the table is *monomial*: two basis
elements multiply to a constant times one basis element, or to zero.

| algebra | basis | the table | dimension |
|---|---|---|---|
| complex numbers | 1, i | i·i = −1 | 2 |
| split-complex | 1, j | j·j = +1 | 2 |
| dual numbers | 1, ε | ε·ε = 0 | 2 |
| jets of order n (Taylor mode) | 1, ε, …, εⁿ | εᵃ·εᵇ = εᵃ⁺ᵇ, or 0 past n | n + 1 |
| Clifford `Cl(p, q, r)` | blades: subsets of e₁…eₙ | symmetric difference, with a sign from reordering and the squares of the shared vectors (+1, −1 or 0 from the signature) | 2ⁿ |
| quaternions | 1, i, j, k | Hamilton's; equal to the even part of `Cl(3, 0)` | 4 |
| n × n matrices | matrix units Eᵢⱼ | Eᵢⱼ·Eₖₗ = Eᵢₗ when j = k, else 0 | n² |
| part-by-part product | eᵢ | eᵢ·eᵢ = eᵢ, else 0 | n |

So **complex numbers, dual numbers, quaternions, Clifford algebras and
square matrices are not five features. They are five tables**, given to
one library function, `algebra(table)`, which produces the type's ring
entry. `Cl(p, q, r)` is a definition that builds the Clifford table from
the signature (a few lines: blades as bitmasks, a sign from counting swaps),
which is how ganja.js generates its algebras. Complex numbers are
`Cl(0, 1)`; nobody has to write them separately, though the library names
them.

What a programmer writes (a sketch; the exact spelling is the editor's):

```
type Complex
  | complex(re: Number, im: Number)            ← an ordinary record

Complex's algebra = algebra(complex(0, 1) · complex(0, 1) = −1)   ← side table, like representations.json

mandelbrot step(z, c) = z · z + c              ← the one ·, the one +
```

and for geometry:

```
PGA = Cl(3, 0, 1)                              ← an algebra value; its element type is ordinary data with 16 Numbers
motor = exp(−angle/2 · e₁₂) · translator(…)
moved = motor · point · reverse(motor)
```

## Each requested system: a type, or a representation?

| system | meaning | representations | notes |
|---|---|---|---|
| **Big integers** | `Int` (exists) | machine word, BigInt, limbs per target (exist) | nothing new; only the glyphs of item 1 |
| **Fractions** | `Rational`: a **type** with exact meaning, a quotient of Int pairs | lowest-terms pair (canonical, so structural equality and hashes stay right); later a finite continued fraction | `gcd` as one builtin in each target, as the compiler lane advises, rather than a definition; `÷` by zero is `Choice` like Int's |
| **Vectors** | a record of K (exists) | the record; on a GPU `vec2f` to `vec4f` (exists) | the vectors module's `plus` and `minus` become the generic `+` and `−`; `scale` is drawn `k · v` |
| **Complex** | a **type**: the ring `Cl(0, 1)` over Number (or Rational) | a two-field record; on a GPU `vec2f` | the first algebra by table; `abs`, `conj`, `exp`, `arg` in the library |
| **Dual numbers, jets** | algebras by table over Number | records | a second implementation of `derivative` (NUMBERS.md stage 8), and higher derivatives from jets |
| **Quaternions** | a **representation**, of the even part of `Cl(3, 0)` | four of the eight coefficients | chosen when the grade inference shows a value only ever has grades 0 and 2 |
| **Clifford algebras** | algebra values from `Cl(p, q, r)`; elements are records of 2ⁿ coefficients | dense (all 2ⁿ), grade-restricted, sparse | the product expanded at compile time from the table, zero terms dropped; grades inferred like units |
| **Matrices** (fixed small size) | the ring of n × n matrix units over K; a record of rows | rows of records; on a GPU `mat2x2f` to `mat4x4f` | determinant and inverse in the library; matrix times vector is a separate `·` (names are presentation) |
| **Tensors** (any size, any rank) | a function from an index to K, with a shape: the general case | dense array, strided, diagonal, sparse, broadcast | needs lists as arrays (BACKLOG C30) and shapes in types; one contraction operation (einsum); comes last |

Two lines are worth saying out loud. **Matrices of fixed small size and
tensors are different things here**: a 3 × 3 rotation in a shader is a
record that the GPU holds by value, while a 1000 × 1000 matrix is an array
whose size is known only when the program runs. Treating them as one type
would make the shader case pay for the general one. They share their
meaning (the small matrix's `meaning` is a tensor of shape 3 × 3), so
converting is a representation change, as everywhere else. And
**quaternions are the only item that is purely a representation**: every
other row is a type the program names.

## How one `+` is checked, run and compiled

**Checking.** The checker already has one constrained type variable: a
`numbers` variable may only stand for a record of Numbers (types.ts,
`requireNumbers`). Generalise it: a variable can carry the structure it
needs (`additive`, `module`, `ring`, `field`, `ordered`), and resolving it
to a type looks the type up: a scalar builtin type has its entry, a record
of a structure's type gets the part-by-part operations, and a type with an
algebra in the side table gets that algebra's. A type that has no entry is
a type error the palette prevents, as now. A generic definition keeps the
constraint in its scheme, as `Scheme.numbers` does, and prints it (`(a, a)
-> a where a is a ring`), which also fixes item 9's bare `a`.

**Literals.** A literal in a hole of a known type is a literal of that
type, as now. In generic code, `0` and `1` are the structure's zero and
one, and a whole literal `n` is `n · 1` (every ring has the map from the
integers), which is Haskell's `fromInteger`. Other literals in generic code
aren't allowed: `0.5` means nothing in `Int`.

**Mixing types.** No implicit conversion, unlike Julia's promotion.
`Int → Rational → Number` and `K → Complex` are explicit functions (`as
number` exists), which the palette offers when a hole wants the other type
and which the view can draw small. `2 · v` with `2` a scalar and `v` a
vector is `scale`, a separate definition drawn as `·`.

**Running.** The evaluator runs the operation the type resolved to. Where
the type is known at the call (nearly all code), the program is the same
as one written with today's per-type builtins, so **Int and Number
arithmetic cost nothing new anywhere.** Generic definitions are the
question: scalar.ts already lowers a definition once per call type for
shaders and the scalar WASM profile, while compiled JavaScript specialises
only the one-instance case (compile.ts, GAPS.md G17). Generic code in JS
either gets copies per type, as MLton does, or passes the type's
operations, as a dictionary, only where it stays generic; that is the
compiler lane's call, and either way the program doesn't change. A table product is expanded at compile time
into sums of products of coefficients, with the zero entries dropped, the
way `gradient` is expanded before the shader is printed (C9): Cl(3, 0)'s
product becomes the 64 multiplications it is, and a rotor times a rotor
the 16 of Hamilton's product.

**Equality.** Exact for every exact type (Int, Rational, and algebras over
them); to 1e-9 relative for Number and algebras over it, as now; part by
part for records.

## Running backwards

- **`+` and `−`** run backwards part by part, as the vectors module does
  today: each part is the scalar case.
- **`·` with one side known** is linear in the other, so `a · x = b` is a
  square block of linear equations in x's coefficients. The solver already
  eliminates linear blocks over Number. **Division needs no definition**:
  `b ÷ a` is `·` run backwards. Where `a` has no inverse (a null vector in
  Clifford, a singular matrix, 0) the block is singular and the answer is
  "no answer" (`Choice`), which is right.
- **Over Rational** the same elimination must be exact. relate.ts's linear
  step becomes generic over the field: it uses the field's `+ · ÷`, so
  Rational systems solve exactly and Number ones as now.
- **Over Int**, backwards stays listing and exact division, as today.

## Derivatives

`derive.ts` differentiates through definitions, and every algebra's
operations are definitions built from scalar `+` and `·`, so they
differentiate with no new rules; a bilinear product gets the product rule
automatically. `gradient` over records of Numbers exists. Two additions:

- **Dual numbers and jets** are algebras, so running any function on them
  computes its derivative (forward mode). That is a second, independent
  `derivative`, which the tests can hold `derive.ts` against.
- **Complex derivatives**: differentiating a `Complex → Complex` function
  as a function of two Numbers gives a 2 × 2 Jacobian. For holomorphic
  functions that is one complex number, but which functions are holomorphic
  isn't something to promise now. Left open.

## Targets

| | GPU (WGSL) | WebAssembly | native (C) | JavaScript |
|---|---|---|---|---|
| Int | as today | as today | as today | as today |
| Rational | refused, with the reason (no unbounded integers on a GPU) | a struct of two Ints, `gcd` builtin | a struct by value, `gcd` builtin | an object per result |
| Complex, dual, small Clifford | `vec2f`, `vec4f` or structs of them; product expanded | structs by value | structs by value | an object per result; scalar replacement later (C31's question) |
| small matrices | `mat2x2f` to `mat4x4f`, WGSL's own `*` | structs | structs | objects |
| tensors | later, as storage buffers | arrays (after C30) | arrays | typed arrays |

The fixed-size cases are the cheap ones everywhere, and they are exactly
the ones shaders and audio need. Tensors are costly until lists can be
arrays, which is why they come last.

## What this design doesn't do

- **No user-defined classes.** The structures are the five above. A
  programmer gives a type an algebra; they don't invent new kinds of
  algebra. (Lean's Mathlib has hundreds of structures; that is a proof
  library's job, not this language's.)
- **No implicit promotion** between number types.
- **No non-monomial tables yet.** Algebras whose basis products are sums
  (most Lie algebras, general structure constants) would need a table of
  sums. The monomial case covers the whole list; the general case is a
  later generalisation of the same table.
- **No tensors before arrays.** A tensor library on cons lists would be a
  demo, not a tool.

---

# Plan

Ordered. Each is one PR unless it says otherwise; each goes to BACKLOG.md
as a proposal (L32 to L50; L30 and L31 were taken by the pedal, so the two text bugs are L49 and L50) until Ersagun or the coordinator says to start.
Bugs first, then the views that change what every program looks like, then
the numbers.

**Bugs**

1. **L49** The blocks text prints a match used as a condition as
   `if ‹match›`, and prints a branch's lets and steps before `then`/`else`
   (calc's `sum rest`, `run line`). S.
2. **L50** An unnamed step done for its effect prints as `‹?q8pk› = …`
   (ledger's `usage`, `run`, `failed`; countdown's `main`). S.

**Notation (views; no meaning hash changes)**

3. **L32** Int's builtins drawn with Number's glyphs: `n + 1`, `a < b`.
   One table, five minutes of work, and the biggest visible change. S.
4. **L33** `≤ > ≥`, `smaller`, `larger` in the prelude, with glyphs; the
   examples' own `smaller`, `larger` and `louder` replaced. S.
5. **L34** Field reads drawn as `p.x`. S.
6. **L35** A one-case match drawn as a destructuring let. M.
7. **L36** Action parameters drawn by name: `first(queens(8), else nil)`. M.
8. **L37** Nested patterns as a view over nested matches. Design note
   first. L.

**Numbers**

9. **L38** One `+ − · ÷` (design accepted first): structures as
   constraints in the checker, generalising `numbers`; Int and Number as
   the first two entries; the vectors module's `plus`/`minus` become `+`/`−`;
   generic literals `0`, `1`, `n`. Code at a known type compiles as today;
   generic code in JS needs lane C's choice (copies or dictionaries). L (two or three PRs: checker, then palette and editor, then
   the module).
10. **L39** `Rational`: lowest-terms pairs, `gcd` builtin in each target,
    exact `÷` with `Choice` at zero, `show` as `3/4`, and relate.ts's linear
    step generic over the field. M.
11. **L40** `algebra(table)` for monomial tables, and `Complex` as the
    first one, with `abs`, `conj`, `exp`, and a Mandelbrot or
    domain-colouring shader as the example (`vec2f` on the GPU). M.
12. **L41** Table products expanded at compile time (with lane C). M.
13. **L42** `Cl(p, q, r)`, with dual numbers, split-complex and `Cl(3, 0)`
    named; a projective geometric algebra example (`Cl(3, 0, 1)`: rotate
    and move a shape in the ray marcher with one motor). M.
14. **L43** Grade inference on the units machinery, and quaternions as the
    rotor representation of `Cl(3, 0)`. L.
15. **L44** Small matrices `Mat2` to `Mat4` as the matrix-unit table, with
    `mat4x4f` on the GPU. M.
16. **L45** Dual numbers and jets as a second `derivative`, tested against
    derive.ts. M.
17. Tensors: NUMBERS.md stage 6, after C30 (lists as arrays). Unchanged
    from NUMBERS.md; not numbered yet.

**Language (not numbers)**

18. **L46** Bounded counting is total (an Int moving towards the bound it
    is compared against), so raymarch loses `with fuel`. M.
19. **L47** `conjugate` and `inverse` without `Choice` when the mode says
    one answer (joins L29). M.
20. **L48** A fold with an accumulator, drawn as `fold … from x` over the
    function-folding tree. M.

**Process**

21. **W** Bigger-program rounds record language gaps next to compiler gaps,
    and WORKFLOW.md gets the rule "a gap two examples write around is P2".

## Recommendation

**Start with L32 (Int glyphs) today**: it is one table, it changes no
meaning, and it removes the single most contrived-looking thing in ledger,
calc, chapters and wc. Then the two text bugs (L49, L50), since bugs come
first and the text is what Ersagun reads. Then **L38, one `+`**, because
fractions, complex numbers and everything after depend on it, and it
replaces a special case (two arithmetics, and the vectors module's private
`plus`) rather than adding a feature, which puts it ahead under the
existing priority rules. After that, **Rational and Complex** (L39, L40) as
the first new number systems, Complex with a picture so it shows. Clifford
follows in three PRs.

The decision Ersagun needs to make before L38: **one generic `+` with a
closed set of algebraic structures (recommended), or NUMBERS.md's original
"one `+` per type, displayed alike, and records of operations passed to
generic code"**.

## Prior art

Influences and prior art, per the attribution rule. Nothing in this
review adapts anyone's code.

- **Julia's number hierarchy and promotion** (Bezanson, Edelman, Karpinski,
  Shah): prior art for one `+` across number types by dispatch on the
  type. We take the hierarchy and leave promotion out.
- **Haskell's `Num` and `fromInteger`**: prior art for literals that take
  the type of their context, and a known warning about one class doing too
  much (Num bundles `abs` and `signum` with ring operations).
- **Elm's constrained type variables** (`number`, `comparable`,
  `appendable`): the closest prior art to the proposal, a closed set of
  built-in constraints with no user classes. Our `numbers` constraint is
  already one.
- **Lean 4 and Mathlib's algebraic hierarchy**: influence for which
  structures to name (additive group, module, ring, field, ordered field).
- **Fortress** (Steele et al.): prior art for a language whose arithmetic
  follows mathematical structure and notation, with algebraic traits.
- **ganja.js** (Steven De Keninck): prior art for generating any
  `Cl(p, q, r)` from its signature and making its operators the language's;
  **Klein** and **Gunn and De Keninck's projective geometric algebra**,
  influence for the PGA example; **Grassmann.jl** and **Versor** (Pablo
  Colapinto), prior art for expanding geometric products at compile time.
- **Structure constants** of an algebra: standard mathematics.
- **APL and J** (Iverson): influence for operations that lift over arrays
  without loops; our part-by-part `+` is a fixed-rank cousin. **NumPy's
  `einsum`** (after Einstein's summation convention): prior art for one
  contraction as the tensor operation. **Dex** and **Futhark**: prior art for
  array shapes in types.
- **Scala's by-name parameters**: prior art for item 6's view.
- **Dafny's and Lean's termination measures**: prior art for item 7's
  bounded counting.
- **Wadler's views** (1987): influence for patterns as a projection
  (items 3 and 4).
- **Hoare's abstraction functions** (1972): the meaning/representation
  split, as in NUMBERS.md.

## Files

```
LANGUAGE-REVIEW-2026-10-24.md   this review
NUMBERS.md                      the representation design it extends
src/lang/types.ts               the numbers constraint that L38 generalises
src/lang/vectors-source.ts      the vectors module
styles/blocks.json              the glyphs L32 adds to
src/lang/render.ts              the text view of items 5 and 8
```
