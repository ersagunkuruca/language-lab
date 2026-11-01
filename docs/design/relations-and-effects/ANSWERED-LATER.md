# Operations answered later, and concurrency on them

BACKLOG L54, written together with L71 as both rows ask. **Status
(2026-10-30):** step 1 (L54a) is built: the evaluator and the checker run
it (`test/later.test.ts`). Step 2 (C40) is mostly built (2026-11-01: a search defined on its own that waits compiles too), step 3 (L56,
effects that take a type) is built, and steps 4 and 5 are open. The two documents behind it say why it
matters: EFFECTS-REVIEW-2026-10-24 §1.5 finds the root of the page dents
(a handler fetch runs twice, fetch-once, `Wait` apart from `Time`) in "an
operation is answered now, or never", and LANGUAGE-NEEDS-2026-10-24 Part 1
writes `together`, `race` and `within` on top of the missing shape.

## Short answer

An operation gets a third shape: **answered later, at most once**. Its
handler case is given the rest of the computation as an ordinary function
value. The case may call it once, now or later, or drop it. A second call
is an error the runtime reports, as in OCaml 5. Nothing else changes:

- **No new node kind.** The shape is a flag on the operation's variant, the
  way "never returns" is the absence of `returns` today. The rest is one
  more binder in the case's arm, after the fields, the way a fold's arm
  has binders for the folded fields.
- **The two shapes there are stay**, as the cheap special cases they are
  in Koka (`fun` and `final ctl`). Programs and compilers keep their fast
  paths. Only an operation declared `later` costs a kept continuation, and
  only on a target that needs one.
- **The handler is still a match**, and still deep: resuming the rest
  resumes it under the same match, so a generator, a scheduler or a page
  runtime is a plain program.

```
effect Yield = yield(item: Float64) returns Unit, later

match count up(3)                         -- yields 1, 2, 3
| yield(item) with rest → cons(item, rest(unit))
```

Here the match gives `[1, 2, 3]` when `count up` itself returns `[]`.
The text notation `with rest` is a placeholder. In the editor the arm shows
the rest as a binder like any other, named "rest" by default.

## Why declared on the operation, not seen from the handler

One idea would be a single shape (every case gets the rest) and letting
the compiler see that a case calls the rest once, at the end (answered
now) or never (never returns). That works for the handler's side. It fails
on the performer's side: compiled code must know, at the place an
operation is *performed*, whether the rest may be kept and resumed later.
That place has to become suspendable (a generator in JavaScript, a
continuation-passing copy elsewhere, C40). If any operation might be kept,
every function with any effect needs a suspendable copy. With the shape
declared, only functions whose rows hold a `later` effect do, and the row
already says which those are.

So a row now tells, for free, which functions may be suspended. That is
the same information an `async` keyword carries, but inferred and never
written: nothing is coloured (Nystrom, "What color is your function?",
2015). A function that calls `fetch text` doesn't change; its row holds
`Network`, and `Network`'s operations are declared `later` (L59).

## Types

For an operation `op(fields) returns T, later` handled by a match whose
value has type `R` and whose own row is `ε`:

- each field binds as today;
- `rest : (T) -[ε]-> R`. Resuming runs the remainder of the handled
  computation under the same handler, so it can do what the match can do
  and gives what the match gives;
- the case's value has type `R` (it replaces the match's value, as a
  "never returns" case's value does).

