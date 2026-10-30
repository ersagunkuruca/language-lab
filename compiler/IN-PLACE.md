# Values changed in place when nobody else holds them

A design note for BACKLOG C56 (projectional/STABLE-REFERENCES.md §3) and
GAPS.md M6. It is written 2026-10-29, after round 5 (routes) and M1 to M4.
It decides the order of the steps and what each one must measure. Nothing
here changes the language. **Status (2026-10-30):** not built; steps are
BACKLOG C62 and C63.

## The rule

Every value is immutable as far as a program can tell. `put(m, k, v)` gives
a new map, and `m` is still there for whoever holds it. If nobody holds `m`
any more, nobody can tell whether `put` copied it or changed it, so the
compiler may change it. Ersagun's rule (2026-10-29) is that this stays
invisible: no annotations, no uniqueness in the types, no hints. A copy the
compiler couldn't avoid makes the program slower, never wrong.

That rules out Clean's uniqueness types, linear Haskell's arrows and Rust's
ownership: they work, but they put the representation in the language. What
fits is what Koka, Lean and Roc do, deciding it from the program: Perceus
(Reinking, Xie, de Moura and Leijen, PLDI 2021), "functional but in place"
(Lorenzen, Leijen and Swierstra, ICFP 2023), and Lean 4's reset and reuse
(Ullrich and de Moura, IFL 2019). Swift's copy on write
(`isKnownUniquelyReferenced`) is the same idea, checked at run time.

## What exists already

- **JavaScript, lists (G25).** A list cell is *owned* where the code at hand
  holds the only reference to it: a fold's accumulator, a fresh cons, what
  an `$own` copy returns. A definition whose list parameter is matched and
  used at most once gets an `$own` copy, and there a cons built in an arm
  that no longer needs the matched cell reuses it. This is decided when the
  program is compiled, and nothing is counted at run time. ledger's
  `add to` and `insert` change their totals this way.
- **JavaScript, arrays (C30, G21).** A list that is only walked, or only
  consed onto at one end, is an array, and `$into` copies write into one.
- **C (N5b, N5c).** Cells have reference counts. An arm whose cell has a
  count of 1 moves the fields out, and a new cell of the same size takes
  its memory. This works for any case, so the trees' `bin` nodes are already
  reused in C when nobody else holds them.

## Where routes spends its time now

This is compiled JavaScript on the trees, 3000 towns, after M4, profiled
over eight runs:

| | share |
|---|---|
| `tree value at` (looking up a town's best distance) | 27% |
| `settle`, the loop itself | 16% |
| building tree nodes (`balance`, `add`, `put`, `remove`, `node`) | 20% |
| garbage collection | 8% |
| comparing keys | 2% |

The ideal (routes.ideal.js) uses a JS Map changed in place: one hash per
lookup and one change per put. It is 16× faster. The persistent tree pays
twice: log n compares on every lookup, and log n new nodes on every change.
Reusing the nodes in place (step 1) only takes on the second, which is
about 28% with the GC. The lookups need a table (step 2).

In routes every map and set has one holder. `settle`, `shortest` and
`cheapest` each pass their search state (`frontier`, `found`) to the next
step and never look at the old one again. So every change could be done in
place, and a table could hold `found`.

## The steps

Each one is a PR or two, and each must measure more than 10% on a program
that has the pattern, or it isn't built (the coordinator's rule).

### 1. Owned cases of any type, in JavaScript (G25 for every type)

G25's `$own` copies, generalised from list cells to the cells of any
case. A parameter that is matched once and used at most once on each path
gets the `$own` copy. Where an arm builds a case with as many fields as the
matched one, and the path doesn't use the matched cell again, the new case
is written into the old cell. For the trees this is `tree put`, `set tree
add` and `remove` along the path they copy today. Their `balance` and
`node` take the parts of an owned node and give back an owned one.

Ownership has to reach the program's own code too. A record field read
from an owned record is owned when the record isn't used again: `s4.fields[1]`
in `improve`, after which `s4` is rebuilt. That is the same "used at most
once on this path" count, applied to a field instead of a whole parameter.

*What it should buy:* most of the 20% of node building, and part of the GC.
*Test:* a program that keeps an old version of a map and prints both
versions gets the definition's answer. That checks the analysis never
reuses a cell somebody still holds. ledger and routes print the same, and
the routes bench measures the gain.

### 2. A table changed in place, as a representation of Map (and Set)

This is the "later representations" row in projectional/DATA-STRUCTURES.md.
It is a new row in LIBRARY.reps with a hash table as its type and the
sorted entries as its meaning. `equal`, `show` and `compare` go through the
meaning, as the trees' do (C47, C52). A fold or `entries of` sorts first, so
it costs n log n. Lookups, puts and removes cost 1.

Because it is changed in place, the chooser may take this row only for a
map that has one holder everywhere it is used. That means every value of
the type, in the program, comes from step 1's ownership. A map that is ever
shared, kept or compared to an older version keeps the tree. The chooser
already weighs costs per job (represent.ts `choose`). This adds a test
before the costs are weighed, like `keyed` and `generic` in library-reps.ts.

Keys need a hash that agrees with `equal`: `equal` is near on Float64s, so
a key type that holds a Float64 can't use this row (it keeps the tree). A
Text, an Int, or a record of those hashes field by field, in code compiled
at the key type as M4's `orderOf` does for `compare`.

*What it should buy:* the 27% of lookups and most of what's left of the
building. If it does, routes compiled comes within about 3× of the ideal.
*Test:* the same program that keeps an old version must not get the table.
A program that only builds and looks up gets it, and prints the same.

### 3. Records and cell contents (C56's other half)

STABLE-REFERENCES.md §1 makes a cell's write an edit at a path (L98). When
the cell is the only holder of its value, which it is unless a read kept
it, that edit can be done in place. The `setPath` copies in records.ts
become writes. This waits for L98's later steps, and for a program that
measures it: the reactive to-do list (L100) is the candidate.

### 4. Counting at run time, where the compiler can't tell

In C the counts exist (N5b), so steps 1 and 2 in C can fall back to
checking `rc == 1` when ownership isn't known, as Perceus does. JavaScript
has no counts, and adding them to every value would cost more than it
saves. In JavaScript a value whose ownership the compiler can't show is
copied, which is the definition's own behaviour. This is the only place
the two targets differ, and it's a hosting detail. The language's idea, a
value nobody else holds may be changed, is the same on both
(the two-landscapes rule).

## What this doesn't do

- **No Choice.** A search may run the rest twice, so a value held by a
  choice point has two futures. Definitions with Choice keep copying, as
  G25's do today. A search that wants speed gets the table only where the
  search's own state is rebuilt each step (routes' searches have no Choice).
- **No lambdas or handlers that may run more than once.** The same "counts
  as many" rule as G25's `usesOf`.
- **Nothing in the editor.** The evaluator keeps the definitions. Running
  in the editor stays the oracle the compiled code is checked against.

## M5, measured again

GAPS.md M5 (leaving the depth count out of the tree jobs) was measured
again after M4. Taking the count out of every tree job gave 648 and 727 ms
at 3000 towns, against 609 and 670 with it: within the noise. So it stays
unbuilt, and is looked at again after step 1, when the trees are a larger
share of the time.
