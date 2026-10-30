# routes

Roads between towns, read from a file. It prints how many towns, roads and
parts (groups of towns joined by roads) there are, the cheapest network of
roads that still joins every town that can be joined, and the town
farthest from the first one by name. Then it answers each `trip` (the
shortest route) and each `near` (the towns within so many km, nearest
first), in the order the file asks them.

```
$ node projectional/cli/lab.ts run --as-defined projectional/examples/routes projectional/examples/routes/roads.txt
7 towns, 8 roads, 2 parts
cheapest network: 570 km in 5 roads
farthest from Arden: Eskar, 460 km
Arden → Brisk → Dunmore → Eskar: 460 km
Eskar → Dunmore → Brisk → Arden: 460 km
Arden → Gant: no route
within 250 km of Brisk: Arden 120, Colm 150, Dunmore 200
Gant → Fallow: 70 km
```

`--as-defined` is needed for now: without it `lab run` picks the tree
representation for Map and Set and then refuses the program, because the
program's own record types still say Map and Set (docs/reports/GAPS.md, round
5, M2). The editor's Run has the same problem.

## The file

One line each, words separated by spaces:

- `road <town> <town> <km>`: a road both ways, a whole number of km long.
- `trip <town> <town>`: the shortest route from one to the other.
- `near <town> <km>`: the towns no farther than that from it.
- Blank lines and lines starting with `#` are skipped.

A line that is none of these, a length that isn't a whole number, or a
trip or near naming a town no road goes to stops the run with the line
number, on standard error, with exit code 1. The summary has been printed
by then if the error is in a trip or near.

## How it works

It is the first program in the examples built on std's `Map` and `Set`
(DATA-STRUCTURES.md):

- The graph is a `Map Text (List (Pair Text Int))`: each town's roads.
- Shortest routes are Dijkstra's method. The frontier is a `Set (Pair Int
  Text)` of (distance, town) pairs, so the nearest town comes first and a
  town whose way gets shorter is moved by removing its old pair. The best
  way to each town is a `Map Text Best`, its length and the town it comes
  from, and the route is read back through those.
- The cheapest network is Kruskal's method over the roads sorted by
  length (the prelude's `sort`, which orders records by `compare`), with
  a union-find forest kept in two maps and joined by size.
- The number of parts is the number of towns less the roads the network
  keeps.

`settle`, `way back` and `root` are recursions the checker can't see end,
so the program carries `Diverge`. `Abort` comes from `bad line`,
`kilometres` and `check town`, and is handled once, in `main`.

The program was written with the TypeScript DSL (`Lang`), by a script that
isn't kept, and saved as `code.json`. Its 39 definitions are 6 types and
33 functions.

## Credits

- Edsger W. Dijkstra, "A note on two problems in connexion with graphs",
  Numerische Mathematik 1 (1959). Keeping the frontier as an ordered set
  instead of a heap with decrease-key is a common textbook variant.
- Joseph B. Kruskal, "On the shortest spanning subtree of a graph and the
  traveling salesman problem", Proceedings of the AMS 7 (1956).
- Bernard A. Galler and Michael J. Fischer, "An improved equivalence
  algorithm", Communications of the ACM 7 (1964): union-find; joining by
  size is from the same line of work.

The towns and roads in `roads.txt` are made up.
