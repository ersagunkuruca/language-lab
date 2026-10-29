# Stable references without giving up values

Written 2026-10-29 from the thread "Design reactive lists for cells". The
discussion is in a Claude doc of the same name; this file is the reasoning
and the design the repository keeps. Nothing here is built yet. The steps
are BACKLOG rows L98-L101 and C56-C61.

**In one sentence:** the window between pure functions and objects that stay
where they are is *uniqueness*: a value only one place holds may be changed
in place, and no pure function can tell. Cells are a second, separate window,
for when someone *should* see the change. Both are representations the
compiler picks, never something the program says.

## The question (Ersagun, 2026-10-29)

FP makes reasoning easier and made huge complexity manageable (React's pure
render functions), but it makes "copy a big structure" the default way to
change one. Non-FP code keeps an object in one place and changes it there:
fewer allocations, and the change is known when it happens. ECS engines in
games push that furthest. React lost favour because it sends everything down
the O(n) route (snapshots in, diff out). Immutable.js shared structure but
still diffed, a virtual DOM for data. We want both: the pure functions and
the stable references. Effects are our window into imperative code; are
cells the window into objects with stable references? And if granular
updates need `Cell` fields inside data, that colours data the way `async`
colours functions.

## The reasoning

### Immutability is about what can be observed, not about memory

"This value never changes" only promises that nobody holding it sees it
change. If one place holds a value, changing it there breaks no promise:
the old version has nobody left to see it. That is Clean's unique arrays,
Koka's, Roc's and Lean 4's reuse in place, and Hylo's and Swift's value
types.

So there are two reasons to want an object that stays where it is:

| | Unobserved identity | Observed identity |
|---|---|---|
| Wanted for | speed: no allocation, no copy | sharing: others must see the change |
| Who can tell it's the same object | nobody | the readers, on purpose |
| In the language | nothing: values stay values | a cell (`read`, `write`), an effect |
| Today | C20 `$own`, C30 lists as arrays | `src/lang/cells.ts` |

React and Immutable.js mixed the two: they used observed identity (compare
snapshots by reference) to buy speed, so every speed question became an
equality question. We keep them apart.

### Decided by Ersagun

