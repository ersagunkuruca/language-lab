# Keyed collections: what C58 should be in Ters (C58)

Design step, 2026-11-10, written before anything is built.
[STABLE-REFERENCES.md](STABLE-REFERENCES.md) §4 planned C58 as "a keyed
collection stored as a grow-only array with a free list and generational
keys (ECS)". This note reads that idea against what Ters has and what its
programs do.

## What generational keys are for

In an ECS engine (and in Rust's slotmap or generational-arena crates) the
collection gives out its keys. An insert answers with a handle, which is a
slot number plus the slot's generation. A remove frees the slot and bumps
its generation. The slot is reused by the next insert. A handle kept from
before the remove names the old generation, so it finds nothing instead of
the new item. The generation buys two things: a handle that finds its slot
in one index, and a stale handle that can't read another item.

## What Ters has instead

- **Keys are the program's own data.** Ters has no collection that gives
  out keys. A to-do's key is an Int the program made (STABLE-REFERENCES.md:
  "Identity … is a key, plain data such as an Int"). A Map lookup compares
  keys, so a removed key already finds nothing, whatever the
  representation. The safety half of generations is already true by
  meaning.
- **Maps are already changed in place.** On JavaScript, std's Table is a
  JS Map with Baker's shallow binding (std.ts `Table`, C63b). On C and
  WebAssembly, it is the runtime's own hash table (C63h to C63k). Either
  way, a lookup is one hash and no copy.
- **Key paths look items up by key every time** (L98 keys), so a path made
  once keeps naming its item as others move. That is the stable reference
  the ECS handle gives, already without slots.

So the generational part of C58 has nothing to do in Ters unless the
library gets a collection that gives out keys, and no program asks for
one yet.

## Where a slot array would still pay

What is left of the idea is the array, for keys that are small Ints.
Measured on Node 22, 100,000 Int keys put then read:

| store | ns per put and get |
|---|---|
| JS array indexed by the key | 20 to 25 |
| JS Map | 113 to 137 |
| std's persistent Table (each put a version) | 231 |

So an Int-keyed map whose keys are dense would go 4 to 9 times faster as an
array. Lua 5's tables do exactly this without being asked: each table has
an array part for keys 1 to n and a hash part for the rest, and when a
table is rehashed the array part is sized to the largest n with more than
half of 1 to n in use (Ierusalimschy, de Figueiredo and Celes, "The
Implementation of Lua 5.0", 2005). In Ters this is a representation of Map
chosen at run time:

- **Map Int v, array part plus table.** Keys in [0, n) live in an array of
  slots, each holding a value or "empty". Other keys live in the Table as
  now. The array grows when more than half of a doubled range would be in
  use, as Lua's does. This is invisible: same answers, same order for
  `entries of`, since an array's slots are already in key order.
- **Versions.** std's Table keeps old versions by recording each change
  (shallow binding). An array part records its changes the same way, with
  the slot index in place of the key.
- **Targets.** In JS it is a field on Table. In C and WebAssembly the
  runtime's Int table gets the same array part.

## Which programs would gain: none yet

Every map operation in the examples was listed with its key's type
(scratchpad mapkeys.ts, 2026-11-10):

- **agent:** Int keys, its A* over 8 triangles. Tiny.
- **notebook, routes, sheet:** Text keys, and routes also (Int, Text) items.
- **The rest:** no maps.

No example keeps a map of many small Int keys, which is what the array part
is for. By the rule that a row is done when its example works, C58 needs
its example first.

## Proposal

1. **C58a: the example.** It should be a program that keeps many things by
   Int key and adds and removes them as it runs. For example, a swarm whose
   particles are born and die, each keyed by a counter, some pointing at
   others by key (a particle following another). Time it with the Table
   as it is.
2. **C58b: the array part,** built only if the example spends more than 10%
   of its run in map operations on Int keys, and only where it measures more
   than 10% better. JS first (std.ts Table), then C's Int table.
3. **Keys given out by a collection, with generations: not now.** It would
   need a library type whose insert answers with a key (a "pool"), and its
   handles could be slot plus generation, because only the pool can make
   them. It is a language question, whether programs should have keys they
   don't choose. It becomes a row only if an example wants one. A swarm
   whose counter never repeats doesn't.

A counter that runs on forever (particles born for hours) leaves the array
part with fewer than half of its slots used, and Lua's rule then moves
those keys to the hash part. That is the one case where reusing slots
(the pool) would beat the array part. The example will show whether it
matters.

## Built since: a pool (C58c, 2026-11-10)

Ersagun asked for free lists, which need the collection to choose its keys,
since a key the program chose can't be handed to another item. So std now
has `Pool a` and `Pool key` (proposal 3): `added to pool`, `pool item`,
`replaced in pool`, `removed from pool`, `pool keys`, `pool size`, and
`next key`, the key the next add gives (an item can hold its own key). It
is written in the language over two lists, the items by slot and each
slot's generation, plus the free slots; compiled, the lists are arrays, so
a lookup is an index and a generation compared. swarm on a pool is the
next step, timed against its Map version.

## Prior art

- Generational indices in ECS engines, and Rust's slotmap and
  generational-arena crates; Catherine West's RustConf 2018 closing keynote
  made them widely known. Goose (Wouter van Oortmerssen, 2026) has pools
  without generations, as STABLE-REFERENCES.md §4 notes.
- Lua 5's array part and hash part (Ierusalimschy, de Figueiredo and
  Celes, 2005).
- Baker's shallow binding ("Shallow binding makes functional arrays fast",
  1991), as std's Table already credits.
