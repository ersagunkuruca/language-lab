# Lists between steps as arrays (C332), measured

C332 asked whether the lists a program builds once and walks once between
its steps would be faster as arrays (TEN-PERCENT-RULE-2026-11-25 pattern
4), before a pass chooses that. Six rounds had stopped with this as part
of the leftover: bazaar, typeset, strings, trek, greenhouse and swarm.

## bazaar, by hand

bazaar runs a query plan step by step (read, keep, hash join, anti join,
aggregate, extend, sort, project, limit), each step's rows a
`List (Array Value)`. A copy of it (an MCP script on a scratch copy; the
program in the repo is unchanged) gives every step its rows as an
`Array (Array Value)`, and `run query` prints the last step's items:

1. **Conversions only**: each step `array of(...)` over the `items of
   array` of the step before. This adds a copy a step, so it's no measure
   of arrays as such. Natively it was 35% slower, on JS 22% slower, on
   WebAssembly about the same.
2. **Array-native walks**: keep, extend, project and limit work on the
   array itself. They walk with `front of array` and push into a new array,
   and limit is `slice of array`. Joins, grouping and sorting still take
   the array's items as a list, since Array has no map, keep, sort or
   group.

Median of seven interleaved runs, the same output on every target:

| target | 40,000 orders | 200,000 orders |
|---|---|---|
| native (one thread) | 91 -> 107 ms (17% slower) | 675 -> 795 ms (17% slower) |
| core JS | 375 -> 413 ms (10% slower) | 1787 -> 2028 ms (13% slower) |
| wasi (Node) | 234 -> 231 ms (1%) | 1124 -> 1129 ms (0%) |

The array steps are slower, not faster. A cons list built once and walked
once is already about the cheapest thing natively: one cell a row, taken
apart as it's walked. An array adds a buffer that grows by copying, and a
view at every `front of array`. C324 closed the same way: measured by hand
on the compiled module, nothing buys 10%.

## The others

- **strings**: measured as C278. Arrays for the signals library's lists
  were slower, and the chooser keeps cons lists there.
- **typeset**: its hot data is arrays already (`Array Item` for a
  paragraph's items, `Array Best` for the breaks). Its lists are the
  words and the offers made per break, built and walked once.
- **trek**: C223's profile has `split`'s list made an array at 14 of 230
  ms (6%), under the bar by itself.
- **greenhouse**: C283 measured its tick's lists, and columns were slower
  on C and no faster on WebAssembly (cut log).
- **swarm**: C58, the ideal's own representation. There a pool is the
  data, not a list between steps.

## Closed

Lists between steps as arrays don't clear the bar: on the one program
measured on every target they're slower natively and on JS, and even on
WebAssembly. The leftover these rounds named isn't the list as a
representation. It is the cells made for each step's rows (C327's
per-value ownership: the rows dying in the step that made them) and the
collector on JS.