- **Stable references stay invisible** (2026-10-29: "we don't have to know if
  we don't need to know"). No `inout`, no reference types, no array kinds.
- **No hints and no promises the programmer writes** (no Koka-style `fip`).
  In place is entirely the compiler's choice.
- **Later goals: cache friendliness and multithreading**, as ECS engines get
  them. Both are recorded below as later steps.

These follow the project's two rules: the type is the meaning and the
representation is how fast it goes (NUMBERS.md), and target quirks never
dent the language (the "two landscapes" rule).

### Colour, and how effects avoided it

`item(title: Cell Text, done: Cell Bool)` makes every function on items come
in a reactive and a plain kind, as `async` splits functions. Effects avoided
that by moving "may wait" out of the function's kind into its row, and rows
are polymorphic, so one `map` serves every function. The same move for data:
take "reactive" out of the data's type and put it in the *read*. A cell
holds plain data; a page's read of `todos`, then item 3, then `.title` is
tracked as that path; the value a watcher sees has the plain type `Item` and
is stored as a view into the cell. Functions don't know which they got, as
they don't know whether a list is cons cells or an array.

Identity is still needed (two equal to-dos are two to-dos), but it is a key,
plain data such as an `Int`, unique within its collection. Not a cell.

## The design

Five pieces. Each is a representation or a handler; none adds a kind of
data, and a program reads the same under all of them.

### 1. A cell owns its value; a write is an edit at a path (L98)

Today `write(c, v)` replaces the whole value, so the handler compares old
and new. Instead the Update effect gains edits at a path:

```
write(todos, at(3).title, "buy milk")
insert(todos, at(0), item(7, "call mum", false, []))
move(todos, from 5, to 1)
remove(todos, at(2).children, at(0))
```

A path is plain data (`at(i)`, `key(k)`, a field), so a definition can build
one. The cell is the only holder of its value, so the handler applies the
edit in place with one store. It knows exactly what changed, so it wakes the
readers of that path, of its prefixes, and of the collection's order or size
when an insert, remove or move changed them. A length is a formula over the
collection; a formula already wakes its readers only when its value changes,
so the length is "its own variable" for free.

A reader that keeps a value it read becomes a second holder; the next edit
copies only the path it touches (copy on write, O(depth)). Every value
anybody sees is still immutable.

Keyed collections need unique keys: inserting a key already present is an
error, as in a Map. The handler keeps the table from key to position that
makes a keyed edit O(1).

### 2. Reads tracked by path: reactive is a representation (L99)

A watcher or formula that reads a cell gets a *tracked view* of the value:
each field or item it reads is recorded as a path. Outside watchers and
formulas, values are stored plainly. The evaluator does this with a view
object; the compiler picks the view only where a watcher or formula reads,
like any other representation choice.

The `each` and `for each` of today (Solid's `mapArray`, matched by equality,
O(n²)) become keyed and driven by the edits: an insert adds one row, a move
moves one DOM node, a remove disposes one row's owner. Nothing is diffed.

Reactive or plain is the handler's choice. Under a plain `State` handler a
write is a store; under `Cells` it wakes readers. A program with no formula,
watcher or page can have its tracking removed altogether.

### 3. Owned values updated in place (C56)

A representation row "owned, in place", chosen when a value has one holder,
generalising C20's `$own` and C30's lists as arrays to records, maps and the
values inside cells. The compiler decides; a silent copy is slower, never
wrong. Reference counts at run time where the compiler can't tell
(Perceus) are the fallback.

### 4. Regions, references as positions, flat layout (C57-C59)

Three ideas from Goose (Wouter van Oortmerssen, 2026), and from ECS engines
before it, each as a representation:

- **A region per scope** (C57). Temporaries made during one page update, one
  audio block or one frame are allocated by bumping a pointer and all freed
  at once when it ends. Region inference: Tofte and Talpin's MLKit.
- **References as positions with a generation** (C58). A keyed collection
  is stored as a grow-only array with a free list; a key resolves to a slot
  plus a counter, so a reused slot never answers for an old key (generational
  indices, as in ECS engines; Goose's reusable pools lack the counter and say
  a stale reference reads another item).
- **Flat, inline layout** (C59) for data built once and then read: nested
  records inside each other with no pointers, which is also a file format
  (FlatBuffers, by the same author).

What we don't take from Goose: array kinds in the type, one growable value
per struct, no growable data across recursion, no closures. Those put the
representation in the language, which Ersagun decided against.

### 5. Later goals: cache friendliness and multithreading (C60, L101)

- **Cache friendliness (C60)** comes from layout, not from uniqueness: a list
  of records stored as columns (struct of arrays), chosen when the loops that
  read it read few fields. Full control on WebAssembly and C; in JS only
  with typed arrays.
- **Multithreading (L101)** is where uniqueness pays: a column with one holder
  can be split and mapped on several threads with no data races, as Rust's
  rayon does. Effect rows already say what each step reads and writes, which
  is what an ECS scheduler uses to decide what may run side by side. This
  joins LANGUAGE-NEEDS-2026-10-24.md's `together` and data-parallel map.

### 6. Where code runs, chosen like everything else (C61)

Ersagun (2026-10-29): use every processing environment, more automatically
than Unity's Burst or hand-written compute shaders. On the web that is JS,
WebAssembly, Web Workers and the GPU through WebGPU, which does run
general compute shaders (we already do: `compiler/gpu.ts` runs each scalar
function as a WGSL compute shader and compares it with the evaluator).

The same rule as above applies: where a part runs is a representation-like
choice, made by the compiler by cost, never written in the program. What
makes a part eligible is already in its type: a pure row with no Choice can
go to a worker or the GPU; the scalar profile (numbers, records of numbers,
loops) can go to WGSL; anything with Console, Files or Update stays on the
main thread. The chooser weighs the work against the cost of moving the
data there and back, which is where flat layout (C59) and columns (C60)
matter. This extends L96's "ways chosen by cost per target" from one
operation to a whole map or fold. Prior art: Unity's Burst compiler and
job system; Futhark (Henriksen et al. 2017) and Accelerate (Chakravarty et
al. 2011) for data-parallel code on GPUs; Halide's separation of algorithm
and schedule (Ragan-Kelley et al. 2013); HVM and Bend (Victor Taelin,
Higher Order Company), which run interaction-net programs on CPU threads
or the GPU automatically. Bend 2 not yet read.

## The demo (L100)

A nested to-do outline (items with children, any depth) on a page, with a
live "what ran" counter beside it: renaming an item runs one watcher,
ticking one updates its line and the "3 of 7 done" count, moving an item
moves one row, adding a child adds one row. Built on L98 and L99, written
in the editor's language with plain `Item` data and keys.

## Prior art

Credited in CREDITS.md, "Stable references, in place and reactive
collections (designed, not built)".

- Uniqueness: Clean (uniqueness types, 1990s); Rust's ownership; Hylo
  (formerly Val; Racordon, Abrahams et al., "Implementation strategies for
  mutable value semantics", 2022) and Swift's copy on write; Koka's Perceus
  and FBIP (Reinking, Xie, de Moura, Leijen 2021; Lorenzen, Leijen,
  Swierstra 2023); Roc; Lean 4.
- Persistent structures: Okasaki, *Purely Functional Data Structures*
  (1998); Clojure's vectors (Rich Hickey, after Bagwell's HAMT);
  Immutable.js. Considered, not the main road: they bound the copy but keep
  the diff.
- Regions: Tofte and Talpin (1994), MLKit; Cyclone; Vale; Zig and Odin
  arenas; Goose (Wouter van Oortmerssen, 2026,
  https://github.com/aardappel/goose/wiki).
- ECS: Unity DOTS, Bevy, flecs (Sander Mertens); Mike Acton, "Data-Oriented
  Design and C++" (CppCon 2014).
- Path-tracked stores and edits as changes: Solid's `createStore` and
  `produce` (Ryan Carniato), MobX (Michel Weststrate), Immer's patches;
  DBSP (Budiu et al. 2023), differential dataflow (McSherry et al. 2013),
  Jane Street's Incremental. Fractional positions for ordered items:
  Figma's fractional indexing, Logoot and other sequence CRDTs.
- The colour argument: Bob Nystrom, "What color is your function?" (2015).
