# Clifford algebra demos: what they found (2026-10-31)

Ersagun asked (2026-10-31) for a few demos written with the prelude's
Clifford functions (`clifford table`, `table product`, `clifford sandwich`,
`reflect`, `project`, `exp`, #716), mainly to find where the implementation
falls short. Three are planned, one PR each: a physics simulation that works
in 2D and 3D, a geometry construction tool, and a relativity or
electromagnetism calculator in spacetime algebra. This report collects what
each one found. The gaps are rows in [BACKLOG.md](../../BACKLOG.md) and are
not fixed in the demo PRs.

## 1. Bounce: one physics step in two and three dimensions

`projectional/examples/bounce`, built as `apps/bounce.html`. Rigid bodies
bounce in a box: a triangle, a square, a pentagon and a hexagon in the plane,
and a tetrahedron, two cubes and an octahedron in space. `step`, `moved`,
`off the walls`, `bounced` and `outline` are written once, generic over the
multivector type, and given a `Space` value: the signature (`[1, 1]` or
`[1, 1, 1]`), the basis, the box's axes, which way is down, and the camera's
rotor. Positions and velocities are vectors, turns are rotors, spins are
bivectors (`clifford exp(−dt/2 · spin)` each frame), a wall reflects a
velocity (`clifford reflect`), and two bodies that meet swap the part of
their closing velocity along the line between them (`clifford project`).

What worked: the same definitions run both worlds with no change, which is
what Ersagun asked for, and the checker infers them as generic over the
multivector (`step : (Space a, List (Body a)) -[Diverge]-> List (Body a)`).
Composing the camera's rotor with each body's rotor once per body, so each
corner takes one sandwich, is ordinary geometric algebra and needed nothing
new.

### Gaps

| # | gap | measured | row |
|---|---|---|---|
| B1 | **A Clifford product costs about 200 times what it should.** `table product` folds over the table's 64 lines and makes records for each; the table itself is rebuilt by every `clifford sandwich`, `reflect`, `project` and `exp` call, which take `(squares, basis)` and not a built algebra. | Before #724, Cl(3, 0), compiled JS: one product 0.10 ms, one table 0.075 ms, one sandwich 0.28 ms (hand-written: 64 multiply-adds, well under a microsecond). One frame of the solid world: step 1.6 ms, drawing 7.3 ms. Evaluated (the editor's page preview): step about 90 ms, drawing about 285 ms, so the page would show a few frames a second there. | L41, now partly done by C65 (#724) for calls with the algebra written down; see B8 |
| B2 | **A page has no frame event.** Stepping a simulation needs a handler (views can't write), so the page hides a `div` with an endless 16 ms CSS animation and steps on its `animationiteration`. Tumble does the same with `animationend`. | two examples write around it | new row, P2 |
| B3 | **No grades in the types.** A position, a spin and a rotor are all `Solid`, the whole 8-part multivector. Nothing stops passing a rotor where a vector goes, and every vector carries 5 zeros. | 3D bodies carry 8 numbers per vector, 4 needed | L43 (grade inference) |
| B4 | **Multivectors are written by position.** `vec3(x, y, z)` puts x, y, z at parts 1, 2 and 4 (the basis order is 1, e₁, e₂, e₁₂, e₃, …), and a spin in e₁₂ + e₁₃ is `solid(0, 0, 0, 2, 0, 1, 0, 0)`. A program can't write `2 e₁₂ + e₁₃`. | every literal multivector in the demo | new row |
| B5 | **Changing one field of a record means writing all of them.** `Body` has 8 fields; moving a body rebuilds it with 7 unchanged. The builder hides this behind a helper; in the editor it is 8 ports per update. | 4 places in the demo | new row |
| B6 | **No item-at-index for lists.** Edges name their corners by number, so the demo writes its own `nth`, as Tumble does. | two examples write around it | new row, P2 |
| B7 | **Pairwise collision is inferred Diverge.** `bump pairs` recurses on the list `bump into each` gives back inside a Pair, which the checker can't see is shorter, so `step` says it may not finish. | `step` carries Diverge | new row, P3 |
| B8 | **C65 (#724) doesn't reach generic code.** Since #724 a clifford call whose squares and basis are written down is worked out when compiled: a Cl(3, 0) product or sandwich written that way now takes about 1 µs. Bounce's step takes its algebra from a `Space` value, which is what lets one definition run both worlds, so none of its calls are worked out, though `flat` and `solid` are constants. Specialising a function on a constant argument (here, the space) would let generic code have both. | after #724: product and sandwich written down 0.001 ms; Bounce's step 1.6 ms and drawing 9.3 ms, unchanged | new row |

## 2. Constructions: ruler-and-set-square geometry in plane PGA

`projectional/examples/constructions`, built as `apps/constructions.html`. A
small dynamic geometry tool, of the kind GeoGebra is, written from scratch
in Cl(2, 0, 1). Lines are vectors a e₁ + b e₂ + c e₀ and points are
bivectors e₁₂ + x e₂₀ − y e₁₀. The tools are new point, line (join),
intersection (meet), perpendicular (l · P), parallel, midpoint, mirror
point (`clifford reflect`) and turn by 60° (`clifford exp` and
`clifford sandwich`). A construction is a list of steps that name earlier
shapes. It opens on a triangle with its altitudes and orthocentre, and
dragging a corner rebuilds everything, so the third altitude stays on H.
Parallel lines meet at a point at infinity, with no special case.

What worked: every construction is one or two products. With the algebra
written down as definitions (`squares`, `basis`, `table`), C65 (#724)
works the products out when compiling, and building the whole opening
construction takes 0.02 ms in compiled JS (1.5 ms before #724).

### Gaps

| # | gap | measured | row |
|---|---|---|---|
| G1 | **A page's events don't say where the pointer is.** `Event` has only `value` and `key`. Placing and dragging points uses a grid of 576 transparent SVG squares, each with its own `pointerdown` and `pointerenter`, so points snap to half units. | 576 elements of workaround | new row |
| G2 | **A `part` can't sit inside an SVG.** A part is a `lab-part` HTML element, so the picture can't redraw only the shapes. The page stacks two SVGs: the paper, drawn once, and the shapes, redrawn as a whole. | two SVGs and `pointer-events` rules | new row |
| G3 | **The prelude has the geometric product, but not the outer or inner product, the dual, the regressive product or grade selection.** The demo writes ½(ab − ba) and ½(lP − Pl), which only work for vectors and for vector-on-bivector, and writes the Poincaré dual out part by part for its own record type. | 3 helpers written around it; `dual` works only for this record | new row |
| G4 | **No list update-at-index.** Dragging replaces one step, so the demo writes `replaced` beside its own `nth` (B6). | third example writing `nth` | I83 widened |
| G5 | **relate needs about 6,400 steps to check one `clifford reflect`,** over the agreement test's budget of 5,000, so the test reports a disagreement where there is none. `mirror` is written inline in `made` instead of as its own definition. | 6,395 steps for one call | new row |
| G6 | **The agreement test skipped a NaN only when it was the whole answer, not inside a record.** A point with no weight (sampled as all zeros) gives a record of NaNs, which it reported as a disagreement. Fixed in this PR, since it is the test's own rule, applied one level down. | `midpoint` and `turned` | fixed here |

## 3. Spacetime: relativity and electromagnetism in Cl(1, 3)

`projectional/examples/spacetime`, built as `apps/spacetime.html`. Sliders
set two speeds β₁ and β₂ and a field (E along y, B along z). The page has
three cards:

- **Boosts.** A boost along x is `clifford exp(φ/2 · σ₁)`, and the speed
  after two boosts is read off R₂R₁ γ₀ (R₂R₁)~. It equals (β₁ + β₂)/(1 + β₁β₂)
  without that formula being written anywhere.
- **The field a moving observer sees.** It is F′ = R̃ F R. E′ and B′ are read
  off as ⟨F′σₖ⟩ and the I part of F′σₖ, and the two invariants of F²
  stay the same.
- **A charge in that field.** It starts at rest, and each proper-time step
  turns its four-velocity by the one step rotor e^(dτF/2) (Hestenes). With
  B > E it loops and drifts along E × B, with E > B it runs away, and
  with E = B the rotor is 1 + dτF/2. These are the three cases of
  `clifford exp`, shown live.

What worked:

- Every number on the page is a product in one algebra, and the formulas
  shown beside them are only there to compare.
- Reading a typed number back with `inverse(show, …)`, the converter's
  trick, works for the sliders too.
- With the algebra written down, C65 (#724) makes the 400-step path take
  2 ms in compiled JS. The same path took about 300 ms for 240 steps
  before #724.

### Gaps

| # | gap | measured | row |
|---|---|---|---|
| S1 | **`clifford exp` needs a bivector whose square is a number.** An electromagnetic field with E·B ≠ 0 squares to a number plus an I part, so the charge's step rotor can't be made, and the page only offers E ⟂ B. Splitting F into commuting parts (F = F₁ + I F₂ … the invariant decomposition) or a series would cover it. | E and B fixed at right angles | new row |
| S2 | **The evaluator doesn't get C65.** The path that compiled JS makes in 2 ms takes about 8 s in the evaluator, so the page can't run in the editor's preview. | 8 s against 2 ms | I79 |
| S3 | **No way to show a number to a fixed number of decimals.** The page writes `rounded` (floor(1000x + ½)/1000), as other pages do with their own helpers. | one helper | new row |
| S4 | **Reading a blade's part means matching all 16 parts.** `scalar part` and `pseudoscalar part` each name 16 fields to take one, and E′ and B′ need a product with σₖ to get at a part (see B4). | two helpers | I81 widened |
| S5 | **relate run backwards through a Cl(1, 3) product doesn't stop at its step budget.** Given only the answer, relating `times` (a 256-line table product of two unknowns) ran for minutes, and the agreement test ran out of memory. Run forwards, it stays within budget (4,753 steps). Constructions' 8-part product was fine. The demo writes `times`, `moved by`, `along` and `velocity of` inline instead of as definitions. | the agreement test runs out of memory | new row, P2 (a bug) |

