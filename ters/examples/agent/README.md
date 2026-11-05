# agent

An agent crossing a room with a pillar in it, on a navigation mesh: the
floor cut into eight triangles by hand. `path` finds the shortest way in
two steps. A* (Hart, Nilsson and Raphael, 1968) walks from triangle to
triangle through shared edges to find which triangles the way goes
through. Then the funnel algorithm, as Mikko Mononen wrote it for Recast
and Detour ("simple stupid funnel algorithm", 2010), pulls the way tight
round their corners.

```
$ lab run examples/agent
(1, 2) → (4, 7) → (8, 9), 10.30 m
(9, 1) → (4, 3) → (2, 8), 10.77 m
```

This is step 1 of an agent with inertia (BACKLOG L122,
docs/design/physics/PHYSICS-AND-PLANNING.md §2). Corners as arcs, the
fastest speed along the path, and a follower come next.

Credits: A* is Peter Hart, Nils Nilsson and Bertram Raphael's (prior art).
Navigation-mesh pathfinding is from Douglas Demyen and Michael Buro's
"Efficient triangulation-based pathfinding" (2006) (prior art). The
funnel's code is adapted from Mikko Mononen's C++ in his blog post "Simple
Stupid Funnel Algorithm" (2010), which Recast and Detour (zlib licence)
use.
