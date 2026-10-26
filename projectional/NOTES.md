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

## Int equality was approximate (2026-10-22)

*The finding.* Round 1 of the compiler gaps (compiler/GAPS.md, G0) found
that `equal(1000000000000, 1000000000001)` was `true`, in the evaluator and
in compiled code alike. Numbers compare to within 1e-9 relative, and an
`Int` is a JS number while it's a safe integer, so at run time it got the
same tolerance. The differential tests couldn't see it, because both sides
had the same bug.

*Current answer.* Equality is type-directed. The checker records, for each
use of `equal`, whether the type compared holds only Ints (exact), only
Numbers (to within 1e-9), or both or a type variable (whole numbers exactly,
others to within 1e-9). The evaluator and the compiler both follow it. The
test "equal compares Ints exactly…" in compiler/test/compile.test.ts checks
every case both ways. No example's output changed.

*Superseded (second review, REVIEW-2026-10-22b.md §2).* Type-directed made
three meanings, and the third caught people out: `equal(10^12, 10^12 + 1)`
on Numbers was `true`, and the same comparison through a generic
`same(x, y) = equal(x, y)` was `false`, so inlining a definition changed a
program's output. Backwards, relate.ts still compared every number near,
Ints too.

## Equality: one rule (2026-10-22)

*The question.* Both reviews asked for `equal` to be exact everywhere, with
a separate `near` for tolerance. Trying it showed why it can't be: running
backwards solves equations over floats, and their answers are approximate
(√2 squared is 2.0000000000000004, and 2·cos(π/2) is 1.2e-16, not 0). So
exact equality would reject the solver's own answers, and the same
predicate would be true backwards and false forward.

*Current answer.* One rule for every type, whichever way the program runs
(`sameNumber` in run.ts, relate.ts's unify, `$sameNumber` in runtime.js,
and scalar.ts for WebAssembly and the GPU). Two whole numbers are equal
only when they are the same number, so every Int is exact (an Int is a JS
number while it's small, and a value can't say which type it has). Any
other pair is equal when it's within 1e-9 relative. The type no longer
matters, so a generic function, a list or a backwards run gives the same
answer as a direct comparison. `test/equality.test.ts` and
`compiler/test/equality.test.ts` check that on boundary values (10^12 and
10^12 + 1, 2^53, 0.1 + 0.2, −0, NaN, ∞).

*What it costs.* It isn't transitive on fractional numbers (no tolerance
is), so it isn't an equivalence there. And two Numbers that both happen to
be whole compare exactly: 10^12 and 10^12 + 1 are different, while 10^12
and 10^12 + 0.5 are within the tolerance. Doubles near 10^12 are spaced
1.2·10^-4 apart, so whole numbers that differ really are different
numbers. `show(0.1 + 0.2)` prints "0.3", so `show` isn't one to one on
Numbers (the converter's "show run backwards is the parser" accepts only
rounded spellings). Settled (Ersagun, 2026-10-23): it stays. Rounding to 9
decimals is off by at most 5·10^-10, inside the 10^-9, so reading the text
back always gives an equal number, forward and backwards (test/equality.test.ts),
and outputs don't show "0.30000000000000004".

