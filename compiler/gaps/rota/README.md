# rota

GAPS.md round 14's program (docs/reports/GAPS.md): a week's staff rota
found by a search written with the language's Choice.

```
ters run compiler/gaps/rota plan.txt
```

A plan names the days (`days Mon Tue …`), each shift and how many people
it needs (`shift early 2`), each person with the most shifts they work and
the shifts they can work (`person Ada 5 early late`), days people are off
(`off Ada Sat Sun`), and rest rules (`rest night early`: nobody works
early the day after a night). `#` starts a comment. rota:

1. reads and checks the plan, and says which line is wrong;
2. fills every place of every shift of every day by backtracking, with
   `one of` for each choice. The place filled next is the one the fewest
   people can take, the least loaded of them tried first; a branch is
   given up as soon as a place has nobody left, or the places left
   outnumber the shifts people may still work. The people on a shift are
   taken in order of name, so each set of them is tried once;
3. finds the fairest rota: the first found under the lowest cap on
   anyone's shifts that has one (`first` and `optional`);
4. counts every way to staff the first day (`count`), and finds who the
   rota can't do without (a search without each person in turn).

Usage errors exit with 2, a bad plan or no rota with 1 and `rota: …` on
stderr.

**It was written through the MCP** (`ters mcp`'s tools, called in process
by a driver in the project's files, `gaps-round14/drive.ts`): one
`define` and one or two `replace`s of text a definition, types included.
`code.json` is the source.

## Credits

- Filling the place with the fewest options first is the search order of
  Solomon W. Golomb and Leonard D. Baumert, "Backtrack programming",
  *Journal of the ACM* 12(4), 1965.
- Giving a branch up as soon as a place has nobody left is forward
  checking: Robert M. Haralick and Gordon L. Elliott, "Increasing tree
  search efficiency for constraint satisfaction problems", *Artificial
  Intelligence* 14(3), 1980.
- Taking a shift's people in order of name, so each set is tried once,
  is the usual symmetry breaking of constraint programming (lexicographic
  ordering of interchangeable values).

The program, the plan and the ideal JavaScript are written fresh.
