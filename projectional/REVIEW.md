# Review: where the language stands, and what it would take to be serious

Written 2026-10-22, after PR #30. Everything here was checked against the
code: the docs were read, the tests and examples were run, and the holes
below were found by trying to break things. The ones that can be shown in a
few lines are in `test/known-holes.test.ts` as `todo` tests: they run, they
fail today, and they don't fail the suite. Fix one, drop its `todo`.

## The verdict, first

This is a strong research prototype with a real thesis and a few genuinely
new combinations: ids instead of names, effects instead of monads, `Choice`
as the one mechanism for search, absence and relation branches, any
function run backwards, derivatives read off real functions, and meaning
separated from representation. The docs are unusually honest, and the
evaluator and compiler test each other.

It is not yet a language anyone can write a program in. Three facts say
that most plainly:

1. **Nobody has written a program in it.** Every example was typed in
   TypeScript (`src/lang/programs.ts`, `numbers.ts`) through the builder,
   then saved as JSON. The editor can change the shipped examples but
   can't make a new definition, a new type, a new program, or add a
   parameter. The real source language today is the TypeScript DSL.
2. **The safety claims are ahead of the checker.** Two ways to write a
   loop that the checker calls total, and three ways for well-typed code
   to crash with a JS exception (§1).
3. **It falls over at small sizes.** The evaluator can't sum a list of 342
   numbers by recursion, or 1,641 by fold, before the JS stack overflows;
   compiled code handles 1,000 and dies before 10,000. The palette takes 0.4 s per hole on a
   1,000-node program, and "the printer is a parser" takes 4 minutes to
   read 400 numbers (§2).

None of these is a reason to change direction. They are the next layer of
work, and they come before new features. The roadmap at the end puts them
first.

---

## 1. Soundness: what the checker promises and doesn't keep

### 1.1 Totality has holes

The error table says non-termination is *inferred*: structural recursion is
total, everything else carries `Diverge`. Two programs break that, and a
third shows the check is also too strict in a way the editor makes common.

- **Landin's knot.** A data type with a field of type `(knot) → Number`
  lets `apply(x) = match x | wrap(f) → f(x)` call itself through the data,
  with no recursion in the definition graph. `apply(wrap(apply))` is typed
  `() -> Number`, pure and total, and runs until the stack overflows.
  Coq and Agda reject such types with a *strict positivity* check: the type
  being defined may not appear to the left of an arrow in its own fields.
  NUMBERS.md's lazy continued fractions need `() → CF` fields, which are
  positive, so the check doesn't get in their way.
- **Every call shrinks something, and it never ends.** `structural` in
  `infer.ts` accepts a recursive call when *some* argument is a piece of
  the same parameter. `ping(a, b)` shrinks `a` in one call and `b` in the
  other while growing the other one, so `ping([0], [0])` runs forever, with
  a total type. Coq requires one decreasing argument for the whole group;
  the general answer is size-change termination (Lee, Jones, Ben-Amram
  2001), which also gives lexicographic orders for free.
- **A dot costs the proof.** `length(xs) = match xs | cons(h, t) → rest = t;
  1 + length(rest)` is given `Diverge`, because the guard check doesn't
  follow lets. The editor's main gesture for naming a value is the dot,
  which *is* a let, so a purely presentational gesture changes a type.
- **Nested data loses totality.** A rose tree (`node(children: List Tree)`)
  can't be folded: `isRecursiveField` only counts a field whose type is
  exactly the type itself. Recursing through `map` over the children is a
  call inside a lambda on a lambda parameter, so it gets `Diverge`. Every
  tree people actually use (an HTML document, JSON, a syntax tree with
  argument lists) is this shape.
- **Representations lose it too** (NUMBERS.md says so): after `represent`,
  `is even` gets `Diverge` because its recursion goes through `match Nat′`.
  The meaning was total, and laws make the rewrite correct, so effects
  should be carried over from the meaning, not re-inferred.

Recommendation: strict positivity now (small), size-change termination for
groups (medium, replaces `structural`), lets transparent to the guard
(small), and folds over nested types as "fold over the type with the
container mapped" (medium; it's what Coq's nested inductive types do).

