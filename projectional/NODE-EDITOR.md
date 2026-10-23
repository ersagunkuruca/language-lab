# Node editor pitfalls, and our answers

Node editors have been around for a long time: Unreal Blueprints, Blender's
node editors, Houdini, Max/MSP, Unity Shader Graph, World Machine and many
more. The same complaints come up about all of them. This note lists the
ones that matter for our graph view, says what the usual fixes are and where
they come from, and says what we do. The graph code is
`projectional/editor/typedGraph.ts` (what to draw), `editor/graphLayout.ts`
(where things go and how wires cross; plain geometry, no DOM, unit-tested in
`test/graphLayout.test.ts`) and `editor/canvas.ts` (the window onto it).

Sources this draws on, credited per the project's attribution rule:

- M. Burnett et al., [Scaling Up Visual Programming Languages](https://web.engr.oregonstate.edu/~burnett/Scaling/ScalingUp.html), IEEE Computer, 1995. The classic list of why visual programs stop working when they grow ("static representation", "effective use of screen real estate").
- Uhiyama Lab, [10 techniques for organizing Blueprint graphs](https://uhiyama-lab.com/en/notes/ue/blueprint-spaghetti-code-prevention-techniques/). What Unreal users do about "spaghetti": reroutes, local variables, alignment, left-to-right flow, comment boxes.
- World Machine forum, [Please improve wire readability](https://forum.world-machine.com/t/please-improve-wire-readability-with-these-features/6395). Overlapping wires, and "wire portals" (named nodes that continue a wire elsewhere, like Unreal's named reroutes).
- SideFX, [Houdini: organizing networks](https://www.sidefx.com/docs/houdini/network/organize.html). Layout, network boxes that move with their contents, dots that route wires around nodes.
- Blender manual, [Node Wrangler](https://docs.blender.org/manual/en/3.3/addons/node/node_wrangler.html). Align nodes, frames, reroutes, lazy connect.
- Cycling '74, [Max `send~`](https://docs.cycling74.com/reference/send~/). Send/receive pairs: a named wire with no line at all.
- Microsoft, [Visio connector line jumps](https://support.microsoft.com/en-US/Visio/add-or-remove-connector-line-jumps). The "hop" where one line crosses another, from circuit diagrams.
- K. Sugiyama, S. Tagawa, M. Toda, "Methods for visual understanding of hierarchical system structures", IEEE SMC, 1981, as taught in [KIT's graph visualization lectures](https://i11www.iti.kit.edu/_media/teaching/winter2019/graphvis/graphvis-ws19-v11.pdf). Layered left-to-right drawing and the barycenter rule for ordering nodes to cut crossings.

## The pitfalls

| # | Pitfall | What others do | What we do |
|---|---|---|---|
| 1 | **Spaghetti.** Long wires cross each other and run behind nodes; you can't tell where a wire goes. | Reroute dots (Blender, Unreal, Houdini), wire portals / named reroutes (Unreal, World Machine), send/receive (Max), line hops (Visio). | Crossings that remain are drawn: a **bridge** (a small hop) where a wire passes over another, and a **tunnel** (the wire fades out at the node's edge and back in on the other side) where it passes under a node. A wire that would pass under a node bends over or under it instead, when that's a short detour that crosses no more of the wires drawn before it. Any value can be shown as a **named let node with get nodes** instead of wires (pitfall 4). Tidy (pitfall 3) moves nodes off wires. |
| 2 | **Clutter from previews.** Inline values and labels pile on top of each other. | Blender and Houdini show previews in a node's body, which makes nodes big; most others hide them. | Values are small chips placed by a label placer: each tries a few spots near its output (above, below, along the wire) and takes the first that doesn't cover a node or another chip. A chip with no free spot shrinks to a dot; hovering shows it. Chips never move nodes. |
| 3 | **Manual layout is busywork, automatic layout throws your work away.** | Auto-arrange add-ons (Blueprint Assist, Blender's Node Arrange), Houdini's layout tool. They lay out everything, often ignoring wires. | Positions are **free and absolute**: a node is where you put it, not an offset from what it feeds, so moving one never drags others along. Unmoved nodes take the automatic place. **Tidy** spaces out all nodes or just the selected ones: it reorders each column so fewer wires cross (Sugiyama's barycenter step, kept only where it helps), removes overlaps, keeps each frame's contents together, pushes nodes off wires that run through them unless that crosses other wires, and keeps inputs to the left of what they feed. It starts from where things are, so it only moves what it has to. **Reset layout** goes back to the automatic one. |
| 4 | **Variables as wires don't scale.** A value used in ten places is ten long wires. | Unreal local variables (Set/Get nodes), Max send/receive, named reroutes. | Same binding, two looks, your choice per binding: a **dot** with wires to every use (the default), or a **let node** plus a small **get node** next to every use, with no long wires. It's a view (layout.json), not code; switching back and forth changes nothing in the program. Selecting either highlights the other. Function inputs can be shown as get nodes too. |
| 5 | **Named wires vs. variables: two things that are one.** | Unreal has both reroutes and variables; they behave differently. | We had this too: a named dot looked like a **captioned wire** (the name floated over the line) while an unnamed one showed •1, and the two read as different things. They're the same: a name on a wire *is* a let. Now a name is only ever drawn on its dot or let node, and the caption is gone. Values on wires look different on purpose (a chip with a value in it), because they are different: a value, not a name. |
| 6 | **Hard to add nodes.** Toolbars and side palettes are far from where you work. | Right-click or Tab search menus at the pointer (Blender Shift-A, Unreal right-click, Houdini Tab). | **Right-click** anywhere: on a hole, the same type-checked palette as the side panel, at the pointer, with search. On empty space, **Add a value here** makes a new dot with a hole and opens the palette for it; wire it in afterwards. On a node: open its definition, show it inline, show its value as a let node or a dot, put a dot on it, clear it, tidy. |
| 7 | **The window is the wrong size.** | Every tool lets you resize panels. | The graph fills its pane, and the gutters between panes resize it (the redesign's dock). **Fit** centers the graph horizontally and vertically. |
| 8 | **No multi-select, so no bulk moves.** | Box select and shift-click everywhere. | Shift-click adds to the selection, shift-drag on empty space draws a box. Dragging any selected node moves them all. Tidy works on the selection. |
| 9 | **Lists, sequences and curried functions drawn nested.** `cons(1, cons(2, cons(3, nil)))` becomes a staircase; `print; print; print` nests. | Most tools have a "make array" node with N inputs. | A list is one node with one input per item, and a run of steps is a column (done in the "Writing programs" thread; this layout keeps both). `(y) => (angle) => …` is one frame with both parameters, and an `if` always shows *then* above *else*. |
| 10 | **Scale: can't see the whole and the part at once.** (Burnett's "screen real estate".) | Collapsing to subgraphs, minimaps, zoom. | Functions are the subgraphs: double-click opens one, **Show inline** draws it in place as a view. Zoom and pan are on the infinite canvas. While part of the graph is out of the window, a **map** in its corner shows the whole graph with the window on it; click or drag there to look elsewhere. Any frame inside a definition **folds** into one box (▾ in its corner, or right-click it): what it holds is hidden, a wire coming in ends on the box's left, a value going out leaves on its right. The box sits where its contents put the frame, so dragging it moves them and unfolding (▸) finds them where they were. Saved in layout.json as a view. |
| 11 | **Breaking the program by accident.** | Most editors let you wire anything and complain at run time. | Every gesture is a typed edit and is refused, with the reason, if it would add an error. While you drag, inputs that can't take the wire are dimmed and say why. (Already true; listed so it stays true.) |

## Decisions

- **One look per thing.** A bridge and a tunnel are drawings of the same wire;
  a let node and a dot are drawings of the same binding; a get node is a pill
  like any other value. No new kind of thing enters the language.
- **Layout is a view.** Positions, which bindings are let nodes, and the
  graph's height live in layout.json or the browser, never in code.json, so
  the program's hash never changes because you tidied.
- **Free beats automatic, automatic beats nothing.** Positions you set are
  kept exactly. Tidy is a gesture you ask for, not something that runs behind
  your back, so nothing jumps while you work.
- **Geometry is plain code.** `graphLayout.ts` has no DOM; it takes boxes and
  polylines and returns positions, crossings and label spots, so it is tested
  like the rest of the language.

## Left for later

- Full wire routing (a search for each wire's path among all the nodes).
  A wire now bends over or under a node in its way when that is a short
  detour that crosses no more wires; the rest keep their tunnels.
- Comment boxes. Comments live in comments.json and show in the inspector;
  drawing them on the canvas is a small step once someone wants it.
