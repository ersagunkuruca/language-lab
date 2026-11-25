# The 10% rule: what it cut, and whether it hurts (2026-11-25)

Ersagun asked (2026-11-25): "Are we at a point where the 10 percent
improvement rule hurts? Should we collect them and see how much they would
compound? Do we have a log of work that didn't make the 10 percent cutoff?
Are there patterns emerging from them?"

The rule, in [WORKFLOW.md](../process/WORKFLOW.md): measure an idea by
hand before building it, and build it only if it buys at least 10% of what
it targets; speed work stops when the next stage buys less. It came from
the 10-hour run of 2026-11-04/05, where two lanes spent about three hours
on speed ideas that gained 4% or less.

This is analysis only. Nothing in BACKLOG.md or WORKFLOW.md changes here.

## Short answer

- **There is no log.** What the rule cut is spread over about 70 places:
  "closed measured" rows in DONE.md, "Round stopped" sections in
  [GAPS.md](GAPS.md), and sentences inside open BACKLOG rows. The table
  below is the first time they are collected.
- **On run time the rule costs little.** About a third of what it cut
  measured nothing or made things slower. Where the cut items are
  positive, they compound to 5% to 15% on most benchmarks and about 25% on
  two (greenhouse in JavaScript, the pedal). The gaps they sit in are 3x
  to 22x the hand-written ideal, so even all of them together close a
  small part of it.
- **On compile time and editor latency it hurts.** Those profiles are
  flat: twenty passes of 2% to 6% each, so every next step is under 10%
  by construction. Stage 4 was declared stopped by the rule on 11-24 at
  about 1.05 s; the Language lane went on, and seven steps took machine's
  recompile from 820 to 450 ms (45%), five of them under 10% alone.
- **Two patterns the per-benchmark bar can't see.** (1) Checks the
  program doesn't need (finite and NaN tests, tagged and checked Int
  arithmetic, array bounds and version reads, a try round a lookup or a
  division) turn up in at least nine benchmarks on all three targets,
  each time measured at one site as 2% to 9%. Nobody has measured them as
  one class. (2) Six rounds stopped "spread thin" and named the same
  leftover: lists built and walked once, kept as cons lists between steps
  where the ideal pushes into arrays, and the collector that follows.
  That is one structural cause with no row.
- **Recommendation: keep the bar, change what it is measured against.**
  Measure an idea by kind across the suite, not by site on one benchmark;
  where there is a goal, judge a batch of steps against the goal; make a
  "spread thin" stop name its structural cause as a row; keep a cut log.
  Details at the end.

## The log

Every item found that was stopped, closed or not built because it measured
under 10%. "Gain" is what was measured, usually by hand-patching the
printed output; "upper bound" means the patch was unsound (it changed or
could change output) and only bounds what a real pass could buy.

### Run time

