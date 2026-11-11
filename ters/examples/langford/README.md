# langford

The first Langford pairing of 1 to n: each number twice in a row of 2n
places, with k places between the two k's. For n = 4: 4 1 3 1 2 4 3 2.
A pairing exists only when n is 0 or 3 more than a multiple of 4, so for
the default, n = 13, the search finds none, and every piece of it fails.
That makes it the example for a `first` on threads whose earlier pieces
are long (BACKLOG C43): queens-first's board lies in its first piece.

    ters run examples/langford 7
    ters native examples/langford -o langford && ./langford 13

The search is queens-first's shape (examples/queens-first): one number
at a time from n down, `one of` the places its pair may start, kept only
if `free` finds both places clear of the pairs placed already. It prints
where each number's pair starts (places counted from 0), from 1 up, or
an empty list when there is none.

Measured 2026-11-11 natively at n = 13, on a machine with 4 cores:

| | time |
|---|---|
| one thread (TERS_WORKERS=0) | 66 s |
| threads, split by the first choice (before C43i) | 20.7 s |
| threads, split by the first two choices (C43i) | 16.9 s |

Before C43i the threads didn't run at all: a `first` went on them on C
only when its answer was a number or data, and here it is an array.
