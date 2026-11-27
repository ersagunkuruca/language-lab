# Drawing with data: a frame is a value, the GPU is a world (design note for BACKLOG G7, 2026-11-22)

Stage 2 of the game plan ([GAME-READINESS-2026-11-17](../../reports/GAME-READINESS-2026-11-17.md)),
chosen by Ersagun on 2026-11-22. Today the GPU only draws a function of the
pixel: a picture is `colour(x, y, time)`, printed as a full-screen fragment
shader (wgsl.ts, editor/picture.ts). A game draws thousands of things from
its own data. The flock page (examples/flock-page) builds 4,000 canvas marks
from its 2,000 birds every frame, and the CPU draws them one by one.

This note says how a program describes what the GPU draws, and how the
runtime gets the program's data there. It follows WEB.md's model for pages:
a page is a value, its changing parts are re-run by the Cells handler, and
the browser is a world. Here a frame is a value, the GPU is a world, and
what changes between frames is uploaded, not rebuilt. Following NO EXPLICIT
SELECTION, the program never names a buffer, a binding or a layout.

## What engines and APIs do

- **Immediate-mode drawing** (canvas 2D, today's `paint`, Processing): each
  frame issues every shape again. Simple, and the CPU pays per shape.
- **Retained scene graphs** (three.js, Unity's GameObjects): objects that
  live between frames, changed in place. Uploading is hidden, but so is
  what costs what.
- **Render graphs and draw lists** (Frostbite's frame graph, Yuriy
  O'Donnell, GDC 2017; Bevy's render graph; WebGPU's own command
  encoders): a frame is a list of passes, each with targets and draws. A
  draw is a pipeline (vertex and fragment stages), its buffers and an
  instance count. This is what the GPU wants.
- **Data-oriented instancing** (Unity's `Graphics.RenderMeshInstanced`,
  entity rendering in DOTS): one draw per mesh, with the instances' fields
  in arrays the GPU reads by instance index.

A Ters frame is the draw-list shape. It's built as an ordinary value, and
the runtime keeps the GPU side alive between frames, much as html.ts keeps
DOM nodes.

## How a program writes it

A canvas gets a `render` attribute beside today's `paint`. Its view gives a
`Frame`:

```
type Frame = frame(passes: List Pass)
type Pass = pass(into: Target, clear: Text, depth: Bool, draws: List Draw)
type Target = screen | texture(name: Text, width: Int, height: Int)
type Placed p v = placed(position: p, carried: v)
type Mesh c = mesh(corners: List c, triangles: List Int)
type Draw                         -- no cases of its own

draw : (Mesh c, List i, (i, c) -> Placed p v, (v) -> k) -> Draw
```

`draw` is a std function, and its type hides `i` (an instance) and `v`
(what the vertex gives the fragment): a frame holds draws of different
instance types in one list, and nothing in a program takes a draw apart,
only the runtime does. So Draw needs no packing and no new checker rule.
(The first draft of this note made Draw a case with its own type
variables, which needed a rule for a variable with no `has`, G9a. A
function with that type does the same job and no rule is needed.)

A mesh's corner `c`, the placed position `p` and the colour `k` are
records of Float64s: the program's own Vec3, Vec4 and Colour, as the
vectors module works on any record of Float64s. A position is clip space
(x and y from −1 to 1 with y up, z from 0 to 1 near to far, w for
perspective; three Float64s mean w = 1), and a colour is red, green and
blue from 0 to 1, with alpha as a fourth. The clear colour is CSS text, as
a mark's fill is. Both functions are pure, as a shader is.

The flock drawn with data:

```
‹bird shape› = dart(4.0)          -- a Mesh: a thin wedge, made in Ters

‹bird corner›(view, b, c) =        -- vertex: a corner of one bird's dart
  turned = aligned(c.position, unit(b.velocity))
  at = plus(b.place, turned)
  placed(times(view, point(at)), depth of(view, at))

‹bird colour›(d) = shade(d)        -- fragment: the colour by distance

‹frame of›(s) =
  view = ‹camera of›(s)
  frame([pass(screen, night, true, [
    draw(‹floor mesh›, [s], ‹floor corner›(view), ‹floor colour›),
    draw(‹bird shape›, s.birds, ‹bird corner›(view), ‹bird colour›),
    draw(‹bird shape›, s.birds, ‹shadow corner›(view), ‹shadow colour›)])])

… paint(‹marks of›(read(now)))  becomes  render(‹frame of›(read(now)))
```

`view` is an ordinary `Mat4` (MATRICES.md), worked out once per frame on
the CPU. There's no camera type: a camera is whatever the vertex function
does with the corner. The vertex and fragment functions are ordinary Ters
functions. They are checked and evaluated like any others, and they have
to lower to the shader profile (wgsl.ts). One that doesn't, because it
recurses or reads a list, is refused with the scalar profile's reason,
shown at the draw as a compile error is.

Today's picture is a special case: one pass, one draw of a full-screen
quad with one instance, whose fragment is `colour`. shaders.html keeps
working, and can later be written this way.

## What the runtime does with it

The `render` view is a watcher, as `paint` is: it runs again when a cell it
read changes, and gives a new `Frame`. The runtime matches the new frame
with the last one by place (pass k, draw j), as `each` matches rows, and
keeps a GPU side for each draw:

- **A pipeline per pair of functions.** The vertex and fragment functions
  are printed to WGSL once per definition, and once per shape of what they
  capture, not once per frame. `‹bird corner›(view)` is the same pipeline
  every frame. Only `view` changes, and it goes to a uniform.
- **Captures go to uniforms.** What a draw's functions captured (`view`,
  the time, a colour) is written into one small uniform buffer per draw.
  It's the same list of captures gpu-maps.ts already makes for a kernel,
  and C175 already moves values that depend only on the time into a
  uniform.
- **Instances go to storage buffers, by column.** An instance list of
  records is stored as columns (C60, and G1b's columns with presence for a
  Pool). Each column the vertex function reads goes to one Float32
  storage buffer (c.ts `fieldsRead` finds which, so G8 reuses it), and the
  vertex stage reads item `instance_index` of each.
- **Only what changed is uploaded.** If the instance list is the same
  object as last frame's, nothing is sent. If its columns are held by the
  compiled code and some are the same arrays as before, only the others
  are sent. Otherwise the columns the vertex reads are sent once. The flock
  sends its places and velocities, 2 × 3 × 2,000 Float32s (48 KB), plus a
  64-byte uniform, and makes three draw calls, where today it builds 4,000
  mark records and makes 4,000 canvas calls.
- **Meshes are uploaded once.** A mesh is data and changes rarely, so it
  is kept by identity, like a kept row.

The Float32 rounding is the GPU's, so the evaluator runs the draw's
functions under the Float32 profile (float32.ts) when it draws a frame on
the CPU (below). Then the two give close answers for ÷, sqrt and sin, and
the same answers for + − × and comparisons, as pictures already do.

## What a compiled page hands the runtime

The compiler prints each `draw` it lowers (compiler/src/gpu-draws.ts)
as a site, and gpu-frame.ts draws the sites it is given:

- The page script calls `pageDraws({ [site]: Site }, { [site]: Packs })`
  before the page starts. A Site is `{ wgsl, caps, instance, corner,
  colour }`. Packs are `{ instance, corner }`, each `(items, f32s, i32s)`
  writing item i's leaves at i × leaves, as the generic `put` would but
  read straight from the compiled records (G8b). A site with no packs
  (written by hand) is put's.
- A compiled draw is `frame$draw(mesh, instances, vertex, fragment,
  site, …caps)`. Its fields 4 and 5 are the site and the list of values
  its two functions read where they were written (`view`, a colour), in
  the uniform's order. A draw with no site goes to raster.ts.
- Each value crosses as 4-byte words, one per leaf. A leaf is `{ path,
  kind }`: the field indices to follow, and `f32` (a Float64), `i32` (an
  Int) or `bool` (1 or 0). `caps` gives the leaves of each value read,
  and `instance` and `corner` give those of one instance and one corner.
  Only the leaves the vertex function reads cross (G8a), so an instance
  it never reads (a floor drawn once for the whole state) has none.
- The module's entries are `lab_vs` and `lab_fs`. In group 0, binding 0
  is `var<uniform> lab_caps: array<vec4u, N>`, the leaves of the values
  read, four to a vec4u. Binding 1 is `var<storage, read> lab_inst:
  array<u32>`, an instance's leaves after another's. Binding 2 is the
  same for the corners. The vertex stage reads every binding, so a
  layout made from the module has all three.
- A captured pass target (G10b) is a texture the draw samples: its
  leaves are `[]`, so it crosses as no words, and the site's `textures`
  gives its index among the caps, in binding order. Binding 3 is
  `lab_sampler`, linear and clamped to the edges; binding 4 + k is
  `lab_tex{k}`, a `texture_2d<f32>` of the texture the pass named by the
  k-th captured target drew (rgba8unorm). In the shader a target is its
  number k as an f32, so it may be passed to functions, and
  `sampled(t, across)` is `textureSampleLevel` of texture t at level 0. A
  target the fragment makes, rather than captures, has no binding, and
  its draw has no site.
- The draw is `drawIndexed(triangles, instances)`, with the triangles as
  the index buffer. The vertex stage takes its corner at `vertex_index`
  and its instance at `instance_index`.
- What the vertex function carries reaches the fragment stage one
  varying per leaf. A Float64 is put between the corners in perspective;
  anything else is the first corner's (`flat`), as in raster.ts.
- A fragment with no answer is `discard`. A corner with no answer is
  placed at NaN, which GPUs drop (raster.ts drops its triangles).
- The blend that matches raster.ts is colour src-alpha / one-minus-src-
  alpha and alpha one / one-minus-src-alpha; depth is depth24plus,
  compared with `less`, cleared to 1.

A vertex or fragment function the shader lowering doesn't take (it reads
a list, it recurses) leaves its draw without a site, and the reason is
kept beside the sites (`gpuDraws(ir).refused`).

