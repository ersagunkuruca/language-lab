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
**Size:** S hours · M one PR · L several PRs or a design note first.
**Status:** ▶ running · ⏸ held · blank = waiting.

## Next up

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | E103, then Language or Compiler rows agreed with those lanes |
| C Compiler and targets | "Compiler lane" | C41 or C58; C93 to Language lane B; C184 and C30 with the Editor lane |
| L Language and library | "Language lane" | L209, L44, then L88 and L182 when unblocked (core, run.ts, infer.ts, hosts.ts) |
| L Language and library | "Language lane B" | L118c (evaluator side, handed over by the Language lane 2026-11-05 22:16; waits on Ersagun, who stopped L118 after step 2), L120 (the compiler choosing a way). Skip L107 (waits on Ersagun) and L24 (research). Take a row from the other list only after telling that lane. |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I167 | + New definition freezes the editor. Example: Create of `extra(x)` on Insertion sort; done when it runs in tasks of at most 0.1 s. Left: the edit's own task, about 0.12 s in Chromium (2026-11-05 23:40, a loaded machine; 0.14 before I167m), of which the guard's check is about 35 ms, the new definition 26 ms and the inspector's draw about 57 ms. Was 1.3 to 1.8 s; what took it down is in DONE.md (I167b to I167l) | QA 11-04 L1 | 2026-11-04 |

## E: Editor

