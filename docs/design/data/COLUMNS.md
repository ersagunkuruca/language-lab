# Columns: an array of records as an array per field (C60)

Ersagun, 2026-11-10: the default compiled code should be as close as
possible to what a C/C++ programmer doing data-oriented design would write,
someone who is aware of the cache and of memory. Pools and the like are for
a last 10%. For a list of records that a loop walks while reading a few
fields, that programmer writes a struct of arrays: `x[i] += vx[i]`, with no
object per item and only the fields read brought into the cache.

## Where drift stands (examples/drift, 300,000 motes, 100 steps)

| version | time |
|---|---|
| compiled, before #2222 | about 10 s (each mote rebuilt, a new array each step) |
| compiled after #2222 (motes changed in place) and #2255 (the map writes into its own array) | 1.1 to 1.4 s |
| by hand, objects changed in place (compiler/gaps/drift.ideal.js) | 0.4 to 0.7 s |
| by hand, columns (Float64Array per field) | 0.25 to 0.36 s |

This machine is shared, so timings swing by ±30%. Patching the compiled
loop by hand showed no single cost bigger than 10%:

- Int arithmetic inlined;
- the array read without its checks;
- unread fields left unread;
- the slot written straight into the buffer.

What remains is the layout itself: 300,000 objects of nine fields, each
step touching every object.

## What it is

An array type whose items are a record R is stored as columns when every
use of it in the core IR is one of these:

1. its length;
2. an item read at a position, where the item is only read field by field.
   That includes the item handed to a function whose input is only read
   field by field, or is rebuilt from its own fields (owned-records.ts);
3. a slot replaced (owned-arrays.ts) by a record made from the fields of
   the item read at that slot. Only the changed columns are written;
4. the array made from records pushed one at a time (a map from another
   array, `array of` a list). Each record's fields go into the columns.

An item that leaves whole (printed, compared, kept in another structure,
given to a closure that isn't known) keeps the array as rows. The meaning
stays the cons list, and a program never says "columns" (no explicit
selection, 2026-10-30).

On JavaScript, a Float64 field is a Float64Array and any other field is a
plain array. On C (c2d), the array keeps its one buffer of slots, but
the slots hold the columns one after another: field 0 of every slot,
then field 1 of every slot. Field f of slot k sits at
`it + cap * 8f`, as an array of the field's type (eight-byte fields only,
so each column stays aligned). An item that is read whole, or copied
when two hold the array, is gathered field by field. Threads and keys
walk a buffer as whole items, so an array they touch stays rows. A
column read lends its array and index (c2c), as a field read lends its
record.

## Steps

- **c1.** The analysis, plus the JavaScript rewrite for uses 1 to 4, with a
  copy of each function that takes an item (`moved`) taking the columns and
  the position instead. Example: drift. Done when drift compiled is within
  2× of the hand-written columns.
- **c2.** C (c2a to c2d, done: native drift 2.85 to 0.12 s at 300,000
  motes), then WebAssembly.
- **c3.** An item that leaves whole, made from the columns where it leaves,
  but only if an example wants it.
