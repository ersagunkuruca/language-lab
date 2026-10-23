# Modes: the order of a backwards search, decided before it runs

Design note for BACKLOG.md L11 (REVIEW-2026-10-22b.md §3, REVIEW.md §1.2,
COMPILER.md stage 1b). Written 2026-10-23. The last section is the plan.

**Status.** Step 1 is built: `src/lang/modes.ts` gives the verdict for any
mode, and `test/modes.test.ts` checks it against what relate.ts does and
against the checker. Nothing uses it yet. As planned, `map` and `show
numbers` backwards end. Forward, the verdict agrees with the checker's
`Diverge` on every definition in the examples, leaving out the few that
call a function they were passed, since there it's that function's effect
row. Known is two levels for now (known or not). The third (the case known,
not the fields) waits for a program that needs it: today a projection run
backwards waits for its record.

## The problem

Running a function backwards (BACKWARDS.md) is a search, and the order of
its goals decides whether it ends. `one of([3])` asked for 5 went on
forever because `member` ran before the list literal had bound its list:
it made up lists containing 5, one longer each time (the classic
miniKanren goal-ordering divergence). The fix made `member` wait for its
list (PR "Backwards, one of waits for its list"). That fixed one goal, the way several others were fixed before it.

`relate.ts` now picks the order at run time, with one rule per place that
went wrong:

| rule | where | why it was added |
|---|---|---|
| lits, refs and lambdas first | `cheap`, `callGoal` | they never search |
| arguments that only use known values first | `computable` | `polynomial([-2, 0, 1], x)` unfolded its fold over every list before building this one |
| arguments that only wait go first when the call only waits | `waitsOnly`, `WAITING` | `text(show(n), " ", rest)` guessed every cut instead of cutting after a number |
| `a hence b`: b first | `S.hence`, `after.reverse()` | in `polar`, x² + y² = length² is the way in |
| value known: arguments after the call, else before | `callGoal` | information flows from what's known |
| match with a known value: arms before the scrutinee | `matchGoal` | the arm rebuilds the value examined |
| fold with an unknown result: parts before the body | `foldGoal` | same, for unfolding |
| `one of`, `first`, `all`, `count`, calls of unknown functions wait | `member`, `aggregate`, `apply` | a goal that would make things up waits instead |

Each rule is right, but they are separate special cases of one idea. What
none of them can do is say, before the search runs, whether it ends.
That is why every relational `solve` is typed `Choice`, and `Diverge` too
whenever anything it reaches folds or recurses (`mayLoop` in `solve.ts`).
`Diverge` is often a false alarm. In `examples/backwards`, `map` solved
for its list from a known result, and `show numbers` read back from text,
both carry `Diverge` and both always end: each step takes apart the known
result, which gets smaller.

## The idea

A **mode** is a definition together with the set of its ports that are
known: its parameters and its result, `out`. Forward evaluation is the
mode where every parameter is known and `out` isn't. A `solve` node names
its mode where it is written (`given` and `binds`), so every mode a
program uses is known statically. Mercury's mode analysis works the same
way (Somogyi, Henderson and Conway, "The execution algorithm of Mercury",
JLP 1996). We infer modes instead of asking for declarations, because the
`solve` nodes already say them.

For each mode the analysis answers three questions:

1. **Order.** In which order do the body's goals run, so that each runs
   when what it needs is known? The result is a **schedule**, the solver's
   one-unknown rule lifted from equations to calls.
2. **Answers.** How many answers can there be: exactly one, at most one,
   at least one, or any number? These are Mercury's determinism
   categories (`det`, `semidet`, `multi`, `nondet`).
3. **Ending.** Does the search end in this mode? This is the size-change
   check the checker already runs for forward totality (`infer.ts`, Lee,
   Jones and Ben-Amram, POPL 2001), with the known ports as the measured
   arguments in place of the parameters.

### What is known: three levels

A port or a node's value is **free** (nothing known), **shaped** (which
case it is, such as "a `cons`", with its fields at their own levels), or
**ground** (all known). Two levels aren't enough: when `map`'s result is
known, its list is shaped all the way down while each element is still
free. Mercury tracks a whole tree of these; three levels with nested
fields is the same thing kept small.

### One rule per node kind, read statically

The rules are the table in BACKWARDS.md, "Every node, backwards", read as
what each node needs and what it gives:

