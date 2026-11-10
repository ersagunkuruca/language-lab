# What a hole's offers still spend, and what to build next (E103, I193)

Design step, 2026-11-10. Asked before building more on E103 (BACKLOG): an
incremental check, which is also the route left for I193. It builds on
[CHECK-BY-GROUP-2026-11-03.md](CHECK-BY-GROUP-2026-11-03.md) (L183, L215),
which caches a group's check under its callees' schemes, and on E103p, which
made a reused check cost about what it rechecks.

## Measured (main at #2200, physics `fall`'s 17 holes)

The 17 holes take 14.5 s in all, and the worst one, mirt1t, takes 1.5 to 1.7 s.
E103 is done when the worst takes under a second. A CPU profile of all 17
holes (`fillingSteps`, 13.6 s) splits like this:

| what | s | share | per unit |
|---|---|---|---|
| whole checks of the group and its callers (`byKind`) | 3.9 | 29% | 562 checks, 6.9 ms each |
| the modes of the group per offer (`newPlans`, `solveMode`) | 3.2 | 24% | |
| making each filled program (`fillHole`, `filledFrom`) | 2.6 | 19% | |
| units per filling (`unitsHold`) | 1.4 | 10% | |
| the rest (`wayField`, `fits`, `dependents`, `meetsUses`, the first check) | 2.5 | 18% | |

**The whole checks.** On the unchanged program, a reused check costs about
1.6 ms with nothing rechecked, 2.0 ms with `fall`, and 4.4 ms with `fall`,
`landing times` and `main`. So `main` costs about 2.5 ms and the fixed part
1.6 ms. A filled program's check costs 6.9 ms. The extra 2.5 ms is mostly
`fall`'s new body solved inside the check (`letValue`, `solveType`): the
filling changes what `fall` runs backwards, so that cost is real work.

Of the 562 checks, 270 pass (1.65 s) and 292 refuse (2.6 s). Every one of
the refusals is in a caller, none in the group:

- 127 refuse at `main` because it prints while a Choice from `fall` is open
  (1.7 s). This is E103n's known case, and it needs main's handlers to
  predict.
- About 165 refuse on types in `main` or `landing times` (about 0.95 s):
  "isn't a Number", "has no std.trig", "a given port: expected …".

## What an incremental check can and can't buy here

L215's cache already does what "incremental" usually means. A caller's
check is keyed by its callees' schemes, and the palette already checks one
filling for each different group type (`groupTypes`). Every check left is
for a type the program hasn't seen, so a cache can't answer it. Making them
cheaper means making each one smaller, not skipping it. There are three
ways to do that, each about 10% of the total:

1. **Resume the callers' check (about 1.4 s at most).** Keep each caller's
   inference with the group's uses as open type variables, solved once.
   Then each outcome unifies the group's new scheme at those uses and runs
   the caller's checks that come after unification. Unification gives the
   same result in any order, so this is sound for types, except in two
   places:
   - **A let inside a caller that generalises over a use.** Such a let
     can't be resumed, so its caller is checked whole.
   - **What is decided while inferring**, where the checker reads a type
     before it is known (`opAt`, ways, defaulting). Those decisions have to
     wait until after the uses are unified.

   This is the units check's own shape (`UnitsBefore`: the earlier system
   solved once, copied, then given only the new constraints), applied to
   types. It is the largest change of the three and touches infer.ts's
   order of work.
2. **Units by what a filling makes of the group (up to 1.4 s).** A caller's
   unit constraints include the group's inlined, so they follow from the
   group's own constraints. Keyed by those constraints, renumbered, the
   callers' units are solved once per key instead of once per filling, as
   the types already are. It touches units.ts only. Measure first how many
   keys a hole has. If nearly every filling has its own key, there is
   nothing to gain.
3. **Make the filled program cheaper (up to 2.6 s).** `fillHole` and
   `filledFrom` (1.1 s) run for each offer, and `filledFrom` already writes
   into one shared copy (E103). Profile what is still per offer
   (`forgetSpine`, `fillUses`, `derivedFrom`). This is plain engineering,
   with no risk to what the check says.

The modes per offer (3.2 s) are E103's oldest cost. Several cuts were tried
and measured, and none was sound (BACKLOG E103), so this note doesn't add
another.

**Order:** (3), then (2), each built only if it measures more than 10%
better, then (1) as a row of its own if the worst hole is still over a
second. All three together are about 5 s of 14.5. That would bring the
worst hole near a second, not well under it, so E103's "under a second"
needs (1) and probably a cut in the modes as well.

## I193: typing the library only where a program reaches it

Since I193a, the library's check is kept on disk and read back in about
0.25 s. What is left for I193 is:

- the first process after any change under src/, which takes 1.4 s;
- R10 §2, a todo test that counts typed nodes: 40,000 of 43,500 for a main
  that prints one text.

Both need the library's bodies typed only when something asks for them.

`reachedFrom` (scalar.ts) from a program's own definitions reaches 1,467
to 1,734 nodes of 44,000 (93 to 101 of 818 definitions) for wc, physics
and collatz. That is about 4%, before the implementations that types pick.
Every library definition is pinned (signatures.ts), so its callers can
take its scheme from the pin without typing its body. The design:

- **The library's schemes come from its pins.** A program's check layers
  over a library "check" that is only the pins as schemes. That is a few
  milliseconds to build and needs no file on disk.
- **A body is typed when its per-node facts are asked for.** The compilers,
  `opAt` and the modes ask for `typeOf`, `opAt` and `reshape` at a library
  node. Typing that definition's group then fills its part of the layer.
  The layer is an OverMap, so "asked for" can be a miss in the layer's
  lookup.
- **What must stay whole-library:** the implementations table, which is
  built from the implementations' pins and not their bodies, and the
  library's own errors. Those are checked once by the library's own test,
  not by every program.

This touches every reader of `info.typeOf` for library nodes, so it has the
widest reach in this note. The disk store already gives the time savings
whenever src/ hasn't changed, so this mainly pays for the first run after an
edit and for R10 §2. Build it as I193's next step only if Ersagun wants R10
§2 closed. Otherwise leave I193 as it is.

## Prior art

As CHECK-BY-GROUP-2026-11-03.md credits it: Unison, Salsa, Adapton, GHC's
interface fingerprints, and "Build systems à la carte". Typing a module's
bodies lazily from its interface is how separate compilation reads an
interface file (OCaml's .cmi, GHC's .hi).
