# Backlog

Every open item from every source (Ersagun's asks, reviews, QA passes,
bigger-program rounds, design notes), in one place. Finished items are in
[DONE.md](docs/process/DONE.md). How items are picked and run is in
[WORKFLOW.md](docs/process/WORKFLOW.md); every doc is listed in [the docs index](docs/README.md).

Each lane's items are grouped by theme. Within a lane, priority (P1 first)
decides what's next, and "Next up" below names it in a line: what's next,
never what's done (that goes to DONE.md).

**Priority:** P0 broken now · P1 blocks the current step or Ersagun asked ·
P2 next steps · P3 nice to have. Within a priority: bugs, then removing a
special case, then what lets programs be written in the editor, then
language, then more targets or speed (WORKFLOW.md "Priority").
Rows once held back as later goals are open again (Ersagun 2026-11-09):
a lane takes them when bugs and goal rows are in hand.
Focus since 2026-11-10 14:49 (Ersagun): finish stable references, free lists and multithreading (P1 rows C58, C60, C61, C43; C42, C57, C59 and C200 closed 2026-11-12 as waiting for an example, DONE.md); mobile rows are down to P3.
Defaults first (Ersagun 2026-11-10 15:34): "I want the default compiled code to be as close to a C/C++ dev doing data oriented design and cache and memory aware as possible. And then if we need Pools and similar stuff to get a last 10 percent of performance that's OK, but the defaults should be our first target." So rows that change what every program gets (layout as columns, arrays written in place, records changed in place, work on every core) go before ones a program must ask for (a Pool type).
**Size:** S hours · M one PR · L several PRs or a design note first.
**Status:** ▶ running · ⏸ held · blank = waiting.

