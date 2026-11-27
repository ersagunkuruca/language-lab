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

Today both draws go to the GPU (their vertex and fragment functions
lower to WGSL), and the slide runs on the CPU.

Credits: random numbers by the ZX81's generator (Sinclair Research, 1981);
a fixed step after Glenn Fiedler's Fix Your Timestep (2004).
