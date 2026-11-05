# Checking per definition group, cached by hash (L183)

Design note, 2026-11-03. BACKLOG L183, from FOUNDATIONS-2026-11-03 §9.
Waited on L178 (a hash that covers what a definition means), which is done.

## The problem

Each edit in the editor checks the whole program. Each speed-up so far has
removed one repeated whole check: I157 (+ New definition, 3 to 5 s), I158
(opening a definition, 1 to 2 s), E103 (holes in a definition run
backwards), E200. The freezes come back because the next feature adds
another caller of `infer`, which has 89 callers in 30 files, and most of
them check everything.

What exists already: `infer(code, names, { from, only })` rechecks the
definitions in `only` and takes the others' schemes from an earlier check.
The palette and `signatures.ts` use it. But the caller has to know what
`only` is. Nothing remembers a result across edits, and a definition's
dependents are rechecked even when its type didn't change.

## The idea

A definition group (one definition, or a mutually recursive group, the SCCs
`infer` already finds) has the same check result whenever two things are
the same:

1. **what its definitions mean**: their hashes (L178), and
2. **what it sees of the rest**: the schemes of the definitions it calls,
   the implementations it may use, and the check's options (pins, hidden,
   library).

So the result is cached under the key `hash(group's hashes, dependencies'
schemes printed canonically, implementations it needs, options)`. Because
the key holds the dependencies' schemes, not their code, an edit that
keeps a definition's type stops there: its callers' keys don't change and
they aren't rechecked. That is "early cutoff" in build-system terms.

An edit inside one definition of a 150-definition program then checks that
definition's group, and its callers only if its type changed.

## What a cached result holds

Everything `Info` gets from one group, in a form that doesn't depend on
the run that made it:

- each definition's scheme, divergent flag and `answered`;
- the types of the group's own nodes, closed: zonked, then their remaining
  variables renumbered from 0. Copying a result in renumbers them into the
  current check's `Subst`;
- the errors at the group's nodes;
- what arith.ts and the compilers read per node: `opAt`, `spread`,
  `reshape`, holes' expected types and rows;
- the implementation keys the group wanted (checked against the program's
  table at the end, as today).

## The parts that are per program

Not everything `infer` does is per group. Each needs its own answer:

- **Typedefs** (positivity, owners): checked per typedef group, cached by
  the typedefs' hashes, the same way.
- **The implementations table**: built from every implementation. It is
  part of the key only through the keys each group needs, so adding an
  implementation rechecks only the groups that wanted that interface.
- **Units** (`unitProblems`): per definition, like the types. Their input is
  already a `UnitsBefore` for that reason. They go in the group's result.
- **Modes, directions, termination**: already per group or per use. They go
  in the result.
- **Checks across groups** (an unused private constructor, the program's own
  `main`): run each time. They are cheap, because they read results and
  don't infer.

## Where it lives

A `Checker` holds the cache: `checker.check(code, names, opts)` returns an
`Info` as `infer` does. The editor keeps one per open program, and the
palette's rechecks go through the same one, so a filling the palette tried
is a hit when the user picks it. The cache is bounded (least recently used,
by node count), and a library is loaded once and its groups are hits from
then on.

`infer` keeps its signature and becomes `new Checker().check(...)`, so its
other callers change nothing and get the cache only when they keep a
checker.

## Risks

- **A result that depends on something outside its key** would be a wrong
  answer, not a slow one. Every input to a group's check has to be in the
  key. The test is a randomized one: random edits to the examples, each
  checked with the cache and from scratch, the two Infos compared.
- **Variable numbering.** Closed results are renumbered on the way in, so
  no two groups share a variable by accident.
- **Errors reported away from their cause.** An error is reported at a node
  of the group whose check found it. A caller that breaks because a callee
  changed type is rechecked, because its key changed.

## Steps

Row L215, one PR each:

- (a) Closed group results and their keys, with the randomized test.
  Done (L215a): ters/src/lang/check-cache.ts, `infer(..., { cache })`.
  As built, the key holds the group's nodes (with their ids, since the
  results are by node), not their hashes, and every value definition's
  nodes stand in for "the implementations it needs" (an implementation or
  embedding is a value), so an edit to a value rechecks everything. Not
  kept: a group with a problem or a hole, one that runs a definition
  backwards (its modes are the callee's body's), definitions with results
  or directions, and a group sharing a type variable with another.
  `reuse` stays until (d).
- (c1) Done: only the values written as an implementation's or an
  embedding's record are in every group's key; other values are groups
  like the rest, so a constant's edit rechecks only what reads it
  (Constructions 370 to 100 ms an edit).
- (c2) Done: a definition's nodes in a key are a number standing for
  their text, answered from the node objects it was last asked with, and
  a program on its layer isn't walked for layer nodes gone when every one
  is there (Spacetime about 11 ms less an edit, Physics and Constructions
  2 to 3).
- (c3) Done: what the checker asks the modes analysis of a published
  definition given only published functions is kept between programs,
  so an edit's check makes no analyzer of the program just to read it
  (Spacetime about 98 to 82 ms an edit).
- (b) The `Checker` cache in the editor's edit path, timed on I157 and
  I158's steps and on a one-character edit in Constructions.
- (c) Typedef groups and the per-program parts above in the cache.
- (d) `reuse` removed, its callers moved to a `Checker`.

## Credits (prior art)

- Unison checks and stores each definition by the hash of what it means,
  so an unchanged definition is never rechecked. This is the closest prior
  art.
- Salsa (rust-analyzer's query engine) and Adapton (Hammer, Phang, Hicks
  and Foster, PLDI 2014) for incremental queries.
- GHC's recompilation avoidance, which compares interface fingerprints, for
  "a dependency whose type didn't change doesn't recheck its users".
- Mokhov, Mitchell and Peyton Jones, "Build systems à la carte" (ICFP
  2018), for early cutoff.
