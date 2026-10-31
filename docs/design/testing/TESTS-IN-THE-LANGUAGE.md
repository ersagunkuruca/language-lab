# Tests in the language (T7)

Status (2026-10-31): T7a built: std's `Check`, `lab test`, and small
values (src/lang/tests.ts). The small values come from the types in
TypeScript for now: Float64 from the fixed list below, Int from −3 to 3,
Text, Bool, lists up to three long of the first three of their items,
the program's records and cases from their fields, and a type variable at
Int. Running constructors backwards with relate is still the plan (§2).
T7b built too: `lab test` reads accepted answers from `examples.json`
in the form below (the older form, a bare list of inputs, still reads as
inputs with no answer) and checks any definition that has one, compared
as printed. T7c's local half is built: `lab test` keeps each result in
`.lab/checks.json` under the key below and skips a test whose key is
kept (cli/checks.ts; `--fresh` runs everything). Keeping it in CI's cache,
T7d and T7e are backlog rows.

[TESTING.md](../../process/TESTING.md) §6 sketched three ideas: accepted answers, laws as
definitions, and re-checking only what changed. This note makes them a
design. It keeps the project's rules: one system with no special node
kinds, tests that speak only in values, so they never pin an
implementation, and the target's quirks staying out of the language.

## The idea in one paragraph

A test is an ordinary definition that performs `Check`, a std effect with
one operation, `expect(holds, what)`. Who handles `Check` decides what a
failure means: the editor shows it on the definition, `lab test` prints
it, and CI fails the run. The values a test runs on come from the same
two places the editor already uses, the saved inputs in `examples.json`
and small values of each input's type, which the language enumerates by
running constructors backwards. An answer you accepted in the editor is
the simplest test of all: "for these inputs, this value". Every result is
kept under the hash of what it ran, so nothing is checked twice.

## 1. `Check`, a std effect

```
effect Check
  expect(holds: Bool, what: Text) -> Unit
```

Declared in std the way Random and Console are, so it needs no new
machinery. A definition whose row has `Check` is a test, and its type
says so: `reverse twice : (List Int) -[Check]-> Unit`. Nothing else marks
it: no attribute, no naming rule, no folder.

- `expect(false, "…")` doesn't stop the test. The handler collects every
  failure, so one run reports them all (as `pytest-check` does, and unlike
  `assert`).
- A test may do Choice too: `x = one of(…)`, then `expect(…)` is checked
  on every path, and a failing one reports the values its path chose.
- A test may not do world effects (Console, Files, Network, Time,
  Random). They run under the handler that a test's caller gives, so a
  test of a printing function handles Console itself and expects on what
  was printed, as [HOSTS.md](../relations-and-effects/HOSTS.md) already allows.

## 2. Where a test's inputs come from

A law has inputs: `reverse twice(xs) = expect(reverse(reverse(xs)) =
xs, "reverse twice is the list")`. The runner fills them from:

1. **Saved inputs.** `examples.json` already keeps values per definition
   for the editor's Run. A test's own saved inputs are used first, as
   given.
2. **Small values.** For each input type, every value up to a size: lists
   up to length 4, Ints from −3 to 3, a Float64 from a fixed short list
   (0, 1, −1, 0.5, 1e-9, 1e9, plus ∞, −∞ and NaN only when the test asks),
   and records and cases built from those. The enumerator is the language
   running a constructor backwards with a size budget, the way relate
   already enumerates (BACKWARDS.md), so a program's own types get
   values with no code. This is SmallCheck's design (Runciman, Naylor and
   Lindblad, 2008): exhaustive and small rather than random, so a failure
   is the smallest one and the same on every run. The budget is about 200
   cases a test, to keep a check under a second.
3. **No randomness.** QuickCheck's random inputs (Claessen and Hughes,
   2000) are left out on purpose: a test whose result can change between
   runs can't be cached by hash (§4).

A function input (`f: Float64 → Float64`) takes its values from the
definitions of that type in the program and its library, which is what
the editor's Run already offers since #703.

## 3. Accepted answers

