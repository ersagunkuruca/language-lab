# Roadmap

Updated 2026-10-22, after PR #51. This replaces §10 of
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
   word count in the language, after Unix `wc`. Open: `Cells` in the
   compiler, a compiled program as one portable file, time, randomness and
   HTTP effects.
4. ~~**Reactivity and on-demand values through effects.**~~ **Done**
   (PR "Cells"): the `Cells` effect (`cell`, `formula`, `read`) and `Update`
   (`write`), one runtime handler that gives Solid.js-style signals and lazy,
   remembered values; a reactive page and continued fractions with Gosper's
   arithmetic, live at reactive.html. Open: guarded corecursion, Cells in
   the compiler, a stateful handler form so programs can write their own.
5. **Fold-as-loop as a representation.** Move "compile a fold to a loop"
   out of the compiler's special cases and into the representation table
   from NUMBERS.md, next to Peano `Nat` → binary. *Why:* one mechanism for
   "how this runs" instead of two, before the backends multiply.
6. **Compile targets.** All are profiles (REVIEW.md §5.2) plus a code
   generator:
   - **Shaders (WGSL)** first: vectors and matrices with static shapes,
     `Float32`, the shader profile, a live preview, an SDF ray marcher with
     normals from `derivative`. Famous demos may be ported, with the author
     named and the source linked.
   - **WebAssembly** second, for the same profile: no recursive data and no
     closures means no garbage collector, so the shader profile compiles to
     plain WASM. Full programs need WasmGC or our own GC, and come later.
   - **Native binaries** last, through WASM (wasm2c or a WASM runtime) or
     LLVM, once WASM works.
   *Why after the items above:* each target is a month, and the editor and
   effects should be solid before they are compiled three ways.
7. **Web apps.** The runtime built on item 4 (a page is a value whose
   changing parts are watched functions, Solid-style, so no diffing is
   needed; `src/lang/ui.ts` is the seed), two-way binding by relations, static site
   output. Mobile follows as a packaged web app.
8. **Research items** as they become blocking: costs worked out from folds,
   laws proved by fusion, fast invertible parsing, exact reals as a practical
   numeric type, Clifford algebras (NUMBERS.md stage 4).

## Showcases waiting for a slot

Small examples that show the language's ideas, picked up when a thread has
room: `conjugate(f, g)` (f⁻¹ ∘ g ∘ f) with a colour-space edit, an
object-vs-world transform and a multiband guitar effect (NOTES.md); the
SDF ray marcher (item 6).
