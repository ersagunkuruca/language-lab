# Words as machine words (C150c design, 2026-11-03)

Row C150 (from L193): Word8 to Word64 should run as the machine's own
unsigned words: WASM `i32`/`i64`, C's `uint8_t` to `uint64_t`, JavaScript
numbers with `>>> 0` (and `Math.imul`) up to 32 bits. Today a word is a
record `{bits: Int}` with a private maker, and each of its operations
unwraps `bits`, works on Int, and masks again with `bits and 2ⁿ−1`
(ters/src/lang/prelude-source.ts, `wordDefs`). C150a and C150b made and,
or, xor and `shifted down` lower on Int. So every word now runs on every
target, but as an Int with an and after each step.

## What it costs now

One million FNV-1a steps (xor in a byte, multiply by the prime, mask),
measured on this container. "Int" is today's lowering of the std word;
the other two are the same loop written by hand in JavaScript:

| width | WASM today (Int + mask) | JS BigInt by hand | JS u32 / `Math.imul` by hand |
|---|---|---|---|
| 32 bits | 81 ms | 36 ms | 5.2 ms |
| 64 bits | 157 ms | 76 ms | 18.2 ms (two 32-bit halves) |

A 32-bit word on WASM or C should be within a few times of the last column,
so about 15× is left on the table. At 64 bits the Int path also leaves the
i64 fast path, because a product of two 64-bit words doesn't fit in i64 and
falls back to limbs.

## The options

**(a) Machine words as new builtin types.** Std gets `Word32` etc. as
builtins with their own operations, like Float64. Every target writes them
directly. This is the fastest to build and the most code. It also undoes
L193's point, that a word is an ordinary definition written in the language
with laws checked against Int. And it adds 4 × 11 builtins that the
evaluator, the solver, the editor's views and SPEC.md must each learn.

**(b) The compiler proves an Int fits a word.** The language stays as it
is. The compiler works out from the program that a `bits` field always
holds `0 ≤ bits < 2ⁿ` (the "known bits" of an Int), and then stores it as an
n-bit machine word. Then `bitAnd(a op b, 2ⁿ−1)`, with a and b known to fit,
is the machine's wrapping op. The proof is short, because the word's maker
is private: every value of `word32` is built in prelude-source.ts by
`wrap` (an and with 2³²−1) or by and, or, xor of two words. So "every
construction of this record puts a value under 2ⁿ in this field" is a
check over a few construction sites, not a whole-program analysis.
The same fact helps other Int code: Fixed (FIXED-POINT.md step 3), hashes,
indexes and colours written as Int masks.

**(c) Recognise the std words by name in scalar.ts.** Easy, but it is a
special case for one library, and a user's own `word12` wouldn't get it.
This goes against "everything is one system".

## Recommendation: (b), in steps

1. **Known bits of an Int, on the core IR.** In scalar.ts, give each
   Int-typed SExpr a bound: an int literal is its value; `bitAnd(x, m)`
   with m ≥ 0 is at most m; or and xor of two values under 2ⁿ stay under
   2ⁿ; a match on a record field takes the bound its constructions give
   (taken across the record's construction sites, with "no bound" if any
   one site has none). This step is checked by tests only, with no change
   to output. Done (C150d): `compiler/src/known-bits.ts`, which finds
   Word8, Word32 and Word64's `bits` under 2ⁿ in FNV-1a and xorshift32
   (compiler/test/known-bits.test.ts).
2. **A field that fits is stored as a word.** Add an SType for an unsigned
   n-bit word (`u32`, `u64`; 8 and 16 held in a u32). It prints as WASM
   `i32`/`i64` with unsigned compare and shift, C's `uint32_t`/`uint64_t`,
   and in JS a number kept by `>>> 0` (u64 in JS stays BigInt with
   `BigInt.asUintN`, or two halves, whichever measures faster). Reading the
   field as an Int widens it (zero-extend). Building the record narrows it,
   which is free because the bound is proved. Done for 32 bits (C150e, with
   step 3): compiler/src/machine-words.ts, run by lowerScalar for
   WebAssembly and C. A record's field under 2³² is an i32 holding the
   bits (Word8, Word16 and Word32), and a local let to it is one too. Core
   JS keeps the evaluator's values, which its host reads, so it is left
   out; Word64 stays an Int, since a word past 2⁶³ fits neither target's
   i64 (left for C150g).
3. **Mask after an op becomes the wrapping op.** `bitAnd(add(a, b), 2ⁿ−1)`
   with a and b words gives `a + b` on the word, and the same for subtract,
   multiply, negate and shift up. Then the Int in between is never made. Done
   (C150f) for Word32's + − ×, negate, both shifts (a runtime function
   taking the Int count), and, or, xor and `less` (step 4's compare, as
   i32.lt_u). Word8's and Word16's masks are narrower, so their + − × still
   go through the Int. One million FNV-1a steps (with an Int counter):
   WebAssembly 150 → 51 ms, C 63 → 12.5 ms including the process start.
   What is left on WebAssembly is the Int counter and a struct made per
   word.
4. **Show and compare.** `less` on two words is the unsigned compare, and
   show widens to Int as now.
5. **Gate.** The FNV-1a loop at 32 bits under 10 ms on WASM and C, with
   words.test.ts's published hashes on every target. Stop when the next
   step buys less than 10%.

Steps 1 to 3 each make one merged PR. Nothing here changes the language,
the std words, or what a program means, so no decision is needed from
Ersagun. This follows his NO EXPLICIT SELECTION rule (the compiler chooses
the representation) and TWO LANDSCAPES (the targets' machine words don't
dent the language's Int).

Prior art: known-bits analysis is LLVM's `computeKnownBits` and GCC's
nonzero-bits tracking; narrowing a provably small integer to a machine
word is how GHC's `Word32` and Rust's `u32` are compiled, though those are
builtin types (option a). Credited in ters/CREDITS.md when step 1 lands.
