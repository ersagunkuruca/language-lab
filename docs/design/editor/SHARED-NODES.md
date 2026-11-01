# Offers that don't copy the program (design note, 2026-11-01)

**Status (2026-11-01).** BACKLOG E133. E133a (way 3 below) is built (#866); E133b too (this PR, "What E133b found" below). Asks
nothing of Ersagun: the choice below is internal and changes no
behaviour.

## The problem

A hole's palette asks, for each offer, "is the program still right with
this in the hole?" (infer.ts `fillings`). For most offers the type
answers that at once. Some need the filled program itself: a whole
check of the group and what depends on it, a comparison of the plans of
the group's solves, and of the directions of definitions with results.
Each of those builds the filled program with `fillHole`, which copies
every node (`{ ...code.nodes }`, about 10,000 with std and the prelude)
to change one.

Measured on physics `fall` (BACKLOG E103), a hole where `fall`'s own
solve is: 23 holes take 121 s in all, the worst 22 s. One of those 22 s:

| part | time |
|---|---|
| comparing the solves' plans per offer (`samePlans`: `planSolve`, `solveMode`) | 5.7 s |
| whole checks for offers whose plan changed (`recheck`) | 10.4 s |
| copying the program per offer (`fillHole`'s `adder`) | 4.3 s |
| the rest (type fits, directions) | ~1.5 s |

On physics `main` (I40, done in #846) the copying was small next to a
copied substitution per offer; `Subst.trial` fixed that by reading
through to the checker's substitution. The nodes are the same idea's
other half.

## Three ways

1. **A persistent map (HAMT) under `Code`.** Every edit shares all but a
   path. The right end state, and the largest change: 82 places iterate
   `Object.values(code.nodes)` or its kin and 51 spread it, in the
   checker, the editor and the CLI. Each would go through the map's own
   iteration. Months of churn for the palette alone; worth it only if
   undo, history or merge (SHARING.md) want it too.
2. **Read-through nodes.** `Object.create(code.nodes)` with the filling's
   few nodes as its own. Lookups work; every `Object.values` sees only
   the few, which is wrong in all 82 places. Rejected.
3. **One scratch copy per palette, edited and put back.** `fillings`
   copies the nodes once, and for each offer writes the filling's nodes
   into the copy, runs the checks on `{ nodes: scratch, defs }` (a new
   `Code` object each time), and takes them out again. Nothing outside
   `fillings` sees the scratch nodes after the call.

## The choice: 3, with two guards

Way 3 removes the 4.3 s and needs no change outside `fillings` and
`fillHole`, except where a cache is keyed by the nodes object rather than
by the `Code`: those would hand one offer's answer to the next. Today
that is `derive.ts` (`cache`, keyed by `code.nodes`) and `infer.ts`
`matchers` (the same). Each is either keyed by the `Code` (a new object
per offer) or skipped while a scratch is out:

- **Guard 1.** `fillHole` gets a `into?: Record<Id, Node>` option: given,
  it writes there and returns what to undo. Without it, it copies as now.
- **Guard 2.** The two caches above are keyed by the `Code`. A test
  fills two offers in turn on one scratch and checks the second's
  answers equal a fresh copy's.

## What it doesn't fix

The plan comparison and the whole checks are most of the time (16 of
22 s). They are E103's: a plan compared per offer could be keyed by what
the plan can see of the offer (its target's mode and arity), as the
whole check is keyed by what the group's types become. That is a
separate step, measured first, and stopped by the 10% rule like the
stages before it.

## Steps

| step | what | size |
|---|---|---|
| E133a | Way 3: the scratch copy in `fillings`, guards 1 and 2 | S |
| E133b | E103: the plan comparison keyed by what the plan sees of the offer | M |

## What E133b found

Measured first, on the same worst hole of physics `fall` (20 s after
E133a): the plan comparison was 6.2 s for 1,008 offers, and almost all of
it was not the comparing. `solveMode` builds an analyzer for each filled
program, and the analyzer starts by scanning every node (~10,000) to join
each variable's uses into one slot. Keying the comparison by the offer
would not have helped much: 399 of the 1,008 offers really do change a
plan (a call with holes for inputs makes `fall`'s search nondet), so each
needs its own answer.

So the analyzer of a filled program now starts from the slots of the
program it was filled from and scans only the filling's nodes
(`derivedFrom` in modes.ts, called by `fillings`). The plan comparison
went from 6.2 s to 0.85 s, the hole from 20 s to 12.7 s, and all 23 of fall's holes take 67 s (121 s before E133a), with the same 399
offers changing a plan. What's left is the whole checks of those 399
(`recheck`, mostly `infer` and `useDirections`), which is the next step if
it's worth one.

## E103c: one check for offers alike

Profiled on fall's next-worst hole after E133b: 973 of its ~1,000 whole
checks came from offers keyed by what they named (`|target`), so every
offer was its own key. The name was there for units, since what a call
does to them is the callee's own. Now a whole check is keyed by what the
offer makes of the group's types, and of its solves' plans where it
changes one; the check's unit errors are set apart, and each offer's
units are checked on their own (`unitProblems` over what depends on the
group, a few milliseconds). Measured on a busy machine: fall's 23 holes
from 80 s to 47 s in all, the worst from 16 s to 8 s, with the same offers
on every hole. What's left is the whole checks themselves, `infer` and
`useDirections`, about half each.

## E103d: lists, not scans

The next profile put half of a whole check in two loops over every node:
`useDirections` looking for solves, and the jobs check (L108) looking for
calls. A filled program is made from the program by a few nodes
(`derivedFrom`, now in model.ts), so `nodesWhere` lists what a loop wants
from the program's own list, scanned once, and the changed nodes.
`useDirections` marks what it returns as derived too. fall's 23 holes went
from 50 s to 30 s, the worst from 10.6 s to 4.2 s, with the same offers.

E103e: after E103d the unit checks were a third of a hole, and an offer
that was the first of its kind had its units checked twice, inside the
whole check and on their own. The whole check now leaves units out
(`noUnits`): 30 s to 23 s for the 23 holes, the worst 4.2 s to 3.7 s.

