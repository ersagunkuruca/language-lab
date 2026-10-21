# Invertible, multi-directional functions

A prototype of "functions" that are relations: a node with ports and the
equations that hold between them, with no fixed inputs or outputs. You pick
which ports are known; the solver derives an ordinary program for the rest,
follows every branch of any multi-valued inverse, and marks one answer as
canonical.

```
npm test                         # 34 tests, no dependencies (Node 20+)
python3 -m http.server           # then open http://localhost:8000/ for the demo page
```

## Does the inverse of `c = a + b, d = a − b` fall out of `+` and `−`?

Partly, and the part that doesn't is the interesting bit.

If each primitive only knows its own inverse (`+` knows `a = c − b`, `−` knows
`a = d + b`), you can undo any equation that has **one** unknown in it. That's
local propagation, the method in Sketchpad and ThingLab. It covers a lot:
`F = C·9/5 + 32` inverts to `C = (F − 32)·5/9` by peeling one primitive at a time.

With `c` and `d` known, though, both equations have two unknowns (`a` and
`b`). No single primitive's inverse applies. You have to solve the two
equations together, and that needs one more fact than the inverses of `+`
and `−`: that terms in the same variable can be collected (`b + b = 2b`, the
ring laws). Gaussian elimination is exactly that fact turned into an
algorithm. Since `+` and `−` are linear, the solver writes the block as a
matrix and eliminates it over exact rationals:

```
a = (c + d) / 2
b = (c − d) / 2        from  c = a + b ; d = a − b
```

So the general method is: **find the smallest group of equations that must be
solved together, then pick a solver for that group.** This is what Modelica
compilers do with acausal equations (matching + BLT/Tarjan ordering, then
"tearing" algebraic loops). Here, in order of preference:

1. **Isolate.** An equation with one unknown is undone primitive by primitive,
   using each primitive's own inverse table (`src/expr.js`, `FN[f].inv`).
2. **Eliminate.** A square block that is linear in its unknowns is solved
   exactly, and the result is a printable expression (`src/linear.js`).
3. **Tear.** A square nonlinear block is torn: guess one unknown, compute
   the others from it in closed form (step 1), and the one equation left over
   becomes a 1-D residual. Every branch combination is scanned over a wide
   range and each sign change is bisected, so it finds every root in range
   (both roots of a quadratic, both `r = ±5` families of polar without its
   law), and domain errors like `sqrt` of a negative just mark gaps.
4. **Newton.** Anything else square and nonlinear is solved numerically,
   with the Jacobian from symbolic differentiation of the same trees. It
   finds one root, not the whole solution set, and the plan says so.
5. **Check.** An equation whose variables are all known becomes a check. This
   is how redundant equations choose between branches (below).

## Multi-valued inverses: branches + a canonical choice

Every inverse returns a list of branches, canonical first. A branch can have
integer parameters (`k ∈ ℤ`) and guards (conditions it needs):

| primitive | inverse branches |
|-----------|------------------|
| `y = x^2` | `sqrt(y)`, `−sqrt(y)` |
| `y = sin(x)` | `asin(y) + 2πk`, `π − asin(y) + 2πk` |
| `y = cos(x)` | `acos(y) + 2πk`, `−acos(y) + 2πk` |
| `y = sqrt(x)` | `y^2` if `y ≥ 0` |

Because the `k` is a real variable inside the expression, periods compose by
themselves: `y = sin(2x)` gives `x = (asin(y) + 2πk) / 2`, period π, which
nobody declared. Running a plan enumerates branches and `k` over a window, and
the first consistent assignment is the canonical solution. That makes the
canonical answer *the canonical branch of every step*, which is the same rule
mathematicians use for `sqrt(4) = 2`.

### atan2 is not a primitive here

Polar coordinates are just `x = r·cos θ, y = r·sin θ`, plus one **law**,
`x² + y² = r²`. With `(x, y)` known the solver gets

```
r = sqrt(x^2 + y^2)   or   −sqrt(x^2 + y^2)          from the law
θ = acos(x / r) + 2πk   or   −acos(x / r) + 2πk     from x = r·cos θ
check y = r·sin θ
```

