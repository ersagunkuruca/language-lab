# projectional: the program is the tree

A small prototype of a language whose source of truth is an AST, not text.
Identifiers are opaque IDs, names are free text kept in a separate table, and
everything you normally fight about (formatting, operator symbols, infix vs
prefix, naming style, whether to nest or use temporaries) is a *view* chosen
per person. No parser exists, on purpose.

```sh
npm run demo   # walks through everything below (Node >= 22.18, no dependencies;
               # networks use the solver in ../invertible)
npm test
```

## The core data model

`code.json` is a flat map of nodes keyed by random ID. That's the whole
semantic program. The expression node kinds (`src/model.ts`; holes and
networks are covered further down):

| kind      | fields                 | notes                                                        |
|-----------|------------------------|--------------------------------------------------------------|
| `lit`     | `value`                | number or string                                             |
| `binder`  | (none)                 | the *identity* of a variable. It has no name.                |
| `ref`     | `target`               | points at a binder, def or builtin **by id**                 |
| `call`    | `fn`, `args[]`         | operators are just calls; `+` is a name, not syntax          |
| `lambda`  | `params[]`, `body`     | params are binder ids                                        |
| `def`     | `body` (or `null`)     | top-level definition; `null` body = extern                  |
| `builtin` | `op`                   | `builtin.add` etc. Referenced exactly like user defs         |

There is no `let`: `((d) => body)(x)` *is* a let, and the let view shows it
as one. There are no modules, imports or files inside the code: a def refers
to what it needs by id.

Everything else is a side table keyed by node id, each in its own file:

```
examples/quadratic/
  code.json                 the tree. The only thing a compiler would read.
  names.short.json          Δ, x₊, a, b, c
  names.descriptive.json    discriminant, root, "leading coefficient", ...
  comments.json             notes attached to nodes, not to lines
  hints.json                strategy / precision / inlining notes
styles/
  math.json  plain.json  lisp.json  graph.json    a person's view + notation
```

Names layers stack (`short` then `descriptive` overrides), so a team can
share a vocabulary and a person can override bits of it. A **style** picks
the view and the notation for each function: glyph (`*`, `·`, `×`), fixity,
precedence, associativity. Precedence is part of *your notation*, not of the
language, so parentheses are computed at render time (`src/render/expr.ts`).

## What the demo shows

**One tree, two shapes.** Ersagun's example, stored once in
`examples/compose/code.json`:

```
nested:  a = ((d) => b(c(d, e(f, d))))(g(h))

let:     d = g(h)
         t1 = e(f, d)
         t2 = c(d, t1)
         a = b(t2)

lisp:    (define a ((λ (d) (b (c d (e f d)))) (g h)))
```

The temporaries `t1`, `t2` have no existence in the code. If you give the
node a name in a names layer, the let view uses it (see `denominator` below),
so naming an intermediate step works like a comment.

**One code.json, several people.** The same quadratic program:

```
short names, math style, nested:

  -- b² − 4·a·c; negative means no real roots
  Δ = (a, b, c) => b · b − 4 · a · c
  x₊ = (a, b, c) => (−b + (√Δ(a, b, c))[1]) / (2 · a)
    [1] NaN when Δ is negative

descriptive names, ASCII operators, let view:

  -- ‹linear coefficient›² − 4·‹leading coefficient›·‹constant term›; negative means no real roots
  discriminant(‹leading coefficient›, ‹linear coefficient›, ‹constant term›):
    t1 = ‹linear coefficient› * ‹linear coefficient›
    t2 = 4 * ‹leading coefficient›
    t3 = t2 * ‹constant term›
    return t1 - t3

  root(‹leading coefficient›, ‹linear coefficient›, ‹constant term›):
    t1 = -‹linear coefficient›
    t2 = discriminant(‹leading coefficient›, ‹linear coefficient›, ‹constant term›)
    t3 = sqrt(t2)   -- NaN when discriminant is negative
    t4 = t1 + t3
    denominator = 2 * ‹leading coefficient›
    return t4 / denominator
```

