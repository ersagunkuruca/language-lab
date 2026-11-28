# Probes and distance fields (design note for BACKLOG G18, 2026-11-28)

BACKLOG G18, from GAME-READINESS-2026-11-17: irradiance probes and
signed distance fields of the static scene, baked through G16
(BAKING.md). G17 (LIGHTMAPS.md) lights what stays still: rain-page's back
wall. G18 lights what moves through a still scene, and shadows what
moves.

## What rain-page would gain

- **The drops are lit by where they are.** A drop's bead is lit from the
  top left now, wherever it is. With probes, a drop near the right lamp
  shines from the right and is brighter, and a drop in a leaf's shadow is
  dull. Twenty thousand drops move every tick, so this can't be a
  lightmap: each drop reads the light where it is, each frame.
- **The fireflies cast soft shadows.** A firefly is a light that moves.
  The leaves are still, so their distance field can be made once, and
  the glass marches it from a place toward each firefly within reach to
  shade the place softly behind a leaf.

## Irradiance probes (G18a, G18b)

A grid of probes over the glass, 32 × 24. Each holds the light arriving
at its place from every direction around it: the three lamps, each a
bulb seen past the leaves as in G17, and the back wall's light
(LIGHTMAPS.md) as a bounce. rain-page is flat, so a direction is an angle
in the plane, and the probe keeps circular harmonics, the plane's
spherical harmonics: the mean and the first two frequencies (cos θ,
sin θ, cos 2θ, sin 2θ), five numbers a colour, fifteen a probe.

A probe traces 128 directions to the lamps and the wall, each tested
against the leaves. That is 768 probes × 128 directions × 16 leaves,
about 1.6 × 10^6 tests. The wall's light at the end of each ray is read
from `back wall`, already baked. So a probe set alone is cheap, about
50 ms compiled. The weighing decides; it may well keep it computed.
That is a fine answer, and the note says so when measured.

A drop's colour reads the four probes round its place, mixed by
distance (bilinear), and evaluates them at the direction its bead faces
for its shine. The read is in the drop's fragment function on the GPU.
The probes go there as an `Image` (two texels a probe for its fifteen
numbers, padded) through a copy pass, as the wall does.

Steps:

- **G18a**: the probes as a value, computed; the drops' fragment reads
  them. Measured: a frame on SwiftShader against now, and the probes'
  compute time.
- **G18b**: the weighing on the probes. If they take under about 10% of
  the page's load, they stay computed and the step closes measured.

## Distance field (G18c, G18d)

The leaves' signed distance: at each place, how far the nearest leaf's
edge is, negative inside one. rain-page's leaves are 16 discs, so the
exact distance is a minimum of 16, cheap enough per step that a texture
may not pay. The field pays when the scene is complex. G18c therefore
measures first, as G14c did for culling: the glass marching toward each
firefly within reach with the exact minimum of 16, against reading a
baked 256 × 192 field. The field is baked only if reading it is at least
10% faster a frame. Otherwise G18d closes measured, with what scene would
make it pay.

The march is the soft shadow by sphere tracing a distance field: step
by the distance, keep the smallest ratio of distance to how far along,
and that ratio is the penumbra (after Íñigo Quílez).

- **G18c**: the fireflies' soft shadows behind the leaves, the exact
  minimum, measured on SwiftShader.
- **G18d**: the baked field against the exact one, built only if it
  pays.

## What stays out

- **Probes in 3D.** rain-page is flat. The probes' code is circular
  harmonics, and spherical ones wait for a scene with depth.
- **Probes that update.** The lamps' places are still, so the probes
  are too. Each probe keeps each lamp's light apart, as the wall does,
  so a lamp's flicker still reads right.
- **A drop's shadow on another drop.** Shadow maps are G15c.

## Credits

Each is credited in the code, rain-page's README, CREDITS.md and the
page's credits line, where it is used.

- Irradiance volumes: Gene Greger, Peter Shirley, Philip M. Hubbard and
  Donald P. Greenberg, "The irradiance volume", IEEE Computer Graphics
  and Applications, 1998.
- Light kept in spherical harmonics: Peter-Pike Sloan, Jan Kautz and John
  Snyder, "Precomputed radiance transfer for real-time rendering in
  dynamic, low-frequency lighting environments", SIGGRAPH 2002; Ravi
  Ramamoorthi and Pat Hanrahan, "An efficient representation for
  irradiance environment maps", SIGGRAPH 2001. Circular harmonics are
  the Fourier series of the circle.
- Soft shadows by marching a distance field: Íñigo Quílez, "Soft
  shadows in raymarched SDFs" (2010); sphere tracing after John C. Hart,
  "Sphere tracing", The Visual Computer, 1996.
- Distance fields kept as samples: Sarah F. Frisken, Ronald N. Perry,
  Alyn P. Rockwood and Thouis R. Jones, "Adaptively sampled distance
  fields", SIGGRAPH 2000.
