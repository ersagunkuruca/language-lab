# Effects: a critical review (2026-10-24)

Ersagun asked (2026-10-24 07:50) whether effects are turning into an
unwieldy monster. His test: a kink that exists only to host the idea in
JavaScript, WebAssembly, C or WGSL is fine; a dent in the idea itself, in
the language as the programmer sees it, is not, and the targets must never
push the language out of shape.

This is a review only. Nothing is fixed here; the proposals are rows
L52 to L60 in BACKLOG.md's L section, and C34 in its C section.

Everything said below was read from the code on main at a576af1
(`src/lang/infer.ts`, `types.ts`, `std.ts`, `ledger.ts`, `run.ts`,
`cells.ts`, `browser.ts`, `html.ts`, `compiler/src/runtime.js`,
`scalar.ts`) and the docs (LANGUAGE.md, WEB.md, AUDIO.md, COMPILER.md,
WASM.md, NATIVE.md). One finding was run as a test (§2.1); one was read
from the code and not run (§1.1).

## The verdict in five lines

1. **The core idea is small and clean, and worth keeping.** Effects are
   declared like data types, an operation is a case, performing is calling,
   a handler is a `match`. Rows are inferred and never written. Nothing in
   that core is shaped by a target.
2. **One restriction was taken partly for the targets' sake, and it is the
   root of most of the weirdness.** A handler can answer an operation *now*
   or abort; it can never answer it *later*. COMPILER.md says why in so many
   words: "Neither needs first-class continuations, which is what makes them
   portable." Every page oddity (event handlers run twice, fetch answers
   frozen for the page's life, `Wait` as a separate effect, Cells and the
   world living only in the runtime) is that restriction meeting a host
   that can't block.
3. **The rule "no world while a Choice is open" is a good rule checked the
   wrong way.** It is a flow analysis beside the type checker, because rows
   unify instead of nest. It has a hole: a printer taken out of a list and
   called under `count` prints three times with no error (§2.1, run).
4. **There are two kinds of effects where there should be one.** Random
   and Time are declared in std and a test can answer them with a `match`;
   Console, Files and Network are builtins and can't be answered at all.
5. **For concurrency the base is right but one shape short.** Rows, deep
   handlers and the search/world rule are what concurrency needs. Missing:
   an operation the handler answers later (once), and effects that take a
   type (`Channel a`). With those, fibers, async, generators and a
   scheduler are programs in the language, not more runtime.

## How to read the classes

- **(c) A dent the targets pushed in.** Something the programmer sees or
  must know, there because a host can't do what the idea asks.
- **(a) Inherent.** A choice in the language's own idea of effects. Each
  gets the simpler idea next to it.
- **(b) A hosting kink.** Confined to one target or the evaluator. The
  language doesn't move. Listed briefly.

## 1. Dents the targets pushed in (c)

These come first because they are what Ersagun asked to see. All five have
one root (§1.5), and pushing that one back out removes the first three.

### 1.1 A page's event handler runs twice when it fetches

`fetch text` in a page can't wait, so it throws `Pending` and the page
runs the handler **again from the start** when the reply lands
(`src/lang/html.ts`, the `on` attribute's `fire`; `browser.ts` header).
LANGUAGE.md tells the programmer the rule this creates: "a handler should
fetch before it writes, the way a Suspense render must be pure".

That is a dent. The language promises (it is the whole point of the
world-under-Choice rule) that an action doesn't happen on a path that is
later abandoned. A re-run handler is exactly an abandoned path: every
`write`, `print` and `write file` before the fetch happens twice.
`cells.batch` delays the watchers, it doesn't take the writes back. So a
click handler `write(count, read(count) + 1); fetch text(url)` adds 2 on
the first click (read from the code, not run; the same click with the URL
already fetched adds 1).

The host's shape (JavaScript's run-to-completion, no blocking on the main
thread) is the cause, and React's Suspense rule is a JavaScript idea, a
fine cube in React's world and a warped one here.

