# Game readiness (2026-11-17)

Ersagun asked (2026-11-17 18:53 UTC) how well Ters can carry a medium-sized
original game that tries to match or beat current engines and languages:
a lot of entities, ECS, rendering, shaders, compute shaders, culling,
lighting with several baked techniques, particles, physics, space
partitioning, and tools in the editor to edit scenes, entities,
components and game data. This report says what works today, what is
missing, how compiled code compares with hand-written code on the
workloads we can measure, and a staged plan (rows G1 to G24 in BACKLOG.md,
held until Ersagun decides). Nothing is built here.

## Short answer

The CPU side of a game is close to ready. The GPU side is not started in
any form a game needs, and the editor has no tools for game data.

- **Entity loops on the CPU are at hand-written C.** Columns (C60), arrays
  changed in place, a generational Pool (C58c) and maps on a thread pool
  (C201) were built for exactly this shape. Measured today: drift (a
  million motes moved a hundred times) natively is as fast as the same
  loop in C at `-O2`; herd on four cores is within 1.1x of hand-written C
  with threads. What C still has over us there is SIMD and Float32 (about
  1.7x on drift), not layout.
- **Whole programs are 2x to 4x the ideal, with cliffs.** The bigger-program
  rounds settle at 2.4x to 3x the hand-written program (round 19, scan),
  but a representation chosen wrong is 10x to 150x until a row fixes it
  (round 12 break 14.6x, round 17 depot 156x at 640 stations, both fixed
  since). A game is exactly the program size where a cliff shows up in a
  frame budget, so each stage below runs as a bigger-program round.
- **The GPU only draws a function of the pixel.** A picture today is
  `colour(x, y, time)`, a full-screen fragment shader printed to WGSL
  (wgsl.ts). Records of two to four Float64s become `vec2f` to `vec4f`,
  linear maps become matrices, tail recursion becomes a loop, so a ray
  marcher runs. But the program can't hand the GPU any data except values
  worked out from the time: no buffers, no meshes, no vertex stage, no
  instancing, no textures, no depth, no second pass. Compute kernels exist
  only for a page's `map`, `keep` and folds of Int to Int or Bool (i32,
  gpu-maps.ts), read back to the CPU after each use. A game needs the
  opposite: Float32 data that stays on the GPU between frames.
- **A frame loop exists, a game host doesn't.** A page's `on("frame")` gets
  the seconds since the last frame (bounce, break-page, pond-page), keys
  and the pointer come as events, and pictures are SVG. That is enough for
  a small 2D game, not for ten thousand entities a frame, and there is no
  window outside the browser (the native apps are view shells, NATIVE-APPS.md).
- **Baking is constant folding, not asset baking.** bake.ts (C255) runs
  pure calls while compiling and writes the answer into the code, capped at
  4,096 nodes and 250,000 steps. Lightmaps, probes and distance fields are
  megabytes made once and loaded: they need a bake step that writes data
  files and a way to load them, which nothing does today.
