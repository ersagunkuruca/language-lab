# Backlog

Every open item from every source (Ersagun's asks, reviews, QA passes,
bigger-program rounds, design notes), in one place. Finished items are in
[DONE.md](docs/process/DONE.md). How items are picked and run is in
[WORKFLOW.md](docs/process/WORKFLOW.md); every doc is listed in [the docs index](docs/README.md).

Each lane's items are grouped by theme. Within a lane, priority (P1 first)
decides what's next, and "Next up" below names it in a line: what's next,
never what's done (that goes to DONE.md).

**Priority:** P0 broken now · P1 blocks the current step or Ersagun asked ·
P2 next steps · P3 nice to have. Within a priority: bugs, then removing a
special case, then what lets programs be written in the editor, then
language, then more targets or speed (WORKFLOW.md "Priority").
Rows once held back as later goals are open again (Ersagun 2026-11-09):
a lane takes them when bugs and goal rows are in hand.
Focus since 2026-11-10 14:49 (Ersagun): finish stable references, free lists and multithreading. Done: C61 and C43 closed, and C58, C60 (with C42, C57, C59 and C200) closed 2026-11-12 as waiting for an example (DONE.md); the mobile rows are closed too. As of 2026-11-13 the open rows are the Inbox's, P7, P8 and the gaps the docs refresh found (L246 to L256), C220; new rows come from the recurring reviews, QA passes and bigger programs.
Defaults first (Ersagun 2026-11-10 15:34): "I want the default compiled code to be as close to a C/C++ dev doing data oriented design and cache and memory aware as possible. And then if we need Pools and similar stuff to get a last 10 percent of performance that's OK, but the defaults should be our first target." So rows that change what every program gets (layout as columns, arrays written in place, records changed in place, work on every core) go before ones a program must ask for (a Pool type).
**Size:** S hours · M one PR · L several PRs or a design note first.
**Status:** ▶ running · ⏸ held · blank = waiting.

