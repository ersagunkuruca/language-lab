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
