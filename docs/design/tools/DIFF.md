# Reading a change to a program: `ters diff` by node id

*Status 2026-11-13: built. E255a (`diffPrograms`, `ters diff` on two
programs), E255b (`--from REV`) and E255c (the editor's Changes tab) are
done; E255d (a PR comment workflow) was declined (Ersagun, 2026-11-13: not needed).*

A saved program is JSON keyed by node ids: `code.json`, `names.default.json`
and `comments.json` in a folder, or one file the editor saves. A change to
one, in a pull request or between two saves, reads today as JSON. Three
reviews asked for a way to read it: BLIND-SPOTS-2026-11-03 §13, both
ASPECTS runs (#37) and STANDING-2026-11-13 §6.7. It matters as soon as a
second person sends a change.

## What there is

- `ters diff before.json after.json` (L113, `merge-files.ts diffLines`)
  says which definitions were added, removed or changed, and how many nodes
  changed in each: `changed \`area\` (3 nodes)`. It doesn't say what
  changed, and it takes two files, not two versions of a program.
- The MCP's `view` prints a definition as the blocks text with each line's
  node id (`render.ts blocksOf`, `mcp/session.ts`). Its edits answer with a
  diff of those lines, matched as text (a longest common subsequence).
- `ters merge` already merges id by id, so a program's change is a set of
  node changes. The diff is the reading side of the same idea.

## What a diff says

For each definition, matched by its id (never by name or position):

    ters diff examples/dice --from HEAD~1

    changed roll : (Int) -[Random]-> List Int
      roll(n) =
    ~   range(n) |> map(_ => one of(1 .. 6))      was: range(n) |> map(_ => one of(1 .. 4))
    + added tally : (List Int) -> Map Int Int
    +   tally(rolls) = fold rolls …
    renamed `count` to `tally of`
    - removed old roll
    comment on roll: "One die per throw" → "One six-sided die per throw"

- **Lines are matched by node id, not text.** Each line of the view shows
  one block and starts with that block's id. A line whose id is in both
  versions is kept (same text), changed (`~`, with what it was) or moved (its
  parent changed). An id only in the new version is added (`+`), only in the
  old one removed (`-`). A block moved inside the definition reads as moved,
  not as a removal and an addition. Two edits that print the same text
  aren't mistaken for each other. This is the "by node id" in the row; a
  text diff would only guess it.
- **Both versions are printed with the new names**, so a rename is one line
  (`renamed \`count\` to \`tally of\``) and not a change to every line that
  uses the name. Comments, examples and hints are the side tables'
  entries, listed by what they're on.
- **A changed type is shown** when the definition's type changed (both
  versions are checked), since the type is what callers see.
- **Layout isn't a change.** Graph positions, folds and the view style are
  shown only with `--all`.
- **Unchanged definitions aren't printed.** A changed one prints its lines
  with three lines of context around each change, and `…` for the rest.

The same result is a value: `diffPrograms(before, after)` gives per
definition its status, its new type and old type, and its lines, each with
its node id and `same | changed | moved | added | removed`. The CLI prints
it, and the editor draws it.

## Where the two versions come from

- Two program folders or two saved files: `ters diff old/ new/`.
- A program and a git revision: `ters diff examples/dice --from HEAD~1`
  reads the old version's three files with `git show REV:path` (and `--to
  REV` for the new one, else the working tree).
- Inside a pull request: `ters diff --from origin/main` lists every program
  folder that changed between the two, so a reviewer runs one command.

A GitHub comment with the diff, posted by a workflow on a PR that touches
`ters/examples` or `ters/library`, would let a reviewer read a change
without running anything. It would cost CI minutes, and Ersagun declined it
(2026-11-13: not needed).

## In git

After `node ters/cli/ters.ts git-setup` once in a clone, git's own commands
print `ters diff` for program files (E262):

| command | shows |
|---|---|
| `git diff`, `git diff --staged`, `git diff main` | the definitions that changed, line by line by node id |
| `git show --ext-diff REV`, `git log -p --ext-diff` | the same for past commits (show and log need `--ext-diff`) |
| `git diff --no-ext-diff` | the JSON itself |

`.gitattributes` marks the four program files by their names alone
(`**/code.json diff=ters merge=ters`), wherever they are. A pattern bound
to a folder would silently lose both drivers for a program moved out of it
(I269). `git-setup` sets this clone's `diff.ters.command` (and the merge
driver, `merge.ters.driver`, SHARING.md §6) to this checkout's `ters.ts`.
It also asks git (`check-attr`) whether a program file at a place nothing
names has both drivers, and where it doesn't, adds those four patterns to
the repository's `.gitattributes`. Other files diff as before.

git calls an external diff driver once per changed file with its two
versions, never with the files beside it, and a definition's text needs
them (its names, comments, signatures). So `ters git-diff` (cli/git-diff.ts)
puts each version's folder back together. A side that is the working tree
takes its folder from there. Otherwise it finds the pair of revisions that
hold the two blobs: the index against the working tree, HEAD against the
index, a branch against the working tree, or a commit against its parent.
When no pair is found it looks for each blob alone. A file beside it that
one version lacks is taken from the other, as an unchanged file would be.

A changed comments.json or names file whose code.json also changed reads
"(shown with …/code.json)", since that diff already shows it. Two code.json
files that hold the same value read "no changes to the program (only its
layout or formatting)". When a version can't be read, the driver says so
and prints git's plain diff.

A program folder that moved is followed (I268). `ters diff --from REV`
pairs each folder with its old place from git's renames (`--name-status
-M`) and says "moved from …" first. The driver is given a renamed file's
new path too (GIT_EXTERNAL_DIFF's two extra arguments). It reads each side
at its own place, heads the diff with both paths, and says a file that only
moved has no changes to the program.

A merge through the driver says each conflict by definition, with ours'
and theirs' text of it, and writes ours to the working tree, so nothing
there marks it afterwards (I265). While the file is unresolved, `ters
conflicts [program]` says them again (cli/conflicts.ts, I267). It reads
the base, ours and theirs that git keeps as the file's index stages 1, 2
and 3, and merges them as the driver did. Once the file is added, it has
none.

## In the editor

A **Changes** view (a tab beside Files) compares the program with a base:

- the version it was opened as (a file, an example as shipped), or
- the last version marked **Reviewed** (a button in the view, kept with the
  program in local storage).

- a git revision of an example (E263): a branch, tag or commit typed into
  the tab, its files read from raw.githubusercontent.com, or a pull request
  (`#123` or its link), whose own change to the program is shown, from
  where its branch left the base (api.github.com's compare) to its newest
  commit. Both answer any page without signing in, so the site does this
  as it is, within GitHub's 60 unsigned requests an hour (a pull request
  takes two). A pull request's change isn't the open version's, so nothing
  is marked in the blocks then.

It lists the changed definitions as the CLI does. Clicking one opens it with
its blocks marked by the same per-node status: added green, changed amber,
removed listed under the definition. The graph marks nodes the same way. It
reads the code, never changes it, and *Undo* is unaffected. Since both
versions are in memory, the editor uses the same `diffPrograms` and doesn't
need git.

## Steps

| step | what | example that shows it works |
|---|---|---|
| E255a | `diffPrograms` (ters/src/diff.ts): definitions by id, the view's lines by node id with both versions printed with the new names, renames, comments, types; `ters diff` on two folders or files prints it (L113's summary stays for a bare code.json pair) | `ters diff` on dice and a copy with one literal changed, one definition added and one renamed prints exactly those three, with the literal's line as `~` |
| E255b | `--from REV` / `--to REV` through `git show`, and a PR's changed program folders with `--from` alone | `ters diff ters/examples/pig --from` a commit before #2240 prints the change #2240 made to pig's handler |
| E255c | The editor's Changes view against the opened version or the last Reviewed one, with marks in blocks and graph | Edit a literal and add a definition in dice: Changes lists both, the literal's block amber, the new definition green |
| E263 | The Changes tab compares an example with a branch, tag or commit from GitHub, or shows a pull request's own change to it | In dice, `2d173aa^` lists bar's two changed lines (#2194's `times rolled` to `nth`); `#2194` lists the same as the pull request's change; a branch that isn't there says so and keeps the version opened |
| E262 | git's diff driver (`ters git-diff`) and `ters git-setup`: `git diff`, `--staged`, `git show --ext-diff` print `ters diff`, with each version's names, comments and signatures | Renaming `expression` in algebra's names prints `renamed \`expression\` to \`term\`` under `git diff` and `git diff --staged`; `git show --ext-diff` of #2422 prints markov's added definitions |
| E255d | Declined 2026-11-13 (Ersagun: not needed). Was: a workflow that comments `ters diff` on PRs touching program folders | A PR changing an example gets the comment |

## Prior art

- Unison's `diff.namespace`: a diff of definitions by hash, with names
  separate, as here (unison-lang.org, "Namespace diffs").
- GumTree (Falleri et al., "Fine-grained and accurate source code
  differencing", ASE 2014) matches tree nodes when there are no ids to
  match by. Ters has ids, so it needs only the matching GumTree has to infer.
- Darcs and Pijul treat a change as a set of edits to identified pieces. Ids
  give the same thing for a tree.
