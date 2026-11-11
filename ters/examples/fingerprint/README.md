# fingerprint

A hash of the numbers below `below`, in order: for each number n, the
steps the thousand numbers n · 1000 + 1 to n · 1000 + 1000 take to reach 1
(the Collatz map, as in examples/collatz), put into the rest's hash as
hash · 31 + walks, kept to 30 bits.

    ters run examples/fingerprint 20
    ters compile examples/fingerprint -o fingerprint.mjs && node fingerprint.mjs 3000

`fingerprint of` is one fold. Its join is no sum: the order counts, so the
parts can't be put together in any order, as collatz's `walks of` can
(C42d). But each number's walks only compute and never read the rest's
hash, so the compiled program works them out first, as a map over the
numbers that goes to worker threads on Node, and then puts the hashes
together in turn (C42e, compiler/src/fold-items.ts). The fingerprint is
the same as working them out in turn.

Measured 2026-11-11 on 4 cores, below 3000: 6.1 to 8.0 s in turn, 2.1 s
with the walks on three workers and the main thread. TERS_WORKERS=0 keeps
every run on the main thread; TERS_BRANCHES=say says how many runs went to
workers. Built native
(`ters native examples/fingerprint -o fingerprint`), the numbers are an
array and the walks go to C's threads: 1.55 s on one thread, 0.44 s on
four, the same fingerprint.
