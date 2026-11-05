# A printer read backwards as recursive descent (C110 step 1)

C110, step 4 of GRAMMARS-2026-11-02. calc's grammar is one printer,
`expression text(e, outer)`, and `inverse` of it is calc's parser (L70b).
Run by relate.ts it is a search. calc's `read expression` takes about
0.9 s for a 13-token line in the evaluator, and the compiled targets run
the same search, since modes.ts (compiler) writes out only det and semidet
modes and refuses a fold run backwards. This note says which printers can
instead be written out as recursive descent, and how binding strength
becomes precedence climbing. Steps 2 to 5 build it.

## Which printers read backwards as descent

A printer is a fold. Backwards it is an unfold: pick an arm, run its body
backwards, unfold the recursive parts. The pick is what makes it a search.
It is no search when the arm can be picked from the next character (after
spaces), that is, when the arms' **first sets** are disjoint (LL(1)):

| calc's arm | prints | first set |
|---|---|---|
| literal(v) | `show(v)` | a digit |
| variable(n) | `n` | a letter |
| negative(x) | `"-" ++ x(unary)` | `-` |
| binary(op, l, r) | `l(…) ++ spaced(op) ++ r(…)` | the first set of the whole fold |
| any arm in `optional parens` | `"(" ++ … ++ ")"` | also `(` |

