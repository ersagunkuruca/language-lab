# Foreign definitions: a program's own effect, answered by the host

**Status (2026-11-01).** BACKLOG L69 (from LANGUAGE-NEEDS-2026-10-24
§5). L69a's evaluator half is built (src/lang/hosts.ts, test/hosts.test.ts):
`lab run` and `lab test` load `hosts/js.js` beside the program, an
operation of the program's own effect that nothing handles is answered
by the host function under its id, the answer is checked against the
operation's result type (Int, Float64, Text, Bool, Unit, lists and
records of them), and a missing or wrong answer is an Abort with the
reason. `lab hosts` prints the skeleton. A host answers at once for now;
one that answers later (a promise) waits for L59. Left in L69a: the
compiled JS. One question for Ersagun at the end; nothing before L69a
waits on it.

A website needs the browser's APIs, a phone app the device's (camera,
storage, notifications), a command-line program the environment's. Today
every one of them is a builtin added to std.ts by hand, with a record per
target in `compiler/src/builtins.ts` (L7). A program can't add its own.

## What already exists

- **Every builtin is a record with a side per target** (L7): its
  JavaScript, its scalar operation for WebAssembly and WGSL, or why a
  target has none (`no("acts on the world: a shader has none")`).
- **The world's effects are std types with operations** (L55, HOSTS.md):
  `Console`, `Files` and `Network` are declared like `Random`. Calling
  `print` is performing `Console.print`. A program may handle it with a
  `match` (a test collects what was printed); whatever nothing handles
  goes to the runtime, which answers it (run.ts `unhandled`, runtime.js).
- **So a host is already the outermost handler.** What it handles is a
  row, and the row says what a definition may ask of the world.

## The idea

A foreign definition is **an operation of an effect the program declares
itself**, whose outermost handler is written in the target's language
instead of in ours:

```
effect Camera = take photo(width: Int) → Text | has camera() → Bool
```

`take photo` is then an ordinary operation. Its type, with `Camera` in
the row, is checked like any other, and a program or a test may handle
`Camera` with a `match` (a fake camera giving a fixed picture, as a data URL). What
nothing handles goes to the host, as `print` does today. The one new
thing is where the host finds its answer: a file beside the program, one
per target, that answers the effect's operations by their ids:

```
examples/photos/
  code.json  names.default.json  comments.json
  hosts/js.js     export default { "<take photo's id>": async (width) => … }
  hosts/c.c       lab_text host_<id>(int64_t width) { … }
```

So nothing in the language changes: no new node kind, no `@external`
annotation, no second way to call a function. An effect and its
operations are what HOSTS.md already made of `Console`. This keeps
Ersagun's two-landscapes rule: how JavaScript or C answers is the host
file's business, and the language only ever sees an effect.

Gleam's `@external(javascript, "./camera.mjs", "take")` is the closest
prior art: one declaration, a body per target, any of which may be
missing. Here the declaration is the effect, and the body per target is
the host file's entry.

## Rules

1. **Keyed by id, not by name.** A host file names an operation by its
   id, so renaming or translating `take photo` changes nothing (names are
   presentation, as everywhere else). `lab hosts <program>` prints a
   skeleton host file with each operation's id, name and type in a
   comment, to start from.
2. **Checked at the border.** What a host gives back is checked against
   the operation's result type before the program sees it (Elm's ports
   do this for what comes in from JavaScript). A wrong answer is
   performing `Abort` with the reason, never a value of the wrong type
   inside the program. A `Float64` must be finite: NaN or ±∞ from the
   host is a wrong answer too (L125f). Inputs going out need no check:
   the checker already typed them.
3. **A missing side is a refusal, with the reason.** A program whose
   `Camera` has no `hosts/c.c` entry doesn't build for C, and says which
   operation and why, the way the scalar profile says a builtin isn't in
   WebAssembly yet. A shader has no host, so a definition whose row has a
   foreign effect isn't drawn on the GPU (as `print` isn't today).
4. **The evaluator is a host too.** It runs in JavaScript, so it answers
   with `hosts/js.js`. The editor shows a definition that performs a
   foreign effect with no JS side as "needs its host" rather than
   running it.
5. **The row is the promise.** An operation's row is what the program
   says about the outside world, so a foreign effect is the programmer's
   word, not the checker's. LANGUAGE.md's guarantee table says so in its
   own line.
6. **Backwards.** Like every world effect, a foreign operation doesn't
   run backwards, and isn't performed while a `Choice` is open (the rule
   effects.test.ts already checks for `Console` and `Files`).

## What std's own builtins become

Nothing, at first. Arithmetic, text and lists stay builtins: the
compiler needs to see `+` to fold it, vectorise it and print it as one
instruction. Only the world's operations (`print`, `read file`, `fetch
text`) are hosts in this sense already, and they could later move to
std's own host files (`std/hosts/js.js`), so that std and a program
answer their effects the same way. That move is optional (L69d).

## Steps

| step | what | lane | size |
|---|---|---|---|
| L69a | An effect's unhandled operations answered from `hosts/js.js` in the evaluator and the compiled JS, results checked at the border; `lab hosts` writes the skeleton | L | M |
| L69b | The same from `hosts/c.c` for native C, and WebAssembly imports from `hosts/js.js` | C | M |
| L69c | The editor: "needs its host" on a definition whose host side is missing; the host file shown read-only in the Program tab | E | S |
| L69d | Optional: std's world operations move to std's own host files | L | M |

## The question for Ersagun

**May a foreign operation be declared pure?** A host's fast hash, or a
JavaScript library's date parser, is a function, not an act on the world.
As an effect, every caller carries it in its row until something
handles it, and nothing in the program can. Two ways:

1. **Keep it in the row (recommended to start).** Honest and simplest: a
   foreign answer is always an effect, and `main`'s row shows every
   foreign call. A pure host function used in a few places costs a longer
   row.
2. **A `pure` mark on the effect type.** The checker then drops it from
   rows, as Gleam and Haskell's `unsafePerformIO` trust the programmer.
   Rows get shorter, and the guarantee table gains a line saying the
   language takes the program's word.

L69a doesn't depend on the answer: option 2 is one flag added later.

## Prior art

- Gleam's `@external` (one declaration, a body per target, any missing).
- Elm's ports (what comes in is checked at the border).
- Koka's `extern` with a body per backend (C, JavaScript).
- Unison's abilities and Eff's handlers: the runtime as the outermost
  handler of what a program asks for.
- Haskell's `foreign import` and `unsafePerformIO`, for option 2's trust.
