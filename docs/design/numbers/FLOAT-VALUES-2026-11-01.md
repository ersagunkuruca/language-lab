# Which IEEE float values the language keeps (design note, 2026-11-01)

**Status (2026-11-01): decided; L125a, L125b, L125d and L125f built.** Ersagun chose both
recommendations (10:28 and 10:29): `Float64` is the finite floats with one
zero, ±∞ move to `Extended a`, and `x / 0` has no answer (`Choice`). Rows
L125a to L125f in BACKLOG.md. L125a step 1 (this PR's row in DONE.md): the
evaluator stops the program with the reason whenever a float operation's
answer isn't finite, and `atan2` takes −0 as 0. L125b is built: no answer
is a `Choice` in the evaluator, dropped where a sign analysis (signs.ts)
shows the input fine; a page's view with no answer shows nothing there
(Ersagun's choice, 12:45), and handlers handle their own (the examples'
`first(() => …, () => what was there)`). L125c1
(compiled JavaScript, 2026-11-01): the same stops with the same reasons,
no answer checked on the argument and overflow late (§2). L125c2
(WebAssembly and C): the same checks in the lowering (scalar.ts), and the
stop says the same reason and exits with 1; there it ends the program
rather than being an Abort a handler in the program gets, and an answer
given back to a host is checked only by C's test harness. Shaders keep
no checks (§ targets). L125d is built: `Extended a` with
`extended less/add/negate/subtract/multiply`, `minimum` and `maximum`. L125f is built: a host's NaN or ±∞ is refused at
the border.

Ersagun, 2026-11-01: "Shall we put the problems with IEEE floats into a
discussion. Maybe we should use a subset of them (probably excluding
infinities and NaN and maybe also −0). But there are places where −0 and
infinities as values solve problems. [...] Maybe we need to do something
like what Rust does with option types on references (uses null values
underneath), and we use the original 'reals' set plus the infinities as a
different type etc. Is that too complicated?"

**Short answer.** It isn't too complicated, and it is simpler than what we
have now. `Float64` should mean the finite floats with one zero. The
infinities become an ordinary data type, `Extended a`, that works for any
ordered number type, not only floats. NaN is never a value: it is how "no
answer" is stored. Rust's trick, using bit patterns that can't be values to
store the extra cases, is exactly how both `Optional Float64` and
`Extended Float64` get stored in one float with no tag. All of this is
representation work the compiler already knows how to do; nothing in the
language becomes a special case. And it settles the Compiler lane's
question about `0 · x`: in this type `0 · x = 0` is simply true, so the
"strong zero" Ersagun picked comes for free, with no zero checks.

## What's wrong today

`Float64` is "the real numbers, represented approximately by float64"
(NUMBERS.md, "Laws"), but its values are IEEE 754's, which has three
kinds of value that aren't reals:

- **NaN** isn't equal to itself, so `x = x` fails, and any law with a
  variable on both sides fails with it. `compare` already patches it (NaN
  after everything, the same as itself, LANGUAGE.md "Float64s are ordered
  exactly").
- **−0** is equal to 0 but isn't interchangeable with it: `1/−0` is −∞,
  `atan2(−0, −1)` is −π, `show` prints "-0". Equal things that behave
  differently break the one rule a language of definitions most needs, that
  you can replace a thing by what it equals. `equal` and `compare` already
  say −0 is 0, so the language has half-decided this.
- **±∞** come from overflow and from `x / 0`, and then turn into NaN
  (`∞ − ∞`, `0 · ∞`).

Each costs the compiler correct laws. Review 2026-11-01 §3 (I107) is the
example: staging folds `0 · x` to 0 and `x + 0` to x, which is right for
reals and wrong for IEEE (`0 · ∞` is NaN, `−0 + 0` is 0). PR #834 makes
the staged code exact by tracking each dropped `x` and adding `x − x` back
in, at 1 to 8% more code. The "strong zero" alternative (0 · x = 0 for
every x) would need a zero check on every multiply on every target. Both
are the price of `Float64` holding values that aren't numbers.

Meanwhile the language already treats "no answer" as a first-class idea:
`Choice` in a type, `Optional` as its data, a relation with no solution,
`Int`'s `quotient` with no answer at 0, fractions' `x ÷ 0` with none. Only
`Float64` answers `1/0` with a value instead.

## The proposal

### 1. `Float64` is the finite floats, with one zero

Its values are the finite float64 numbers, and 0 is one value. Its meaning
is still "reals, approximately", and now every value is a real.

- **−0 is a second spelling of 0**, the way `2/4` is a spelling of `1/2`
  (NUMBERS.md "Canonical spellings and quotient types"). Hardware will
  produce it (`−1 · 0`), and nothing needs to stop it, because only a few
  operations can see the sign of a zero, and those make it canonical first
  with one `+ 0.0` (which turns −0 into 0 under round to nearest): `show`,
  `atan2`, `sign`, reading the bits, and hashing. Everything else can't
  tell.
- **No ∞, no NaN.** An operation that would leave the set doesn't produce
  a strange value; it has no answer, or it fails (below).
- **The laws that come back:** `x = x`, `0 · x = 0`, `x + 0 = x`,
  `x − x = 0`, `x / x = 1` for `x ≠ 0`, `x · 1 = x`, and `a < b` or `a = b`
  or `a > b`. These are exact, not approximate, so staging and any later
  optimiser may use them. The laws that rounding breaks stay broken
  (`(a + b) + c ≠ a + (b + c)`), so nothing is reassociated; that's the
  part of fast-math that is still a different language.

### 2. Leaving the set: two kinds

Where a check goes depends on why the answer is missing.

| what happens | operations | in the type | why |
|---|---|---|---|
| **no answer, mathematically** | `x / 0`, `sqrt` of a negative, `log` of 0 or less, `asin`/`acos` outside [−1, 1], `0 ^ negative`, a text or Int too big to read as a Float64 | `Choice`, like `Int`'s `quotient` | there is no real number to give; the program can and should say what to do, and a search simply backtracks |
| **the answer is too big to hold** | `+ − ·`, `/` of a tiny divisor, `exp`, `^` past 1.8e308 | not in the type: an abort, like running out of memory | a real answer exists, the machine can't hold it; putting `Choice` on every `+` would put it on every arithmetic function |

The first kind is checked where it happens, on the argument: one compare
before `/`, `sqrt`, `log`. A compiler that can see the argument can't be
zero or negative (a literal, `1 + x²`, inside `if d ≠ 0`) leaves both the
check and the `Choice` out. That is an inferred fact, never something the
programmer writes (Ersagun, 2026-10-29: no compiler hints).

The second kind can be checked late. IEEE's own propagation keeps an
overflow visible: an ∞ stays ∞ or becomes NaN through `+ − ·`, so a chain
of arithmetic needs one finiteness check at its end, not one per step. The
check goes where a non-finite value could otherwise vanish or decide
something: a comparison or branch, a divisor, `exp`/`atan`/`tanh` (which
turn ∞ into finite values), `show`, a conversion, and the value leaving to
an effect or the host. Pure code can't observe the difference between
"failed at the multiply" and "failed at the compare after it". One honest
rule makes this sound: **an overflow nobody uses may not be reported**, as
in Haskell's imprecise exceptions, where pure code that fails says only
that it fails, not exactly where.

`Choice` on division is the real cost of the proposal for programmers: a
function that divides by something the compiler can't prove nonzero gets
`Choice` in its type, and somebody handles it. That is what `Int` already
asks, and the Clifford demos show it's right: normalising the meet of two
parallel lines (an ideal point, weight 0) is exactly the case a program
should say something about, and today it silently makes NaN.

### 3. Infinities: `Extended a`, an ordinary data type

The places where infinities genuinely help are mostly about **bounds**,
not about floats:

- an interval with no upper end, `[3, +∞)`;
- the identity of `minimum` (the minimum of no numbers is +∞), so a fold
  over an empty list has an answer;
- "not reachable yet" in a shortest-path search;
- a limit, like `atan(+∞) = π/2`, or a ray that never meets a slab in a
  ray-box test.

Those want `Int` and `Rational` and `Fixed` as much as `Float64`. So:

```
Extended a = minus infinity | finite(value: a) | plus infinity
```

ordinary data, in the library, generic over any ordered number type. Its
`<` is total. Its `+ − ·` are defined where the extended reals define them
(`∞ + 1 = ∞`) and have no answer where they don't (`∞ − ∞`, `0 · ∞`), so
`Extended` has no NaN either. `Float64 → Extended Float64` is `finite`,
and back is a match.

**Signed zero is not kept, even here.** Its jobs are `1/±0 = ±∞` and
choosing the side of a branch cut (Kahan, "Much Ado About Nothing's Sign
Bit"). Both are real, but both need zero to be two values that are equal,
which is the break in substitution above. Without it, `1/0` has no answer
in `Extended` too (affine ∞ has a sign, and 0 doesn't say which), and the
branch cuts of `atan2`, `log` and complex `sqrt` follow one fixed rule
(the cut belongs to the side counter-clockwise from it, Kahan's own
convention when no sign is available). A program that needs the side of
a limit says so with `Extended` values or a separate argument. This is the
one place we give up something IEEE does well: identities like
`sqrt(conj z) = conj(sqrt z)` fail exactly on the cut. That's an
acceptable price for "equal means interchangeable".

### 4. How they're stored: Rust's niche, through representations

Rust stores `Option<&T>` in one pointer by using null, a bit pattern no
reference can have, for `None`. float64 has 2⁵³ patterns that aren't
finite numbers. So, as representations the compiler picks (representations
are language definitions; REPRESENTATIONS.md), never chosen by hand:

| type | stored as | the extra cases | test |
|---|---|---|---|
| `Float64` | one f64 | none | none |
| `Optional Float64` | one f64 | `none` = any non-finite | `abs(x) < ∞` |
| `Extended Float64` | one f64 | `±infinity` = IEEE's ±∞ | `x = ±∞` |
| `Optional (Extended Float64)` | one f64 | `none` = NaN | `x ≠ x` |
| `Extended Int`, `Extended Rational` | the plain data | | |

Two consequences:

- **"No answer" is free in the common case.** A `Float64` function with
  `Choice` whose caller handles it nearby (`first(() => a / b, otherwise
  0)`) compiles to the division and one test, no exception, no tag, no
  continuation: the hardware's ∞ or NaN *is* the `none`. That's what makes
  `Choice` on `/` affordable.
- **`Extended Float64` costs nothing over IEEE.** Its `+ − · <` are the
  hardware's, plus a NaN test where `∞ − ∞` could happen. A ray-box slab
  test written with `Extended` compiles to the usual IEEE code.

A program never sees any of this: it sees `Optional`, `Extended` and
`Float64`. That's the two-landscapes rule (2026-10-24): the bits are a
hosting detail.

Bit patterns, not payloads: we never store anything in a NaN's payload,
because JavaScript engines and WebAssembly don't promise to keep payloads
through arithmetic. "Any non-finite" and "any NaN" are tests every target
does exactly.

### 5. The targets

| target | the language's `Float64` | checks it needs | what to watch |
|---|---|---|---|
| evaluator | JS numbers | argument checks for kind 1, overflow checked at each op (it's the reference; late checking is the compilers' freedom) | the same answers as compiled code, by I111's agreement test |
| JS | doubles | `d !== 0` before `/`, `x >= 0` before `sqrt`, a finiteness test at branches and boundaries | the checks are one compare each and well predicted |
| WASM | `f64` | the same, `f64.abs` + `f64.lt` for finiteness | NaN payloads aren't deterministic; we don't use them |
| C | `double` | the same | **never** compile with `-ffinite-math-only` or `-ffast-math`: they let the C compiler delete our finiteness tests. We do the folds ourselves |
| shaders (f32) | `f32` | none for kind 2 | WGSL may assume no ∞ or NaN at all (its finite-math assumption), which is this type exactly. A GPU can't abort, so an overflow there is lost, as a stack overflow would be; the CPU fallback reports it. Kind 1 must be handled inside the shader (`otherwise`), which is already the rule for any `Choice` on the GPU. Under `Float32`, overflow comes at 3.4e38, part of that representation being approximate |

The cost is a handful of compares per function, in exchange for removing
#834's tracking and keeping staging's folds. In a Clifford product, where
the folds matter, there are no divisions at all, so no checks.

### 6. What it means for the rest

- **Staging (I107).** `0 · x → 0` and `x + 0 → x` become the type's laws.
  #834's `x − x` tracking isn't needed. Ersagun's "strong zero" pick
  (2026-11-01, on the Compiler lane's card) is what this type gives, with
  none of the per-multiply checks that made the lane withdraw it.
- **Relations and search.** `x ÷ 0` having no answer for `Float64` matches
  fractions and `Int`. `solve` already skips points with no answer (the
  `0·x = 0` rule, BACKWARDS.md); now Float64 equations can't wander into
  NaN either.
- **`equal`, `compare`.** No change in behaviour (−0 is 0 already, and
  NaN can't occur); the NaN case in `compare` can go.
- **`Fixed`'s trig.** FIXED-POINT.md made `log(x ≤ 0) = 0` because Trig
  "cannot refuse". With `Choice` on `log` it can refuse, for every type.
- **Foreign values.** A float from the host (JSON, `hosts/js.js`, a byte
  buffer) is checked once on entry: non-finite is `none`.
- **Naming.** `Float64` keeps its name (WHAT-NUMBER-MEANS.md): the values
  are a subset, the width is still 64. We don't call it `Real`, which
  EXACT-REALS.md keeps for exact reals.

## Alternatives, and why not

- **Keep full IEEE** (today, with #834). Honest about the hardware, but the
  type's laws stay false, and every optimisation needs a "known finite"
  analysis around it. It also leaves `Float64` the one number type where
  `1/0` is a value.
- **Strong zero everywhere on IEEE** (0 · x = 0 even for ∞). Makes one law
  true by adding a check to every multiply, and leaves the others broken.
- **A finite type beside an IEEE type** (`Finite` and `Float64`). Two
  types with the same operations for one idea, and the IEEE one would be
  the default people reach for. `Extended a` covers what IEEE adds that's
  worth having, for every number type.
- **Saturate instead of failing on overflow**, as posits do (the biggest
  number instead of ∞). Silent, and wrong answers that look plausible are
  worse than an abort.
- **A fast-math mode** (Zig's per-scope float mode, C's flags). A mode
  makes the same code mean two things; the two-landscapes rule says no.

## Prior art

- **Rust's niche optimisation** (prior art for §4): an enum stores its tag
  in bit patterns its payload can't have, so `Option<&T>` and
  `Option<NonZeroU32>` are as big as what they wrap. Swift's "extra
  inhabitants" are the same idea. Using the NaN space of a double for other
  things is NaN-boxing, from JavaScript engines and LuaJIT.
- **Posits and unums** (John Gustafson; prior art for §1): posits have one
  zero, no infinities, and a single exception value, NaR ("not a real"),
  the same value set this note proposes for `Float64`, arrived at for
  hardware reasons.
- **William Kahan's "Branch Cuts for Complex Elementary Functions, or Much
  Ado About Nothing's Sign Bit" (1987)** (influence on §3): the case for
  signed zero, and the conventions for branch cuts when the sign isn't
  there. We take the conventions and decline the sign.
- **Julia** (prior art): `==` follows IEEE while `isequal` makes NaN equal
  to itself and tells −0 from 0, two equalities for the problem our
  `equal`/`compare` patch. Julia's `false` is a "strong zero"
  (`false * NaN == 0`), the behaviour Ersagun picked for `0 · x`.
- **Haskell's imprecise exceptions** (Peyton Jones, Reid, Hoare, Marlow and
  Henderson, 1999) (influence on §2): pure code that fails promises that it
  fails, not where, which is what lets an overflow be checked late.
- **Liquid Haskell's refinement types and Idris** (prior art for §2): a
  divisor proved nonzero, `{v:Double | v /= 0}`. We want the inference
  without the annotation.
- **Zig** (`@setFloatMode`): fast-math scoped to a block; the alternative
  we reject above.

## Steps (BACKLOG L125)

Decided 2026-11-01; L125a goes first.

1. **L125a** `Float64` means finite with one zero, in LANGUAGE.md and
   NUMBERS.md; the evaluator fails on overflow, and `/`, `sqrt`, `log`,
   `asin`, `acos`, `^` get `Choice` at the bad arguments; −0 made
   canonical in `show`, `atan2`, `sign`. Examples updated where they divide
   (L, M).
2. **L125b** the inferred "can't be zero / can't be negative" fact that
   drops the `Choice` and the check (L, M).
3. **C: L125c** compiled JS, WASM and C: argument checks, late finiteness
   checks at branches and boundaries, no `-ffinite-math-only`; staging's
   folds kept as laws, #834 closed; a test that overflow and `x / 0`
   give the evaluator's answers (C, M).
4. **L125d** `Extended a` in the library with `<`, `+ − ·`, `minimum`'s
   identity (L, S).
5. **C: L125e** the niche representations of §4 (`Optional Float64`,
   `Extended Float64` in one f64), and a local `Choice` on Float64 compiled
   to a test instead of a handler (C, M).
6. **L125f** host values checked on entry (`hosts/js.js`, JSON, bytes) (L, S).

## Decisions (both taken 2026-11-01, as recommended)

1. **Does `Float64` become the finite floats with one zero, with ±∞ moved
   to `Extended a`?** Recommended: yes. It makes the type's laws true,
   gives the strong zero for free, and stores as cheaply as today.
2. **What does `x / 0` do on `Float64`?** Recommended: no answer
   (`Choice`), as `Int` and fractions already do, with the compiler dropping
   it where it can see the divisor isn't zero. The alternative is an abort,
   which keeps types shorter but turns a case the program should handle
   into a crash.
