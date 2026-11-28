# Rigid bodies (design note for BACKLOG G19, 2026-11-28)

BACKLOG G19, from GAME-READINESS-2026-11-17: rigid bodies, with a broad
phase, a narrow phase, a solver by sequential impulses, and a way for
fast bodies not to pass through. G20 then measures it at scale against
hand-written C. This note says where the bodies go, what each phase is,
and in which steps they are built.

## Where they go

Ters has bodies already, but none that turn and stack:

- bounce has balls with speculative contacts (L119, L121).
- impact has a stick's first touch of a wall (L120).
- agent has a body with inertia (L123).

No example has bodies that rotate, rest on each other and push with
friction. The rule of no new examples holds (Ersagun 2026-11-25). The
G12 to G19 exception is rain-page, so the bodies go there, as the wall
and the probes did.

**Hail on the sill.** Now and then the rain turns to hail. Stones of ice
strike the glass, slide down it and land on the window's sill along the
bottom of the pane, where they bounce, tumble and pile up. Some stones
are round (discs) and some are chips (boxes), so the pile has both
rolling and resting. The hand that wipes the glass pushes the stones
along the sill, and a wipe sweeps them off its end. The stones melt
slowly, so the pile never fills the pane.

The scene is still flat: the stones move in the plane of the glass, with
gravity down the pane. Bodies are 2D: a place, an angle, a velocity, a
spin. The stones are drawn on the GPU as instances over the glass, as the
drops are, and lit by the probes (G18).

## The phases

A tick is these phases, in this order, at the page's fixed 1/60 s:

1. **Forces.** Gravity, then the velocities step forward.
2. **Broad phase.** Pairs whose bounds overlap, found by a uniform grid
   over the sill's strip. This is the same grid as `within reach` (G15b),
   written in Ters over the stones' places. Sweep and prune or a BVH come
   only if the grid measures worse at G20's scale.
3. **Narrow phase.** Contacts of each pair, as a manifold of points with
   a normal and a depth:
   - disc and disc, or disc and sill: one point;
   - box and box: separating axes, then the incident edge clipped to the
     reference face, so up to two points (Gregorius 2013, Box2D Lite).
4. **Solver.** Sequential impulses (Catto 2005, 2006). Each contact keeps
   its accumulated normal and friction impulse, clamped, not the impulse
   of one pass. Ten passes a tick. It is warm-started: a contact that
   persists from the last tick, matched by its pair and its features,
   starts from last tick's impulses, so a pile rests instead of
   jittering. Overlap is pushed out by a bias on the velocity
   (Baumgarte), a share of the depth past a small slop.
