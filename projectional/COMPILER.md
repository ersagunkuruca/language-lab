# Compiling the language: when, to what, and how

This is the decision, not a survey. A working compiler for everything the
typed core has today lives in `compiler/` (top level), with tests that
compare it against the evaluator.

```sh
cd compiler
npm run build   # compiles the five typed examples to compiler/out/*.js
npm test        # the compiled programs must print exactly what the evaluator prints
npm run bench   # evaluator vs compiled
```

## Short answers

- **When?** Now, as a thin backend that grows with the language. Waiting
  until the language is done means the compiler arrives as a big bang and
  finds every semantic question at once. Started now, it costs little,
  because there's no parser and the checker has already done the hard
  analysis. It also gives us a second implementation, so the evaluator and
  the compiler test each other on every example. Each later stage below
  has its own trigger.
- **To what?** JavaScript source code. The editor runs in a browser, and JS
  gives us closures, garbage collection, generators and strings for free.
  V8 then does the low-level work better than we would. Not WASM (we'd
  have to bring our own GC and closures), and not a bytecode VM of our own
  (that's just a faster evaluator). JavaScript stays the main target. The
  other targets (shaders, WebAssembly, native binaries) start from the
  part of the language that needs no heap, and grow from there. See
  "Targets beyond JavaScript" below for the order and the reasons.
- **What is the IR?** No new IR. The node graph plus the checker's `Info`
  (types, effect rows, which definitions may diverge) is the IR. Program
  transformations are code → code functions that produce ordinary
  definitions the editor can show: specialization, and `differentiate`
  from the relations work. JavaScript text is only produced at the last
  step.
- **Effects?** The types decide the shape of the code. Code without
  `Choice` becomes plain JavaScript. Code with `Choice` becomes nested
  `for … of` loops, with the rest of the computation inside the innermost
  loop. `first`, `all` and `count` become loops that stop early, collect,
  or count. `Console` is a function call. `Diverge` costs a counter check,
  and only at calls into definitions the checker couldn't prove terminate.
- **Relations?** The solver runs at compile time. A `solve` node's
  direction is fixed where it's written, so its plan is too: the compiler
  calls `plan(rel, known)` and writes the plan out as code. Plans that need
  a numeric search (tearing, Newton) or a periodic family (`asin(y) + 2πk`)
  call the solver at run time instead, with the plan made once at load. For
  directions that go through matches, strings and folds (the relational
  interpreter, `src/lang/relate.ts`), use Mercury's approach: a static mode
  analysis per (definition, known ports) where it succeeds, and the
  interpreter as a runtime library where it doesn't. Today the interpreter
  runs all of them; the mode analysis is the next stage.

## What the proof of concept shows

All five example programs compile and print exactly what the evaluator
prints. `npm run bench` on this machine:

|                            | evaluator | compiled | speedup |
|----------------------------|----------:|---------:|--------:|
| count every 8-queens board |   1767 ms |   3.1 ms |    576× |
| queens: main               |   2219 ms |   3.5 ms |    641× |
| algebra: main              |     33 ms |   1.0 ms |     35× |
| relations: main            |    2.2 ms |   0.1 ms |     23× |
| backwards: main            |     11 ms |   1.9 ms |      6× |
| calculus: main             |     21 ms |   2.5 ms |      8× |

`backwards` and `calculus` gain least because most of their work is in the
relational interpreter and `derivative`, which still run interpreted (see
stage 1b below).

Eight queens shows what the effect types buy. Its source has no search
code: each row does `one of(range(size))` and fails if the column isn't
safe. The compiler turns that into the backtracking loop you would write by
hand (from `compiler/out/queens.js`):

```js
// queens
function* queens(size) {
  const fold$5 = function* (s$6) {
    switch (s$6.tag) {
      case "std.list.nil" /* nil */: {
        yield $nil;
        break;
      }
      case "std.list.cons" /* cons */: {
        for (const board2 of fold$5(s$6.fields[1])) {
          for (let l$7 = $range(size); l$7.tag === "std.list.cons"; l$7 = l$7.fields[1]) {
            const x$8 = l$7.fields[0];
            const column = x$8;
            if ((safe(column, board2).tag === "std.bool.true")) {
              yield $cons(column, board2);
            } else {
              /* fail */
            }
          }
        }
        break;
      }
    }
  };
  for (const r$9 of fold$5($range(size))) {
    yield r$9;
  }
}
```

`safe` has no `Choice` in its type, so it is a plain function with `&&`,
and `count(() => queens(8))` is a loop with a counter:

```js
let count$1 = 0;
for (const r$2 of queens(8)) {
  count$1++;
}
```

Pattern matching by choice (`first(() => number(constant(l) + constant(r)),
() => …)` in `simplify`) becomes "loop over the one possible answer and
return it, else fall through". The `sum & difference` relation read as
`split(sum, difference)` becomes two lines of arithmetic:

```js
// sum & difference: given a + b, a − b, solve for a, b
const v0 = ((v2 + v3) / 2); const v1 = ((v2 - v3) / 2);
```

## The decisions in more detail

### Two calling conventions, picked by the type

A function whose type has `Choice` compiles to a generator function, and
anything else compiles to a plain function. A call site knows which one it
has from the callee's type, so no runtime check is needed. Inside one
function, each expression is either "exactly one result", compiled as a JS
expression, or "a stream of results", compiled as statements that run a
continuation once per result. The continuation is code that the compiler
pastes into the innermost loop. It is not a closure.

Effect polymorphism (`map : (List a, (a) -[e]-> b) -[e]-> List b`) is
handled by **specializing on the one bit that matters**: does `e` include
`Choice`? So `map` gets at most two copies, `map` and `map$choice`. The
copy needed at each call follows from the instantiated type. There are two
details:

- A row variable that appears only as a definition's own effect, and not
  inside a parameter, is compiled as pure. `safe : (Number, List Number)
  -[e]-> Bool` is called from inside `queens`, which has `Choice`, but
  `safe` can't start choosing because its caller does.
- Where a parameter's row already lists `Choice` (as in `keep`'s test
  function), that position says nothing about the variable.

