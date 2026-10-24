# Native programs through C

Design note for BACKLOG.md C17 (ROADMAP step 6, COMPILER.md "Targets
beyond JavaScript", route 2). Written 2026-10-24. The last section is the
plan.

**Status.** Stages N1 to N4 are done: whole programs run natively, built by `lab native`.

- **N1.** The scalar profile and its records print as C
  (`compiler/src/c.ts`): Numbers, Bools, records as structs passed by
  value, lets, ifs, calls, self tail calls as loops, and budgets. calculus,
  physics, the ray marcher's colours and the strip integral give the
  evaluator's bits, built with GCC and with clang
  (`compiler/test/c.test.ts`). sin, cos, tan, exp, log, pow and atan2 are
  V8's fdlibm, the code Node's Math runs, translated from C++ to C by
  `compiler/math/to-c.ts` (into `src/c-math.ts`). On 140,000 inputs (any
  bits, the edges, large arguments) they give exactly Node's bits.
- **N2.** Data has counts:
  - lists, trees, Optional and the lowering's frames are cells, with a
    static cell for each case with no fields;
  - matches, folds (nested ones too, a rose tree's List of children) and
    equality on data work;
  - `dup` and `drop` come from liveness, as below.

  sort, insert, the calculus polynomials (100,000 coefficients), Countdown's
  `valid`, algebra's `derivative`, `same` on lists and a rose tree's
  total, depth, mirror and scaled give the evaluator's answers. After each
  call every cell is freed: the harness prints how many are still live,
  and the tests want 0. They also pass under AddressSanitizer
  (`NATIVE_CFLAGS="-fsanitize=address,undefined"`), so no cell is used
  after it is freed.
- **N3.** Functions as values, one answer or none, and searches:
  - a closure is a counted cell: its code, then what it captured. A call
    goes through a pointer typed by the function type, and the code owns
    the closure, as it owns its other inputs;
  - a function with one answer or none sets `lab_st` to 1 and gives a
    stand-in (0, or no cell). Each call to one checks it, and leaves
    through the nearest label (an attempt, a failing budget) after
    dropping what it owns there, or says none itself;
  - first, optional, all and count are a body, then a label for none. The
    boxes the lowering's searches put answers in are counted cells;
  - and, or run both sides, as WebAssembly's i32.and does: a side can hold
    cells, and skipping it would leak them.

  Countdown's whole search (`solutions`, through the lowering's k
  closures), algebra's evaluate, simplify and newton, calculus's partial
  definitions and the Peano and binary numbers give the evaluator's
  answers, every cell freed, under AddressSanitizer too. Abort waits for
  N4, since its reason is a Text. Writing the tests found that the shared
  lowering counted ±∞ as a whole number when comparing (so ∞ ≠ 0 there,
  but ∞ ≈ 0 in the evaluator, whose rule is Number.isInteger); fixed for
  every target.
- **N4a.** Int, Text and Abort (`compiler/src/c-rt.ts`, the runtime that
  wasm-rt.ts is to WebAssembly):
  - an Int is one `int64_t`: odd, the value itself while it fits 62 bits;
    even, a pointer to a counted cell of 32-bit limbs. Each Int has one
    spelling, so small ones are equal when their words are. Big products
    are schoolbook and division is Knuth's Algorithm D (Hacker's Delight's
    `divmnu`); quotient and remainder round down, as the evaluator's do;
  - a Text is a counted cell of UTF-8 bytes. Positions count characters,
    and since UTF-8's byte order is the code points' order, `less` compares
    bytes;
  - a Number shown is JavaScript's String(x): the fewest digits that read
    back as x (the first precision whose correctly rounded digits do, by
    the C library's printf and strtod), set out as ECMA-262 says;
  - Abort is status 2, with its reason in `lab_reason`; a handler is a
    label for status 2, as an attempt is for 1.

  A call is now a statement of its own, in order: C may run a call's
  arguments in any order, and a call can drop a cell another argument
  still reads. Calc's arithmetic on 400 Ints of every size, its tokens,
  parser and descriptions, chapters' words and slugs, wc's tallies,
  ledger's amounts (and their aborts) and the converter's numbers on 300
  random magnitudes give the evaluator's answers, every cell freed, under
  AddressSanitizer too.
- **N4b.** The world and whole programs:
  - the console and files over the C library and POSIX (`stat`,
    `opendir`), failing with the words Node's world uses
    (projectional/src/lang/world.ts) and status 2. A folder's names are
    sorted as JavaScript sorts texts, by UTF-16 units;
  - `main` gets the arguments as a List Text and runs on a thread with a
    1 GiB stack (address space, used only as deep as the program goes),
    so calc's 100,000 nested parentheses need no heap copy as compiled
    JavaScript's do (C21). Its Int is the exit code; an Abort nothing
    handles prints its reason to standard error and exits with 1;
  - `lab native <program> [-o out]` writes the C and builds it with `cc`
    (or `$CC`).

  wc, ledger, chapters, calc, queens and a fixture that lists folders,
  checks and writes files and reads lines give the evaluator's standard
  output, standard error, exit code and files, in a folder of their own,
  on 70 runs: missing files, folders given as files, files given as
  folders, a name with ü and 🎉, \r\n lines, aborts handled and not.

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

**One file.** The program and its runtime are one `.c` file. It needs the
C library, and for the world POSIX (`sys/stat.h`, `dirent.h`) and
threads (`-pthread`). `lab native` writes it and calls `cc`. Windows
would need `_stat` and `FindFirstFile` in their place.

## Plan

1. **N1. Scalar profile and records.** Done (above). The printer has no
   heap yet: data, closures, text and the world are refused, with the
   stage that brings them.
2. **N2. Data with counts.** Done (above). `dup` and `drop` are decided
   while printing:
   - a use of a local is its last one, or a dup;
   - a branch drops the locals it doesn't use as it starts;
   - reading a field borrows the cell, dups the field, and drops the cell
     after its last read.
   A cell with no counts left gives up its fields from a stack, so a long
   list frees without deep recursion. Countdown's `combine` has one answer
   or none, so it waits for N3.
3. **N3. Functions as values, one answer or none, searches, Abort.**
   - Closures as counted cells holding their captures.
   - The status convention as C return values.
   - k as a closure.
   - Check: Countdown against the evaluator. Done (above); `musttail`
     moves to N5's measurements, and queens to N4 (it needs `number.range`).
4. **N4. Int, Text and the world: whole programs.**
   - Int and Text as above. Done (N4a).
   - Console, files and arguments over the C library.
   - main on a big stack; `lab native`. Done (N4b).
   - Check: wc, ledger, chapters and calc, printing and exiting as the
     evaluator does.
5. **N5. Reuse, then measure.**
   - Perceus reuse in matches.
   - Compare against compiled JavaScript and WebAssembly on Countdown,
     ledger and wc: time, start-up and peak memory, which are the reasons
     to have this target.
