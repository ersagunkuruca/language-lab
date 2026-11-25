# A gradient in one pass back (L285)

`gradient(f)` is forward mode today (derive.ts). It runs `f` once per
part of its input, each run seeded along that part (Wengert 1964, JAX's
`jacfwd`). For a point, three runs are fine. For mnist's 25,450
parameters it would take 25,450 runs a step, so round 22 wrote its
backward pass by hand (GAPS.md DG3). This note is how `gradient` gets the
same answer in one run forward and one pass back (Linnainmaa 1970,
Speelpenning 1980), for records and for arrays.

## What doesn't change

- **The meaning.** `gradient(f)(x)` is the record, or now the array, of
  ∂f/∂xᵢ. Reverse mode is only how it is worked out, so a test can compare
  it with forward mode and with central differences.
- **The name and the type.** `gradient : ((a) -[e]-> Float64) -> (a)
  -[Choice, e]-> a`. `a` may now be an `Array Float64` as well as a record
  of Float64s. The Choice is the same as today's: where a slope can't be
  read there is none, and the checker drops it when it can read every
  slope.
- **Where it runs.** The result is ordinary code (calls, lets, cases,
  maps), made ahead of time as forward mode's is. The evaluator and every
  compiler target run it with nothing new, except the one library
  function below.

## The transform

A definition `g(x₁, …, xₙ) = body` that `f` reaches gets a pullback `ḡ(x₁,
…, xₙ, ȳ)`. It gives the slopes of g's moving inputs, times ȳ. It is made
once per set of moving inputs, as forward mode makes `g′`, and it may call
itself, so recursion needs nothing special.

- **Lets.** The body runs forward and keeps its lets. Then each let's
  slope is the sum of what its uses give it, taken in reverse order
  (Speelpenning's adjoints, Griewank and Walther's *Evaluating
  Derivatives*, 2008, chapter 3).
- **Arithmetic.** Each operation's partials come from the solver's
  primitive table, as forward mode's do, so arithmetic is defined once.
- **Calls.** A call of a definition gives back that definition's
  pullback's answer. A call of a function value is the same, through the
  function's pullback carried as `derivative` carries its derivative
  (I245).
- **`if` and `match`.** The pullback takes the same branch, so it is
  piecewise, as forward mode is.
- **`map(range(n), k ↦ e)`, `sum` of one, and `array of` one.** Each
  item's slope goes back through `e` at its own k, and the slopes that
  reach a variable from outside the lambda are summed over k.
- **Reads of an array, `at(p, i)`.** The slope ȳ goes to position i of
  p's slope. Many reads hit one array, so p's slope is an array carried
  through the backward pass: it starts as n zeros, and each read adds its
  slope at i with `replace at`, where nothing else holds the array in
  place. Branches start from the same array and give back theirs; a `map`
  over items becomes a fold carrying it. This is JAX's transpose of a
  gather, a scatter-add, and Futhark's reduce-by-index for reverse mode
  over arrays (Schenck, Rønning, Henriksen and Oancea, SC 2022).

Pearlmutter and Siskind gave the functional form of this transform
("Reverse-mode AD in a functional framework", TOPLAS 2008). JAX's `grad`
does the same on its own programs (Bradbury et al., 2018).

## What it costs

The first version (R2) gathered each read as one pair in a bag, a tree
of (position, slope)s, added into an array at the end: about 2.5 million
pairs per 100 digits for mnist, against 25,450 sums in the hand-written
pass, and Adam over 1000 made-up digits took 4.5 s natively against the
hand-written 0.24 s. R5 (11-25) carries the array instead, so the pairs
never exist: 0.64 s natively, and the core IR's JavaScript 3.8 s to
1.1 s at 200 digits (0.17 s hand-written). What is left is a call of
`replace at` and `item at` for each read where the hand-written pass
adds into a buffer.

## Forward over backward

The pullbacks are ordinary generic code, so running them on `Dual` gives
the Hessian times a vector (Pearlmutter 1994). mnist's Newton mode does
this today with its hand-written pass, and it would keep doing it with
`gradient`'s.

## Steps

1. **R1.** Records and Float64s: lets, arithmetic, calls of definitions,
   `if` and `match`. `gradient` uses the pullback where its function is
   known. Tests compare it with forward mode on the examples that use
   `gradient` (raymarch's normal, round 15's fit), and with central
   differences.
2. **R2.** Arrays: `at`, `map` over a range, `sum`, `array of`, bags and
   `slopes at` (bags replaced in R5). Tests on a dot product, a matrix times a vector,
   and a softmax.
3. **R3.** Recursion (mnist's `dot` and `strided sum`) and function values.
4. **R4.** mnist's `loss at` differentiated by `gradient`, checked against
   its hand-written `loss and gradient`, and raced (bench-mnist.ts).
5. **R5.** Bags added in place: done 11-25 by carrying each array's
   slopes so far instead. Tensors (`contracted`) once C302 stores them as
   one array.
6. **value and gradient** (11-25): f(p) with its slopes, the value taken
   where the pass back starts, inside the lets the run forward bound.
   mnist's `reverse` no longer runs `loss at` again for its loss: 10000
   digits natively 7.7 s to 6.6 s.