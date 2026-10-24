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

## Types, totality, units

| What | Label | Who and where |
|---|---|---|
| Inferred types, never written | Textbook | Hindley-Milner (Hindley 1969, Milner 1978, Damas and Milner 1982), `src/lang/infer.ts`. |
| Strictly positive data types | Adapted | The check Coq and Agda use. REVIEW.md §1. |
| Termination by size-change | Adapted | Lee, Jones and Ben-Amram, "The size-change principle for program termination", POPL 2001. LANGUAGE.md. |
| Nested data folded through its container | Adapted | Coq's nested inductive types, `src/lang/nested.ts`; in WebAssembly as one mapping function per container type (`compiler/src/scalar.ts` fold). |
| Units as part of the type, solved as exponent vectors | Prior art | Andrew Kennedy, "Dimension Types" (ESOP 1994), and F#'s units of measure. LANGUAGE.md credits it. |
| `match`, `fold`, `if` and `cons` as ordinary function nodes; one system, no special kinds | Ersagun's idea | Related: Church/Scott encodings, where data is its own eliminator, and catamorphisms (below). |

## Effects

| What | Label | Who and where |
|---|---|---|
| Algebraic effects and handlers | Influence | Plotkin and Power (2003), Plotkin and Pretnar (2009); the Eff language (Bauer and Pretnar). |
| Effect rows in inferred types | Influence | [Koka](https://koka-lang.github.io) (Daan Leijen, "Koka: programming with row polymorphic effect types", 2014). LANGUAGE.md: "the Koka/Eff/OCaml 5 line of design, cut down". |
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
| `examples/countdown`: every way to reach a target with + − × ÷, written in the editor by clicks | Adapted | Graham Hutton, "The countdown problem", *Journal of Functional Programming* 12(6), 2002 ([pdf](https://www.cs.nott.ac.uk/~pszgmh/countdown.pdf)): the search and its `valid`. The game is Channel 4's *Countdown*. |
| GET as a read that may run under `Choice`, fetched once per address per run | Our own | Leans on HTTP's definition of safe methods (RFC 9110, §9.2.1). LANGUAGE.md "The web". |

## Concurrency, parallelism and collections (designed, not built)

Proposed in [LANGUAGE-NEEDS-2026-10-24.md](LANGUAGE-NEEDS-2026-10-24.md); the full list of sources is there. When a row is built, its entry moves to the section of the feature.

| What | Label | Who and where |
|---|---|---|
| `together` as a scope no branch outlives; errors stop the siblings | Influence | Trio's nurseries (Nathaniel J. Smith, "Notes on structured concurrency", 2018); OCaml 5 Eio's `Fiber.both` and switches (prior art). |
| Waiting in direct style, no async colour, the handler decides | Influence | Koka, Effekt, OCaml 5 effects; Bob Nystrom, "What color is your function?" (2015) names the problem. |
| Parallel for pure code, concurrent for waiting code | Influence | Simon Marlow, *Parallel and Concurrent Programming in Haskell* (2013); `par`/`pseq` considered, annotations rejected. |
| Seeded schedules and virtual time for tests | Prior art | FoundationDB's deterministic simulation (Will Wilson, 2014); tokio's paused clock. |
| Work stealing, or-parallel search, data parallelism | Prior art | Cilk (Blumofe, Leiserson; Frigo, Leiserson, Randall 1998), Chase-Lev deque (2005); Aurora and Muse Prologs; NESL (Blelloch), Futhark (Henriksen et al. 2017). |
| Channels; actors not a construct; STM | Influence / Considered, rejected | CSP (Hoare 1978), Go, Erlang (Armstrong); STM (Harris, Marlow, Peyton Jones, Herlihy 2005). |
| Maps with one meaning and several representations; an order on data; Outcome; foreign definitions | Influence | Weight-balanced trees (Adams 1993), HAMT (Bagwell 2001), RRB vectors (Bagwell, Rompf 2012); OCaml's `compare` and Erlang's term order; Rust's `Result`; Gleam's `@external` and Elm's ports. |

## Choice: failure and many answers

| What | Label | Who and where |
|---|---|---|
| `Choice`: an expression can fail or give many answers, lazily | Influence | Verse (Augustsson, Breitner, Claessen, Jhala, Peyton Jones, Shivers, Steele and Sweeney, "The Verse Calculus", ICFP 2023). Prior art: Icon's generators (Ralph Griswold), Prolog's backtracking. |

## Running any function backwards

| What | Label | Who and where |
|---|---|---|
| A function is a relation: any ports can be the inputs, the node's direction depends on how it's wired | Ersagun's idea | Prior art: relational programming in Prolog and [miniKanren](http://minikanren.org); constraint logic programming (Jaffar and Lassez, POPL 1987; CLP(R)); constraint propagation in Sketchpad (Ivan Sutherland, 1963) and ThingLab (Alan Borning, 1979); acausal equations in [Modelica](https://modelica.org) (Elmqvist, Mattsson and others); reversible languages such as Janus (Lutz and Derby, 1982). |
| The search: a lazy, fair stream of states | Adapted | miniKanren (Daniel P. Friedman, William E. Byrd, Oleg Kiselyov, *The Reasoned Schemer*, 2005), streams as in μKanren (Jason Hemann and Daniel P. Friedman, 2013). Credited in `src/lang/relate.ts`, BACKWARDS.md. |
| Whole-number sums run in any direction: any two sides give the third | Prior art | Prolog's CLP(FD) (`X #= Y + 1`, Markus Triska's clpfd library) and miniKanren's arithmetic relations (`pluso`, Kiselyov, Byrd, Friedman and Shan, "Pure, declarative, and constructive arithmetic relations", FLOPS 2008). Credited in BACKWARDS.md. |
| Modes of a function run backwards: an order for its goals, and how many answers (det, semidet, multi, nondet) | Influence | Mercury's mode and determinism analysis (Somogyi, Henderson and Conway, JLP 1996). `src/lang/modes.ts`, MODES.md, COMPILER.md. |
| Whether a backwards search ends, per mode, by measuring the known ports | Prior art | TermiLog (Lindenstrauss and Sagiv, ICLP 1997) and cTI (Mesnard and Neumerkel, SAS 2001), termination of logic programs per query mode. `src/lang/modes.ts`, MODES.md. |
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
| `Int` as `from(Nat) \| minus one minus(Nat)` | Adapted | Lean's definition of `Int`. NUMBERS.md. |
| Rich number systems, Clifford algebras instead of separate complex/quaternion/dual types | Ersagun's idea | Geometric algebra: W. K. Clifford (1878), David Hestenes; Dorst, Fontijne and Mann, *Geometric Algebra for Computer Science*. |
| Exact continued-fraction arithmetic | Adapted | R. W. Gosper, HAKMEM (MIT AI Memo 239, 1972), item 101. Credited in `src/lang/cells-programs.ts`, `reactive.html`, NUMBERS.md. e's expansion is Euler's. |
| Continued fractions computed on demand, through effects | Ersagun's idea | Call-by-need is Haskell's laziness; demand-driven incremental computation is Adapton (below). |

## Folds as representations, fusion

| What | Label | Who and where |
|---|---|---|
| Folds as the one way to consume data | Influence | Catamorphisms: Meijer, Fokkinga and Paterson, "Functional programming with bananas, lenses, envelopes and barbed wire" (FPCA 1991). |
| How a fold runs is a job of the representation of what it folds; no intermediate list | Prior art | Deforestation (Wadler, 1990); short-cut fusion, `foldr`/`build` (Gill, Launchbury and Peyton Jones, 1993); stream fusion (Coutts, Leshchinskiy and Stewart, 2007). Credited in NUMBERS.md and ROADMAP.md. |

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