An accepted answer is a value and the inputs it came from, kept with the
definition's saved inputs:

```json
"n7m8dbevtqo7s1h07idtb8fuhl": [
  { "inputs": ["2", "[1, 3]"], "answer": "[1, 2, 3]" }
]
```

The old form, a list of input texts, still reads as inputs with no
answer. The answer is the printed value (`show any`), which is in the
language's own terms, so it doesn't depend on how a list was stored or
which target ran it. Accepting is a click in the editor's Run: a tick
when today's answer is the same, the two values side by side when it
isn't, and a button to accept the new one. Prior art: expect tests (Jane
Street's `ppx_expect`) and snapshot tests (Jest). An accepted answer is a
test without the word: the runner treats it as `expect(f(inputs) =
answer, …)`.

## 4. Re-check only what changed

A result is kept under one key: the content hash of the test's
definition and everything it uses, which is the recipe `library/build.ts`
already hashes published modules with, plus the hash of the evaluator's
own build. Same key, same result, so the check is skipped. This is
Unison's cached test results.

- **Locally**, results live in `.lab/checks.json`, which isn't committed
  (built). Only a test whose row is Check, search, Abort or divergence is
  kept; one that reads the clock, random numbers or the world isn't. The
  evaluator's hash is that of its source files.
- **In CI**, `lab test` runs only tests whose key isn't in the Actions
  cache. CI's cost stays near zero when nothing a test uses changed,
  which fits the budget rule (ci-cost).
- **In the editor**, a save re-checks the dependents of what changed, so
  a broken law shows on its definition at once.

## 5. What runs a test

`lab test <program>` runs every test and accepted answer in the program
with the evaluator, and prints each failure with its values. With
`--compiled` it runs them compiled to JS too, and the two must agree.
That one flag replaces most of the TypeScript sweeps that compare the
evaluator with compiled JS.

## 6. What it replaces and unblocks

- **Example sweeps.** "Every example's main gives the same answer both
  ways" becomes an accepted answer per example plus `--compiled`.
  `test/agreement.test.ts` becomes laws: `inverse(f, f(x)) = x` over small
  values. The TypeScript harness that runs `lab test` over every example
  stays, and is about ten lines.
- **L108d**, representation laws: for each representation, the compiler
  writes the law `job(meaning(x)) = meaning(job′(x))` as a test definition,
  and the same runner checks it with small values of the stored type.
- **L97e**, the complex laws: `polar` and `unpolar` round trips as tests in
  the prelude (built: the prelude's first laws, run by
  test/prelude-laws.test.ts).
- **The library checks itself.** Prelude laws (`append` associative,
  `sort` sorted and a permutation) ship as definitions, cached like the
  rest.

## Steps

| step | what | lane | size |
|---|---|---|---|
| T7a | `Check` in std, the small-values enumerator, `lab test` in the evaluator | L | M |
| T7b | Accepted answers in `examples.json`, read and checked by `lab test` (built) | L | S |
| T7c | Results cached by hash, locally (built) and in CI | L, T | M |
| T7d | The editor: a tick or the difference on Run, and an accept button; a failing law shown on its definition | E | M |
| T7e | Example sweeps moved to accepted answers and laws; `--compiled` | T | M |

## Open questions

None needs deciding before T7a. Two can wait for use:

- Whether a law in a published module runs when a program that uses the
  module is checked, or only when the module is published. This note says
  only at publishing, because its hash doesn't change after that.
- The small-values budget for Float64. The fixed list above is a guess,
  and the first laws will show whether it finds the bugs.

## Prior art

- Expect and snapshot tests: Jane Street's `ppx_expect`, Jest snapshots.
- SmallCheck (Runciman, Naylor and Lindblad, "SmallCheck and Lazy
  SmallCheck", Haskell Symposium 2008): exhaustive small values.
- QuickCheck (Claessen and Hughes, ICFP 2000): laws as properties. Its
  random inputs are left out here on purpose (§2).
- Unison: test results cached by the hash of the code they ran.
- Algebraic effects as the test harness: Koka's and Eff's handlers. The
  handler decides what a failure means.
