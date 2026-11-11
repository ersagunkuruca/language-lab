# herd

A herd of animals on a plane. Each tick every animal moves a tenth of the
way towards the animal it follows (if that one is still there), wanders
a little (64 small steps of a sine each way, the costly part), and gets
a tick older; an animal whose life is over goes, and `k` new ones are
born, each following one of the 30 born just before it. The animals are
kept in one `Map Int Animal`, keyed by a counter never reused, and an
animal names the one it follows by its key: entities, references between
them that stay stable as others come and go, and work each tick that
only computes, so it may run on several cores (BACKLOG C58, C61).

    ters run examples/herd 20 10
    ters native examples/herd -o herd && ./herd 200 50

The first argument is the number of ticks (200 when there is none), the
second how many animals are born each tick (50). It prints how many are
left, how many were born and the sum of their x.

Measured 2026-11-11 (200 ticks, 50 born a tick, about 2,000 alive), on
a machine with 4 cores:

| | one core | 4 cores |
|---|---|---|
| hand-written C (compiler/gaps/herd.ideal.c) | 1.31 s | 0.40 s |
| hand-written JavaScript (compiler/gaps/herd.shared.mjs) | 1.69 s | 0.53 s |
| `ters native` | 1.36 s | 0.46 s |
| `ters compile` (Node) | 2.0 s | 1.0 s |
| `ters wasi` (Node's WASI) | 2.07 s | |

Natively the map of each tick first stopped the compiler (a map on the
threads met where a call's record is read first, C61f), then ran on one
thread, as a table could not be shared with the threads (1.40 s), then
waited a millisecond of each tick before sharing (0.60 s).
