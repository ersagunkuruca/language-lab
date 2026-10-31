# Influences, prior work and adapted code

This project is meant to show a language and its features, not other
people's work passed off as ours. Most of the ideas started with Ersagun.
Some were shaped by things he had seen, some turned out to have been tried
before, and the code was written by Claude, which brings what it knows of
decades of other people's research and engineering. So this page lists, for
each feature, where the idea comes from and how our version relates to it.

Each entry carries one label:

- **Ersagun's idea**: raised by Ersagun in the project. Where others had a
  similar idea first, the entry says so: having the idea again doesn't make
  it new.
- **Influence**: someone else's design that we knew of and that shaped ours.
  No code was copied.
- **Prior art**: we arrived at it ourselves, and it was done before. Listed
  so nobody mistakes it for a first.
- **Adapted**: a formula, algorithm or piece of code translated from a named
  source. The code says so where it's used.
- **Textbook**: a standard algorithm with no single source, written from the
  general literature.
- **Considered, rejected**: looked at seriously and not followed, still named
  because it shaped the decision.
- **Our own**: designed in the project, with no source we know of.

If something here is missing or wrongly credited, that's a bug: please say
so, and it gets fixed like any other bug. Claude writes from memory of the
literature, so an idea that felt obvious while building it very likely has
prior art we haven't named yet.

## How to credit

The rule (Ersagun, 2026-10-22) applies to every file in the repository:

1. **In the code**: a comment at the definition or file that uses the idea,
   with the author's name and a link or citation. In a program made in the
   editor, that comment is the definition's comment (`comments.json`), so it
   shows in the editor next to the code.
2. **In the docs**: the example's or feature's doc names the source, and the
   entry goes on this page.
3. **In the PR**: the PR description says what was adapted or influenced,
   from whom.
4. **Visible where people look**: a page that shows the work (the editor,
   `shaders.html`, `reactive.html`, the tutorial) shows the credit on the
   page, not only in the source. In the editor, an example's
   program comment (a line each, labelled as below) shows in the Program tab
   and above its picture, and the menu bar's Credits link comes to this list.

Prefer original demos. When reusing, link the source and respect its
licence. Textbook algorithms say they are the textbook ones. Ideas count too,
not only code: an influence is credited even when nothing was copied.

## The program is a tree, not text

