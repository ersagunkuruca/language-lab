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

```
$ lab run examples/agent
(1, 2) → (4, 7) → (8, 9), 10.30 m in 5.79 s
(9, 1) → (4, 3) → (2, 8), 10.77 m in 6.02 s
Credits: …
```

This is step 1 of an agent with inertia (BACKLOG L122,
docs/design/physics/PHYSICS-AND-PLANNING.md §2). A follower and a page
come next.

Credits (printed by main too): A* is Peter Hart, Nils Nilsson and Bertram Raphael's (prior art).
Navigation-mesh pathfinding is from Douglas Demyen and Michael Buro's
"Efficient triangulation-based pathfinding" (2006) (prior art). The
funnel is D. T. Lee and Franco Preparata's (1984); its code here is adapted from Mikko Mononen's C++ in his blog post "Simple
Stupid Funnel Algorithm" (2010), which Recast and Detour (zlib licence)
use.
The fastest speed along a fixed path by a forward and a backward pass is
J. E. Bobrow, S. Dubowsky and J. S. Gibson's and Kang Shin and Neil
McKay's (1985) (prior art).