### Bugs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| I176 | Opening some definitions freezes the page for 1 to 2.2 s. Example: board `stage from key`, 2.3 s with one 2.2 s task (0.8 to 1.1 s in the morning's pass); also Spacetime `scalar part` 2.6 s, machine `all digits` 1.4, board `stage name` 1.3, calc `blank` 1.2. After I176a (2026-11-05 23:50): `stage from key` 0.68 s, its longest task 0.61; `stage name` 0.67; Spacetime `scalar part` 2.2 s (task 1.0), machine `all digits` 1.6 (1.6), calc `blank` 1.3 (1.2). Done when `stage from key` opens in tasks of at most 0.3 s | QA-2026-11-05b M1 | P2 | M | a done |
| I177 | Run main through the evaluator takes 2.6 to 4.5 s even for a small program (relations 2.6 s, calc 4.1 s to print `→ 0`, numbers 4.5 s; compiled runs 0.8 s; `lab run` of calc is instant). Example: calc → `main` → Run main with empty input; done when it prints within 1 s | QA-2026-11-05b M2 | P2 | M | |
| I178 | Redo's note reads "Redid: code.json changed back.": wrong for Redo, and a file name where words are expected. Example: Insertion sort, cut a part, Ctrl+Z, Ctrl+Shift+Z; done when the note says what was redone in words | QA-2026-11-05b L1 | P3 | S | |

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Writing programs in the editor

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Speed of editing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E103 | **Bug.** Adding a value in a definition run backwards is slow (five stages and E133, E103c to e and L226 so far, DONE.md). Example: physics `fall`'s holes, 72 s for all 23 and the worst 18 s (2026-11-05); its 8 call holes 119 to 34 s from cold, the worst 41 to 14.5 s, by refusing offers the callers can't use before a whole check (E103f), and before their plans are worked out (E103g: on main since, 37 to 23 s, the worst 16 to 5.9 s); done when the worst takes under a second. 2026-11-05 20:50, 17 holes now: 46 s, the worst 6.7 s; E103j 27.6 s, the worst 4.0 s (fillings alone 2.5 s, the rest the hole's first check). Measured 21:30: in the worst hole (a ref, 201 offers) 1.6 of its 2.7 s is the plans compared per offer, 245 of them at 6.7 ms, 205 the same as the program's; nearly all of it is the group's own mode (fall's body) worked out again, its callees already kept as published ones (keeping an unpublished callee's for the offers, E103k, was tried: 8 of 259 asked, not built). A literal at the hole is a given goal whatever its value, so literals could share one plan; a reference can't, since where a let names it or a higher-order call takes it the callee's mode changes. Left: the plans compared per offer (solveMode, about 4 ms each, 2,019 for one hole with 7 distinct answers) and the checks of the group. Next idea: where only a plan changes, check the solves' verdicts instead of a whole inference (reusing a verdict across callees needs a fingerprint of the callee's modes, not cheap and sound yet). Measured 23:10 (main at #2014): the 17 holes 17.8 s, the worst 1.9 s (cp3j3f), but 0.85 s of that is the first offer of steady sin and steady log working out their modes once per session (whichever hole offers them first pays it); without it the worst is mirt1t, 1.8 s, of which about 1.1 s is 110 checks of the group (one per different outcome among 268 fillings, ~10 ms each) and the plans are under 1 ms an offer. A field called on holes always made the program's plan at each hole (1,161 of 1,178), but sharing that plan bought nothing, since those plans were cheap. Left: the group's check per outcome (fewer outcomes, or a cheaper check of fall), and steady's modes worked out at build time rather than on first offer | E100 | P3 | M | |

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
| C30 | Lists as arrays, chosen from use, paying off on a real program. The chooser does pick `array of List` when a program reads a list by position often (library-reps.test.ts: `item at` in a fold over a range of 200), and WebAssembly and C lower that choice (C30d3c), but no example program reaches it: on 2026-11-05 chapters, ledger, sort, queens, notebook, routes, sheet, calc and countdown all keep cons lists, and the pedal keeps them for the three reasons in C184. Left: an example program that indexes a list often, chosen as arrays on JavaScript, WebAssembly and C, measured against the same program on cons lists; then whatever stops the chooser on it. Example: a new example program (a lookup table read by position in a loop, e.g. a histogram or a sample table) stored as arrays on JavaScript, WebAssembly and C and faster there than as cons lists | reopened 2026-11-05 (coordinator: close only when the chooser picks arrays where they pay off) | P3 | M | chooser and WASM/C lowering done; no example yet |
| C184 | The pedal's sound from the core IR as quick as compile.ts made it. Measured 2026-11-05 on one machine (bench-audio.ts): the core IR 0.037 ms a block, compile.ts's last 0.021 (its 0.036 on the machine first measured), by hand 0.009; the core IR is 4.0× the hand-written pedal. Where the core IR's time goes: building the block as a cons list and reading it back (sound.ts toList, fromList) 13%; the finite checks before each comparison 11%; the depth counter under 1%; the rest is the cons cells and the pairs a mapping-with-state builds per sample. The gap is compile.ts's lists as arrays chosen from use, which the core IR has only through the language's `array of List` row (C30). The chooser keeps the pedal's lists as written for three reasons: its program holds a page whose `Html` holds lists (listBoundary looks at every definition, not only the sound's); a library definition it reaches has a bare use (L211), which listBoundary refuses; and its bands are a relation run backwards (`fail` at a list). Example: compiler/gaps/bench-audio.ts's core IR row within 1.1× compile.ts's on the same machine | Ersagun 2026-11-05 20:00 (what compile.ts did that the core IR doesn't yet) | P3 | S | |
| C175 | Tidy the scalar printer's output (WGSL, and the core IR's other printers that share it). Example: raymarch's WGSL (511 lines). Copies, negations and unread lets done (scalar.ts `tidied`: 511 to 460 lines). Left: share what the gradient's per-axis copies have in common (`sin(0.7 · t)` is computed 20 times); build only the parts of `Pga_2` that are read; work out the time-only motor once per frame, not per pixel | Ersagun 2026-11-05 12:38 (Learn thread: the ray marcher) | P2 | M | |
| C93 | Lists read and written by position stay cons lists (primes 20000 compiled 47.9 s against 43 ms ideal); steps 1 to 3, (c) and s1 to s3b done (DONE.md). Example: machine's primes 20000 on JavaScript, aim 0.11 s (155 ms now on the core IR, split lists); done when it gets there. Left: (s4) that, and a cost for the split against the trees. WebAssembly and C keep trees until arrays are replaced in place there (C56) | [GAPS round 9](docs/reports/GAPS.md#round-9-machine-an-assembler-and-interpreter-on-every-target-2026-11-02) M1 | P3 | L | |

### Memory and layout (STABLE-REFERENCES.md §3 to §6)

All invisible to programs: no annotations or hints (Ersagun 2026-10-29).

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C56 | "Owned, in place" as a representation chosen when a value has one holder, generalising `$own` and C30 to records, maps and cell contents; reference counts (Perceus) where the compiler can't tell. Steps are C62, C63 | STABLE-REFERENCES.md §3 | P3 | L | |
| C57 | A region per scope: temporaries of one page update, audio block or frame freed at once (Tofte–Talpin) | STABLE-REFERENCES.md §4 | P3 | L | |
| C58 | Keyed collections as a grow-only array with a free list and generational keys (ECS) | STABLE-REFERENCES.md §4 | P3 | M | |
| C59 | Flat inline layout for data built once and read, doubling as a file format (FlatBuffers). Measured on notebook after C71/C72 (GAPS.md round 6, N3: about 10% left for it there, 4.4× the ideal with no one hotspot): its index is built once with one holder (8.5× the ideal on trees) and then only read by every question (8×); a frozen map as sorted key and value arrays makes `entries of` free and `value at` a binary search | STABLE-REFERENCES.md §4, GAPS.md round 6 N3 | P3 | M | after C70, C71 |
| C60 | **Later goal**: a list of records stored as columns when its loops read few fields | STABLE-REFERENCES.md §5 | P3 | L | |
| C61 | **Later goal**: where code runs chosen by cost, never written (workers, GPU compute, main thread). First step: read Bend 2 and write the design note | STABLE-REFERENCES.md §6 | P3 | L | |

### Parallel and concurrent code on the targets

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C41 | Pure `together` branches on worker_threads / Web Workers past a cost threshold | LANGUAGE-NEEDS-2026-10-24 | P3 | M | after L62 |
| C42 | Data-parallel `map` and associative folds on a thread pool, later as compute shaders (NESL, Futhark) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C30 |
| C43 | Or-parallel `all`/`count` and speculative `first` in canonical order, with work stealing (Cilk, Aurora/Muse) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C41 |
| C44 | Fibers in native C (own stacks, an event loop) and in WASM (JSPI) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C40 |

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

## L: Language and library

Numbers first (Ersagun, 2026-10-24 07:01), then the rest of
LANGUAGE-REVIEW-2026-10-24. Anything that only adds a target ranks below
all of these.

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L182 | Flags as hidden kinds: new attributes go through the schema (a), `def.results`, a field's `results` and `def.direction` gone (b, c1, c2; DONE.md). Example: `field.ports` gone, a field's port names read from its own type (c3); done when it is. Waits for function types' parameters to have names, since directions pair fields by them (L182c3 in DONE) | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §8 | P3 | M | |

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Ersagun's current asks

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L107 | **Open question, not decided** (Ersagun 2026-10-30: "I didn't ask to lift strict positivity BTW, I'm not sure if we should lift that"): drop strict positivity, so a data type may take itself as a function's input in its fields (`knot = wrap(f: knot → Float64)`), with taking one apart carrying Diverge so a function without Diverge still always finishes. Recursive data types themselves (a type holding itself, directly or through others) are allowed and always were; TUTORIAL.md §3.8 says so. If decided yes: LANGUAGE.md "Two rules", TUTORIAL.md §3.8 and the guarantees test | Ersagun 2026-10-30 | P3 | S | open question |

### Numbers (NUMBERS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L209 | Values stored in the smallest structure they stay in, chosen by the compiler through embeddings. Example: a Complex with no imaginary part kept as a Float64 in compiled code (EMBEDDINGS.md L208f, C lane, after L43c). Anything beyond it (a rotor as a quaternion, masks for std's own tables) needs its own row. Showing an inserted embedding in the editor is asked of Ersagun first | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | L | |
| L44 | Linear maps, geometry and matrices ([MATRICES.md](docs/design/numbers/MATRICES.md)). Example: a program's rotation function compiled as a matrix product. Left: the compiler stores linear functions as matrices (C lane, C30b/c) | LANGUAGE-REVIEW-2026-10-24 | P1 | M | a-g done |
| L118c | The evaluator compiles each definition to JavaScript closures once (closure compilation, Feeley and Lapalme 1987), keeping the heap continuation only where a search or a handler needs it; likely 3-10x on all interpreted code; notebook's Run takes 3.2 s for 100 notes, half of it the evaluator's own machine (GAPS.md round 6 N6) ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md) step 2). For later: Ersagun stopped L118 after step 2. Measured 2026-11-05 (Editor lane): notebook with 500, 1,000 and 2,000 notes and as many queries, `lab run` against the same program compiled through the core IR (`lab compile`): the run itself (startup of 6.3 s taken off) 5.4 s against 0.25, 19.9 against 0.44, 76 against 2.0, 22 to 45 times; nearly all of it the evaluator's own machine (run.ts going, step, resume, apply). So it would earn far more than 10%. First step done (Editor lane, docs/process/DONE.md): `lab run` runs a main that lowers through the core IR's JavaScript, the evaluator for the rest; what is left is the evaluator's own speed, for what doesn't lower and for the editor's Run | Ersagun 2026-10-31 | P3 | L | for later |
| L88 | Exact reals ([EXACT-REALS.md](docs/design/numbers/EXACT-REALS.md)). Example: `real less than` at Real answers with Diverge instead of fuel. Left: that one <, when a program asks for it | Ersagun 2026-10-26 | P2 | L | e1-e5 done |