There is one known imprecision. The checker unifies a call's effects with
the effects of the function body it sits in, so a pure lambda passed to
`map` inside a `Choice` function gets `Choice` in its type. It then
compiles to a generator, which is correct but slower than it needs to be.
The fix belongs in the checker: at a call, require the callee's row to be
*contained in* the surrounding row, instead of equal to it. Do this when
it shows up in a profile, not before.

### The evaluator stays the definition of the language

`src/lang/run.ts` is the reference. The compiler's tests run every example
both ways and compare what they print, the stream of answers from a
`Choice` function, and the solutions of each solved direction in the
solver's order and with its rounding. Any new language feature should be
added to the evaluator first, then to the compiler, with a test that
compares them. Holes compile to a call that throws, the same way the
evaluator throws when it reaches one, so a program with holes still
compiles.

### Relations: the solver is the compiler

The solver already turns (relation, known ports) into a program: isolate
this variable with these branches and guards, solve this linear block,
check that equation. The compiler runs that step at compile time and emits
the program as code (`compiler/src/relation.ts`): a block per branch, an
`if` per guard and check, and deduplication and rounding the same as
`invertible/src/relation.js`. The effect is already known from
`direction()`. A unique direction is a plain expression, and anything else
is a loop over its answers, like any other `Choice`.

Not everything is specialized. Tearing and Newton steps, and periodic
branches (infinite, streamed level by level), call the solver at run time
with a plan made once when the program loads. A degenerate case at run
time (0·x = 0, where x is free) hands that one call back to the solver,
which knows how to report it.

When relations cover the whole language (matches, strings, folds read
backwards), the work splits the same way Mercury's does. For each
(definition, known ports) pair a solve node uses, try a static mode
analysis: order the calls so that each one runs when its inputs are known,
which is the solver's one-unknown rule lifted to calls. If the analysis
works, the direction compiles like a forward function. If it can't order
them statically, because the order depends on values, link `relate.ts` as
the runtime and call it, as tearing calls the numeric solver now. Forward
evaluation is just the direction where only the inputs are known, so it is
always the first mode to compile.

The runtime half is done. A relational `solve` compiles to a call to
`relate.ts`, which works on the program's node table, so a module that
needs it carries that table (`examples/backwards` and `examples/calculus`
do). Functions are not black boxes there: `map` run backwards is passed
`square`, and the interpreter looks inside it. So in such a program every
compiled function remembers its lambda node and the values it closed over,
exactly as the evaluator's functions do (the `META` tag), and is wrapped
when the evaluator has to call it as a stream.

