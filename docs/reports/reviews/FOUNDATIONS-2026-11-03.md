# Foundations and maintainability, 2026-11-03

Written 2026-11-03 at `87979f3` (after PR #1249), at Ersagun's ask: "We are
at the start of developing this language and if we are putting ourselves in
a corner in terms of maintainability now, it will only get worse ... kill the
snake while it's still small." Two questions:

1. **Foundations.** Do the core decisions match the goals in the README?
   A serious language for programs, shaders, websites, mobile and audio; one
   uniform system with no special node kinds; the compiler choosing
   representations; effects as the base for concurrency; simple ideas in the
   language with target quirks kept out; adjacency over nesting.
2. **Maintainability.** Duplicated paths, changes that touch very many
   sites, special cases, module boundaries, the test setup, and how fast
   complexity grows.

Findings are ranked by **how much more they cost to fix later than now**,
not by how bad they are today. Nothing is fixed here; the rows are at the end
and in BACKLOG.md. The Language lane is merging `call` and `solve` (L130d)
while this was written, so its files were read, not touched.

**How it was checked:** the code was measured with grep and git (numbers
below are reproducible with the commands in "Method"), the hash was probed
with small hand-built programs run against `ters/src/hash.ts`, and
`test/affected.ts --list` was run on one-line edits of core files. No
browser, no suites run in full.

## The verdict, first

The foundations are mostly right, and better than the speed of the work
would suggest. The model is small (17 node kinds), flat, id-keyed and
name-free; builtins already have one record per target (L7); the
representation layer exists and is written in the language; effects are in
the types and concurrency is built on them; hashing by content is in from
the start. None of that needs undoing.

The snake is in three places, and all three get more expensive with every
PR:

1. **The node's shape is written out by hand in many places, and they
   have drifted.** The hash, the "children" walkers and the copiers each
   list a node's fields themselves. The hash has already missed several:
   an effect, an interface and a plain data type of the same shape hash the
   same; a definition with results hashes the same as one without; a
   literal match arm is hashed by its node id, so changing its value
   doesn't change the hash, and `lab test` keeps the old result (§1). Every
   saved program and published module carries these hashes, so fixing them
   costs more each day.
2. **The language's meaning is written about six times.** The evaluator,
   the partial evaluator (staging), running backwards, the search modes,
   compiled JavaScript straight from the model, and the shared lowering
   that WebAssembly, C, WGSL and a second JavaScript printer use. Compiled
   JavaScript doesn't go through the shared lowering, and the most
   important representation (lists as arrays) lives as special code in it
   instead of in the representation layer (§2, §3). Each feature is built
   once per path, which is where R8's "finite Float64 built five times,
   three meanings" came from.
3. **The test selection has stopped selecting.** A one-line change to
   `text.ts`, `cells.ts` or `model.ts` runs 135 to 145 of 150 ters test
   files and all 44 compiler ones, because `std.ts` both declares every
   builtin and imports their implementations (§5). So the main check runs
   about 20 minutes and is cancelled more often than it finishes (I110).

Fix now: §1 (P1, a bug), the L130d question in §4 (it is decided the day
the flip lands), §5 (cheap), and a rule that stops §2 and §3 from growing
while they are paid down.

## Ranked

| # | finding | cost later | fix now? | row |
|---|---|---|---|---|
| 1 | Node shape listed by hand; the hash misses meaning (bug) | grows with every saved program, module and new attribute | **yes** | L178 |
| 4 | L130d keeps `binds` + `body` (nesting) where a tuple of results would do | fixed the day the flip lands in the saved format | **decide now** | L179 |
| 5 | `std.ts` joins declarations and implementations; affected runs ~everything | grows with every test file | **yes** (M) | L180 |
| 2 | Six meaning paths; JS bypasses the shared lowering | grows with every feature × target | **start now**: rule + first step | C137 |
| 3 | Lists as arrays outside the representation layer | grows with every target and list optimisation | after C137's first step | C138 |
| 6 | Written lists are nested calls; every pass recurses (I154) | grows with data-heavy programs and with each new pass | soon | L181 |
| 7 | Library types named in core passes (compile 188, scalar 152, run 82 sites) | grows with every library type the compiler learns | with C137 | C139 |
| 8 | Flags as hidden node kinds (`effect`, `interface`, `row`, `way`, `direction`, `results`, …) | grows with each new flag | rule now, merge with L128d/L130 | L182 |
| 9 | Whole-program check per edit; freezes recur (I157, I158, E103) | grows with program size | after L178 (needs a sound hash) | L183 |
| 10 | Pace: +6,000 source and +4,600 test lines a day, no consolidation share | compounding | **yes** (process) | P7 |
| 11 | `editor/main.ts` 4,589 lines, 254 kind tests | grows slowly | later | E228 |
| 12 | The library is written in TypeScript, not in the editor | low: publishing is by hash | later | none |

## Part 1: foundations, goal by goal

| goal | what's there | verdict |
|---|---|---|
| **Programs are trees, names apart** | `model.ts`: 17 kinds in a flat id map; names, comments and notation in side tables | Right. Keep. |
| **One uniform system** | 17 kinds is small. But several kinds carry optional flags that act as sub-kinds (§8): a typedef is a data type, an effect, an interface or a row; a def is a value, a way, a direction or a relation with results | Held by the letter, slipping in spirit. Each flag is read in 7 to 29 files. |
| **Definitions run both ways** | `call`/`solve` merging (L130); ports and tuples (L128); `relate.ts` (2,010 lines), `modes.ts` (997), `solve.ts`, `results.ts`, `directions.ts`, `ways.ts`, and `invertible/` | Right direction. L130 is the right merge; §4 asks one question about its shape. After it, `def.results`, `def.direction` and `field.results/ports` should fold into ports too (L128d does the fields). |
| **The compiler chooses representations** | `represent.ts` + `library-reps.ts`: representations written in the language, chosen by cost; Map/Set/Nat use it on every target | The layer is right. Its most important case, lists as arrays, is outside it (§3), and NUMBERS.md says so. |
| **Effects in the types, concurrency on effects** | handlers, rows, answered-later, together/race as prelude handlers (L149/L150 done) | Right. The cost is that handlers are implemented per engine (`run.ts`, `runtime.js` + `compile.ts`, the WebAssembly handler stack, C), which is §2. |
| **Targets don't bend the language** | builtins one record per target (`compiler/src/builtins.ts`); hosts (L69) | Mostly held. Where it slipped (overflow, R8 §1), it slipped because the meaning is written per engine, §2 again. |
| **Adjacency over nesting** | the graph editor draws adjacency; the model nests where `solve` has a `body` and lets are lambdas | §4: the merged use is the moment to drop the one nesting that isn't needed. |
| **A serious language: five legs** | programs strong; shaders strong; web strong; audio built; mobile (`lab build-app`) never reported run on a phone (R8 §4) | On course. Mobile is the thin leg, but it is packaging, not a foundation. |
| **Tests in the language** | T7 `Check`, `lab test` cached by hash | Right, but the cache is only as sound as the hash (§1). |

## 1. The node's shape, written by hand, and the hash (P1, fix now)

`model.ts` defines the node kinds once, but nothing derives from that
definition. Each of these lists a node's parts by hand:

- `children` in `model.ts` (with `default: return []`, so a new kind or
  field silently has no children),
- `kids` in `hash.ts`, in `infer.ts` and in `counting.ts`, each a different
  subset (`hash.ts` leaves out `lambda.results`, `variant.returns`,
  `arm.value`; `infer.ts` and `counting.ts` leave out binders and types on
  purpose),
- `canon` in `hash.ts`, which decides what is meaning,
- copiers and id maps (`mapIds`, the DSL, `refactor.ts`, the loader),
- 2,805 `case "kind"` / `kind === "kind"` tests across ters, the compiler
  and the editor.

**What has drifted.** Probed with hand-built programs against
`hashDef` (Method, below):

| change | hash changes? | should it? |
|---|---|---|
| a typedef marked `effect: true` | no | yes: an effect and a data type are different things |
| marked `interface: true` | no | yes |
| an operation's `returns` type, `later`, `private` | no | yes: the operation's type and who may build it |
| a def's `results` (which ports it gives) | no | yes: a function and a relation over the same body |
| a def's `direction`, `way`, `cost` | no (not read) | `direction` and `way` yes; `cost` arguable |
| a literal match arm's value, 1 → 5 | **no** | yes |
| the same literal match, written twice with other ids | **yes** | no |

The last two are the sharpest: an arm on a literal (L164c) is hashed by its
node id (`part()` falls through to `["extern", id]`), not by its value. So
`lab test` (`.lab/checks.json`, results kept by hash) keeps a passing result
after the value is edited, and two people writing the same match get two
hashes. Publishing (`modules.ts`) dedupes by hash, so an effect and a data
type of the same shape in two modules could be taken for one.

**Why now.** Every saved program, every published module and the editor's
saved drafts carry ids derived from these hashes. Each day adds more of
them, and each new optional attribute is another chance to forget the hash.
The hash is also what an incremental checker (§9) and sharing
(SHARING docs) would key on, so both need it sound first.

**Fix (L178).** One schema table in `model.ts`: per kind, its child slots
(expression, binder, type, case), its meaning-bearing attributes, and its
presentation-only ones. `children`, the walkers' `kids`, `canon`, `mapIds`
and the copiers read it. A test walks every kind and attribute in the
`Node` type and fails if one isn't classified, so a new flag can't be added
without saying whether it is meaning. Then the hash covers the attributes
above, and `onTodaysIds` moves saved programs to the new ids, as renames do
now. Wait for L130d to land first (it changes the same file), then do it
before anything else in the Language lane.

## 2. The meaning is written six times (start now, L)

| path | file(s) | lines | what it walks |
|---|---|---|---|
| evaluator | `ters/src/lang/run.ts` (+ `std.ts` implementations) | 1,156 | the model |
| partial evaluator (staging) | `stage.ts` | 797 | the model |
| running backwards | `relate.ts`, `invertible/` | 2,010 + | the model |
| search modes | `modes.ts` | 997 | the model |
| compiled JavaScript | `compiler/src/compile.ts` + `runtime.js` | 3,435 + 811 | **the model, directly** |
| shared lowering | `scalar.ts` → `wasm.ts`, `c.ts`, `wgsl.ts`, `js-scalar.ts` | 2,297 → 828, 1,604, 863, 166 | its own `Lowered` form |

So there are already two JavaScript backends (`compile.ts` and
`js-scalar.ts`), and the fullest compiler, `compile.ts`, has its own lowering
with 358 kind tests, separate from the one the other targets share. Each
feature is written in the evaluator, then in `compile.ts`, then in
`scalar.ts` (and often again in `c-rt.ts`/`wasm-rt.ts`). R8 §1 is the
example: finite Float64 built five times with three meanings.

The evaluator, staging, relate and modes are honestly different jobs
(running, specialising, solving, searching); they share the model and
that's fine. The duplication worth removing is **two lowerings for the
compiled targets**. The shared one (`Lowered`) has grown past its "scalar"
name: it now has data, closures, handlers, lists, Int and text on
WebAssembly and C.

**Fix (C137), in steps.** (a) Rule from today: no new feature or
optimisation goes only into `compile.ts`; it goes into a model-to-model pass
(as `liftLets`, `expandInverses`, `fuseHandlers` already are) or into the
shared lowering. (b) Rename `scalar.ts`'s `Lowered` to what it is (the core
IR) and write down its contract. (c) A JavaScript printer from the core IR,
grown until it runs the examples `compile.ts` runs, measured against it
(I111's agreement test and the R8 differential test are the check). (d)
`compile.ts` retires piece by piece. This is several PRs; what matters now
is (a), because every PR that adds to `compile.ts` makes (c) longer.

## 3. Lists as arrays sit outside the representation layer (C30, raised)

NUMBERS.md "Not yet" says it: lists as arrays are "a compiled-JavaScript
trick, outside the layer". In `compile.ts` that is 50 places that test for
`CONS`/`NIL`/`LIST` by id, and the same idea was then built again for
WebAssembly and C (C30d2, C30d3c) and for the evaluator (C30d3a). This is
the goal "the compiler chooses representations" with its main example
hard-coded. C30's aim (an `array` representation written in the language,
chosen by the same chooser as Map and Set) is the fix; it should move ahead
of the split/join/block stages that are waiting in C30 and be done on the
core IR from §2, so each target gets it once.

