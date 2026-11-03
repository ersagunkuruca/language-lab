# The Ters specification, first draft (2026-11-03)

This says what a Ters program **means**: which answers it may give and
which it may not, on any engine. It doesn't say how an engine gets there,
how the editor draws it, or how a value is stored.

It is short on purpose. [LANGUAGE.md](LANGUAGE.md) teaches the language,
[LIBRARY.md](LIBRARY.md) lists the library, and
[BACKWARDS.md](BACKWARDS.md) explains running backwards. This page is the
one they have to agree with. Where they say more, they explain; where they
disagree with this page, one of the two has a bug.

**Why now.** Three engines once gave finite Float64 three different
meanings (REVIEW-2026-11-02c, R8 §1). Each engine was right by its own
reading, because there was nothing to read except the other engines. A
spec is the thing to read.

## 0. How to read this

**The evaluator is the reference.** `ters/src/lang/run.ts`, with the
checker (`infer.ts`) and the library implementations it calls, is this
spec run as a program. Where this page is silent, the evaluator's answer
is the meaning. Where this page and the evaluator disagree, it's a bug,
and the fix is decided case by case (usually the evaluator is fixed, but
sometimes this page was wrong). The compiled targets must agree with the
evaluator. The fuzz test (`compiler/test/fuzz.test.ts`) and the
examples' agreement test (`examples-agree.test.ts`) check that.

**Words.** *Must* is a rule every engine keeps. *May* is a freedom an
engine has, and a program can't tell which choice was taken unless this
page says how. *Open* marks a question this draft doesn't answer. Those
are listed in §12 and never invented here.

**Two landscapes.** The meaning is decided in the language, never by a
target. A target that can't keep a rule refuses the definition, with a
reason, before it runs (§10). It never gives another answer.

**Pending.** The Language lane is merging `call` and `solve` into one
node kind (L130). §7 is written at the level that survives the merge.
Where the merged node's shape still matters (L179), it is marked
*pending*.

## 1. Programs

1.1. A program is a set of **definitions**. Each definition has an
identity, maybe some inputs, and a body that is one expression. There
are no statements, no assignments, and no variables that change.

1.2. A program is a graph of nodes keyed by id, not text. Names,
comments, layout and notation are presentation: renaming anything never
changes meaning. Two programs that differ only in presentation mean the
same thing.

1.3. A published definition is identified by a **hash of its meaning**.
Everything that changes what a definition means must change its hash,
and nothing else may (L178 makes the hash keep this; today it doesn't
quite, see §12 S13).

1.4. A **hole** is an expression not written yet. A program with holes is
well formed and can be checked. Running into a hole is a stop (§8).

1.5. The node kinds are: literal, binder, reference, call, use (today
`solve`), lambda, definition, builtin, hole, data type, case, field,
type reference, function type, match, fold and arm. A data type also
declares an **effect** (its cases are operations) or an **interface**
(one case whose fields are operations). A `let` is a call of a lambda;
`if` is a match on `Bool`. Neither is its own kind.

## 2. Values

2.1. **Kinds of value.** A value is one of: a number (§3), a text, a
**datum** (one case of a data type, with a value for each of its
fields), a tuple, or a function. A list, a Bool, a map and an Optional
are data. Nothing else is a value: there is no `null`, no undefined, no
NaN and no infinity.

2.2. **Data.** A data type lists its cases; each case lists named,
typed fields. A case may be **private**: only the library that keeps
the type's rule may build it, but anyone may take it apart.

2.3. **Lists.** A list means `cons(head, rest)` or `nil`, and nothing
else. A written list `[1, 2, 3]` is that chain. However an engine stores
a list (as an array, a tree, two-ended, fused away) is not observable
(§9).

2.4. **Maps and sets** mean their entries in `compare` order (§2.7). Two
maps with the same entries are equal and show the same, whatever order
they were built in.

2.5. **Text** is a sequence of Unicode code points. `length` counts code
points; equality and order compare code points. Normalisation and
grapheme clusters are not part of the meaning yet (*open*, S7).

2.6. **Functions** are values. A function remembers the code it was made
from (so it can be run backwards, §7), but a program can't look inside
it, can't compare two functions, and can't show one.