### 1.2 Well-typed programs can still crash

The table in LANGUAGE.md lists runtime errors as only the IEEE domain
errors. In fact a program that type-checks can throw:

| what | today | should be |
|---|---|---|
| `derivative(sqrt)` (a builtin passed as a value) | throws "needs a function written in the program" | works: the `FN` table has the derivative of every prim |
| `solve g(out = 6) for x` where `g` uses `first` inside | throws `NotInvertible` | a checked error, found before running |
| running `apply(f, x)` backwards for `f` | throws `NotInvertible` | a checked error ("functions can't be guessed") |
| a solve or a lambda the relational interpreter can't handle | throws `NotInvertible` | checked |
| reaching a hole | throws | fine as it is: a hole is a declared gap, and the editor knows where it is |
| a list of a few hundred items | stack overflow | can't happen (§2.1) |

The fix is the one COMPILER.md already plans for speed: a **mode analysis**
per (definition, known ports). It should be the checker's job, not only the
compiler's. Then "runs backwards" is a static fact: either a direction is
accepted (with `Choice`, maybe `Diverge`), or it is an error at the solve
node, with the reason that today only appears at run time.

### 1.3 Equality has two meanings, and functions have none

- `equal` is typed `(a, a) → Bool` for every `a`, including functions, and
  compares functions by JS identity: two copies of `x ↦ x·x` are unequal.
  For a language whose point is that functions aren't black boxes, that's
  the wrong answer and should be a type error.
- Numbers are equal exactly in the evaluator and within `1e-9` relative in
  the relational interpreter's unification (`close` in `relate.ts`). So
  `x = 0.1 + 0.2` is not `0.3` forward, but unifies with it backwards. The
  same program gives different answers depending on direction.
- `show` rounds to 9 significant decimals, so `show(0.1 + 0.2)` is `"0.3"`.
  That makes `show` not injective, which breaks the "read back only the
  spelling `show` produces" rule for running it backwards on floats.

Recommendation: one inferred property, **plain data** (no functions
inside), required by `equal`, `show`, hashing, saving and sending (§5.2).
For floats, exact equality everywhere, and tolerance only where it is asked
for (a `near` relation). `show` prints the shortest round-tripping decimal,
as JS's own `String(x)` does.

---

## 2. Scale: it works at the size of the examples

### 2.1 The stack

| | largest list summed | after the real-data work |
|---|---:|---:|
| evaluator, plain recursion | 341 | memory-bound (1,000,000 in 5 s) |
| evaluator, `fold` | 1,640 | memory-bound (1,000,000 in 1.4 s) |
| compiled, `fold` | between 1,000 and 10,000 | memory-bound (a loop) |
| compiled, plain recursion | between 1,000 and 10,000 | unchanged (COMPILER.md, "Folds are loops") |

The evaluator is a generator per node, and each level of recursion is
several JS frames. The compiled code is ordinary JS recursion. Neither is
acceptable for "regular programs", where a list of a million lines is
normal.

Recommendation, opinionated: **a fold over a type with at most one
recursive field per case (lists, Nat, binary, any chain) compiles to two
loops**: walk down collecting the spine into an array, then run the cases
back up. No stack, and no change to the meaning. Trees use an explicit
stack. The evaluator gets the same treatment, or becomes a small-step
machine with a heap-allocated continuation, which also gives stepping and
"pause at this node" for the editor for free.

### 2.2 Speed of the things that make it special

- **The printer-as-parser is a demo, not a parser.** `show numbers`
  backwards reads 50 numbers in 0.27 s, 100 in 2.5 s, 200 in 25 s and 400
  in 228 s, roughly cubic. `join text` with neither side known enumerates
  every cut, and the state is copied on every binding.
- **The palette re-checks the whole program per candidate.** On `algebra`
  (963 nodes with the std library), `infer` takes about 4 ms, but the
  palette for one hole takes 421 ms, because every "risky" candidate is
  confirmed by inferring the whole program again. At 50,000 nodes that is
  tens of seconds per click.
- **Every edit re-infers everything**, and `parentOf` scans every node.
  Fine at 1,000 nodes, quadratic at 100,000.

