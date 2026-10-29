# Several named results (BACKLOG L95)

Ersagun, 2026-10-28 ("Discuss multiple-output functions and polar"): polar
started as a relation with four ports and no direction, and became a Bool
predicate when networks and functions were made one kind of definition
(#41). It still runs in any direction, but getting two answers out takes
`solve polar(x = x, y = y) for length, angle`, or a function that returns a
Pair, which is nesting where we want adjacency. This note is how a
definition gets several results without a new kind of anything.

## The idea

A definition with results is a relation whose result ports are named. Its
meaning stays what it is today, a predicate over all its ports, so
`polar(x, y, length, angle)` is still true or false for four numbers. What
it adds is a declared direction: `length, angle` are what `polar` gives
when it's given `x, y`. A Bool predicate is the case with no results, and an
ordinary function is the case with one (its `result`). So everything stays
one system, as Ersagun asked ("everything is one system, no special node
kinds").

```
polar(x, y) → length, angle =
  x = length · cos(angle) and y = length · sin(angle)

‹quotient and remainder›(a, b) → q, r = a div b, a mod b
```

The second line is the same thing written for results that are computed
directly: `= e1, e2` is `q = e1 and r = e2`. Nothing else is new about the
definition.

## Using it

A use binds the results side by side, and the rest of the block sees them:

```
length, angle = polar(x, y)
  …length and angle here…
```

Underneath this is the `solve` node we already have, with the definition's
inputs given and its results bound, so the text is a new reading of an old
node, not a new node. The several results come from one solution, so they
always agree with each other (one `angle` with its own `length`).

Another direction is written by naming what's given, and the results are
the ports left over, in order:

```
x, y = polar(length = 1, angle = a)        -- cos a and sin a
```

A result nobody reads is written `_`, and the compiler drops the work for it
(C55): `_, y = polar(length = 1, angle = a)` is a plain `sin`.

## Types and effects

The checker works out the declared direction's mode the way it does for
any `solve` (modes.ts, MODES.md). Exactly one answer that can't fail is
pure, as `quotient and remainder` is. Several answers or possibly none is
`Choice`, as `polar` is (an angle is only known up to whole turns, and
`length` has two signs), with the canonical answer first, so `first` or a
`with` handler picks one. A declared direction that its inputs don't pin
down is an error at the definition ("polar's results can't all be found
from x, y: …"), so a use never finds that out.

Its signature reads as the direction it declares:

```
polar : (Float64, Float64) -[Choice]-> length: Float64, angle: Float64
```

## In the graph

One node with an output wire per result, the same node as any call (editor
lane). A wire left unconnected is a `_`.

## Compiled

As `solve` is compiled today. C55 then compiles each direction a program
uses as a function of its own and drops the results nobody reads, the way
Mercury compiles each mode.

## Prior art

- Mercury (Somogyi, Henderson, Conway, 1996) and Prolog: a predicate's
  argument modes, chosen per use; Mercury compiles each mode separately.
- Modelica and other equation-based languages: equations without
  direction, causality decided where they're used.
- Go, Lua and Common Lisp's multiple values: results side by side, not a
  tuple to take apart. Common Lisp also drops the values a caller ignores.
- Hardware description languages (Verilog, VHDL): a block with several
  named output ports.

## Steps

1. **L95a, built.** The definition's `results` (the model's def node lists
   which of its ports they are, in order); the checker checks the declared
   direction at the definition ("sum and difference's results can't all be
   found from d: it needs 1 more known port"), and a use is typed as any
   `solve` is; text renders the definition's header (`→ length, angle`)
   and a use that follows the declared direction as `length, angle =
   polar(x, y)`; the DSL builds both (`results`, `use`).
   examples/relations' polar and sum and difference declare theirs, so
   `to polar` and `split` read that way (test/results.test.ts). The
   signature line still shows the predicate's type; it reads as the
   direction in L95b.
2. **L95b, built.** Results computed directly: `= e1, e2` for a
   definition whose body is `r1 = e1 and r2 = e2` with no result inside an
   e; other directions written by naming what's given (`d, b = ‹sum and
   difference›(s = 10, a = 3)`); and the signature line read as the
   declared direction, with the effects the checker found for it
   (`Info.directions`).
3. **L95c (editor lane, Inbox I65).** The graph node's output wires, the
   palette and structural editing of results.
4. **C55 (compiler lane).** Each direction compiled on its own, unused
   results dropped.

Then L97 puts Trig behind polar, with L96 choosing how each is computed.
