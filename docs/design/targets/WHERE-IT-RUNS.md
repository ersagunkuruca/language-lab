# Where code runs, chosen by cost (C61)

Status: design note, C61's first step (2026-11-06). Built since: a
together's pure branches on worker threads on Node (C41, 2026-11-09,
compiler/src/branches-rt.ts, examples/area), and a `map` of a function
that only computes by runs of its items (C42's first step, examples/mandelbrot-rows) a `keep` likewise (C43a, examples/collatz), `all pass` and `any pass` stopping past the first deciding item (C43b, examples/nicomachus), and `first where` likewise (C43c, examples/divisors),
with the threshold measured as it runs (a branch past 20 ms starts the
workers; a map site keeps what an item took, and a map under a
millisecond by that is the compiled one) rather than priced. In C (L101,
2026-11-10, compiler/src/c.ts `par:map`) an array's map of a function that
only computes runs its items on a pool of threads once they have taken a
millisecond: mandelbrot-rows native, 1200 columns and 5000 steps, 2.8 s on
one thread and 0.75 s on four. What the threads share (the function and
the items) is marked shared first, and only such cells' counts change
atomically, as Koka's and Lean's runtimes do. A together whose actions
only compute runs them on the same threads (C201): examples/area native,
side 2400, 2.5 s to 0.86 s.
The goal is in [STABLE-REFERENCES.md](../data/STABLE-REFERENCES.md) §6:
every processing environment a target has (on the web: the main thread,
Web Workers, WebAssembly, the GPU through WebGPU compute) used without the
program saying which. Where a part runs is a choice like a representation,
made by the compiler by cost, never written.

## What Bend 2 does (read 2026-11-06)

Bend 1 (2024) ran on HVM2, an evaluator of interaction combinators: every
reduction is local, so any two can run at once, and the runtime spread them
over CPU threads or CUDA cores with nothing written. The price was a
constant factor per interaction, so a single thread was far slower than C.

Bend 2 (September 2026) keeps interaction nets in the design but not at run
time. It compiles to one C file (clang for the CPU, Metal or CUDA for the
GPU) and is "designed to be practical, not idealistic":

- **CPU threads, automatic.** Code written as divide and conquer (a call
  that splits its work into independent calls) is spread over the cores by
  the runtime. No threads, locks or kernels are written.
- **The GPU, marked.** A call is sent to the GPU with the `!` operator.
  Whether the GPU pays is the programmer's call, not the compiler's.
- **Memory without a collector.** Affine parameters (`+`) and closures
  called at most once let memory be settled statically.
- Reported: Game of Life on an M4 Max, 7.8 s on one core (C: 6.78 s), 0.06 s
  on the GPU. In one outside port test, never faster than Rust on the same
  work.

So the one system that started from "everything parallel, nothing written"
now writes the GPU by hand and keeps automatic splitting for CPU threads
only. Two lessons for us. Splitting independent calls across cores
automatically is practical once the code is compiled, not interpreted.
Choosing the GPU automatically is the hard part, because a wrong choice
costs a lot: a dispatch, a copy each way and a wait.

## What we have already

- **Eligibility is in the type.** A definition's row says whether it can
  leave the main thread: a pure row (Diverge spent from a budget, Choice
  as a flag) can run in a worker or a shader, Console, Files, Cells or
  Update keep it on the main thread. Since L22c the GPU's "no" for effects
  is told from the type and carried to callers (profiles.ts); the lowering
  (scalar.ts `shader`) adds what the type doesn't show.
- **Independent work is visible.** `together` names branches that don't
  depend on each other (C41 runs pure ones on workers); a `map` over an
  array and an associative fold are data-parallel (C42); Bend's divide and
  conquer is a fold over a tree, whose two halves are a `together`.
- **One holder is known.** C63a's check tells when a value has one holder.
  That is what makes moving data cheap (below), as Bend's affine
  parameters do for its memory.
- **Costs are already weighed.** The representation chooser prices jobs
  and weighs a job in a loop by n (C63c). WAYS.md picks a way by declared
  cost per target.

## Measured: what leaving the main thread costs

Node 22, this container, one worker, summing √ of a Float64Array (about
2 ns an item on one thread):

| items | copied there and back | transferred there and back | on the main thread |
|---|---|---|---|
| 1,000 | 0.40 ms | 0.34 ms | 0.05 to 0.19 ms |
| 100,000 | 6.2 ms | 0.72 ms | 3.5 to 4.7 ms |
| 1,000,000 | 23 ms | 3.5 ms | 2.3 ms |
| 10,000,000 | 226 ms | 26 ms | 23 ms |

Starting the worker and its first round trip: 50 ms. A copy costs about
20 ns an item there and back, ten times this work. A transfer (the
buffer's ownership moves, nothing is copied) costs nearly nothing beyond
the round trip, about 0.3 ms. So:

1. A part moves only when its work per item is well above what moving an
   item costs: with copies, about 20 ns an item; with transfers, only the
   round trip and the start.
2. **A transfer needs one holder.** After `postMessage(…, [buf])` the
   sender's buffer is empty, which is safe exactly when nothing else holds
   it. The one-holder check that lets a table change in place (C63a) is the
   one that lets an array move to a worker for free. Arrays held twice are
   copied, or stay.
3. Workers are started once, at the program's start or its first use, and
   kept (as the editor's Run worker is, I177a); 50 ms per part would eat
   any gain.

The GPU adds the same shape with bigger numbers: a buffer written, a
dispatch, and a read back that is always asynchronous on the web
(`mapAsync`). Measured (step a, `node compiler/gaps/bench-places.ts`):
Chromium's WebGPU on SwiftShader, which is the GPU emulated on this
container's 4 CPU cores, so a real GPU will do the work far faster and the
moving about the same. Each item is x ← √(x² + 1), once or 100 times,
Float32 there and Float64 on the main thread:

| work per item | items | GPU, there and back | main thread |
|---|---|---|---|
| 1 | 1,000 | 3.2 ms | 0.1 ms |
| 1 | 100,000 | 3.6 ms | 9.0 ms |
| 1 | 1,000,000 | 24 ms | 5.4 ms |
| 1 | 4,000,000 | 89 ms | 13 ms |
| 100 | 1,000 | 2.6 ms | 0.7 ms |
| 100 | 100,000 | 9.2 ms | 62 ms |
| 100 | 1,000,000 | 79 ms | 625 ms |
| 100 | 4,000,000 | 318 ms | 2,554 ms |

A dispatch and its read back cost about 3 ms however small the work, and
moving costs about 20 ns an item (4 bytes each way), as a worker's copy
does. So a map with little work per item never pays, at any size: the
moving alone is several times the work. With 100 steps an item it pays
from about 10,000 items, and is 8× at a million even emulated. The rule
for the price list: leave when (work per item − moving per item) × n is
more than the fixed cost, with a margin. The same bench with a worker:
one worker is no faster than the main thread at the work itself, as
expected; what it buys is the main thread free (a page that stays
responsive) and, with a pool, the cores. GPU=1 runs the bench on a real
adapter where there is one.

## The hard constraint: leaving is asynchronous

On the web nothing that leaves the main thread comes back synchronously: a
worker answers with a message, the GPU with a promise. So a part can leave
only where its caller can wait for it, which in Ters terms is where a wait
is allowed (a page's handler, a main that waits, PAGE-WAITS-2026-11-03.md;
the core IR's rests, C181's cps). Inside a plain function called from a
view, the part stays. This decides more than the cost model does:
eligibility = a pure row, plus a caller that can wait. Between frames (a
game's step, the ray marcher's image) the wait is the frame itself.

On native targets (C, and WebAssembly with threads) a worker can be waited
on synchronously, so the constraint is the web's and not the language's.

## The choice

A place is chosen per call of an eligible part, the way a representation
is chosen per value:

- **Candidates:** a `together`'s pure branches (workers, C41), a `map` or
  associative fold over an array (a pool of workers, then a compute shader,
  C42), a pure call whose arguments are arrays of numbers or one-case
  records (the GPU, when the shader lowering takes it).
- **Cost:** work estimated as the chooser does now (a job by n, n from the
  array's length where known, else declared) against moving: a start once
  per program, a round trip per call, and per item a copy, or nothing when
  the array has one holder and is transferred. The constants come from a
  measurement per target, as above.
- **Default:** stay. A part leaves only when the estimate says it gains
  more than a margin (as the 10% rule), so a wrong guess costs little.
- **Seen, not written:** the editor's "Where it runs" panel (L22a) says
  where each part was put and why, as it says why a part can't run on the
  GPU now.

## Steps

Each about an hour, measured first:

- **(a) done: Measure the GPU** the way the table above measures a worker:
  WebGPU compute in Chromium (compiler/gpu.ts already runs a scalar
  function as WGSL), a buffer there and back plus a dispatch, at 1,000 to
  10,000,000 items, against the same loop in JavaScript. Gives the break
  even for a pure map.
- **(b) The price list:** a per-target table of these constants beside
  library-reps.ts's costs, read by the chooser.
- **(c) A first choice, workers for a map:** a pure `map` over an array
  with one holder, in a page's handler or a waiting main, runs on a kept
  pool when the estimate says so; the same answers as on the main thread
  (a test against the evaluator), and an example whose map gains, timed.
  Builds on C41's worker plumbing and C42's map.
- **(d) The GPU for a map,** after (a) says where it pays: the shader
  lowering's function as a compute kernel over the array.
- **(e) Divide and conquer:** a fold over a tree whose halves are
  independent, split across the pool to a depth set by the item count, as
  Bend 2 does with its splits.

## Prior art

- Bend and HVM (Victor Taelin, Higher Order Company): HVM2, a parallel
  evaluator for interaction combinators (2024), automatic CPU and GPU
  parallelism; Bend 2 (2026), compiled to C, automatic CPU splitting, the
  GPU marked with `!`, affine parameters. Read from the Bend repository
  (github.com/HigherOrderCO/Bend) and Fabio Akita's review "New AI-Focused
  Language Just Released: Bend 2" (akitaonrails.com, 2026-09-19). Prior
  art; our choice by cost and our one-holder transfers are our own.
- Interaction nets: Yves Lafont (1990, 1997).
- Unity's Burst and job system; Futhark (Henriksen et al. 2017) and
  Accelerate (Chakravarty et al. 2011) for data-parallel code on GPUs;
  Halide's algorithm and schedule (Ragan-Kelley et al. 2013); Cilk's work
  stealing (Blumofe et al. 1995), as STABLE-REFERENCES.md §6 and C41 to
  C43 credit.
- Transferable objects: the HTML standard's `postMessage` transfer list.
