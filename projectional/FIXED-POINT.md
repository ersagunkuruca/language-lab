# Deterministic numbers for games: Fixed (design note, 2026-10-27)

Ersagun, 2026-10-26: floats "cause precision problems with large worlds and
they work inconsistently across different machines making multiplayer a
harder problem" (BACKLOG L89).

## Short answer

Add `Fixed`, a Number that is an Int counted in steps of 2⁻³². `1.5` at Fixed
is the Int 6442450944, which is 1.5 · 2³². It answers both of Ersagun's
complaints:

- **The same bits everywhere.** Every operation is Int arithmetic plus a
  rounding rule the language fixes (round toward −∞, an arithmetic shift).
  Int is already exact and identical on every target, so Fixed is too.
  There is nothing for a machine, a compiler flag or a fused multiply-add to
  change. Lockstep multiplayer can send inputs and never states.
- **Large worlds.** A step is 2⁻³² everywhere in the world, not only near the
  origin. A Float64 position 10⁹ metres out has steps of 10⁻⁷; a Fixed one
  still has steps of 2.3 · 10⁻¹⁰. The integer part is an Int, so it has no
  fixed limit. A world is as big as its Ints.

## In the language

`Fixed` is a record around one Int, `fixed(steps)`. It joins the one
`+ − · −x <` the way any type of the program's own does since L40h, through
implementations written in the prelude, in the language:

- `arithmetic at fixed`: `+`, `−` and `−x` are the Int's own. `a · b` is
  `(a · b) shifted right 32`, that is floor(a · b / 2³²).
- `ordered at fixed`: the Int's `<`.
- `divide` is `floor(a · 2³² / b)`, with no answer for 0, as at Rational.
  `square root` is Int's whole square root of `a · 2³²`.
- `trig at fixed` is CORDIC (Volder, 1959): sin, cos and atan2 from
  shifts, adds and a table of 32 angles, all Ints. It is exactly the same
  on every machine because nothing in it is a float. exp and log use the
  same shift-and-add method (Specker, 1965).
- A literal at Fixed comes from its digits as a fraction, so it is exact.
  `0.1` is round(0.1 · 2³²) = 429496730 steps, rounded once, the same way
  on every target. Float64's `0.1` is never involved.
- `as fixed(x)` and `as float64(f)` convert explicitly, as with the other
  Numbers. `show` prints the shortest decimal that reads back to the same
  steps.

Because Fixed is an ordinary type with implementations, generic code
written with `+ · <`, such as vectors, physics steps and `sort`, works on
it unchanged. That is the point of L40h.

The fraction bits are 32, fixed for now. A `Fixed n` with n fraction bits
is a later step if a program needs it (16.16 for small worlds, as Doom
used).

## Targets (hosting, not language)

The language promises the same bits everywhere. How each target delivers
them is its own business, the "two landscapes" rule:

- **Evaluator and compiled JS:** Int's tagged-or-BigInt representation.
  A product of two Fixed values passes 2⁵³ and takes the BigInt path, so
  this is slower than Float64. It is correct first.
- **WASM and C:** an `i64` when the values are known to fit, and Int's
  BigInt path when they might not. The checks for that are the same range
  analysis Int lowering already needs. The product uses a
  128-bit intermediate (`__int128` in C; two 64-bit halves in WASM).
- **GPU:** refused with a reason for now. A shader has no 64-bit integers
  in WGSL. Fixed positions can still be turned into Float32 relative to
  the camera before drawing, which is how big-world games draw anyway.

Today Float64 already gives the same bits on JS, WASM and C: + − · / are
IEEE 754's, and sin and cos are fdlibm's on all three (NATIVE.md). Fixed is for
the remaining cases: other machines, other compilers, FMA contraction, and
large worlds.

## Steps

1. `std.fixed` with `arithmetic at fixed`, `ordered at fixed`, literals,
   `as fixed`, `as float64` and `show`, all in the prelude. A test shows
   that a 1,000-step physics loop gives the same steps evaluated and
   compiled, and a position at 10¹² keeps its last bit. **Built (L89a)**:
   the product's shift is a new Int builtin, `shifted down` (floor(a / 2ⁿ)),
   and literals are rounded in arith.ts with the other number literals
   (test/fixed.test.ts). For now `as fixed` takes a whole number,
   `fixed as float64` gives the nearest Float64, and `show fixed` shows
   through it. **Since L89b** `show fixed` is the shortest decimal that
   reads back to the same steps (Steele and White's free-format digits,
   in Ints), and `divide fixed` is there.
2. `trig at fixed` by CORDIC, `square root` and `divide`. `divide` is
   built (L89b); CORDIC and `square root` are next.
3. WASM and C lowering to `i64` where the range is known.
4. An example: a lockstep simulation where two runs that share only inputs
   end in the same state, bit for bit.

## Prior art

- Doom's `fixed_t`, 16.16 in an int (id Software, 1993), and most console
  games before FPUs.
- Deterministic lockstep: Bettner and Terrano, "1500 Archers on a 28.8:
  Network Programming in Age of Empires and Beyond" (GDC 2001). Many RTS
  engines use fixed-point simulation for exactly this.
- CORDIC: Jack Volder, "The CORDIC Trigonometric Computing Technique"
  (1959); Specker (1965) for exp and log. libfixmath (MIT) is a modern
  C library of Q16.16 functions.
- Ada's and Embedded C's (ISO/IEC TR 18037) fixed-point types are
  languages making it a built-in type.
