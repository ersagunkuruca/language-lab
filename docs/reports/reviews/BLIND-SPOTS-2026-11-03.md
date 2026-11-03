# Blind spots: what the language hasn't thought about yet (2026-11-03)

Ersagun asked (2026-11-03 07:48): "can you do another review so that we
think of other aspects of the language? Things I might not have thought
of?" The foundations audit of the same morning
([FOUNDATIONS-2026-11-03](FOUNDATIONS-2026-11-03.md)) looked at how the
code is built; the earlier reviews looked at the language, the editor and
the compiler as they are. This one looks for whole dimensions nobody has
asked about yet: what a serious language for programs, shaders, websites,
phone apps and audio will be asked about by its first outside user.

Each item says what is missing (checked against the code at `main`
2026-11-03), why it matters now or can wait, and how costly it gets to add
later. They are ranked by that last part: the cost of waiting. Rows are
added to BACKLOG.md only for items worth acting on; the rest are noted so
the next review can check whether they became urgent.

Ranked:

| # | blind spot | now or later | cost of waiting | row |
|---|---|---|---|---|
| 1 | Old saved programs when the language changes | now, before L130 | high, grows with every saved file | L184 |
| 2 | A page can run script through attributes | now, it's a bug | grows with every website | C140 |
| 3 | No license | now, a decision | very high once others contribute | P8 |
| 4 | Text: equality, case and Turkish I, graphemes | soon | high once programs store text | L185 |
| 5 | Effect rows as permissions | soon, before sharing | medium | E229 |
| 6 | Record and replay through the effect log | design now | high once hosts multiply | L186 |
| 7 | Performance that changes silently | soon | medium | E230 |
| 8 | Error messages as a designed set | soon | grows per message | L187 |
| 9 | Dates, times, durations | before apps | medium | L188 |
| 10 | Accessibility of the editor and of pages | with E228 | high to retrofit | E231 |
| 11 | Names in more than one human language | later | low while names are a layer | none |
| 12 | Hard real-time audio | later | medium | none |
| 13 | Reading a program's change in review | later | low | none |
| 14 | Numbers that differ between browsers and GPUs | later | low | none |

Already covered elsewhere and not repeated here: packages, versions and
sharing (SHARING.md), foreign code (FOREIGN.md), concurrency and time
inside the language (LANGUAGE-NEEDS-2026-10-24, ANSWERED-LATER.md), tests
in the language (TESTS-IN-THE-LANGUAGE.md), numbers (NUMBERS.md and its
siblings).

## 1. Old saved programs when the language changes

**What's there.** A saved program is JSON with `format` and `version: 1 | 2`
(ters/src/files.ts). Renamed std ids are read as today's
(`onTodaysIds`, std.ts `RENAMED_IDS`). That is the whole upgrade story.
`fromFile` checks only that each node has a `kind` that is a string; a
node of a kind that no longer exists, or of a kind whose fields moved,
opens and then fails somewhere in the checker or the editor.

**Why now.** The next language items change node shapes: L130 makes call
and solve one node kind, L179 changes how a merged use gives its ports,
L178 adds a schema table for nodes. Every program saved before those land
lives in someone's browser (localStorage), in the project's files (the
round boards `gaps-round7/sheet.json`, `gaps-round8/board.json`,
`gaps-round10/clinic.json`) or in a file someone downloaded with Save
file. Nothing tells a lane that its change breaks them.

**What to do.** One number for the node schema (with L178's table, which
is where kinds and their fields are listed), and an upgrade step per
schema change that turns version n into n+1 on open, run in a chain.
A test opens a small corpus of real old files, starting with the round
boards above, and checks every one still opens, type-checks and gives the
same `main`. A change that alters node shapes then has to write its step
to pass the test. Std definitions whose meaning changes (not just their
name) get the same treatment: either a new id (the old one kept, marked
superseded) or an upgrade step, never a silent change under the old id.

**Cost of waiting.** Each shape change made without a step leaves a
generation of files that can't be opened, and the person finds out only
when they open one. Once others share programs (SHARING.md), it is their
work that's lost. Writing the chain now costs one PR; reconstructing
steps for changes already made means reading git history.

