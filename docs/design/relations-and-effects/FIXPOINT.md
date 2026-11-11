# Fixed points: say the equation, and why it ends

Design note for BACKLOG.md L238 (thread "Explore solving by fixed-point
iteration", 2026-11-11). Written 2026-11-11.

**Status.** `grow` (L237) and `settled` / `settled by` over a List
Float64 (L239) are in the prelude. What was learned building `settled` is
under "What building it changed". The Markov chain example (L240) and
Newton (L241) are rows.

## The problem

Many answers are fixed points: an `x` with `x = step(x)`.
- The nodes a graph reaches.
- What a compiler's dataflow knows at each point.
- A page's rank.
- A Markov chain's stationary distribution.
- The values in value iteration.
- `x = cos(x)`.

The usual program is a loop:

```
settle(step, x) = if step(x) = x then x else settle(step, step(x))
```

Ters gives it `-[Diverge]->`, because nothing says the loop ends. Today a
program can get rid of that in three ways:

- **Write the bound by hand.** An Int counted down from a bound is total
  (counting.ts): `if 0 < left then … settle(left − 1, …) else x`. That is
  how `grow` is written.
- **Run it under `with fuel(n, …)`.** Running out of fuel is a failure,
  so Diverge becomes Choice (BACKWARDS.md).
- **For numbers, state only the equation.** `inverse((x) ↦ x − cos(x),
  0.0)` solves it by Newton's method, with no loop written.

The third way is the shape we want everywhere: the program states the
equation, and the compiler picks how to solve it and says in the type
whether it ends.

## Three ways a fixed point ends

| kind | why it ends | bound | what the type can say |
|---|---|---|---|
| Finite and growing | Each step only adds facts, and there are finitely many possible facts (Kleene 1952, Knaster–Tarski 1955) | the number of possible facts, in rounds | total: no effect |
| Contraction | Each step brings two points closer by a factor q < 1, so the error shrinks geometrically (Banach 1922) | ⌈log(ε / d₀) / log q⌉ steps to reach ε, where d₀ is the first step's size | Choice, when q is only checked while it runs |
| Neither | Newton far from a root, a chain that isn't ergodic, plain iteration of anything | none | Diverge, or Choice under fuel |

A recursive function is the first kind one level up: it is the least
fixed point of its definition, reached by Kleene iteration from "not yet
defined".

## The finite, growing case: `grow`

`grow(universe, start, more)` gives the least set that holds `start` and
is closed under `more`, keeping only items of `universe`. Each round adds
what `more` gives for the items the previous round added, and only those
items: semi-naive evaluation, as in Datalog (Bancilhon 1986).

Every round except the last adds an item, so it ends within
`set size(universe)` rounds. It counts them down and is total by the
counting rule, with no checker work: its type is
`(Set a, Set a, (a) -[e]-> List a) -[e]-> Set a`.

Reachability is one call:

```
reached from(start) = grow(nodes, as set([start]), (n) ↦ neighbours of(n))
```

**Monotonicity comes from the shape, not from types.** `grow` only ever
takes the union with what `more` gives, so the step is monotone by how it
is built. Datafun (Arntzenius and Krishnaswami, ICFP 2016) instead puts
monotone functions in its types, with a separate context for variables
used monotonically. That would be a second kind of function type in Ters,
which goes against keeping one system. The recommendation is to leave
monotonicity out of types. A step that grows a set is written `grow`'s
way. Any other step is a contraction or plain iteration, below.

## The contraction case: `settled`

```
settled(start, step, tolerance)
```

This gives a point x with `step(x)` within `tolerance` of x, for a step
over a list of Float64s (a record of them waits for an example). Distance
is the sum of the parts' differences (the L1 norm; see below for why not
the max norm). It runs plain rounds and checks the contraction as it goes:

1. Run four rounds and take q̂ half way from the largest ratio `dₖ₊₁ / dₖ`
   seen between the sizes of consecutive steps to 1. If q̂ ≥ 1, there is no answer
   (Choice): the step isn't contracting from this start.
2. From q̂ and d₀, the number of rounds is bounded:
   N = ⌈log(tolerance · (1 − q̂) / d₀) / log q̂⌉. The loop counts N down,
   so it is total, as `grow` is.
3. If a later ratio goes above q̂, there is no answer (Choice). It never
   loops on.
4. Otherwise stop once `dₖ · q̂ / (1 − q̂) ≤ tolerance`. This is Banach's
   bound after the fact: the distance to the true fixed point is at most
   that much.

So `settled` is `-[Choice]->` and never Diverge. The check is honest about
what it knows:
- When the rate is known, as PageRank's damping is, `settled by` is given
  it and the answer is within tolerance.
- Otherwise q̂ is an estimate. An answer could then be off by more than the
  tolerance if the step contracts less elsewhere.

The note to write with it says so. A program that knows its rate can say
so instead: `settled by(start, step, q, tolerance)` takes q as given, needs
no first step, and fails only if the step breaks the given rate.

