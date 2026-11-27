# Data that stays on the GPU (design note for BACKLOG G13, 2026-11-27)

Stage 3 of the game plan ([GAME-READINESS-2026-11-17](../../reports/GAME-READINESS-2026-11-17.md)),
after G12. Its example is examples/rain-page: 20,000 Float32 drops slid by
one map a tick and drawn as 20,000 instances. Since G12b the slide can be
a WebGPU kernel (gpu-maps.ts). Each tick still sends the drops up (five
words a drop, 400 KB), runs the kernel, reads the drops back (400 KB), and
the frame then sends them up again as the draw's instances. The CPU only
carries the drops from one GPU job to the next. This note says how they stay
on the GPU instead, and how answers stay the evaluator's.

## What others do

- **Arrays on the device** (JAX, CuPy, PyTorch's `cuda` tensors): an array
  made by a kernel stays in GPU memory. A host read copies it back, and
  blocks or is awaited (`jax.device_get`, `.item()`).
- **GPU particles** (Unity's VFX Graph, the WebGPU compute-particles
  samples): the particles live in a storage buffer. A compute pass updates
  it, and the draw reads the same buffer by instance index. The CPU never
  sees a particle.

A Ters program names no buffer (NO EXPLICIT SELECTION). So the compiler
finds where a list can live on the GPU, and the runtime keeps it there.

## Which lists stay

A list stays on the GPU when everything that reads it can read a buffer:

- the item list of a map or keep that has a kernel (gpu-maps.ts), as a
  G12 page's handler sends away;
- a draw's instance list (gpu-draws.ts);
- the field of a record it is put in and taken out of again (rain-page's
  `Pane.drops`), when every other read of that field is one of the above.

A list anything else reads (a fold on the CPU, a view's `sum`, an equality,
a show) is held on the CPU, as today. This is BACKLOG G13's "a column only
kernels and draws touch". It's decided per field of a record type, by
walking every read of the field in what main reaches, the way
pool-shapes.ts finds the jobs a pool's items are given. A list built on the
CPU (`start pane`'s scattered drops) is sent up once, when a kernel or a
draw first takes it.

## The value: a list held on the GPU

At run time such a list is a `GpuItems`: the buffer of its items' words
(the kernel's output, a leaf a word, as G12b lays them out), the count, and
the item's class, which the answers are made of if it is ever read. A
kernel given a `GpuItems` binds its buffer as its items and writes a new
one. A draw given one binds it as its instances. Nothing is copied. The old
buffer is freed when the field is written again and no other value holds
it.

A read on the CPU that the compiler didn't foresee can't happen, because a
list with such a read stays on the CPU. Tests and the editor's value
viewers do read one: they await `items()`, which maps the buffer back.

## Answers stay the evaluator's

A kernel gives an item back when it can't work it out as the CPU would: an
Int past 32 bits, an Int made a number past 2²⁴, a step budget run out
(wgsl.ts's `lab_fuel = -1`). Today the CPU then works that item out from
the item it still has. With the items on the GPU it has none. So:

1. The kernel also counts the items it gave back, in a 4-byte buffer.
2. The tick waits for that count, 4 bytes, not 400 KB (the handler's
   Pending, as G12b's map waits for its answers).
3. If the count is 0, the new buffer is the field's. If it isn't, the
   runtime maps the old buffer back, works the given-back items out on the
   CPU, and sends the fixed items up. That costs a readback, and only on a
   tick that has one.
4. The steps: a function that surely ends takes none outside a budget
   (C179), so a total map spends nothing. A map that may not end still
   reads back its steps (n floats), because the handler's budget must
   come out as the evaluator's.

So every answer is the evaluator's, bit for bit (G12's exactness, and
G12c's `GPU close` where a person held it so).

## Steps

- **G13a** (done, gpu-resident.ts): find the lists that can stay, per
  record field (a pass beside pool-shapes.ts).
- **G13b**: `GpuItems` in branches-rt.ts. A map gives one and takes one,
  with the given-back count waited for and the fix-up on the CPU. The
  program's decisions say so as a placement entry (`Pane's drops: GPU
  between ticks; among CPU, GPU between ticks`), so a person can hold one
  on the CPU. The entry waits for this step so it never names a place the
  list isn't kept.
- **G13c**: a draw takes a `GpuItems` as its instances (gpu-frame.ts). The
  kernel's word layout is a draw's instance layout when the vertex reads
  every leaf. Otherwise the draw reads the leaves it needs by their place
  in the item.
- **G13d**: rain-page measured: CPU time a tick and bytes moved, against a
  hand-written WebGPU rain.

## What stays out

- **Async reads in views.** A view that reads a list holds it on the CPU.
  Waiting inside a view isn't something views do.
- **Pools and columns on the GPU.** A Pool's tables or a column split stay
  on the CPU for now. G12's "columns sent as they are" comes first.
