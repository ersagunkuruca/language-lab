# Roadmap

Updated 2026-10-22, after PR #51, and again after the second review
(evening). This replaces §10 of
[REVIEW.md](REVIEW.md), which stays as the review it was written as. The
ideas behind the new items, and the current answer to each, are in
[NOTES.md](NOTES.md).

## Done

| step | what landed | PRs |
|---|---|---|
| 1. Make the claims true | size-change termination, strict positivity, lets in the guard, `derivative` returns `Choice` instead of crashing, running backwards never throws, `equal` on plain data only, folds over nested types (rose trees) | #34, #38 |
| 2. Real-sized data | stackless evaluator, compiled folds are loops, 130-bit ids, `merge` refuses clashes, linear printer-as-parser, `Int` that never overflows, text operations, record `set`, generic `show` | #32, #33, #36, #39 |
| 3. Write a program in the editor | new program, definition, type, parameter, case and field; save and open; copy and paste; values on wires; insertion sort built by clicks; examples frozen as JSON; Show inline; one set of values per function; palette about 5× faster | #35, #37, #40, #42, #45, #46 |
| 4. One world | a network is a function returning `Bool`, a wire is `equal`; network node kinds, network editor and the untyped checker removed; units on every program | #41 |
| 5. Signatures and modules | publish by hash, pins, the prelude as the first module, file format v2 | #47 |
| 6a. Effects, checker and evaluator | effects a program defines (handlers are `match`), `Abort`, `Log`, `Optional`, world effects refused under `Choice`, files and console IO, `main` with arguments and an exit code | #48 |

**The bug pause** (11:28 to about 12:25). The page broke after the one-world
merge (an all-digit parameter id was read as a port number). Fixed in #49,
with a headless-browser smoke test (`npm run smoke`) that runs on every PR
and before Pages publishes. #50 fixed old saved copies of examples, and the
smoke test now replays one. #51 replaced the row of tabs with one outline
for programs and definitions.

Still open from steps 1 to 5: mode analysis through cases and folds (step
4), data-type upgrades and path namespaces (step 5), the editor's "copy into
my program" and pin gestures, compiled plain recursion past about 10k
levels, relational reads past about 1,300 items.

## First, after the second review (2026-10-22, evening)

[REVIEW-2026-10-22b.md](REVIEW-2026-10-22b.md) found holes that come
before any item below, bugs before features. In order, one PR each (its §9
has the detail):

1. **The shader freeze:** `shadow` gets a step limit; the preview waits
   for each frame and handles a lost device (editor thread).
2. **The shader profile refuses loops it can't see end**, instead of
   dropping `Diverge`.
3. **Equality with one meaning**, backwards too, and a round-tripping
   `show`. Done except `show`: one rule for every type rather than exact
   everywhere, because solving over floats needs the tolerance (NOTES.md,
   "Equality: one rule").
4. **A backwards `one of` waits for its list**, and forward/backwards
   agreement over every example in CI.
5. **Reading a formula stops hiding `Diverge`.**
6. **Systematic checks:** the effect ledger and container matrix, equality
   laws, save/open round trip of every example, a shader soak test.
7. **Docs** brought up to date, and the error table generated from tests.

