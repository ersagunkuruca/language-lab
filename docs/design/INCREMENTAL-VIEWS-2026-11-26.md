# Incremental lists in a page's views (C354)

Ersagun picked "build it in steps" on 2026-11-26 (22:44 UTC). This is
the plan the steps follow. Every page keeps its meaning: a view still
gives what it gave when it ran again.

## What an add costs now

board at 2000 cards, `node compiler/gaps/bench-board.ts 2000`: adding a
card is 1.2 ms against the ideal's 0.02 ms. Counted per add at 1000 cards
(cells.ts `recompute` by label), each add runs these again:

- 3 parts, one per stage column, about 0.36 ms between them. All three
  read the board's cards, though only one column gains a card.
- 33 texts, 17 classes, 1 style, 3 formulas and 1 `each`.

Profiled at 2000 cards, the 2.3 s of adds are about:

- 0.9 s of the program's own view code over every card: `at stage` and
  `shown cards` (`keep`), `points of cards` (`sum(map(…))`), and
  `filter bar` (the tags, with flatten and reverse).
- 1.3 s of the page runtime matching new lists against old. cells.ts
  `inserted` and `differences` walk both lists, and html.ts `redrawn`
  mounts every kid. These are already pointer walks (C287).

## What is there already

- A write that puts an item into a cell's list carries an edit:
  `{ kind: "insert", i }` (cells.ts `Edit`, `inserted`).
- `each` and `each of` (cells.ts `mapRows`) follow those edits. A row per
  item is made once and kept while its item stays (Solid's `mapArray`),
  and a formula's observers get the edits it saw (`o.edits`, the `grown`
  path in `recompute`).
- html.ts draws a kept row's node again where it was (`KEPT`, `drawn`).

What isn't there yet: the list functions a view calls (`keep`, `map`,
`sum`, `length`, `flatten`) run as plain compiled code over the whole
list each time, so the edits stop at the first one.

## Steps

1. **keep and map follow edits.** Two new cells.ts operators beside
   `each of`:
   - `keep of(list, test)`: a row per item holding `test(item)`. Its value
     is the kept items in order. An insert makes one row; the item goes
     in among the kept ones at its place, and the operator passes on an
     edit of the kept list.
   - `map of(list, f)`: `each of` with the edits passed on.

   In a page, a call of the prelude's `keep` or `map` whose list is read
   from a cell (a view of one, as `each of` takes) is lowered to these.
   This holds where the function given only computes, and a view's
   functions do: a view only reads. board's `at stage` and `shown cards`
   then call their test once per new card, not once per card.
   Measure: board at 2000 cards, adds and the whole session. Target:
   the 0.9 s of view code, the keep half of it.
2. **sum and length follow inserts.** `sum of` keeps its total and adds
   the new row's value. That is exact for Int and Rational, so those come
   first. A Float64 sum is the same in-order sum only when the item goes
   in at the end (sums stay in order by default, Ersagun 11-26). An insert
   anywhere else adds it all again. `length` adds one.
3. **The runtime takes the edits.** A part whose list came from step 1's
   operators gets its edits: html.ts `redrawn` puts in one row instead of
   mounting every kid, and cells.ts skips `inserted` and `differences`
   for a list whose edits it already has. This is the 1.3 s.
4. **flatten and the rest**, as the gaps benches ask (board's tags).

Each step is its own PR and is measured. A step that doesn't reach 10% on
board or another page bench is reported and closed, not merged.

## Measured, 2026-11-26 night

Step 1 was tried and is closed, not merged, under the rule above.

- **Step 1 as a memo.** keep, map and flat map kept their last answers
  with their list and closure (code and captures), and a list with items
  put on its end was worked out for those items alone. It fired on board:
  most calls were hits or grew by one card. It gave 0% at 2000 cards. The
  walk to find where the old list ends, and the copy of the kept cells
  before the new one, cost what the tests did. board's tests are a stage
  compared and a filter that is `everything`, so the test was never the
  cost; the cons cells were.
- **Where an add goes**, profiled alone at 2000 cards: the views' own code
  about 35%, html.ts about 25%, the `each` matching rows about 17%, GC
  about 25%. The view code is spread over about eight views, each O(cards)
  in list cells walked and made, not in calls.
- **Step 3's html half as a redraw in place.** A part whose new value has
  the same shape keeps its element and its texts, watches their
  attributes and texts again, and puts in only the children that changed.
  html.ts time per add went down by about a quarter. The whole add was the
  same within noise (about ±10% between runs on this machine).

So steps 1 to 3 as planned don't take board's add under O(cards): what is
left is the walk and copy of cons cells in every view, which is the
section below. The patches are kept in the Compiler lane's scratch.

## What stays O(n)

A list in a view is a cons list, so a new list with one more item past
the front copies the cells before it. After step 1 that is a walk of
pointers, with no test or closure called per item. To go under that, the
lists a view holds would be another representation (an array or tree
stored for the list, as the list chooser picks elsewhere). That is a
later step, if the measures after step 3 ask for it.

## Prior art

- Umut Acar, *Self-Adjusting Computation*, PhD thesis, Carnegie Mellon
  University, 2005; Acar, Blelloch and Harper, "Adaptive Functional
  Programming", POPL 2002: a run's dependences kept, and a change
  propagated through them.
- Ashish Gupta and Inderpal Singh Mumick, "Maintenance of Materialized
  Views: Problems, Techniques, and Applications", IEEE Data Engineering
  Bulletin, 1995: a query's answer updated from the rows inserted, per
  operator (select, project, sum).
- Solid's `mapArray` (Ryan Carniato), which cells.ts `each` already
  follows.
