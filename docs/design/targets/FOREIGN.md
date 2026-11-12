# Foreign definitions: a program's own effect, answered by the host

**Status (2026-11-06): done** (BACKLOG L69 closed; see DONE.md). BACKLOG L69 (from LANGUAGE-NEEDS-2026-10-24
§5). L69a's evaluator half is built (src/lang/hosts.ts, test/hosts.test.ts):
`ters run` and `ters test` load `hosts/js.js` beside the program, an
operation of the program's own effect that nothing handles is answered
by the host function under its id, the answer is checked against the
operation's result type (Int, Float64, Text, Bool, Unit, lists and
records of them), and a missing or wrong answer is an Abort with the
reason. `ters hosts` prints the skeleton. A host answers at once for now;
one that answers later (a promise) waits for L59. Compiled JavaScript
does the same (L69a2): the module imports `hosts/js.js` and the runtime's
`$perform` answers from it with the same border checks, and `ters compile`
bundles it in. A page does too (L69a3): `ters build-web` and `ters build-app`
bundle the program's `hosts/js.js` into the page's script. A page's main
may ask the host while it builds the page; its views and handlers may
perform only the page's own effects (Cells, Time, …), so asking a host
from a view is refused until a row lets it. One question for Ersagun at the end; nothing before L69a
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
   presentation, as everywhere else). `ters hosts <program>` prints a
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

## In a native program (L69b1)

`ters native` reads `hosts/c.c` beside the program and puts it in the C
file. Each operation is a C function named by its id, `host_<id>`, and
what crosses is C's own:

| in the program | at the host |
|---|---|
| `Int` | `int64_t` (an Int too big for it is an Abort before the call) |
| `Float64` | `double` (NaN or ±∞ given back is a wrong answer) |
| `Text` | `const char *`: the program's copy, freed after the call; one given back is copied, so it may be the host's own (NULL is a wrong answer) |
| `Bool` | `int`, 0 or 1 (anything else given back is a wrong answer) |
| `Unit` | `void`, given back only |