## 4. The merged use (L130d): a body, or a tuple? (decide before the flip)

PORTS §3 plans the merged `call` as: `fn`, and either `args` by position,
or `given` by name with `binds` and a `body` that uses the bound ports. The
`body` is a scope: the produced ports are only visible inside it. That is
nesting, the shape Ersagun prefers to avoid.

With L128 in, a function can already give several results as a tuple, read
by port name (`r.angle`). So a use run in another direction could simply
**give its produced ports as a tuple**, like any function with several
results, with `Choice` in its row when there may be none or several (as
`solve` has today). Then the merged node is `fn` plus the given ports, no
`binds`, no `body`, and the results flow out as wires, which is how the
graph draws them anyway. A `solve` with a body is then just a use whose
tuple is bound by the existing let form.

This isn't a finding against L130, which is the right merge. It's a
question for it, and the answer is fixed in the saved format and the hash
the day L130d lands. It may have reasons this doc can't see (the body is
also where a search's answers are enumerated). Row L179 asks the Language
lane to decide it, in writing, before the flip.

## 5. `std.ts` is a hub, so every test runs (fix now, M)

`std.ts` declares every builtin's id and type, and imports the
implementations (`int.ts`, `text.ts`, `algebraic.ts`, cells through
`run.ts`). 69 files import it. So `test/affected.ts` measured on one-line
edits:

| file edited | ters tests run | compiler tests run |
|---|---|---|
| `src/model.ts` | 145 of 150 | 44 of 44 |
| `src/lang/text.ts` | 145 of 150 | 44 of 44 |
| `src/lang/arith.ts` | 136 of 150 | 44 of 44 |
| `src/lang/cells.ts` | 135 of 150 | 44 of 44 |
| `src/lang/audio.ts` | 7 of 150 | none |
| `compiler/src/c.ts` | 1 | 6 of 44 |

Targets select well; the language core selects nothing, and it is where
most work is. Test code grew from 12,000 to 28,200 lines in eight days.

**Fix (L180).** Split `std.ts` into the ids and signatures (what the
checker, the compilers and the editor import) and the implementations
(what the engines import). Then a change to how text is cut runs the tests
that run text, not the checker's. Measure with `affected --list` before and
after. This also takes most of I110.

## 6. Written lists are nested calls, and every pass recurses (I154, soon)

A list written out with 1,000 items overflows the stack in `infer.ts`,
because it is 1,000 nested `cons` calls and every pass (checker, evaluator,
staging, compilers, hash) recurses into it. Making every pass iterative is
many PRs and has to be remembered in every new pass. The uniform fix is
PORTS §4's variable number of inputs: a written list is one call to the
list maker with n inputs, no new node kind, depth 1. Row L181 (the fix
for the Inbox's I154).

## 7. Library types named inside the core passes

References to particular library constructors and builtins by id
(`CONS`, `NIL`, `BOOL`, `UNIT_V`, `SOME`, `S.*`, `INT_OPS.*`, …): `compile.ts`
188, `scalar.ts` 152, `run.ts` 82, `editor/main.ts` 23, `typed.ts` 21. Some
are honest (Bool as a JavaScript boolean is a representation). Most are
representation choices or optimisations keyed on one library type, which is
the special case the uniformity rule is about. L7 already moved builtins'
per-target code into one record; the same move for library types is: a
representation (§3) or a builtin record, never an id test in a pass. Row
C139, done as part of C137's printer so the old sites retire with
`compile.ts`.

## 8. Flags as hidden kinds

| flag | sites | files |
|---|---|---|
| `.results` | 184 | 29 |
| `.effect` | 71 | 24 |
| `.row` | 49 | 14 |
| `.interface` | 33 | 12 |
| `.cost` | 32 | 8 |
| `.later` | 30 | 17 |
| `.direction` | 24 | 7 |
| `.same` | 24 | 12 |
| `.way` | 17 | 10 |
| `.ports` | 14 | 7 |

Flags aren't wrong; an effect really is a typedef whose cases are
operations. The risk is that each new flag is a new special case every pass
must remember, with nothing to say it forgot (§1 is what forgetting looks
like). Row L182: (a) every new attribute goes through L178's schema; (b) as
L128d and L130 land, `def.results`, `def.direction` and `field.results/
ports` become ports on the definition's type, so three of these flags go.

## 9. The editor checks the whole program on each edit

The editor's freezes keep coming back after each speed-up: I157 (+ New
definition 3 to 5 s), I158 (opening a definition 1 to 2 s), E103 (backwards
holes), E200. `infer` is called from 89 places in 30 files and mostly
checks the whole program. Content-addressed definitions are the natural
cache key: a definition group whose hash and whose dependencies' types are
unchanged needs no new check. That needs a sound hash (L178) first. Row
L183, a design note before code.

