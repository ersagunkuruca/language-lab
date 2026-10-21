# Invertible, multi-directional functions

A prototype of "functions" that are relations: a node with ports and the
equations that hold between them, with no fixed inputs or outputs. You pick
which ports are known; the solver derives an ordinary program for the rest,
follows every branch of any multi-valued inverse, and marks one answer as
canonical.

```
npm test                         # 19 tests, no dependencies (Node 20+)
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
3. **Newton.** A square nonlinear block is solved numerically, with the
   Jacobian obtained by symbolic differentiation of the same trees. It finds
   one root, not the whole solution set, and the plan says so.
4. **Check.** An equation whose variables are all known becomes a check. This
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
(`polarNoLaw`) the solver falls back to Newton and finds one root, sometimes
the `r < 0` one, which shows why the law is worth having.

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

## Layout

```
src/expr.js       expression trees, primitive table (eval, inverses, derivatives), printer
src/parse.js      tiny infix reader, used to build trees in examples and tests
src/linear.js     exact rational elimination for linear blocks
src/relation.js   relations, composition, planning, running, describing plans
src/examples.js   sumDiff, polar, sin, x², Ohm, rotate, temperature
src/syntax.js     bidirectional URL syntax
index.html        interactive demo
test/             node:test suites
```