The existing rule carries over: a case may not give several answers. Its
body may not have `Choice` in its row, so a search can't resume the rest
once per answer. Dropping the rest is allowed, and that is how
cancellation works (below). "At most once" is checked when the program
runs, because a static check would need linear types for one rule. OCaml 5
made the same trade (Sivaramakrishnan et al., "Retrofitting effect
handlers onto OCaml", 2021).

The rest is an ordinary function value, so it can be stored: in a list of
parked fibers, in a record, or in a cell. It may not be compared or shown,
the same as any function.

### Resuming twice, or never

What happens in each case is decided, so a program never meets a surprise:

- **Never resumed.** Allowed, and it means what it says: nothing after
  the operation runs, the same as an operation that never returns. The
  case's value is the match's value, and any choices the computation still
  had are dropped with it, a cut. This is how a page drops a stale request
  and how `race` stops its losers.
- **Resumed twice on one path.** The checker refuses it: "this resumes the
  rest of `yield` a second time: the rest runs once, so resume it on one
  path only". Each branch of a match is its own path. A fold's case runs
  once per item, so the rest can't be used inside one. A case whose own
  row has `Choice` can't hold the rest at all, since a search would resume
  it once per answer (`infer.ts`, `resumedTwice`).
- **Resumed twice after being passed on.** When the case passes the rest
  to a function or stores it in data, that counts as its one use. What the
  receiver does with it can't be followed without linear types, so a
  second call there stops the run with "the rest of `yield` was resumed a
  second time: a rest runs once", naming the operation. This is the only
  part checked when the program runs, and it is where OCaml 5 checks all of
  it.

## How each target runs it

- **Evaluator.** Its continuation is a linked list of immutable frames on
  the heap (LANGUAGE.md, "How it runs"). To keep the rest:
  1. Take the frames from the perform up to the handler's frame, and the
     choice points above the handler's base, as one value.
  2. A call to the rest copies that segment onto the caller's continuation,
     with the handler frame again at its bottom (deep).
  3. A flag on the value makes a second call an error.

  The cost is linear in the depth between the perform and the handler, and
  only for `later` operations.
- **Compiled JavaScript (C40, step 1 built).** A definition whose row holds a `later`
  effect gets a generator copy (COMPILER.md already has generators for
  searches). Performing is `yield`. The handler drives the generator, and
  the rest is a wrapper that calls `next(answer)` once. JavaScript
  generators can't be resumed twice from one point, which is exactly "at
  most once". The world's handler for `await` is the browser's or Node's
  event loop: the rest is a callback.
- **WebAssembly and C.** Continuation-passing copies of the same
  definitions, or WebAssembly's stack-switching proposal and a stack per
  fiber in C. Each is that target's own hosting choice, and none changes
  the language. Until then, those targets refuse a program that performs a
  `later` operation, with that reason.
- **Running backwards (relate.ts).** Not taken on in step 1. A `later`
  operation has nothing to run backwards, so it is to be refused under a
  relation, the way a world action is.

## What it unlocks

In the order the BACKLOG wants them:

1. **Page handlers resume (L59).** The page runtime becomes a handler: on
   `fetch` it keeps the rest and resumes it when the reply lands, once.
   This removes several current workarounds:
   - the re-run of a handler and its double writes (§1.1); L52's
     take-back stops being needed;
   - the fetch-once memo, which shrinks to one search (§1.2);
   - the separate `Wait` effect: `wait` parks the rest and a timer resumes
     it, so `Wait` folds back into `Time` (§1.3).
2. **Generators and streams in the language.** `yield` as above. A lazy
   list producer is a program, not a runtime feature.
3. **Stateful handlers (L16).** `get` and `put` answered later, with the
   match returning a function of the state, give `State` as a program. The
   runtime stops owning cells' handler state (EFFECTS-REVIEW §2.4).
4. **`together`, `race`, `within` (L71).** With L56 (effects that take a
   type), std's waiting operations become `start(request) : Ticket a` plus
   `await(ticket) returns a, later`, and `together` is a prelude handler
   over `await`:
   - it runs each branch until it awaits, and parks its rest with its
     ticket;
   - when all are parked, it does `await(any of(tickets))` outward;
   - it resumes the branch whose ticket came back.

   Nesting is free, because an inner `together` with nothing ready is just
   a waiting branch to the outer one. `race` drops the losers' rests,
   which is a cut. `within(ms, a)` is a `race` with a wait that fails, so
   a timeout is no answer (`Choice`), not an error. The full design is
   LANGUAGE-NEEDS-2026-10-24 Part 1.
5. **Tests with a fake clock and network (L55).** A test answers `await`
   from a virtual clock, in the language.

## Steps

1. **L54a, the shape, in the evaluator. Done.**
   - The `later` flag on a variant.
   - The rest binder in an arm, the checker's types above, and the
     one-shot error.
   - `yield` and a round-robin scheduler of two fibers as tests, written
     in the language.
   - Compiled targets refuse a `later` operation with a clear reason.
   - The text shows the rest as `yield(item) with rest`, the way a fold's
     folded values read, and the declaration as `returns Unit, later`. In
     the editor (E80, done), an operation's panel has **Answered later**
     beside Gives back: ticked, every case handling it gets a name for the
     rest, after its inputs, and the graph draws the case as
     `(item) with rest =>`.
2. **C40**, compiled JavaScript by generators. Then pages can use it.
   Step 1 is built (compile.ts `isLater`, runtime.js `$handleL`): the
   programs in `test/later.test.ts` give the same prints compiled. A
   function that waits, given where any row goes (`map`), gets a copy of
   that definition that waits too (step 2a). A handler around code that
   waits on another handler's operation passes it outward (step 2c). A
   search written in place may wait too (step 2b), and so may a waiting
   handler with a case answered at once (step 2d). Not yet: a definition
   with both Choice and a waiting row, which says so when compiled.
3. **L56**, effects that take a type, for `Ticket a`. **Built.**
4. **L59** and **L60**, the page and audio runtimes as handlers. **L71**,
   `together`, `race` and `within`.
5. **WebAssembly and C**, when a program there needs it.

## Typing `await` and `together` (2026-11-01, L71's first step)

Written before building L71, because the sketch above leaves two type
questions open, and the obvious answers would dent the language.

**1. `await` is one operation for every type.** `await(ticket: Ticket a)
returns a, later` needs its `a` chosen at each call: a fetch's ticket
gives a Text, a timer's a Unit, in the same `together`. Today an effect's
type parameter (L56, `Yield a`) belongs to the effect, and a row unifies
it across every use in its scope, so `Await a` would force one type per
scope. That is the wrong shape, not a limit to live with.

The answer is **an operation's own type variables**: a variable in an
operation's fields that isn't one of its effect's parameters is the
operation's, fresh at each call, and isn't in the row (the row says
`Await`, with no argument). It is OCaml 5's choice (an effect is a GADT
constructor, `Await : 'a ticket -> 'a Effect.t`) and Koka's polymorphic
operations. A case handling it must work for every `a`: inside the arm,
`a` is rigid (signatures.ts already makes rigid variables), so the case
can pass the ticket on or keep the rest, and can't pretend the answer is
a Text. No new node kind: an operation's fields simply name a binder the
operation itself introduces (`params` on its variant, as a typedef has).

