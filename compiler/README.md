# compiler

Compiles the typed core of `projectional/` to JavaScript. The effect types
decide the shape of the code: functions without `Choice` become plain
functions, and `Choice` becomes nested loops inside generators. `solve`
nodes are planned by the relation solver at compile time and written out as
straight-line arithmetic. Why it's built this way, and what comes next, is
in [`projectional/COMPILER.md`](../projectional/COMPILER.md).

```sh
npm run build   # projectional/examples/{queens,algebra,relations,backwards,calculus} -> out/*.js
npm test        # compiled output must match the evaluator on every example
npm run bench   # eight queens: about 400× faster than the evaluator
```

Plain TypeScript run by Node >= 22.18, no dependencies, like the other
folders. `out/` is generated, but it's committed so the output can be read
without running anything.