### Data and representations (DATA-STRUCTURES.md, REPRESENTATIONS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L101 | **Later goal**: multithreading where uniqueness allows it (rayon), effect rows deciding what runs side by side (§5) | Ersagun 2026-10-29 | P3 | L | |

### Effects and concurrency (ANSWERED-LATER.md, EFFECTS-REVIEW-2026-10-24)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L69 | Foreign definitions ([FOREIGN.md](docs/design/targets/FOREIGN.md)). Example: one of std's world operations (the clock) answered by `hosts/js.js` instead of the evaluator's own code. Left: L69d (optional), std's world operations as host files. Ersagun 2026-11-05: a foreign operation may be declared pure only if it is ("reading the clock isn't pure"; FOREIGN.md). L69d1 done (DONE.md: the evaluator and the core IR's JavaScript). L69d2 done (DONE.md). Measured 2026-11-05 (L69d): std's world operations are answered by the runner's World (run.ts `World`, given per target: Node, the browser, tests' fixed clocks), which is a host already; the clock from a host file means World.now becoming a std hosts entry that a program's hosts/js.js can override, and hosts.ts taking std's effects (effectOfOperation finds only a program's own). Touches every World a caller builds (editor, lab, tests) | LANGUAGE-NEEDS §5 | P2 | M | a-c done |

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Grammars, modules and sharing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L72 | JSON as one relation: `json spelled` gives every spelling, `json read` is it run backwards (a to f done, DONE.md). Example: `json printed` is `json spelled`'s first on every target (e1d); done when it is. It waits for the core IR to run a `first` of a Choice without nesting the rest in it: 300 records run out of stack now, though the evaluator prints them in 0.29 s. Beyond it, rows if they earn them: json read's message saying where it stopped (f3), `json printed indented` as a variant (e4) | Ersagun 2026-10-24 | P3 | L | low priority |

