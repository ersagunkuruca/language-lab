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
  (that's just a faster evaluator). WASM comes in only if a numeric
  benchmark, such as a big physics network, shows JS is the bottleneck.
  Even then it would be for numeric kernels only.
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

## When to do what

| stage | what | start when |
|---|---|---|
| 0 | pure code, `Choice`, `Console`, `Diverge`, `solve` with closed-form plans; differential tests (this PR) | done |
| 1a | relational directions and `derivative` through their interpreters, linked as the runtime; compiled functions carry their nodes | done (all five examples match the evaluator) |
| 1b | mode analysis, so relational directions compile; `derivative` at compile time when the function is known | next; worth it once a backwards search shows up in a profile |
| 2 | compile in the editor: a "run compiled" button using a blob module, with a cache keyed by each definition's content hash, so only changed definitions recompile | a program in the editor is too slow to run live, or someone wants to share a runnable program |
| 3 | user-defined effects and handlers: one-shot handlers as generators that yield effect requests; `Choice` stays special (loops), because it is the one multi-shot effect | user-defined effects are added to the checker |
| 4 | containment instead of equality for effect rows at call sites, so pure lambdas inside `Choice` code stay plain functions | a profile shows generator overhead from it |
| 5 | WASM for numeric kernels (networks solved in one direction, run many times) | a numeric benchmark shows JS is the bottleneck |

Things not to build: a parser, our own bytecode VM, or a typed IR separate
from the node graph. Each would be a second copy of something we already
have.

## Files

```
compiler/src/compile.ts    the code generator: conventions, specialization, loops for Choice
compiler/src/relation.ts   a solve plan, written out as code
compiler/src/runtime.js    what generated code links against (handlers, fuel, solver and relate.ts fallbacks, derivative)
compiler/src/program.ts    load, check and compile an example
compiler/build.ts          writes compiler/out/*.js
compiler/bench.ts          evaluator vs compiled
compiler/test/             compiled vs evaluated, on every example
```
