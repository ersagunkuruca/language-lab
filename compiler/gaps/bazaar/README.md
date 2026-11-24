# bazaar

This is GAPS.md round 23's program (docs/reports/GAPS.md): a small relational database of a bazaar's customers, products and orders, written in Ters through the MCP.

```
ters run compiler/gaps/bazaar [orders]
```

The default is 10,000 orders, with a customer for every 20 of them and 40 products. The same count always gives the same data.

## How it goes

1. **Questions as data.** A `Query` is a tree: a table scanned, rows filtered, two tables matched on a key, rows that match nothing in another table, rows grouped with their aggregates (count, sum, highest, mean), a column computed, rows ordered, columns picked, the first rows.
2. **Pushing filters down.** Each filter is cut into the tests that must all pass, and each test goes as low as it can: into the side of a join whose columns it reads, under an anti join's left side, below a computed column it doesn't read.
3. **Planning.** The query becomes a `Plan` whose columns are known by their place: a join a hash join that files the side guessed smaller (a filter is guessed to keep a third), an anti join filing the right side's keys.
4. **Running.** Each plan step gives its rows: rows are arrays of cells, a cell a whole number, a text, an amount or nothing.
5. **The report.** Five questions, each with its plan and its answer as a table: revenue by city, March's busiest buyers, the products no one in Trabzon bought in January, prices by category, and December's largest orders.

The credits are also the program's own comment, shown in the editor's Program tab, and in docs/language/CREDITS.md.
