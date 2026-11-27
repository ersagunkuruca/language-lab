# chomsky

Grammars and their machines as ordinary data, across Chomsky's hierarchy
(BACKLOG L293, [CHOMSKY-2026-11-27](../../../docs/design/relations-and-effects/CHOMSKY-2026-11-27.md)).

```
ters run examples/chomsky [length]
```

A grammar is a value: `grammar(name, start, rules)`, each rule a list of
symbols rewritten to another, written as text such as
`"S → aSb | ab"` (capital letters are variables). The program builds four,
one at each level, and for each prints its level and its words up to a
length (8):

| grammar | rules | level |
|---|---|---|
| a⁺b* | S → aS \| a \| aB; B → bB \| b | regular |
| aⁿbⁿ | S → aSb \| ab | context free |
| aⁿbⁿcⁿ | S → aSBc \| abc; cB → Bc; bB → bb | context sensitive |
| a^(2^n) | S → ACaB; Ca → aaC; CB → DB \| E; aD → Da; AD → AC; aE → Ea; AE → ε | unrestricted |

## How it goes

- **The level** (`level of`) is the narrowest kind of rule all the rules are:
  right-linear, one variable on the left, never shorter on the right, or
  anything.
- **A derivation step** (`rewritten`) is a Choice: any rule, at any place
  its left side occurs. No search code is written; `all` collects the
  forms a step can make.
- **Words up to a length** (`words up to`): when no rule shrinks a form,
  every form on the way to a word of n symbols is n symbols or fewer, so a
  breadth-first search over those forms finds every word. The forms are
  finitely many, and the search counts its rounds down from how many
  there are, so the checker sees it ends.
- **The unrestricted level** (`searched`): a rule may shrink a form, so no
  length bounds the search, and the checker gives `searched` the `Diverge`
  effect. `found within` runs it under `with fuel`, which turns that into
  `Choice`: a word is found, or nothing is known after so many rounds.

So the line between decidable and semi-decidable shows in the types:

```
words up to : (Grammar, Int) -> List (List Symbol)
searched    : (Grammar, List Symbol, Set (List Symbol), Set (List Symbol)) -[Diverge]-> Answer
found within: (Grammar, List Symbol, Float64) -> Answer
main        : (List Text) -[Console]-> Unit
```

## Credits

The program's own comment, shown in the editor's Program tab, says the
same, and so does docs/language/CREDITS.md.

- Prior art: the hierarchy, from Noam Chomsky's "Three models for the
  description of language" (1956) and "On certain formal properties of
  grammars" (1959). Context-sensitive languages decided in bounded space:
  S.-Y. Kuroda, "Classes of languages and linear-bounded automata" (1964).
- Adapted: the a^(2^n) grammar is the example in John Hopcroft and
  Jeffrey Ullman, *Introduction to Automata Theory, Languages, and
  Computation* (1979).
- Influence: JFLAP (Susan H. Rodger, Duke University), where grammars and
  machines are objects you convert between and test against each other.