Recommendation: incremental checking per definition, made possible by
signatures (§4.6): a definition is re-checked when it changes, and its
callers only when its signature changes. That is exactly what Unison's
content hashing gives: a definition's checked type is cached by its hash.

### 2.3 Ids are 32 bits, and merges overwrite silently

`freshId` makes 8 hex characters. A program averages about six nodes per
displayed line (queens: 252 nodes), so a 10,000-line program has around
60,000 nodes, and the chance that two of them share an id is about 35%.
`merge` is `Object.assign`, so a collision silently replaces one node with
the other. Libraries from different authors would collide for certain.

Recommendation: 128-bit ids (or 96), a collision check in `merge`, and,
more importantly, the hash as the identity of published code (§4.5).

---

## 3. Still two worlds, and more copies than that

The tutorial's first critique was "two worlds of functions". It's worse
than that when counted in code:

| job | implementations |
|---|---|
| run a program | `src/eval.ts` (plain expression defs), `src/lang/run.ts` (typed), `src/lang/relate.ts` (any direction), compiled JS, and the solver's own evaluator for networks |
| check a program | `src/check.ts` + `src/units.ts` (networks and plain defs), `src/lang/infer.ts` (typed) |
| edit a program | `src/edits.ts`, and `editor/typed.ts` + `src/lang/refactor.ts` |
| a function with no direction | `network` + `part` nodes, and a lambda used by a `solve` node |
| units | only in networks; typed `Number` has none |
| "which ports are known" | `layout.json` for networks, `code.json` for solve nodes |
| `+` | `add`, `subtract`, `negate` builtins in tree code; one `sum` atom in networks |

*Numbers & networks* is still an untyped program (`typed: false` in the
editor). The tutorial's proposal is "every definition is a network, and a
function is a network plus a direction". The relational interpreter made a
simpler unification possible, which I'd take instead:

**A network is a predicate, and a wire is an equality.** `fall` is the
function `fall(speed, gravity, time, distance) = distance = speed·time +
½·gravity·time²`, returning `Bool`. Solving it for `time` is running it
backwards with `out = true`, which `relate.ts` already does (`equal(a, b) =
true` backwards is unification, and the arithmetic goes to the solver). So:

- `network` and `part` leave the model: two fewer node kinds, and
  `check.ts`, `src/eval.ts` and the network half of `relational.ts` go with
  them.
- The picture doesn't change. The graph view draws `equal(a, b)` under an
  `and` as one wire joining `a` and `b`, which is what a network wire is.
  The `sum` atom becomes the drawing of `a + b = total`.
- "Known ports" live in one place: the solve node (code) when used in a
  program, and the try-it panel (a view, not code) when exploring.
- Units become a parameter of `Number`, inferred by the same exponent
  solver, so they exist everywhere, not only in networks.

This is the single biggest simplification available, and it removes the
"two worlds" item, the units item and half the "small inconsistencies" item
from the tutorial's list in one move.

---

## 4. Design tensions, and how I'd resolve them

### 4.1 `Choice` and side effects

`count(() => x = one of([1, 2, 3]); print("trying " ++ show(x)); fail())`
prints three lines and returns 0. Printing in a branch that is later
abandoned still happened, and `first` over a search prints for every guess
it rejects. Today that's harmless; with files, network requests or
payments it's a bug factory, and the compiler will make it worse by
re-running continuations.

Recommendation: split the world effects from tracing. **`Log` (debug
output) may appear anywhere and isn't part of the meaning. World effects
(console, files, network, storage) may not run under an unhandled
`Choice`**: the checker requires the `Choice` to be handled before a world
effect, the way it already requires handlers before `main`. Verse's
transactional failure contexts are the alternative, but they need undo for
every effect, which the outside world doesn't offer.

### 4.2 `Choice` is not data

"No null, no Option, absence is `Choice`" works for control flow. It
doesn't work for data: a record with an optional field, a lookup result
stored for later, a JSON value with a missing key. Those need a value, and
today the only one is `List` (via `all`).

Recommendation: std gets `Optional a = none | some(a)` and a handler
`optional(action)`, the at-most-one sibling of `all`. `Choice` stays the
way to *compute* absence, `Optional` the way to *store* it, and the
handler is the bridge. No null comes back.