The check throws away the `acos` branch with the wrong sign of `y`, and what's
left, on the canonical branches, is exactly `atan2(y, x)`. All six pairs of
known ports work (`x,r → θ,y` gives `±` branches for `y`, and so on), and one
known port reports "underdetermined, pick one more of x, y, r".

A law is a fact the solver can't derive itself. In general that derivation is
nonlinear elimination: a Gröbner basis of `{x − rC, y − rS, C² + S² − 1}` would
produce `x² + y² = r²`. Instead, laws are written down and the tests check
every law numerically against the defining equations. Without the law
(`polarNoLaw`) the solver tears the block (guess θ, `r = x / cos θ`, scan
for `y = r·sin θ`): it still finds every solution, but numerically, where
the law gives a closed form.

### Composition runs backwards for free

`rotate` is two polar relations sharing `r`, plus `θ2 = θ + φ`. Nobody writes
an inverse. Known `(x, y, φ)` gives the rotated point; known `(x2, y2, φ)` gives
the original point; known `(x, y, x2, y2)` gives the angle. Inverting the
surrounding relation automatically inverts the inner ones in whatever
direction is needed.

## URLs: the same problem with strings

`src/syntax.js` describes a site's URLs once, from small pieces that each know
how to read and how to write themselves (literal, int, path segment, enum,
query string, optional trailing slash, sequence, routes). Sequences and routes
derive both directions from their parts, just as compound relations do.

- **Parsing** is many-to-one: `/USERS/042/`, `/u/42#bio` and
  `https://example.com/users/42` all read as `{ route: 'user', id: 42 }`.
- **Printing** is the inverse and is multi-valued. It returns every spelling
  it knows, canonical first. The canonical URL is the printer's first branch,
  which is the role `sqrt` plays for `x²`.
- Some values have no spelling (`id: −1`), like `sqrt(−1)` has no real value.

The tests check the round-trip laws: `parse(print(v)) = v`; every listed
spelling parses back to `v`; and `canonicalize` is idempotent.

## Prior art this borrows from

- **Constraint propagation**: Sketchpad (1963), ThingLab (1979). Local
  propagation is step 1 above.
- **Acausal modelling**: Modelica. Equations without direction; the compiler
  picks causality per use, finds algebraic loops, and solves them.
- **Relational programming**: Prolog, miniKanren. Run a relation "backwards".
  Mostly for symbolic/discrete domains, not real arithmetic.
- **Bidirectional transformations**: lenses, Boomerang, "Invertible Syntax
  Descriptions" (Rendel & Ostermann, 2010), partial isomorphisms. These are
  the URL half.
- **Automatic differentiation**: derivatives as another interpretation of the
  same program. Here the Newton fallback uses that, and the same move
  (functions as inspectable trees) is what makes inversion possible.

## What's next

- Laws are hand-written. A small Gröbner/resultant step could derive them for
  polynomial systems, so `x² + y² = r²` would fall out too.
- Symbolic (not just numeric) coefficients in elimination, e.g. `x = r·C`
  with `r` known in a loop.
- Unify the two halves. The URL printer's branches and the math branches are
  the same idea in two codebases. A single "relation over any domain" core
  would let a route relation sit in the same graph as numeric ones.
- Learned inverses: a relation whose inverse is a trained model (the
  VAE/GAN observation) could plug in as a primitive with a numeric-only
  inverse, the way Newton does now.

## Is − the inverse of +? The arithmetic atoms

Decision: **there is no + node.** The additive atom is the *balance*,
`l₁ + l₂ + … = r₁ + r₂ + …` (what flows in equals what flows out:
Kirchhoff's current law, double-entry bookkeeping). With n ports, any n − 1
determine the last, exactly and single-valued. +, − and negate are the same
node seen from different ports, so the symbol drawn on it is presentation,
chosen by which ports are known:

| node | known | unknown | drawn as |
|------|-------|---------|----------|
| `a + b = total` | a, b | total | `total = a + b` (+) |
| `a + b = total` | total, b | a | `a = total − b` (−) |
| `x + y = 0` | x | y | `y = −x` (negate) |

`view(rel, known)` returns that symbol and formula for an editor to draw.

Why the balance is the atom and not +: it has no privileged output, so its
inverse is itself with the ports relabelled. It's variadic for free (`sum(5)`
is one node, not four), and a graph made only of balances is linear, so
elimination always solves it exactly. Starting from + you need − to invert
it, and starting from − you need negate. Starting from the balance you need
nothing else.

