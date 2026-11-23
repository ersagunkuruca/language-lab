# flock-frame-page: Flock, drawn with data

The flock of examples/flock-page, drawn with `render` instead of `paint`
(BACKLOG G9d, docs/design/targets/FRAMES.md). The birds, their flight and
the camera are the same definitions. Only the picture is different: the
canvas gets a `Frame`, not a list of marks.

The frame is one pass with a depth buffer and four draws:

- the floor, one quad;
- the floor's grid and the edges round the top of the box, a thin quad for
  each line, made as wide on the screen as it is long;
- every bird's shadow, the bird's dart flattened onto the floor;
- every bird, a dart (a chevron of two triangles) turned along its flight,
  paler the nearer it is.

Each draw is a mesh, a list of instances and two functions: the vertex
function places a corner of the mesh for one instance, and the fragment
function colours what it carried. The draws capture only the camera (its
turn and tilt), so the GPU gets the birds and one small uniform a frame.
Where a draw has no printed site, or there's no WebGPU, raster.ts draws the
same frame on the CPU.

## Measured (G9d, 2026-11-22)

Both pages built with `ters build-web` and run in headless Chromium, with
WebGPU on SwiftShader (no GPU in the container). The figures are main-thread
milliseconds a frame from a CPU profile over 6 s. "Build" is the view
making the marks or the frame. "Draw" is painting the marks on the 2D
context, or writing the instances' words and encoding the draws
(gpu-frame.ts).

| birds | page | build | draw | frames a second |
|---|---|---|---|---|
| 2,000 | paint (flock-page) | 1.4 | 1.2, plus the canvas's own raster | 10 |
| 2,000 | render (this page) | 0.9 | 3.1, of which writing words 2.1 | 13 |
| 20,000 | paint | 12.4 | 12.7, plus the canvas's raster | 1 |
| 20,000 | render | 2.3 | 6.6, of which writing words 5.3 | 4.7 |

The frames a second are SwiftShader's and the flock's ticks, not the
drawing's. At 2,000 birds the frame's draw costs more than the marks' did,
almost all of it in reading each bird's leaves into words. That is G8's
part: columns the compiled code keeps, sent as they are. At 20,000 the
frame is already 2.7 times cheaper on the main thread, and the GPU does the
filling the 2D canvas did.

Credits: as examples/flock-page (Reynolds's boids, Park and Miller's
generator, Fiedler's fixed step). The frame as a list of passes after
Frostbite's frame graph (Yuriy O'Donnell, GDC 2017).
