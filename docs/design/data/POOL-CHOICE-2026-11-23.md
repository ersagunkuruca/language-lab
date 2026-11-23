# A pool as a choice (L280f)

**Decided (Ersagun, 2026-11-23 06:20 UTC).** `Pool a` means a Map plus a
counter, and its keys are opaque. Slots with a free list become a way the
compiler picks, written in `<program>.choices` like Map's tree or hash
table. Two options were turned down: pooling plain counter-keyed Maps
(it needs a proof of how keys flow, which breaks quietly) and leaving the
Pool as it is.

## The meaning

```
data Pool a = pool(entries: Map Int a, next: Int)
data Pool key = pool key(number: Int)
```

- `empty pool` is `pool(empty map, 0)`.
- `next key` is `pool key(next)`.
- `added to pool` puts the item at `next` and counts one on.
- `pool item`, `replaced in pool` and `removed from pool` are the Map's
  lookup, put and remove, at the key's number.
- `pool keys` and `pool items` are the entries in key order, which is the
  order the items were added in.

A key is a number that is never given out twice. That makes the safety
half of generations true by meaning: a key kept after its item was
removed finds nothing.

## The snag: a key's meaning

The slots way needs each key to find its slot in one step, so its key has
to carry the slot. Its key is `(number, slot)`. The number is the counter
that the meaning gives out. It plays the generation's part: a slot keeps
the number of the item in it, and a lookup compares the two. The slot is
only a hint and means nothing. So the slots way's key means
`pool key(number)`, and two keys are equal when their numbers are.

That changes two types together, Pool and Pool key. Today a representation
row (represent.ts `Representation`) has one `of` type. So the row gains a
companion: the key type it stores its own way, with that type's meaning
(take the number) and its own equal, show and compare (by the number).
The chooser picks the two together, and they are held together.

## The slots way

```
slots(items: List (Optional a), numbers: List Int, free: List Int, size: Int, next: Int)
slotted key(number: Int, slot: Int)
```

This is today's Pool with its generations replaced by numbers. `next key`
is `slotted key(next, the first free slot or slots)`.

- A lookup reads `items[slot]` when `numbers[slot]` is the key's number.
- A remove puts the slot on the free list. No generation is counted up,
  since the next item that takes the slot brings a new number.
- `pool keys` comes out in number order. Slots are reused, so slot order
  isn't number order. The slots way sorts the keys, or walks them in
  number order (n log n against n), and its cost row says so.

## Costs

| job | Map plus counter (hash table) | slots |
|---|---|---|
| add, item, replace, remove | 1 (hashed) | 1 (indexed) |
| keys, items in order | n log n (sorted) or n (in order) | n log n |
| space | n | slots ever used at once |

So the slots way wins on constant factors and memory reuse, not on order.
swarm-pool measured 1.5 to 1.8 s compiled on slots against 2.6 s on a Map
(C58d, which was a Map the program keyed itself). The chooser picks slots
for a pool whose run is mostly adds, lookups and removes, and the Map
where keys are walked in order often. Measured runs (L280d) decide where
they exist.

## Steps

1. Rewrite the meaning in prelude-source.ts with the same job names and
   the same answers for programs that never look at a key's slot. None
   does: swarm-pool, pond-page and compiler/gaps/pond only name the type.
2. Add the slots way as a representation row with its key companion,
   with laws against the meaning (rep-laws.ts).
3. Add the choices entry: `std.pool representation: Pool as slots; among
   Map and counter, slots; …`, which can be held.
4. Time swarm-pool, pond-page and compiler/gaps/pond each way, on every
   target.

## Built (L280f)

The meaning is in prelude-source.ts (the pool section) and the slots way
in map-tree.ts, as `Pool slots` with `Slotted key` beside it (together.ts
names the two as one choice). As built, the slots way differs from the
plan above in three places.

- It keeps the order the items were put in: a list of slotted keys,
  newest first, so `pool keys` and `pool items` walk it in n and need no
  sort. A removed item stays in the order until the removed outnumber
  the rest; then the order is compacted.
- A key whose slot no longer holds its number (removed, or a key of
  another pool) finds its slot in the order by halves, since the order's
  numbers fall. The meaning lets such a key name an item another way, so
  the slot alone can't say it's gone.
- The library picks the pool's way before Map's, so the meaning's own
  Map doesn't make Map's choice for the program (library-reps.ts).

Measured against the pool before L280f (seconds, the same machine and
hour):

| program | target | slots way | before |
|---|---|---|---|
| swarm-pool | JavaScript | 1.1 to 1.3 | 0.85 |
| swarm-pool | native | 0.46 | 0.30 |
| swarm-pool | WASI | 1.04 | 0.75 |
| greenhouse | JavaScript | 3.3 | 3.9 |
| greenhouse | native | 0.94 | 0.99 |

swarm-pool is slower, but not for its stale keys: 5.6% of its lookups
look along the order, under 1% of its native instructions (L280j,
measured). The three calls of each lookup are about 39% (C317).
