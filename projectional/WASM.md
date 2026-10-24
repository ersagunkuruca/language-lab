# WebAssembly for whole programs

Design note for BACKLOG.md C7 (ROADMAP step 6, COMPILER.md "Targets
beyond JavaScript"). Written 2026-10-23. The last section is the plan.

**Status.** Stages W1 to W4 are done (W2: functions as values, W3a: Int
and Text, W3b: the world, through a JavaScript host or as a WASI command,
W4a: searches with one answer or none, W4b: choosing inside a handler,
W4c: Abort, W4d: searches with several answers anywhere, below). wc,
ledger, chapters, calc, queens and Countdown run whole in WebAssembly,
main included, and as WASI commands they run under wasmtime with no
JavaScript (`npm run wasi -- wc` in compiler/), Countdown too since W3c
wrote mod (from musl's fmod) in WebAssembly, and W3d a Number's show:
plain decimals directly, anything else as JavaScript's String, with
Ryū's shortest digits (its tables, about 10 KB, are in a module only
when it shows a Number). So a module asks its host for nothing but the
world. Countdown's search runs as fast as the hand-written ideal
JavaScript. With no JavaScript host, sin and the other Math functions
are V8's fdlibm compiled to WebAssembly (W3e: `compiler/math/gen.ts`
writes `src/wasm-math.ts`), the same bits as Node's Math; a JavaScript
host still gives its own Math, so a page matches the browser. An Int grows
past 64 bits as the evaluator's does (W5b, W5c), and folds go through
nested data (W1d). Left: from W1 one cast per arm. What runs in WebAssembly is the
scalar profile (`compiler/src/scalar.ts`, `wasm.ts`) lowered with `data`:
Numbers, Bools, records of them as immutable structs (W1a), data with
several cases and data that contains itself, such as lists and expression
trees (W1b), matches, folds, calls, tail calls as `return_call`, and a
budget. The host builds and reads values through exported makers and
readers (`List.cons`, `List.case`, `List.cons.head`, `Colour.red`). Sort,
the calculus example's polynomials, Countdown's `valid` and `combine` and
the algebra example's `derivative` give exactly the evaluator's answers.
Everything else is refused with a reason, which the editor shows.

How W4d came out. A function that chooses (`one of`), or calls one that
does outside a handler, has several answers. It's compiled the way the
JS backend's `$k` copies are, after Mercury's high-level C backend: it
takes the rest of the search as one more input, a closure k, and calls
it on each answer in turn. k gives "stop" as an answer and "go on" as no
answer (status 1, W4a's), so `one of` is a loop that tries k on each item
until one stops, `fail` is going on, and an abort (status 2) still goes
straight out. A handler's k puts each answer in a box (a struct with a
mutable field): `first` and `optional` stop at the first, `all` and
`count` keep going. This is a pass over the lowered code, run once a
root and everything it calls is lowered, so it knows which functions
choose, mutual recursion included. The rest of a search is made as code
where the answer is and moved, its locals renumbered, into the loop, the
closure or a join (for the arms of a match) that runs it. A call that's
the last thing left passes the caller's own k on, with no closure, so a
fold that chooses on the way up (queens' rows) costs one closure per
level, not per answer. The order of answers is the evaluator's:
arguments left to right, each choice's items in order. A function value
that chooses, and a search with several answers under a budget or
inside a match on Abort, are refused with a reason. On Countdown's four
instances WebAssembly takes 1.0 to 1.1× the hand-written ideal
JavaScript, against 1.2 to 1.5× for the compiled JavaScript
(`node gaps/bench-countdown.ts`); Hutton's example takes 88 ms, the
evaluator 22 s. queens' main and the fixtures match the evaluator.

How W3b-2 came out. `emitWasm(lowered, { wasi: true })` gives a WASI
command: the same world operations, written in WebAssembly over
`wasi_snapshot_preview1` (`fd_write`, `fd_read`, `path_open`,
`fd_readdir`, `path_filestat_get`, `args_get`, `proc_exit`) in
`wasm-rt.ts`, and `_start`, which runs main as `runMain` does. WASI hands
bytes over in linear memory, so the module has one, grown to fit, and
copies between it and its GC texts. A failure's reason is Node's world's
wording, from WASI's error number. Two things a JavaScript host gets free
are written out: a folder's names come sorted (each time the greatest name
before the last one taken, since WASI gives them in no order), and a line
is read a byte at a time so what follows stays for the next read. Paths
are relative to the folder the host gives the program, WASI's sandbox, so
an absolute path or `..` out of it is "not allowed". Under `node:wasi` in a
folder of their own, the four programs and one that uses the rest of the
world (listing folders, `file exists`, `read line`, `add to file`) give the
evaluator's output, files and exit codes on 90 runs; by hand they run the
same under wasmtime 50 (`-W gc=y`).

