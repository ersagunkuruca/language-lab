# sheet

A small spreadsheet, written in the editor for bigger-program round 7
([GAPS.md](../../../docs/reports/GAPS.md), "Round 7"). It reads a file of
cells, one per line, works out every cell once, finds cycles, prints the
sheet as a grid and the cells that went wrong, and writes a report beside
the file.

```
$ node ters/cli/lab.ts run ters/examples/sheet ters/examples/sheet/budget.txt
           A       B       C       D
   1    1200   14400     750  #cycle
   2     450    5400     820  #cycle
   3     380    4560     676  #div/0
   4    2030   24360    -670  #parse
line 14: D1 is #cycle
line 15: D2 is #cycle
line 16: D3 is #div/0
line 17: D4 is #parse
```

## The file

- `<cell> = <formula>`, a cell a letter and a row number (`B12`).
- A formula has whole numbers, cells, `+ - * /` (division rounds down),
  unary `-`, brackets, and the functions `SUM`, `MIN`, `MAX`, `COUNT` and
  `AVERAGE` over cells and spans (`A1:B3`). Names may be in any case.
- An empty cell is 0. A cell that can't be worked out shows why:
  `#cycle`, `#div/0`, `#parse`, `#span` (a span outside a function),
  `#empty` (MIN or MAX of nothing), `#name?` (no such function).
- Blank lines and lines starting with `#` are skipped. A line without `=`
  stops the run with its line number.

The exit code is 0 when every cell has a value, 1 when some don't, and 2
with no file named. The report goes to `<file>.out`.

It lives here, not in `ters/examples`, until BACKLOG L146 is fixed (the
checker types `show formula` as Diverge where the modes see it end).
The program is original; spreadsheet evaluation and recursive descent
are common knowledge.
