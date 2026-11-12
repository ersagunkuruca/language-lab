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
| C Compiler and targets | "Compiler lane" | C195 (relations in WebAssembly and C); C187 is blocked on V8 |
| L Language and library | "Language lane" | the next goal row (stable references, free lists, multithreading) agreed with the lane that holds it; I203's editor half is with the Editor lane (L182 is with the Editor lane) |
| L Language and library | "Language lane B" | the next goal row agreed with its lane (C43's first on C waits for an example); round 12's I187 is with the Editor lane. Skip L107 (waits on Ersagun) and L24 (research). Take a row from another list only after telling that lane. |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I219 | What the full run fails on, on main (2026-11-12; draws fixed in I219a, board, effects and finite in I219b, lang.test's palette sweep, map-tree.test's timing and C42h's names in c-names.test in I219 part, palette in I219c, the editor's shaders ("process is not defined") in I219d, the smoke's first-steps check (it waited for main, but a first visit opens on fall since E235) in I219e, the rest of the smoke (Countdown's solutions read [] once relate's settles spent steps) in I219f, fixed.test's CORDIC and core-js.test's pig in I219 part 2, each file run alone; the nightly hasn't passed since 10-28): on CI resolve-once.test (a kept library resolving typed `List Case several` where it is `List a`), passing here; likely the same cause as CORDIC (a kept resolving read over another library check), fixed by part 2, for the next Nightly to confirm. | I208 | 2026-11-12 |

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
| C195 | Relations in WebAssembly and C: a solve has no lowering outside JavaScript, where it is the evaluator's solver or a plan printed as JavaScript text (core-solve.ts, modes.ts), so `ters wasi` and `ters native` stop at "solves a relation (not in this profile yet)" (scalar.ts solveUse). A plan written as code the scalar profile lowers (as `derive` writes a derivative) would reach every target. Example: `ters wasi` of examples/relations, backwards, conjugate and physics printing what `ters run` prints (the other 16 examples with a main that isn't a page already do, 2026-11-06). Surveyed 2026-11-06 04:00 (Language lane, which took the row): no one step gets an example there, since each needs a different kind of solve. relations: split and add are solver plans with one way (`once`), square has two answers, polar is numeric or periodic. backwards: angle is `once`, greet a mode plan, magnitudes to is neither (relate.ts runs it). conjugate: brighter is neither (a conjugation of closures). physics: fall is numeric, rotate periodic. Steps: (a) a `once` solver plan (relation.ts compileSolve's `$one`) and a det or semidet mode plan (modes.ts) written as Ters definitions the scalar profile lowers, with `$clean`'s 12-digit rounding as a builtin on C (`%.12g`) and WASM, `$ok` and `$close` as arithmetic; (b) a solver plan with several answers as a Choice (square); (c) numeric plans (tearing, Newton) as Ters code (polar, fall); (d) solves relate.ts runs (magnitudes to, brighter), each a row if it earns one. Done: (a) for solver plans (C195a, 2026-11-06), (b) for ways without a periodic parameter (C195b, 2026-11-09). Mode plans with one answer or none (greet) done too (C195c, 2026-11-09). Tears of one unknown in a search (physics' fall) done too (torn.ts, 2026-11-09). Periodic ways where only a first takes the answer (physics' rotate), and for some over one predicate, done too (2026-11-10): physics prints on WASM and C what ters run prints. A first of a call of a definition that is one such solve (relations' to polar) writes its body in place there (2026-11-10): relations prints on WASM and C what ters run prints. Relational solves with several answers in a search (backwards' magnitude, every answer as a list, one chosen) and text joined with neither side known (cuts) done too (2026-11-10); backwards' main then stops at read numbers (show numbers unfolded). Found 2026-11-10: relate.ts gives answers by miniKanren's mplus, which takes the next arm's first answer whenever one suspends (each unfolded level, a recursive call), so every answer of an unfold or a recursive mode comes interleaved (square roots of each([4, 9]) is [2 3] [-2 3] [2 -3] [-2 -3]); written code would need that order (a breadth-first queue of suspended arms), or first-only readings. Until then, mode functions giving every answer refuse calls and unfolds. Left: periodic ways in a search whose every answer counts (all, count), and solves relate.ts runs with several answers (backwards' read numbers, square roots of each). Periodic ways, found 2026-11-09: to polar is a several-answer definition that main reads through first, so the solve is in CPS code, not under the first. The solver's stream goes by levels, L = 0 to 10^4, each the whole plan again with every k from −L to L, giving only answers no earlier one had and stopping at a level L > 0 with none new. Written out exactly, that is a loop over levels, a k list built per level, and a dedup check that runs the plan again over every earlier path, all in CPS: a large step. The cheaper way, level 0 when a first takes the answer, needs the first to be seen through the definition's call (first-arms.ts could carry it). 2026-11-12 (Compiler lane): a conjugate of a function written in place is a solve on the function it calls (#2481), so conjugate's quarter turn about compiles; equations solved together (bands run backwards: a + b and a − b known) are written as the solver's plan for them, each unknown rounded as it rounds (C195e). Conjugate then stops at multiband: bands run backwards has several answers (its otherwise arm takes a one-item list) and calls itself, so it needs the interleaved order too, which the Language lane is writing for backwards | Compiler lane 2026-11-06 (ters wasi survey) | P3 | L | |


### Mobile (Ersagun 2026-11-09: a goal; native compilation per platform a stretch goal, instead of a webview. Down since 2026-11-10 14:49, behind stable references, free lists and multithreading: "Platform stuff will eventually be solved anyway")

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L235 | Foreign views: a program declares a view kind of its own (a map, a camera preview) the way FOREIGN.md declares operations, with one view per platform in a host file (a DOM element on the web, an Android View, a UIView), mounted by `Html` like any element. A platform with none is answered through L234. On the web and in the Android app done (DONE.md L235 steps); left: iOS's with C199e | Ersagun 2026-11-10 13:47 (Learn thread: multiplatform UI) | P3 | M | after L234 |
| L236 | Platform lifecycle as effects a page can handle: back, pause and resume, permissions asked and answered (popstate and visibilitychange on the web; onBackPressed, onPause and the permission dialog on Android; their iOS counterparts with C199e). Keep one meaning in the language; each shell maps its own events. Back, pause and resume done (`on("back")` and so on, web and Android; DONE.md L236 step); permissions asked by main and a page's handler, on the web, the command line and compiled JavaScript (L236 steps 2 and 3); left: Android's permission dialog (needs C page handlers that wait) | Ersagun 2026-11-10 13:47 (Learn thread: multiplatform UI) | P3 | M |  |
| C199 | Stretch: native apps per platform instead of a webview. Designed in docs/design/targets/NATIVE-APPS.md (2026-11-10): the program through the C target, a thin native shell per platform, and a view host in C mirroring html.ts's `Doc` and `El`; step C199e left (C199a to C199d done). Example: dice as a native Android app with no webview | Ersagun 2026-11-09 | P3 | L | C199a to C199e |
| C199f | The other page examples as native apps, each checked against its web version as dice was (behaviour on the headless host against html.ts, layout against Chromium at 360 wide). Surveyed 2026-11-10: tumble, bounce, compass, constructions and agent lower for C; converter (show as a value), pedal and spacetime (a relation run by the relational interpreter) and pig (a match on data in `recorded into`, lowered since) were refused. tumble, compass and constructions show what html.ts shows, bounce mounted and over three seconds of frames. Pictures are drawn now (paths, arcs, circles and the rest, paint from the sheet; within 0.1 of Chromium for compass, bounce and constructions), and tumble's APK builds (Android has no ucontext; fibers switch with setjmp there). Pointer events now reach boxes (tumble's taps, checked on an emulator by the Android check workflow) and pictures (C finds the shape under the finger, so compass's points drag). Animations run on the screen (tumble's steps go on when one ends). Tumble swaps by a drag too. Boxes clip with overflow: hidden, and min-height keeps a box's room (tumble's status no longer reflows); max-height with overflow: auto scrolls (pig's log). pig lowers and plays in C (its own handler of Random). Native pages have the web page's base sheet, and borders on one side. Pictures draw their texts (spacetime's labels: at their anchors, sized and painted by the sheet; spacetime itself waits on C195 for its sliders' solves). Native sheets read :empty, :first-child and :last-child (pig's empty log and tally aren't shown, its last line has no rule, as in Chromium). Left: Ersagun's try of the new APKs. Example: tumble on a phone with no webview | C199 | P3 | M | |
| C199e | The iOS shell: a Swift view host over UIKit (NATIVE-APPS.md). Needs a macOS runner, free on the public repo (Ersagun 2026-11-10 16:10). Example: dice on an iPhone simulator | C199 | P3 | M | |

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
| L24 | Research as it becomes blocking: costs from folds, laws proved by fusion, fast invertible parsing | ROADMAP 8 | P3 | L | |

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
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805), tests reached by a one-line text.ts edit (145/150 + 44/44) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P3 | postponed (Ersagun 2026-11-10: until people want to use Ters) |
