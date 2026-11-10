# swarm-pool

examples/swarm on std's Pool (BACKLOG C58,
docs/design/data/KEYED-COLLECTIONS.md): the same swarm of motes, with the
same answers, but the motes are kept in a `Pool Mote`, which gives out
the keys. A mote that dies frees its slot, and the next one born takes it
(the pool's free list). A mote names the one it follows by its `Pool
key`, and a key kept after its mote died finds nothing, even once the slot
holds another mote (the slot's generation went up). The 30 most recent
keys are kept in a list, so a newborn mote can follow one of them.

    ters run examples/swarm-pool 40 20
    ters compile examples/swarm-pool -o swarm-pool.mjs && node swarm-pool.mjs 2000 50

Measured 2026-11-10 (2000 ticks, 50 born a tick, about 2,000 motes alive,
on the slots of at most a few thousand):

| | Map (examples/swarm) | Pool |
|---|---|---|
| compiled JavaScript | 2.6 s | 1.5 to 1.8 s |
| native | 1.35 s | 0.82 s |

At first the pool was 190 s compiled: its lists were inside a library
type, so they stayed cons lists, walked on each lookup. Now
`own-holders.ts` copies the Pool into the program, and its lists are
stored as arrays like the program's own. Keeping the recent keys with
`append([key], recent)` instead of `cons` made the chooser pick trees for
the whole program; with `cons` every list is an array.
