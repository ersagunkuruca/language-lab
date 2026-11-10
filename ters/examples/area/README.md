# area

The area of the Mandelbrot set, counted on a grid: a point is inside when
z → z² + c, from 0, stays within the circle of radius 2 for 300 steps.
The grid is `side` points wide (the first argument, 120 when there is
none) over the rectangle from −2 − 1.25i to 0.5 + 1.25i, 6.25 square
units, so the area is 6.25 times the share of points inside. The true
area is about 1.5066; a finer grid comes closer.

    ters run examples/area 200
    ters compile examples/area -o area.mjs && node area.mjs 2400

`main` counts the grid in eight bands with `together`, each band every
eighth row, so the bands take about as long. Each band only computes
(it may run long, but touches nothing), so the checker knows the bands
can run at once (pure-branches.ts, L62), and the compiled program runs
them on worker threads on Node (C41, compiler/src/branches-rt.ts). The
answer is the same as counting the bands in turn. Measured 2026-11-09 on
4 cores: side 2400 1953 ms in turn, 913 ms on three workers and the main
thread; side 1200 558 to 353 ms. A small grid stays on the main thread,
since starting workers would cost more than the bands (TERS_WORKERS=0
keeps every run there; TERS_BRANCHES=say says how many bands ran on
workers). Built native (`ters native examples/area -o area`) the bands
run on threads too (C201): side 2400 2.5 s one after another and 0.86 s
on four cores, measured 2026-11-10.