**Push it out:** the page runtime becomes a handler that *keeps* the rest
of the handler and resumes it when the reply lands, once. That needs the
operation shape in §1.5. The evaluator already has what it takes: its
continuations are immutable frames on the heap (LANGUAGE.md "How it runs"),
so keeping one is keeping a pointer. Compiled JavaScript has `$k` copies
and generators already (COMPILER.md, "Searches in continuation-passing
style"). Until then, the cheap honest fix is to refuse a write or world
action before a fetch in a handler (L52).

### 1.2 A page fetches each address once for its whole life

"Each address is fetched once per page load" (`browser.ts`). The memo is
there for two reasons. One belongs to the language: a search that
backtracks shouldn't ask a server twice, which is what lets `Network`
run under `Choice`. The other is the re-run in §1.1: the second run must
find the answer the first one asked for. The result is a dent: a page
can't poll, can't refresh, and can't retry after a failure, because the
failure is remembered too.

**Push it out:** once §1.1 resumes instead of re-running, the memo only has
the search reason left, so it can be scoped to a search (inside one `all`,
`first`, `count` or `optional`) and to one event, not to the page.

### 1.3 `Wait` is its own effect because a page can't wait

`Time` has `now()`; `wait(ms)` is a separate effect `Wait` so that a page's
rows can leave it out (`std.ts`: "Its own effect, so a page, whose parts
and handlers may not wait, says so in their types"). The split exists
because the browser can't block, not because waiting and reading the
clock are different ideas.

**Push it out:** with §1.5, `wait` in a page handler parks the rest and a
timer resumes it. `wait` goes back into `Time`. A *view* still may not
wait, and for a language reason: a view is what the page shows given its
cells, and waiting has no meaning there. That rule stays in `View`'s row
(§2.6), without a second effect to carry it.

### 1.4 A page with sound may not use Random or Time in main

AUDIO.md: the audio thread is another JavaScript realm, a closure can't
cross into it, so the worklet runs `main` **again** and matches cells by
the order they were made. "So a page with sound may not draw random
numbers or read the clock in `main` (checked: its row loses `Random` and
`Time`)". Whether `main` may roll a die depends on whether the page has a
`listen` attribute somewhere: a pure AudioWorklet constraint, written into
`main`'s type.

**Push it out:** this is what handlers are for. The worklet's second run of
`main` goes under a handler that answers `random()` and `now()` with the
answers the page's run got, in order (record and replay). The language
goes back to one rule for `main`. Matching cells by creation order stays as
a hosting kink (§3).

### 1.5 The root: an operation is answered now, or never

LANGUAGE.md "Effects you define": every operation either returns (the case
gives one value and the computation carries on at once) or never returns
(the case's value replaces the whole match). "The continuation isn't a
value, on purpose." The reasons given are two:

- a language reason: a handler can't secretly resume twice (that would
  duplicate the world's actions), and these two shapes cover errors,
  configuration, logging, IO and mocking;
- a target reason: "Both compile to plain JavaScript without capturing
  continuations", and COMPILER.md: "Neither needs first-class
  continuations, which is what makes them portable".

The first reason argues for **at most once**, not for **now**. The second
is the targets talking. The cost of "now" is everything in §1.1 to §1.3,
plus three things that had to move into the runtime because a program
can't write them (§2.4): the Cells handler, a page's suspension, and any
scheduler.

**Push it out (L54):** a third operation shape, *answered later, at most
once*. The case gets the rest of the computation as a value it may resume
once, now or later, or drop. Calling it twice is an error the runtime
reports (OCaml 5 does exactly this). The checker's existing rule (an answer
may not be a `Choice`) stays. The two shapes that exist become the cheap
special cases they already are in Koka (`fun` and `final ctl`), and the
compilers keep their fast paths for them. Only operations declared with the
new shape cost a captured continuation, and only on targets that need one.

## 2. Inherent to the idea (a), each with a simpler idea

### 2.1 The world-under-Choice rule is checked beside the types, and leaks

The rule is good and it is the language's own: Console, Files and Update
can't be taken back, so they may not run where a search might abandon or
repeat the path. Verse has the same rule (its `<transacts>` and
`<no_rollback>` effect specifiers: what runs in a failure context must be
able to roll back).

It is checked by `worldUnderChoice` in `src/lang/infer.ts`, a walk over each
function's calls that follows lets and parameters and says in its own
comment: "A function held in a variable other than a let isn't followed,
so that case is still open." That case is easy to reach. This program
checks with no errors and prints three times:

```
main = () => count(() =>
  x = one of([1, 2, 3])
  match [(s) => print(s)]
  | cons(f, rest) → f("trying"); fail()
  | nil → fail())
```

(Built with the DSL as a test file, `infer` gives `errors: []`, `runMain`
prints `trying` three times. Not committed: findings before fixes.)

Why a walk and not the types: rows **unify** at calls instead of **nest**.
A thunk handed to `count` gets the row "Choice and whatever the function
around it does", so if `main` prints anywhere, every thunk inside it says
Console too, and the types can't tell which thunk prints. COMPILER.md has
the same root as its "one known imprecision" (a pure lambda passed to `map`
inside a search becomes a generator).

**Simpler idea (L53):** let a function's row be *contained in* the row of
the place it's used, instead of equal to it. A lambda's row is then its own
effects, and "a search may not do world effects" becomes a constraint on
the search parameter's row, the way `plain` already constrains a type
variable (`Subst.plain`). It's checked by unification, everywhere, with no
walk and no holes, and the imprecision in COMPILER.md goes with it. Koka
does containment with `open` at every use; this project already does it
for variables (`opened()` in infer.ts), and the step is to do it where a
lambda is passed too. Effekt avoids the problem a different way, by making
functions passed to handlers second class; that is a bigger change and not
needed here.

### 2.2 Two kinds of effects

| built in, no operations | declared in std, with operations |
|---|---|
| Choice, Diverge, Console, Files, Cells, Update, Network | Abort, Log, Random, Time, Wait, and a program's own |

Declared effects are handled by a `match`, and what nothing handles goes to
the runtime (Log to standard error, Random to the platform's randomness,
Time to the clock). So a test can fix the clock with `match … | now() → 0`.
Builtins can't be matched: there is no way to run a printing function in a
test and collect what it printed, or to give `read file` a fake file. This
is history, not design: Console was in the typed core before declared
effects existed (PR #10 vs #48).

**Simpler idea (L55):** Console, Files and Network become declared std
effects like Random, answered by the world when nothing handles them.
"World" becomes a flag on the declaration (this effect can't be taken
back), which is what the search rule (§2.1) reads. The builtins left are
the two that genuinely aren't operations: `Diverge` (a property, like
Koka's `div`) and `Choice` (built in, like Verse's choice, because it
resumes many times, which declared effects deliberately can't). Cells and
Update follow once a handler can hold state (§2.4).

### 2.3 Effects can't take a type

"Effects take no type parameters, because rows hold effect ids." The
reason is the checker's data structure, not the idea. The cost: an error
that carries data needs its own effect (`effect Invalid`), there is no
`State s`, no `Yield a` (generators), no `Emit a`, and for concurrency no
`Channel a` or `Promise a`.

**Simpler idea (L56):** a row holds applied effects (`Yield Int`), as in
Koka, Unison (`{Stream a}`) and Effekt. Unifying two rows then unifies the
arguments of matching effects. The compilers key handlers by the effect's
id, which still works (COMPILER.md relies on "effects have no type
parameters" only for that key).

### 2.4 A handler has no state, so the runtime holds it all

LANGUAGE.md "Cells": "No handler for Cells written in the program. The
handler keeps state … and handlers in the language have neither state nor
continuations, so it is the runtime's." The same is true of the page's
suspension, the clock cell, the fetch memo and the world. L16 asks for "a
stateful handler form".

**Simpler idea:** no new form. With §1.5, state is an ordinary handler that
passes its state along as it resumes (the parameter-passing handlers of
Plotkin and Pretnar, and Koka's `var` and `local` handlers). L16's stateful
handler is a consequence of L54, not an item of its own.

### 2.5 A handler can't change the result's type

A handler's value is the handled computation's value when it finishes
normally, so `match compute() | abort(why) → none` requires `compute` to
give an `Optional` already. Every handler paper and language has a
*return case* for this (`| done(x) → some(x)`), OCaml's value case
included.

**Simpler idea (L57):** an optional case for the normal finish. Small,
and a match on data already has the `otherwise` slot to model it on.

### 2.6 Six closed rows, named in TypeScript

The ledger (`src/lang/ledger.ts`, LANGUAGE.md "Where effects go") is the
best thing in this area: every place an effect leaves a row is a call to
`discharge`, the table is generated, and a test checks it. Keep it.

What it shows is six closed rows written in `std.ts`: a page's view, a
page's handler, a program's main, a shader, a sound's block function, a
sound's maker. Each has a good reason. But they're invisible in the
language: `Html`'s `text` field reads as `() -[Cells, Diverge, Time,
Network, Log]-> Text`, LANGUAGE.md's copy of the `Html` type is already
stale (it shows no `Log`), and the differences between the rows (a handler
may use Files but not Wait, a sound block may write cells but not read the
clock) are policy no one can see without reading TypeScript.

The idea underneath is clean: **a host is the outermost handler**, and
what it handles is a row. **Simpler idea (L58):** say so in the language.
Named rows in std (`row View = Cells, Diverge, Time, Network, Log`,
`row Handler = …`, `row Main = …`), used by `Html` and `Attribute` by name.
The ledger's table becomes the list of those definitions, and a view's row
reads as `() -[View]-> Text`.

### 2.7 Diverge where nothing diverges, and `read` says Diverge

Already in the backlog (L46, L47, L16's guarded corecursion). `read` has
`Diverge` because a formula's action runs at a later read, so its effects
can't show where it was made. That is inherent to laziness plus totality,
and the honest fix is guarded corecursion. Not a target dent.

### 2.8 What is right, and should stay as it is

- Rows are sets and inferred, so `map` is one function, never `mapM`.
- A handler is a `match`; an operation is a case. This is the cleanest
  part of the design. Frank had it first ("handlers are functions that
  pattern-match on commands", §4), and OCaml 5.3 has the syntax.
- Deep handlers, so a `Log` case that logs reaches the next one out.
- An answer may not be a `Choice` (a handler can't resume twice in
  secret), and an abort cuts the alternatives (Prolog's `catch/3`).
- `Choice` built in, `Optional` as its data form, absence as failure.
- The criterion for "world": can it be taken back or seen outside? Log,
  Random, Time and a GET can't be seen outside, so they may run in a
  search; a print, a file write and a cell write can.
- Time in a page as a cell written each frame (Fran's time-varying
  values), and reactivity as a handler's dynamic scope (Solid's current
  listener). Both are effects ideas, not JavaScript ideas.
- Variables with closed rows opened at each use (Koka's `open`).

## 3. Hosting kinks (b), briefly

None of these changes what a program means. Each is fine where it is.

- **JavaScript:** a handler stack (`$perform`, `$handle` in
  `compiler/src/runtime.js`), aborts as `Escape` exceptions, `Choice` as
  generators or `$k` continuations, `$handleS` keeping a handler on the
  stack across a generator's steps. Effect polymorphism specialised on the
  one bit "does this row have Choice" (`map` and `map$choice`).
- **WebAssembly and C:** `Abort` is status 2 with its reason beside it, a
  search is success continuations (Mercury's high-level C, credited). Of
  the declared effects, only Abort is compiled, and it is found by its id
  (`ABORT_OP` in `compiler/src/scalar.ts`). A program's own effect whose
  operation never returns has the same shape and could compile the same
  way; recognising the shape instead of the id is a small target item
  (C34, for the Compiler lane; done). Answered effects, Random, Time, Network and
  Cells are refused with a reason, which is the right way for a target to
  be smaller than the language.
- **WGSL:** no effects but `Diverge` under a literal `with fuel`. Right.
- **The browser world:** Files are localStorage entries named after the
  program; `print` goes to the console; Run main in the editor runs in a
  Web Worker that gets a copy of the files and sends back what it wrote.
- **Node:** `fetch text` blocks on a child process; `wait` sleeps without
  spinning.
- **Audio:** the worklet's copy of the cells is matched to the page's by
  creation order. Fragile, but confined, once §1.4's replay keeps `main`'s
  row the same.

## 4. Prior art, honestly

| | what it has | how this compares |
|---|---|---|
| Plotkin and Pretnar, "Handlers of algebraic effects" (ESOP 2009); Plotkin and Power (2003) | operations, handlers with the continuation as a value, return clauses | This is a fragment: handlers that resume now or never, no return clause. Prior art for all of it, and for parameter-passing state (§2.4). |
| OCaml 5 (Sivaramakrishnan et al., PLDI 2021) | effect cases in `match` (5.3), one-shot continuations, untyped effects | Our syntax is theirs (credited). They have the continuation, used once, and that is how Eio builds fibers. We have rows; they don't. |
| Koka (Leijen) | row-typed effects, `fun` (resume now), `ctl` (resume any time, any number of times), `final ctl` (never resume), `open`, `div` | Our two shapes are exactly `fun` and `final ctl`; we lack `ctl`. §1.5 proposes `ctl` limited to once. Koka's rows also nest by `open` at uses, which §2.1 proposes for lambdas. |
| Effekt (Brachthäuser, Schuster, Ostermann) | capabilities, second-class blocks, contextual effect polymorphism, efficient compilation of handlers | The alternative answer to §2.1: no row variables to confuse, at the price of second-class functions. Credited for compiling tail-resumptive and abortive handlers without continuations. |
| Unison abilities | `{Ability}` rows, handlers with continuations, abilities with type parameters (`Stream a`, `Store s`), IO and exceptions as abilities | The model for §2.2 and §2.3: IO is an ability a test can handle, and an ability takes a type. |
| Frank (Lindley, McBride and McLaughlin, "Do be do be do", POPL 2017) | handlers are ordinary functions that pattern-match on commands; multihandlers over several computations | Prior art for "a handler is a match", which CREDITS.md credited only to OCaml 5.3. Multihandlers (one function handling two computations) are the shape of `pipe` and `select` in concurrency. |
| Verse (Augustsson et al., ICFP 2023 and the language) | choice, failure contexts, effect specifiers `<decides>`, `<transacts>`, `<no_rollback>` | `Choice` is credited to Verse already. The world-under-Choice rule is Verse's `<no_rollback>` rule, and Verse checks it in the types, which is what §2.1 proposes. |

CREDITS.md gets three rows in this PR for prior art it was missing: Frank
for handlers as pattern matching, Koka's `fun`/`final ctl` for the two
operation shapes, and Verse's effect specifiers for the world rule.

## 5. Is this a sound base for concurrency and parallelism?

The sibling thread "Plan concurrency and what a good language needs" is
designing those on top of effects, and has this section.

**Yes for the foundations, no for what's built on them yet.**

What carries over as it is:

- Rows tell, for every function, whether it acts. **Parallelism of pure
  code needs no effect at all**: a function whose row is empty (or only
  reads) can run its parts on several cores and give the same answer, so
  `both(f, g)` and a parallel `map` are library functions with a row
  constraint, deterministic by construction.
- Deep handlers with dynamic scope are what structured concurrency is: a
  scope that waits for every fiber started inside it (Trio's nurseries,
  Eio's switches, Kotlin's `coroutineScope`) is a handler around the
  computation.
- The world/search rule is the shape of the rules concurrency needs ("no
  world inside a transaction", "no shared write across parallel
  branches").

What is missing, in the order it blocks:

1. **An operation answered later, once (L54).** `await`, `yield`,
   `receive` and `sleep` are all operations whose handler keeps the rest
   and resumes it when something happens. Without it, every concurrency
   primitive is runtime code with its own special row, which is the
   monster Ersagun is worried about. With it, a scheduler is a program.
2. **Effects with a type (L56).** `Channel a`, `Promise a`, `Yield a`.
3. **The world rule in the types (L53).** Concurrency adds more "not here"
   rules; a flow analysis that already leaks won't carry them.
4. **One kind of effect (L55).** So the event loop, the console and the
   network are handlers like the rest, and a test can run a concurrent
   program with a fake clock and a fake network deterministically.

How the targets host it is their business: JavaScript has generators and
async functions (and the compiler's continuation-passing already), the
evaluator has heap continuations, WebAssembly has the stack-switching
proposal or continuation-passing, C has continuation-passing or a stack
per fiber. Each is a kink in one target, which is the acceptable kind.

## 6. The proposals, in priority order

Bugs first, then what removes special cases, then what the concurrency
design needs (Ersagun's next topic). Rows L52 to L60 and C34 in BACKLOG.md.

| id | what | class | why first |
|---|---|---|---|
| L52 | A page handler that writes, prints or saves before it fetches is refused (until L54 removes the re-run) | (c) bug | writes happen twice today |
| L53 | Rows nest: a lambda's row is contained in its place's; the world rule becomes a row constraint, `worldUnderChoice` goes | (a) bug | the rule leaks (§2.1) |
| L54 | Operations answered later, at most once; design note first | (c) root | removes §1.1 to §1.3 and the runtime-only handlers; concurrency needs it |
| L55 | Console, Files and Network declared in std, answered by the world; "world" a flag | (a) | one kind of effect; tests can answer printing and files |
| L56 | Effects take type parameters | (a) | `Channel a`, `Yield a`, `State s` |
| L57 | A handler's case for the normal finish | (a) | small |
| L58 | Named rows for the hosts (`View`, `Handler`, `Main`, `Sound`) | (a) | the policy becomes readable |
| L59 | After L54: page waits and fetches resume instead of re-run; `Wait` folds into `Time`; the fetch memo scoped to a search | (c) | the pushback for §1.1 to §1.3 |
| L60 | After L54: the audio worklet's `main` replays the page's random numbers and clock; `main` keeps one row | (c) | §1.4 |
| C34 | (Compiler lane) WebAssembly and C compile any never-returning operation, not only Abort by id | (b) | small |
