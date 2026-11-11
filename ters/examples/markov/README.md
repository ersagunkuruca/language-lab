# markov

Where three Markov chains settle: the chances of each state in the long
run, found with `settled` and `settled by` (L239, FIXPOINT.md). Each starts
from one state and takes a step at a time until a step changes the chances
by under 1e-9 (summed over the states).

- **Weather**, three states that mix quickly. `settled` reads the rate at
  which the steps shrink off its first four steps, and gets
  0.521739 0.304348 0.173913 (sunny, cloudy, rainy).
- **Two rooms** joined by a door that is rarely used. A step closes only 1%
  of the gap to where the chances settle, so `settled by` is told a rate
  (0.995), and from it and the first step's size it counts the steps it
  may take before it starts: about 4,200 (Banach's bound). It gets 0.6 0.4.
- **A swap**, a chain that always changes state, so the chances flip back
  and forth and never settle: no answer, rather than a run that never ends.
  The type of `settled` is Choice, not Diverge.

`ters run examples/markov` prints:

```
Weather, three states that mix quickly: 0.521739 0.304348 0.173913
Two rooms with a door rarely used: 0.6 0.4
A chain that only swaps: no answer
```
