# Polar behind Trig (design note for BACKLOG L97, 2026-10-29)

Ersagun, 2026-10-28 ("Discuss multiple-output functions and polar"): polar
should be the relation behind trigonometry, with sin, cos, tan, atan2,
hypot, asin and acos as its directions, and a type should be able to
implement polar or sin and cos and get the rest. RESULTS.md (L95) gave a
definition several named results, and WAYS.md (L96) lets an interface field
come from its ways, picked by cost. This note puts the two together.

## Short answer

```
polar(length, angle) → x, y = length · cos(angle), length · sin(angle)

interface Trig a = trig(sin, cos, tan, exp, log,
                        polar: (length: a, angle: a) → x: a, y: a,
                        unpolar: (x: a, y: a) → length: a, angle: a)
  way sin by polar     = (t) → y of polar(1, t)          -- _, y = polar(1, t)
  way cos by polar     = (t) → x of polar(1, t)
  way polar by sincos  = (r, t) → r · cos(t), r · sin(t)
  way tan by sincos    = (t) → sin(t) / cos(t)
  way unpolar by atan2 = (x, y) → √(x² + y²), atan2(y, x)
  way asin by unpolar  = (s) → angle of unpolar(√(1 − s²), s)
  way acos by unpolar  = (c) → angle of unpolar(c, √(1 − c²))

trig at float64 = trig(sin: host sin, cos: host cos, …, unpolar: host, polar: by its ways)
trig at fixed   = trig(polar: cordic rotate, unpolar: cordic vector, …by its ways)
trig at dual    = trig(sin: dual sine, cos: dual cosine, …by its ways)
```

and the prelude's `polar` relation solved backwards, `length, angle =
polar(x = 3, y = 4)`, uses the type's `unpolar` instead of the numeric
solver.

## Three pieces

**A field with several results.** An interface field may declare results
the way a definition does (RESULTS.md), and its type reads as that
direction, `(a, a) -> x: a, y: a`. An implementation gives it a definition
with the same results. A way of a field with results is the same thing:
`way polar by sincos` is a definition with results `x, y`. Using one is the
use L95 already reads, `x, y = polar(r, t)`, and a way can bind one result
and drop the other (`_, y = polar(1, t)`). How the evaluator or a target
hands two results back is a hosting detail: today a solve's answers are a
record of the bound ports, and nothing of that shows in the language.

**A relation's other direction given by a definition.** The relation
`polar` declares `x, y` as its results. A second definition may say it
computes another direction of the same relation (`direction of polar`, with
its ports matched by name), so a solve in that direction calls it instead
of searching. This is how `polar(x = 3, y = 4)` becomes `unpolar` at the
type's Trig, with one answer and no Choice, where the numeric solver today
gives a Choice of angles. The checker states that the direction's ports are
the relation's and that the direction is the one the definition declares;
whether the two agree is a law, checked by T7 like any pair of ways.

**Costs pick.** WAYS.md step 2 already lets a written field lose to a
cheaper way. Float64 on JS has `Math.sin`, `Math.cos` and `Math.atan2` and
no sincos, so it keeps sin and cos as given and takes `polar by sincos`.
A target with one sincos instruction (x87 `fsincos`, C's `sincos`) gives
polar at the price of one, and then `sin by polar` wins only once C55 drops
the unused `x`, so until C55 the costs keep the plain sine. Fixed has no
host trig at all: it writes CORDIC's two modes, rotation (polar) and
vectoring (unpolar), and gets everything else from the ways.

## What stays as it is

- `sin`, `cos`, `tan`, `exp`, `log` keep their names and types, so no
  program changes. `atan2`, `asin`, `acos` and `hypot` become Trig fields
  instead of Float64-only builtins, so Dual and Fixed get them.
- Complex's constructor called `polar` today (`polar(size, angle)`, a
  complex number) is renamed `from polar`, so the name is the relation's.
- No new node kind: polar is a def with results, its uses are solve nodes,
  `unpolar` is a def with one more optional field.

## The complex side (later)

`polar(length, angle) = length · exp(i · angle)` and `log z = ln|z| +
i · angle of z` are laws between the real and complex Trig, so either can
be written from the other. They need T7's law checks first, and they are
the last step.

## Steps

1. **L97a, built.** Complex's `polar` is now `from polar` (the prelude's
   name and LIBRARY.md; no example used it).
2. **L97b, built.** A definition that gives another direction of a
   relation with results: the def's optional `direction` (the relation it
   is a direction of, the same ports in the same order), checked at the
   definition ("unpolar is a direction of polar, so it has polar's 4
   ports, in order", and of the same types). A solve of the relation that
   gives the direction's inputs is a solve of the direction, for the
   checker, the evaluator and the compiler alike (src/lang/directions.ts,
   run first by infer and by resolveArithmetic); the program still reads
   and hashes as polar. And a solve in a definition's declared direction
   whose results are each an expression of the inputs (`= e1, e2`) is
   computed forward, one answer and no Choice, so `unpolar(x, y) →
   length, angle = √(x² + y²), atan2(y, x)` is a function and not a search
   (test/directions.test.ts). The prelude's own `polar` and `unpolar` come
   with Trig in step 3, where they are used.
3. **L97c, built.** Interface fields with results, and Trig's `polar`:
   a field node may name the positions of its results (`results`, with
   `ports` for the text), a use is a solve of the field, `_, y =
   polar(1, angle)`, checked in the direction the field declares with one
   answer ("polar gives x, y from length, angle" otherwise), and resolved
   by arith.ts to what the type gives, or to the way picked, its ports
   moved from positions to that definition's parameters. A definition
   given for it must declare the same results, with one answer. The
   prelude's ways are `polar by sincos`, `sin by polar` and `cos by polar`;
   Float64 gives `float64 polar`, Dual and Fixed leave polar to its ways
   and get it from their sin and cos, and a type that gives only polar
   gets sin and cos (test/polar.test.ts, evaluated and compiled).
   **L97c2, built.** The `unpolar` field the same way, the same four
   ports read as (x, y) → length, angle: Float64 gives `float64 unpolar`
   (√(x² + y²) and atan2), Dual `dual unpolar` by the chain rule, and
   Fixed `fixed unpolar`, CORDIC's vectoring mode in Ints (each of length
   and angle runs it once, until C55). No way gives unpolar yet, so every
   Trig gives it. **Next (L97c3):** the prelude's `polar` relation with
   `unpolar` as its direction, and asin and acos as ways of unpolar.
4. **L97d.** Fixed's CORDIC, both modes, and every other Trig field from
   its ways. Cheap only with C55 (sin alone must not do the cos half).
5. **L97e.** The complex laws, after T7.

Steps 1 to 3 (and L97c2) do not need C55; C55 only makes the polar-first types (Fixed)
as cheap as they should be.

## Prior art (to credit when built)

- Mercury's mode-specific clauses and `promise_equivalent_clauses`: one
  predicate, a separate definition per mode, promised to agree.
- Volder, "The CORDIC Trigonometric Computing Technique", 1959: rotation
  and vectoring modes, which are exactly polar and unpolar.
- C's `sincos` and x87 `fsincos`: both results of one evaluation.
- Common Lisp's `cis` and Julia's `sincos`.
