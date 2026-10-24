# Native programs through C

Design note for BACKLOG.md C17 (ROADMAP step 6, COMPILER.md "Targets
beyond JavaScript", route 2). Written 2026-10-24. The last section is the
plan.

**Status.** Stage N1 is done. The scalar profile and its records print as
C (`compiler/src/c.ts`): Numbers, Bools, records as structs passed by
value, lets, ifs, calls, self tail calls as loops, and budgets. calculus,
physics, the ray marcher's colours and the strip integral give the
evaluator's bits, built with GCC and with clang (`compiler/test/c.test.ts`).
sin, cos, tan, exp, log, pow and atan2 are V8's fdlibm, the code Node's
Math runs, translated from C++ to C by `compiler/math/to-c.ts` (into
`src/c-math.ts`). On 140,000 inputs (any bits, the edges, large arguments)
they give exactly Node's bits.

## What it's for

WebAssembly (WASM.md) already runs whole programs with no JavaScript, under
wasmtime. Native code adds three things:

- **Start-up and memory.** A command that starts in a millisecond and
  holds what it uses, not a JIT and a heap.
- **Embedding.** A C library links into anything: a game engine, an audio
  plugin (the guitar pedal in BACKLOG.md), a phone app, a microcontroller.
- **Every platform.** Any C compiler is a backend. That includes
  WebAssembly with linear memory, through clang.

## The decisions

**The same lowering, printed a fourth time.** C prints what `scalar.ts`
lowers, as WebAssembly, WGSL and the CPU's JavaScript do. The lowering has
already settled the hard parts:

- searches, as the rest of the search passed on (W4d);
- one answer or none, as a status after the answer (W4a);
- Abort, as status 2 (W4c);
- closures, as shapes of what they capture (W2);
- folds, as functions of their own.

So C gets each of these as a pattern to print, not a design to redo. What
C lacks that WebAssembly has is a garbage collector and a fixed order of
evaluation.

**Reference counting, not a collector.** Values can't be changed and can't
form cycles, so counting references frees everything, as soon as the
last reference goes. A pass over the lowered tree puts in `dup` and
`drop`. Functions own their inputs, and a value is dropped at its last
use, not at the end of its scope (Koka's Perceus: Reinking, Xie, de Moura
and Leijen, PLDI 2021). Then reuse: a match that takes a cell apart and
builds one of the same size gives that cell back to the constructor, if
nothing else holds it (Lean 4's reset/reuse: Ullrich and de Moura,
"Counting Immutable Beans", IFL 2019). That is how `map` over a list
nobody else holds runs in place. The cells search answers go into
(mutable boxes) are counted too, since nothing in them can point back
at them.

**Values.**

- A Number is a `double` and a Bool an `int32_t`.
- A record is a struct passed by value. Its counted fields are dup'd and
  dropped with it.
- A data value is a pointer to a cell: a count, a case, then fields. A
  case with no fields is a static cell whose count is never changed.
- An Int is an `int64_t`-sized word: the value itself while it fits in 62
  bits, else a pointer to 32-bit limbs (WASM.md W5b's algorithms, written
  again in C).
- A Text is a counted cell of UTF-8 bytes and its length.

**Left to right, said in C.** C doesn't say in which order a call's
arguments run, and GCC runs them right to left (found in N1's test
harness). The evaluator goes left to right, and that order shows when an
argument prints, aborts or spends fuel. So the printer puts any argument
that isn't pure in a local first, in order. Pure arguments stay where they
are, since the C compiler may reorder those freely.

**The numbers are the evaluator's.**

- + − × ÷, sqrt and floor are exact in C, as in JavaScript.
- `mod` is fmod twice, as runtime.js's `$mod`.
- The Math functions are fdlibm (above).

The compiler must be told two things, which `CFLAGS` in c.ts carries:

- not to fuse a·b + c into one step (`-ffp-contract=off`, which GCC needs
  on aarch64, with `#pragma STDC FP_CONTRACT OFF` in the file as well);
- on 32-bit x86, not to keep x87's extra bits (`-msse2 -mfpmath=sse`).

**Tail calls.** A call to itself as the last step is a loop (N1). Other
tail calls matter for searches: W4d passes a caller's own k on as a tail
call. For those, clang's `musttail` is used where it exists. Elsewhere the
compiler's sibling calls at -O2 handle them, and that will be measured.

**Deep recursion.** A real nesting (calc's parentheses) takes C stack. As
`lab compile` does, `main` runs on a thread with a big stack (1 GB of
address space, used only as deep as the program goes).

**One file.** The program and its runtime are one `.c` file. It needs only
the C library (`stdint.h`, `math.h`, `stdio.h`). `lab native` will write
it and call `cc`.

## Plan

1. **N1. Scalar profile and records.** Done (above). The printer has no
   heap yet: data, closures, text and the world are refused, with the
   stage that brings them.
2. **N2. Data with counts.**
   - Lists, trees, Optional, matches, folds and equality, with `dup` and
     `drop` from a pass over the lowered code.
   - Check: sort, the calculus polynomials and Countdown's `valid` and
     `combine` against the evaluator. A test counts cells made and freed,
     and every run ends with none left.
3. **N3. Functions as values, one answer or none, searches, Abort.**
   - Closures as counted cells holding their captures.
   - The status convention as C return values.
   - k as a closure, with `musttail` measured.
   - Check: queens and Countdown against the evaluator.
4. **N4. Int, Text and the world: whole programs.**
   - Int and Text as above.
   - Console, files and arguments over the C library.
   - main on a big stack; `lab native`.
   - Check: wc, ledger, chapters and calc, printing and exiting as the
     evaluator does.
5. **N5. Reuse, then measure.**
   - Perceus reuse in matches.
   - Compare against compiled JavaScript and WebAssembly on Countdown,
     ledger and wc: time, start-up and peak memory, which are the reasons
     to have this target.