| What | Label | Who and where |
|---|---|---|
| The source is an AST keyed by ids; names, notation, formatting and nesting are per-person views kept in side tables | Ersagun's idea | Prior art: projectional editing in JetBrains MPS; Charles Simonyi's Intentional Programming (1990s); [Dion](https://dion.systems) ("the AST is the source of truth, formatting is personal"). Names as metadata over ids: Unison (below). See README.md "Prior art, briefly". |
| Structure editing where the program is never syntactically broken | Prior art | The Cornell Program Synthesizer (Teitelbaum and Reps, CACM 1981), [Lamdu](https://www.lamdu.org), [Hazel](https://hazel.org). |
| Typed holes, and the palette that offers only fillings that type-check | Influence | Hazel (Cyrus Omar and colleagues, "Hazelnut", POPL 2017; "Live functional programming with typed holes", POPL 2019); holes in Agda and Idris. |
| Several views of one program (graph, Blocks, Steps, Nested, Lisp) | Ersagun's idea | Prior art: Enso (formerly Luna) has synchronized text and graph views. The Lisp view is McCarthy's s-expressions (1960). |
| Never a type error either: every edit is checked and refused with the reason | Ersagun's idea | Builds on Hazel's "every edit state is meaningful". |
| An action handed to a handler drawn as what it does (`first(queens(8), else nil)`, the tree keeps the `() =>`) | Influence | Scala's by-name parameters (`=> A`), as LANGUAGE-REVIEW-2026-10-24 §6 proposed. `src/lang/render.ts` `byName`. |
| Nested patterns drawn over nested matches, which stay one level each (designed, PATTERNS.md) | Influence | The view runs pattern-match compilation backwards, from a decision tree to rows (Luc Maranget, "Compiling pattern matching to good decision trees", ML Workshop 2008). Patterns as a projection of the data: Philip Wadler, "Views", POPL 1987. |

## Definitions by hash, modules, publishing

| What | Label | Who and where |
|---|---|---|
| A definition is identified by a hash of its content; names are metadata; publishing by hash; no dependency conflicts | Influence | [Unison](https://www.unison-lang.org/docs/the-big-idea/) (Paul Chiusano, Rúnar Bjarnason, Arya Irani and the Unison team). Credited in `src/hash.ts`, `src/lang/modules.ts`, LANGUAGE.md. |
| Hashing a mutually recursive group as a unit | Adapted | Unison's method for cycles, in `src/hash.ts`. |
| Strongly connected components for dependency order | Textbook | Tarjan's algorithm (R. E. Tarjan, SIAM J. Computing, 1972), `src/lang/infer.ts`, `src/hash.ts`. |
| SHA-256 | Adapted | Written from the standard, FIPS 180-4, in `src/sha256.ts`. |

## Sharing, versions and merging (designed, not built)

Proposed in [SHARING.md](../design/sharing/SHARING.md) (BACKLOG L109-L115); its Credits table has the full list.

| What | Label | Who and where |
|---|---|---|
| A stable lineage id over changing version hashes; names pinned per program and offered on upgrade | Ersagun's idea / Prior art | Ersagun, 2026-10-31. IPNS in IPFS (Protocol Labs); git branches over commits; Unison's upgrades. |
| Every version used kept in the project, downgrade from it | Ersagun's idea / Prior art | Ersagun, 2026-10-31. Go and Cargo vendoring; Nix's store and GC roots; Unison's local codebase. |
| Imports pinned by hash from any host; signed append-only logs of which version is current | Prior art | Dhall (Gabriella Gonzalez); Nix (Eelco Dolstra); Go's checksum database; Sigstore's Rekor; Certificate Transparency. |
| Compatibility checked from types | Influence | Elm's `elm diff` (Evan Czaplicki). |
| Structural diff and merge; history as commuting patches | Prior art | GumTree (Falleri et al. 2014), Difftastic (Wilfred Hughes); Darcs (David Roundy), Pijul (Meunier, Becker), CRDTs (Shapiro et al. 2011), Automerge (Martin Kleppmann). |

## Types, totality, units

| What | Label | Who and where |
|---|---|---|
| Inferred types, never written | Textbook | Hindley-Milner (Hindley 1969, Milner 1978, Damas and Milner 1982), `src/lang/infer.ts`. |
| Strictly positive data types | Adapted | The check Coq and Agda use. REVIEW.md §1. |
| Termination by size-change | Adapted | Lee, Jones and Ben-Amram, "The size-change principle for program termination", POPL 2001. LANGUAGE.md. |
| Nested data folded through its container | Adapted | Coq's nested inductive types, `src/lang/nested.ts`; in WebAssembly as one mapping function per container type (`compiler/src/scalar.ts` fold). |
| Units as part of the type, solved as exponent vectors | Prior art | Andrew Kennedy, "Dimension Types" (ESOP 1994), and F#'s units of measure. LANGUAGE.md credits it. |
| `match`, `fold`, `if` and `cons` as ordinary function nodes; one system, no special kinds | Ersagun's idea | Related: Church/Scott encodings, where data is its own eliminator, and catamorphisms (below). |
| Functions take all their inputs at once; `curry`, `uncurry`, `flip` and `partially` when one at a time is wanted | Ersagun's idea; Prior art for the names | Ersagun 2026-10-26 ("non curried is easier to reason about"). The names are Haskell's Prelude's (after Haskell Curry). `src/lang/prelude-source.ts`, LANGUAGE.md "Types". |

## Effects

| What | Label | Who and where |
|---|---|---|
| Algebraic effects and handlers | Influence | Plotkin and Power (2003), Plotkin and Pretnar (2009); the Eff language (Bauer and Pretnar). |
| Effect rows in inferred types | Influence | [Koka](https://koka-lang.github.io) (Daan Leijen, "Koka: programming with row polymorphic effect types", 2014). LANGUAGE.md: "the Koka/Eff/OCaml 5 line of design, cut down". |
| Effects with type parameters, applied in rows (`Yield Text`) | Prior art | Koka's effect types with parameters (Leijen 2014), Unison's abilities (`{Stream a}`), Effekt. `src/lang/types.ts` `Row.args`, LANGUAGE.md "Effects you define", EFFECTS-REVIEW-2026-10-24 §2.3. |
| The world's IO (Console, Files, Network) as declared effects that a program's own handler can answer, the runtime answering the rest (L55) | Prior art | Unison's `IO` and `Exception` abilities, handled by the runtime at the top and by a program's handler in a test; Koka's `console` effect. `src/lang/std.ts` `WORLD_OPS`, LANGUAGE.md "The effects", HOSTS.md. |
| Named rows for what a host allows (`View`, `Handler`, `Sound`, L58) | Prior art | Koka's effect aliases (`alias io = <console, fsys, net, …>`). `src/lang/std.ts` `namedRow`, LANGUAGE.md "Pages: web apps", HOSTS.md. |
| A closed function row opened at each use of a variable, so a function can go where more happens | Prior art | Koka's `open` (Daan Leijen, "Type directed compilation of row-typed algebraic effects", POPL 2017). `src/lang/infer.ts` `opened`, LANGUAGE.md "Effects". |
| A handler is a `match` whose cases are an effect's operations | Adapted | OCaml 5.3's effect cases in `match` (OCaml 5 effects: Sivaramakrishnan et al., PLDI 2021). Credited in `src/lang/infer.ts` and LANGUAGE.md. |
| An abort cuts the remaining alternatives | Prior art | ISO Prolog's `catch/3`; Koka and Effekt treat aborts as exceptions the same way. |
| Effects as ordinary type definitions; world effects not allowed under `Choice` | Our own | Grew out of the review (REVIEW.md); no direct source we know of. |
| A handler is an ordinary function that pattern-matches on an effect's operations | Prior art | Frank (Sam Lindley, Conor McBride and Craig McLaughlin, "Do be do be do", POPL 2017, https://arxiv.org/abs/1611.09259) had it before OCaml 5.3's syntax. Found by EFFECTS-REVIEW-2026-10-24.md. |
| An operation either returns at once or never returns (no continuation as a value) | Prior art | Koka's `fun` and `final ctl` operations (Daan Leijen, https://koka-lang.github.io/koka/doc/book.html#sec-handlers), which Koka compiles without capturing continuations. Found by EFFECTS-REVIEW-2026-10-24.md. |
| No world effects where a search may abandon the path | Prior art | Verse's effect specifiers `<transacts>` and `<no_rollback>` (what runs in a failure context must be able to roll back; https://dev.epicgames.com/documentation/en-us/uefn/specifiers-and-attributes-in-verse). Found by EFFECTS-REVIEW-2026-10-24.md. |
| A search's function in a row of its own, contained in the call's row, that can't take the world | Influence | Koka's subeffecting and row openness (Daan Leijen, POPL 2017), used for one more row constraint; the rule itself is Verse's `<transacts>` above. `src/lang/infer.ts` `settle`, `types.ts` `Subst.noWorld` and `subs`, LANGUAGE.md "The world and Choice" (L53). |
| `examples/generic`: a polynomial evaluated one coefficient at a time, highest first | Prior art | Horner's rule (William George Horner, 1819; known earlier to Qin Jiushao and to Newton). Named in the program's comment on `horner`. |
| Randomness as an effect whose handler chooses the numbers (a seeded one for tests, the world's otherwise) | Prior art | Koka's `ndet` effect for random numbers; the Eff papers' examples of handlers for nondeterminism and randomness (Bauer and Pretnar). LANGUAGE.md "Random". |
| The seeded generator, xoshiro128** seeded by SplitMix32 | Adapted | xoshiro128** by David Blackman and Sebastiano Vigna (2018, public domain, [prng.di.unimi.it](https://prng.di.unimi.it/xoshiro128starstar.c)); SplitMix by Guy Steele, Doug Lea and Christine Flood ("Fast splittable pseudorandom number generators", OOPSLA 2014). Translated in `src/lang/random.ts`. |
| The time as a cell written each animation frame, so a part reading `now()` re-runs per frame; no timer operation | Prior art | Fran's time-varying behaviours (Conal Elliott and Paul Hudak, "Functional reactive animation", ICFP 1997); Elm's `Time.every` subscriptions (Evan Czaplicki). `src/lang/browser.ts`, LANGUAGE.md "Time". |
| Lists on a page that keep their rows: `each` maps a cell's list item by item, keeping what an item still there was mapped to, and the html module's `for each` draws it | Prior art | Solid's `mapArray` and `<For>` (Ryan Carniato, [solidjs.com](https://www.solidjs.com)). `src/lang/cells.ts`, `src/lang/html.ts`, `src/lang/html-source.ts`, WEB.md "Lists". |
| A page's fetch suspends: the view keeps what it shows and runs again when the reply lands; a handler runs again | Prior art | Solid's `createResource` (Ryan Carniato, [solidjs.com](https://www.solidjs.com)) and React's Suspense (the React team at Meta). `src/lang/browser.ts`, `src/lang/html.ts`, LANGUAGE.md "The web". |
| `examples/dice` (apps/dice.html): two dice, seeded batches, a histogram of the sums | Our own | The credits line on the page names what it borrows (xoshiro128**, Fran and Elm, Koka and Eff); the triangular distribution of two dice is textbook. |
| `examples/pig`: the dice game Pig, one game run under strategy, commentary, recording and replay handlers | Prior art (the game, the strategy), our own (the page and its handlers) | Pig is a folk dice game, described by John Scarne (*Scarne on Dice*, 1945). Holding at 20 is the rule of thumb that Todd Neller and Clifton Presser analyse in "Optimal Play of the Dice Game Pig" (*The UMAP Journal* 25(1), 2004). Handlers you choose for an effect: Eff (Andrej Bauer and Matija Pretnar) and Koka (Daan Leijen). The credits line on the page says the same. |
| `examples/tumble`: a match-3 game whose chain reaction is shown three ways (wait, all at once, step by step) | Prior art (the genre, the problem), influence (the step queue), adaptation (the number generator), our own (the game, its rules, the page and its handlers) | The match-3 genre began with Eugene Alemzhin's *Shariki* (1994) and was made popular by PopCap's *Bejeweled* (2001); Ersagun named the question "the Candy Crush problem" after King's *Candy Crush Saga* (2012). Steps queued and shown one at a time: the Event Queue pattern in Robert Nystrom's *Game Programming Patterns* (https://gameprogrammingpatterns.com/event-queue.html). New pieces come from Park and Miller's minimal standard generator ("Random number generators: good ones are hard to find", *CACM* 31(10), 1988). A handler that keeps the rest of the computation to resume later: Eff (Bauer and Pretnar), Koka (Leijen), OCaml 5's effects. The credits line on the page says the same. |
| `examples/bounce`: rigid bodies bouncing in a box, one physics step written once and run over Cl(2, 0) and Cl(3, 0) | Prior art (the method), influence (2D and 3D from one code), our own (the bodies, the step and the page) | Rotors, reflections and projections as sandwiches, and a spin as a bivector whose exponential turns the body: David Hestenes, *New Foundations for Classical Mechanics* (1986), on W. K. Clifford's algebras (1878). Writing geometry once and changing only the algebra: Leo Dorst, Daniel Fontijne and Stephen Mann, *Geometric Algebra for Computer Science* (2007), and Steven De Keninck's ganja.js and bivector.net examples (https://bivector.net). The credits line on the page says the same. |
| `examples/constructions`: a dynamic geometry page in plane projective geometric algebra (lines as vectors, points as bivectors, join, meet, perpendiculars, mirror and turn) | Prior art (PGA and dynamic geometry), our own (the tools, the construction and the page) | Plane PGA, the meet as the outer product and the join through the dual: Charles Gunn, *Geometry, Kinematics, and Rigid Body Mechanics in Cayley-Klein Geometries* (2011), and Gunn and Steven De Keninck, "Geometric Algebra for Computer Graphics" (SIGGRAPH 2019 course, https://bivector.net); the point convention e₁₂ + x e₂₀ + y e₀₁ is ganja.js's. Constructions whose shapes follow a dragged point: Cabri Géomètre (Jean-Marie Laborde, 1988) and GeoGebra (Markus Hohenwarter, 2001). No code was taken from any of them. The credits line on the page says the same. |
| `examples/countdown`: every way to reach a target with + − × ÷, written in the editor by clicks | Adapted | Graham Hutton, "The countdown problem", *Journal of Functional Programming* 12(6), 2002 ([pdf](https://www.cs.nott.ac.uk/~pszgmh/countdown.pdf)): the search and its `valid`. The game is Channel 4's *Countdown*. |
| GET as a read that may run under `Choice`, fetched once per address per run | Our own | Leans on HTTP's definition of safe methods (RFC 9110, §9.2.1). LANGUAGE.md "The web". |

## Concurrency, parallelism and collections (designed, not built)

Proposed in [LANGUAGE-NEEDS-2026-10-24.md](../reports/reviews/LANGUAGE-NEEDS-2026-10-24.md); the full list of sources is there. When a row is built, its entry moves to the section of the feature.

| What | Label | Who and where |
|---|---|---|
| `together` as a scope no branch outlives; errors stop the siblings | Influence | Trio's nurseries (Nathaniel J. Smith, "Notes on structured concurrency", 2018); OCaml 5 Eio's `Fiber.both` and switches (prior art). |
| Waiting in direct style, no async colour, the handler decides | Influence | Koka, Effekt, OCaml 5 effects; Bob Nystrom, "What color is your function?" (2015) names the problem. |
| Parallel for pure code, concurrent for waiting code | Influence | Simon Marlow, *Parallel and Concurrent Programming in Haskell* (2013); `par`/`pseq` considered, annotations rejected. |
| Seeded schedules and virtual time for tests | Prior art | FoundationDB's deterministic simulation (Will Wilson, 2014); tokio's paused clock. |
| Work stealing, or-parallel search, data parallelism | Prior art | Cilk (Blumofe, Leiserson; Frigo, Leiserson, Randall 1998), Chase-Lev deque (2005); Aurora and Muse Prologs; NESL (Blelloch), Futhark (Henriksen et al. 2017). |
| Channels; actors not a construct; STM | Influence / Considered, rejected | CSP (Hoare 1978), Go, Erlang (Armstrong); STM (Harris, Marlow, Peyton Jones, Herlihy 2005). |
| Maps with one meaning and several representations; an order on data; Outcome; foreign definitions | Influence | Weight-balanced trees (Adams 1993), HAMT (Bagwell 2001), RRB vectors (Bagwell, Rompf 2012); OCaml's `compare` and Erlang's term order; Rust's `Result`; Gleam's `@external` and Elm's ports. |

## Stable references, in place and reactive collections (designed, not built)

Proposed in [STABLE-REFERENCES.md](../design/data/STABLE-REFERENCES.md) (BACKLOG L98-L101, C56-C61); the full list of sources is there. When a row is built, its entry moves to the section of the feature.

| What | Label | Who and where |
|---|---|---|
| Values stay values; the compiler stores ones with one holder in place, invisibly | Ersagun's idea / Prior art | Ersagun asked for "the window" between pure functions and stable references (2026-10-29). Done before: Clean's uniqueness types; Koka's Perceus and FBIP (Reinking, Xie, de Moura, Leijen 2021; Lorenzen, Leijen, Swierstra 2023); Roc; Lean 4; Hylo's mutable value semantics (Racordon, Abrahams et al. 2022) and Swift's copy on write. Design: docs/design/data/IN-PLACE.md. |
| A cell owns its value; writes are edits at a path; reads tracked by path so data inside stays plain | Influence | Solid's `createStore` and `produce` (Ryan Carniato), MobX (Michel Weststrate), Immer's patches; DBSP (Budiu et al. 2023), differential dataflow (McSherry et al. 2013), Jane Street's Incremental. The colour argument: Bob Nystrom, "What color is your function?" (2015). |
| Regions per scope, references as positions with a generation, flat inline layout | Influence | Goose (Wouter van Oortmerssen, 2026, [wiki](https://github.com/aardappel/goose/wiki)); Tofte and Talpin's regions (1994, MLKit); ECS engines' generational indices (Unity DOTS, Bevy, flecs by Sander Mertens); FlatBuffers. |
| Where code runs (workers, GPU) chosen by cost from the effect row | Influence | Unity's Burst compiler and job system; Futhark (Henriksen et al. 2017); Accelerate (Chakravarty et al. 2011); Halide (Ragan-Kelley et al. 2013); HVM and Bend (Victor Taelin, Higher Order Company). |
| Struct of arrays and parallel systems as later goals | Influence | Mike Acton, "Data-Oriented Design and C++" (CppCon 2014); Rust's rayon. |
| Persistent structures as the main road | Considered, rejected | Okasaki (1998), Clojure (Rich Hickey), Immutable.js: they bound the copy but keep the diff. |

## Edits at a path in a cell (L98a)

| What | Label | Who and where |
|---|---|---|
| `path`, `item path`, `then path`; `write at`, `insert at`, `remove at`, `move at` and `read at`, waking only the readers of the place (cells.ts `edit`, std.ts, STABLE-REFERENCES.md §1) | Influence | Solid's `createStore` with paths and `produce` (Ryan Carniato), MobX (Michel Weststrate), Immer's patches (Michel Weststrate). A path from fields written in place is `set`'s lens (REVIEW.md §5.3). Written fresh, no code taken. |

| `each` following the edits: one row made, moved or disposed per edit, no matching (cells.ts `each`, L99a) | Influence | Solid's `mapArray` and `<For>` with stores (Ryan Carniato), whose keyed rows this replaces matching with; differential dataflow's changes as data (McSherry et al. 2013). Written fresh. |
| Tracked views: a row reads its item through a view, each field or list case read a place it waits on (cells.ts `view`, L99b) | Influence | Solid's `createStore` (Ryan Carniato), whose proxies track each property read; MobX's observable objects (Michel Weststrate); Vue 3's `reactive` (Evan You). Written fresh, no code taken. |
| `each of`: rows of their own for a list inside a row's item, following the edits at that place (cells.ts `eachOf`, L99c) | Influence | Solid's nested `<For>` over a store's inner arrays (Ryan Carniato), where each level tracks its own array. Written fresh, no code taken. |

| The nested to-do outline (cells-programs.ts `outlineProgram`, L100) | Influence | TodoMVC (Addy Osmani, Sindre Sorhus and others) as the shape of a to-do demo; Solid's stores demo of nested to-dos (Ryan Carniato). Written fresh. |
| The nested to-do's look (cells-programs.ts `styles`, `draw item`) | Influence | Round ticks before the title and small actions that show on hover, as in to-do apps such as Things (Cultured Code) and Todoist (Doist). Our own rules and colours, written fresh; credited on the page. |

## Choice: failure and many answers

| What | Label | Who and where |
|---|---|---|
| `Choice`: an expression can fail or give many answers, lazily | Influence | Verse (Augustsson, Breitner, Claessen, Jhala, Peyton Jones, Shivers, Steele and Sweeney, "The Verse Calculus", ICFP 2023). Prior art: Icon's generators (Ralph Griswold), Prolog's backtracking. |

## Running any function backwards

| What | Label | Who and where |
|---|---|---|
| A function is a relation: any ports can be the inputs, the node's direction depends on how it's wired | Ersagun's idea | Prior art: relational programming in Prolog and [miniKanren](http://minikanren.org); constraint logic programming (Jaffar and Lassez, POPL 1987; CLP(R)); constraint propagation in Sketchpad (Ivan Sutherland, 1963) and ThingLab (Alan Borning, 1979); acausal equations in [Modelica](https://modelica.org) (Elmqvist, Mattsson and others); reversible languages such as Janus (Lutz and Derby, 1982). |
| The search: a lazy, fair stream of states | Adapted | miniKanren (Daniel P. Friedman, William E. Byrd, Oleg Kiselyov, *The Reasoned Schemer*, 2005), streams as in μKanren (Jason Hemann and Daniel P. Friedman, 2013). Credited in `src/lang/relate.ts`, BACKWARDS.md. |
| Waiting equations and checks sleep under the unknowns they read and wake when one gets a value | Prior art | Coroutining in Prolog: `freeze/2` and `when/2`, goals suspended on variables and woken by binding them, built on attributed variables (Christian Holzbaur, "Metastructures vs. attributed variables in the context of extensible unification", PLILP 1992); constraint solvers' watch lists. Credited in `src/lang/relate.ts` (`doze`) and BACKWARDS.md. |
| Whole-number sums run in any direction: any two sides give the third | Prior art | Prolog's CLP(FD) (`X #= Y + 1`, Markus Triska's clpfd library) and miniKanren's arithmetic relations (`pluso`, Kiselyov, Byrd, Friedman and Shan, "Pure, declarative, and constructive arithmetic relations", FLOPS 2008). Credited in BACKWARDS.md. |
| Fraction arithmetic runs in any direction, exactly | Prior art | Prolog's CLP(Q), constraints over the rationals (Christian Holzbaur, the clpqr library, 1995); the whole-number row above, over a field. Credited in `src/lang/relate.ts` (fractionGoal), BACKWARDS.md. |
| Modes of a function run backwards: an order for its goals, and how many answers (det, semidet, multi, nondet) | Influence | Mercury's mode and determinism analysis (Somogyi, Henderson and Conway, JLP 1996). `src/lang/modes.ts`, MODES.md, COMPILER.md. |
| Whether a backwards search ends, per mode, by measuring the known ports | Prior art | TermiLog (Lindenstrauss and Sagiv, ICLP 1997) and cTI (Mesnard and Neumerkel, SAS 2001), termination of logic programs per query mode. `src/lang/modes.ts`, MODES.md. |
| A backwards search drops a recursive call that can't return its answer: the body read as arithmetic on intervals, bounds that keep moving widened to infinity | Prior art | Abstract interpretation over intervals with widening (Patrick and Radhia Cousot, "Abstract interpretation: a unified lattice model for static analysis of programs", POPL 1977). `src/lang/bounds.ts`, BACKWARDS.md "Why the fast version did worse". |
| Equation solving: smallest blocks first, then isolate, eliminate, tear, Newton | Adapted | Block lower triangular ordering and tearing as Modelica compilers do (with Tarjan's algorithm); Gaussian elimination, bisection and Newton's method are textbook. `invertible/README.md`. |
| Two-way transformations, invertible printers and parsers | Influence | Lenses (Foster, Greenwald, Moore, Pierce, Schmitt, TOPLAS 2007), Boomerang (Bohannon et al., POPL 2008), "Invertible Syntax Descriptions" (Rendel and Ostermann, 2010). |
| Relational arithmetic on binary numbers | Influence | Kiselyov, Byrd, Friedman and Shan, "Pure, declarative, and constructive arithmetic relations" (FLOPS 2008). NUMBERS.md. |
| `hence` (a consequence that guides solving without being a constraint) | Our own | Not known to us elsewhere. |

## Derivatives

| What | Label | Who and where |
|---|---|---|
| Differentiating real functions written in the language (`derive.ts`) | Textbook | Symbolic differentiation. The product and quotient rules are the textbook ones. |
| `gradient`, and slopes through records of Numbers: one forward pass per part, each seeded with that direction | Prior art | Forward-mode automatic differentiation of a function of several inputs, one pass per input (Wengert, 1964), as JAX's `jacfwd` does. `derive.ts`, LANGUAGE.md. |
| A fold carrying (value, slope) pairs | Prior art | Forward-mode automatic differentiation (Wengert, 1964) and dual numbers (W. K. Clifford, 1873). `∂polynomial/∂x` is Horner's rule. |
| `derivative(f)` generated before compiling, so GPU code gets exact slopes | Prior art | Differentiating a program before code generation, as [Enzyme](https://enzyme.mit.edu) (Moses and Churavy, NeurIPS 2020) does for LLVM and GPU kernels. Noted in `shade`'s comment in `examples/raymarch`. |

## Numbers and representations

| What | Label | Who and where |
|---|---|---|
| Write the mathematical definition (Peano `Nat`, cons lists) and let the compiler run a fast representation underneath; meaning vs. representation | Ersagun's idea | Prior art: Hoare, "Proof of correctness of data representations" (1972), abstraction functions; Wadler's views (POPL 1987), credited in NUMBERS.md. |
| A representation written as one definition: `representation(meaning, space, jobs)`, each job typed as t's with r for t (std.ts, represent.ts `representationsIn`, L108a) | Prior art / Influence | Hoare's abstraction function (1972) for `meaning`; Lean's `@[implemented_by]` and GHC's rewrite rules for a definition done by a faster one; the jobs as a record, as an implementation of an interface is here (Haskell's type class dictionaries). Written fresh. |
| `Int` as `from(Nat) \| minus one minus(Nat)` | Adapted | Lean's definition of `Int`. NUMBERS.md. |
| Rich number systems, Clifford algebras instead of separate complex/quaternion/dual types | Ersagun's idea | Geometric algebra: W. K. Clifford (1878), David Hestenes; Dorst, Fontijne and Mann, *Geometric Algebra for Computer Science*. |
| Exact continued-fraction arithmetic | Adapted | R. W. Gosper, HAKMEM (MIT AI Memo 239, 1972), item 101. Credited in `src/lang/cells-programs.ts`, `reactive.html`, NUMBERS.md. e's expansion is Euler's. |
| Continued fractions computed on demand, through effects | Ersagun's idea | Call-by-need is Haskell's laziness; demand-driven incremental computation is Adapton (below). |
| `Algebraic` numbers as a polynomial and an isolating interval, arithmetic by resultants (`src/lang/algebraic.ts`, EXACT-REALS.md) | Prior art | Rüdiger Loos, "Computing in algebraic extensions" (1982); Sturm's theorem (1829); Mathematica's `Root`, Sage's `QQbar`/`AA`; Cohen, *A Course in Computational Algebraic Number Theory* (1993). Ersagun's idea (2026-10-26) that √2 is the number where x² = 2. |
| Polynomial algorithms for algebraic numbers: pseudo-remainders, the primitive remainder sequence, Sturm sequences, resultants of Sylvester matrices by fraction-free elimination | Textbook | Cohen, *A Course in Computational Algebraic Number Theory* (1993) §3.1-3.3; Sturm (1829); Erwin Bareiss, "Sylvester's identity and multistep integer-preserving Gaussian elimination" (Math. Comp. 1968). `src/lang/poly.ts`. |
| Polynomial equations at `Algebraic` run backwards to their exact real roots (relate.ts `exactRoots`, algebraic.ts `realRoots`) | Prior art | Real root isolation by Sturm's theorem (1829) and the root-object answers of computer algebra systems (Mathematica's `Solve` over the reals returning `Root` objects, Sage's `AA` roots). Ersagun's idea (2026-10-26) of running x² = 2 backwards. |
| `clifford table`: a Clifford algebra's multiplication table from its signature (prelude) | Textbook; prior art | W. K. Clifford, "Applications of Grassmann's extensive algebra" (1878); blades as bit sets with a sign from counting swaps, as in Steven De Keninck's ganja.js and Dorst, Fontijne and Mann, *Geometric Algebra for Computer Science* (2007). The test's quaternion product is Hamilton's (1843). Ersagun's idea of rich number systems as Clifford algebras. |
| Ways: `by its ways`, the `way` flag and the cheapest grounded way per field (std, prelude, arith.ts) | Algorithm; prior art | Donald Knuth, "A generalization of Dijkstra's algorithm", Information Processing Letters 6(1), 1977; Haskell's default methods and `MINIMAL` pragma. Ersagun's idea of several, even circular, ways chosen by the compiler (WAYS.md). Costs per target (L96c) after Spiral (Püschel et al., 2005), which picks among rewrite rules by cost per machine. |
| `Mat2` to `Mat4` and `matrix table`: matrices from the matrix-unit table (std, prelude) | Textbook | The matrix units E_ij with E_ij · E_jl = E_il, the standard basis of a matrix algebra; matrix multiplication from Arthur Cayley, "A Memoir on the Theory of Matrices" (1858). |
| `Fixed`: fixed-point numbers as an Int of 2⁻³² steps (std.fixed, prelude) | Prior art | Doom's `fixed_t` (16.16, id Software, 1993); deterministic lockstep simulation as in Bettner and Terrano, "1500 Archers on a 28.8" (GDC 2001). Ersagun's ask for numbers with the same bits on every machine and in big worlds (FIXED-POINT.md). |
| `trig at fixed`: CORDIC sin and cos, series exp and log, Heron's square root, all in Ints (prelude) | Algorithm | Jack Volder, "The CORDIC Trigonometric Computing Technique" (1959); log by 2·atanh((m − 1)/(m + 1)), the textbook series; Heron's method for the square root. |
| `show fixed`: the shortest decimal that reads back to the same steps (prelude) | Algorithm | Guy Steele and Jon White, "How to Print Floating-Point Numbers Accurately" (PLDI 1990), free-format digit generation, here in exact Ints. |
| `clifford reverse` and rotors: R · v · R̃ turns a vector, Cl(3, 0)'s even part as the quaternions (prelude) | Textbook; prior art | Rotors and the reverse from W. K. Clifford (1878) and David Hestenes, *New Foundations for Classical Mechanics* (1986); the quaternion correspondence is Hamilton's (1843) quaternions as the even subalgebra of Cl(3, 0). |
| `clifford sandwich`, `clifford reflect`, `clifford project`, `clifford exp`: rotors from a bivector's exponential, reflections n̂ x n⁻¹, projections ½(x − b̂ x b⁻¹), and motors moving points in projective geometric algebra (prelude) | Textbook; prior art | Versors and the sandwich product from David Hestenes, *New Foundations for Classical Mechanics* (1986), and Dorst, Fontijne and Mann, *Geometric Algebra for Computer Science* (2007); projective geometric algebra, its translators, motors and point convention from Charles Gunn and Steven De Keninck, "Geometric Algebra for Computer Graphics" (SIGGRAPH 2019 course), and De Keninck's ganja.js. Ersagun's choice of Clifford algebras for geometry (MATRICES.md). |
| std `Array a` and its builtins, a list's items side by side (std.ts) | Prior art | Arrays standing for sequences, as Clojure's persistent vectors and Haskell's Data.Vector do; the count kept first so equal and compare walk it, as length-prefixed arrays do. Made to be the `array of List` representation (REPRESENTATIONS.md step 5), with the Compiler lane's C30d. |
| `array of List`, a list's representation at Array, and the `hides` job (array-list.ts) | Prior art | Hoare, "Proof of correctness of data representations" (1972), the meaning as abstraction function; Clojure's vectors and Haskell's Data.Vector as sequences side by side; `hides` is the compiler's own `hidden` (represent.ts Storage) written in the language. |
| `linearMap`: a function's matrix and offset read from its graph (src/lang/linear.ts) | Textbook; prior art | The matrix of a linear map, column j the image of the j-th basis vector (textbook linear algebra); reading affine maps out of straight-line code as compilers do (LLVM's and Halide's affine analysis, MLIR's affine maps); the abstract evaluation follows derive.ts's reading of slopes. Ersagun's "linear maps are functions" (MATRICES.md). |
| Linear calls composed in compiled JS: f(g(x)) as one matrix product (compiler/src/compile.ts `linearCall`) | Textbook; prior art | The matrix of a composition is the product of the matrices (textbook); folding affine code at compile time as LLVM and MLIR do for affine maps. Ersagun's "linear maps are functions" (MATRICES.md). |
| Linear maps as WGSL matrices: `mat3x3f(…) * v + b`, compositions folded (compiler/src/wgsl.ts `affine`) | Textbook; prior art | The matrix of a linear map and of a composition (textbook); GPUs and shading languages run matrix times vector as a built-in (WGSL spec, matCxR). Ersagun's "linear maps are functions" (MATRICES.md). |
| Calls given data written down, worked out when compiled (projectional/src/lang/stage.ts) | Prior art | Partial evaluation: Futamura (1971); Jones, Gomard and Sestoft, "Partial Evaluation and Automatic Program Generation" (1993). Specialising geometric-algebra products to a known signature, as Gaigen (Fontijne) and ganja.js generate them. |
| The design of `Fixed` for deterministic game numbers (FIXED-POINT.md, not built yet) | Prior art | Doom's 16.16 `fixed_t` (id Software, 1993); Bettner and Terrano, "1500 Archers on a 28.8" (GDC 2001) on deterministic lockstep; CORDIC (Jack Volder, 1959; Specker 1965); libfixmath; Ada's and ISO/IEC TR 18037's fixed-point types. Ersagun's ask (2026-10-26). |
| Factoring over the integers for minimal polynomials | Textbook | Hans Zassenhaus, "On Hensel factorization I" (J. Number Theory 1969); David Cantor and Hans Zassenhaus, "A new algorithm for factoring polynomials over finite fields" (Math. Comp. 1981); Maurice Mignotte's coefficient bound (1974); Hensel lifting as in von zur Gathen and Gerhard, *Modern Computer Algebra*, Algorithm 15.10. `src/lang/factor.ts`. |
| `Real` as lazy nested intervals (designed, EXACT-REALS.md) | Prior art | Hans-J. Boehm, "Towards an API for the real numbers" (PLDI 2020); iRRAM (Norbert Müller); Edalat and Potts' exact real arithmetic. |

## Folds as representations, fusion

| What | Label | Who and where |
|---|---|---|
| Folds as the one way to consume data | Influence | Catamorphisms: Meijer, Fokkinga and Paterson, "Functional programming with bananas, lenses, envelopes and barbed wire" (FPCA 1991). |
| How a fold runs is a job of the representation of what it folds; no intermediate list | Prior art | Deforestation (Wadler, 1990); short-cut fusion, `foldr`/`build` (Gill, Launchbury and Peyton Jones, 1993); stream fusion (Coutts, Leshchinskiy and Stewart, 2007). Credited in NUMBERS.md and ROADMAP.md. |
| A list named by a let and used once is put where it is walked, so the fold sees what made it (compiler/src/inline-lets.ts, C49) | Prior art | Inlining a binding that occurs once in a place that runs at most once: GHC's occurrence analysis (Peyton Jones and Marlow, "Secrets of the Glasgow Haskell Compiler inliner", JFP 2002). |

## Evaluator and compiler

| What | Label | Who and where |
|---|---|---|
| Stackless evaluator, self tail calls as loops | Textbook | Continuations and defunctionalization (Reynolds, "Definitional interpreters", 1972); tail calls as jumps are standard compiler practice. |
| A recursion that builds a list (`cons(x, self(rest))`) compiled as a loop that fills the last cell's empty field | Prior art | Tail recursion modulo cons: Friedman and Wise, "Unwinding stylized recursions into iterations" (1975); OCaml 4.14's `[@tail_mod_cons]` (Bour, Clément and Scherer, 2021). `compiler/src/compile.ts`, GAPS.md G22; in WebAssembly (`compiler/src/scalar.ts` modCons) by keeping the items and reversing, as immutable cells can't be filled. |
| A block function's list written into an array it is handed (`$into` copies), including the list field of a two-field record such as the compressor's samples and level | Prior art | Destination-passing style: Minamide, "A functional representation of data structures with a hole" (POPL 1998); Shaikhha, Fitzgibbon, Peyton Jones and Vytiniotis, "Destination-passing style for efficient memory management" (FHPC 2017). `compiler/src/compile.ts` (`intoShape`, `intoMatch`), COMPILER.md "Folds are loops", GAPS.md P4. |
| List cells nobody else holds changed in place (`$own` copies), decided at compile time | Prior art | Koka's Perceus and "functional but in place" (Reinking, Xie, de Moura and Leijen, PLDI 2021; Lorenzen, Leijen and Swierstra, ICFP 2023), which do it with reference counts at run time. `compiler/src/compile.ts`, COMPILER.md "Data", GAPS.md G25. |
| Steps over a list (`keep`, `map` and definitions of their shape, between `split`/`characters` and `length`/`joinAll`) compiled as one loop with no list between | Prior art | Deforestation (Wadler, 1990) and short-cut fusion (Gill, Launchbury and Peyton Jones, FPCA 1993); ours inlines known steps. `compiler/src/compile.ts`, COMPILER.md "Folds are loops". |
| A fold over `characters(t)` in WebAssembly as one loop over t's bytes from the end, with no list (`compiler/src/scalar.ts` characters) | Prior art | Deforestation (Wadler, 1990), as above. |
| Lists that are only walked, or consed onto then walked, kept as arrays (`$arr` copies) | Prior art | Cdr-coding (Wilfred J. Hansen, "Compact list representation", CACM 1969; MIT Lisp Machine, Symbolics); ours is decided at compile time by the uses. COMPILER.md, NUMBERS.md. |
| Compiling `Choice` with success continuations (built for JS: the `$k` copies) | Adapted | Mercury's high-level C backend (Henderson and Somogyi, "Compiling Mercury to high-level C code", CC 2002), credited in COMPILER.md and `compiler/src/compile.ts`; the same convention in WebAssembly (`compiler/src/scalar.ts`, W4d), the rest of the search as a closure. |
| A search with one answer or none in WebAssembly as a function that gives a status after its answer, checked by each call (`compiler/src/wasm.ts`) | Adapted | Mercury's calling convention for semidet procedures, which return a success flag (Henderson and Somogyi, CC 2002, as above). |
| Choosing `one of` a list inside first, optional, all and count as a loop per choice (`compiler/src/scalar.ts`) | Influence | The translation of list comprehensions into loops, Philip Wadler, chapter 7 of Simon Peyton Jones, The Implementation of Functional Programming Languages (1987). |
| sin, cos, tan, exp, log, pow and atan2 in WebAssembly with no JavaScript host (`compiler/math/ieee754.cc`, generated `compiler/src/wasm-math.ts`) | Adapted | fdlibm (Sun Microsystems, 1993: "Permission to use, copy, modify, and distribute this software is freely granted, provided that this notice is preserved") as ported by the V8 project (src/base/ieee754.cc at 12.4.254.21, BSD licence), compiled by clang; scalbn's three-step scaling from musl (MIT). |
| mod in WebAssembly, which has no remainder of floats (`number.fmod` in `compiler/src/wasm-rt.ts`) | Adapted | musl libc's `fmod` (src/math/fmod.c, MIT licence, Rich Felker and contributors), translated to WebAssembly text on the bits. |
| A Number's shortest digits in WebAssembly (`number.js` in `compiler/src/wasm-rt.ts`), laid out as ECMA-262's Number::toString | Adapted | Ryū, Ulf Adams ("Ryū: fast float-to-string conversion", PLDI 2018; d2s.c, Apache 2.0 or Boost licence), translated to WebAssembly text, its tables made with BigInt. |
| Big Ints in WebAssembly: add, subtract, multiply, compare, show and read on 32-bit limbs (`compiler/src/wasm-rt.ts` mag.*) | Prior art | Donald Knuth, The Art of Computer Programming vol. 2, 4.3.1, the classical algorithms (A, S, M, and D for division, laid out as Henry S. Warren's divmnu in Hacker's Delight, 9.2; base 10⁹ chunks for show). Written fresh, no code taken. |
| Int in WebAssembly as an `i31ref` while it's small, else a box (`compiler/src/wasm.ts`, `wasm-rt.ts` int.of) | Prior art | Hoot, Guile Scheme on WasmGC (Spritely Institute), which keeps fixnums as i31ref; wasm_of_ocaml (Jérôme Vouillon, OCaml's ints as i31ref). |
| Programs as WASI commands: the console, files and arguments over `wasi_snapshot_preview1` (`compiler/src/wasm-rt.ts`) | Influence | WASI, the WebAssembly System Interface (Bytecode Alliance and the W3C WebAssembly CG), whose preview 1 calls we write against; run with wasmtime and Node's `node:wasi`. |
| Deep recursion in compiled JS on the heap: a generator copy whose recursive calls yield, run by a loop past 1,000 calls (`compiler/src/compile.ts` C21, `$drive` in `compiler/src/runtime.js`) | Prior art | Kotlin's `DeepRecursiveFunction` (recursive calls as suspensions kept on the heap); trampolined style (Ganz, Friedman and Wand, ICFP 1999). Written fresh, no code taken. |
| Trying many rewrites at once and keeping the cheapest (equality saturation, e-graphs), discussed in RUNNING.md "How the compiler makes code faster" as the strategy we don't use yet | Prior art | Tate, Stepp, Tatlock and Lerner, "Equality saturation", POPL 2009; Willsey et al., "egg", POPL 2021. Not used: the compiler's passes are fixed rewrites, and only representations are chosen by cost. |
| `Choice` functions as lazy streams of answers (the generators) | Prior art | Wadler, "How to replace failure by a list of successes" (FPCA 1985). COMPILER.md. |
| Native code via C with reference counting (`compiler/src/c.ts`: dup and drop from liveness, a matched cell's fields moved out when nobody else holds it, and the cell reused by the arm's new cell, NATIVE.md N5b and N5c) | Influence | Koka's Perceus (Reinking, Xie, de Moura and Leijen, PLDI 2021), its drop specialization in `takeApart`; Lean 4's reset/reuse, the cell given to the new one (Ullrich and de Moura, "Counting Immutable Beans", IFL 2019). No code taken. |
| sin, cos, tan, exp, log, pow and atan2 in native programs (generated `compiler/src/c-math.ts`, by `compiler/math/to-c.ts`) | Adapted | The same fdlibm as V8 ports it (`compiler/math/ieee754.cc`, notices kept), translated from C++ to C. |
| Big Int division in native programs (`lab__divmod` in `compiler/src/c-rt.ts`) | Adapted | Knuth's Algorithm D (The Art of Computer Programming vol. 2, 4.3.1) as Henry S. Warren's Hacker's Delight writes it (`divmnu`), rewritten for 32-bit limbs in a 64-bit word. |
| Native Ints as one word, the value itself when it fits and a pointer to limbs when it doesn't (`compiler/src/c-rt.ts`) | Prior art | Tagged small integers as in OCaml and Lean 4 (whose `Nat` is a scalar until it overflows, then a GMP number). No code taken. |
| Native cells from a free list per size, cut from blocks that are never given back (`lab_new` in `compiler/src/c.ts`) | Prior art | Small-object allocators in reference-counted runtimes: Lean 4's (`lean_alloc_small`, free lists per size class in pages) and Koka's use of mimalloc (Leijen, Zorn and de Moura, "Mimalloc: free list sharding in action", 2019). Written fresh, no code taken. |
| Compiling numeric code to WebAssembly and WGSL | Ersagun's idea | Follows the [WGSL](https://www.w3.org/TR/WGSL/) and WebAssembly specifications. |
| Whole programs to WebAssembly with the host's garbage collector (WasmGC), one struct type per case (design, WASM.md) | Prior art | OCaml's wasm_of_ocaml (Jérôme Vouillon), Guile's Hoot (Spritely Institute), Kotlin/Wasm and dart2wasm compile garbage-collected languages to WasmGC. No code taken. |

## Cells, reactivity and web apps

| What | Label | Who and where |
|---|---|---|
| Is the effect system like Solid.js? Make it reactive | Ersagun's idea | The answer was yes; the model below is Solid's. |
| Fine-grained reactivity: signals, memos, effects, owners, no virtual DOM | Adapted | [Solid.js](https://www.solidjs.com) (Ryan Carniato), after S.js (Adam Haile). Credited in `src/lang/cells.ts`, LANGUAGE.md, WEB.md, `reactive.html`. |
| Update order: mark dirty on write, pull on read | Adapted | Milo's [Reactively](https://dev.to/modderme123/super-charging-fine-grained-reactive-performance-47ph). |
| One mechanism for laziness and incremental update | Prior art | Adapton (Hammer, Phang, Hicks and Foster, PLDI 2014). |
| Model, update, view for web apps | Considered, rejected | [The Elm architecture](https://guide.elm-lang.org/architecture/) (Evan Czaplicki). Still possible as a style, WEB.md. |
| An input's value is set only when it differs, so typing isn't disturbed | Influence | Svelte's `bind:value` (Rich Harris). In `src/lang/html.ts`. |
| Elements as (tag, attributes, children) | Influence | HyperScript's `h()` (Dominic Tarr), as virtual-DOM libraries since use it. `Html` in std.ts. |
| The html module: each tag a function of its children, attributes added by wrapping, a style sheet as a list of rules | Prior art | Elm's Html module (Evan Czaplicki), each tag a function; Hiccup (James Reeves), markup as plain data. `src/lang/html-source.ts`, WEB.md "The widgets are functions". |
| Two-way binding by running the view backwards | Our own | Follows from running functions backwards (Ersagun's idea, above). Prior art: lenses (Foster, Greenwald, Moore, Pierce and Schmitt, "Combinators for bidirectional tree transformations", TOPLAS 2007). `examples/converter`. |
| `inverse` and `conjugate` of a named function compiled as a solve on it (`compiler/src/inverses.ts`) | Prior art | Specializing a function on a known argument is partial evaluation (Yoshihiko Futamura, 1971; Jones, Gomard and Sestoft, "Partial Evaluation and Automatic Program Generation", 1993). |
| Haar's split in the pedal written as lifting steps, so its way back is arithmetic (`examples/pedal`, AUDIO.md A1c) | Prior art | Wim Sweldens, "The lifting scheme: a custom-design construction of biorthogonal wavelets", 1996. |
| A sound played on the audio thread, 128 samples at a time, from a program run again there (`src/lang/audio-worklet.ts`) | Prior art | The Web Audio API's AudioWorklet (W3C, Hongchan Choi and others); a page's cells cross to it over its MessagePort, as Faust and Elementary Audio drive a running graph's parameters from outside. |
| The strum the pedal page plays (`examples/pedal/strum.wav`, `apps/strum.wav`) | Adapted (recording) | Six notes of a steel-string acoustic guitar from the University of Iowa Musical Instrument Samples (Lawrence Fritts), as trimmed and normalised in Nicholas Brosowsky's tonejs-instruments, licensed CC BY 3.0 (https://github.com/nbrosowsky/tonejs-instruments). Mixed here into an open E chord, 14 ms apart, at 24 kHz. Named in the pedal program's comment. It replaced a Karplus–Strong synthesis that rattled (Ersagun, 2026-10-24). |
| The pedal's output brought back to the loudness that came in, so Clean against Driven compares tone, not volume (`examples/pedal`, `as loud as`) | Prior art | Level-matched A/B comparison, standard in listening tests (ITU-R BS.1116); credited in the definition's comment, which the editor shows. |
| The pedal's compressor: a peak level that rises at once and falls exponentially, and a gain by ratio over a threshold in log terms (`examples/pedal`) | Prior art | Giannoulis, Massberg and Reiss, "Digital Dynamic Range Compressor Design—A Tutorial and Analysis", JAES 2012. |
| A match run backwards whose arms build the result with different cases has one answer (`src/lang/modes.ts`) | Influence | Mercury's switch detection and determinism analysis (Somogyi, Henderson and Conway, JLP 1996). |
| examples/pedal: drive as tanh(k · atanh x), a scaling in saturation space by conjugation, on the slow band of Haar's split | Prior art | tanh soft clipping is textbook distortion; Haar's wavelet (Alfréd Haar, 1910); a multiband pedal splits with a crossover instead. Credited in the program's comment, which the editor shows. |
| Audio as functions on blocks with state in cells, played in an AudioWorklet (design, AUDIO.md) | Prior art | Faust (Orlarey, Fober and Letz, Grame), SuperCollider (James McCartney; unit generators by block, server apart from the language), Elementary Audio (Nick Thompson), the W3C Web Audio API's AudioWorklet. No code taken. |
| Mobile apps as a packaged web page (`lab build-app`, `projectional/cli/app.ts`) | Prior art | PWAs: W3C's Web Application Manifest and Service Workers (the cache-first offline pattern); [Capacitor](https://capacitorjs.com) (Ionic), whose `capacitor.config.json` with `webDir` the folder follows. WEB.md. |
| A page's event handler that stops at a fetch is taken back and run again (`Cells.attempt`, src/lang/cells.ts) | Prior art | Software transactional memory's `retry` (Harris, Marlow, Peyton Jones and Herlihy, *Composable Memory Transactions*, 2005), in one thread: writes undone, printing held until the run is kept. No code taken. |

## Shaders

| What | Label | Who and where |
|---|---|---|
| Sphere tracing | Adapted | John C. Hart, "Sphere tracing: a geometric method for the antialiased ray tracing of implicit surfaces", The Visual Computer, 1996. |
| The ring's (torus's) distance, the smooth minimum, the soft shadow | Adapted | Inigo Quilez's formulas, from his [distance functions](https://iquilezles.org/articles/distfunctions/), [smooth minimum](https://iquilezles.org/articles/smin/) and [soft shadows](https://iquilezles.org/articles/rmshadows/) articles. Credited in each definition's comment in `examples/raymarch` (shown in the editor), on `shaders.html` and in COMPILER.md. |
| An algebra's product from its multiplication table (`table product`, `complex table`) | Prior art | An algebra's structure constants, the textbook construction; generating algebras from their tables as ganja.js does for Clifford algebras (Steven De Keninck). Credited in `src/lang/prelude-source.ts` and ALGEBRA-TABLES.md. |
| The Mandelbrot shader's colours | Ersagun's | His HSI colour space (hue, saturation, intensity on linear RGB; the `hsi-playground` repository): a circle of hues at saturation 1/2 and one luminance. Rec. 709's luminance weights and the sRGB transfer function (IEC 61966-2-1) are the standards. Credited in `examples/mandelbrot` (the comments of `hsi colour`, `palette` and the Program note, shown in the editor) and on `shaders.html`. Before this the colours were Inigo Quilez's [cosine palette](https://iquilezles.org/articles/palettes/). |
| The Mandelbrot set, drawn by counting escape steps | Prior art | Benoit Mandelbrot (1980); counting the steps until `z ↦ z² + c` leaves radius 2 is the standard way to draw it. Credited in `examples/mandelbrot` and on `shaders.html`. |
| Records of Numbers printed as WGSL vector operations (parts doing the same thing become one `vec3f` operation; `dot`, `mix`, `normalize`, … recognised) | Prior art | Superword-level parallelism: Samuel Larsen and Saman Amarasinghe, "Exploiting superword level parallelism with multimedia instruction sets", PLDI 2000. Ours works on the expression tree. Credited in `compiler/src/wgsl.ts` and COMPILER.md "Vectors". |
| A shader runs something that might not finish only under a budget, `first(() => with fuel(n, …), …)`, counted as the evaluator counts | Prior art | Fuel as a bound on recursion is an old technique: the "fuel" argument in Coq and Agda developments, gas in the Ethereum virtual machine (Gavin Wood, the Ethereum yellow paper, 2014), fuel in [Wasmtime](https://docs.wasmtime.dev/api/wasmtime/struct.Config.html#method.consume_fuel). GPU drivers' watchdogs (Windows TDR) are the runtime's blunter version. `compiler/src/scalar.ts`, COMPILER.md, the comment on `colour` in `examples/raymarch` (shown in the editor). |
| A page runs each update under a step budget and shows "didn't finish" for a part that runs out | Prior art | Browsers stop a script that runs too long (Firefox's and Chrome's "page unresponsive" watchdog), per page; here it's per update and counted in calls, the same fuel as above. `src/lang/run.ts` (`withSteps`), `src/lang/html.ts`, LANGUAGE.md (Cells); a page shows "didn't finish" where it happens. |
| `map parts`, `zip parts`, `total`: one operation for every record of Numbers, typed by a constraint on type variables | Prior art | Haskell's `Functor`/`Applicative` (`fmap`, `liftA2`) over a record, and type classes as constraints (Philip Wadler and Stephen Blott, "How to make ad-hoc polymorphism less ad hoc", POPL 1989); APL's and NumPy's elementwise arithmetic. Ours has one built-in constraint, not classes. LANGUAGE.md, std.ts. |
| The vectors module's operations and names (dot, length as magnitude, normalize as unit, mix, clamp, reflect) | Influence | GLSL's and [WGSL's](https://www.w3.org/TR/WGSL/#numeric-builtin-functions) built-in functions, which they compile to. Said in the module's comments, shown in the editor. |
| Generic definitions copied once per type for the GPU | Prior art | Monomorphisation, as in C++ templates and Rust generics, and whole-program in MLton (Stephen Weeks, "Whole-program compilation in MLton", 2006). `compiler/src/scalar.ts`. |
| The scene (a drop in a ring over a checker floor), the ripples, normals as the scene's gradient | Our own | Written for this project; computing normals as the gradient of the distance is standard practice. |

## The node editor

| What | Label | Who and where |
|---|---|---|
| A let is a reroute dot on a wire | Influence | Blender's node editor reroutes (also Unreal and Houdini). Credited in `editor/typedGraph.ts`, README.md. |
| Named let/get nodes, wire portals | Influence | Unreal Blueprints' local variables and named reroutes, Max/MSP send/receive, World Machine portals. NODE-EDITOR.md. |
| Bridges over crossing wires, tunnels under nodes | Ersagun's idea | Prior art: line hops in circuit schematics and Visio. |
| Tidy reorders columns to cut crossings | Prior art | The barycenter step of layered graph drawing: K. Sugiyama, S. Tagawa, M. Toda, "Methods for Visual Understanding of Hierarchical System Structures", IEEE Trans. SMC, 1981. Credited in `editor/graphLayout.ts`. |
| Tidy everything lays the graph out afresh in columns | Prior art | The longest-path layering of layered graph drawing, from the same Sugiyama, Tagawa and Toda paper. `editor/graphLayout.ts` `arrange`. |
| Tidy everything centres each node on its inputs | Prior art | The parent-over-children placement of tidy tree drawing: E. M. Reingold, J. S. Tilford, "Tidier Drawings of Trees", IEEE Trans. Software Engineering, 1981. A column goes as near those centres as its order and gaps allow by isotonic regression, pooling adjacent violators: M. Ayer, H. D. Brunk, G. M. Ewing, W. T. Reid, E. Silverman, Ann. Math. Statist., 1955. `editor/graphLayout.ts` `arrange`, `nearestInOrder`. |
| Loose parts: pieces lying beside a definition, kept, checked, never run | Ersagun's idea | Prior art: Scratch's canvas, where blocks not attached to a script don't run (Resnick, Maloney et al., MIT); unconnected nodes in Blender, Unreal Blueprints and Houdini. Hazel (Omar et al.) for an editor where every state is meaningful because gaps are holes. `editor/drafts.ts`, NODE-EDITOR.md "Loose parts". |
| Frames that fold into one box with their wires in and out | Influence | Minimized network boxes in Houdini; Unreal Blueprints' collapsed graphs (Collapse Nodes), which keep their pins. `editor/typedGraph.ts` `fold`, NODE-EDITOR.md. |
| Right-click search at the pointer, tidy, frames | Influence | Blender (Shift-A, Node Wrangler), Unreal, Houdini (Tab, network boxes). Full list with links in NODE-EDITOR.md. |
| Known visual-programming pitfalls | Influence | M. Burnett et al., "Scaling Up Visual Programming Languages", IEEE Computer, 1995, and the sources in NODE-EDITOR.md. |
| Visual design (Design E, neutral colours) | Our own | Designed in the project. Fonts: Red Hat Display and DM Mono (SIL Open Font License, via Google Fonts). |

## Testing

| What | Label | Credit |
|---|---|---|
| `npm run affected`: run the tests whose imports reach a change | Prior art | Google's TAP runs the test targets that depend on the changed files: A. Memon et al., "Taming Google-Scale Continuous Testing", ICSE-SEIP 2017. Regression test selection is an old field; see also Ekstazi (M. Gligoric et al., ISSTA 2015). Credited in `test/affected.ts`. |
| A slice of each sweep per run, all of it at other times | Prior art | Close to Facebook's predictive test selection, which runs a learned subset of the affected tests per change (M. Machalica et al., ICSE-SEIP 2019); ours is a fixed rotating slice, with no learning. |

## Example programs

| Example | Label | Who and where |
|---|---|---|
| `examples/wc` | Adapted | Unix `wc` (Version 1 AT&T Unix, 1971); options and layout follow GNU coreutils `wc`. Credited in its comments and LANGUAGE.md. |
| `examples/sort` | Textbook | Insertion sort. Credited in its comment. |
| `examples/queens` | Textbook | The eight queens puzzle (Max Bezzel, 1848), a classic backtracking example (e.g. Wirth, "Program development by stepwise refinement", 1971). |
| `examples/calc` | Textbook | A tokenizer and a recursive-descent parser with one function per precedence level. |
| `examples/raymarch` | Adapted | See Shaders. |
| `examples/shaders` (ripples) | Our own | Written for this project. |
| `examples/quadratic`, `physics`, `calculus`, `algebra` | Textbook | The quadratic formula, projectile motion, Newton's method, polar coordinates. The programs around them are ours. |
| `examples/numbers` | Textbook | Peano arithmetic (Giuseppe Peano, 1889). |
| `conjugate(f, g)` and `examples/conjugate` (f⁻¹ ∘ g ∘ f) | Ersagun's idea; textbook | Conjugation and commutators are standard group theory (familiar from Rubik's cube methods). The example's 2.2 power is the simple form of the sRGB curve (IEC 61966-2-1), and its band split is the Haar wavelet (Alfréd Haar, 1910); a multiband compressor splits with a crossover instead. |
| Fractions (`std.rational`, `lowest terms`) | Textbook | Lowest terms by Euclid's algorithm (Elements VII, c. 300 BC). Kept canonical so equality is structural, as in Scheme's and Haskell's rationals. |
| Complex numbers (`std.complex`) as a pair of Numbers with the usual product, `complex exp` by Euler's formula | Textbook | Complex arithmetic and e^(iθ) = cos θ + i sin θ (Euler, 1748); a complex number as a `vec2f` on the GPU, as shader code commonly does. Named in the prelude's comments. |
| `compare`: one order on all plain data, cases in declared order then fields | Prior art | OCaml's polymorphic `compare`; Erlang's term order. LANGUAGE.md "Order, and sort", `run.ts compareValues`. |
| `sort`: a merge sort, bottom-up over a binary counter of runs | Prior art | John von Neumann's merge sort (1945); the bottom-up counter form as in Chris Okasaki, *Purely Functional Data Structures* (1998). Named in the prelude's comment on `sort`. |
| `Outcome`, `attempt`, `value or abort`: an Abort kept as data | Influence | Rust's `Result` and the `?` operator; mirrored on the language's own `Optional`/`optional`/`value of`. LANGUAGE.md "`Outcome`: the data form of Abort", named in the prelude's comment on `attempt`. |
| `Map` and `Set`: entries sorted by key, one spelling, folds in key order | Prior art | Haskell's `Data.Map`, OCaml's `Map`, Rust's `BTreeMap`; one canonical spelling as NUMBERS.md's quotient types. DATA-STRUCTURES.md, LANGUAGE.md "Maps and sets", named in the prelude comment. |
| `smallest item`, `largest item`, `smallest key`, `largest key` (prelude, map-tree.ts `first` and `last`) | Prior art | Haskell's `Data.Set.lookupMin` and `lookupMax`, Rust's `BTreeSet::first` and `last`. Asked for by the routes example (docs/reports/GAPS.md round 5, LG1). |
| `update at` (prelude, map-tree.ts `tree update at`) | Prior art | Haskell's `Data.Map.alter` and `insertWith`, Rust's `HashMap::entry` API. Asked for by the routes example (docs/reports/GAPS.md round 5, LG2). |
| `sort by` (prelude) | Prior art | Python's `sorted(key=…)` and Haskell's `Data.List.sortOn`; the merge sort is the prelude's own (von Neumann, 1945; Okasaki's bottom-up counting). Asked for by the routes example (docs/reports/GAPS.md round 5, LG3). |
| Maps stored as a weight-balanced tree | Prior art | Nievergelt and Reingold, weight-balanced trees (1972); Stephen Adams, "Efficient sets: a balancing act" (1993), as in Haskell's `containers`; the parameters ⟨3, 2⟩ from Hirai and Yamamoto, "Balancing weight-balanced trees" (2011). Named in `src/lang/map-tree.ts` and DATA-STRUCTURES.md. |
| Operations answered later: the case gets the rest as a function, resumed at most once | Prior art | Koka's `ctl` operations (Daan Leijen, 2017) and their fast paths (Xie and Leijen, 2021); one-shot continuations checked at run time as in OCaml 5 (Sivaramakrishnan et al., "Retrofitting effect handlers onto OCaml", 2021); handlers after Plotkin and Pretnar (2009). ANSWERED-LATER.md, LANGUAGE.md, `run.ts` resumeRest. |
| A plain literal is some Number (`3` is an Int, Rational, Float64 or Complex, whichever its place needs; `0.5` not an Int), and `Number` names the family | Prior art | Haskell's numeric literals and defaulting: a literal is `fromInteger n :: Num a => a` (`fromRational` with `Fractional` for one with a fraction part), and an ambiguous one defaults (Haskell 2010 report §6.4.1 and §4.3.4). Ours resolves before anything runs, and an open one is an Int when it is whole (Haskell's `Integer`) and a Float64 otherwise (`Double`). WHAT-NUMBER-MEANS.md, LANGUAGE.md "Numbers", infer.ts and arith.ts. |
| `compare` on Numbers exact and total, NaN last | Prior art | IEEE 754-2008's totalOrder predicate (§5.10), except that −0 and 0 are the same here. LANGUAGE.md "Order, and sort", `run.ts` numberOrder. |
| Private constructors: a constructor only the library keeping its type's rule may call | Prior art | OCaml's private types (`type t = private …`); Haskell's smart constructors with the constructor left out of the export list. LANGUAGE.md "Private constructors", the variant's `private` flag in `src/model.ts`. |
| Recursive lets: a let's function calls itself by the let's name, lifted into a definition before it runs | Influence; prior art | ML's `let rec` (Milner, Tofte and Harper, *The Definition of Standard ML*, 1990), monomorphic inside as there; lambda lifting from Thomas Johnsson, "Lambda lifting: transforming programs to recursive equations" (1985). LANGUAGE.md "Types", `src/lang/lift-lets.ts`. |
| Interfaces and implementations: an interface is a record of functions over one type, an implementation is a definition of it at one type, each use resolved to a direct call before running, dynamic dispatch only when an implementation is passed as a value | Ersagun's call (2026-10-27: "a separate thing", "0 cost if possible"); prior art | Type classes, with instances as dictionaries (Philip Wadler and Stephen Blott, "How to make ad-hoc polymorphism less ad hoc", POPL 1989); Rust's traits, monomorphised by default with `dyn Trait` on request, and their coherence (one impl per trait and type); monomorphisation as in C++ templates and MLton; an implementation as an ordinary value, as with Scala's implicits and ML modules. Choosing Int or Float64 for an open literal by which implementations exist follows Haskell's defaulting. INTERFACES.md, `src/lang/infer.ts` and `src/lang/arith.ts`. |
| Several named results: a predicate whose result ports are named, used as `length, angle = polar(x, y)` (the def's `results`, L95a) | Prior art | Mercury's and Prolog's modes (Somogyi, Henderson and Conway, 1996), chosen per use; Modelica's equations without direction; multiple values in Go, Lua and Common Lisp, side by side rather than a tuple. RESULTS.md, `src/lang/infer.ts` results, `src/lang/render.ts`. |
| A relation's other direction given by a definition of its own (`unpolar` as a direction of `polar`, L97b) | Prior art | Mercury's mode-specific clauses and `promise_equivalent_clauses`: one predicate, a definition per mode, promised to agree. POLAR.md, `src/lang/directions.ts`. |
| Trig's polar, a field with two results, with sin and cos as its ways and it as theirs (L97c) | Prior art | C's `sincos` and x87's `fsincos`, both results of one evaluation; Common Lisp's `cis`; Julia's `sincos`. POLAR.md, `src/lang/prelude-source.ts`. |
| Fixed's unpolar: CORDIC's vectoring mode, (x, y) turned onto the x axis, the turns adding up to the angle (L97c2) | Adapted | Volder, "The CORDIC Trigonometric Computing Technique", 1959. POLAR.md, `src/lang/prelude-source.ts` `cordic vector`. |
| asin and acos as the angle of a vector, √ as e^(½ log x) for a type with only exp and log (L97c3) | Textbook | The identities asin s = atan2(s, √(1 − s²)) and acos c = atan2(√(1 − c²), c), as C libraries compute them (fdlibm's e_asin.c reduces the same way). POLAR.md, `src/lang/prelude-source.ts`. |
| Dual numbers (`std.dual`): value + slope·ε with ε² = 0, the product rule for ·, the chain rule for Trig, and `slope by duals` | Textbook; prior art | Dual numbers from W. K. Clifford, "Preliminary sketch of biquaternions" (1873); their use for derivatives is forward-mode automatic differentiation (R. E. Wengert, "A simple automatic derivative evaluation program", 1964), as in Julia's ForwardDiff. Named in the prelude's comments, INTERFACES.md. A typedef's `unique` keeps Dual apart from Complex, which has its shape, when hashed: Unison's `unique type`. |
| `+ − · −x <` as the interfaces Arithmetic and Ordered, so a type of the program's own joins the one `+` and `<` | Prior art | Haskell's `Num` and `Ord` classes and Rust's `Add`/`Mul`/`PartialOrd` traits (monomorphised, as here). The test's quaternion product is W. R. Hamilton's (1843). Named in INTERFACES.md and test/own-arithmetic.test.ts. |
