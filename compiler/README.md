# compiler

Compiles the typed core of `projectional/` to JavaScript. The effect types
decide the shape of the code: functions without `Choice` become plain
functions, and `Choice` becomes nested loops inside generators. `solve`
nodes are planned by the relation solver at compile time and written out as
straight-line arithmetic; a relational one whose mode has at most one
answer is its mode plan written out (`src/modes.ts`), and the rest run
in the relational interpreter. Why it's built this way, and what comes next, is
in [`projectional/COMPILER.md`](../projectional/COMPILER.md).

The scalar profile (Float64 and Bool functions: arithmetic, `if`, lets,
calls) also compiles to WebAssembly (`src/scalar.ts`, `src/wasm.ts`), with
tail calls as `return_call`. `out/calculus.wat` shows the output. The same
lowering prints as WGSL for the GPU (`src/wgsl.ts`, `out/calculus.wgsl`):
`f32`, no recursion except a call to itself as the last step, which is
printed as a loop. For the GPU the profile also takes records of Float64s
and Bools (a point, a colour), printed as structs. `npm run gpu` runs it
with WebGPU in headless Chromium and compares it with the evaluator.

```sh
npm run build   # projectional/examples/{queens,algebra,relations,backwards,calculus} -> out/*.js
npm test        # compiled output must match the evaluator on every example
npm run bench   # evaluator vs compiled JS, and a numeric loop in WebAssembly
npm run gaps    # calc: evaluator vs compiled vs the hand-written ideal
npm run gpu     # the WGSL output on a GPU (WebGPU in Chromium) vs the evaluator
```

[`GAPS.md`](GAPS.md) compares what the compiler emits for a bigger program
(`examples/calc`, a calculator) with JavaScript written by hand, and ranks
what's missing. It's redone at each compiler milestone.

Plain TypeScript run by Node >= 22.18, no dependencies, like the other
folders (`gpu.ts` borrows `projectional`'s playwright-core). `out/` is generated, but it's committed so the output can be read
without running anything.
