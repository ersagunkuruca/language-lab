# flock

3D boids (GAPS.md game round 3, BACKLOG G6d): the stress test beside
Night watch, which Ersagun asked for as a boids flock, in 3D. Birds fly in
a 120 m box split into 12 x 12 x 12 cells of 10 m. Each tick, every bird
reads the birds in its own cell and the 26 around it, and for those
within ten metres it keeps apart, matches their heading and moves toward
their middle. A goal that sweeps the box pulls the flock along, and the
walls push back. Speeds stay between 0.8 and 1.8 m a tick.

The goal sweeps along triangle waves, not sin and cos, so every way
(evaluator, compiled JS, wasi, native, and the C and JS written by hand)
prints the same digits.

`ters run compiler/gaps/flock [ticks] [birds]` flies 100 ticks of 5,000
birds and logs a checksum and the mean speed every 25 ticks.
`examples/flock-page` is the same flock drawn in perspective.

Credits: the birds flock by Craig Reynolds's boids ("Flocks, herds and
schools", SIGGRAPH 1987), looking only at their own cell of a grid and the
26 around it; random numbers by Stephen Park and Keith Miller's minimal
standard generator (1988).