The multiplicative atom has the same shape, the **ratio** `Π left = Π right`.
×, ÷ and 1/x are its views. It differs in one place, zero:

- `0 · x = 5` has no solution, so the result stream is empty (failure).
- `0 · x = 0` holds for every x. The result says `x` is **free** (value
  `null`, listed in `free`), not NaN. So "0/0" isn't an error. It's an
  honest answer: anything.

`log` maps a ratio onto a balance (`log a + log b = log c`), so exp/log is
the bridge between the two atoms.

`examples.discriminant` builds `D = b² − 4ac` from atoms only, with no minus
and no square: `b·b = bb` and `4·a·c = q` are ratios and `D + q = bb` is a
balance. Asking for `b` gives `±sqrt(D + 4ac)`. Asking for `c` gives
`(b² − D) / 4a`. These are the same three nodes.

## Multiple results, Verse style

A relation solved in some direction is an expression with **0, 1 or many
results**. This is the semantics of Verse's failable expressions and choice,
and of Icon's generators:

- `results(rel, values)` is the lazy, ordered stream of solutions. Canonical
  comes first, then the other branches, then `k = ±1`, `±2`, and so on. It
  is infinite for periodic inverses: `take(results(sine, {y: .5}), 50)` gives
  50 distinct solutions.
- `first(...)` is the function view: the canonical answer, or `null` for
  failure. This is how `sqrt` and `asin` behave as ordinary functions.
- `only(...)` succeeds only if there is exactly one result. It is a
  uniqueness assertion: `only(square, {y: 9})` fails, `only(square, {y: 0})`
  gives 0.
- Failure is the empty stream, never an exception. `asin(2)`, `0·x = 5` and
  an inconsistent overdetermined input are all just "no results".

A consumer decides how many answers it wants, so "the" inverse is
`first ∘ results`, and choosing a canonical branch is a choice of handler, not
something built into the function.

## Embedding in a node editor

`src/index.js` is the API for hosting relation nodes in a graph editor:

```js
import { defineRelation, analyze, evaluate, directions, checkWiring, results, first, only, sum, view, examples } from './src/index.js';

analyze(examples.polar, ['x', 'y'])       // derived program: steps as text + expression trees
evaluate(examples.polar, { x: 3, y: 4 })  // canonical solution + every branch
directions(examples.polar)                // [['x','y'], ['x','r'], ...] minimal input choices
checkWiring(examples.polar, ['x', 'r'], ['θ'])  // inputs wired in, outputs wired out: ok?
results(examples.sine, { y: 0.5 })      // lazy stream of every solution; first()/only()
view(sum(2), ['total', 'b'])            // { a: { symbol: '−', text: 'total − b' } }
direction(examples.square, ['y'])       // { kind: 'function', multiplicity: 'many', canFail: true, run, all }
direction(examples.polar, ['θ'])        // { kind: 'underdetermined', need: 1, completions: [['x'],['y'],['r']], with }
```

Ports wired from the enclosing function's inputs are `known`; ports wired
towards its outputs are `wanted`. A whole graph is a relation too: list its
nodes in `uses` with `bind` mapping node ports to wire names, and solving the
graph backwards inverts every node inside it.

## Layout

```
src/expr.js       expression trees, primitive table (eval, inverses, derivatives), printer
src/parse.js      tiny infix reader, used to build trees in examples and tests
src/linear.js     exact rational elimination for linear blocks
src/relation.js   relations, composition, planning, running, describing plans
src/examples.js   sumDiff, polar, sin, x², Ohm, rotate, temperature
src/syntax.js     bidirectional URL syntax
src/atoms.js      balance (Σ = Σ) and ratio (Π = Π) atoms, view() symbols
src/index.js      embedding API (analyze, evaluate, directions, checkWiring)
index.html        interactive demo
test/             node:test suites
```