| item | program, target | kind | gain measured | where |
|---|---|---|---|---|
| C283 | greenhouse, JS | checks | column guards, finite check, view checks dropped: 6% | DONE |
| C283 | greenhouse, JS | allocation | the walk's Flock as seven numbers: 8% | DONE |
| C283 | greenhouse, JS | loop shape | three walks as one loop of numbers: 11% (over the bar; no general pass named, not built) | DONE |
| C283 | greenhouse, JS | checks | `buf` read without its getter: 3% | DONE |
| G1b4 | greenhouse, JS | inlining | the map's function put in its loop: under 5% | DONE |
| C284 | greenhouse, wasi | checks | every finite check dropped: 8% (upper bound) | DONE |
| C284 | greenhouse, wasi | allocation | `met` makes no Vec: 1% | DONE |
| G1b2-4, G3d | greenhouse, C and wasm | representation | columns: slower on C, nothing on wasm | DONE |
| C184 | pedal, core IR | algorithm | the bands' solve as a hand loop: 7.6% | DONE |
| C184 | pedal, core IR | checks | `gain for`'s finite checks: 9% | DONE |
| C184 | pedal, core IR | algorithm | the tanh solve: about 8% | DONE |
| C184 | pedal, core IR | collector | 4% to 5% | DONE |
| C31 | pedal, JS | representation | split, join and block as arrays: under 10% | DONE |
| C290 | strings, core IR | allocation | the fold's pair per item split: 0% (1.68 to 1.75 s, slower) | DONE |
| C290 | strings, core IR | checks | the fold's Int subtraction: 4% | DONE |
| C276 | strings, core IR | recursion | the generator for deep self calls: 8% of its time | DONE |
| C278 | strings, core IR | representation | the signals library's lists as arrays: slower | DONE |
| round 20 | strings, core IR | fusion | the FFT's maps fused by hand: slower | GAPS |
| C237 | scan, JS | checks | a try round a lookup with a default: under 2% | DONE |
| C238 | scan, JS | representation | pair keys read through a JS Map: about 4% | DONE |
| C242 | scan, C | calls | tail lets: 7% of instructions (landed anyway, for stack) | DONE |
| C282 | mini, C | refcount | text compared with a literal, borrowed: 5% | DONE |
| C324 | bazaar, core IR | representation | hash tables for data keys: 0% | DONE |
| C324 | bazaar, core IR | fusion | `map(reverse(rows), f)` as one pass: under 5% | DONE |
| TG2 | typeset, core IR | spread | collector, checked `int.add`/`int.mul`, versioned reads, a try per division: none over 7%, no row | GAPS |
| I215 | rota, JS | hashing | a key compiled for its type: under 10% (spelling 2%) | DONE |
| C289 | rota, core IR | spread | `merge by key` 4%, `set tree has` 3.4%: no row | GAPS |
| C223 | trek, wasi | representation | `split` straight into an array: 15 to 20 ms, about 7% | DONE |
| C107 | clinic, JS | in place | every record set in place: 0% to 7% (upper bound) | DONE |
| C208 | herd, JS | threads | workers on the map: 6% for twice the CPU | DONE |
| C209 | herd, JS | threads | main-thread pieces of a tick, each under 10%; columns kept between ticks at most 12% before puts | DONE, GAPS |
| C58, C60 | swarm, all | representation | eight next steps each under 10% (no sort, identity hash, denser columns, untagged Int fields, …); mote in place 0% | DONE |
| C58a | swarm, JS | representation | an array part for Int keys: under 10% | DONE |
| C211 | swarm, collatz, wasm | spread | "none worth 10% alone"; array offsets on wasm 0% | DONE |
| L280j | swarm-pool, C | algorithm | a stale key's slot by interpolation: no faster natively, slower on JS | DONE |
| C317 | swarm-pool, C | inlining | a lookup's three calls forced inline: 17% slower | DONE |
| C267 | flock, C | checks | `array.length` as int64: 3.5% of instructions, 0% time | DONE |
| G3d | flock and greenhouse, wasm | allocation | a record per neighbour taken apart: 0% to 5%, noisy | DONE |
| C327c2 | flock, wasm | allocation | views by value: 4% at the hottest site (25% on C, built) | BACKLOG |
| C327d | bazaar, C | allocation | a fold's frames as one stack: no change | BACKLOG |
| regions | six programs, C | allocation | a run that never frees: at most 2% faster, up to 40% slower | ALLOCATIONS |
| C207 | queens-count, C | checks | Float64 compares' NaN tests: 6% | DONE |
| C207 | queens-count, C | allocation | the placed list's views: about 12% of instructions; free slots reused: 0% | DONE |
| C303 | mnist, core IR | representation | Float64Arrays for the arrays: 0% | BACKLOG |
| C72 | notebook, JS | representation | trees walked in order: 9.8% on trees, 0% once the table is chosen | DONE |
| C68 | bounce, JS and wasm | allocation | small record functions in place: 3% to 4% | DONE |
| C95 | machine, JS | in place | Perceus-style reuse: within noise | DONE |
| C62 | routes, JS | in place | tree nodes written in place: 0% | DONE |
| C12, C13 | calc, JS | checks | inline try/catch; fuel only where needed: within noise | DONE |
| L281e, f, k | pages, interpreter | interpreter | under 2%; name lookup within noise | DONE |
| L118b | spacetime, evaluator | interpreter | frames not copied; parts in the machine: within noise | DONE |

### Compile time

| item | program | kind | gain measured | where |
|---|---|---|---|---|
| C67i, C67j | bounce, spacetime, constructions | passes | 4% to 11%, 3% to 10%; landed, then C67 stopped | DONE |
| C90 | ray marcher's GPU lowering | passes | three parts 17% to 25% each, each a design of its own; closed | DONE |
| I203 | spacetime, sheet | checks | each check left under 10% of its compile | DONE |
| I264 | machine | checks | first arms' checks 0.3 s, choice copies 0.15 s: each under 10% | DONE |
| L266e | machine | start-up | a Node snapshot: 6% of the compile | DONE |
| L280b | machine | caching | per-definition summaries: 0.2 of 4.5 s, under 5% | BACKLOG |
| L266 | machine | spread | 4.1 s over about twenty passes, none over 10% | BACKLOG |
| stage 4 | machine recompile | spread | "lowering 650 ms flat, none 10%", stopped 11-24 | memory |