The `‹ ›` around multi-word names is a choice of the `plain` style (so it
still reads in a terminal); a real editor would just show a chip.

Comments are structured too: `{3fa2c19e}` inside comment text is a reference
to a node and is shown with its current name. That's why the discriminant's
comment says `b² − 4·a·c` in one view and spells out the coefficients in the
other, and it keeps up with renames.

The node view (Mermaid, so GitHub draws it). Variables are wires that fan out:

```mermaid
flowchart LR
  n92f7051c(["leading coefficient"])
  n650835b4(["linear coefficient"])
  n49dc496d(["constant term"])
  out_n0ec3f332[/"root"/]
  n56af9fb8["÷"]
  ne119fc68["+"]
  n0c3b2c0a["−"]
  n650835b4 --> n0c3b2c0a
  n0c3b2c0a -->|1| ne119fc68
  nff10a387["√"]
  n8d9c044c["discriminant"]
  n92f7051c -->|1| n8d9c044c
  n650835b4 -->|2| n8d9c044c
  n49dc496d -->|3| n8d9c044c
  n8d9c044c --> nff10a387
  nff10a387 -->|2| ne119fc68
  ne119fc68 -->|1| n56af9fb8
  n6c34cfa2["×<br/><i>denominator</i>"]
  n2da62cc1["2"]
  n2da62cc1 -->|1| n6c34cfa2
  n92f7051c -->|2| n6c34cfa2
  n6c34cfa2 -->|2| n56af9fb8
  n56af9fb8 --> out_n0ec3f332
```

**Rename is not an edit to the program.** Renaming a binder produces a new
names table. `code.json` is byte-for-byte unchanged, the semantic hash is
unchanged, and evaluation is unchanged (the interpreter's environment is
keyed by binder id, `src/eval.ts`).

**Collisions are a display problem.** Name all three parameters `k` and
nothing breaks; the renderer shows `Δ = (k₁, k₂, k₃) => k₂ · k₂ − 4 · k₁ · k₃`
and `Δ(1, -3, 2)` is still `1`. Shadowing, capture, namespaces and "stained"
scopes don't exist, because nothing is looked up by name.

**Edits keep attachments.** Replace the `2 · a` subtree with `a + a`: the
step is still called `denominator`, and the comment on the `sqrt` step is
still on the `sqrt` step, since both are keyed by node id rather than by
line number.

**Content hashing.** `src/hash.ts` hashes a def with ids *and* names left
out: binders become positions, refs to other defs become those defs' hashes.
Two people who write the same function independently, with different ids
and names, get the same hash (tested). That gives you the module/package
story for free: a "package" is the dependency closure of a def
(`dependencies()` in `src/model.ts`), identified by hashes. Folders,
namespaces and package names become presentation (a names layer that
assigns paths), not something the compiler has to resolve.

## The editor

`editor/dist/index.html` is a self-contained browser editor over the same
core (open it directly, or rebuild with `npm install && npm run build-editor`).
It never shows editable source text. There are two kinds of definitions.

**Expression defs** (`discriminant`, `root`) are shown as Scratch-like blocks
and a graph, with selection shared between them.

- **Rename** a variable, definition or step. Naming a step is the same as
  extracting it in the let view; clearing the name inlines it.
- **Wrap in…** a function, searched by *any* of its names or glyphs
  (`*`, `·`, `×`, `multiply` and `mul` all find the same node).
- **Replace with…** a variable in scope, another definition or a number;
  **Delete** leaves a hole `□`, and holes still render and hash.
- **Open definition** (or double-click a call) jumps to the callee, with a
  back button. **Show inline** displays the callee's body in place of the
  call. That is a view stored in `layout.json`; `code.json` doesn't change.
- **Turn into a network** rewrites the def as a network (below). Calls keep
  their ids as nodes, so names and comments carry over.

