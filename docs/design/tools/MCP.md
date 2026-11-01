# The Ters MCP server

*Status 2026-11-01: built: read tools (#853), edits and eval (this PR).*

An LLM reads, changes, runs and tests a Ters program through the
[Model Context Protocol](https://modelcontextprotocol.io). It is also how we
find out what working on Ters is like for an LLM.

    lab mcp [program]        # or: node projectional/mcp/server.ts [program]

For Claude Code: `claude mcp add ters -- node /path/to/projectional/cli/lab.ts mcp`.

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
- `…` is a block left out: with no `depth`, the view is as deep as fits 40
  lines; `view` the id to open it.

Uses of a name show the name alone: it is bound once, with its id, in sight.

## Tools

| tool | does |
|---|---|
| `open(path)` | open a folder or saved file; lists its definitions |
| `defs(filter?, library?)` | id, name, type of each definition; ✗ marks errors |
| `view(at, depth?)` | a definition or one block of it |
| `check()` | type errors, or ok |
| `run(entry?, args?, input?)` | run main (or an action, a value, a page); output and exit code |
| `test()` | definitions that perform Check, and accepted answers |
| `eval(text)` | the value of an expression, with its type |
| `replace(at, text, find?)` | a part becomes an expression written as `view` prints it; `□` makes a hole |
| `step(at, name, value)` | a step `name = value` before a part |
| `split(at, on, find?)` | a part becomes a match on a variable, one case per variant |
| `rename(at, name)`, `comment(at, text)` | side tables only; uses follow the id |
| `define(name, kind, params?)`, `add_input(at, name)`, `remove(at)` | definitions |
| `undo()` | the last edit |

`find` picks a part inside `at` by its text, copied from `view` (the `#id`s
in it are ignored, `*` reads as `·`). Each edit is one of the editor's own
gestures (`editor/typed.ts`, `src/lang/toplevel.ts`); it is kept only if the
program has no more type errors than before, then saved, and the answer is
the changed lines of the definition or the reason it was refused.

Program output goes into the answer, never to the server's own stdout (the
protocol). A run is stopped after 20 million steps.

## Next

A write-up of trying it on Tumble as an LLM, and the friction found, as
backlog rows.
