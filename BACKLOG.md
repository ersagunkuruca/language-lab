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
| E Editor | "Editor lane" | E319j, E319k (editor thread, Ersagun 2026-11-23) |
| C Compiler and targets | "Compiler lane" | G10 with the Editor lane (its texture contract first) |
| L Language and library | "Language lane" | L266 (Ersagun 2026-11-17) |
| L Language and library | "Language lane B" | L251, L253 (P3, from the 2026-11-13 docs refresh) |
| L Language and library | "Speed up the interpreter on real programs" | no open row (round 2 stopped 2026-11-23, Ersagun: fix the failed compile instead, E320) |
| G Game | "Build a game to test Ters against engines" | stage 1: done (C265, C267 done, C283 and C284 closed measured; G1b with G3d, columns: done in JS, closed for C and WebAssembly 2026-11-22) ([GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md)) |
| L Language and library | "Build a tuner, metronome and looper app" | L271c |
| T Testing | "Make testing granular and cheap" | no open row (T16 done; TESTING.md §8 names the follow-ups to measure once the test map is full) |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I351 | A function given as an input and called both inside `first(…, else …)` and outside it (the `else`) gets one row with Choice in it, so the Choice `first` handles leaks to every caller: `tanh(x, lift) = first(divide(lift(1.0) − x, lift(1.0) + x), else lift(0.0))` is typed `(a, (Float64) -[Choice, e]-> a) -[Choice, e]-> a`, and `tanh(y, (v) => v)` must be handled again (Koka infers the same). A call of a function input with an open row unifies its row with the code around it, where a closed row's goes inside (infer.ts I153). Its display of twenty-odd other variables' `b's Division` is fixed (#3207) | GAPS.md round 22 (mnist) | 2026-11-23 |
| I350 | At 1280 px wide the side panel's six tabs don't fit one line (E310's aim): Definition, Program, Checks, Files and Changes fit, and Guide wraps onto a second line under them (Bigger program: sheet → main → Checks) | QA 11-23 L1 | 2026-11-23 |
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
| E316 | A node's comment in the graph readable at a glance, without overlapping anything (Ersagun 2026-11-22 on E306's speech mark: "Not ideal but an improvement. We can go back to this later"). The other two ways he was offered: the comment as the node's top line, which layout and Tidy count, cut with the rest on hover; or a note beside the node, joined by a line, with room Tidy keeps. His pick when it's taken up | Ersagun 11-22 | P3 | M | |

### Trying a program where it runs ([RUN-INPUTS-2026-11-17](docs/reports/RUN-INPUTS-2026-11-17.md))

Ersagun 2026-11-17: a program's inputs (arguments, files, standard input) are visible and editable in Run, with the example's own ready, so it can be tried without reading its code.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Speed of editing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E319k | A large definition drawn in one task: every render draws the whole editor again, and spacetime's `rapidity picture` takes 230 to 430 ms a render (its graph's drawing and layout about 130, getBoundingClientRect and getBBox about 90 each, its blocks 80 to 100, the backwards panel's seeded values 150). Opening it gives three or four such tasks, because each worker's answer (the backwards search, the choices, the page's compile) calls render. Redraw only what an answer changes, and keep the graph's and blocks' DOM across renders that don't change them. The probe's "opening a large definition" place shows it. | Ersagun 2026-11-23; [EDITOR-THREAD-2026-11-23](docs/reports/EDITOR-THREAD-2026-11-23.md) | P2 | M | open |
| E319j | Pause on a compiled page, what's left on the editor's thread once the worker chooses the stored program's lists and Maps (runCodeAsk.ts): its check over the groups the worker sent (bounce 394 ms) and the interpreted page started at the log's last event (433 ms, its arithmetic resolved about 150). The check finds the groups but reads the whole library again (the stored program changes the library's lists, so it isn't on the library's layer) and its modes again; the page's start resolves the stored program's arithmetic afresh. Both grow with the program. | Ersagun 2026-11-23; [EDITOR-THREAD-2026-11-23](docs/reports/EDITOR-THREAD-2026-11-23.md) | P2 | M | open |

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
| C302 | Tensor of Float64 as one array with its shape, and `contracted` lowered to the loop nest it means (a matrix product for one pair of axes): compiler/gaps/mnist's batch times its layer, a 100 × 784 by 784 × 32 contraction, takes 259 s compiled against 0.13 s on arrays, and 10 rows 10.1 s, faster growth than the work (each index a list, each item found by `item at` on the items list). Then the program moved onto tensors (DG2) | GAPS.md round 22 (mnist) | 2026-11-23 |
| C303 | Tight array loops in the core IR (compiler/gaps/mnist `dot`, 51% of an Adam pass): no step counted in a recursion that counts an Int down to 0, positions bounded by an array's length as plain numbers rather than big-capable `int.add`/`int.sub` calls, a generic count specialised to Int where every call gives one, and Float64 arrays as Float64Arrays read without the ArrayView version and bounds checks; core IR 16x to 21x the ideal, native 3x (DG4) | GAPS.md round 22 (mnist) | 2026-11-23 |
| C304 | An array of Dual (a record of two Float64s) as two columns, each item read once: mnist's Newton mode 35x the ideal in the core IR and 22x in WASI, where Adam is 16x to 21x; `dot` reads the same record from the array again for each field, and each multiply-add allocates one (DG5) | GAPS.md round 22 (mnist) | 2026-11-23 |
| C305 | `ters wasi` reading a 47 MB file: `read bytes` conses one list cell a byte, then makes the Bytes, and V8 stops with "requested new array is too large" (a segmentation fault at Node's default stack); read into one byte array. mnist's 60,000 training digits can't run on WASI (DG6) | GAPS.md round 22 (mnist) | 2026-11-23 |
| C306 | Matrix products natively at NumPy's speed: blocked for the cache, vectorised, on the pool's threads. NumPy runs mnist's Adam pass over 60,000 digits in 0.69 s, `ters native` in 15.6 s, the ideal JS in 4.6 s. After C302 and C303 (DG8) | GAPS.md round 22 (mnist) | 2026-11-23 |
| C307 | `contracted` and maps of Float32 on WebGPU in a page, raced against PyTorch on Apple's MPS with compiler/gaps/mnist-python/mnist_torch.py --device mps --float32. L286 is built (the numbers module's Float32, DG1) | GAPS.md round 22 (mnist) | 2026-11-23 |
| C309 | Float32 (L286) stored as binary32 on every target: C `float`, wasm `f32`, a Float32Array for an array of them. Today it is a one-field record of a Float64, each step rounded with `(double)(float)`, `f32.demote_f64 f64.promote_f32` or `Math.fround`, so it computes right but takes a Float64's room and conversions | L286 | 2026-11-23 |
| C311 | `open outside(path)` (L283) in C (posix_spawnp of open or xdg-open, ShellExecuteW on Windows), on Android (an ACTION_VIEW intent through a FileProvider) and in WASI (no way out: it aborts with the reason). The evaluator, compiled JavaScript and pages have it; scalar.ts lists it as JavaScript's only (HOST_WORLD) | L283 | 2026-11-23 |
| C313 | A page asking for "files" (L284) on a phone and on Windows: Android's folder picker (ACTION_OPEN_DOCUMENT_TREE, the page's files then read through its tree URI), iOS's document picker for a folder (a security-scoped URL), yes in a Windows app as in a Mac one. Today Android and iOS answer no and the page keeps the app's own files | L284 | 2026-11-23 |
| C293 | `neighbours` on a grid in C and WebAssembly at the hand grid's speed. Step 1 (#PR): compiler/gaps/flock at 5,000 birds (100 ticks) natively 2.9 s one thread and 1.4 s on threads, against 1.4 s and 0.55 s on its own grid before C292 and 0.45 s for the ideal C; wasi 5.1 s (6.0 s before). Left: every Int big-capable (positions, cell keys: 300 million `lab_int_dup` in 30 ticks), and merging each bird's 27 runs conses onto arrays that are often copied | Compiler lane 2026-11-23 (C292) | 2026-11-23 |

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L285 | A reverse-mode `gradient` for functions of arrays and tensors: one pass back (Linnainmaa 1970, Speelpenning 1980; JAX's `grad`). `gradient` is forward mode on records, one pass per part: mnist's 25,450 parameters would be 25,450 passes a step, so its backward pass is written by hand. With it, both modes are the language's own differentiation; the Hessian times a vector already comes from duals over that pass (DG3) | GAPS.md round 22 (mnist), Ersagun 2026-11-23 | P2 | L | |
| L266af | Incremental compile after edits, parts 2 to 5 (plan doc https://claude.ai/artifact/WaH3BBwr84Rai5dm6mddVn): definition keys kept by node objects; lowering per function kept (a stop's number is counted over the whole program today, so a kept function's stops need numbering of their own); the whole-program analyses (ownership, zero parts, arithmetic, first arms, reach) as per-definition summaries kept by key; the choice made from kept summaries with a per-definition rewrite. Each part checked by compiler/test/edits.test.ts and the 78-program sweep. Goal: machine's recompile after a one-definition edit under 0.3 s (1.48 s at part 1) | Ersagun 2026-11-20 (card: incremental compile after edits) | 2026-11-20 | high | L | open |
| L266u | Make the List choice carry its types, as the Map and Set choice does (carried-reps.ts, #2899), so a first compile doesn't check the program again (about 0.2 s of machine's 2.3 s warm). The rewrite's old nodes keep their types, with List read as the array on the arrays' side; refs to builtins at the boundary, the conversions and the loops' new definitions are typed by unifying what they're given. On machine that rule types every old node the way the check does, except 55 of these. Set aside on 11-19 for stage 4, whose stable ids already let a recompile skip this check | compiler redesign, 2026-11-19 | low | M | open |

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


### Mobile (Ersagun 2026-11-09: a goal; native compilation per platform a stretch goal, instead of a webview. Down since 2026-11-10 14:49, behind stable references, free lists and multithreading: "Platform stuff will eventually be solved anyway")

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Desktop apps ([DESKTOP-APPS](docs/design/targets/DESKTOP-APPS.md); Ersagun 2026-11-23 10:08 TRT: go, macOS first, then Windows)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C297 | Windows app: `ters build-native-app --windows`, a screen in C over Win32 (Direct2D boxes and pictures, DirectWrite texts, EDIT inputs, frames at the display's rate, dark mode), an `.exe` from clang alone, a hand-run "Windows app" workflow; sound by WASAPI as its own part. Example: dice, then folders | Ersagun 2026-11-23 ("If we want to target windows and macos apps, is that too much work? Can I make my own file browser with it for example?") | P1 | L | |
| C312 | Keys with Ctrl, Cmd, Shift or Alt: the page's event carries which are held (html.ts's handler, the C page's ters_page_event, each screen), so a page can tell Ctrl+F from F; found by C298 | Ersagun 2026-11-23 ("If we want to target windows and macos apps, is that too much work? Can I make my own file browser with it for example?") | P1 | M | |
| C300 | Long lists in a C page: folders at 10,000 rows. Formulas kept until a cell they read is written (C300a) took a key from 7 s to 31 ms; left: rerun only the views that read a changed cell and lay out only what moved (C199b reruns every view, C199d lays out the whole page), under 16 ms a key. Opening takes 1.4 s, 85% of it comparing names (L288) | Ersagun 2026-11-23 ("If we want to target windows and macos apps, is that too much work? Can I make my own file browser with it for example?") | P1 | M | |

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
| L280d | Measured sizes and call counts from runs written into the choices and read by the chooser in place of the cost ladder's n. Parts 1-2 done: `ters choices --measure [args]` writes `measured` entries (each picked type's jobs called by main's own definitions, how often, and the largest value given or gotten, in items), kept until measured again, and the chooser orders a measured type's rows by the steps those calls take at that size, calls made in actions counted too (part 3), and matches and folds (part 4), a page's run measured (part 5: `--measure --frames n` on a clock at 60 a second, or `--replay log.json` for the events a run logged), and the picks then made from what was just measured; left: an app's run (from its events on a device) | Ersagun 2026-11-20 | P3 | M | |
| L280e | Parameters on a representation (a grid's cell size, a chunk size, a worker count), chosen by the compiler and kept in the choices. Parts 1-4 done: the runs a shared job is cut into (JavaScript's `in 32 runs`, C's `in 8 runs a thread`), C's chunks (`in chunks of 16384 items`), the workers a program starts (`main's threads: cores less one, at most 15`), held to tune, and a grid's cell size (L280g's `grid of 5 cells`, in JavaScript; in C with C292) | Ersagun 2026-11-20 | P3 | M | |
| L280g | Spatial partitioning as representations of the "pairs nearer than r" job: all pairs as its meaning, grid and tree as implementations, cell size as a parameter. Needs a program that uses it (flock or Night watch). Design: docs/design/data/NEARBY-2026-11-22.md (std `neighbours(items, place, r)`, its ways all pairs, grid, k-d tree). Step 1 done: std `neighbours` as its meaning; steps 2a-2b done: the evaluator and compiled JavaScript find them on a grid (library/near.ts); step 4 for flock-page done (its twelve grid definitions gone); step 3 done: each call is a `way` entry, held to every pair or to a grid's cell size; step 2d done: a k-d tree, held as a third way (20,000 3D points: grid 191 ms, tree 173 ms uniform; 5 tight clusters, 22 M pairs, grid 4.5 s, tree 7.7 s); places of more than 3 parts on the tree, picked by their type and said in the choices, and the tree asked wherever the grid can't take the places (in the evaluator too); the grid in C and wasm done (C292; compiler/gaps/flock on it); left: the compiler picking the tree from measured sizes (no measured case yet where the grid loses below 4 parts) | Ersagun 2026-11-20 | P3 | L | |
| L280i | A published library carries its own types' and ways' choices, keyed by content hash (when sharing needs it) | Ersagun 2026-11-20 | P3 | M | |

### Instrument app: tuner, metronome, looper ([INSTRUMENT-APP-2026-11-17](docs/reports/INSTRUMENT-APP-2026-11-17.md))

Ersagun 2026-11-17: "A universal instrument tuner, metronome, looper app. This I really want to develop." Ersagun said go 2026-11-17 19:00; the metronome first. L267, L268, L269, the metronome (L275) and the tuner with its signals and tunings modules (L272 to L274) stereo (L270) and minutes of audio in a cell (C261) are done (DONE.md). The looper (L276) and the strum tuner (L277) are done. Left: L271c beside them (L271b, WAV in the language, is done); the frets page (L278), L279, C271, C273, C260b and C269 are done. The compiled FFT is about 50 times hand-written JS (a 2048-sample autocorrelation takes 14 ms); C262 measures it.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L271c | Keeping a recording, minutes of it: the sounds module (L271b, DONE) writes and reads WAV in the language, but slowly. Measured 11-21 compiled to JS: a minute of stereo at 16 bits written in 15.6 s with the tone made (11.5 MB), ten seconds written at 16 and 32 bits and read back in 7.0 s, a minute read back out of memory at 8 GB; garbage collection is 40 to 47% of it, then range, lists made into arrays and worker messages. Wanted: a few minutes saved in a second. Needs `array of(map(range(n), f))` and `bytes of(append(header, map(range(n), f)))` fused into filling a buffer by position, and the read's `map(range(frames), …)` into a Float64Array; in an app, offer file as the share sheet and ask for file as the system's picker (c.ts) | Ersagun 2026-11-17 | P3 | M |  |

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
| G1b | Columns with presence: an `Optional` field of a record kept as columns stored as a bit per slot and a column of values, read in place by a match on it (columns.ts, C and JS first) | C | [ENTITIES](docs/design/data/ENTITIES.md) | P2 | L | |
| G1b1 | `keep` over a List kept as an array lowers as every `all` of a `choose`: the array's items as a list taken apart, answers consed in a box, reversed, an array made of them. The greenhouse's three keeps a tick (moths, plants, lamps) are the first thing keeping its Things as rows in JS (columns.ts: `array.of`). A loop over the positions pushing each kept item (kept-items.ts), on JS, C and WebAssembly. Done | C | G1b, 2026-11-20 | P2 | S | |
| G4 | The archetype representation from G1, built: a Pool whose records leave components out stored as tables per set of components | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G5 | Systems with disjoint effect rows run on the thread pool and page workers at once (G1's scheduling) | C | [GAME-READINESS-2026-11-17](docs/reports/GAME-READINESS-2026-11-17.md) | P2 | L | ⏸ |
| G9 | Vertex functions and instanced draws (G9c, G9d): a Ters function of (instance, vertex) to a position and its varyings, printed as a WGSL vertex stage beside today's fragment | C | [FRAMES](docs/design/targets/FRAMES.md) | P2 | L | |
| G10 | Depth, render targets and several passes in a frame; post effects as passes reading the last one's texture. Steps done: G10a passes into textures and `sampled` on the CPU (#3132); G10b on WebGPU, the runtime (#3142) and the compiler (a captured target bound as a texture, `sampled` in WGSL); left: the flock with a fog pass | C | [FRAMES](docs/design/targets/FRAMES.md) | P2 | L | |
| G11 | Textures and meshes loaded as data (images, a simple mesh format), from files a page or native build carries | C | [FRAMES](docs/design/targets/FRAMES.md) | P2 | M | |
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