## Where it runs

- **WebGPU** in the browser, which is the target.
- **A CPU rasterizer** where there is no WebGPU: the same frame drawn by a
  small triangle rasterizer with a depth buffer into an ImageData, the
  draw's functions compiled to JavaScript (js-scalar.ts), as pictures fall
  back to WebAssembly today. It's slow on purpose, and it's the reference
  the GPU path is checked against.
- **Headless WebGPU for tests.** This container has no GPU, but its
  Chromium runs WebGPU on SwiftShader (checked 2026-11-22: `--enable-unsafe-webgpu
  --use-webgpu-adapter=swiftshader` gives an adapter and a device on a
  `file://` page). So tests can draw a real frame through WebGPU, read the
  pixels back, and compare them with the CPU rasterizer's. Node tests use
  the rasterizer alone.
- **Native** (a window through wgpu or Dawn) is out of this stage. The
  WGSL is the same, so it's a host, not a language change.

## Depth, passes and post effects (G10)

`depth: true` gives the pass a depth buffer, cleared to the far plane, and
the draws test against it. A pass `into` a `texture(…)` draws off screen,
at the texture's own size. A later pass's fragment reads it with
`sampled(t, across) : Texel`, where `t` is the same `Target` value captured
by the function, and `across` is a record of two Float64s from 0 to 1, from
the top left. A `Texel` is std's red, green, blue and alpha. It reads
between the four nearest texels and keeps to the edges, as a GPU's linear
sampler with clamp-to-edge does. Capturing the target is what makes it a
binding. Passes run in the order written, and a fragment that reads a
texture no earlier pass of the frame drew is refused, with the texture's
name. (The first draft had the runtime reorder passes; written order is
simpler to read, and a frame that needs another order says so by its list.)
A post effect is a pass drawing one full-screen quad. Bloom is a pass into
"glow", a blur pass reading "glow", and a pass reading both.

