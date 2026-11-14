# The saved program format: literals as digits, one node per line

*Status 2026-11-13: I237 built (#2556, #2564), I240 built; the design of rows I237 (number literals saved as their
digits) and I240 (canonical JSON, one node per line). Ersagun picked
canonical JSON over an own text format and over today's layout (thread
"Decide the saved program format", 2026-11-13).*

A program is saved as JSON keyed by node ids. An example folder has
`code.json`, `names.default.json`, `comments.json` and sometimes
`signatures.json` and `examples.json`. The editor saves one file holding
the same tables (`files.ts` ProgramFile). A library module, and a
program's `modules/` and `store.json`, are a `projectional-module` with
its code inside. Every one of these holds nodes, and the same two rules
apply to all of them.

## Why

- **Number literals are JSON numbers today.** Whole numbers that fit a
  Float64, and every untyped number, are written as JSON numbers. An Int
  past 2⁵³ is already a string of digits, so the file mixes two spellings.
  A reader whose JSON parser reads numbers as doubles is right by
  accident, and a number typed where its type wasn't known became the
  wrong Int (I236, fixed in the palette).
- **The layout is long.** dice is 896 nodes in 5,696 lines (160 KB): each
  node takes about six lines and writes its id twice. A changed literal
  is one line in the middle of a node's block. Two branches touching
  neighbouring nodes conflict in git's line merge.
- **There is no one spelling.** `JSON.stringify(x, null, 2)` in one place
  and `null, 1` in another. Key order follows how the node was built. An
  unchanged program saved again can change bytes.

## I237: a number literal is saved as its digits

On disk a number literal's digits are a string under `num`, never a JSON
number. `of` names its type when it is known:

    {"kind": "lit", "num": "0.1"}                       some number, decided by the check
    {"kind": "lit", "num": "12345678901234567891", "of": "type.int"}
    {"kind": "lit", "num": "2.5", "of": "std.fixed"}
    {"kind": "lit", "value": "1/3", "of": "@…Rational"}  a type's own spelling, as today
    {"kind": "lit", "value": "hello"}                   a Text, as today

`num` and not `value`, because a string `value` with no `of` is a Text.
A second key reads without guessing, and it is the same length on a line.
A literal whose type spells it as text (a Rational's `1/3`, Bytes, a
Map written out) is already a string and stays under `value`.

**The spelling.** Each value has exactly one spelling, and saving the
same program twice gives the same digits:
- **A whole number:** its decimal digits, with `-` for a negative.
- **A Float64, or a number not settled to Int:** JavaScript's shortest
  spelling that reads back as the same double (`String(x)`: `0.1`,
  `1e+21`).

So "exactly as written" means exactly as the editor keeps it. The editor
already reads what is typed into a value: `0.10` is `0.1` once entered, and
a 20-digit decimal at Float64 is the nearest double. At Rational it is
kept exactly, as `p/q`.

**What the digits mean is decided when the program is read**, from `of`:
- **No `of`:** a number, which the check settles to Int or Float64 as it
  does today. Since I236 a whole number past 2⁵³ is saved with
  `of: type.int`, so none is lost here.
- **`type.int`:** an Int of any size. One past 2⁵³ stays digits in memory,
  as today.
- **Another type** (Fixed, Float64): the number the digits spell.

**In memory nothing changes.** A literal's `value` is a number or a
string, as every pass reads it today. The digits are a property of the
file, so they are converted at two places only:
- `savedCode`, on the way out;
- `readCode`, on the way in.

Content hashes are taken over the nodes in memory, so no module's ids move.

**Old files still read.** A `value` that is a JSON number reads as it does
now. Every example, library module and store is rewritten once, by a
script, in its own PR.

## I240: canonical JSON, one node per line

Still plain JSON: `JSON.parse` reads it, and so does every JSON tool. One
printer writes it. Below is a folder's `code.json`:

    {"defs": [
    "ab12…",
    "cd34…"
    ],
    "nodes": {
    "0f3k…": {"kind": "lit", "num": "6", "of": "type.int"},
    "0g9a…": {"kind": "call", "fn": "1h2b…", "args": ["2k8c…", "0f3k…"]},
    …
    }}

**The layout.**
- **What is one line.** A node, keyed by its id, which is not repeated
  inside it. Also one name or one comment in `names.*.json` and
  `comments.json`, and one definition id in `defs`.
- **Where defs' order lives.** `defs` stays an array in program order, one
  id per line, so moving a definition moves one line. Nodes are sorted by
  id, so where a node sits never depends on edit history.
