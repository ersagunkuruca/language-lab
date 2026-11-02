# A field several cases share

Design note for BACKLOG L168, from
[REVIEW-2026-11-02d](../../reports/reviews/REVIEW-2026-11-02d.md) §2.
Written 2026-11-02 by the Language lane. Steps 1 and 2 are built (L168;
set takes the shared field alone, not a path through it yet); the
editor's half is next.

## The problem

machine's `Instr` has 21 cases, and six of them (`jump`, `jz`, `jnz`,
`jlt`, `jeq`, `call`) say where to go in a field each calls `to`. Four
definitions read or replace that field, and each is a six-arm match:

```
targets(code) = flat map(code, (i) ↦
  match i
    jump(to) → [to]   jz(a, to) → [to]   jnz(a, to) → [to]
    jlt(a, b, to) → [to]   jeq(a, b, to) → [to]   call(to) → [to]
    otherwise → nil)
```

board's `Timer` is `idle | running(id, left) | paused(id, left)`, and
`timer id` and `running id` are the same shape. Today `i.to` is refused:
"to belongs to one case of Instr; use a match to reach it" (infer.ts).

## What "the same field" means

A field is a node with an id, and names are only how it's shown. So two
cases' `to` fields are two nodes, and nothing says they are the same
thing. Three ways to say it:

1. **Same name, same type.** Rejected: it makes a name carry meaning, and
   renaming one case's field would silently change what `i.to` reads.
2. **A field of the whole type**, declared once on the typedef and present
   in every case. Rejected for this problem: `to` is in six cases of 21,
   not all of them.
3. **Sharing by identity.** Recommended. The cases say, by id, that
   their field is the same one, so renaming it renames it in every case,
   and a case that wants a different `to` simply doesn't say so. Two ways
   to write that in the model:
   - *one field node listed by several variants.* The simplest to state,
     but the program stops being a tree: `subtree`, hashing
     (`src/hash.ts`), copying a definition, the editor's layout and
     deleting a case all assume each node has one parent.
   - *each case keeps its own field node, and it may name another case's
     field as the one it is* (`same: <field id>`, like a ref). The tree
     stays a tree; a read `i.to` refers to the first case's field, and
     the others point at it. This is the recommendation.

A field's position can differ per case (`to` is first in `jump` and
third in `jlt`), which either way is the case's own.

## What it means

- **Reading.** `i.to` has the field's type. When every case of the type
  lists the field, the read is total (a record's field is the case of
  one). Otherwise it has `Choice`: no answer on a case without it, which
  is LANGUAGE.md's "pattern matching by choice". So
  `targets(code) = flat map(code, (i) ↦ first([i.to], else nil))`.
- **Setting.** `set((i) ↦ i.to, instr, x)` is the instruction with its
  `to` changed, and has no answer on a case without it. A path through
  a shared field (`(i) ↦ i.to.value`) is the same. machine's `threaded`
  and `moved` become one line each, under a `first`.
- **Building.** Each case still builds with all its own fields, in its
  own order: `jz(a, to)`. Nothing changes in a match either: an arm binds
  the case's fields, shared or not.
- **The editor.** Adding a field to a case offers "the same field as
  another case has" beside a new one (Editor lane's row, once this is
  in). A shared field shows as itself in each case it's in.

## How it runs

As L162b's `fields mapped` and L167's several-field `set` do, a code →
code pass writes it out before anything runs, so the evaluator,
relate.ts and every compiler target see what they already run. A read
`x.to` on a type with several cases becomes a call of a generated
definition, one per (type, field):

```
to of Instr(i) = match i
  jump(to) → to   jz(a, to) → to   …   call(to) → to
  otherwise → fail()
```

and `set` through it becomes the generated match that rebuilds the case
with that field replaced. The checker types the read before the pass:
the field's type, with `Choice` unless every case lists the field.

## Steps

1. The model and checker: a variant's field may name, as the field it
   is, a field of another case of the same type (never another type's).
   A saved program with no shared field is unchanged.
2. The read and the set, as the pass above, with tests evaluated and
   compiled, and machine's four matches and board's `timer id` as the
   proof.
3. The editor's half: share a field when adding one to a case (a row for
   the Editor lane).

## Prior art

Haskell's record fields across constructors: a selector shared by several
constructors works on those and throws on the others (partial). Here the
others have no answer, so the caller handles it, as with any `Choice`.
OCaml's inline records and Rust's enum variants keep each case's fields
apart, as the language does today. Sharing by identity rather than by
name follows the project's rule that names are only shown
(STABLE-REFERENCES.md).
