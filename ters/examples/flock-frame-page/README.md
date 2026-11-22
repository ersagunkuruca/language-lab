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

Credits: as examples/flock-page (Reynolds's boids, Park and Miller's
generator, Fiedler's fixed step). The frame as a list of passes after
Frostbite's frame graph (Yuriy O'Donnell, GDC 2017).