**Prior art.** Database schema migrations as numbered steps run in order
(Rails Active Record migrations); Protocol Buffers' rule that a field's
number is never reused; Unison keeps every definition by hash so old
code keeps meaning what it meant (SHARING.md already cites Unison).

## 2. A page can run script through attributes

**What's there.** A page's attribute is `property(name, value)`, and
ters/src/lang/html.ts sets any name to any value with `setAttribute`
(html.ts around line 167). Text children go through `textContent`, which
is safe. But a program that puts text the user typed (or text it fetched)
into `href` or `src` lets `javascript:…` run, and an attribute named
`onclick` or `onerror` set from data runs it too. WEB.md says "every
attribute the browser has is reachable".

**Why now.** It is a bug in the website target, cheap to fix while the
page runtime is small, and the fix is a rule of the language's own: an
event is `on(…)`, never a string attribute. Phone apps built with
`lab build-app` inherit it.

**What to do.** In html.ts (and the static HTML `lab run` and
`lab build-web` print): refuse attribute names starting with `on`, and
refuse or neutralise `javascript:` (and `data:` other than images) in
`href`, `src`, `action`, `formaction`. Say so in WEB.md. A test with each.

**Cost of waiting.** Low to fix at any time, but every website built in
the meantime carries the hole, and people learn to rely on string
handlers.

**Prior art (influence).** Elm's virtual DOM drops `on*` attributes and
`javascript:` URLs set as attributes (elm/virtual-dom, Evan Czaplicki);
React warns on and blocks `javascript:` URLs.

## 3. No license

**What's there.** The repo has no LICENSE file, and ters/package.json is
the npm package "ters". Without a license, nobody else may legally use,
copy or change the code, whether or not the repo is public. It already
carries adapted code with its own notices (V8's port of fdlibm with Sun's
notice, CREDITS.md), which is fine, but the project's own terms are
missing.

**Why now.** Choosing is free while there is one author. Changing a
license later needs every contributor's agreement.

**What to do.** Ersagun picks. Common choices for a language: Apache-2.0
(permissive with a patent grant; Rust, Swift and Kotlin use it, Rust as
MIT or Apache-2.0), MIT (shortest), or a copyleft like MPL-2.0. Separately:
whether programs written in Ters and the examples carry the same license
(most languages leave the user's programs alone and put examples under a
permissive license). Row P8 adds the file once he chooses.

## 4. Text: equality, case and Turkish I, graphemes

**What's there.** Text is a JS string. `length` counts code points
(text.ts), order compares code points. No case mapping, no
normalisation, no grapheme clusters (proposed in LANGUAGE-NEEDS-2026-10-24
§ text and never made a row).

**The blind spots.**
- **Equality.** "é" typed as one code point and as "e" plus a combining
  accent are different Text and different hash keys. Text that arrives
  from the world (a fetch, a field the user types into, a file) can be
  either. Decide: normalise to NFC where text enters from the world, so
  equality inside the language stays plain code-point equality.
- **Case.** When upper and lower case arrive, they must take the
  language as an input: Turkish dotted and dotless i (`i` → `İ`,
  `ı` → `I`) is the classic case-mapping bug, and the language is named in
  Turkish. JS's `toUpperCase` is locale-free; `toLocaleUpperCase` reads
  an ambient locale, which a language built on effects shouldn't do
  silently. A locale is either a plain argument or a world effect.
- **Graphemes.** A flag or an emoji with a skin tone is several code
  points; cutting text for a phone screen by code points splits them.
  A `graphemes(t)` beside `characters(t)`.
- **Order for people.** Sorting names for a user needs a collation
  (Turkish puts ç after c, ğ after g); code-point order stays the
  structural order (L66) and a collation is another order, by locale.

**Cost of waiting.** Normalisation decided after programs store text
means old stored keys no longer match new ones; that is a migration of
user data.

**Prior art.** Swift's String (graphemes as its characters, canonical
equivalence for `==`); Unicode UAX #15 (normalisation), UAX #29
(grapheme clusters), CLDR collation; ICU.

## 5. Effect rows as permissions

**What's there.** A definition's row already lists what it may do to the
world: print, fetch, time, random, storage, Abort. The editor opens any
program file (Open file) and runs its main when asked; `lab run` runs
anything. Fetch reaches any address.

