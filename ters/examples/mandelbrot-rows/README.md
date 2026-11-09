# mandelbrot-rows

The Mandelbrot set drawn in characters: `#` for the points that stay
within the circle of radius 2 for `limit` steps of z → z² + c, and
lighter marks the sooner a point leaves.

    ters run examples/mandelbrot-rows 60 50
    ters compile examples/mandelbrot-rows -o mandelbrot-rows.mjs && node mandelbrot-rows.mjs 1200 5000

The first argument is the width in columns (72 when there is none), the
second the steps a point gets (200). `main` makes each row's line with
one `map` over the rows' numbers. The line only computes, so the checker
knows the rows can be drawn at once (pure-branches.ts `parallelMaps`),
and the compiled program shares them out to worker threads on Node (C42,
compiler/src/branches-rt.ts). The picture is the same as drawing the rows
in turn. Measured 2026-11-09 on 4 cores: width 1200 with 5000 steps,
2628 ms in turn and 906 ms on three workers and the main thread. A small
picture stays on the main thread (TERS_WORKERS=0 keeps every run there;
TERS_BRANCHES=say says how many runs of rows went to workers).
