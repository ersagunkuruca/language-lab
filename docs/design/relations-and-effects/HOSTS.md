# Hosts as handlers: named rows and the world's effects in std

**Status (2026-10-31).** Built (Ersagun agreed 2026-10-31): L55 #709, L58.
L58 named View, Handler and Sound, the rows written in std's types. Main
and a sound's maker stay ledger entries, since no type spells them. This note covers BACKLOG
L58 (named rows for the hosts) and L55 (Console, Files and Network declared
in std). Both come from EFFECTS-REVIEW-2026-10-24.md §2.2 and §2.6, whose
single idea is: **a host is the outermost handler, and what it handles is
a row.** Nothing here changes what a program may do. It changes where the
rules are written and who can see them.

## Where things stand

- **Two kinds of effects.**
  - Choice, Diverge, Console, Files, Cells, Update and Network are bare ids
    with no operations (types.ts). Their actions are builtins, such as
    `print`, `read file` and `fetch text`.
  - Abort, Log, Random, Time, Wait and a program's own effects are declared
    in std as types with operations. A `match` handles them. Whatever
    nothing handles goes to the runtime (`unhandled` in run.ts: Log to
    standard error, Random to the platform).
- **So a test can't fake the world.** A test can fix the clock with
  `match … | now() → 0`. It can't collect what a function printed, and it
  can't give `read file` a fake file.
- **What each host allows is hidden in TypeScript.** Five closed rows are
  written in std.ts and run.ts through the ledger's `discharge`: a view,
  a handler, main, a sound's block and a sound's maker. `Html`'s text
  field reads `() -[Cells, Diverge, Time, Network, Log]-> Text`. The
  differences between hosts are policy no one can see from the language.
  For example, a handler may use Files but not Wait.

## L55: the world's effects declared like Random

Declare `Console`, `Files` and `Network` in std as effect types whose
operations are today's builtins:

```
effect Console = print(Text) → Unit | print error(Text) → Unit
               | read line() → Optional Text | read input() → Text
effect Files   = read file(Text) → Text | write file(Text, Text) → Unit
               | add to file(Text, Text) → Unit | file exists(Text) → Bool
               | list folder(Text) → List Text
effect Network = fetch text(Text) → Text
```

- The ids stay the same (`effect.console`, and so on), so every row, every
  ledger line and every type a program shows is unchanged.
- Calling `print` is performing `Console.print`. Unhandled, it goes to the
  runtime, as Random does today: run.ts `unhandled`, and the compiled
  JS's runtime.js, which already answers `random()` and `now()` this way.
  The WASM and C runtimes need the same cases. How they answer Random today
  is to be checked before building.
- What it buys: a test handles `print` with a `match` and collects the
  lines, and a program can give `read file` a fake file. Once there is a
  tests-in-the-language (T7), this is how a test is written.
- Cost: every target's runtime gains a case per operation, as for Random. The type checker's "a function that acts can't be
  run backwards" rule doesn't change.
- Only Choice and Diverge stay built in, because they are about how a
  computation runs, not what it asks the world for.

## L58: named rows

A row definition in std, one per host:

```
row View    = Cells, Diverge, Time, Network, Log
row Handler = Cells, Update, Console, Files, Abort, Diverge, Time, Network, Random, Log
row Main    = Console, Files, Update, Cells, Diverge, Network, Log, Abort, Random, Time, Wait
row Sound   = Cells, Update, Random, Diverge
row Making sound = Cells, Diverge
```

- `Html` and `Attribute` name them in their field types, so a view's type
  reads `() -[View]-> Text`. The checker expands a named row where it is
  written.
- **Shown by name only where it was written by name.** The type printer
  doesn't guess names from a set of effects. `{Cells, Diverge}` is also
  the row of `read`, and calling that "Making sound" would be wrong. So a
  row type carries the name it came from, and loses it once anything
  joins it.
- The ledger's table becomes these definitions. `discharge` reads them
  instead of keeping its own lists, and LANGUAGE.md's table is generated
  from std as it is now.
- **The model question.** This needs one new node kind, `row` (a
  definition whose body is a list of effects), or a flag on `typedef`. The
  editor must draw it in the library view. Hashing treats it like a
  typedef: a row's hash is its effects' hashes.
- Prior art: Koka's effect aliases (`alias io = <console, fsys, net, …>`)
  name a row once and use it in types. Credit them in CREDITS.md when
  built.

## Order

1. L55 first. It is self-contained and makes tests able to fake the world.
2. Then L58. Its rows then name only std effects, all declared the same
   way.

Ersagun decides whether to build either. Each is one PR.
