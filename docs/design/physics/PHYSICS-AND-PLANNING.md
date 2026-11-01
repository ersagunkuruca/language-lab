# Fast bodies and agents with inertia: two questions

Written 2026-11-01 from the thread "Explore Clifford ideas for physics and
pathfinding". **Status (2026-11-01):** proposal, nothing built. The steps
are BACKLOG rows L119 to L124, all later goals.

Ersagun asked two things:

1. Can the "bullet" problem (a large step lets a fast body pass through
   another or through a thin wall) be fixed with a higher-dimensional
   representation?
2. Can A* on a navigation mesh be made continuous, for an agent with
   inertia, a limited acceleration and a top speed (by drag, or by
   rapidity instead of velocity), using a higher-dimensional analysis, or
   is it too expensive to compute?

Short answers: (1) yes, and it is cheap for the bodies Bounce has today.
The higher-dimensional picture is spacetime, and it is exactly what game
engines call continuous collision detection. (2) Yes, by searching over
position *and* velocity, which is the higher-dimensional space here. The
exact optimum is too expensive in general, but two good approximations are
practical. Geometric algebra makes both easier to write, once, for 2D and
3D; it does not make either one asymptotically cheaper.

## 1. Bodies passing through each other

### Why it happens

Bounce moves every body by its velocity times the step, then looks for
overlaps and pushes overlapping bodies apart. It only ever looks at the
start and the end of a step. A ball of radius 0.1 moving 5 units per
second with a step of 1/30 s moves 0.17 units per step, more than its own
diameter. A wall thinner than that, or a small ball coming the other way,
can sit entirely between two samples, and nothing is seen.

### The higher-dimensional view

Add time as one more axis. A ball moving at a constant velocity during a
step is no longer a disc in the plane but a slanted cylinder in
(x, y, t): its *world tube* over the step. Two balls collide during the
step exactly when their world tubes meet between t = 0 and t = dt. A wall
is a slab in spacetime, and a ball crosses it exactly when its tube meets
the slab. Nothing can slip between samples, because there are no samples.

For balls and flat walls the meeting point has a closed form:

- **Ball and ball.** With relative position d₀ and relative velocity w,
  the gap is |d₀ + w t| − (r₁ + r₂). They touch when
  |d₀ + w t|² = (r₁ + r₂)², a quadratic in t. The first root in [0, dt]
  is the time of impact.
- **Ball and wall.** The distance from a moving point to a plane changes
  linearly with t, so the time of impact is one division.

