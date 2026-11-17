# greenhouse-page

A night in a greenhouse, to play. Moths eat the plants and fly to the
light; walk with the arrows or WASD and hang the lamp (Space) to lead them
away. Hanging it leaves your hands empty, and Space near a hung lamp takes
it down again. Dawn comes after 90 seconds, and the page says how many of
the 24 plants made it through.

The game is compiler/gaps/greenhouse with a page for a main (BACKLOG G6):
one `Pool` of things with optional parts (moths, plants, hung lamps), a
tick of systems over it, painted on a canvas from marks (G2). The page
keeps the keys held now as a set, and the seconds the frames gave that no
tick has used yet. Each frame runs as many ticks of 1/30 s as those
seconds hold, four at most, so the game runs at the same speed at any
frame rate.

Credits: the moths flock by Craig Reynolds's boids (1987); random numbers
by Stephen Park and Keith Miller's minimal standard generator (1988);
entities as a pool of things with optional parts, after Unity DOTS, flecs
(Sander Mertens), Bevy and EnTT (Michele Caini).