- **Inside a node.** `kind` first, then the other keys sorted. Arrays and
  nested objects stay inline, in their own order (some objects say an
  order, as a representation's operations do). No spaces other than
  after `:` and `,`.
- **The other tables.** names, comments, signatures, examples and layout
  are one entry per line, sorted by key. The single file the editor saves
  holds the same tables in the same spelling, one after another.
- **Text.** UTF-8, `\n` line ends, a final newline, and JSON's own escapes
  only (`ensure_ascii` off, so `é` is `é`).

**Who uses the printer.** `ters`, the editor's Save, the MCP's saves and
`ters merge` all write through `savedCode` and the one printer. Each
reader goes through `readCode`. Today these are:
- `files.ts` fromFile and toFile;
- `load.ts` reading a folder, its modules and its store;
- `mcp/session.ts` reading and writing;
- `cli/main.ts` for publish, fetch, upgrade, downgrade and merge;
- `editor/main.ts` for its examples and saved files;
- `library/build.ts` for the library's modules.

**What it buys.** dice goes from 5,696 lines (160 KB) to about 900 lines
(89 KB). A literal edited in the editor changes one line. Two branches
that change different nodes merge with git's own line merge, without the
driver. `ters diff` and the merge driver keep working by id, as before.


## I271: two added definitions, merged on GitHub's lines

GitHub's merge button never runs a custom merge driver (GIT-TRIAL-2026-11-14
§7), so two pull requests that each add a definition are merged there on
lines alone. Measured on every example (I271): for 1,371 pairs of its own
definitions, a base without both (and the nodes and names only they reach),
one branch adding each back, `git merge-file` on code.json and
names.default.json:

| layout | 3 to 9 definitions | 10 to 29 | 30 or more |
|---|---|---|---|
| as saved now (I240) | 100% conflict | 100% | 100% |
| as now, with `defs` never conflicting (order kept apart) | 93% | 75% | 47% |
| a definition's nodes kept together, definitions by id | 41% | 16% | 4% |

**`defs` alone isn't the conflict.** Every pair conflicts at the end of
`defs`, where both append. But with `defs` set aside, the nodes still
conflict in 65% of pairs and the names file in 35%: nodes are sorted by
id, so each added definition's 10 to 70 nodes scatter through the file,
and two branches' nodes often fall between the same two old ones, which
git calls a conflict however different the lines are. Keeping order apart
from the list of ids buys little.

**Keeping a definition's nodes together** (code.json as one block per
definition, sorted by the definition's id, its own nodes inside; the few
nodes two definitions share in a table after; the order shown as a key on
each block's first line, so appending touches no old line; names grouped
the same way) makes two new definitions conflict only when no old
definition's id sorts between theirs, or one lands last (JSON's commas).
It would also make GitHub's own diff of a pull request readable, one
definition's lines together. The model stays a table of nodes: the
grouping is the printer's and the reader's alone (saved.ts), but it is a
third format for every file, and a key per definition that saving must
keep stable.

**What fixes it whatever the layout is the driver**, which merges these
pairs id by id with no conflict at all. When GitHub says a pull request
conflicts in program files, `git merge origin/main` in a clone where
`ters git-setup` was run (with `ters.mjs` anywhere, I272) merges them,
`ters conflicts` says what is left, and the push makes the button green.
An Action could do the same on GitHub, merging the base into a
conflicted pull request's branch with the driver, but a push made with
the workflow's own token runs no checks, so it would need a token of the
repository's.

**Decided (Ersagun, 2026-11-14): keep the layout and merge with the
driver.** Even grouped, 16% to 41% of pairs in programs of the usual size
still conflict, so the driver is needed anyway, and a third format with
order keys to keep stable costs more than it saves. `node
ters/bench/merge-on-lines.ts` measures it again.

## Steps

1. **I237a.** `ters/src/saved.ts`: `savedCode` and `readCode`, used by every
   reader and writer above. Literals are saved as digits, and old files
   are read too. Tests: a 20-digit decimal at Rational and at Float64, a
   big Int and an untyped number round-trip through save, load, the MCP
   and `ters merge`.
2. **I237b.** Every example, library module and store rewritten once (a
   script), in its own PR.
3. **I240a.** The printer in `saved.ts`, used by every writer, with the old
   layout still read. Test: an unchanged program saved twice is the same
   bytes, and a literal edited changes one line.
4. **I240b.** Every file rewritten once into the new layout, in its own PR.
5. **I241.** The trial repository, ersagunkuruca/ters-trial (built 2026-11-14:
   [GIT-TRIAL-2026-11-14](../../reports/GIT-TRIAL-2026-11-14.md)).