### 4.3 Failure without a reason

`fail()` says nothing about why. A parser that fails, a lookup that
misses, a validation that rejects: "undefined" is all the user sees.
Errors with reasons are a different effect from search: they abort, they
don't backtrack.

Recommendation: user-defined effects first (COMPILER.md's stage 3, but
moved up), and `Abort e` written in std with them, handled by a `catch`
that receives the `e`. `Choice` stays reason-free, because in a search the
"reason" for no answer is every branch's reason at once.

### 4.4 Relations, effects, representations and fuel together

Each feature is consistent alone. Together:

- **Relations and effects.** A function with `Choice` inside runs
  backwards; one with a handler inside throws at run time (§1.2); one that
  prints is a checked error. The rule should be one sentence, checked
  statically: "a direction is accepted when every node on its path has a
  backwards rule for what's known there".
- **Representations and effects.** The rewrite can add `Diverge` to a
  program's type (§1.1). A shader target would then refuse a program that
  was fine before the compiler chose binary. Effects belong to the meaning.
- **Representations and relations.** Encoding is `meaning` run backwards,
  which is a search. Fine for a demo; a real representation must provide
  `encode`, which NUMBERS.md already allows. Make it required for builtin
  representations.
- **Fuel means three things.** In the evaluator it counts calls into
  divergent definitions; in `relate.ts` it counts search steps; in compiled
  code it throws in plain code and fails in `Choice` code (the corner case
  COMPILER.md notes). `with fuel(100, …)` should mean one thing. Calls into
  divergent definitions is the most predictable, and the search can count
  unfoldings, which are its calls.

### 4.5 Identity: random ids, content hashes, and packages

The README says hashing gives "the module/package story for free". It gives
half of it. Identity is a random id, and the hash is computed on the side
and not used for anything but display. So two copies of a library get
different ids and are two libraries; updating a library has no meaning;
and std is referenced through hand-picked string ids (`std.list.cons`).

Recommendation, following Unison: **drafts have ids, published code is
named by its hash.** Publishing a definition freezes it and replaces its id
with its hash everywhere (the content hash already exists, including for
recursive groups). An update is a new hash plus a "replaces" entry, and the
editor offers to propagate it to dependents, re-checking each. Namespaces
are a names layer (paths), as the README says, plus one thing it doesn't:
**visibility**, so a library can keep helpers out of the palette.

Also: the hash of a mutually recursive group depends on which member is
hashed first (`["rec", index in stack]`), so the same group can hash two
ways. Hash the group as a unit, in a canonical order.

### 4.6 Types are never written, so nothing is stable

Inference with no annotations is pleasant inside a definition, and a
problem at its boundary. Filling a hole can change a definition's type and
break a caller far away (LANGUAGE.md explains the case the test found); the
palette defends against that by re-checking the whole program, which is
the cost in §2.2.

Recommendation: **a signature is a pin.** Pinning a definition's type
(a side table keyed by id, like names) makes it an interface: edits inside
must keep it, callers are checked against it, and incremental checking
stops at it. The editor pins automatically when a definition is published
or used from another program, and shows the pin as the frame title it
already draws. Nothing is typed by hand.

### 4.7 The DSL is the real source, and examples get regenerated

`npm run build-lang-examples` rebuilds examples from TypeScript with new
random ids. Anything attached by id that isn't in the generator (layout,
comments added in the editor) is lost on regeneration. For a language whose
thesis is "the tree is the source of truth", that's backwards.

Recommendation: freeze the examples as JSON now and retire the generators
for them. New examples are written in the editor, which forces the editor
work in §6.

---

## 5. What a serious language needs that isn't here yet

### 5.1 The basics, honestly listed

