# Culling (design note for BACKLOG G14, 2026-11-27)

Stage 3 of the game plan ([GAME-READINESS-2026-11-17](../../reports/GAME-READINESS-2026-11-17.md)),
after G13. Today every instance of a draw is drawn (FRAMES.md, "No
culling"): `drawIndexed(triangles, instances)`. The GPU runs the vertex
function for every corner of every instance, and clipping throws away the
triangles outside the picture. When most instances are outside it, most of
that work, and on the CPU path most of the bytes sent, buys nothing. This
note says how a draw skips them without the program saying so, and what it
is measured on.

## What others do

- **Frustum culling on the CPU** (every engine): a bound per object (a
  sphere or box) tested against the view's planes before the draw is
  recorded. Cheap because the bound is given, not worked out.
- **On the GPU** (Unreal's GPU scene, the "GPU-driven rendering"
  pipelines of Assassin's Creed Unity and Frostbite, Wihlidal 2016): a
  compute pass tests every instance and appends the survivors to a list;
  the draw is `drawIndexedIndirect`, its instance count written by the
  pass. The CPU never learns the count.
- **Occlusion** (Greene, Kass and Miller's hierarchical Z, 1993): the
  last frame's depth, reduced to a mip chain of maxima, and each instance's
  bound tested against the level its size covers.

## What a draw may skip

A Ters draw names no bound. Its vertex function says where each corner of
each instance lands, as a clip position. A triangle all of whose corners
are outside one plane of the clip volume (x < −w, x > w, y < −w, y > w,
z < 0, z > w) gives no fragment. So an instance is skipped exactly when,
for one plane, every corner of the mesh run through the vertex function
is outside it. Nothing drawn changes: the same fragments come out, in the
same order (instances keep their order), so the picture is the same pixel
for pixel. A corner whose position is NaN (the vertex ran out of fuel)
counts as outside every plane, as it draws nothing today.

The test runs the vertex function, so it costs a vertex run for each
corner. For a quad that is 4 runs an instance, the same work the draw
would do. It pays only when skipping saves more than that: the drawing of
the instance's fragments, and on the CPU path the words sent.

## Where it runs

- **On the GPU (G14b)**: a compute pass, compiled from the same vertex
  function as the draw (gpu-draws.ts), runs every corner of each instance.
  It writes the kept instances' indices into a buffer in order (a prefix
  sum over the kept flags, so the order stays), and the instance count into
  `drawIndexedIndirect`'s arguments. The draw's vertex stage reads its
  instance through that index. This works on a list kept on the GPU
  (G13), where the CPU has no drops to test.
- **On the CPU (G14c)**: the same test in the page's JavaScript before
  packing, so skipped instances are never sent. It pays only where packing
  costs more than four vertex runs, which is rare for small records. It is
  built only if G14a's measurement says it pays.
- **Occlusion (G14d)**: hierarchical Z from the last frame's depth, for a
  pass with depth on. rain-page has none; this waits for a page with depth
  and things hidden behind other things.

Which of none, GPU or CPU a draw uses is the compiler's choice, written in
the program's decisions as a draw entry, the way placements are (SAVED
CHOICES, `<program>.decisions`): `draw 12 cull: GPU; among none, GPU`. A
person may hold it.

## Example and measure

rain-page shows the whole glass, so every drop is on screen and culling
buys nothing. G14a gives it a closer look: a Closer button zooms on the
glass's middle, 2× then 4×, so at 4× most drops are outside the picture.
That is one change to the example (allowed for G12 to G19,
new-example-g12-g19), not a new one. Measured on SwiftShader here (GPU time
per frame and bytes sent), and on a real GPU by Ersagun (as G13d).

Measured before culling (G14a, 11-27, headless Chromium on SwiftShader,
the drops kept on the GPU so no frame sends any; median of 30 frames, the
frame and its GPU work): 480 ms a frame at 1×, 250 ms at 4×. SwiftShader
runs on the CPU, so these say where the work is, not a real GPU's times:
at 4× clipping already drops most triangles before their fragments, and
what is left is every corner's vertex run, the work G14b skips.

## Steps

- **G14a** (done): rain-page's closer look, a Closer button (Ters pages
  have no wheel or pinch events yet). Measured above.
- **G14b1** (done): GPU culling: the cull pass from the vertex function
  (gpu-draws.ts, `lab_cull_main` in the draw's own module), the kept
  indices in order (one workgroup's scan, gpu-frame.ts `KEPT_IN_ORDER`),
  `drawIndexedIndirect`; on ordinary and kept lists, for a draw of 256
  instances or more. At 4× rain-page draws about a sixteenth of its drops:
  250 ms a frame before, 37 ms after (SwiftShader); at 1×, 480 and 405
  ms. The picture is the one without culling, pixel for pixel
  (gpu-cull.test).
- **G14b2**: the decisions entry, so a person may hold a draw unculled.
- **G14c**: CPU culling, if G14a's numbers say it pays.
- **G14d**: occlusion, waiting for a page with depth.

## What stays out

- **Bounds a person writes.** The vertex function is the bound. A
  program that wants a cheaper test can draw fewer instances itself
  (a `keep` before the draw).
- **Level of detail.** That is a different mesh per distance, which a
  program says with its own draws.