**The idea.** The rows are capabilities already: nothing in the language
reaches the world except through an effect a host answers. So show them
before a program from elsewhere first runs ("this program can fetch from
the network and keep data in this browser"), and let a host answer only
what was allowed: `lab run --allow fetch=example.com`, an editor setting
per opened file. That is a security story most languages can't tell,
and it costs little because the rows exist.

**Why soon.** It should exist before SHARING.md's sharing does; it is
cheaper to build the rule "a host answers only what was granted" into
hosts.ts now than to add it to every host later.

**Prior art (influence).** Object capabilities (Mark Miller's E
language, Wyvern's effect-based capabilities); Deno's `--allow-net` and
friends; Koka's rows as the type-level list of what code may do.

## 6. Record and replay through the effect log

**What's there.** Values on wires (trace.ts) shows one definition run on
example inputs. Pig has a recording handler; AUDIO.md mentions record
and replay. There's no general way to take a run that went wrong (a page
after twenty clicks, a fetch that answered oddly) and run it again
exactly.

**The idea.** Every answer from the world passes through a handler. If
the host keeps a log of what each world effect answered, any run can be
replayed exactly, stepped back through, or turned into a test whose
inputs are that log (T7's accepted answers). Time travel comes nearly
free for a language whose effects are the only door to the world, which
is something to show off.

**Why design now.** Effects are still moving (L54 answered later, L149
branches, L150 tickets, foreign definitions answered by JS). A rule now,
"every world answer goes through one log a host can keep", is one
sentence in HOSTS.md; after a dozen hosts each answer effects their own
way, it is a dozen retrofits. Fibers (L60) make the order of answers part
of the log, so the seeded scheduler from LANGUAGE-NEEDS belongs in it.

**Prior art.** Elm's time-travel debugger (Laszlo Pandy, 2014, on Elm's
signals); Mozilla's rr (record and replay at the system-call boundary);
Redux DevTools; FoundationDB's deterministic simulation (already cited
in LANGUAGE-NEEDS).

## 7. Performance that changes silently

**What's there.** The compiler chooses representations and ways (no
explicit selection, Ersagun 2026-10-30), with costs on a big-O ladder
(cost.ts). E159 shows the chosen representation in a type's panel.

**The blind spot.** Because the choice is the compiler's, a small edit
elsewhere (a use that needs `at(i)` on a list stored as cons cells) can
flip a choice and make a program much slower, with nothing on screen
saying so. The person can't pin it (by design), so the editor has to
explain it: when an edit changes a definition's cost order or a type's
chosen representation, say so next to the edit ("sum of prices is now
linear: `at` on List is stored as cells because of `prepend` in add
item").

**Cost of waiting.** Medium. Without it, the first slow program becomes a
guessing game, and "the compiler chooses" reads as "the compiler is
unpredictable", which undercuts the design's main claim.

**Prior art (influence).** SQL's EXPLAIN for query plans the database
chose; GHC's rewrite-rule fusion, known for failing silently (its
`-ddump-rule-firings` exists because of that); Halide's split of what a
program computes from how (Ragan-Kelley et al., 2013).

## 8. Error messages as a designed set

**What's there.** The checker's messages are written well, in plain words
at the node (infer.ts has about a hundred `err(` sites), and the checker
keeps going after an error. But they're scattered strings: no list of
them, no test that each can still be reached, no "how to fix it" beside
them, and nothing that keeps their tone when ten lanes add more.

**What to do.** One table of problems (an id, the message, a sentence on
the usual fix, and when there is one, the editor gesture that fixes it),
and a test per problem with the smallest program that shows it. A
projectional editor can offer the fix as a button where a text compiler
can only describe it.

**Cost of waiting.** Linear in messages, so not catastrophic, but each
week adds more and the people who'll read them first are learning the
language (Ersagun's learning thread).

**Prior art (influence).** Elm's "Compiler Errors for Humans" (Evan
Czaplicki, 2015); Rust's error index and `rustc --explain`; Hazel's
typed holes and error marks that never stop the editor (Omar et al.).

## 9. Dates, times, durations

**What's there.** Time is milliseconds from a world effect; there's no
date, time zone or duration type. units.ts has units of measure.

**Why before apps.** Every website and phone app shows dates, and the
classic bugs (time zones, daylight saving, months of different lengths,
mixing an instant with a wall-clock time) come from a muddled first
design that can't be taken back. Units of measure already exist, so a
Duration is nearly there; an Instant, a calendar date and a time zone
are separate types, and "now" and the local time zone are world effects.