Newton's method is not a replacement for this. Newton needs the
derivative, which Ters has (derivatives, `inverse`), and converges
quadratically near a root. But one Newton step on n unknowns solves an
n × n linear system. For a large, sparse step such as PageRank, plain
rounds are cheap and local, and they share out over workers. So the
compiler would choose:
- **Newton:** a few unknowns and a step it can differentiate.
- **Plain rounds:** everything else.

### What building it changed

- **The norm is L1, not max.** PageRank's step shrinks by 0.85 in the sum
  of differences, every step. In the max norm its step-to-step ratio on the
  ten-page test graph swings between 0.43 and 0.98, so `settled by(…,
  0.85, …)` measured in the max norm had no answer. A step that contracts
  in the max norm instead (value iteration) shrinks in L1 by at most n
  times as much, so it may need `settled` rather than `settled by`.
- **`settled` takes a margin.** Its first ratios on the same graph are
  0.51, 0.64, 0.57, 0.71, and later ones reach 0.85. So after four rounds
  it takes q half way from the largest ratio seen to 1 (0.85 there), not
  the largest itself.
- **A millionth of slack.** A step that shrinks by exactly q measures a
  hair over it after rounding, so a step fails only when it shrinks by
  less than q · 1.000001.

## The worked program: PageRank

A page's rank is the chance that a surfer is on it. The surfer follows a
random link with probability d = 0.85, and jumps to a random page
otherwise. The ranks are the fixed point of one step of that:

```
rank step(links, ranks) = map(pages(links), (p) ↦
  (1 − 0.85) / page count(links)
  + 0.85 · sum(map(linking to(links, p), (q) ↦ rank of(ranks, q) / links from(links, q))))

page rank(links) = settled(evenly(links), (r) ↦ rank step(links, r), 1e-9)
```

The step is a contraction with q = 0.85 in the sum of absolute
differences (the L1 norm), which `settled` measures. From an even start,
d₀ ≤ 2, so it ends within ⌈log(1e-9 · 0.15 / 2) / log 0.85⌉ = 144 rounds.
With `settled by(…, 0.85, 1e-9)` the bound is known before the first
round. test/settled.test.ts runs both on ten pages.

A Markov chain's stationary distribution π = π · P is the same program,
with P's rows in place of the links. It has an answer when the chain is
ergodic, and the rate is the second-largest eigenvalue's size. For a chain
that mixes slowly, q is close to 1 and the bound is large. For a chain
with no single stationary distribution (periodic or reducible), the
observed ratio doesn't drop below 1 and `settled` has no answer. Both
outcomes are visible in the type and at run time rather than as a hang.

What a program writes today for the same thing:

```
page rank(links) = first(() ↦ with fuel(100000, () ↦ settle((r) ↦ rank step(links, r), evenly(links))), evenly(links))
```

This version compares for exact equality, which floats may never reach.
Its fuel is a guess. Its fallback hides a failure as the starting ranks.

## The compiler's side

Each round of `rank step` is a map over the pages. The compilers already
share a map out over workers and the GPU (C41, C61). So `settled`'s rounds
run in parallel with nothing new, and the distance is a max fold, which
shares out too (C42).

`grow`'s rounds are a fold over the newest items. Datalog engines run that
fold as joins over indexed relations. For a program whose `more` is a
lookup in a map of edges, a later step could keep the edges indexed by
source. That waits for an example that needs it.

## Prior art

- **Kleene's fixed-point theorem** (1952) and **Knaster–Tarski** (Tarski,
  1955): least fixed points of monotone maps by iteration from the bottom.
  `grow` is the finite case.
- **Banach's fixed-point theorem** (1922): a contraction has one fixed
  point, reached geometrically, with a bound before and after.
- **Semi-naive evaluation** in Datalog (Bancilhon, 1986): each round joins
  only the facts the last round found.
- **Flix** (Madsen, Yee and Lhoták, PLDI 2016): Datalog fixed points over
  lattices inside a functional language.
- **Datafun** (Arntzenius and Krishnaswami, ICFP 2016): a functional
  language with `fix` over finite lattices and monotonicity in the types.
  This is the closest design. We take its finite fixed points and leave
  out its monotone types (above).
- **PageRank** (Brin and Page, 1998) and **value iteration** (Bellman,
  1957): the classic contractions run by plain rounds.
- In Ters itself:
  - relate.ts's tabling already computes a least fixed point (BACKWARDS.md, L70b).
  - `inverse` already solves a numeric equation stated alone (Newton).

## Rows this would become

L239 is built; L240 and L241 are BACKLOG rows at P3.

- **`settled` and `settled by` in the prelude** (L239, built). They run plain rounds with
  the contraction check above, so the type is Choice and never Diverge.
  Example: PageRank on a ten-page graph, evaluated and compiled the same,
  within 144 rounds.
- **A Markov chain's stationary distribution as an editor example.** It
  shows a slow-mixing chain's large bound and a periodic chain with no
  answer.
- **The compiler picks Newton for `settled`** when the step has a few
  Float64 unknowns and a derivative. Example: `x = cos(x)` as `settled`,
  in 4 steps instead of 52 plain rounds (to 1e-9 from 1.0).
- **Not proposed:** monotone function types (Datafun's). `grow`'s shape
  covers the finite case without them.
