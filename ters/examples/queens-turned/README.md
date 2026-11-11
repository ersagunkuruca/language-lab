# queens-turned

The first board of n queens on an n by n board, none attacking another,
that a half turn leaves the same: queens-first's search (its `queens` and
`safe`) with each board that turns into another failed.

    ters run examples/queens-turned 8
    ters native examples/queens-turned -o queens-turned && ./queens-turned 14

The argument is n (11 when there is none). The board is printed a
column a row, from the last row placed.

Written for BACKLOG C43, a first of a search split by its first two
choices on C's threads, which helps only when the pieces before the
answer's are long and fail. Here they are, but the answer's own piece is
longer still. Measured 2026-11-11 natively, n = 15: 9.5 s on one thread
and 8.7 s with the threads. The first board has row 0's queen in column 1
and row 1's in column 3, and every other piece under column 1 fails at
once, so a split by two choices leaves the work in one piece too.

Building it natively found a bug: a map of Float64s on the threads (the
turned board's columns) didn't link.
