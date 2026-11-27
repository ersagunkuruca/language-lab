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

As built in G13b, a tick always read back each item's steps (n floats,
80 KB for rain-page's drops against 480 KB of answers and steps); since
G13c3 a kept tick reads back 12 bytes, the steps summed on the GPU. Where
one was given back, the answers come back too and the tick's list is an
ordinary one, sent up again by the next kernel or draw that takes it. The
4-byte count, for a map that surely ends, is left for G13c.

## Steps

- **G13a** (done, gpu-resident.ts): find the lists that can stay, per
  record field (a pass beside pool-shapes.ts).
- **G13b** (done, gpu-device.ts, gpu-resident.ts `keptOnGpu`,
  branches-rt.ts, gpu-frame.ts): one device for a page's kernels and
  frames; `GpuItems` from a resident map's kernel, taken by the next
  tick's kernel and bound by the draw as its instances. The draw is
  told the layout of every leaf of an instance, in the kernel's order, so
  the kernel's buffer is its instances as it is (a draw whose instance isn't
  the kernel's answer leaf for leaf keeps the list on the CPU). Lists stay
  only while the frames draw with WebGPU. The program's decisions say so
  as a placement entry (`Pane's drops: GPU between ticks; among CPU, GPU
  between ticks`), and a person can hold one on the CPU.
- **G13c** (done): what a kept list costs where it isn't
  kept. G13c1: the kernel's steps aren't filled before a run; every item's
  run writes its own. G13c2: the draw reads the leaves it needs by their
  place (pipeline constants, gpu-draws.ts `kept`), so an ordinary list of
  drops sends the 3 words the vertex reads and a kept one is bound as its
  5. G13c3: a kept tick's steps are summed on the GPU (how many were
  given back, and the others' steps as a 64-bit sum, branches-rt.ts
  `SUMMED`): 12 bytes come back, not 4 an item; the steps and answers
  only where an item was given back.
- **G13d**: rain-page measured: CPU time a tick and bytes moved, against a
  hand-written WebGPU rain.

## What stays out

- **Async reads in views.** A view that reads a list holds it on the CPU.
  Waiting inside a view isn't something views do.
- **Pools and columns on the GPU.** A Pool's tables or a column split stay
  on the CPU for now. G12's "columns sent as they are" comes first.
