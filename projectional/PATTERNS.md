# Nested patterns: a view over nested matches

Design note for BACKLOG.md E61, which was L37 (LANGUAGE-REVIEW-2026-10-24.md §4).
Written 2026-10-24. The last section is the plan.

## The problem

There is one kind of match: one level of a value, one arm per case. So
reading four fields from a line takes five matches, and the same error
arm is written five times. Here is ledger's `parse` as the blocks text
draws it today:

```
parse(line, n) =
  match split(line, ",")
    nil → ‹bad line›(n)
    cons(date, ‹after date›) →
      match ‹after date›
        nil → ‹bad line›(n)
        cons(account, ‹after account›) →
          match ‹after account›
            nil → ‹bad line›(n)
            cons(cents, ‹after cents›) →
              match ‹after cents›
                nil → ‹bad line›(n)
                cons(memo, ‹after memo›) →
                  match ‹after memo›
                    nil → entry(date, account, amount(cents, n), memo)
                    cons(head, tail) → ‹bad line›(n)
```

What it means is two lines:

```
parse(line, n) =
  match split(line, ",")
    [date, account, cents, memo] → entry(date, account, amount(cents, n), memo)
    otherwise → ‹bad line›(n)
```

ledger's and chapters' `main` do the same with the command line, writing
the usage message twice. calc's tokenizer matches a list and then its
head in two steps.

## The decision: the tree stays nested; the views flatten it

Nested patterns are **not** added to the tree. A match stays one level of
one value. Running backwards (relate.ts), mode analysis (modes.ts), folds,
the checker's exhaustiveness and every compiler keep seeing exactly what
they see now. This is the same reason E59 draws a one-case match as a let
without a new node kind: the uniformity rule (one system, no special
nodes) holds, and the meaning hash of every program stays the same.

In fact, nested matches are what an ML compiler turns nested patterns
into: a decision tree (Maranget, "Compiling pattern matching to good
decision trees", ML Workshop 2008). The view runs that step in reverse,
from a decision tree back to rows of patterns. Wadler's views ("Views: a
way for pattern matching to cohabit with data abstraction", POPL 1987) are
the precedent for a pattern being a projection of the data rather than
its storage.

## Which matches are flattened

An arm's body is merged into its pattern only when both of these hold:

1. The body is a match (not a fold, not a handler, not an if on a Bool),
   and its scrutinee is one of that arm's own fields.
2. That field is read nowhere else: not in the inner match's arms, and
   not in its `otherwise`. If it were read elsewhere, the pattern would
   need an `as` name. That is left out until a program needs it (see
   "Not in the first step").
A name the user gave such a field disappears into the pattern. That is
the point: ‹after date› only named a position. Its binder is still in the
tree, and selecting that place in the pattern selects it.

Merging repeats down the chain, so ledger's five levels become one row
per leaf arm:

```
nil → ‹bad line›(n)
cons(date, nil) → ‹bad line›(n)
cons(date, cons(account, nil)) → ‹bad line›(n)
…
cons(date, cons(account, cons(cents, cons(memo, nil)))) → entry(…)
cons(date, cons(account, cons(cents, cons(memo, cons(head, tail))))) → ‹bad line›(n)
```

The rows of a decision tree are disjoint, so their order doesn't change
what they mean. An inner `otherwise` becomes a row with `_` in that
position, placed after its siblings, as it is in the tree. First match
wins, as it does everywhere in the language.

## Two more steps of drawing, both still views

**Lists as lists.** A pattern of `cons` ending in `nil` is drawn
`[date, account, cents, memo]`, as the value is. One ending in a variable
is drawn `[head, head₂, ..rest]`. The text already draws list values
this way (render.ts `listItems`).

**Rows that say the same thing become `otherwise`.** When several rows'
bodies are the same expression (equal by hash) and read none of their
own fields, they are drawn once, as the last row, `otherwise →
‹bad line›(n)`. That is only allowed when no row after them would be
shadowed by it. Since the rows are disjoint, moving the shared row to the
end is always safe. A row whose body reads its fields keeps its own line.

These are separate nodes in the tree, five copies of `‹bad line›(n)`.
Editing the shared row edits every copy: one change to the meaning, made
in five places, in one undo step. The inspector shows "the same in 5
places". This is the one part that touches editing, so it is the last
step.

## The graph

The graph draws the same rows: one match node whose ports are the
flattened patterns (`[date, account, cents, memo]`, `otherwise`), each
with its frame. A frame's parameters are every name in its pattern, so
`date`, `account`, `cents` and `memo` are wired from one frame's left
edge instead of from four nested frames. The ▸/▾ fold toggle on the match
switches between rows and the nested tree, for when you want to see the
decision order.

## Editing

- **Match deeper.** On a field in a pattern, "Split on it" (typed.ts
  `splitOn`, which exists) adds the inner match. In the view this is "match
  deeper": the field's place in the pattern opens into that type's cases.
- **Selecting.** A field in a pattern selects that binder. A row selects
  its leaf arm, and the arm's body is where the palette fills.
- **Removing a level.** A new "Join cases" on a row whose inner match has
  one row left puts its body back as the outer arm's body. That is the
  inverse of match deeper, and it is drawn as the pattern losing a level.

## Not in the first step

- `as` names (`cons(date, rest as ‹after date›)`), for a field that is both
  taken apart and read whole. No example needs it yet.
- Literal patterns (`"+"`, `0`). calc's `symbol(m) → m = "+"` would read
  better as `symbol("+")`, but that means flattening an `if` on equality.
  That is a different view, after this one.
- Or-patterns (`nil | cons(_, nil) → …`). The `otherwise` row covers the
  examples.

## Plan

One PR each:

1. **Text: flatten and draw lists.** Rules 1 and 2 in render.ts, `[a, b]`
   and `[a, ..rest]` patterns, an inner `otherwise` as `_`. Tests at the
   behaviour level: ledger's `parse` has one row that builds the entry,
   and every leaf arm of the tree appears as exactly one row (read back
   from the text, the rows' patterns are disjoint and cover the type).
2. **Text: shared bodies as `otherwise`.** Ledger's `parse` reads as two
   rows, and the mains as two or three.
3. **Graph: rows. Done.** One node with the flattened ports, each row's
   names on its frame's left. The match's menu switches between rows and
   the tree ("Draw as nested matches", layout.json `tree`), in place of a
   ▸/▾ toggle. Shared bodies aren't merged into one `otherwise` row in the
   graph: until step 4, a frame stands for one copy of a body.
4. **Editing a shared row** edits every copy, in one undo step. "Match
   deeper" and "Join cases" named in the menu.
