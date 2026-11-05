# Several ways to compute one operation (design note, 2026-10-28)

Ersagun, 2026-10-28 (BACKLOG L96): an interface or a definition may list
several definitions of one job, even circular ones, and the compiler
picks. `a ≠ b` can be `not(a = b)` and `a = b` can be `not(a ≠ b)`. sin
can come from polar, and polar from sin and cos. Each target's builtins
are more ways of their own, so what a target lacks is filled in from the
laws, and nothing about targets enters the language.

**Status (2026-10-30).** Steps 1 and 2 are built (L96a to L96c: ways,
"nothing grounds" in the checker, costs). Step 3 is L97, mostly built
(POLAR.md); steps 4 and 5 are open.

## Short answer

- **A way is a law that also computes.** It is an ordinary definition
  that gives one operation of an interface in terms of the others:
  `differ by equal = (a, b) → not(equal(a, b))`. It is marked as a way of
  the `differ` field, the way an interface is a typedef marked
  `interface: true`. There are no new node kinds.
- **Builtins are ways too, and so are the operations an implementation
  writes.** `trig at float64`'s builtin sin is a way of `sin` with no
  uses. `dual sine` is a way of `sin` at Dual that uses Float64's sin and
  cos. A way that uses nothing at its own type is *grounded*: it ends in
  real code.
- **An implementation may leave fields to its ways.** `equality at
  version = equality(equal: same version, differ: by its ways)`. Giving
  one of a circular pair is enough.
- **The compiler picks the cheapest grounded set**, per type and per
  target, before anything runs. It is the same pass that resolves `+`
  today (arith.ts). The search is Knuth's generalisation of Dijkstra's
  algorithm to derivations (1977). It handles cycles because going
  round a cycle never makes anything cheaper.
- **It is an error only when nothing grounds.** "Version has neither
  `equal` nor `differ`", said at the implementation.
- **The ways must agree.** They are laws, checked by T7's law tests. A
  type whose bits must be the same everywhere (Fixed, L89) gets one pick
  for all targets.

## How it reads

```
interface Equality a = equality(equal: (a, a) -> Bool, differ: (a, a) -> Bool)
  way differ by equal = (a, b) → not(equal(a, b))     cost 1 + equal
  way equal by differ = (a, b) → not(differ(a, b))    cost 1 + differ

equality at version = equality(equal: same version, differ: by its ways)
```

Trig, once L95 gives several results and L97 puts `polar` behind it:

```
interface Trig a = trig(sin, cos, tan, polar, atan2, exp, log)
  way sin by polar    = (t) → y of polar(1, t)
  way cos by polar    = (t) → x of polar(1, t)
  way polar by sincos = (r, t) → (r · cos(t), r · sin(t))
  way tan by sincos   = (t) → sin(t) / cos(t)
  way atan2 by polar  = (y, x) → angle of polar backwards (x, y)

trig at fixed = trig(polar: cordic, …by its ways)     -- Volder, 1959
trig at dual  = trig(sin: dual sine, cos: dual cosine, …by its ways)
```

A type implements what is natural for it and gets the rest. Fixed writes
CORDIC once, which gives sine and cosine together, and it gets sin, cos,
tan and atan2 from that. Dual writes the chain rule for sin and cos.

## How it is resolved

The problem is a small graph. Each node is an operation at a type (`sin
at Fixed`). Each way is an edge from the operations it uses to the one it
gives, with its own cost. The cost of a derivation is the way's own cost
plus the costs of what it uses. That is a superior function in Knuth's
sense: it never goes down when a use gets more expensive. Knuth's
algorithm is Dijkstra's with "a node is final when its cheapest way's
uses are all final". It finds the cheapest derivation of every node at
once, in O(edges · log nodes). A circular pair is fine. `equal by differ`
can only be final once `differ` is, and `differ` is final through the
written `same version`, so the cycle is never followed.

This runs in arith.ts, where `+` and interfaces are resolved today
(INTERFACES.md "How it is resolved"):

1. For each (interface, type) the program uses, collect the ways: the
   interface's own, the implementation's written fields, and the
   target's builtins for that type.
2. Run the search. Each field gets its cheapest grounded way.
3. Resolve each use of the field to that way's definition, copied at the
   type, as generic definitions are copied now. No runner sees a way. The
   evaluator, relate.ts, JS, WASM, C and the GPU get plain calls, as with
   interfaces.

