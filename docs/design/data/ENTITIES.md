# Entities and components as a representation (design note for BACKLOG G1, 2026-11-17)

Ersagun, 2026-11-17, on a medium-sized game: "A LOT of entities,
components etc. All the game development tricks tested on the language.
ECS, …". This note says how a Ters program writes a game's entities, and
how the compiler stores them, so that the storage engines use (archetype
tables, columns, presence bits) is something the compiler chooses, not a
library the game calls. It follows NO EXPLICIT SELECTION (2026-10-30) and
REPRESENTATIONS.md: a program says what its data means, the compiler
picks how it sits in memory.

## What engines do

- **Objects.** Each entity an object holding its components, updated
  by a virtual call a frame. Easy to write; every update chases pointers.
- **Sparse sets** (EnTT, Michele Caini): one packed array per component
  type, indexed through a sparse array by entity. Adding and removing a
  component is cheap; a query over two components walks one set and
  looks up the other.
- **Archetype tables** (Unity DOTS, flecs by Sander Mertens, Bevy's table
  storage): entities with the same set of components share a table, one
  column per component. A query visits only the tables that have what it
  asks for, and walks their columns straight. Adding or removing a
  component moves the entity's row to another table.
- **Scheduling.** A system declares what it reads and writes (Bevy works
  it out from the system's parameters; Unity from job dependencies), and
  systems with no conflict run at once.

All four are ways of storing one meaning: a set of entities, each with
some components. That is a data type, and storage of a data type is what
Ters representations are for.

## How a program writes it

An entity is an ordinary record. A component it may or may not have is
an `Optional` field; one it always has is a plain field. The world keeps
its entities in a `Pool`, so each has a generational key.

```
type Thing = thing(place: Vec, velocity: Optional Vec, light: Optional Lamp,
                   body: Optional Body, wings: Optional Wings, age: Int)
type World = world(things: Pool Thing, tick: Int)
```

A system is a function over the pool that maps or keeps its items by
their fields:

```
fly(w) = updated in pool(w.things, (t) => match (t.velocity, t.wings)
  (some(v), some(f)) → with velocity(t, flown(v, f, w))
  _ → t)
```

`updated in pool` is a std operation on Pool (G1a): the pool with each
item replaced by f of it, keys unchanged. `kept in pool` removes the items
that fail a test, as `removed from pool` does, and `pool items` lists them
in slot order. Spawning and despawning inside a
system are not done in place: a system gives back the changes it wants
(a list of `spawn(Thing)` and `despawn(Pool key)`), applied after it, as
pond's plans are (GAPS round 13). That is Bevy's `Commands`, and in Ters
it is just a returned value.

A game may also write its entities as a sum type, `type Thing = moth(…) |
lamp(…) | pot(…)`, when each kind's set of components is fixed. Both are
the same question for the compiler: which items share a shape.

Nothing above names a table, a column or a thread.

## How the compiler stores it

Three representations of `Pool Thing`, each with its meaning back to the
pool's slots (REPRESENTATIONS.md), chosen by cost as Map's and List's are:

1. **Rows.** The pool as it is today: an array of records by slot.
2. **Columns with presence.** One column per field, as drift's records
   are already (COLUMNS.md, C60), and for each `Optional` field a bit per
   slot saying whether it is `some`. A system matching `some(v)` walks
   the bits and reads the column where they are set. This is the
   sparse-set trade: adding a component sets a bit, no row moves.
3. **Archetype tables.** Slots grouped by which `Optional` fields are
   `some` (or by case, for a sum type), each group a table of columns of
   only the fields it has. A system matching `(some(v), some(f))` visits
   only the tables where both are present. The pool's key finds a row
   through an index slot → (table, row), as flecs and Bevy keep. A system
   that changes a field from `none` to `some` moves the row, at the end of
   the system, never during its walk.

What decides between them is how the program uses the pool, counted as
the representation planner counts every other choice (the compiler
redesign's stage 3 plans representations from types and a cost table;
this is one more entry, not a separate pass):

- the systems that match on presence, and how many items each skips;
- how often a field goes from `none` to `some` or back (a row moved each
  time with tables, a bit flipped with columns);
- what leaves whole (an item printed, compared, sent away: a gather from
  columns, as columns already do).

The default for a pool whose items all have the same fields present is
columns; tables only pay when systems skip most items and shapes change
rarely. Measured first on the greenhouse (G6), not assumed.

## Systems at once

Each system is a pure function of the world as it was. Two systems may
run at once when neither writes a field the other reads or writes. The
compiler knows each system's field reads and writes from its code (the
same analysis columns.ts makes to keep a column unwritten), and the
world's effects from its type: a system that prints, or reads the clock,
runs alone. The scheduler is the existing `together` on threads (C201,
`par:together`), given systems whose writes go to different columns, so
there is nothing to merge but the columns themselves. A tick written as
`fly`, then `glow`, then `age` keeps that order wherever one reads what
another wrote; it is a dependency graph worked out from the code, never
declared.

