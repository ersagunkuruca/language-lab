# A tutorial for the projectional language

This tutorial has two jobs. Right now it's for us: to understand the language
as it actually is in the code, and to find the parts that are confusing or
could be simpler. Later, cleaned up, it's for showing the language to other
people. The last part, [What's confusing, and what could be simpler](#whats-confusing-and-what-could-be-simpler),
is the reason it exists today.

Everything here can be tried in the editor:
https://ersagunkuruca.github.io/language-lab/ (or open the repository's
`index.html` locally). The examples are the ones
that ship with it: `fall`, `to polar`, `rotate`, eight queens, calculus over real
functions, functions run backwards, and the relations program.

The tutorial is in three parts:

1. [For a five-year-old](#part-1-for-a-five-year-old): what this is, with no
   programming words at all.
2. [For programmers who haven't done functional programming](#part-2-for-programmers-who-havent-done-functional-programming):
   the handful of ideas the language takes from that world, in plain words.
3. [The language](#part-3-the-language), one idea at a time, each one in the
   editor.

---

## Part 1: For a five-year-old

Imagine a big table covered in little machines. Each machine has holes on its
left where you put things in and a spout on its right where something comes
out. One machine adds two numbers. One machine makes a number bigger. One
machine looks at a picture and tells you whether it's a cat.

You connect the machines with strings. A string goes from one machine's spout
to another machine's hole, and whatever comes out of the first goes into the
second. If you want the same thing to go to two places, the string splits in
two.

That's a program here: machines and strings. There's nothing to type, so you
can't make a typo. If you try to tie a string to a hole where it doesn't fit,
the string won't stick, and a little note tells you why.

Some machines are special: they work backwards, too. A machine that turns
"how fast and how long" into "how far" can also be asked "I went this far,
how long did it take?", and it figures it out.

Some holes are still empty. That's fine: the machine knows what kind of thing
should go there, and when you point at the hole it shows you only the things
that fit.

And each machine has a sticker with its name. You can put your own stickers
on, in your own words, and the machines don't care: they still do exactly the
same thing. Your friend can use their own stickers on the same table.

---

## Part 2: For programmers who haven't done functional programming

You don't need to know Haskell or Lisp. You need six ideas, and the editor
shows all of them as pictures.

### 1. A program is values flowing through functions

In most languages a program is a list of instructions that change things:
`x = 3; x = x + 1; print(x)`. Here a program is a description of how each
value is made from other values: "the discriminant is b·b minus 4·a·c". There
is no `x = x + 1`, because nothing changes after it's made. That's why it can
be drawn: every value is a node, and every use of it is a wire.

![The discriminant: three parameters, four calls, one result](tutorial/discriminant.png)

### 2. Functions are values too

A function is something you can pass around like a number. `for each(list,
action)` takes a function `action` and calls it on every item. In the editor a
function that hasn't been called yet is a **frame**: a box whose parameters
are on its left edge and whose result leaves on its right.

### 3. "Let" is just naming a value so you can use it twice

`column = one of(range(size))` in the queens program doesn't store anything
anywhere. It means: this value, used in these two places. In the editor
that's a **dot** on a wire with two wires coming out of it.

### 4. Data comes in cases

A list is either empty (`nil`) or an item followed by the rest of a list
(`cons(item, rest)`). A Boolean is `true` or `false`. An algebra expression is
a number, or `x`, or a sum of two expressions, and so on. These are **data
types**, and each case is a **variant** with **fields**. When you look inside
a value of such a type, you say what to do in every case. That's `match`.
`if` is the same thing for `true`/`false`.

### 5. No loops: you walk the data instead

There's no `for (i = 0; i < n; i++)`. To do something to every item of a list,
you describe what to do for `nil` and what to do for `cons(item, rest)`, given
the answer for `rest`. That's a **fold**. Because each step works on a smaller
piece, a fold always finishes. Plain recursion (a function calling itself) is
allowed too; the language works out whether it obviously finishes, and if it
can't tell, it says so in the function's type.

### 6. What a function *does* besides return a value is in its type

Printing, failing, giving several answers, and maybe never finishing are
called **effects**. Instead of being hidden, they're listed in the function's
type:

```
queens : (Number) -[Choice]-> List Number
main   : () -[Console]-> Unit
```

Read `-[Choice]->` as "an arrow that may give several answers, or none". You
never write types; the editor works them out and shows them on hover and in
the frame's title.

That's all the functional programming you need.

---

## Part 3: The language

### 3.1 The program is the tree; names are stickers

There is no source text. The program is stored as nodes keyed by random ids
in `code.json`. Names live in separate files (`names.*.json`), as do comments
(`comments.json`) and positions on the canvas (`layout.json`).

What this buys:

- **No syntax errors**, because there's no syntax.
- **No unknown names or typos.** A reference is an id you picked from a list.
- **Renaming is free.** It changes a names file, not the program. The
  meaning hash in the Files panel doesn't move.
- **Names can collide harmlessly.** Name three parameters `k` and they show
  as `k₁`, `k₂`, `k₃`. Nothing is looked up by name, so there's no shadowing.
- **Notation is personal.** The `a · b` / `a * b` / `(* a b)` switch and the
  Short names / Descriptive switch change only what you see.

**Try it.** Open *Numbers & physics* → `discriminant`. Switch between *Short
names* and *Descriptive*, and between the three notations. Watch the Files
panel: `code.json` is never touched.

### 3.2 Nodes and wires

A **node** computes a value: a function call, an `if`, a `match`, a `fold`, a
`solve`. Inputs are hollow circles on its left; its output is the filled
circle on its right. A **wire** carries a value from an output to an input.

There are no variable boxes. Every use of a variable is a wire from where
that variable comes from, so a value used twice visibly fans out. In
`discriminant` above, `leading coefficient` has two wires because it's used
twice.

**Gestures.** Drag from an output (or a dot) onto an input to use that value
there. Drag an input's wire into empty space to remove it; the input becomes a
hole. Drag a node to move it. That only changes `layout.json`.

### 3.3 Dots: where a value starts and branches

A **dot** is where a value starts and branches out to every place that uses
it. Two things are dots:

- **A function's parameters**, on its frame's left edge.
- **A let.** Click any wire to put a dot on it. Select the dot to give it a
  name, or leave it unnamed: then it shows as `•1`, `•2`, a handle that's
  never stored. Drag from the dot to another input to share the value there.

In the code, a dot is the binder of `((b) => body)(value)`. There is no `let`
node. Removing a dot with one wire out puts the value back on that wire.

A dot that nothing reads is a step done only for its effect, like a `print`
in `main`. Those are drawn hollow, in a column, in order.

### 3.4 Frames: functions not called yet

A **frame** is a function as a value. Its parameters are dots on its left;
what it gives back leaves on its right. A whole definition is a frame too: its
title shows its name and inferred type, e.g. `queens : (Number) -[Choice]->
List Number`.

Frames nest, and a node can't leave the frame its inputs come from. If you
drag a node out, the frame grows to keep it inside.

### 3.5 Holes: the program is allowed to be unfinished

A **hole** (`□`) is a value not filled in yet. It knows its type. Select it
and the side panel lists only fillings that fit: variables in scope, calls
(which arrive with one hole per argument), constructors, numbers, text,
functions, and "match on …" / "fold on …" for each variable whose type has
cases. A program with holes runs until it reaches one.

**Try it.** Open *Algebra* → `evaluate`. Select the body of the `sum` case
and press *Clear to a hole*. The hole needs a `Number`. The palette offers
`at`, `l′`, `r′`, calls like `add(□, □)`, and so on, but not `display(…)`,
which returns text. That's the whole idea of "type errors prevented by the
editor": you can't pick what doesn't fit.

### 3.6 Data types, `match`, `if`

A data type is a definition whose body is a list of variants, each with
fields:

```
type expression
  | number(value: Number)
  | x
  | sum(left: expression, right: expression)
  | product(left: expression, right: expression)
  | sine(of: expression)
  | ...
```

A variant used as a function is its constructor: `sum(a, b)`. The standard
types `Bool`, `Unit`, `List a` and `Pair a b` are ordinary data types, not
built in.

`match` looks at a value and has one case per variant. In the graph it's an
ordinary node: the value goes into its first input, then one frame per case,
whose parameters are that case's fields. `if` is a match on `Bool`, drawn the
same way with inputs labelled `condition`, `then` and `else`.

Two gestures keep matches complete:

- **Split by cases…** on any expression replaces it with a match on a
  variable you pick, one case per variant, each starting as a copy of what was
  there.
- **Add a case** on a data type adds a case with a hole to *every* match and
  fold over that type. Adding `tangent` to `expression` produces exactly four
  holes, in `evaluate`, `derivative`, `simplify` and `display`. A missing case
  can't be written.

### 3.7 Loops are folds

A **fold** is a match where each recursive field also comes with its
already-computed result. In `derivative`, the `product` case gets `u`, `v`
(the parts) and `u′`, `v′` (their derivatives), so the product rule reads like
the textbook:

```
derivative(expression) =
  fold expression
    number(value) → number(0)
    x → number(1)
    product(u, v) with u′, v′ → sum(product(u′, v), product(u, v′))
    sine(u) with u′ → product(cosine(u), u′)
    ...
```

In the graph a fold is the same shape as a match; the case frames just have
the extra parameters. A fold always finishes.

The eight queens program is a fold over the rows: for each row, pick a column
and keep it only if it's safe.

![queens: a fold over range(size), with one of, if and fail inside the cons case](tutorial/queens.png)

**Plain recursion** is allowed. The checker accepts it as finishing when each
recursive call passes something a match took apart from the same parameter
(`for each(rest, action)` inside the `cons(item, rest)` case). Anything else
gets the `Diverge` effect in its type, and so does everything that calls it.
`newton` in the calculus program has `-[Choice, Diverge]->` because nothing in
it gets smaller.

### 3.8 Effects: Choice, Console, Diverge

There are exactly three effects. A node whose call performs one carries a
**badge**.

| effect | what it means | made by | removed by |
|---|---|---|---|
| `Choice` | may give several answers, or none | `one of(list)`, `fail()`, some relations | `first(action, fallback)`, `all(action)`, `count(action)` |
| `Console` | prints | `print(text)` | the runtime (only `main` may keep it) |
| `Diverge` | might not finish | recursion the checker can't see ends | the runtime, or `with fuel(n, action)` |

**Choice is the interesting one.** It replaces several things other languages
have separately:

- **Search.** `queens` picks `one of(range(size))` for each row and calls
  `fail()` if it isn't safe. There's no search code. `first` gives one board,
  `count` gives 92, `all` gives every board.
- **Absence.** There's no `null` and no `Option`. "Might not have a value" is
  `Choice` in the type. `evaluate` fails on division by zero, and `main`
  handles that with `first(…, "undefined")`.
- **Filtering.** `keep(list, test)` is `all(() => item = one of(list); if
  test(item) then item else fail())`.
- **Several answers from a relation.** See 3.9.

The handlers (`first`, `all`, `count`, `with fuel`) take **actions**,
functions with no inputs, which appear as `() =>` frames. A handler is marked
with the effect it removes, and the effect stops there.

Effects compose with no extra machinery. `map` has type
`(List a, (a) -[e]-> b) -[e]-> List b`: whatever effects the function you pass
has (`e`), `map` has too. There's no `map` vs `mapM`.

The checker won't run a program whose `main` still has `Choice` or any effect
the runtime can't handle; that's reported before anything runs.

**Try it.** Open *Eight queens* → `main` and press *Run*: the first solution
for 8, the count (92), and all four solutions for 6.

### 3.9 Running a function backwards

Every function has **ports**: its parameters and its result. Running it
forward means giving it the parameters and asking for the result. But you can
give it any of its ports and ask for the others. *Run* in the side panel
lists the ports of whatever definition you're looking at, each with a tick
box: ticked ports are ones you give, the others are worked out. Which ones
are ticked is stored in `layout.json`, not in the code, so flipping them
changes the direction, not the program.

`period(length, gravity)` gives 2.006 s for a one-metre pendulum. Untick
`length`, tick the result and type 2: it answers how long a pendulum swings
once every two seconds.

**A function that says true or false is a set of equations.** `fall` is an
ordinary definition with four parameters that returns a `Bool`:

![fall: distance = speed·time + ½·gravity·time²](tutorial/fall.png)

Each `equal` in it is an equation (here, `distance = drift + drop`), `and`
puts several together, and a dot on a wire (`drift`, `drop`) is just a name
for part of one. Run it with *holds* ticked and `true`, and it solves for
whichever ports you left unticked, keeping it true. Give it `distance` and
ask for `time`, and it answers "when does it land?": thrown down at 5 m/s,
29.62 m takes 2 s. The other root, about −3.02 s, is a second answer.

![Running fall backwards: distance known, time solved, with the other root](tutorial/fall-backwards.png)

*The program it derives for this direction* shows what the solver from
`invertible/` worked out: an ordinary program, here the quadratic formula for
`time`. That's what the compiler writes out, too.

Two more words make predicates as expressive as wiring:

- `for some` names a value that isn't a parameter. `rotate(x, y, turn, x′,
  y′)` says: for some `length` and `angle`, `polar(x, y, length, angle)` and
  `polar(x′, y′, length, angle + turn)`. Its unknowns are the wires inside.
  Run forward, `for some` asks whether any value makes it true.
- `hence` adds something that follows from what came before. `polar` says
  `x = length · cos(angle)` and `y = length · sin(angle)`, hence `x² + y² =
  length²`. The consequence gives the solver a way in (from `x` and `y` it
  finds `length` with a square root, no search), but it isn't counted as an
  extra condition, so `polar` given only `x` is still correctly a whole
  family of points.

**Units are part of the type.** Declare `m` on `distance` and `m/s²` on
`gravity` (select a parameter or a number; *Unit* shows chips) and the rest
is inferred: `period` comes out in seconds, `drift` and `drop` in metres. An
edit that would add metres to seconds is refused like any other type error.
A plain number is dimensionless; a number like 9.81 m/s² carries its unit.

**Solve nodes** do the same inside a program (*Relations in programs*). The
ports you give it are inputs; the ones it solves for come out on its right,
all from the same solution. A predicate is solved with its result given as
`true`:

![to polar as a solve node inside a typed program](tutorial/to-polar-solve.png)

Its effect comes from the direction: one answer that can't fail is pure (the
missing addend of a sum, splitting a sum and difference); several answers, or
possibly none, is `Choice`. `square` read backwards (`x · x = y`) gives both
roots of 9 under `all` (canonical first, so `first` gives 3), and none for −1.
This is the "x² = 4 has a canonical answer" idea, written as a program, and it
uses the same `Choice` as queens.

### 3.10 The errors you can't make

Every edit is a pure function from program to program, and it's refused, with
the reason in the status line, if the result has an error the program didn't
have before. The editor also asks ahead of time: while you drag, the inputs
you can reach light up and the others say why not.

| error | status | why |
|---|---|---|
| syntax | impossible | there is no text |
| unknown name, typo | impossible | references are ids picked from a list |
| name clash, shadowing, capture | impossible | binders are ids; equal names get a subscript on screen |
| wrong number of arguments | prevented | a call is made with one hole per parameter |
| type mismatch | prevented | holes only offer what fits; edits that add one are refused |
| missing case | prevented | cases come from the type; *Add a case* adds hole cases everywhere |
| null / undefined | impossible | there is no null; absence is `Choice`, which must be handled |
| unhandled effect | checked | effects are in types; `main` can't keep `Choice` |
| non-termination | inferred | it shows up as `Diverge` in the type |
| unit mismatch | prevented | units are part of the type |
| unfinished program | allowed | holes have types; it runs until it reaches one |
| `sqrt` of a negative, `÷ 0` in builtins | runtime | builtins follow IEEE (NaN, Infinity) |
| logic errors | not prevented | relations give round-trip laws to test against |

The *Checks* panel lists these live for whatever program is open. A test
(`test/lang.test.ts`) punches holes all over both typed programs, tries every
filling the palette offers (over a thousand), and checks none causes an error.

### 3.11 Summary: the vocabulary

These are the words the in-editor Guide uses, one word per thing:

| word | what it is |
|---|---|
| node | something that computes a value: a call, an if, a match, a fold, a relation |
| wire | carries a value from an output (or dot) to an input |
| dot | where a value starts and branches: a parameter, or a let |
| frame | a function not called yet: parameters on the left, result on the right |
| hole | a value not filled in yet, with a type |
| badge | the effects a node has, or the effect it handles |
| relation | a node with no fixed direction: you pick what's given, it solves the rest |

---

## What's confusing, and what could be simpler

This is the candid part. Each item says what's there today, why it's a
problem, and a proposal. [REVIEW.md](REVIEW.md) goes further: soundness
holes, scale, and a roadmap. They're ordered roughly by how much they'd simplify
the language.

### 1. ~~There are still two worlds of functions~~ (done: one world)

**Was.** Tree code had a direction; networks had none and were solved, with
their own node kinds, their own editor, their own checker, and units only
there. *Numbers & networks* had `to polar` as a network while *Relations in
programs* had a different `to polar` with a `solve` node.

**Now.** A network is an ordinary function returning `Bool`: each `equal` is
a wire, `and` collects them, and `for some` names the wires inside. Any
function can be run from any of its ports (*Run*, and `solve` nodes), and one
interpreter (`relate.ts`) does every backwards run. The network node kinds,
the network editor, `eval.ts`, `check.ts` and the separate relation builtins
are gone; `polar` is a three-line definition. Units moved into the type
checker (item 9). See LANGUAGE.md, "One world".

### 2. Builtins are black boxes, and arithmetic exists three times

**Today.** Double-clicking `+` shows nothing, because `add` is a JavaScript
function in `src/prelude.ts`. The same arithmetic exists again in
`invertible/src/expr.js`, where each function carries a hand-written inverse
per argument and a symbolic derivative. And the algebra example builds a
*third* copy: an `expression` data type with `sum`, `product`, `sine`, plus
`evaluate` and `derivative` written over it.

**Why it matters.** The pitch is that functions aren't black boxes, but the
most basic ones are. And the algebra example teaches the opposite lesson from
the one we want: it differentiates a data structure *about* functions instead
of differentiating functions.

**Proposal.**
- Give each builtin a visible definition: the equation it satisfies (for
  `sum`, `a + b + … = total`) and its inverses, shown when you open it, even
  if the evaluator still runs JavaScript underneath.
- Make `derivative` an operation on any definition, like `solve` is. The
  solver already differentiates its expression trees for Newton's method, so
  the machinery exists. The algebra example would then become
  `derivative(f)` for a real `f`, and the `expression` type would be an
  example of data types, not of calculus.

### 3. Relations only cover arithmetic

**Today.** The relations are `sum`, `product`, the numeric builtins
(`sqrt`, `pow`, `sin`, `cos`, `exp`, `log`), `polar`, `sum & difference` and
`Ohm's law`. Text, `if`, lists and folds can't be run backwards.

**Proposal.** Some of these come almost for free, and one of them would remove
a concept:

- **Constructors are relations already.** `cons(item, rest) = list` read
  backwards is "take this list apart", and it fails if the list is `nil`.
  That's exactly one case of a `match`. So a `match` could be "try each
  constructor backwards", and `if` a match on `Bool`. That would make match a
  solve node, and would make pattern matching and relation solving the same
  thing.
- **Join text** backwards (`join(a, b) = "hello"`) has several answers, which
  is `Choice`: every way to split the text. With `a` known it's one answer or
  none (a prefix check).
- **Folds** backwards are unfolds: given the result, find the data. That's
  hard in general, but small cases (`length`, `sum of list`) are useful
  demos.

### 4. Cases that are values are drawn as functions

**Today.** The `then` and `else` of an `if`, and every case with no fields
(`nil`, `x`), are drawn as `() =>` frames, because internally they're actions
that run only when chosen. Look at queens: `fail` sits inside its own frame
under `else`, and `nil` inside another.

**Why it matters.** A reader sees "a function with no inputs" where they
expected "a value". It's honest about laziness but it adds boxes.

**Proposal.** Draw a zero-parameter frame as just its contents with no box,
unless it's a real action passed to a handler like `first` or `all`.

### 5. "Output" and "dot" are almost the same thing

**Today.** A node's output is a filled circle on its right. Dragging it to a
second input creates a dot on its wire. A parameter is a dot, a solved port of
a `solve` node is a dot, but a node's output isn't.

**Proposal.** Every output is a dot. A value used once is a dot with one
wire; there's nothing to create when you use it a second time. That removes
one shape and one gesture.

### 6. Order is invisible

**Today.** A dataflow picture has no order, so steps done only for their
effect (`print`) are hollow dots in a column. Also, a fold computes its
children before the parent, so effects inside a fold run bottom-up, and the
docs say "use `for each` when order matters".

**Why it matters.** This is the one place where the picture doesn't tell you
what happens. It will bite anyone who prints inside a fold.

**Proposal.** Either draw a sequencing wire between effectful steps (a thin
"then" wire, the way Unreal Blueprints have execution pins), or make folds
lazy so effects run top-down. The first is more uniform with "everything is a
wire".

### 7. The type syntax has a variable most people won't understand

**Today.** Types like `(List a, (a) -[e]-> b) -[e]-> List b` show `e`, a row
variable meaning "whatever effects the caller's function has".

**Proposal.** Show it in words when hovering ("has the effects of `action`")
and hide `e` by default. The badges already say what a node does; the type
in the frame title could drop effect variables entirely.

### 8. Three ways to repeat

**Today.** `fold`, plain recursion (with totality inferred) and `with fuel`
(recursion with a limit). They exist for good reasons, but a newcomer will
ask which to use.

**Proposal.** Teach fold first and present recursion as "a fold the checker
couldn't see". If folds over numbers (`range`) are cheap enough, most
programs never need the others.

### 9. ~~Units only exist in networks~~ (done)

Units are part of `Number`'s type now, in every program: declared on
parameters and numbers, inferred everywhere else, and a mismatch is a type
error. What's still missing is a unit *parameter* in written types (a
function generic over its unit, like `sqrt` taking m² to m, is inferred but
can't be written down).

### 10. Small inconsistencies worth fixing

- `equal` is defined for any type, including functions, which can't really
  be compared. `show` only works on numbers.
- Two kinds of definition in the navigator now (functions and `▤` data types) and one
  panel layout, since every program is typed.
- The model has 17 node kinds (`lit binder ref call lambda def builtin hole
  typedef variant field tref tfun match fold arm solve`). Proposal 3 would
  remove `match`/`arm` as separate from `solve`.

### 11. Modules: library code is visible but frozen

Every program is loaded with the prelude (`map`, `keep`, `reverse`, …),
whose definitions are named by their content hash (LANGUAGE.md,
"Signatures and modules"). Two things are still awkward:

- You can open a library function and read it, but any edit inside it is
  refused, because changing it would change its name. The gesture that's
  missing is "copy into my program", which makes a draft you can change
  and, later, publish as a replacement.
- Pins (frozen signatures) exist in the checker, but the editor can't pin
  one of your own definitions yet, and doesn't show which ones are pinned.

### 12. Things that are good and should stay

So the list above isn't read as "everything is wrong":

- Names, comments and layout outside the code. Rename, notation and layout
  never change meaning, and you can see it in the Files panel.
- Holes with types and a palette of only what fits.
- *Add a case* adding holes everywhere.
- One `Choice` effect covering search, absence, filtering and relation
  branches.
- Non-termination as an inferred effect, rather than a promise.
- The canonical-first answer for multi-valued inverses.

---

## Where this lives

- This file: `projectional/TUTORIAL.md`. The editor build also turns it into
  `tutorial.html` next to the editor, linked from the editor's header.
- The language reference: [LANGUAGE.md](LANGUAGE.md). The prototype and
  editor: [README.md](README.md). The solver: [../invertible/README.md](../invertible/README.md).
- Screenshots are in `projectional/tutorial/`.
