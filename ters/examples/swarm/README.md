# swarm

A swarm of motes on a line. Each tick, every mote moves halfway towards
the mote it follows (if that one is still there) and gets a tick older;
a mote whose life is over goes, and `k` new ones are born, each
following one of the 30 born just before it. The motes are kept in one
`Map Int Mote`, keyed by a counter that is never reused, and a mote names
the one it follows by its key: entities and references between them, as
a game's entity store keeps them (BACKLOG C58,
docs/design/data/KEYED-COLLECTIONS.md).

    ters run examples/swarm 40 20
    ters compile examples/swarm -o swarm.mjs && node swarm.mjs 2000 50

The first argument is the number of ticks (2000 when there is none), the
second how many motes are born each tick (50). It prints how many motes
are left and how many were made.

Measured 2026-11-10 (2000 ticks, 50 born a tick, about 2,000 motes alive):
compiled JavaScript 2.8 s, native 1.3 s. In the compiled program the map
is about half of the run: listing its keys each tick (`keys of`, which
lists the entries as pairs, sorted, then takes their keys) is about a
third, mostly the cells and pairs it makes and the collector taking them
back; `value at` about a tenth; put and remove a few percent. Hashing
itself is a small part, so an array part for small Int keys would buy
little here; listing the keys straight from the table would buy most.