| area | today | needed |
|---|---|---|
| integers | floats only; `range(2.5)` is allowed | `Int` and `Nat` that never overflow, represented by JS numbers or BigInt (NUMBERS.md stage 1), plus `Float32` as a representation for GPUs |
| text | `join text` and `show` (numbers only) | length, slicing, characters, comparison, search, formatting, Unicode. Opinion: text's *meaning* is `List Char`, represented by JS strings or ropes, so everything that works on lists (folds, running backwards) works on text, and stays fast |
| records | one-variant types with projections; no update | an update for every field, generated like constructors. It's the projection run backwards with the other fields given, so it's a relation, not a new feature (§5.3) |
| collections | `List` | `Map` and `Set`, with meaning "sorted list of pairs" and representations hash map or HAMT; arrays (NUMBERS.md stage 3) |
| modules | none | §4.5: hashes for identity, paths and visibility as names layers |
| IO | `print` | files, arguments, environment, time, randomness, network, storage, each an effect |
| FFI | an extern (`body: null`) is a check error | an extern with a pinned signature and implementations per target in a side table (`js`, `glsl`, `wgsl`), the same way names are per person |
| errors | `fail()`; JS exceptions with a message | `Abort e` (§4.3); runtime failures point at the node and the chain of calls, which the evaluator knows and doesn't report |
| concurrency | none | async IO as a one-shot effect handled by the runtime's event loop; no threads or shared memory |
| testing | in TypeScript | examples and laws as side tables on definitions, run live in the editor (§6) |
| persistence | the browser's local storage | programs saved as files (the side tables already are), opened from and saved to disk or a repo |
| debugging | none | values on wires (§6) |

### 5.2 One property system for effects and targets

There's a pattern across the gaps above: "may this function diverge",
"does this value contain a function", "can this run on a GPU", "can this be
sent over the network" are all properties inferred from the code and
propagated to callers, exactly as effects are. Today only effects have
machinery.

Recommendation: treat **targets as profiles**: a set of allowed effects
plus a set of required type properties, checked by the same inference.

| profile | allowed effects | type properties |
|---|---|---|
| pure total library | none | any |
| CLI program | world effects, `Diverge`, `Log` | any |
| shader | none (`Diverge` only under constant fuel) | plain data, no recursive types, fixed-size vectors, `Float32` |
| UI view | `Log` | output is plain data |
| sent or saved | n/a | plain data |

The editor shows which profiles a definition fits, as it shows its badges.
"This function can run on the GPU" becomes a fact you can see before
compiling, the way "this function prints" is now.

### 5.3 Relations as the answer to records, lenses and two-way binding

This is the opinionated part, and the reason I think the relation work is
the language's real differentiator rather than a curiosity:

- A field projection `name(person)` run backwards with the rest of the
  person given *is* the setter. So records get updates without a new
  construct, and a nested update (`person.address.city`) is a chain of
  projections run backwards: a lens, derived, not written.
- A UI that shows `model.user.name` in a text field and writes the edit
  back is that same projection, forward for display and backwards for
  input. Two-way binding falls out of relations, where other frameworks
  hand-write it.
- A form validated by a predicate, a unit converter, a layout constraint
  ("these two boxes have equal width") are predicates solved for whichever
  value the user just changed. That is the network idea applied to UIs.

---

## 6. The editor

What it does well: one canvas, typed holes with a palette of only what
fits, refusals that say why, a visible Files panel proving names and layout
never touch the meaning, and a shared vocabulary (node, wire, dot, frame,
hole, badge, relation) that's documented in the guide.

What it can't do, in order of how much it blocks:

1. **Create anything at the top level**: no new definition, data type,
   program or parameter; no deleting a definition, reordering parameters,
   or changing a case's fields after the fact.
2. **Enter code quickly.** Every node is a palette pick. A structured input
   method (type `a + b·c` into a hole, get the tree, not text) is what
   makes structure editors usable; Hazel and Lamdu both found this.
3. **Save and open.** Programs live in local storage; Reset wipes them.
4. **Copy and paste** a subtree, with dots and binders remapped.
5. **Find**: with thousands of definitions, the palette needs namespaces,
   recency and type-directed ranking.
6. **Show values.** The network view already shows values on ports. The
   typed graph should too: pick example inputs for a definition and see the
   value on every wire, live as you edit. For a dataflow picture this is
   the highest-leverage feature there is, and it's where examples and
   tests can live (§5.1).