How W3b-1 came out. Console and Files are imports from a module
`world`, one per operation used (`print`, `readFile`, `listFolder`, …),
taking and giving the module's own texts, lists and optionals: the host
reads a text with `Text.size` and `Text.byte` and makes one with
`Text.new` and `Text.put`, and makes lists and optionals of texts with
`TextList.cons` and `TextOption.some`, whatever else the module calls
those types. One that can fail (a missing file) gives status 2 after its
answer, and `world.reason` then gives the reason, so it's an Abort where
it was called, as in the evaluator. `wasm.ts` `instantiate` takes the
evaluator's own `Runtime`, and `runMain` runs a main as `runProgram`
does: the arguments as a list of texts, the exit code from an Int, an
Abort nothing handled to standard error with exit 1. The four programs
print, write files and exit as the evaluator does on 72 runs.

How W4c came out. Abort is a third status, 2, with its reason in a
global, so it leaves every function between at once the way no answer
does. A match on Abort is two blocks, like `first`: status 2 gives the
arm, with the reason, after putting the fuel back as it was when the
handler started (the evaluator does the same); any other status goes on
out. `first`, `optional`, `all`, `count` and budgets let a 2 go on out
in turn. One not handled is the function's status, and the host reads
the reason with `Abort.reason`. calc's parser, which aborts on what it
can't read, and ledger's `entries` and `report` give the evaluator's
answers and reasons.

How W4b came out. Inside `first`, `optional`, `all` and `count`, lets
whose value is `one of` a list (keep: let item = one of list, item if
it passes, else fail; or two choices nested) become a loop per choice: a
function of the list and the locals the rest uses, which tries the rest
for one item and then calls itself on the tail, a tail call, in the
evaluator's order. `first` stops at the first answer; `all` collects
backwards as it goes and turns the list round at the end; `count` adds
one. This is the usual translation of list comprehensions into loops
(Wadler, in Peyton Jones's The Implementation of Functional Programming
Languages, chapter 7; credited). A function with Choice as a value gives
a status too, and a generic definition is lowered per effect row as well
as per type, so keep with a test that may have no answer is a search of
its own. Every pure function of chapters and calc at known types
compiles. Still
refused: `one of` inside a function that's called (queens, Countdown's
`split`), which needs success continuations.

