# agent

An agent crossing a room with a pillar in it, on a navigation mesh: the
floor cut into eight triangles by hand. `path` finds the shortest way in
two steps. A* (Hart, Nilsson and Raphael, 1968) walks from triangle to
triangle through shared edges to find which triangles the way goes
through. Then the funnel algorithm, as Mikko Mononen wrote it for Recast
and Detour ("simple stupid funnel algorithm", 2010), pulls the way tight
round their corners. Then the agent drives it: each corner is rounded by
an arc 0.5 m from it, as fast as its acceleration (2 m/s²) holds it on the
arc, and a forward and a backward pass over the legs give the fastest
speed everywhere, starting and ending at rest, with a top speed of 3 m/s.

Then `place at` follows it over time: each leg is driven in three
phases (speeding up, holding the peak, braking), and each leg is a
quadratic Bézier curve, its bend the leg's middle on a straight and the
corner on an arc. The page (main) draws the room, its triangles, the
pillar, the way and the agent, and moves the agent by the frame event's
seconds: one trip, a second's rest, the other trip, again and again.

The mesh's hole is the pillar grown by the agent's radius on every side
(`pillar` is the pillar itself), as Recast builds its meshes, so the
path's corners are where the agent's middle turns.

```
$ ters build-web examples/agent -o agent.html
```

The page writes each trip's line too:
"(1, 2) → (4, 7) → (8, 9), 10.30 m in 5.79 s" and
"(9, 1) → (4, 3) → (2, 8), 10.77 m in 6.02 s".

Beside it, in orange, the coupled search (L123, step 2 of
docs/design/physics/PHYSICS-AND-PLANNING.md §2), Hybrid A*-style: A*
over place and velocity at once. Each step holds one of nine thrusts
(none, or 2 m/s² one of eight ways) for half a second, moved exactly
under linear drag (top speed 3 m/s), checked on the mesh four times
along the way, and the search keeps one state for each cell of a 0.5 m
grid, a quarter of the top speed and a sixteenth of a turn. Its estimate
is the straight line to the goal at the top speed. It is done within
half a metre of the goal, slower than half a metre a second.

| trip | path, then speed | coupled search |
|---|---|---|
| (1, 2) to (8, 9) | 5.79 s | 6.00 s, 5,217 states |
| (9, 1) to (2, 8) | 6.02 s | 6.00 s, 5,308 states |

The coupled one takes the corners wide to keep its speed, and is no
faster here: its choices come every half second, and drag slows it near
the top speed where the first one's acceleration doesn't. Both searches
run when the page starts, in 0.8 s compiled: Map and Priority queue
are weight-balanced trees there (BACKLOG C186; as entry lists they took
9 s). L122's path length from each cell as the
estimate, which the design note proposed, was measured in a JavaScript
prototype first: on this map it looked at as many states (about 4,900
against 5,100), so the straight line stays.

Two chasers follow the blue agent (L124), thrusting at it as hard as
they can, 2 m/s², at the target less half a second of their own
velocity. Both have a top speed of 3 m/s, held two ways (§"Drag or
rapidity for the top speed?" in the design note):

- the green one has linear drag, so its speed levels off at 3 m/s
  (`drag step`, moved exactly as the coupled search moves);
- the purple one has a speed cap like light's. Its velocity is a boost
  in Cl(2, 1), the plane and time (`Plane time`, made by `clifford
  algebra` from the squares −1, 1, 1), and each frame's thrust is a
  small boost e^(½ dφ d e0) multiplied on its right, with dφ = a·dτ/c
  and dτ = dt/γ (`rocket step`). Its speed only gets closer to 3 m/s,
  and near it the rocket turns and brakes weakly, so it overshoots the
  goal where the green one stops.

The page says both speeds and the rocket's γ each frame. Neither chaser
sees the pillar.

Credits (on the page too): A* is Peter Hart, Nils Nilsson and Bertram Raphael's (prior art).
Navigation-mesh pathfinding is from Douglas Demyen and Michael Buro's
"Efficient triangulation-based pathfinding" (2006) (prior art). The
funnel is D. T. Lee and Franco Preparata's (1984); its code here is adapted from Mikko Mononen's C++ in his blog post "Simple
Stupid Funnel Algorithm" (2010), which Recast and Detour (zlib licence)
use.
The fastest speed along a fixed path by a forward and a backward pass is
J. E. Bobrow, S. Dubowsky and J. S. Gibson's and Kang Shin and Neil
McKay's (1985) (prior art).
The hole grown by the agent's radius is Tomás Lozano-Pérez and Michael
Wesley's configuration space (1979) (prior art).
The coupled search is Dmitri Dolgov, Sebastian Thrun, Michael Montemerlo
and James Diebel's Hybrid A* (2010) (prior art).
Boosts as rotors are David Hestenes' space-time algebra (1966), and
rapidity is Alfred Robb's (1911) (prior art).
