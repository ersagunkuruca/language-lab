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
| E Editor | "Editor lane" | E237 (after L204), E103 (after infer.ts's idea) |
| C Compiler and targets | "Compiler lane" | C137 (retiring compile.ts), C138, C162; then C30, C93 |
| L Language and library | "Language lane" | next by priority from the table below |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I167 | + New definition still freezes about a second (1.3 to 1.8 s to the status line, gaps 0.8 to 1.0 s), down from 3 to 5 s (I157). Where it goes (Insertion sort, 11-04): the edit's guard checks the whole program (`guardTyped`, 0.53 s), then the panel draws (0.33 s), then the hole's fillings, a frame later (0.6 s). A guard of only the added definition (signatures.ts `recheck`) took 26 ms but gives an Info that isn't a layer over the library's, and the palette then lost the inputs in scope: it needs `infer` to check an addition as a layer. | QA 11-04 L1 | 2026-11-04 |

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
| E237 | The editor's literals and display for library number types through L204's and L205's interfaces, not editor/typed.ts's own list (`EXOTIC`, the Rational literal paths). E237a done: values shown through `showerFor` (editor/shown.ts). Left: the literals | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | M | after L204, L205 |

### Speed of editing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E103 | **Bug.** Adding a value in a definition run backwards (physics `fall`) takes about 4 s; five stages (#478 to #504) took fall's holes from 48 s to 18.5 s in all. Stopped by the 10% rule. **Measured again 2026-11-01:** 23 holes 121 s, the worst 22 s, of which the plan comparison per offer 5.7 s and whole checks for offers whose plan changed 10.4 s; E133a took the node copies off (→ 18 s); E133b took the analyzer's full scan per offer off (worst 12.7 s, all 23 holes 67 s); E103c (#898) checks once for every offer that makes the same of the group's types and plans, each offer's units on their own (fall's 23 holes 80 → 47 s, the worst 16 → 8 s, measured on a busy machine; same offers); E103d (#902): a filled program's solves and calls are listed from the program's, not by scanning its ~10,000 nodes in `useDirections` and the jobs check (all 23 holes 50 → 30 s, the worst 10.6 → 4.2 s; same offers); E103e (#938): an offer's units are checked once, not again inside its whole check (23 holes 30 → 23 s, the worst 4.2 → 3.7 s); **measured again 2026-11-01 21:40** (busy machine, all 23 holes ~31 s): the plans compared per candidate 8.2 s (7,452 plans, ~1.1 ms each), the type-group checks 10 s (2,229 distinct groups, ~4.5 ms each: an offer of another shape makes fall's own type another shape, so few share), the whole checks of risky offers 7.7 s (400, ~19 ms each; checking their units apart buys nothing). Stopped by the 10% rule: the next stage needs a new idea, such as checking a group's callers against its new type instead of a whole inference, or a plan that can tell from the filling alone that it can't change; what's left is the checks' own work. **Measured again 2026-11-02** (all 23 holes 29.7 s, the worst 5.2 s, fall's whole body): that hole asks 1,221 plan comparisons and 645 distinct type-and-plan checks for 113 offers kept, because a changed plan is part of the check's key and most candidates change it a little. The next idea is infer.ts's (Language lane): where only a plan changes, check the solves' verdicts (Diverge, how many answers) instead of a whole inference of the group | E100 | P3 | M | |

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
| C137 | The compiled targets on one lowering. compile.ts (3,435 lines) lowers JS straight from the model while WebAssembly, C, WGSL and js-scalar share scalar.ts's core IR, so each feature is built twice in the compiler. (a) From now on nothing goes into compile.ts alone: a model-to-model pass or the shared lowering (written in compile.ts's header and CORE-IR.md); (b) done: `Lowered` is `CoreIR`, its contract in docs/design/targets/CORE-IR.md; (c) a JavaScript printer from it, grown until it runs compile.ts's examples, checked by I111 and the differential test: c1 to c17 done (`lab compile --core`, `lab build-web --core`; the evaluator's values; the evaluator's builtins with no lowering, by id; cells and page effects, the world's clock and draws, 6 pages agree; solves through the evaluator's solver, its budget spent, given closures that carry their nodes; core-js.ts: data, Int, Text, arrays, tables, seeded Random, searches, budgets, aborts, the world; every fuzz program and the 16 examples whose main lowers agree with the evaluator, core-js.test.ts), every example lowers since C137c24 (pig's handlers C137c23, tumble's Animate answered later C137c24, [PROGRAM-EFFECTS-2026-11-03](docs/design/targets/PROGRAM-EFFECTS-2026-11-03.md), on JavaScript; WebAssembly and C next); physics' polar, calculus' derivative and backwards' budget run since C137c19 to C137c21, and function values choosing among several answers (conjugate, pedal) since C137c22, [SEVERAL-ANSWER-FUNCTIONS-2026-11-03](docs/design/targets/SEVERAL-ANSWER-FUNCTIONS-2026-11-03.md)); deep recursion that isn't a tail call runs on the heap (C137c18); (d) compile.ts retired piece by piece (its pages, which can't go on from a wait, go with it: C40's last part): d1 done (`lab compile` and `lab build-web` use the core IR by default, compile.ts where main doesn't lower); d2 done (a compiled program that solves carries the evaluator's solver without the library, about 0.9 MB for calc beside compile.ts's 170 KB, so every example's `lab compile` goes through the core IR); d3 done (a sound in Node, `lab render --compiled`, on the core IR, the evaluator's very samples); d4 done (a page with sound from the core IR, its audio thread's script printed from it too); d5 done (a program's hosts/js.js asked from the core IR, in `lab compile` and on a page); d6 done (a core IR page and worklet made without a bundler, page.ts corePageFile, for the editor's Save page: E244 switches the editor); d7: a sound that solves stays on compile.ts (`lab build-web`, `lab render --compiled`), since the evaluator's solver played the pedal at 34 blocks a second on the core IR; d8 done (solves' plans written out once, as compile.ts's: the pedal 8,300 blocks a second, 22× real time); d9 done (the guard only for a solve whose plan isn't written out, core-js.ts `solvesSlowly`; the editor's Save page still asks `usesSolver`); d10 done (a page with sound and hosts/js.js); d11 to d16 done (calc, Countdown, chapters, routes, notebook and sheet benchmarked on the core IR: sheet 3.8× compile.ts's time since its invariants are hoisted (d16); notebook 2×; routes as fast as compile.ts, calc as fast as compile.ts, Countdown 1.4×, chapters 3× compile.ts's time, a quarter of it std.ts's cons lists from split and the like, C138); left: page.ts, the other gaps benchmarks | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §2 | P2 | L | |
| C138 | C30's aim first: an `array` representation of List written in the language and chosen by the representation layer, on the core IR, replacing compile.ts's 50 CONS/NIL tests and the per-target copies (C30d2, C30d3). C138a: the core IR takes the layer's arrays on JavaScript, WebAssembly and C, so compile.ts's tests go with C137. Left: compile.ts makes every list an array in compiled JS, while the chooser picks arrays only for programs reaching `length`, `item at` or `replace at`; measure (sort, queens, pedal on the core IR) whether the chooser should weigh a fold's or a cons's constant cost so more programs get arrays before compile.ts goes. C138b measured ledger: core IR 4–5× the ideal, compile.ts 2–3×, mostly garbage from `{tag, fields: [...]}` (two objects per constructor); one object per constructor on the core IR done (C138c: 50,000 entries 328 → 170 ms, 3.5× the ideal beside compile.ts's 2.9×) | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §3 | P2 | L | |
| C139 | Library types out of the core passes: id tests on library constructors and functions (compile.ts 188, scalar.ts 152, run.ts 82) become representations or builtin records, retired with C137's printer | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §7 | P3 | M | |

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C93 | Lists read and written by position stay cons lists: machine's registers, memory, code and counts are walked at every step (primes 20000: compiled 47.9 s, ideal 43 ms, 1100×; sort 1000 183×; collatz 7×). Step 1 done: machine's lists are trees, beside its Map and Set hash tables in JavaScript (compiled primes 20000 47.9 → 0.47 s; `lab native` sort 1000 30.4 → 2.2 s, primes 20000 about 36 → 0.47 s). Step 2 done: a definition recurring through a stored list's match, not in a tail call, ran out of stack in compiled JS past a few thousand items (it called itself through the case's function); the match is now put in place. Step 3 done: the WebAssembly the round measures stores lists as trees too (primes 5000 5.3 s → 58 ms, sort 400 5.3 → 0.16 s). Step (c) done: `array of List` replaces in one step (in place in C with one holder). Left: machine still picks trees, because it also builds onto a match's rest and appends, n each on an array (its appends are in the assembler, not the step loop, but one choice is made per type for the whole program, so a choice per value is what's missing); a row that does both in log n and reads in 1, or arrays that share a rest, would take primes 20000 to about 0.11 s (measured by hand-editing the output). Part of C30 | [GAPS round 9](docs/reports/GAPS.md#round-9-machine-an-assembler-and-interpreter-on-every-target-2026-11-02) M1 | P3 | L | |
| C162 | **Reads tracked by the compiler** (Ersagun 2026-11-04: he expected this route with stable references). The compile-time half of [STABLE-REFERENCES](docs/design/data/STABLE-REFERENCES.md) §2 "reactive is a representation" (L99: the compiler picks a tracked view only where a watcher or formula reads) and [CELL-READERS-2026-11-03](docs/design/data/CELL-READERS-2026-11-03.md) option (c). How they fit: L98's paths are the stable references, L99's tracked views record which paths a reader reads at run time, and this works the same paths out at compile time. On the core IR, where a formula's or a view's uses of a value read from a cell are all field reads, list matches and `each`/`each of` in its own code (or in functions it passes the value to, followed as C64b follows handlers), it subscribes to those paths directly (Cells' path readers, as `read at` does) and reads the plain value, with no view at run time. A reader that hands the value whole to something it can't follow, shows it or compares it keeps today's whole-value read. The evaluator and the editor's preview keep views or whole reads, which is the same meaning at another speed. C86b's measurement is the reason: views cost per place read (a board add 3× slower), paths found at compile time cost nothing per read. Done when board's running frame at 1,000 cards wakes only the card's row on the core IR, an add costs no more than today (bench-board.ts), and board's fifteen-phase session wakes the same readers on both | [CELL-READERS-2026-11-03](docs/design/data/CELL-READERS-2026-11-03.md) (c), C86 (closed into this row 2026-11-04: C86a's diffing done, C86b's views not merged) | P2 | L | |
| C30 | Lists as arrays. Done so far: P4a, #555, #558, #561 (pedal 2.9×). The split, join and block-in-array stages pay only together (~25% more); do them as one stage when another program needs lists as arrays. The aim: an `array` representation written in the language (REPRESENTATIONS.md), so WASM, C and the editor get it too. C30d (2026-10-31): Ersagun's two-ended array list; JS runtime views (C30d1, #734), the ends and `array of List` (#737), the ends in WebAssembly and C (C30d2, #754), the evaluator's arrays on the same buffer (C30d3a, #762; Ersagun chose "everywhere" 2026-10-31), the preview's chooser picking `array of List` from use (C30d3b), and the compiled targets taking the same choice (C30d3c: WebAssembly and C lower `first of array if any`). Next: the split, join and block-in-array stages, when a program needs them | GAPS.md round 4 P4 | P2 | L | |
| C68 | Tuples passed and returned as separate values on every target (WebAssembly multi-value, a struct or out-pointers in C), generalising C31 ([PORTS-2026-11-01.md](docs/design/relations-and-effects/PORTS-2026-11-01.md) §6) | Ersagun 2026-11-01 19:27 | P3 | M | after L128 |

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
| C143 | A stop in compiled code names the node it came from: compiled JS, WebAssembly and C carry each node's id where they can stop (Abort, overflow, no answer, a hole), so `lab run` of compiled code and a page print it and the editor selects it (source maps, influence) | [ASPECTS-2026-11-03b](docs/reports/reviews/ASPECTS-2026-11-03b.md) 269 | P3 | M | |
| C150 | Words as machine words (L193): Word8 to Word64 compiled to u8/u16/u32/u64 (WASM i32/i64, C's uint8_t to uint64_t, JS numbers with `>>> 0` or BigInt.asUintN) instead of an Int record wrapped by `bits and`; (and, or, xor since C150a, shifted down since C150b: on Int, so each op on a word still wraps by an and). Measured on words.test.ts's FNV-1a and xorshift. Design C150c ([MACHINE-WORDS-2026-11-03](docs/design/numbers/MACHINE-WORDS-2026-11-03.md)): the compiler proves an Int fits a word; next C150d known bits of an Int on the core IR, C150e a field that fits stored as a word, C150f the mask after an op as the wrapping op, C150g compare/show and the 10 ms gate | L193 | P3 | M | |

## L: Language and library

Numbers first (Ersagun, 2026-10-24 07:01), then the rest of
LANGUAGE-REVIEW-2026-10-24. Anything that only adds a target ranks below
all of these.

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L211 | A use gives its produced ports as a tuple (decided in L179, PORTS-2026-11-01.md §3 "Decided (L179)"). Step a done: a use with no body is read at load (ports.ts `fillUses`, from `base` and `fromFile`) as the use binding each produced port with their tuple as its body, so every engine runs it. Step b done: the model's `binds` and `body` are optional, read through model.ts `bindsOf`/`bodyOf` (compiler/src/uses.ts since C158, the editor since E240). Step c done: the checker types a use with no body as its produced port or their tuple (infer.ts `useResult`), each port typed where a binder would be, with Choice as before. Step d done: the evaluator runs one (run.ts, ports.ts `answerKeys`; the passes on its way read model.ts `useKids`). Step e done: the modes analysis and the relational interpreter read one with its ports bound (ports.ts `filled`, a copy made once per program). Step f done: derive.ts copies one, and the renderers show one as a call naming its given ports (`add(… = 2, result = 5)`, sexpr `(solve add (…))`). Step g done: saved uses move with a `SHAPE_STEPS` entry (ports.ts `usesGiveTheirPorts`): no body, the old body a let of the value, a binder's read a part of it. The compilers run it (C161, #1429). Step h done: a load keeps it as it is (`fillUses` only in ports.ts `filled`). Step i done: the DSL's `use` and `solve` build today's shape (the library is written so), and a tuple's part of a use reads by its port's name (`tuple2.length`). Left: `binds`/`body` leave the model once the editor writes no use with them (Editor lane), and a use binding a port with a unit gets a shape of its own. The editor's drawing done (each produced port an output, wired to what reads it) | L179 | P2 | L | |
| L182 | Flags as hidden kinds: (a) every new node attribute goes through L178's schema, done by construction (model.ts `SCHEMA` is typed so a new attribute doesn't compile without its slot, L178b); left (b), now that L128d and L130 have landed: `def.results`, `def.direction` and `field.results/ports` become ports on the definition's type | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §8 | P3 | M | |
| L215 | Check per definition group, cached ([CHECK-BY-GROUP-2026-11-03.md](docs/design/tools/CHECK-BY-GROUP-2026-11-03.md)), one PR each: (a) closed group results keyed by the group's hashes, its dependencies' schemes, the implementations it needs and the options, with a randomized cache-against-scratch test; (b) a `Checker` cache on the editor's edit path, timed on I157, I158 and a one-character edit in Constructions; (c) typedef groups, units, modes in the cache; (d) `reuse` removed | L183, FOUNDATIONS-2026-11-03 §9 | P3 | L | design done |

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L173b | The rest of REVIEW-2026-11-02d §5, which `lab mcp` couldn't write: machine's `args mapped` as `fields mapped(instruction, f)` is refused because a replaced body loses the parameter's type (the text has no way to say `instruction : Instr`), and board's `card of` as `first where(cards, (c) => c.id = id)` because `c.id` picks among Edit's, Timer's and Card's `id` (E213). Also `zeros` as `copies(count, 0)` turns its type into a generic Number list (L175's question). Needs a parameter's type written in the text, or the editor | [REVIEW-2026-11-02d](docs/reports/reviews/REVIEW-2026-11-02d.md) §5, L173 | P3 | S | |
| L143 | A tuple shows as `tuple(1, "a")` while its type shows `(Int, Text)`: show done (L143a, #1000); left: the text view's literal as `(1, "a")`, which waits on the editor's reader (Editor lane) | [REVIEW-2026-11-01b](docs/reports/reviews/REVIEW-2026-11-01b.md) §8 | P3 | S | |
| L29 | Function variables' rows checked in any order (the closing use should win either way). The other half, `inverse(f, …)` typed from f at the call, is done (#701). Tried 2026-11-01: letting an open row be taken in by a closed one where `opened` copies it broke three effects tests (a handler's row then leaks outward), so it needs two passes: rows settled after every use is seen | L14 | P3 | M | needs two passes |

### Ersagun's current asks

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L107 | **Open question, not decided** (Ersagun 2026-10-30: "I didn't ask to lift strict positivity BTW, I'm not sure if we should lift that"): drop strict positivity, so a data type may take itself as a function's input in its fields (`knot = wrap(f: knot → Float64)`), with taking one apart carrying Diverge so a function without Diverge still always finishes. Recursive data types themselves (a type holding itself, directly or through others) are allowed and always were; TUTORIAL.md §3.8 says so. If decided yes: LANGUAGE.md "Two rules", TUTORIAL.md §3.8 and the guarantees test | Ersagun 2026-10-30 | P3 | S | open question |
| T7 | Tests in the language ([TESTS-IN-THE-LANGUAGE.md](docs/design/testing/TESTS-IN-THE-LANGUAGE.md)): T7a `Check`, small values and `lab test` done; T7b accepted answers in examples.json done; T7c results cached by hash: local done (`.lab/checks.json`), CI's cache left (T, S); T7d the editor's tick, difference and accept button done (#829); T7e example sweeps moved to answers and laws, `--compiled` (T, M). Unblocks L108d, L97e | TESTING.md T7 | P2 | L | design, T7a and T7b done |

### Numbers (NUMBERS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L203 | Grade masks for any library: grades.ts reads which parts can be nonzero from the table and the code, not from the prelude's `clifford …` names and std's `Algebra` constructor (the only compiled-speed gap L202 measured). Step a done: a copy of the prelude's definitions is known by its meaning's hash. Left: the general reading, for a library of its own | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P2 | M | |
| L204 | Number types by interface only. Step a done: a library type's + − · < wait for the lookup exactly when the library has an implementation for it (types.ts `Subst.waits`, from the layer under, L216), so `IMPLEMENTED` and `WORD_TYPES` went and a type without one is still told at the use. Step b done: std's `Literal` interface (`from fraction(top, bottom)`), so a number written at a type of the program's own is its implementation's, and one with none that isn't a record of Float64s is told where (L204b). Left: types.ts `requireArith`, infer.ts `isNumberType`, arith.ts `DATA_NUMBERS` and the per-type literal constructors (Rational, Complex, Dual, Fixed) become Arithmetic, Ordered and Literal implementations; `std.` types stop skipping the lookup; `MATRIX_SIZE` gone (L204c, the prelude's `literal at mat2` to `mat4`); Rational's and Algebraic's ordering in run.ts and compile.ts goes through Ordered | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P2 | L | |
| L205 | Showing by interface: L205a done (std's `Shown` interface, the prelude's Rational, Complex and Fixed implement it, and `show any` in the evaluator shows a value of a type with one through it, so a type of the program's own shows its own way). L205b done (a search's `show any` shows the same way, relate.ts given the runner's resolver). L205c done: run.ts `showerFor(code, info, names)` shows as show any does, and lab test's answers and the representation laws show through it. The editor's wire values, Run panel and Run backwards use it (E237a, #1471). Left: seeds.ts still prints with `showValue`, since its texts are read back by parseValue and a Shown text needn't read back; `showValue`'s Rational, Complex and Fixed branches go once seeds no longer need them; compiled code done (C148) | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P2 | M | steps a, b, c done |
| L206 | The evaluator's speed without jets by hash: stage known-data calls in the evaluator (stage.ts) or let a library declare its host implementation beside the definition; retire jets.ts's list. Measured by L202 | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | M | |
| L207 | The number types leave std.ts for a published `numbers` module written in the language (Rational, Complex, Dual, Fixed, Mat2 to Mat4, Matrix, Algebra, Table entry, Trig, Extended), ids kept for saved programs (L184). After L204 and L205. Algebraic stays host code, registered by the module | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | L | |
| L208 | Generalization as a feature (Ersagun 2026-11-03 09:38): an embedding is a representation whose meaning keeps the operations; the checker inserts only canonical (unique) ones and the rest are named; two canonical paths must agree; laws checked (T7). Step a done: design note EMBEDDINGS.md (a std `Embedding a b` record; only the canonical one per pair inserted, where both types are known; two paths must agree or a direct one is declared). Step b done: std's `Embedding a b`, its declaration checked (known types, the record, once a pair), its laws run by lab test (embed-laws.ts), and the library's Int in Rational, Int and Rational in Float64, Float64 in Complex and in Dual. Step c done: the checker inserts one where a known type is given at a parameter of another it embeds in, and lifts the smaller side of + − · < (infer.ts `liftThrough`, arith.ts `insertEmbeddings`); a program's own embeddings are checked first. Step d done (the diamond rule, diamonds.ts). Step c2's function results done (a function given where one returning the larger type is wanted); c3 done (an input lifted where an earlier input fixed its type, `inverse(half, count)`). Left: c2's rest, a pinned definition's result and a literal (with e), and the relational interpreter and modes seeing the inserted map; e literals as the embedding from Int (with L204), f the compiler keeps a value in the image as the small type (C lane, after L43c); the editor showing an inserted one is asked of Ersagun first | [EMBEDDINGS](docs/design/numbers/EMBEDDINGS.md) | P2 | L | |
| L209 | Values stored in the smallest structure they stay in, chosen by the compiler through embeddings: a Complex with no imaginary part as a Float64, a multivector that stays a rotor as a quaternion. Generalizes L203's grade masks. After L208 | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | L | |
| L210 | A number type for programs that need the same bits on every machine (lockstep games, multiplayer; SPEC §3.2): a Float64 whose sin, cos, exp, log, pow are written in Ters (fdlibm's algorithms) in the library, carried only by programs that use it; lockstep's Fixed is the other way | Ersagun 2026-11-03 (C141) | P3 | M | |
| L44 | Linear maps, geometry and matrices ([MATRICES.md](docs/design/numbers/MATRICES.md), Ersagun 2026-10-31): `Mat2` to `Mat4` done (L44a). Rotors, reflections, projections and PGA motions from the Clifford tables done (L44b); reading a function's matrix done (L44c, src/lang/linear.ts). A `Matrix a` of any size with products, sums and `solved` done (L44d); `determinant` and `inverted` done (L44e); `least squares` done (L44f). Next: the compiler stores linear functions as matrices (C lane, C30b/c); LU kept for many right-hand sides when a program needs it | LANGUAGE-REVIEW-2026-10-24 | P1 | M | steps 1-3 started |
| L43 | Rotors done (L43a: quaternions as the even part of `Cl(3, 0)`). Next, which parts can be nonzero ([GRADES.md](docs/design/numbers/GRADES.md)): L43b blade masks done (src/lang/grades.ts); L43c compiled JS and WGSL store only the masked parts, with L41 (C, M; done: the algebra's mask tables come from its blades, 14 s to 0.2 s on Spacetime, #942; staging multiplies only the masked parts of a definition's inputs, worked out from its callers, #952, and in shaders, #961; next: storing only those parts, and the copies staging makes); L43d the editor names a value's mask done (#831); L43e masks are types, a wrong grade is a type error (done: a part read outside the mask; named masks on record fields, `Vector of T` and the others, and on lists' items (L43e3); next: where the editor names an input's type) (Ersagun 2026-10-31: "each blade combination a different type") (L, M). Bounce passes vectors, spins and rotors as one 8-part type | NUMBERS.md stage 4, [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B3 | P1 | L | rotors and masks done |
| L118c | The evaluator compiles each definition to JavaScript closures once (closure compilation, Feeley and Lapalme 1987), keeping the heap continuation only where a search or a handler needs it; likely 3-10x on all interpreted code; notebook's Run takes 3.2 s for 100 notes, half of it the evaluator's own machine (GAPS.md round 6 N6) ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md) step 2). For later: Ersagun stopped L118 after step 2 | Ersagun 2026-10-31 | P3 | L | for later |
| L88 | Exact reals (EXACT-REALS.md): `Algebraic` done (L88a to L88d, √2·√2 is the Int 2). Next: step 4, `Real` as lazy intervals, when a program needs π exactly | Ersagun 2026-10-26 | P2 | L | 3 of 4 steps |
| L89 | Fixed point for games (FIXED-POINT.md): `Fixed`, exact show, CORDIC trig and examples/lockstep done (L89a to L89d). Left: i64 on WASM and C (lane C) | Ersagun 2026-10-26 | P3 | M | 3 of 4 steps |

### Data and representations (DATA-STRUCTURES.md, REPRESENTATIONS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L212 | A hash array mapped trie for Map and Set, and RRB vectors (32-wide) for `tree of List`, as further representations ([DATA-STRUCTURES.md](docs/design/data/DATA-STRUCTURES.md) "Later representations"): only when a program measures the need, as C63's hash tables did. Credit Bagwell (HAMT, 2001) and Bagwell and Rompf (RRB, 2012), prior art | L61's rest | P3 | M | |
| L98 | A cell owns its value and a write is an edit at a path (STABLE-REFERENCES.md §1): positions done (L98a), keys done (L98b, `key path`). Next: the in-place store is C56's representation | Ersagun 2026-10-29 | P2 | L | steps 1, 2 done |
| L101 | **Later goal**: multithreading where uniqueness allows it (rayon), effect rows deciding what runs side by side (§5) | Ersagun 2026-10-29 | P3 | L | |
| L21 | Folds: a `build` row for user producers, folds with `Choice` asking the table | ROADMAP 5 | P3 | L | |

### Effects and concurrency (ANSWERED-LATER.md, EFFECTS-REVIEW-2026-10-24)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L69 | Foreign definitions ([FOREIGN.md](docs/design/targets/FOREIGN.md)): a program's own effect answered by a host file per target. L69a `hosts/js.js` in the evaluator and compiled JS, results checked at the border, `lab hosts` skeleton (L, M): done (evaluator; compiled JS, L69a2; a page's build-web and build-app, L69a3; asking a host from a page's view or handler is refused, as only the page's effects are allowed there); L69b C and WebAssembly (C, M); L69c the editor's "needs its host" (E, S), done (#860); L69d optional, std's world operations as host files (L, M). Asks Ersagun: may a foreign operation be declared pure | LANGUAGE-NEEDS §5 | P2 | M | design done |

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| I84 | Bounce's `bump pairs` is inferred Diverge: it recurses on a list it gets back inside a Pair, which the checker can't see is shorter. Needs a size analysis that follows a list through a record's fields (sized types), not a tweak to the structural check | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B7 | P3 | L | needs sizes |
| L46b | Raymarch's `march` and `shadow` count steps in an Int and `colour` drops `with fuel` (bounded counting is total since L46). Waits on Int in the scalar profile outside shaders (C66's WebAssembly int32 step; plain JS and C too), or the editor's CPU-side pictures and the scalar tests refuse it | L46 | P3 | S | |

### Grammars, modules and sharing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C110 | A grammar's backward mode compiled to recursive descent when it is LL(1), from COMPILER.md's planned mode analysis (GRAMMARS-2026-11-02 step 4) | L70 | P3 | L | after L70b |
| L72 | Grammars and their machines (Chomsky hierarchy) as ordinary data, parsing and printing one relation run both ways; extends L70. A first case: JSON, whose printer (`json printed`) and hand-written reader (`json read`, L190b) would become one relation run both ways (was L190c) | Ersagun 2026-10-24 | P3 | L | low priority |
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
| L16 | Guarded corecursion, and a stateful handler form so programs write their own Cells. The stateful handler is done (L16a: std `State` with `with state` written in the prelude); left: guarded corecursion | ROADMAP 4 | P3 | L | step a done |
| L22 | Profiles inferred like effects and shown in the editor ("runs on the GPU") | REVIEW-2026-10-22b §5 | P3 | L | |
| L24 | Research as it becomes blocking: costs from folds, laws proved by fusion, fast invertible parsing | ROADMAP 8 | P3 | L | |

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L214 | Text as decided in [TEXT-2026-11-03.md](docs/design/data/TEXT-2026-11-03.md) (L185): steps a to d done in the evaluator and compiled JS (NFC where text enters, `Locale` with `uppercase`/`lowercase` and `my locale()`, `graphemes`, `collated` with `sort with`; DONE.md L214a to L214d). Left: WebAssembly and C, where case, graphemes and collation need the Unicode tables (the library's own code with generated tables, checked against the host on JS, TEXT §"How each target does it") | L185, BLIND-SPOTS-2026-11-03 §4 | P3 | M | a to d done |
| L187 | Error messages as one table (id, message, usual fix, the gesture that fixes it) with a smallest program per problem as its test | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §8 | P3 | M | |
| L188 | Dates and times: Instant, calendar Date, Duration (on units.ts), time zone; now and the local zone as world effects (java.time, Temporal, influence). Step a done: std's `Date` and the prelude's calendar (date of, day number both ways by Hinnant's algorithms, weekday, added days, days between, leap year, days in month, date text), written in the language. Step b done: std's `Instant` (seconds since 1970 UTC) and durations as Float64s in seconds (`seconds`, `minutes`, `hours`, `days`, checked by units.ts), `later by`, `duration between`, `instant at`, `date at`, `time at`, `instant text` and `instant read` (ISO 8601 UTC). Step d1 done: `current instant` (the clock, Time) and `wait for` a duration (Wait). Step e2 done: `duration text` and `duration read` (ISO 8601 PT1H30M). Step c1 done: fixed offsets from UTC, `offset text`, `instant text in` and `instant read` of ±hh:mm. Step c2 done: time zones by name, `zone offset(zone, instant)` and `instant text in zone`, by the host's IANA rules (Intl); step d2 done: `my time zone()`, Settings' second operation. Step c3 done: `instant in zone(date, time, zone)`, a local time read back, a skipped one landing after the jump and a twice-shown one the earlier (Temporal's "compatible"). Left: WebAssembly and C, which need the zone database. Step e done: `date read`, ISO 8601 year-month-day | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §9 | P3 | M | |

### What a good language needs ([ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L189 | `Bytes`: a byte sequence, meaning a list of Ints 0 to 255, stored as a buffer by the representation layer; Files and Network read and write it. Step a done: std's `Bytes`, prelude `bytes of`, `byte items`, `byte count`, and UTF-8 both ways written in the language (`utf8 of`, `text of utf8`). Step d done: hex and Base64 (RFC 4648) both ways, written in the language. Step c's Files half done: `read bytes` and `write bytes` on the command line, evaluated and compiled (bytes.ts). Left: (b) a buffer representation (with `array of List`'s), (c) the rest: Bytes bodies for `send request` (L191), and bytes in a page's store. Audio files, images, binary formats, hashes and WASM/C buffers need it; today there is only Text | [ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md) 153, 164, 290 | P2 | M | |
| L191 | Network beyond `fetch text`: left, Bytes bodies (with L189b's buffer, so a body isn't a list of Ints). Built: `send request(request)` with `Request`/`Response` in std, evaluated and compiled on the command line (L191a) and in a page (L191b) | [ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md) 162 | P2 | S | |
| L213 | Resources as handlers ([RESOURCES-2026-11-03.md](docs/design/relations-and-effects/RESOURCES-2026-11-03.md)): (a) done in the evaluator and checker: a handler's release case, run once on every exit (normal, an Abort handled further out, one nothing caught, the stop); a `with fuel` outside running out releases too (L213a2); left of (a): compiled code (compile.ts and the core IR refuse it with the reason); (b) handler names (`with open file(p) as source`), operations given one, escaping refused as a scope error; (c) the first resource done in the evaluator: `with open file(path, body)` with `next line` and `write line` (L213c), the file's number private to the library; left of (c): the bytes version (after L189b) and compiled code; (d) LANGUAGE.md's error row becomes checked | L192 | P3 | M | design done |

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
| T14 | The single slow tests left after L216: Tumble's clear backwards 74 s, tree of List 50 s, every builtin backwards 103 s, core-js examples and pages 116 s, editing's swapAndUndo 43 s. Each becomes a sweep or gets a smaller input, toward 5 s a file | [TEST-SPEED-2026-11-03](docs/reports/TEST-SPEED-2026-11-03.md) | P3 | M | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P1 | PRs #43 and #44, open since 2026-10-22, likely superseded by #49: close or land | REVIEW-2026-10-22b §8 | P2 | |
| P2 | Batch deploys if Actions cost needs it | Ersagun 2026-10-23 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |
| P4 | Lanes' squash merges carry every commit message of their long-lived branch (#952's lists C52, C30, C40 2a to 2d, C65, C66a to C66c3, I79 … before its own): squash with the PR's own title and summary only | [REVIEW-2026-11-01b](docs/reports/reviews/REVIEW-2026-11-01b.md) §8 | P3 | |
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805), tests reached by a one-line text.ts edit (145/150 + 44/44) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P1 | Ersagun's call |
