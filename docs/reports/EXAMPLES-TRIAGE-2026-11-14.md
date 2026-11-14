# Examples triage, 2026-11-14

Ersagun (2026-11-14 20:05 UTC): "a lot of example programs are either poorly
explained or very trivial or hard to understand because they are command line
tools. For each of them, decide whether to make it into a page with more
interactivity and human readable explanation, to add more human readable
comments, or to get rid of it."

This covers the 38 programs in the editor's example picker
(`editor/examples.json`). Each gets exactly one decision:

- **page**: turn it into a page with controls and a plain-language
  explanation on the page itself.
- **comments**: keep it as it is, and add plain-language comments (on each
  definition, and a program note saying what it shows and how to run it).
- **remove**: take it out of the picker.

**Removing keeps the folder.** Every removed example is used by tests
(and some by GAPS rounds or backlog rows), so its folder stays under
`ters/examples/` as a test program, like `divisors`, `fibonacci` or the
queens variants already are. What it taught that nothing else does is moved
into an example that stays (named in the table), so the picker loses nothing.

**Bigger programs stay what they are.** The bigger-program rounds are records:
GAPS.md compares each one, as it was written, with hand-written code and
benchmarks it. Rewriting one into a page would break those comparisons, so
they get comments, never a rewrite. Most already have them; the three with
none get them.

**Lockstep, the example that started this.** Its `main` is one Text, and the
line `fixed(steps) = position` takes a Fixed apart to get at its count of
2⁻³² steps. Nothing on screen says that this is what it does, or why anyone
would want the count. As a page, the count becomes a visible "the two machines
agree" check, and the taking apart goes behind a named helper.

## The table

Comment coverage is how many of the program's own definitions carry a comment,
measured on 2026-11-14.