How W4a came out. A search with one answer or none is a function that
gives a status after its answer, `(result T i32)`: 0 with the answer, 1
with a zero for none, the convention Mercury uses for semidet procedures
(credited in CREDITS.md). Each call checks the status and branches to the
block of the nearest handler (`br_if`), so no answer leaves every
function between at once, without WebAssembly exceptions (whose
current form Node 22 doesn't turn on by default) and no slower than a
compare per call. A tail call to a function that gives the same stays a
`return_call`, so a search through a long list runs in constant stack.
`first`, `optional`, `all` and `count` are two blocks: the answer, or
the default, none, an empty list, 0. `fail` is the branch itself, `value
of` a match, and the Choice builtins (quotient, remainder, power, whole
part, read, find, character code, character) are runtime functions with a
status. Without `one of`, which stays refused, a search can't have two
answers, so these are exactly the evaluator's. A function that spends
from a budget is partial too: running out is no answer where it happens,
and the nearest handler sees it, as in the evaluator (a `first` inside a
budget gives its default when the budget runs out inside it). The
shader profile keeps its count check.

How W3a came out. An Int is an `i64`; an add, subtract, multiply or
negate whose answer doesn't fit traps, a runtime error rather than a
wrong answer, until big Ints (W5). Text is an `(array (mut i8))` of UTF-8,
mutable only while it's filled; positions count characters, so slice and
length walk the bytes (the "all ASCII" flag that would make them O(1) is
left for when a profile asks). The text builtins are a small runtime,
`compiler/src/wasm-rt.ts`, written in WebAssembly's own text format one
instruction per line, which a few lines of assembler there turn into
bytes; a module prints exactly the runtime it carries. `show` of a Number
writes plain decimals of up to 15 digits itself, which is then exactly
what JavaScript writes, and asks the host for the rest (1e21, 1.5e-7,
more than 15 digits), an import a WASI build will have to replace with
its own shortest-digits printer. The host makes and reads text through
exported `Text.new`, `Text.put`, `Text.size`, `Text.byte`. wc's, chapters'
and ledger's text functions (pad, money, two digits, with point) give the
evaluator's answers.

How W2 came out. A function type is two types in the recursion group: a
closure struct holding its code as a `(ref $code)`, and the code's type,
which takes the closure and then the inputs. A function written in place
is a function of its own and a subtype of the closure struct that adds
what it captured; its code reads them back with a cast. A definition used
by name is a closure made once that calls it. Calling a function value is
`call_ref` on the closure's code, `return_call_ref` in tail position, so a
loop through a function passed in stays in constant stack. A constant is
a function of no inputs. Queens' `safe` (a fold whose result is a
function), numbers' `factorial` and calculus `newton` run. A function type
with effects other than Diverge waits for W4, and a function written
inside a fold arm that uses the fold's result inlined there is refused.

How W1b came out. A data type is a base struct holding the case's number
as an `i32` and one final subtype per case, all the structs in one
recursion group. A match puts the value in a local and jumps on the
number with `br_table`; reading a field casts to the case first
(`ref.cast`, once per read for now). A fold is a recursive function of its
own, taking the value and the locals its arms use. A child's folded
result used once in its arm is computed where it's used, so `insert`
stops once it has found its place rather than folding the rest of the
list; under a budget the evaluator's order is kept, so the count matches.
A fold whose arms each fold at most one child (a list, a chain) is a
loop instead (W1c): `down` walks to the end keeping a stack of the values
it passes, as a data type of the lowering's own, and `up` takes them back
giving each value's arm the result so far, both as tail calls. That's the
evaluator's order, and a list of any length folds in constant stack (a
fold over 10⁴ numbers overflowed before; 10⁶ now take 375 ms). Structural
`equal` is a function per type: the same case, then each field by the
evaluator's rule, the last one a tail call, so two long lists compare in
constant stack too. With `data`, a definition the checker
can't see end is allowed, as in the JS backend: outside a budget the fuel
is infinite, so it just runs.

## What it's for

In a browser, WebAssembly competes with our JavaScript backend, which
already runs on a mature JIT and is within 1.3× to 2.5× of hand-written JS
on the bigger-program rounds (compiler/GAPS.md). So speed in a page isn't
the reason. The reasons are:

1. **Hosts without JavaScript.** wasmtime, wasmer, edge workers, plugin
   hosts and WASI command lines run a `.wasm` file and nothing else. A
   language that wants to be "serious" (regular programs, websites,
   mobile) should reach them without shipping a JS engine.
2. **One artifact for the CPU fallback of shaders, and for the rest.**
   The scalar profile is already the CPU fallback when there's no GPU. A
   full backend lets the whole page's program, not only its pixel
   function, run there.
