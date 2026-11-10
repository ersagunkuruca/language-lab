# A region per scope: measured before building (C57)

Design step, 2026-11-10, written before anything is built.
[STABLE-REFERENCES.md](STABLE-REFERENCES.md) §4 planned C57 as "a region
per scope": the temporaries made during one page update, one audio block
or one frame would be allocated by bumping a pointer and freed all at
once when the scope ends (Tofte and Talpin's region inference, as MLKit
does it).

## Where a region could apply

- **JavaScript and WebAssembly** have a collector (WasmGC on WebAssembly),
  so a program can't free anything itself there. A region would only
  matter on C.
- **C** counts references (c.ts `cellsC`). A cell is freed when its last
  holder lets it go. Cells of up to 256 bytes come from free lists, one
  list per size, cut from 256 KB blocks that are never handed back. So
  making a cell is already a pop from a list, or a bump through a fresh
  block, which is what a region's allocation is. What a region would save
  is the freeing: `lab_drop` and `lab_fields` walking each dead cell, and
  the count changes on cells that never outlive the scope.

## Measured (callgrind, instructions, this container)

**dice as a native page** (ui-headless, 200 presses of "Roll 100"):
freeing (`lab_drop`, `lab_fields`) is 1.0% of the run, and making cells
(`lab_new`) is 0.6%. Laying the page out takes most of the time: style
matching, numbers printed and read back as text, and so on. A region per
page update could buy at most about 1.6%.

**swarm natively** (2000 ticks, about 2,000 motes, 1.2 s):

| part | share |
|---|---|
| `lab_fields` | 9.3% |
| `lab_drop` | 7.4% |
| `lab_new` | 3.8% |

About a third of the drops fall in `ticks`, when the old tick's lists are
let go, and a third in `array of`. The cells they free are mostly the
pairs and lists that `keys of` makes each tick: entries as pairs, sorted,
then their keys. Listing the keys straight from the table is C58's
step (BACKLOG C58, KEYED-COLLECTIONS.md), and it would remove those cells
outright, so a region would have less left to free.

**Leaking instead of freeing** gives an upper bound on what skipping the
frees could buy: `lab_drop` returning at once, nothing ever freed. Swarm
then took 1.37 to 1.53 s, against 1.14 to 1.35 s with frees. That is
slower, because fresh memory misses the cache while reused cells hit it.
A region would reuse its memory each tick, so it wouldn't lose this way,
but it shows that the frees cost less than their instruction share
suggests.

The audio pedal doesn't build natively (it is a sound, rendered on
JavaScript), so there is no audio block to measure on C yet.

## Decision

Don't build regions now. No example measured spends more than 10% of its
run freeing one scope's temporaries in a way that C58's step won't remove.
The row stays open at P3. Measure again after C58's `keys of`, or when a
native program shows the drop walk above 10% of its run (a frame loop on
the pool's threads, or the pedal's block once a sound lowers to C).

If it is built, it is the Perceus-style form, not Tofte and Talpin's.
A cell made in a scope and proved not to escape it, by the same one-holder
facts owned-records.ts and owned-arrays.ts use, goes into the scope's
region instead of a free list. Its fields borrow rather than count, and
the region is reset when the scope returns. Everything else stays
counted, so a wrong guess costs a copy, never a dangling pointer.

## Prior art

- Tofte and Talpin, "Region-based memory management" (1997), and the
  MLKit.
- Reinking, Xie, de Moura and Leijen, "Perceus: garbage free reference
  counting with reuse" (2021): counting with reuse, as c.ts does, already
  frees each temporary at its last use.
- Goose (Wouter van Oortmerssen, 2026), whose per-scope arenas
  STABLE-REFERENCES.md §4 read.