| node | needs | gives | answers |
|---|---|---|---|
| constructor | its fields, or its value shaped | the other side | one |
| projection | the record, or the field (builds the record) | the other side | one |
| arithmetic | all ports but one (or a block the solver plans) | the last port | the solver's plan says |
| `join text` | the result, or both parts | the rest | finitely many cuts |
| `show` | the number, or the text | the other | at most one |
| `equal` true | either side | the other | one |
| `less`, `equal` false | both sides | nothing | at most one |
| `one of` | the list | the element | finitely many |
| `first`, `all`, `count` | their action, ground | the result | one |
| match | the scrutinee shaped, or the result (then each arm is a choice) | the arm's binders | one arm, or a choice of arms |
| fold | the scrutinee, or the result (unfold) | the parts | per arm, as match |
| call of a known definition | whatever its own mode needs | its other ports | its mode's |
| call of a function value | the function ground | as the function's mode | as the function's mode |

Scheduling is then a topological order of the body's data flow. A goal is
ready when what it needs is known. Among ready goals, those with one
answer go first, then those with at most one, then finite choices, then
the rest. That ordering on its own reproduces every rule in the first
table. If no goal is ready, the mode is **stuck**: the direction needs
something nobody gives, and it is a checked error at the `solve` node,
naming the goal ("solving `f` for `x` needs `y`, which nothing here
gives"). Today that shows up at run time as a residual wait or a search
that never ends.

### Ending, per mode

A search can run forever in two ways: a recursion whose measured argument
doesn't shrink, or a choice that is infinite (every list, every `2πk`).
The second is already known per goal: the "answers" column. For the
first, the size-change graphs are built as now, with one change: sizes
flow through constructors **both ways**. Taking apart a known value gives
strictly smaller parts, which is what makes `map` backwards end: the
recursive call's `out` is the tail of a known `out`. A mode ends when
every cycle of calls has a known port that strictly decreases, and every
choice on the way is finite. Numbers don't count as decreasing, as in
the forward check.

Termination analysis of logic programs per query mode is prior art:
TermiLog (Lindenstrauss and Sagiv, ICLP 1997) and cTI (Mesnard and Neumerkel, SAS 2001)
measure the bound arguments in the same way.

### Where it can't decide

Some orders depend on values: a call of a function value whose function
is only known at run time, or `hence` whose way in depends on which
equations close. There the schedule says **dynamic** for that goal, and
`relate.ts` keeps its run-time waits for it, as Mercury links its runtime
where its analysis gives up. A mode with a dynamic goal on a cycle keeps
`Diverge`. That's the same answer as today, so nothing gets worse.

## What it changes

- **Types.** A relational `solve` gets `Choice` only when its mode isn't
  `det`, and `Diverge` only when its mode isn't proven to end. `map` and
  `show numbers` backwards in `examples/backwards` lose `Diverge`
  (predicted, to be checked by the first PR). A stuck mode is an error
  before the program runs.
- **`relate.ts`.** The interpreter follows the schedule instead of the
  rules in the first table, which are deleted. `cheap`, `computable`,
  `waitsOnly`, `WAITING` and the `hence` reversal go. The search
  (streams, unification, the solver's equations) stays as it is.
- **The compiler** (lane C, COMPILER.md stage 1b). A `det` or `semidet`
  mode with no dynamic goals is a forward function in disguise. It
  compiles like one, instead of calling `relate.ts` at run time.
- **The editor** (lane E). A `solve` node can say what its direction is,
  in words: "ends, at most one answer", or "may not end: `parse` calls
  itself on something that isn't smaller". It's the same fact the type
  carries.

## Decisions

- **Inferred, not declared.** Mercury asks for mode declarations. Here
  the `solve` node already says which ports are known, so asking again
  would be a second place to say the same thing.
- **One analysis for both directions.** Forward is the mode "parameters
  known". The forward totality check becomes the special case of the
  per-mode check, rather than a second checker.
- **Coarse first.** Three levels of known, not Mercury's full
  instantiation trees. Unique modes (destructive update) and mode
  polymorphism are out of scope.
- **No behaviour change in step one.** The analysis first runs alongside
  the interpreter and reports, so its verdicts can be checked against
  what the search actually does before anything depends on them.

## Plan

One PR each, in this order:

1. **L11a `modes.ts`: analysis and report.** Schedule, answers and
   ending for every mode a `solve` node uses. A test runs it over every
   example and the backwards tests and compares with what the
   interpreter does: a mode said to end must end within its budget, and
   a `det` mode must give exactly one answer. No behaviour change.
2. **L11b Types from modes.** `infer.ts` takes `Choice` and `Diverge` for
   a relational `solve` from its mode, and reports stuck modes. The error
   table in LANGUAGE.md gets a row.
3. **L11c `relate.ts` follows the schedule.** The rules in the first
   table are deleted. Every backwards test and example gives the same
   answers. Where the order of answers changes, the test lists it.
4. **Lane C: compile `det` and `semidet` modes** as plain functions.
5. **Lane E: the `solve` node says its mode** in the editor.

Credits for this design: Mercury (influence, already in CREDITS.md),
size-change termination (adapted, already in CREDITS.md), and TermiLog
and cTI (prior art, added to CREDITS.md with this note).
