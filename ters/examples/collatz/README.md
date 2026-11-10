# collatz

The numbers below `below` whose way to 1 under the Collatz map (halve an
even number, take 3n + 1 of an odd one) is longer than `longer than`
steps: how many there are, the first five, and the last.

    ters run examples/collatz 3000 100
    ters compile examples/collatz -o collatz.mjs && node collatz.mjs 1000000 300

The first argument is `below` (300000 when there is none), the second
`longer than` (300). `main` keeps the numbers with one `keep`, whose test
only computes, so the checker knows the numbers can be tested at once
(pure-branches.ts `parallelLists`), and the compiled program tests runs of
them on worker threads on Node (C43, compiler/src/branches-rt.ts): the
numbers kept are the same, in the same order. Measured 2026-11-10 on 4
cores: the default 0.8 s in turn and 0.5 s with three workers; below
1000000, 2.9 s and 1.5 s. The defaults are sized for the compiled program;
the evaluator is better given a smaller `below`.

The walk counts in Float64, halving with `· 0.5` and testing evenness
with `floor`: Int's bit operations run through BigInt in compiled
JavaScript, ten times slower here.