In conformal geometric algebra (Compass's Cl(3, 1), or Cl(4, 1) in 3D) a
sphere is a single vector S = c + ½(c² − r²)∞ + o, and the inner product of
two spheres is ½(r₁² + r₂² − |c₁ − c₂|²). Two spheres touch from outside
when S₁ · S₂ = −r₁r₂. Moving each sphere by a translator that grows
linearly in t keeps S₁(t) · S₂(t) a quadratic in t, so the whole test is
one line, and it is the same line in 2D and 3D. That is the honest value
of the algebra here: one definition for every dimension, which is what
Bounce already does for its step, rather than a new kind of answer. In
projective geometric algebra (Constructions' Cl(2, 0, 1)) the ball and
wall case is the point-to-plane distance, linear in t under a translator.

### What it costs

A quadratic per pair of bodies whose swept bounds overlap: about twenty
multiplications and one square root, no more than the overlap test Bounce
does now. Broad phase uses each body's bounds swept over the step instead
of its bounds at the end.

The real work is what to do after an impact is found. There are three
known answers, in order of cost:

1. **Speculative contacts.** Treat bodies that are closer than they could
   travel in one step as touching, and let the contact solver stop them
   before they cross. No extra steps, cheap, and it never tunnels; the
   price is an occasional "ghost" bump against a corner that wasn't going
   to be hit.
2. **Step to the first impact.** Move everything to the earliest time of
   impact, resolve it, and continue with the rest of the step. Exact, but
   a pile of bodies can produce many impacts per frame, so engines cap the
   number of sub-steps.
3. **Sub-step only the fast bodies.** Mark bodies whose motion per step is
   larger than their size ("bullets") and give only those continuous
   treatment against the static world.

For Bounce, option 2 with a cap is small: its bodies are all circles and
balls and its walls are planes, so every time of impact is the closed form
above. That is row **L119**.

### Rotating shapes

Once bodies spin and aren't round (boxes, polygons), the motion in a step
is a screw: a turn and a slide together. In PGA that is exactly a motor,
e^(tB), so the algebra gives the natural in-between positions for free.
The distance between two shapes along a screw motion is no longer a
polynomial in t, though, so the time of impact is found numerically. The
standard way is **conservative advancement**: from the current distance
and a bound on how fast any point can approach (linear speed plus angular
speed times the shape's radius), step forward by the largest time that
can't cause a collision, and repeat. It converges in a few iterations and
never skips an impact. That is row **L120**, after Bounce has shapes
other than balls.

A language-specific angle: "the time when these two touch" is a relation
run backwards (`gap(a at t, b at t) = 0`, solved for t), which our
language already does for numbers. For balls the closed form is faster
and should be what the compiler picks; for screw motions, conservative
advancement is a safe numeric way to solve that relation. That fits
[WAYS.md](../numbers/WAYS.md): several ways to compute one operation, the
compiler choosing by cost. It is a note for L120, not a separate row.

## 2. A* for an agent with inertia

### Why plain A* isn't enough

A* on a navigation mesh finds the shortest path for a point that can turn
on the spot. An agent with inertia can't: its velocity is part of where it
"is". Two agents at the same spot, one standing still and one running
east, have different best paths. So the search has to run over
**position and velocity together**: 4 numbers for a 2D agent, 6 for a 3D
one (and one more, time, if obstacles move). That doubled space is the
higher-dimensional analysis. It is called kinodynamic planning.

### Is the exact answer computable?

Not in general, and not cheaply. Shortest paths among obstacles in 3D are
already NP-hard (Canny and Reif, 1987). For a point mass with bounded
velocity and acceleration, Donald, Xavier, Canny and Reif (1993) gave a
provably near-optimal algorithm, but its cost grows as a high power of
1/ε (the accuracy) and exponentially with dimension. It shows the problem
is well posed; it is not something to run per frame.

### What is practical

**Step 1, decoupled (cheap, near-optimal for most maps).** Plan the shape
of the path first, then the speed along it:

1. A* over the navigation mesh's triangles, then the funnel algorithm to
   pull the path tight around corners.
2. Replace each corner by an arc whose radius the agent's clearance
   allows, so the path has no sharp turns.
3. Time-optimal speed along the path: at each point the speed is at most
   the top speed and at most √(a·R) on an arc of radius R. One forward
   pass (how fast can it be, accelerating from the start) and one
   backward pass (how fast may it be, to brake in time) give the fastest
   speed profile.
4. A follower that steers the agent along the path at that speed.

Cost: A* over a few hundred triangles plus two linear passes, well under a
millisecond per query (an estimate, not measured). What it misses: a
fast agent would sometimes do better on a wider path (taking a corner
wide, or choosing a longer road it can run on at full speed). That is row
**L122**.

**Step 2, coupled (Hybrid A*-style search in state space).** Search over
(position, velocity) states, but only keep one continuous state per cell
of a grid over that space. From each state, try a handful of *motion
primitives*: hold a constant thrust (eight directions, plus coast) for a
short time. With linear drag the motion under a constant thrust has a
closed form, so each primitive is exact and cheap:
x(t) = x₀ + (u/k)t + (v₀ − u/k)(1 − e^(−kt))/k. Each primitive's path is
checked against the navigation mesh. The heuristic is the geometric path
length from step 1 divided by the top speed, which never overestimates,
so A* stays correct.

Cost, as an estimate: a 100 m × 100 m map at half-metre cells is 40,000
position cells; with 16 velocity directions at 4 speeds plus standing
still, about 2.6 million states. A good heuristic expands a small share of
them, likely tens of thousands, nine primitives each, so a query in the
tens of milliseconds in compiled JS. Fine for a handful of agents, or
replanning a few times a second; too slow for hundreds of agents every
frame, where step 1 plus local avoidance is the right tool. That is row
**L123**, after L122, compared against it on the same map.

Sampling planners (kinodynamic RRT*) are the other family; they suit high
dimensions and robots better than game maps, where a lattice search is
more predictable. We would only look at them if L123 is too slow.

### Drag or rapidity for the top speed?

Both cap the speed smoothly. They feel different and plan differently.

- **Linear drag** (acceleration = thrust − k·velocity) gives a top speed
  of a/k. The dynamics stay linear, so motion primitives and steering have
  closed forms. Braking is easiest at high speed, since drag helps. This is
  how vehicles in games usually feel. It is the recommended model for
  planning.
- **Rapidity** treats the top speed as a speed of light c. The agent's
  velocity is a boost (a rotor in Cl(2, 1) for a 2D agent, as in the
  Spacetime page's Cl(1, 3)), and a bounded thrust is a bounded *proper*
  acceleration. Speeds compose by multiplying rotors and can never pass c,
  with no clamping. The catch: near top speed, both turning and braking
  get weak (the coordinate acceleration along the motion falls as 1/γ³,
  across it as 1/γ). An agent at full speed takes a long time to stop,
  which is right for relativity and odd for a game character. Boosts in
  different directions also don't commute, so the dynamics aren't linear
  and motion primitives need numeric integration.

  What rapidity does give for free is a bound: the agent can never leave
  its "light cone", so geometric distance / c is an exact lower bound on
  arrival time. The same bound holds with drag, so it's not a reason to
  prefer it.

Rapidity is a lovely demo, a sibling of the Spacetime page: the same path
driven with drag and with a rapidity cap, side by side. That is row
**L124**, optional.

### Where geometric algebra helps, honestly

It doesn't change the search's cost. It helps in writing it: one planner
for 2D and 3D agents (as Bounce does for physics); a vehicle's pose as a
PGA motor, so car-like agents (which Hybrid A* was made for) turn and
move in one product; and the boost formulation above. Velocity obstacles
for local avoidance (step 1's partner for crowds) are a cone in velocity
space, which also reads naturally as geometry.

The search itself fits the language as it is: `routes` already has a
Dijkstra frontier, and A* is that frontier ordered by cost plus heuristic.

## Steps

| row | step | size |
|---|---|---|
| L119 | Bounce: time of impact for ball and ball (a quadratic) and ball and wall (linear), written once for 2D and 3D, stepping to the first impact with a cap on sub-steps; a "bullet through a thin wall" case beside the plain step | M |
| L120 | Rotating shapes: time of impact along a PGA motor (screw motion) by conservative advancement; after Bounce has shapes other than balls | L |
| L121 | Speculative contacts in Bounce, compared with L119 on the same scene (cost per frame, ghost bumps) | S |
| L122 | Agent with inertia, decoupled: navigation-mesh A*, the funnel, corners as arcs, the time-optimal speed profile, a follower; a page with one agent and a hand-made mesh | L |
| L123 | Agent with inertia, coupled: a Hybrid A*-style search over position and velocity with drag-exact motion primitives and the step-1 heuristic; compared with L122 on the same map | L |
| L124 | A rapidity speed cap (velocity as a boost in Cl(2, 1)) beside linear drag, on L122's page | M |

## Credits

Everything above is prior art except where a step says ours. Each row
that gets built credits these in its code, its page and
[CREDITS.md](../../language/CREDITS.md).

| What | Label | Who and where |
|---|---|---|
| The question, and rapidity as a speed cap | Ersagun's idea | Ersagun, 2026-11-01 |
| Time of impact, swept bounds, sub-stepping to the first impact, speculative contacts | Prior art | Erin Catto, Box2D, and his GDC talk "Continuous Collision" (2013); speculative contacts as described by Paul Firth (2011); Bullet Physics (Erwin Coumans), its swept-sphere CCD |
| Conservative advancement | Prior art | Brian Mirtich, *Impulse-based Dynamic Simulation of Rigid Body Systems* (PhD thesis, 1996); Xinyu Zhang, Stéphane Redon, Minkyoung Lee and Young J. Kim, "Continuous collision detection for articulated models using Taylor models and temporal culling" (2007) |
| Continuous collision along screw motions | Prior art | Stéphane Redon, Abderrahmane Kheddar and Sabine Coquillart, "Fast continuous collision detection between rigid bodies" (2002) |
| Collisions as intersections in spacetime | Prior art | Brian Von Herzen, Alan Barr and Harold Zatz, "Geometric collisions for time-dependent parametric surfaces" (1990) |
| Spheres as vectors in conformal GA, motors as screw motions in PGA, rigid-body dynamics in PGA | Prior art | Hestenes, Li and Rockwood (2001); Dorst, Fontijne and Mann, *Geometric Algebra for Computer Science* (2007); Charles Gunn and Steven De Keninck, "Geometric Algebra for Computer Graphics" (SIGGRAPH 2019) and "May the Forque Be with You: Dynamics in PGA" (bivector.net) |
| Hardness and approximation of kinodynamic planning | Prior art | John Canny and John Reif (1987); Bruce Donald, Patrick Xavier, John Canny and John Reif, "Kinodynamic motion planning" (JACM, 1993); Steven LaValle, *Planning Algorithms* (2006) |
| Hybrid A*, state lattices | Prior art | Dmitri Dolgov, Sebastian Thrun, Michael Montemerlo and James Diebel, "Path planning for autonomous vehicles in unknown semi-structured environments" (2010); Mihail Pivtoraiko, Ross Knepper and Alonzo Kelly, state lattices (2009) |
| Kinodynamic RRT* | Prior art | LaValle and Kuffner, kinodynamic RRT (2001); Sertac Karaman and Emilio Frazzoli, RRT* (2011); Dustin Webb and Jur van den Berg, "Kinodynamic RRT*" (2013) |
| Navigation-mesh A* and the funnel | Prior art | Douglas Demyen and Michael Buro, "Efficient triangulation-based pathfinding" (2006); Mikko Mononen, Recast and Detour, and his "simple stupid funnel algorithm" (2010) |
| Time-optimal speed along a path | Prior art | J. E. Bobrow, S. Dubowsky and J. S. Gibson (1985); Kang Shin and Neil McKay (1985) |
| Steering a follower, velocity obstacles | Prior art | Craig Reynolds, "Steering behaviors for autonomous characters" (1999); Paolo Fiorini and Zvi Shiller (1998); Jur van den Berg, Ming Lin and Dinesh Manocha, RVO (2008) |
| Planning with time as an axis | Prior art | David Silver, "Cooperative pathfinding" (2005) |
| Boosts as rotors, rapidity | Prior art | David Hestenes, *Space-Time Algebra* (1966); Alfred Robb, rapidity (1911) |
