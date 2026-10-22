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
  `evaluate : (expression, Number) -[Choice]-> Number`. There are three:
  `Choice` (Verse-style failure and multiple answers), `Console` and
  `Diverge`. Handlers are ordinary functions that remove an effect.
- **Verse's thing?** Yes, it's `Choice`, and it's the same idea as the
  relation solver's branches: a stream of answers, canonical first.
- **Can the editor stop type errors?** Holes have types, and the palette
  offers only fillings that keep the whole program error-free. A test punches
  holes all over both programs, tries every option the palette offers (over
  a thousand fillings), and checks that none of them causes an error.

## Data

```
type expression
  | number(value: Number)
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
(`knot = wrap(f: knot → Number)` is refused, since through it a function
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
newton : (expression, expression, Number) -[Choice, Diverge]-> Number
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
subtree, so the checker reports it as "used outside the function or case
that introduces it".

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

The effects:

| effect | operations | handled by |
|---|---|---|
| `Choice` | `one of(list)`, `fail()` | `first(action, fallback)`, `all(action)`, `count(action)` |
| `Console` | `print(text)` | the runtime |
| `Diverge` | (any recursion the checker can't see ends) | the runtime, or `with fuel(n, action)` |

Two rules make this checkable. A definition's own value must be pure, and
anything that acts is an action, a function with no inputs. `runMain`
accepts an action only if its remaining effects are ones the runtime handles,
so an unhandled `Choice` at the top is reported before anything runs.

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

## Relations inside programs: `solve`

A `solve` node uses a relation in the direction chosen where it's used.
The relation can be a network def, an expression def, `polar`, the variadic
`sum`/`product` atoms, or a numeric builtin read as `out = f(…)`. The node's
`given` ports are computed by expressions. Its `binds` ports are solved for
and bound to binders the body can use, all from the same solution, so several
outputs stay consistent with each other (`src/lang/solve.ts`,
`examples/relations`):

```
‹to polar› : (Number, Number) -[Choice]-> Pair Number Number
‹to polar›(x, y) =
  solve polar(x = x, y = y) for length, angle
    pair(length, angle)

‹square roots› : (Number) -> List Number
‹square roots›(y) = all(() => solve square(result = y) for x → x)
```

The effect comes from the solver's static `direction()`. Exactly one answer
that can't fail is pure: the missing addend of a `sum`, for instance. Several
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
can't be run backwards, and the checker says so. `show numbers` run
backwards is a parser:

```
‹read numbers›(text) = with fuel(10000, () => solve ‹show numbers›(result = text) for numbers)
```

The full table of what each node does backwards, and what can't be done
and why, is in [BACKWARDS.md](BACKWARDS.md). So is the calculus example,
which differentiates real functions by reading their graphs.

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

| class | status | how |
|---|---|---|
| syntax | impossible by construction | there is no text |
| unknown name, typo | impossible by construction | references are ids picked from a list |
| name clash, shadowing, capture | impossible by construction | binders are ids; equal names only get a subscript on screen |
| field/method name collisions between libraries | impossible by construction | fields are ids |
| wrong number of arguments | prevented by the editor | a call is created with one hole per parameter of the callee's type |
| type mismatch | prevented by the editor | typed holes; the palette offers only fillings that type-check, and fillings that would change a definition's type for its callers are confirmed against the whole program |
| missing case / non-exhaustive match | prevented by the editor | arms come from the type; adding a variant adds hole arms everywhere |
| unreachable case | checked | `otherwise` when every case is covered is reported |
| null / undefined | impossible by construction | there is no null; absence is `Choice`, and an unhandled `Choice` can't reach `main` |
| unhandled effect (printing from a pure value, failing with no handler) | checked | effect rows; a definition's value must be pure; `runMain` refuses leftover effects |
| non-termination | inferred | recursion that size-change termination accepts is total; everything else carries `Diverge`, which `with fuel` turns into `Choice`. Data types are strictly positive, and values can't be recursive |
| comparing functions | checked | `equal` needs plain data (no functions inside), a constraint type variables carry like a type class: `same(x, y) = equal(x, y)` is `(a, a) → Bool` for plain `a` only |
| a derivative that can't be read | runtime, but typed | `derivative`'s result may fail (`Choice`): where the slope can't be read (through `floor`, or data built from x), there is none |
| running something backwards that only runs forward | runtime, but typed | it waits until its inputs are known; an answer that leaves it waiting isn't pinned down, so it isn't an answer. Solving for a function is refused by the checker |
| variable out of scope | checked | can only come from moving a subtree; reported as a scope error |
| incomplete program | allowed | holes have types and the program runs until it reaches one |
| division by zero | runtime, but typed | `evaluate` fails instead of returning NaN; builtin `/` is IEEE (Infinity/NaN) |
| other domain errors (`sqrt` of a negative) | runtime | builtins are IEEE; a `Choice`-returning `sqrt` (both roots, or none) is the natural fix |
| unit mismatches | prevented by the editor in networks | dimension vectors, in `src/units.ts` (editor thread); could become a parameter of `Number` |
| resource misuse (leaks, use after close) | not addressed | proposal: resources exist only inside their handler's scope, so they can't escape (effects again, not linear types) |
| merge conflicts | mostly avoided | conflicts are per node and per side-table entry, not per line |
| logic errors | not preventable | invertible relations provide round-trip laws (`parse(print(v)) = v`) as properties to test |

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
queens : (Number) -[Choice]-> List Number
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

Both programs are built once by `examples/build-lang.ts` from
`src/lang/programs.ts`. After that, the JSON is the program, and the
TypeScript is just how it was first typed in, since there's no parser.

## Files

```
src/lang/types.ts     types, effect rows, unification, display
src/lang/std.ts       Bool, Unit, List, Pair as typedef nodes; builtins with signatures
src/lang/infer.ts     inference, exhaustiveness, totality, typed holes, fillings()
src/lang/run.ts       evaluator: results as lazy streams; handlers; runMain
src/lang/refactor.ts  fillHole(), addVariant(): the gestures that prevent errors
src/lang/render.ts    the block view (if/match/fold as indented blocks, types on top)
src/lang/dsl.ts       building programs from TypeScript
src/lang/programs.ts  queens and algebra
src/lang/load.ts      load a program on top of prelude + std
src/lang/demo.ts      npm run lang
```

The model gained `typedef`, `variant`, `field`, `tref`, `tfun`, `match`,
`fold` and `arm` (`src/model.ts`). The nested, let and s-expression views and
`hash.ts` handle them. Recursive definitions now hash, because a reference
back into the group being hashed is named by its position.

## What's next

- **Numbers.** Fractions, big integers, continued fractions, Clifford
  algebras and tensors, and running a definition like Peano naturals on a
  fast representation chosen by cost: the plan is [NUMBERS.md](NUMBERS.md).
- **The editor.** `fillings()`, `fillHole()` and `addVariant()` are the API
  for a palette, a "match on…" gesture and an "add a case" gesture. The
  editor thread owns `editor/` and has the node shapes.
- **User-defined effects and handlers.** The evaluator's stream model handles
  `Choice` naturally. General handlers with resumable continuations need a
  CPS evaluator.
- **Units as a type parameter.** `Number m/s`, unifying the editor thread's
  dimension vectors with these types.
- **Laziness for fold results**, so effects in folds could run top-down.