7. **Scale visually.** The queens graph already has crossing wires at
   about fifteen nodes. Large definitions need folding (a call shown closed
   or opened inline, which exists for plain defs), and an automatic layout
   that minimizes crossings.

The tutorial's critique list is still open apart from #2 (partly: there's
one arithmetic table, but tree code still has `add`/`subtract`/`negate`
where networks have `sum`) and #3 (done, relations cover the language).
Items 4 to 6 (zero-parameter frames as plain contents, every output a dot,
an execution wire for order) are all good and cheap, and I'd do them.

---

## 7. The targets

### 7.1 Regular programs (CLIs, scripts, servers)

**Needs:** §2.1 (no stack limits), §5.1 in full (Int, text, records, Map,
IO, FFI, errors with reasons), a `main : (arguments) → exit code` entry with
world effects, the compiler emitting a Node or Deno module, and packaging
(one file per program). Async IO as a one-shot effect.

**Achievable soon.** The compiler already emits plain JS for pure code and
loops for `Choice`. Most of this is library and runtime work, not new
language. Queens compiled is about 600× faster than evaluated, so speed
isn't the problem; stack depth and missing basics are.

### 7.2 Shaders

The best fit of the four, and I'd make it the first real target. Shaders
want exactly what this language already enforces: pure, total functions,
no null, no recursion, and data-flow graphs (which is what every shader
editor in Blender, Unity and Unreal draws already).

**Needs:**
- Fixed-size vectors and matrices (`vec3`, `mat4`) as Clifford or tensor
  types with static shapes (NUMBERS.md stages 4 and 6, cut down), and
  `Float32` as an approximate representation of `Number`.
- The shader profile (§5.2): no recursive data, no `Choice` except over a
  constant-size list (a loop with `break`), no world effects, `Diverge` only
  under constant fuel (a bounded loop).
- Specialization until no closures are left (inline higher-order calls),
  which the compiler's effect specialization is a first step towards.
- A WGSL or GLSL ES backend: a third code generator next to JS, much
  simpler, since the profile has already removed everything hard.
- Uniforms and inputs as the entry function's parameters; a live preview
  canvas in the editor.

**The showcase writes itself:** a signed-distance-field ray marcher.
Sphere tracing is `with fuel(64, march)`, a bounded loop. Surface normals
are `derivative(sdf)`, read off the graph by `derive.ts` instead of
approximated by finite differences. Intersections with simple shapes can be
`solve` nodes. Every special idea in the language does real work in one
small program.

### 7.3 Websites

