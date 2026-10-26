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
- **What does it cost in the types?** Running something backwards has
  `Choice` (any number of answers, including none), unless its direction
  always gives exactly one: a pair taken apart is always a pair, so
  `solve make(a, b) = p` is an ordinary call (MODES.md). It also has
  `Diverge` when the search may not end: when it unfolds or recurses on
  something that doesn't get smaller each time (MODES.md). Reading text
  back into numbers ends, since each step reads a shorter text; a list
  from how many items it has may not, since whole numbers don't shrink
  towards a base case. `with fuel` turns `Diverge` into `Choice`, the same
  as for Newton's method. A direction that can never pin down an answer
  (a pair from its first item alone) is an error at the `solve`.

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
| whole-number `add`, `subtract`, `negate` | evaluate | any two sides give the third, exactly. So `length(xs) = 3` backwards gives `n = 2` for the rest before unfolding it, and builds the three-item list at once instead of guessing lengths (as Prolog's CLP(FD) and miniKanren's `pluso` do) |
| `split(t, by) = pieces` | split | `pieces` known: join them with `by`, and accept it only if splitting that gives the same pieces (no piece holds `by`) |
| `join text(a, b) = c` | concatenate | `a` known: strip it off. `b` known: strip it off. Neither: every way to cut `c` in two |
| `show(n) = t` | print the number | read `t` back, and accept only the spelling `show` itself would produce (so `"01"` and `"1.0"` aren't answers) |
| `less(a, b)`, `equal(a, b) = false` | compare | a check that waits until both sides are known. It can reject a value, never produce one |
| `equal(a, b) = true` | compare | unify `a` and `b` |
| `and`, `or`, `not` | evaluate | every row of the truth table that fits |
| `range(n)` | `[0, …, n − 1]` | `n` is the list's length, once that's known |
| `one of(list)` | each item | the value is somewhere in the list. It waits for each cell of the list to be known, so a list built by a later goal is searched once and a finite one fails finitely; a list that never becomes known is left as a residual |
| `fail()` | no answers | no answers |
| `solve` | a relation in a direction | the same as a call, read sideways: its given ports are inputs, its bound ports are unknowns |
| `for some(f)` | is there an `x` with `f(x)`? (a search) | `x` is a fresh unknown, and `f(x)` must hold |
| `a hence b` | `a and b` | `a`'s equations, with `b`'s as laws: usable to solve, not counted as constraints |

## What can't run backwards, and why

The checker refuses the first and the last two before anything runs. The
next three are refused, with their reason, when the search reaches them.
The rest only run forward: they wait, inside the search, until what they need
is known, and then run. An answer that leaves one of them waiting isn't
pinned down, so the evaluator's `solve` doesn't count it (`relate` returns
it with the wait in `residual`).

| what | why |
|---|---|
| `print` | Printing can't be undone, and a search would print once per guess. The checker refuses to run a printing function backwards. |
| the world's operations (`read file`, `write file`, `read line`, …) | The same reason as `print`: they can't be undone, and a search would do them once per guess. |
| `cell`, `formula`, `read`, `write` | Cells are the runtime's state, kept by its handler, and only run forward. |
| `seeded` | It answers `Random` from a generator. Backwards it would have to search the generator's seeds. |
| `floor`, `mod`, `round to Float32` | Many inputs give the same output, a whole interval or every multiple of `b`. That's a continuum, not a list to choose from, so these wait until their input is known and only run forward. An answer whose input never becomes known keeps the constraint as a residual. |
| `less` producing a number | `x < 3` has a continuum of answers, so comparisons only check. `magnitude` backwards works because its arms produce the numbers and the condition only rejects. |
| calling an unknown function | Functions can't be enumerated. `map` runs backwards only when its function is given. |
| `first`, `all`, `count`, `optional` with unknown inputs | They look at *every* answer of their action at once. Backwards, that would mean "find inputs for which the set of answers is exactly this", which is not one choice per answer (it's Prolog's negation-as-failure problem). They wait until everything their action uses is known, then run it forward. |
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

## A worked example: Fibonacci, backwards

Ersagun asked this on 2026-10-26: how can `fib` run backwards at all, and
why did the fast version do worse backwards than the slow one? The
numbers below are from the editor's Run pane and from `relate` on the same
code, at #447.

The two functions, as he wrote them in the editor:

```
fib(n) = if n = 1 or n = 2 then n else fib(n − 1) + fib(n − 2)
fib3(a, b, n) = if n = 0 then a else fib3(b, a + b, n − 1)
fibFast(n) = fib3(1, 1, n)
```

`fib` counts 1, 2, 3, 5, 8, 13, …: `fib(4) = 5`.

### It doesn't unwind the tree. It guesses it, smallest first.

Nothing works out a recursion's tree from its result. The search knows
two things, and the rest follows from them:

- **An `if` run backwards is a choice of its two arms.** The answer came
  from the `then` arm or from the `else` arm, so try both.
- **A sum with an unknown is an equation.** It's kept until enough is
  known to solve it.

Asked for `fib(n) = 5`:

1. **`then` arm:** `n` would be 5, but 5 isn't 1 or 2. Rejected.
2. **`else` arm:** `fib(n − 1) + fib(n − 2) = 5`. Two calls, nothing
   known about either. The equation `x + y = 5` waits. The search starts
   on `fib(n − 1) = x` with **both sides unknown**. That's the same
   question one level down, so it is again a choice of arms:
   - `then` arm: `n − 1` is 1 or 2, and `x` is the same. That's a
     **guess**. From it, `n` is 2 or 3. Now `fib(n − 2)` has a known input,
     so it simply runs forward, and the waiting sum checks the total.
     `n = 3` gives 2 + 1 = 3, not 5.
   - `else` arm: `n − 1` is itself a recursive case. Go one level deeper
     and guess there.

The trace of the calls the search makes for `fib(n) = 5` (`_17` and so on
are unknowns):

| step | call | what's happening |
|---|---|---|
| 1 | `fib(_0) = 5` | the question |
| 2 | `fib(_17) = _15` | the else arm's first call, nothing known |
| 3 | `fib(0)`, `fib(1)` | guesses `n = 2` and `n = 3` from the base case; the second call runs forward |
| 4 | `fib(_41) = _39` | one level deeper: `n − 1` is itself a sum |
| 5 | `fib(2)` | guess `n = 4`: 3 + 2 = 5. **Answer: n = 4** |

So the search builds possible trees from the bottom up, shallowest first,
and checks each against the result. The first tree whose sum is 5 gives
`n`. That's why non-Fibonacci numbers fail: no tree adds up to them, and
the search can't tell that a deeper tree would only make bigger numbers,
so it goes on until it runs out of steps (the Run pane allows 20,000) or
stack. Planning which goal runs first, before the search starts, follows
Mercury's modes (prior art, MODES.md).

Two things keep this from getting lost down one path forever:

- **Fair interleaving.** Each recursive call is a point where the search
  may switch to another branch. A branch that goes on forever doesn't
  starve the others. (`fib(0)` is one: it recurses into negative numbers
  forever, so a branch that reaches it never ends, but the others still
  get their turn.) This is miniKanren's search (prior art, credited
  above). The guess `n = 2` shouldn't have been tried at all, since this
  arm is the one where `n` isn't 1 or 2. The check waits and doesn't cut
  the branch before `fib(0)` starts. That's a known waste, on the backlog.
