# A representation per group of values, not per type (C93 step 1)

C93: machine still stores its lists as trees. The chooser (ters
represent.ts `choose`) picks one representation for each type over the
whole program, from every job the program does on it. machine does two
things with `List`:

- **builds**: the assembler (`items of`, `labels of`, `resolved`,
  `optimized`) conses lines on and appends passes' output, once per run;
- **reads by position**: the step loop (`executed`, `stepped`, `loaded`,
  `stored`, `set register`) reads `code`, the registers and memory with
  `item at`, and writes them with `replace at`, once per step.

Cons lists read in n, arrays append in n, trees do both in log n, so
trees win for the program as one. An array for what the loop reads and a
cons list for what the assembler builds would take primes 20000 from
0.47 s to about 0.11 s (measured by hand-editing the output, GAPS round 9).

## What splits a type's uses

A value's representation has to be the same wherever the value goes
without a conversion. So the unit of choice is a **group**: the List
values that flow into one another. Values flow:

- from a call's argument to the parameter, and from a definition's
  result to the call;
- through a record's field: what is stored in `Machine`'s `memory` field
  is what is read from it, so a field has one representation, and every
  definition that builds or reads that field is in its group;
- through a fold's or match's binders (the rest of a list is the list's).

Two groups meet only where a value crosses from one to the other, and
there the compiler converts it: `array of` (n) from a cons list, `items
of` (n) back. A crossing that runs once costs n once; a crossing inside a
loop costs n per turn, which the chooser already counts (`looped`).

The cut is by definition, the way represent.ts already rewrites: each
definition is in one group per type, and a call from one group's
definition to another's is a crossing at its arguments and result. In
machine the groups should come out as the assembler's definitions (built once,
reached from `assembled`) and the machine's (`Machine`'s fields, the step
loop), with one crossing where the machine takes the assembled `code`
(s2 checks this).

## How the choice is made

For each group, `choose` as now, over the jobs of that group's
definitions only, with each group's jobs weighed by `looped` as now. A
split is kept only when the groups' costs plus the crossings' cost come
to less than one choice for the whole type; otherwise the program keeps
one representation, as today. Types are unchanged: the source still says
`List Int` everywhere, and the rewrite (represent.ts `represent`) runs
once per group over that group's definitions.

Library definitions called from both groups (`map`, `length`) are
copied per group, as copies at other number types already are.

## Prior art

SETL's data representation sublanguage and its automatic selection
(Schonberg, Schwartz and Sharir, 1981) chose a representation per
variable, with conversions where values moved between differently
represented variables. Clojure's transients are the hand-written form of
machine's case: build a mutable vector, then freeze it for reading.
Data representation synthesis (Hawkins et al., PLDI 2011) picks
representations of a relation from the queries made on it.

## Steps

- **s2** represent.ts reports the groups for machine: each group's
  definitions, its jobs, its choice, and the crossings. No rewrite.
- **s3** two representations of `List` in one program: each group
  rewritten with its own, and a conversion at each crossing.
- **s4** machine's primes 20000 on the core IR's JavaScript, aiming at
  about 0.11 s.
- **s5** WebAssembly and C.
