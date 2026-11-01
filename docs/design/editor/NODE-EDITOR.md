# Node editor pitfalls, and our answers

Node editors have been around for a long time: Unreal Blueprints, Blender's
node editors, Houdini, Max/MSP, Unity Shader Graph, World Machine and many
more. The same complaints come up about all of them. This note lists the
ones that matter for our graph view, says what the usual fixes are and where
they come from, and says what we do. The graph code is
`editor/typedGraph.ts` (what to draw), `editor/graphLayout.ts`
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
| 1 | **Spaghetti.** Long wires cross each other and run behind nodes; you can't tell where a wire goes. | Reroute dots (Blender, Unreal, Houdini), wire portals / named reroutes (Unreal, World Machine), send/receive (Max), line hops (Visio). | Crossings that remain are drawn: a **bridge** (a small hop) where a wire passes over another, and a **tunnel** (the wire fades out at the node's edge and back in on the other side) where it passes under a node. A wire that would pass under a node bends over or under it instead, when that's a short detour that crosses no more of the wires drawn before it. A wire that would run through a frame it doesn't start or end in (a function's, a case's) goes round it, however far, even at the cost of a crossing or two: a wire through a frame reads as going into it. Any value can be shown as a **named let node with get nodes** instead of wires (pitfall 4). Tidy (pitfall 3) moves nodes off wires. |
| 2 | **Clutter from previews.** Inline values and labels pile on top of each other. | Blender and Houdini show previews in a node's body, which makes nodes big; most others hide them. | Values are small chips placed by a label placer: each tries a few spots near its output (above, below, along the wire) and takes the first that doesn't cover a node or another chip. A chip with no free spot shrinks to a dot; hovering shows it. Chips never move nodes. |
| 3 | **Manual layout is busywork, automatic layout throws your work away.** | Auto-arrange add-ons (Blueprint Assist, Blender's Node Arrange), Houdini's layout tool. They lay out everything, often ignoring wires. | Positions are **free and absolute**: a node is where you put it, not an offset from what it feeds, so moving one never drags others along. **Tidy everything** lays it all out afresh, the same picture every time: each frame on its own, innermost first, then everything in columns by how far it is from the result (the longest-path layering of Sugiyama, Tagawa and Toda), each column ordered by where its nodes plug in (what they feed, top to bottom, then the port), so a call's inputs come in the order of its ports however tall each is, and then each node is centred on the inputs that feed it, as a parent over its children in Reingold and Tilford's tidy trees, a column keeping its order and gaps. A folded frame is one box, so folding makes room, and what it holds is laid out as it would be open, with the folded frames inside it shut. A graph nobody has moved is drawn the same way, so unmoved nodes are where Tidy everything puts them, and tidying twice moves nothing. **Tidy what's inside** a frame lays its contents out the same way and leaves the frame's corner where it is. **Tidy** on picked nodes only spaces those out from where they are: it reorders each column so fewer wires cross (Sugiyama's barycenter step, kept only where it helps), removes overlaps, keeps each frame's contents together, pushes nodes off wires that run through them unless that crosses other wires, and keeps inputs to the left of what they feed. |
| 4 | **Variables as wires don't scale.** A value used in ten places is ten long wires. | Unreal local variables (Set/Get nodes), Max send/receive, named reroutes. | Same binding, two looks, your choice per binding: a **dot** with wires to every use (the default), or a **let node** plus a small **get node** next to every use, with no long wires. It's a view (layout.json), not code; switching back and forth changes nothing in the program. Selecting either highlights the other. Function inputs can be shown as get nodes too. |
| 5 | **Named wires vs. variables: two things that are one.** | Unreal has both reroutes and variables; they behave differently. | We had this too: a named dot looked like a **captioned wire** (the name floated over the line) while an unnamed one showed •1, and the two read as different things. They're the same: a name on a wire *is* a let. Now a name is only ever drawn on its dot or let node, and the caption is gone. Values on wires look different on purpose (a chip with a value in it), because they are different: a value, not a name. |
| 6 | **Hard to add nodes.** Toolbars and side palettes are far from where you work. | Right-click or Tab search menus at the pointer (Blender Shift-A, Unreal right-click, Houdini Tab). | **Right-click** anywhere: on a hole, the same type-checked palette as the side panel, at the pointer, with search. On empty space, **Add a value here** makes a new dot with a hole and opens the palette for it; wire it in afterwards. On a node: open its definition, show it inline, show its value as a let node or a dot, put a dot on it, clear it, tidy. By touch, two fingers pinch to zoom (and pan with it), a press held still for half a second is the right-click, and the menu's **Pick** stands in for shift-click (picked nodes move and tidy together; a picked dot drags to move instead of to wire, as alt-drag does). |
| 7 | **The window is the wrong size.** | Every tool lets you resize panels. | The graph fills its pane, and the gutters between panes resize it (the redesign's dock). **Fit** centers the graph horizontally and vertically. |
| 8 | **No multi-select, so no bulk moves.** | Box select and shift-click everywhere. | Shift-click adds to the selection, shift-drag on empty space draws a box. Dragging any selected node moves them all. Tidy works on the selection. |
| 9 | **Lists, sequences and curried functions drawn nested.** `cons(1, cons(2, cons(3, nil)))` becomes a staircase; `print; print; print` nests. | Most tools have a "make array" node with N inputs. | A list is one node with one input per item, and a run of steps is a column (done in the "Writing programs" thread; this layout keeps both). `(y) => (angle) => …` is one frame with both parameters, and an `if` always shows *then* above *else*. |
| 10 | **Scale: can't see the whole and the part at once.** (Burnett's "screen real estate".) | Collapsing to subgraphs, minimaps, zoom. | Functions are the subgraphs: double-click opens one, **Show inline** draws it in place as a view. Zoom and pan are on the infinite canvas. While part of the graph is out of the window, a **map** in its corner shows the whole graph with the window on it; click or drag there to look elsewhere. Any frame inside a definition **folds** into one box (▾ in its corner, or right-click it): what it holds is hidden, a wire coming in ends on the box's left, a value going out leaves on its right. The box names the calls it holds (`trace, with fuel`) and sits where its contents put the frame, so dragging it moves them and unfolding (▸) finds them where they were; if the frame would now cover other nodes, its contents move together to the nearest clear place. Any framed part (a function, an action, a case of a match) whose body is more than 3 deep or 3 wide, counting through the frames inside (`f(g(h(x)))` or `f(a, b, c, d)`, not `x * 2 + 1`), starts folded; opened, it stays open. Picked nodes from one frame can be **grouped into one box** (their menu): a frame of their own, folded at once, that names what it holds (`· ×2`); unfolded it is a dashed frame, and **Ungroup** takes it away. Saved in layout.json as a view. |
| 11 | **Breaking the program by accident.** | Most editors let you wire anything and complain at run time. | What's refused is wiring that doesn't fit: every gesture is a typed edit, refused with the reason if it would add an error, and while you drag, inputs that can't take the wire are dimmed and say why. Nothing is refused for leaving the tree unfinished: Delete, pulling a wire off, a drop on a filled input and Add a value leave **loose parts** and empty inputs (Loose parts, below), kept and type-checked but not run. So no gesture removes work, and Undo takes back any one. |

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

## Same edits in both views (audit, 2026-10-24, BACKLOG E97)

Every edit should be reachable from the graph and from the Blocks pane. Both
views select into the one Selected panel, so anything the panel does works
from both. The table lists every gesture and where it works. Each mark was
checked on the built page (fall, two dice), not just read from the code.

| Gesture | Blocks | Graph | How |
|---|---|---|---|
| Select a part | ✓ click | ✓ click | a call's name or operator selects the whole call in both |
| Fill a hole | ✓ | ✓ | the panel's palette, or right-click the hole; type a value or `x * 2` |
| Replace with… | ✓ | ✓ | panel, menu, Enter |
| Clear to a hole | ✓ Delete | ✓ Delete, or drag an input's wire off | |
| Change the function… | ✓ | ✓ | panel, menu, Enter on a call |
| Copy, cut, paste a whole call | ✓ Ctrl+C/X/V | ✓ Ctrl+C/X/V | the panel's Copy too |
| Use a variable | ✓ palette | ✓ palette, or drag from the variable to an input | |
| Share a value (a dot) | ✓ menu | ✓ menu, or drag an output onto another input | |
| Add a value before this | ✓ menu | ✓ menu | |
| Add a value (empty space) | ✓ right-click empty space: at the start | ✓ right-click the canvas: where you clicked | |
| List items, a + b + c inputs: add, move, take out | ✓ panel, menu | ✓ panel, menu, + under the inputs, drag an input onto another to move it | |
| Split by cases, steps earlier/later | ✓ panel | ✓ panel | |
| Rename | ✓ panel | ✓ panel, menu Name it… | |
| Open a definition | ✓ double-click a name | ✓ double-click a node, menu Open | |
| Definition: pin, Let it loosen, inputs, duplicate, delete | ✓ click its name | ✓ click its frame | |
| Step through parts | ✓ Tab | ✓ Tab (in reading order) | |
| Menu from the keyboard | ✓ Shift+F10 | ✓ Shift+F10 | |
| Long press for the menu (touch) | ✓ | ✓ | |
| Layout: move, pick, tidy, fold, inline, let/get nodes | n/a | ✓ | how the graph is drawn, not the program |

## Loose parts: editing without keeping the tree whole (agreed, 2026-10-24)

*Agreed with Ersagun on 2026-10-24, after his report from editing two dice `main` in the
graph. All built, in the order below (#433 to #436).*

**The problem.** Every gesture in the graph has to leave a whole, typed
tree behind (pitfall 11). That's why Delete takes everything that feeds
the node with it, why a wire can't be left hanging, why an empty input is
a hole *node* you have to find, and why moving one element from an
`append` into a list took him a dozen steps. The graph is a tree editor
drawn as a node editor.

**The idea (Ersagun's).** Let pieces lie around unconnected. What is wired
through to the result is the definition, exactly as today. Everything else
is a **loose part**: kept and type-checked, but not part of the
definition's meaning, type or run.

Prior art: Scratch's canvas, where blocks not attached to a script just
sit there and don't run (Resnick, Maloney et al., MIT); unconnected nodes
in Blender, Unreal Blueprints and Houdini. Hazel (Omar et al.) is prior art
for the other half, an editor where every state of the program is
meaningful because the gaps are holes.

### Rules

1. **The definition is unchanged.** It's the tree from the result back, as
   now; holes stay holes underneath. code.json, the hash, the type, the
   compiler and Run don't see loose parts.
2. **Loose parts live in `drafts.json`**, beside code.json, per definition:
   each a small tree with its own ids, as a copy is today. Not in
   layout.json: layout only ever changes how things look. Save file, copy
   and undo carry drafts like any other file.
3. **Holes are drawn as empty inputs** in the graph (a hollow port; its type
   on hover; click it for the palette). No hole nodes. The Blocks text keeps
   `□`.
4. **Delete removes one node.** Its slot becomes an empty input; whatever
   was wired into its inputs becomes loose. Delete on a loose part throws it
   away (Undo brings it back).
5. **Unwiring never loses anything.** Dragging a wire off an input leaves the
   input empty and the value loose. Dropping an output on a *filled* input
   swaps it in and the old value goes loose. Dropping on a list's `+` adds
   it as an item.
6. **Wiring is still checked.** Connecting a loose output to an input of the
   definition is a typed edit, refused with the reason if it doesn't fit, as
   now. Inside a loose part the same holds.
7. **Making something new** on the canvas (right-click, Add a value) makes a
   loose node, with no dot or let needed; wire it in when it's ready.
8. **Blocks shows loose parts at the end**, under a line `-- loose, not used
   yet`, as `_1 = named("random", button(…))`. They're edited there like any
   other part, and a loose part can be cut and pasted into a hole.
9. **Graph drawing:** a loose part is drawn faded with a dashed outline, so
   it's plain at a glance what doesn't count yet.

### How it's built

A loose part is a definition with no name (the text shows it as `loose:`
and the expression it is; inside, it is `_1`), owned
by the definition it came from (`editor/drafts.ts`). In the editor it sits
in the code like any other definition, so every edit, the palette and the
type checker work on it unchanged; on disk it's split off into drafts.json,
and what runs, compiles and is hashed is the program without it. A variable
of its definition that it used becomes an input of its own, called the
same (`_2(said) = p([text(read(said))])`), so it stays well typed out of
place; wired back where that variable is in reach, the input is the
variable again, and elsewhere it becomes a hole. That settles the first
open question below for now. Those inputs are a lambda at the part's top
whose parameters all stand for a variable (drafts.json's `home`); any
other lambda there is the part itself, so a loose part may be a function,
`loose: (x) => …`, and wires in whole (BACKLOG E130).

### Open questions

- **Names that go out of scope.** A part taken out of the body may use a
  value named by a step of the body (`a` in `a = die()`). Paste today turns
  such a use into a hole. Better for drafts: keep the reference, show it as
  unresolved, and resolve it again when the part is wired back where `a` is
  in scope.
- **Ill-typed drafts.** Rule 6 keeps drafts well typed. Hazel instead lets a
  mistake stay, marked in place. Start with rule 6; revisit if it gets in the
  way.

### Order of PRs (Editor lane)

1. Holes drawn as empty inputs; the `+` and filled-input drops (view and
   gesture only, no new file). ✓ for a call's inputs and a list's items, where a hole
   was most of them; a hole that is a whole function body or a case's result
   is still drawn as a □ node, since there's no input to draw it on.
2. `drafts.json`: loading, saving, Save file, undo, and the Blocks section. ✓
3. Delete and unwiring leave loose parts (rules 4 and 5). ✓
4. New values on the canvas are loose (rule 7); faded drawing (rule 9). ✓
5. Pitfall 11 rewritten to say what's refused now: wiring that doesn't fit,
   never removing. ✓