## Next up

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | no open row of its own; the next QA pass's findings |
| C Compiler and targets | "Compiler lane" | the next bigger program's gaps (C187 closed, waiting for browsers' WebAssembly stack switching) |
| L Language and library | "Language lane" | L246 (bug: `ters` help), L250 (check a totality loss); the Inbox's I219 (the Nightly green again) and I239 (tumble running an hour, its log under a fixed size) wait for a lane |
| L Language and library | "Language lane B" | L251, L253 (P3, from the 2026-11-13 docs refresh) |
| T Testing | "Make testing granular and cheap" | no open row (T16 done; TESTING.md §8 names the follow-ups to measure once the test map is full) |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I219 | What the full run fails on, on main (2026-11-12; draws fixed in I219a, board, effects and finite in I219b, lang.test's palette sweep, map-tree.test's timing and C42h's names in c-names.test in I219 part, palette in I219c, the editor's shaders ("process is not defined") in I219d, the smoke's first-steps check (it waited for main, but a first visit opens on fall since E235) in I219e, the rest of the smoke (Countdown's solutions read [] once relate's settles spent steps) in I219f, fixed.test's CORDIC and core-js.test's pig in I219 part 2, each file run alone; the nightly hasn't passed since 10-28): on CI resolve-once.test (a kept library resolving typed `List Case several` where it is `List a`), passing here; likely the same cause as CORDIC (a kept resolving read over another library check), fixed by part 2, for the next Nightly to confirm. | I208 | 2026-11-12 |
| I260 | The MCP text reader's smaller gaps from round 16: a `match` as a step with steps after it; the message for `0.0 m` where m is a parameter (say m is a name here); `first` on an Optional (the message reads backwards); `not in order(ps)` (suggest `not (in order(ps))`); a `replace` taking 1.5 s at 50 definitions | GAPS.md round 16 M1 | 2026-11-13 |
| I264 | `ters run` on trek (round 16) lowers for 4 s and runs for 70 ms. A second run of the same program reads it lowered (I264a): 1.4 s, of which 0.33 s is the load check's units and 0.15 s the source hash. Left: the first run's lowering, where choosing library representations takes 1.8 s (`choiceOf` 0.9 s, its rewrite's check 0.9 s) and the scalar pass 1.1 s | I261 | 2026-11-14 |
| L258b | Facts a guard can't show from where the division is: trek's 6 `first(…, else 0)` left after L258 are a haversine's `asin(√smaller(h, 1))` (h is a sum of squares times cosines, in 0 to 1), `sum(hs) / length(hs)` (never called empty), divisions by a leg's time or length inside `keep(ls, moving)` (moving says both are positive), and `(h − lo) / (hi − lo)`. Each needs a fact carried across definitions or through a filter (a refinement), not a test beside it | GAPS.md round 16 L1 | 2026-11-14 |
| I274 | The text views print a chain of `+` or `·` whichever way it nests (std.ts chainOperands, "a view"), so `a + (b + c)` and `(a + b) + c` read the same though Float64 adds them differently: an agent editing through the MCP text can't tell them apart, and text read back nests them left. trek's ideal had to match std's right-nested `sum` by hand | I273 | 2026-11-14 |
| C224 | A known record of functions given to a definition: copy the definition for it, so its field read and call become a direct call (closure-args.ts's law for a record of closures; GHC's dictionary specialisation). Today `half through(halving at float64, y)` builds the record, reads `half` and calls through it | [CLOSURES-INTERFACES-EFFECTS-2026-11-14](docs/reports/CLOSURES-INTERFACES-EFFECTS-2026-11-14.md) §2.4 | 2026-11-14 |
| C225 | Defunctionalisation (Reynolds 1972): where every lambda of a function type is known, a function value as a sum of its lambdas' captures and a call as a match, so a shader can run a function picked at run time and WebAssembly and C switch instead of calling indirectly. Waits for an example (a shader picking a distance function per object) | [CLOSURES-INTERFACES-EFFECTS-2026-11-14](docs/reports/CLOSURES-INTERFACES-EFFECTS-2026-11-14.md) §2.4 | 2026-11-14 |
| C226 | `steps of E(c)` matched at once: the generated handler and the match made one, so no `Steps` datum is built per operation (case of a known constructor across a handler). Waits for an example whose time is in its steps | [CLOSURES-INTERFACES-EFFECTS-2026-11-14](docs/reports/CLOSURES-INTERFACES-EFFECTS-2026-11-14.md) §3.4 | 2026-11-14 |
| L260 | LANGUAGE.md: one short section on records, sums, effects and interfaces as one typedef with four readings, and the bridges between them (`optional`, `attempt`, `steps`, a record passed by hand) | [CLOSURES-INTERFACES-EFFECTS-2026-11-14](docs/reports/CLOSURES-INTERFACES-EFFECTS-2026-11-14.md) §5 | 2026-11-14 |

## E: Editor

### Bugs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Writing programs in the editor

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Speed of editing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### What a good language needs ([ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Plain words for newcomers ([OUTSIDER-READ-2026-11-03](docs/reports/reviews/OUTSIDER-READ-2026-11-03.md))

Rewrite only what the outside reader marked; the next outsider read checks it.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## C: Compiler and targets

New targets and speed rank below every language item (Ersagun,
2026-10-24 07:01). Measurements and rounds: docs/reports/GAPS.md.

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Memory and layout (STABLE-REFERENCES.md §3 to §6)

All invisible to programs: no annotations or hints (Ersagun 2026-10-29).

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Parallel and concurrent code on the targets

| id | item | source | pri | size | status |
|---|---|---|---|---|---|


### Mobile (Ersagun 2026-11-09: a goal; native compilation per platform a stretch goal, instead of a webview. Down since 2026-11-10 14:49, behind stable references, free lists and multithreading: "Platform stuff will eventually be solved anyway")

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### The spec ([SPEC](docs/language/SPEC.md) §12)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### What a good language needs ([ASPECTS-2026-11-03b](docs/reports/reviews/ASPECTS-2026-11-03b.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Compiled output without names or unneeded machinery ([DEBUG-AND-SPEED-2026-11-04](docs/design/targets/DEBUG-AND-SPEED-2026-11-04.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Someday

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## L: Language and library

Numbers first (Ersagun, 2026-10-24 07:01), then the rest of
LANGUAGE-REVIEW-2026-10-24. Anything that only adds a target ranks below
all of these.

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Ersagun's current asks

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Numbers (NUMBERS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L247 | Costs worked out, not declared (NUMBERS.md stage 7): a representation's job costs read from its folds and the sizes of its values, checked against measurements (rep-costs.test.ts measures today's declared ones). L24 found the declared costs right on the examples, so this waits for a program where a declared cost is wrong | docs refresh 2026-11-13 (thread "Update all project docs"); NUMBERS.md, RESEARCH-L24-2026-11-12 | P3 | L | waits for an example |
| L248 | Ropes as one more representation of List (NUMBERS.md stage 3): `append` and `split` in log n, chosen by cost like `array of List`. Waits for a program that splits and joins long lists | docs refresh 2026-11-13 (thread "Update all project docs"); NUMBERS.md | P3 | M | waits for an example |
| L249b | Int's own definition as data (NUMBERS.md stage 1, the rest of L249): Lean's `from(Nat) \| ‹minus one minus›(Nat)`, one spelling per integer, so a `match` on an Int splits it by sign into std's Nat, stored as the Int itself; and Nat literals (`3` at Nat). Nat in std is done (L249). Waits for a program that matches on an Int's sign or writes a Nat literal | L249 (Language lane B, 2026-11-13); NUMBERS.md | P3 | S | waits for an example |
| L252e | Units in a pinned signature and in types of two parameters (the rest of L252): a pin keeps its definition's units, concrete (`Float64 m`) and related (`(Float64 u) -> Float64 u²`, a unit variable), so an edit that changes them is refused as one that changes the type is; and a Map's values (trek's `Map Int (Float64 m)`, shown `Map Int Float64` today) and a tuple's parts. Lists carry their unit since L252d. Waits for a program that pins a unit-generic function, or keeps unit numbers in a Map or tuple it reads back | L252d (Language lane B, 2026-11-14); GAPS.md round 16 U1 | P3 | M | waits for an example |
| L256 | A value packed with its implementation (INTERFACES.md step 6): a list of things of different types sharing an interface, paid for only where used; built as a record of closures that captured the value, no new kind of value (CLOSURES-INTERFACES-EFFECTS-2026-11-14 §2.3). Waits for a program that needs it | docs refresh 2026-11-13 (thread "Update all project docs"); INTERFACES.md | P3 | M | waits for an example |

### Data and representations (DATA-STRUCTURES.md, REPRESENTATIONS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Effects and concurrency (ANSWERED-LATER.md, EFFECTS-REVIEW-2026-10-24)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Grammars, modules and sharing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Physics and planning ([PHYSICS-AND-PLANNING.md](docs/design/physics/PHYSICS-AND-PLANNING.md))

Ersagun 2026-11-01: fast bodies passing through each other, and A* for an
agent with inertia: built as L119 to L124 (DONE.md).

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Someday

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### What a good language needs ([ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Plain words for newcomers ([OUTSIDER-READ-2026-11-03](docs/reports/reviews/OUTSIDER-READ-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### The spec ([SPEC](docs/language/SPEC.md) §12)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## T: Testing and fast feedback

The thread that owns `.github/workflows` and the browser checks. Plan:
docs/process/TESTING.md. T7 is in lane L.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805 on 11-03; 3,421 on 11-13), tests reached by a one-line text.ts edit (145/150 + 44/44 on 11-03; 139/219 + 91/125 on 11-13) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P3 | postponed (Ersagun 2026-11-10: until people want to use Ters) |
