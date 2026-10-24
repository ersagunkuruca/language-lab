# Backlog

Every open item from every source, in one place. How it's used, the lanes and
the priority criteria are in [WORKFLOW.md](WORKFLOW.md). Each lane's list is in
priority order: a lane takes its top item that isn't running.

First gathered 2026-10-23 from projectional/ROADMAP.md, NOTES.md, WEB.md,
NUMBERS.md, COMPILER.md, REVIEW.md, REVIEW-2026-10-22b.md (R2), QA-2026-10-22.md,
QA-2026-10-23.md (QA2), QA-2026-10-23b.md (QA3), compiler/GAPS.md, the editor and compiler threads'
queues, and Ersagun's messages in the project chat.

**Status:** ▶ running (don't disturb) · ⏸ parked · blank = waiting.
**Size:** S hours · M one PR · L several PRs or a design note first.

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|

## E: Editor

Thread "Writing programs in the editor". Current step: the can't-edit list,
so the next bigger program can be built in the editor.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## C: Compiler and targets

Thread "Bigger programs and compiler gaps". Current step: the items below in order.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C17 | Native binaries through C with reference counting, stage N5 of projectional/NATIVE.md, reuse and measurements (N1 to N4 done) | ROADMAP 6, NATIVE.md | P3 | L | |
| C18 | Mobile as a packaged web app (PWA or Capacitor) | ROADMAP 7 | P3 | M | |

## L: Language and library

Thread "Backlog and planned workflow", which also keeps this file current.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L11 | Mode analysis through cases and folds (the general fix for backwards search order). Design: projectional/MODES.md. Next: lane E shows the mode on the `solve` node | R2 §3, ROADMAP step 4 open | P2 | L | ▶ L11a to L11e done |
| L12 | Tutorial and its screenshots brought up to the current editor | ROADMAP 2 | P2 | M | after the editor step |
| L16 | Guarded corecursion, and a stateful handler form so programs write their own Cells | ROADMAP 4 open | P3 | L | |
| L17 | Data-type upgrades and path namespaces for modules | ROADMAP 5 open | P3 | L | |
| L18 | Relational reads past about 1,300 items; a stackless `relate.ts` | ROADMAP 1-5 open, real-sized data | P3 | M | show numbers reads back 3,000 numbers since L11c (each level of a fold run backwards starts on a fresh stack); plain recursion still uses the stack |
| L19 | Numbers stage 1: Int as data (match/fold view), Rational; stage 2: overloading by name | NUMBERS.md | P3 | L | |
| L20 | `set` with general functions through relations | real-sized data follow-up | P3 | M | |
| L21 | Folds: a `build` row for user producers, user representations per value, folds with `Choice` asking the table | ROADMAP 5 open | P3 | L | |
| L22 | Profiles inferred like effects and shown in the editor ("runs on the GPU"), instead of a second checker in the compiler | R2 §5, REVIEW.md §5.2 | P3 | L | |
| L24 | Research as it becomes blocking: costs from folds, laws proved by fusion, fast invertible parsing, exact reals, Clifford algebras | ROADMAP 8 | P3 | L | |
| L29 | Function variables' rows checked in any order: a use that fixes a variable's row wider before the use that closes it (a page field's `view` handed to `inverse` before it's shown) still clashes; the closing use should win, as it does in the other order. And the checker typing `inverse(f, …)` from f at the call, as the modes already do, instead of Diverge | L14 | P3 | M | |
| T7 | Tests in the language: accepted answers next to examples.json inputs, laws as definitions with a `Check` effect, results cached by definition hash and re-checked on save (Unison prior art). Design note first | projectional/TESTING.md T7 | P2 | L | |

## Testing and fast feedback

Thread "Testing strategy and fast feedback", which owns `.github/workflows`
since 2026-10-23. Plan and measurements: projectional/TESTING.md. T1-T3,
T4 to T6 are done; T7 is in lane L.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P1 | PRs #43 and #44 open since 2026-10-22 morning, likely superseded by #49: close or land | R2 §8 | P2 | |
| P2 | Batch deploys (deploy is its own workflow) if Actions cost needs it | Ersagun 2026-10-23 08:26 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |

## Done

Recent first, one table per lane so that lanes finishing items at the
same time don't edit the same lines. Older history is in git and in the
roadmap's Done table; this section keeps about a week.

### E: Editor

| id | item | PR |
|---|---|---|
| E48 | Steps done for their effects start at the left edge, so a big main (Numbers & physics) opens with its first steps in view; was Inbox I2 (QA3 L4) | #300 |
| E47 | Pages keep running across program switches; dice says Rolls: 1; ray marcher constructor is rgb (no colour₁). L4 lopsided first view is the layout's shape: Inbox I2 | #298 |
| E46 | CPU picture: still or paused (click) pictures redraw sharp at canvas size; one-line status | #296 |
| E45 | Folded box names its calls; unfolding moves contents to the nearest clear place (tidy keeps a folded frame's space on purpose) | #295 |
| E44 | Run main in a worker with Stop; Countdown's run keeps frames under 60 ms | #294 |
| E43 | Palette arithmetic reads names in scope: x * 2 in double(x) | #292 |
| E42 | Undo first in the phone top bar; hints say tap and long-press on touch | #291 |
| E41 | Pinch to zoom in the graph: two fingers zoom about their middle and pan with it; the one-finger pan and the long press step aside for the second finger | #290 |
| E40 | One pane at a time below 900 px wide or 500 px high (phones either way up, tablets); the stacked layout is gone; the smoke checks 844x390 and 768x1024 | #288 |
| E39 | Keyboard: Enter in a literal's or name's field saves and returns to the program; Enter on a call opens its menu on Change the function; Shift+F10 / Menu key opens the menu, arrows move, Escape returns | #287 |
| E38 | By touch, Pick keeps every picked node: the tap ending a long press landed on the graph redrawn for the menu as a click; when a touch last opened a menu now outlives one drawing | #285 |
| E37 | The minimap copies the graph (classes kept, ids and data-* dropped) instead of drawing it through <use>, whose copy rules like .tgraph .rg don't reach: frames were black | #283 |
| E36 | Touch: a long press opens the graph's menu (iOS has no right-click), the menu's Pick stands in for shift-click, and a picked dot drags to move as alt-drag does | #278 |
| E20 | Phone width: under 600 px one pane at a time (Programs, Graph, Text, Run) from a bar at the bottom, instead of a 4,614 px page; the smoke checks it at 390x844 | #277 |
| E35 | Frames fold into one box (▾, or right-click): wires in end on its left, values out leave on its right; it sits where its contents put the frame, so dragging or tidying it moves them. A view in layout.json | #275 |
| T4 | A quicker smoke: each program's first definition, main and an eighth of the rest per change (all nightly), and graph clicks only where a click reaches (402 half-second timeouts a run were frames under their contents): 5 min 40 s to 1 min 22 s | #274 |
| I1 | Without a GPU the ray marcher's colour record runs as WebAssembly (WasmGC struct, read by the module's field readers), not JavaScript: 244 to 144 ms a frame at 160x160 | #272 |
| E19 | A map in the graph's corner while part of it is out of view (the 'there's more' cue); click or drag to look there. Collapsible frames split to E35 | #270 |
| E18 | Wires bend over or under nodes in their way when a short detour crosses no more wires: tunnels 333 to 136, bridges 410 to 438 | #263 |
| E17 | Tidy reorders columns to cut crossings (Sugiyama barycenter + swaps) and stops pushing nodes across wires: examples 410 to 375 crossings after tidy (was 522) | #256 |
| E21 | Int literals in the palette ("an integer"): already there since 79f95d0; closed on review | none |
| E16 | Copy into my program and Pin this type: already in the Definition tab since 0ca7b27 (Oct 22); closed on review | none |
| E34 | Programs have a comment like definitions; each example's credits became that comment, credits.json is gone (Ersagun 19:34) | #253 |
| E15 | Tab and Shift+Tab step through a program's parts in reading order; Enter edits the selected one | #251 |
| E33 | Bug: a list of tall items showed as cons(…) in the blocks (Ersagun 19:16) | #248 |
| E14 | Palette: most-used first, √ finds sqrt, typed arithmetic fills as calls | #247 |
| E32 | Picture CPU fallback and its GPU check run in Float32 | #245 |
| E31 | Same-label palette rows name their holes' types: show(□: Int) | #244 |
| E30 | Add a value before this… puts a step anywhere, inside one arm of a match | #242 |
| E29 | A short text literal gets a new line with Shift+Enter | #241 |
| E28 | An untyped input can be called from the palette: before(□, □) | #239 |
| E27 | A whole number typed in an Int hole fills it as an Int | #237 |
| E26 | Definitions that print or write files run only when asked | #236 |
| E25 | Text view brackets a one-line if inside ++ | #234 |
| E24 | Graph keeps the spaces in a text literal (SVG collapsed them) | #231 |
| E13 | Navigator search finds definitions in every program | #227 |
| E12 | Unit refusals name the units on both sides | #223 |
| E23 | Bug: the live page's buttons went dead after opening another definition (Chrome drops listeners when the frame is redrawn) | #221 |
| E11 | The zoom button shows the zoom; Fit keeps clear of the pill | #215 |
| E10 | A program opens on `main`, its showcase definition in the next tab | #212 |
| E9 | Solver output writes powers as superscripts (`time²`) | #211 |
| E8 | Nested view listed a comment on a called lambda as two footnotes | #207 |
| E22 | Long and multiline text literals render compactly (first line + "· N lines", full text on hover, multiline edit box) | #206 |
| E7 | Add a value here: palette 7.5 s → 1.7 s on solved functions | #203 |
| E6 | Show inline refits the graph; canvas labels get a halo | #199 |
| E5 | Tabs: six at most, shrink to fit the pane | #196 |
| E4 | Remove a used input: its uses become holes | #194 |
| E3 | Clearing a node keeps its definition's type while the hole is open | #191 |
| E2 | Reorder an action's steps: Do it earlier / later | #184 |
| E1 | Inner lambda parameters: add, remove, reorder | #179 |
| | Right-click menu edits show what they selected (QA2 H1's last part) | #177 |

### C: Compiler and targets

| id | item | PR |
|---|---|---|
| C7 W4c | Abort in WebAssembly: status 2 with the reason in a global (the host reads it with `Abort.reason`); a match on Abort is a block that takes status 2, puts the fuel back as the evaluator does and gives its arm; first, optional, all, count and budgets let it go on out. Everything in wc, ledger, chapters and calc but their Console and Files parts compiles: calc's tokens, parser and evaluate, and ledger's entries and report (a 2000-entry book) give the evaluator's answers and reasons | #284 |
| C7 W3b-1 | The world in WebAssembly through a JavaScript host: Console and Files as imports from `world` (one that fails gives status 2 and then `world.reason`, an Abort where it was called); `runMain` runs a main as `runProgram` does. wc, ledger, chapters and calc run whole, main included, and print, write files and exit as the evaluator does | #286 |
| C7 W3c | mod and the show of a Number written in WebAssembly: mod from musl's fmod (adapted, credited), exact against JavaScript on edge values; show writes tiny numbers (1.5e-7) itself, and fixes wholes past 2⁵³ (they had wrong digits). Countdown runs as a WASI command with no JavaScript at all (imports only fd_write and proc_exit). Left for a JS-free host: sin and the other Math functions (refused with a reason), and a show needing 15 or more digits (traps) | #297 |
| C17 N4b | Native programs, stage 4b: whole programs in C. The console and files over the C library and POSIX, with Node's world's words for failures; main gets the arguments and runs on a thread with a 1 GiB stack (calc's 100,000 nested parentheses), its Int the exit code, an unhandled Abort's reason on standard error with 1. `lab native <program> [-o out]` writes the C and builds it. wc, ledger, chapters, calc, queens and the world fixture give the evaluator's output, errors, exit codes and files on 70 runs | this PR |
| C17 N4a | Native programs, stage 4a: Int, Text and Abort in C (compiler/src/c-rt.ts). An Int is one word, the value while it fits 62 bits, else a counted cell of limbs (Knuth's Algorithm D as Hacker's Delight writes it, credited); a Text a counted UTF-8 cell; Number shown as JavaScript's String; Abort as status 2 with handlers as labels. Calls are statements, in order (an argument's call may drop a cell another argument reads). Calc's big Int arithmetic, tokens and parser, chapters, wc, ledger's amounts and aborts, and the converter give the evaluator's answers with every cell freed | #314 |
| C17 N3 | Native programs, stage 3: functions as values, one answer or none, and searches in C (projectional/NATIVE.md). Closures are counted cells holding their captures, called through a typed pointer and owning the closure; a partial function sets a status and gives a stand-in value, each call checks it and leaves through a label that drops what it owns; first/optional/all/count and failing budgets are a body, then a label for none. Countdown's whole search (solutions), algebra's evaluate, simplify and newton, calculus's partial definitions and the Peano and binary numbers give the evaluator's answers with no cell left, under AddressSanitizer too. Found on the way: ±∞ counted as whole numbers in the shared lowering (so WebAssembly and shaders too), now as Number.isInteger; `and`/`or` evaluate both sides in C as in WebAssembly | #313 |
| C17 N2 | Native programs, stage 2: data in C with reference counts (projectional/NATIVE.md). Cells per case, a static one for each case with no fields; dup and drop from liveness while printing (a use is the last or a dup, a branch drops what it doesn't use, a field read borrows), Perceus's (Koka) liveness half; a cell's fields are freed from a stack, not by recursion. sort, the calculus polynomials (100,000 coefficients), Countdown's valid, algebra's derivative, equal on lists and a rose tree's folds give the evaluator's answers, with no cell left after each call, also under AddressSanitizer | #312 |
| C17 N1 | Native programs, stage 1 (design: projectional/NATIVE.md, C from the same lowering with Perceus-style counts): the scalar profile and records print as C (compiler/src/c.ts), structs by value, self tail calls as loops, budgets; calculus, physics, the ray marcher's colours and the strip integral give the evaluator's bits with GCC and clang. Math is V8's fdlibm translated to C by compiler/math/to-c.ts: Node's bits on 140,000 inputs. C runs a call's arguments in any order (GCC right to left), so later stages put the impure ones in locals first | #311 |
| C11 | G17's copy per type for generics used at several types, measured and left: what a type changes in compiled JS is equality, and none of the 17 example programs with a main compiles a generic `$eq` any more (converter's one compares Optionals, not a generic); the one-type case (round 2) was already within noise on chapters, since `$eq` answers texts and numbers at once. Reopen with a program where a generic compare at two types is hot | #310 |
| C21 | G1's full fix: recursion that isn't a tail call goes on the heap in compiled JS, so pages and imported modules go past about 1,500 levels. A definition in a cycle of calls gets a generator copy whose calls in the cycle yield; past 1,000 such calls on the stack the call runs that copy under `$drive`, which keeps the waiting calls in an array (Kotlin's DeepRecursiveFunction, trampolined style; credited). calc takes 100,000 nested parentheses on Node's default stack (845 ms; before, it stopped near 1,500), and its sessions take the same time. Shallow calls pay a counter; a catch that goes on, and each page update, puts it back | #309 |
| C7 | WebAssembly for full programs (WasmGC), all five stages of projectional/WASM.md: data, closures, text and the world (also as WASI commands with no JavaScript, Math included), searches and effects, Int past 64 bits. The last W1 item, one cast per arm rather than per field read, measured and left: V8 with every cast skipped (`--experimental-wasm-assume-ref-cast-succeeds`) runs Countdown in WebAssembly no faster (79-88 ms against 74-88, noise), so fewer casts can't buy anything | #308 |
| C7 W3e | Math with no JavaScript host: under WASI, sin, cos, tan, exp, log, pow and atan2 are V8's port of fdlibm (what Node's Math runs; Sun's and V8's notices kept, credited) compiled by clang to WebAssembly and turned into runtime functions by compiler/math/gen.ts (generated src/wasm-math.ts, 10 functions), their tables and stack in a memory of their own (multi-memory, on by default in Node 22 and wasmtime). 350,000 inputs (any bits, edges, past 2²⁰·π/2) give exactly Node's bits. A JavaScript host still imports Math, so a page matches the browser's evaluator. WebAssembly modules now need nothing from a host but the world | #307 |
| C7 W1d | Folds over nested data in WebAssembly: a field holding the type inside a container (a rose tree's List of children, a List of Lists) folds to that container with each one folded, one function per container type made by the fold (Coq's nested inductive types, as the evaluator's nested.ts; credited), tail recursive modulo cons so 50,000 children need no stack; with Choice too. A type inside itself at other arguments (List (List Tree)) is now in the profile | #306 |
| C7 W5c | Quotient, remainder and power on big Ints in WebAssembly: Knuth's algorithm D on 32-bit limbs (as Hacker's Delight writes it; credited), floor division with the divisor's sign as int.ts does; power by squaring on the big multiply. The smallest i64 over -1 is 2⁶³ now, not a trap. Matches BigInt on 57,000 random divisions (limbs chosen to reach the rare add-back step) and the evaluator in the test. An Int no longer traps anywhere but a power too big for memory | #305 |
| C7 W5b | Int in WebAssembly grows past 64 bits: past an i64 it is a `$huge`, a sign and 32-bit limbs, written in WebAssembly (add, subtract, multiply, compare, equal, show, read, as Number, whole part; Knuth's classical algorithms, credited), with i31 and i64 fast paths so the small case costs nothing measurable (wc the same time, 1.1 KB more). The host passes big ones limb by limb (`toInt`, `fromInt`). Matches the evaluator around the i31 and i64 edges and on random Ints up to 320 bits. Left: quotient, remainder and power past 2⁶³ still trap (W5c) | #304 |
| C24 | WebAssembly tail recursion modulo cons: a function whose answer ends as cons(x, itself(…)) keeps the items so far in one more input and turns them round onto the answer at its other ends, so each step is a tail call (reversing, not filling holes, as WasmGC cells are immutable). ledger's entries: 15,000 lines ran out of stack, 200,000 now take 1.1 s | #303 |
| C23 | WebAssembly folds over `characters(t)` with no list and no stack: one function walks t's bytes from the end, a character per tail call (fusion, Wadler credited); the host fills a text four bytes a call. wc on 100,000 lines 4.2 s → 0.38 s (11×) | #302 |
| C7 W5a | Int in WebAssembly is an `i31ref` while it fits in 31 bits, else a `$big` box (now an i64, limbs in W5b), as Hoot and wasm_of_ocaml keep small ints (credited); the runtime's Int functions stay on i64s behind generated wrappers, the host makes and reads Ints with `Int.of` and `Int.get`. No measurable cost on ledger and wc | #301 |
| C7 W3d | A Number's show needs no host: past the plain decimals it is JavaScript's String, with Ryū's shortest digits written in WebAssembly (adapted, credited; tables built with BigInt into one global) and ECMA-262's layout. The same as String on every binary exponent, the decimal powers and random bits (2.6 million checked once, 30,000 in the test); the `host.show` import is gone, so modules import only Math and the world | #299 |
| C7 W3b-2 | Programs as WASI commands, with no JavaScript: the world written in WebAssembly over `wasi_snapshot_preview1`, and `_start` running main (`npm run wasi -- wc` in compiler/). wc, ledger, chapters, calc and a program using the rest of the world give the evaluator's output, files and exit codes under `node:wasi` on 90 runs, and run under wasmtime | #289 |
| C7 W4d | Searches with several answers in WebAssembly: a function that chooses takes the rest of the search as a closure and calls it on each answer (Mercury's success continuations, as the JS `$k` copies); handlers keep answers in a mutable box. queens and Countdown run whole; Countdown at 1.0-1.1× the hand-written ideal JS (compiled JS 1.2-1.5×) | #293 |
| C7 W4b | Choosing in WebAssembly: in first, optional, all and count, lets that choose `one of` a list (keep's shape, and nested) are a loop per choice, a tail call per item in the evaluator's order (all collects backwards and turns the list round); functions with Choice as values give a status too, and a generic definition is lowered per effect row as well as per type (keep with a test that may have no answer is a search itself). Every pure function of chapters and calc at known types compiles; 207 of their calls and the new searches fixture match the evaluator, a keep over 2×10⁴ items in constant stack | #280 |
| C7 W4a | Searches with one answer or none in WebAssembly: a partial function (Choice, or spending from a budget) gives a status after its answer (Mercury's semidet calling convention, credited); a call checks it and branches to the nearest handler's block, a tail call to a function that gives the same stays `return_call`; `first`, `optional`, `all` and `count` are blocks; `fail`, `value of`, and the Choice builtins (quotient, remainder, power, whole part, read, find, character code, character) are runtime functions with a status. Running out of a budget is no answer where it happens, which the nearest handler sees, as in the evaluator (the shader profile keeps its count check). chapters' `heading` and `lower` and ledger's `newline` and `table` now compile; 515 inputs match the evaluator | #279 |
| C7 W3a | Int and Text in WebAssembly: Int an i64 whose overflow traps (a runtime error, big Ints are W5), Text a UTF-8 byte array with positions counted in characters; compiler/src/wasm-rt.ts is a small runtime written in WebAssembly's text format (concat, length, slice, split, join all, characters, comes before, equal, show of Int and Number, range) that an assembler there turns into bytes, so the module's text is what runs. Library definitions (map, keep) now lower at known types (their body's type variables differ from their type's). wc's, chapters' and ledger's text functions match the evaluator | #276 |
| C7 W2 | Functions as values in WebAssembly: a function type is a closure struct holding its code (`(ref $code)`) and a code type taking the closure and the inputs, one rec group; a lambda is a function of its own plus a closure struct of what it captured; a definition by name is a closure made once; a call of a function value is `call_ref`, `return_call_ref` in tail position; a constant is a function of no inputs. Queens' `safe` (a fold into a function), numbers' `factorial` (a constant), calculus `newton` (takes functions) compile; answers match the evaluator | #273 |
| C7 W1c | Structural `equal` on data in WebAssembly (the evaluator's rule on each number, the last field a tail call: two lists of a million compare in constant stack); a fold whose arms each fold one child (lists, chains) is a loop, `down` keeping a stack of the values passed and `up` giving each its arm, the evaluator's order: polynomial over 10⁴ coefficients overflowed the stack, now 10⁶ run (375 ms) | #271 |
| C7 W1b | Data in WebAssembly (`data`): types with several cases and types that contain themselves (lists, expression trees) as a base struct with the case's number and a subtype per case, one recursion group; a match is `br_table`; a fold is a recursive function of its own, a result used once computed where it's used (insert stops at its place); a module that may not finish runs as in JS. sort, insert, polynomial, ∂polynomial/∂x, Countdown's valid and combine, algebra's derivative give the evaluator's answers through exported makers and readers (`List.cons`, `List.case`, `List.cons.head`) | #269 |
| C7 W1a | Records in WebAssembly as WasmGC structs, an exported reader per field (`Colour.red`), a generic definition at two types exported under both; the ray marcher's colours match the evaluator exactly. The editor's CPU fallback could now use WebAssembly for colour records (Inbox) | #265 |
| C7 design | projectional/WASM.md: whole programs to WasmGC by growing the scalar profile towards the heap; representation table, text as UTF-8 arrays, Int past 64 bits from the host, the five stages | #262 |
| C6 | G13 again, the part left: a single-answer function whose answers are one record leaves their fields in `$got` (a `$fields` copy) when its caller goes on with the answer; Countdown's `join` builds no `found`, 1.47× → 1.30× the ideal | #259 |
| C22 | G23's last part measured and left: `entries` kept as an array for the folds from the end made 50,000 lines 146 ms against 138 ms (noise), since each step's `add to` is the cost, not the spine (GAPS.md G23) | #255 |
| C22 | G23 part 2: a list from `split` matched and handed back to its own definition (ledger's `entries`, calc's `run lines`) is the array and an index; the folds from the end are still open above | #246 |
| C16 | G10: the output's indentation follows its brackets, not the ones in text or comments | #243 |
| C15 | G2: equality with a value built in place is a tag test and its fields, with nothing built | #240 |
| C14 | G12: `one of` a few constants written in place runs each in turn, with no list | #238 |
| C12 | G18: a handler whose cases all escape is an inline try/catch (calc enters one per line; gain within noise) | #233 |
| C13 | G1 again: a program `lab compile` writes spends fuel only in calls that can be under a `with fuel` (calc has no checks left; the gain is within noise) | #230 |
| C2 | G21 part 3: a list from `split` taken apart by matches is an index into the array (ledger's `parse` makes no cells, about 5 to 10%); the rest is C22 | #228 |
| C8 | `Float32`: an approximate representation of `Number` (every job rounded to binary32, literals too), so f32 is in the program rather than the GPU's choice; on the GPU test, 578 of 1001 values (functions of + − × only) now match the evaluator exactly instead of closely. Design #220, builtin #224, representation #225 | #226 |
| C10 | Deep recursion checked: `lab compile` takes 1,000,000 nested parentheses; on the default stack compiled and the ideal both stop near 1,500, no gap; heap continuations left as C21 | #218 |
| C9 | Compiled JS expands `derivative` and `gradient` of a known function at compile time, as the scalar profile does; only a function known at run time asks the runtime's `$derivative` | #217 |
| C6 | G13 again, the fold part: a fold whose answer is one record carries its fields in locals and builds it once (chapters' `sections`, one record fewer per line) | #214 |
| L2 | Fuel in plain code inside a search: running out fails that branch only, as in the evaluator, instead of ending the whole `with fuel` body (guards only in programs that use `with fuel`) | #210 |
| C4 | G3 again: Bool parameters of definitions only called by name, and tests written in place for a fused `keep`, are JS booleans (ledger's `goes before`, chapters' `slug` and `words`) | #208 |
| C5 | G24 and G14 again: Choice builtins are partial (`$partial`, one answer or none), and `first` over a body with one answer runs it in place (ledger's `amount`, chapters' `lower`) | #204 |
| C20 | G25 list cells nobody else holds changed in place (`$own` copies): ledger's `by account` 35 → 25 ms, about 10% overall | #202 |
| C19 | G22 tail recursion modulo cons: `cons(x, self(rest))` fills holes in a loop, so ledger runs 50,000 lines on the default stack | #200 |
| C3 | GAPS round 3: ledger, 32 definitions built in the editor by clicks; compiled 2 to 4× the ideal; G22 (stack), G23, G24 and eight editor frictions | #197 |
| C2 | G21 parts 1 and 2: lists walked whole, and accumulators, stay arrays (chapters about 3.4× → 1.9× the ideal) | #182, #188 |
| C1 | G16 fusion: steps over a list run as one loop (chapters 550 → 200 ms) | #176 |

### L: Language and library

| id | item | PR |
|---|---|---|
| L23 | `conjugate(f, g)` = f⁻¹ ∘ g ∘ f in the prelude, over `inverse`; `examples/conjugate` (in the editor as "Conjugation"): brighter in linear light, a quarter turn about a point, the fast band of a Haar split softened; run and compiled the same | #249 |
| L15 | Static output: `lab run` on a page prints it once as an HTML document (every text, part and attribute drawn, handlers left out); `<style>` and `<script>` text unescaped | #235 |
| L27 | `Log` in a page's views and handlers: both rows allow it, a line goes to the browser console (a view's each time it runs), evaluator and compiled the same | #232 |
| L14 | One generic bind: the prelude's `inverse(f, y)` runs any function value backwards (a solve over `applied(f, x) = f(x)`). The converter's fields read back with `inverse(view, typed)` and its ten `from X` definitions are gone (646 nodes to 559). Found and closed a hole: a function given to a solve as a port lost its effects; they now reach the row around. A closed function in a variable opens at each use (Koka's `open`), so a field's `view` can be both shown and inverted. Compiled pages mark builtins used as values, so `inverse(show, …)` runs compiled too | #229 |
| L28 | The html module: each tag a function of its children, attributes by wrapping (`styled`, `classed`, `named`, `with`), `button`, `words`, a style sheet as a list of rules. The dice and converter pages rewritten with it (dice 475 nodes to 382; the converter's style sheet is its own definition) | #209 |
| L13 | Keyed lists in pages: `each(items, f)` in cells (Solid's `mapArray`) and the html module's `for each(items, row, inside)`, which keeps an item's row, cells and all, when the list changes; evaluator and compiled pages the same | #222 |
| L25 | Container matrix, the other places: a solve's body, a function run backwards, a shader (with and without a literal with fuel), a representation's job, a module's pinned export and one whose pin leaves an effect out. One hole found and closed: a job that did an effect its definition doesn't was only caught when the rewritten program happened not to check; `jobProblem` refuses it before the rewrite (`lab` asks it) | #219 |
| L26 | The effect ledger in code: every place an effect leaves a row calls `discharge(where, effects, why)` (`src/lang/ledger.ts`); LANGUAGE.md's "Where effects go" table is generated from the calls, and a test checks each builtin's type drops exactly its row | #216 |
| L7 | One record per builtin for the compiler's targets (`compiler/src/builtins.ts`): its JavaScript (an expression, std.ts's implementation, or written by compile.ts, saying where) and its scalar operation for WASM and WGSL, or why it has none, which a shader's refusal now says. compile.ts's OPS and impl rule and scalar.ts's table are derived from it, and a full WASM target adds a field, not a table. The language's jobs stay in their modules: relate.ts's backwards rules are closures over its search and derive.ts's come from invertible's table, so a record would only point at them; `builtins.test.ts` asks each of them for every builtin | #252 |
| L11e | MODES step 5: a relational `solve` whose mode is `det` or `semidet` compiles to its plan written out (`compiler/src/modes.ts`), with no interpreter in the module when every solve is like that; several answers stay with relate.ts | #250 |
| L11d | A `solve` whose mode gives exactly one answer and ends has no `Choice`: the checker, run.ts (no choice point) and the compiler (a plain call) agree. A one-case constructor taken apart always matches | #213 |
| L11c | `relate.ts` follows the schedule: each function in each mode runs its goals in the order modes.ts planned. The ordering rules (`cheap`, `computable`, `waitsOnly`, `hence` reversed, match and fold and solve orders) are gone; goals a stuck direction never reaches wait for what they need | #205 |
| L11b | Types from modes: a relational `solve` is `Diverge` only when its mode may not end (says why), and a direction nothing pins down is an error at the `solve`; `mayLoop` removed | #198 |
| L11a | `modes.ts`: a schedule, how many answers and whether it ends, for any mode; reports only, checked against relate.ts and the checker (`test/modes.test.ts`). `map` and `show numbers` backwards end, so their `Diverge` is a false alarm | #195 |
| L11 | Design note for mode analysis: projectional/MODES.md | #193 |
| L10 | Shader soak: `npm run smoke-shaders` lets the pictures move for 10 s each way (GPU and CPU) and fails if the page stops answering, the browser goes 500 ms without a frame, or a picture drops under 2 frames a second | #192 |
| L9 | `examples/compose` archived (`examples/archive/`, says why); `quadratic` kept, it type-checks and the editor's numbers program uses it | #190 |
| L8 | The error table names its tests: generated from `test/errors.test.ts`, which fails if a test is missing or the table was edited by hand; new row for effects hidden where a function waits | #189 |
| L6 | A page's rows named once (`PAGE_VIEW`, `PAGE_HANDLER`), checked against the runtime; closed on purpose, WEB.md says why | #186 |
| L5 | Container matrix: 10 places a function can wait × 4 effects, each reaches the type, is refused, or is the runtime's on purpose; no holes found | #185 |
| L4 | One page model: reactive.html draws std's `Html`, its widgets are definitions, `ui.ts` and `UI` removed | #183 |
| L3 | LANGUAGE.md says what runs: effects list, bundled output, totality row, Choice-and-world gap (now tested) | #181 |
| L1 | Run refuses a program that doesn't type-check, naming the definition | #178 |

### Coordinator and process

| id | item | PR |
|---|---|---|
| T6 | Testing rules in WORKFLOW.md ("Tests"): the language's terms, laws over all examples, tests go with the design they pin, under 5 s per file or a sweep, no coverage targets. The tests that mention `cons` read against them: toplevel.test.ts edits a match on a list's cons arm (would change with arrays, as it should); compiler checks that output has no `$cons` (the opposite of a pin) | this PR |
| T5 | Nightly at 03:00 UTC, when main changed since the `good` tag: `npm run affected -- --all` (every test, every sweep in full, the browser and GPU checks); green moves `good`. Running Pages by hand on `good` puts back the last fully checked site | #267 |
| T2 | `npm run affected` runs only the tests a change reaches: the import graph across the three packages, the test files that read a changed example, the browser tests when the pages could change; Check main runs it from its last green commit. Over the last 40 merges: 6 needed nothing, 5 nearly every unit test, the rest a few files; the browser tests (now the long pole, T4) for 31 | #266 |
| T3 | The four slowest test files check a rotating eighth of their sweep per run (`SWEEP=all` for everything, `SWEEP_AT` picks the eighth; Check main passes its run number): about 330 s → 60 s; lang.test.ts no longer repeats palette.test.ts's queens sweep | #264 |
| T1 | Deploy first: a merge is live in about 2 minutes (86 s for #262); the suites run beside it in "Check main" and report instead of blocking | #261 |
| P4 | CI on a pull request is only the type check (under a minute); unit and browser tests run once per merge before the deploy | #187 |

### Before the backlog

| id | item | PR |
|---|---|---|
| | Countdown in the program list (Hutton credited) | #174 |
| | QA2 H1, H2, M1 to M4 | #137, #139, #159, #160, #158, #156 |
| | Can't-edit: change a call's function keeping its inputs; field types | #151, #147 |
| | GAPS round 2: G9, G11, G13, G14, G15, G17 (one type), G19 (half) | #133 to #170 |
| | Second review fixes 1 to 6 (builtin half), agreement test, TypeScript type-check in CI | #117 to #173 |