The first set of an arm is found from its body's first piece: a literal
text gives its first character, `show` of a whole number gives the digits,
a name (a `Text` field) gives what the type's names may start with, a
recursive part gives the fold's own first set, and `spaced` and `optional
parens` add spaces and `(`. Anything else (a call of an unknown function,
a text built by a loop) has no first set, and the printer stays a search.

Two arms break LL(1) in calc, and both have a known shape:

- **`optional parens`** puts `(` in every arm's first set. Read backwards,
  `(` always starts a parenthesized expression read at strength 0, closed
  by `)`, and the arm is picked inside it. Since `optional parens` accepts
  extra parentheses (`((1))` reads as 1), no check of `outer` is needed on
  the way in; the arm that comes out is the one the inside picked.
- **binary** starts with its own left part, `l(strength(op))`: left
  recursion. Its first set is everything.

## Binding strength as precedence climbing

An arm that starts with a recursive part read at a strength, then a
token, then another recursive part, is an infix operator. Descent reads it
the way precedence climbing does:

```
expression(min):
  x ← primary            -- the arms that don't start with a recursive part
  loop: op ← the next operator, if strength(op) ≥ min, else stop
        y ← expression(strength(op) + right side(op))
        x ← binary(op, x, y)
  return x
```

`primary` is the LL(1) choice above (a digit, a letter, `-`, `(`). The
printer's own numbers say everything the loop needs: `strength(op)` is the
level, `outer > strength(op)` is where the printer wants parentheses, and
`right side(op)` is the associativity (`2 ^ 3 ^ 2` to the right, `1 - 2 -
3` to the left). The negative arm's `x(unary)` is the same rule for a
prefix operator. So the loop is found from the printer, not written as a
second grammar: the compiler matches the shape, and a printer that doesn't
match it stays a search.

Read this way, the answer is the one the search gives first, and the only
one: the printer's `outer > strength` test is what makes every reading of a
line unique (GRAMMARS "one more thing makes the answer unique"), and the
loop takes exactly the readings that test allows.

## Where it lives

In the compiler's mode pass (compiler/src/modes.ts), as a third kind of
mode beside det and semidet: a fold run backwards over text, with each
arm's first set. ters/src/lang/modes.ts keeps planning the mode as it does;
the descent is written out only when every arm has a first set and the
left-recursive arms match the infix shape. Otherwise the solve stays with
relate.ts, as now. Where a line stops making sense (L70c's `stuck`) is the
position descent fails at, with the first set it wanted there as "expected".

## Steps

- **s2** a check that names each arm's first set for a printer, and the
  arms whose sets overlap. A report only, tested on calc (the table above).
- **s3** descent written out for a printer with no left recursion:
  literal, variable, negative and `optional parens`, tested on a
  calc without binary.
- **s4** left recursion through binding strength (the loop above), on all
  of calc's grammar, tested against calc-grammar.test.ts's lines.
- **s5** calc's run line on it, measured against the 0.9 s; then the
  Language lane deletes calc's hand parser.

## What was built, and step 7: descent on every target

Steps 2 to 6 put descent where the line is read: compiler/src/core-solve.ts
for the core IR's JavaScript (s5) and ters/src/lang/run.ts `solveAnswers`
for the evaluator (s6), both through ters/src/lang/descent.ts, which
*interprets* the printer: it walks the printer's nodes for each line.
WebAssembly and C can't do that. They refuse any solve ("solves a relation,
not in this profile yet", scalar.ts), and they carry neither the printer's
nodes nor a TypeScript interpreter. So calc's run line can't move onto
`read expression` until it reads there too.

Step 7 writes the reader *as a definition in the language*, from the
printer, before any target lowers it. That is the same shape as
inverses.ts (a model-to-model pass, C137a), and every target then reads by
descent with no new runtime: what the printer's arms read becomes ordinary
Text operations C and WebAssembly already have (`length`, `code` and
`slice` of a Text, Int compares).

The written reader takes the text, a position, and the printer's other
inputs (calc's level), and gives `optional (position after, value)`:

- one definition for the primary arms, a match on the next character's
  class (the first sets, as descent.ts `starts`), each arm's pieces read in
  turn, a `none` where one fails;
- one for the infix loop (`Infix` in descent.ts), written as a recursion on
  the position and the left operand so far, its operators the literal arms
  of the printer's match on the operator and its levels evaluated from the
  printer's `lets`, as descent.ts evaluates them now;
- `spaced` and `optional parens` as two small prelude helpers written once
  over a position, rather than special cases in the pass.

`inverse(e ↦ F(e, …), y)` then becomes a call of the reader, with
"the whole line was read" checked, where inverses.ts now makes it a solve
on F. The evaluator and the core IR run the same definition, so
descent.ts's interpreter can go, along with core-solve.ts's `descended` and
run.ts's hook. Where a line stops (L70c) needs the furthest position, which
the written reader carries as a second result.

- **s7a** the pass writing the reader for calc's printer, with no infix
  arm (literal, variable, negative, parentheses), checked against
  descent.ts on descent.test.ts's lines.
- **s7b** the infix loop written too: every calc-grammar line and the 300
  random expressions read as descent.ts reads them.
- **s7c** inverse rewritten to the reader (inverses.ts), on the evaluator
  and the core IR; descent.ts, `descended` and run.ts's hook removed.
- **s7d** calc compiled to C and WebAssembly reading lines
  (c.test, wasm.test), and the stuck position as a second result.
- Then the Language lane moves calc's run line onto `read expression`
  and deletes the hand parser.

## JSON: one relation, written once, read leniently (L72e, 2026-11-05)

Descent now reads `json printed` backwards (L72b to L72d). That reads
only the text `json printed` writes: no spaces, a number as `show` writes
it, `\u0009` for a tab. `json read` accepts all of RFC 8259: whitespace
between tokens, `1.0`, `1e3`, `\t`, `\/`, surrogate pairs. So `json read`
can't simply become `json printed` run backwards. That would refuse
JSON every other program writes.

The language already has what the difference needs. A printer may give
several texts (a Choice), with the one it prints first. **`json spelled`**
is JSON's grammar as one relation: every text that spells a value, the
canonical one first. Then:

- `json printed(v) = first(json spelled(v))`: printing takes the first
  spelling;
- `json read(t)` = `json spelled` run backwards: any spelling reads.

Where a spelling has a choice, the piece says so, and the canonical
alternative comes first:

- `blank` between tokens: `""` first, then any run of spaces, tabs, line
  ends;
- a number: `show(x)` first, then any RFC 8259 number that reads to x
  (`read number`'s inverse, kept to the JSON number grammar);
- a character in a string: `json character(c)` first, then `\uXXXX` for
  any c, `\t` and the other short escapes, `\/` for `/`.

`optional parens` is already this kind of piece: it prints none where
none is needed and reads any number. These pieces are ordinary Choice
definitions in the prelude, not grammar operations named in relate.ts.

**What descent needs.** It must read a piece with several answers by
trying the alternatives in order, within the piece, the way a match's
arms are tried. A run of `blank` is read greedily, as `spaced` is. That
is the one new rule. The rest (lists between separators, a function of
one character, Float64 show) is built.

**The indented printer.** `json indented(v, n)` becomes one more choice
of blanks (a line end and `n` spaces a level), so `first` of a variant
of `json spelled` with that blank first. Its law with `json read` holds
by construction.

Steps: (e1) the pieces `blank` and the number and character
alternatives in the prelude, with `json spelled`; `json printed` as its
first spelling, the same text as today (hash moves via library/moved.json);
(e2) descent reads a Choice piece by its alternatives in order, and
blanks greedily; (f) `json read` as `json spelled` run backwards, its
error messages from L70c's "where it stopped", and the hand-written
reader (prelude-source.ts `json value` and the eight definitions under
it) deleted, with the JSON laws (T7e9, T7e11) as its test.