### Editor and tooling

| item | where | gain measured |
|---|---|---|
| E103 | a hole's offers, physics `fall` | a plan per builtin class: under 10%; "stopped by the 10% rule" twice |
| E133 | the same | an incremental check: "not worth it at 4 s worst" |
| L215c4, c5 | check cache | typedefs about 1 ms, units 0.5 ms of an 80 ms edit |
| L215d2 | the palette's trials | measured, not built |
| E319f, E319h, E283 | editor thread | small analyses, waits of 7 ms |
| I192 | graph search worker | 3% of the open |
| T14 | editing tests | a small program for simplifyAppend: under 10% |
| L180 | test runs | std split: 6% fewer runs |

## How they would compound

Multiplying the remaining-time factors of the positive items on one
benchmark gives an upper estimate: items overlap (the greenhouse's one loop
includes carrying the Flock as numbers), and the upper bounds are unsound.

| program, target | items | compounded | gap to the ideal | after, roughly |
|---|---|---|---|---|
| greenhouse, JS | 6%, 8%, 3% (11% overlapping) | 16% to 25% | 4.3x to 4.8x | 3.4x to 4.0x |
| pedal, core IR (11-12) | 7.6%, 9%, 8%, 4.5% | about 26% | 4.1x to 4.8x | 3.0x to 3.6x |
| typeset, core IR | four causes under 7% | 12% to 25% (estimate) | 8.5x (with TG1 by hand) | 6.5x to 7.5x |
| strings, core IR | 4%, 8% | about 12% | 20x to 22x | 18x |
| queens-count, C | 6%, views | 6% to 15% | 1.8x | 1.6x |
| herd, JS 4 cores | pieces, columns | about 10% | 1.9x | 1.7x |
| rota, core IR | 2%, 4%, 3.4% | about 9% | 8.7x to 9.4x | 8x |
| greenhouse, wasi | 8%, 1% | about 9% (upper bound) | 2x native | 1.8x |
| flock, wasm | 4%, 0% to 5% | 4% to 9% | | |
| trek, wasi | 7% | about 7% | 4.0x | 3.7x |
| clinic, JS | 0% to 7% | up to 7% | 7x to 8.5x | |
| scan, JS | 2%, 4% | about 6% | 3x to 6x | |
| mini, C | 5% | 5% | 3.1x | 2.9x |
| bazaar, core IR | under 5% | under 5% | about 4x | |
| bounce, JS | 3% to 4% | 3% to 4% | | |
| swarm, swarm-pool, machine, routes, mnist, notebook | none positive | 0% | | |
| **machine recompile** | stage 4 after the stop: 17%, 6%, 3%, 8%, 12.5%, 8%, 1% | **45%** (820 to 450 ms, built) | goal 0.5 s | met on average; steady edits 0.33 s |

