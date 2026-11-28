# rain-page: Rain

Rain on the greenhouse glass at night: 20,000 drops on it, the
greenhouse dark behind with three lamps glowing. Most drops are small
beads that cling where they strike; one in thirty-two is big and runs
down, now and then catching, drawn long with its tail above it. Each
drop is a small lens: the lamps' light seen through it from the side
away from them, a glint, a darker rim. Drag across the glass to wipe the
drops away; the rain strikes the glass again elsewhere. Closer looks at the glass's
middle two, then four times as close, then at the whole glass again; at
four times most drops are outside the picture, which is what culling
(G14) skips.

It is the example of the GPU and physics rows (BACKLOG G12 to G19).
Each drop is a record of Float32s, as a graphics card keeps
them, and each tick is one map over the drops, so the tick can run as a
compute kernel (G12) on data that never leaves the GPU (G13). The picture
is one frame with two draws: the glass behind, one quad, and every drop,
a small square shaded as a lens.

Every product in a drop's slide is by a power of two, so it is exact
(the drops' sizes too, and where a new one strikes: each of across and
up two seeds' spots, one halved, added and wrapped, as the generator's
neighbours fall in rows). A
GPU may fuse a·b + c into one rounding; with exact products that gives the
same Float32 as the CPU, so a kernel's drops are the evaluator's.

Both draws go to the GPU: their vertex and fragment functions lower to
WGSL. The slide is a compute kernel too (G12b), each drop crossing as
five words, and the page runs it there once the GPU is the quicker
(G12d: its drops are lists, so its map is sent away). On SwiftShader's
WebGPU, which runs on the CPU, it never is. Each tick still reads the
drops back. Keeping the drops on the GPU between ticks is G13.

The lamps are a list of three records, made each tick as they flicker,
and the glass's fragment function sums their glow over the list (G15a,
LIGHTS.md). The list goes to the GPU as a storage buffer, its length then
each lamp's three numbers, and the sum is a loop over it in WGSL, in the
list's order, so one shader serves any number of lamps.

A thousand fireflies drift behind the glass, a list made each tick, each
a small light with its own reach. The glass sums the light of those
within reach of each place (`within reach`, G15b), which the compiler
makes one loop over the fireflies, each tested where it is, so no list of
those that reach is made on the GPU. A grid of the fireflies by place,
built on the GPU each tick, lets a pixel test only those filed in its
own cell (G15b2). On SwiftShader a frame takes 0.44 s at 1x, against
1.25 s with every pixel testing every firefly and 0.42 s with no
fireflies.

Behind the glass is the greenhouse's back wall: pots along the bench
and leaves above them, dark discs, lit by the three lamps (G17,
LIGHTMAPS.md). Each lamp is a bulb, so each place on the wall sees a
share of 64 points on it, and its shadows are soft; 32 short rays round
each place darken the corners and the ground under the pots. That is
160 × 120 places, about 2.4 s of work compiled, so the compiler bakes
`back wall` to a file the page carries (BAKING.md): the page loads in
about 150 ms, against 2.4 to 3.4 s tracing it as it loads (Chromium,
SwiftShader). Its red, green and blue are each lamp's light, so the glass
still flickers each lamp each tick.

The drops are lit by where they are (G18, PROBES.md): a grid of 32 × 24
probes over the glass keeps each lamp's light at its place, seen past the
leaves, as the first circular harmonics of where it comes from. A drop's
bead reads the four probes round its middle and shines where it faces
the lamps, dull in a leaf's shadow. The probes take 85 ms compiled, and
the compiler bakes them too.

The fireflies cast soft shadows (G18c, G18d): the glass marches from a
place toward each firefly within reach, each step as long as the nearest
leaf is far, and keeps the narrowest the way gets for how far along,
which is the penumbra. The leaves' distance is read from `leaf field`, a
256 × 192 picture of it, copied in as the wall is: marching the exact
distance (the nearest of 16 discs at every step) made a frame on
SwiftShader 18% slower, the field 1%. A firefly's reach is short next to
the leaves, so its shadows are thin crescents at a leaf's edge.