`derivative` works the same way for now: it is handed to the evaluator,
which reads the function's nodes, writes the derivative as new nodes, and
interprets them. When the function is known at compile time (a def, or a
lambda written in place), the better plan is to run `derivativeLambda` in
the compiler and compile the derivative like any other definition. That's
staging, the same idea as running the solver at compile time.

### Diverge and fuel

Only calls into definitions in `info.divergent` (the ones the checker
couldn't prove terminate) check fuel, and only when a `with fuel` handler
is active. In code with `Choice`, running out of fuel means the call has no
result, exactly as in the evaluator. In code without `Choice`, running out
throws, and the handler catches it. These differ in one corner case: a
branch that runs out of fuel inside plain code abandons the whole `with
fuel` body, where the evaluator would let a later branch that makes no
divergent calls still succeed. Nothing does this today. If it starts to
matter, make out-of-fuel a `Choice` failure at every call site.

### Folds are loops; recursion still uses the stack

A `fold` without `Choice` compiles to a loop, so its size is bounded by
memory. When no case has more than one recursive field (lists, Nat, binary
numbers, any chain), the generated code walks down the spine into an array
and then runs one `step` function per item back up it. For trees it keeps
an explicit stack of values whose children are still being folded. Either
way the arms are run children first, as the evaluator does. A million-item
fold and a 100,000-deep tree are in the tests.

What isn't a loop yet:

- **Plain recursion** (a function that calls itself, not a `fold`) is JS
  recursion, so it runs out of stack at around 10,000 levels. The
  evaluator has no such limit. The fix is the same as the evaluator's
  (continuations on the heap) for the functions the checker finds
  recursive, or self tail calls as loops for the common case. Until then,
  `fold` is the way to walk long data in compiled code.
- **A fold with `Choice`** is a recursive generator, one per level.

### Data

Values have the same representation as in the evaluator: numbers, strings,
functions, and `{ tag, fields }` with the variant's id as the tag. That
means compiled and evaluated code can call each other and their results
can be compared directly. Booleans in conditions are plain JS booleans
(`a < b && …`). The ids in `case` labels carry the variant's name as a
comment.

`and` and `or` short-circuit in compiled code. The evaluator evaluates both
sides, which only differs in how much fuel gets spent. Short-circuiting
should become the language's rule, and the evaluator should follow.

## Targets beyond JavaScript: shaders, WebAssembly, native

Ersagun asked: if shaders are a target, why not WebAssembly, and why not
a native binary later? All three are worth doing. They share one
structure, and the order follows from what each one needs beyond the JS
backend.

### What each target needs that JS gives for free

| | JS (now) | WGSL shader | WASM, scalar | WASM, full | native binary |
|---|---|---|---|---|---|
| numbers, `if`, lets, calls | yes | yes | yes | yes | yes |
| recursion | yes (stack-limited) | **no**, bounded loops only | yes, tail calls are `return_call` | yes | yes |
| data (`{tag, fields}`), lists | GC objects | **no**, fixed-size structs and vectors | **no** | WasmGC structs | our own memory management |
| closures, higher-order code | JS closures | **no**, specialized away | **no** | WasmGC + `call_ref` | structs + function pointers |
| `Choice` | generators | **no**, except over a constant list | **no** | success continuations | success continuations |
| effect handlers | a stack of handlers, exceptions | **no** | **no** | handler stack, WASM exceptions | handler stack, return codes |
| text | JS strings | **no** | **no** | JS strings via imports | our own strings |
| the solver fallback, `relate.ts` | linked as JS | **no**, closed-form plans only | **no**, closed-form plans only | call back into JS | port it, or refuse |

The first three columns are the **scalar profile**: Number and Bool,
arithmetic, `if`, lets, and calls between such definitions. It needs no
heap, no closures and no runtime, which is exactly what a GPU and plain
WebAssembly can run. A shader adds one rule (no recursion, because GPUs
have no call stack) and needs vector types. WebAssembly allows recursion.

### WebAssembly for the scalar profile: built

`compiler/src/scalar.ts` checks the profile and lowers a definition to a
tiny expression tree (numbers, locals, operations, `if`, let, call).
`compiler/src/wasm.ts` prints that tree as a WebAssembly module, binary
and text, with no dependencies. Each part maps directly:

- Number is `f64` and Bool is `i32`.
- A let is a local, and `if` is `if … else … end`.
- `sin`, `pow` and friends are imported from the host's `Math`, so results
  are bit-for-bit the evaluator's.
- A call in tail position is `return_call` (the tail-call proposal,
  https://github.com/WebAssembly/tail-call, now
  standard and on by default in V8, Firefox and Safari), so loops written
  as tail recursion run in constant stack.

A definition outside the profile is **refused with the reason**, the way
a type error is reported: `sinc` "has effects (Choice)", `parabola` "calls
polynomial, which takes or gives something other than Number or Bool". So
"can this run on the GPU / in WASM" becomes a question with a visible
answer in the editor (REVIEW.md §5.2, targets as profiles).

From the examples, `cubic`, `wave`, `kink`, `bump`, their generated
derivatives (`cubic′` …), `fall` and `period` compile. The tests compare
each one with the evaluator at several inputs, bit for bit. A numeric
loop written as tail recursion (the area under a cubic) benchmarks like
this:

| steps | evaluator | compiled JS | WASM |
|---:|---:|---:|---:|
| 1,000 | 11 ms | 0.17 ms | 0.01 ms |
| 10,000 | 83 ms | stack overflow | 0.05 ms |
| 1,000,000 | (skipped) | stack overflow | 3.1 ms |

The JS failure is the backend's known limit: plain recursion is JS
recursion. Compiling self tail calls as loops in the JS backend is the
cheap fix and belongs in stage 2 below. It's still a real point for WASM:
tail calls are native, not a transformation we have to get right.

### How the rest maps, when it comes

**Effects.** As designed in LANGUAGE.md, every operation is either
*answered* (tail-resumptive: the case gives one value and the computation
carries on) or *aborting* (the case's value replaces the whole handled
computation). Neither needs first-class continuations, which is what
makes them portable:

- **Answered.** A call to the case found on a stack of handlers. The key
  is the effect's def id (effects have no type parameters). Handlers are
  deep: the case runs with the stack cut back below its own handler, so a
  `Log` case that logs reaches the next handler out. JS: closures on an
  array. WASM: a table of `funcref`s or the handler passed as an argument.
  C: the same with function pointers. An answer case can't have `Choice`
  (the checker forbids it), so it is always a plain call.
- **Aborting.** An exception caught by its match, which also drops the
  computation's remaining `Choice` alternatives (a cut, like Prolog's
  `catch/3`). JS: `throw`/`catch`. WASM: exception handling
  (`try_table`/`throw`, standard). C: a return code checked after each
  call, or `setjmp`/`longjmp`.