**Networks** (`to polar`, `rotate`) are node graphs you wire freely: add
nodes from a palette (builtins, relations such as `polar`, other defs,
constants), drag between ports to connect, drag a wired port into empty
space to disconnect, add and remove outer ports. A network is a function
without a direction. Each outer port is either *known* or *solved for*, and
that choice lives in `layout.json`, not in the code. The relation solver from
`../invertible` derives the program for the current choice and lists every
branch of a multi-valued answer, canonical first.

So `to polar` with `x, y` known gives `angle, length`. Tick `angle` and
`length` instead and it computes `x, y`. With `x, length` known it finds `y`
and `angle`, `±` branches included. Each node's ports show which way values
flow through it (filled = input, hollow = solved), and the arrows flip when
you change the outer choice. `rotate` is two polar nodes sharing a length
plus an adder; making `x′, y′` known solves for `turn` through both polar
nodes backwards. `root`, turned into a network, can be asked for the linear
coefficient that gives a particular root.

A **Files** panel shows which file each gesture touched, plus the meaning
hash, so you can see that renames, comments, notation, layout and direction
never move it. Edits are kept in your browser's local storage; Reset brings
the examples back.

### Typed programs in the editor

The editor's program switcher has the two typed programs from `src/lang/`
(see LANGUAGE.md): eight queens and the small algebra system. They show as
clickable blocks (`editor/typed.ts`) with every node's inferred type on
hover. Clicking a hole opens a palette of only the fillings that
type-check (`fillings()`), "Split by cases" turns an expression into a match
on a variable with one arm per case of its type, "Add a case" on a data type
adds a hole arm to every match and fold over it, and `main` runs in the
page. Any edit that would add a type error is refused with the reason.

