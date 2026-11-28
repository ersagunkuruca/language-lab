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
program reads at start, as words it decodes without parsing text.

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

The compiler bakes when the work is large next to the bytes. It times
the definition compiled, not in the evaluator, against its decoder reading
the file and the cost of carrying the file (G16b3c3).

Held `at start`, the program computes the answer as written. Held `baked
to a file`, the answer is baked even when it is small.

`ters decisions` writes the entry from the weighing, and `ters build-web`
and `ters build-app` weigh again unless it is held (G16d1). The weighing
is timed, so `ters check` doesn't weigh and never calls a bake entry
stale. The bake store keeps each file by its key and each weighing by
its key and the compiler that reads it back (G16d2), so a rebuild with
nothing changed runs no bake and times nothing: rain-page's build-web
goes from 4.1 s to 3.0 s.

## How it is made

The bake runs the definition compiled, not evaluated. A lightmap traced
in the evaluator would take hours. G17 traces on the CPU threads, so the
bake runs the definition as a small native program (C, its threads)
where there is a C compiler, and as compiled JavaScript in Node
otherwise. The program writes its answer's bytes in the bake's layout (below).

Numbers: `+`, `-`, `*`, `/` and `sqrt` are bit-exact on every target, and
sin, cos, exp and pow are within a few ulp (PLATFORM MATH, 2026-11-03).
So a baked answer is one the target could have computed, though not
always to the last bit. The same holds today for a page that runs a map
on the GPU.

## Where it is kept

The bake store sits beside the run store (run-store.ts) in the kept
directory. Each bake is keyed by:

- the definition's nodes and those of every definition it reaches;
- the bake's layout of its type (below);
- the bake's own version.

A rebuild with nothing changed reads the bytes back and runs nothing.
Editing any of those nodes makes a new key. Because the key says when a
bake is stale, the editor can show that later (an Editor lane row,
after G16).

## How it is loaded

The representation a list gets is the compiler's choice, made per program
and per target: cons cells, an array, columns, Float32 storage. So a
loader written per target would need one copy for each of those choices.
Instead, the bake rewrites the definition's body into a decoder written
in Ters:

```
match baked bytes("<key>") {
  some(b) → map(range(n), (i) → drop(float32 at(b, 20 · i), …))
  none → <the body as written>
}
```

The compiler then compiles the decoder like any other code, into
whatever representation it chose for the answer. Rows and columns, a
page and native code, all come out of the same rewrite. Three internal
builtins carry it, none of them offered:

- `baked bytes(key) : Option Bytes`. It is pure: the bytes are a
  function of the key, and `none` (no file, or a header that doesn't
  match) gives the body as written.
- `baked float32 at`, `baked float64 at` and `baked int32 at` of
  (Bytes, Int): a little-endian word. They are written in the prelude
  (G16a), so every target has them. A target may later read the word
  directly, with a DataView on JavaScript, a memcpy on C, or a load on
  WebAssembly (Bytes are native since C350), if the measurement says it
  pays.

The bake's layout is the answer's leaves in order: an item after
another, each leaf a 4-byte or 8-byte word, as the type's Float32,
Float64 and Int say. Lists start with their length. Each file starts
with a header: the magic "TERSBAKE", the layout's version, the key, and
the length. A file whose header doesn't match gives `none`, so a bake can
make a program slower to start, but never wrong.

