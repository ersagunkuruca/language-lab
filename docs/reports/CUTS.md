# Cut log

Every idea closed, stopped or not built because it measured under the bar
(WORKFLOW.md "Doing an item": 10% on one benchmark, or about 3% geometric
mean by kind across the suite). One line each, added in the PR that closes
the idea: item, program and target, kind, what was measured, where the
full record is. The weekly review sums the log by kind and by target, and
asks whether a kind now clears the bar as a whole (C331 is the first such
row). Allocation ideas are judged on C or by the allocations they remove,
not by what V8 hides (WORKFLOW.md "Targets and allocations").

Seeded 2026-11-25 from [TEN-PERCENT-RULE-2026-11-25](TEN-PERCENT-RULE-2026-11-25.md),
which also has how they compound per benchmark.

## Run time

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
| L266af | machine recompile | spread | after #3301 the steady 0.33 s over the IR passes, none 10%; their literal reads (Int ranges, kept arrays, keys) not replayable, so not built 11-25 | BACKLOG |

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