## Textures and meshes as data (G11)

A texture from a file is an `Image`: its width, its height and its
`Texel`s, row by row from the top left. A frame's `copy(image, into)` pass
puts it into the texture `into` names, at the image's own size, and a
later pass's fragment samples that texture as it samples any pass's
target. So the compiler sees nothing new: a draw captures the target, as
it does for a pass's. The runtime writes the image to the GPU only when it
isn't the image that texture last held. Images and meshes from files are
read by library functions written in Ters, from text formats: a PPM image
(P3) and an OBJ subset (positions and faces, fanned into triangles). So
loading one is ordinary code, and baking one (stage 4) is that code run at
build time. A page carries the files its program reads by a name written
in it (G11a).

## What stays out

- **No material system.** A material is the fragment function and what it
  captures.
- **No scene graph.** Grouping is the program's own data: a frame is built
  from it by ordinary functions each frame, and the runtime's matching
  makes that cheap.
- **No GPU-resident data yet.** Instances are uploaded from the CPU each
  frame they change. Keeping them on the GPU and updating them with
  compute kernels is stage 3 (G12 to G14). This stage's upload-only-what-
  changed is what stage 3 builds on.
- **No culling.** Every instance is drawn. Culling follows compute (G14, [CULLING.md](CULLING.md)).

