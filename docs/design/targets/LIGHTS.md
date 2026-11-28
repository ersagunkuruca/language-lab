# Lights (design note for BACKLOG G15, 2026-11-27)

Stage 4 of the game plan ([GAME-READINESS-2026-11-17](../../reports/GAME-READINESS-2026-11-17.md)),
after culling ([CULLING.md](CULLING.md)). Today a draw's fragment
function reads its instance's carried values and values it captured that
are numbers or records of numbers (gpu-draws.ts: "reads a value that isn't
Float64s, Ints, Bools or records of them"). A light is a record, so a few
lights written one by one work already. A list of them doesn't. This note
says how a draw reads a list of lights, how it reads only the lights that
reach a place once there are many, and what all of this is measured on.

## What others do

- **Forward** (every engine's first): each fragment loops over every
  light. Its cost is pixels × lights, so it suits a few lights.
- **Deferred**: positions and normals written to buffers first, then
  each light shades only the pixels it covers. It doesn't suit
  transparency, and rain is all transparency.
- **Tiled and clustered** (Olsson and Assarsson's tiled shading, 2011;
  Olsson, Billeter and Assarsson's clustered shading, 2012): a pass sorts
  the lights into screen tiles (and, when clustered, depth slices), each
  tile keeping a list of the lights whose bounds touch it. A fragment
  loops over its tile's list alone. Forward+ (Harada, McKee and Yang,
  2012) is the tiled kind kept forward, so transparency still works.
- **Shadow maps** (Williams, 1978): the scene's depth drawn from the
  light, and a fragment is in shadow when something is nearer the light
  than it is.

## A list a draw reads (G15a)

A shader has no lists today. It has arrays, each of a size known where it
is made (C66c, wgsl.ts), and a function taking one is copied for each size
it is given (C66d). A captured list has no size until the page runs.

A fragment function may read a list it captured: `lamps`, a list of
`Lamp` records (a place, a colour, a reach). It reaches the shader as a
storage buffer of the records' leaves, an array whose size the shader
reads from the buffer (WGSL's runtime-sized `array<T>`), so one pipeline
serves any number of lamps. A fold over it (add,
largest, smallest, or a map and then one of those) lowers to a WGSL loop
over that buffer, in the list's order. A sum adds in order, as it does
on the CPU, so the shader's sum is the evaluator's whenever its products
are exact (sum-order-decisions: sums in order unless a decisions entry
says otherwise). The list is sent once a frame, a few words a lamp.

The example is rain-page. Its one lamp, written into the glass's colour
today, becomes `lamps`, a list of three. The glass glows round each lamp,
and each drop's shine faces the lamps that light it, falling off with
distance. That is a change to the example, not a new one (allowed for G12
to G19, new-example-g12-g19).

## Only the lights that reach (G15b)

Many lights is a different picture. In G15b fireflies drift behind the
glass, a thousand of them, each a light that moves every tick (a map over
the fireflies, which the GPU can run as G12's kernels do). Forward, every
pixel loops over a thousand lights. Most of them are too far away to
matter.

A program says which lights reach a place with a library function, as it
says which items are near with `neighbours` (L280g):

`within reach(items, place of, reach of, here) : List a`: the items whose
place is within their reach of here, in the list's order. (`within` is
already the timer's: an action's value if it finishes within some
milliseconds.)

As written, it walks every item, keeping those that reach. The compiler may find the
same lights another way, which gives the same list: a grid over the
places' space, each cell holding the indices of the lights whose reach
touches it, in order, built each frame by a compute pass; a fragment
reads its own cell's indices. This is clustered shading, with the cells
in whatever space the places are in (rain-page's are the glass's, from 0
to 1) rather than in screen tiles. Nothing ties the grid to the screen,
so the compiler needs no camera to build it. The lights come in the same
order, so the sum over them is the same, pixel for pixel.

Which way is the compiler's choice, written in the program's decisions as
a `way` entry, as neighbours' are: `every item; among every item, grid of
cells` with the cell size, which a person may hold. A grid is chosen from
some number of items (measured in G15b, as `CULL_FROM` was).

## Shadows (G15c)

A shadow map needs depth and something between the light and what it
lights. rain-page is flat: a pane of glass in front of a dark picture. So
G15c waits for a page with depth, as occlusion culling (G14d) does.
Shadows are then a pass drawing depth from the light (FRAMES.md passes and
targets, G10 and G11) and a fragment sampling it.

## Example and measure

On SwiftShader here, the time a frame takes on rain-page:

- G15a: one lamp written into the glass's colour, against three lamps
  read from a list. The list should cost little, a loop of three.
- G15b: a thousand fireflies forward, against the grid. The grid is
  built only if it pays at least 10% (WORKFLOW's bar). The picture is the
  same either way, pixel for pixel (a test, as gpu-cull.test does for
  culling).

Ersagun measures on a real GPU later, as with G13d.

## Steps

- **G15a1** (done): a draw captures an `Array` of records whose size the
  page gives: a storage buffer at binding 16 + r, its length then each
  item's leaves, read by `item at` and `array length` in WGSL (wgsl.ts
  `given`: such an array is passed on and read, never copied as a value;
  gpu-frame.ts sends it again only when its items change). One module
  serves any length (gpu-lists.test).
- **G15a2** (done): a captured List goes as such an array (a shader
  holds a List as an Array; scalar.ts), and a fold over it lowers to a
  loop over its indices, the last first, as a fold runs; a fold whose
  cons arm reads the rest of the list is refused. A program that draws
  on the GPU keeps its lists off the tree (library-reps.ts), whose walk a
  shader can't take. rain-page's three lamps are a list made each tick,
  the glass summing their glow. On SwiftShader a frame took 443 ms at 1x
  and 42 ms at 4x, against 439 and 40 with the one lamp written in: the
  loop of three costs little, as expected. Each drop's shine facing the
  lamps waits for G15b, where the fireflies light the drops.
- **G15b1**: `within reach` in std (done: written as its own walk, not a
  `keep`, so the functions it is given carry no Choice; reference.ts,
  LIBRARY.md, within-reach.test). A fold over it is one fold over the
  list, each item tested by `reaches` where it is (done: fuse-steps.ts),
  so a shader loops over the lights it captured and makes no list of
  those that reach. rain-page's fireflies, lit forward, measured (done):
  a thousand, made each tick by a map over `range`, spread over the glass
  by Roberts' R2 sequence, each a spot and a reach of 0.006 to 0.012 of
  it. On SwiftShader a frame took 1,254 ms at 1x and 881 ms at 4x,
  against 417 and 40 without them:
  every pixel testing every firefly is most of the frame, which is what
  the grid is for.
- **G15b2**: the grid. Built (done): a shader's fold over the items
  that reach here, where here is one Float64 or a record of two, reads
  only the indices filed in here's cell (scalar.ts `reachGrid`, wgsl.ts
  `grids`). gpu-draws.ts writes the cell functions and two compute
  passes; gpu-frame.ts runs them before the draw, only when the list's
  items changed. One thread finds where the items' reach spans. Then one
  thread per cell files the items whose reach, widened by 0.01% and
  1e-7, overlaps that cell, in order, up to 32. A cell with more, a list
  under 32 items, or a place that isn't finite reads every item, so the
  sum is the same, in the same order (gpu-grid.test: the same pixels).
  The grid has √n cells a side, at most 64, or n in a line. rain-page on
  SwiftShader: 442 ms a frame at 1x and 56 ms at 4x, against 1,254 and
  881 forward, and 417 and 40 with no fireflies.
  **G15b2b** (done): its `way` entry in the decisions, by the within
  reach call as written (the fused test and the fold's copy of the call
  are noted as copies of it):
  `… way: glass colour's items within reach: grid; among every item,
  grid; target JavaScript page`. Held to `every item`, the draw has no
  grid (gpu-draws.ts holdEveryItem), and `ters check` says so.
- **G15c**: shadow maps, waiting for a page with depth.

## What stays out

- **Deferred shading.** Rain is transparent and drawn in order. Forward,
  with only the lights that reach, keeps that.
- **A light type in std.** A light is the program's own record: what it
  carries and how it lights a place are the fragment function's to say.
  Only `within reach`, which says nothing about light, is in std.
- **Bounds a person writes.** A light's reach is one of its fields, read
  by `reach of`, as neighbours' reach is. It isn't a hint beside the code.
