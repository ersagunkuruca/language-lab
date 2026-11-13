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
Focus since 2026-11-10 14:49 (Ersagun): finish stable references, free lists and multithreading. Done: C61 and C43 closed, and C58, C60 (with C42, C57, C59 and C200) closed 2026-11-12 as waiting for an example (DONE.md); the mobile rows are closed too. As of 2026-11-13 the open rows are the Inbox's, P7, P8 and the gaps the docs refresh found (L246 to L256, C219), C220; new rows come from the recurring reviews, QA passes and bigger programs.
Defaults first (Ersagun 2026-11-10 15:34): "I want the default compiled code to be as close to a C/C++ dev doing data oriented design and cache and memory aware as possible. And then if we need Pools and similar stuff to get a last 10 percent of performance that's OK, but the defaults should be our first target." So rows that change what every program gets (layout as columns, arrays written in place, records changed in place, work on every core) go before ones a program must ask for (a Pool type).
**Size:** S hours · M one PR · L several PRs or a design note first.
**Status:** ▶ running · ⏸ held · blank = waiting.

## Next up

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | no open row of its own; the next QA pass's findings |
| C Compiler and targets | "Compiler lane" | C219 (qasm), C220 (machine natively slower than in WASI); the next bigger program's gaps (C187 closed, waiting for browsers' WebAssembly stack switching) |
| L Language and library | "Language lane" | L246 (bug: `ters` help), L250 (check a totality loss); the Inbox's I219 (the Nightly green again) and I239 (tumble running an hour, its log under a fixed size) wait for a lane |
| L Language and library | "Language lane B" | L251, L253 (P3, from the 2026-11-13 docs refresh) |
| T Testing | "Replace the slow browser smoke test" | no open row (T15 and I64 closed) |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I219 | What the full run fails on, on main (2026-11-12; draws fixed in I219a, board, effects and finite in I219b, lang.test's palette sweep, map-tree.test's timing and C42h's names in c-names.test in I219 part, palette in I219c, the editor's shaders ("process is not defined") in I219d, the smoke's first-steps check (it waited for main, but a first visit opens on fall since E235) in I219e, the rest of the smoke (Countdown's solutions read [] once relate's settles spent steps) in I219f, fixed.test's CORDIC and core-js.test's pig in I219 part 2, each file run alone; the nightly hasn't passed since 10-28): on CI resolve-once.test (a kept library resolving typed `List Case several` where it is `List a`), passing here; likely the same cause as CORDIC (a kept resolving read over another library check), fixed by part 2, for the next Nightly to confirm. | I208 | 2026-11-12 |
| I241 | A trial repository holding one real Ters program, to try the format and `ters diff` in real git use: edits on two branches touching the same definitions, PRs read in GitHub's raw view and with `ters diff`, merges with and without the driver, findings in a dated report. Needs Ersagun to create the repository. After I240 | thread "Decide the saved program format" | 2026-11-13 |

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
| C220 | `ters native` runs machine 2× to 3× slower than its WebAssembly on the same representations (C218's bench: fib 24 190 ms natively against 68 in WASI, sort 1000 385 against 139, primes 20000 60 against 26). Profile the C build and close the gap, or say why it's the C compiler's | C218's measurement 2026-11-13 (compiler/gaps/bench-machine.ts) | P3 | M | |

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
| C219 | `ters qasm`: unroll a loop to a known bound (ancillas reused since C219a) (REVERSIBLE-AND-QUANTUM-2026-11-11.md "Not done") | docs refresh 2026-11-13 (thread "Update all project docs"); REVERSIBLE-AND-QUANTUM-2026-11-11.md | P3 | M | |

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
| L252 | Units written in a type (`Float64 m/s`) and functions generic over a unit; units are inferred and checked today, not written (LANGUAGE.md "What's next"). Field units done (L252a, #2629), a number's unit read from text (L252b, #2630), signatures showing their known units (L252c; Ersagun 2026-11-13: known units only, unit-generic numbers stay plain Float64); left: a unit written in a pinned signature (signatures.ts pins carry none), with unit variables (`Float64 u`) for a function generic over its unit, and units inside other types (`List (Float64 s)`) | docs refresh 2026-11-13 (thread "Update all project docs"); LANGUAGE.md, NUMBERS.md "Units" | P3 | L | |
| L256 | A value packed with its implementation (INTERFACES.md step 6): a list of things of different types sharing an interface, paid for only where used. Waits for a program that needs it | docs refresh 2026-11-13 (thread "Update all project docs"); INTERFACES.md | P3 | M | waits for an example |

### Data and representations (DATA-STRUCTURES.md, REPRESENTATIONS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Effects and concurrency (ANSWERED-LATER.md, EFFECTS-REVIEW-2026-10-24)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L254 | Lazy fold results, so the effects in a fold could run top-down (LANGUAGE.md "What's next"). Research first: what it would mean for Choice and for the compiled loops | docs refresh 2026-11-13 (thread "Update all project docs"); LANGUAGE.md | P3 | L | |
| L255 | Cells holding a value that arrives later, as Solid's resources (a fetch's text as a cell with a loading state). Check first how much L59's page fetch already covers (LANGUAGE.md "Cells, further") | docs refresh 2026-11-13 (thread "Update all project docs"); LANGUAGE.md | P3 | M | |

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
