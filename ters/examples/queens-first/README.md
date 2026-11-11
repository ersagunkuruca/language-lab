# queens-first

The first board of n queens on an n by n board with none attacking
another, found by the same search as queens-count (its `queens` and
`safe`), with `first` in place of `count`.

    ters run examples/queens-first 8
    ters native examples/queens-first -o queens-first && ./queens-first 28

The argument is n (11 when there is none). The board is printed a
column a row, from the last row placed.

Measured 2026-11-11 natively on one thread, n = 28: 7.7 s, and 6.8 s
once an array's items are read without taking a count (C207g); the same
search written by hand in C, its queens in an array of doubles, 2.3 s.
The threads give nothing here, and a split by the first two choices
(BACKLOG C43) can't: the first board lies under the first row's first
column and the second row's third, and every piece before that one fails
at once, so all the work is in one piece. A first is helped by the
threads when its earlier pieces are long and fail, as divisors' are.
