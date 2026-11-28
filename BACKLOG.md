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
| E Editor | "Editor lane" | E319k (editor thread, Ersagun 2026-11-23) |
| C Compiler and targets | "Compiler lane" | G10 with the Editor lane (its texture contract first) |
| L Language and library | "Language lane" | L271c (the fill's push); L266 parked 11-26 (Ersagun) |
| L Language and library | "Language lane B" | L251, L253 (P3, from the 2026-11-13 docs refresh) |
| L Language and library | "Speed up the interpreter on real programs" | no open row (round 2 stopped 2026-11-23, Ersagun: fix the failed compile instead, E320) |
| G Game | "Build a game to test Ters against engines" | stage 1: done (C265, C267 done, C283 and C284 closed measured; G1b with G3d, columns: done in JS, closed for C and WebAssembly 2026-11-22) ([GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md)) |
| L Language and library | "Build a tuner, metronome and looper app" | L271c |
| T Testing | "Learn from Ephyra for our bug finding" | no open row (T18a-g done 2026-11-27; findings C366 and I387 are rows for their lanes) |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| L266 | A faster checker: machine's 8,000 reached nodes took 1.5 s, about 190 µs a node; aim for 10x. L266a: 0.2 s warm. Next: compiling machine still checks it six times (firstArms three, bake, stage, fused folds: about 0.2 s each), L266b keeps the higher-order call analysis's answers between checks. L266c resolves arithmetic over what is reached, L266d reaches once. Left, in `ters compile machine` (8.8 s): the first check 1.1 s (warm it is 0.15 s; L266e found the once-per-process part, 0.45 s, not worth a snapshot); choosing representations 4.8 s, of it two whole checks of the program over the library (represented.ts and library-reps.ts, 0.7 and 0.8 s) and the choice's walks (choiceOf 2.4 s: splitByGroups, represent.ts uses and looped walking each definition's subtree again per type); lowering 3.5 s, of it first-arms' checks 0.6 s. With I316, machine's compile under half a second. C256 found the checks inside lowering are the checker's cost too: rechecking only what a pass changed (infer.ts inferRewritten) saved 0.2 s of machine's 3.1 but kept effects the passes had made more exact (drift, depot, sheet got Diverge back), so a faster whole check is the fix; and a layered check joined a first's thunk's row to the row around it (agent's first-arms took 5 of 7) Measured again 11-24 (Language lane): `ters compile machine` 4.1 s warm, 5.9 s with nothing kept, spread over about twenty passes, none above a second: the lowering 1.5 s (scalar 0.85, zero parts 0.2, owned arrays 0.1), choosing representations 1.0 s (splitting lists 0.25, the chooser's replay 0.13, the check of what it made 0.13 and carried 0.13), arithmetic's resolving 0.33 (spread tuples typing the reached library bodies, which lowering needs anyway), the check 0.9 (half of it library bodies typed when first asked). No one cut is worth more than 10%: the 10x is the redesign's per-definition lowering (COMPILER REDESIGN, stage 4) | Ersagun 2026-11-17 ("Having to spend more than a second compiling them is kinda weird") | 2026-11-17 |

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

### Trying a program where it runs ([RUN-INPUTS-2026-11-17](docs/reports/RUN-INPUTS-2026-11-17.md))

Ersagun 2026-11-17: a program's inputs (arguments, files, standard input) are visible and editable in Run, with the example's own ready, so it can be tried without reading its code.

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