The rewritten definition still makes its records one by one. For
rain-page's drops, what the bake saves is the work of making each one
(`scattered`'s random numbers and arithmetic), not the making of the
list.

Each target finds the bytes its own way:

- **Page** (`ters build-web`, the editor's apps): a carried file, as in
  G11a.
- **Native** (`ters native`, the desktop apps): a file beside the
  executable, read at start. A C array literal of megabytes compiles too
  slowly.
- **WebAssembly** (`ters wasi`): the same file, preopened.
- **Phones**: an asset in the app.

## Steps

- **G16a** (done): measure first: `start pane` is about 48 ms of a
  compiled JavaScript run, against 36 to 42 ms for the rest. Then the
  decoder's word readers, written in the prelude and not offered:
  `baked int32 at` and `baked float32 at` (a Float32's bits times a power
  of two from a table, exact), with `baked word at` under them. They are
  tested with bytes a DataView wrote, evaluated and compiled the same
  (ters/test/baked-words.test.ts). Being in the language, every target
  has them.
- **G16b1** (done): `baked float64 at` (the low word first, exact, by a
  table of 2,046 powers), and `baked bytes(key)`, which as written gives
  none, so a decoder gives its definition's body as written. All of them
  are in prelude-ids.ts for the compiler to find.
- **G16b2** (done): compiled JavaScript reads `baked/<key>.bin` from its
  world for `baked bytes` (none without it); native and WebAssembly keep
  the prelude's none until G16c. bake.ts never folds what reaches `baked
  bytes`. Test: compiler/test/baked-bytes.test.ts.
- **G16b3a** (done): the power tables are values, made once. Decoding
  20,000 drops in compiled JavaScript went from 934 ms to 30 ms, which is
  still more than the 20 ms `start pane` takes to compute them.
- **G16b3b** (done): compiled JavaScript reads a word directly, with a
  DataView kept by the bytes. Decoding the 20,000 drops' records takes
  9.6 ms on a first run, against 31.8 ms with the prelude's readers and
  about 20 ms for computing them.
- **G16b3c1** (done): the encoders, in the prelude and not offered:
  `baked float32 bytes`, `baked float64 bytes` and `baked int32 bytes`,
  each leaf's bytes exactly as a DataView writes them. A bake runs them
  compiled, over the answer in whatever representation it has. An Int
  outside 32 bits stops the bake.
- **G16b3c2** (done): the bake, compiler/src/bake-file.ts. It finds the
  layout from the definition's type, runs its encoder compiled, writes the
  header and the answer, and rewrites the body into its decoder. A Float32
  is read back through the numbers module's `as float32`, since its case
  is private. Compiled JavaScript checks the header. Test:
  compiler/test/bake-file.test.ts.
- **G16b3c3** (done): bakes are weighed (bake-file.ts `bakedPage`). The
  decoder is timed compiled, reading the file, against computing the
  answer compiled, and carrying the file costs about 0.036 ms a KB of
  base64. A bake is kept only where decoding and carrying take under 90%
  of computing.

  rain-page's `start pane` doesn't pay. Measured in Chromium, the page
  loads in 53 ms as written, 72 ms carrying the 537 KB file without
  reading it, and 95 ms reading it. In Node, decoding the 20,000 drops
  takes 22 to 29 ms, and computing them takes 20 to 31 ms. Each drop is
  cheap to compute from its seed, so making the list and its records is
  most of the work, and a bake doesn't save that (as "How it is loaded"
  says). What pays is an answer that is costly for each item, like G17's
  lightmaps.
- **G16c**: native and WebAssembly. Run the bake as C where there is a
  C compiler, with the file beside the executable or preopened.
- **G16d**: the decisions entry, and build-web baking what the weighing
  keeps (G16d1, done), with the bytes and the weighing kept in the store
  so a rebuild runs nothing (G16d2, done).
- **G16e**: lists, records of arrays, and Bytes, beyond an Array of
  records.

G17 then bakes a lightmap of rain-page's glass from its lamps through
this.

## What stays out

- **A bake a person writes.** There is no `bake(…)` call and no
  annotation. Baking is a way the compiler chooses, written in the
  decisions file.
- **Asset formats.** A bake writes its own layout of the answer's
  leaves, not PNG or KTX. Reading images a person made is the Host and assets row.
- **Baking with effects.** A definition that reads a file or the clock
  isn't baked. When its inputs change, the program as written changes
  nothing, so the key couldn't say the bake is stale.
