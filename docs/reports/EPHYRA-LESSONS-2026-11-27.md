# What Ephyra teaches our testing (2026-11-27)

Ersagun asked (2026-11-27) what [Ephyra](https://github.com/datadog-labs/ephyra), a
property-based testing library by a friend of theirs, could teach us about testing and
bug finding. Not an integration: Ephyra is Rust only, and a spike driving ters from a
Rust test (branch `claude/project-thread-d48ptg`, `ters/props/`) took 4.5 s a case
because it spawned `ters`. The ideas carry over to TypeScript without the library.
Rows: T18a to T18g in BACKLOG.md. Credit: CREDITS.md, "Lessons for our generated tests".

## Verdict

We already do the core of what Ephyra does: generated programs compared across
engines (C101). Its lessons are in how it keeps that search alive and honest. Five gaps:

1. **C101's generator stopped growing on 2026-11-05.** By functions entered (the test
   map, 11-27), `compiler/test/fuzz.test.ts` runs 37,591 of 57,463 lines of
   `compiler/src` (65%; all tests 97%) and 23,626 of 51,941 of `ters/src/lang` (45%),
   and never enters 18 of `compiler/src`'s 96 files. Ephyra's agents steer generators at
   what coverage never reached, round by round. (T18a, then steering rounds.)
2. **We never check that a test catches a bug.** Ephyra keeps each fixed bug's fix,
   reversed, as a patch, and CI checks that the property for its class fails with it
   applied. Re-injecting our own past fixes also finds `affected.ts` holes: main was red
   7.5 of 14 h on 11-27 from tests outside the pre-merge set. (T18d.)
3. **Generated failures don't shrink, aren't saved, and the seed is always 1.**
   Ephyra's compiler harnesses shrink by deletions that keep the program typed, run only
   the failing configuration while shrinking, and replay saved failures first. (T18b, T18c.)
4. **Our only reference is "the evaluator vs the engines".** Ephyra's OCaml harness
   compares trunk with the last release (bugs every backend shares) and seven native
   configurations; its rustc harness samples optimizer settings and random pass toggles,
   and compares compile-time with run-time evaluation. Ours: random `.decisions` entries
   and chooser alternatives (T18e), the `good` tag's evaluator (T18f), incremental vs
   fresh compiles of generated programs, `bake.ts` vs run time.
5. **We test calls, not sequences.** Ephyra generates sequences of steps for anything
   stateful and shrinks the sequence. Our edit tests change number literals in five
   examples; editing scenarios and merges are hand-written. (T18g.)

## Where C101 doesn't reach

| File | Lines | Run by any test | Run by C101 |
|---|---|---|---|
| `c.ts` | 5,521 | 5,470 | 3,222 |
| `scalar.ts` | 6,658 | 6,558 | 4,319 |
| `wasm-table.ts` | 1,349 | 1,333 | 41 |
| `zero-parts.ts` | 1,204 | 1,182 | 137 |
| `wgsl.ts` | 997 | 966 | 237 |
| `core-rt.ts` | 1,110 | 1,096 | 524 |
| `columns.ts` | 615 | 593 | 97 |
| `holders.ts` | 614 | 599 | 124 |
| `untagged-ints.ts`, `fuse-walks.ts`, `pool-shapes.ts`, `gpu-resident.ts` | 1,153 | 1,120 | 0 |

## Smaller lessons

- Failure signatures: group C101's differences so one run reports each distinct bug once.
- Generator health: the share of generated definitions each engine refuses, over time.
- An oracle failing on more than about 1% of inputs is usually wrong itself.
- Re-run a failure once before reducing it; one that doesn't come back is flaky.
- Fault localization from passing and failing coverage (Ochiai) needs line coverage, which
  T16 dropped for speed: last.

## Where Ephyra doesn't apply

- In-language tests stay free of randomness (TESTS-IN-THE-LANGUAGE.md §2), so results
  can be kept by hash; random search belongs in CI and the Nightly, failures kept as cases.
- Engine agreement, forward/backward agreement, laws over small values, C's live-cells
  count and incremental vs fresh checking are already as strong as its case studies' oracles.
- Coverage-guided mutation of inputs needs finer coverage than ours (block coverage was 9x
  slower, T16); steering the generator by hand gets most of the benefit.

## Sources

Ephyra's [README](https://github.com/datadog-labs/ephyra),
[STARTUP.md](https://github.com/datadog-labs/ephyra/blob/main/STARTUP.md),
[API.md](https://github.com/datadog-labs/ephyra/blob/main/API.md),
[CONTRIBUTING.md](https://github.com/datadog-labs/ephyra/blob/main/CONTRIBUTING.md),
[regressions/](https://github.com/datadog-labs/ephyra/blob/main/regressions/README.md), the
[OCaml](https://github.com/datadog-labs/ephyra/blob/main/case-studies/ocaml/harness/README.md) and
[rustc](https://github.com/datadog-labs/ephyra/blob/main/case-studies/rustc/harness/README.md)
harnesses; ours: `compiler/test/fuzz.test.ts`, TESTING.md, DONE.md (C101 to C130), the
`test-map` branch's `map.json` on 11-27.
