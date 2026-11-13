# The Ters MCP server

*Status 2026-11-01: built: read tools (#853), edits and eval (#855), search and folded cases (this PR).*

An LLM reads, changes, runs and tests a Ters program through the
[Model Context Protocol](https://modelcontextprotocol.io). It is also how we
find out what working on Ters is like for an LLM.

    ters mcp [program]        # or: node ters/mcp/server.ts [program]

For Claude Code: `claude mcp add ters -- node /path/to/ters/cli/ters.ts mcp`.

## Principles

- **Terse.** A tool answers with what was asked: text, a diff, an error. The
  one explanation is the server's `instructions`, three lines, sent once.
- **Ids, not text positions.** Programs have no text syntax; the text an LLM
  reads is a view, and everything it points at is an id.
- **Short ids.** A 26-character id is shown as the shortest prefix (4 or more)
  no other node of the program shares. Any unique prefix is accepted, and a
  definition's name works wherever an id does.
- **Same view as the editor.** `view` prints the blocks text (the walk the
  editor's Blocks pane draws, `render.ts blocksOf`) with ids put back in.

## A first program

    define(name: "main", kind: "function")          # no params: main takes nothing
    replace(at: "main", find: "□", text: "print(\"hello\")")
    run()                                           # hello

- **main** is a function with no inputs (or one, `List Text`, for the
  command line's arguments). `run()` runs it; `run(entry)` runs another
  action of no inputs.
- **Names with spaces** are written between `‹` and `›` where they're used:
  `‹word count›(text)`, `‹range from›(1, 21)`. `define` and `rename` take
  the name plain, `word count`; `at` takes either.
- **Text** is the expression the view prints: `=` is equality, `≠` reads as
  `not (a = b)`, `if c then a else b`, `(x) => x + 1` a function. A body of
  steps goes on the lines after a `=>`, one `name = value` a line and the
  result last:

        all(() =>
          a = one of(range from(1, 21))
          b = one of(range from(a + 1, 21))
          if a < b then [a, b] else fail())

- **step** adds the same steps one at a time: `step` at the hole after the
  last step puts the new one after it, so each can name the ones before.
- **A test** is a definition that performs Check: a function with no
  inputs whose body is `expect(‹word count›("a b") = 2, "two words")`. `test()` answers `✓ name (1 case)`:
  a case is one run, of each accepted answer and of each set of inputs it
  was tried with (a test with inputs is tried with several).
- **eval** of a definition's name gives its value: `eval("triples")`.

## The view

    n26s  cascade#n26s : (Board) -[Animate, Diverge]-> Board
          cascade#n26s(board#uaqd) =
    c7te    if settled(board)
    ir3f      then board
    oi40      else
    mqgt        cleared#niee = animate(cleared, clear(board))
    s6h6        …

- the gutter is the id of the block that starts on that line;
- `name#id` is where a name is bound (definitions, inputs, lets, fields, cases);
- `□#id` is a hole;
- `ab12 otherwise is: fell, filled` under a match: cases that read the same
  are shown once, as otherwise (as the editor does);
- `…` is a block left out: with no `depth`, the view is as deep as fits 40
  lines; `view` the id to open it.

Uses of a name show the name alone: it is bound once, with its id, in sight.

## Tools

| tool | does |
|---|---|
| `open(path)` | open a folder or saved file; lists its definitions |
| `defs(filter?, library?)` | id, name, type of each definition; ✗ marks errors |
| `view(at, depth?)` | a definition or one block of it |
| `search(text)` | the smallest parts, in every definition, whose text contains it, with ids |
| `check()` | type errors, or ok |
| `run(entry?, args?, input?)` | run main (or an action, a value, a page); output and exit code |
| `test()` | definitions that perform Check, and accepted answers |
| `eval(text)` | the value of an expression, with its type |
| `replace(at, text, find?, case?)` | a part becomes an expression written as `view` prints it, or as the keyboard writes it (GUIDE.md, "Text you can type": `=` for equality, `*` for `·`, `‹two words›` for a name with spaces, steps on lines); `□` makes a hole; `case` picks one case of a match |
| `step(at, name, value)` | a step `name = value` just before the step a part is in: at a hole after `a = …`, after `a`, so steps are added top-down, each naming the ones before; at a definition, first in its body |
| `split(at, on, find?)` | a part becomes a match on a variable, one case per variant |
| `rename(at, name)`, `comment(at, text)` | side tables only; uses follow the id |
| `define(name, kind, params?)`, `add_input(at, name)`, `remove(at)` | definitions |
| `pin(at, off?)` | a definition's type held as it is now (signatures.ts), so edits inside keep it and a body can rely on its inputs' types; a folder keeps pins in signatures.json, which `ters` reads too (L173c) |
| `undo()` | the last edit |

`find` picks a part inside `at` by its text, copied from `view` (the `#id`s
in it are ignored, `*` reads as `·`). Each edit is one of the editor's own
gestures (`editor/typed.ts`, `ters/src/lang/toplevel.ts`); it is kept only if the
program has no more type errors than before, then saved, and the answer is
the changed lines of the definition or the reason it was refused. An edit to
an otherwise that stands for several cases is made in each (the editor's
`sameEverywhere`); `case` changes just one.

Program output goes into the answer, never to the server's own stdout (the
protocol). A run is stopped after 20 million steps.

## Next

A write-up of trying it on Tumble as an LLM, and the friction found, as
backlog rows.