**2. `together` parks rests of different types.** A parked branch is a
ticket of some `a` and a rest taking an `a`. A list of them would need
existential types. It doesn't: what `together` keeps for a branch is a
thunk, `() → rest(await(ticket))`, made inside the arm where `a` is known,
so every parked branch has the same type, `() -[Await]-> r`. Beside it,
`together` keeps the ticket with its type forgotten (`ticket id(t) :
Ticket Unit`, std), which is all `await(any of(ids))` needs to say which
branch is ready. Resuming that branch is running its thunk: its `await`
goes outward and is answered at once, its result already there.

```
together(actions) =
  run each branch under
  | await(ticket) with rest → park(ticket id(ticket), () → rest(await(ticket)))
  when every branch is parked or done:
    i = await(any of(parked ids))        -- outward: the world, or an outer together
    run parked branch i's thunk, the rest as before
```

**The steps this gives** (BACKLOG):

- **L71a** (done, 2026-11-01), an operation's own type variables, in the
  checker (fresh per call, rigid in its case, absent from the row), the
  evaluator untouched (it is untyped): a variant's `params`. Tested on a
  program's own `pick(first: a, others: List a) → a` (test/own-type-vars.test.ts).
- **L71b** (done, 2026-11-01), std's `Await` (`await`, later), `Ticket a`, `ticket id` and
  `any of`, and `together` in the prelude as above, tested with a handler
  that answers `await` from a list of ready tickets (a fake world, in the
  language, L55's way). Built with `Ticket a = ticket(number) | timer(milliseconds,
  value) | first ready(tickets, which)`: `which : (Int) → a` gives `any of`
  its Ticket Int without a type that depends on the case, and lets a
  world in the language answer `first ready` at all (a case can't make an
  `a` from nothing). Its limit: `Branch`'s `resume` is a field, and a
  field's function row is closed, so a branch may only `Await` for now
  (test/await.test.ts).
- **L71c** (done, 2026-11-01), the world answers `await`: `start timer(ms)`
  (an `Await` operation, answered by the world) gives a ticket ready ms after
  it was started; the evaluator's runtime waits on the world's clock for a
  timer, a world ticket, or the first ready of `any of(…)`. `race` is
  `together` that stops at the first done branch, and the others are simply
  dropped where they wait: a parked branch is a value, so cancelling it is
  forgetting it. `within(ms, action)` races the action against a timer.
  The page's runtime is L59; compiled JS is C40.

## Prior art

- Algebraic effect handlers: Plotkin and Pretnar (2009); Eff (Bauer and
  Pretnar).
- Koka's three operation shapes (`fun`, `final ctl`, `ctl`) and their fast
  paths: Leijen (2017); Xie and Leijen, "Generalized evidence passing for
  effect handlers" (2021).
- One-shot continuations checked at run time: OCaml 5 (Sivaramakrishnan
  et al., 2021).
- Direct style with no colouring: Effekt (Brachthäuser, Schuster and
  Ostermann), Koka, OCaml 5's Eio.
- Generators as one-shot continuations in JavaScript: the compilation
  scheme of Effekt's and Koka's JavaScript back-ends.
- Structured concurrency for `together`: Trio's nurseries (Smith, 2018),
  as in LANGUAGE-NEEDS-2026-10-24.
- An operation's own type variables: OCaml 5's effects as GADT
  constructors, and Koka's polymorphic operations.