- **Equations wait.** `x + y = 5` with both unknown can't be solved, so it
  waits. Once a guess fixes `x`, it gives `y`, or checks it.

How the work grows: for `fib(n) = 8` the search takes 85 steps, for 13 it
takes 145, for 144 it takes 1,610. Each next Fibonacci number costs about
1.6 times as many steps as the last. That's the same growth as running
`fib` forward, because it builds the same trees.

### Why the fast version did worse

Backwards, `fib3` and `fibFast` find the answer much faster. `fibFast(n)
= 8` is found in 11 steps (85 for `fib`), and 144 in 23 steps (1,610 for
`fib`): two steps per level. With `a` and `b` known, `fib3` backwards is a
straight walk: `fib3(1, 1, n) = 8` becomes `fib3(1, 2, n − 1) = 8`, then
`fib3(2, 3, n − 2) = 8`, and so on, until the `then` arm finds `a = 8`.

What makes it look worse is what happens **after** the first answer. The
Run pane keeps looking for other answers, and only shows anything when
that search ends. For `fib3` that second search is the slow part:

- It goes on walking: `fib3(8, 13, _) = 8`, `fib3(13, 21, _) = 8`, … `a`
  is already past 8, but nothing tells the search that `a` only grows, so
  it doesn't stop.
- `n` is still unknown at every level. Each level adds one more waiting
  equation (`n = n₁ + 1`, `n₁ = n₂ + 1`, …), and each step re-reads all of
  them. After 200 levels there are 198 waiting equations. After 1,400 there
  are 1,398, and `a` is about 10²⁹². Each step costs more than the last.

In the editor that takes about 26 seconds before the stack runs out and
the pane shows `n = 5` with "Maximum call stack size exceeded". The slow
`fib` runs out after about 1 second, because its extra search doesn't
pile up equations.

So the fast version is the better program backwards too: it finds the
answer in a few steps. It's the search for a second answer, which can
never succeed, that costs more. Two improvements would fix it (both on the
backlog):

- Show the first answer as soon as it's found, and look for more after.
- Notice that a known input only grows while the result stays fixed, and
  stop. That's the size-change check MODES.md already runs, applied to
  values as well as to shapes.

### Adding a helper function

`fibFast(n) = fib3(1, 1, n)` needs `fib3` as its own definition (`+ New
definition`), as above. A function written inside another one can't call
itself: only definitions can be recursive, which is what lets the checker
see whether recursion ends. A function written in place is offered by the
palette only where a function is expected (an input of type `(a) -> b`),
as "new function".

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
  as the evaluator. `test/agreement.test.ts` checks that for every pure
  function of every example, on sample inputs, and also that backwards
  from the result finds those inputs and only answers that run forward to
  it. The evaluator in `run.ts` is just the fast special case where inputs
  are always known.

## Order of work

What runs first decides whether a search ends, so the interpreter follows
three rules. An argument computed only from known values runs first, in
either direction: it's a value, where backwards it would be a guess
(`polynomial([-2, 0, 1], x)` backwards builds the list before unfolding the
fold, and a let whose inputs are known is computed, not solved for). A
`solve` whose answer is known runs its body before its relation, so what
the body says about the bound ports narrows the search. And every answer
the equation solver gives is checked against the equations it came from: a
step that is right in general can be wrong at a singular point (`y = x·tan θ`
undoes `atan2` except at `x = 0`). The search's step budget (`spend`) is
carried in its state, so the solver spends it too: each answer it hands
back is one step.

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
MODES.md is the design: the same analysis also decides, before running,
whether a direction ends and how many answers it can have.

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
