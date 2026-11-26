# How Ters allocates, and whether to change it (2026-11-24)

Ersagun asked, after a talk in the project chat about closures on the
stack and the heap, async callbacks, tail calls as frame reuse and
Perceus: where does Ters stand on all of this, what should improve, and
is there a paradigm switch, even a big one, that would change how Ters
handles allocations in general?

This is an analysis. Nothing is built here. The rows it proposes are
C325 to C328 in BACKLOG.md. The measuring tools are in
`compiler/gaps/allocations/`.

## The answer in short

- **Ters already stands where the research has ended up on most of
  these axes.** Native code is Perceus: owned values, a dup or a drop at
  each use, drop specialisation, a matched cell's memory reused by the
  arm's new cell, borrowed parameters, free lists per size. JavaScript
  and WebAssembly get in-place changes where the program can't tell
  (one-holder.ts, owned-arrays.ts, owned-records.ts, owned-tables.ts)
  and versions otherwise (Baker's rerooting). A call made last is a
  loop, and a cons onto a call made last is too (TRMC) in the
  interpreter and the compiler. Handlers are fused away where they can
  be, a stack of cases where every case resumes in place, and the rest
  goes through continuation passing (JavaScript) or fibers (C).
- **Regions per action or frame would not pay.** Natively, freeing is
  12% to 34% of the instructions, but a run that never frees anything is
  at most 2% faster and up to 40% slower (fresh memory misses the
  cache). Freeing is not the cost. On JavaScript and WebAssembly a
  program can't free memory at all.
- **The cost is the cells themselves.** 44% to 67% of all cells a
  native run makes are freed before the function that made them
  returns. Every closure in six benchmarks is, and every fold's frame.
  They never needed the heap. On flock, 98% of the 36.6 million cells
  are array views (a slice's buffer, start and length) that could have
  been three words in registers.
- **The paradigm switch worth making** is one inferred analysis of
  ownership and lifetime, per value, on the core IR, which every target
  reads (C327). It is "second-class by inference": a value that never
  leaves its frame lives in the frame (C: a stack slot; WebAssembly:
  locals, not a GC struct), and a value with one holder is changed in
  place, decided per value instead of per type. It would replace the
  four owned-* passes and one-holder.ts's whole-program, per-type rule.
  It is big (several PRs), it fits after the Language lane's stage 4
  (per-definition lowering, whose summaries it needs), and its payoff in
  time is not measured yet. So its first step is a measurement by hand
  (C327a), and it is built only if that shows more than 10%.
- **Effects need two fixes, not a new model.** WebAssembly refuses a
  handler that answers later (tumble, pig) while it waits for stack
  switching; the continuation passing JavaScript already uses would run
  there today (C325). C's fibers take 6 to 7 µs to start, since each
  mallocs a 64 MiB stack, and 330 ns a round trip, since glibc's
  `swapcontext` changes the signal mask (two system calls) each time; a
  kept stack and the switch c-rt.ts already has for Android and Apple
  give 10 to 20 ns and 14 ns (C326). No benchmark uses fibers yet, so this is
  P3.

## 1. How each target allocates today

| | interpreter | core IR → JavaScript | WebAssembly (`ters wasi`, pages) | C (`ters native`) |
|---|---|---|---|---|
| records, cases, lists | JS objects | JS objects; a list read in order as written, others as arrays (the chooser) | WasmGC structs | counted cells: a header (count, type, case, size class) and fields; free lists per 8-byte size up to 256 bytes, cut from 256 KB blocks |
| freeing | V8's GC | V8's GC | the engine's GC | at the last drop; a dead cell's fields from a stack of cells, not by recursion |
| reuse | none | in place where one-holder.ts says every value of a type has one holder; versions (Baker) for arrays and tables otherwise | the same, versions since C285 | Perceus: a matched cell with count 1 moves its fields out and its memory goes to the arm's new cell (Lean 4's reset and reuse); `rc == 1` checked at run time |
| closures | JS closures | JS closures; applied at once, a direct call (known-closures.ts); given to a definition, a copy of it (closure-args.ts, known-records.ts) | a GC struct of the code's index and captures, `call_ref` | a counted cell of the code's address and captures |
| array slices (a rest, a view) | JS objects | JS objects | GC structs | counted cells |
| a fold that walks down and back up | JS stack | a list of frames on the heap (scalar.ts `framesOf`) | the same | the same, counted cells |
| deep recursion | heap continuations past the JS stack | a generator copy past a depth (C137c18) | frames on the heap (deep-loops.ts, cons-loops.ts) | the same as WebAssembly, or a 1 GiB stack |
| tail calls | a call made last runs in its caller's loop (L281a, L281b TRMC) | loops for calls to itself | `return_call` for every tail call | loops for calls to itself; others are C calls |
| handlers whose cases answer in place | a stack of handlers | fused into the code (handlers.ts) or a stack of cases | fused or a stack of cases | fused or a stack of cases |
| handlers that answer later | heap continuations | continuation passing (core-rt.ts `handleK:`) | refused: "no runtime function fhandle" (C187 waits for stack switching) | a fiber per handler: `ucontext`, a 64 MiB malloc'd stack |
| Choice and search | heap continuations | success continuations | success continuations | success continuations, a status code for no answer |
| page cells | cells.ts | cells.ts | cells.ts (the host's) | the C page runtime |

The interpreter is the stackless kind: its machine keeps each
continuation on the heap, and a function that only computes runs
directly on the JavaScript stack (L118c). It is the reference the
compiled code is checked against, and its speed is
INTERPRETER-SPEED-2026-11-21's subject, so it is left out below.

## 2. Measurements

### Natively: what each run makes, and how long it lives

Each benchmark's C (`ters native`) was compiled with
`-finstrument-functions`, so each function the program defines keeps a
frame number while it runs (the runtime's own functions don't count as
frames, so a cell `lab_text_concat` makes belongs to the program
function that asked for it). Each cell made records its kind and the
frame that made it. When it is freed, or its memory reused, it is
counted *in frame* if that frame is still running, *outlived* if not.
One thread (`TERS_WORKERS=0`). `compiler/gaps/allocations/kinds.py`
makes the instrumented file.

| benchmark | cells made | freed in frame | closures | list cells | fold frames | views | others |
|---|---|---|---|---|---|---|---|
| bazaar 10,000 orders | 1.16 M | **54%** | 4% (100% in frame) | 56% (54%) | 16% (100%) | 6% (0%) | records 15% (29%), tree nodes 4% (0%) |
| mini 2,000 | 5.26 M | **65%** | 17% (100%) | 29% (72%) | 1.5% (100%) | 1% (14%) | texts 33% (70%), records 13% (0%), boxes 2% (100%) |
| pack 3,200 words | 0.47 M | **44%** | 5% (100%) | 31% (63%) | 11% (100%) | 14% (31%) | tree nodes 33% (0%) |
| scan 800 | 19.7 M | **57%** | 15% (100%) | 55% (21%) | 12% (100%) | 0% | texts 18% (99%) |
| strings 8 blocks | 69.8 M | **52%** | 2% (100%) | 80% (41%) | 14% (100%) | 4% (70%) | |
| flock 5,000 birds, 30 ticks | 36.6 M | **67%** | 0.8% (100%) | 0.4% (100%) | 0% | **98%** (67%) | |

Perceus's reuse is working: of the list cells, 128 k of bazaar's, 4.5 M
of scan's and 24.3 M of strings' took the memory of the cell their arm
took apart, without a free or a new.

What the table says:

- **No closure outlived the function that made it**, in any of the six.
  They are all downward: made to be given to a fold, a map or a
  helper, and dropped when that returns. Rust, Swift (a closure is
  non-escaping unless marked) and Effekt (second-class functions) keep
  such closures on the stack.
- **Every fold frame is freed in frame.** A fold that walks a list down
  and back up conses one frame per item onto a list of frames
  (`tree as map.fold.down` in bazaar's C) and takes them apart on the
  way up. That is a stack, written as list cells.
- **flock's views are 98% of its cells**: 240 per bird per tick.
  `array rest`, `push front` and `first` each make a counted cell of
  three words. In Go or Rust a slice is those three words, passed by
  value.
- What outlives its frame is what the program keeps: tree nodes, the
  table's arrays, records in the result.

"Freed in frame" is measured on one run. A static analysis proves less
than a run shows, so this is an upper bound on what an analysis could
move off the heap.

### Natively: what memory management costs

Callgrind instruction counts, the same benchmarks (smaller sizes where
noted), counting `lab_new` (making), `lab_drop`, `lab_dec`, `lab__dead`,
`lab_fields`, `lab_free` (freeing) and malloc. The dups and drops
inlined into the program's own functions are not counted, so this is a
lower bound.

| benchmark | memory management | making | freeing |
|---|---|---|---|
| bazaar 10,000 | 48.5% | 12.2% | 34.2% |
| strings 2 | 47.6% | 16.0% | 31.6% |
| mini 500 | 36.9% | 11.8% | 20.8% |
| flock 5,000, 5 ticks | 30.7% | 7.9% | 21.5% |
| pack 3,200 | 18.4% | 6.7% | 11.7% |
| scan 200 | 17.2% | 5.2% | 12.0% |

Instructions are not time. Two changes to the generated C, timed (best
of five, one thread):

| benchmark | as built | `lab_new` always inlined | never freed (leaks) |
|---|---|---|---|
| bazaar 200,000 | 595 ms | 623 ms | 582 ms |
| strings 8 | 581 ms | 548 ms | 821 ms |
| mini 8,000 | 303 ms | 295 ms | 408 ms |

A run that never frees is at most 2% faster and up to 41% slower, as
REGIONS.md found for swarm on 2026-11-10: the freeing's instructions
overlap with the waits for memory, and reused cells are warm in the
cache where fresh ones aren't. So the third of the instructions spent
freeing buys back its cost in locality. What the table can't say is how
much faster a run would be that never made the frame-local half of its
cells at all. That needs a hand experiment (C327a).

Also seen: bazaar natively at 200,000 orders takes 0.92 s on the pool's
threads and 0.63 s on one. Sharing a value with the pool marks every
cell it reaches as shared (`lab_share`), and shared counts are atomic.
This is the native side of C323, which is about JavaScript's workers
(C328).

### JavaScript and WebAssembly: the collector

From the rounds' profiles (GAPS.md), the collector's share of the core
IR's time: bazaar 25%, strings 31%, depot 23%, fit 13%, rota 12%,
greenhouse and moths 8% to 16%, routes 8%. WebAssembly's is higher where
measured: pack in WASI is about half collection, and machine's primes
13% after C285. V8's young generation makes a short-lived object for a
few nanoseconds, and C62 (2026-10-31) found writing into an old node
instead of making one saves nothing in JavaScript (the write barrier
costs as much). So in JavaScript what pays is not making the value at
all (fusion, scalar replacement, columns) or changing a big one in
place (arrays and tables), never reusing a small cell's memory.

### C's fibers

`compiler/gaps/allocations/fibers.c` does what c-rt.ts's `fibers` does
on Linux, a handler at a time (a fiber `calloc`'d, a 64 MiB stack
`malloc`'d, `makecontext`, `swapcontext` in and out), then the same with
c-rt.ts's own switch for Android and Apple (`sigsetjmp` without the
signal mask, a jump onto the new stack):

| | to start a handler | a perform and its resume |
|---|---|---|
| as built (ucontext, a fresh 64 MiB stack) | 6.0 to 7.4 µs | 330 ns |
| ucontext, a 64 KiB stack | 0.5 µs | 330 ns |
| c-rt's own switch, a fresh 64 MiB stack | 6.1 to 6.7 µs | 77 to 80 ns |
| c-rt's own switch, a kept stack | 10 to 20 ns | 14 ns |

A 64 MiB `malloc` is an `mmap` and its `free` an `munmap`, with page
faults for every page the fiber touches. glibc's `swapcontext` saves and
sets the signal mask, a system call each way. Also: glibc's
`_FORTIFY_SOURCE` (on by default in Ubuntu's gcc at -O2) aborts a
`siglongjmp` onto another stack ("longjmp causes uninitialized stack
frame"), so the Android and Apple switch needs `-D_FORTIFY_SOURCE=0` if
it is used on Linux.

None of the benchmarks starts a fiber. A native page starts one per
event handler, which at 7 µs is invisible. A program performing an
effect answered later in a loop (a generator, a scheduler of many
`together` branches) would feel it.

## 3. The candidates

### Regions or arenas per action, frame or tick (Tofte and Talpin; MLKit)

The cells of a scope would come from a region freed at once when the
scope ends. On JavaScript and WebAssembly a program can't free, so this
is C only. On C, freeing is already at the last use, from free lists
(Perceus is "garbage free"), and the leak test bounds what skipping the
frees could buy at 2%. The MLKit later put a collector beside its
regions (Hallenberg, Elsman and Tofte, PLDI 2002), since inferred
regions alone kept too much alive on some programs; Cyclone made
regions explicit, which Ersagun's rule (no annotations, 2026-10-29) rules
out. **Not recommended.** REGIONS.md (C57) reaches the same decision; this
round adds four more programs to its evidence.

### Perceus-style counting with reuse, everywhere

C has it (c.ts, since N5). JavaScript and WebAssembly can't count: the
engine's collector owns memory, and counting every value on top would
cost more than it saves (IN-PLACE.md step 4). What carries over is the
static half: knowing a value has one holder, so a change can be made in
place. That exists (one-holder.ts), but per type and for the whole
program at once: an Array of Int is changed in place only if *every*
Array of Int in the program has one holder. machine's primes lost a
factor of 500 in WebAssembly to that rule until C285 made arrays
versions (GAPS.md sweep). Versions catch what the rule misses, at a
note per change. **Recommended as part of C327**: one holder decided per
value, with versions or `rc == 1` as the fallback, as now.

What C still lacks from Perceus and its successors, each small: borrow
inference for every parameter (C94 lends a record or cell input the body only reads), reuse
specialisation (writing only the changed fields into a reused cell), and
FBIP's guarantee for a definition that keeps its shape (Lorenzen, Leijen
and Swierstra's FP², ICFP 2023). None is a paradigm change.

### Whole-program defunctionalisation (Reynolds 1972; MLton)

A function value becomes a tag and its captures, and a call through it a
switch. WGSL already does this (defunc.ts, C225). On C and WebAssembly
the gain would be a direct call instead of an indirect one, and, more
usefully, a closure that is a plain value instead of a cell, which can
live in a register or a local. The measurements say closures are 1% to
17% of cells, and C288 (known-closures.ts) already removed the ones fit
made per point. **Not a goal of its own.** Inside C327 it is the means by
which a frame-local closure on WebAssembly becomes locals instead of a
GC struct.

### Uniqueness or ownership types, written or shown (Clean, Linear Haskell, Rust)

Ersagun's rule since 2026-10-29: the representation stays out of the
language, so a copy the compiler can't avoid makes a program slower,
never wrong. All of these put ownership in the types a person writes.
**Not recommended**, and not needed: everything they would let a
compiler do, an inferred analysis can do on a program that doesn't say
it, with a fallback where it can't prove it. Hylo's mutable value
semantics, which is closest in spirit (values, never shared references,
mutated in place), also needs `inout` written.

### Ownership and lifetime per value, inferred, on the core IR (recommended)

One stage of the core IR, after lowering and before the printers, that
gives each value made:

- **its holders**: one (change it in place), shared, or unknown (decide
  at run time: `rc == 1` on C, a version on JavaScript and WebAssembly);
- **its lifetime**: dies in its frame (second-class), or may leave it
  (returned, stored, captured by a value that leaves);
- **each parameter's mode**: borrowed or consumed, and each result:
  fresh or not. These are the per-definition summaries that let it run
  one definition at a time, which is what the Language lane's stage 4
  (per-definition lowering) gives.

Each target then reads it:

| | C | WebAssembly | JavaScript |
|---|---|---|---|
| one holder | in place, no `rc == 1` test | in place, no version | in place, no version |
| dies in its frame | a stack slot, no count (a closure, a view, a fold's frame stack, a box) | locals and multiple values, no GC struct | left to V8 (its escape analysis does this for objects that don't leave a function) |
| may leave | a counted cell, as now | a GC struct, as now | an object, as now |

It replaces one-holder.ts's per-type rule and the four owned-* passes
(owned-arrays.ts, owned-records.ts, owned-tables.ts, owned-pushes.ts),
about 1,050 lines with one-holder.ts, each pass looking for one shape. It does not replace
fusion (fuse-steps.ts, fuse-walks.ts), columns or loop-records.ts, which
remove values rather than place them.

Prior art for each part: Perceus and its borrow inference (Reinking,
Xie, de Moura and Leijen, PLDI 2021); Lean 4's borrowed parameters and
reset/reuse (Ullrich and de Moura, IFL 2019); escape analysis for stack
allocation (Park and Goldberg 1992; Blanchet, POPL 1998; Choi et al.,
OOPSLA 1999); second-class values (Osvald, Essertel, Wu, Alayón and
Rompf, OOPSLA 2016) and Effekt's second-class functions (Brachthäuser,
Schuster and Ostermann, OOPSLA 2020), here inferred rather than written;
Swift's non-escaping closures and Rust's unboxed closures as the
targets' shape; Go's slices for views as values.

*Cost:* several PRs over weeks, on the core IR every printer reads.
*Expected win:* on C, up to two thirds of the cells and the counting
traffic they carry, which instruction counts put at 17% to 48% of a run
but which isn't measured in time; on WebAssembly, the same cells out of
the collector, which takes a third to half there; on JavaScript, less
(V8 already does this for some objects), mostly in-place changes the
per-type rule misses.
*Risk:* an analysis wrong about a holder changes an answer. Each step is
checked against the evaluator on every example and benchmark, as every
target is today, and a value it can't prove keeps today's path.

### Stackful or stackless effects, per target

Ters's operations are one-shot: a case calls its rest at most once
(ANSWERED-LATER.md), so no continuation is ever copied. That makes both
fibers (OCaml 5's) and continuation passing (Koka's and Effekt's
selective CPS) correct; the choice is cost, per target:

- **JavaScript** has no way to switch stacks (generators are a frame
  each on the heap, the same cost as `async`), so continuation passing,
  only where a case keeps the rest, is right. Keep it.
- **C** switches stacks cheaply if it is done well: a kept stack and its
  own switch cost 10 to 20 ns to start and 14 ns a switch. Keep fibers, and make them that cheap
  (C326): a pool of stacks reused, 64 MiB reserved with `mmap` and a
  guard page rather than `malloc`'d per handler, and c-rt's own switch on
  Linux too (or `swapcontext` replaced by a few lines of assembly per
  processor, as Boost.Context does).
- **WebAssembly** has stack switching only behind a flag (WasmFX,
  Phipps-Costin et al., OOPSLA 2023; C187 checked Chromium 153), and
  Node 22 not at all. Waiting leaves tumble and pig unbuilt. The
  lowering JavaScript uses (scalar.ts's `handleK:` route) needs only
  closures and tail calls, which WebAssembly has (C325). When stack
  switching ships on by default, measure it against that.

So: stackful where the target offers cheap stacks, stackless elsewhere,
one meaning. That was PROGRAM-EFFECTS-2026-11-03's option (a) for
JavaScript; this extends it to WebAssembly instead of waiting.

### Tail calls and frame reuse

In place: the interpreter (L281a, L281b), loops for calls to itself in
JavaScript and C, `return_call` in WebAssembly, TRMC by cons-onto.ts.
Left: a mutual tail call in JavaScript takes a frame, and in C relies on
gcc's sibling calls at -O2. No program has shown either; not a row.

## 4. Recommendation

1. **C327, per-value ownership and lifetime, after stage 4.** Start
   with C327a, a measurement by hand on two benchmarks' generated C:
   flock's views passed as three words, and bazaar's fold frames as a
   growable array with its closures on the stack. If neither is 10%
   faster, stop and close the row as measured; regions and
   defunctionalisation are then out too, since they would win less.
   If they are, build the analysis (C327b) with per-definition
   summaries, then its readers one at a time: views (C327c), fold frames
   (C327d), closures (C327e), one holder per value in place of
   one-holder.ts's per type (C327f), WebAssembly's locals (C327g).
2. **C325, WebAssembly's handlers that answer later by continuation
   passing**, now. It needs no decision and unblocks tumble and pig.
3. **C326, cheap fibers on C**, when a program performs an effect
   answered later in a loop. P3.
4. **C328, the native pool's sharing cost** (bazaar 0.92 s on threads,
   0.63 s on one), with C323.

Not recommended: regions (§3, measured), a collector on C, ownership in
the types a person writes, defunctionalisation for its own sake.

No decision is needed from Ersagun for C325, C326 and C328: they are how
the compiler lowers what the language means. C327 is a large change to
the compiler's core; the lane starts it with C327a's measurement and
reports before building.

## C327a, measured by hand (2026-11-24, afternoon)

Two hand edits to generated C, each one function, each printing the
same as before (`compiler/gaps/allocations/c327a-*.c`). Times are the
minimum and median of 15 runs, alternating, one thread unless said.

| edit | cells it removes | before | after |
|---|---|---|---|
| flock: `merge sorted`'s array views passed by value (buffer, start, length; the buffer counted) | 16.1 M of 36.0 M views at 30 ticks | 2,959 ms min, 3,058 median | 2,330 min, 2,484 median: **21% faster** |
| the same, on the pool's threads | | 1,333 min, 1,400 median | 1,208 min, 1,299 median: 7% to 9% |
| bazaar: `append`'s fold frames in one growable stack (64 on the C stack, then malloc'd) | 138 k of 182 k frames (12% of all cells) at 10,000 | 621 min, 732 median | 624 min, 756 median: no change |

So the two kinds of frame-local cell differ. A view is made in the
innermost loop and read through a pointer each time; passing its three
words instead saves a fifth of flock's run, from one function. A fold
frame is made and taken apart in a tight loop whose cells the free list
hands back warm; an array in its place saves its instructions but not
measurable time. Closures were not measured: the hottest closures are
too few (bazaar 4% of cells) or not in one function (mini).

What this changes in C327:

- **Views by value (C327c) first, and on its own.** A view never needs to
  be a cell: it is three words, and only a view stored in data needs a
  box. That is a representation change, not an inference, so it doesn't
  wait for C327b's analysis. Every array program on C and WebAssembly
  makes views (flock 98% of its cells, pack 14%, strings 4%, bazaar 6%).
- **Fold frames (C327d) closed as measured.** Not worth a change.
- **The analysis itself (C327b) waits** for a reader that pays: closures
  measured on a program where they are hot, or WebAssembly's records,
  where frame-local GC structs go through the collector (C327g).

## C327c, views by value on C (2026-11-24, evening)

Built in `compiler/src/c.ts` for every array, not one function: a view
is `{ lab_cell *b; uint32_t s, n; }`, passed, returned and held in
record and cell fields as it is, with only its buffer counted. `rest`
and `slice` move `s` and `n`; `push` and `pushFront` write into the
buffer's spare room when the view ends at it; `replaceAt` and a
column's write work in place when `b->rc == 1`, since every other view
of the buffer holds a count of it. A definition made once for the
threads keeps its view beside it. Same output on flock and bazaar.
Times: medians of 7 runs, alternating, same container as above.

| program | before | after |
|---|---|---|
| flock, one thread | 3,118 ms | 2,331 ms: **25% faster** |
| flock, the pool | 1,374 ms | 1,100 ms: **20% faster** |
| bazaar 10,000 | 24 ms | 26 ms: no change (6% of its cells were views) |

The hand edit (C327a) measured 21% from `merge sorted` alone; the rest
comes from the views every other array function stops making. Next is
the same on WebAssembly (C327c2), where a view is a GC struct today.

## C327c2, WebAssembly measured by hand (2026-11-24, evening)

Before building the same thing for WebAssembly, the same hand edit:
flock's `merge sorted`, from `ters wasi`, disassembled with binaryen
and changed to keep its two views as locals (buffer, start, length). It
then makes one view per merge instead of one per step
(`compiler/gaps/allocations/c327c2-flock-merge.py`). Node 22 (V8),
medians of 7 alternating runs, same output:

| edit | before | after |
|---|---|---|
| `merge sorted`'s views as locals | 5,277 ms | 5,075 ms: 4% faster |
| its `Ordering` answers as three globals, not a struct a compare | 5,245 ms | 5,213 ms: no change |

On C the same edit was 21%. V8 allocates a short-lived struct by
bumping a pointer, and its young-generation collector frees one by
not copying it, so a view costs a few instructions, not a count kept up
and a free list. The profile agrees: the whole collector is 11.6% of
flock's run, and that bounds what removing every view could save.

So C327c2 is closed as measured: views by value on WebAssembly would
mean multi-value lowering in every function that takes an array, for
4% at the hottest site.

## Reopened (2026-11-25)

Ersagun, on the closes above: an engine's collector may hide what an
allocation costs, "but I feel like we shouldn't rely on that. Because we
can do more analysis and JIT compiler has very little time budget to do
the same." The browser is not Ters's first target either; it shows the
demos. So C327c2 (views by value on WebAssembly) and C327d (a fold's
frames as one stack) are open again, judged by the cells and structs a
run makes as well as its time, and C327b (the analysis) no longer waits
for a reader that buys 10% of V8's time.

### C327d on C, built (2026-11-25)

`compiler/src/c.ts` keeps a fold's frames (scalar.ts framesOf) on one
growable stack: a cell holding up to eight values itself, then a
malloc'd array, pushed in place while one holds it and popped as the
arm takes it apart; the last stack emptied waits for the next fold, so
a shallow fold makes no cell. Cells made at the sizes of the table
above, one thread (`kinds.py`), and the best of five times:

| program | cells before | after | time before | after |
|---|---|---|---|---|
| bazaar 10,000 | 1.13 M | 0.95 M: **-16%** | 26 ms | 25 ms |
| strings 8 | 66.9 M | 57.3 M: **-14%** | 580 ms | 566 ms |
| pack 3,200 | 418 k | 365 k: **-13%** | 15 ms | 15 ms |
| scan 800 | 19.7 M | 17.6 M: **-11%** | 490 ms | 483 ms |
| mini 2,000 | 5.26 M | 5.19 M: -1% | 80 ms | 78 ms |

### C327d on WebAssembly, built (2026-11-25)

`compiler/src/wasm.ts` does the same with GC types: a fold's frames type
becomes `done` and `stack` (a growable array of its values, and how
many), pushed, read and popped by three runtime functions. The stack a
fold emptied waits in a global for the next fold of its type and `done`
is made once, so the frame structs go as C's frame cells went (the same
lowering, the same counts as the table above). Under Node's WASI, best
of three:

| program | time before | after |
|---|---|---|
| strings 32 | 4.46 s | 4.23 s |
| scan 3,200 | 2.07 s | 2.13 s |
| typeset 1,000 | 1.20 s | 1.29 s |
| mini 8,000 | 358 ms | 378 ms |
| bazaar 10,000 | 79 ms | 76 ms |
| pack 3,200 | 53 ms | 51 ms |

V8's young generation made these structs nearly free, so the times move
within noise either way; the point is the engines whose collectors are
slower (Ersagun 2026-11-25). Every benchmark prints the same.

### C327c2 on WebAssembly, built in loops (2026-11-25)

`compiler/src/wasm-views.ts` keeps a looping function's array views as
three locals (the buffer, the start, the length) where the loop walks
them by `rest` or pushes onto them, as flock's `merge sorted` and every
`map` do. Reads, `rest` and the pushes work on the three (the array's
own runtime functions, written again in `wasm.ts viewRt`), and a view is
made only where one leaves the loop on a branch that doesn't go round
again. A call of `array cons` and a let of another local are read
through first. Views made, counted with `TERS_COUNT_VIEWS=1` (each
`struct.new $arr` adds one to an i64 at address 120 of WASI's memory):

| program | views before | after |
|---|---|---|
| flock 100 ticks, 5000 birds | 150.4 M | 55.6 M: **-63%** |
| pack 3,200 | 209 k | 141 k: **-32%** |
| strings 32 | 19.7 M | 16.2 M: **-18%** |
| typeset 1,000 | 3.91 M | 3.80 M: -3% |
| bazaar, scan, mini | the same | |

Flock under Node, five alternating runs each: 5.01 to 5.83 s before,
4.84 to 5.50 s after (about 5%). The others are within noise. Of flock's
remaining 56 M, 29 M are views made where one leaves a loop (mostly
small maps' answers), 14 M are new arrays (`of`, `range`, `slice`) and
11 M are pushes in functions that aren't loops. Removing the first and
the last needs views passed between functions by value (multi-value
inputs and answers), which is left.

## How this was measured

On this container (4 cores), gcc 13 at `ters native`'s flags. Cells by
kind: `python3 compiler/gaps/allocations/kinds.py in.c out.c`, then
`gcc -std=c99 -O2 -ffp-contract=off -fwrapv -pthread -finstrument-functions
-o x out.c -lm` and `TERS_WORKERS=0 ./x args`; the report is on standard
error. Instructions: `valgrind --tool=callgrind` on the same C built with
`-g`. Fibers: `gcc -O2 -D_FORTIFY_SOURCE=0 -o fibers
compiler/gaps/allocations/fibers.c` and `./fibers u|s handlers performs
[stack bytes] [keep]`.

## Credits

Prior art and influences named above, all prior art or considered here
(nothing is built): Tofte and Talpin, "Region-based memory management"
(Information and Computation, 1997) and the MLKit; Grossman et al.,
"Region-based memory management in Cyclone" (PLDI 2002); Hallenberg,
Elsman and Tofte, "Combining region inference and garbage collection"
(PLDI 2002); Reinking, Xie,
de Moura and Leijen, "Perceus: garbage free reference counting with
reuse" (PLDI 2021) and Koka; Ullrich and de Moura, "Counting immutable
beans" (IFL 2019) and Lean 4; Lorenzen, Leijen and Swierstra, "FP²:
fully in-place functional programming" (ICFP 2023); Reynolds,
"Definitional interpreters for higher-order programming languages"
(1972), and MLton's whole-program defunctionalisation (Cejtin,
Jagannathan and Weeks, ESOP 2000); Baker's shallow binding for
functional arrays (1991); Park and Goldberg (1992), Blanchet (POPL 1998)
and Choi et al. (OOPSLA 1999) on escape analysis; Osvald et al. on
second-class values (OOPSLA 2016) and Effekt (Brachthäuser, Schuster and
Ostermann, OOPSLA 2020); Clean's uniqueness types, Linear Haskell and
Rust's ownership (considered, rejected by Ersagun's rule); Hylo's mutable
value semantics (Racordon et al., JOT 2022); Sivaramakrishnan et al.,
"Retrofitting effect handlers onto OCaml" (PLDI 2021); Phipps-Costin et
al., "Continuing WebAssembly with effect handlers" (OOPSLA 2023);
Friedman and Wise on TRMC (1975); Go's slices; Swift's non-escaping
closures; Boost.Context's stack switch. All listed in
docs/language/CREDITS.md.

## C327b and C327e, closures in their frame on C (2026-11-25)

`compiler/src/frames.ts` is the first part of the analysis (C327b). It
reads each value's lifetime on the lowered IR. A value leaves its frame
when it is the answer, goes into a record, case, list, closure or box,
goes to the runtime, the world or an abort, or goes to a function or
closure code whose parameter in that place leaves. Each parameter is
summed up once, to a fixpoint over the calls. Two more cases count as
leaving: a value handed to the next turn of its maker's loop (its calls
of itself made last), and anything the analysis doesn't read (handlers,
searches, budgets). Maps on the threads (parC) are read as staying,
since they apply their function only while they run and wait for their
threads.