- **The editor edits code, not game data.** It has the node graph, number
  scrubbing (#2807) and editable run inputs (E273-E277). There is no scene
  view, no entity list, no inspector, and no way to keep a running game's
  state across an edit. Compiling takes 5 to 6 s for a small native program
  today; the compiler redesign (L266, aiming at 0.5 s) is the first thing
  fast prototyping needs.

So: a game is a good next challenge, and Ters has a real chance to match C
on the simulation side. On rendering it starts from nothing a game uses,
and that part is most of the work.

## Measured today

This container, 4 cores, no GPU. `ters native` as built on main
(3662bcc), hand-written C with gcc. Each time includes making the data
(drift's sines and cosines), two runs each, the range shown.

| workload | Ters | hand-written | ratio |
|---|---|---|---|
| drift, 1,000,000 motes x 100 steps, one core | native 0.22-0.29 s | C `-O2`, columns 0.22 s | 1.0-1.3x |
| | | C `-O3 -march=native` (SIMD) 0.13-0.14 s | 1.7-2.1x |
| | | same, Float32 columns 0.11-0.13 s | about 2x |
| herd, 200 ticks, ~2,000 animals, 4 cores | native 0.34-0.37 s | C with threads (herd.ideal.c `-DTHREADS`) 0.32-0.33 s | 1.05-1.1x |
| scan (round 19, 146 defs), whole program | native 2.4x, JS 2.9x | the ideal | |
| `ters native` of drift / herd (compile + cc) | 6.3 s / 5.0 s | | |

Not measurable yet: anything on the GPU (no GPU here, and no Ters program
draws with data), a frame budget (no game-sized page), memory per frame.

## What a game needs, area by area

**Entities and ECS.** Have: records stored as columns, Pool with
generational keys, Map with hash keys on C and WebAssembly (C243), maps on
threads. Missing: a way to say "an entity has some of these components" that
the compiler stores as archetype tables. The Ters way, following NO
EXPLICIT SELECTION, is not an ECS library: write a `Pool Thing` of records
whose components are `Optional` fields (or a sum type), and let the
compiler choose archetype columns as a representation of it, the way it
chose columns for drift. Queries are `keep` and `map` with a match on the
fields; a system is a function whose effect row says what it reads and
writes, and the scheduler runs systems with disjoint rows at once. That is
a language result worth having on its own. Influences to credit: Unity
DOTS, Bevy's scheduler, flecs (Sander Mertens), EnTT (Michele Caini).

**Rendering.** Have: WGSL from pure functions, vectors and matrices, the
Float32 profile, a WebGPU picture drawn from a program in the editor's Run
panel and on shaders.html. Missing: a value that describes a frame (a draw
list: meshes, instances, materials, cameras, passes), data from the
program's columns into GPU buffers, a vertex function, instanced draws,
depth, render targets and textures, post effects as passes. The design
question is the same as for pages (WEB.md): a frame is a value, the GPU is a
world, and what changes between frames is uploaded, not rebuilt.

**Compute shaders and particles.** Have: Int kernels for a page's maps.
Missing: Float32 kernels over columns, buffers that stay on the GPU between
frames (a particle system read back every frame loses to a hand-written one
by orders of magnitude), and the compiler choosing GPU-resident for data
only the GPU touches. This is C61 ("where code runs, chosen by cost")
carried to data.

**Culling.** Missing all of it: frustum culling on the CPU first, then on
the GPU (a compute pass writing indirect draw arguments), then occlusion
(a hierarchical depth buffer). Needs indirect draws, so it follows
rendering and compute.

**Lighting.** Missing: lights at all. A plan in order: forward with a few
lights, then clustered lights (many dynamic lights), shadows (shadow maps),
then baked: lightmaps traced on the CPU threads, irradiance probes
(spherical harmonics), baked ambient occlusion, signed distance fields of
the static scene. Several of these are the "baked precomputed" techniques
Ersagun named; each one is a bake step writing a data file plus the
shader that reads it.

**Physics and space partitioning.** Have: conservative advancement and
PGA motors (impact, L120), event-driven collisions (break), relations for
first touch. Missing: rigid bodies at scale (a broad phase: uniform grid,
then sweep and prune or a BVH; a narrow phase; a sequential-impulse
solver), and the structures themselves in std or as examples (grid hash,
BVH, octree). These are written in Ters, so they are mostly a test of the
compiler on arrays of ints and floats, the CPU side that already does well.

**Baking.** Have: compile-time evaluation into the code (C255). Missing: a
bake that runs a definition at build time and writes a binary data file
(Float32 arrays, textures), loading it at start, and the editor showing
when a bake is stale. Binary files are also missing in general (Files is
text; a page keeps files in localStorage).

**Host and assets.** Missing: a canvas-backed game page (continuous input
state: keys held, pointer, gamepad; fixed-step update with interpolation),
image and mesh loading, and later a desktop window (WebGPU native through
Dawn or wgpu, or SDL) for `ters native`.

**Tools.** Missing: a scene view in the editor (the game's frame drawn
beside the graph, pick an entity by clicking it), an entity list and an
inspector that edits a component's fields with the editor's own number
scrubbing, game data as tables (the RUN-INPUTS files, made editable as
data), keeping the game's state across an edit (hot reload: the state is a
cell, the code under it changes), and a time scrubber (the world log,
WORLD-LOG-WINDOW.md, already records runs). These go in editor/, one thread
at a time.

## Where Ters could beat current engines

Worth aiming at, not promised:

- **The same function on CPU and GPU.** A Ters function already prints as
  C, WebAssembly, JS and WGSL. Physics written once and run where its data
  is, chosen by cost, is something engines do by hand twice.
- **Systems scheduled by their effects.** Bevy works out a system's reads
  and writes from its parameters; Ters has them in the type.
- **Bakes as ordinary pure functions.** A lightmap is a pure function of
  the scene; the compiler already knows what is pure and what it depends
  on, so it knows when a bake is stale.
- **Layout chosen by the compiler.** Archetypes, columns, GPU residency as
  representations, not code the game writes.

## The game

Original, chosen for what it tests. A working idea: **a greenhouse at
night**. The player tends plants under a glass roof while swarms of moths
(ten thousand or more, boids on a grid hash) are drawn to lamps the player
carries and hangs; rain runs down the glass (GPU particles); pots and
crates can be knocked over (rigid bodies); the greenhouse itself is static
and lit by baked lightmaps and probes, with the lamps as dynamic lights.
Every item on Ersagun's list has a place in it. He may well prefer another
idea; the plan below doesn't depend on it.

## Staged plan

Each stage ends with a playable slice and a bigger-program round on it
(measured against hand-written JS, C and WGSL, gaps into GAPS.md). Rows
G1 to G24 are in BACKLOG.md under "G: Game", all held until Ersagun says go.
Which lane takes each row is a suggestion; the L lane is mid-redesign.

1. **CPU game on a page** (G1-G6): the ECS question as a design note, a
   canvas game host with input state, spatial hash and boids, a slice with
   ten thousand moths drawn in 2D, and the round on it.
2. **Drawing with data** (G7-G11): a frame as a value, buffers from
   columns, vertex functions and instancing, depth and passes, textures.
3. **Data that stays on the GPU** (G12-G14): Float32 compute kernels over
   columns, GPU-resident buffers, GPU particles, then culling.
4. **Light** (G15-G18): dynamic lights and shadows, then the bakes
   (lightmaps, probes, AO, distance fields) through a bake-to-file step.
5. **Physics** (G19-G20): broad phase, solver, rigid bodies.
6. **Tools** (G21-G24): scene view, inspector, data tables, hot reload.

The first stage needs no new target and mostly tests what exists, so it is
the cheap way to find out if the CPU numbers above hold in a real game.
Stages 2 and 3 are the big ones: each is a design note first.

## Credits to carry

Influences and prior art to name when each stage is built: Unity DOTS and
Bevy (ECS and scheduling), flecs (Sander Mertens) and EnTT (Michele Caini)
for archetype storage, Craig Reynolds's boids (1987), Erin Catto's
sequential impulses (Box2D), Ola Olsson's clustered shading, Peter-Pike
Sloan's spherical-harmonic irradiance, Brian Mirtich's conservative
advancement (already credited in impact). Each one's credit goes in the
code, the docs, the PR, CREDITS.md and on the game's page.
