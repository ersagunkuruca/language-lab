# rain-page: Rain

Rain on the greenhouse glass at night: 20,000 drops sliding down it, the
greenhouse dark behind with a lamp glowing. Drag across the glass to wipe
the drops away; new ones run in from the top.

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
WGSL. The slide has a compute kernel too (G12b), each drop crossing as
five words, but the page as written doesn't use it yet. Ticking on every
frame, its drops are stored as a tree of List, and then no map is sent
away (BACKLOG G12d). Ticked from a button instead, the drops stay a list,
and the map goes to the GPU once the GPU is the quicker (gpu-maps.test).
Keeping the drops on the GPU between ticks is G13.

Credits: random numbers by the ZX81's generator (Sinclair Research, 1981);
a fixed step after Glenn Fiedler's Fix Your Timestep (2004).
