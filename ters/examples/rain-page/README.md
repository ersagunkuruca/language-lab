# rain-page: Rain

Rain on the greenhouse glass at night: 20,000 drops sliding down it, the
greenhouse dark behind with three lamps glowing. Drag across the glass to wipe
the drops away; new ones run in from the top. Closer looks at the glass's
middle two, then four times as close, then at the whole glass again; at
four times most drops are outside the picture, which is what culling
(G14) skips.

It is the example of the GPU and physics rows (BACKLOG G12 to G19).
Each drop is a record of Float32s, as a graphics card keeps
them, and each tick is one map over the drops, so the tick can run as a
compute kernel (G12) on data that never leaves the GPU (G13). The picture
is one frame with two draws: the glass behind, one quad, and every drop,
a small square shaded as a bead.

Every product in a drop's slide is by a power of two, so it is exact. A
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

Credits: random numbers by the ZX81's generator (Sinclair Research, 1981);
a fixed step after Glenn Fiedler's Fix Your Timestep (2004); the fireflies and the points on each bulb spread by Martin Roberts's R2 sequence ("The unreasonable effectiveness of quasirandom sequences", 2018); soft shadows by distributed ray tracing (Robert L. Cook, Thomas Porter and Loren Carpenter, SIGGRAPH 1984); ambient occlusion after Sergei Zhukov, Andrei Iones and Grigorij Kronin ("An ambient light illumination model", 1998); the wall's light kept as Quake's lightmaps were (id Software, 1996); the drops lit by probes, an irradiance volume (Gene Greger, Peter Shirley, Philip M. Hubbard and Donald P. Greenberg, 1998) kept in circular harmonics as Peter-Pike Sloan, Jan Kautz and John Snyder (2002) and Ravi Ramamoorthi and Pat Hanrahan (2001) keep light in spherical ones.
