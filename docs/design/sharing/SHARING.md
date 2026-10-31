# Sharing programs and libraries: lineages, versions and names

Written 2026-10-31 from the thread "Design sharing libraries and
versioning". **Status (2026-10-31):** proposal, nothing built. The steps
are BACKLOG rows L109 to L115, which take over L17 and L68.

**In one sentence:** a definition (or a library) keeps one **lineage id**
for its whole life and gets a **version hash** each time it's published;
a program records both, plus its own copy of the names it took, and every
change from the author reaches it as an upgrade the editor offers.

## The questions (Ersagun, 2026-10-31)

*"Should we think about how anybody else would write programs and
libraries in this? I know we said ids are the thing that ties everything
so libraries are modules are functions. But for that we could need a
global registry, and versions (just hashes?) and persistent hashes."* And:
*"Do we need something like git but for structured data, or just a diff
extension?"*

In the discussion, "persistent hash" turned out to mean Bob's view: an id
for a library that never changes for him, while the version under it
does. That's the lineage id below. The other meaning, a hash that always
names the same code, is ordinary content hashing and stays (§3).

## Where we are

LANGUAGE.md "Signatures and modules": a draft node is born with a random
id; publishing renames each definition to `@` + its SHA-256 content hash
and refuses unfinished code; refs are the imports; a module is published
nodes plus side tables (names, pins, comments, which definitions it
offers); `replaces` and `upgrade` move a program to a new definition only
when the pins are equal. Names are already a layer over ids. What's
missing: nothing ties version 2 of a definition to version 1 except a
hand-written `replaces`; publishing throws the draft's id away; nobody
can say who published what; and a change to std re-hashes everything
above it (#709 republished the html module because Console's
declaration moved).

## 1. Lineage ids and version hashes

Two ids, two jobs:

| | lineage id | version hash |
|---|---|---|
| says | *which thing* ("Alice's json parse") | *exactly which code* |
| changes | never | every publish |
| comes from | the draft's born id, kept when published | SHA-256 of the content, as now |
| like | a git branch, an IPNS name | a git commit, an IPFS CID |

Publishing keeps the draft id as the lineage id instead of replacing it.
Publishing again from the same lineage makes a new version that replaces
the last; `replaces` stops being something an author writes. A library
is the same thing one level up: a lineage id for "json", a version hash
per release (the hash of its offered set, names and pins). One mechanism
for functions and libraries, so nothing new for the uniformity rule.

The lineage id isn't part of the hash. Two people who write the same
function still publish the same version hash, and putting their code
together is still a no-op; it's one version in two lineages.

## 2. What a program records

A program's ref holds **the lineage id and the exact version hash it was
checked against**. The program always runs that version, so it runs the
same forever and a build is reproducible with no lockfile (the refs are
the lock). The lineage id is how the editor finds newer versions.

Considered and rejected: a ref holding only the lineage id, resolved to
the newest version when it runs. Bob's program would change behind his
back whenever Alice published, and two runs a day apart could differ.

**Upgrades are offered, and the checker decides which are safe.** When
the lineage has a newer version:

- **the new pin is at least as general as the old one** (today `upgrade`
  needs them equal): the editor moves the ref and tells Bob. Once T7
  exists, Bob's own tests and laws must also still pass. Nobody writes a
  version range; this is "the compiler chooses" applied to versions;
- **the type changed**: the editor shows both types and where Bob's
  program uses it. Data-type changes need a migration (L17's half that
  stays).

Two versions of one library in one program are two hashes side by side,
so there's no diamond problem; only a value of a data type passed between
them needs converting, as in Unison.

## 3. Hashes that stay true

A version hash names the same code forever, and the code never goes
away. Two things break that today, and both get a rule:

- **What a hash points at changes.** html's code didn't change in #709,
  but std's Console declaration did, so every html hash moved and the
  examples were repointed. Rule: **std is published like any other
  library** (lineage ids, version hashes), so changing a declaration adds
  a version and the old one stays, as the hidden Float64-only `smaller`
  already does. Builtins stay leaves (`["builtin", op]`), and an op's
  meaning never changes under the same op.
