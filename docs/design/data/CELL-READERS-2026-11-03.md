# Waking only the readers a write concerns (C86 design, 2026-11-03)

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
