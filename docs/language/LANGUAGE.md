# The typed core: data, cases, loops, effects, and the errors you can't make

This adds a language to the projectional prototype: data types, case
analysis, folds, inferred types with effects, typed holes, and two programs
that do real work. Everything is still nodes keyed by id, with names in side
tables. Code is in `src/lang/`, the programs are `examples/queens` and
`examples/algebra`.

```sh
npm run lang    # shows both programs, runs them, and walks through the errors
npm test        # includes test/lang.test.ts
```

## Start here: the language in plain words

This section is for someone opening the editor for the first time. The rest
of the file goes deeper, and [LIBRARY.md](LIBRARY.md) lists everything a
program can use without writing it, with its type and one line on what it
does.

**A program is a list of definitions.** Each has a name, maybe some inputs,
and a body that computes its answer. Here are three from the two dice
program, as the editor's text view shows them:

```
die : () -[Random]-> Float64
die() = add(floor(multiply(random(), 6)), 1)

two dice : () -[Random]-> Float64
two dice() = add(die(), die())

a hundred rolls : (Float64) -> List Float64
a hundred rolls(seed) = seeded(seed, map(range(100), (i) => two dice()))
```

There are no statements and no variables that change. A body is one
expression, and a name you give inside it (`total = add(i, 2)`) is a
value you can use below that line.

**Reading a type.** The line above each definition is its type. You never
write it: the checker works it out and the editor shows it.

- `(Float64) -> List Float64` takes a Float64 and gives a list of Float64s.
- `() -[Random]-> Float64` takes nothing, may draw random numbers, and gives
  a Float64. What's in the square brackets is the definition's *effects*,
  what it may do besides compute. A plain arrow `->` has none: same inputs,
  same answer, every time.
- A small letter is any type: `(List a) -> Int` works on a list of
  anything.

**Effects, and who answers them.** `random()` doesn't decide where the
numbers come from. It asks, and the nearest thing around it that handles
`Random` answers. That's why `die` has `Random` in its type, and so does
`two dice`, which calls it. In `a hundred rolls`, `seeded(seed, …)` is
the handler: it answers every `random()` inside it from a generator started
at the seed, so the same seed gives the same hundred rolls. The `Random`
stops there, and `a hundred rolls` has a plain arrow. If nothing handles
an effect, the world does when the program runs: the page's Roll button
calls `die()` straight, and gets the browser's randomness.

Two edits show how types follow what you do. Put `die()` where the Roll
100 button passes `7`, as `a hundred rolls(die())`, and nothing changes in
any type: the button's handler is allowed `Random`, and the seed is now
different on every click. Put `die()` in place of `seed` *inside* `a
hundred rolls`, as `seeded(die(), …)`, and its type becomes `(a) -[Random]->
List Float64`. The input is no longer used, so it can be anything (`a`). The
`die()` runs before `seeded` takes over, so `Random` leaks out. Both are
fine programs; the type tells you which one you wrote.

