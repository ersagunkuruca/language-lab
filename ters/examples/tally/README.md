# tally

Counts made-up words into a Map: `counts of` is one fold, each word's
`update at(counts, w, 0, (c) => c + 1)`. The words are `w` and n²'s
remainder by 1009, so some come far more often than others, and about
half of the 1009 never.

    ters run examples/tally 3000
    ters native examples/tally -o tally && ./tally

The fold only counts into the map, so built native the words are counted
in runs on C's threads, each run into a Map of its own from empty, and the
threads' Maps are then added together key by key (C42h,
compiler/src/fold-chunks.ts, MapReduce's combiner). It is the same Map:
Int addition is exact, and a map's entries are in its keys' order.
Both the words' making and their counting go to the threads.

Measured 2026-11-12 on 4 cores, 2,000,000 words: native 0.31 s on one
thread (TERS_WORKERS=0), 0.10 s on four. Compiled JavaScript (0.7 s)
counts in turn: posting the words to Node's workers would cost most of
what they save (by hand in plain JavaScript, 185 to 150 ms).

A Map read for its entries in order (`entries of`) is stored as a tree,
not a hash table, and its counting stays in turn.
