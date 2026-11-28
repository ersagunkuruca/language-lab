# Lightmaps (design note for BACKLOG G17, 2026-11-28)

BACKLOG G17, from GAME-READINESS-2026-11-17: lightmaps and ambient
occlusion baked through G16 (BAKING.md). This note says what rain-page
gains, how the light is made, and how it reaches the glass.

## Why rain-page needs one

G16b3c3 measured that rain-page's `start pane` doesn't pay to bake. Its
20,000 drops are cheap to make from their seeds, so reading them back
costs what making them does. A bake pays when each item is costly, and a
lightmap is the usual case: each texel traces many rays to every light.

rain-page is a pane of glass in front of a dark greenhouse with three
lamps. The greenhouse behind is only a colour now. G17 gives it a back
wall: benches, pots and leaves as flat shapes (discs and boxes), lit by
the lamps with soft shadows, and darkened in the corners by ambient
occlusion. This is the one new example piece the G12 to G19 exception
allows, added to rain-page, not a new example.

## How the light is made

A pure definition, `back wall`, gives an `Image`. It is written in Ters
as ordinary code, with no bake in it (BAKING.md "What stays out").

- **Texels.** About 160 × 120, each a `Texel`: red, green and blue are
  the light of lamps one, two and three, unweighted by their flicker;
  alpha is the ambient occlusion. Keeping each lamp apart lets the glass
  flicker each lamp per tick with no new bake.
- **Soft shadows.** Each lamp is a disc. A texel takes 64 points on the
  disc, spread by Roberts' R2 sequence as the fireflies are, and tests
  each segment from the texel to the point against every shape. The
  share that gets through, times the falloff, is the lamp's light.
- **Ambient occlusion.** 32 directions around the texel, each tested
  against the shapes within a short reach. The share open is the alpha.

Each texel then makes about 3 × 64 + 32 = 224 rays, each tested against
some 20 shapes: about 4,500 tests a texel and 9 × 10^7 for the wall.
Compiled JavaScript should take around a second, which is far more than a
page should spend at start. The file is 160 × 120 × 4 Float32s, about
300 KB, which costs about 14 ms to carry (CARRY_MS_PER_KB) plus its
decode. So the weighing should keep the bake by a wide margin. If it
doesn't, the note is wrong and the measure says by how much.

The lamps' places stay fixed; only their brightness flickers. If their
places wobble each tick now, the wall is lit from where they rest, and
the glow on the glass stays as it is.

## How it reaches the glass

As FRAMES.md G11 says for an `Image` read from a file: a `copy(back wall,
into)` pass puts it in a texture, and the glass's fragment samples it
with `sampled`. The compiler sees nothing new. The runtime writes the
image to the GPU once, since it never changes. The glass colour is the
wall's texel, its red, green and blue each times its lamp's flicker this
tick and the lamp's colour, all times the alpha, added to what the glass
draws now.

An `Image` is a record of its width, its height and a list of Texel
records, so bake-file.ts `layoutOf` already lays it out: two Int32s,
then the list. G16e is not needed first.

## Who decides

The compiler, as for every bake: `back wall`'s answer is weighed by
bakedPage and written in the decisions as
`… way: back wall's answer: baked to a file; among at start, baked to a
file; target JavaScript page`. Nothing in the program says bake.

## Steps

- **G17a**: the back wall in rain-page, computed at start: its shapes,
  the soft shadows, the copy pass and the glass sampling it. Measured:
  the time to compute it, compiled, and the page's load event, as
  G16b3c3 measured.
- **G17b**: built with `ters build-web`, the wall is baked (the weighing
  should choose it). Measured against G17a: the load event and the
  bake's build time. A test holds the baked page's picture to the
  computed one's, pixel for pixel, as gpu-grid.test does for the grid.
- **G17c**: the ambient occlusion in alpha, if G17a leaves it out to
  keep the first piece small.
- **G17d**: the bake on the CPU threads (G16c, C where there is a C
  compiler), only if G17b's build time is long enough for threads to
  pay 10%.

## What stays out

- **Light bouncing between shapes.** One bounce of direct light and the
  occlusion only. Irradiance probes are G18.
- **Shadows from the drops or the fireflies.** They move, so they can't
  be baked; shadow maps are G15c.
- **A lightmap format.** The bake writes its own layout (BAKING.md), not
  KTX or PNG.