The last row is not an estimate. After the rule stopped stage 4 on 11-24,
the Language lane found one idea, an edit of a number replays each step's
last answer with the new values (literals-again.ts, #3294 to #3301), and
applied it pass by pass. Only two of the seven steps cleared 10% alone;
together they met the goal.

## Patterns

**1. Most of the cut items are nulls, and the nulls are on V8.** About 20
of the run-time items measured within noise, no change, or slower. Almost
all are allocation-shaped ideas on JavaScript or WebAssembly: Perceus reuse
(C95), the pair per item (C290), a record per neighbour (G3d), views by
value on wasm (C327c2), the mote in place (C60), tree nodes in place (C62),
the function in its loop (G1b4). V8's young generation and escape analysis
already make short-lived values cheap. The same idea on C pays: views by
value bought 25% on flock natively and 4% on wasm. Here the rule worked:
it stopped work that would have bought nothing.

**2. The positive items are mostly one kind: checks the program doesn't
need.** Finite and NaN tests (C184 9%, C284 8%, C207 6%, C283), tagged or
checked Int arithmetic (C267, strings 4%, typeset's `int.add`, G3d's
leftover `int.sub`/`int.clamped`, herd's "fuel and Int checks"), array
bounds and version reads (C283's `buf` 3% plus "persistent arrays' `buf`
reads 10%", typeset's `get buf`), and a try round something that can fail
(C237 2%, typeset's division). That is at least nine benchmarks on all
three targets. Each time it was measured at one site on one benchmark and
came out 2% to 9%. When it was the whole loop, it was large: C303c took
mnist's Adam from 9.2 to 5.9 s by checking `dot`'s reads once before the
loop. This is where the per-benchmark bar hurts most: a pass that removes
a check kind everywhere is judged by one site's share.

**3. Flat profiles make the rule a permanent stop.** Once a profile has
more than ten similar parts, every part is under 10%. That is the state of
compile time (L266: twenty passes, none over a second of 4.1 s), of stage
4 (twenty passes of 10 to 40 ms), and of the editor's checks (E103,
I203, I264). In those places the rule said stop while the goal (0.5 s a
compile) was still twice away. Stage 4 shows what was there: one idea
applied across passes, 45%.

**4. "Spread thin" stops leave the big gap unnamed.** Six rounds stopped
with the program 4x to 22x from the ideal and described the same
leftover: lists built and walked once, kept as cons lists between steps
where the ideal pushes into arrays, and the collector that follows. Bazaar
(C324: "a representation question … not a gap of one pass"), typeset
(TG2: "no row"), strings (C278, C290: "the FFT as the library writes
it"), trek (`split` and its list made an array), greenhouse (`arrayOf` for
each tick's cell lists), swarm (C58: "that ideal's representation
itself"). The rule tests one pass at a time, so a cause that is a
representation choice across a program never gets measured as one.

**5. "10% of what it targets" is read differently each time.** C283's one
loop bought 11% and wasn't built (no general pass named); C242 bought 7%
and was built (for stack depth); C67i and C67j landed at 4% to 11% and
then stopped the row. Most items are judged against one benchmark's whole
run, a few against a function (C303c), a few against a tick (C209).

**6. Noise sits near the bar.** JavaScript timings here move ±5% to 10%
(stage 4's bench ±50 ms of 650; greenhouse "median of 9, noisy machine"),
so "within noise" on three to five runs can't tell 0% from 4%. C rows that
counted instructions (callgrind) gave clean small numbers (C267 3.5%, C242
7%).

## Recommendation

Keep a bar. It did its job on pattern 1, and it is the reason the lanes
don't repeat 11-05's three hours on 4% ideas. Change what it is measured
against:

1. **Measure an idea by kind across the suite, not at one site.** An idea
   passes if it buys 10% on one benchmark, or about 3% (geometric mean)
   over every benchmark and target it touches. The first candidate is
   pattern 2: drop every check of one kind by hand (unsound, as an upper
   bound) on every bench and target, and see which kinds clear that bar.
   This would be a new Compiler lane row.
2. **Where there is a goal, judge a batch against the goal.** For compile
   time, editor latency or "1.1x the ideal", a lane may take steps under
   10% as long as each batch of three PRs buys 10% together and the goal
   is still in reach; stop when a batch doesn't. Stage 4's 820 to 450 ms
   passes this; 11-05's 4% ideas would not have.
3. **A "spread thin" stop names its structural cause.** A round that stops
   above 3x the ideal writes a row for what the leftover is made of, not
   "no row". Pattern 4 would become one row now: lists built once and
   walked once stored as arrays between steps (bazaar, typeset, strings,
   trek, greenhouse, swarm as examples).
4. **Keep a cut log.** One table (a section of GAPS.md, or
   `compiler/gaps/CUTS.md`) gets a line for every idea closed under the
   bar: item, program, target, kind, gain, how measured, date. The weekly
   review sums it by kind. The tables above can seed it.
5. **Try allocation ideas on C first.** On JavaScript and WebAssembly,
   expect V8 to have done it already unless the collector is over a third
   of the profile.
6. **Measure small gains with instructions or more runs.** Below 10%, use
   instruction counts on C and seven or more interleaved runs on
   JavaScript, and say the spread.

Each of these changes WORKFLOW.md and would go in its own PR once Ersagun
chooses.

## Decided (Ersagun, 2026-11-25 09:22 UTC)

"All four": recommendations 1 to 4 go into WORKFLOW.md, one PR each.
Recommendation 5 is turned down: "V8 or whatever browser engine could
alleviate the issues with allocations but I feel like we shouldn't rely on
that. Because we can do more analysis and JIT compiler has very little
time budget to do the same. It will hurt us eventually." An allocation
idea that measures nothing on JavaScript or WebAssembly because the engine
hides it is not closed for that. And: "let's abandon the notion that ters's
first target is JS or the browser. Browser helps for showcasing demos
easily, but it's not the first target."
