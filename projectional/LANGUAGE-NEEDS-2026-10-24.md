# What the language needs next, 2026-10-24: concurrency on effects, and an honest inventory

Ersagun asked (2026-10-24, 07:50): *"We need good concurrency/parallelism
primitives. I feel like effects is a very good start for them. What else can
you think of we need for a good language?"*, with a rule attached: our ideas
should be simple and clean in the language, and if that makes a target
awkward, so be it; the targets' weirdness must not dent the language.

Part 1 designs concurrency and parallelism as one idea on the effects the
language already has. Part 2 is an inventory of what a serious language
still lacks, ranked by what blocks real programs now. Both end in proposals
that go into BACKLOG.md (rows L60 to L69 and C40 to C45). Nothing here is
built yet.

**How it was read.** LANGUAGE.md (effects, cells, pages, "Where effects
go"), WEB.md, AUDIO.md, COMPILER.md, WASM.md, NATIVE.md, NUMBERS.md,
LANGUAGE-REVIEW-2026-10-24.md, both REVIEWs, the QA reports, compiler/GAPS.md,
NOTES.md, std.ts's builtins, the prelude and BACKLOG.md.

## The short answer

**Concurrency: one function, not a new feature.** Add `together(actions)`,
which runs a list of actions and gives back their answers in order. Its type
is exactly `map(actions, run)`'s:

```
together : (List (() -[e]-> a)) -[e]-> List a
```

so a program that uses it means the same as the sequential one, except that
branches that *wait* (on the clock, the network, input) wait at the same
time. There are no `async` or `await` words, no promises or futures as
values, no `spawn` that returns a handle, no locks, and no colours on
functions: a function that fetches is `-[Network]->` whether or not it runs
inside `together`, as today. With it come `race(actions)` (the first to
finish wins, the others stop) and `within(ms, action)`, which is `race`
against a `wait`.

**And `together` is written in the language, not in the runtime.** The
effects review (EFFECTS-REVIEW-2026-10-24.md §5, PR #359) found the one
shape effects lack: an operation its handler answers *later*, at most once
(L54). With it, `together` is a handler of about twenty lines in the
prelude, a scheduler is a program, and the runtime keeps only the world's
event loop. This design is built on L54 rather than around it, so that
concurrency doesn't become runtime code with special rows, which is the
monster Ersagun asked us to avoid.

**Parallelism is a property of pure code, concurrency of waiting code**
(Marlow's distinction). The rows already say which is which. A branch with
no world effects may run on another core, and nobody can tell, because pure
code has one answer. A branch that waits runs as a fiber on the same thread
and gives way only where it waits. One primitive covers both, and the
runtime picks per branch from its row.

**The one dent this removes.** Today an event handler in a page that
fetches is *run again from the start* when the reply comes, and LANGUAGE.md
asks programmers to "fetch before you write". That is the browser's
inability to block leaking into the language. With fibers, the handler just
waits where it fetched. This is the clearest case of Ersagun's rule in the
current design; the effects review files it as L52 (refuse the double
run now) and L59 (resume instead, after L54).

**What else a serious language needs, in order:** (1) maps and sets, with an
order on plain data so they have one meaning; (2) nested patterns and
destructuring, already proposed as L35 and L37, which should move up;
(3) `Outcome`, the data form of `Abort`, as `Optional` is of `Choice`;
(4) a foreign function interface, which websites and phone apps can't do
without; (5) `together` and real suspension in pages (Part 1); (6) tests in
the language (T7, already designed); (7) text formatting, and parsing as
printing run backwards; (8) stateful handlers (L16) and sharing modules
between projects. Numbers are already first in lane L and are not repeated
here.

# Part 1: Concurrency and parallelism, on effects

## What exists that this builds on

The language is closer to this than it looks:

- **Waiting is already an effect.** `Wait` (`wait(ms)`), `Network`
  (`fetch text`), `Console`'s `read line` and `read input`. On the command
  line they block; in a page `fetch text` suspends through a `Pending` cell.
- **The evaluator is already a machine with its continuations on the heap**
  (`src/lang/run.ts`, "How it runs: no stack limit"). Pausing one
  computation and running another is keeping two machine states.
- **Compiled JS already has suspendable copies** of definitions: since C21,
  a definition in a cycle of calls gets a generator copy, so deep recursion
  goes onto the heap. A generator copy that yields at a waiting operation is
  the same code generator with a second reason to yield.
- **Things already run on other threads**: `Run main` in a Web Worker
  (#294), a sound's block function in an AudioWorklet (AUDIO.md), shaders on
  the GPU. None of these is a language feature; each is a runtime handler,
  with a row that says what may cross.
- **Effects decide containment.** A row says what a branch does, so the
  checker can say which branches may run on another core (no world
  effects), and the runtime can say where a branch may give way (a waiting
  operation).

## The one idea

A `together` call is a **handler scope** for waiting. Inside, each branch
is a fiber. A fiber runs until it performs a waiting operation; the handler
starts the wait, runs another fiber, and comes back to the first when its
wait is over. When every branch has finished, `together` gives back their
answers in the order the branches were written. Nothing escapes the call: no
branch outlives it, which is Trio's nursery (Nathaniel J. Smith, "Notes on
structured concurrency, or: Go statement considered harmful", 2018) and the
scope of OCaml 5's Eio `Fiber.both` and `Switch` (prior art).

```
pages = together([
  () => fetch text("https://example.org/a"),
  () => fetch text("https://example.org/b"),
])
```

### How `together` is written: on an operation answered later

This part depends on L54 (an operation answered later, at most once) and
L56 (effects that take a type), both proposed by the effects review. With
them, every waiting operation in std is two halves: *start* the request
(fetch this address, wake me in 30 ms), which gives back a `Ticket a` at
once, and `await(ticket)`, answered later with the `a`. `fetch text(url)`
stays one call for the programmer; it is `await(start fetch(url))`
underneath, in std, written once.

`together` is then a handler, in the prelude, over `await`:

```
together(actions) =
  match run each(actions)                 -- branch by branch, in order
  | await(ticket) later k →               -- a branch waits: keep its rest
      park(ticket, k); run the next ready branch
  -- when every branch is parked: await(any of(tickets)) outward,
  -- which the next handler out (another together, or the world) answers
  -- later with the first ticket that is ready; resume that branch's k
```

(The notation for "answered later" is L54's to choose; `later k` is a
placeholder. `k` is the rest of the branch, usable once.)

What this buys, over a scheduler in the runtime:

- **Nesting is free.** An inner `together` that has nothing ready does
  `await(any of(…))`, and to the outer one that is just a branch waiting.
- **The world has one waiting job:** answer `await(any of(tickets))` when
  one is ready. That is the event loop every host has (the browser's,
  Node's, poll in C), and the only runtime part left.
- **Tests answer it too.** Once Console, Files and Network are declared
  effects a match can answer (L55), a test handler answers `await` from a
  virtual clock and a fake network, in the language (below).
- **Pages get it for nothing.** A page's event handler runs under the
  page's own handler for `await`, so a fetch waits where it is (L59).

Three things follow from it being a plain function of a list of actions:

1. **The meaning is the sequential one.** Take out the `together` and
   write `map(actions, run)`: same answers, same type, same errors. What
   changes is only *when* waits happen, and so the order in which two
   branches' world effects interleave. A pure program can't tell the
   difference at all.
2. **No colouring.** Bob Nystrom's "What color is your function?" (2015)
   is the problem `async` creates: an async function can only be awaited by
   another. Here there is nothing to colour. Koka, Effekt and OCaml 5 make
   the same choice (prior art): direct style, and the handler decides
   whether a wait blocks a thread or switches a fiber.
3. **No new node kind.** `together` is a call with a list. The editor
   draws it as the list it is (see "The editor" below).

### `race` and `within`

```
race   : (List (() -[e]-> a)) -[e]-> a
within : (Number, () -[e]-> a) -[Choice, Wait, e]-> a
```

`race` gives the answer of the first branch to finish and stops the others.
`within(ms, action)` is `race([action, () => (wait(ms); fail())])`, so a
timeout is a `Choice`: it fails, and `first(() => within(500, load), () =>
cached)` reads as what it does. A timeout is not an error, it is no answer,
and the language already has a word for that.

### Stopping: cancellation is a cut, not an exception

When a branch is stopped (it lost a `race`, or a sibling aborted), it
stops at its next waiting operation and nothing after that runs. With L54
that is simply the handler never resuming the branch's `k`: a one-shot
rest that is dropped is a cut. It is the same mechanism as an operation
that never returns: an escaping `abort` already drops the rest of the
computation and every alternative it still had (LANGUAGE.md, "Effects you
define"). Cancellation reuses it.

It is deliberately **not** an `Abort` that a `match` can catch. In Python
and Java, cancellation is an exception, and code that catches every
exception swallows its own cancellation; Trio and Kotlin spend real effort
on that. Here, a branch can't observe that it was stopped, so it can't
refuse. If the language gets resources that need closing (none today: a
file is written in one call), they get a scope that closes them on every
way out, including this one.

### Errors

An `Abort` in one branch stops its siblings and comes out of `together`
as the `Abort` it was, where a `match … | abort(why) → …` around the call
catches it. That is structured concurrency's rule (Trio, Swift's task
groups, Kotlin's coroutine scopes) and Erlang's link: a failure isn't lost
in a background task nobody waits for. `Choice` inside a branch is what it
is in `map`: `together` of two searches has every combination of their
answers, in the sequential order. Running the search's branches in parallel
is a separate thing, below.

### Shared state

Branches share nothing but cells, and cells already have a rule: a write is
`Update`, a world effect. Between two waits a fiber runs alone, so each
stretch from one wait to the next is atomic, and two fibers can't tear a
write. That is cooperative scheduling as JavaScript, Eio within a domain and
asyncio have it (prior art), and it means **no locks, no atomics and no
data races in the language**, on purpose. A branch that writes cells or
does world effects runs as a fiber, never on another core; only pure
branches go there.

Software transactional memory (Harris, Marlow, Peyton Jones and Herlihy,
"Composable memory transactions", 2005) was considered and is not proposed:
with no preemption there is nothing for a transaction to protect against.

### Channels, later

When fibers need to pass a stream (a producer and a consumer in a
pipeline), a `Channel a` made inside a `together`'s scope, with `send` and
`receive` that wait, is Go's and CSP's channel (Hoare, 1978; Go, 2009) kept
inside the scope so it can't outlive its fibers. This is the last step of
the plan, after programs show they need it: most of what a page wants
between parts is already cells.

### Actors: not a feature

Erlang's processes and mailboxes (Armstrong, 2003) solve two problems:
running many independent things, and surviving failure. The first is
`together` plus channels. The second is a supervisor, which is a library
function here: `retry(n, action)` is a `match` on `abort` that runs the
action again. A process with a mailbox that lives forever is what a page
already is: its state is cells, its messages are events. So there is no
actor construct; if a server program ever wants one, it is a library over
channels.

## Deterministic testing of concurrent programs

Because waiting is an effect and the scheduler is its handler, a test can
answer it (once L55 lets a match answer Network and the console, and the
clock as it already can). Under `seeded(seed, action)` the scheduler's choices (which
ready fiber runs next) come from the same generator, and a `match` that
answers `wait(ms)` and `now()` from a virtual clock (`| wait(ms) → unit`
already skips pauses) runs a concurrent program the same way every time,
with no real waiting. A failing interleaving is a seed you can paste into a
test. This is FoundationDB's deterministic simulation testing (Will Wilson,
"Testing distributed systems with deterministic simulation", Strange Loop
2014) and tokio's paused clock (prior art), and it comes from the effects
design almost for free. Proposed as L63; it should land before anything
ships `together` to a page.

## Parallelism

Three kinds, each decided by rows, none needing a word in the program
beyond what's there.

**1. Pure branches of `together`.** A branch with no world effects, no
`Update` and no waits can run on another core. The answer is the same
either way, so the runtime decides by cost (a branch worth less than a
thread hop runs in place). This is Haskell's `par` (Hammond and Peyton
Jones; Marlow et al., "Seq no more", 2010) without the annotation: the
programmer says "these are independent" by writing `together`, and the row
says "and safe".

**2. Data parallelism over arrays.** `map` of a pure function over a list
that is an array (C30), and a fold whose step is associative, can split the
array across cores, or across the GPU, where a shader already is a pure
function on every pixel. Associativity is where this meets the numbers
work: L38's one `+` and `·` range over closed algebraic structures, and a
structure's laws say that `+` is associative, so `total`, `sum` and a dot
product split safely. NESL (Blelloch, 1990s) and Futhark (Henriksen et al.,
2017) are the prior art for nested data parallelism from a functional
language; the compiler picks it the way it picks a representation, by cost,
and the editor says where it did.

**3. Searches.** `all` and `count` collect every answer of a `Choice`, so
their alternatives are independent and can be split across cores
(or-parallelism, as in the Aurora and Muse parallel Prologs, around 1990,
prior art), with work stealing as Cilk does (Blumofe and Leiserson, 1999;
Frigo, Leiserson and Randall, "The implementation of the Cilk-5
multithreaded language", 1998). `all` puts the answers back in the
canonical order, so its result doesn't change. `first` may try later
alternatives speculatively but must give the first answer in canonical
order, so it waits for earlier ones; that keeps `first` meaning what it
means. Eight queens, Countdown and the relational solves are the
obvious first users.

What isn't proposed: annotations like `par` and `pseq`, parallel
strategies, or threads in the language. Thirty years of automatic
parallelism say the granularity is the hard part; the answer here is that
`together` marks independence, the rows mark safety, and the runtime marks
cost. The editor shows the result, so it's not magic.

## Pages and audio

- **Event handlers become fibers.** A click handler that fetches waits
  where it fetched, then goes on. The "run again from the start" rule and
  its advice go away. Two clicks while a fetch is out are two fibers; each
  writes when its reply comes. This is the effects review's L59 (after
  L54); until then its L52 refuses a world action before a fetch in a
  handler, so nothing happens twice.
- **Views keep Suspense.** A view is a pure read of cells, so running it
  again when a reply lands is correct and cheap, as Solid's resources do.
  Nothing changes there.
- **A page's `main`** may use `together` to fetch what the first draw needs.
- **Audio stays outside.** A sound's block function already runs on its
  own thread with no waiting effects in its row, under a deadline. That is
  parallelism by row, the same rule as pure branches, applied to the audio
  thread. Nothing changes for audio, which is the point: it already fits.

## What each target does

The language is the same everywhere; this table is where the kinks go.

| target | fibers (waiting branches) | parallel pure code | kinks |
|---|---|---|---|
| evaluator (`run.ts`) | `k` is the machine's continuation, already on the heap; the world answers `await(any of …)` from a promise | none needed (one thread); answers identical | none: this is where the design is easiest |
| compiled JavaScript | a definition that can perform an answered-later operation gets a suspendable copy (C21's generator copies, yielding at the operation), so `k` is a paused generator; the world's `await(any of …)` is a promise | worker_threads in Node, Web Workers in a page, for a branch over a cost; data copied by structured clone | copies of data across workers; two copies of some definitions (already true since C21) |
| WebAssembly | JavaScript Promise Integration (JSPI) suspends the module on a host promise; later the stack-switching proposal (typed continuations, WasmFX) gives fibers inside the module | the threads proposal shares linear memory only; WasmGC objects can't cross threads until a shared-GC proposal lands, so pure parallel branches run in place | parallelism waits on the platform; the language doesn't change for it |
| native C | each fiber its own small stack (a context switch like Go's goroutines or Boost.Context), an event loop over poll or epoll for waits | a pool of threads with work-stealing deques (Chase and Lev, 2005; Cilk's work-first rule) | reference counts on cells that cross threads must be atomic: a cell is marked shared when it crosses, as Koka does (Ullrich and de Moura; Reinking, Xie, de Moura, Leijen, "Perceus", 2021), so cells that never cross keep cheap counts |
| WGSL | no `together` (no waiting on a GPU) | a shader already is data parallelism; data-parallel `map` over arrays becomes a compute shader later | none new |

The evaluator goes first, as with every feature: it defines the meaning,
the targets are tested against it, and a target that can't yet do the
parallel part runs the branches in place with the same answers.

## The editor

- `together`, `race` and `within` are calls; `together`'s list is drawn as
  a list node, its branches side by side, which reads as a fork and a join
  without a new shape.
- Where the compiler made something parallel (a pure branch, a data-parallel
  map, a search), the node gets the same kind of note a `solve` will get for
  its mode (L11): "runs on 4 cores", "fiber: waits on Network".
- The trace, later, gets a timeline: one row per fiber, a bar where it ran,
  a gap where it waited. That's a view of the trace the editor already
  records, not a new mechanism.

## What this needs from the effects design

The effects review (PR #359, its §5 written for this note) says effects
are a sound base for concurrency and one shape short. Kept as they are:
inferred rows (so pure code runs in parallel with no effect at all), deep
handlers (a structured scope is a handler around the computation), and the
world-under-search rule (the model for every "not here" rule concurrency
adds). Needed, in the order they block this design:

1. **L54, an operation answered later, at most once** (Koka's `ctl`,
   one-shot as OCaml 5's continuations are). `together`, `race`, `await`
   and later `receive` are written on it. The two shapes there are today
   (answered now, never answered) stay the fast cases.
2. **L56, effects that take a type**, for `Ticket a` and `Channel a`.
3. **L53, the world rule as a row constraint**, not a walk over the code:
   the "pure branch" test for parallelism (L62) is the same kind of
   constraint, and the review shows the walk leaks.
4. **L55, Console, Files and Network as declared effects**, so a test can
   answer them and a concurrent program runs with a fake clock and network.

So L54's design note, which the review says is to be written "with the
concurrency thread", is the first step of this plan: L60 below is that
note and `together` together.

# Part 2: What a serious language still needs

The goal is regular programs, shaders, websites, phone apps and audio. The
inventory below is against that goal, ranked by what blocks or bends a real
program **now**. Numbers (L38 and the numeric tower) are already first in
lane L and stay there; they're not repeated.

## 1. Maps and sets (blocks real programs now)

There is no map, no set and no array type in the language (REVIEW.md listed
them on 2026-10-22; still true). The ledger keeps its totals per
account in a list that `add to` walks for each entry, and sorts them with an
insertion sort of its own (`sorted`, `insert`); every program that counts
words, groups lines or memoizes writes the same thing again. In other languages
this is the first library type anyone reaches for.

Proposal, in NUMBERS.md's sense of meaning and representation:

- **Meaning.** `Map k v` is a finite function, spelled canonically as its
  pairs sorted by key with no key twice (a quotient type, as NUMBERS.md
  "Canonical spellings" describes). `Set k` is `Map k Unit`. Because the
  meaning has one spelling, `equal`, `show`, hashing and content addresses
  work on maps with no special case, and a fold over a map goes in key
  order on every target. That is better than JavaScript, Python or Go, whose
  iteration order is an accident of the representation.
- **Representations.** A balanced tree (weight-balanced, as Haskell's
  containers; Adams, 1993) by default; a hash array mapped trie (Bagwell,
  2001) where keys hash and order is only needed for folds; a plain hash
  table changed in place when nobody else holds it, which Perceus-style
  reuse (#202, N5c) already knows how to detect. Chosen by cost, like
  everything else in NUMBERS.md.
- **Keys need an order.** That needs item 2's `compare`.
- **Running backwards.** `lookup(m, k) = v` run backwards over `k` is "which
  keys hold v", a search the relational interpreter can do on the meaning.
- **In the editor**, a map literal is drawn as a two-column table.

**Arrays** are not a separate type: they are C30's representation of
`List`, which should finish first. A persistent vector (Bagwell and Rompf's
RRB trees, 2012) is a later representation of `List` for programs that
index and update in the middle (C45).

## 2. An order on plain data, and sort

`equal` works structurally on any plain data. There is no matching
`compare`: `<` is on numbers, `comes before` on Text, and each program
writes its own for records. A structural total order on plain data (cases
in declaration order, then fields left to right, as OCaml's `compare` and
Erlang's term order do) gives `sort`, `smaller`, `larger`, `Map` keys and
`Set` elements to every type at once, as a constraint the checker already
knows how to carry (`plain data`, like `equal`'s). Small, and it unblocks
item 1. (L66.)

## 3. Nested patterns and destructuring (already proposed: move up)

LANGUAGE-REVIEW-2026-10-24 found that parsing is a staircase of matches
(§4, L37) and returning two things means a one-case match (§3, L35). These
make every bigger program look contrived, and they're what a programmer
meets in the first ten minutes. They are already in lane L at P2;
**this review recommends they come right after Complex (L40)**, before the
rest of the numeric tower, because more programs need them than need
Clifford algebras. That is Ersagun's call; nothing here reorders the lane.

## 4. `Outcome`: errors as data

`Choice` has a data form, `Optional`, so an absent value can be stored in a
list. `Abort` has none: to keep "this line failed, and why" in a list
(a batch import, a form with several fields, `together` where one branch
may fail without stopping the rest), a program writes its own type and its
own match. Proposal: `Outcome a = done(value: a) | refused(reason: Text)`
in std, with `attempt(action)` (the run as an Outcome) and `value or
abort(o)` (back to Abort), exactly mirroring `optional` and `value of`.
That's the whole error story: `Choice` for no answer, `Abort` for a reason,
a declared effect for a typed error (already possible, LANGUAGE.md), and
each with a data form. Rust's `Result` and `?` are the influence; the
difference is that the effect is the default and the data is the
exception. (L67.)

## 5. A foreign function interface (blocks websites and phone apps)

A website needs the browser's APIs, a phone app the device's (camera,
storage, notifications), a command-line program the environment. Today
every host function is a builtin added to std.ts by hand. L7 already made
one record per builtin, with its JavaScript, WASM and C sides. Proposal:
the same record as a user declaration, a **foreign definition**: a name, a
type with its effect row (checked, and trusted), and a body per target,
any of which may be missing (and then the program doesn't build for that
target, with the reason). Gleam's `@external` and Elm's ports are the
influences: Gleam for one declaration with a body per target, Elm for the
rule that what comes in is checked at the boundary. The row is the
promise: a foreign function that says it is pure must be, and the docs say
that is the programmer's word, not the checker's. (L69.)

## 6. Concurrency (Part 1)

`together`, real suspension in page handlers, and the seeded scheduler.
Ranked here, not first, because no current program is blocked by it; but
the page-handler rerun is a dent in the language today, so the effects
review's L52 and L59 are bug fixes as much as features.

## 7. Tests in the language (already designed: T7)

TESTING.md's T7 (accepted answers next to examples, laws as definitions
with a `Check` effect, cached by hash, Unison prior art) is the right
design and doesn't need repeating. It belongs in this list because a
language people trust has its tests in it, and because the `Check` effect
and the seeded scheduler (L63) are the same kind of handler.

## 8. Text: formatting, and parsing as printing backwards

Text has the basics and counts positions in characters (code points). What
real programs miss:

- **Formatting numbers**: fixed decimals, padding, thousands separators.
  Every report program (ledger, wc) writes its own. A few prelude functions.
- **Interpolation as a view.** `"total: " ++ show(n)` chains could print as
  `"total: {n}"`, a view over `join all`, no new node (the review's notation
  line).
- **Grapheme clusters.** An emoji with a skin tone is several code points;
  `length` says more than one. A `graphemes(t)` beside `characters(t)`
  (Unicode UAX #29), not a change to `length`.
- **Parsing.** The language's unusual strength is that a printer run
  backwards is a parser: `inverse(view, text)` already reads the
  converter's fields back. A grammar written once, as a printer, gives both
  directions, which is the idea of invertible syntax descriptions
  (Rendel and Ostermann, 2010) and of Boomerang lenses (Bohannon et al.,
  2008), prior art. ROADMAP's research list has "fast invertible parsing";
  the proposal is to make calc's parser the first program written that way,
  in a design note first. (L70.)

## 9. Stateful handlers (already proposed: L16)

Handlers have neither state nor continuations, so the Cells handler, the
world and (with Part 1) the scheduler are the runtime's. A handler with
state (a value it threads from one operation to the next, as Koka's and
Effekt's parameterised handlers do) would let a program mock `Console` in a
test, render a page on a server, or write its own cache. It's the one
extension of the effects design this review would consider, and only after
the effects review says the base is sound. First-class, multi-shot
continuations are not proposed: they are what makes handlers hard to
compile and hard to think about. The one-shot, answered-later operation of
L54 (Part 1) is the most this review would add, and it is enough for
concurrency.

## 10. Sharing code between projects

Modules are named by hash, imports are references, signatures are pins
(LANGUAGE.md "Signatures and modules"). What's missing is the outside:
fetching someone else's module by its hash, a name for it in your project,
and a browser for what's published. Unison has shown this needs no version
numbers, since a hash is a version (prior art). Not blocking anything yet;
it will be when there are two projects. (L68, P3.)

## Things checked and not proposed

- **Classes, inheritance, interfaces you declare.** Constraints stay
  closed and structural (records of Numbers, plain data, the algebras of
  L38, and an order). Open type classes are where a language's generics get
  hard to read; nothing so far needs them.
- **Mutation.** In-place update when nobody else holds a value (#202,
  N5c) gives the speed; cells give state where it's meant. A mutable
  variable would be a second way to do both.
- **Macros.** The program is a tree and the editor edits trees; a macro is
  a function on trees that would bypass the checker. Views do the job
  notation-macros do elsewhere.
- **Null, exceptions as values, implicit conversions.** None exist, and
  none should.

# Plan

In BACKLOG.md as proposals, lane by lane. Ids start at L60 and C40 so they
can't clash with rows other threads add today.

| id | what | lane | size | after |
|---|---|---|---|---|
| L60 | L54's design note with this one, then `together`, `race`, `within` in the prelude as handlers over `await`; std's waiting ops as start + await; Abort stops siblings; cancellation is a dropped `k` | L | L | L54, L56 |
| L62 | Pure branches marked by a row constraint (no world, no Update, no waits) and shown in the editor; the runtime may run them elsewhere | L | S | L60, L53 |
| L63 | Deterministic schedules: under `seeded` the scheduler's choices are seeded, a match answering `await` gives virtual time and a fake network; a test shows an interleaving bug found by a seed | L | M | L60, L55 |
| L64 | Scoped channels (`Channel a`, `send`, `receive`), when a program needs one | L | M | L60, a program |
| L65 | `Map k v` and `Set k`: meaning as sorted pairs, a balanced tree first, folds in key order, drawn as a table | L | L | L66 |
| L66 | A structural order on plain data: `compare`, generic `sort`, `smaller`/`larger` on any plain data | L | S | — |
| L67 | `Outcome a` with `attempt` and `value or abort`, the data form of Abort | L | S | — |
| L68 | Sharing modules between projects by hash, with a browser | L | L | — (P3) |
| L69 | Foreign definitions: a typed, rowed declaration with a body per target, on L7's builtin records | L, C | M | — |
| L70 | Design note: grammars written once as printers, parsed by running them backwards; calc's parser as the first | L | M | — |
| C40 | Compiled JS for L54 and L60: suspendable copies (C21's generators) for definitions that perform an answered-later operation; the world's `await(any of …)` as a promise | C | M | L60 |
| C41 | Pure `together` branches on worker_threads / Web Workers, over a cost threshold | C | M | L62 |
| C42 | Data-parallel `map` and associative folds over arrays, on a thread pool and later as compute shaders | C | L | C30, L38's laws |
| C43 | Or-parallel `all` and `count`, and speculative `first` in canonical order, with work stealing | C | L | C41 |
| C44 | Fibers natively (own stacks, an event loop) and in WASM (JSPI) | C | L | C40 |
| C45 | A persistent vector (RRB) as a representation of `List` for indexed updates | C | M | C30 |

## Recommendation

Do the quick unblockers in lane L right after the current numbers step:
**L66** (order), **L67** (Outcome), then **L65** (maps), with L35 and L37
moved up beside them. Start concurrency with the effects review's **L52**
(the page-handler bug, now) and **L53**, then **L54's design note, written
as L60's first step**, with **L56**; then `together` and **L63** in the
evaluator, **C40**, and the review's **L59**, which removes the
page-handler dent for good.
Leave parallelism (C41 to C43) until a program is slow for want of it: the
pedal, the ray marcher and Countdown are the candidates, and the
bigger-program rounds will say when. FFI (L69) goes in when the first
website or phone app needs a browser or device API that isn't in std.

## Prior art and influences

Each is named where it's used above; collected here.

- Structured concurrency: Trio (Nathaniel J. Smith, 2018, influence); OCaml
  5 Eio's fibers and switches (Madhavapeddy, Leonard et al., prior art);
  Swift task groups and Kotlin coroutine scopes (prior art).
- Effects as the way to async without colours: Koka (Leijen), Effekt
  (Brachthäuser, Schuster, Ostermann), OCaml 5 effects (Sivaramakrishnan et
  al., "Retrofitting effect handlers onto OCaml", 2021) (influence); Bob
  Nystrom, "What color is your function?", 2015 (the problem named).
- Parallel and concurrent as different things: Simon Marlow, *Parallel and
  Concurrent Programming in Haskell*, 2013 (influence); `par`/`pseq` and
  strategies (Trinder, Hammond, Loidl, Peyton Jones, 1998; Marlow et al.,
  2010) (considered, annotations rejected).
- Work stealing: Cilk (Blumofe, Leiserson; Frigo, Leiserson, Randall,
  1998); Chase and Lev's deque, 2005 (to be adapted when built).
- Or-parallel Prolog: Aurora and Muse (around 1990) (prior art).
- Data parallelism: NESL (Blelloch), Futhark (Henriksen, Serup, Elsman,
  Henglein, Oancea, 2017) (prior art).
- Channels and processes: CSP (Hoare, 1978), Go, Erlang (Armstrong)
  (influence, actors rejected as a construct); STM (Harris, Marlow, Peyton
  Jones, Herlihy, 2005) (considered, rejected).
- Deterministic simulation: FoundationDB (Will Wilson, 2014), tokio's
  paused time (prior art).
- Thread-shared reference counts: Koka and Lean 4 (Perceus, Reinking et
  al., 2021; Ullrich and de Moura, 2019) (influence).
- Maps: weight-balanced trees (Adams, 1993; Haskell's containers), HAMT
  (Bagwell, 2001), RRB vectors (Bagwell and Rompf, 2012) (to be adapted).
- Order on data: OCaml's `compare`, Erlang's term order (prior art).
- Errors: Rust's `Result` (influence). FFI: Gleam's `@external`, Elm's
  ports (influence). Parsing backwards: invertible syntax descriptions
  (Rendel and Ostermann, 2010), Boomerang (Bohannon, Foster, Pierce,
  Pilkiewicz, Schmitt, 2008) (prior art). Grapheme clusters: Unicode UAX
  #29. Code by hash: Unison (prior art).

## The effects review

The sibling thread's review is EFFECTS-REVIEW-2026-10-24.md (PR #359).
Its verdict for this note, in its own words: effects are "a sound base for
concurrency, but they are one shape short". Its proposals L52 to L59 are
the foundation of Part 1: L54 (answered later, once) and L56 (effects with
a type) are what `together` is written on; L53 and L55 are what the
parallelism test and the deterministic tests need; L59 is the page
handler fix that this note first proposed as its own row (dropped in
favour of L59). The targets' ways of hosting a resumption (generators in
JavaScript, the heap continuations the evaluator already has, stack
switching or continuation passing in WebAssembly, a stack per fiber or
continuation passing in C) are hosting kinks, which is where Ersagun's
rule says they belong.