- **The recipe changes.** FNV-64 became SHA-256 once. Rule: **every hash
  carries its recipe version** (a format letter after `@`). A new recipe
  comes with a table from old hashes to new, which `upgrade` reads like
  any other replacement.

And: **published code is never deleted.** An author can mark a version
broken (§4); programs that use it keep running and get a warning.

## 4. Lineage logs: who says which version is current

A hash proves *what* the code is. It doesn't say *who* made it or
*whether it's the latest*. Each lineage has a **log**: an append-only
list, signed by its author, of "this lineage's current version is
`@def`, which was `@abc`", with "`@abc` is broken: reason" as the other
kind of entry. Scenarios, with Alice's `json` and Bob's program using
`parse`:

1. **Bug fix.** Alice fixes `parse`. Her log says the lineage is at
   `@def` now. Bob's editor sees the pin still fits and moves him over,
   telling him.
2. **Impostor.** Mallory publishes something with the same names. Its
   hashes check out (hashes only prove content), but only Alice's key
   writes to Alice's lineage, so the editor shows "json by Alice" only
   for Alice's code.
3. **Security problem.** Alice marks `@abc` broken. Bob's program still
   runs; his editor warns him and offers `@def`.
4. **Finding things.** A search site indexes logs. If it disappears, the
   code and the logs are still wherever they were hosted.

Without logs, sharing still works by passing hashes around, and stays
correct, but gets no updates, no authors and no warnings.

**Hosting is the other landscape.** Code fetched by hash checks itself
(`verify` already does this), so any store can hold it: a git repository,
a static site, IPFS, an npm package for the JS target. Logs are small
signed files hosted the same way. There is no global registry the
language depends on; a registry is just an index of logs, and anyone can
run one. How signing and fetching work on each host is a host detail.

**Effects are a supply-chain check for free.** A library's pins carry
its effects, so a `parse` whose pin has no Network can't reach the
network, whatever version arrives.

## 4b. The project keeps every version it has used (Ersagun, 2026-10-31)

*"If we are thinking of allowing any source, even non-registry sources,
then there is a chance that the version we are using can go away. … At
each update from those sources we may need to save the old version, so
that if anything that's not obvious from the tests etc drifted, Bob would
keep the option to downgrade later."*

So a project has its own **store**: every published node it has ever
used, keyed by hash, saved with the project (a folder next to the program
files, under git). It is filled by default, not on request, because it's
cheap: content addressing shares every node two versions have in common,
so keeping `@abc` after moving to `@def` costs only the nodes that
changed. Nothing to remember, nothing to choose.

- **A source goes away.** The program still opens, checks and runs from
  the store. The editor says the version's source is gone and offers to
  publish the kept copy somewhere else; the hash proves it's the same
  code wherever it lands.
- **An upgrade drifted in a way tests didn't catch.** The upgrade keeps
  the old version in the store, and the lineage's history in the program
  lists every version Bob has had. **Downgrade** moves the ref back the
  same way an upgrade moves it forward (same pin rules, names restored
  from the copy he had then), and it needs no network.
- **Size.** The editor can show what the store holds and offer to drop
  versions no program in the project refers to any more; dropping is the
  only way anything leaves it.

Prior art: vendoring (Go's `vendor/`, Cargo's `cargo vendor`), Nix's
store and its garbage collection by roots, Unison's local codebase,
which keeps every definition it has seen.

## 5. Names: pinned locally, updated by asking

