# moths-page

The moths of game round 1 (compiler/gaps/moths) on a page: a 512 by 512
canvas painted from the program's marks every frame, with Pause, Step and
Restart. It is the first slice of the greenhouse game (BACKLOG G6) and
the example for G2, the canvas game host.

The canvas is an ordinary `canvas` element with a `paint` attribute: a
function giving a list of `Mark`s (disks, rectangles, segments, writing),
drawn again whenever a cell it reads changes. The swarm lives in a cell,
and `on("frame")` moves it one tick.

Credits: the moths flock by Craig Reynolds's boids (1987); random numbers
by Stephen Park and Keith Miller's minimal standard generator (1988).