## Before this pays: the per-item cost

Game round 1 (moths, GAPS.md) is the warning. Moths are already columns
and the grid is already arrays; layout was not what made them 3x C. The
time went to allocation per item (lists made to be walked once, records
built per neighbour), to the thread pool's own cost per item (a count
taken and dropped on the shared closure for each item, about five
atomic count changes per moth), and to compiled JavaScript making a
record per call. Archetype tables would save none of that. So the order
is: G3a to G3d first (each item costs what C's does), then G1a and the
greenhouse written with a Pool of Things on columns with presence, then
tables (G4) only where the greenhouse shows systems skipping most items,
then systems at once (G5).

## Steps

- **G1a** (done). std: `updated in pool` (map a pool's items, keys
  kept), `kept in pool` (despawn those that fail a test), `pool items`.
  Changes applied after a system need nothing new: a fold of the list it
  gives back with `added to pool` and `removed from pool`. The greenhouse
  writes its moths and lamps as one `Pool Thing` (G6).
- **G1b.** Columns with presence: an `Optional` field of a record kept as
  columns stored as a bit per slot and a column of values, read in place
  by a match on it (columns.ts, C and JS first).
- **G4** (done). Archetype tables. compiler/src/pool-shapes.ts runs each
  system's function on what each shape of item says (its `Optional`
  parts there or not, the rest unknown) and tells the call the shapes it
  touches: `updated in pool shaped`, `kept in pool shaped`, `pool items
  shaped` (prelude, each meaning the word it was written as), and
  `updated in pool keeping shapes` where the function surely gives every
  item its own shape back. Only functions that surely finish and do
  nothing else are told. A pool with such calls is stored as "tables"
  (map-tree.ts): a slots table per shape, a key finding its table by the
  slot it names, a changed shape moving the item after the walk. Tables
  are picked only where a shaped call is (the ladder can't see the part
  of n a shaped walk skips, so the costs tie). The greenhouse, 600 ticks
  of 2000 moths, one thread: compiled JavaScript 3.98 → 3.02 s, wasi
  2.69 → 2.31 s, native 1.06 → 0.95 s, as fast as the greenhouse split
  into three pools by hand; see GAPS.md game round 2.
- **G5.** Systems at once from their field reads and writes.

## Credits

Influences: archetype storage as in Unity DOTS (Unity Technologies),
flecs (Sander Mertens) and Bevy (Carter Anderson and contributors);
sparse sets as in EnTT (Michele Caini); systems scheduled by what they
read and write as in Bevy; deferred spawning as Bevy's `Commands`. Prior
art for entity systems as a data layout: Adam Martin's "Entity Systems
are the future of MMOG development" (2007). Generational keys are
already credited with the Pool (KEYED-COLLECTIONS.md).
