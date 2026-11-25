# sparks

A firework's sparks, each a record of four Float32s (where it is and how
fast it goes), moved a hundred steps: each step a spark moves by its
speed, is slowed by the air and pulled down. Float32 is what a graphics
card keeps, so a program that hands its sparks to one computes what the
card would.

    ters run examples/sparks 200
    ters compile examples/sparks -o sparks.mjs && node sparks.mjs 300000

The argument is how many sparks (1000 when there is none); it prints the
sum of their heights after the hundred steps.

It is the program BACKLOG C309 waited for: since C309 a Float32 is held
in 32 bits where it is kept, not as a Float64 rounded at every step. In
C a spark is four floats (sixteen bytes, not thirty-two); compiled to
JavaScript the sparks are columns, each a Float32Array. On WebAssembly
they are columns too, each an array of f32s (300,000 sparks in Node 8.4 s
as rows, 0.9 s as columns). Measured
2026-11-23 at 300,000 sparks on one machine: JavaScript 0.35 s, C 0.07 s,
the same as with Float64 rooms at this size, in half the memory.
