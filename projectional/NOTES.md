# Discussion notes

Design ideas Ersagun raised in the project chat, with the current answer to
each. Short on purpose: the full designs live in LANGUAGE.md, NUMBERS.md,
COMPILER.md and REVIEW.md, and what gets built when is in
[ROADMAP.md](ROADMAP.md). Dates are when the idea was raised.

## Standing rules

**Uniformity** (2026-10-21). Everything is one system: `match`, `fold`,
`if` and `cons` are ordinary function nodes, a let is a reroute dot, a
variable is a wire fanning out from a port, there is one canvas and one
layout store. Visual distinctions confuse more than they help, so before
adding a new kind of thing on screen, ask whether it can be an existing one.

**Attribution** (2026-10-22). Code, demos, algorithms or techniques copied
from or heavily based on someone else's work name the author and link the
source in the code, the example's docs and the PR, and respect the licence.
Famous demos (ray-marching SDF shaders, for example) may be ported on those
terms. Textbook algorithms say they are the textbook ones. This applies to
everything in the repo, not only shaders.

## Peano naturals, linked lists, and the stack (2026-10-22)

*The idea.* `zero | succ(Nat)` and `nil | cons(List)` are the mathematical
definitions, and terrible for performance. Keep both: the program uses the
definition, and the compiler picks a faster implementation underneath.

*Current answer.* That is the meaning/representation split in NUMBERS.md
(PR #30): a representation is an ordinary type plus a `meaning` function and
fast versions of its jobs, and the chooser picks one by declared cost.
`factorial` on Peano `Nat` runs on binary numbers. The stackless evaluator
and fold-as-loop (PRs #32, #33) are the control side of the same split: they
make deep recursion survive, but don't change its cost. They should merge:
fold-as-loop becomes one more entry in the representation table instead of a
compiler special case (ROADMAP item 5).

## Nested prints and cons chains (2026-10-22)

*The idea.* Adjacent `print`s and `cons` chains render nested, which is the
Peano/linked-list problem again, and it looks worst in the node editor.

*Current answer.* Same split, applied to presentation. The tree stays
right-nested (that is its meaning); the view draws a right-nested chain of
one function as a flat list: a stack of statements, a list literal. No new
node kind, so the uniformity rule holds (ROADMAP item 1, "Flat sequences").

## Number systems and Clifford algebras (2026-10-22)

*The idea.* Fractions, big integers, complex numbers, continued fractions
(including infinite ones), vectors, matrices, tensors, and Clifford algebras
instead of separate complex/quaternion/dual types.

*Current answer* (NUMBERS.md, PR #30). Integers never overflow (`Int` landed
in PR #39). Floats are an approximate representation of the reals and are
never substituted silently. Complex, split-complex, dual numbers and
quaternions are named algebras in one Clifford library, with quaternions as
the rotor representation. Infinite continued fractions are an ordinary lazy
type (`term(whole, rest: () → CF)`) with Gosper's arithmetic (HAKMEM, 1972),
and comparisons on them carry `Diverge`. Vectors and matrices with static
shapes come first for shaders.

## Continued fractions on demand, through effects (2026-10-22)

*The idea.* The review listed exact reals by continued fractions as a dream;
on-demand calculation could be done with something like effects.

*Current answer.* Agreed, and it moves out of "dreams". A computation that
needs another term performs an "ask for the next term" operation, and a
handler decides how far to go: produce terms until a comparison is decided,
or until a precision is reached. That keeps laziness out of the type
(no `() → CF` fields needed for the common case) and puts the stopping rule
in one place. Built together with reactivity (ROADMAP item 4).

## Effects and Solid.js reactivity (2026-10-22)

*The idea.* Is the effect system like Solid.js's? Then reactivity demos
should be possible.

*Current answer.* Roughly yes. In Solid, reading a signal inside a
tracking context records a dependency, and writing it re-runs what depended
on it. Here, reading a signal would be an effect operation, and the
tracking context its handler: the handler records the read and answers it.
Solid's fine-grained updates (Ryan Carniato's design) come from the handler,
not from the language. One gap: re-running a dependent computation needs
the handler to keep the computation, which our one-shot handlers allow
because it re-runs from the start rather than resuming twice. Demos: a
counter and a derived value, then the web runtime on top (ROADMAP items 4
and 7).

## Conjugation and commutators (2026-10-22)

*The idea.* From Rubik's cube commutators: go to another space, act, come
back. Colour spaces, object space versus world space, and a guitar pedal
that applies an invertible filter, compresses or overdrives some frequencies
more than others, and inverts the filter.

*Current answer.* That is conjugation, f⁻¹ ∘ g ∘ f (a commutator is
f ∘ g ∘ f⁻¹ ∘ g⁻¹). It fits this language because f⁻¹ comes from running f
backwards, not from writing it again. Plan: `conjugate(f, g)` as an ordinary
function, with three examples: an edit in a perceptual colour space, a
transform in a parent's frame, and multiband processing, where the
invertible filter is a band split (a crossover or an STFT) and the
per-band compression or overdrive is g. Standard DSP; credit the sources
the demo follows. Waiting for a slot (ROADMAP, showcases).

## Shaders, WebAssembly, native (2026-10-22)

*The idea.* If shaders are a target, why not WebAssembly, and binaries
later?

*Current answer.* Yes, as profiles plus code generators. The shader profile
(no recursive data, no closures, bounded loops, no world effects) needs no
garbage collector, so the same programs compile to plain WASM almost for
free once WGSL works. Full programs need WasmGC or our own GC, so they come
later. Native goes through WASM or LLVM after that. COMPILER.md's "not WASM"
was about the whole language and still holds for it (ROADMAP item 6).

## The node editor (2026-10-22)

*The idea.* Overlapping previews and edges, no automatic spacing, nodes
placed relative to their outputs, no right-click menu, a fixed-size canvas,
Fit not centred. Maybe bridges and tunnels for crossing edges, and a choice
per binding between a junction and named let/get nodes. Why are captioned
edges and lets different?

*Current answer.* All on ROADMAP item 1. Named let/get nodes are allowed
under the uniformity rule if they are a view of the same let, chosen per
binding like any other presentation, not a second kind of variable. On
captioned edges: our editor has no wire captions today (names sit on dots
and ports). A caption would be a name drawn on a wire and a let is a name
drawn on a dot, and both would name the same value, so there should be no
difference: a caption is one more way to draw a named dot, alongside the
junction and the let/get pair. The editor thread decides which is default.
