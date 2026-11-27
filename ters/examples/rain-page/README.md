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

Credits: random numbers by the ZX81's generator (Sinclair Research, 1981);
a fixed step after Glenn Fiedler's Fix Your Timestep (2004).
