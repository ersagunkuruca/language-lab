# A faster evaluator (2026-10-31)

Ersagun, 2026-10-31: "make the evaluator faster if we can". BACKLOG L118.
The method: profile, fix one hotspot per PR, measure before and after, and
stop when the next step buys less than 10%.

## Benchmarks

| benchmark | what it runs |
|---|---|
| Spacetime's charge path | `motion(field(0, 0.5, 0, 0, 0, 1), 400, 0.06)`: 400 steps of a charge in Cl(1, 3), what the page draws |
| Bounce's step | `step(solid, solid bodies)` 20 times, through a definition so the generic arithmetic resolves as on the page |

`node cli/evaluator-bench.ts` runs both (`--no-jets` for the definitions as written; `node --cpu-prof` to profile). Times are one run in a container, Node 22.

## Step 1: the table product as a jet (L118a)

**Profile before.** Spacetime's charge path took 8.3 s. Self time was spread
over the machine (`go` 14%, `step` 10%, `refValue` 7%, `apply` 7%), the
garbage collector (14%) and the parts builtins, which looks like general
interpreter overhead. Timing single calls showed the real cause: one
`clifford product` in Cl(1, 3) took 7.6 ms and one `clifford exp` 5.4 ms.
Every Clifford operation is the prelude's `table product`, a fold over the
algebra's 256 table lines with two 16-part dot products per line, and a
step makes several.

**Fix.** The evaluator runs `table product` natively (src/lang/jets.ts):
the same multiplications and additions in the same order, so the answers
are the same bits. The definition stays the meaning. A part that isn't a
Float64 runs the definition, and `jets: false` runs every library
definition as written.

**After.**

| benchmark | before | after |
|---|---|---|
| Spacetime's charge path, 400 steps | 8.3 s | 0.48 s |
| one `clifford product`, Cl(1, 3), warmed up | 7.6 ms | 0.07 ms |
| Bounce, one solid step | 14 ms | 3.7 ms |

The jet first checked the table's 256 lines on every call, which a second
profile showed as 28% of the charge path (0.78 s); it now reads a table
once and keeps it by the table's identity, as values never change.

Both outputs are byte-identical with and without the jet
(test/jets.test.ts checks the charge path and random products).

## Step 2: the machine itself (measured, not merged)

After step 1 the charge path's time is the machine: in the profile, `go`
12%, `step` 8%, `refValue` 5%, `apply` 4%, the garbage collector 8%, and
no single function or definition above that. Three changes were tried and
timed against main, interleaved, ten runs each:

| change | charge path |
|---|---|
| main after step 1 | 460 to 520 ms |
| a call's argument frame not copied, a call's parts array kept per node | 430 to 500 ms |
| `map parts` and `zip parts` with a function in the language run in the same machine, not a new machine per part | 460 to 520 ms |

Neither is outside the run-to-run noise (about ±10%), so by the rule
neither was merged, and the step-by-step work stops here.

**What would still buy a lot.** The machine walks the code tree and
allocates a frame for every call and every argument, for every value. The
known way past that is to turn each definition into JavaScript closures
once, before running ("closure compilation", Feeley and Lapalme, 1987),
keeping the heap continuation only where a search or a handler needs it.
That is typically 3 to 10 times faster for code like this, and it is a
rewrite of the machine's core (M to L), not a hotspot. It is L118c on the
backlog, waiting on Ersagun. Pages that already run compiled code (I97)
get the compiler's speed without it. That is the general interpreter cost the profile
showed, and the next PR profiles it again.