After those, the order of the remaining open work changes. **The editor
comes before the next target**: its "can't edit" list (inner lambda
parameters, swapping a call's function, statement order) is fixed first,
so that the next bigger program (GAPS.md round 2) is written in the editor
rather than in the TypeScript DSL. Then time, randomness and HTTP as world
effects (they serve the CLI and web legs at once), one page model
(reactive.html onto `Html`), and only then WebAssembly (item 6).

## Next, in priority order

Each item says why it comes where it does. Items with the same number can
run in parallel because they touch different files.

1. **Node editor ergonomics.** Free positioning (no offsets from the auto
   layout), automatic spacing of all or selected nodes that takes edges into
   account, value previews that don't overlap, edge routing with bridges
   (edge over edge) and tunnels (edge under node), a right-click menu (add,
   search, inline), a resizable canvas, Fit that centres horizontally, and
   per-binding choice between a junction dot and a named let/get pair.
   Start from a list of known node-editor pitfalls (Blender, Unreal
   Blueprints, Houdini, ComfyUI, Max/MSP) and credit where solutions come
   from. *Why first:* the thesis is that editing the tree beats editing
   text, and the graph is what hurts most today.
1. **Flat sequences.** Adjacent `print`s, `cons` chains and other
   right-nested chains of one function are drawn as one flat list (a stack
   of statements, a list literal), not as nesting. A view only: the tree is
   unchanged. *Why now:* it is the same presentation problem as the graph's
   clutter, and the examples look worst because of it.
1. **Visual redesign.** A few candidate designs made with Ersagun's
   modern-design skill, less line-heavy and off the green/orange palette,
   then one picked. *Why in parallel:* it is styling, and only collides with
   item 1 in the canvas CSS, so the two threads agree on class names first.
2. **Tutorial update.** Bring TUTORIAL.md and its screenshots up to the
   current editor (navigator, effects, modules, one world), and strike what
   got fixed from its critique list. *Why here:* cheap, and it should follow
   the visual changes above so the screenshots stay current.
3. ~~**Finish effects for the world.**~~ **Done** (this PR): the compiler
   handles operations, handler matches, `Optional` and the world builtins
   (`$perform` with a handler stack, escapes as exceptions), `cli/lab.ts`
   runs, compiles and checks saved programs on Node, and `examples/wc` is a
   word count in the language, after Unix `wc`. `Cells` compiles to the
   runtime's one handler. A compiled program is one portable file (`lab compile` bundles its runtime). Open: time, randomness and
   HTTP effects.
4. ~~**Reactivity and on-demand values through effects.**~~ **Done**
   (PR "Cells"): the `Cells` effect (`cell`, `formula`, `read`) and `Update`
   (`write`), one runtime handler that gives Solid.js-style signals and lazy,
   remembered values; a reactive page and continued fractions with Gosper's
   arithmetic, live at reactive.html. Compiled too (PR #62). Open: guarded corecursion, a stateful handler form so programs can write their own.
5. ~~**Fold-as-loop as a representation.**~~ **Done** (PRs #90, #91, #92,
   #94, #96, #97): how a fold runs is the fold job of the representation its
   value has (NUMBERS.md, "Folds run the way their value is stored"). The
   compiler's loop is the fold of `cells`; a fold over `characters(t)` runs
   on the string and one over `range(n)` is a counted loop (fusion as
   choosing a representation for one value, after Gill, Launchbury and
   Peyton Jones's foldr/build); Peano `Nat` is stored as an Int whose fold
   is a counted loop, written in the language and picked by the chooser,
   also by `lab run` and `lab compile`. Open: `build` for user producers
   (`keep` after a fold), user representations chosen per value, folds with
   `Choice` asking the table, arrays and ropes for lists.
6. **Compile targets.** All are profiles (REVIEW.md §5.2) plus a code
   generator:
   - **Shaders (WGSL)** first. *Done (PRs #80, #82, #85, #86):* the
     scalar profile printed as WGSL, records as structs, self tail calls as
     loops, [shaders.html](https://ersagunkuruca.github.io/language-lab/shaders.html)
     checked against the evaluator on a GPU, and an SDF ray marcher with
     normals from generated derivatives (COMPILER.md, "WGSL shaders").
     *Left:* native vectors and matrices with static shapes, `Float32`,
     `derivative` in the source, and a live preview in the editor.
   - **WebAssembly** second, for the same profile: no recursive data and no
     closures means no garbage collector, so the shader profile compiles to
     plain WASM. Full programs need WasmGC or our own GC, and come later.
   - **Native binaries** last, through WASM (wasm2c or a WASM runtime) or
     LLVM, once WASM works.
   *Why after the items above:* each target is a month, and the editor and
   effects should be solid before they are compiled three ways.
7. ~~**Web apps.**~~ **Done** (PRs #100, #102, #104, #106, #107):
   a page is a value of std's `Html` whose changing parts are watched
   functions, Solid-style, so no diffing is needed (WEB.md); events are
   handlers that write cells; the browser is a world (files in
   `localStorage`); `lab build-web` writes one HTML file; two-way binding
   is a field's display function run backwards, and
   [apps/converter.html](https://ersagunkuruca.github.io/language-lab/apps/converter.html)
   is written that way. On the way, functions kept in data got their
   effect rows (#102). Open: reactive.html's programs moved onto `Html`,
   keyed lists, `solve` over a function value (one generic `bind`),
   static output from `lab run`, time, randomness and HTTP, a page shown
   live in the editor. Mobile follows as a packaged web app (a PWA, or
   Capacitor).
8. **Research items** as they become blocking: costs worked out from folds,
   laws proved by fusion, fast invertible parsing, exact reals as a practical
   numeric type, Clifford algebras (NUMBERS.md stage 4).

## Showcases waiting for a slot

Small examples that show the language's ideas, picked up when a thread has
room: `conjugate(f, g)` (f⁻¹ ∘ g ∘ f) with a colour-space edit, an
object-vs-world transform and a multiband guitar effect (NOTES.md); the
SDF ray marcher (item 6).
