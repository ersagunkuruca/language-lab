# flock-page: Flock

A stress test, not a game: 2,000 birds in a 120 m box, drawn in 3D. Each
bird looks only at the birds within ten metres and does three things:
keeps apart from the nearest, flies the way they fly, and stays with them.
A point that roams the box draws the whole flock after it, and the walls
push back. Out of that come the swirls and the long ribbons.

Drag the sky with a finger or the mouse to turn and tilt the camera, or
click it and use the arrows or WASD. It turns slowly by itself while
nothing turns it.

The birds are a list of records, flown 30 times a second on a grid of
10 m cells: each bird reads the birds in its own cell and the 26 around
it. The picture is canvas marks drawn in perspective: each bird a dart
that shrinks and darkens with distance, its shadow on the floor, the
floor's grid and the box's edges. Each frame runs the ticks the time since
the last one holds, two at most.

compiler/gaps/flock is the same flock without the page, for measuring
(GAPS.md, game round 3). Both were written through the MCP by
`/mnt/project-files/game-g7/flock.ts`, a driver kept in the project files.

Credits: the birds flock by Craig Reynolds's boids ("Flocks, herds and
schools", SIGGRAPH 1987), looking only at their own cell of a grid and the
26 around it; random numbers by Stephen Park and Keith Miller's minimal
standard generator (1988); a fixed step after Glenn Fiedler's "Fix Your
Timestep!" (2004).
