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
| E Editor | "Editor lane" | no open row (startup: E280 to E284 done, E283 closed measured, 2026-11-21) |
| C Compiler and targets | "Compiler lane" | C267 (the game loops) |
| L Language and library | "Language lane" | L266 (Ersagun 2026-11-17) |
| L Language and library | "Language lane B" | L251, L253 (P3, from the 2026-11-13 docs refresh) |
| G Game | "Build a game to test Ters against engines" | stage 1: C267 (the cells' Ints, now the flock's largest gap), C265 (the greenhouse's reads) (G1b with G3d, columns: done in JS, closed for C and WebAssembly 2026-11-22) ([GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md)) |
| L Language and library | "Build a tuner, metronome and looper app" | L271c |
| T Testing | "Make testing granular and cheap" | no open row (T16 done; TESTING.md §8 names the follow-ups to measure once the test map is full) |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I320 | calc's first Run main right after opening takes 5.9 to 6.6 s (evaluator); after a 10 s wait it takes 0.4 s. sheet's first Run takes 4.8 s, the others about 2 s. Run should wait less on the warm-up, or say it's warming up. 11-22, after L281g and I330 (#2990, #2997): the Run worker's resolving for calc goes on from the library's (3.5 → 0.37 s); calc's first Run right after opening is about 2.4 s (headless). 11-22 (#3024): Run's worker checks each program as it is opened, not only the first: calc's Run 1.5 s after opening 1.0 → 0.3 s (calc's main runs a function backwards, so it has no prebuilt main and is checked in the worker). 11-22 (#3045): Run's worker starts with the page, not with the first program's check (its start and the kept checks took 0.8 s): calc's Run 1 s after opening 1.6 → 0.4 s (1.0 s on a first visit). Left: a Run in the first half second waits about 1 s, on calc's own check (0.5 to 0.8 s in the worker) | QA 11-18 L1 | 2026-11-18 |
| L266 | A faster checker: machine's 8,000 reached nodes took 1.5 s, about 190 µs a node; aim for 10x. L266a: 0.2 s warm. Next: compiling machine still checks it six times (firstArms three, bake, stage, fused folds: about 0.2 s each), L266b keeps the higher-order call analysis's answers between checks. L266c resolves arithmetic over what is reached, L266d reaches once. Left, in `ters compile machine` (8.8 s): the first check 1.1 s (warm it is 0.15 s; L266e found the once-per-process part, 0.45 s, not worth a snapshot); choosing representations 4.8 s, of it two whole checks of the program over the library (represented.ts and library-reps.ts, 0.7 and 0.8 s) and the choice's walks (choiceOf 2.4 s: splitByGroups, represent.ts uses and looped walking each definition's subtree again per type); lowering 3.5 s, of it first-arms' checks 0.6 s. With I316, machine's compile under half a second. C256 found the checks inside lowering are the checker's cost too: rechecking only what a pass changed (infer.ts inferRewritten) saved 0.2 s of machine's 3.1 but kept effects the passes had made more exact (drift, depot, sheet got Diverge back), so a faster whole check is the fix; and a layered check joined a first's thunk's row to the row around it (agent's first-arms took 5 of 7) | Ersagun 2026-11-17 ("Having to spend more than a second compiling them is kinda weird") | 2026-11-17 |

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
| E309 | Schedule rows by the walks in the program's own definitions, with their written names, one row a walk, not one per compiler-made definition and list maker (QA-2026-11-22c L1; the text comes from cli/choices.ts scheduleLines) | QA 11-22c | P3 | S | |
| E310 | The side panel's seven tabs fit one line at 1400 px; on a phone a Choices row's count stays beside its name (QA-2026-11-22c L2, L4) | QA 11-22c | P3 | S | |
| E311 | A mode plan's pick names its goals by the definitions they call, not their drawn text (`relational, goals a function(…)`; QA-2026-11-22c L3) | QA 11-22c | P3 | S | |

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
| C265 | Optional components cost a count on every read: the greenhouse's Thing holds three Optionals, so on C each `item at` of a moth dups the Thing and drops it again (Thing_dup 83 million and lab_drop 247 million calls in 600 ticks, against none for moths' all-Float64 Moth). An item read only to be read, borrowed, with no count taken. First half done: a record a loop passes on as it is each round is lent (c.ts), the greenhouse's `gathered from` no longer dups and drops its moth per neighbour (native one thread, 600 ticks of 2,000 moths, 2.6 to 1.85 s; C 0.46 s). Second half done with C268: `item at` put in place (item-reads.ts), the item read lent where only read (c.ts `peeked`), 1.85 to about 1.4 s, instructions 5.0 to 2.8 billion for 150 ticks | game round 2 (G6), 2026-11-17 | 2026-11-17 |

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
| L280a | Write the compiler's picks to `<program>.choices` beside the program: representations, ways, mode plans, places, schedules, one entry per line sorted by stable id, each with the facts it read; a stale entry is picked again (cache rule). `ters check` and the editor's Program tab read it ([CHOICES-2026-11-20](docs/design/data/CHOICES-2026-11-20.md)). Representations (part 1), ways (part 2), mode plans (part 3), a page's placements (part 4), a command-line program's worker threads (part 5), C's threads (part 6) and schedules' fused walks (part 7) and search order (part 8) written and checked; fold chunks are C's `fold counting into a map` placements (part 6); the Program tab left | Ersagun 2026-11-20 | P2 | L | |
| L280b | Per-definition summaries (jobs used per type, calls in a loop) kept in `.lab/` by content hash; a pick whose facts come out the same is reused without the chooser (early cutoff). Measured 2026-11-20 (machine, warm ~0.42 s a choice, CPU profile over 13 runs, no check cache): deciding (choose, uses, looped, listBoundary, inPlace, keyed, generic, listGroups, listFree) about 30%, rewriting (represent, splitLists, stable ids) about 23%, checking the rewrite (infer, carriedChoice) about 36%, the passes before it (fuse walks, fold items, holders, reach) about 8%. A saved pick alone skips the 30%; the rest needs the rewritten definitions and their checks kept by hash too. Part 1 done: the chooser's decisions kept on disk by the program's key (`.lab/decided`), taken by the next command (machine 4.5 -> 4.1 s, greenhouse-page 6.0 -> 5.2 s cold); left: per-definition summaries so an edit elsewhere keeps the decision. Measured 2026-11-22 (machine, cold, 0.84 s in choiceOf): splitByGroups 0.24 s, generic 0.20 s, uses 0.17 s, choose 0.08 s, looped 0.06 s; generic and uses read every definition's calls and their callees' schemes, so a summary per definition has to be keyed by its callees' too. A literal edit (the editor's drag, the 0.5 s goal) already skips the chooser | Ersagun 2026-11-20 | P2 | M | |
| L280c | Held entries: a person holds or changes an entry; the compiler refuses one that isn't an implementation of the same meaning and warns when it would now pick another. Editor gesture in E292's Choices tab. Part 1 done (whole-type entries held in the file, `ters check` warns), part 2 (a list's split held), part 3 (a whole program's lists held as arrays or trees); the editor gesture done in E292 (#3053, #3054). | Ersagun 2026-11-20 | P2 | M | |
| L280d | Measured sizes and call counts from runs written into the choices and read by the chooser in place of the cost ladder's n | Ersagun 2026-11-20 | P3 | M | |
| L280e | Parameters on a representation (a grid's cell size, a chunk size, a worker count), chosen by the compiler and kept in the choices | Ersagun 2026-11-20 | P3 | M | |
| L280f | Pool as a representation of a collection, so a program writes List or Map and the choices say pooled (moves the Pool type out of the code) | Ersagun 2026-11-20 | P3 | L | |
| L280g | Spatial partitioning as representations of the "pairs nearer than r" job: all pairs as its meaning, grid and tree as implementations, cell size as a parameter. Needs a program that uses it (flock or Night watch) | Ersagun 2026-11-20 | P3 | L | |
| L280h | Where work runs (C61's GPU, workers or main thread) kept and tunable in the choices, per loop | Ersagun 2026-11-20 | P3 | M | |
| L280i | A published library carries its own types' and ways' choices, keyed by content hash (when sharing needs it) | Ersagun 2026-11-20 | P3 | M | |

### Instrument app: tuner, metronome, looper ([INSTRUMENT-APP-2026-11-17](docs/reports/INSTRUMENT-APP-2026-11-17.md))

Ersagun 2026-11-17: "A universal instrument tuner, metronome, looper app. This I really want to develop." Ersagun said go 2026-11-17 19:00; the metronome first. L267, L268, L269, the metronome (L275) and the tuner with its signals and tunings modules (L272 to L274) stereo (L270) and minutes of audio in a cell (C261) are done (DONE.md). The looper (L276) and the strum tuner (L277) are done. Left: L271c beside them (L271b, WAV in the language, is done); the frets page (L278), L279, C271, C273, C260b and C269 are done. The compiled FFT is about 50 times hand-written JS (a 2048-sample autocorrelation takes 14 ms); C262 measures it.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L271c | Keeping a recording, minutes of it: the sounds module (L271b, DONE) writes and reads WAV in the language, but slowly. Measured 11-21 compiled to JS: a minute of stereo at 16 bits written in 15.6 s with the tone made (11.5 MB), ten seconds written at 16 and 32 bits and read back in 7.0 s, a minute read back out of memory at 8 GB; garbage collection is 40 to 47% of it, then range, lists made into arrays and worker messages. Wanted: a few minutes saved in a second. Needs `array of(map(range(n), f))` and `bytes of(append(header, map(range(n), f)))` fused into filling a buffer by position, and the read's `map(range(frames), …)` into a Float64Array; in an app, offer file as the share sheet and ask for file as the system's picker (c.ts) | Ersagun 2026-11-17 | P3 | M |  |

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
