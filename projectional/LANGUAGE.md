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
- **Modules? Imports?** A module is published definitions plus the same
  side tables a program has. Publishing names a definition by its content
  hash, so the hash is its id; a reference to it is the import, and there
  are no import statements. Signatures are *pins*: inferred types, frozen.
  See "Signatures and modules" below.
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

**Updating a record** is `set(field, record, value)`: the record with that
field changed and every other field kept. The field can also be a path,
`set((p) ↦ p.home.city, ada, "Paris")`, which copies only the records on the
path. That is the projection run backwards with the rest of the record
given, so records get updates, and nested data gets lenses, without a new
construct (REVIEW.md §5.3). The checker accepts only a field or a path of
fields written in place, so an update always has exactly one answer. A
general function there (`(p) ↦ p.width · 2`) is the next step: it would
run backwards through the relational interpreter, with `Choice`.

### Whole numbers and text, at real sizes

`Int` is the whole numbers, and it **never overflows** (`src/lang/int.ts`).
A value is a JS number while it is a safe integer and a BigInt beyond, with
exactly one spelling per number, so `equal` and hashing stay right. This is
NUMBERS.md's stage 1: the meaning is the integers, the representation is
machine numbers with a BigInt fallback. Int literals are ordinary `lit`
nodes with `of: "type.int"` (digits in a string past 2^53). Its operations
have Number's names (`add`, `multiply`, `less than`, `show`, `range`),
because names are presentation; the types tell them apart, and Int and
Number never mix without `as number` or `whole part`. Where there is no
whole answer there is no answer: `quotient` and `remainder` by zero, a
negative `power`, `whole part` of infinity and `read whole number` of
"007" are `Choice`, not a crash or a NaN. Division rounds down, so
`remainder` has the divisor's sign.

Text has `length`, `slice`, `characters`, `split`, `join all`, `find`
(`Choice`: the part may not be there), `comes before`, `character code`
and `character` (`src/lang/text.ts`). Positions count characters, so an
emoji is one. `join all` joins a list in one step, where a fold of `join
text` would copy.

All of these run in the evaluator, the compiler (`$int`, `$impl`, `$many`
in its runtime) and forward in the relational interpreter.

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

A `solve` node uses a function in the direction chosen where it's used.
The function can be any definition (a predicate like `polar` is solved with
its result given as `true`, see "One world" below), or a numeric builtin
read as `out = f(…)`. The node's
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
can't be run backwards, and the checker says so. `show numbers` run
backwards is a parser:

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

- **`equal` is a wire.** One equation. Numbers are equal when they agree to
  1e-9 relative (`close` in `run.ts`), forward and backwards and compiled,
  because a wire in a network meant "these are the same quantity", and
  `0.1 + 0.2` should be the same quantity as `0.3`. The cost is that `equal`
  on numbers isn't transitive at the 1e-9 scale. Bit-exact comparison is a
  different question and should get its own name when something needs it.
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
  error is at the definition: "area is pinned to (Number) -> Number, and
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
fields move too) need a migration, which is a next step.

**The prelude**, the first module, is `for each`, `map`, `keep`, `show
numbers`, `length`, `sum`, `append`, `reverse` and the helper `reverse
onto`. It is written once with the DSL in `src/lang/prelude-source.ts` and
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
| integer overflow | impossible by construction | `Int` is unbounded: machine numbers with a BigInt fallback |
| division by zero | runtime, but typed | `Int`'s `quotient` and `remainder` are `Choice` (no answer); `evaluate` fails instead of returning NaN; Number's `/` is IEEE (Infinity/NaN) |
| other domain errors (`sqrt` of a negative) | runtime | builtins are IEEE; a `Choice`-returning `sqrt` (both roots, or none) is the natural fix |
| unit mismatches | checked | a unit is part of a number's type: dimension vectors (`src/units.ts`), reported by the type checker, so the editor refuses an edit that adds one |
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

Both programs were first typed in TypeScript through the builder, since
the editor couldn't yet make definitions. The JSON is the program now; it
is changed in the editor, and nothing regenerates it.

## Files

```
src/lang/types.ts     types, effect rows, unification, display
src/lang/std.ts       Bool, Unit, List, Pair as typedef nodes; builtins with signatures
src/lang/infer.ts     inference, exhaustiveness, totality, typed holes, fillings()
src/lang/run.ts       evaluator: results as lazy streams; handlers; runMain
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

- **Numbers.** Fractions, big integers, continued fractions, Clifford
  algebras and tensors, and running a definition like Peano naturals on a
  fast representation chosen by cost: the plan is [NUMBERS.md](NUMBERS.md).
- **The editor.** `fillings()`, `fillHole()` and `addVariant()` are the API
  for a palette, a "match on…" gesture and an "add a case" gesture. The
  editor thread owns `editor/` and has the node shapes.
- **User-defined effects and handlers.** The evaluator's stream model handles
  `Choice` naturally. General handlers with resumable continuations need a
  CPS evaluator.
- **Units written in types.** Units are inferred and checked as part of
  the type now; what's missing is writing them in a type (`Number m/s`) and
  a function generic over its unit.
- **Laziness for fold results**, so effects in folds could run top-down.