2.7. **Equality and order.** `equal` is structural on numbers, text,
data and tuples. Functions can't be compared. `compare`
gives a total order: numbers by value, text by code point, cases in the
order their type lists them, then fields left to right. On Float64,
`equal` is exact, like `compare` and map keys: two Float64s are equal
only when they are the same Float64 (Ersagun's decision, 2026-11-03).
The solver keeps its own tolerance when it checks an answer it found
(L197), and the prelude's `near(a, b)` (within 1e-9, relative) is how a
program says "the same up to rounding". A relation over Float64s checked
forward shows the rounding: `polar(0, 2, 2, π/2)` is false, since
2·cos(π/2) is 1.2e-16 (Ersagun's choice, 2026-11-03).

## 3. Numbers

3.1. **Int** is a whole number of any size. No Int operation overflows.
`quotient` rounds down and `remainder` has the divisor's sign; both have
no answer (§5) when the divisor is 0.

3.2. **Float64** is the finite IEEE 754 binary64 numbers with **one
zero**. −0, the infinities and NaN are not values. Each operation gives
the correctly rounded IEEE result where IEEE requires one (`+ − · /`,
`sqrt`). For `sin`, `exp` and the other library functions, the engines
must give the same bits as the evaluator; today they share fdlibm's
algorithms so that they do.

3.3. **Leaving the finite floats** happens in two ways (FLOAT-VALUES
§2):

- **No answer.** An operation with no real answer at its inputs (`x / 0`,
  `sqrt` of a negative, `log` of 0 or less, `asin` outside [−1, 1], `0 ^`
  a negative, a text that doesn't read as a Float64) has no answer: it is
  `Choice`, exactly like a lookup that finds nothing (§5). The checker may
  leave `Choice` out of a type where it can see the input is fine; that
  changes the type, never the answer.
- **Overflow.** An answer too big to hold (past about 1.8e308) is a
  **stop** (§8.3). No handler in the program catches it. An overflow
  whose value nothing uses later *may* not be reported: one engine may
  stop and another finish, but no engine may finish with a different
  answer than another engine's finished answer.

3.4. **Rational** is an exact fraction, always in lowest terms. **Complex**
is re + im·i, with Float64 parts. The library adds **Algebraic** (exact roots of
polynomials), **Fixed** and others as ordinary data types with private
constructors; their meaning is their definitions.

3.5. **Literals.** A plain literal is some number: `3` is an Int where an
Int is needed, a Float64 where a Float64 is, and so on. A whole literal
nothing fixes is an Int; one with a point or a fraction nothing fixes is
a Float64 or a Rational as LANGUAGE.md "Numbers" says. Numbers of
different kinds never mix by themselves; conversions are named
functions.

3.6. `show` on a Float64 writes up to nine decimals, and a nonzero number
smaller than 10⁻⁶ by its shortest digits, never as 0 (L154). Every engine
must give the same text.

## 4. Types and effects

4.1. Every definition has a type, inferred, never written (Hindley-Milner
with effect rows). The checker runs before anything else, and a program
with a type error doesn't run. Types never change what a well-typed
program computes.

4.2. A function type is `(inputs) -[effects]-> result`. The effects are a
**row**: a set of effects, plus maybe a variable standing for "whatever
the caller does". A plain arrow `->` has no effects: same inputs, same
answer, every time.

4.3. A function type written inside a data type has a **closed** row: a
function kept in a field does at most what the field says.

4.4. A definition's own value must be pure. Anything that acts is an
**action**, a function with no inputs. `main` is an action, and the
effects it may leave unhandled are only those the host answers (§6.6).
In particular an unhandled `Choice` or user-declared effect can't reach
the top: that is a type error, not a run-time one.

4.5. **Termination.** Recursion the checker can see ends (a `fold`,
recursion on a smaller part) has no effect. Any other recursion has
`Diverge` in its type. Data types must be strictly positive (L107 asks
whether to lift this; *open*, S9).

4.6. **Interfaces** (`+`, `<`, `Division`, …) are resolved by the checker
to one implementation per use before anything runs. Which implementation
a use gets is decided by types alone.

## 5. Evaluation, and Choice

5.1. **Strict, left to right.** Ters is call by value. A call evaluates
its function and then its inputs, left to right, then runs the body. A
`let` evaluates its value before its body. Effects happen in that order.

5.2. **Results are streams.** Every expression gives a **stream of
answers**, in order. Pure code gives exactly one. `one of(list)` gives
each item in list order. `fail()` gives none. A call gives one answer for
every combination of its parts' answers, in order: the first input's
first answer with each of the second input's answers, and so on
(depth first, like Prolog). An effect performed on one path happens once
per path that reaches it.

5.3. **Handlers of Choice** take a stream and give one value:

- `first(action, fallback)`: the first answer, or the fallback's value if
  there is none. Only as much of the stream as the first answer needs is
  computed.
- `all(action)`: every answer, in order, as a list. If the stream never
  ends, neither does `all`.
- `count(action)`: how many answers.
- `optional(action)`: `some(first answer)` or `none`.

5.4. **Match** picks the one arm for the value's case (or `otherwise`),
binds its fields, and evaluates the arm. A match covers every case; a
missing case can't be written.

5.5. **Fold** is structural recursion: like a match, and each recursive
field also gives its already-folded value (a paramorphism). It always
ends.

5.6. **Fuel.** `with fuel(n, action)` runs the action with a budget of n
**steps**. A step is one call into a definition the checker couldn't
prove ends (one with `Diverge` in its own type). When the budget runs
out, there is no answer (`Choice`). So `with fuel` turns `Diverge` into
`Choice`. (*Open*, S4: this ties an answer to how clever the checker is.)

5.7. **No stack limit.** Recursion depth is limited by memory, not by an
engine's stack. An engine that runs out of memory stops (§8.3).

## 6. Effects and handlers

6.1. An **effect** is declared like a data type; its cases are its
**operations**, and each case's fields are what the operation is given.
Calling an operation **performs** it, which adds the effect to the
caller's row. An effect can take type parameters, and an operation can
have type variables of its own.

6.2. A **handler** is a `match` whose value examined is a computation
that may perform operations. Performing an operation goes to the nearest
enclosing match that has a case for it.

6.3. **Deep handlers.** A case runs *outside* its match: an operation
the case itself performs goes to the next handler out.

6.4. Every operation has one of three shapes:

- **It returns** (`returns T`): the case's value is the answer, and the
  computation carries on with it, exactly once. A case that could give
  several answers or none is a type error.
- **It never returns** (no `returns`, like `abort`): the case's value is
  the value of the whole match. The rest of the computation is dropped,
  **including every answer it still had** (a cut).
- **Answered later** (`later`): the case is also given the rest of the
  computation as a function. It may resume it at most once, now or later,
  or drop it. The checker refuses two resumes on one path; a second
  resume that gets past the checker stops the run (§8.3).

6.5. **Normal finish.** When the computation finishes without performing
anything, the match's value is its value, or, if the match has an
`otherwise`, that function applied to it (so a handler can change the
result's type).

6.6. **The world.** Effects nothing in the program handles go to the
**host** at the top: `Console`, `Files`, `Network`, `Random`, `Time`,
`Wait`, `Log`, `Abort` (the run ends with exit code 1), `Cells` and
`Update` on a page. The host is outside this spec. A host's answers are
the only thing that may differ between two runs of the same program
(HOSTS.md). `seeded(seed, action)` answers `Random` inside the program,
so the same seed gives the same numbers on every engine.

6.7. `Choice`, `Diverge`, `Cells` and `Update` are built in; every other
effect, including `Abort`, `Log`, `Random`, `Time` and `State`, is
declared in the library like a program's own.

## 7. Running backwards (*pending L130*)

7.1. Every definition is a relation between its inputs and its result,
and can be run in more than one **direction**: some ports given, the
rest found. Forward is the direction "inputs given, result found". A
definition is never written specially to run backwards.

7.2. A **use** names a definition (or a builtin, or an interface's
field) and the ports it is given. It gives the other ports, together,
from one solution. Calls and uses are one node kind (L130): a use is a
call that names its given ports, and its found ports are bound for a
body. Whether they come out as a tuple instead is *pending* (L179). That
choice changes the shape, not the meaning below.

7.2a. A **definition with results** is written as a condition on all its
ports and names some of them its results. Its type is the function of
that declared direction, its other ports to a tuple of its results (one
result is its value): `sum and difference(s, d) → a, b` is
`(Float64, Float64) → (Float64, Float64)`. Called, or passed on as a
value, it runs as its use in that direction; a use may still ask it any
other way. Given all its ports, `polar(r, t, x, y)`, it is the condition
on them, true or false, as inside another relation. An interface's field with results is typed the same way:
Trig's `polar` is `(length, angle) → x, y` (L128d).

7.3. **Effects of a use.** The checker works out from the direction how
many answers it can have:

- exactly one, always: pure (a pair taken apart, the missing addend of a
  `+`, a direction another definition is marked as computing);
- maybe none or several: `Choice`;
- a search that may not end: `Diverge` as well;
- never pinned down by the given ports: a type error at the use.

7.4. **Answers.** A use's answers are the values of the found ports that
make the relation hold. Only fully known answers count: an answer that
leaves a port free (a line or plane of solutions, `0 · x = 0`) is not an
answer of a use. Its **first** answer is the **canonical** one (the
positive square root, the principal angle). The order of the rest is
*open* (S3).

7.5. **What can't run backwards** is refused by the checker (printing,
the world's operations, cells, solving for a function) or waits until
its inputs are known and then runs forward (`floor`, `mod`, comparisons,
`first`/`all`/`count` over unknowns, calling an unknown function).
BACKWARDS.md "What can't run backwards" is the list.

7.6. A direction answered by a definition marked as computing it (POLAR
§`direction`) must give the same answers as the search would, in the
same canonical order. That is a law the definition's author promises;
checking it is *open* (S14).

## 8. Errors and stops

There are four ways a program doesn't give an ordinary answer, and they
are kept apart on purpose.

8.1. **Type errors** are found before the program runs, and it doesn't
run. They include an unhandled `Choice` or effect at the top, a missing
case, and a direction that can't be pinned down.

8.2. **No answer** is `Choice` with an empty stream: `fail()`, `x / 0`, a
lookup that misses, a use with no solution, `with fuel` running out.
The program handles it with `first`, `optional`, `all` or `count`. It
carries no reason.

8.3. **Abort** is the `abort(reason)` operation, carrying a text reason.
A program handles it with a match (`attempt` keeps it as data). At the
top, the run ends with the reason and exit code 1.

8.4. **Stops** end the run with a reason, and **no handler in the
program catches them**:

- a Float64 overflow (§3.3);
- running into a hole;
- running out of memory;
- a page's update running past its budget;
- a later operation's rest resumed twice (§6.4).

A stop is a property of the whole run, not a value: a program can't
test for one, and engines agree on which programs stop only up to §3.3's
freedom.

8.5. **Diverging** (running forever) is allowed only where the type
says `Diverge`. A program that runs forever has no answer; an engine may
not turn that into any answer of its own.

## 9. Representation is not meaning

9.1. The compiler chooses how each value is stored (lists as arrays,
maps as tables or trees, a Float64 with a niche), from how it is used
(REPRESENTATIONS.md). A program never names a representation, and no
program can observe which was chosen, except through time and memory.

9.2. A representation written in the library must keep its type's
meaning: every job it offers gives the same answer as the type's own
definition. These are its laws (L108d checks them).

## 10. Targets and conformance

10.1. An engine **conforms** if, for every definition it accepts, it
gives the evaluator's answers (the same stream, in the same order, for
everything a program can observe), performs the same effects in the
same order, and stops where the evaluator stops, with §3.3's freedom for
an overflow nothing uses.

10.2. An engine may **refuse** a definition it can't run, with a
reason, before running anything. A refusal is not a wrong answer. Today
WebAssembly and C refuse handlers of operations that return, and
compiled JavaScript doesn't run operations answered later yet (C40).

10.3. **Profiles.** A target may run a declared subset of the language:

- the **scalar** profile: Float64, Bool, arithmetic, `if`, lets and calls;
- **records**: plus records of those;
- **data**: plus data, closures, Int, Text, Choice, handlers and the
  world (WebAssembly and C).

The **shader** profile (WGSL) doesn't conform today: an Int is 32 bits
and gives up past that, as a budget running out does, and a Float64
overflow gives a GPU's ∞ or NaN unchecked, in f32. *Open*, S6.

## 11. What this page leaves to other documents

- The library's operations, one by one: LIBRARY.md (generated). Each
  entry's one line is its meaning; this page covers only the rules every
  entry follows.
- Pages, cells and reactivity: LANGUAGE.md "Cells". They are host
  effects (§6.6), and a host is outside the spec.
- Units of measure: LANGUAGE.md "Types". A unit is part of a number's
  type; it never changes the number.
- Modules, publishing and versions: SHARING.md.
- The editor: never part of the meaning.

## 12. Open questions

Each one is a place where engines could disagree or where the meaning
hasn't been chosen. None is answered here. Rows are in BACKLOG.md.

| # | question | today | row |
|---|---|---|---|
| S1 | **Float64 `equal` within 1e-9.** Decided 2026-11-03 (Ersagun): `equal` becomes exact, and the tolerance stays only inside the solver (§2.7). | done: exact on every engine, the tolerance only in the solver | L197 |
| S2 | **An overflow nothing uses.** §3.3 lets engines differ on whether it stops. Is that freedom the meaning, or should every engine stop like the evaluator? Today the agreement tests only compare programs that don't overflow, which this page now says. | decided by FLOAT-VALUES; written here | none |
| S3 | **The order of a use's answers after the first.** The backwards search is a fair interleaving (miniKanren), so the order depends on the search's internals. `first` is fixed (canonical), but `all` of a use lists answers in an order nothing specifies. Spec it as canonical order, or say `all` of a use is a set? | evaluator only; compiled code runs uses through the same solver | L198 |
| S4 | **Fuel counts depend on the checker.** A step is a call into a definition the checker couldn't prove ends (§5.6). When the checker gets smarter, a definition stops counting, and the same `with fuel(n, …)` can go from no answer to an answer. Count every call, or keep it and say a checker change can change fuel answers? | evaluator and the core IR count the same way | L199 |
| S5 | **When a stopped search had effects.** §5.2 performs an effect once per path. With `first`, paths after the first answer don't run. Does a conforming engine have to run paths in exactly the evaluator's order, or only give the same answers? (Printing inside a search is already a type error, so this matters only for handled effects like `Log` and `State`.) | evaluator's order; the fuzz test checks it | L198 |
| S6 | **Shaders.** Is the shader profile a conforming target with refusals (Int past 32 bits and overflow refused, or checked) or a declared approximation with its own meaning? | approximation, not written down | C141 |
| S7 | **Text.** Normalisation where text enters, grapheme clusters, case mapping and locales. | code points only | L185 |
| S8 | **The merged use's shape** (tuple or body). | pending | L179 |
| S9 | **Strict positivity.** | kept | L107 |
| S10 | **Evaluation order inside a use.** §5.1 is left to right for calls. A use solves its ports in the order the solver finds best. Are effects in a use's given ports evaluated left to right by port order, and before solving? | evaluated before solving; port order not written down | L198 |
| S11 | **`compare` on Float64** is documented in LIBRARY.md as putting NaN after every other Float64, but NaN isn't a value (§3.2). A stale line. | doc only | L200 |
| S12 | **Library functions' bits.** §3.2 asks every engine for the evaluator's bits on `sin`, `exp`, `pow`. Is that the rule (it is today, through fdlibm), or is "within an ulp" enough, which shaders and future targets would need? | same bits on JS, WebAssembly and C | C141 |
| S13 | **The hash misses meaning** (L178): an effect and a data type of one shape, a literal arm's value. §1.3 is the rule L178 implements. | bug | L178 |
| S14 | **A direction's law** (§7.6): nothing checks that a definition marked as another's direction gives the same answers. | promised by the author | L201 |

## How this page is kept

A PR that changes what a program means changes this page in the same
PR, or adds an open question here. The weekly critical review reads it
against the evaluator.

## Credits

**Influence.** The idea that a spec is prose a reference implementation
runs, and that conformance means agreeing with it, comes from the
[WebAssembly specification](https://webassembly.github.io/spec/) and its
reference interpreter. Keeping the static meaning (§4, types) apart from
the dynamic meaning (§5 to §8, running) follows *The Definition of
Standard ML* (Milner, Tofte, Harper and MacQueen, MIT Press, 1997). This
page borrows no text or formal rules from either; it is prose, not a
formal semantics. The ideas it describes are credited where they are
explained: effects and handlers in LANGUAGE.md, running backwards in
BACKWARDS.md, the overflow rule (Haskell's imprecise exceptions) in
FLOAT-VALUES-2026-11-01.md, and all of them in [CREDITS.md](CREDITS.md).
