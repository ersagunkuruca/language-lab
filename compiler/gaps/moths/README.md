# moths

Moths flocking in a walled-in garden at night (GAPS.md game round 1,
BACKLOG G3): the inner loop of a game's update, the kind every engine has
to make fast. The garden is a 256 m square that wraps round at its edges.
Each moth keeps away from the moths near it, flies as they fly and gathers
toward them (Craig Reynolds's boids, 1987), and is drawn to the nearest of
four lamps that is lit; the lamps come on and go off in turn, so the swarm
moves from one to the next.

A moth sees 8 m. Each tick the moths are filed in a grid of 8 m cells by
the cell they are in (a list of moth numbers per cell), so a moth only
looks at the moths in its own cell and the eight around it: a uniform grid
hash, the simplest space partition. Then every moth's next place and
velocity is worked out from the swarm as it was, a `map` that only
computes, so it may run on several threads.

    ters run compiler/gaps/moths 50 300
    ters native compiler/gaps/moths -o moths && ./moths 100 10000

The arguments are the ticks (100) and the moths (10,000). It prints a
checksum of where the moths are and their mean speed every 25 ticks.

It was written through the Ters MCP server's tools, 61 definitions, by a
driver kept in the project's files (`game-g3/`). The hand-written ideals
are `../moths.ideal.c` and `../moths.ideal.js`: the moths as columns and
the grid as a counting sort each tick, the same arithmetic in the same
order, so every way prints the same digits.

Credits: the flocking rules are Craig Reynolds's boids (1987, influence);
the random numbers are Stephen Park and Keith Miller's minimal standard
generator (1988). Both are named in the program's own `credits`, which it
prints.
