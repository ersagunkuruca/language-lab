# pond

A pond of fish, food and herons, a tick at a time (GAPS.md round 13). The
pond is a 48 m square that wraps round at its edges, its floor 48 by 48
cells of food that grows back each tick. The fish are kept in a `Pool`:
each has a key that is a slot and a generation, so a fish that dies frees
its slot for the next one born, and a key kept for a dead fish finds
nothing rather than its slot's next fish. Each fish follows a leader by
its key, swims toward the most food it smells, eats, ages, has young when
it has energy to spare and dies when it runs out or grows old. Six herons
hunt the nearest fish, each by its key too.

Each tick every fish's plan (where it swims, the cell it eats from, how
much it wants) is made from the pond as it was, by a `map` over the
pool's keys that only computes, so it can run on several threads. Then
the plans are carried out in turn, the herons strike, and the food grows.
main lives the pond a number of ticks (300) with a number of fish to
start (400), and prints a line every 50 ticks, then checks on the end
(no fish outside the pond, none spent, no patch overfull, none too old).

It was written whole through the Ters MCP server's tools (`ters mcp`):
types, functions, comments and all, 105 definitions, by a driver script
kept in the project's files (`gaps-round13/drive.ts`).

```
$ ters run compiler/gaps/pond 300 400
tick 50: 858 fish (born 1070, died 570, caught 42), food 194.502, mean energy 0.5792, following 637, elders 0, checksum 64937.811
...
```

## Credits

- The school follows leaders as Craig Reynolds's boids steer: "Flocks,
  herds and schools: a distributed behavioral model", SIGGRAPH 1987.
- The food grows back by Pierre-François Verhulst's logistic growth
  (1838).
- Random numbers by Stephen Park and Keith Miller's minimal standard
  generator: "Random number generators: good ones are hard to find",
  Communications of the ACM, 1988.
- The fish are kept with generational keys and a free list, as game
  engines keep their entities (generational indices).

The same credits are main's last line.
