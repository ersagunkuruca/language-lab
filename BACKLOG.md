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
Focus since 2026-11-10 14:49 (Ersagun): finish stable references, free lists and multithreading (P1 rows C58 to C61, C42, C43; C57 measured and waits); mobile rows are down to P3.
Defaults first (Ersagun 2026-11-10 15:34): "I want the default compiled code to be as close to a C/C++ dev doing data oriented design and cache and memory aware as possible. And then if we need Pools and similar stuff to get a last 10 percent of performance that's OK, but the defaults should be our first target." So rows that change what every program gets (layout as columns, arrays written in place, records changed in place, work on every core) go before ones a program must ask for (a Pool type).
**Size:** S hours · M one PR · L several PRs or a design note first.
**Status:** ▶ running · ⏸ held · blank = waiting.

## Next up

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | C58 (free lists; a Pool type asked of Ersagun), then C59; mobile rows wait. Then Language or Compiler rows agreed with those lanes |
| C Compiler and targets | "Compiler lane" | C60 (drift: the map written into its own array, then columns), then C42's other associative folds; C187 is blocked on V8; C184 with the Editor lane |
| L Language and library | "Language lane" | the next goal row (stable references, free lists, multithreading) agreed with the lane that holds it; I203's editor half is with the Editor lane (L182 is with the Editor lane) |
| L Language and library | "Language lane B" | the next goal row agreed with its lane (C43's first on C waits for an example); round 12's I187 is with the Editor lane. Skip L107 (waits on Ersagun) and L24 (research). Take a row from another list only after telling that lane. |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I207 | Carried types (I203) checked against the old rechecks: every example compiled with `TERS_RECHECK=1` and without gives the same module, as a sweep test (ids canonicalised: calculus and conjugate get fresh node ids that differ from one compile to the next, carried or not, so `ters compile` isn't reproducible byte for byte). Since I210 backwards matches. Left: bounce, whose carried compile keeps 520 functions and 23 record classes against the recheck's 493 and 28 (the same output). Rechecking after hoist alone, or after withBodies alone, gives the recheck's module, and after staging alone the carried one: so a later pass reads the first check's info (with pins) where a recheck types the program's copies differently. Then run `verify` in every compile: measured 2026-11-11, elaborating a program's own definitions and verifying them takes 3 to 50 ms (wc 14, sheet 18, spacetime 49, swarm 3) against 11 to 265 ms for a warm check of the same program, and the whole library elaborated is 170 to 420 ms, so verify only what the passes made and what they reach | [REVIEW-2026-11-11](docs/reports/reviews/REVIEW-2026-11-11.md) §2 | 2026-11-11 |
| I208 | The Nightly finishes: it ended cancelled at its 30-minute limit every night from 10-31 to 11-11 (one failure, 11-04), and the `good` tag is at 10-28, so no run has checked every example compiled in two weeks. Split it into jobs that each fit, or run the compiled-examples sweep alone (Ersagun's CI budget decides) | [REVIEW-2026-11-11](docs/reports/reviews/REVIEW-2026-11-11.md) §1 | 2026-11-11 |
| I203 | A compile reads the check's written-out typing (verify.ts elaborate) instead of checking again after its rewrites, and the editor checks while one edits so a compile needs no check (Ersagun 2026-11-11). Measured 2026-11-11: checking is about 30% of `ters compile examples/spacetime` (3.3 of 10.7 s CPU), most of it stage.ts's whole check of each staged program; checking only the definitions a rewrite changed (patch in project files, i193l-infer-changed.patch) gave the same modules but no gain, since few rechecks could take that path. Of the examples only spacetime stages (its clifford calls): two whole checks of 0.6-0.7 s each, and layering the second over the first (its copies are many new definitions) takes as long (0.78 s). The passes need to carry each new node's type instead: stage.ts residualizing with the types of the values it evaluated. After I203a (#2368, hoisting carries its types): of scalar.ts's rechecks only fuse-steps fires on the examples (tumble 4 times, about 80 ms each), fold items never; layering a recheck over the check before gives nothing (80 ms either way). The compile's half, 2026-11-11 (I203a-d): hoisting, filling the uses with no body and staging's last step carry their types, and the library's kept check is found every run (I203b: swarm 5.2 to 2.9 s, collatz 5.1 to 2.8); spacetime now has no check after staging, its module the same. Measured after: checks are 0.2-1.7 s of 2-8 s compiles, each recheck left under 10% of its compile: staging's check after its copies (spacetime 0.7 s; its copies are of generic library definitions, so their types need the call's instance matched in, rows too), first-arms.ts and the library rows' checks (their checks decide: Choice left, rows that check), fuse-steps (sheet 0.34 s, tumble 4 of 70 ms; the consumer's copied fold shares its binders). Tried: the group cache on unlayered checks hits but gains nothing (its fixed cost). The editor's half is with the Editor lane (I203 (editor, a-d) in DONE.md). Example: `ters compile examples/spacetime` with no whole check after staging, its module the same | [REVIEW-2026-11-09](docs/reports/reviews/REVIEW-2026-11-09.md) §2 | 2026-11-09 |
| I195 | One gallery example is left out of the core-IR agreement test (compiler/test/core-js.test.ts) because the evaluator, which defines the meaning, is too slow: `agent`'s A* search takes minutes. L118c (a faster evaluator) would bring them back and is held by Ersagun. Example: core-js.test checks agent against the evaluator with no skip Left (2026-11-09, I195a): `numbers` is back, checked as `ters run` stores it (Nat as Int, 0.4 s in the evaluator); `agent` still takes over 400 s in the evaluator even stored, so it waits on L118c. Measured 2026-11-10 after L118c (functions that only compute compiled): `agent`'s main still over 15 min in the evaluator: 43 million calls in the first minute, nearly all of them already run as compiled JavaScript (direct), so it is the amount of work, not the machine; L118e (refs to definitions not looked for in the scope) made it 12% quicker. I195b (DONE.md): the sorted list's walks as host ways, 8.7 min (520 s). What's left is plain arithmetic in the direct run (turn, point, inside: `on mesh` for each state), whose own costs are looking binders up in the scope's linked list and wrapping each builtin's one answer; together maybe 30%, not the 10x the test needs. Tried 2026-11-10 (Editor lane): a call of a definition or builtin deciding once what callDirect asks of it, no gain (agent's cells per 15 s 39.9k to 39.0k, notebook the same). | [REVIEW-2026-11-09](docs/reports/reviews/REVIEW-2026-11-09.md) §5 | 2026-11-09 |

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
| C200 | tumble's lists stored as the costs choose (arrays: its board read by position), where they are kept as written today: a Cell of the program's lists (a lane's `queue`, `swaps`, its Board) is made on one side and read by the page on the other, and rep-split.ts refuses a Cell holding lists (a cell can't be converted where it is read). A cell made on the stored side could convert at each `read` and `write` on the other, as a field of a stored type converts. Measured 2026-11-10 (Language lane B): settling a scattered board, the most a tap makes, takes 80 µs in compiled JavaScript (2000 boards in 161 ms), against 16 ms a frame, so arrays could save at most a fraction of that: not worth building for tumble. It waits for a program whose cells hold big lists. Example: `ters compile examples/tumble` choosing `array of List` beside main's lists, the same page | C196 (its last refusal, 2026-11-09) | P3 | M | |

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C184 | The pedal's sound from the core IR as quick as compile.ts made it. Measured 2026-11-05 on one machine (bench-audio.ts): the core IR 0.037 ms a block, compile.ts's last 0.021 (its 0.036 on the machine first measured), by hand 0.009; the core IR is 4.0× the hand-written pedal. Where the core IR's time goes: building the block as a cons list and reading it back (sound.ts toList, fromList) 13%; the finite checks before each comparison 11%; the depth counter under 1%; the rest is the cons cells and the pairs a mapping-with-state builds per sample. The gap is compile.ts's lists as arrays chosen from use, which the core IR has only through the language's `array of List` row (C30). Why the pedal's lists stay as written (checked 2026-11-06, Compiler lane): `ters render --compiled` and `soundOf` lower the program as given, and with the chooser run on the sound's root (represented.ts) it still picks `List as written`, since by the declared costs a list read only in order is cheapest as a cons list; forced to `array of List`, listBoundary refuses it for the page's `styles` (an Html, a library type holding lists, which the sound never reaches), and with the program cut to what the sound reaches, for the bands' solve (a relation run backwards over a list). So the step left is the costs (an array's read in order, cheaper than a cons cell's in compiled JavaScript) and a solve over an array. Measured again 2026-11-06 (Compiler lane): the core IR 0.021 ms a block, 2.9 to 3.0× by hand (compile.ts was 2.3× by hand, so the aim is about 2.6×). A profile of the block alone: the tanh solve 16% (its answers made as a list of arrays, `solve$`, `solve$$direct`, `$clean`; `drive` is `first` over every answer of a solve that has one at most, so a solve known to give at most one answer could be a call that fails when it gives none, with no list and no chooser), the garbage collector 11%, `gain for`'s finite checks 9%, the bands' mode plan 3%. A solve of one answer or none is a call now (C184 step, DONE.md): 0.0204 to 0.0187 ms, about 2.65× by hand. Measured 2026-11-10 (Compiler lane), with the block stored as an array since C196: the core IR 5.2-5.4× by hand, the lists as written 3.1-3.4×; walks over an array no longer spend a step a call (C184 step, DONE.md), 4.5-4.6×. Left in the array walks: array.length and array.get as runtime calls (an inlined read measured 2-7%), pushFront's copies while a block is built from the back (pushFront 7.6% of a profile; starting with room for 128 measured within this machine's noise, ±15% run to run), and a pair per sample (the walk's answer and its state). Profile 2026-11-10 after that step: `gain for`'s finite checks 9%, the bands' mode plan 6%, the tanh solve about 8% ($all.one, solve$$one, $clean), the collector 4%: no one part is 10%, so the next step is the pair per sample, which needs a walk that gives its list and its state back without a record (multiple results in the core IR). Example: compiler/gaps/bench-audio.ts's core IR row within 1.1× compile.ts's on the same machine | Ersagun 2026-11-05 20:00 (what compile.ts did that the core IR doesn't yet) | P3 | S | |

### Memory and layout (STABLE-REFERENCES.md §3 to §6)

All invisible to programs: no annotations or hints (Ersagun 2026-10-29).

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C57 | A region per scope: temporaries of one page update, audio block or frame freed at once (Tofte–Talpin). Measured 2026-11-10 ([REGIONS.md](docs/design/data/REGIONS.md)): only C frees memory itself (JS and WasmGC collect), and its counted cells already come from free lists per size. Freeing is 1.6% of dice's native page updates. In swarm natively it is 17% of the run, but mostly the pairs and lists `keys of` makes each tick, which C58's next step removes. Measured again after C58j (#2274, Editor lane 2026-11-10): swarm natively 1.3 to 0.35 s, freeing 10.8% (lab_fields 8.3%, lab__dead 2.5%), nearly all the per-step array views of `moved`'s walk, which array offsets on C (Compiler lane) remove. Not built: measure again when a native program spends over 10% of its run freeing a scope's temporaries that no other row removes | STABLE-REFERENCES.md §4 | P3 | L | |
| C58 | Keyed collections as a grow-only array with a free list and generational keys (ECS). Designed 2026-11-10 ([KEYED-COLLECTIONS.md](docs/design/data/KEYED-COLLECTIONS.md)): Ters has no collection that gives out keys, and a removed key already finds nothing, so generations have nothing to do. What carries over is Lua 5's array part for small Int keys, as a run-time representation of Map (an array 20 to 25 ns a put and get against JS Map's 113 to 137 and the Table's 231). No example keeps many Int keys (agent: 8 triangles; notebook, routes, sheet: Text). (a) done: ters/examples/swarm (DONE.md C58a). Its compiled run (2000 ticks, about 2,000 motes, 2.8 s) is about half map operations, but a third is listing the keys each tick (`keys of`: the entries as pairs, sorted, then a list of their keys, mostly allocation and the collector), `value at` about a tenth, put and remove a few percent. So (b), the array part, would buy at most the lookups (under 10%), not built. (b′) taken (DONE.md C58b′): a table of Int keys lists its entries without keyOrder or a copy per entry, sorted only when the keys weren't put in order; swarm compiled 3.0 to 2.45 s. Measured after: in swarm's 2.45 s, numberEntries is 0.33 s and the pairs' map to keys and the collector most of the rest of the map's share, so `keys of` straight from the table would buy at most about 15%, at the price of a builtin on JS, C, WebAssembly and the scalar lowering; left as a row's next step, not built now. (c) done (DONE.md C58c): std's Pool gives out keys, with a free list and generations (Ersagun asked for free lists 2026-11-10). (d) done (DONE.md C58d): swarm-pool 1.6 s against the Map's 2.6 s compiled (0.82 against 1.35 native), after library types holding lists became the program's own. Next, defaults first (Ersagun 2026-11-10: the default compiled code as a data-oriented C developer would write it, Pools only for a last 10%): a hand-written data-oriented swarm as the ideal (compiler/gaps/swarm.ideal.js, 90 ms), then the plain Map version brought to it. (e) done (DONE.md C58e): tables nobody else holds changed in place, swarm 2.6 to 1.4 s. (f) done (DONE.md C58f): `keys of` straight from the table, 0.95 s. (g) done (DONE.md C58g): the keys walked by position, 0.72 s. (h) done (DONE.md C58h): native 1.05 to 0.55 s, C's Int keys radix sorted. (i) done (DONE.md C58i): C tables at most half used, native 0.39 s. (j) done (DONE.md C58j): C's keys straight into an array, native 0.35 s. (k) done (DONE.md C58k): `tick` given its swarm rather than lent it, so the map is changed in place, native 0.30 s. The opt-in Pool (swarm-pool, 1.3-1.5 s) is now slower than the default Map: each `replaced in pool` copies its items array, since owned-arrays.ts replaces in place only arrays of Ints, Float64s and Texts, and one-holder.ts refuses swarm-pool anyway, for two reasons a Map's table is spared by being a representation's jobs: `empty pool` is a value (one value wherever it is named), and `pool item` has Choice (it fails on a stale key) and reads the pool. Tried 2026-11-10 (Editor lane), not built: the Pool's definitions read as jobs, as the hash table's are, would need the types' check over Pool and Array together Measured after, by hand in plain JavaScript: the same swarm on a JS Map of objects takes 0.32 s, and V8's Map is not the cost (a window of Int keys as an array was slower). So 0.72 s is 2.2× idiomatic JavaScript, the rest spread thin (no part over 10%), and 8× the data-oriented ideal, whose gain is the motes as columns: C60's columns, for a map's values. Next for C58: C60 for a Map Int record, or C59 Measured 2026-11-11 (Editor lane, min of 9 runs): compiled swarm 0.56-0.58 s against the hand-written JS Map version's 0.38 s (examples' timings above are of a slower machine); `value at` twice per mote is the program's own (its mote and the one it follows). What is left is spread: Ints past 2^28 are BigInts on JS by design (int.ts), so swarm's random numbers (16807 · seed mod 2^31 − 1) are BigInt arithmetic, about a tenth; `keys of`'s array copied into a buffer three times its size, 4%; table reads for Int keys without `held` and `Keyed`, nothing measurable. swarm-pool 1.12-1.17 s: its arrays' replaces were versioned (replaceIn) since a push in front marked the buffer shared, not copied; the Pool's definitions read as jobs, record items allowed and pushes made on the view they were given (owned-arrays.ts) took it to 1.06 s, 6%, not built; the rest is the Pool written over lists (every slot walked for `pool keys`, the record rebuilt per change). Next for C58: C60's columns for a Map's values (Compiler lane) Measured 2026-11-11 natively (Lane B): swarm-pool 467-502 ms against the Map's 210 ms. Since C58l a function that only reads a record's array fields, or lends them on, borrows the record (`pool item`, `replaced in pool`'s check): 368 ms. Left on C: each lookup's Optional box and the pool's fields let with a count each, a 30-key `take` per mote born rebuilt item by item (a tenth), `pool keys` walking every slot. Giving a pool last in a call that also reads it (`replaced in pool(motes, key, … pool item(motes, …) …)`) saved its one copy but under 5%, not built. Compiled JavaScript (1.03 s against the Map's 0.51 s, profiled 2026-11-11): `pool item` 23% (about 30 ns a call, a JS Map's get about 20), `pool keys` 12% (every slot walked, a key record made for each), the collector 12% (a new pool record and `some` box per change), `replaced in pool` 8%, the take's pushFront 5%. What's left is the Pool as written (a record rebuilt and an Optional boxed per change, keys made per tick), not the compiler: the next step is std's Pool kept as columns of the pool's own (C60) or its definitions as jobs of a representation, as the hash table's are. Measured 2026-11-11 natively by hand (Compiler lane; swarm 0.29 s against the data-oriented ideal's 57 ms in JavaScript): by callgrind `keys of` is 17% of the instructions (its radix sort 11%), lookups 33%, the table's and keys' counts about 14%, but in time leaving the sort out entirely bought under 5%, and lending the table and key to `value at` (no count taken) about 4%; an identity hash for Int keys was four times slower (a lookup walks the removed slots of the motes gone). So a compact table in insertion order (Hettinger's ordered dict, CPython 3.6), whose gain would be the sort, isn't built; what's left is the ideal's representation itself: the motes as columns in key order with a key-to-place array, no hash. Since C58m-p (Compiler lane 2026-11-11, DONE.md): a table of Int keys starts direct (each key at its own slot, hashed at the first two that meet), its keys listed by a rotation not a sort, on C and WebAssembly, and WebAssembly's owned tables changed in place: native swarm 290 to 146 ms, WASI 550 to about 360 ms. The hand-written data-oriented C (one loop over columns) takes 18 ms; ours spends about 470 instructions a mote a tick, spread over calls, counts and tags; denser columns, untagged Int fields and lending each measured or estimated under 10%. Columns in key order not built (Ersagun asked 2026-11-11 19:51 whether to stop). | STABLE-REFERENCES.md §4 | P1 | M | |
| C59 | Flat inline layout for data built once and read, doubling as a file format (FlatBuffers). Measured on notebook after C71/C72 (GAPS.md round 6, N3: about 10% left for it there, 4.4× the ideal with no one hotspot): its index is built once with one holder (8.5× the ideal on trees) and then only read by every question (8×); a frozen map as sorted key and value arrays makes `entries of` free and `value at` a binary search. 2026-11-06 at 3000 notes (nb profile): questions are 43% of the run (seen with, like line, any scores), the index 22%; `value at` read without a list or a throw took the table way from about 365 to 300 ms against an ideal of about 83 (4.4× to 3.6×), texts compared where they differ (#2095). A frozen map would buy notebook little now: `value at` on the hash table is one lookup and `entries of` a version is sorted once (C72). What's left is spread: `credit`'s `update at` per word makes a new table version and a closure (made as `{ caps }` instead of a function, no change measured), GC 12%. Design step 2026-11-10 ([FLAT-LAYOUT.md](docs/design/data/FLAT-LAYOUT.md)): no example gains over 10%. The C and WebAssembly library tables are decoded at each start, about 10 ms natively (c-cases' program 20 to 24 ms against 12 for an empty process). The likely first real case is a program's saved file, such as a mobile app's state: time its Json load first. | STABLE-REFERENCES.md §4, GAPS.md round 6 N3 | P1 | M | after C70, C71 |
| C60 | A list of records stored as columns when its loops read few fields. Step 1 measured 2026-11-09 by hand in plain JavaScript (100,000 records of six Float64s, median of 9): summing one field 68 ms as objects against 13 ms as a column (Float64Array or plain array alike); moving each (x += vx, y += vy) 179 ms making new records, 9.7 ms changing them in place, 3.6 ms as columns. So columns pay 2.7 to 5 times, but only once three things hold, none of which does today: the list is an array (of the 39 examples only pedal keeps a list of records as one, its pairs: C196), an array read makes no object (C196 (a): today a view, an option and a pair each), and a record is changed in place rather than rebuilt (C93 s5, C56), which is the 18 times. Those three hold since 2026-11-09 (C196 steps, C56). Looked at again then: the lists of records now arrays are agent's (Vec, Triangle, Portal, Leg), spacetime's (Moment, Spacetime multivectors) and pedal's pairs, and each loop over them reads all or most of the record's fields (a point's x and y, a moment's four, a multivector's sixteen in a product), so columns would buy nothing yet. Agent's compiled run spends 45% in `point` (mesh.points by position), which turns the whole Array of points into a cons list on every read: `point` is on the side kept as written, so `item at` there goes through `items` (passed to the Compiler lane, C196). That program is examples/drift (2026-11-10, Compiler lane): 100,000 motes of nine fields, x and y moved by vx and vy a hundred times. Compiled 3.3 s; by hand (compiler/gaps/drift.ideal.js) records rebuilt 2.6 s, changed in place 0.14 s, as columns 0.08 s. The motes are an array already, but each step's `map` builds a new array and a new mote per item (the lowered map pushes onto an empty array from the back, and calls `moved` as a closure, not its in-place copy that C56 made); the map's array written in place with each mote changed in place was 0.33 s by hand (10×). Since then each mote is changed in place in the map (zero-parts.ts keeps binders): 0.47 to 0.63 s. Since then a map of an array nobody else holds writes into it (owned-arrays.ts mapsInPlace): 1.10 s at 300,000 motes against 1.34. Since then the motes are columns (columns.ts, c1 of docs/design/data/COLUMNS.md): about 0.5 s CPU at 300,000 motes against 1.5. On C a map writes into its array since c2a (native drift 2.85 to 0.52 s; hand-written C rows 0.10 s, columns 0.04 s). Since c2b the native loop reads and writes fields in their slots (0.60 to 0.28 s CPU), since c2c a read lends its array (0.15 s), and since c2d the buffer holds columns (0.12 s). On WebAssembly a map writes into its array since w1 (2.2 to 0.75 s), and since w2 the motes are columns there too (0.33 s, with C207e's inline Int paths). Left: swarm's Map of motes (compiler/gaps/swarm.ideal.js, 90 ms against 0.72 s compiled) after; c3, an item leaving whole made from the columns there, only for an example that wants it | STABLE-REFERENCES.md §4 | P1 | L | Compiler lane |

### Parallel and concurrent code on the targets

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C211 | WebAssembly as quick as native C on number-heavy examples. Survey 2026-11-11 (one thread, best of 3, Node's WASI, outputs the same; about 34 ms of each WASI run is Node starting): after C207k (DONE.md), swarm 1.43 s against 0.36 natively (4x: its Map Int's puts, removes and `keys of` each tick; since C211a 0.70 s, its keys sorted by a radix sort; since C211c about 0.59 s against 0.29), herd 2.05 against 1.39 (1.5x, mostly V8's sine: platform cost, each platform's own sin by SPEC §10.3, not a gap to close), queens-count 0.17 against 0.09 (1.5x past Node's start; since C211d CPU 0.161 to 0.136 s, the rest its array made from a list each placement), divisors 0.18 against 0.12 (1.3x; since C211b 0.12, its counts as i64s); collatz 0.40 against 0.18 natively, since C211e 0.35, its 3n + 1 one test and its compares, masks and shifts as instructions). Since C58o/C58p swarm 0.36 s (direct Int-key tables, keys by rotation, owned tables changed in place). Left, none worth 10% alone: swarm's rest is spread (its walk's rests a view each: array-offsets.ts on WebAssembly measured no gain 2026-11-11; its motes' Ints boxed); collatz 0.29 against 0.18, its loop already inline i64s | C207k survey | P1 | M | Compiler lane |
| C207 | The default C of number-heavy loops as close to hand-written C as possible (Ersagun 2026-11-10 15:34: defaults first). Since C207a Int operations are inline fast paths (collatz natively on one thread 0.49 to 0.28 s; hand-written C 0.154 s). Since C207b `array of` a range is filled at once and dropping a count is inline (divisors 0.87 to 0.45 s; hand-written C 0.092 s). Since C207c a fold of a map is one fold (fuse-steps.ts; divisors 0.42 to 0.24 s, nicomachus 0.43 to 0.049 s). Since C207d a fold over `array of` a range counts down with no array (divisors 0.24 to 0.155 s, 1.7x hand-written C). Since C207e WebAssembly's Int add, sub, equal and less are inline while both are i31s (divisors 0.47 to 0.21 s, collatz 1.88 to 1.48 s under Node's WASI). Since C207f a fold to a function applied at once (`fold xs from d = …`) is a forward loop (queens-count 0.25 to 0.12 s; hand-written C 0.03 s; its search, the choice and the placed list made per step, is the rest of its gap). Since C207e on C a loop's counting Ints are int64_ts (untagged-ints.ts; divisors 0.19 to 0.14 s, nicomachus 31 to 12 ms). Since C207g an array's item is read on C with the array lent (queens-first 7.7 to 6.8 s at n = 28, hand-written C 2.3 s; queens-count 97 to 83 ms). Since C207h a loop checks its unchanged Float64s on its first step only (finite-checks.ts; queens-first 6.8 to 5.5 s, queens-count 90 to 72 ms, divisors 0.14 to 0.11 s). Since C207i a loop that only computes on Ints keeps all of them as int64_ts, a round leaving the small range starting again as written (collatz 0.29 to 0.21 s; since C207q its 3n + 1 is one test of n against the bounds, 0.21 to 0.18 s, hand-written C 0.154 s). Since C207j a Float64 made from a loop's count isn't checked finite (divisors 0.557 to 0.482 s at 20000 500). Left: divisors' product `floor(x / d) * d` is still checked, since it can overflow with x near the largest Float64 (dropping it would buy another 15%, given a bound on x); divisors' Float64 division; since C207l an array's or list's Float64 items known finite and not below zero aren't checked as read, nor the distance between two (queens-first 6.2 to 4.3 s at n = 28, hand-written C 2.3 s); since C207m `safe`'s fold gives false once it is (queens-first 4.3 to 3.4 s); since C207n those two hold under a search on the threads too (queens-count 0.46 to 0.40 s at n = 12 on one thread, hand-written C 0.12 s); since C207o `safe` enters its counted loop at once (queens-count 0.39 to 0.35 s, queens-first 3.4 to 3.1 s); since C207p a choice from a range counts through it with no list (queens-count 0.34 to 0.28 s, queens-first 3.2 to 2.5 s against hand-written C's 2.3 s); since C207r an array is lent to a function or loop that only reads it, no count taken and given back (queens-count 0.28 to 0.225 s, queens-first 2.5 to 2.3 s, level with hand-written C); since C207y a Float64 at most 2^1000 (a count, a range's item, one plus a number up to 2^940) is known, so the sum of two such needs no check, and with none left C207m's loop stops once false (langford at n = 13 natively on one thread 66 to 50 s, hand-written C 32 s; compiled at 10, 0.38 to 0.26 s); next queens-count's placed list (an array pushed onto per placement, hand-written C 0.12 s) | defaults-first | P1 | M | Compiler lane |
| C42 | Associative folds on a thread pool (a `map` of a function that only computes shares its items on workers since C42a, examples/mandelbrot-rows; since C42b a fold of a list adding an Int worked out for each item, examples/collatz's `steps of all`, and since C42c one keeping the largest or smallest, its `most steps`), later maps and folds as compute shaders (NESL, Futhark). Since C42d a record of Ints, each field added to or compared with an Int of the item's (examples/collatz's `walks of`: compiled 1.13 to 0.90 s, native 0.33 to 0.23 s). Since C42e a fold whose join is no sum, where each item's work only reads the item: that work shared as a map, the join in turn (examples/fingerprint, compiled 6.1 to 2.1 s). natively 1.55 to 0.44 s since C42e native. Since C42f a page's fold adding an Int for each item, or keeping the largest or smallest, runs on the GPU as WebGPU kernels of its item's arm, the rest's Int given as the join's identity (gpu-maps.ts; examples/collatz's `steps of all` in a page's handler, checked in headless Chromium's WebGPU). Since C42g a page's fold to a record of Ints likewise, on its workers and on the GPU (collatz's `walks of`). Left: other associative joins whose putting together is itself costly (none in an example yet: ledger, wc, routes, numbers, calculus, lockstep surveyed 2026-11-11) | LANGUAGE-NEEDS-2026-10-24 | P1 | L | |
| C195 | Relations in WebAssembly and C: a solve has no lowering outside JavaScript, where it is the evaluator's solver or a plan printed as JavaScript text (core-solve.ts, modes.ts), so `ters wasi` and `ters native` stop at "solves a relation (not in this profile yet)" (scalar.ts solveUse). A plan written as code the scalar profile lowers (as `derive` writes a derivative) would reach every target. Example: `ters wasi` of examples/relations, backwards, conjugate and physics printing what `ters run` prints (the other 16 examples with a main that isn't a page already do, 2026-11-06). Surveyed 2026-11-06 04:00 (Language lane, which took the row): no one step gets an example there, since each needs a different kind of solve. relations: split and add are solver plans with one way (`once`), square has two answers, polar is numeric or periodic. backwards: angle is `once`, greet a mode plan, magnitudes to is neither (relate.ts runs it). conjugate: brighter is neither (a conjugation of closures). physics: fall is numeric, rotate periodic. Steps: (a) a `once` solver plan (relation.ts compileSolve's `$one`) and a det or semidet mode plan (modes.ts) written as Ters definitions the scalar profile lowers, with `$clean`'s 12-digit rounding as a builtin on C (`%.12g`) and WASM, `$ok` and `$close` as arithmetic; (b) a solver plan with several answers as a Choice (square); (c) numeric plans (tearing, Newton) as Ters code (polar, fall); (d) solves relate.ts runs (magnitudes to, brighter), each a row if it earns one. Done: (a) for solver plans (C195a, 2026-11-06), (b) for ways without a periodic parameter (C195b, 2026-11-09). Mode plans with one answer or none (greet) done too (C195c, 2026-11-09). Tears of one unknown in a search (physics' fall) done too (torn.ts, 2026-11-09). Periodic ways where only a first takes the answer (physics' rotate), and for some over one predicate, done too (2026-11-10): physics prints on WASM and C what ters run prints. A first of a call of a definition that is one such solve (relations' to polar) writes its body in place there (2026-11-10): relations prints on WASM and C what ters run prints. Relational solves with several answers in a search (backwards' magnitude, every answer as a list, one chosen) and text joined with neither side known (cuts) done too (2026-11-10); backwards' main then stops at read numbers (show numbers unfolded). Found 2026-11-10: relate.ts gives answers by miniKanren's mplus, which takes the next arm's first answer whenever one suspends (each unfolded level, a recursive call), so every answer of an unfold or a recursive mode comes interleaved (square roots of each([4, 9]) is [2 3] [-2 3] [2 -3] [-2 -3]); written code would need that order (a breadth-first queue of suspended arms), or first-only readings. Until then, mode functions giving every answer refuse calls and unfolds. Left: periodic ways in a search whose every answer counts (all, count), and solves relate.ts runs with several answers (backwards' read numbers, square roots of each). Periodic ways, found 2026-11-09: to polar is a several-answer definition that main reads through first, so the solve is in CPS code, not under the first. The solver's stream goes by levels, L = 0 to 10^4, each the whole plan again with every k from −L to L, giving only answers no earlier one had and stopping at a level L > 0 with none new. Written out exactly, that is a loop over levels, a k list built per level, and a dedup check that runs the plan again over every earlier path, all in CPS: a large step. The cheaper way, level 0 when a first takes the answer, needs the first to be seen through the definition's call (first-arms.ts could carry it) | Compiler lane 2026-11-06 (ters wasi survey) | P3 | L | |
| C187 | Fibers in WASM (JSPI, or the stack switching proposal): a program's own handlers that keep the rest, and together and race, as C44 runs them natively. Example: fibers-c.test's generator and together, run through `ters build --wasm` printing what ters run prints. Checked 2026-11-06 04:10 (Editor lane): this container's Node 22.22 has neither (`WebAssembly.Suspending` undefined even with --experimental-wasm-jspi). Headless Chromium 141 has JSPI on by default, but JSPI resumes a suspended stack only through a promise, so a case's `rest(y)` can't give the fiber's answer back synchronously as C44's does: the whole program would have to run under `promising`, every rest a suspending import. The stack switching proposal (WasmFX: cont.new, resume with `(on tag label)`, suspend) is C44's fibers one to one and synchronous. Chromium 141 validates it behind `--js-flags=--experimental-wasm-wasmfx`, but a resume with an on-label handler of a tag [] -> [] failed to compile there ("handler generates 0 operands, target block returns 1"), so V8's encoding of handlers needs checking first. Checked 2026-11-10 (Compiler lane, a hand-assembled generator: tag [i32] -> [], cont.new, resume with (on tag label), suspend, in Chromium 141.0.7390.37 with the flag): V8 validates a handler's label as receiving the tag's values only, not the continuation ("handler generates 1 operand, target block returns 2"), and with the label typed so the module compiles, the continuation is unreachable, so a generator can't go on. Blocked on V8 shipping handlers that pass the continuation; JSPI stays promise-based. Check again with a newer Chromium (playwright's) before building | C44 | P3 | L | blocked on V8 |


### Mobile (Ersagun 2026-11-09: a goal; native compilation per platform a stretch goal, instead of a webview. Down since 2026-11-10 14:49, behind stable references, free lists and multithreading: "Platform stuff will eventually be solved anyway")

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L234 | **Asking what a platform has, as ordinary code.** A program asks with a plain Bool, `supports(Camera)` (or one per effect), and chooses with an ordinary match: no button, or another UI altogether. Each target says which effects it answers, so when compiling for one target the answer is a constant. The match folds (stage.ts) and the branch it drops is never compiled, together with everything only that branch reaches: the camera's photo and upload logic and its UI aren't in a build that has no camera. No compiler directives. In the evaluator and the editor the answer is the current host's. Needs lowering only what main reaches (DEBUG-AND-SPEED-2026-11-04) | Ersagun 2026-11-10 13:47 (Learn thread: multiplatform UI) | P3 | M |  |
| C204 | `ters build-native-app` answers the program's own effects: it reads `hosts/c.c` as `ters native` does (main.ts uses c.c only for `native`, so a native app's foreign effects have no host today). Also add a way to reach Android's Java APIs (camera, storage) without writing JNI by hand, e.g. a `hosts/android.java` the shell calls | Ersagun 2026-11-10 13:47 (Learn thread: multiplatform UI) | P3 | M |  |
| C205 | Native pages say what they can't show: an element the shell doesn't know becomes an empty FrameLayout, and CSS outside the subset (hover, transitions, combinators) is dropped without a word. List them at build time, and refuse where the page would mean something else (NATIVE-APPS.md planned a refusal) | Ersagun 2026-11-10 13:47 (Learn thread: multiplatform UI) | P3 | S |  |
| L235 | Foreign views: a program declares a view kind of its own (a map, a camera preview) the way FOREIGN.md declares operations, with one view per platform in a host file (a DOM element on the web, an Android View, a UIView), mounted by `Html` like any element. A platform with none is answered through L234 | Ersagun 2026-11-10 13:47 (Learn thread: multiplatform UI) | P3 | M | after L234 |
| L236 | Platform lifecycle as effects a page can handle: back, pause and resume, permissions asked and answered (popstate and visibilitychange on the web; onBackPressed, onPause and the permission dialog on Android; their iOS counterparts with C199e). Keep one meaning in the language; each shell maps its own events | Ersagun 2026-11-10 13:47 (Learn thread: multiplatform UI) | P3 | M |  |
| C198 | Revive `ters build-app` and run one app on a phone. It makes an installable web app (manifest, service worker, icons) that is also a Capacitor project for Android and iOS (ters/cli/app.ts, WEB.md "Mobile"), untouched since 11-02, and no app has been run on a phone that we know of. Check it still builds on today's `ters build-web`, works offline once installed, and that the Capacitor project builds an Android APK; ask Ersagun to install it, since containers can't reach a phone. Example: `ters build-app` of dice installed on a phone and played offline. Found 2026-11-09 (Compiler lane): it builds, and plays offline in Chromium; containers can't reach Google's Android SDK, so the Actions workflow "Android app" (#2146, run by hand) builds the APK; waiting on Ersagun to install it | I194 (REVIEW-2026-11-09 §6); Ersagun 2026-11-09 | P3 | M | Compiler lane |
| C199 | Stretch: native apps per platform instead of a webview. Designed in docs/design/targets/NATIVE-APPS.md (2026-11-10): the program through the C target, a thin native shell per platform, and a view host in C mirroring html.ts's `Doc` and `El`; step C199e left (C199a to C199d done). Example: dice as a native Android app with no webview | Ersagun 2026-11-09 | P3 | L | C199a to C199e |
| C199f | The other page examples as native apps, each checked against its web version as dice was (behaviour on the headless host against html.ts, layout against Chromium at 360 wide). Surveyed 2026-11-10: tumble, bounce, compass, constructions and agent lower for C; converter (show as a value), pedal and spacetime (a relation run by the relational interpreter) and pig (a match on data in `recorded into`, lowered since) were refused. tumble, compass and constructions show what html.ts shows, bounce mounted and over three seconds of frames. Pictures are drawn now (paths, arcs, circles and the rest, paint from the sheet; within 0.1 of Chromium for compass, bounce and constructions), and tumble's APK builds (Android has no ucontext; fibers switch with setjmp there). Pointer events now reach boxes (tumble's taps, checked on an emulator by the Android check workflow) and pictures (C finds the shape under the finger, so compass's points drag). Animations run on the screen (tumble's steps go on when one ends). Tumble swaps by a drag too. Boxes clip with overflow: hidden, and min-height keeps a box's room (tumble's status no longer reflows); max-height with overflow: auto scrolls (pig's log). pig lowers and plays in C (its own handler of Random). Native pages have the web page's base sheet, and borders on one side. Left: :empty and other pseudo-classes in native sheets; Ersagun's try of the new APKs. Example: tumble on a phone with no webview | C199 | P3 | M | |
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
| C210 | A quantum target for the reversible part: a function that is `det` both ways over fixed-width Ints printed as Toffoli/CNOT gates in OpenQASM 3, with Bennett's uncompute added by the compiler. Superposition and measurement would be a language layer (Choice with amplitudes), not part of this row. Waits until the current goals are done and Ersagun asks. Example: a 4-bit adder's circuit agrees with the evaluator on all 256 inputs in a small permutation simulator | [REVERSIBLE-AND-QUANTUM-2026-11-11](docs/design/targets/REVERSIBLE-AND-QUANTUM-2026-11-11.md) §6 | P3 | L | |

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
| L240 | A Markov chain's stationary distribution as an editor example on `settled` (L239): a quickly mixing chain, a slowly mixing one with its large bound, and a periodic one with no answer. Example: the three in the editor's examples, each answer or none shown | [FIXPOINT.md](docs/design/relations-and-effects/FIXPOINT.md) (L238), Ersagun's fixed-point discussion 2026-11-11 | P3 | S | |
| L241 | The compiler picks Newton for `settled` when its step has a few Float64 unknowns and a derivative (derivatives, as `inverse` does). Example: `x = cos(x)` as `settled` in 4 steps instead of 52 plain rounds, to 1e-9 from 1.0 | [FIXPOINT.md](docs/design/relations-and-effects/FIXPOINT.md) (L238), Ersagun's fixed-point discussion 2026-11-11 | P3 | M | |

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
| T14 | The slowest single tests (steps a to p done, DONE.md; shaderOpens 27 to 19 s by T14p). Example: editing.test.ts's swapAndUndo, 20 s now; done at 5 s. Left: the graph's wire values running fall backwards after each pick (editor/main.ts traceInputs), resolving arith.ts for each version's search was 8 of its 34 s (2026-11-05 17:00): the library's resolving seed was never made after #1860, fixed by #1928, 27 s since. Of the 27, the palettes' whole checks are 6 s: 266 checks, 213 of them refused because the filling breaks the held definition's pin ("is pinned to (a, a, a) -> a …, and this makes it (Float64, …)"). Those are refused before the check now (E103h): swapAndUndo 27 to 24 s. Beyond it, a row each if they earn one: the next slowest file (swapAndUndo 29 s on main at 18:20, 20 s after E103i: its two pages each check the library once, no repeat; the rest is drawing's types 4.2 s and the palettes' whole checks 3.6 s; simplifyAppend 14 to 12 s by T14n: a value written into a hole was checked with no options, so the library was checked a second time; listItems 12.0 s, implementInterface 13.5 to 5.9 s by T14o: a click on a side link that isn't there waited 5 s and was caught silently; the file's other silent catches don't wait), measured by stage. Measured, not built (2026-11-05 19:40): the whole editing.test.ts is 225 s, of it model.ts nodesWhere's own scan 25 s (Object.values of the ~27,000 nodes, for a program not on the library's layer) and the garbage collector 29 s; scanning by id instead took 225 to 219 s, under 10%; keeping the scan per version of the nodes would earn more, if code.nodes is never changed in place, which isn't checked yet Measured 2026-11-11 (Editor lane): editing.test.ts 205 s, shaderOpens 21 s, swapAndUndo 17, simplifyAppend 14; in shaderOpens, scans of a whole program not on a layer (nodesWhere) are 2.4 of 20 s, about 250 scans of a dozen programs, each program and kind scanned 2 to 7 times, so keeping them per version would save under 10%; the rest is spread (garbage collector 1.2 s, children 1.2). Measured 2026-11-11 PM (Editor lane, T14r): each test page now keeps the checks a browser would keep between visits (editor-page.ts's IndexedDB for checkStore.ts), so a file's pages after its first read the library's check and resolved arithmetic back: editing.test.ts 218 to 162-168 s, swapAndUndo 20 to 15 s. | [TEST-SPEED-2026-11-03](docs/reports/TEST-SPEED-2026-11-03.md) | P3 | M | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805), tests reached by a one-line text.ts edit (145/150 + 44/44) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P3 | postponed (Ersagun 2026-11-10: until people want to use Ters) |
