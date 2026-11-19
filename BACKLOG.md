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
| E Editor | "Editor lane" | no open row (E273 to E278 done, RUN-INPUTS-2026-11-17) |
| C Compiler and targets | "Compiler lane" | no open row of its own (scan's round 19 stopped after C243: core 2.9x, native 2.4x, wasi 2.3x the ideal; the next stages buy under 10%, GAPS round 19) |
| L Language and library | "Language lane" | L266 (Ersagun 2026-11-17) |
| L Language and library | "Language lane B" | L251, L253 (P3, from the 2026-11-13 docs refresh) |
| G Game | "Build a game to test Ters against engines" | stage 1: C267 (the cells' Ints, now the flock's largest gap), C265 (the greenhouse's reads), G1b with G3d (columns) ([GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md)) |
| L Language and library | "Build a tuner, metronome and looper app" | C260b, L271b, C271, C273, L279 |
| T Testing | "Make testing granular and cheap" | no open row (T16 done; TESTING.md §8 names the follow-ups to measure once the test map is full) |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
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
| C265 | Optional components cost a count on every read: the greenhouse's Thing holds three Optionals, so on C each `item at` of a moth dups the Thing and drops it again (Thing_dup 83 million and lab_drop 247 million calls in 600 ticks, against none for moths' all-Float64 Moth). An item read only to be read, borrowed, with no count taken | game round 2 (G6), 2026-11-17 | 2026-11-17 |
| C266 | The greenhouse is slower on 4 threads than on one natively (13.4 s against 10.8 s a night): its maps' answers hold cells (the Optionals), so what they share is counted atomically from every thread (G3c froze it only where answers hold none) | game round 2 (G6), 2026-11-17 | 2026-11-17 |
| C267 | Counts and positions stay big-capable Ints in a loop: the greenhouse's walk over a cell's moth numbers keeps its position, the array's length and each number as `lab_int` (dup, add and sub with overflow checks), 9% of the native night. A position that counts up to an array's length, and numbers read from a `List Int` only used as positions, as int64. Compiled JS, first cut (int-ranges.ts): Ints shown small by ranges across calls are `+ - * %` (the flock's cell keys; flock 2.8 → 2.4 s); C and positions read from a `List Int` still to do | game round 2 (G6b), 2026-11-17 | 2026-11-17 |
| C268 | `item at`'s answer when past the end is built on every read: the greenhouse makes its stand-in Thing (`nothing`) 32 million times a night that is never used. Build it only when the position is past the end | game round 2 (G6b), 2026-11-17 | 2026-11-17 |

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L266u | Make the List choice carry its types, as the Map and Set choice does (carried-reps.ts, #2899), so a first compile doesn't check the program again (about 0.2 s of machine's 2.3 s warm). The rewrite's old nodes keep their types, with List read as the array on the arrays' side; refs to builtins at the boundary, the conversions and the loops' new definitions are typed by unifying what they're given. On machine that rule types every old node the way the check does, except 55 of these. Set aside on 11-19 for stage 4, whose stable ids already let a recompile skip this check | compiler redesign, 2026-11-19 | low | M | open |

### Instrument app ([INSTRUMENT-APP-2026-11-17](docs/reports/INSTRUMENT-APP-2026-11-17.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C260b | The platform's sound latency in an app (AAudio's and AVAudioSession's figures behind `my sound latency`, which a page in a browser has, C260a), and an app's sound kept playing with the screen off | Ersagun 2026-11-17 | P2 | M |  |
| C262 | Bigger-program round on the instrument app: FFT, YIN and the looper's buffer compiled against hand-written JS and C; gaps to GAPS.md | Ersagun 2026-11-17 | P3 | M |  |
| C269 | A sound in stereo (L270) in a native app: c.ts plays only `listen`, and says a `listen in stereo` plays only in a browser for now | Ersagun 2026-11-17 | P3 | S |  |
| C273 | An item path made for every sample: `write at(tape, at item(q), v)` makes a path value (a function with its steps) and reads it apart again, as `at item` is a definition of the program the compiler doesn't inline; three a sample in the looper, its blocks' main allocation left after C270. Compile a read or edit at an item of a known path without the path (core-js.ts, as scalar.ts writes out `changed`'s path) | C270 | P3 | M |  |
| C271 | Lists read by position stay cons lists in compiled code: the strum tuner's analysis (L277) read its spectrum and templates with `item at` and took 0.79 s a window as the page compiles it; written to walk each list once instead (`at positions`) it takes 0.2 s. The representation chooser should make a list read by position an array (NO EXPLICIT SELECTION), so the first way of writing it is as fast | L277 | P3 | M |  |

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
| L279 | A function made in a let and called both inside a `part` and outside it takes on what `part` handles: in the frets page, `frets now = () => frets of(…)` called in `part(() => …)` and in the page's table gave main `-[Cells, Choice, Diverge, Network, Log, Settings, Time]`, and the page wouldn't build ("main can't be a page: unhandled effect: Choice"), though frets of has no effect; as definitions taking the cells it builds. A let-bound lambda's effects should be its own at each call (generalised, as a definition's are) | L278 | P2 | M |  |

### Ersagun's current asks

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Instrument app: tuner, metronome, looper ([INSTRUMENT-APP-2026-11-17](docs/reports/INSTRUMENT-APP-2026-11-17.md))

Ersagun 2026-11-17: "A universal instrument tuner, metronome, looper app. This I really want to develop." Ersagun said go 2026-11-17 19:00; the metronome first. L267, L268, L269, the metronome (L275) and the tuner with its signals and tunings modules (L272 to L274) stereo (L270) and minutes of audio in a cell (C261) are done (DONE.md). The looper (L276) and the strum tuner (L277) are done. Left: C260b, L271b, C271 and C273 beside them, and L279, found by the frets page (L278, done). The compiled FFT is about 50 times hand-written JS (a 2048-sample autocorrelation takes 14 ms); C262 measures it.

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
| G3d | moths M4: compiled JS is 10x the hand-written JS because each moth is 3 objects and 4 boxed numbers spread over the heap, not because of `met`'s code (25 ns a call alone, 85 ns in place; GAPS game round 1, G3d measured). Columns (columns.ts) for records holding records, a column per leaf field, and an item given whole to a function passed as its fields; build with G1b. Step 1 done for compiled JS (`whole`: a column per leaf, an item leaving whole made from its columns; flock 6.4 → 4.3 s, moths 10.5 → 4.9 s, the flock page from about 1 tick a second to 30). Step 2 done: a record chosen between and read by its parts is chosen part by part (chosen-parts.ts), so the flock's neighbour loop makes no bird: flock 4.3 → 3.4 s, moths 1.7 → 1.1 s (200 ticks of 3,000). Left: the same on C and WebAssembly | C | [GAPS game round 1](docs/reports/GAPS.md) | P2 | L | |
| G3e | moths M5: profile `ters wasi` on moths (14.6x) and split what isn't M1, M2 or M4 into rows | C | [GAPS game round 1](docs/reports/GAPS.md) | P2 | S | |
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