| # | example (picker label) | decision | why | what only it teaches |
|---|---|---|---|---|
| 1 | Numbers & physics (quadratic + physics) | comments | Its main prints eight lines (`polar(0, 2, 2, π/2) = false`) that mean nothing without the code. The quadratic part's two definitions have no names in the default set, so they read as `‹?0f88›` | Units in types (m, m/s², inferred s); a predicate run in any direction (`fall`, `rotate`); several name sets for one program (quadratic) |
| 2 | Insertion sort | remove | Trivial: main prints `[1, 2, 3]`. Queens and countdown show recursion over lists better | Nothing the others don't (folder stays: about 20 tests use it) |
| 3 | Eight queens | page | Choice and backtracking are easiest to see on a board: pick n, see the first answer, step through all of them, see the count | `Choice` with `first`/`all`/counting over the same search |
| 4 | Countdown numbers | page | 49 lines of brackets on stdout. As the TV game: six numbers and a target you choose, the answers listed. Runs in about a second | Search over data (expressions), Hutton's pruning; the biggest nondeterministic search in the picker |
| 5 | Calculus | page | Prints `f(2)`, `f′(2)` and a root for six functions. A plot of f and f′, with the roots marked, shows what the derivative is | Derivatives made by the compiler from a definition (`cubic′`), Newton's method on them |
| 6 | Run backwards | comments | Each printed line is a different lesson, and half its definitions have no comment. Takes in relations' two lessons that it lacks | Running ordinary functions backwards: Text (`who was greeted`), parsing (`read numbers`), cuts, fair search |
| 7 | Conjugation | page | Its point is visual: brighter in linear light against doubling the stored number, and a quarter turn about a point. Two colour swatches and a slider, and a drawing, say it in a second | f⁻¹ ∘ g ∘ f done by running f backwards |
| 8 | Relations in programs | remove | Overlaps: `polar` is in physics, `square roots` in Run backwards. Its two own lessons (`sum and difference` solved with no Choice by linear elimination, `missing addend` from `add`) move into Run backwards | Nothing once moved (folder stays: tests use it) |
| 9 | Where Markov chains settle | page | Three lines of numbers. With sliders for the chances and the long-run shares drawn step by step, "settles", "settles slowly" and "never settles" are seen | `settled` and `settled by` (fixpoints, a rate bound), an answer that doesn't exist rather than a run forever |
| 10 | Effects | comments | Short and right, but main prints `360 · can't: nobody to share with` with no context. Each print should say which handler answered | The smallest handler example: an effect declared, handled twice. Pig is the big one |
| 11 | Lockstep: a cart on a spring | page | The case Ersagun hit. As a page: press left and right, the cart moves; a second machine gets only the presses and shows the same state, step count for step count | Fixed numbers, the same bits everywhere; only inputs travel |
| 12 | Shader: ripples | remove | The simplest shader, and nothing in it the Mandelbrot set doesn't show (a per-pixel function of x, y and time) | Nothing the others don't (folder stays: shader tests use it) |
| 13 | Shader: ray marching | comments | Already commented (19 of 20). One missing comment, and a program note saying what to look at | Sphere tracing; projective geometric algebra in a shader |
| 14 | Shader: Mandelbrot set | comments | Commented (7 of 7); nothing to add beyond a sentence on the zoom | Complex numbers on the GPU; Ersagun's HSI colours |
| 15 | Shader: tiles | comments | Commented, but no program note saying why it exists | A function chosen at run time on a GPU (defunctionalised, C225) |
| 16 | Wavetable | remove | Prints a table length and six numbers. Its lesson is the compiler storing a List as an array, which is in its README and doesn't show in the editor. Pedal is the sound example | Nothing the editor shows (folder and README stay, C30 row points at it) |
| 17 | Page: two dice | page | Already a page, explained on the page. No change | Randomness as an effect, seeded replay |
| 18 | Page: Pig | page | Already a page, explained. No change | One play under three sets of handlers (record, replay, quiet) |
| 19 | Page: Tumble | page | Already a page, explained. No change | Animation and input together: three policies side by side |
| 20 | Page: nested to-do outline | page | Already a page. No change | Keyed lists of cells, nested |
| 21 | Page: unit converter | page | Already a page, explained. No change | Fields that run backwards (solve) |
| 22 | Page: guitar pedal | page | Already a page, explained. No change | Sound on the audio thread, cells read from it |
| 23 | Page: constructions | page | Already a page, explained. No change | Projective geometric algebra, Cl(2,0,1) |
| 24 | Page: bounce | page | Already a page, explained. No change | One step in 2D and 3D from the same definitions |
| 25 | Page: spacetime | page | Already a page, explained for a reader without the maths. No change | Spacetime algebra |
| 26 | Compass (page only) | page | Already a page, linked from constructions. No change | Conformal geometric algebra, Cl(3,1) |
| 27 | Bigger program: sheet | comments | 0 of 90 definitions commented | A spreadsheet: formulas, cycles, errors as values |
| 28 | Bigger program: board | comments | 0 of 112 commented | A task board page built from many parts |
| 29 | Bigger program: machine | comments | Commented (140 of 140); program note is enough. No change | An assembler and interpreter |
| 30 | Bigger program: notebook | comments | Commented (51 of 51). No change | Text indexing, a file's questions answered |
| 31 | Bigger program: routes | comments | Commented (38 of 38). No change | Graphs: Kruskal, Dijkstra |
| 32 | Bigger program: ledger | comments | 0 of 32 commented | CSV money entries, exact decimals |
| 33 | Bigger program: chapters | comments | Commented (16 of 21), good program note. The five missing | Files out: one per chapter, a log appended |
| 34 | Bigger program: calc | comments | Commented (15 of 21), good note. The six missing | Whole numbers of any size; a parser (descent) |
| 35 | Bigger program: clinic | comments | 1 of 146 commented | Event simulation on leftist heaps |
| 36 | Bigger program: crew | comments | Commented (66 of 67). No change | Workers as fibers; critical path |
| 37 | Bigger program: break | comments | Commented (86 of 86). No change | A pool break event by event |
| 38 | Bigger program: pond | comments | Commented (104 of 104). No change | Fish kept in a pool (the Pool type) |

Count: 6 new pages (queens, countdown, calculus, conjugation, Markov,
lockstep), 10 pages kept, 4 removed from the picker (sort, relations, ripples,
wavetable), 18 commented, of which 11 need work (numbers & physics, Run
backwards, effects, ray marching, tiles, sheet, board, ledger, clinic,
chapters, calc: one PR each or a tiny batch) and 7 already have it.

## Not in the picker

The other folders under `ters/examples/` (agent, algebra, archive, area,
collatz, divisors, drift, fibonacci, fingerprint, generic, herd, impact,
langford, the queens and mandelbrot variants, rmold, swarm, swarm-pool, tally,
trits, wc) are compiler and test programs, never shown in the editor. They
are out of this triage. The rounds after pond (depot, fit, places, rota, trek)
aren't in the picker either; adding them is a separate question.

## How it is carried out

One PR per new page, one per removal (with what moves), and the comment-only
changes in small batches. The rows are L261a to L261r in BACKLOG.md. A page
keeps the program's credits and puts a credits line on the page itself
(project attribution rule). The picker's file, `editor/examples.json`, is under
`editor/`, so removals and new `page: true` flags wait their turn on the
editor; the programs themselves are under `ters/examples/` and go ahead.
