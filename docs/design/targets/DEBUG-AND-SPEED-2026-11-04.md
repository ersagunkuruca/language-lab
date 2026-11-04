# Debugging and speed: one build, a map beside it

Ersagun, 2026-11-04: how do pauses, stack traces and stepping sit beside
heavily transformed compiled code? And compiled output should hold no source
names, and no machinery for running functions backwards, wherever the
compiler can work it out ahead of time by inlining or precomputing.

## Decided

- **One optimized build.** Debugging never changes what a program means.
  Checks such as finite Float64 stay in every build. The compiler drops a
  check only when it proves the check can't fail.
- **A map beside the output, not in it.** The map takes output positions to
  node ids, and says which node's value a variable holds. It holds ids only,
  and the editor joins it with the names file. The map is for our own tools
  (the editor, `lab`). Browser devtools source maps come later, and are a
  plus, not a necessity (Ersagun 2026-11-04: "We are not trying to create a
  language that just spits out JS").
- **Pausing and stepping happen in the evaluator.** A compiled run records
  the world's answers (L186's log). The evaluator replays them and steps
  from there. The evaluator side is built (E232a to E232d).
- **Profiling** is the only other setting, added when someone needs it. A
  profile keeps chosen call boundaries so time has somewhere to land.

## What compiled output carried (lab compile, 2026-11-04, core IR)

1. **Solves ask the evaluator's solver at run time** and ship the program's
   whole node table (calc: 337 KB of escaped JSON, 2,529 nodes). compile.ts
   printed the closed form instead, for example relations' `split` as
   `(s + d) / 2` and `(s - d) / 2`. Row C167.
2. **Every definition is lowered**, not only what main reaches:
   `lowerCore(p.code, p.info, p.names, p.own)` in ters/cli/lab.ts. calc's
   unreached `inverse` is its only solve, so it alone brings in the node
   table. calculus: 31 of 41 functions unreached. Row C168.
3. **Every closure carries its lambda's node id and capture binder ids**
   for a solver, and core-rt.ts makes a Map for each closure, in programs
   that never solve (dice: 9). Row C169.
4. **Ids as strings, and names as comments.** Tags are compared as strings
   such as `"std.list<type.number<>>.frames.frame"`, builtins are looked up
   by id (`R.rt("number.show", …)`), and each function has a
   `// definition name` comment. Row C170.
5. **Checks the types already rule out.** sort's insert checks numbers
   taken from a list of finite Float64 for being finite, twice per step. A
   search budget is set up where nothing searches. Row C171.

compile.ts was worse on names: functions named after definitions, a
`$names` table of every constructor, and show code for every library type.
It is being retired (C137).

## Prior art and influences

All of these are influences on the design. No code is adapted from them.

- Source maps (JavaScript) and DWARF, including split debug info: debug
  information kept beside the code and stripped at no cost.
- GHC's profiling builds (cost centres) and the GHCi debugger: stepping in
  an interpreter, not in optimized code.
- OCaml's ocamldebug, beside the native compiler.
- Rust's debug and release profiles, as the warning: overflow checks differ
  between them, so the two builds mean different things.
- Deoptimization: Hölzle, Chambers and Ungar, "Debugging optimized code
  with dynamic deoptimization", PLDI 1992. Fast code plus metadata to go
  back to the faithful view on demand.
- rr and Elm's debugger: record and replay. These are already credited by
  E232a.

When a row builds on one of these, it goes into ters/CREDITS.md and where
the user sees it.
