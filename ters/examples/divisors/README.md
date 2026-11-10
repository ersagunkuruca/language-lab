# divisors

The first n below `below` whose triangular number 1 + 2 + … + n has more
than `more than` divisors, or none.

    ters run examples/divisors 1000 100
    ters compile examples/divisors -o divisors.mjs && node divisors.mjs 20000 500

The first argument is `below` (10000 when there is none), the second
`more than` (400). n and n + 1 share no factor, so the triangular number's
divisors are counted as the even one's half's count times the other's,
each count trying every number up to it.

`main` is one `first where`, whose test only computes and always ends, so
the checker knows the ns can be tested at once (pure-branches.ts
`parallelLists`), and the compiled program tests runs of them on worker
threads on Node (C43, compiler/src/branches-rt.ts). Every thread takes
runs from the front, and a run past the first n that passes stops between
items, so the answer is the one testing in turn gives. Measured 2026-11-10
on 4 cores: the default (5984) 2.6 s in turn and 1.7 s with three workers;
more than 500 below 20000 (12375), 13.0 s and 4.4 s. A small search, more
than 300 (2079), is 0.7 s in turn and 0.9 s with workers, which then cost
more than they bring.

The division in the count may fail (by zero), so it is taken through
`first`; j is never 0 there.
