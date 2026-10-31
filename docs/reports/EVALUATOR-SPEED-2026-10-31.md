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

**Next.** The rest is the machine around the jet: `go`, `step`,
`refValue`, `parts` and the garbage collector. That is the general interpreter cost the profile
showed, and the next PR profiles it again.