Names stay the human interface, and stay presentation. Bob's program
keeps **its own copy of the library's names**, taken at the version he
adopted (`adopt` already keeps a program's names where they differ). A
rename can never break anything, since every ref goes by id. On upgrade
the editor compares three name sets, the names Bob took, the new
version's names, and the names Bob changed himself:

- **Bob renamed it**: Bob's name wins, no question.
- **Alice renamed it**: one question for the whole upgrade, not one per
  name: "json renamed 3 things: `parse` → `decode`, … Take these names?"
- **Alice reused a name for something different**: Bob's refs are on the
  old lineage, so nothing breaks; the question shows the clash and Bob's
  old `parse` keeps its name in his program.

So everything a program takes from a library, code, types and names, is
pinned locally and offered as an upgrade. Types follow by themselves when
they fit; names ask, because a name is a human choice. Path namespaces
(`json.parse`) are one more name layer, the library's title in front,
and need nothing new.

## 6. Git, or git for structured data

**Git stays**, as transport and history: it's a host tool, and the
language's ideas don't depend on it. What we add is a **structural diff
and merge driver** for program files, registered in `.gitattributes`
(git calls a custom driver per file type). It's easy for us because every
node and every side table (names, comments, layout, examples) is keyed by
a stable id:

- **diff** says which definitions were added, removed or now replace
  which, which names changed, and inside a draft which nodes changed, as
  a tree, not as JSON lines;
- **merge** is a three-way merge id by id. Published nodes never conflict
  (same hash, same content). Names and comments merge on their own. A
  conflict only happens when both sides changed the same field of the
  same draft node, and the driver says which node in which definition.

A new version-control system is not needed now. The principled long-term
form is history as the editor's own edits (edits at a path,
STABLE-REFERENCES.md §1) that commute when they touch different nodes:
patch theory, as in Darcs and Pijul, or a CRDT. That's what live
collaboration in one program would need, and it can wait until we want
that.

## Steps (BACKLOG)

| id | step | size |
|---|---|---|
| L109 | Hashes carry a recipe version; std published with lineages and version hashes, so a std change adds versions and keeps the old ones | M |
| L110 | Publishing keeps the draft id as the lineage id; refs hold lineage and version; `replaces` derived from the lineage | M |
| L111 | Upgrades by pin generality (new pin at least as general), moved by the editor with a note; tests must pass once T7 is built | M |
| L112 | Names pinned per program; one question per upgrade for the author's renames; the program's own renames win | M |
| L113 | Structural diff and three-way merge driver for program files, by id, registered in `.gitattributes` | M |
| L115 | A project store: every published node the project has used, kept by hash with the project; runs when a source is gone; downgrade moves a ref back to any kept version | M |
| L114 | Lineage logs: signed, append-only, "current" and "broken" entries; fetching code by hash from any host; a browser over logs (was L68) | L |

L17's data-type migrations stay as L17. L113 can go first: it needs
nothing else and helps today.

## Credits

| What | Label | Who |
|---|---|---|
| Definitions named by content hash, names as metadata, upgrades that move refs | Influence | [Unison](https://www.unison-lang.org) (Paul Chiusano, Rúnar Bjarnason, Arya Irani and team) |
| A fixed name pointing to changing content-addressed versions | Prior art | IPNS in [IPFS](https://ipfs.tech) (Juan Benet, Protocol Labs); git branches over commits (Linus Torvalds) |
| Keeping every version used inside the project; downgrade from it | Ersagun's idea / Prior art | Ersagun, 2026-10-31; Go's and Cargo's vendoring, Nix's store and garbage collection, Unison's local codebase |
| Imports pinned by hash, fetched from any host | Prior art | [Dhall](https://dhall-lang.org) (Gabriella Gonzalez); [Nix](https://nixos.org)'s content-addressed store (Eelco Dolstra) |
| Signed, append-only logs saying which version a name means | Prior art | Go's checksum database (Russ Cox and team); [Sigstore](https://www.sigstore.dev)'s Rekor; Certificate Transparency |
| Compatibility checked from types, not declared by version numbers | Influence | Elm's `elm diff` and enforced semantic versioning (Evan Czaplicki) |
| History as commuting patches | Prior art | [Darcs](https://darcs.net) (David Roundy), [Pijul](https://pijul.org) (Pierre-Étienne Meunier, Florent Becker); CRDTs (Shapiro et al. 2011), [Automerge](https://automerge.org) (Martin Kleppmann) |
| Diffs of trees instead of lines | Prior art | GumTree (Falleri et al., ASE 2014), [Difftastic](https://difftastic.wilfred.me.uk) (Wilfred Hughes) |
| A stable lineage id with a version hash under it; names pinned per program and offered on upgrade | Ersagun's idea | The thread above, 2026-10-31 |
