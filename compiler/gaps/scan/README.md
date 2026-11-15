# scan

This is GAPS.md round 19's program (docs/reports/GAPS.md). It makes up a server log, reads a list of regular expressions, makes each one an automaton three ways and scans the log with all three, checking that they agree.

```
ters run compiler/gaps/scan [lines]
```

The default is 2000 lines. The same count always gives the same log.

## How it goes

1. **The log.** Each line has a time, a level, a host, a user, an address, a request in quotes, how long it took, a hexadecimal id and a few words of message, all drawn by a linear congruential generator from seed 20261115.
2. **Patterns.** A pattern's text is read by recursive descent into an expression: characters, classes `[...]` and `[^...]` (ranges, escapes `\d \w \s \n \t \r` and their capitals), `.`, groups, `|`, `*`, `+`, `?`, `{m}`, `{m,}` and `{m,n}`, with `^` and `$` for the ends of a line. The expression is made simpler (one-character alternatives one class, a repeat of a repeat one repeat), written back as text, and read again to check it comes back the same.
3. **Thompson's automaton.** Each expression becomes a nondeterministic automaton built from the end back (Thompson, "Regular expression search algorithm", CACM 11(6), 1968): edges on ranges of characters, forks and the final state 0.
4. **Deterministic.** The characters are split into classes that every edge treats alike, and the subset construction (Rabin and Scott, "Finite automata and their decision problems", 1959) makes a state for each set of states the automaton can be in.
5. **Fewest states.** Moore's refinement ("Gedanken-experiments on sequential machines", 1956) splits blocks of states by where they go until no split tells more apart.
6. **The scan.** Every line is searched for each rule's leftmost longest match by all three automata. The report gives each rule's states and matches, a line with its match marked, the users seen most often, the slowest request, and, for every two rules, a shortest text both match whole, found by a breadth-first search over pairs of states.
