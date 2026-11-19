# larder

GAPS.md round 20's program (docs/reports/GAPS.md): a week's cooking from
a book of recipes, with exact fractions, lines read by running their
printers backwards, and the packs to buy found by a search.

```
ters run compiler/gaps/larder book.txt
```

A book names units (`unit tsp`, a base unit, or `unit tbsp 3 tsp`),
recipes (`recipe pancakes 4`, how many it serves, then a line per food:
`1 1/2 cup flour`), what is in the larder (`have 2 1/2 cup flour`), the
packs the shop sells (`sell 4 cup flour`) and what to make (`make
pancakes 6`). `#` starts a comment. larder:

1. reads each line by running its printer backwards: `spelled item`
   writes an amount, a unit and a food, and `inverse(spelled item, line)`
   is every way the line could have been written by it, of which the one
   whose unit and food are one word each is kept. A unit line is read the
   same way. Amounts are exact `Rational`s, whole (`2`), a fraction
   (`3/4`) or both (`1 1/2`);
2. checks the book (units named once, measured by units there are, no
   unit measured by itself, a food measured the same way everywhere) and
   says which line is wrong;
3. scales each dish to the portions asked for and spells every amount
   as a kitchen would: exactly, in the largest unit that holds at least a
   quarter of one, with halves, thirds, quarters or eighths (a search,
   `all` and `one of`, its answers ranked); else in any unit; else about,
   to the nearest eighth of the smallest unit;
4. adds up what the plan needs, and for each food the larder is short
   of, searches every way to buy enough of the packs sold (never more of
   one than covers what is left), keeping the one with the least over,
   then the fewest packs;
5. says how many portions of each dish the larder alone makes, each by
   running a product backwards (`inverse((y) => y · per, have)`).

Usage errors exit with 2, a bad book with 1 and `larder: …` on stderr.

**It was written through the MCP** (`ters mcp`'s tools, called in process
by a driver in the project's files, `gaps-round20/drive.ts`): one
`define` and one or more `replace`s of text a definition, types included.
`code.json` is the source.

## Credits

- Reading a line by running the function that prints it backwards is the
  relational programming of miniKanren: Daniel P. Friedman, William E.
  Byrd and Oleg Kiselyov, *The Reasoned Schemer* (MIT Press, 2005), whose
  search the language's `inverse` runs (docs/language/BACKWARDS.md).

The program, the book and the ideal JavaScript are written fresh.