**Static sites:** a pure function from data to an HTML tree. HTML is a
data type (a rose tree, so §1.1's nested folds are needed), and rendering
it to text is a fold. Needs text and records. Achievable soon.

**Interactive apps:** the Elm architecture fits the language without
adding mutable state: `init`, `update(model, event) → model`, `view(model)
→ html`, with effects as values the runtime performs (fetch, storage,
timers). Needs: user-defined effects or a fixed effect set for the
runtime, a virtual-DOM diff (a representation of the `html` meaning, in
NUMBERS.md's sense), events as data, and §5.3 for forms. Achievable in
months, not years.

**Servers:** `request → response` with world effects, through the CLI
target. Same needs as 7.1.

### 7.4 Mobile apps

Native compilation is a dream for now, and shouldn't be the plan. The
realistic path is the web target packaged as a PWA or with Capacitor, with
device features (camera, location, notifications) through the FFI side
table. That makes mobile "web, plus FFI, plus packaging", and nothing
mobile-specific in the language. A React Native target is possible later,
because the compiler emits JS.

The more interesting mobile question is the editor on a phone. A structure
editor is a better fit for touch than text (no keyboard precision, picks
from a palette), but a free node canvas isn't. A touch editor would lean on
the blocks view and the palette. Worth trying once the editor can create
programs.

---

## 8. Achievable soon, and dreams for now

| achievable in weeks | achievable in months | dreams for now |
|---|---|---|
| strict positivity; lets in the guard check; size-change termination | incremental checking with pinned signatures | invertible parsing of arbitrary printers at real speed |
| folds as loops (no stack) | mode analysis in the checker: no runtime `NotInvertible` | proved (not tested) representation laws by fusion |
| `derivative` of builtins; `equal`/`show` only on plain data; shortest round-trip `show` | network = predicate; `network`/`part` and `eval.ts`/`check.ts` removed | costs worked out from folds, representation chosen per value flow |
| 128-bit ids, collision-checked `merge` | user-defined effects, `Abort`, `Optional`; world effects not under `Choice` | exact reals with Gosper arithmetic as a practical numeric type |
| editor: new def/type/param, save/open files, copy/paste | units on `Number` everywhere | native mobile compilation |
| Int/Nat/Text basics, record updates | WGSL backend and an SDF shader demo | relational UI layout (constraints solved live, Cassowary-style) at app scale |
| values on wires for example inputs | Elm-architecture web runtime with two-way binding by relations | a package ecosystem by hash, with propagated updates |
| tests and examples as side tables | publish by hash, namespaces, visibility | |

---

## 9. Process

- **CI doesn't run on pull requests.** The only workflow is Pages, on
  pushes to `main`, and it runs `projectional` tests only. `invertible` and
  `compiler` tests never run in CI, and all 30 PRs were merged without a
  check on the pull request. Add a test workflow on pull requests for all three folders.
- **Thirty PRs in two days** have produced docs that are good individually
  and overlapping together (LANGUAGE, TUTORIAL, BACKWARDS, NUMBERS,
  COMPILER, README each restate the model and the error table, with small
  differences). Make LANGUAGE.md the reference, have the others link to it,
  and keep the tutorial's critique list as the one list of open problems
  (this review's items can be folded into it).
- **The error table should be generated from tests.** Each row claims a
  status ("impossible", "prevented", "inferred"); each claim should point
  at the test that shows it. §1 found two rows that were wrong.

---

## 10. Roadmap, in priority order

Each step says why it comes where it does.

1. **Make the claims true** (weeks). Strict positivity, size-change
   termination, lets in the guard; `derivative` of builtins; `equal` and
   `show` on plain data only; shortest round-trip `show`; one meaning of
   float equality; 128-bit ids. Turn the todo tests green. *Why first:* the
   language's pitch is "errors you can't make", so a hole in it costs more
   than a missing feature.
2. **Make it hold real data** (weeks). Folds as loops in the compiler and
   the evaluator; Int, Nat, Text, record updates, `Optional`, `Map`. CI on
   pull requests. *Why:* nothing else matters if a 400-item list crashes.
3. **Write a program in the editor** (weeks to a month). New definition,
   type and parameter; save and open files; copy and paste; values on
   wires; examples as side tables. Freeze the examples as JSON. Then write
   the next example program only in the editor, and fix what hurts.
   *Why:* the thesis is projectional editing, and it hasn't been tested by
   writing anything.
4. **One world** (a month). Network = predicate; delete `network`, `part`,
   `src/eval.ts`, the untyped checker; units on `Number`; mode analysis in
   the checker so backwards directions are static. *Why now:* every feature
   added before this is added twice.
5. **Signatures, identity, modules** (a month). Pins, incremental checking,
   publish by hash, namespaces and visibility. *Why:* needed before any
   program is bigger than one screen of definitions, and before libraries.
6. **Effects for the world** (a month). User-defined effects with one-shot
   handlers, `Abort e`, IO effects, `Log`, the rule that world effects
   don't run under `Choice`, FFI through a side table, the CLI target.
   *Why:* this is "regular programs".
7. **Shaders** (a month). Vectors and matrices with static shapes,
   `Float32`, the shader profile, a WGSL backend, a live preview, the SDF
   ray marcher. *Why here:* it's the target where the language's ideas
   (purity, totality, derivatives, data-flow pictures) are strongest, and a
   working demo there is the clearest argument for the whole project.
8. **Web apps** (months). The Elm-architecture runtime, HTML as data with a
   diffing representation, two-way binding by relations, static site
   output. Mobile follows as packaging.
9. **The research items** as they become blocking: costs worked out from
   folds, laws proved by fusion, fast invertible parsing, exact reals.

---

## Files

```
REVIEW.md                    this review
test/known-holes.test.ts     the holes in §1 and §2.1 as todo tests: run, fail, don't fail the suite
```
