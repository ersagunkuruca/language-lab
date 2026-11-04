# Waking only the readers a write concerns (C86 design, 2026-11-03)

**Measured (C86b, 2026-11-04; Ersagun agreed to (b)):** built as step 1
says, and checked on the fast set and board.test.ts (both green). Then
measured with bench-board.ts, the evaluator at 200 cards, best of three:

| | before | with tracked reads |
|---|---|---|
| a running frame | 19 ms | 8.8 ms |
| an add, per card | 11 ms | 33 to 40 ms |
| the whole session | 6.4 s | 10.4 to 12 s |

A frame is half as long, because a card's time is no longer read by the
columns. But every reader that still runs again (on an add, the list has
changed) now reads through a view per card it touches, and that costs
more than it saves. Three cheaper versions were tried: a view's places
taken from the view around it, views made once per place, and list cells
as plain objects instead of Proxies. They took the add from 82 ms to
33 ms, still 3× before. Step 2's gate says to stop there, so it isn't
merged. The patch is kept in the project files
(compiler-lane/c86b-tracked-reads.patch).

What would let it pass: (c), the compiler's own paths, which need no
views at run time; or views only where a reader reads a few places of a
big value (they cost per place read, and a column's filter reads every
card).

**Next (C162, Ersagun 2026-11-04):** (c), as the compile-time half of
STABLE-REFERENCES.md §2 ("the compiler picks the view only where a
watcher or formula reads"). L98's paths are the stable references, L99's
views find a reader's paths at run time, and C162 finds them at compile
time on the core IR, subscribing to them with no view.

C86 comes from GAPS round 8, B2. The board example keeps its whole state
in one cell. A running frame changes one card's time. An add appends one
card. Either way, every reader of the cell runs again: the three columns'
`shown cards`, their rows' matching, the counts, the tags and the history.
At 1,000 cards that is 1.6 ms a frame (ideal 0.01), and at 10,000 about
20 ms, more than a whole frame.

Two pieces are built:

- **C86a** (#1048): a write of a whole new value is compared with the old
  one once (cells.ts `differences`), and only readers of the places that
  differ wake.
- **L160**: a path to a list item by key (`item where`), so a handler can
  write one card's field.

That isn't enough, because board's readers read the whole value,
`read(state).board.cards`. A reader of the whole value wakes on any
change. The row notes the fix as a design call.

## C162: how the compiler finds the paths (2026-11-04)

Board on the core IR (bench-board.ts's `core` way since C137d19) shows
what the analysis has to follow. A column's formula reads `state`, takes
`.board.cards` and hands it to `shown cards`. That calls the library's
`filter` with a closure, `matches filter`, which reads a card's tags or
title. The progress view, the counts and `all tags` work the same way,
through `map`, `fold` and `filter`. So an analysis that gives up at a
closure finds nothing on board. It has to follow a known closure into
the function it's passed to.

**The analysis** runs on the core IR, after lowering, over every
`cells.read` whose cell holds data:

- A value has a source: a read site, or one of the function's inputs,
  and the steps taken from it. A field step is `f<i>`, a list's head is
  `*` (any item), and a list's tail is the list again.
- What a use needs: `get` and `field` take a step and need nothing. A
  `case` or `tag` on a list or a type with several cases needs that
  place *only*: its case, or the list's length, not what's inside.
  Anything else (an operation, a comparison, `show`, a host builtin, a
  value put into a new constructor, returned, or captured by a closure
  that's not followed) needs the whole value there, as a read at that
  place does today.
- A call passes its inputs' sources to the callee's summary: for each
  input, the places it needs, relative to the input. Summaries are found
  to a fixed point over the call graph (recursion over a list's tail
  reuses the same summary). Past 16 places, an input needs its whole
  value.
- A closure the code makes with a known function (core IR `closure`
  with `fn`) is followed where it's applied: the callee is summarised
  for that closure (one summary per function and closure-function
  input, so `filter` with `matches filter` and `filter` with
  `has tag` are summarised apart). A closure whose function isn't known
  there (one read from a field, given by the host) needs its inputs
  whole.
- At each read site, the places its value needs become the read's
  paths: `R.rt("cells.readPaths")(c, ["f0/f1/*/f4", "f0/f1/="])`.

**Cells** take a path with `*` (any item) and a path that ends at a
place *only* (`=`, a list's length or a case). cells.ts `write` compares
each difference with a reader's paths. A `*` matches any item. A
difference inside a place-only path doesn't wake the reader. The
evaluator and the editor's preview keep their whole reads (or L99's
views for `each`), which means the same at another speed.

**What this can't do alone.** A column's formula *returns* cards: the
ones its filter keeps. A returned value needs its whole value, so the
formula still wakes when a kept card's time changes, and runs its filter
over every card again. What it saves is the readers that don't hand
cards on: the counts, the progress bar, `all tags`, the history. To wake
only the card's row, the formula's answer would have to keep its parts
as places in `state` (a row of `each` reading card *i*'s time through
the formula). That is incremental computation, (d) above, or views for
the returned parts only. It is step 3, measured after step 2.

**Steps:**

1. Done (C162a): cells.ts paths with `*/` and a place-only `=`
   (`meets`), and `readPaths`, with tests on Cells alone
   (cell-paths.test.ts). No compiler change, nothing changes for the
   evaluator. A whole new value is compared with the old one
   (`differences`) only once a Cells knows how lists look (`shape`, set
   today by the first view `each` makes); step 2 gives it from the
   start on the core IR.
2. The analysis in compiler/src (a pass on CoreIR, no closures
   followed), `cells.readPaths` printed by core-js.ts. Then closures
   followed. Measured with bench-board.ts's `core` way at 1,000 cards, a
   running frame and an add, and board.test.ts's session checked to
   draw the same.
3. If the columns' formulas are still what a frame costs: a design call
   on the formula's returned parts, put to Ersagun.

Prior art: Svelte's compile-time dependencies, and the path analyses of
alias analysis (access paths, Landi and Ryder 1992). Following a closure
into the function it's passed to is 1-CFA (Shivers 1991), with summaries
per callee and closure.

## Options

**(a) Programs read by path.** board's views use `read at(state, path)`
and its handlers use `write at` with `item where`. Nothing in the
language or the runtime changes. But every page author has to know this,
the plain `read` stays the slow way, and a column's filter still reads
every card's column through the list, so it needs a path per card anyway.

**(b) A plain `read` inside a view or a formula is a tracked view.** L99's
tracked views already do this for `each`'s rows (Solid's stores, Ryan
Carniato): reading a field or a list's case through a view records that
place for the reader. Under (b), every reader works this way. A column's
filter that reads each card's `column` then wakes when a card's column
changes, and not when its time does.

The row's worry was that this "changes what every reader sees". A view
is the value *as it is now*, and a plain read is the value *as it was
read*. These differ only if a write happens between the read and the
use. Inside a view or a formula, that can't happen. A view's row
(std.ts PAGE_VIEW) has Cells to read but no Update, a formula can't
write, and a formula's answer is copied out of its views before it is
kept (cells.ts `plainOf`). So inside a reader, a tracked view and a plain
read give the same values, and the meaning is unchanged. Handlers, which
do write, keep plain reads.

**(c) The compiler works out the paths.** An analysis on the core IR
finds which parts of a read value a reader uses, and subscribes to those
paths, with no views at run time. It is the fastest compiled, but it
needs to follow a value into every function it's given to. The evaluator
and the editor's preview would wake more than compiled code does, which
is the same meaning at a different speed. It is a later optimisation of
(b), not a replacement.

**(d) Incremental computation** (self-adjusting computation, Acar 2005;
Adapton): each formula's own steps are remembered and redone only where
their inputs changed. This is the most general, and far more machinery
than board needs.

## Recommendation: (b), then (c) where views cost

(b) is L99's mechanism applied to every reader, not a new rule. The
reasoning above shows a program can't tell the difference, so this
needs no decision from Ersagun beyond a nod. If he wants plain reads
kept as snapshots anyway, (a) is what's left, and it is a lesson for
page authors.

Steps:

1. **cells.ts:** `read` of a cell with a shape (`lists.views`), from
   inside a formula or a watcher, gives a view (`this.view`, now used
   only by `each`). The places read are recorded as for rows. A reader
   that reads the whole value (shows it, compares it, hands it to the
   host) still wakes on every change, as now.
2. **Measure** with bench-board.ts: a running frame at 1,000 cards should
   drop from 1.6 ms toward the ideal's 0.01, and an add from 3.6 ms. The
   step stops if a view's reads cost more than they save on the editor's
   examples (the 10% rule).
3. **Compiled pages** use the same Cells (core-page.ts, page-runtime.ts),
   so they get (b) with no compiler change. A test runs board's
   fifteen-phase session on both and checks that the same parts ran
   again.
4. **(c) later:** on the core IR, where a reader's uses of a read value
   are all field reads and list matches in its own code, subscribe to the
   paths directly and skip the view.

Prior art: Solid's stores and `reconcile`, MobX's observable objects,
Vue 3's reactive proxies (all read-tracking through a view); Svelte's
compile-time dependencies for (c); Acar's self-adjusting computation and
Adapton for (d).
