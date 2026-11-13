# compiler

Compiles the typed core of `ters/` to JavaScript, WebAssembly, C and GPU
shaders. Every target is printed from one middle form, the core IR
(`src/scalar.ts` lowers a checked program to it;
[CORE-IR.md](../docs/design/targets/CORE-IR.md)): JavaScript by
`src/core-js.ts` (pages by `src/core-page.ts`, sound by
`src/core-sound.ts`), WebAssembly by `src/wasm.ts`, C by `src/c.ts` and
WGSL by `src/wgsl.ts`. The effect types decide the shape of the code:
functions without `Choice` become plain functions, and a search passes the
rest of itself in as a function called on each answer. `solve` nodes are
planned by the relation solver at compile time and written out as
straight-line arithmetic; a relational one whose mode has at most one
answer is its mode plan written out (`src/modes.ts`). The passes that make
the code fast (fusion, arrays and records changed in place, untagged Ints
in loops, columns, work on every core) are passes in `src/`, most of them
on the core IR so every target gets them; [RUNNING.md](../docs/learn/RUNNING.md)
lists them. Why it's built this way is in
[COMPILER.md](../docs/design/targets/COMPILER.md); the targets are
[WASM.md](../docs/design/targets/WASM.md),
[NATIVE.md](../docs/design/targets/NATIVE.md) and
[WEB.md](../docs/design/targets/WEB.md).

The command line drives it: `ters compile`, `ters native`, `ters wasi`,
`ters build-web`, `ters build-app`, `ters build-native-app` and `ters run`
(ters/cli/ters.ts).

```sh
npm run build   # some ters/examples printed as the core IR's JavaScript -> out/*.js, for reading
npm test        # compiled output must match the evaluator on every example and target
npm run bench   # evaluator vs compiled JS, and a numeric loop in WebAssembly
npm run gaps    # the bigger programs: evaluator vs compiled vs the hand-written ideal
npm run gpu     # the WGSL output on a GPU (WebGPU in Chromium) vs the evaluator
npm run wasi -- wc out/wc.wasm   # an example as a WASI command, for wasmtime
```

[`GAPS.md`](../docs/reports/GAPS.md) compares what the compiler emits for
the bigger programs (`gaps/`: calc, chapters, ledger, machine, clinic,
board and the other rounds, each with a hand-written `*.ideal.js`) with
code written by hand, and ranks what's missing. A new round is added with
each bigger program.

Plain TypeScript run by Node >= 22.18, no dependencies, like the other
folders (`gpu.ts` borrows `ters`'s playwright-core). `out/` is generated, but it's committed so the output can be read
without running anything.