5. **Integrate.** Places and angles from the solved velocities.
6. **Fast stones.** A stone striking the glass is fast next to its size.
   Contacts are made speculatively (Firth 2011, Catto's "Continuous
   collision", 2013): a pair closer than it could close in a tick gets a
   contact whose distance may be positive, and the solver lets it close
   only that far. So a stone stops at the sill rather than passing
   through it, as bounce's balls do (L121). Conservative advancement
   (impact, L120) is kept for what this misses, if anything does.

Everything is a pure tick from one sill to the next, so the language's
side is ordinary code. The solver's passes are the one sequential part,
since each contact's impulse changes the next contact's velocities.
Within a pass, contacts are solved in the order of the pairs, the same
on every target. The solver is written over Arrays of the bodies'
velocities, read and written at places (C354's arrays). The compiler
chooses the representation, as for any program. If the passes write
arrays in place it is a find for the compiler; if they copy, that is a
gap for G20.

## What it tests

- Mutation in place: an Array of velocities written ten times per tick,
  one contact at a time. This is where a pure language usually copies.
- Small records in tight loops: contacts, manifolds, the 2D cross
  products.
- The grid: Ints and lists of Ints, as the moths' hash (G3).
- Persistent state across ticks: the contacts kept for warm starting, a
  Map from a pair to its impulses.
- Reproducibility: the same ticks give the same pile on every target,
  since sums stay in order (2026-11-26).

## Steps

- **G19a**: round stones only, on the sill and on each other. Forces,
  the grid, disc contacts, the sequential impulses with friction and
  warm starting, drawn on the GPU. Measured: a tick for 200 stones, and a
  pile that comes to rest.
- **G19b**: chips (boxes) with their angles. Separating axes and clipped
  manifolds, and box on box, box on disc, box on sill. Measured: a stack
  of five chips that stands.
- **G19c**: the hand as a body that moves where it is put, not by
  forces, pushing the stones; a wipe sweeps them off the sill.
- **G19d**: speculative contacts for the stones striking the glass. A
  test shoots a stone at ten times its speed, and it doesn't pass the
  sill.
- **G19e**: the measures for G20: ticks for 200, 1,000 and 5,000 stones;
  where the time goes (broad phase, narrow phase, solver); whether the
  solver's arrays are written in place.

## G19a, built (2026-11-28)

`Hail` is a field of rain-page's `Pane`: the stones (`Stone`: an id, a
place, an angle, a velocity, a spin and a radius, in glass heights), the
impulses each touch kept from last tick (a `Map (Int, Int) Push`, by the
pair's ids, the frame's sides numbered below zero), and a seed.
`hail ticked` is the tick: the stones fall and melt (`fallen`), one is
added every fifth tick while it hails, `touches of` finds the touches
(`neighbours` within 0.06 for the pairs, then the frame's three sides),
`solved` warms the stones by last tick's impulses and runs ten `pass`es
of `applied` over the touches, and `stone moved` integrates.

What the first runs showed:

- Discs on a flat sill roll for ever, since friction at a rolling
  contact does no work. A pile only came to rest with a drag on the spin
  (`rolling drag`, 3 a second, Box2D's angular damping), so that went in.
- A stone that melts off its touch falls one tick before it touches
  again, so a resting stone shows a speed of up to one tick of gravity
  (0.025). Speculative touches (G19d) would close that gap.
- Each pass walks the touches in the order the last pass left them,
  which reverses them; on every target the same.
- `replace at` on the stones is the Array's constant replace (Baker's
  shallow binding, C93c), not a copy. A tick for 110 to 120 stones is 2
  to 4 ms compiled to JavaScript (a profile: 17% collecting garbage, the
  rest in `applied` and the records it makes). Melting keeps the pile
  near 120, so the 200-stone measure moves to G19e, with a pile made for it.
- `ticked` first built the pane after the hail's tick in one expression,
  `pane(map(p.drops, …), …, hail ticked(p.hail, p.tick))`. The drops'
  slide then waited in the call's join closure, and the compiler, which
  keeps a list on the GPU only when the map's answers go straight into
  the record, brought the drops back from the GPU every tick, with no
  word (gpu-resident.test caught it). `ticked` ticks the hail first now;
  C368 is the compiler's row to follow answers through the closure.
- The stones' draw is a third draw on the GPU.

Test: rain.test, 30 stones fall, rest on the sill and deep in no other
stone, the fastest slower than a tick of gravity.

## G19b, built (2026-11-28)

A stone has `chip: Bool`; four in ten are chips, a box `radius` across
each way from its middle and half that thick, struck turned and spinning.
`chips touch` tries the two chips' four sides as separating axes
(`overlap along`, `half across`), takes the least overlap's face as the
reference, finds the incident face on the other (`facing most`), clips it
to the reference face's sides (`clipped`) and keeps the points below the
face: two for a chip lying on a chip, so it stays level. A chip on the
sill (`frame touches`, `corner touch`) is its corners below it; a chip on
a disc (`disc on chip`) the disc's nearest point on the box. Every touch
then goes to G19a's solver as before, with the lever arm from each
middle, so chips turn as they are pushed.

Found on the way: a draw whose instances hold a Bool was refused for
compiled pages ("data holding a Bool"), as every host builtin given one
is. A draw hands its instances to no function of the evaluator's: the
frame writes a Bool leaf as a word from a boolean or the evaluator's True
(gpu-frame.ts `put`), and on the CPU only the program's own functions see
them. So scalar.ts takes the draw before that refusal.

Measured: five chips stacked on the sill stand for 240 ticks, each on the
one below, level and at rest (rain.test). Hail of chips and discs piles
up with no stone in the sill.

## What stays out

- **3D bodies.** rain-page is flat.
- **Joints.** No hinge or rope; contacts only.
- **Sleeping and islands**, unless G19e shows a resting pile is most of
  the cost.
- **The solver on the GPU.** Sequential impulses are sequential. A
  parallel solver (Jacobi, or graph colouring) is a G20 question if the
  CPU tick is too slow.

## Credits

Each is credited in the code, rain-page's README, CREDITS.md and the
page's credits line, where it is used.

- Sequential impulses, accumulated and clamped, warm starting: Erin
  Catto, "Iterative dynamics with temporal coherence", GDC 2005, and
  "Fast and simple physics using sequential impulses", GDC 2006; Box2D
  Lite.
- Contact manifolds by clipping: Dirk Gregorius, "Robust contact
  creation for physics simulations", GDC 2013; separating axes after
  Stefan Gottschalk, Ming C. Lin and Dinesh Manocha, "OBBTree", SIGGRAPH
  1996.
- Speculative contacts: Paul Firth, "Speculative contacts: a continuous
  collision engine approach", 2011; Erin Catto, "Continuous collision",
  GDC 2013.
- Position correction by a velocity bias: Jürgen Baumgarte,
  "Stabilization of constraints and integrals of motion in dynamical
  systems", 1972.
- A uniform grid as the broad phase: as for the moths (G3), after Craig
  Reynolds's bin-lattice spatial subdivision.
