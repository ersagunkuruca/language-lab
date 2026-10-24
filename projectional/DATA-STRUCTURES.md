# Data structures: maps and sets first, as meanings with representations

BACKLOG L61 and L65, from Ersagun's "we need better data structures; list
being an array underneath is a good start but we need more" (2026-10-24)
and LANGUAGE-NEEDS-2026-10-24 §1. This is the plan; each step below is one
PR.

## Short answer

A map and a set are **ordinary data with one spelling**: a map is its
entries sorted by key with no key twice, a set is its items sorted with
none twice, both in the order `compare` gives (L66). Because each meaning
has exactly one spelling, `equal`, `show`, `compare`, content hashes and
running backwards work on them with no special case, and a fold goes in
key order on every target, which JavaScript, Python and Go don't promise.

How they are *stored* is a separate choice, in NUMBERS.md's sense: a
balanced tree, later a hash trie or a table changed in place. The program
says "map"; the representation is picked by cost, and the evaluator keeps
running the meaning so every representation is tested against it. There
is no new node kind and no built-in collection type: the types are std
data, the operations prelude definitions.

## The meaning (step 1, L65)

In std, next to `Optional` and `Outcome`:

```
Map k v = map of(entries: List (Pair k v))     -- sorted by key, no key twice
Set k   = set of(items: List k)                -- sorted, no item twice
```

`Set k` is its own type rather than `Map k Unit`, so a set reads as
`set of([1, 2, 3])` and not as a map whose values are all `unit`. The
constructor is only the spelling; programs build maps with the prelude,
which keeps the spelling canonical (as `fraction` keeps lowest terms
rather than `ratio` being called directly).

Prelude, offered:

| | maps | sets |
|---|---|---|
| build | `empty map`, `as map(pairs)` (a later pair wins), `put(m, k, v)`, `remove key(m, k)` | `empty set`, `as set(items)`, `add item(s, x)`, `remove item(s, x)` |
| ask | `value at(m, k)`: a Choice, no answer when the key is absent; `has key(m, k)` | `has item(s, x)` |
| combine | `merge maps(a, b)` (b wins) | `set union`, `set intersection`, `set difference` |
| read out | `keys of`, `values of`, `entries of`, `map size` | `items of`, `set size` |

The names avoid the plain words (`size`, `lookup`, `difference`) that
example programs already use for their own definitions.

`value at` is a Choice because absence is computed (LANGUAGE.md: no null);
`first(value at(m, k), else 0)` is a lookup with a default, and `optional`
stores one. Counting words is `put(m, w, first(value at(m, w), else 0) + 1)`
in a fold.

All of these are folds and structural recursions, so the termination check
accepts them and their types have no Diverge. Each is linear in the size of
the map until step 2: fine for the programs in examples/, and the meaning
the faster versions are checked against.

**Running backwards.** `value at(m, k) = v` run backwards over `k` is "which
keys hold v": the relational interpreter walks the entries, as it does for
any list, so it comes for free from the meaning.

**Targets.** The values are plain data, so the evaluator, compiled JS,
pages and audio take them as they are. WebAssembly and C need `compare`
there first (C46).

## The representation (step 2)

A **weight-balanced tree** (Nievergelt and Reingold, 1972; Adams, 1993, as
in Haskell's `containers`, with Hirai and Yamamoto's 2011 parameters), written
in the language itself as a prelude type, with:

- `meaning`: the tree's entries in order, which is the step 1 value;
- jobs: `put`, `value at`, `remove key`, `has key` in log n, `union` and friends
  by split and join (Blelloch, Ferizovic and Sun, 2016), folds in order in
  n;
- `canonical: false`. A tree's shape depends on the order of insertion, so
  structural equality would be wrong; `equal`, `show`, `compare` and the
  hash go through `meaning`, which is what represent.ts already requires of
  a representation that isn't canonical.

**Done (L76):** the tree is `src/lang/map-tree.ts` (`withMapTree`), its
jobs tested against the definition through `meaning` with the balance
checked after every change (`test/map-tree.test.ts`). The chooser takes it
for a word count, and the represented program prints what the definition
prints; in the evaluator a word count of 1,200 words (400 different) runs
about 3.5 times faster, and of 3,000 words about 15 times (the list is
quadratic, the tree n log n).

What step 2 needs that doesn't exist yet: today representations are applied
only by `lab run` and `lab compile` with a representations.json (#97). A
std or library type's representation has to be chosen automatically by the
evaluator, the compiler and the editor, from the costs of the jobs the
program uses. That is a Compiler lane change (C47). It must also send `equal`, `show`
and `compare` on a map through `meaning`, since the tree isn't canonical:
`represent` today replaces jobs by id and has no types to find which
`equal`s are on maps.

## Later representations

- A hash array mapped trie (Bagwell, 2001) where keys hash and only folds
  need the order: folds then sort, which is n log n, so the chooser takes it
  only when a program does many lookups and few folds.
- A hash table changed in place when nobody else holds the map: Perceus
  reuse analysis (#202, native N5c) already finds where a value is unique.
- Arrays aren't a type: they are C30's representation of `List`. A
  persistent vector (RRB trees, Bagwell and Rompf, 2012) is C45.

## The editor

A map or a set value, and a literal `as map([...])` in a definition, is
drawn as a two-column table (a one-column list for a set), keys in order.
An Editor lane row.

## Steps

1. **L65**: `Map` and `Set` in std, the prelude operations above, tests
   that each keeps the spelling canonical and agrees with a list model,
   compiled JS equal to the evaluator. LANGUAGE.md section.
2. **L76 + C47**: the weight-balanced tree as a representation, and
   library representations chosen automatically.
3. **E74**: maps and sets drawn as tables.
4. HAMT and the in-place table, when a program measures the need.

## Prior art

- One canonical spelling as the meaning: NUMBERS.md's quotient types;
  Unison's content addressing needs it.
- Ordered maps with folds in key order: Haskell `Data.Map`, OCaml `Map`,
  Rust `BTreeMap`, Clojure sorted maps.
- Weight-balanced trees: Nievergelt and Reingold (1972), Adams (1993),
  Hirai and Yamamoto (2011); parallel set operations by join: Blelloch,
  Ferizovic and Sun (2016).
- HAMT: Bagwell (2001), as in Clojure and Scala.
