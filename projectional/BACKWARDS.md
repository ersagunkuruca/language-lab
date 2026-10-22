# Running the whole language backwards

Relations used to cover arithmetic only: `+`, `−`, `×`, `÷`, `sin` and
friends, through the equation solver in `invertible/`. Now every node kind
in the typed core has a backwards reading, and one interpreter
(`src/lang/relate.ts`) runs a function in any direction: forward, backwards,
or with some inputs and the output known. A `solve` node picks the direction
inside a program, as before.

```sh
npm run lang                        # includes examples/backwards and examples/calculus
node --test test/backwards.test.ts
```

## Short answers

- **What does "backwards" mean?** Every node is a relation between its
  inputs and its value. Forward is "inputs known, value wanted".
  Backwards is "value known, some inputs wanted". The interpreter doesn't
  have two modes; each node does what the known values allow.
- **How?** Two pieces of machinery, used together. Data goes through
  **unification**: a constructor run backwards takes its value apart, like
  Prolog. Numbers become **equations**, handed to the existing solver as
  soon as one can be solved. The search is miniKanren's, a lazy fair
  stream, so an infinite branch can't starve a finite one (miniKanren by
  Friedman, Byrd and Kiselyov, [minikanren.org](http://minikanren.org); the
  stream code follows Hemann and Friedman's
  [μKanren](http://webyrd.net/scheme-2013/papers/HemannMuKanren2013.pdf)).
- **Does a function have to be written specially?** No. Every example
  below is an ordinary function, written forward.
- **What does it cost in the types?** Running something backwards always
  has `Choice` (any number of answers, including none). If the function
  folds or recurses, it also has `Diverge`, because unfolding may never
  end. `with fuel` turns that into `Choice`, the same as for Newton's
  method.

## Every node, backwards

| node | forward | backwards (value known) |
|---|---|---|
| number, text | the literal | check it's equal |
| variable | look it up | unify it with the value |
| constructor `cons(h, t)` | build | **take apart**: `cons(h, t) = [1, 2]` binds `h = 1`, `t = [2]` |
| projection `fst(p)` | read the field | build a pair whose `fst` is the value, `snd` unknown |
| `+ − × ÷`, `sqrt`, `pow`, `exp`, `log`, `sin`, `cos`, `tan`, `atan2`, `abs` | evaluate | an equation for the solver. One unknown: undone primitive by primitive, with every branch (`±sqrt`, `asin + 2πk`). Several unknowns: kept until enough is known, or eliminated together when they form a square linear block (`a + b = 10, a − b = 4`). Nonlinear with one unknown (`x³ − x − 1 = 0`): scanned for every root |
| `if` / `match` | pick the arm | **a choice over the arms**: run the arm backwards, then rebuild the value examined from the arm's case, and check it. `if x < 0 then −x else x` backwards from 5 gives −5 and 5 |
| `fold` | fold bottom-up | **unfold**: pick a case, run its body backwards to find the parts and the folded values of the recursive parts, unfold those in turn. The printer `show numbers` becomes a parser |
| call of a definition | run its body | run its body backwards. Calls are ordered by what's known: when a call's value is known it's pushed into the function first, else its inputs are computed first |
| call of a function value | call it | the same, when the function is known (it's not a black box: a function value remembers its node). `map(xs, square) = [4, 9]` gives four lists |
| let (a dot on a wire) | bind | the same: a let is a call of a lambda |
| `join text(a, b) = c` | concatenate | `a` known: strip it off. `b` known: strip it off. Neither: every way to cut `c` in two |
| `show(n) = t` | print the number | read `t` back, and accept only the spelling `show` itself would produce (so `"01"` and `"1.0"` aren't answers) |
| `less(a, b)`, `equal(a, b) = false` | compare | a check that waits until both sides are known. It can reject a value, never produce one |
| `equal(a, b) = true` | compare | unify `a` and `b` |
| `and`, `or`, `not` | evaluate | every row of the truth table that fits |
| `range(n)` | `[0, …, n − 1]` | `n` is the list's length, once that's known |
| `one of(list)` | each item | the value is somewhere in the list; if the list isn't known, lists that contain it, one length at a time |
| `fail()` | no answers | no answers |
| `solve` | a relation in a direction | the same as a call, read sideways: its given ports are inputs, its bound ports are unknowns |
| `for some(f)` | is there an `x` with `f(x)`? (a search) | `x` is a fresh unknown, and `f(x)` must hold |
| `a hence b` | `a and b` | `a`'s equations, with `b`'s as laws: usable to solve, not counted as constraints |

## What can't run backwards, and why

The checker refuses the first and the last two before anything runs. The
rest only run forward: they wait, inside the search, until what they need
is known, and then run. An answer that leaves one of them waiting isn't
pinned down, so the evaluator's `solve` doesn't count it (`relate` returns
it with the wait in `residual`).

| what | why |
|---|---|
| `print` | Printing can't be undone, and a search would print once per guess. The checker refuses to run a printing function backwards. |
| `floor`, `mod` | Many inputs give the same output, a whole interval or every multiple of `b`. That's a continuum, not a list to choose from, so these wait until their input is known and only run forward. An answer whose input never becomes known keeps the constraint as a residual. |
| `less` producing a number | `x < 3` has a continuum of answers, so comparisons only check. `magnitude` backwards works because its arms produce the numbers and the condition only rejects. |
| calling an unknown function | Functions can't be enumerated. `map` runs backwards only when its function is given. |
| `first`, `all`, `count` with unknown inputs | They look at *every* answer of their action at once. Backwards, that would mean "find inputs for which the set of answers is exactly this", which is not one choice per answer (it's Prolog's negation-as-failure problem). They wait until everything their action uses is known, then run it forward. |
| `with fuel` inside the function | Runs its action with its own budget once the action is known: each step of the search that might repeat forever spends one. |
| `derivative` | Backwards it would be integration. Once its function is known it runs forward, so `slope(x) = derivative(y ↦ y·y)(x)` run backwards from 1 gives 0.5. |
| a function, as an answer | It has no value outside the search to hand back, and functions can't be guessed. The checker refuses to solve for anything with a function in it. |
| text from nothing: `show(n) = t` with neither known | Waits. If nothing else pins `n` or `t` down, the answer says they're free. |

"Free" deserves a word. `total(xs) = 10`, with `total` a fold that adds a
list, has the answer `[10]`, then `[_3, _9] where 10 = _3 + _9`, then lists
of three, and so on. Those later answers are lines and planes, not points.
The interpreter returns them with the leftover equations
(`Answer.residual`), the way a constraint logic language prints residual
constraints. Inside a typed program an answer must be fully known, so free
answers are skipped (the same rule `solve` already had for `0·x = 0`).

## Things it gets right that the old arithmetic-only relations couldn't

- `show numbers` run backwards on `"10 20 30"` is `[10, 20, 30]`, and on
  `"10  20"` it has no answer. Nobody wrote a parser; the printer is one
  read the other way. This is the URL-syntax idea from `invertible/` made
  general: any printer written as a fold is also a parser.
- `queens` run backwards on the board `[2, 0, 3, 1]` finds the size, 4.
  The search checks the board is safe along the way.
- `f(a, b) = pair(a + b, a − b)` backwards from `pair(10, 4)` gives `7, 3`.
  Unification takes the pair apart and the solver eliminates the two
  equations together.
- Running forward through the relational interpreter gives the same answers
  as the evaluator (a test checks queens of 5 both ways). The evaluator in
  `run.ts` is just the fast special case where inputs are always known.

## Calculus on real functions (`examples/calculus`)

The old `examples/algebra` modelled expressions as a data type, with a
second copy of arithmetic (`sum`, `product`, …) and `evaluate`, `derivative`
and `display` as folds over it. That was backwards for this language:
functions aren't black boxes here, so the derivative can be read off a
real function. `examples/calculus` does that:

```
cubic(x) = x·x·x − x − 1
cubic′(x) = x·(x + x) + x·x − 1          ← generated, an ordinary definition

root near(f, guess) = with fuel(100, () => newton(f, derivative(f), guess))
zeros of cubic = all(() => solve cubic(out = 0) for x)
```

`derivative` is a builtin that reads a function's graph and builds the
derivative as another function (`src/lang/derive.ts`). The same code
generates `cubic′`, `kink′` and the rest as definitions you can open in the
editor. The rules:

| node | derivative |
|---|---|
| arithmetic | the chain rule. Each operation's partial derivatives come from the solver's primitive table, the same table that evaluates and inverts it |
| let | a let of the value and its slope |
| call of a definition | through a generated definition of its derivative (`g′`, or `∂g/∂a` for several inputs). Recursion works: `∂power/∂x` calls itself |
| call of a function value | `derivative(f)(u) · u′`, at run time |
| `if` / `match` | the same case analysis with each arm differentiated (piecewise, as AD does) |
| `fold` over data that doesn't depend on x | a fold that carries (value, slope) pairs: forward-mode AD written in the language itself. `∂polynomial/∂x` is Horner's rule doing that |
| `fail()` | `fail()`: where `sinc` has no value, `sinc′` has none either |

Not differentiable: taking apart data built from x (that needs
derivatives of data), calls of builtins that aren't arithmetic (`floor`),
and `solve` nodes (implicit differentiation would do it). `differentiate`,
the editor's gesture, refuses those with `NotDifferentiable`. At run time
`derivative` can't refuse, so it puts `fail()` where it can't read a slope:
its result may fail, `(Number) -[Choice]-> Number`, and only the pieces
that need the missing slope fail. `derivative(sqrt)` works too: a builtin
is read as `x ↦ sqrt(x)`.

Finding zeros uses the other half: `zeros of cubic` is `cubic` run
backwards from 0. The solver can't isolate x in `x·x·x − x − 1`, so it
scans for sign changes and returns every real root, where Newton returns
one. `zeros of x² − 2` gives both `±1.414…`.

`examples/algebra`, the data-type version, stays as the test bed for data
types, since adding a case to `expression` exercises every fold.

## One system: what this unifies

- **Arithmetic is defined once.** The solver's primitive table
  (`invertible/src/expr.js`, `FN`) has each operation's evaluation, its
  inverses, and its partial derivatives. The forward evaluator now takes
  `eval` from there (`src/prelude.ts`), the relational interpreter uses the
  inverses, and `derive.ts` uses the derivatives. Before, `+` was written
  three times: a JS builtin, the solver's copy, and the `sum` case of the
  algebra data type.
- **Pattern matching is relation solving.** A match arm run backwards is
  its constructor run backwards. Matching a value against `cons(h, t)` and
  building `cons(h, t)` are the same unification, read in two directions.
- **A network is a predicate.** What used to be a network is a function
  returning `Bool` built from `equal`, `and`, `hence` and `for some`
  (LANGUAGE.md, "One world"). Run backwards with its result `true`, each
  `equal` unifies, each `for some` adds unknowns, and the arithmetic becomes
  constraints in the same state as everything else. `polar` is such a
  predicate, not a built-in relation.
- **Periodic answers are cut off.** An angle solved from a cosine is a whole
  family (`θ + 2πk`). When none of its first 64 members fits what else is
  known, `relate.ts` stops there instead of walking every `k`.

## For the compiler

Directions stay static: a `solve` node still names its function and which
ports are known, and no node kinds were added. Arithmetic-only directions
are compiled by the solver's plan as before. For the others, the order of
work inside `relate.ts` is chosen at run time, so `COMPILER.md` plans a
Mercury-style mode analysis per (definition, known ports), with `relate.ts`
linked as the runtime where it fails.

## Files

```
src/lang/relate.ts    the relational interpreter: unification, constraints, fair search
src/lang/derive.ts    derivatives of functions, as new code
src/lang/solve.ts     planSolve: solver path or relational path, and the effects
src/lang/run.ts       solve nodes on the relational path; derivative; function values remember their node
examples/backwards    everyday functions run backwards
examples/calculus     calculus on real functions
test/backwards.test.ts
```
