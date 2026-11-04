# Resources that live only inside their handler (L192)

Design note, 2026-11-03. BACKLOG L192, from ASPECTS-2026-11-03 items 97
("cleanup on failure") and 123 ("deterministic destruction"). It answers the
"resource misuse (leaks, use after close)" row of LANGUAGE.md's error table,
which said "not addressed".

## Where this stands

Today Ters has no resources to misuse. `read file`, `write file`, `add to
file` and `fetch text` each take a path or a URL and do the whole job in
one operation: the host opens, reads or writes, and closes inside it. A
program never holds an open file, so it can't leak one or use one after it
is closed. The row was "not addressed" because nothing needed addressing
yet.

That changes with the rows that are coming: reading a large file in pieces
(L189 `Bytes`), a socket that stays open (L191), an audio device a sound
keeps (AUDIO.md), a database connection. Each needs something open across
several operations. This note fixes how that looks before the first one is
built, so they all come out the same.

## The rule

**A resource is a handler, never a value.** Opening a resource is entering
a handler; the operations on it are the handler's operations; closing it is
the handler ending. There is no handle the program can keep, put in a list
or return, so there is nothing to leak and nothing to use after closing.

```
with open file("log.txt") do
  write line("started")
  write line(show(count))
```

`with open file(path) do body` runs `body` with `write line` and `read
line` answered by that file. When `body` ends, however it ends, the file is
closed. Outside `body`, `write line` isn't answered by anything, and the
effect row says so: the checker refuses a `write line` with no handler, as
it refuses any unhandled operation today.

This is the existing machinery and no new kind of node. A resource handler
is a stateful handler (L16's `with state` is one) whose state is the
host's handle, plus a release. It needs two things the handlers don't have
yet, below.

## What handlers need

### 1. A release that runs on every exit

A handler today has a `value` case for when its body ends normally. A body
can also end by `Abort` (a failure nothing inside handled), by the stop no
handler catches (a Float64 overflow, L166), or by running out of fuel. A
resource must be released on all of them.

So a handler gets a **release** case: a body of its own, with the
handler's state in scope, run once when the handler ends, by any exit. It
runs after `value` on a normal end, and on its own otherwise. A release
may use only effects that can't fail or wait (`Log`, the host's own close),
so releasing can't itself need a release. That is a row the checker
already knows how to check (a named row, like `PAGE_HANDLER`).

Several resources open at once release in the reverse order they were
opened, which is the order their handlers end. They are written one after
the other (adjacent `with` clauses in one block, which the text view
flattens), not nested by hand, though the meaning is nesting.

### 2. Two of the same resource at once

`with open file("a") do with open file("b") do write line(...)`: which
file gets the line? With one effect named `File`, the inner handler takes
it, and the outer file can't be reached. Copying a line from one file to
another needs both.

The answer is a **name for the handler**, bound where it is entered:

```
with open file("a") as source do
  with open file("b") as target do
    write line(target, read line(source))
```

`source` and `target` are binders like a `let`'s, with the scope of their
handler's body. An operation given one is answered by that handler. A
function that uses `source` carries `File source` in its effect row, so a
function made inside the body and handed out of it carries a row naming a
binder that is no longer in scope. That is a scope error, which the
checker already reports for a variable moved out of its case (LANGUAGE.md's
"variable out of scope" row). So the name can't escape either, without a
new check: escaping is being out of scope.

A name is not a value. It can't go in a list or a field (a field's type
would have to mention it, and a type can't mention a binder), which is what
keeps "a resource is never a value" true.

## How it fits what is already decided

- **Choice.** World effects don't run while a `Choice` is open (LANGUAGE.md,
  "The world and Choice"). A file is a world resource, so it is never open
  on a search path that could be abandoned or resumed twice. Multi-shot
  resumption, the usual trouble with handlers and resources, never meets a
  resource.
- **Answered later** (ANSWERED-LATER.md). An operation answered at most once,
  later, inside a resource's handler is answered before the handler ends,
  or the handler's end answers it with no answer (the ticket's `Choice`).
  A release never waits on a ticket.
- **Pages and sounds.** A page's socket or a sound's device lives as long
  as the page or the sound. The page runtime and the sound runtime are the
  handlers; their release runs when the page is closed or the sound
  stopped. Nothing new for the program.
- **Targets.** The release is a `finally` on JS and WASM's host side, a
  cleanup label on C. A target's kinks (a GC'd JS stream, a C `FILE *`) stay
  in the host (TWO LANDSCAPES: the targets' weirdness never dents the
  language).
- **Ports.** A resource's operations are ports like any effect's, so the
  graph editor shows `with open file … as source` as a node whose body is
  inside and whose name is a port the body's nodes wire to.

## What it costs and what it doesn't do

- It doesn't manage memory. Values are still immutable and collected; this
  is only about things the host must close.
- A resource can't outlive the handler that opened it. A pool, or a
  connection kept across a program's whole run, is a handler around the
  whole program (`main`'s), which is where it belongs.
- Linear or affine types (Rust's ownership, Linear Haskell) would also
  prevent leaks and use after close, and would let a handle be a value.
  They add a second kind of variable to every function type, which Ters
  doesn't want for this one job. Handlers already scope.

## Steps

1. A handler's release case: model, checker (the release's row), evaluator
   and compiled JS. Test: an `Abort` inside the body still runs the
   release, once. Built in the evaluator and the checker (L213a,
   release.test.ts): an arm for std's `release` marker, last among the
   cases; compiled code refuses it for now, and a `with fuel` outside
   running out doesn't release yet.
2. Handler names: `as name` on a handler, operations taking the name, the
   scope error when it escapes. Test: two files open, a line copied from
   one to the other; a function using a name returned from its handler is
   refused.
3. The first resource: `with open file(path)` with `read line`, `write
   line`, after L189 (`Bytes`) for the binary version.
4. LANGUAGE.md's error table row becomes "checked".

Each is its own row when it is picked up.

## Credits (influences)

- Effekt's capabilities, which are second-class so they can't escape
  their handler (Brachthäuser, Schuster and Ostermann, "Effects as
  capabilities", OOPSLA 2020). The closest prior art: our handler names
  are their capabilities, and our "escaping is being out of scope" is
  their second-class rule.
- Koka's named and scoped handlers (Xie, Brachthäuser, Hillerström,
  Schuster and Leijen, "First-class names for effect handlers", OOPSLA
  2022).
- Haskell's `runST`, whose rank-2 type keeps a state thread's references
  from escaping (Launchbury and Peyton Jones, "Lazy functional state
  threads", PLDI 1994), and lightweight monadic regions (Kiselyov and Shan,
  Haskell Symposium 2008), for the same idea with types.
- `bracket` (Haskell), `with` (Python), `using` (C#) and `try` with
  resources (Java), for the release on every exit.
