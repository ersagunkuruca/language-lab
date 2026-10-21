# projectional: the program is the tree

A small prototype of a language whose source of truth is an AST, not text.
Identifiers are opaque IDs, names are free text kept in a separate table, and
everything you normally fight about (formatting, operator symbols, infix vs
prefix, naming style, whether to nest or use temporaries) is a *view* chosen
per person. No parser exists, on purpose.

```sh
npm run demo   # walks through everything below (Node >= 22.18, no dependencies)
npm test
```

## The core data model

`code.json` is a flat map of nodes keyed by random ID. That's the whole
semantic program. Seven node kinds (`src/model.ts`):

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
  n6c4d7986(["leading coefficient"])
  n058bd72f(["linear coefficient"])
  n1fa84a77(["constant term"])
  out_nbd55b215[/"root"/]
  n33da8789["÷"]
  n119cf467["+"]
  n88a295e3["−"]
  n058bd72f --> n88a295e3
  n88a295e3 -->|1| n119cf467
  n30596cef["√"]
  ndcd7bbed["discriminant"]
  n6c4d7986 -->|1| ndcd7bbed
  n058bd72f -->|2| ndcd7bbed
  n1fa84a77 -->|3| ndcd7bbed
  ndcd7bbed --> n30596cef
  n30596cef -->|2| n119cf467
  n119cf467 -->|1| n33da8789
  nd6b55253["×<br/><i>denominator</i>"]
  n8e659233["2"]
  n8e659233 -->|1| nd6b55253
  n6c4d7986 -->|2| nd6b55253
  nd6b55253 -->|2| n33da8789
  n33da8789 --> out_nbd55b215
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
It never shows editable source text. You select nodes and use gestures:

- **Blocks** (Scratch-like) and a **graph** sit side by side as two views of
  one tree, with selection shared between them. Graph positions you drag are
  saved to `layout.json`, which is just another side table.
- **Rename** a variable, definition or step. Naming a step is the same as
  extracting it in the let view; clearing the name inlines it.
- **Wrap in…** a function, searched by *any* of its names or glyphs
  (`*`, `·`, `×`, `multiply` and `mul` all find the same node).
- **Replace with…** a variable in scope, another definition or a number;
  **Delete** leaves a hole `□`, and holes still render and hash.
- A **Files** panel shows which file each gesture touched, plus the meaning
  hash, so you can see that renames, comments, notation and layout never
  move it. A **Run** panel evaluates the definition live.

Edits are kept in your browser's local storage; Reset brings the example back.

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

1. **Tree or graph as the canonical form?** Here the core is a tree and the
   node graph is derived from it (a variable used twice is one binder, two
   refs). A graph-first core would make sharing structural, but then a
   "temporary used twice" in the let view is a semantic edit, not a view.
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
5. **Recursive and mutually recursive defs** need SCC-based hashing
   (Unison's approach); `hashDef` currently refuses them.

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
src/demo.ts           the walkthrough
editor/               browser editor (main.ts, page.html, build.ts, dist/)
examples/build.ts     regenerates the example programs (new random ids)
test/core.test.ts
```