| id | item | source | added |
|---|---|---|---|
| C303 | The rest of mnist's Adam pass in the core IR (3.1x the ideal over 10,000 digits after #3410 and the arrays filled with room for their count, 5.1 s → 3.15 s): the dots are now near the ideal's loops; left are the collector (8%), the small calls of `table of`'s maps and the arrays made each step. Float64Arrays for the arrays measured no faster end to end (C303c, and again 11-26) (DG4) | GAPS.md round 22 (mnist) | 2026-11-23 |
| C304 | mnist's Newton mode after C304c is 2.9x the ideal in the core IR (Adam 6x): its Dual arrays are columns now; left is what the profile shows next (DG5). Profiled 2026-11-26 (1000 digits, 3 passes, 11.9 s against the ideal's 4.2 s): two Dual dot loops take 6.4 of 10 s and are as V8 runs them best (the Dual made in the loop and read at once is no slower than its parts by hand, measured). One, 1.8 s, dots the digits lifted to Duals, whose ε column is always 0: a column known 0 (zero-parts.ts over arrays' items) would drop a third of its work, about 6% in all. The other dots Dual by Dual, three products an item where the ideal's R-pass does two, so most of the 2.8x is the program's forward-over-backward on Duals, not the loops | GAPS.md round 22 (mnist) | 2026-11-23 |
| C351 | (mnist no longer needs it: C351c wrote its weight gradient with `contracted`, Ersagun's pick of 11-26; kept for a program writing its products as dots.) A map over a range whose item k is a strided sum with offsets that step with k, worked out as the sums of neighbouring items together. The weights' gradient in mnist is `map(range(n), k => dot(d1, quotient(k, 784), hidden, x, remainder(k, 784), 784, b, 0))`: one sum a weight, walking the pixels 784 apart. The ideal (`outer`) and NumPy add each digit's row into the gradient's row instead. That is the same sums in the same order, so the bits are the same and no `.decisions` entry is needed. Measured 2026-11-26 after C350: in the core IR (JavaScript) the 29% of Adam (0.98 of 3.4 s) was the prelude's `strided products` (contracted's sums), not this `dot`; C351a worked those several at once, 3.1 to 2.4 s, and C351b at Dual (newton 11.9 to 10.0 s). Writing the weight gradient on `contracted` instead (d1 [b, hidden] by x [b, 784] over the digits), measured 11-26 with the same output: native adam 0.81 to 0.66 s, newton 3.8 to 2.7 s; core IR newton 10.0 to 7.6 s. Natively it is 43% of Newton 1000×3's instructions, at Dual. 4 weights at once by hand in the C measured about 11% of Newton's run (3.48 to 3.10 s user), and a C sketch of Adam's gradient 1.3 to 0.42 ms a batch. Native is now under the ideal JS (adam 10000 0.81 s against 1.03 s, newton 1000×3 3.8 s against 4.2 s) | GAPS.md round 22 (mnist) | 2026-11-26 |
| C306 | Matrix products natively at NumPy's speed: blocked for the cache, vectorised, on the pool's threads. NumPy runs mnist's Adam pass over 60,000 digits in 0.69 s, `ters native` in 15.6 s, the ideal JS in 4.6 s. After C302 and C303 (DG8). C306a done (native one-axis products, 2×4 sums at once: Adam at 10,000 digits 1.5 to 1.19 s, ideal 1.04 s). C306b done (the same at Dual: Newton 1000×3 4.0–4.4 to 3.2–3.7 s). Measured after C306b: products are now 8% of Adam's instructions and 17% of Newton's, so the pool's threads would buy under 10% there. The program's own `dot` (one matrix row by one digit) is 28% and 43%. Each `dot` is one sum in order, so it can't be split or vectorised without changing the bits, and NumPy's speed needs sums added in another order (a meaning call). Stopped here: native Adam 1.19 s, ideal 1.04 s. Reordered sums, measured 2026-11-26 after Ersagun allowed them behind a `.decisions` entry (sums stay in order by default): mnist's C edited by hand so `dot` keeps 4 partial sums (added (a0 + a1) + (a2 + a3), then the rest in order). Adam at 10,000 digits went from about 2.21 to 2.12 s for the whole run (~5%), and Newton 1000×3 at Dual got slower (5.1 to 5.3-6.0 s). The hot `dot` is one weight's gradient over the batch, walking the pixels 784 apart, so memory sets its speed, not the order of adds. Not built (under 10%). Working out neighbouring items of that tabulation together keeps the bits and needs no entry: 4 weights a row apart at once, each sum still in order. A C sketch of the gradient (32 × 784 weights over 100 digits) went from 1.3 to 0.42 ms a batch with the same bits, but that is about 0.09 s of the run (~4%), so it isn't built either. gprof of that run: building an Array of Int from a list (`array of`, reading the files' bytes) 25%, `readBytes` 14%, cells made (`lab_new`, 56 million) 12%, the strided `dot` 11% | GAPS.md round 22 (mnist) | 2026-11-23 |
| C354 | **11-27 07:31 UTC (Ersagun): change how views hold lists.** Step A done (C354a, DONE.md): page lists as arrays; a frame 2.3x faster. C354b: keep, map and flat map over arrays work out only the new card (an add 0.96 -> 0.62 ms at 2000 cards). C354c: the column's redraw mounts only the new row (an add about 0.7 -> 0.5 ms). C354d: the tag set adds only the new card's tags (an add 0.59 -> 0.49 ms mean). Left of an add: `each`'s row matching, redrawn's walk over the kept prefix, and cells.ts `inserted`/`differences` copying both arrays. **DECIDED 2026-11-26 22:44 UTC (Ersagun): build it in steps.** Step 1 measured 11-26 night and closed (0% on board; the cons cells, not the tests, are the cost; see the doc's "Measured" section). Steps: docs/design/INCREMENTAL-VIEWS-2026-11-26.md (1 keep and map follow edits, 2 sum and length, 3 the runtime takes the edits, 4 flatten). Incremental lists in a page's views: a card added flows through the view's `filter`, `keep`, `map`, `sum` and `flatten` as one edit, instead of the view running again over every card and the page runtime diffing the old and new lists. Measured on board at 2000 cards (11-26): adding a card costs 1.2 ms, against the ideal's 0.02 ms, and both halves are O(cards). About 0.9 s of the 2.3 s of adds is the program's own view code over every card (`shown cards`, `at stage`, `points of cards`, `filter bar`, flatten, reverse). About 1.3 s is the runtime: cells.ts `inserted` and `differences` walk both lists, and html.ts `redrawn` mounts every kid. These are already pointer walks (C287), so nothing local takes them under O(cards). Plan: (1) cells.ts already carries a list's `grown` edits to its `each` rows; carry them into a view's call, so a formula over a list that received inserts is given those edits with its last answer. (2) The library's list functions a view uses (`filter`, `keep`, `map`, `sum`, `length`, `flatten`) each get an edit rule: an insert at i is an insert of f(x) (map), an insert or nothing (filter, keep), an add (sum, length). The compiler marks a view's formula incremental only when it is made of these, and runs it again otherwise, so meaning never changes. (3) html.ts `redrawn` takes the edits instead of diffing the kids. Success: an add on board is O(1) in cards, and the session at 2000 cards gets several times faster; every page gives what it gave before. Prior art: self-adjusting computation (Umut Acar, "Self-Adjusting Computation", PhD thesis, CMU 2005; Acar, Blelloch, Harper, POPL 2002), and incremental view maintenance in databases (Gupta and Mumick, 1995). | Compiler lane board profile, 2026-11-26 | 2026-11-26 |
| C330 | `map(numbered(xs), f)` in general as one loop by position, no pairs, and a map over a list known to be a handful of items long never asking for workers (`mapWorth`). The case GAPS.md round 24 found, a map that replaces one item (`if p.first = c then v else p.second`), is read as `replace at` (part 1, DONE: typeset at 1000 paragraphs core IR 2.08 → 1.27 s, native 1.14 → 0.74 s). Waits for a program whose map over `numbered` does more than replace one item. Measured 2026-11-26 on fft's (strings, tuner, frets, looper: the odds' transform turned by position): in strings' compiled run `numbered from` is 33 ms of 2.0 s and the maps 67 ms, and fft makes twice as many pairs in its two `zipped`s, so the loop alone buys under 5%; worth it with `zipped` maps read by position too. (Since L292 fft maps no `numbered` or `zipped`: it works on arrays.) Measured again after L292 (Language lane, 11-26), one thread, the time in `numbered`, `numbered from` and `zipped` making their pairs: strings 41 ms of 2271, typeset 2 of 1714, scan 1 of 8273, and none sampled in bazaar, flock, fit, mnist (adam 10000, newton 1000). The maps over them are the program's work either way, so fusing saves under 2% wherever measured: under the bar, not built. It waits for a program whose pairs show in its profile. The short map's half, 11-26 (Language lane): a job down to one unit is never sent (the main thread takes its units first, so it ran here after its payload was written for nothing), and the first post's copy, times the workers, joins the count of whether sharing pays: wav-file at a minute of stereo in core JS 3.0 -> 2.6 s (2.45 s with no workers; bazaar at 200,000 unchanged) | GAPS.md round 24 (typeset), TG1 | 2026-11-24 |

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L266af | Incremental compile after edits, parts 2 to 5 (plan doc https://claude.ai/artifact/WaH3BBwr84Rai5dm6mddVn): definition keys kept by node objects; lowering per function kept (a stop's number is counted over the whole program today, so a kept function's stops need numbering of their own); the whole-program analyses (ownership, zero parts, arithmetic, first arms, reach) as per-definition summaries kept by key; the choice made from kept summaries with a per-definition rewrite. Each part checked by compiler/test/edits.test.ts and the 78-program sweep. Goal: machine's recompile after a one-definition edit under 0.3 s (1.48 s at part 1). Measured 11-23 (ters/bench/edits.ts machine, 1.3 s: check 0.04, choice 0.46, lowering 0.76, print 0.03): lowering per function as planned would keep only the scalar code and text (func 0.06 s, print 0.03 s); the rest of lowering is some 40 whole-program passes of 10 to 90 ms each (arithmetic 0.09, firstArms 0.04, ownedArrays's oneHolder 0.04, bake 0.035, reach 0.035, zeroParts 0.03, vouched 0.045, columns, useDirections, …), so the per-definition summaries (part 4) come first, the largest first. 11-24 (Language lane, L266ay): the nodes and walks now stay the same objects across an edit's recompile (all but the edited definition), 1.36 to 1.2 s; the rest is still flat (about 40 passes, each copying or scanning the whole node map: nodeIds, copyNodes, joinedOver and the collector together about a fifth), so the next step is each pass's result kept by the definition's walk. 11-24 later: a pass's result kept by walk needs a key of the definition's types too, and 31% of machine's node types are other objects after an edit (renumbered variables), so writing that key costs about what the pass does; instead, for an edit of a number within its class, lowering's front steps and its prepared steps (arithmetic, first arms, lets) take their last answer with the new value put in, as the choice does (literals-again.ts, the seeded ids moved on as if made), 820 to 680 ms; left: the scalar lowering itself (func 0.07 s), vouched and verify 0.06, bake and stage 0.05 (these read numbers), and the core IR passes, about 0.18 s. 11-25: #3295-#3301 (the choice's check, ownership, the verdict, the baked calls and the staging kept; three IR passes walk less) took it to about 0.45 s on the bench, 0.33 s for an edit that keeps a number on its side of 0; a 0 -> 1 edit stays a full recompile (the check's signs.ts reads whether a number is 0). #3307 found literals whose value, not only its class, a pass reads (a log of one, slice(t, 0, 1), one inside a divisor or a test's side: value-reads.ts) and takes no edit of those as a class edit. The IR passes read Int values (int-ranges, kept-arrays, kept-items, share-calls' keys), so they can't take a number edit as a patch. 11-25: the scalar lowering made again with the new values put in (0.18 s of 0.55 s) buys nothing on the bench, since the bake reads (readRuns: every literal under a run and in what it reaches) the literals the bench edits; cut (CUTS.md). The lever there is the bake telling only the literals its runs read; tried 11-25 (the evaluator telling each literal it compiles or reads): the same 344 reads on machine, 0% on four programs' benches, since the bench's edits are of literals the bake's runs do read (CUTS.md) 11-26 (Language lane): #3387, #3390, #3393 (value reads carried over, the choice's key and patch without walking every node, the passes before lowering taken again) and the Compiler lane's holders work (#3377-#3384): machine's number edit about 0.35 to 0.4 s on the bench (check 0.03, choice 0.01, lowering 0.3, print 0.03). Of lowering, lowerScalar about 0.15 (func 0.05, the front's replays 0.02, prepared 0.015, vouched 0.007) and the core IR passes about 0.15 (ownedArrays 0.04, ownedRecords 0.03, columns 0.02, zeroParts 0.015). Keeping func's output per definition needs the some 50 tables lowerOnceIn shares across definitions (funcs, index, shapes, records, closureCode, stop sites, kits …) replayed per definition: the planned part 3 is that redesign, not a cache over today's lowering 11-26 (Language lane, L266bf, Ersagun chose per-definition lowering 11-26): the core IR passes after the scalar lowering are taken again for a number edit with the new numbers put in (ir-again.ts; passes that read a number's value say so): machine's same-class number edit about 0.25 s (lowering 0.17: lowerScalar 0.11 with func 0.055, printing 0.035). Left for one-definition edits of any kind: the scalar lowering per definition and the passes per function. 11-26 evening (L266bg-bx, #3416-#3460): machine's body edit about 1 s (check 0.025, choice 0.13-0.2, lowering 0.7-0.9, print 0.035), the whole-program scans now per definition; part 3 measured first: keeping each function's scalar lowering saves at most 0.05-0.075 s (functions without callees 0.007), and the rest is part 4's passes (prepared 0.11, verdicts 0.055, zeroParts 0.07). Parked 11-26 by Ersagun (card); if taken again, part 4 first, largest pass first | Ersagun 2026-11-20 (card: incremental compile after edits) | 2026-11-20 | high | L | ⏸ parked 11-26 |
| L266u | Make the List choice carry its types, as the Map and Set choice does (carried-reps.ts, #2899), so a first compile doesn't check the program again (about 0.2 s of machine's 2.3 s warm). The rewrite's old nodes keep their types, with List read as the array on the arrays' side; refs to builtins at the boundary, the conversions and the loops' new definitions are typed by unifying what they're given. On machine that rule types every old node the way the check does, except 55 of these. Set aside on 11-19 for stage 4, whose stable ids already let a recompile skip this check. Measured 11-25: 0.13-0.16 s of machine's 4.1 s compile (3.5%), under the bar alone (CUTS.md) | compiler redesign, 2026-11-19 | low | M | cut 11-25 |

### Speed of the interpreter, round 2 (Ersagun 2026-11-22: flock ran interpreted at 0.5 fps after an edit whose compile failed; "Why is the interpreter THAT much slower though?")

Flock's page, interpreted in node, ticked twice a frame: 7.2 s a frame before L281i.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Instrument app ([INSTRUMENT-APP-2026-11-17](docs/reports/INSTRUMENT-APP-2026-11-17.md))

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
| C326 | Cheap fibers on C: a handler's fiber takes 6 to 7 µs to start (a 64 MiB stack malloc'd and freed each time: an mmap, an munmap and page faults) and 330 ns a perform and resume (glibc's `swapcontext` sets the signal mask, a system call each way). A pool of kept stacks reserved with mmap and a guard page, and c-rt.ts's own switch (its Android and Apple path) on Linux too, measure 10 to 20 ns and 14 ns (compiler/gaps/allocations/fibers.c). That switch needs `-D_FORTIFY_SOURCE=0` on glibc, whose fortified `siglongjmp` aborts a jump onto another stack. The switch is done on Linux (C326a): crew performs and resumes in a loop. Left: the pool of kept stacks, when a program starts many fibers (crew starts a handful) | [ALLOCATIONS-2026-11-24](docs/reports/ALLOCATIONS-2026-11-24.md) | P3 | M | |


### Mobile (Ersagun 2026-11-09: a goal; native compilation per platform a stretch goal, instead of a webview. Down since 2026-11-10 14:49, behind stable references, free lists and multithreading: "Platform stuff will eventually be solved anyway")

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Desktop apps ([DESKTOP-APPS](docs/design/targets/DESKTOP-APPS.md); Ersagun 2026-11-23 10:08 TRT: go, macOS first, then Windows)

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
| L280b | Per-definition summaries (jobs used per type, calls in a loop) kept in `.lab/` by content hash; a pick whose facts come out the same is reused without the chooser (early cutoff). Measured 2026-11-20 (machine, warm ~0.42 s a choice, CPU profile over 13 runs, no check cache): deciding (choose, uses, looped, listBoundary, inPlace, keyed, generic, listGroups, listFree) about 30%, rewriting (represent, splitLists, stable ids) about 23%, checking the rewrite (infer, carriedChoice) about 36%, the passes before it (fuse walks, fold items, holders, reach) about 8%. A saved pick alone skips the 30%; the rest needs the rewritten definitions and their checks kept by hash too. Part 1 done: the chooser's decisions kept on disk by the program's key (`.lab/decided`), taken by the next command (machine 4.5 -> 4.1 s, greenhouse-page 6.0 -> 5.2 s cold); left: per-definition summaries so an edit elsewhere keeps the decision. Measured 2026-11-22 (machine, cold, 0.84 s in choiceOf): splitByGroups 0.24 s, generic 0.20 s, uses 0.17 s, choose 0.08 s, looped 0.06 s; generic and uses read every definition's calls and their callees' schemes, so a summary per definition has to be keyed by its callees' too. A literal edit (the editor's drag, the 0.5 s goal) already skips the chooser Measured 2026-11-24 (machine, the chooser cold, 0.8 s in choiceOf): generic 0.20 s is nearly all the library bodies its callees are typed when first asked (looked, info.schemes), which the lowering needs after anyway, so keeping generic's answers per definition saves none of it; uses 0.13 s, splitByGroups 0.25 s (the rewrite itself). A per-definition summary would save about 0.2 s of a 4.5 s compile (under 5%), below the 10% bar: left until the redesign's per-definition lowering makes the summaries its own | Ersagun 2026-11-20 | P2 | M | |

### Instrument app: tuner, metronome, looper ([INSTRUMENT-APP-2026-11-17](docs/reports/INSTRUMENT-APP-2026-11-17.md))

Ersagun 2026-11-17: "A universal instrument tuner, metronome, looper app. This I really want to develop." Ersagun said go 2026-11-17 19:00; the metronome first. L267, L268, L269, the metronome (L275) and the tuner with its signals and tunings modules (L272 to L274) stereo (L270) and minutes of audio in a cell (C261) are done (DONE.md). The looper (L276) and the strum tuner (L277) are done. Left: L271c beside them (L271b, WAV in the language, is done); the frets page (L278), L279, C271, C273, C260b and C269 are done. The compiled FFT is about 50 times hand-written JS (a 2048-sample autocorrelation takes 14 ms); C262 measures it.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L271c | Keeping a recording, minutes of it: the sounds module (L271b, DONE) writes and reads WAV in the language, but slowly. Measured 11-21 compiled to JS: a minute of stereo at 16 bits written in 15.6 s with the tone made (11.5 MB), ten seconds written at 16 and 32 bits and read back in 7.0 s, a minute read back out of memory at 8 GB; garbage collection is 40 to 47% of it, then range, lists made into arrays and worker messages. Wanted: a few minutes saved in a second. `array of(map(range(n), f))` is filled where it is made (part 1, DONE #3279), and wav-file's Bytes are a byte array with the WAV bytes filled by position (part 2, DONE): 10 s of stereo written and read back in 2.2 s. The Sound's channels are arrays and its maps stay on the main thread (part 3, DONE): 0.84 s. The read's channels filled into arrays where they're read (fill-arrays.ts, through `items of array(array of(map(range(frames), …)))`) and a Float32 read from its two 16-bit halves, no BigInt (part 4, 11-25): 10 s of stereo written and read back at 16 and 32 bits, the tone made too, core JS 4.7-5.3 -> 3.0-3.4 s, native 0.56 -> 0.37-0.45 s; a program writing a WAV without reading one compiled to a crash, fixed (own-holders.ts). A push in the fill no longer makes a view each (11-26: pushOwned grows the view it's given, and a full buffer moves to one twice as long with its room after it): a minute of stereo at 16 bits written and read back in core JS 3.3 -> 3.1 s. Left (11-26 profile of that minute): the words' own loops; the maps sent to workers for nothing are C330's (11-26: 3.0 -> 2.6 s). Done: in an app, offer file as the share sheet and ask for file as the system's picker (c.ts; 11-26 both compile to C and WebAssembly as on the command line, as the evaluator has them: written here under the name alone, asking aborts, offer-file.test.ts; and in an app's page the screen asks where or which and the handler waits for it, a Mac's save and open panels and Windows' save and open dialogs; and on phones iOS's share sheet and document picker, Android's create and open document (11-26)). 11-25: the write's Float32 words made as two 16-bit halves, no BigInt, bought about 5% of a write in core JS (CUTS.md); cut Measured 2026-11-27 (Language lane): a minute of stereo written and read back is 2.5-3.2 s in core JS, run to run on this machine. Inclusively, the write is about a third, the program's own check (`largest difference`, every sample compared) about a quarter, the read about a ninth, and the byte fills spread over the words' loops. Each sample's remainder and quotient by the channel count go through the runtime's many-builtin wrapper, so I tried a small-Int fast path for both by hand in the printed module: 2.54-3.27 s against 2.71-3.18 s over 6 runs each, no gain. Nothing left in it reaches the 10% bar | Ersagun 2026-11-17 | P3 | M |  |

### Desktop apps ([DESKTOP-APPS](docs/design/targets/DESKTOP-APPS.md); Ersagun 2026-11-23 10:08 TRT: go, macOS first, then Windows)

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

## G: Game ([GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md))

Ersagun 2026-11-17: a medium-sized original game to test Ters against current engines and languages. Ersagun said go for stage 1 on 2026-11-17 19:00 UTC; stage 2 (drawing with data) on 2026-11-22; stages 3 to 6 stay held. The lane column is a suggestion; each stage ends in a bigger-program round.

| id | item | lane | source | pri | size | status |
|---|---|---|---|---|---|---|
| G25 | The greenhouse's flight (90% of a tick) spread over threads beyond what native does now. Measured 2026-11-27, 600 ticks of 2,000 moths: native already runs it on the thread pool (0.97 s alone, 0.60 s on 4 threads; the hand-written C 0.38 s, 0.17 s with OpenMP), its parallel part scaling as OpenMP's does here; the rest of a tick, about a fifth of its instructions, runs on the main thread (sharing the captures each tick, the grid filed, the moths' items kept). Compiled JS never sends it to workers (a function given by the caller is known only on C, C266), and when it can (patch js-flight-cross.patch in the project's files: given functions on JS, columns and items by shape crossing) the 2,000 moths copied to each worker and back take 7 ms a tick against 3.4 ms in turn. JS needs the pool's items in shared memory to gain; WebAssembly GC has no shared objects. G25a done (the moths' keep dropped: native on four threads 0.73 → 0.65 s); G25b done (memory with threads bounded: a night 270 → 17 MB); G25c closed measured (each piece left on the main thread 2 to 3% of a tick, filing the grid 10% of which a fold split could move half) | C | GAPS.md game round 2 | P2 | M | |
| G12 | Float32 compute kernels over columns, records of Float64s as vec2f to vec4f as in pictures. Its example: examples/rain-page, 20,000 Float32 drops slid by one map a tick. G12a done (a captured record holding a Bool no longer keeps a map on the main thread), G12b done (a map or keep of records of Float32s, Ints and Bools as a kernel of words, where its arithmetic is the CPU's bit for bit), G12c done (one only close held on the GPU by its .decisions entry, `GPU close`), G12d done (rain-page as written sends its slide away: lists split off pick a tree only by their own jobs). Left: a map whose answer is a record of another type; items held as columns sent as they are | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | |
| G13 | Data that stays on the GPU: a column only kernels and draws touch lives in a GPU buffer across frames, never read back (C61's choice by cost, carried to data); GPU particles as its example. Example: examples/rain-page's drops. Design note [GPU-DATA.md](docs/design/targets/GPU-DATA.md): G13a done (which lists stay: gpu-resident.ts), G13b done (one device, gpu-device.ts; rain-page's drops kept on the GPU between ticks, slid by the kernel and drawn from its buffer, the entry `GPU between ticks` a person may hold on the CPU); G13c1 done (no steps sent up each tick), G13c2 done (a draw reads the leaves it needs by place: a tick on the CPU sends 3 words a drop, not 5); G13c3 done (a kept tick reads back its steps' sum, 12 bytes, not 80 KB); left G13d (measured; parked: needs a real GPU, Ersagun can time it) | C | [GPU-DATA](docs/design/targets/GPU-DATA.md), [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | |
| G14 | Culling: frustum on the CPU, then a compute pass writing indirect draw arguments, then occlusion against a hierarchical depth buffer. Example: examples/rain-page with a closer look. Design note [CULLING.md](docs/design/targets/CULLING.md): G14a done (a Closer button; 480 ms a frame at 1×, 250 ms at 4× on SwiftShader), G14b1 done (GPU cull pass, indirect draw: 4× frame 250 -> 37 ms on SwiftShader), G14b2 done (the decisions entry, `draw culling: GPU; among none, GPU`), G14c closed (CPU culling doesn't pay: rain's drops stay on the GPU, and a test costs more than the packing it saves), G14d (occlusion, waits for a page with depth) | C | [CULLING](docs/design/targets/CULLING.md), [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | |
| G15 | Lights: forward with a few, then clustered (many dynamic lights), then shadow maps. Credit Olsson's clustered shading. Design note [LIGHTS.md](docs/design/targets/LIGHTS.md): G15a1 done (a draw captures an Array of a size known only at run time: a storage buffer, one module for any length), G15a2 done (a captured List as one, folds over it as loops: rain-page's three lamps), G15b1 done (`within reach` in std, folds over it fused, fireflies forward: 1.25 s a frame on SwiftShader against 0.42 without), G15b2 done (the grid, in the places' space, built by two compute passes: 0.44 s a frame against 1.25 forward), G15b2b done (the grid's `way` entry in the decisions, held to every item), G15c shadows wait for a page with depth | C | [LIGHTS](docs/design/targets/LIGHTS.md), [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | |
| G16 | Bake to a file: a pure definition run at build time whose answer (Float32 arrays, textures) is written as a data file and loaded at start, stale when what it reads changes; bake.ts stays for small answers. Design note [BAKING.md](docs/design/targets/BAKING.md): a way the compiler chooses (decisions entry, `baked to a file` or `at start`), run compiled (C threads where there is a C compiler, else Node), kept in a bake store by a key of what it reads, loaded by a decoder the bake writes in Ters (`baked bytes`, `float32 at`: the compiler compiles it into whatever representation it chose), behind a header (a mismatch computes at start). Steps G16a done (measured: `start pane` ~48 ms of a JS run; `baked float32 at`, `baked int32 at` in the prelude, exact), G16b1 done (`baked float64 at`, `baked bytes`), G16b2 done (compiled JavaScript reads `baked/<key>.bin`), G16b3a done (power tables made once: decoding 20,000 drops 934 -> 30 ms), G16b3b done (compiled JavaScript reads the words with a DataView: 31.8 -> 9.6 ms), G16b3c (the bake step for pages), G16c (native, wasm), G16d (decisions entry and weighing), G16e (lists, records of arrays, Bytes) | C | [BAKING](docs/design/targets/BAKING.md), [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | |
| G17 | Baked lightmaps traced on the CPU threads, and baked ambient occlusion, through G16 | L | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | |
| G18 | Baked irradiance probes (spherical harmonics, credit Sloan) and signed distance fields of the static scene, through G16 | L | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | |
| G19 | Rigid bodies: broad phase (grid, then sweep and prune or a BVH), narrow phase, a sequential-impulse solver (credit Catto); conservative advancement from impact for fast bodies | L | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | |
| G20 | Stage 5 round: physics at scale (thousands of bodies) against hand-written C | L | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | M | ⏸ |
| G21 | Scene view in the editor: the game's frame drawn beside the graph, click to pick an entity | E | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G22 | Entity list and inspector: a picked entity's components and fields, edited with number scrubbing | E | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G23 | Game data as tables: records lists (levels, spawn tables, tuning) edited as data, kept in files the program reads | E | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | M | ⏸ |
| G24 | Hot reload: an edit recompiles under the running game and keeps its state (the state is a cell, the code under it changes); needs the compiler redesign's fast compile | E | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |

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
