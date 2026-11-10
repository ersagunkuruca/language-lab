# nicomachus

Nicomachus's theorem, checked for every k below `below`: 1³ + 2³ + … + k³
is (1 + 2 + … + k)², the square of a triangular number. Then whether some
k below it has a sum of cubes past 10¹² (the first k past about 1414 has).

    ters run examples/nicomachus 200
    ters compile examples/nicomachus -o nicomachus.mjs && node nicomachus.mjs 12000

The argument is `below` (4000 when there is none). The check is one
`all pass` and the question one `any pass`. Each test only computes and
always ends, since a sum over a range is a fold over a finite list. So the
checker knows the ks can be tested at once (pure-branches.ts
`parallelLists`), and the compiled program tests runs of them on worker
threads on Node (C43, compiler/src/branches-rt.ts). Every thread takes
runs from the front and stops past the first k that decides, so the
answers are the same as testing in turn. Measured 2026-11-10 on 4 cores:
the default 0.8 to 1.1 s in turn and 0.5 s with three workers; below 12000,
8.3 s and 3.0 s.

A test that might run forever (general recursion, such as collatz's walk)
isn't shared by all pass or any pass. Run in turn they may stop before
reaching it, and run at once they would wait on it.

The sums are Float64s, exact while they stay under 2⁵³: past k ≈ 13,700
the check fails for that reason alone.
