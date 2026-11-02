# Backlog

Every open item from every source (Ersagun's asks, reviews, QA passes,
bigger-program rounds, design notes), in one place. Finished items are in
[DONE.md](docs/process/DONE.md). How items are picked and run is in
[WORKFLOW.md](docs/process/WORKFLOW.md); every doc is listed in [the docs index](docs/README.md).

Each lane's items are grouped by theme. Within a lane, priority (P1 first)
decides what's next, and "Next up" below names it. When the order changes,
change "Next up" in the same PR.

**Priority:** P0 broken now · P1 blocks the current step or Ersagun asked ·
P2 next steps · P3 nice to have. Within a priority: bugs, then removing a
special case, then what lets programs be written in the editor, then
language, then more targets or speed (WORKFLOW.md "Priority").
**Size:** S hours · M one PR · L several PRs or a design note first.
**Status:** ▶ running · ⏸ held · blank = waiting.

## Next up

Ersagun's "take 40 more tasks" (2026-11-01 11:46): Editor 13, Compiler 13, Language 14.

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | Review 2026-11-02b ([REVIEW-2026-11-02b](docs/reports/reviews/REVIEW-2026-11-02b.md), the editor): E197 done (saving kept only a program's own nodes), E198 done (type parameters on data types, effects and operations), then E200 done (step 1; E200b, a selection redraws only what shows it, after the P2s), E201 done (the edit draws first, its palette after), E202 done (undo capped, older versions drop their caches), E203 done (a tap's type on the phone's status line), then E207, E206, E205, E204, E199. Before it: QA-2026-11-02b ([report](docs/reports/qa/QA-2026-11-02b.md)): E193 to E196 done. Before it, bigger-program round 8 (board, a page written in the editor, [GAPS.md](docs/reports/GAPS.md#round-8-board-a-page-written-in-the-editor-2026-11-02)): E185 to E192 done; E186b closed; C90's editor half done (one picture lowering per version of the code); E166b done; E103 measured again, its next idea is infer.ts's (row); QA rows as they come. Done before it: bigger-program round 7 (sheet, written in the editor, GAPS.md): E173 to E184, E173b and E183b done; E133 closed (design, SHARED-NODES.md). Next: QA14's findings (QA-2026-11-02): I134 to I143 all done; I144 (Pair→Tuple2 ids on browser restore) done; I29 closed (I29g #1032); I145 Int `range` first done. Done before it: Ersagun's "as many as you can" (until 2 Nov 17:00 UTC): C66's picture half (#892), E103c (#898), I29's later states (#900), E103d (#902); then QA13's findings (QA-2026-11-01b): I122 to I132 and I126b done |
| C Compiler and targets | "Compiler lane" | Round 9 (machine, [GAPS.md](docs/reports/GAPS.md#round-9-machine-an-assembler-and-interpreter-on-every-target-2026-11-02)): C91, C92 and C96 done, C94 step 1 and C93 step 1 done, then C95, C93's rest. Round 8 (board): C86 (with L160). Before them, Ersagun's "as many as you can" (until 2 Nov 17:00 UTC): C74 (#974), C78 (#975), I133 (#980), C80 (#984), C81 (#985), C83 steps 1 (#990) and 2 (#992), C75 (#1003), C82 (#1013), C79 (#1014), C76 (#1025), C55c (#1026), C82b (#1027), C77 (#1029), sheet into ters/examples (#1030), C84 (#1033), C83 with the motor landed (#1037), C69 and C55 closed (#1038), C89 and C87 (one-answer self tail calls as loops, #1040), C85 (#1042), C88 with C72 closed (#1046), C86a (#1048), the shader-opening bug (#1054), C90 step 1 (#1056), C63f (#1058), C67g (#1062), C40's normal finish around a waiting handler (#1063), C97 show in WebAssembly and C (#1066), I146 the ray marcher's Float32 pixel (#1070), C91 machine's native build (#1074), C92 machine's WebAssembly (#1075), C96 lab check on machine (#1077), C94 step 1 (#1083), C98 a search's function input sharing its row (#1087), C93 step 1 lists as trees beside the hash tables (this PR); then C40's rest |
| L Language and library | "Language lane" | Ersagun's 40 (2026-11-01): L125a step 1 done (#842); L125b done, L125d done (#847), L125f done (#848), L71a done (#849), L38's open end done (#851), L71b done (#887), I118 done (#890), L127 done (#891), L69a2 done (#894), L43e3 done (#895), L108d2 done (#896), L29 and I84 put back (too big for now, see their rows); Ersagun's 20 more (16:05): L71c done (#901), L59a done (#904), the calculus palette bug done (I120, #913), L128a done (#925), L128b done (#930), L136 done (#932), L134 done (#933), L135 done (#934), L133 done (#935), L128c's text done (#936; reading it back is the Editor lane's), I121 the site's build done (#946), L128e inline functions' result ports in the text done (#948), I122 the upgrade test done (#950), L63 done (#951), L131 done (#956), L132 sums sorted when hashing done (#966), L113 the merge driver done (#968), L18 long lists read back done (#970); review 2026-11-01b: L137 a function of two inputs where one pair goes done (#976), L141 an any of inside an any of done (#977); round 7: L145 Console's print by name done (#982), L138 simulated now and wait done (#989), L142 the schedule's own random stream done (#993), L143a tuples shown (1, "a") done (#1000), L144 recheck keeps what a run needs done (#1007), L139 one 2-tuple, Pair is Tuple2 done (#1011), L146 recursion through map over a list field ends done (#1020), L140 positions and counts are Int done (#1024), L148 flatten, flat map, repeated and padded done (#1028), L147 range from done (#1034; L147b, why a typed range(n) is Float64's, is in editor/typed.ts); review 2026-11-02 ([REVIEW-2026-11-02](docs/reports/reviews/REVIEW-2026-11-02.md)): L157 docs done (#1036), L153 show at Fixed and Extended done (#1039), L151 counts as Int done (#1045), L154 tiny Float64s shown exactly done (#1050), L158 keep's row (only the reference hid it) done (#1051), L156 the per-type shows leave the palette, one as float64 done (#1059), L159 a lazy stream's message names the field done (#1064), L152 Text has < done (#1072), L149 together's branches may do more than wait done (#1080), L155 one divide done (#1085), L160 item where, a path to a list item by key, done (#1089), L150 start fetch gives a ticket done (this PR), L160 (round 8); then L60 done (#937), L44's next step, L42's next step (a PGA motor), L130 after E168 (L126 `sameAs` done by the Editor lane, #920; L97d was already done). Earlier today: #809 to #823 |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I106c | A rest of a two-ended array is a view on the whole buffer, so after a million `rest`s a one-item array still holds 1.5 M slots (Go's slices leak the same way, which is why Go has `copy`). Copying when a view is much smaller than its buffer would make a repeated match on one small view linear, so it needs a rule that keeps match constant | REVIEW-2026-11-01 §2 | 2026-11-01 |
| I107 | Staging folds `0 · x` to 0 and `x + 0` to x (stage.ts, "as fast-math"), so compiled answers differ from the evaluator's for ∞, NaN and −0, and the preview swaps between the two. Fold only when x is known finite; a test with ∞ and NaN inputs. Settled by L125 (finite `Float64`, decided 2026-11-01): the folds are the type's laws, #834 closes, the checks move to L125c | REVIEW-2026-11-01 §3 | 2026-11-01 |
| I110 | Check main: 49 of its last 60 runs cancelled while queued, a run takes ~19 of its 20 minutes, "affected" reaches 93 of 97 test files. Look at why std.ts and the prelude reach every test; lanes check the latest run when starting an item | REVIEW-2026-11-01 §6 | 2026-11-01 |

## E: Editor

### Bugs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E207 | Values from saved inputs (or of a definition with no inputs) are traced on the page's thread with no time limit (`boundedTrace`): a definition that loops would hold the page on every redraw. By reading; reproduce with a looping definition first, then a long limit with a message or the worker | [REVIEW-2026-11-02b](docs/reports/reviews/REVIEW-2026-11-02b.md) §11 | P3 | S | |

### Writing programs in the editor

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E199 | Language features no gesture makes: private constructors (L79), a definition as a way of an interface field and its cost (WAYS.md), `direction` (POLAR.md), `unique`. A short note first on which belong in the editor (private and ways look like yes), then a row each | [REVIEW-2026-11-02b](docs/reports/reviews/REVIEW-2026-11-02b.md) §3 | P3 | M | |
| E205 | Examples are wired by hand: ~80 JSON imports in main.ts, a 21-way conditional in `initialFor`, `EXAMPLES`, `START`, and editor/build.ts's own list of pages. One examples manifest (folder, label, start definition, page or not) read by main.ts and build.ts | [REVIEW-2026-11-02b](docs/reports/reviews/REVIEW-2026-11-02b.md) §9 | P3 | M | |
| E206 | NODE-EDITOR.md's "Same edits in both views" audit (2026-10-24) misses every gesture since: Wrap in, Turn around, list sockets (E166), result ports (L128), Group into a function, Implement, Answered later. Recheck each in both views and extend the table | [REVIEW-2026-11-02b](docs/reports/reviews/REVIEW-2026-11-02b.md) §10 | P3 | S | |

### Speed of editing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E200b | A click that only selects still redraws the whole app: after E200 (parent index, one graph layout per shape) 45 to 155 ms on the big examples, spread over the graph's drawing (~40 ms in Constructions), the inspector (~30), the blocks (~22) and the browser's layout of the new page (~30). Redraw only what shows the selection on a selection change: the `sel` classes, the lit uses, the inspector | [REVIEW-2026-11-02b](docs/reports/reviews/REVIEW-2026-11-02b.md) §4 | P2 | M | |
| E204 | The editor page is 25 MB (4 MB gzipped): every example is inlined and parsed before the first drawing (3 to 4 s; 9 to 12 s at 4× CPU). Load examples as JSON when picked; the page carries only the one it opens with | [REVIEW-2026-11-02b](docs/reports/reviews/REVIEW-2026-11-02b.md) §8 | P3 | M | |
| E103 | **Bug.** Adding a value in a definition run backwards (physics `fall`) takes about 4 s; five stages (#478 to #504) took fall's holes from 48 s to 18.5 s in all. Stopped by the 10% rule. **Measured again 2026-11-01:** 23 holes 121 s, the worst 22 s, of which the plan comparison per offer 5.7 s and whole checks for offers whose plan changed 10.4 s; E133a took the node copies off (→ 18 s); E133b took the analyzer's full scan per offer off (worst 12.7 s, all 23 holes 67 s); E103c (#898) checks once for every offer that makes the same of the group's types and plans, each offer's units on their own (fall's 23 holes 80 → 47 s, the worst 16 → 8 s, measured on a busy machine; same offers); E103d (#902): a filled program's solves and calls are listed from the program's, not by scanning its ~10,000 nodes in `useDirections` and the jobs check (all 23 holes 50 → 30 s, the worst 10.6 → 4.2 s; same offers); E103e (#938): an offer's units are checked once, not again inside its whole check (23 holes 30 → 23 s, the worst 4.2 → 3.7 s); **measured again 2026-11-01 21:40** (busy machine, all 23 holes ~31 s): the plans compared per candidate 8.2 s (7,452 plans, ~1.1 ms each), the type-group checks 10 s (2,229 distinct groups, ~4.5 ms each: an offer of another shape makes fall's own type another shape, so few share), the whole checks of risky offers 7.7 s (400, ~19 ms each; checking their units apart buys nothing). Stopped by the 10% rule: the next stage needs a new idea, such as checking a group's callers against its new type instead of a whole inference, or a plan that can tell from the filling alone that it can't change; what's left is the checks' own work. **Measured again 2026-11-02** (all 23 holes 29.7 s, the worst 5.2 s, fall's whole body): that hole asks 1,221 plan comparisons and 645 distinct type-and-plan checks for 113 offers kept, because a changed plan is part of the check's key and most candidates change it a little. The next idea is infer.ts's (Language lane): where only a plan changes, check the solves' verdicts (Diverge, how many answers) instead of a whole inference of the group | E100 | P3 | M | |

## C: Compiler and targets

New targets and speed rank below every language item (Ersagun,
2026-10-24 07:01). Measurements and rounds: docs/reports/GAPS.md.

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C40 | Compiled JS for operations answered later (L54/L71): steps 1, 2a to 2d done (#571 to #573), 2e a search whose own definitions wait (C40e). The world answering main's own waits (`start timer`, `await` of a ticket or of `any of(…)`) done (#958: the runtime's `$main`, sleeping on the world's clock or, in a world that can't sleep, a promise). Next: a page that waits (page-runtime.ts; the evaluator's browser world can't wait either, and a page's event handler that waits is first a design question: what the page shows meanwhile), and a waiting search that folds over a list now passes its waits on (step 2f, it gave wrong answers before); a waiting search through its `$k` or record-field copies, or a wait inside a list being built, still says not yet | LANGUAGE-NEEDS-2026-10-24 | P2 | M | step 2 done |

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C93 | Lists read and written by position stay cons lists: machine's registers, memory, code and counts are walked at every step (primes 20000: compiled 47.9 s, ideal 43 ms, 1100×; sort 1000 183×; collatz 7×). Step 1 done: machine's lists are trees, beside its Map and Set hash tables in JavaScript (compiled primes 20000 47.9 → 0.47 s; `lab native` sort 1000 30.4 → 2.2 s, primes 20000 about 36 → 0.47 s). Left: (a) a definition that recurs through a stored list's match calls itself inside the case's function, which compiled JavaScript can't move to the heap, so past about 2,000 items it may run out of stack (`map` has a job of its own now); put a match job that isn't recursive in place after the check (before it, the termination check no longer sees the rest as a piece); (b) the WebAssembly the round measures, built from the program as written; (c) `array of List` has no `replace at` job, and in place where one holder (C56) would take primes 20000 to about 0.11 s (measured by hand-editing the output). Part of C30 | [GAPS round 9](docs/reports/GAPS.md#round-9-machine-an-assembler-and-interpreter-on-every-target-2026-11-02) M1 | P3 | L | |
| C94 | In C, a record read again after a call was shared during it. Done (this PR): a record given to a call and afterwards only read field by field has those fields read first (machine's `stepped`). At the end of a function, a record read field by field while one field is changed has every field read first, after the calls that take it whole (machine's `stored`: `replace at(m.memory, …)` now gets the memory with one holder). primes 20000 native 61 → 36 s. Left: a record passed whole to a function that only reads it (`value of(m, r)`) is still dup'd for the call; borrowed parameters (Perceus) would take that away | [GAPS round 9](docs/reports/GAPS.md#round-9-machine-an-assembler-and-interpreter-on-every-target-2026-11-02) M4 | P3 | M | step 1 done |
| C95 | A record built and at once copied with a few fields changed: machine's `executed` makes a new `Machine` and `stepped` copies it to count the step. The first has one holder; change it in place. Measured on top of C93's arrays: collatz 3000 295 → 210 ms, primes 5000 90 → 50 ms | [GAPS round 9](docs/reports/GAPS.md#round-9-machine-an-assembler-and-interpreter-on-every-target-2026-11-02) M5 | P3 | M | |
| C86 | A write of a whole new value wakes every reader of the cell: board's running frame changes one card's time, and the three columns' formulas, their rows' matching, the counts, the tags and the history all run again (1.8 ms a frame at 1,000 cards, about 20 ms at 10,000, against the ideal's 0.01 and 0.9); an add the same (3.6 ms at 1,000, ideal 0.01). C86a done (#1048): the old and new values are compared once, skipping what they share, and only path and view readers of the places that differ wake (frame 1.97 → 1.59 ms at 1,000 cards). Left: board's readers read the whole state, so they still all wake; that needs L160 (reading only the fields used). Prior art: Solid's `reconcile`. With L160 | [GAPS round 8](docs/reports/GAPS.md#round-8-board-a-page-written-in-the-editor-2026-11-02) B2 | P2 | L | |
| C90 | Opening the ray marcher in the editor is slow since its PGA motor (#1037): editing.test.ts `shaderOpens` 12 s before, 57 s after the emitter fix (#1054). Most of it is `lowerPicture` staging the larger picture (stageProgram, specialiseCalls/copyTree, the check after staging), done for the GPU try and again for the CPU side. Step 1 done (#1056): only what the picture reaches is staged, 57 → 24 s. The editor's half done (#1061): one lowering, and one Float32 copy for the CPU side, per version of the code and its names, so opening the program again lowers nothing (shaderOpens 21 → 15 s; the GPU and the CPU side still lower different code, the Float64 and the Float32 program). Left: staging's own check is still most of a lowering (0.8 s) | Editor lane via coordinator 2026-11-02 | P2 | M | |
| C67 | **A faster compiler** (Ersagun 2026-10-31: "make the compiler faster"). The editor's compiled swap takes 2 to 7 s. Benchmarks: compiling Bounce, Spacetime and Constructions to JS (main). Before: 6.1, 5.9 and 1.9 s; most of it is the program checked again after staging, over the whole library. Done: C67a, only what the exports reach is compiled (3.5, 4.4, 1.0 s); C67b, ids from a pool of random bytes (3.0, 4.2, 0.8 s); C67c, effect-row chains flattened as they are walked (2.9, 2.7, 0.8 s). Stopped there (2026-10-31): no single function is over 0.5 s now. The largest part left is staging's two whole-program checks (about 1 s of Spacetime's 2.7 s). C67d would check the middle one only on the definitions staging changed (infer's `reuse`, as the palette does), which saves about 10% at best and must merge type info from two checks: not worth it yet. Measured again 2026-11-01 (a busy machine): 3.5, 3.3 and 2.8 s, since L125b's check of which calls always answer cloned the whole substitution for each builtin call it looked at; C67e reads a builtin's own type once instead (2.2, 2.4, 1.8 s). C67f made the check itself about twice as fast (Constructions' infer 660 → 350 ms): a pinned definition is checked on a trial over the substitution, not a copy of it; each definition with results is asked its direction on the program's own modes analysis plus the few new nodes; signs reads each input once (1.6, 2.6, 1.5 s). What is left is the modes analysis itself and staging's own work (evaluating at compile time). The rule was to stop when a step buys less than 10%. C67g (#1062): cut to what the exports reach before hoisting, sheet 1.1 → 0.6 s | Ersagun | P3 | M | C67g done |
| C30 | Lists as arrays. Done so far: P4a, #555, #558, #561 (pedal 2.9×). The split, join and block-in-array stages pay only together (~25% more); do them as one stage when another program needs lists as arrays. The aim: an `array` representation written in the language (REPRESENTATIONS.md), so WASM, C and the editor get it too. C30d (2026-10-31): Ersagun's two-ended array list; JS runtime views (C30d1, #734), the ends and `array of List` (#737), the ends in WebAssembly and C (C30d2, #754), the evaluator's arrays on the same buffer (C30d3a, #762; Ersagun chose "everywhere" 2026-10-31), the preview's chooser picking `array of List` from use (C30d3b), and the compiled targets taking the same choice (C30d3c: WebAssembly and C lower `first of array if any`). Next: the split, join and block-in-array stages, when a program needs them | GAPS.md round 4 P4 | P2 | L | |
| C63 | IN-PLACE.md step 2: a hash table changed in place as a representation of Map and Set, where every value has one holder and keys hash as they're equal. C63a (the one-holder check), C63b (the `hash table` row for Map, Int and Text keys, on JS and the evaluator) and C63c (jobs in a loop weigh n; routes takes the table, 2× faster than on trees) are done. C63d, the same for Set (std's Hash set, Int and Text items), is done; routes' sets pass the one-holder check since C63e and keep the tree. C63f (#1058): tuples of Ints and Texts as keys too, and a match that reads only the smallest priced as log n on a tree, so routes' frontier keeps its tree. Left: records as keys, and WebAssembly and C (no host Map). Tried 2026-11-02: a hash set with a binary heap beside it for the smallest, so routes' frontier would be one; slower (3,000 towns 422 → 546 ms), the tuple keys' spellings cost more than the tree's typed compare, so not kept | docs/design/data/IN-PLACE.md | P2 | L | |
| C68 | Tuples passed and returned as separate values on every target (WebAssembly multi-value, a struct or out-pointers in C), generalising C31 ([PORTS-2026-11-01.md](docs/design/relations-and-effects/PORTS-2026-11-01.md) §6) | Ersagun 2026-11-01 19:27 | P3 | M | after L128 |
| C64 | Handlers the compiler can see: Pig's `quietly` and `hold at` sit right around `play`. Done: C64a (#759, quiet cases skip the hiding, 330 → 270 ms) and C64b (#787, handlers written into the code they handle, 270 → about 95 ms). C64c (a case written in as a condition is a plain JS condition, about 110 → 77 ms today; earlier numbers were on a busier machine). C64d (Random that nothing in the program handles is drawn from the world straight away, `$random()`: Pig's 20,000 games about 60 → 42 ms, best of 15). Left: nothing measured; the same for Time's `now` if a program shows it | examples/pig | P3 | M | |

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

## L: Language and library

Numbers first (Ersagun, 2026-10-24 07:01), then the rest of
LANGUAGE-REVIEW-2026-10-24. Anything that only adds a target ranks below
all of these.

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L162 | A type's fields by their type: machine's `Instr` has 21 cases and seven definitions match all 21 only to reach the `Arg`s in them or the case's name (`args mapped`, `problems of`, `threaded`, `moved`, `targets`, `disassembled`, `op name`; 147 cases in the editor). A map and fold over every field of a given type in any case, and a case's name as text. Prior art: Haskell's `deriving Functor`, GHC Generics, "Scrap your boilerplate" (Lämmel and Peyton Jones 2003), Data.Data's `showConstr` | [GAPS round 9](docs/reports/GAPS.md#round-9-machine-an-assembler-and-interpreter-on-every-target-2026-11-02) MG1 | P2 | M | |
| L163 | A value with one place changed, for any value: paths (`path`, `item path`, `then path`) work only with `write at` on a cell, so machine writes all eight `Machine` fields out at twelve places to change one or two. `changed(value, path, part)`; also tells the compiler which field changes (C95). Prior art: lenses (van Laarhoven; Kmett's `lens`), OCaml's and Elm's `{ r with f = v }` | [GAPS round 9](docs/reports/GAPS.md#round-9-machine-an-assembler-and-interpreter-on-every-target-2026-11-02) MG2 | P2 | M | |
| L164 | Library gaps machine wrote itself: zip (`zipped`), positions with items (`numbered`), a list of n copies (`zeros`; `repeated` is Text's), all/any over a list (`all digits`); and no match on Text values (`instruction of` is a 21-way if chain) | [GAPS round 9](docs/reports/GAPS.md#round-9-machine-an-assembler-and-interpreter-on-every-target-2026-11-02) MG3 | P3 | S | |
| L161 | Library gaps board wrote itself: a whole number from text (`digit of`, `digits value`, `whole number`); a search in a list (`card of`, `position of`, `tag in`: `has item` and `find` are Set's and Text's only) and the largest of a list (`largest id`); Float64 to Int (`floor` gives a Float64, so a random pick is `nth card`, a recursion on a Float64 index); `++` on lists (`inserted` is two appends); `≠` | [GAPS round 8](docs/reports/GAPS.md#round-8-board-a-page-written-in-the-editor-2026-11-02) BL1 to BL4 | P3 | M | |
| L147b | **Editor lane's file.** A typed `range(n)` with `n` not yet typed picks Float64's `range`: editor/typed.ts reads a name into its alternatives in std's order (`builtin.range` is declared before `builtin.int.range`), and `leaveOpen` keeps that order when both leave the input open, so the first wins. Prefer the Int one there (or order Int first among same-named alternatives), and offer it first in the palette. `range from(a, b)` done (L147, Int) | [REVIEW-2026-11-02](docs/reports/reviews/REVIEW-2026-11-02.md) §10; GAPS round 7 SL2 | P2 | S | |
| L143 | A tuple shows as `tuple(1, "a")` while its type shows `(Int, Text)`: show (and the text view's literal) as `(1, "a")` | [REVIEW-2026-11-01b](docs/reports/reviews/REVIEW-2026-11-01b.md) §8 | P3 | S | |
| L29 | Function variables' rows checked in any order (the closing use should win either way). The other half, `inverse(f, …)` typed from f at the call, is done (#701). Tried 2026-11-01: letting an open row be taken in by a closed one where `opened` copies it broke three effects tests (a handler's row then leaks outward), so it needs two passes: rows settled after every use is seen | L14 | P3 | M | needs two passes |

### Ersagun's current asks

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L107 | **Open question, not decided** (Ersagun 2026-10-30: "I didn't ask to lift strict positivity BTW, I'm not sure if we should lift that"): drop strict positivity, so a data type may take itself as a function's input in its fields (`knot = wrap(f: knot → Float64)`), with taking one apart carrying Diverge so a function without Diverge still always finishes. Recursive data types themselves (a type holding itself, directly or through others) are allowed and always were; TUTORIAL.md §3.8 says so. If decided yes: LANGUAGE.md "Two rules", TUTORIAL.md §3.8 and the guarantees test | Ersagun 2026-10-30 | P3 | S | open question |
| L128 | **Tuples of ports** ([PORTS-2026-11-01.md](docs/design/relations-and-effects/PORTS-2026-11-01.md) §1, §2): a built-in structural tuple type (a tuple of one is its value, of none `Unit`); a function's inputs are one tuple in the checker, so `f(p)` is `f(x, y)`; several results on any function including lambdas (`= e1, e2` in a body); `r.port` reads a part by the function's port name; interface fields' `results`/`ports` become a plain function type. Credit Standard ML (prior art) and Swift SE-0029/SE-0110 (considered). L128a done: `Tuple2`..`Tuple8`, `f(p)` (spread.ts). L128b done: a lambda's named result ports, `resultPorts`. L128c's rendering done; reading `→ a, b = e1, e2` back into a lambda's results is editor/typed.ts's (Editor lane). Left: L128d interface fields' `results`/`ports` as a plain function type, which waits for L130: polar's interface uses a field's ports as a relation (solved either way), and a plain function type would lose that until call and solve are one | Ersagun 2026-11-01 19:27; he chose tuples of ports 19:35 | P1 | L | steps a, b, c done |
| L130 | `call` and `solve` one node kind in the model: a use names its given ports and the rest come out ([PORTS-2026-11-01.md](docs/design/relations-and-effects/PORTS-2026-11-01.md) §3) | Ersagun 2026-11-01 19:27; he chose views first, merge later 19:36 | P2 | L | after E168 |
| L108 | Representations written in the language (REPRESENTATIONS.md). L108a to L108c done: a representation is a definition, the compiler chooses, no explicit selection (#679 to #682). L108d laws done (`lab test` checks each job through its meaning, match and fold too, L108d2). Left: the editor half, E159 | Ersagun 2026-10-30 | P2 | M | 4 of 4 steps; E159 left |
| T7 | Tests in the language ([TESTS-IN-THE-LANGUAGE.md](docs/design/testing/TESTS-IN-THE-LANGUAGE.md)): T7a `Check`, small values and `lab test` done; T7b accepted answers in examples.json done; T7c results cached by hash: local done (`.lab/checks.json`), CI's cache left (T, S); T7d the editor's tick, difference and accept button done (#829); T7e example sweeps moved to answers and laws, `--compiled` (T, M). Unblocks L108d, L97e | TESTING.md T7 | P2 | L | design, T7a and T7b done |

### Numbers (NUMBERS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L44 | Linear maps, geometry and matrices ([MATRICES.md](docs/design/numbers/MATRICES.md), Ersagun 2026-10-31): `Mat2` to `Mat4` done (L44a). Rotors, reflections, projections and PGA motions from the Clifford tables done (L44b); reading a function's matrix done (L44c, src/lang/linear.ts). Next: the compiler stores linear functions as matrices (C lane, C30b/c); then a linear-algebra library for any size | LANGUAGE-REVIEW-2026-10-24 | P1 | M | steps 1-2 done |
| L42 | `Cl(p, q, r)`: `clifford table` done (L42a). Next: a PGA motor in the ray marcher (L41 is done); written and working in the evaluator, C74 lets the compiled targets differentiate it; the evaluator's own gradient through them works since I133; landed with C83 (the ray marcher turns its scene with a motor; every target agrees with the evaluator) | NUMBERS.md stage 4 | P1 | M | motor landed |
| L43 | Rotors done (L43a: quaternions as the even part of `Cl(3, 0)`). Next, which parts can be nonzero ([GRADES.md](docs/design/numbers/GRADES.md)): L43b blade masks done (src/lang/grades.ts); L43c compiled JS and WGSL store only the masked parts, with L41 (C, M; done: the algebra's mask tables come from its blades, 14 s to 0.2 s on Spacetime, #942; staging multiplies only the masked parts of a definition's inputs, worked out from its callers, #952, and in shaders, #961; next: storing only those parts, and the copies staging makes); L43d the editor names a value's mask done (#831); L43e masks are types, a wrong grade is a type error (done: a part read outside the mask; named masks on record fields, `Vector of T` and the others, and on lists' items (L43e3); next: where the editor names an input's type) (Ersagun 2026-10-31: "each blade combination a different type") (L, M). Bounce passes vectors, spins and rotors as one 8-part type | NUMBERS.md stage 4, [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B3 | P1 | L | rotors and masks done |
| L118 | A faster evaluator ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md)): profile, one hotspot per PR, stop when the next buys <10%. L118a the table product as a jet done (Spacetime's charge path 8.3 s → 0.48 s, Bounce's step 14 → 3.7 ms). L118b, the machine's own hotspots, measured below the noise and stopped. Stopped here (Ersagun 2026-10-31 21:12); L118c is its own row below | Ersagun 2026-10-31 | P1 | M | done for now |
| L118c | The evaluator compiles each definition to JavaScript closures once (closure compilation, Feeley and Lapalme 1987), keeping the heap continuation only where a search or a handler needs it; likely 3-10x on all interpreted code; notebook's Run takes 3.2 s for 100 notes, half of it the evaluator's own machine (GAPS.md round 6 N6) ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md) step 2). For later: Ersagun stopped L118 after step 2 | Ersagun 2026-10-31 | P3 | L | for later |
| L51 | Tensors as the general algebra (NUMBERS.md stage 6) | NUMBERS.md stage 6 | P1 | L | after C30 |
| L97 | `polar` as the relation behind Trig (POLAR.md): L97a to L97c4 done (Trig's polar, unpolar, asin, acos; polar given x, y answered by unpolar). L97e complex laws done (prelude tests). L97d done: Fixed's polar is CORDIC's rotation, its sin and cos come from it. C55 closed: a solve the relational interpreter would run, binding one result, is a call for that result alone (C55a): Fixed's polar given the angle and binding y alone compiles to `fixed_polar_s_y` only (checked 2026-11-02) | Ersagun 2026-10-28 | P2 | M | done |
| L96 | Several ways to compute one operation, the compiler choosing by cost (WAYS.md): L96a to L96c done. Left: the steps after L97 | Ersagun 2026-10-28 | P2 | L | 3 of 5 steps |
| L88 | Exact reals (EXACT-REALS.md): `Algebraic` done (L88a to L88d, √2·√2 is the Int 2). Next: step 4, `Real` as lazy intervals, when a program needs π exactly | Ersagun 2026-10-26 | P2 | L | 3 of 4 steps |
| L125 | Which IEEE float values the language keeps ([FLOAT-VALUES-2026-11-01.md](docs/design/numbers/FLOAT-VALUES-2026-11-01.md)): `Float64` as the finite floats with one zero, ±∞ as an ordinary `Extended a`, NaN only as how "no answer" is stored. **Decided 2026-11-01** (Ersagun: finite `Float64` yes; `x / 0` no answer). Steps: L125a the meaning (overflow aborts; `/ sqrt log asin acos ^` get `Choice` at bad arguments; −0 canonical in `show`, `atan2`, `sign`) (L, M); L125b the inferred nonzero/nonnegative fact that drops the check (L, M); L125c compiled checks on JS, WASM, C, staging's folds as laws, #834 closed (C, M); L125d `Extended a` in the library (L, S), shown and typed as ±∞ in the editor (#865); L125e niche representations, `Optional Float64` and `Extended Float64` in one f64 (C, M), done in WebAssembly and C (compiled JavaScript keeps them as data); L125f host floats checked on entry (L, S) | Ersagun 2026-11-01 | P1 | L | decided; L125a step 1 done (the evaluator stops on a non-finite answer, with the reason); L125d and L125f done; L125b done (no answer is a `Choice` in the evaluator; a view with none shows nothing); L125c1 done (compiled JS stops the same), L125c2 done (WASM and C); L125c3 done (compiled JavaScript gives no answer too, as WebAssembly and C already did; plain scalar code with no Choice still stops); L125e done |
| L89 | Fixed point for games (FIXED-POINT.md): `Fixed`, exact show, CORDIC trig and examples/lockstep done (L89a to L89d). Left: i64 on WASM and C (lane C) | Ersagun 2026-10-26 | P3 | M | 3 of 4 steps |

### Data and representations (DATA-STRUCTURES.md, REPRESENTATIONS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L61 | Better data structures as representations: a meaning (List, Map, Set) plus representations (array, HAMT, balanced tree, RRB vector) chosen per value, no new node kinds. `Map` and `Set` done (L65); written in the language since L108b | Ersagun 2026-10-24 | P1 | L | Map and Set done |
| L98 | A cell owns its value and a write is an edit at a path (STABLE-REFERENCES.md §1): positions done (L98a). Next: keys, with L99 | Ersagun 2026-10-29 | P2 | L | step 1 done |
| L99 | Reads tracked by path, so data in cells stays plain (§2): `each` follows edits (L99a), tracked views (L99b), nested lists (L99c) done. Next: the compiler picking views where a watcher reads; a plain `State` handler | Ersagun 2026-10-29 | P2 | L | 3 steps done |
| L101 | **Later goal**: multithreading where uniqueness allows it (rayon), effect rows deciding what runs side by side (§5) | Ersagun 2026-10-29 | P3 | L | |
| L20 | `set` with general functions through relations | real-sized data | P3 | M | |
| L21 | Folds: a `build` row for user producers, folds with `Choice` asking the table | ROADMAP 5 | P3 | L | |

### Effects and concurrency (ANSWERED-LATER.md, EFFECTS-REVIEW-2026-10-24)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L150b | Fetches that overlap: a world that fetches in the background, so `start fetch` returns at once and `await` waits for the body (the page's runtime and the compiled main, as timers are; the CLI world's fetch is synchronous today). Then `start read file`. L150 gave the API, `start fetch(url) : Ticket Text` | L150 | P3 | M | |
| L54 | Operations answered later, at most once (ANSWERED-LATER.md): step 1 done (L54a); compiled side is C40 | EFFECTS-REVIEW §1.5, §5 | P1 | L | step 1 done |
| L59 | A page's fetch and wait resume instead of re-running the handler; `Wait` folds into `Time`. L59a done (the evaluator's page: a handler goes on from its fetch). Left: L59b `wait` in a page handler parks on a timer the same way, and `Wait` folds into `Time` (a view's row still leaves the clock's waiting out); L59c the fetch memo scoped to one search and one event, not the page (§1.2); compiled JS's page resumes (C40). L59b waits for C40: a compiled page would stop at a wait the evaluator's page lets through | EFFECTS-REVIEW §1.1-1.3 | P1 | M | step a done |
| L69 | Foreign definitions ([FOREIGN.md](docs/design/targets/FOREIGN.md)): a program's own effect answered by a host file per target. L69a `hosts/js.js` in the evaluator and compiled JS, results checked at the border, `lab hosts` skeleton (L, M): done (evaluator; compiled JS, L69a2; a page's build-web still to bundle it); L69b C and WebAssembly (C, M); L69c the editor's "needs its host" (E, S), done (#860); L69d optional, std's world operations as host files (L, M). Asks Ersagun: may a foreign operation be declared pure | LANGUAGE-NEEDS §5 | P2 | M | design done |
| L62 | Branches with no world effects marked pure by a row constraint, so the runtime may run them on another core | LANGUAGE-NEEDS Part 1 | P3 | S | after L71 |
| L64 | Scoped channels (`Channel a`, `send`, `receive`), when a program needs a pipeline | LANGUAGE-NEEDS Part 1 | P3 | M | |

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| I84 | Bounce's `bump pairs` is inferred Diverge: it recurses on a list it gets back inside a Pair, which the checker can't see is shorter. Needs a size analysis that follows a list through a record's fields (sized types), not a tweak to the structural check | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B7 | P3 | L | needs sizes |
| L46b | Raymarch's `march` and `shadow` count steps in an Int and `colour` drops `with fuel` (bounded counting is total since L46). Waits on Int in the scalar profile outside shaders (C66's WebAssembly int32 step; plain JS and C too), or the editor's CPU-side pictures and the scalar tests refuse it | L46 | P3 | S | |

### Grammars, modules and sharing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L70 | Design note: grammars written once as printers and parsed by running them backwards; calc's parser first | LANGUAGE-NEEDS §8 | P3 | M | |
| L72 | Grammars and their machines (Chomsky hierarchy) as ordinary data, parsing and printing one relation run both ways; extends L70 | Ersagun 2026-10-24 | P3 | L | low priority |
| L17 | Data-type upgrades (migrations when constructors and fields move); path namespaces are a name layer (SHARING.md §5) | ROADMAP 5 | P3 | L | |
| L109 | Hashes carry a recipe version; std published with lineages and versions, so a std change adds versions and keeps the old (no more #709-style republishing) | SHARING.md §3 | P3 | M | |
| L110 | Publishing keeps the draft id as the lineage id; refs hold lineage and exact version; `replaces` derived from the lineage | SHARING.md §1, §2 | P3 | M | after L109 |
| L111 | Upgrades by pin generality (new pin at least as general), moved by the editor with a note; Bob's tests must pass once T7 exists | SHARING.md §2 | P3 | M | after L110 |
| L112 | Names pinned per program; one question per upgrade for the author's renames; the program's own renames win | SHARING.md §5 | P3 | M | after L110 |
| L115 | Project store: every published node the project used, kept by hash with it by default; runs when a source is gone; downgrade to any kept version (Ersagun 2026-10-31) | SHARING.md §4b | P3 | M | after L110 |
| L114 | Lineage logs: signed, append-only, "current" and "broken" entries; code fetched by hash from any host; a browser over logs (was L68) | SHARING.md §4 | P3 | L | after L111 |

### Physics and planning ([PHYSICS-AND-PLANNING.md](docs/design/physics/PHYSICS-AND-PLANNING.md), later goals)

Ersagun 2026-11-01: fast bodies passing through each other, and A* for an
agent with inertia. All later goals.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L119 | **Later goal**: Bounce's continuous collisions: time of impact for ball and ball (a quadratic, S₁(t)·S₂(t) = −r₁r₂ for conformal spheres) and ball and wall (linear), once for 2D and 3D; step to the first impact with a sub-step cap; a "bullet through a thin wall" case beside the plain step | Ersagun 2026-11-01 | P3 | M | |
| L120 | **Later goal**: time of impact for rotating shapes along a PGA motor (screw motion) by conservative advancement (Mirtich); the compiler choosing it or the closed form by cost (WAYS.md) | Ersagun 2026-11-01 | P3 | L | after L119, shapes other than balls |
| L121 | **Later goal**: speculative contacts in Bounce, compared with L119 on the same scene (cost per frame, ghost bumps) | Ersagun 2026-11-01 | P3 | S | after L119 |
| L122 | **Later goal**: an agent with inertia, decoupled: navigation-mesh A* (from routes' frontier), the funnel, corners as arcs, the time-optimal speed profile (forward and backward pass), a follower; one page, a hand-made mesh | Ersagun 2026-11-01 | P3 | L | |
| L123 | **Later goal**: the coupled search: Hybrid A*-style over position and velocity, motion primitives exact under linear drag, L122's path length / top speed as the heuristic; compared with L122 on the same map | Ersagun 2026-11-01 | P3 | L | after L122 |
| L124 | **Later goal**: a rapidity speed cap (velocity as a boost in Cl(2, 1)) beside linear drag on L122's page; optional | Ersagun 2026-11-01 | P3 | M | after L122 |

### Someday

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L12 | Tutorial screenshots brought up to the current editor | ROADMAP 2 | P3 | M | |
| L16 | Guarded corecursion, and a stateful handler form so programs write their own Cells | ROADMAP 4 | P3 | L | |
| L22 | Profiles inferred like effects and shown in the editor ("runs on the GPU") | REVIEW-2026-10-22b §5 | P3 | L | |
| L24 | Research as it becomes blocking: costs from folds, laws proved by fusion, fast invertible parsing | ROADMAP 8 | P3 | L | |

## T: Testing and fast feedback

The thread that owns `.github/workflows` and the browser checks. Plan:
docs/process/TESTING.md. T7 is in lane L.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| I64 | The browser smoke fails at letNodes: it waits for dice's `die` call node, which since auto-fold (#619) sits in a folded handler. Pick a call that's drawn, or unfold its frame first | smoke thread, 2026-10-29 | P2 | S | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P1 | PRs #43 and #44, open since 2026-10-22, likely superseded by #49: close or land | REVIEW-2026-10-22b §8 | P2 | |
| P2 | Batch deploys if Actions cost needs it | Ersagun 2026-10-23 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |
| P4 | Lanes' squash merges carry every commit message of their long-lived branch (#952's lists C52, C30, C40 2a to 2d, C65, C66a to C66c3, I79 … before its own): squash with the PR's own title and summary only | [REVIEW-2026-11-01b](docs/reports/reviews/REVIEW-2026-11-01b.md) §8 | P3 | |