- **World effects** (files, console) are host imports in every target. A
  host failure becomes an `Abort` at the call site.

The JS backend does this now: `$perform`, `$handle` and `$handleS` in
runtime.js. A handled computation with `Choice` is a generator, and
`$handleS` keeps its handler on the stack during each of its steps. The
world builtins call the runtime's `World` (`$setWorld`, Node's in
`src/lang/world.ts`). `compiler/test/effects.test.ts` checks each case
against the evaluator. The other targets follow the same scheme.

**`Choice`.** JS uses generators. WebAssembly and C have none, so `Choice`
code becomes **success continuations**: a nondeterministic function takes
an extra argument, "what to do with each answer", and calls it once per
answer. `first` passes a continuation that records the answer and
signals stop. This is how Mercury's high-level C backend compiles
nondeterministic code (Fergus Henderson and Zoltan Somogyi, "Compiling
Mercury to high-level C code", CC 2002,
https://mercurylang.org/documentation/papers.html), and it's the natural reading of our JS output: the
code inside the innermost loop *is* the continuation. It needs closures
(the continuation captures variables), so it comes with WasmGC or with
native closures.

**The solver fallback.** Closed-form plans are already straight-line code
(src/relation.ts), and the same plans can be lowered into the scalar tree
for WASM and shaders. The `$clean` rounding has to come along, so a WASM
solve gives the solver's numbers exactly. Tearing, Newton and periodic
families are bounded loops or streams, so they work in full WASM and
native code but not in a shader. In a shader, `first` of a periodic
family is its canonical branch, which is straight-line. `relate.ts` (a
search over terms with unification) stays a JS library. A WASM module that
needs it imports it from JS. A native binary either has the search ported
or refuses those directions, and the mode analysis (stage 1b) makes most
of them static first.

**Native binaries.** Two routes, in this order:

1. **Now-ish, for CLIs:** package the JS output with a runtime as a single
   executable (Node's single executable applications, `deno compile` or
   `bun build --compile`). That gives one file and no install step at
   almost no cost, and it is what the CLI target needs first.
2. **Real native code:** emit C, the route Koka takes. The language is
   pure and its data can't form cycles (nothing is mutable), so reference
   counting with reuse (Koka's Perceus: Alex Reinking, Ningning Xie,
   Leonardo de Moura and Daan Leijen, "Perceus: Garbage Free Reference
   Counting with Reuse", PLDI 2021,
   https://www.microsoft.com/en-us/research/publication/perceus-garbage-free-reference-counting-with-reuse/)
   gives garbage-collector-free memory management that frees exactly when
   the last reference goes. C then gets
   us every platform via any C compiler, and WebAssembly again via clang.
   LLVM IR directly would give more control but no portability, and it's
   more work.

Full WebAssembly via WasmGC (structs, closures, exceptions) is the last of
these, not the first. In a browser it competes with our own JS backend,
which already runs on a mature JIT. Its real use is running the same
program outside a JS host, and the C route covers that too.

### The order

1. **WebAssembly, scalar profile.** Done in this change. It's the CPU
   fallback for shader code and a fast path for numeric kernels.
2. **WGSL shaders.** A second printer for the same scalar tree, plus a
   "no recursion" rule, vector types (`vec3`, `mat4`) and `Float32`. Every
   piece of this is shared with step 1. This is REVIEW.md's stage 7 (the
   SDF ray marcher).
3. **Single-file executables** from the JS output, with the CLI target
   (effects thread).
4. **Grow the scalar profile** towards the heap: fixed-size records
   (flattened into locals), then lists. This step also opens shaders to
   structs.
5. **Native via C** with reference counting and success continuations.
   Start when a CLI needs fast startup or low memory, or the language needs
   to be embedded somewhere without JS.
6. **Full WASM via WasmGC.** Only when a program has to run in a
   WebAssembly-only host.

## When to do what

| stage | what | start when |
|---|---|---|
| 0 | pure code, `Choice`, `Console`, `Diverge`, `solve` with closed-form plans; differential tests (this PR) | done |
| 1a | relational directions and `derivative` through their interpreters, linked as the runtime; compiled functions carry their nodes | done (all five examples match the evaluator) |
| 1b | mode analysis, so relational directions compile; `derivative` at compile time when the function is known | next; worth it once a backwards search shows up in a profile |
| 2 | compile in the editor: a "run compiled" button using a blob module, with a cache keyed by each definition's content hash, so only changed definitions recompile | a program in the editor is too slow to run live, or someone wants to share a runnable program |
| 2½ | self tail calls as loops in the JS backend (the scalar benchmark overflows at 10,000 steps; compiled calc crashes on 5,000 lines, GAPS.md G1) | next small fix |
| 3 | user-defined effects and handlers: answered operations as calls to a handler stack, aborting ones as exceptions; `Choice` stays special (loops); the world through the runtime's `World`; `lab compile` (projectional/cli/lab.ts); `Cells` as calls on one runtime `Cells` instance | done |
| 4 | containment instead of equality for effect rows at call sites, so pure lambdas inside `Choice` code stay plain functions | a profile shows generator overhead from it |
| 5 | other targets: WASM scalar profile (done), WGSL, single-file executables, native via C, WasmGC | the order in "Targets beyond JavaScript" |

Things not to build: a parser, our own bytecode VM, or a typed IR separate
from the node graph. Each would be a second copy of something we already
have.

## Files

```
compiler/src/compile.ts    the code generator: conventions, specialization, loops for Choice
compiler/src/relation.ts   a solve plan, written out as code
compiler/src/runtime.js    what generated code links against (handlers, fuel, solver and relate.ts fallbacks, derivative)
compiler/src/scalar.ts     the scalar profile: check it, refuse with a reason, lower to a small tree
compiler/src/wasm.ts       that tree as a WebAssembly module (binary and text), tail calls as return_call
compiler/src/fixtures.ts   small programs for the tests and the benchmark
compiler/src/program.ts    load, check and compile an example
compiler/build.ts          writes compiler/out/*.js
compiler/bench.ts          evaluator vs compiled
compiler/test/             compiled vs evaluated, on every example
compiler/GAPS.md           a bigger program's compiled output vs a hand-written ideal, gaps ranked
compiler/gaps/             that program's ideal JS and the benchmark behind GAPS.md
```