**Prior art (influence).** java.time (JSR-310, Stephen Colebourne, after
Joda-Time); JavaScript's Temporal proposal; both keep instants, dates and
zoned times as different types.

## 10. Accessibility of the editor and of pages

**What's there.** A few `aria-` attributes in editor/main.ts. No QA pass
has checked keyboard-only use or a screen reader.

**Why it matters.** Text code works with a screen reader for free; a
projectional editor doesn't, and blind and low-vision programmers can't
use most block editors for that reason. Pages made with Ters inherit
whatever the language makes easy: if `element` makes labels and roles as
easy as styles, generated sites are accessible by default.

**When.** Retrofitting into one 4,589-line main.ts is costly; doing it as
part of E228's split, one part at a time, is cheap. Add keyboard-only and
screen-reader checks to the daily QA practice's format.

**Prior art.** Milne and Ladner, "Blocks4All: Overcoming Accessibility
Barriers to Blocks Programming for Children" (CHI 2018); Microsoft's Code
Jumper; WAI-ARIA tree and grid patterns.

## Later, no rows

**11. Names in more than one human language.** Names are already a layer
apart from ids (files carry `names`), so a program could carry Turkish
and English names for the same definitions, and std could be read in
either. Cheap to keep possible: never let a display name become an id.
Prior art: Hedy (Felienne Hermans) teaches with keywords in many
languages; Scratch's blocks are translated; Unison keeps names apart from
hashes.

**12. Hard real-time audio.** The pedal runs in an audio worklet, where a
block must finish in about 3 ms and never wait for a collector or a
lock. Nothing checks that a sound's per-block work allocates nothing.
When the pedal is a goal again, a check on the compiled worklet (or a
row that means "bounded, no allocation") is the way. Prior art: Faust's
guarantees for signal processors; Clang's RealtimeSanitizer and
`[[clang::nonblocking]]`.

**13. Reading a change in review.** A saved program is JSON with node ids;
a change shows up in GitHub as JSON. A `lab diff` that prints changed
definitions as text, matched by hash, would make Ters programs
reviewable in pull requests. SHARING.md §6 covers storage; this is the
reading side. Prior art: Unison's namespace diff; GumTree (Falleri et
al., 2014) for tree diffs.

**14. Numbers that differ between browsers and GPUs.** WASM and C use V8's
fdlibm, so Node, WASM and native agree. Firefox's and Safari's `Math.sin`
are not V8's, and shaders' `sin` is the GPU's. An accepted answer stored
by T7's tests can then differ by a last bit on another browser. When it
bites: compiled JS can call the same fdlibm port, and tests compare
floats within a stated tolerance where a GPU is involved.

## Not blind spots, checked

- **Deep recursion** is known: COMPILER.md's "recursion still uses the
  stack", I154 for long written lists.
- **Memory on native** is reference counting with reuse (NATIVE.md,
  Perceus); cycles can't form while values can't change. Recursive lets
  (L84) and stable references should keep that true; worth a sentence in
  STABLE-REFERENCES.md when L99 lands.
- **Tests in the language** have a design (T7), including where inputs
  come from.

## Credits

Prior art and influences named above, all cited as influence or prior
art, nothing adapted as code: Rails migrations; Protocol Buffers;
Unison; Elm's virtual DOM and compiler errors (Evan Czaplicki); React;
Swift's String; Unicode UAX #15 and #29, CLDR, ICU; Mark Miller's E;
Wyvern; Deno; Koka; Elm's time-travel debugger (Laszlo Pandy); rr;
Redux DevTools; FoundationDB; SQL EXPLAIN; GHC; Halide (Ragan-Kelley et
al.); Rust's error index; Hazel (Omar et al.); java.time (Stephen
Colebourne), Joda-Time, TC39 Temporal; Blocks4All (Milne and Ladner);
Code Jumper; WAI-ARIA; Hedy (Felienne Hermans); Scratch; Faust; Clang's
RealtimeSanitizer; GumTree (Falleri et al.). This is a review, so per
the attribution rule these go in this doc and its PR; whichever of them
shapes a built feature gets its line in docs/language/CREDITS.md then.
