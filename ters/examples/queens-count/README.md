# queens-count

How many ways there are to place n queens on an n by n board with none
attacking another. It uses queens' definitions, and its main is one
`count`.

    ters run examples/queens-count 6
    ters compile examples/queens-count -o queens-count.mjs && node queens-count.mjs 12

The argument is n (11 when there is none). The search only computes and
chooses, so the checker knows it can be split up (pure-branches.ts
`parallelCounts`). On Node, the compiled program runs it once for each
column of the first row (C43, compiler/src/branches-rt.ts `countPure`).
The first run is on this thread and finds how many columns there are, and
the others run on worker threads. Each run keeps only its own column at
that first choice (`choose.split`), and a search inside it keeps all of
its own choices. The counts add up to the whole search's count.

Measured 2026-11-10 on 4 cores, which other work shared, so the times
varied by a second: n = 12 (14200 boards) took 6.2 to 7.5 s in turn and
3.4 to 3.7 s with three workers. n = 11 (2680) took 1.3 to 1.4 s either
way, since the first column runs alone before the workers start.
