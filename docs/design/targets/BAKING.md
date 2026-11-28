# Baking to a file (G16)

BACKLOG G16, from GAME-READINESS-2026-11-17. G17 (lightmaps, ambient
occlusion) and G18 (irradiance probes, distance fields) bake through it.

## What there is

bake.ts (C255) is constant folding. It runs a pure call whose inputs are
all written down, and writes the answer into the code as literals. It
gives up on an answer bigger than 4,096 nodes or a run longer than 250,000
steps, because an answer that big would make the program bigger and the
check slower than the work it saves.

A game's precomputed data is the other kind: megabytes, made once, and
loaded as they are. Lightmaps, probes and distance fields are examples,
and so is rain-page's `start pane`, 20,000 drops of five Float32s made at
start. None of it belongs in the code. It belongs in a file that the
program reads at start, laid out the way the target holds it, so loading
is a copy rather than a parse.

G11a already carries files with a page. A page holds the files its
program reads by name, with any non-text bytes kept as the page's store
keeps them. So a page can carry a baked answer without anything new.

## What is baked

A definition with no inputs, or a call of one with every input written
down, that can only give its value: no effect in its type, not even
Diverge (bake.ts's test). Its answer must be one of:

- an Array or List of numbers (Float32, Float64, Int), or of records of
  them, held as the target holds such a list (columns or rows, as the
  representation chooses);
- Bytes;
- a record of these.

Anything else, such as a function, a text, or a tree, stays computed at
start.

## Who decides

The compiler decides, and a person may hold the decision. This is the
same rule as every other way (SAVED-CHOICES, the decisions file):

```
<def> way: start pane's answer: baked to a file; among at start, baked to a file; target JavaScript page
```

The compiler bakes when the work is large next to the bytes. It counts
the work the way bake.ts does, but by running the definition compiled,
not in the evaluator. The threshold is set by measurement in G16d.

Held `at start`, the program computes the answer as written. Held `baked
to a file`, the answer is baked even when it is small.

## How it is made

The bake runs the definition compiled, not evaluated. A lightmap traced
in the evaluator would take hours. G17 traces on the CPU threads, so the
bake runs the definition as a small native program (C, its threads)
where there is a C compiler, and as compiled JavaScript in Node
otherwise. The program writes its answer's bytes in the target's layout.

Numbers: `+`, `-`, `*`, `/` and `sqrt` are bit-exact on every target, and
sin, cos, exp and pow are within a few ulp (PLATFORM MATH, 2026-11-03).
So a baked answer is one the target could have computed, though not
always to the last bit. The same holds today for a page that runs a map
on the GPU.

## Where it is kept

The bake store sits beside the run store (run-store.ts) in the kept
directory. Each bake is keyed by:

- the definition's nodes and those of every definition it reaches;
- the target's layout of its type;
- the bake's own version.

A rebuild with nothing changed reads the bytes back and runs nothing.
Editing any of those nodes makes a new key. Because the key says when a
bake is stale, the editor can show that later (an Editor lane row,
after G16).

Each target gets the bake its own way:

- **Page** (`ters build-web`, the editor's apps): a carried file, as in
  G11a. It is read at start into a Float32Array or Int32Array over the
  bytes, or into the page's columns.
- **Native** (`ters native`, the desktop apps): a file beside the
  executable, read at start into the array's buffer with one `fread`. A
  C array literal of megabytes compiles too slowly.
- **WebAssembly** (`ters wasi`): the same file, preopened, copied into
  linear memory.
- **Phones**: an asset in the app.

Each file starts with a header: the magic "TERSBAKE", the layout's
version, the key, and the length. A file whose header doesn't match
isn't read: the program computes the answer at start instead. A bake can
make a program slower to start, but never wrong.

## Steps

- **G16a**: measure first. Find how much of rain-page's start is `start
  pane`, as compiled JavaScript and as native code. Build the layout and
  the loader for one target, the page: an Array of records of Float32s
  as columns, written by hand in a test and read back equal.
- **G16b**: the bake step for pages. Compile the definition alone to
  JavaScript, run it in Node, write the bytes, keep them in the store,
  and carry them with the page. rain-page's `start pane` comes from the
  file.
- **G16c**: native and WebAssembly. Run the bake as C where there is a
  C compiler, with the file beside the executable or preopened.
- **G16d**: the decisions entry, and the weighing that sets when the
  compiler bakes.
- **G16e**: lists, records of arrays, and Bytes, beyond an Array of
  records.

G17 then bakes a lightmap of rain-page's glass from its lamps through
this.

## What stays out

- **A bake a person writes.** There is no `bake(…)` call and no
  annotation. Baking is a way the compiler chooses, written in the
  decisions file.
- **Asset formats.** A bake writes the target's own layout, not PNG or
  KTX. Reading images a person made is the Host and assets row.
- **Baking with effects.** A definition that reads a file or the clock
  isn't baked. When its inputs change, the program as written changes
  nothing, so the key couldn't say the bake is stale.
