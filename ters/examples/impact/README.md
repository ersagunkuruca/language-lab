# impact

When a spinning stick first touches a thin wall, found by conservative
advancement along a motor of 2D projective geometric algebra (BACKLOG
L120, docs/design/physics/PHYSICS-AND-PLANNING.md "Rotating shapes").

A stick 40 cm long and 5 cm thick is thrown from the origin at a wall
5 cm thick, 5 m away, spinning. A plain step a frame (60 a second) looks
at it once a frame. At 80 m/s it is on one side of the wall at one frame
and past it at the next, so the step never sees it touch.

Conservative advancement (Brian Mirtich, 1996) doesn't miss it. A frame's
motion, a slide and a turn about the stick's middle, is one turn about
another point (`screw centre`, Chasles' theorem). In PGA that turn is a
motor e^(−sφ/2 c), and `moved by` takes each corner along it by a
sandwich (`clifford sandwich` in Cl(2, 0, 1), made by `clifford
algebra` from the squares 0, 1, 1). No corner moves faster than |φ|
times its farthest corner's distance from c (`reach`). So the gap to the
wall divided by that is a part of the frame in which the stick can't
reach the wall. `advance` moves it that far and repeats until the gap is
under a tenth of a millimetre or the frame is over.

Then the same against a body that moves too (L120b): a plank 2 m tall
and 5 cm thick, 5 m away, turning slowly about its middle. Each body has
its own frame's motor. The gap is the distance between the two polygons
(`between`: 0 when the separating axis theorem finds no edge with the
other wholly outside it, else the nearest corner to an edge). No two of
their points close faster than the sum of what each can move.

```
$ lab run examples/impact
At 60 m/s, spinning 20 rad/s: a step a frame finds it in the wall at frame 5 (0.0833 s); conservative advancement finds it touching at 0.0826 s, in 12 steps.
At 80 m/s, spinning 15 rad/s: a step a frame never finds it in the wall; conservative advancement finds it touching at 0.0611 s, in 11 steps.
At 60 m/s at a plank turning 1.0 rad/s: a step a frame finds them overlapping at frame 5 (0.0833 s); conservative advancement finds them touching at 0.0825 s, in 14 steps.
At 80 m/s at a plank turning 1.0 rad/s: a step a frame never finds them overlapping; conservative advancement finds them touching at 0.0607 s, in 11 steps.
Credits: …
```

Both times match a JavaScript prototype that turns the corners with
cos and sin rather than a motor. `lab test examples/impact` checks main's
answer, and with `--compiled` checks it compiled too.

Every body must spin: a frame's motion with no turn is a slide, which
`screw centre` can't make a turn of. What L120 leaves: the compiler
choosing this or a closed form by cost (WAYS.md).

Credits (printed by main too): conservative advancement is Brian
Mirtich's, *Impulse-based Dynamic Simulation of Rigid Body Systems*
(PhD thesis, 1996) (prior art). That any motion of the plane that turns
is a turn about one point is Michel Chasles' theorem (1830) (prior art).
Plane geometric algebra with e0 squaring to 0, and motors in it, are
Charles Gunn's (*Geometry, Kinematics, and Rigid Body Mechanics in
Cayley-Klein Geometries*, PhD thesis, 2011) (prior art). The way a point
is written, x e20 + y e01 + e12, follows Steven De Keninck's ganja.js
and bivector.net (influence).
The separating axis theorem for convex shapes is Hermann Minkowski's
hyperplane separation (1896) (prior art).