Every definition is drawn on one canvas (`editor/canvas.ts`): typed
programs, plain expressions and networks alike, with the same gestures.
In tree code (`editor/typedGraph.ts`) calls are nodes, and functions and each
case of a match or fold are frames whose variables are sources on the left
edge. There are no variable pills: every use of a variable is a wire from
its source, so a value used twice visibly fans out. Calls that bring in an
effect carry a badge (Choice, Console, Diverge), and handlers (`first`,
`all`, `count`, `with fuel`) are marked with the effect they remove.
Dragging a source onto an input uses that variable there (refused, with the
reason, if it's out of scope or the wrong type); dragging a node's output
onto a second input shares the value by giving it a dot; dragging an
input's wire into empty space leaves a hole. Drag a node to move it: it
keeps an offset from the automatic layout in layout.json, frames grow to
hold it, and it can't leave its scope. Networks move and wire the same way.

A relation used inside a typed program (a `solve` node, `examples/relations`)
is a node too: the ports it is given are inputs, the ones it solves for are
sources on its right, all from the same solution. Its badge says whether
that direction is pure or a Choice (several answers, or possibly none).

A let is a dot on a wire, like a reroute dot in Blender's node editor: the
value flows into the dot and a wire runs from the dot to every place that
uses it. Click any wire to put a dot on it; drag from the dot to another
input to share the value there. The dot can carry a name, and needn't:
an unnamed one shows as `•1`, `•2` in every view, a handle that is never
stored. Removing a dot with one wire out puts the value back on that wire.
In the code the dot is the let's binder, `((b) => body)(value)`: the binder
is exactly "this output, used in these places", and its name was always
optional, living in names.json like every other name. So nothing in the
core changed. The value moves to the start of the innermost body around it
(a function's, a case's, a let's), where every later input can reach it;
only bodies bind names, so nothing changes scope on the way. The one thing
a dataflow picture can't show is order, so a step done only for its effect
(`_ = print(…)`) is a hollow dot nothing reads, in the column of steps.

The editor is published by `.github/workflows/pages.yml` on every push to
main: https://ersagunkuruca.github.io/language-lab/

## Networks in the core

`src/relational.ts` adds two node kinds to the model:

| kind      | fields                         | notes                                               |
|-----------|--------------------------------|-----------------------------------------------------|
| `network` | `params[]`, `wires[]`, `parts[]` | a def body; params (outer ports) and wires are binders |
| `part`    | `fn`, `bind`, `value?`         | a builtin, relation or def, each port bound to a wire by id |

A network compiles to one solver relation: a builtin part becomes an
equation (`out = a + b`), a relation or a network part is embedded with
`uses`, and an expression def used as a part is inlined into an equation, so
its insides can be inverted too. `partDirections` plans the network without
one part to find which of that part's ports are already determined (inputs)
and which it must produce (outputs).

When a direction needs a nonlinear block (the root network asked for `b`),
the solver *tears* it: it guesses one unknown, computes the others from it
in closed form, and scans the guess for values that satisfy the one leftover
equation, so it finds every root in range rather than one. The derived
program shows that as "guess b … keep the b where …".

## Errors you can't make

There's no text, so there are no syntax errors. The aim is to make the other
kinds just as impossible. `src/check.ts` names every kind, `src/edits.ts`
makes every gesture a pure function `code → code`, and each edit is refused
(with a reason, and nothing changed) if the result has an error the code
before it didn't. The editor asks ahead of time, too: while you drag a wire,
the ports it can legally reach light up and the others say why not, unit
chips that would contradict the wiring are disabled, and so are picker
options that would be refused.

| kind | what stops it |
|---|---|
| syntax | there is no text |
| unknown names | a reference is an id picked from what's in scope |
| wrong number of arguments | wrapping or calling makes one slot per parameter |
| ports that don't exist | a part's ports come from its function's definition |
| dangling wires | a wire with fewer than two ends is removed |
| broken trees (a node in two places) | edits swap whole subtrees |
| a network that contains itself | refused when the part is added |
| unit mismatches | refused at connection time |
| holes, unconnected ports | allowed while editing; they're incomplete, not wrong |
| √ of a negative, ÷ 0, too few known ports | only found by running |

`test/check.test.ts` drives a few hundred random gestures (seeded) over each
example and asserts that no accepted edit ever leaves an error.

**Units are the types.** `src/units.ts` gives every value a dimension, a
vector of exponents over m, s, kg, A and rad. Each builtin says how its
ports relate (`+`: all equal; `×`: exponents add; `√`: halve; `sin`: takes
rad), which gives linear equations over the exponents, solved exactly by
incremental elimination. A type error is an inconsistent system. You
declare units on a few ports and inference does the rest: in `fall`, only
the four outer ports have units and every wire inside gets its own; in
`period`, only the inputs do and the result comes out in seconds. A def used
twice is inlined each time, so it's polymorphic in whatever it leaves free.
Zero is the one number that is every unit at once.

**+ and − are one node.** Arithmetic in networks is two variadic atoms from
`../invertible`: a *sum* (`a + b + … = total`) and a *product*. Which symbol
the node shows depends on which port is unknown: the same sum draws as `+`
when the total is unknown, `−` when an addend is, and `neg` with a zero
total. There's always one spare addend port, and connecting it adds a term.
Turning an expression def into a network converts `+ − neg × ÷` to these.

## Mapping back to the original ideas

| idea | where it lives here |
|---|---|
| names are free text tied by unique IDs | `binder` / `ref.target`; `names.*.json` |
| syntax and formatting are a per-person view | `styles/*.json`, `src/render/*` |
| operators are just functions with one or many glyphs | `builtin.*` + `notation` in a style |
| comments attached to branches of the tree | `comments.json`, with `{id}` refs |
| strategies, batch sizes etc. stored separately | `hints.json` |
| multiple paradigms as views of the same code | nested / let / sexpr / graph renderers |
| libraries, packages, modules unified | no imports; refs by id + content hash + dependency closure |
| a node whose inputs and outputs depend on how it's wired | `network` + `part`, solved by `../invertible` |
| never a syntax error, and no type errors either | `src/check.ts`, `src/edits.ts`, units as types |

## Prior art, briefly

- **JetBrains MPS**: full projectional editor; the model is the AST and
  notations are pluggable. Heavy, and names are still mostly text with
  scoping rules on top.
- **Unison**: definitions identified by a hash of their AST, names are
  metadata, renames are free, no dependency conflicts. The closest match to
  the ID/name split and the package story. Still edited as text.
- **Lamdu**, **Hazel**: structure editors where the program is never
  syntactically broken; Hazel adds typed holes so incomplete programs still
  run. Good references for the editing experience this prototype skips.
- **Dion** (dion.systems): "the AST is the source of truth, formatting is
  personal", aimed at C-like systems code. Same thesis as here.
- **Enso** (ex-Luna): one program, two synchronized views (text and node
  graph). The dual-view part of this idea, done for real.
- **Scratch / Blockly / node editors** (Blender, Unreal Blueprints): block
  and graph views, but each is the *only* view of its language.

What seems less explored is putting all of it together: Unison-style
identity, MPS-style per-user notation, and Enso-style multiple views, with
every non-semantic thing in independent, mergeable side tables.

## Open questions

1. **Tree or graph as the canonical form?** Expression defs are trees (the
   graph is derived from them); networks are graphs with no direction. Both
   are stored the same way, as nodes keyed by id. Open: should expression
   defs simply *be* networks with one chosen direction, so there's one
   editor instead of two?
2. **Order in the let view.** For pure code, any topological order of the
   steps is equivalent, so the order could be a presentation choice too.
   Effects would pin it.
3. **Editing through a view.** The editor maps a first set of gestures
   (rename, name/inline step, wrap, replace, delete) onto tree edits. Typing
   would be a structured input method, not a parser, and is not tried yet.
   Finding things to reference still uses names, so aliases (`*`, `·`, `×`
   for one function) become a search problem, which the wrap picker shows.
4. **Orphaned side-table entries** when a node is deleted, and merging two
   people's side tables. Since everything is keyed by id, merges are
   per-node rather than per-line, which should be much nicer than text.
5. **Units beyond exponents.** Offsets (°C vs K), named-but-equal units
   (J vs N·m are the same here) and a fractional exponent from `√` of an odd
   power all fall out of the vector model unevenly.
6. **Recursive and mutually recursive defs** need SCC-based hashing
   (Unison's approach); `hashDef` currently refuses them.

## The typed core

Data types, `match`, `fold`, inferred types with effects (`Choice`,
`Console`, `Diverge`), typed holes with a palette that can't produce a type
error, and two real programs (eight queens, a small computer algebra system):
see [LANGUAGE.md](LANGUAGE.md) and `npm run lang`.

## Layout

```
src/model.ts          node types, traversal, replace(), dependencies()
src/presentation.ts   names / comments / hints / style types, rename()
src/prelude.ts        builtins (ordinary nodes with stable ids)
src/builder.ts        build trees from code (there's no parser)
src/eval.ts           strict interpreter, env keyed by binder id
src/hash.ts           name- and id-free content hash
src/render/           namer (display names + disambiguation), nested,
                      let, sexpr, graph views
src/relational.ts     networks: compile to the solver, port directions, toNetwork(),
                      sum/product atoms and the symbol they show
src/units.ts          units as types: constraints, exact inference, compatible()
src/check.ts          every kind of error, and incomplete states
src/edits.ts          every gesture as a pure, guarded edit
src/demo.ts           the walkthrough
src/lang/             the typed core: types + effects, inference, evaluator,
                      block view, std library, example programs (LANGUAGE.md)
editor/               browser editor (main.ts, page.html, build.ts, dist/)
examples/build.ts     regenerates the example programs (new random ids)
examples/build-lang.ts  regenerates examples/queens and examples/algebra
test/core.test.ts, test/relational.test.ts, test/check.test.ts (with the fuzz test),
test/lang.test.ts
```
