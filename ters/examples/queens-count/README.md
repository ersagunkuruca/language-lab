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

Native (C203a) it's split the same way on C's threads (c.ts `par:count`),
each thread keeping its own split and seen:

    ters native examples/queens-count -o queens-count && ./queens-count 12

Measured 2026-11-10 on 4 cores: n = 12 took 2.2 s on one thread
(TERS_WORKERS=0) and 0.86 to 0.98 s on four. Since C43g it splits by the
first two choices (144 runs at n = 12, not 12) and goes on the threads
once the search has taken a millisecond: 0.51 to 0.53 s at n = 12, 0.09 s
at 11 (0.34 on one thread), 3.3 s at 13 (12.6), about 3.8× on four.
