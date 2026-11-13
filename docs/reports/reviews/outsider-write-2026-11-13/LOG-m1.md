# LOG m1 — word count via Ters MCP server

## Entries
- Read README.md and MCP.md first. MCP.md is terse but gives the tool table; good. (went well)
- `tools` listing: schemas are clear; `define` kind enum and `replace`/`step` examples helped. (went well)
- Finding library functions: grep LIBRARY.md "## Text" gave `split : (Text, Text) -> List Text`, list section gave `keep` (filter) and `length`. Answered exactly. (went well)
- Multi-word name syntax in expressions: `define` answered with `‹word count›#vhi2`, so I guessed I must write `‹word count›(...)` in `replace` text. Worked first try, but MCP.md "The view" section never explains the ‹› quotes or whether a bare `word count(x)` would parse. Typing ‹› is awkward. Severity: papercut.
- Body of word count: `replace at=01if text='length(keep(split(text, " "), (w) => w ≠ ""))'` worked on the first try; type inferred as (Text) -> Int. `≠` was accepted and shown back as `not (w = "")` (slightly surprising rewrite, harmless). (went well / papercut)
- main: MCP.md does not say how to make `main` (kind function with no params? value?). Guessed `define name=main kind=function` (no params) -> `main() : () -> a`; filling with print made it `() -[Console]-> Unit` and `run` accepted it. 1 try. Severity: papercut.
- Two statements in sequence: used `step at=main name=_ value=...`. Step "at a definition" inserts FIRST in the body, so to get statements in order you add them in reverse (fill last statement with replace, then step the earlier ones). Schema description says "(or first in a definition's body)", so documented, but not obvious for building a sequence top-down. For the test I added 2 steps at the definition and they ended up in reverse of the order I added them. Severity: papercut.
- Tests: LANGUAGE.md "Check: tests are definitions" + LIBRARY.md Check entry explained it: any definition performing `expect(holds, what)` is a test. The type of `what` isn't spelled out (I guessed Text; worked). Made `word count test()` with 3 expects; `test` -> `✓ word count test (1)`. The "(1)" is unexplained in the MCP answer (CLI says "(1 cases)", clearer). Severity: papercut.
- Sanity: added a deliberately wrong expect -> `✗ word count test(): deliberately wrong`; `undo` within the same invocation removed it; tests green again. Clear failure message. (went well)
- CLI `ters run m1/prog` printed 5 / 0; `ters test m1/prog` -> `✓ word count test (1 cases)`. (went well)

## Summary
Writing the program through the Ters MCP server was smooth: ~11 tool calls total, no blockers, every edit accepted on the first try. README -> MCP.md -> `tools` listing gave the gestures; LIBRARY.md's Text and List sections gave split/keep/length; LANGUAGE.md's "Check: tests are definitions" explained tests. The only frictions were undocumented details I had to guess from tool output: the ‹multi word› name quoting, how to define main, the reverse ordering of `step` when building a sequence, and the meaning of "(1)" in the test result.

## Final program (view)
```
      ‹word count›#vhi2 : (Text) -> Int
      ‹word count›#vhi2(text#t3ob) = length(keep(split(text, " "), (w#2j7t) => not (w = "")))

      main#6rcq : () -[Console]-> Unit
      main#6rcq() =
uttj    print(show(‹word count›("the quick  brown fox jumps")))
        print(show(‹word count›("")))

      ‹word count test›#3aji : () -[Check]-> Unit
      ‹word count test›#3aji() =
h0f3    expect(‹word count›(" a  b ") = 2, "leading and trailing spaces")
upbd    expect(‹word count›("the quick  brown fox jumps") = 5, "double spaces count once")
        expect(‹word count›("") = 0, "empty text has no words")
```

## Output
```
run:  5
      0
      exit 0
test: ✓ word count test (1)
CLI ters test: ✓ word count test (1 cases)
```

## Top 5 frictions
1. `step` at a definition inserts first, so sequences are built bottom-up (statements end up in reverse order of adding) — papercut.
2. ‹multi word› name quoting in expression text is undocumented in MCP.md; learned only from output — papercut.
3. No doc on how to create `main` via MCP (function with no params worked) — papercut.
4. Test result "(1)" unexplained in MCP answer; also the type of `expect`'s second argument not stated — papercut.
5. `≠` silently rewritten to `not (w = "")` — mild surprise, harmless.

## Verdict
Finished.