## Next up

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | C58 (free lists; a Pool type asked of Ersagun); mobile rows wait. Then Language or Compiler rows agreed with those lanes |
| C Compiler and targets | "Compiler lane" | C187 is blocked on V8; C195 is done (#2515) |
| L Language and library | "Language lane" | the next goal row (stable references, free lists, multithreading) agreed with the lane that holds it; I203's editor half is with the Editor lane (L182 is with the Editor lane) |
| L Language and library | "Language lane B" | the next goal row agreed with its lane (C43's first on C waits for an example); round 12's I187 is with the Editor lane. Skip L107 (waits on Ersagun) and L24 (research). Take a row from another list only after telling that lane. |
| T Testing | "Replace the slow browser smoke test" | T15 (P0: Check main finishes), then I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I219 | What the full run fails on, on main (2026-11-12; draws fixed in I219a, board, effects and finite in I219b, lang.test's palette sweep, map-tree.test's timing and C42h's names in c-names.test in I219 part, palette in I219c, the editor's shaders ("process is not defined") in I219d, the smoke's first-steps check (it waited for main, but a first visit opens on fall since E235) in I219e, the rest of the smoke (Countdown's solutions read [] once relate's settles spent steps) in I219f, fixed.test's CORDIC and core-js.test's pig in I219 part 2, each file run alone; the nightly hasn't passed since 10-28): on CI resolve-once.test (a kept library resolving typed `List Case several` where it is `List a`), passing here; likely the same cause as CORDIC (a kept resolving read over another library check), fixed by part 2, for the next Nightly to confirm. | I208 | 2026-11-12 |
| I227 | Running a Number-generic function backwards throws the host's "The number 1.2 cannot be converted to a BigInt because it is not an integer" (`total price(net, rate) = net * (1 + rate)`, inferred `(a, a) -> a where a is a Number`; rate 0.2, result 300). Forwards works; writing `1.0` makes it Float64 and the backwards run answers 250. Bug: the backwards run should answer (or refuse in Ters's words, naming the type), and BACKWARDS.md say how a generic number type is solved. Suggested lane: Language | [OUTSIDER-WRITE-2026-11-13](docs/reports/reviews/OUTSIDER-WRITE-2026-11-13.md) §3.1 | 2026-11-13 |
| I228 | MCP `replace` with steps on lines inside a lambda (`all(() =>` then `a = one of(…)` on its own line): the steps don't bind ("nothing is named a here; did you mean p, i?") and the call takes 2 s with one step, 55 s with three (an outsider's call was killed after 120 s). Bug: steps inside a lambda read as at the top of a body (I217), in time that stays flat. Suggested lane: Language (ters/mcp/session.ts) | [OUTSIDER-WRITE-2026-11-13](docs/reports/reviews/OUTSIDER-WRITE-2026-11-13.md) §2.3 | 2026-11-13 |
| I229 | MCP `step(at, …)` puts the step before the whole chain the part is in, not before the part, so a sequence can only be built bottom-up and a step can't use the one before it; its "did you mean p, i?" names things not in the program. The step goes before the part named (or a `after` form), and suggestions come from what's in scope | [OUTSIDER-WRITE-2026-11-13](docs/reports/reviews/OUTSIDER-WRITE-2026-11-13.md) §2.2 | 2026-11-13 |
| I230 | Overloaded names in refusals: a 2-input `for each` call failing for another reason leads with "for each takes 3 inputs, given 2" (the page's Cell version), in the editor before the real reason and in MCP alone. The version whose input count fits leads the message, and MCP `defs` gives each version an id so it can be named | [OUTSIDER-WRITE-2026-11-13](docs/reports/reviews/OUTSIDER-WRITE-2026-11-13.md) §2.4 | 2026-11-13 |
| I231 | Reader errors name what they couldn't read: `if x == 1 then 2 else 3` in MCP `replace` answers just "a binder". Say which token, and for `==` that equality is `=`. Check the palette's reader gives the same | [OUTSIDER-WRITE-2026-11-13](docs/reports/reviews/OUTSIDER-WRITE-2026-11-13.md) §2.1 | 2026-11-13 |
| I232 | A page on the text you can type, shared by the palette and MCP `replace` (GUIDE §3 says only "a value" or "a short sum"): `=` for equality, `if … then … else`, `(x) => …`, `‹multi word›` names, `*` for `·`, steps on lines, records and fields. And the view reads back as it prints: `first(…, else x)` and `all(one of(…))` (typed as `() => …`) are accepted as written | [OUTSIDER-WRITE-2026-11-13](docs/reports/reviews/OUTSIDER-WRITE-2026-11-13.md) §2.1 | 2026-11-13 |
| I233 | MCP.md for a first program: making `main` (a function with no inputs), `‹›` around names with spaces, what `test`'s "(1)" counts (the CLI says "(1 cases)"), and `eval` of a bare name (now "a name alone is listed already") giving its value | [OUTSIDER-WRITE-2026-11-13](docs/reports/reviews/OUTSIDER-WRITE-2026-11-13.md) §2.1, §2.6 | 2026-11-13 |
| I234 | FizzBuzz needs `first`: `remainder(n, 3)` has Choice (no answer for 0) even when the divisor is a non-zero literal, so the commonest first program must handle a Choice it can't take. A divisor known not to be 0 gives no Choice, or the guide's first loop says why it does. Suggested lane: Language | [OUTSIDER-WRITE-2026-11-13](docs/reports/reviews/OUTSIDER-WRITE-2026-11-13.md) §2.5 | 2026-11-13 |
| I235 | Editor papercuts from writing a first program: an input whose type is still `a` is offered as `celsius(□)`, `celsius(□, □)`, `celsius(□, □, □)`; a new program stays "Untitled 1" and Save file names it `untitled-1.json` without asking; a backwards run shows only "Looking for an answer… Stop" (−40 for `celsius · 9 / 5 + 32` took about 10 s, though arithmetic is solved directly: check why); after a reload no hole is selected | [OUTSIDER-WRITE-2026-11-13](docs/reports/reviews/OUTSIDER-WRITE-2026-11-13.md) §2.6 | 2026-11-13 |

## E: Editor

### Bugs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Writing programs in the editor

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E257 | The graph's crossings (CONFUSING item 1): names drawn with a background so a wire can't cover them, and wires routed around nodes instead of under them. Seen 2026-11-13 in `rotate` unfolded: wires cross the frame edges and each other, and the inner frame's `for some` node is drawn over the first `polar`'s `x` input | [CONFUSING.md](docs/design/CONFUSING.md) item 1, checked 2026-11-13 (E256) | P3 | M | |
| E258 | Cases that are values drawn as values (CONFUSING item 2): a zero-input frame (an if's then and else, a case with no fields) drawn as just its contents, with no `() =>` box, unless it's an action given to a handler like `first` or `all`. Example: `queens`'s nil, then and else with no frames | [CONFUSING.md](docs/design/CONFUSING.md) item 2, checked 2026-11-13 (E256) | P3 | M | |
| E259 | Every output a dot (CONFUSING item 3): a node's output is the same dot a let has, so sharing a value is one more wire from it, not a gesture that makes a dot. Example: `queens` with its outputs as dots and nothing else changed | [CONFUSING.md](docs/design/CONFUSING.md) item 3, checked 2026-11-13 (E256) | P3 | M | |
| E260 | One `for some` for a frame's unknowns (CONFUSING item 5): `rotate`'s `for some((length) => for some((angle) => …))` drawn as one frame with two unknowns, each a dot labelled some, instead of two nested frames and two nodes. A view: the tree is unchanged | [CONFUSING.md](docs/design/CONFUSING.md) item 5, checked 2026-11-13 (E256) | P3 | S | |
| E261 | Effect row variables in words (CONFUSING item 7): a type shows `-[Choice, e]->` as `-[Choice, …]->` with "and the effects of f" on hover, so `newton`'s and Markov's `shown`'s types read without `e` | [CONFUSING.md](docs/design/CONFUSING.md) item 7, checked 2026-11-13 (E256) | P3 | S | |

### Speed of editing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E255b | `ters diff --from REV [--to REV]` through `git show`, and every changed program folder of a PR with `--from` alone. Example: pig across #2240 prints its handler change | [DIFF.md](docs/design/tools/DIFF.md); STANDING-2026-11-13 §6.7 | P3 | S | after E255a |
| E255c | The editor's Changes view: the program against the version it was opened as or the last one marked Reviewed, changed definitions listed, blocks and graph nodes marked added or changed. Example: a literal edited and a definition added in dice, both listed and marked | [DIFF.md](docs/design/tools/DIFF.md); STANDING-2026-11-13 §6.7 | P3 | M | after E255a |

### What a good language needs ([ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Plain words for newcomers ([OUTSIDER-READ-2026-11-03](docs/reports/reviews/OUTSIDER-READ-2026-11-03.md))

Rewrite only what the outside reader marked; the next outsider read checks it.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## C: Compiler and targets

New targets and speed rank below every language item (Ersagun,
2026-10-24 07:01). Measurements and rounds: docs/reports/GAPS.md.

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Memory and layout (STABLE-REFERENCES.md §3 to §6)

All invisible to programs: no annotations or hints (Ersagun 2026-10-29).

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Parallel and concurrent code on the targets

| id | item | source | pri | size | status |
|---|---|---|---|---|---|


### Mobile (Ersagun 2026-11-09: a goal; native compilation per platform a stretch goal, instead of a webview. Down since 2026-11-10 14:49, behind stable references, free lists and multithreading: "Platform stuff will eventually be solved anyway")

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### The spec ([SPEC](docs/language/SPEC.md) §12)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### What a good language needs ([ASPECTS-2026-11-03b](docs/reports/reviews/ASPECTS-2026-11-03b.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Compiled output without names or unneeded machinery ([DEBUG-AND-SPEED-2026-11-04](docs/design/targets/DEBUG-AND-SPEED-2026-11-04.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Someday

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## L: Language and library

Numbers first (Ersagun, 2026-10-24 07:01), then the rest of
LANGUAGE-REVIEW-2026-10-24. Anything that only adds a target ranks below
all of these.

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L243 | `agent` back in the engines' agreement test: compiler/test/core-js.test.ts skips it, because the evaluator (the reference) takes minutes on its A* search. Run it at a smaller size, as I202 did for swarm-pool, or make the evaluator fast enough through L118c's direct run | [STANDING-2026-11-13](docs/reports/reviews/STANDING-2026-11-13.md) §6.6 | P3 | S | |

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Ersagun's current asks

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Numbers (NUMBERS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Data and representations (DATA-STRUCTURES.md, REPRESENTATIONS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Effects and concurrency (ANSWERED-LATER.md, EFFECTS-REVIEW-2026-10-24)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L244 | `+` as one sum (CONFUSING item 9): `add`, `subtract` and `negate` are three built-ins, each with its own equation, where one relation `a + b = total` read in its directions would do (as `polar` is one relation); the names stay as the directions' names | [CONFUSING.md](docs/design/CONFUSING.md) item 9, checked 2026-11-13 (E256) | P3 | M | |
| L242 | The verifier checks termination: verify.ts skips it (`skip("termination")`), so "never Diverge" is the checker's word alone (REVIEW-2026-11-11 §6), and `grow`, `settled` and the worker passes lean on it. Check counting.ts's measure in verify, or list termination in CHECKED-ONCE as what's still trusted | [STANDING-2026-11-13](docs/reports/reviews/STANDING-2026-11-13.md) §6.5 | P2 | M | |

### Grammars, modules and sharing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Physics and planning ([PHYSICS-AND-PLANNING.md](docs/design/physics/PHYSICS-AND-PLANNING.md))

Ersagun 2026-11-01: fast bodies passing through each other, and A* for an
agent with inertia: built as L119 to L124 (DONE.md).

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Someday

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### What a good language needs ([ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Plain words for newcomers ([OUTSIDER-READ-2026-11-03](docs/reports/reviews/OUTSIDER-READ-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### The spec ([SPEC](docs/language/SPEC.md) §12)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## T: Testing and fast feedback

The thread that owns `.github/workflows` and the browser checks. Plan:
docs/process/TESTING.md. T7 is in lane L.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| T15 | Check main finishes: 0 of its last 100 runs passed (94 cancelled at the 20-minute timeout; newest finished one a failure on 11-11), so its base never moves and every run tests too much (I110's fix waits on a finished run). Split it into shards under the timeout, as I208 did for the Nightly, or test only what its own merge changed; then see it pass. With I219, until the Nightly passes and `good` moves off 10-28 | [STANDING-2026-11-13](docs/reports/reviews/STANDING-2026-11-13.md) §6.1 | P0 | M | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805 on 11-03; 3,421 on 11-13), tests reached by a one-line text.ts edit (145/150 + 44/44 on 11-03; 139/219 + 91/125 on 11-13) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P3 | postponed (Ersagun 2026-11-10: until people want to use Ters) |