A host fails by calling `lab_host_fail(reason)`; the program sees an
Abort, "the host's ‹name› failed: ‹reason›", as it does for a wrong
answer. Lists and records don't cross to C yet. An operation with no
`host_<id>` in the file is a refusal to build that names it, and
`ters hosts <program> --c` prints a file with each one, to start from.
A native Android app (`ters build-native-app`, C204) takes hosts/c.c the
same way, and also hosts/android.java: the app's class `Hosts` (package
app.ters.page), a static method `host_<id>` per operation, where what
crosses is Java's own (an Int a long, a Float64 a double, a Text a String,
a Bool a boolean, Unit void). Each operation it answers, and hosts/c.c
doesn't, gets a C `host_<id>` that calls it through JNI, so a program
reaches Android's APIs without writing JNI; `MainActivity.current` is the
app, a Context for them. An exception the method throws is the host
failing, so the program's Abort with the exception as the reason. `ters
hosts <program> --android` prints the class to start from. As on the web,
the page's main may ask the host while it builds the page; its views and
handlers perform only the page's own effects.
In WebAssembly (L69b2) each such operation is an import from "world",
`host:<effect>:<number>`, which `instantiate` answers from the
Runtime's `hosts` (hosts/js.js) through hosts.ts's border, as the
evaluator does; an Int, a Float64, a Text and a Bool cross, and a
function that performs one is partial, so a wrong answer is an Abort
there too. Not yet: L186's log doesn't keep a host's answers, in C,
WebAssembly or JavaScript.

## Asking whether the platform answers an effect (L234)

`supports(() => take photo())` is true when every effect the function
would perform is answered where the program runs: std's own, one marked
pure, one the program handles itself, or one this platform's host file
answers (hosts/js.js by id, hosts/c.c by `host_<id>`). The function is
never run. A program chooses with an ordinary `if`, no directive. Each
command answers it for its platform before checking main against that
platform (src/lang/supports.ts): the answer is written in and the `if`
becomes the branch it takes, so a native build without a camera has no
camera code and isn't refused for it. `ters check` still sees both
branches.

## A view of the platform's own (L235)

A map, a camera's preview or a video call is drawn by the platform, not
by the page. The program declares it as it declares any foreign thing: an
operation of its own effect that gives `Html`,

```
effect Maps = map view(zoom: Int) → Html
```

and the host draws it: hosts/js.js's function for the operation gives a
DOM element. At the border (hosts.ts, shape `view`) anything but an object
is a wrong answer; an element comes in as an `Html` element `ters-view`
carrying it, so the program puts it among other elements, and html.ts
mounts the host's own node in its place (evaluated and compiled pages
alike). Static HTML shows `<ters-view></ters-view>`. A platform with no
such view says so through `supports(() => map view(3))` (L234), and the
page shows something else.

In the Android app the page is C, which can't hold an Android View, so
`ters build-native-app` writes each call of such an operation that
hosts/android.java answers, before anything is checked, as the element
that stands for it (src/lang/native-views.ts): tag `ters-view`, Hosts'
method and the inputs as text, each after U+001F. The shell's `box` sees
the tag, calls the method with the inputs read back as its parameters'
types (long, double, String, boolean) and places the `android.view.View`
it gives (a text saying why, where it can't). The C layout can't ask a
View its height, so the box is as high as the operation's input named
`height` (CSS px), else 240 px, and as wide as its parent. In the iPhone app (`--ios`) the same element names a function of the
program's hosts/ios.m, `UIView *host_…(…)`, whose inputs are int64_t,
double, NSString * or BOOL as the operation's; Screen.m calls it by that
name and places the UIView it gives (cli/ios-app.ts).

## What std's own builtins become

Nothing, at first. Arithmetic, text and lists stay builtins: the
compiler needs to see `+` to fold it, vectorise it and print it as one
instruction. Only the world's operations (`print`, `read file`, `fetch
text`) are hosts in this sense already, and they could later move to
std's own host files (`std/hosts/js.js`), so that std and a program
answer their effects the same way. That move is optional (L69d).

**The clock from a host file (L69d1, built).** std's world operations
are answered by the runner's World (run.ts `World`: Node's, the
browser's, a test's fixed clock), which is std's host already. A
program's `hosts/js.js` may answer one of them in its place, under the
operation's id, as it answers the program's own:

```
export default { "std.time.now": () => 1234 }   // a fixed clock
```

The answer is checked at the same border (a NaN is an Abort with the
reason), and the effect stays in every row: the clock is Time whoever
reads it. Abort and Check are the language's own and never a host's.
The evaluator does this (hosts.ts `stdHosted`), so `ters run` and `lab
test`, which run a program with its own hosts on the evaluator, do; so
does the core IR's JavaScript (core-rt.ts worldFn's `now`, #2016). L69
is closed with this (2026-11-06); std's own host files stay optional.

## Steps

| step | what | lane | size |
|---|---|---|---|
| L69a | An effect's unhandled operations answered from `hosts/js.js` in the evaluator and the compiled JS, results checked at the border; `ters hosts` writes the skeleton | L | M |
| L69b | The same from `hosts/c.c` for native C (L69b1, done), and WebAssembly imports from `hosts/js.js` (L69b2, done) | C | M |
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

**Answered (Ersagun, 2026-11-05): "If it is actually pure, yes. Reading
the clock isn't pure."** So option 2 is allowed, but only for an operation
that is a function of its inputs (a hash, a parser). The clock, files,
the network and randomness stay effects in every row, whoever answers
them, std's World or a host file.

**Built (L69d2).** An effect the program declares may be marked pure
(the typedef's `pure`): its operations are then in no row, answered by
the host as the program's own are, in the evaluator and the core IR's
JavaScript, and a test may still answer them with a match. Each must
give an answer at once (one that never returns, or answers later, is
refused). With no host, asking one is an Abort where it is asked, since
no row said it was needed. LANGUAGE.md's guarantee table has the line.

## Prior art

- Gleam's `@external` (one declaration, a body per target, any missing).
- Elm's ports (what comes in is checked at the border).
- Koka's `extern` with a body per backend (C, JavaScript).
- Unison's abilities and Eff's handlers: the runtime as the outermost
  handler of what a program asks for.
- Haskell's `foreign import` and `unsafePerformIO`, for option 2's trust.