## 10. The pace (process)

| | 10-22 | 10-26 | 10-29 | 11-01 | 11-03 |
|---|---|---|---|---|---|
| source lines (ters/src, compiler/src, editor; generated math excluded) | 6,800 | 35,300 | 40,700 | 47,100 | 59,200 |
| test lines | 650 | 12,000 | 14,900 | 19,000 | 28,200 |
| Markdown lines | 1,000 | 13,800 | 16,000 | 19,900 | 26,000 |

195 PRs merged in the last 24 hours. Every lane's queue is features and
fixes found by programs; reviews refill those queues. No lane owns paying
complexity down, so it is paid only when a feature forces it (as L130 did).

**Proposal (P7).** (a) Each lane takes a foundation row (this doc's, or a
later one's) as every fourth item. (b) The weekly review keeps three
numbers next to its size table: kind tests across the code (2,805 today),
tests reached by a one-line edit of `text.ts` (145/150 + 44/44 today), and
files that read a node kind's field (L130's "129 places read solve, about
300 read call"). If they rise while features land, the next foundation row
moves up.

## 11, 12. Smaller, later

- **`editor/main.ts`** is 4,589 lines with 254 kind tests and 349
  functions, plus E205 (examples wired by hand). L178's schema lets the
  palette and inspector read node shapes instead of switching on them.
  Split by job (selection, palette, run, files) when the Editor lane next
  has room. Row E228, P3.
- **The library is written in TypeScript** (`prelude-source.ts` 2,047
  lines, trees, vectors) through the DSL, not in the editor. Publishing is
  by hash, so moving it later costs little. No row now; worth one when the
  editor can comfortably hold a 2.6 MB module.

## What not to change

- The flat id-keyed model with names apart. It's why renames, views and
  hashing are cheap.
- One record per builtin per target (L7). §7 extends it; it doesn't
  replace it.
- The representation layer written in the language. §3 is about using it
  for lists, not replacing it.
- Effects as the base for concurrency (together/race as prelude handlers).
- One backlog, three lanes, one change per PR.

## Rows (also in BACKLOG.md), in fix order

| order | id | lane | item | pri | size |
|---|---|---|---|---|---|
| 1 | L179 | L | Before L130d lands: decide whether a use in another direction gives its produced ports as a tuple (no `binds`/`body`) or keeps the body; write the reason in PORTS §3 | P1 | S |
| 2 | L178 | L | **Bug.** One node schema in model.ts (child slots, meaning and presentation attributes) that `children`, the walkers, the hash and the copiers read, with a test that every attribute is classified; then the hash covers `effect`, `interface`, `returns`, `later`, `private`, a def's `results`/`direction`/`way`, and a literal arm's value (not its id); saved programs moved by `onTodaysIds`. After L130d | P1 | M |
| 3 | L180 | L | Split std.ts into ids and signatures, and implementations; `affected --list` on text.ts/cells.ts measured before and after (today 145/150 + 44/44). Takes most of I110 | P1 | M |
| 4 | C137 | C | The compiled targets on one lowering: (a) from now on nothing goes into compile.ts alone; (b) scalar.ts's `Lowered` named and documented as the core IR; (c) a JavaScript printer from it, grown until it runs compile.ts's examples, checked by I111 and the differential test; (d) compile.ts retired piece by piece | P2 | L |
| 5 | C138 | C | C30's `array` representation written in the language and chosen by the representation layer, on the core IR, replacing compile.ts's 50 CONS/NIL sites and the per-target copies (raise C30's aim ahead of its split/join stages) | P2 | L |
| 6 | L181 | L | A written list is one call to the list maker with n inputs (PORTS §4), so a 1,000-item list is depth 1 in every pass (I154) | P2 | M |
| 7 | P7 | coordinator | A foundation row every fourth item per lane; the weekly review tracks kind tests, tests reached by a text.ts edit, and readers of a kind's fields | P2 | S |
| 8 | C139 | C | Library types out of the core passes: every id test on a library constructor in compile.ts/scalar.ts/run.ts becomes a representation or a builtin record (with C137's printer) | P3 | M |
| 9 | L182 | L | Flags through the schema; `def.results`, `def.direction`, `field.results/ports` become ports (with L128d, after L130) | P3 | M |
| 10 | L183 | L | Design note: checking per definition group, cached by hash and dependencies' types, for the editor's freezes (I157, I158, E103). After L178 | P3 | L |
| 11 | E228 | E | editor/main.ts split by job; palette and inspector read L178's schema instead of switching on kinds | P3 | L |

## Method

```
# kind tests across the code
grep -rhoE '(case "[a-z]+"|kind [!=]== "[a-z]+")' ters/src ters/cli ters/mcp compiler/src editor --include=*.ts | wc -l
# flags
grep -rhoE '\.results\b' ters/src ters/cli ters/mcp compiler/src editor --include=*.ts | wc -l
# library ids in a pass
grep -oE '\b(CONS|NIL|LIST|BOOL|TRUE|FALSE|UNIT_V|SOME|NONE|…|S\.[a-zA-Z]+|B\.[a-zA-Z]+|INT_OPS\.[a-zA-Z]+)\b' compiler/src/compile.ts | wc -l
# test reach of a one-line edit
echo '// x' >> ters/src/lang/text.ts; (cd ters && node test/affected.ts --list); git checkout ters/src/lang/text.ts
```

The hash probes build a one-definition `Code` by hand (a typedef with one
variant, then the same with `effect: true`, `interface: true`, a variant
`returns`/`later`; a lambda def with and without `results`; a match with one
literal arm, its value changed and its ids changed) and print `hashDef`.