An operation the program never uses is not searched. A way's own uses
of other fields are uses too, so the search follows them.

## Costs

A way's cost is declared on NUMBERS.md's ladder (`1`, `log n`, `n`, …)
with a constant in front, and a target can declare its own constants for
its builtins. The search adds the costs up. For example, in JS `Math.sin`
and `Math.cos` cost 1 each. On x87, `fsincos` gives both for about the
price of one, which is a way of `polar` with several results (L95). WASM
has no trig instruction, so there sin's only ways are the prelude's own
(an fdlibm-style polynomial in the language) or an import from the host.

Costs are on one scale with the representation chooser's (C30a,
ters/src/lang/cost.ts): a way's declared cost and a builtin's are
constant steps, and a cost is compared from its highest order down.

Declared costs are the start. NUMBERS.md "Costs and the chooser" already
plans worked-out costs (folds have computable costs) and checked ones (a
benchmark fits the exponent). Ways use the same ones.

**A written field is a way like any other.** By default the cheapest way
wins, even over a field the program wrote. That is what makes `polar`
share one sincos when a program uses both sin and cos. The editor shows
the pick per field, as it will show the representation chooser's. It
never lets a program pick one (Ersagun 2026-10-30, on representations:
"I don't want explicit selection, I want the compiler to choose").

## The ways must agree

The ways of one field mean the same function. That is a claim, and T7's
laws check it: each way of a field is tested against the others on
generated values, and the results are cached by definition hash. For
Float64 they agree within the tolerance `=` already has. The ways are
different roundings of one real function.

That is not enough where bits matter:

- **Fixed (L89)** promises the same bits on every machine. Its ways are
  all Int arithmetic in the language, and no target adds a builtin way
  for a Fixed operation. So the pick is made from target-neutral costs
  only, once, and every target runs the same code. A type says this with an
  `exact` flag on its declaration.
- **Float64 on JS, WASM and C** has the same sin and cos bits today
  because all three use fdlibm (NATIVE.md). If a target's builtin is a
  different sin, picking it changes the bits. So a target's builtin joins
  as a way only when it is the same function bit for bit, or when the
  program allows approximate ways, as shaders do already (#528: WGSL's
  cos differs by 2⁻¹¹).

## A direction is a way of its relation (L182c1, 2026-11-05)

A def node carries two flags that say the same kind of thing. `way`
names an interface field the definition is one way to compute. Since
POLAR.md, `direction` names a relation the definition computes in one
direction (`unpolar` is `polar` given x and y). Both say "a cheaper or
better-behaved computation of something written elsewhere, which must
agree with it". FOUNDATIONS-2026-11-03 §8 counts both among the flags
that act as hidden kinds, so `direction` goes and `way` covers both:

- **What a way may name.** An interface field, as today, or a definition
  with results (a relation). Naming a relation, the way is a direction of
  it: its results are the ports it gives, its other parameters the ports
  it is given, matched by position as `direction` is today
  (directions.ts `directionProblem`).
- **What reads it.** arith.ts's search reads only ways of fields, as now.
  directions.ts's `directionsIn` reads ways whose target is a definition,
  so `useDirections` rewrites a solve of `polar` given x and y into a call
  of `unpolar` as it does today. One flag, two readers, each by what the
  target is, the way a `ref` means a variable or a definition by its
  target.
- **Costs.** A direction may then carry `cost` like any way. Two
  directions of one relation in the same mode, which `directionProblem`
  refuses today, become a choice by cost, as two ways of one field are.
- **Laws.** Unchanged: each direction's answers hold for the relation
  (directions.test.ts, L201), as each way agrees with its field (the
  prelude's `… agrees at Float64` laws).
- **Saved programs and hashes.** hash.ts already hashes `direction` and
  `way` the same way (each a `defRef`). A def saved with `direction: r`
  is read as `way: r` by a SHAPE_STEPS entry, so the hash of a published
  direction changes once. The prelude's directions (`unpolar` and the
  inverse trig ones) are republished with it, as L184 keeps ids.
- **The editor.** Its "A direction of polar" panel (main.ts) and the
  check that keeps a direction out of a merge (typed.ts) read `way` with
  a definition as its target. Asked of the Editor lane with step (c2).