Its first reader (C327e) is C. A closure that never leaves has its cell
in its maker's frame (`lab_framed`, size class 255), and it is counted
like any other. Its captures go at its last drop, and `lab_free` leaves
its memory alone. Cells made, one thread, outputs the same, times the
best of five:

| program | closures made before | in the frame now | cells made | time |
|---|---|---|---|---|
| bazaar 10,000 | 45 k | all | 808 k → 763 k (−6%) | 21 → 20 ms |
| mini 2,000 | 908 k | all | 4.98 M → 4.07 M (−18%) | 80 → 79 ms |
| pack 3,200 | 23 k | all | 327 k → 304 k (−7%) | 12 → 12 ms |
| scan 800 | 3.02 M | all | 13.0 M → 10.0 M (−23%) | 430 → 412 ms |
| strings 8 | 1.48 M | all | 33.0 M → 31.5 M (−4%) | 595 → 570 ms |
| typeset 200 at 300 | 679 k | all but 14 k (`hyphen points`) | 5.40 M → 4.73 M (−12%) | 124 → 123 ms |
| flock 5,000 × 30 | 425 k | all | 3.22 M → 2.79 M (−13%) | 307 → 303 ms |

As C327a found for fold frames, the time hardly moves: the free lists
hand back warm cells. On the pool, flock prints the same. Under
AddressSanitizer, flock, scan and mini show no errors, and their leaks
are what they were before (the runtime's own buffers). `NO_FRAMES=1`
turns it off.

Next are C327f (one holder decided per value, which C334 waits on) and
C327g (WebAssembly's frame-local records as locals).

## C327f part 1 and C334, one holder per value on core JavaScript (2026-11-25)

holders.ts decides, per value, whether an array has one holder where it
is replaced or pushed onto: where it came from (a new array, what a
replace or push gave back, a record's field, a call's answer, a
parameter every caller gives one), and whether the local holding it is
used once (read any number of times, then given away once; a call's
inputs are worked out before it gives a local away, so `replace(a, i,
item at(a, i))` is one use). Parameters and answers are summed over the
program's functions to a fixpoint, through direct calls and through the
applies of closure codes the runtime is never handed. It runs after
one-holder.ts's rule by type, and takes what that rule can't: mnist's
gradient shares the parameters' type, and the parameters have two
holders.

A push onto an array with one holder is `pushOwned`: it grows the buffer
as `push` does, but doesn't mark it shared, which had made every later
owned replace a version anyway (the gradient is made by pushes). It is
named after columns.ts has run, so an array built by pushes can still
become columns (Newton's Dual arrays).

mnist, 300 digits, one epoch, core JavaScript:

| run | Versions made before | after | time before | after |
|---|---|---|---|---|
| reverse | 7,738,331 | 6,431 | 1.94 s | 0.69 to 0.81 s |
| adam | 0 | 0 | 0.39 s | 0.33 to 0.41 s |
| newton | 0 | 0 | 1.2 to 1.5 s | 1.2 to 1.4 s |

Same output each way. Of the other 20 benchmarks in compiler/gaps, only
typeset's code changes (one more replace in place). Not done here: C and
WebAssembly still decide by type, and the owned-* passes stay (C327f's
rest).

## C327f on WebAssembly (2026-11-25)

The same holders.ts on WebAssembly's lowering (`ters wasi`), after
owned-arrays.ts: its replaces are `array.replaceOwned`, which already
wrote in place unless another view shares the buffer, and its pushes
`array.pushOwned`, a push that doesn't mark its buffer as having another
view (wasm-rt.ts; wasm-views.ts takes it as a push, by value too).

Arrays the replaces make (`TERS_COUNT_VIEWS=array\.replace`), mnist at
300 digits, one epoch:

| run | before | after | time before | after |
|---|---|---|---|---|
| reverse | 7,738,331 | 6,431 | 8.8 to 9.9 s | 8.3 to 8.4 s |
| adam | 0 | 0 | 7.0 to 8.3 s | the same |

Same output. The time hardly moves: four fifths of it is the collector,
and what it collects is the records and closures the reverse pass makes
(tuples of arrays, Duals, closures), not arrays: C327g's ground. C makes
nothing here to remove, since a replace there writes in place whenever
its count is 1.

Node segfaulted on about one run in three of mnist's adam and reverse on
WebAssembly, before this change as after (C344).

The segfault was Node's, not the module's (C344, #3357). WASI's `fd_read`
starts a collection inside V8's fast call, and that collection crashes. The
slow mnist runs were data loading: on WASI a file's Bytes were a list,
55 M cells for mnist's files (C345, #3358). Reverse at 300 digits now
takes 0.41 s instead of 7.8 s.

## C327g part 1, records read by their parts on WebAssembly (2026-11-25)

Structs made by each place that makes one, counted with
`TERS_COUNT_MAKES=1` and read by compiler/gaps/made.ts. The collector's
share is from a CPU profile.

| program | structs made | collector |
|---|---|---|
| scan 3,200 | 143.0 M | 5% |
| mini 8,000 | 12.4 M | 10% |
| bazaar 200,000 | 22.5 M | 52% |
| pack 3,200 | 0.64 M | 13% |
| strings 8 | 143.8 M | 31% |
| typeset 1,000 at 300 | 29.8 M | 6% |
| flock 100 ticks, 5,000 birds | 291.7 M | 13% |

Most are lists, trees and orders that a value keeps, not frame-local.
Two kinds are frame-local:

1. A record that is read only by its parts.
2. The frames of non-tail recursion turned into loops (`$down` functions).
   These hold several values and have a case per call site, so C327d's one
   growable stack doesn't take them. They are 41% of flock's structs.

The first is chosen-parts.ts, which core JavaScript already ran. It now
runs on WebAssembly too, after columns. It also takes a record made of
values that aren't flat, such as array reads that may fail: those are
worked out first, in order, as lets. One example is the pair of strings'
FFT items in `difference at`'s zipped fold.

| program | structs before | after | time before | after |
|---|---|---|---|---|
| strings 8 | 143.8 M | 93.5 M (−35%) | | |
| strings 32 | | | 4.42 to 4.67 s | 3.99 to 4.43 s |
| flock 100 × 5,000 | 291.7 M | 233.8 M (−20%) | 5.16 to 5.44 s | 5.17 to 5.46 s |

The other six benchmarks make the same structs. All eight print the same.
Left: the `$down` frames (several fields, a case a call site) as one stack,
on C and on WebAssembly.

## C327g part 2a, a case with no fields made once on WebAssembly (2026-11-25)

A case with no fields (an empty list, `none`, an order's `less` and
`greater`, a frame's `done`) was a struct made at each use. Nothing can
tell two of them apart and nothing writes them, so each such case is now
one struct in an immutable global, as a fold stack's `done` already was.
`NO_NIL_GLOBALS=1` turns it off.

| program | structs before | after |
|---|---|---|
| scan 3,200 | 141.8 M | 81.7 M (−42%) |
| mini 8,000 | 12.36 M | 9.87 M (−20%) |
| bazaar 200,000 | 22.26 M | 15.02 M (−33%) |
| pack 3,200 | 602 k | 388 k (−36%) |
| strings 8 | 93.5 M | 86.6 M (−7%) |
| typeset 1,000 at 300 | 10.46 M | 10.08 M (−4%) |
| flock 100 × 5,000 | 233.8 M | 166.8 M (−29%) |
| mnist reverse 300 | 844 k | 767 k (−9%) |

All eight print the same. Times, five runs each: scan 3,200 2.21 to 2.32 s
before, 2.12 to 2.20 s after; bazaar 200,000 1.18 to 1.45 s both; strings
32 4.61 to 5.27 s, 4.60 to 4.87 s; flock 100 × 5,000 5.34 to 5.79 s,
4.90 to 5.90 s.

## C327g part 2b, a deep loop's frames kept spare on WebAssembly (2026-11-25)

deep-loops.ts makes non-tail recursion two loops: `$down` makes a frame
a call (a case a call site, holding the locals what comes after it
reads and the frame under it), and `$up` reads each frame once, as its
case's scrutinee. Once `$up` has read a frame's locals and the frame
under it, nothing names the frame again. So `frame.take` now puts it on
its case's spare list, linked through its own `next`, and `frame.new`
in `$down` writes a spare frame's fields again when there is one
(frame-spares.ts). A run makes frames only as deep as it goes. This is
only done where `$up`'s case is the one place a frame is read.
`NO_FRAME_SPARES=1` turns it off.

| program | structs before | after |
|---|---|---|
| flock 100 × 5,000 | 166.8 M | 69.8 M (−58%) |
| pack 3,200 | 388 k | 254 k (−35%) |
| bazaar 200,000 | 15.02 M | 14.20 M (−5%) |
| strings 8 | 86.6 M | 86.3 M |
| mnist reverse 300 | 767 k | 767 k |

scan, mini and typeset make the same structs. All eight print the same.

Under Node it costs time. In nine runs, flock 100 × 5,000 took 5.06 to
5.59 s before and 5.37 to 5.91 s after, about 4% slower. A build that
took frames but never kept them ran as fast as before, so the cost is
in writing the kept frames again, not in the extra tests. A kept frame
outlives V8's young generation, so each write of a young value into it
goes through the write barrier and the remembered set. scan, bazaar
and strings took the same time. It stays on: allocations are judged by
the structs a run makes, not by one engine's collector (2026-11-25).

## C327e on WebAssembly, a closure passed as its captures (2026-11-25)

On WebAssembly closures were up to a third of the structs a run makes:
mini 37%, typeset 34%, scan 15%. Every closure that made many was given
to a function that the lowering had already copied for it, such as
`any pass·contains.λ` or `map.onto·moved.λ`. A copy like that calls
the closure's code directly, and takes the closure only to hand it to
the code, or on to the next copy. closure-parts.ts finds these inputs
and passes the closure's captures in their place, to the copies and to
a copy of the code that reads the captures as inputs. It works out
which code each input carries from the closures given to it, and
through inputs that pass it on, then drops any input that is given
anything else or used any other way. `NO_CLOSURE_PARTS=1` turns it off.

| program | structs before | after |
|---|---|---|
| scan 3,200 | 81.7 M | 69.7 M (−15%) |
| mini 8,000 | 9.87 M | 6.23 M (−37%) |
| bazaar 200,000 | 14.20 M | 13.31 M (−6%) |
| pack 3,200 | 254 k | 230 k (−9%) |
| strings 8 | 86.3 M | 84.8 M (−2%) |
| typeset 1,000 at 300 | 10.08 M | 6.62 M (−34%) |
| flock 100 × 5,000 | 69.8 M | 68.8 M (−1%) |
| mnist reverse 300 | 767 k | 727 k (−5%) |

None of these programs makes a closure any more, and all eight print the
same. mini 8,000 runs 0.39 to 0.45 s before and 0.36 to 0.39 s after,
about 8% faster. The others take the same time, within the noise.

## C327f part 4a, records written in place per value (2026-11-26)

owned-records.ts writes a record made from fields of one local of its
type into that local when holders.ts says nobody else holds it, instead
of when one-holder.ts says no value of the type has two holders. The
make counts as giving the local away, so a local read again after it,
handed to a function that keeps it, or held twice, keeps its copy.

To find what the by-type rule found, holders.ts reads more closely:

- a field only read (an item at, a length) is borrowed, as a local is;
- a number, a text, a list or a function may be held anywhere, as
  nothing writes one in place and what comes out of one is shared;
- a part read out of a value gives the value away only where the part is
  given (`first` of a set of texts reads the set);
- a make works out its inputs before its fields go, as a call does
  (`set register` reads the machine's registers, then rebuilds it);
- a closure capturing a record of such fields captures a copy, which
  owned-records.ts makes;
- `handleK:8li2…` no longer counts as handing function 8 to the runtime.

In-place sites, by type before and per value now, on all 22 benchmarks
on JavaScript and WebAssembly: the same in machine, crew, moths, scan and
greenhouse; new in depot (11 on JavaScript), mnist (9) and clinic (1);
lost in bazaar's `plan anti` on JavaScript (its input comes back from
`both`, run on the threads), called once a query. trek's `walked` is no
longer called after lowering. Structs made on WebAssembly are the same on
the eight benchmarks but mnist (−3 k), and every output is the same.

Left (part 4b): a record given to a map's function as an item of a list
or an array (drift's `moved`). holders.ts gives what is read out of a
list or an array more than one holder, so there owned-records.ts still
asks one-holder.ts.

## C327f part 4b, a list's items (2026-11-26)

holders.ts now has a value for a list with one holder: `{it}`, the
holders of what is in it. A list made here (`new`) holds what it was
made of; a case's field of one gives the rest of the list as the list's
own kind and an item as its items'. A match only looks at its value, so
its arms can take the fields one by one. drift's `moved`, given each
mote of a list it maps, now writes it in place per value on core
JavaScript's lists.

Two things kept that from working before. A function nothing calls (the
generic `map`, left after its copies were made) applied every closure of
its type to items from nowhere; it is no longer looked at. And any value
other than a closure or a local handed to the runtime, an Int literal
too, counted as holding every closure, so every closure's code took its
inputs from outside; now what a value may hold is read from its type.

Left, part 4c: four sites still need one-holder.ts's rule by type. An
array's items (drift with its list as an array, the way `ters compile`
holds it), a record captured by a closure given to a map (housefit's
`weather of`), an item read out of a set before the set is changed
(crew's `give`), and a result `both` ran on the threads (bazaar's
`plan anti`).
