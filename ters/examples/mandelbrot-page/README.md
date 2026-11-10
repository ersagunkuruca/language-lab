# mandelbrot-page

The Mandelbrot set drawn in characters as a page, the same picture as
[mandelbrot-rows](../mandelbrot-rows), 240 columns and 96 rows. Each press
of Draw draws it again with 1000 more steps a point, so its edge gets
finer.

    ters build-web examples/mandelbrot-page -o mandelbrot.html

The picture is one `map` over the rows, inside the button's handler. Each
line only computes, so the compiled page sends the rows out to workers
(C61, compiler/src/branches-rt.ts `mapAway`).

- **No shared memory.** GitHub Pages can't set the headers a page needs
  for shared memory, so the page can't wait inside a call as Node does.
  Instead the handler goes on by the rest of its code.
- **The workers.** They are started from the page's own script, the
  first time a map takes over 20 ms. After that, each draw sends most of
  the rows to them by postMessage, and the main thread draws its share.
- **The wait.** The handler waits until every row is back. Meanwhile
  the page shows nothing new. A click or a frame that comes in waits its
  turn, and frames are joined into one with their seconds added up. So
  nothing tells it apart from drawing the rows in turn, except the time.

Measured 2026-11-10 in Chromium in the container, 4 cores:

| Draw | Main thread alone | Main thread and three workers |
|---|---|---|
| 8th (8000 steps a point) | 165 to 187 ms | 54 to 63 ms |
| 16th (16000 steps a point) | 341 to 350 ms | 90 to 110 ms |

The first draw runs on the main thread, since there are no workers yet.
The next few are slower while the workers' code warms up. A small picture
stays on the main thread. A browser without workers draws in turn, as the
editor's preview does.
