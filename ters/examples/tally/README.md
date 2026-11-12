# tally

Counts made-up words into Maps: `counts of` is one fold, each word's
`update at(counts, w, 0, (c) => c + 1)`. The words are `w` and n²'s
remainder by 1009, so some come far more often than others, and about
half of the 1009 never. main counts all n words, then the first half
again, for its first three words in order: a Map read in order is stored
as a tree (map-tree.ts). compiler/gaps/tally-by-key is the same program
read only by key, whose Map is a hash table.

    ters run examples/tally 3000
    ters native examples/tally -o tally && ./tally

The fold only counts into the map, so built native the words are counted
in runs on C's threads, each run into a Map of its own from empty, and the
threads' Maps are then added together key by key (C42h,
compiler/src/fold-chunks.ts, MapReduce's combiner): a tree's by a join
compiled from its own update at (C42i), a hash table's by the C runtime. It is the
same Map: Int addition is exact, and a map's entries are in its keys'
order. Both the words' making and their counting go to the threads.

Measured 2026-11-12 on 4 cores, 2,000,000 words: native 1.9 s on one
thread (TERS_WORKERS=0), 0.54 s on four (a tree's count of 2,000,000 alone
1.2 to 0.33 s; tally-by-key's hash table 0.31 to 0.10 s). Compiled
JavaScript counts in turn: posting the words to Node's workers would cost
most of what they save (by hand in plain JavaScript, 185 to 150 ms).