3. **A check on the core.** Each new target has found something the
   others hid (the WGSL printer found `mod`'s missing tables). A target
   with no closures and no generators for free tests that the typed core
   says what it means.

Native code (BACKLOG C17) is a separate route: C with reference counting
(Koka's Perceus), and WebAssembly again through clang if we ever want
linear memory. This note is about WebAssembly with the host's garbage
collector.

## The decisions

**WasmGC, not our own heap.** Data in the language can't be changed and
can't form cycles, so either works. A heap of our own in linear memory
means writing a collector or reference counting before the first list
runs. WasmGC (structs, arrays, `ref.test`, `br_on_cast`, `call_ref`) is in
every current browser, in Node 22 (V8 12.4, on by default) and in
wasmtime with its GC support turned on. It is what the functional languages that target WebAssembly
now use: OCaml's wasm_of_ocaml (Jérôme Vouillon), Guile's Hoot (Spritely
Institute), Kotlin/Wasm and dart2wasm. Prior art for the whole approach,
not code we take.

**Grow the scalar profile, don't start a second compiler.** COMPILER.md's
order already says it: "grow the scalar profile towards the heap". The
lowering in scalar.ts gets new node kinds for data (`make` of any variant,
`tag` tests, field reads, lists), closures and handlers. The WGSL printer
keeps refusing them with its own reason, and the WASM printer prints them.
One tree for both targets keeps the uniformity rule: a shader is the same
program with fewer things allowed, not a different language.

**One representation first, specialized later.** As in the JS backend's
first version, every value of an unknown or polymorphic type is an
`anyref`. A Number in a polymorphic position is boxed in a one-field
struct, a Bool and a small Int are `i31ref`. Where the type is known
(most code after specialization), values stay unboxed: `f64`, `i32`, and
a struct reference of the exact variant type. The JS backend's
specializations (per effect row, per Bool, per array kind) are decided
in compile.ts; the ones that matter here move into the shared lowering
as they are needed, one at a time, each with a measurement.

| language | WebAssembly |
|---|---|
| Number | `f64` (boxed `(struct f64)` where polymorphic) |
| Bool | `i32`; `i31ref` where polymorphic |
| Int | an `i31ref` while it fits in 31 bits, else a `$big` struct (an i64), else a `$huge` (sign and 32-bit limbs; see Int below) |
| a type's cases | one struct type per variant, all subtypes of the type's base struct, which holds the tag as an `i32` field; a match is a `br_table` on the tag |
| a record (one case) | its struct, no tag test |
| List | cons cells as structs; arrays from `split` as `(array anyref)` |
| Text | see Text below |
| functions as values | a closure struct: a `funcref` and its captured values; a known callee is a direct `call` |
| `Choice` | success continuations, as the JS `$k` copies already do (Mercury's high-level C backend, credited in COMPILER.md); a single-answer function returns an `i32` found flag and its answer's fields as multiple values, which is C6's `$fields` with no `$got` |
| `Abort` and other aborting effects | WebAssembly exceptions (`throw`, `try_table`) |
| answered effects (`Log`, cells) | a handler stack in a global array of closures, as runtime.js `$perform` does |
| `with fuel` | a mutable global, as the scalar profile's budget |
| the world (files, console, time, random, HTTP) | imports, through one `World` interface of about ten functions: a JS adapter for browsers and Node, a WASI preview 1 adapter for wasmtime |

**Text.** Positions count characters (std.ts), and the JS backend keeps
JS strings, checking for surrogates. In a JS host the cheapest text is a
JS string through the JS String Builtins (`wasm:js-string`, on by default
in Node 22 and current Chrome and Firefox). Outside a JS host there are
no JS strings. One representation is better than two, so text is our
own: an immutable `(array i8)` of UTF-8 with a flag for "all ASCII", where
character positions are byte positions. Non-ASCII text pays a walk to
find a position, as it does in `$text` today for text outside the Basic
Multilingual Plane. Text crosses to a JS page through `TextDecoder` at
the boundary. If a profile shows text crossing a lot, imported strings
become a JS-host-only fast path, not the first design.

**Int.** "Whole numbers that never overflow". An `i64` can't hold a big
one, and a JS host's BigInt isn't there in WASI, so (decided in W5a) an
Int is an `eqref`: an `i31ref` while it fits in 31 bits, with no
allocation, else a `$big` struct. That is how Hoot (Guile Scheme on
WasmGC) keeps fixnums and wasm_of_ocaml keeps OCaml's ints. W5a holds an
i64 in `$big`; past 2⁶³ (W5b) it is a `$huge`: a sign and a trimmed
`(array (mut i32))` of 32-bit limbs, least significant first, so it grows
as the evaluator's does. Each Int is in its one spelling: the smallest of
the three that holds it, so equal stays a comparison of cases. Add,
subtract and multiply try the i64 (or i31) way first and take the limbs
only on overflow or a `$huge`; the limbs are Knuth's classical algorithms
(TAOCP vol. 2, 4.3.1). The host passes a `$huge` limb by limb
(`Int.limbs`, `Int.limb`, `Int.huge`, `Int.setLimb`; `toInt` and
`fromInt` in wasm.ts), not under WASI. Quotient and remainder past an
i64 are Knuth's algorithm D (W5c), and power squares on the big multiply. The runtime's Int functions are written on i64s and called through
wrappers that convert (`int.small`, `int.of`, wasm-rt.ts `runtime`), so
only add, subtract, multiply and the rest need a big path. Measured: the
ledger (5,000 lines) and wc in WebAssembly take the same time as with
i64.

**What stays refused.** A relational solve the mode compiler (MODES step
5, `compiler/src/modes.ts`) can't write out needs relate.ts, a search
over terms in JS: in a JS host it's an import, in WASI it's refused at
compile time. `derivative` and `gradient` of a function written in place
are expanded before lowering, as for shaders; of a function only known at
run time, refused.

**Checking it.** The evaluator is the oracle, as for every target. Each
stage adds its programs to a differential test that runs `main` in the
evaluator and in WASM (Node runs WasmGC) and compares the printed lines.
The bigger-program rounds (GAPS.md) get a WASM column next to the
compiled JS and the ideal.

## Plan

One PR each, in this order. Each stage widens what runs, and refuses the
rest with the reason, so nothing breaks between stages.

1. **W1 data.** Records first (W1a, done: one struct type per record
   type, readers for the host). Then variants and records of any fields,
   matches and folds over them, lists as cons cells (W1b, done),
   structural `equal` and folds over lists as loops (W1c, done), folds
   over data nested in other data (W1d, done: a rose tree's `List Tree`
   folds to a `List R`, through one function per container type that the
   fold makes and calls on the field). Left:
   one cast per arm rather than per field read. The binary encoder in wasm.ts gets the type
   section's recursion groups, struct and array types and reference
   types. Programs: calculus and physics without text, and Countdown's
   `solutions` count.
2. **W2 closures (done).** Functions as values, `map` and `keep` with a
   lambda, `call_ref`, and tail calls through `return_call_ref`.
3. **W3 text and the world.** UTF-8 text with the std.ts text builtins,
   `show` (W3a, done), and the `World` imports with both adapters (W3b,
   done: JavaScript, and WASI for wasmtime). Programs: wc and
   ledger as WASI commands (`node:wasi` in the test; wasmtime when it's
   installed).
4. **W4 searches and effects.** One answer or none as a status after
   the answer (W4a, done), choosing inside a handler and functions with
   Choice as values (W4b, done), Abort as a third status (W4c, done),
   and `one of` anywhere through success continuations (W4d, done).
   Programs: queens, Countdown, calc.
5. **W5 Int past 64 bits** through host bignums, then specialization
   measured against the JS backend on each GAPS round.

Mobile packaging (C18) doesn't wait for this: a web app wraps the JS
build. WebAssembly matters there only for the WASI-style hosts above.
