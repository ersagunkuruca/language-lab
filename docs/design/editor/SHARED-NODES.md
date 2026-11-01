# Offers that don't copy the program (design note, 2026-11-01)

**Status (2026-11-01).** BACKLOG E133. E133a (way 3 below) is built (#866); E133b is open. Asks
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
