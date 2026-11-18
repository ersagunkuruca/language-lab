# greenhouse-page: Night watch

A game. Moths are after the seedlings, and you're the gardener. Keep at
least 12 of the 24 plants alive until dawn, three nights in a row, each
night with more and faster moths.

- Moths follow light. Your lantern draws the ones near you, so you can
  lead them away from the beds.
- Space swings the net. It catches every moth in a short sweep in front
  of you, then takes a moment to swing again.
- E hangs a lamp as a decoy. You have two. Each burns for 20 seconds, and
  the burnt-out ones are refilled at the shed in the top-left corner.
- Moths come in waves through the vents in the walls, every 10 seconds.
  Small moths nibble. Hawk moths are bigger, browner and eat three times
  as fast, and they ignore hung lamps while your lantern is near.
- Plants left alone grow and bloom. At dawn each plant saved scores 5,
  and each bloom 5 more, on top of the moths in your jar.

Arrows or WASD walk, and Enter goes on between nights. Click the
greenhouse first.

The program uses the shape ENTITIES.md proposes. One `Pool` holds the
moths, plants, hung lamps and puffs, each a place with optional parts. A
tick is systems over the pool: the moths flock and fly, the plants grow or
are eaten, the lamps burn and the puffs fade, and what is spent goes.
Waves add to the pool, and the net takes from it. Everything is painted on
a canvas from marks: winged moths, plants that wilt and flower, the
gardener with lantern and net, and the bar along the top. Each frame runs
as many ticks of 1/30 s as the time since the last one holds, four at
most, so the game runs at the same speed at any frame rate.

It was written through the MCP by `/mnt/project-files/game-g7/` (a
driver kept in the project files). compiler/gaps/greenhouse stays the
plain swarm night, for measuring.

Credits: the moths flock by Craig Reynolds's boids (1987); random numbers
by Stephen Park and Keith Miller's minimal standard generator (1988);
entities as a pool of things with optional parts, after Unity DOTS, flecs
(Sander Mertens), Bevy and EnTT (Michele Caini); a fixed step after Glenn
Fiedler's "Fix Your Timestep!" (2004).