*Order is not equality (2026-10-26).* Maps, sets and `sort` came after
this trade, and they need a real order, which a tolerance can't give
(REVIEW-2026-10-26.md §1.1). So `compare` orders Numbers exactly, with NaN
after the rest and the same as itself, and `equal` keeps its tolerance for
equations. `compare` and `equal` disagree on near Numbers on purpose:
"same key" and "equal value" are two questions (LANGUAGE.md "Order, and
sort").

## Peano naturals, linked lists, and the stack (2026-10-22)

*The idea.* `zero | succ(Nat)` and `nil | cons(List)` are the mathematical
definitions, and terrible for performance. Keep both: the program uses the
definition, and the compiler picks a faster implementation underneath.

*Current answer.* That is the meaning/representation split in NUMBERS.md
(PR #30): a representation is an ordinary type plus a `meaning` function and
fast versions of its jobs, and the chooser picks one by declared cost.
`factorial` on Peano `Nat` runs on binary numbers. The stackless evaluator
and fold-as-loop (PRs #32, #33) are the control side of the same split: they
make deep recursion survive, but don't change its cost.

*Merged (ROADMAP item 5, 2026-10-22).* Control and data are now one
mechanism: how a fold runs is a job of the representation of what it folds.
The compiler's loop is the fold of `cells` (values linked as written). A
list made by `characters` or `range` is folded on the string or the count,
without building the list. Peano `Nat` has an `int` representation,
written in the language, whose fold is a fold over `range(n)` and so a
counted loop: `factorial` still says `zero` and `succ`, and `lab run
examples/numbers` runs it on Ints. Linked lists in general (arrays, ropes)
and fusing a user's own list producer with its consumer are still open
(NUMBERS.md, "Folds run the way their value is stored").

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

*Answer, built (PR "Cells").* Agreed, it is out of "dreams", but not with
an "ask for the next term" operation. Such an operation needs its handler
to remember how far each stream got (state) and to resume the producer
where it stopped (a continuation); handlers here have neither. And a
shared input (`x` in `x + x`) would be computed twice. What's wanted is
call-by-need: computed when asked, once. So the rest of a continued
fraction is a *formula cell*, `term(whole: Int, rest: Cell CF)`, and reading
it is an operation of the `Cells` effect whose handler (the runtime's)
computes it on first read and remembers it. Laziness does show in the
type, as `Cells`, which is honest: reading may compute. The stopping rule
stays with the consumer (`terms(x, n)`), and `with fuel` stops what can't
be decided (√2 · √2 never gives a first term). Gosper's `+ − × ÷` on these
is an ordinary program; see LANGUAGE.md "Cells" and the live
[Cells page](https://ersagunkuruca.github.io/language-lab/reactive.html).

## Effects and Solid.js reactivity (2026-10-22)

*The idea.* Is the effect system like Solid.js's? Then reactivity demos
should be possible.

*Answer, built (PR "Cells").* Yes, in a precise sense. In Solid,
reading a signal inside an effect or memo records a dependency through a
global "current listener", and writing re-runs what read it. Here `read` is
an operation of the `Cells` effect and the tracking context is its handler:
a deep handler's dynamic scope is exactly that "current listener". The
handler is the runtime's (it keeps values and readers, and handlers in the
language have no state), with Milo's "Reactively" update order: mark dirty
on write, recompute lazily on read, only if a source really changed. What
the types add: a view is `() -[Cells]-> Text` and can only read, a formula
can't write (its row is closed), and `write` is `Update`, a world effect,
so it can't run inside a search. The same handler is what makes
continued fractions lazy (above): Solid's memo and Haskell's thunk are one
mechanism, as Adapton (PLDI 2014) showed. The page is a value whose
changing parts are functions, one watcher each, so updates need no diffing:
that changes ROADMAP item 7's "diffing representation".

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
the demo follows. Done (BACKLOG.md L23): the prelude's `conjugate(f, g)`
is three lines over `inverse`, and `examples/conjugate` brightens a colour
in linear light, turns a point about another, and softens the fast band
of a Haar split. A crossover and a real compressor, on audio, would make
the pedal; that waits for audio as a target.

## Shaders, WebAssembly, native (2026-10-22)

*The idea.* If shaders are a target, why not WebAssembly, and binaries
later?

*Current answer.* Yes, as profiles plus code generators. The shader profile
(no recursive data, no closures, bounded loops, no world effects) needs no
garbage collector, so the same programs compile to plain WASM almost for
free once WGSL works. Full programs need WasmGC or our own GC, so they come
later. Native goes through WASM or LLVM after that. COMPILER.md's "not WASM"
was about the whole language and still holds for it (ROADMAP item 6).

## Vector operations in shaders (2026-10-23)

*The idea.* The ray marcher does colour and vector maths channel by
channel and axis by axis. Do those become vector operations in the
compiled shader?

*Current answer.* They didn't: every part was its own `f32`, and `Vec` and
`Colour` were structs. Now (COMPILER.md "Vectors") a record of two to four
Numbers is stored as `vec2f`–`vec4f`, and parts that each do the same thing
are printed as one vector operation, with `dot`, `length`, `normalize`,
`mix`, `clamp`, `min` and `max` recognised. On modern GPUs that is mostly
for the GPU's built-ins and for readability, since each thread is scalar
anyway. The real fix is in the source, one PR each: elementwise operations
over any record of Numbers as ordinary built-ins, a prelude vector module
written once on them (usable on `Vec` and on `Colour`, while adding a
colour to a position stays a type error), and the ray marcher rewritten to
use them.

Built so far: the printer (PR #121), then `map parts`, `zip parts` and
`total`, typed by a "record of Numbers" constraint that type variables carry
the way `equal`'s plain data does, and the vectors module (`plus`, `scale`,
`dot`, `magnitude`, `unit`, `mix`, `clamp`, `reflect`, …) written on them.
Considered and not taken: a `Vec3` type in std (Colour and Vec would have to
be the same type, and adding them would type-check), operation records
passed by the editor (NUMBERS.md's plan for rings; heavier here, and a GPU
can't take a record of functions), and a derive step that writes each
record's operations field by field (the per-channel code would still be
there, just generated).

Then the ray marcher itself (step 3): its normals were three
`derivative((x) ↦ scene(x, y, z, time))(x)`, one per axis. Now `gradient(f)`
gives the three as one Vec, and derive.ts reads slopes through records of
Numbers: a record's derivative is a record, part by part (forward mode
with a record of tangents), and a definition that takes or returns a
record is differentiated where it's called. Considered and not taken: a
gradient written in the vectors module (it would need "this record with
part j replaced", which map parts can't say), and partial derivative
definitions per part (∂scene/∂p.x …) for generic definitions like `minus`,
which have no one record to have parts of.

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

## Time, randomness and HTTP (2026-10-22)

*The idea.* Real programs and pages need the time (a clock, an animation),
random numbers (a dice game), and the network (fetching data). How do they
fit effects whose world must not be touched under `Choice`?

*Current answer.* One PR each (ROADMAP item 7):

- **Random** is a std effect with a seeded handler and the world as the
  default (LANGUAGE.md "Random"). It may run under `Choice`, and `Files` and
  `Console` may not, because the rule is about what can't be taken back:
  printing on an abandoned path stays printed, a written file stays
  written, but a number drawn on an abandoned path changed nothing outside
  the program. (Nothing is restored either: under `seeded`, the next
  alternative takes the next numbers.)
- **Time**: `now()`, and `wait(ms)` as its own effect (`Wait`), so a
  page's types can allow the clock and refuse pausing. No separate tick
  operation: in a page, a part that reads `now()` runs again each animation
  frame, the way a time-varying value works in Fran (Elliott and Hudak) and
  `Time.every` in Elm. Like Random, a match can answer them, so a test can
  fix the clock and skip the pauses.
- **HTTP**: `fetch text(url)`, a GET that aborts on failure. It is memoised
  per URL for the run, so a search that backtracks never repeats a request;
  that is why it can be allowed where `Files` isn't. A page's part that
  fetches keeps its content until the reply arrives and then runs again
  (Solid's `createResource`, React's Suspense).

