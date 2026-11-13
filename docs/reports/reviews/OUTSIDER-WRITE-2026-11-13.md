# Outsider write, 2026-11-13

The second outsider pass (BACKLOG P9, from
[STANDING-2026-11-13](STANDING-2026-11-13.md) §6.3). The first,
[OUTSIDER-READ-2026-11-03](OUTSIDER-READ-2026-11-03.md), had a cold reader
mark what it couldn't follow. This one asks more: four unprimed agents each
had to **write and run** a small real program, from the public docs alone,
and log every place they got stuck, guessed or hit an error. Findings are
reported here; fixes are separate rows (I227 to I235), one area per row,
not in this PR.

## How it was run

- main at 61f40bc. `npm ci` and `npm run build-editor` in `ters/`, the
  site served over http at the repo's root.
- Each agent got a folder with copies of README.md, docs/learn/*
  (LEARN, TUTORIAL, GUIDE, RUNNING and their pictures),
  docs/language/{LANGUAGE,SPEC,LIBRARY,BACKWARDS}.md and
  docs/design/tools/MCP.md, plus the local site. It was told the language
  is called Ters and nothing else, and not to read the repo (source, tests,
  examples, backlog, reports) or search the web.
- Two wrote their program **in the editor**, driving index.html with
  Playwright in a headless browser (screenshots and page text to see). Two
  wrote theirs **through the MCP server** (`ters mcp <folder>`, through a
  small stdio client that makes the calls given on its command line), the
  way an LLM would. The MCP agents could also run the `ters` command.
- Each logged, per stuck point: what it tried, what happened (quoted), what
  the docs said, how it got past, how many tries, and a severity
  (blocker / slowdown / papercut).
- The thread reproduced the two bugs (§3.1, §3.2) and the "a binder" error
  itself before writing this; the rest is the agents' logs, condensed.

| agent | route | program | result | tool calls |
|---|---|---|---|---|
| w1 | editor | FizzBuzz 1 to 15 from `main` | finished, right output | ~22 |
| w2 | editor | Celsius to Fahrenheit and a total price, each run forwards and backwards | finished, after one workaround the docs don't give | ~31 |
| m1 | MCP | `word count`, a `main` and a test | finished, no blockers | ~15 |
| m2 | MCP | Pythagorean triples with c ≤ 20 by search, then a `Triple` record and perimeters | finished, after three workarounds | ~37 |

## 1. What went well

- **The README's path worked for all four.** README → LEARN → GUIDE
  (editor) or README → MCP.md (MCP) got each one to a running first edit.
  GUIDE §3 (holes and the palette), §6 (choice and `all`), §7 (the Run pane,
  ticking ports to run backwards) and §10 were each named as "described the
  step exactly". LANGUAGE.md's "Start here" made `one of` / `all` / `fail`
  clear to m2, and "Check: tests are definitions" gave m1 its test.
- **LIBRARY.md answered lookups.** `split`, `keep`, `length`, `range from`,
  `first`, `show`, `print`, `join all` were all found by searching it.
- **Running backwards worked** for a Float64 formula: Celsius 100 → 212,
  212 → 100, −40 → −40; net 250 for a total of 300 at 0.2 (after §3.1).
- **A good refusal.** w1's first FizzBuzz printed `remainder(n, 3)` directly;
  the editor refused with "main does Console while a Choice is open, so it
  would act on paths that are later abandoned: handle the Choice first
  (first, all, count or optional)". It said what and how to fix, and the
  second try ran.
- **MCP edits were cheap when they fit.** m1 made every edit on its first
  try; the line-diff answers and the ✓/✗ test lines were clear.
- Nobody tripped on the words OUTSIDER-READ-2026-11-03 marked (`lab`,
  lanes, "typed core", dots before they're introduced, raw file links): the
  README, LEARN, TUTORIAL and GUIDE rewrites (L194 to L196) held up.

## 2. Where they got stuck, by area

### 2.1 Typing code: the text you type has no written grammar (w1, w2, m1, m2)

The quickest route in the editor turned out to be typing the whole body as
one expression into the palette's search box. GUIDE §3 mentions only "a
value" and "a short sum, like x + 1", so w1 found this by trying. Then:

- `=` is equality, `if … then … else`, `(n) => …` for a function: guessed
  from examples in LANGUAGE.md; nothing lists what the palette and MCP
  `replace` accept (w1, m2).
- `==` is refused, in MCP, with the error **"a binder"**, which names
  neither the token nor `=`. m2 spent three calls on it (§2.3).
- Names with spaces are written `‹word count›(…)`. MCP.md never shows the
  quotes; m1 learned them from `define`'s answer.
- The view doesn't read back: `first(…, else show(n))` is how the view
  shows what was typed as `first(…, () => show(n))`, and
  `all(() => one of(…))` is shown as `all(one of(…))`. MCP.md says
  `replace` takes "an expression written as view prints it".
- `≠` is accepted and rewritten to `not (w = "")` (harmless surprise, m1).
- MCP.md doesn't say how to make `main` (m1 guessed a function with no
  inputs, which is right) or what `test`'s "(1)" means (the CLI says
  "(1 cases)").

Severity: slowdown for each; together the biggest source of guessing.

### 2.2 `step` builds a sequence backwards (m1, m2)

MCP `step(at, …)` puts the new step before the **whole chain** the part is
in, not before the part. Given a hole after `a = one of(…)`, a step `b = …`
went in front of `a`, so it couldn't use `a`: "nothing is named a here;
did you mean p, i?" (p and i are not in the program). Both agents ended up
adding steps in reverse order and filling each with `replace`. Undo only
reaches back within one server run, so a misplaced step was rebuilt by
hand.

### 2.3 Steps inside a lambda in `replace` text (m2; reproduced)

`replace` with steps on lines inside `all(() => …)`:

    all(() =>
      a = one of(range from(1, 21))
      b = one of(range from(a + 1, 21))
      c = one of(range from(b + 1, 21))
      if a * a + b * b == c * c then [a, b, c] else fail())

m2's call never answered (killed after 120 s). Reproduced here: it answers
"nothing is named a here; did you mean p, i?" after **55 s**; with one step
instead of three it says the same after 2 s. So steps on lines don't bind
inside a lambda, and the time grows fast with the number of steps. (Steps
on lines at the top of a body do work: I217, #2441.)

### 2.4 The `for each` that doesn't fit leads the message (w1, m2)

`for each` has a List version (2 inputs) and the page's Cell version
(3 inputs). A 2-input call whose real problem was elsewhere was refused with
"for each takes 3 inputs, given 2; or …" in both the editor (w1, before the
good Choice message) and MCP (m2, where it was the whole message, so m2
gave up on `for each` and printed one joined text). `defs filter="for
each" library=true` lists both with no ids, so neither can be picked.

### 2.5 FizzBuzz needs `first` (w1)

`remainder` on Int has Choice (no answer when dividing by 0), so
`remainder(n, 3) = 0` inside a `print` needs `first` or `optional` even
though 3 is a literal. The refusal explains it well (§1), but it's the
first thing a newcomer meets in the most common first program.

### 2.6 Smaller ones

- An input named `celsius` (type still `a`) is offered in the palette as
  `celsius(□)`, `celsius(□, □)`, `celsius(□, □, □)`: briefly looked like a
  library function (w2).
- A backwards run shows only "Looking for an answer… Stop" for several
  seconds; −40 for `celsius · 9 / 5 + 32` took about 10 s, though README
  says arithmetic is solved directly (w2; not timed precisely).
- MCP `eval "triples"` answers "a name alone is listed already"; `defs`
  lists the type, not the value (m2).
- A new program stays "Untitled 1" and Save file names it
  `untitled-1.json` without asking (w1, w2).
- After a reload no hole is selected, so the palette isn't on screen until
  one is clicked (w1; mostly an automation note).

## 3. Bugs

### 3.1 Running a Number-generic function backwards throws a raw JavaScript error (w2; reproduced)

`total price(net, rate) = net * (1 + rate)`, typed with the literal `1`, is
inferred as `(a, a) -> a where a is a Number`. Forwards, (200, 0.2) gives
240. Backwards, rate 0.2 and result 300 gives, in the Run pane:

> The number 1.2 cannot be converted to a BigInt because it is not an integer

Typing 300.0 changes nothing. Writing `1.0` instead of `1` makes the
function Float64, and the backwards run then answers 250. Nothing in
BACKWARDS.md or GUIDE §7 mentions it, and the message is the host's, not
Ters's: it names no type, node or fix. For a newcomer who doesn't guess
"make the literal a float" this is a blocker. Reproduced here in a fresh
definition, the same message.

### 3.2 `replace` with steps inside a lambda: no binding, and slow (§2.3)

## 4. Compared with 2026-11-03

| | 2026-11-03 (reading) | 2026-11-13 (writing) |
|---|---|---|
| task | mark what can't be followed | write, run and test a program |
| readers | one, docs + scraped screen text | four, two in the editor and two through MCP |
| where the trouble was | words: jargon, terms used before they're explained, internal names (`lab`, lanes), raw links | doing: the typed text's grammar, which edit goes where, error messages, two bugs |
| doc problems | many, in README, LEARN, TUTORIAL, GUIDE | few: the path worked, no jargon complaints; the gaps are missing pages (typed text, MCP basics), not confusing ones |
| result | rows E234-E236, L194-L196, I160, all done | rows I227-I235 |

What moved: the reading surface is now fine for someone arriving cold, so
the friction has moved one level down, to writing. Two things are new
because writing exercises them: the text you type (palette and MCP share it)
has no grammar page, and its error messages ("a binder", the wrong `for
each`) don't point at the problem. The editor route was smoother than the
MCP route (w1 and w2 needed one guess each; m2 needed three workarounds),
which is the opposite of 11-03, where the editor's own screen text drew the
most marks.

Caveats: one agent per task, agents read fast and guess well, so a human
newcomer would likely hit more; the editor was driven by a script, so
mouse-level gestures (drag a wire, alt-drag a dot) weren't tried, since
typing was quicker.

## 5. Rows

Added to BACKLOG's Inbox, one area per row:

- **I227** (bug) Backwards run of a Number-generic function: a Ters message
  or, better, an answer (§3.1).
- **I228** (bug) MCP `replace`: steps on lines inside a lambda bind, and the
  time stays flat in the number of steps (§2.3).
- **I229** MCP `step` places a step before the part named, so a sequence
  can be built top-down (§2.2).
- **I230** Overloads in refusals and in `defs`: the version that fits leads
  the message, and each version can be named (§2.4).
- **I231** Reader errors name what they couldn't read: `==` says to use `=`
  (§2.1).
- **I232** A page on the text you can type (palette and MCP `replace`), and
  the view reads back as it prints (§2.1).
- **I233** MCP.md basics: making `main`, `‹›` names, what `test`'s count is,
  `eval` of a name (§2.1, §2.6).
- **I234** `remainder` by a literal non-zero divisor without Choice, or a
  documented answer why not (§2.5).
- **I235** Editor papercuts: an untyped input offered as a call at three
  arities, a new program's title and file name, backwards-run progress
  (§2.6).

## Logs

The four logs, unchanged, are in
[outsider-write-2026-11-13/](outsider-write-2026-11-13/):
[w1](outsider-write-2026-11-13/LOG-w1.md),
[w2](outsider-write-2026-11-13/LOG-w2.md),
[m1](outsider-write-2026-11-13/LOG-m1.md),
[m2](outsider-write-2026-11-13/LOG-m2.md). The paths in them are the
agents' scratch folders.