## Steps

Each is its own PR or a few, in this order. The slice at the end is the
flock page drawn with data, and the stage's round compares it with a
hand-written WebGPU flock (flock.ideal-gpu.js): CPU time a frame, bytes
uploaded, draw calls.

- **G9b** (done): std `Frame`, `Pass`, `Target`, `Placed`, `Mesh`,
  `Draw` and `draw`, and the `render` attribute, typed as `paint` is.
  raster.ts draws a frame on the CPU into the canvas's ImageData, with
  depth and with what the vertex carried put between the corners in
  perspective. frames.test checks small frames pixel by pixel against
  answers worked out by hand.
- **G9c** (done): the vertex and fragment stages printed to WGSL from a draw's
  functions (wgsl.ts, beside today's fragment-only picture), with captures
  as a uniform and instances as storage buffers of whole records (one
  record a slot, no columns yet). The runtime keeps a pipeline per draw.
  Checked on SwiftShader against the rasterizer.
- **G8**: instances by column, Float32 storage buffers of only the fields
  the vertex reads, uploaded only when they changed. A test counts the
  bytes sent per frame. Done as G8a (only the leaves read) and G8b (a
  packing loop printed per site); columns closed, measured: the drawing
  was under 1% of the flock page's main thread.
- **G9d** (done): the flock page drawn with `render`, 2,000 birds and then
  20,000, and its CPU time a frame against today's `paint`.
- **G10** (done): depth (already in G9b's rasterizer, in WebGPU here),
  texture targets, `sampled`, pass order, and the flock with a fog pass
  (flock-frame-page: the scene and its distance into two textures, then a
  full-screen pass reading both).
- **G11** (done): `Image` from a file, sampled; the OBJ-subset mesh reader in
  Ters; a mesh drawn from a file. Done as G11a (a page carries the files
  its program reads by a name written in it) and G11b (`obj mesh`, and the
  flock's bird read from bird.obj), G11c (`Image` and the copy pass) and
  G11d (the flock's floor from floor.ppm).
- **Round** (done): the stage's bigger-program round on the flock drawn
  with data, measured against flock.ideal-gpu.js (compiler/gaps/
  bench-frames.ts), with the gaps going into GAPS.md (game round 4).

The compiler-internal parts (G9c's WGSL vertex stage, G8's columns into
buffers) can go to the Compiler lane now that G9b has landed.

## Credits

Frostbite's frame graph (Yuriy O'Donnell, "FrameGraph: Extensible
Rendering Architecture in Frostbite", GDC 2017) for a frame as a list of
passes worked out each frame. Bevy's render graph and Unity's instanced
mesh rendering for draws over instance data. Solid.js (Ryan Carniato) for
re-running only what changed, through WEB.md. WebGPU and WGSL (W3C GPU for
the Web group). SwiftShader (Google) for WebGPU without a GPU.
