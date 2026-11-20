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
| E Editor | "Editor lane" | E279a, E279b, E279c (live edits while a page runs, Ersagun 2026-11-20) |
| C Compiler and targets | "Compiler lane" | no open row of its own (scan's round 19 stopped after C243: core 2.9x, native 2.4x, wasi 2.3x the ideal; the next stages buy under 10%, GAPS round 19) |
| L Language and library | "Language lane" | L266 (Ersagun 2026-11-17) |
| L Language and library | "Language lane B" | L251, L253 (P3, from the 2026-11-13 docs refresh) |
| G Game | "Build a game to test Ters against engines" | stage 1: C267 (the cells' Ints, now the flock's largest gap), C265 (the greenhouse's reads), G1b with G3d (columns) ([GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md)) |
| L Language and library | "Build a tuner, metronome and looper app" | L271b |
| T Testing | "Make testing granular and cheap" | no open row (T16 done; TESTING.md §8 names the follow-ups to measure once the test map is full) |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I330 | An edited program in the editor isn't on the library's layer (each edit is derived from the last, checked over the last check: infer.ts inferEdited), so arith.ts seedFor finds no library resolving for it and resolves the whole library again, every library body typed (3.4 s the first time on choiceAction's page). Read it as on the layer, through the chain of checks to the library's (OverMap down to it), so the kept resolving serves it | I327, 2026-11-20 | 2026-11-20 |
| I331 | Compiled each and each of over data holding a Bool: their rows are handed the evaluator's items (views); turn them lazily (a view whose Bools read as booleans, the same object each time so each of finds its list) rather than copying, so the outline compiles again (outline-views.test) | I328, 2026-11-20 | 2026-11-20 |
| I320 | calc's first Run main right after opening takes 5.9 to 6.6 s (evaluator); after a 10 s wait it takes 0.4 s. sheet's first Run takes 4.8 s, the others about 2 s. Run should wait less on the warm-up, or say it's warming up | QA 11-18 L1 | 2026-11-18 |
| L266 | A faster checker: machine's 8,000 reached nodes took 1.5 s, about 190 µs a node; aim for 10x. L266a: 0.2 s warm. Next: compiling machine still checks it six times (firstArms three, bake, stage, fused folds: about 0.2 s each), L266b keeps the higher-order call analysis's answers between checks. L266c resolves arithmetic over what is reached, L266d reaches once. Left, in `ters compile machine` (8.8 s): the first check 1.1 s (warm it is 0.15 s; L266e found the once-per-process part, 0.45 s, not worth a snapshot); choosing representations 4.8 s, of it two whole checks of the program over the library (represented.ts and library-reps.ts, 0.7 and 0.8 s) and the choice's walks (choiceOf 2.4 s: splitByGroups, represent.ts uses and looped walking each definition's subtree again per type); lowering 3.5 s, of it first-arms' checks 0.6 s. With I316, machine's compile under half a second. C256 found the checks inside lowering are the checker's cost too: rechecking only what a pass changed (infer.ts inferRewritten) saved 0.2 s of machine's 3.1 but kept effects the passes had made more exact (drift, depot, sheet got Diverge back), so a faster whole check is the fix; and a layered check joined a first's thunk's row to the row around it (agent's first-arms took 5 of 7) | Ersagun 2026-11-17 ("Having to spend more than a second compiling them is kinda weird") | 2026-11-17 |
| I317 | The MCP server ran out of its 2 GB heap writing the greenhouse page (98 definitions, at the 85th) and needed 6 GB; its heap grows with every definition. Find what it keeps | game round 2 (G6), 2026-11-17 | 2026-11-17 |
| I318 | Text the MCP reads: `x = …; match y` with the match's arms on the lines after isn't read ("no operator starts it"), nor a match after `else` on one line; both need a step (□) or a function of their own | game round 2 (G6), 2026-11-17 | 2026-11-17 |

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

### Live edits while a page runs ([doc](https://claude.ai/artifact/KLcZxJq2zWYssNynnXbUVA))

Ersagun 2026-11-20 19:38 UTC: a change to a number while a page runs keeps the page going with the new value; only the editor's preview does this, never compiled or saved pages. Constants are not cells (measured 2.9x to 20x on flock and greenhouse).

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E279a | An edit to a page's program keeps the page's state: the new version starts and takes over every cell the old run changed (cells.ts handOver, today interpreted to compiled only), matched by the node that made each cell rather than by the order cells were made. A cell whose first value or type changed starts again; when nothing can carry, the page restarts and the status line says so. Prior art: Smalltalk, Erlang hot code loading, Flutter hot reload (credit on screen and in CREDITS.md). Example: flock and greenhouse pages keep their birds and moths across an edit of a speed | Ersagun 2026-11-20 | P1 | M | |
| E279b | A number scrubbed while its page runs takes effect at the next frame with no recompile: the preview's compiled page holds each of the program's literals as a variable the editor sets (about 1.15-1.2x measured), and a page that doesn't tick redraws its views once per change. Save page and Open in a tab keep plain literals. At release, E279a's hand-over runs once. Influence: Bret Victor's Inventing on Principle, Unity's inspector | Ersagun 2026-11-20 | P1 | M | |
| E279c | E279b for shaders: a literal in shader code is passed as a uniform while the preview runs, so a scrub changes the picture without recompiling the shader | Ersagun 2026-11-20 | P2 | S | |

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
| C259 | pond-page's reads of its cells kept whole: tracking where each read's value goes (cell-paths.ts trackReads) works pond's calls out inside one another 649 deep, which overflowed the stack (`ters compile examples/pond-page` failed on main); it now gives up past 300 (L266g), so its reads take the whole value. Work them out without nesting (a worklist, or each function's answer by its inputs' shapes) so pond's reads are rewritten too | L266g sweep, 2026-11-17 | 2026-11-17 |
| C263 | branches.test "a search whose first choice has one item with answers shares out its second choice's items (C43g)" fails on main in a 4-core container, twice in a row: compiled JS with `TERS_WORKERS=3` says `branches on workers: 0`, so the second choice's items weren't shared out (the answers are right). Find why the search no longer reaches the workers | game thread, 2026-11-17 | 2026-11-17 |
| C264 | A compiled page refuses a cell (and other host builtins) on data holding a Bool (scalar.ts `host`, boolInside: the evaluator's Bool inside data is a case, compiled code's a boolean). The greenhouse's gardener first held `carrying: Bool`; it now carries an `Optional Lamp`. Convert at the host boundary, or give compiled data the evaluator's Bool | game round 2 (G6), 2026-11-17 | 2026-11-17 |
| C265 | Optional components cost a count on every read: the greenhouse's Thing holds three Optionals, so on C each `item at` of a moth dups the Thing and drops it again (Thing_dup 83 million and lab_drop 247 million calls in 600 ticks, against none for moths' all-Float64 Moth). An item read only to be read, borrowed, with no count taken. First half done: a record a loop passes on as it is each round is lent (c.ts), the greenhouse's `gathered from` no longer dups and drops its moth per neighbour (native one thread, 600 ticks of 2,000 moths, 2.6 to 1.85 s; C 0.46 s). Second half done with C268: `item at` put in place (item-reads.ts), the item read lent where only read (c.ts `peeked`), 1.85 to about 1.4 s, instructions 5.0 to 2.8 billion for 150 ticks | game round 2 (G6), 2026-11-17 | 2026-11-17 |
| C266 | The greenhouse is slower on 4 threads than on one natively (13.4 s against 10.8 s a night): its maps' answers hold cells (the Optionals), so what they share is counted atomically from every thread (G3c froze it only where answers hold none). Done 11-20: the pool's update, a map calling the function its caller gives, runs on C's threads when every caller gives a pure one (pure-branches.ts givenEffects), and a map whose answers hold cells is frozen too, the counts its answers keep of what it shares taken after (c.ts lab__hold). A night of 2,000 moths natively: 4 threads 9 s before freezing, 5.2 s now, one thread 5.8 s (C 2.0 s, OpenMP 0.7 s). Left: marking what it shares (lab_share) each map, about 9% of the work, and the serial work around it | game round 2 (G6), 2026-11-17 | 2026-11-17 |
| C267 | Counts and positions stay big-capable Ints in a loop: the greenhouse's walk over a cell's moth numbers keeps its position, the array's length and each number as `lab_int` (dup, add and sub with overflow checks), 9% of the native night. A position that counts up to an array's length, and numbers read from a `List Int` only used as positions, as int64. Native: a count stepped where it is given to the next round (`from + 1`, no let) is untagged too (untagged-ints.ts), the greenhouse's walk over a cell's moths counts with int64 (one thread, 600 ticks of 2,000 moths, about 1.4 to 1.28 s). Compiled JS, first cut (int-ranges.ts): Ints shown small by ranges across calls are `+ - * %` (the flock's cell keys; flock 2.8 → 2.4 s); C and positions read from a `List Int` still to do | game round 2 (G6b), 2026-11-17 | 2026-11-17 |
| C268 | `item at`'s answer when past the end is built on every read: the greenhouse makes its stand-in Thing (`nothing`) 32 million times a night that is never used. Build it only when the position is past the end. Done with C265's second half (item-reads.ts). In JavaScript too: `item at` read at a part checked in place, with no try and no item made, the stand-in worked out only past the end (chosen-parts.ts), greenhouse compiled JS 600 ticks of 2,000 moths about 6.0 to 5.0 s (hand-written JS 0.8 s) | game round 2 (G6b), 2026-11-17 | 2026-11-17 |

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L266af | Incremental compile after edits, parts 2 to 5 (plan doc https://claude.ai/artifact/WaH3BBwr84Rai5dm6mddVn): definition keys kept by node objects; lowering per function kept (a stop's number is counted over the whole program today, so a kept function's stops need numbering of their own); the whole-program analyses (ownership, zero parts, arithmetic, first arms, reach) as per-definition summaries kept by key; the choice made from kept summaries with a per-definition rewrite. Each part checked by compiler/test/edits.test.ts and the 78-program sweep. Goal: machine's recompile after a one-definition edit under 0.3 s (1.48 s at part 1) | Ersagun 2026-11-20 (card: incremental compile after edits) | 2026-11-20 | high | L | open |
| L266u | Make the List choice carry its types, as the Map and Set choice does (carried-reps.ts, #2899), so a first compile doesn't check the program again (about 0.2 s of machine's 2.3 s warm). The rewrite's old nodes keep their types, with List read as the array on the arrays' side; refs to builtins at the boundary, the conversions and the loops' new definitions are typed by unifying what they're given. On machine that rule types every old node the way the check does, except 55 of these. Set aside on 11-19 for stage 4, whose stable ids already let a recompile skip this check | compiler redesign, 2026-11-19 | low | M | open |

### Instrument app ([INSTRUMENT-APP-2026-11-17](docs/reports/INSTRUMENT-APP-2026-11-17.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C262 | Bigger-program round on the instrument app: FFT, YIN and the looper's buffer compiled against hand-written JS and C; gaps to GAPS.md | Ersagun 2026-11-17 | P3 | M |  |

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
| L280a | Write the compiler's picks to `<program>.schedule` beside the program: representations, ways, mode plans, places, one entry per line sorted by stable id, each with the facts it read; a stale entry is picked again (cache rule). `ters check` and the editor's Program tab read it ([SCHEDULE-2026-11-20](docs/design/data/SCHEDULE-2026-11-20.md)) | Ersagun 2026-11-20 | P2 | L | |
| L280b | Per-definition summaries (jobs used per type, calls in a loop) kept in `.lab/` by content hash; a pick whose facts come out the same is reused without the chooser (early cutoff). Measured 2026-11-20 (machine, warm ~0.42 s a choice, CPU profile over 13 runs, no check cache): deciding (choose, uses, looped, listBoundary, inPlace, keyed, generic, listGroups, listFree) about 30%, rewriting (represent, splitLists, stable ids) about 23%, checking the rewrite (infer, carriedChoice) about 36%, the passes before it (fuse walks, fold items, holders, reach) about 8%. A saved pick alone skips the 30%; the rest needs the rewritten definitions and their checks kept by hash too | Ersagun 2026-11-20 | P2 | M | |
| L280c | Held entries: a person holds or changes an entry; the compiler refuses one that isn't an implementation of the same meaning and warns when it would now pick another. Editor gesture in the Program tab | Ersagun 2026-11-20 | P2 | M | |
| L280d | Measured sizes and call counts from runs written into the schedule and read by the chooser in place of the cost ladder's n | Ersagun 2026-11-20 | P3 | M | |
| L280e | Parameters on a representation (a grid's cell size, a chunk size, a worker count), chosen by the compiler and kept in the schedule | Ersagun 2026-11-20 | P3 | M | |
| L280f | Pool as a representation of a collection, so a program writes List or Map and the schedule says pooled (moves the Pool type out of the code) | Ersagun 2026-11-20 | P3 | L | |
| L280g | Spatial partitioning as representations of the "pairs nearer than r" job: all pairs as its meaning, grid and tree as implementations, cell size as a parameter. Needs a program that uses it (flock or Night watch) | Ersagun 2026-11-20 | P3 | L | |
| L280h | Where work runs (C61's GPU, workers or main thread) kept and tunable in the schedule, per loop | Ersagun 2026-11-20 | P3 | M | |
| L280i | A published library carries its own types' and ways' schedule, keyed by content hash (when sharing needs it) | Ersagun 2026-11-20 | P3 | M | |

### Instrument app: tuner, metronome, looper ([INSTRUMENT-APP-2026-11-17](docs/reports/INSTRUMENT-APP-2026-11-17.md))

Ersagun 2026-11-17: "A universal instrument tuner, metronome, looper app. This I really want to develop." Ersagun said go 2026-11-17 19:00; the metronome first. L267, L268, L269, the metronome (L275) and the tuner with its signals and tunings modules (L272 to L274) stereo (L270) and minutes of audio in a cell (C261) are done (DONE.md). The looper (L276) and the strum tuner (L277) are done. Left: L271b beside them; the frets page (L278), L279, C271, C273, C260b and C269 are done. The compiled FFT is about 50 times hand-written JS (a 2048-sample autocorrelation takes 14 ms); C262 measures it.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L271b | Keeping a recording, the rest: WAV written and read in the language (a sound-files module: 16-bit and float PCM, mono and stereo) from a tape without making it a list of every byte, so a few minutes save in a second; the files ops are L271a (DONE). Measured 11-17: `bytes of(map(range(n), f))` compiled takes 3.9 s and 2.7 GB for 10 MB (lists as arrays: 2.0 s, 3.3 GB), and a minute of stereo at 16 bits is 11.5 MB, so it needs Bytes made item by item (by position) that compiles to a buffer, or that pipeline fused; in an app, offer file as the share sheet and ask for file as the system's picker (c.ts) | Ersagun 2026-11-17 | P3 | M |  |

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

Ersagun 2026-11-17: a medium-sized original game to test Ters against current engines and languages. Ersagun said go for stage 1 on 2026-11-17 19:00 UTC; stages 2 to 6 stay held until stage 1's round is reported. The lane column is a suggestion; each stage ends in a bigger-program round.

| id | item | lane | source | pri | size | status |
|---|---|---|---|---|---|---|
| G1b | Columns with presence: an `Optional` field of a record kept as columns stored as a bit per slot and a column of values, read in place by a match on it (columns.ts, C and JS first) | C | [ENTITIES](docs/design/data/ENTITIES.md) | P2 | L | |
| G1b1 | `keep` over a List kept as an array lowers as every `all` of a `choose`: the array's items as a list taken apart, answers consed in a box, reversed, an array made of them. The greenhouse's three keeps a tick (moths, plants, lamps) are the first thing keeping its Things as rows in JS (columns.ts: `array.of`). A loop over the positions pushing each kept item (kept-items.ts), on JS, C and WebAssembly. Done | C | G1b, 2026-11-20 | P2 | S | |
| G1b2 | After G1b1 the greenhouse's Things stay rows for the arrays built by pushes: `keep`'s loop (`array.push` from `array.empty`) and `pool items` (`array.pushFront` onto a fresh array, slot by slot). Columns that grow, written where the loop pushes (columns.ts, JS first). Measured: `gathered from` is half the greenhouse's compiled JS, its time on the moth's row and its place's Vec read per neighbour, and on the array view's version check. Done in JS: a loop pushing onto an array it was given new and empty grows it as columns (columns.ts `grow`, `array.cbuild`/`array.cpush`), and a loop putting what it keeps in front goes down the positions pushing instead (kept-items.ts `pushedInOrder`, `pool items`); the greenhouse's Things are columns, compiled JS 600 ticks of 2,000 moths 4.5 to 3.6 s. C and WebAssembly not yet | C | G1b, 2026-11-20 | P2 | M | |
| G1b3 | Then the Thing's `Optional` fields as a presence column and the payload's leaves as columns (`velocity: Optional Vec`, two Float64Arrays and a bit), a match on the field read in place (columns.ts, JS first, then C). Tried 11-20 (patch kept in the project's files, patches/g1b3-optional-columns-wip.patch): the leaves written and read right, every greenhouse line the same, and a match on a case chosen between pushed into each choice (chosen-parts.ts, case of a known case), so `gathered from` makes no Optional per neighbour (its share 45% to 34%). But the night got slower, 3.9 to 4.6 s: `pool items` now takes each Thing's three Optionals apart, a match per leaf, for every Thing every tick, reading the pool's slots, which are rows made afresh by each `updated in pool`. Pays only with G1b4 | C | G1b, 2026-11-20 | P2 | M | |
| G1b4 | The pool's own slots as columns with presence: `Pool Thing`'s items, an array of `Optional Thing`, a bit per slot and the Thing's leaves (with G1b3's for its Optional fields), so `updated in pool` writes columns, `pool items` copies columns into columns, and no Thing is a row anywhere in a tick (columns.ts: an array of a case of one record, JS first). Tried 11-20 with G1b3 (patch patches/g1b4-slot-columns-wip.patch): every greenhouse line the same, and two fixes on the way (an Optional written to columns named once, not remade per leaf, which had made it 5x slower; a choice whose every match went in, dropped). The night came out even, 4.09 s against 4.05 s (median of 5): `gathered from` and the GC gain, but `map` over the slots hands each Thing to its function as a whole record, made from the columns and taken apart again (72 to 262 ms). Pays only with that function put in place in the map's loop; not merged | C | G1b3, 2026-11-20 | P2 | L | |
| G3d | moths M4: compiled JS is 10x the hand-written JS because each moth is 3 objects and 4 boxed numbers spread over the heap, not because of `met`'s code (25 ns a call alone, 85 ns in place; GAPS game round 1, G3d measured). Columns (columns.ts) for records holding records, a column per leaf field, and an item given whole to a function passed as its fields; build with G1b. Step 1 done for compiled JS (`whole`: a column per leaf, an item leaving whole made from its columns; flock 6.4 → 4.3 s, moths 10.5 → 4.9 s, the flock page from about 1 tick a second to 30). Step 2 done: a record chosen between and read by its parts is chosen part by part (chosen-parts.ts), so the flock's neighbour loop makes no bird: flock 4.3 → 3.4 s, moths 1.7 → 1.1 s (200 ticks of 3,000). Left: the same on C and WebAssembly | C | [GAPS game round 1](docs/reports/GAPS.md) | P2 | L | |
| G3e | moths M5: profile `ters wasi` on moths (14.6x) and split what isn't M1, M2 or M4 into rows. Done 11-20: profiled with function names (TERS_WASM_NAMES, wasm.ts's name section): split into G3f and G3g, the rest is `met` and its loops (M4, G3d) | C | [GAPS game round 1](docs/reports/GAPS.md) | P2 | S | |
| G3f | moths on WebAssembly: filing the moths by cell copies the cells array once for every moth (`replace at`, 24% of a profile, and most of the 16% in the GC). WebAssembly has no counts, so only one-holder.ts can make it in place, and the one value `empty grid`, named every tick, isn't one holder's. Fix: a constant used as a fresh value is made fresh where it is cheap, or one-holder reads a definition's value as a new one each time it is named. Done 11-20: the second. A definition giving an array of a type written in place is worked out each time it is named, in JavaScript and WebAssembly, unless it gives an empty one (one-holder.ts `fresh`). Arrays of arrays count as items (owned-arrays.ts). A pure call giving an array is no longer shared (share-calls.ts), so two namings stay two arrays. The moths' cells are filed in place on WebAssembly: moths 10.6 to 7.7 s, greenhouse 6.6 to 3.9 s, flock 6.6 to 4.7 s. JavaScript is unchanged and every program prints the same | C | [GAPS game round 1](docs/reports/GAPS.md) | P2 | M | 2026-11-20 |
| G3g | moths on WebAssembly: small runtime functions (an array's item and length, `int.less`, `int.small`) are calls Node's V8 doesn't inline (about 10% together). Put them in place as compiled JavaScript does (core-js inline array reads, #2913). Done 11-20: a runtime function that is a straight run of instructions (no branch, no local of its own), called with locals, is put in place with the caller's locals for its parameters (wasm-rt.ts `inlined`, its bytes and its text; NO_INLINE_RT turns it off). flock 4.65 to 4.5 s, greenhouse 3.86 to 3.75 s, moths within noise. The moths' items are Ints kept as bytes, so their read is `array.slot`, which branches on the bytes and stays a call: putting it in place needs the caller to get a scratch local, which buys at most the few percent left. Every program prints the same | C | [GAPS game round 1](docs/reports/GAPS.md) | P2 | S | 2026-11-20 |
| G4 | The archetype representation from G1, built: a Pool whose records leave components out stored as tables per set of components | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G5 | Systems with disjoint effect rows run on the thread pool and page workers at once (G1's scheduling) | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G7 | Drawing with data, a design note: a frame as a value (meshes, instances, materials, cameras, passes), the GPU as a world, what changes between frames uploaded rather than rebuilt (WEB.md's model for pages, for frames) | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | M | ⏸ |
| G8 | Columns into GPU buffers: a program's Float64 columns uploaded as Float32 storage buffers, only the columns a shader reads, only when they change | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G9 | Vertex functions and instanced draws: a Ters function of (instance, vertex) to a position and its varyings, printed as a WGSL vertex stage beside today's fragment | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G10 | Depth, render targets and several passes in a frame; post effects as passes reading the last one's texture | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G11 | Textures and meshes loaded as data (images, a simple mesh format), from files a page or native build carries | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | M | ⏸ |
| G12 | Float32 compute kernels over columns (today's GPU maps are Int to Int or Bool only), records of Float64s as vec2f to vec4f as in pictures | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G13 | Data that stays on the GPU: a column only kernels and draws touch lives in a GPU buffer across frames, never read back (C61's choice by cost, carried to data); GPU particles as its example | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G14 | Culling: frustum on the CPU, then a compute pass writing indirect draw arguments, then occlusion against a hierarchical depth buffer | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G15 | Lights: forward with a few, then clustered (many dynamic lights), then shadow maps. Credit Olsson's clustered shading | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G16 | Bake to a file: a pure definition run at build time whose answer (Float32 arrays, textures) is written as a data file and loaded at start, stale when what it reads changes; bake.ts stays for small answers | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G17 | Baked lightmaps traced on the CPU threads, and baked ambient occlusion, through G16 | L | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G18 | Baked irradiance probes (spherical harmonics, credit Sloan) and signed distance fields of the static scene, through G16 | L | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G19 | Rigid bodies: broad phase (grid, then sweep and prune or a BVH), narrow phase, a sequential-impulse solver (credit Catto); conservative advancement from impact for fast bodies | L | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
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
