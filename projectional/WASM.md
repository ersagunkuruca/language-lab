# WebAssembly for whole programs

Design note for BACKLOG.md C7 (ROADMAP step 6, COMPILER.md "Targets
beyond JavaScript"). Written 2026-10-23. The last section is the plan.

**Status.** Stage W1 has begun: records are WasmGC structs (W1a). What
runs in WebAssembly is the scalar profile (`compiler/src/scalar.ts`,
`wasm.ts`): Numbers, Bools, records of them as immutable structs with an
exported reader per field (`Colour.red`), calls, tail calls as
`return_call`, and a budget. The ray marcher's colours come out of
WebAssembly exactly as the evaluator's. Everything else is refused with
a reason, which the editor shows.

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
| Int | `i64` while it fits, a host bignum past that (see Int below) |
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

**Int.** "Whole numbers that never overflow". An `i64` add with an
overflow check, and a bignum past it. Bignums in WebAssembly are a
library of their own, so the first version imports them from the host in
a JS host and refuses a program that overflows in WASI with a clear
message ("this Int grew past 2⁶³; WASI builds don't have big integers
yet"), which is a runtime error, not a wrong answer. The ledger and the
examples stay far below.

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
   type, readers for the host). Then variants and records of any fields, matches and folds
   over them (folds as the loops the JS backend makes), lists as cons
   cells, structural `equal`. The binary encoder in wasm.ts gets the type
   section's recursion groups, struct and array types and reference
   types. Programs: calculus and physics without text, and Countdown's
   `solutions` count.
2. **W2 closures.** Functions as values, `map` and `keep` with a lambda,
   `call_ref`, and tail calls through `return_call_ref`.
3. **W3 text and the world.** UTF-8 text with the std.ts text builtins,
   `show`, and the `World` imports with both adapters. Programs: wc and
   ledger as WASI commands (`node:wasi` in the test; wasmtime when it's
   installed).
4. **W4 searches and effects.** Success continuations for `Choice`,
   multi-value single-answer returns, exceptions for `Abort`, the handler
   stack. Programs: queens, Countdown, calc.
5. **W5 Int past 64 bits** through host bignums, then specialization
   measured against the JS backend on each GAPS round.

Mobile packaging (C18) doesn't wait for this: a web app wraps the JS
build. WebAssembly matters there only for the WASI-style hosts above.
