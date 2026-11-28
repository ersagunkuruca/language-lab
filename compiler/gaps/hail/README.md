# hail

rain-page's hail as a benchmark (GAPS.md game round 5, BACKLOG G20):
physics at scale against hand-written C. The program is
`examples/rain-page` with a `main` that lays discs of ice on the sill in
rows of 50, each row a little to one side of the one below, and ticks
them between showers with the hand off, so they fall onto each other and
settle into a pile. Each tick every disc falls and melts a little,
`neighbours` finds which may touch (a grid), each touch starts from last
tick's impulses, ten passes of sequential impulses solve them, and the
discs move (RIGID-BODIES.md).

`ters run compiler/gaps/hail [ticks] [discs]` ticks 100 times over 1,000
discs and logs how many are left and their places' sum every 25 ticks.
`compiler/gaps/hail.ideal.c` and `hail.ideal.js` are the same physics by
hand and print the same digits; `node compiler/gaps/bench-hail.ts` races
them against every target.
