# greenhouse

A night in a greenhouse (GAPS.md game round 2, BACKLOG G6): the first
slice of the game stage 1 builds toward. Moths come out at night, flock,
fly to the nearest light and eat the plants they land on. The gardener
carries a lamp and can hang it somewhere to lead the moths away.

Everything in the greenhouse is one `Pool Thing`. A thing has a place and
optional parts: a moth has a velocity, a hung lamp a light, a plant a leaf
(ENTITIES.md, G1). Each tick is a few systems over the pool, each a
function of the pool as it was:

- the moths fly: `updated in pool` with the boids of moths (game round 1)
  on a grid hash of the moths, drawn to the nearest light;
- the plants grow, or lose health to each moth on them;
- the plants with no health left go: `kept in pool`.

This folder's main plays a night with no player. The gardener walks a
square and hangs or takes down the lamp every 400 ticks, and the night is
logged every 100 ticks.

    ters run compiler/gaps/greenhouse 200 300
    ters native compiler/gaps/greenhouse -o greenhouse && ./greenhouse 2700 2000

The arguments are the ticks (600; a whole night is 2,700) and the moths
(2,000). There are always 24 plants. ters/examples/greenhouse-page is the
same game to play, on a canvas.

It was written through the Ters MCP server's tools, 88 definitions, by a
driver kept in the project's files (`game-g6/`).

Credits: the flocking rules are Craig Reynolds's boids (1987); random
numbers are Stephen Park and Keith Miller's minimal standard generator
(1988); entities as a pool of things with optional parts, stored as the
compiler chooses, follow Unity DOTS, flecs (Sander Mertens), Bevy and EnTT
(Michele Caini).
