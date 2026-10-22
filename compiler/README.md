# compiler

Compiles the typed core of `projectional/` to JavaScript. The effect types
decide the shape of the code: functions without `Choice` become plain
functions, and `Choice` becomes nested loops inside generators. `solve`
nodes are planned by the relation solver at compile time and written out as
straight-line arithmetic. Why it's built this way, and what comes next, is
in [`projectional/COMPILER.md`](../projectional/COMPILER.md).

The scalar profile (Number and Bool functions: arithmetic, `if`, lets,
calls) also compiles to WebAssembly (`src/scalar.ts`, `src/wasm.ts`), with
tail calls as `return_call`. `out/calculus.wat` shows the output.

```sh
npm run build   # projectional/examples/{queens,algebra,relations,backwards,calculus} -> out/*.js
npm test        # compiled output must match the evaluator on every example
npm run bench   # evaluator vs compiled JS, and a numeric loop in WebAssembly
```

Plain TypeScript run by Node >= 22.18, no dependencies, like the other
folders. `out/` is generated, but it's committed so the output can be read
without running anything.
