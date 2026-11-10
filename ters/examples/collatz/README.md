# collatz

The numbers below `below` whose way to 1 under the Collatz map (halve an
even number, take 3n + 1 of an odd one) is longer than `longer than`
steps: how many there are, the first five, the last, how many steps
all the numbers below take together, and the most any one of them takes.

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

`steps of all` adds every number's steps by a fold whose arm adds one
number's steps to the rest's, which only computes, so the compiled program
works them out for runs of the numbers on worker threads and adds the runs'
sums (C42): Ints add up the same in any order. Measured 2026-11-10 on 4
cores, the whole program at its default: 2.6 to 2.9 s in turn, 1.6 s with
three workers. `most steps` keeps the larger of each number's steps and
the rest's most (`if r < s then s else r`), shared out the same way (the
larger of two Ints is the same whichever comes first): with both, 3.6 s in
turn and 1.95 s with three workers.

The walk is in Int: halving is `shifted down` by one bit and evenness is
`int bits and` 1. Compiled, these are JavaScript's own 32-bit operations
while the numbers are small (C201), so the walk runs within 1.1 times the
same walk in Float64 (measured 2026-11-10: the default 1.2 s against
1.1 s, below 1000000 2.4 s against 2.2 s; the walks pass 2³¹ and agree).