Step (c2) is that move: model.ts drops `direction`, SCHEMA keeps `way`
as a ref, directions.ts and infer.ts read the way's target, the
SHAPE_STEPS entry moves saved programs, and the prelude is rebuilt.
Step (c3), `field.ports`, is separate: a field's ports are its function
type's parameter names, read from the type the field already has.

## Compared with what exists

- **Haskell's default methods and `MINIMAL` pragma** (GHC 7.8). `Eq`
  defines `==` and `/=` from each other, and `MINIMAL` says one is
  enough. GHC picks by which one the instance wrote, never by cost, and a
  missing pair is a warning that loops at run time. Here the pick is by
  cost, and a pair that does not ground is an error before running.
- **Rust's default trait methods**: one default per method, overridden
  by writing it. There are no cycles and no costs.
- **Equality saturation** (Tate et al., 2009; egg, Willsey et al., 2021)
  keeps many equal programs and extracts the cheapest. Ways are the same
  idea, with the equalities written by the programmer as laws and the
  extraction done per operation, which is why Knuth's algorithm suffices.
- **Spiral** (Püschel et al., 2005) picks among the rewrite rules for a
  signal transform by measured cost per machine. That is the target
  costs part.

## Steps

1. **Ways for one interface.** A `way` flag on a definition naming the
   field it gives, `by its ways` for an implementation's field, and
   Knuth's search in arith.ts with costs all 1. Start with Ordered and a
   new Equality (`less` from `at most`, and the circular `equal` and
   `differ`). Show it evaluated and compiled, with the "nothing grounds"
   error. **Built (L96a)**, with Trig instead: Ordered has one field and
   `=` is the language's own on all plain data, so the first cycle is
   the prelude's `cos by sin` (sin(x + π/2)) and `sin by cos`. A def node
   has an optional `way` naming its field, `by its ways` is a builtin
   that fills a field, and arith.ts runs Knuth's search per
   implementation, each field given costing 1 and each way 1 plus what
   it uses. A Trig of the program's own that gives only sin or only cos
   gets the other; one that gives neither is refused with "leaves cos to
   its ways, and none of them ends in a field it gives" when it is
   resolved. **Since L96b the checker says it**, at the implementation,
   before anything runs: "trig at angle leaves sin and cos to their ways,
   and none of them ends in a field it gives". The search is one function
   (ways.ts `pickWays`) that the checker and arith.ts both call
   (test/ways.test.ts).
2. **Costs. Built (L96c).** A way's declared cost (the def's `cost`, 1
   when not given) and a builtin's cost on a target (`resolveArithmetic`'s
   `costOf`, target-neutral by default, Infinity for a builtin the target
   lacks). A written field is now a way like any other: it costs 1, or
   its builtin's cost, and a cheaper way beats it. So a target where cos
   costs 5, or has no cos, takes `cos by sin` for Float64, and the program
   gives the same numbers (test/ways.test.ts). No target declares its own
   constants yet: none of today's differ in a way that changes a pick, and
   the first real one is L97's (x87's `fsincos` as one polar). Fixed needs
   no `exact` flag for now: its fields are all its own Int code, never a
   target's builtin, so its pick is target-neutral already.
3. **Trig through polar (L97). Mostly built** (POLAR.md's L97a to L97c3). Trig fields with
   several results (`polar`, `unpolar`) and a definition that gives a
   relation's other direction. Only the polar-first types (Fixed) need
   C55's one direction per use, so sin alone is a plain sine.
4. **Agreement checked (T7). Built (L96d)** for the prelude's ways: each
   way of a Trig field is a law against Float64's own field ("cos by sin
   agrees at Float64", and polar by sincos holding of Float64's polar),
   run by `lab test` and test/prelude-laws.test.ts, which also checks that
   every way the prelude gives has a law that runs it. The inputs stay
   within [−3, 3]: far out, x + π/2 rounds away more than `=`'s tolerance,
   a disagreement of floats rather than of the ways. A program's own ways
   get laws the same way; caching by hash is `lab test`'s.
5. **The editor** shows the pick per field. There is no explicit
   selection: the compiler chooses (Ersagun 2026-10-30).

Credit when built: Knuth, "A generalization of Dijkstra's algorithm",
*Information Processing Letters* 6(1), 1977. Haskell's `MINIMAL` and
default methods. Equality saturation (Tate, Stepp, Tatlock and Lerner,
2009; Willsey et al., egg, 2021). Spiral (Püschel et al., 2005). Ersagun's
idea of the targets as more ways.
