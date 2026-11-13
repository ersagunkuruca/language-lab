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
Focus since 2026-11-10 14:49 (Ersagun): finish stable references, free lists and multithreading (P1 rows C58, C60, C61, C43; C42, C57, C59 and C200 closed 2026-11-12 as waiting for an example, DONE.md); mobile rows are down to P3.
Defaults first (Ersagun 2026-11-10 15:34): "I want the default compiled code to be as close to a C/C++ dev doing data oriented design and cache and memory aware as possible. And then if we need Pools and similar stuff to get a last 10 percent of performance that's OK, but the defaults should be our first target." So rows that change what every program gets (layout as columns, arrays written in place, records changed in place, work on every core) go before ones a program must ask for (a Pool type).
**Size:** S hours · M one PR · L several PRs or a design note first.
**Status:** ▶ running · ⏸ held · blank = waiting.

## Next up

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | C58 (free lists; a Pool type asked of Ersagun); mobile rows wait. Then Language or Compiler rows agreed with those lanes |
| C Compiler and targets | "Compiler lane" | C187 is blocked on V8; C195 is done (#2515) |
| L Language and library | "Language lane" | the next goal row (stable references, free lists, multithreading) agreed with the lane that holds it; I203's editor half is with the Editor lane (L182 is with the Editor lane) |
| L Language and library | "Language lane B" | the next goal row agreed with its lane (C43's first on C waits for an example); round 12's I187 is with the Editor lane. Skip L107 (waits on Ersagun) and L24 (research). Take a row from another list only after telling that lane. |
| T Testing | "Replace the slow browser smoke test" | T15 (P0: Check main finishes), then I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I219 | What the full run fails on, on main (2026-11-12; draws fixed in I219a, board, effects and finite in I219b, lang.test's palette sweep, map-tree.test's timing and C42h's names in c-names.test in I219 part, palette in I219c, the editor's shaders ("process is not defined") in I219d, the smoke's first-steps check (it waited for main, but a first visit opens on fall since E235) in I219e, the rest of the smoke (Countdown's solutions read [] once relate's settles spent steps) in I219f, fixed.test's CORDIC and core-js.test's pig in I219 part 2, each file run alone; the nightly hasn't passed since 10-28): on CI resolve-once.test (a kept library resolving typed `List Case several` where it is `List a`), passing here; likely the same cause as CORDIC (a kept resolving read over another library check), fixed by part 2, for the next Nightly to confirm. | I208 | 2026-11-12 |
| I234 | FizzBuzz needs `first`: `remainder(n, 3)` has Choice (no answer for 0) even when the divisor is a non-zero literal, so the commonest first program must handle a Choice it can't take. A divisor known not to be 0 gives no Choice, or the guide's first loop says why it does. Suggested lane: Language | [OUTSIDER-WRITE-2026-11-13](docs/reports/reviews/OUTSIDER-WRITE-2026-11-13.md) §2.5 | 2026-11-13 |
| I237 | (Step a done: saved.ts reads and writes the digits, SAVED-FORMAT.md. Left: I237b, every example, library module and store rewritten once.) Number literals saved as their digits, exactly as written: `"0.1"`, `"1/3"`, `"12345678901234567891"`, never a JSON number, with `of` naming the type when it's known; what the digits mean (Int, Float64, Rational, …) is decided when the program is read. Every example rewritten once, the old form still read. Example: a 20-digit decimal at Rational and at Float64 round-trips through save, load, MCP and the merge driver. After I236. Suggested lane: Language | thread "Decide the saved program format" | 2026-11-13 |
| I239 | A run's log of the world's answers within bounded memory (Ersagun 2026-11-13: "it's still a memory hole"). Each world effect says how it is recorded: random as one seed for the run (our generator, seeded once from the world), the clock once per frame as a difference from the last reading. The log is kept as a window: a snapshot of the page's state every N seconds, older entries dropped, replay and step-back going as far back as the window. Prior art: rr's checkpoints, Redux DevTools' maxAge. Design note first. Example: tumble running an hour in the editor with its log under a fixed size, and step-back working inside the window. Suggested lane: Language | thread "Decide the saved program format"; worldlog.ts | 2026-11-13 |
| I240 | Saved programs as canonical JSON, one node per line (Ersagun picked it 2026-11-13): still plain JSON, but each node is one line, sorted by id, with no `id` repeated inside it and literals as strings (I237), and one byte-exact spelling per program, so saving an unchanged program changes no byte. Written by one printer shared by `ters`, the editor's Save, the MCP and `ters merge`; the old layout still read. Every example and library file rewritten once, in its own PR. Design note first (what is one line: a node, a name, a comment; where defs' order lives). Example: dice goes from 5,696 lines to about 900, a literal edited in the editor changes one line of code.json, and two branches changing different nodes merge with git's own line merge. After I237. Suggested lane: Language | thread "Decide the saved program format" | 2026-11-13 |
| I241 | A trial repository holding one real Ters program, to try the format and `ters diff` in real git use: edits on two branches touching the same definitions, PRs read in GitHub's raw view and with `ters diff`, merges with and without the driver, findings in a dated report. Needs Ersagun to create the repository. After I240 | thread "Decide the saved program format" | 2026-11-13 |
| I242 | The first open of some definitions freezes the page for over 2 s: calculus's `newton` 2.4 s, then 0.12 s; Markov's `weather` 2.3 s (QA-2026-11-12 L1). A profile shows the checker's type resolution (`resolveRow`) doing most of it. Find what the first open pays for and make it cost what the later opens do | [QA-2026-11-13.md](docs/reports/qa/QA-2026-11-13.md) Q1 | P3 | S | |
| I243 | The Changes tab names an anonymous dot as the text printer does (`x₂`), where the blocks and the graph say `•1`: the diff should use the blocks' names | [QA-2026-11-13.md](docs/reports/qa/QA-2026-11-13.md) Q2 | P3 | S | |
| I245 | A derivative of a function chosen at run time, compiled (I238's last part): calculus (`root near(f, 1)` over `samples`, each f a closure picked from a list) is the one example whose JS still ships nodes and runs the evaluator's `derivative` on the closure's lambda, and WebAssembly and C refuse it ("looks inside a function at run time"). The way: each function value that can reach `derivative` or `gradient` (by its type, as core-js.ts lambdasLookedIn finds them) carries its derivative, made ahead by derive.ts from its lambda with the same captures (a captured value is constant, its slope 0), so `derivative(f)` reads it, as forward-mode AD of a closure; a named definition given as a value carries its g′. In scalar.ts, so every target gets it: a closure shape with a second code. Example: calculus compiles to JS, WebAssembly and C with no node table and prints what `ters run` prints. Suggested lane: Compiler; L, a design note in CORE-IR.md first | I238 (#2560) | 2026-11-13 |

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

### Data and representations (DATA-STRUCTURES.md, REPRESENTATIONS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Effects and concurrency (ANSWERED-LATER.md, EFFECTS-REVIEW-2026-10-24)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L244 | `+` as one sum (CONFUSING item 9): `add`, `subtract` and `negate` are three built-ins, each with its own equation, where one relation `a + b = total` read in its directions would do (as `polar` is one relation); the names stay as the directions' names | [CONFUSING.md](docs/design/CONFUSING.md) item 9, checked 2026-11-13 (E256) | P3 | M | |

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
| T15 | Check main finishes: 0 of its last 100 runs passed (94 cancelled at the 20-minute timeout; newest finished one a failure on 11-11), so its base never moves and every run tests too much (I110's fix waits on a finished run). Split it into shards under the timeout, as I208 did for the Nightly, or test only what its own merge changed; then see it pass. With I219, until the Nightly passes and `good` moves off 10-28 | [STANDING-2026-11-13](docs/reports/reviews/STANDING-2026-11-13.md) §6.1 | P0 | M | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805 on 11-03; 3,421 on 11-13), tests reached by a one-line text.ts edit (145/150 + 44/44 on 11-03; 139/219 + 91/125 on 11-13) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P3 | postponed (Ersagun 2026-11-10: until people want to use Ters) |