### Physics and planning ([PHYSICS-AND-PLANNING.md](docs/design/physics/PHYSICS-AND-PLANNING.md), later goals)

Ersagun 2026-11-01: fast bodies passing through each other, and A* for an
agent with inertia. All later goals.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L120 | **Later goal**: the time when two things touch as a relation (`gap(a at t, b at t) = 0` solved for t), with conservative advancement and the closed forms as its ways. Done: examples/impact (L120a to c), one `first touch` with a ball's closed form and conservative advancement as a way, the compiler choosing by cost | Ersagun 2026-11-01 | P3 | L | a, b, c done |

### Someday

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L22 | Profiles inferred like effects and shown in the editor ("runs on the GPU"). L22a done: a definition's panel shows where it runs, from the lowering's refusals; L22b done: told at once from its own type (profiles.ts). Left: the profile carried in the type, as an effect is, so a caller is told without lowering: not by calls alone, since a call given a list written out is one the lowering unrolls (calculus's parabola calling polynomial) | REVIEW-2026-10-22b §5 | P3 | L | |
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
| T14 | The slowest single tests (steps a to m done, DONE.md). Example: editing.test.ts's swapAndUndo, 20 s now; done at 5 s. Left: the graph's wire values running fall backwards after each pick (editor/main.ts traceInputs), resolving arith.ts for each version's search was 8 of its 34 s (2026-11-05 17:00): the library's resolving seed was never made after #1860, fixed by #1928, 27 s since. Of the 27, the palettes' whole checks are 6 s: 266 checks, 213 of them refused because the filling breaks the held definition's pin ("is pinned to (a, a, a) -> a …, and this makes it (Float64, …)"). Those are refused before the check now (E103h): swapAndUndo 27 to 24 s. Beyond it, a row each if they earn one: the next slowest file (swapAndUndo 29 s on main at 18:20, 20 s after E103i: its two pages each check the library once, no repeat; the rest is drawing's types 4.2 s and the palettes' whole checks 3.6 s; simplifyAppend 14 to 12 s by T14n: a value written into a hole was checked with no options, so the library was checked a second time; listItems 12.0 s, implementInterface 13.5 to 5.9 s by T14o: a click on a side link that isn't there waited 5 s and was caught silently; the file's other silent catches don't wait), measured by stage. Measured, not built (2026-11-05 19:40): the whole editing.test.ts is 225 s, of it model.ts nodesWhere's own scan 25 s (Object.values of the ~27,000 nodes, for a program not on the library's layer) and the garbage collector 29 s; scanning by id instead took 225 to 219 s, under 10%; keeping the scan per version of the nodes would earn more, if code.nodes is never changed in place, which isn't checked yet | [TEST-SPEED-2026-11-03](docs/reports/TEST-SPEED-2026-11-03.md) | P3 | M | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P2 | Batch deploys if Actions cost needs it | Ersagun 2026-10-23 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805), tests reached by a one-line text.ts edit (145/150 + 44/44) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P1 | Ersagun's call |
