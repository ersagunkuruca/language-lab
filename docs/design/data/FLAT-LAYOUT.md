# Flat layout for data built once and read: where C59 would pay

**Status (2026-11-13).** Not built: no example gained over 10%, so C59
closed on 2026-11-12 until a program needs it (the likely first case is a
program's saved file).

Design step, 2026-11-10, written before anything is built.
[STABLE-REFERENCES.md](STABLE-REFERENCES.md) §4 planned C59 as "flat, inline
layout for data built once and then read: nested records inside each other
with no pointers, which is also a file format (FlatBuffers)". This note
looks for the places in Ters where that would pay.

## The idea

A value that is built once and then only read doesn't need to be a graph of
objects. It can be one block of bytes: records laid out inline, lists as
runs, and offsets in place of pointers. Reading a field is an offset away,
nothing is allocated, and the same bytes can be written to a file and read
back with no parsing. That last point is FlatBuffers' and Cap'n Proto's
whole point. In Ters this would be a representation, chosen when a value
has one holder and no change after it is built, never written.

## Where Ters builds data once and reads it

1. **Notebook's index** (the row's example, GAPS.md round 6, N3). The
   index is built once and read by every question. Since C71, C72 and
   #2094/#2095, `value at` on the hash table is one lookup and `entries of`
   is sorted once per version. The row's own measurement (2026-11-06) says
   a frozen map would buy notebook little now: what's left is spread out
   (`credit`'s `update at` per word, the garbage collector 12%).
2. **The library's tables on C and WebAssembly:** case, graphemes and
   collation (L214e5). They are compiled in as text constants and decoded
   by the cases module at run time. Measured 2026-11-10: c-cases.test's
   program, natively compiled from 4.7 MB of C, runs in 20 to 24 ms, where
   an empty process takes 12. So decoding the tables, plus the program's
   own prints, is about 10 ms per start. Laid out flat as static data, that
   would be close to 0. That is 10 ms of a native app's start, which isn't
   worth a representation by itself.
3. **The tool's own kept check** (I193a, .lab/*.v8): about 0.25 s per
   process reading back the library's check. This is the editor's and
   CLI's data, not a Ters program's, so it isn't C59's. But it is the
   largest "built once, read every time" cost measured anywhere in the
   project. A lazy read (one definition's part decoded when it is asked
   for) belongs with I193's on-demand typing (INCREMENTAL-CHECK-2026-11-10.md).
4. **A program's own saved data.** A file a program writes and reads back
   (the Files effect, std's Json) is where "also a file format" pays: no
   parse on load. No example saves and loads data of any size yet. The
   mobile apps (C198, C199) are the likely first: an app's state saved
   between launches.

## Proposal

- **C59 stays a representation with no example.** Nothing measured gains
  more than 10%: notebook gains little, and native table decoding is about
  10 ms. Keep the row at P3, with this note's findings.
- **The first real case is probably a saved file.** When an example saves
  and loads data of some size (a mobile app's state, a game's level), time
  its load through Json first. Build the flat format only if loading is
  more than 10% of its start.
- **Native tables as static data** is a small step of its own, worth taking
  if a native app's start is measured and the 10 ms matters.
- **Point 3 is a note for I193,** not a C59 step.

## Prior art

FlatBuffers (Wouter van Oortmerssen, Google, 2014) and Cap'n Proto (Kenton
Varda, 2013): zero-copy layouts that are also the wire and file format.
Goose (van Oortmerssen, 2026) inlines nested structs, as STABLE-REFERENCES.md
§4 credits. Compact regions in GHC (Yang et al., "Efficient communication
and collection with compact normal forms", ICFP 2015): an immutable value
copied into one block, so the collector skips it and it can be sent as is.