The effects you'll meet: `Choice` (a search, or an answer that may be
missing), `Abort` (stopped with a reason), `Random`, `Time` (the clock),
`Console` and `Files` (printing, files), `Network` (fetching), `Cells` and
`Update` (a page's changing values), `Log` (debugging lines), and
`Diverge` (it might not finish). You can declare your own, and handle
it with a match. See "Effects, and why not monads" below.

**Numbers.** There are four kinds: `Int` (whole, any size), `Float64`
(floating point), `Rational` (exact fractions such as 1/3) and `Complex`.
Together they are the Numbers. One `+ − · <` works on all of them, and
the checker picks the kind; a type says so as `(a, a) -> a, where a is a
Number`. A plain literal is some Number too: `3` is an Int where an Int is
needed, a Float64 where a Float64 is, and so on, while `0.5` can be
anything but an Int. One that nothing fixes is exact where it can be: `2 +
3` alone is the Int 5, `0.5` alone a Float64. Values don't mix
by themselves: `as float64`, `whole part`, `as fraction` and `as complex`
convert. (WHAT-NUMBER-MEANS.md.)

**Data.** You make a type by listing its cases, each with named fields:

```
type Shape
  | circle(radius: Float64)
  | rectangle(width: Float64, height: Float64)
```

`circle(2)` makes one. A `match` looks at which case a value is and gives
each case's fields names; `if … then … else …` is a match on true and
false. There are no loops: `map`, `keep` and `for each` go through a list,
`fold` walks any data, and a function may call itself. The library has
lists, pairs, `Optional` (a value that may be missing), `Outcome` (done,
or refused with a reason), maps and sets.

**Searching.** `one of([1, 2, 3])` is any of the three: a computation with
several answers, and the `Choice` effect in its type. `all(…)` collects
every answer, `first(…, default)` takes the first, and `fail()` has none.
So a search is written as "pick, check, keep" with no loop, and the same
`Choice` is how a lookup says "not there": `value at(m, k)` has no answer
when the map hasn't got `k`, and `first(() => value at(m, k), () => 0)`
gives a default.

**Pages.** `main` can return a page (`Html`). A `cell` holds a value that
changes; a part of the page that reads a cell is drawn again when it
changes, and a button's handler writes cells. The two dice page is about
forty lines.

**Errors you can't make.** The editor offers only what keeps the program
correct: a hole shows its type, and the palette lists what fits it. The
types say what each definition does, so printing from inside a search, or
a page's view writing a cell, is a type error, not a surprise at run time.

### What's new since 2026-10-23

- **A plain literal is some Number** (2026-10-26): `3` is an Int, a
  Rational, a Float64 or a Complex, whichever its place needs, with no `as
  float64` in between; `Number` names the family in types and errors. A
  whole literal nothing fixes is an Int, so `10^12 · 10^12` is exact.
- **One `+ − · <` for every kind of number** (it used to be a separate
  set per type), with `Rational` (exact fractions, in lowest terms) and
  `Complex` (re + im·i) as the new kinds. A literal can be written as a
  fraction (`1/2`). `smaller`, `larger` and `≤ > ≥` work on every ordered
  kind. ("Whole numbers and text", LIBRARY.md "Numbers".)
- **`compare` and `sort`** on any plain data: numbers by value, text
  alphabetically, cases in the order the type lists them. ("Order, and
  sort".)
- **`Outcome`**: `attempt(action)` keeps an `Abort` as data,
  `done(value)` or `refused(reason)`, so failures can go in a list.
  ("`Outcome`: the data form of Abort".)
- **Maps and sets**: `Map k v` and `Set k`, kept sorted so equal maps
  print the same, with 21 operations (`put`, `value at`, `has item`, …).
  When `lab` runs a program, a map can be stored as a balanced tree,
  which is faster, without the program changing.
  ("Maps and sets".)
- **Effects fixes**: a page's button whose handler fetches now does what
  came before the fetch once, not twice. Printing inside a search is
  refused by the checker instead of leaking, because a search may run a
  path several times or drop it.
- **Answered later**: an operation can be declared `later`, and its handler
  is given the rest of the program as an ordinary function, to resume once
  (now, or later) or drop. That's how waiting is written: a generator, a
  page waiting for a reply, two tasks taking turns. It runs in the
  evaluator; compiled JavaScript doesn't run it yet. ("Effects you define",
  ANSWERED-LATER.md.)
- **LIBRARY.md**: every definition the library offers, with a plain note.

## Short answers

- **Conditionals?** One construct: `match`, a case analysis over a data type.
  `if c then a else b` is how a match on `Bool` is *displayed*; there is no
  `if` node.
- **Loops?** No loops. `fold` walks any recursive data type and always ends.
  Recursion is allowed, and the checker works out whether it ends. `map`,
  `for each` and `keep` (filter) are ordinary library definitions.
- **Types?** Yes, inferred (Hindley-Milner) and never written down. The type
  is a view: the block view prints it above each definition.
- **Monads?** No. Effects are part of a function's type as a *row*, e.g.
  `evaluate : (expression, Float64) -[Choice]-> Float64`. Built in are
  `Choice` (Verse-style failure and multiple answers), `Diverge`, the
  world's `Console` and `Files`, `Network`, and `Cells` and `Update` for
  reactive values; std declares `Abort`, `Log`, `Random`, `Time` and
  `Wait` as ordinary effects, and a program can declare its own. Handlers
  are ordinary functions (a `match` on the operations) that remove an
  effect.
- **Verse's thing?** Yes, it's `Choice`, and it's the same idea as the
  relation solver's branches: a stream of answers, canonical first.
- **Modules? Imports?** A module is published definitions plus the same
  side tables a program has. Publishing names a definition by its content
  hash, so the hash is its id; a reference to it is the import, and there
  are no import statements. Signatures are *pins*: inferred types, frozen.
  See "Signatures and modules" below.
- **How is data stored?** However the compiler chooses. A type means its
  definition (`zero`/`succ`, `cons`/`nil`, a map as sorted entries), and
  representations, written in the language as ordinary definitions, say
  how it may be stored and what each job costs. The compiler picks one
  from the jobs the program uses; a program never names one, and
  `lab check` says what was picked (REPRESENTATIONS.md).
- **Can the editor stop type errors?** Holes have types, and the palette
  offers only fillings that keep the whole program error-free. A test punches
  holes all over both programs, tries every option the palette offers (over
  a thousand fillings), and checks that none of them causes an error.

## Data

```
type expression
  | number(value: Float64)
  | x
  | sum(left: expression, right: expression)
  | ...
```

A `typedef` is a def's body: a list of `variant`s, each a list of `field`s.
Variants and fields are nodes, so **the id is the tag and the id is the
label**. A reference to a variant is its constructor, called like any
function (`sum(a, b)`). A reference to a field of a one-variant type is its
projection (`fst(p)`). Two libraries can both add a field called `name` to
things and never collide, because the field is an id and "name" is just its
display name. That covers the `Symbol` and `WeakMap` workarounds from the
original pitch.

The standard library (`src/lang/std.ts`) defines `Bool`, `Unit`, `List a`
and `Pair a b` as ordinary typedef nodes with stable ids. Nothing about them
is built into the language.

`Array a` is the one data type that is a builtin (L116): a list's items side
by side, read by position in constant time (`item at(array, i)`, no answer
outside it). `array of(list)` makes one, `items of array(a)` is the list it
stands for, and `push` gives a copy with one more item. Its two ends are
read and grown the same way: `first of array` (no answer when empty),
`rest of array` and `push front`. It exists to be a
list's representation, so a program that says `List` can be stored as an
array where the jobs it does pay for that. The compiler chooses, as it does
for Map's trees (REPRESENTATIONS.md).

**Updating a record** is `set(field, record, value)`: the record with that
field changed and every other field kept. The field can also be a path,
`set((p) ↦ p.home.city, ada, "Paris")`, which copies only the records on the
path. That is the projection run backwards with the rest of the record
given, so records get updates, and nested data gets lenses, without a new
construct (REVIEW.md §5.3). The checker accepts only a field or a path of
fields written in place, so an update always has exactly one answer. A
general function there (`(p) ↦ p.width · 2`) is the next step: it would
run backwards through the relational interpreter, with `Choice`.

**Records of Float64s, part by part.** A point, a direction or a colour is
an ordinary one-case type whose fields are all Float64s (`vec(x, y, z)`,
`colour(red, green, blue)`). Three builtins take any such record part by
part, so the arithmetic on it is written once for all of them:

- `map parts(f, r)`: `f` on each part, `vec(f(x), f(y), f(z))`;
- `zip parts(f, a, b)`: `f` on each pair of parts;
- `total(r)`: the parts added up.

`f` must be pure (it runs once per part). A Float64 counts as a record of
one part, so the same code works on plain Float64s. The checker types them
with a constraint that type variables carry, like `equal`'s plain data:
`plus(a, b) = zip parts(add, a, b)` is `(r, r) → r` for every record of
Float64s `r`. Both inputs are the same `r`, so adding a colour to a point is
still a type error (NUMBERS.md: "adding a position to a color is a
mistake"), and a record with a field that isn't a Float64 is refused with
that reason. Run backwards, each part is one call that runs backwards on its
own: the point that `plus(p, vec(1, 1, 1))` takes to `vec(5, 0, 2)` is
`vec(4, -1, 1)`.

The **vectors module** (`library/vectors.json`, built from
`src/lang/vectors-source.ts`) is written on them: `plus`, `minus`,
`times`, `scale`, `dot`, `magnitude`, `distance`, `unit`, `mix`, `clamp`
and `reflect`, the operations GLSL and WGSL have built in. On a GPU each is
the vector operation it describes (COMPILER.md "Vectors").

`derivative` reads slopes through records of Float64s too: a record's
derivative is a record, each part's derivative, so the slope of
`(t) ↦ magnitude(vec(t, 3, 4))` is read through the Vec. And
`gradient(f)`, for a function of one record of Float64s, is the record of
its derivatives along each part: `gradient((q) ↦ dot(q, q))(vec(1, 2, 3))`
is `vec(2, 4, 6)`, and the normal of a surface `scene(p) = 0` is
`unit(gradient(scene)(p))` (`examples/raymarch`). Like `derivative`, its
result may fail (`Choice`) where a slope can't be read, and the checker
drops the Choice when it can see `f` and read every slope.

### Whole numbers and text, at real sizes

`Int` is the whole numbers, and it **never overflows** (`src/lang/int.ts`).
A value is a JS number while it is small (below 2^28 in size) and a BigInt
beyond, with exactly one spelling per number, so `equal` and hashing stay
right. The bound is that low so a value says whether it is an Int: below
2^28 two different whole numbers are always further apart than `equal`'s
tolerance for Float64s, so `equal` can be near on every JS number, and a
bigger Int is a BigInt, compared exactly. A Float64 that happens to be
whole keeps its tolerance: `√1e17 · √1e17` equals `1e17`, as `√2 · √2`
equals 2 (REVIEW-2026-10-26.md §1.2). This is
NUMBERS.md's stage 1: the meaning is the integers, the representation is
machine numbers with a BigInt fallback. Int literals are ordinary `lit`
nodes with `of: "type.int"` (digits in a string past 2^53). A literal can
be at the other number types the same way: `of: "std.rational"` with a
whole number or `"top/bottom"` (`"6/8"` is 3/4; a zero bottom is an error
the checker names), and `of: "std.complex"` with a Float64, its real part.
They're drawn as written (`1/2`), and before anything runs they become
their constructor's call (`ratio(1, 2)`, `complex(2.5, 0)`; arith.ts), so
`ratio(1, 2) + 1` needs no `as fraction` once the 1 is at Rational. Its operations
have Float64's names (`add`, `multiply`, `less than`, `show`, `range`),
because names are presentation; the types tell them apart, and Int and
Float64 never mix without `as float64` or `whole part`. Where there is no
whole answer there is no answer: `quotient` and `remainder` by zero, a
negative `power`, `whole part` of infinity and `read whole number` of
"007" are `Choice`, not a crash or a NaN. Division rounds down, so
`remainder` has the divisor's sign. Run backwards, Int stays whole: `x · 3
+ 1 = 13` gives 4 and `= 12` gives none, whether it is written with Int's
own operations or the generic ones at an Int literal. The checker plans it
the way it runs, in the relational interpreter, not as Float64's
equations.

Text has `length`, `slice`, `characters`, `split`, `join all`, `find`
(`Choice`: the part may not be there), `comes before`, `character code`
and `character` (`src/lang/text.ts`). Positions count characters, so an
emoji is one. `join all` joins a list in one step, where a fold of `join
text` would copy.

All of these run in the evaluator, the compiler (`$int`, `$impl`, `$many`
in its runtime) and forward in the relational interpreter.

### Order, and sort

`compare(a, b)` answers `before`, `same` or `after` (the std type `Order`)
for any two values of one plain type, the way `equal` answers for any
two: numbers by value (Int, Float64 and fractions), text by code point, cases in the order
their type declares them (`low` before `medium` before `high`, `none`
before `some`, `[]` before any other list), then fields left to right, so
lists go lexicographically. Functions and cells can't be compared, as
they can't be told equal. This is OCaml's `compare` and Erlang's term
order (prior art), with the cases' order taken from the program rather
than from names or hashes. `sort` (prelude) puts a list in that order: a
merge sort (von Neumann, 1945) written bottom-up, as a binary counter of
sorted runs (Okasaki's bottom-up mergesort), so every step is a fold or a
recursion the termination check accepts and its type, `(List a) -> List
a`, has no Diverge. Both run in the evaluator, compiled JavaScript (the
cases' order is written into the program as `$order`) and forward in the
relational interpreter (`run.ts compareValues`), and in WebAssembly and C.

**Float64s are ordered exactly, where `equal` is near.** `equal` lets two
Float64s within about 1e-9 of each other be equal, which an equation over
floats needs (√2 squared is 2.0000000000000004). An order can't do that: if
a is the same as b and b as c, a has to be the same as c, or a sorted list
and a set fall apart (with nearness, three Float64s a step of 1.5e-6 apart
near 1000 made a set of 2 or of 1 depending on the order they came in;
REVIEW-2026-10-26.md §1.1). So `compare` is exact: `compare(0.1 + 0.2,
0.3)` is `after`, though `equal` says they are equal. NaN (from `0 / 0` or
`sqrt(−1)`) comes after every other Float64 and is the same as itself, as
in IEEE 754's totalOrder; −0 is the same as 0, as `equal` says. A map's
keys and a set's items are told apart this exact way, and `equal` on two
maps compares their entries with its own nearness.

### Maps and sets

A map and a set are ordinary data with one spelling (DATA-STRUCTURES.md):

```
Map k v = map of(entries: List (Pair k v))   -- sorted by key, no key twice
Set k   = set of(items: List k)              -- sorted, no item twice
```

The order is `compare`'s, so any plain data can be a key, and keys are
exact: two Float64 keys are the same key only when they are the same
Float64. The prelude
builds them and keeps the spelling: `empty map`, `as map(pairs)` (a later
pair wins), `put`, `remove key`, `value at` (a `Choice`: no answer when the
key isn't there), `has key`, `merge maps`, `keys of`, `values of`,
`entries of`, `map size`; `empty set`, `as set`, `add item`, `remove item`,
`has item`, `set union`, `set intersection`, `set difference`, `items of`,
`set size`. Counting words is a fold that does

```
put(counts, word, first(value at(counts, word), else 0) + 1)
```

Because each map has one spelling, two maps with the same entries are
`equal` however they were built, `show` prints them in key order, and a
fold over `entries of` goes in key order on every target (JavaScript,
Python and Go leave that order to the representation). The operations walk
the list, so each is linear; a weight-balanced tree that stores them in
log n (`src/lang/map-tree.ts`, Adams 1993) is a representation, checked
against them, which the chooser takes for a program that puts and looks up
a lot (choosing it without the program asking is C47). Haskell's
`Data.Map`, OCaml's `Map` and Rust's `BTreeMap` are the prior art.
(`test/maps.test.ts`.)

## Case analysis: `match`

```
constant(expression) =
  match expression
    number(value) → value
    otherwise → fail()
```

An `arm` names a variant and binds one binder per field. A match has either
one arm per variant, or some arms plus `otherwise`. The editor makes the arms
from the type, so **a missing case can't be written**. When a variant is
*added* to a type, `addVariant` (`src/lang/refactor.ts`) adds an arm with a
hole to every match and fold over that type. The program then has new holes,
which are fine, and no missing cases, which would be errors. Adding
`tangent` to `expression` produces exactly four holes, one each in evaluate,
derivative, simplify and display, and each hole already knows its type.

## Loops: `fold`, and recursion the checker can see ends

```
derivative(expression) =
  fold expression
    number(value) → number(0)
    x → number(1)
    product(u, v) with u′, v′ → sum(product(u′, v), product(u, v′))
    sine(u) with u′ → product(cosine(u), u′)
    ...
```

A `fold` is a match where each recursive field also comes with its
*already-folded* value (`u′`). It's always a paramorphism: you get the part
and its result, which is what the product and chain rules need. Unused
binders cost nothing, and a view can hide them. A fold is structural
recursion, so it always ends.

A field can also hold the type inside another one, like a rose tree's
`children: List Tree` (an HTML document, JSON, a syntax tree with argument
lists). Its folded value is the container with each tree replaced by its
folded value, `List R`: the fold is mapped over the container
(`src/lang/nested.ts`, what Coq does for nested inductive types). So
`size(node(v, children)) = 1 + sum(sizes)` is a total fold, and it runs
without the JS stack however wide or deep the tree is.

Plain recursion is allowed too. The checker (`terminates` in
`src/lang/infer.ts`) uses size-change termination (Lee, Jones and
Ben-Amram, 2001): each recursive call says, for each input, whether it is
a parameter passed on as it is or a piece a match took apart from one, and
following every chain of calls that comes back to where it started, some
input must strictly shrink. That accepts one decreasing argument,
lexicographic orders (Ackermann), arguments that swap places and mutual
recursion, and rejects "ping-pong" recursion, where each call shrinks one
argument while growing the other. A let (a dot) is transparent: naming the
smaller piece keeps it the smaller piece.

Two rules make "a piece is smaller" true. Data types are strictly
positive: a type may not take itself as an input in its own fields
(`knot = wrap(f: knot → Float64)` is refused, since through it a function
could call itself without any recursion), while taking itself as an output
is fine (`rest: () → Stream` is lazy data). And only functions can be
recursive: `ones = cons(1, ones)` is refused, so all data is finite.

```
‹for each›(list, action) =
  match list
    nil → unit
    cons(item, rest) →
      action(item)
      ‹for each›(rest, action)        ← rest is smaller than list: total
```

Anything else gets the **`Diverge` effect** in its type. Newton's method
carries it, because nothing in it gets smaller:

```
newton : (expression, expression, Float64) -[Choice, Diverge]-> Float64
```

Change `for each` to recurse on `list` itself and its type, and the type of
`main` that uses it, gain `Diverge`. So termination is inferred like any
other effect, not checked against a promise. The `with fuel(n, action)`
handler turns `Diverge` into `Choice`: after n calls to possibly-divergent
definitions it fails, so `root near` has type `-[Choice]->` and its caller
handles "didn't converge" with `first`, the same way it handles division by
zero.

There are no `while` loops. Library functions cover the usual needs:
`map` and `for each` are structurally recursive, and `keep` (filter) is one
line of `Choice`.

Order: a fold computes the folded values of the children before the parent's
case runs. That doesn't matter for pure code. For effects it means a fold
runs bottom-up, so use `for each` when order matters.

## Types

Hindley-Milner with let-polymorphism at definitions, checked in dependency
order with mutually recursive groups together (`src/lang/infer.ts`). Types
are inferred from the tree and never stored, the same way names and layout
are never stored in `code.json`. Writing them down as annotations could be
added later as a hint layer, keyed by node like everything else.

Because variables are binder ids, there are no shadowing or name-resolution
rules in the checker. The one scope error left is a *reference that sits
outside the lambda or arm that binds it*. That can only come from moving a
subtree, so the checker reports it as "has no value here: it is used
outside the function or case that introduces it".

**Recursive lets.** A let is `(name ↦ body)(value)`, and when the value is a
function it may call itself by the name, and use the inputs of the function
around it (ML's `let rec`, monomorphic inside as there):

    fibonacci(n) = let step = (a, b, k) ↦ k = 0 ? a : step(b, a + b, k − 1)
                   in step(0, 1, n)

It's checked for termination like a definition (this one counts a Float64
down, so it carries Diverge; one that takes a list apart doesn't), and
before anything runs `src/lang/lift-lets.ts` makes it a definition of its own
that takes what it uses from around it first (lambda lifting), so the
evaluator, running backwards and every compiler target see ordinary
recursion. A value that isn't a function still can't use its own name:
`ones = cons(1, ones)` has no first step to take. The palette offers the
name inside the function it names.

**Functions take all their inputs at once.** A lambda has a list of inputs
and a call a list of arguments, on every target and run backwards, so
`f(a, b)` is one step, inputs can be reordered and simplified as a list, and
nothing builds a function per argument. One input at a time is something
you ask for, from the prelude (BACKLOG L87): `curry(f)(a)(b)` is `f(a, b)`,
`uncurry` goes back, `partially(f, a)` gives `f` its first input ahead of
the rest (`map(xs, partially(add, 1))`), and `flip(f)` swaps two inputs.
Each keeps `f`'s effects in its row. Haskell curries every function and
ML-family languages mostly do; Haskell's Prelude names `curry`, `uncurry`
and `flip` (prior art).

**Interfaces and implementations** (INTERFACES.md, BACKLOG L40e). An
interface is a record of functions over one type, marked as one, and its
fields are its operations:

    interface Halving a = halving(half: (a) -> a, twice: (a) -> a)
    halving at pair = halving(half pair, twice pair)
    quarter(x) = half(half(x))          // (a) -> a where a has Halving

An implementation is an ordinary definition of the record at one type, and
a type has one of each. A use of `half` at a type with none is an error at
the use. A second implementation is an error too. Before anything runs,
arith.ts copies `quarter` once per type it is used at, and makes each
`half` a direct call of that type's own function, so nothing is looked up
while the program runs. An implementation passed as a value and taken
apart with a match is the dispatch you ask for. Prior art: Haskell's type
classes (Wadler and Blott, 1989) and Rust's traits, `dyn` on request.

## Effects, and why not monads

A function type is `(params) -[effects]-> result`. The effect part is a row:
a set of effect ids, plus an optional row variable for "whatever the caller
does". That variable is what makes higher-order code work with no extra
machinery:

```
map  : (List a, (a) -[e]-> b) -[e]-> List b
keep : (List a, (a) -[Choice, e]-> Bool) -[e]-> List a
```

`map` is pure when its function is pure, and prints when its function
prints. With monads you'd need `map` and `mapM`, plus a transformer stack
whose order changes the meaning. Rows are sets, so they compose in any
order, and nothing about effects shows up in the code: it's all in the
inferred type. (This is the Koka/Eff/OCaml 5 line of design, cut down.)

A function kept **inside data** has its row written in the type, closed:
`type UI = text(shows: () -[Cells, Diverge]-> Text) | …`. A field's
function type that lists no effects is pure. So a function put in a field
can't hide what it does: taking it out and calling it has exactly the
effects the field says. (Before, each use of the type gave the field a
fresh row, and a printer could be put in a field and called back out
under a `Choice` with no error.) Data types have no row variables, so a
type can't be "pure when its function is pure" the way `map` is; a field
lists the most it allows.

A function in a variable whose row ends up **closed** that way (a page
field's `view`, once it has been shown in a text) does those effects and
no others, so each later use of the variable gets an open copy: it can be
called, or handed to `inverse`, where more happens. A definition whose own
row comes out closed gets the same at each use: a handler that parks its
continuation in such a field (Tumble's `parked`, whose `Chain.rest` says
only `Diverge`) does `Diverge` and nothing else, and a page handler that
does much more may still call it. Only the outer row
opens; its parameters keep their types. This is Koka's `open` (Leijen,
"Type directed compilation of row-typed algebraic effects"). Uses are
checked in order, so a use that fixes the row to something wider before
the closing use still clashes with it.

The effects:

| effect | operations | handled by |
|---|---|---|
| `Choice` | `one of(list)`, `fail()`, `value of(optional)` | `first(action, fallback)`, `all(action)`, `count(action)`, `optional(action)` |
| `Console` | `print(text)`, `print error(text)`, `read line()`, `read input()` | a match; at the top, the runtime |
| `Files` | `read file`, `write file`, `add to file`, `file exists`, `list folder` | a match; at the top, the runtime |
| `Network` | `fetch text(url)` | a match; at the top, the runtime |
| `Abort` | `abort(reason)` | a match with an `abort(reason)` case; at the top, the run ends (exit code 1) |
| `Log` | `log(line)` | a match with a `log(line)` case; at the top, standard error |
| `Random` | `random()` | `seeded(seed, action)`, or a match; at the top, the world's randomness |
| `Time` | `now()` | a match (a test's fixed clock); at the top, the clock |
| `Wait` | `wait(milliseconds)` | a match; at the top, the runtime (not in a page) |
| `Diverge` | (any recursion the checker can't see ends) | the runtime, or `with fuel(n, action)` |
| `Cells` | `cell(x)`, `formula(action)`, `each(items, f)`, `each of(list, f)`, `read(c)` | the runtime (see "Cells" below) |
| `Update` | `write(c, x)` | the runtime; a world effect, like `Console` |
| yours | the operations you declare | a match on them |

`Console`, `Files` and `Network` are declared in std like `Random`
(HOSTS.md, L55). A program calls the builtins (`print`, `read file`, …),
whose types also say they may `Abort`; each performs its effect's
operation, so a match on that effect's operations answers it, and what
nothing handles goes to the world as before. A test collects what was
printed, or gives `read file` a file of its own. As for any effect, the
match has a case for each operation, and a case that calls the builtin
again passes it on, since a case runs outside its match. Only `Choice`,
`Diverge`, `Cells` and `Update` are still built in. Compiled to
WebAssembly or C, a match on these isn't supported yet (only operations
that never return are), and the checker's targets refuse it.

Two rules make this checkable. A definition's own value must be pure, and
anything that acts is an action, a function with no inputs. `runMain`
accepts an action only if its remaining effects are ones the runtime handles,
so an unhandled `Choice` at the top is reported before anything runs.

### Effects you define

An effect is declared exactly like a data type, with one flag: its cases are
its *operations*, and each case's fields are what the operation is given.
An operation either returns a value of a declared type, or never returns:

```
effect Ask   = ask(question: Text) returns Float64
effect Abort = abort(reason: Text)                  -- never returns (std)
effect Log   = log(line: Text) returns Unit          -- std
```

Calling an operation performs it: `ask("width")` has type
`Float64` and adds `Ask` to the caller's row, so a function that asks is
`() -[Ask]-> Float64`. Handling it is a **match on the operations**, with the
computation that performs them as the value examined:

```
match width() + height()
| ask(question) → if question = "width" then 30 else 12      -- the answer
```

```
match show(check(n))
| abort(why) → "refused: " ++ why                            -- the value of the match
```

That is OCaml 5.3's effect cases in `match` (`match f () with effect (Ask q), k -> …`),
minus the continuation `k`, and it's why there is no new node kind: a
handler is a match, an operation is a case, performing is calling. The
match's value is the computation's value when it finishes normally. Each
case runs *outside* its handler (deep handlers), so a `Log` case that logs
reaches the next handler out, and in the end the runtime.

A handler may also say what its normal finish gives, in the match's
`otherwise` slot, as a function of the computation's value. That lets the
handler change the result's type (OCaml's value case, L57):

```
match half(n)
| abort(why) → none
| done(x)    → some(x)                                       -- Optional Float64
```

The compiled JavaScript runs it, except beside an operation answered
later; WASM and C refuse it with a reason for now.

The continuation isn't a value, on purpose. Every operation is one of two
shapes, and those two cover what programs need (errors, configuration,
logging, IO, mocking IO in tests) without first-class continuations:

- **It returns** (`ask`, `log`): the case gives the answer and the
  computation carries on with it, once. The answer must be one value: a
  case that may give several or none (`Choice`) is an error, so a handler
  can't secretly resume twice.
- **It never returns** (`abort`): the case's value becomes the value of the
  whole match and the rest of the computation is dropped, including any
  alternatives it still had (a cut, like ISO Prolog's `catch/3`).

Both compile to plain JavaScript without capturing continuations: an
answer is a call to the handler's case found on a stack of handlers, an
abort is an exception caught by its match (this is how Koka and Effekt
compile tail-resumptive and abortive handlers). An effect can take types,
as a data type can (L56): `effect Yield a = yield(value: a) returns Unit`,
and a row holds it applied, so `words : () -[Yield Text]-> Unit`, and the
handler's case sees `value` as Text. A function that only passes values on
is generic over them: `pass on(x) = yield(x)` is `(a) -[Yield a]-> Unit`.
This is how Koka, Unison (`{Stream a}`) and Effekt write it. One limit for
now: a function type written inside a data type can name such an effect
but not its argument, which is left open there.

**Answered later** (ANSWERED-LATER.md) is the third shape, for waiting:
`effect Yield = yield(item: Float64) returns Unit, later`. Its case is given
the rest of the computation as a function, `| yield(item) with rest → …`,
which it may resume once, now or later (it can be stored, say in a list of
parked fibers), or drop. The rest has the type `(answer) -[the match's
effects]-> the match's value`, and resumes under the same match. The
checker refuses resuming it twice on one path; once it has been passed on,
a second resume stops the run with that reason. A generator, a page that
waits for a fetch, and a round-robin scheduler of two fibers are each a few
lines in the language (`test/later.test.ts`). The evaluator runs it;
compiled JavaScript does not yet (C40). This is Koka's `ctl` with OCaml 5's
one-shot continuations.

Errors with reasons are now `Abort` (REVIEW.md §4.3): `read file` aborts
with "no such file: notes.txt", and `Choice` stays reason-free, for search.

### `Optional`: the data form of Choice

`Choice` is how absence is *computed*; it can't be stored in a record or a
list. `Optional a = none | some(value: a)` is how it's stored, and two
functions cross between them: `optional(action)`, the at-most-one sibling of
`all` (the first answer as `some(answer)`, or `none`), and `value of(o)`,
which is `Choice` again. There is still no null: `none` is a case you
match on.

### `Outcome`: the data form of Abort

`Abort` has a reason but, on its own, can't be stored either: a batch
import that should keep going past a bad line, or a form with several
fields, wants "this one failed, and why" in a list. `Outcome a = done(value:
a) | refused(reason: Text)` is how it's stored, and the same two crossings:
`attempt(action)` runs the action and gives `done(answer)`, or
`refused(reason)` if it aborted (its type takes `Abort` out of the row,
`(() -[Abort, e]-> a) -[e]-> Outcome a`), and `value or abort(o)` is the
`Abort` again. Both are prelude definitions over an ordinary match with an
`abort(reason)` case. So the whole error story is: `Choice` for no answer,
`Abort` for a reason, an effect you declare for a typed error, and each
with a data form. Rust's `Result` and `?` are the influence; the
difference is that here the effect is the default and the data the
exception. (`test/outcome.test.ts`.)

### The world and Choice

`count(() => x = one of([1, 2, 3]); print("trying " ++ show(x)); fail())`
used to print three lines and return 0: printing on a path that was then
abandoned still happened. With files or payments that is a bug factory. So
the **world effects** (`Console`, `Files`) may not run while a `Choice` is
open: a function that does both is an error ("this does Console while a
Choice is open … handle the Choice first and act on its result"), and so is
handing a world action to something that runs it under `Choice`
(`first(say, …)` where `say` prints). Handle the search first, then act on
its result. `Log` isn't the world (it is debugging output), so it may run
anywhere, searches included.

The rule comes from the types. The function a search runs (`all`, `count`,
`first`, `optional`) has an effect row of its own, and that row may not take
`Console`, `Files` or `Update`: binding one there is a type error, wherever
the effect comes from (a call in the thunk, a printer taken out of a list, a
function passed down from a caller). The search's row is *contained in* the
row of the call, not equal to it: whatever else the searched function does
(`Abort`, `Log`) the call does too, but the code beside the call may print
freely, and `first`'s default, which runs after the search, may act.
A definition whose own effects include both an unhandled `Choice` and a
world effect is an error too, since its caller handles the `Choice` around
the whole call.

A function that runs a search on what it is given says so in its type, and
its pin keeps it: `keep`'s predicate row may not take the world, and is
contained in `keep`'s own row (tests: "a printer taken out of a list and
called under a search is refused", "a pinned library function that searches
keeps the rule and passes its function's effects on"). This replaced a walk
over each function's calls (`worldUnderChoice`), which missed a function
held in a data structure (EFFECTS-REVIEW-2026-10-24 §2.1). Rows contained in
other rows are Koka's subeffecting and row openness (Daan Leijen, "Type
directed compilation of row-typed algebraic effects", POPL 2017) used for
one more constraint, like `plain`; refusing the world inside a search is
what Verse does for code that may fail (its `<transacts>` effect), here
written as a row that can't hold the world (influence).

### The world

The world effects have one handler, the runtime's `World` (`run.ts`): the
evaluator takes one (`Runtime.world`), and `src/lang/world.ts` is Node's.
Operations that can fail (`read file`, `write file`, `list folder`,
`read input`) abort with the reason, at the place they were called, so an
ordinary `match … | abort(why) → …` catches a missing file. A command-line
`main` takes the arguments as `List Text` and returns the exit code
(`runProgram`); an `Abort` nothing handles prints its reason to standard
error and exits with 1. Command-line arguments aren't an effect: they're
`main`'s input.

### Random

`Random` is an effect declared in std like any other, with one operation:
`random()`, a Float64 in [0, 1). There are three ways to answer it:

- `seeded(seed, action)` runs `action` with numbers that are the same on
  every run for the same seed (xoshiro128** by Blackman and Vigna, seeded
  with SplitMix32: `src/lang/random.ts`). The evaluator and compiled code
  use the same generator, so they draw the same numbers bit for bit, which
  is what makes a program that rolls dice testable.
- A match answers it like any operation that returns:
  `match roll() | random() → 0.5` is a die that always lands in the middle.
- What nothing handles, the world answers, from the platform's
  cryptographic randomness (`World.random`).

`Random` is not a world effect: drawing a number changes nothing outside
the program, so a search may draw (`all(() => x = one of(xs); random() <
0.5 …)`). Under `seeded`, each alternative takes the next numbers, depth
first, and an abandoned alternative doesn't give its numbers back.

Run backwards (`relate`), `seeded` only reads forward: once its seed and
action are known, the action runs with the same generator, so a function
like the dice page's `a hundred rolls(seed)` agrees in both directions.
Finding a seed from its rolls would mean searching the seeds, which it
doesn't do.

### Time

`Time` is a std effect with one operation, `now()`: milliseconds since
1970 (UTC), as a Float64. `Wait` is another, `wait(ms)`, which pauses the
program. Like Random, neither is the world: reading the clock or pausing
changes nothing outside the program, so both may run under `Choice`, and
a match can answer them (a test fixes the clock with `match … | now() →
0`, and skips the pauses with `| wait(ms) → unit`). What nothing handles,
the world answers (`World.now`, `World.wait`; Node's wait sleeps without
spinning).

There is no tick or timer operation. In a page, the clock is a cell the
browser writes on every animation frame, once something has read it, and
`now()` reads that cell. So a part that shows the time runs again each
frame, and nothing else does (`text(() => show(floor(now() / 1000)))` is a
seconds counter; its text changes once a second, because a watcher only
sets what really changed). This is a time-varying value, the idea of Fran
(Elliott and Hudak, 1997) and of Elm's time subscriptions, falling out of
the cells a page already has. A page can't `wait`: `Wait` isn't in its
rows, so a part that waits is a type error.

### The web

`fetch text(url)` is the body of an HTTP GET, as Text. It has the
`Network` effect and aborts with the reason when there is no body to be
had (no connection, a status that isn't 2xx), so a `match … | abort(why)
→ …` around it is how a program says what to do then.

`Network` isn't a world effect, so a search may fetch. A GET reads and
doesn't change anything (RFC 9110 calls it *safe*), and the runtime
fetches each address once per run and remembers the answer, failures
included. So a search that backtracks never asks a server twice, and an
address read twice in one run gives the same text both times.

On the command line the program waits for the reply (Node's world hands
the request to a child process and blocks on it). A page can't wait, so
in a page `fetch text` asks and, until the reply lands, *suspends*: a view
that fetched keeps what it shows and runs again when the reply comes, and
an event handler runs again from the start with the same event. The run
that stopped at the fetch is taken back first: its writes to cells and
files are undone and its printing never happens (`attempt` in
`src/lang/cells.ts`, software transactional memory's retry), so a handler
may write before it fetches and each write still happens once, as a path a
search abandons leaves nothing behind. Resuming the handler where it
stopped, instead of running it again, is L59. This is Solid's `createResource` and React's Suspense, built from
the cells a page already has (`Pending` in `src/lang/cells.ts`). A view's
row has no `Abort`, so a view that fetches has to catch it and show
something; a handler may let it go (the page logs it).

### Cells: reactivity and values on demand

Is this effect system the same thing as Solid.js's reactivity? In one
precise sense, yes. In Solid (Ryan Carniato, https://www.solidjs.com),
reading a signal inside an effect or a memo records a dependency through a
global "current listener"; writing the signal runs again exactly the
effects and memos that read it. Seen through effects, reading is an
*operation*, and the tracking context is its *handler*: the code that
reads doesn't say who is listening, the nearest handler around it decides.
A deep handler's dynamic scope is that "current listener". So the language
has one more effect, with its handler in the runtime (`src/lang/cells.ts`):

```
cell    : (a) -[Cells]-> Cell a                       -- Solid's createSignal
formula : (() -[Cells, Diverge]-> a) -[Cells]-> Cell a  -- createMemo, lazy
read    : (Cell a) -[Cells, Diverge]-> a              -- reading either
write   : (Cell a, a) -[Update]-> Unit                -- the setter
```

The handler records, for every formula and every *watcher* (Solid's
`createEffect`; the page that shows a program makes one per changing part),
which cells it read on its last run. A write marks the readers dirty and
their readers "check"; nothing is recomputed until it is read, and a
"check" formula recomputes only if a source's value really changed. That is
Milo's "Reactively" algorithm ("Super-charging fine-grained reactive
performance", 2022), credited in the code. Dependencies are found while
running, so a branch not taken isn't tracked: a text that shows the count
only when details are on stops running when the count changes while
they're off.

What the types add over Solid:

- **A view can only read.** `text(() => show(read(count)))` is
  `() -[Cells]-> Text`. A button is `() -[Cells, Update]-> Unit`.
- **A formula can't write.** Its action's row is closed, `[Cells,
  Diverge]`, so `formula(() => write(…))` is a type error. Solid warns
  about writes in memos at run time; here they can't be written.
- **A list mapped item by item.** `each(items, f)` is a formula over a
  cell's list that keeps what `f` made of an item still in the list, and
  maps only new ones; each item's `f` runs in an owner of its own, so a
  cell it makes lives as long as the item. It is Solid's `mapArray`, which
  `<For>` is built on (prior art), and the html module's `for each` is it.
  `each of(list, f)` is the same over a list inside a cell's value, as a
  row of `each` has it (its item's steps): only that list's rows are made
  or moved when it changes, and the row it's in stays as it was.
- **No writes on abandoned paths.** `Update` is a world effect, so a write
  under an open `Choice` is the same error as printing there. Reading isn't
  world, so a search may read cells.
- **`Cell a` isn't plain data.** Two cells holding the same value are two
  cells, so cells can't be compared or shown, and neither can data holding
  them.

**Values on demand are the same handler.** A formula runs when first read
and is kept until a cell it read changes: with no cells to change, that is
call-by-need, Haskell's laziness. So data with a `Cell` in a field is lazy
data, computed once, which is what NUMBERS.md wanted for infinite
continued fractions:

```
type CF = end | term(whole: Int, rest: Cell CF)
square root(n) = … term(a, formula(() => root terms(…)))
```

Reading more terms reads more `rest` cells; each one runs its formula once.
Gosper's arithmetic on these (`plus`, `minus`, `times`, `over`) is an
ordinary program in `src/lang/cells-programs.ts`, and showing one more term
of six numbers runs about nine formulas and watchers instead of
recomputing them. Adapton (Hammer, Phang, Hicks, Foster, PLDI 2014) is the
paper that made "demand-driven" and "incremental" one mechanism; this is a
small version of it.

Both programs run live at
[reactive.html](https://ersagunkuruca.github.io/language-lab/reactive.html) (built by
`editor/build.ts` from `editor/reactive.ts`). The page is a value: `main`
runs once and returns std's `Html`, like every page (WEB.md), whose
changing parts are functions; `src/lang/html.ts` puts each one in a
watcher, so a change touches only its own element. That is Solid's
compiled JSX, as data. `button`, `row`, `entry`, `slider` and the rest are
definitions in the program that build elements.

What is deliberately not there, and why:

- **No handler for Cells written in the program.** The handler keeps
  state (values, readers) and handlers in the language have neither state
  nor continuations, so it is the runtime's, like `Console`'s. A program
  can't swap it for, say, a server-side renderer that answers every read
  with the initial value; with handler state that would be one `match`.
- **`read` says `Diverge`.** A formula's action runs at some later read,
  so its effects can't show up where it was made. It may have `Cells`, and
  `Diverge`, because a lazy producer of endless data (`√2`'s terms) is
  recursion the checker can't see end. So `read` may not finish, and its
  type says so: everything that reads a cell is `Diverge` too, the way
  everything that calls a possibly endless function is. (Before the second
  review, `read` hid it, and a page could hang with a total type.) A page
  handles it: each update (a text, a part, an attribute, a handler) runs
  under a step budget, the same count as `with fuel`, a million calls into
  definitions not proven to end. One that runs out shows "didn't finish"
  in place of its text or part, and runs again when a cell it read
  changes; a handler that runs out stops, keeping the writes it made. A
  check for *guarded corecursion* (each step builds a `term` before
  recursing, under a `formula`) would give productive producers no
  `Diverge` at all; it isn't written yet.
- **Compiled, Cells runs on the same handler.** The compiler turns
  `cell`, `formula`, `read` and `write` into calls on one `Cells` instance
  in its runtime (cells.ts), so a compiled program updates and remembers
  exactly as the evaluator does.

### Where effects go

A function's effects show in the type of whatever calls it, all the way up
to `main`. A few places take some away on purpose, and these are all of
them. Each calls one function, `discharge` (`src/lang/ledger.ts`), and this
table is generated from those calls (`npm run ledger-table`), so a new
place (a profile, a runtime handler, a builtin that runs what it's given)
is a new row, added on purpose. `test/ledger.test.ts` checks that each
builtin's type takes away exactly what its row says.

| where | takes away | why |
|---|---|---|
| a match on an effect's operations | any effect declared with operations (Abort, Log, Random, your own) | a case for each operation says what it does: the handler |
| a page's event handler | Cells, Update, Console, Files, Abort, Diverge, Time, Network, Random, Log | the page runtime runs a handler when its event comes, under a step budget, and logs an Abort; a log line goes to the browser's console |
| a page's text, part or attribute value | Cells, Diverge, Time, Network, Log | the page runtime runs a view in a watcher, under a step budget, after main has returned; a log line goes to the browser's console, once per run |
| a program's main | Console, Files, Update, Cells, Diverge, Network, Log, Abort, Random, Time, Wait | the runtime handles them around main: the world, cells, the clock and the web; an Abort ends the program with its reason |
| a shader | Diverge | only under a literal with fuel, which gives each pixel a step budget |
| a sound's block function | Cells, Update, Random, Diverge | the audio runtime runs it on each block, under a step budget, with Random seeded; a block that doesn't finish plays silence |
| a sound's maker | Cells, Diverge | the audio runtime runs it once to get the block function, and in a page once more in the audio thread, so it may only make cells |
| all, count | Choice | every answer, collected into a list or counted |
| first | Choice | the first answer, or the default when there's none |
| formula, each | Diverge | a formula runs when it's read, so read has Diverge instead |
| optional | Choice | the first answer as some(answer), or none |
| seeded | Random | the same numbers for the same seed, from a generator in the program |
| with fuel | Diverge | at most n calls that may not end, then no answer: Diverge becomes Choice |

### How it runs: no stack limit

The evaluator (`src/lang/run.ts`) is a small machine, not a recursive
interpreter. What is left to do after the current expression (the
continuation) is a linked list of frames on the heap, and every choice
still open is a choice point holding that continuation. So recursion depth
is limited by memory, not by the JS stack: summing a million numbers by
`fold` or by plain recursion both work (`test/scale.test.ts` pins 200,000;
`node bench/limits.ts` times up to a million). A frame is never changed
after it's made, which is what lets a choice point resume it later.

### Choice: Verse, Prolog, `null`, and the solver's branches are one thing

Evaluation produces a lazy stream of results (`src/lang/run.ts`). Pure code
produces one. `one of` produces several, `fail` produces none, and a call
runs once for every combination of its parts' results. The handlers consume
the stream: `first` takes the first result and otherwise runs the fallback,
`all` collects every result, and `count` counts them. Some things this one
mechanism covers:

- **Search.** Eight queens is a fold over the rows that picks
  `one of(range(size))` for each row and fails if the queen isn't safe.
  There's no search code. `first` gives one board, `count` gives 92, and
  `all` gives every board.
- **Absence.** There is no `null` and no `Option`. "Might not have a value"
  is `Choice` in the type, and the caller must handle it, because an unhandled
  `Choice` can't reach the top. `evaluate` fails on division by zero instead
  of returning NaN, and `main` prints "undefined" via `first`.
- **Pattern matching by choice.** `constant(e)` is "the number inside, or
  fail". `simplify` uses it as
  `first(() => number(constant(l′) + constant(r′)), () => …)`, which reads as
  "if both sides are constants, add them, else…". That's Verse's failure
  context, using nothing beyond the three operations above.
- **Canonical answers.** `first` is the canonical answer, just as the
  solver's first branch is `sqrt(4) = 2`. The `invertible/` solver now
  exposes `results(rel, known)` as a lazy stream ordered canonical-first, so
  a solved relation can become a function with the `Choice` effect: each
  solver branch is one choice. That join isn't made in code yet; it's the
  obvious next step.


### The command line: `lab`

`cli/lab.ts` (also `npm run lab --`) runs a program saved by the editor,
or a folder of side tables like `examples/wc`:

```
node cli/lab.ts run examples/wc notes.txt todo.txt     # the evaluator
node cli/lab.ts compile examples/wc -o wc.mjs          # a JavaScript module
node wc.mjs -l notes.txt                               # same output, same exit code
node cli/lab.ts check examples/wc                      # errors, and each definition's type
```

`examples/wc` is the proof: a word count written in the language, after
Unix `wc` (Version 1 AT&T Unix, 1971; the options and layout follow GNU
coreutils `wc`). It counts lines, words and characters in one fold over a
file's characters, takes `-l`, `-w` and `-c`, reads standard input when
it's given no file, and prints `wc: no such file or folder: x` and exits
with 1 when a file is missing. The missing file is an `Abort` from
`read file`, caught by a match in `count files`. Its counts match `wc`'s
(`test/cli.test.ts`). Run by the evaluator it counts 200,000 lines in about
25 seconds, and compiled in about one.

### Pages: web apps

A page is a program whose `main` takes nothing and returns an `Html`,
an ordinary data type in std (WEB.md has the design and the reasons):

```
row  View      = Cells, Diverge, Time, Network, Log
row  Handler   = Cells, Update, Console, Files, Abort, Diverge, Time, Network, Random, Log
row  Sound     = Cells, Update, Random, Diverge
type Html      = element(tag: Text, attributes: List Attribute, children: List Html)
               | text(shows: () -[View]-> Text)
               | part(view: () -[View]-> Html)
type Attribute = property(name: Text, value: () -[View]-> Text)
               | on(event: Text, then: (Event) -[Handler]-> Unit)
               | listen(to: Input, play: (List Float64) -[Sound]-> List Float64)
type Event     = event(value: Text, key: Text)
type Input     = microphone | recording(address: Text)
```

`View`, `Handler` and `Sound` are named rows in std (HOSTS.md, L58): what
a host lets the functions it runs do, written once as a definition. Each is
the ledger's list (below), so the type and the runtime can't disagree. A
type shows a row by its name where the name was written, and only while it
has exactly those effects. A function that happens to do Cells and Diverge
isn't shown as anything but that. Koka's effect aliases are the prior art.

`listen` plays a sound (AUDIO.md) when its element is clicked, and stops
it when it's clicked again: the input, a block of 128 samples at a time,
through `play`, to the speakers. `play` runs on the audio thread, where
main runs once more to make it; cells main made are the same cells there,
so a handler's write to one (a knob) reaches the sound as it plays. So a
page with sound keeps main to making cells: no clock or random numbers
there.

Pages are written with the **html module** (`library/html.json`, built
from `src/lang/html-source.ts`), ordinary functions that build these
values. Each tag is a function of its children (`p([words("Hello")])`,
`section`, `h1`, …, and `tag(name, children)` for the rest); text that
doesn't change is `words(t)`; attributes are added by wrapping:
`styled("color: #777", p(…))`, `classed("lead", …)`, `named("roll", …)`,
`with([attribute(name, value), on(…)], …)`. `button(label, then)` is a
button with a click handler. `for each(items, row, ul)` draws a cell's
list and keeps the row of an item that's still there when the list
changes, with whatever the row holds, as Solid's `<For>` does (prior art).
A style sheet is a list of rules,
`style sheet([rule("h1", "font-size: 28px"), media("(prefers-color-scheme:
dark)", […])])`, which a program keeps as a definition of its own. Each
tag a function is Elm's Html module (prior art), markup as plain data is
Hiccup's.

`main` runs once; each function in the value runs in a watcher of the
Cells handler, so a write re-runs only the texts, attributes and parts
that read that cell (Solid.js's model, no virtual DOM). The rows are the
guarantees: a view can't write or print, a handler can't leave a search
open around a write. In the browser, `print` goes to the console and
files are `localStorage` entries named after the program. A view that
reads `now()` runs again every animation frame ("Time" above), and one
that fetches shows its reply when it lands ("The web"). Handlers may draw
random numbers; views may not, since they run again whenever a cell they
read changes, and a different number each time isn't a view. Both may `log` (to the console; a view logs each time it runs).
`examples/dice`, live at
[apps/dice.html](https://ersagunkuruca.github.io/language-lab/apps/dice.html),
uses all three: Roll draws from the world, "Roll 100 with seed 7" adds the
same hundred rolls every time (`seeded`), and the status line counts the
seconds since the last roll by reading `now()`.

```
node cli/lab.ts build-web examples/converter -o converter.html   # one HTML file, nothing else
node cli/lab.ts run examples/converter > static.html             # the page drawn once, as static HTML
```

`examples/converter`, live at
[apps/converter.html](https://ersagunkuruca.github.io/language-lab/apps/converter.html),
is the proof: ten fields over three quantities, where each field is the
function that shows it (`as °F(c) = show(c × 9 / 5 + 32)`) and typing
in it runs that function backwards (`solve as °F(out = text) for c`).
Text the function can't produce, like `hot` or `68.0`, has no answer, so
the field is marked and nothing changes. The evaluator and the compiled
page draw and react alike (`compiler/test/web.test.ts`).
## Relations inside programs: `solve`

A `solve` node uses a function in the direction chosen where it's used.
The function can be any definition (a predicate like `polar` is solved with
its result given as `true`, see "One world" below), or a numeric builtin
read as `out = f(…)`. The node's
`given` ports are computed by expressions. Its `binds` ports are solved for
and bound to binders the body can use, all from the same solution, so several
outputs stay consistent with each other (`src/lang/solve.ts`,
`examples/relations`):

```
‹to polar› : (Float64, Float64) -[Choice]-> Pair Float64 Float64
‹to polar›(x, y) =
  solve polar(x = x, y = y) for length, angle
    pair(length, angle)

‹square roots› : (Float64) -> List Float64
‹square roots›(y) = all(() => solve square(result = y) for x → x)
```

A definition can name its results (RESULTS.md): `polar(x, y) → length,
angle = …` is still the predicate over four ports, and says that given x
and y it gives length and angle. A use in that direction reads as the
results side by side, `length, angle = polar(x, y)`, and is the same solve
node underneath. The checker says at the definition when its inputs can't
pin its results down. Another definition can give a relation's other
direction (POLAR.md): `unpolar(x, y) → length, angle = √(x² + y²),
atan2(y, x)`, marked as a direction of polar, answers every solve of polar
given x and y, with one answer instead of a search. Trig's own `polar`
works the same way at any number type: `length, angle = polar(x = 3, y =
4)` is answered by that type's `unpolar`, because unpolar is a field of
the same interface over the same four ports, read the other way.

The effect comes from the solver's static `direction()`. Exactly one answer
that can't fail is pure: the missing addend of `+`, for instance. Several
answers, or possibly none, is `Choice`, a lazy stream with the canonical
answer first. A direction that the given ports don't determine is a checked
error ("needs 1 more known port"). So `square` read backwards gives both
roots of 9 under `all`, none for −1, and `2` under `first`. That's the
"x² = 4 has a canonical answer" idea from the original pitch, written as a
program.

### Beyond arithmetic

`solve` isn't limited to arithmetic. A function with cases, folds, text or
data in it is run backwards by the relational interpreter
(`src/lang/relate.ts`): an `if` becomes a choice over its arms, a fold
becomes an unfold, `join text` enumerates the ways to cut its result. Its
type is `Choice`, plus `Diverge` when it might unfold forever. Printing
can't be run backwards, and the checker says so. A function given as a
port (`solve applied(f = view, out = text) for x`) brings its effects in
with it, as a call would; the prelude's `inverse(f, y)` is that solve, so
any function value can be run backwards. `show numbers` run backwards is
a parser:

```
‹read numbers›(text) = with fuel(10000, () => solve ‹show numbers›(result = text) for numbers)
```

The full table of what each node does backwards, and what can't be done
and why, is in [BACKWARDS.md](BACKWARDS.md). So is the calculus example,
which differentiates real functions by reading their graphs.

## One world: a network is a predicate

There used to be two kinds of definition. Functions had a direction:
arguments in, result out. Networks had none: a graph of relations (`polar`,
`sum`, `product`) wired together, with outer ports you marked known or
unknown, solved by `invertible/`. They had their own node kinds (`network`,
`part`), their own editor, their own evaluator (`eval.ts`) and checker
(`check.ts`), and units existed only there. Now there is one kind.

**A network is a function that returns `Bool`.** Each wire is an `equal`,
`and` collects them, and the outer ports are the parameters. Solving it
means asking for values of the unknown parameters that make it `true`:

```
fall(distance m, speed m/s, gravity m/s², time s) =
  drift = speed · time
  drop = 0.5 · gravity · time · time
  equal(distance, drift + drop)

polar(x, y, length, angle) =
  and(equal(x, length · cos(angle)), equal(y, length · sin(angle)))
    hence equal(x · x + y · y, length · length)

rotate(x, y, turn, x′, y′) =
  for some length, angle:
    and(polar(x, y, length, angle), polar(x′, y′, length, angle + turn))
```

Those are `examples/physics`. The pieces:

- **`equal` is a wire.** One equation. Float64s are equal when they agree to
  1e-9 relative (`close` in `run.ts`), forward and backwards and compiled,
  because a wire in a network meant "these are the same quantity", and
  `0.1 + 0.2` should be the same quantity as `0.3`. Only a finite gap is
  near: ∞ equals ∞ alone, not −∞, 0 or 1e308 (BACKLOG L81). The cost is that `equal`
  on numbers isn't transitive at the 1e-9 scale. Bit-exact comparison is a
  different question and should get its own name when something needs it.
  Two whole numbers are the exception: they're equal only when they're the
  same number, so an `Int`, which is a count, is always compared exactly.
  That is one rule for every type (`sameNumber` in run.ts), so it doesn't
  matter whether the checker knew the type or a generic function compared
  a type variable (NOTES.md, "Equality: one rule").
- **A let is a dot on a wire.** `drift` names a sub-expression. Lets of
  non-numbers (a `Bool`, a function) are read where they're used, so a dot
  anywhere leaves the equations as they were.
- **`for some` is a wire inside.** `rotate`'s `length` and `angle` aren't
  ports, so they can't be parameters. `for some` takes a function and says
  some argument makes it true. Read as equations, its parameters are fresh
  unknowns; run forward, it searches (`satisfiable` in `relate.ts`). An
  existential is the honest name for an internal wire, and it scopes it:
  two `rotate`s inlined into one predicate get separate `length`s.
- **`hence` is a consequence.** `a hence b` is `a and b` when run, but read
  as equations `b` is a *law*: it follows from `a`, so it may be used to
  solve but doesn't count as a constraint. From `x` and `y`, `polar` finds
  `length` by a square root instead of a numeric search; from `x` alone it
  stays correctly underdetermined (a circle of answers), where adding
  `x² + y² = length²` as a third equation would have made it look solved.
- **Calls inline.** A call to another predicate (`polar` inside `rotate`) or
  to a numeric function is inlined into the equations, so its inside is
  solved too. Nothing is a black box, including `polar`, which used to be a
  built-in relation and is now three lines.

**Running one, any direction.** A function's ports are its parameters and
its result. `solve` nodes and the editor's *Run* panel give some ports and
ask for the rest; for a predicate the result is given as `true`. If the
function reads as equations (`src/lang/equations.ts`), the solver plans the
direction ahead of time, the type checker gets its effect from the plan, and
the compiler writes the plan out as arithmetic. Anything else (cases, folds,
text) goes through `relate.ts`, the one interpreter that runs things
backwards, which hands the same solver whatever arithmetic it meets.

**Where the direction lives.** In a program, in the `solve` node, because
the program needs it. In the editor, as ticks in `layout.json`: exploring a
function backwards is like running a test, not a change to the program.

**Units are part of the type.** They were the type system of networks; now
`infer.ts` checks them in every program (`unitProblems` in `src/units.ts`).
Declare a unit on a parameter, or write a number with one (`9.81 m/s²`), and
the rest is inferred: `period` is in seconds, `drift` and `drop` in metres.
A plain number is dimensionless, so a plain `29.62` where a length is needed
is a type error. Radians are gone as a base unit: an angle is a plain number,
as in SI.

**Where the ideas come from.** Reading a constraint network as a predicate
and running it in any direction is constraint logic programming: Jaffar and
Lassez, "Constraint Logic Programming" (POPL 1987), and Prolog's CLP(R).
Equations between physical quantities as undirected relations is the idea
behind Modelica's acausal modelling (Elmqvist, Mattsson and others,
[modelica.org](https://modelica.org)). The search that runs it backwards is
miniKanren's (Friedman, Byrd, Kiselyov; [minikanren.org](http://minikanren.org)),
with streams as in Hemann and Friedman's μKanren (2013). `for some` is the
ordinary existential quantifier, and units as exponent vectors solved by
linear algebra is Kennedy's dimension types ("Dimension Types", ESOP 1994).
`hence` (a consequence that guides solving without counting as a
constraint) and the editor around it are this project's own as far as I
know.

**What went away.** `network` and `part` (19 node kinds to 17), `eval.ts`,
`check.ts`, `edits.ts`, `relational.ts`, the `polar`, `sumDiff` and `ohm`
relation builtins and the variadic `sum`/`product` atoms, the vectors
example, and the free-wiring network editor with its `+`/`−`/`neg` glyph that
flipped with direction. What replaces the free wiring is the typed editor:
you build a predicate from holes (`equal(□, □)`, `and(□, □)`) and dots, and
every edit is type- and unit-checked. Drawing an `equal` as a plain wire
joining two values, instead of as a node, would bring the network look back
without a second kind of thing; that's a rendering question now, not a
language one.

## Signatures and modules

A program that uses `map` doesn't import it. It has a ref to `map`'s id,
and `map`'s id is its content hash, so the ref says exactly which `map`,
forever. Everything else follows from that one decision, and nothing in it
is a new kind of node. Code: `src/lang/modules.ts`, `src/lang/signatures.ts`,
`src/hash.ts`; the first module is `library/prelude.json`; tests in
`test/modules.test.ts`.

### Drafts have ids; published code is named by its hash

Every node is born with a random id, and while you edit, that's what it
keeps: a draft can change, and everything attached to it (names, comments,
layout) stays attached. **Publishing** a definition renames it to its
content hash: the def becomes `@` and 26 characters (130 bits of SHA-256,
the size of a fresh id), and each node inside it becomes `@hash:n`, `n`
its place in the definition. Publishing takes every draft the definition
uses along with it, and refuses a definition with a hole, an error or no
body: its hash will be its name forever, so it has to be finished.

That makes ids do what they couldn't before (REVIEW.md §4.5):

- **Two copies of a library are one library.** Two people who publish the
  same function, with different names for everything, publish the same
  nodes byte for byte, so putting their code together is a no-op instead
  of a clash. The six examples each carried their own copy of `for each`,
  `map`, `keep` and `show numbers`; their hashes matched the prelude's, so
  `adopt` replaced every copy with a ref to the published one (about 3,600
  lines of JSON gone, and the examples run unchanged).
- **A module can be checked against itself.** `verify` rehashes every
  definition; each must come out as its own id, every node must sit where
  its id says, and every pin must be the type the checker gives. Change one
  number inside `sum` and the module says "sum was changed after it was
  published".
- **Regenerating published code loses nothing.** Publishing is
  deterministic, so building the prelude from the DSL again gives the same
  file, byte for byte (tested). REVIEW.md §4.7's complaint, that rebuilding
  examples from TypeScript makes new ids, is gone for anything published.

The hash had to change for this. A mutually recursive group used to hash
according to which member was asked about first, so the same group could
get two hashes. It is now hashed as a unit the way Unison does it: each
member is hashed with references inside the group left anonymous, the
members are sorted by that, then the group is hashed with those references
numbered by the sorted order. `is even` and `is odd` get the same hashes
whichever is written or asked about first (tested). FNV-64 became SHA-256,
written out from FIPS 180-4 in `src/sha256.ts` so it runs synchronously in
the browser.

### Signatures are pins

Types are still never written by hand. A **pin** freezes the type the
checker inferred for a definition (`signatures.ts`), and makes it an
interface:

- an edit inside the definition must keep the pin, and if it doesn't, the
  error is at the definition: "area is pinned to (Float64) -> Float64, and
  this makes it (a) -> Text". Without the pin the same edit is an error at
  some caller far away (tested both ways);
- callers are checked against the pin, not the body;
- so checking stops at pins. `recheck(code, names, before, changed)` checks
  the changed definitions, then the callers of any whose type moved, and
  so on outwards; a pinned definition's type can't move, so an edit inside
  one rechecks that one definition and nothing else, and gives the same
  errors a whole check would (tested). That is REVIEW.md §2.2's
  incremental checking.

A body may be more general than its pin (the pin promises less) but not
less general, and not with more effects. The pin is checked by unifying
the body's type with the pin's type with the pin's variables held rigid.
Every published definition is pinned, with the type it had when it was
published, and a module carries its pins. A pin is a side table keyed by
id, like names, and the type isn't part of the hash: it's derived from the
content, so the same content can't come with two pins.

### Modules

A module (`MODULE_FORMAT`, `library/prelude.json`) is: published nodes,
the author's names for them, their pins, comments, and **which definitions
it offers**. The rest are helpers. `reverse onto` is used by `reverse`
and kept out of the palette, so a library can have internals without a
`private` keyword: visibility is one more side table, and the checker's
`hidden` option is all it takes (tested).

### Private constructors

Some types have a rule their values must keep: a `Set`'s items are sorted
with none twice, a `Map`'s keys the same, a `Rational` is in lowest terms
with a bottom that isn't 0. The library keeps the rule, and everything
else relies on it (`equal`, `show`, `compare` and folds look at the
spelling). Calling the constructor yourself would skip it:
`set of([3, 1, 3])` would be a set of size 3, `ratio(2, 4)` would not
equal 1/2, and `ratio(1, 0)` would exist (REVIEW-2026-10-26.md §2).

So those constructors are **private**: a flag on the variant, as `later`
is, not a new kind of thing. Only the library that keeps the rule (the
prelude, and the representations that stand for these types, such as the
map tree) may call them. Anywhere else the checker refuses with what to
use instead (`as set`, `as map`, `put`, `fraction`, `as fraction`), and
the palette doesn't offer them; a saved program that calls one is reported
when it opens. Taking a value apart is open to everyone: a `match` on
`set of(items)` reads the items, which keeps the rule. Which definitions
are the library's is the checker's `insiders` option (`checkOptions`
gives the prelude's), like its `pins` and `hidden`.

This is the smallest form of an abstract type: the constructor is hidden,
the type and its pattern are not. OCaml's private types (`type t = private
…`) are the same idea, and Haskell's smart constructors with an
unexported constructor the usual practice (prior art). A quotient type,
equal by the rule rather than by spelling, is the bigger alternative and
isn't needed yet.

Names stay presentation. A module's names are a layer under the
program's, like std's: a program can call `map` "transform" and only that
program sees it, and `adopt` keeps a program's names for adopted code
only where they differ from the module's. A namespace is the same thing:
a name layer. When two modules offer the same display name, the palette
already shows both with their types, and the hash says which is which;
paths like `list.map` would be one more layer, and nothing has needed them
yet.

**Updates.** A new version is a new hash. A module can say which old
definition a new one replaces (`replaces`), and `upgrade(code, old, new)`
moves a program over: every ref, and the ports of every place it's run
backwards. It does it only when the two have the same pin, so nothing that
uses it can break and nothing needs checking again; a changed type is
refused with both types named. Data type upgrades (where constructors and
fields move too) need a migration, which is a next step. How others share and version code (a lineage id kept
for life, a version hash per publish, names pinned per program) is
proposed in [SHARING.md](../design/sharing/SHARING.md).

**The prelude**, the first module, is `for each`, `map`, `keep`, `show
numbers`, `length`, `sum`, `append`, `reverse`, `inverse`, `conjugate`, the
comparisons `at most`, `more than`, `at least` (drawn `≤ > ≥`, over the one
generic `<`, so they work on every ordered number type, run backwards and
differentiate with no rules of their own) and Text's `not after`, `comes
after`, `not before` (over `comes before`), `smaller` and `larger` (min and
max, on every ordered number type too, which a shader compiles to `min` and
`max`; the Float64-only versions published before stay in the prelude,
hidden, so a program saved with them still opens), the
fractions `fraction`, `as fraction`, `divide fractions`, `show fraction` and
`fraction as float64` (a Rational is exact and in lowest terms, and the one
`+ − · <` works on it through the published, unoffered `add fractions`,
`subtract fractions`, `multiply fractions`, `negate fraction` and `fraction
less than`), the complex numbers `as complex`, `i`, `complex conjugate`,
`modulus`, `angle of`, `polar`, `divide complex`, `complex exp` and `show
complex` (a Complex is `complex(re, im)`, a record of two Float64s, so the
parts builtins and the vectors module work on it and a shader holds it as a
`vec2f`; the one `+ − · −x` works on it through the unoffered `add
complex`, `subtract complex`, `multiply complex` and `negate complex`, ·
being the complex product, and it has no `<`), and the helpers `reverse
onto` and `applied`. `inverse(f, y)` is the x that f takes to y:
any function value run backwards, through `applied(f, x) = f(x)`, since
`solve` names a definition. Its type has Choice and Diverge for any f;
called with a function written at the call (a definition's name or a
lambda), the call's type says what running that one backwards does: no
Diverge when the modes say it ends, no Choice when it gives exactly one
answer (`inverse((p) ↦ p + 1, y)` is plain). `conjugate(f, g)` is f⁻¹ ∘ g ∘ f: g done in
f's space, the way back being f run backwards (`examples/conjugate`: an
edit in linear light, a turn about a point, one band of a signal). The
function it gives back is typed the same way from the f it is given:
`conjugate(step, double)` with `step = (x) ↦ x + 1` is a plain function,
`conjugate(double, step)` keeps Choice. It is written once with the DSL in
`src/lang/prelude-source.ts` and
published by `node library/build.ts`, which also moves the examples onto it.
Every program is loaded with it (`src/lang/library.ts`): the editor, the
loader, the tests, the compiler.

**Published code can't be edited.** The editor refuses any edit that would
change a node under an `@` id. Changing a library definition means making a
draft copy of it in your program and, if you like, publishing that: a new
hash, which can `replace` the old one. (The "copy into my program" gesture
is the editor's next step.)

### Files and the compiler

The program file (`editor/files.ts`) is version 2. It still holds only the
program's own nodes, plus two side tables: `needs`, the published
definitions it uses and where they were found ("map from prelude"), and
`signatures`, its own pins. `needs` is not an import list: the refs are
the imports, and opening a file only uses `needs` to say what's missing
("it uses length from prelude, which isn't in any module loaded here").
Version 1 files open unchanged.

The compiler compiles a program together with the modules it uses, into
one file. Identity is by hash, so a definition that two modules share is
compiled once and there is nothing to link; separate compilation, when it
is needed, is a cache keyed by hash (COMPILER.md's step 2 already plans
one), not a module system.

### Where the ideas come from

Naming definitions by the hash of their syntax tree, hashing cycles as a
group in a content-derived order, and names as a separate layer are
Unison's (Paul Chiusano, Rúnar Bjarnason, Arya Irani and the Unison team,
https://www.unison-lang.org/docs/the-big-idea/). Content-addressed stores
in general go back further (Git's object store, Nix's store paths). Pins,
visibility as a side table, refusing upgrades unless the pin is kept, and
adopting copies by hash are this project's.

## The errors, class by class

"Never a syntax error again" holds by construction. Below is every other
class considered, and where each one ends up:

- **Impossible by construction.** The data model can't represent the error.
- **Prevented by the editor.** The model could represent it, but no gesture
  produces it.
- **Inferred.** It isn't an error. The checker works it out and puts it in
  the type.
- **Checked.** Reported where it happens. It can only arrive in code that
  wasn't built by the editor.
- **Runtime.** Can only be found by running the program.

Each row names the test that shows it. The table is generated from
`test/errors.test.ts` (`npm run error-table`), and that test fails when
a row's test is missing or the table here differs from the rows.

| class | status | how | shown by |
|---|---|---|---|
| syntax | impossible by construction | there is no text | no test: the program is a tree of nodes |
| unknown name, typo | impossible by construction | references are ids picked from a list | no test: a reference holds an id |
| name clash, shadowing, capture | impossible by construction | binders are ids; equal names only get a subscript on screen | "two things in scope together can't share a name; cases each have their own scope" (`test/toplevel.test.ts`) |
| field/method name collisions between libraries | impossible by construction | fields are ids | no test: a field is an id |
| wrong number of arguments | prevented by the editor | a call is created with one hole per parameter of the callee's type | "a call made from the palette has one hole per input" (`test/errors.test.ts`) |
| type mismatch | prevented by the editor | typed holes; the palette offers only fillings that type-check, and fillings that would change a definition's type for its callers are confirmed against the whole program | "every filling the palette offers keeps the program free of errors" (`test/lang.test.ts`) |
| missing case / non-exhaustive match | prevented by the editor | arms come from the type; adding a variant adds hole arms everywhere | "a case analysis is created with every case, and a new case reaches every analysis" (`test/lang.test.ts`) |
| unreachable case | checked | `otherwise` when every case is covered is reported | "otherwise when every case is covered is reported" (`test/errors.test.ts`) |
| null / undefined | impossible by construction | there is no null; absence is `Choice` when computed and `Optional` (a case you match on) when stored, and an unhandled `Choice` can't reach `main` | "effects: a definition's value must be pure, and run refuses unhandled Choice" (`test/lang.test.ts`) |
| errors without a reason | checked | `Abort` carries a reason, and effects you declare carry typed ones; a `match` with their cases catches them | "abort ends the computation a match handles, with its reason" (`test/effects.test.ts`) |
| side effects on abandoned search paths | checked | world effects (`Console`, `Files`) may not run while a `Choice` is open (see "The world and Choice") | "the world isn't touched while a Choice is open" (`test/effects.test.ts`) |
| unhandled effect (printing from a pure value, failing with no handler) | checked | effect rows; a definition's value must be pure; `runMain` refuses leftover effects, and a program that doesn't type-check | "effects: a definition's value must be pure, and run refuses unhandled Choice" (`test/lang.test.ts`) |
| effects hidden where a function waits | checked | a function kept in a field, a list, a cell, a formula or a page keeps its effects: they reach the type, are refused, or are the page runtime's on purpose (`test/containers.test.ts` checks 40 cases) | "a function in a field can't hide its effects" (`test/effects.test.ts`) |
| non-termination | inferred | recursion that size-change termination accepts is total; everything else carries `Diverge`, which `with fuel` turns into `Choice`. Data types are strictly positive, and values can't be recursive. Reading a formula carries `Diverge` too, and a page runs each update under a step budget; the shader profile takes `Diverge` only under a literal `with fuel`; running backwards is `Diverge` only when its mode may not end (the same size-change check on the known ports, modes.ts), and spends a step budget, solver answers included | "size-change: a call that keeps every argument the same size is Diverge" (`test/guarantees.test.ts`) |
| arithmetic on records that aren't vectors | checked | `map parts`, `zip parts`, `total` and the vectors module take only records of Float64s, a constraint type variables carry; both sides of `plus` are the same type, so a colour and a point don't add | "adding a colour to a point, or taking the parts of text, is a type error" (`test/parts.test.ts`) |
| comparing functions | checked | `equal` needs plain data (no functions inside), a constraint type variables carry like a type class: `same(x, y) = equal(x, y)` is `(a, a) → Bool` for plain `a` only | "§1.3 equal on functions should be refused, not compare by identity" (`test/known-holes.test.ts`) |
| a derivative that can't be read | runtime, but typed | `derivative`'s result may fail (`Choice`): where the slope can't be read (through `floor`, or data with several cases built from x), there is none; `gradient` the same | "derivative never throws: where a slope can't be read there is none" (`test/guarantees.test.ts`) |
| a direction nothing pins down | checked | the checker works out each `solve`'s mode (modes.ts): when some port or goal never gets what it needs, the search could only end with unknowns left, so it's an error at the `solve` node | "§1.2 a well-typed backwards solve must not throw NotInvertible at run time" (`test/known-holes.test.ts`) |
| running something backwards that only runs forward | runtime, but typed | it waits until its inputs are known; an answer that leaves it waiting isn't pinned down, so it isn't an answer. Solving for a function is refused by the checker | "backwards, derivative and with fuel run forward once their function is known" (`test/guarantees.test.ts`) |
| a value that breaks its type's rule (a set with an item twice, a fraction 2/4 or 1/0) | checked | the constructors of types with a rule (`set of`, `map of`, `ratio`) are private to the library that keeps it: elsewhere the checker refuses them and the palette doesn't offer them; a match can still take the value apart | "a program calling set of, map of or ratio is refused, with what to use instead" (`test/private.test.ts`) |
| variable out of scope | checked | can only come from moving a subtree; reported as a scope error | "scope: a variable moved out of the case that binds it is caught" (`test/lang.test.ts`) |
| incomplete program | allowed | holes have types and the program runs until it reaches one | "a program with a hole runs until it reaches it" (`test/errors.test.ts`) |
| integer overflow | impossible by construction | `Int` is unbounded: machine numbers with a BigInt fallback | "Int never overflows: 2^64 + 1, 30!, and the step from safe integers to BigInt" (`test/data.test.ts`) |
| division by zero | runtime, but typed | `Int`'s `quotient` and `remainder` are `Choice` (no answer); `evaluate` fails instead of returning NaN; Float64's `/` is IEEE (Infinity/NaN) | "Int division rounds down; dividing by zero and a negative power have no answer" (`test/data.test.ts`) |
| other domain errors (`sqrt` of a negative) | runtime | builtins are IEEE; a `Choice`-returning `sqrt` (both roots, or none) is the natural fix | no test: not addressed beyond IEEE |
| unit mismatches | checked | a unit is part of a number's type: dimension vectors (`src/units.ts`), reported by the type checker, so the editor refuses an edit that adds one | "units: declared on parameters and numbers, inferred through predicates and functions" (`test/oneworld.test.ts`) |
| resource misuse (leaks, use after close) | not addressed | proposal: resources exist only inside their handler's scope, so they can't escape (effects again, not linear types) | no test: not addressed |

There's one subtle case. Filling a hole inside a definition can make that
definition's inferred type *more specific*, which breaks callers elsewhere.
`for each` with a hole in its body has type `(List a, b) -> Unit`, and
filling the hole with `action` would pin `b` to `Unit`. That breaks `main`,
which passes a function. The palette detects when a filling pins a variable
of the enclosing definition's type, and confirms those fillings against the
whole program. The test found this case; it's described here because it's
the type-level version of "changing a function's signature".

## The two programs

`examples/queens` (search with `Choice`):

```
queens : (Float64) -[Choice]-> List Float64
queens(size) =
  fold range(size)
    nil → nil
    cons(row, rows) with board →
      column = ‹one of›(range(size))
      if safe(column, board) then cons(column, board) else fail()
```

`examples/algebra` is a small computer algebra system: expressions as data,
with evaluation, differentiation, simplification and printing as folds (so
all four are total), plus Newton's method under fuel. Its `main` prints:

```
f(x)  = x·x·x − x − 1
f′(x) = (x + x)·x + x·x − 1
f(2)  = 5
root near 1: 1.324717957

f(x)  = sin(x) / (x − x)
f′(x) = cos(x)·(x − x) / ((x − x)·(x − x))
f(2)  = undefined
root near 1: none found
```

Printing works out the fewest parentheses from precedence, the same job
`src/render/expr.ts` does for the views. The fold returns the text and how
tightly it binds, and wraps a part only when it has to.

Both programs were first typed in TypeScript through the builder, since
the editor couldn't yet make definitions. The JSON is the program now; it
is changed in the editor, and nothing regenerates it.

## Files

```
src/lang/types.ts     types, effect rows, unification, display
src/lang/std.ts       Bool, Unit, List, Pair as typedef nodes; builtins with signatures
src/lang/infer.ts     inference, exhaustiveness, totality, typed holes, fillings()
src/lang/run.ts       evaluator: results as lazy streams; handlers; runMain
src/lang/cells.ts     the Cells handler: cells, lazy formulas, watchers
src/lang/html.ts      draws an Html value on a page, one watcher per changing part
src/lang/cells-programs.ts  the reactive page and continued fractions
src/lang/refactor.ts  fillHole(), addVariant(): the gestures that prevent errors
src/lang/render.ts    the block view (if/match/fold as indented blocks, types on top)
src/lang/dsl.ts       building programs from TypeScript
src/lang/programs.ts  list helpers through the builder, for tests and benchmarks
src/lang/load.ts      load a program on top of prelude + std
src/lang/equations.ts code as equations: numeric expressions and predicates, for the solver
src/lang/solve.ts     a solve node's plan: solver direction, or run backwards
src/lang/relate.ts    runs any function backwards (BACKWARDS.md)
src/lang/demo.ts      npm run lang
src/lang/modules.ts   publish by hash, verify, modules, adopt, upgrade
src/lang/signatures.ts pins, and recheck (incremental checking that stops at pins)
src/lang/library.ts   the modules every program is loaded with
src/lang/prelude-source.ts  the prelude, written with the DSL; library/build.ts publishes it
src/sha256.ts         SHA-256 (FIPS 180-4), for hashes
```

The model gained `typedef`, `variant`, `field`, `tref`, `tfun`, `match`,
`fold` and `arm` (`src/model.ts`). The nested, let and s-expression views and
`hash.ts` handle them. Recursive definitions now hash, because a reference
back into the group being hashed is named by its position.

## What's next

- **Numbers.** Built: Int of any size, Float64, fractions, complex and
  dual numbers, exact algebraic numbers, Fixed, Clifford tables and
  rotors, one `+ − · <` for all of them through interfaces, and ways
  picked by cost. Left: matrices on the GPU, grade inference, tensors and
  lazy exact reals; the plan is [NUMBERS.md](../design/numbers/NUMBERS.md) and BACKLOG.md
  lane L.
- **The editor.** `fillings()`, `fillHole()` and `addVariant()` are the API
  for a palette, a "match on…" gesture and an "add a case" gesture. The
  editor thread owns `editor/` and has the node shapes.
- **More of the world.** Time, randomness and HTTP GET are done (see
  "Random", "Time", "The web"), and `lab compile` bundles the runtime into
  one portable file. Still missing: environment variables and HTTP beyond
  GET. (Handlers for `Console`, `Files` and `Network` written in the
  program are done, L55.)
- **Units written in types.** Units are inferred and checked as part of
  the type now; what's missing is writing them in a type (`Float64 m/s`) and
  a function generic over its unit.
- **Laziness for fold results**, so effects in folds could run top-down.
  (Lazy *data* now exists: a `Cell` in a field, see "Cells".)
- **Cells, further.** Guarded corecursion, so productive lazy producers
  have no `Diverge`; a stateful handler form so a
  program can write its own Cells handler (server-side rendering, tests);
  async cells (HTTP results) as Solid's resources.