Now and then the rain turns to hail (G19a, RIGID-BODIES.md). A stone
strikes the glass every fifth tick while it hails, falls, and lands on
the window's sill, where it bounces, rolls and comes to rest against the
others; the stones melt slowly, so the pile never fills the pane. Each
tick finds which stones touch by `neighbours` (a grid, as the moths'),
then solves every touch by sequential impulses, ten passes, each touch
keeping what it has pushed so far and starting the next tick from it, so
a pile rests instead of jittering. The stones are drawn on the GPU as a
third draw over the glass, lit by the probes. A tick for 110 to 120
stones is 2 to 4 ms compiled to JavaScript.

Four stones in ten are chips (G19b): flat shards of ice twice as long as
they are thick, struck at an angle and spinning. Whether two touch is
found by separating axes, each chip's two sides tried as the line between
them, and where they touch by clipping the face that meets the other
against its sides, so a chip lying on another touches at two points and
stays level. A chip on the sill or on a disc is the same, the sill a face
and the disc a point. Each stone carries whether it is a chip, and the
GPU draws the two kinds in one draw.

The hand that wipes the glass pushes the stones too (G19c). It goes where
it is put, and nothing pushes it back: to the solver it is as the frame
is, a body nothing moves, but a stone it touches must part from it at
least as fast as it comes on, its speed found from where it was the tick
before. The sides of the frame don't hold a stone the hand is pushing, so
a wipe along the sill sweeps the hail off its end.

A stone falling fast would be found touching the sill only once it is
well into it, and the overlap pushed out would throw it back up. So the
sill is looked for as far below a stone as it may fall in a tick, and a
touch found before the two meet lets the stone come as near as it is
apart and no nearer (speculative contacts, G19d, after Paul Firth and
Erin Catto): a stone shot at ten times the hail's speed stops on the sill.

Credits: random numbers by the ZX81's generator (Sinclair Research, 1981);
a fixed step after Glenn Fiedler's Fix Your Timestep (2004); the fireflies and the points on each bulb spread by Martin Roberts's R2 sequence ("The unreasonable effectiveness of quasirandom sequences", 2018); soft shadows by distributed ray tracing (Robert L. Cook, Thomas Porter and Loren Carpenter, SIGGRAPH 1984); ambient occlusion after Sergei Zhukov, Andrei Iones and Grigorij Kronin ("An ambient light illumination model", 1998); the wall's light kept as Quake's lightmaps were (id Software, 1996); the drops lit by probes, an irradiance volume (Gene Greger, Peter Shirley, Philip M. Hubbard and Donald P. Greenberg, 1998) kept in circular harmonics as Peter-Pike Sloan, Jan Kautz and John Snyder (2002) and Ravi Ramamoorthi and Pat Hanrahan (2001) keep light in spherical ones; the fireflies' soft shadows by sphere tracing (John C. Hart, "Sphere tracing", 1996) the leaves' distance as Íñigo Quílez marches a soft shadow ("Soft shadows in raymarched SDFs", 2010), the distance kept as samples (Sarah F. Frisken, Ronald N. Perry, Alyn P. Rockwood and Thouis R. Jones, "Adaptively sampled distance fields", 2000); the hail by sequential impulses after Erin Catto ("Iterative dynamics with temporal coherence", GDC 2005; "Fast and simple physics using sequential impulses", GDC 2006) and his Box2D Lite, the overlap pushed out as Jürgen Baumgarte stabilised constraints (1972); the chips' touches by separating axes (Stefan Gottschalk, Ming C. Lin and Dinesh Manocha, "OBBTree", 1996) and clipping (Dirk Gregorius, "Robust contact creation for physics simulations", GDC 2013; Box2D Lite); speculative contacts with the sill after Paul Firth (2011) and Erin Catto ("Continuous collision", GDC 2013).
