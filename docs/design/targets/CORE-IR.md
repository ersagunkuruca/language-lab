# The core IR (C137b)

`CoreIR` (compiler/src/scalar.ts, called `Lowered` until 2026-11-03) is the
form every compiled target except compiled JavaScript is printed from:
WebAssembly (wasm.ts), C (c.ts), WGSL (wgsl.ts) and JavaScript for the
scalar profile (js-scalar.ts). `lowerScalar` makes it from the typed
program. It started as the "scalar profile" (Float64s and Bools for a GPU)
and has grown into the compiler's middle: data, closures, searches,
handlers, the world, Int, Text, arrays and hash tables. This note writes
down what it is, so a printer can rely on it and a feature can be added
once.

compile.ts is the other lowering. It prints JavaScript straight from the
model, so each feature has been written twice in the compiler
([FOUNDATIONS-2026-11-03](../../reports/reviews/FOUNDATIONS-2026-11-03.md)
§2). C137 replaces it in steps:

- (a) **The rule, from 2026-11-03:** no new feature or optimisation goes
  into compile.ts alone. It goes into a model-to-model pass (as
  `liftLets`, `expandInverses` and `fuseHandlers` are) or into the core
  IR's lowering, where every printer gets it.
- (b) The core IR named and its contract written down (this note).
- (c) A JavaScript printer from the core IR, grown until it runs the
  examples compile.ts runs. I111's agreement test and the fuzz test
  (C101) are the check. Step c1 is compiler/src/core-js.ts: the `data`
  profile's values and control, with Int, Text and Array through the
  evaluator's own builtins; the fuzz test runs it beside WebAssembly and
  C, and skips (and names) the runtime functions it doesn't have yet.
  Step c2 adds tables and Hash sets (the evaluator's Table) and seeded
  Random, so every generated program runs. Step c3 adds the world
  (`runCoreMain`), checked on wc, ledger, chapters and calc's mains.
- (d) compile.ts retired piece by piece.

## What it holds

```
CoreIR {
  funcs     SFunc[]       the lowered definitions, and the functions the
                          lowering made (folds, closures' code, searches)
  refused   Map<Id, why>  definitions that couldn't be lowered, and why
  records   RType[]       records (one case): a struct of fields
  data      DType[]       data types (several cases, or containing
                          themselves): a case number and fields
  arrays    AType[]       std's Array, one per item type (C66)
  tables    TType[]       std's Table and Hash set, one per key and value
                          type (C63h to C63j)
  fns       FType[]       function types: closures' code takes the closure
                          first, then the inputs
  shapes    Shape[]       what each closure captured
  escapes   DType[]       operations that never return, besides abort (C34)
  code, info              the program lowered (with derivatives generated)
  rounded   Set<Id>       staged numbers Float32 can't hold
  shader?   true          lowered for a GPU: Int is int32, no answer is a flag
}
```

Three profiles, by `lowerScalar`'s options:

- **none**: Float64, Bool, arithmetic, `if`, lets and calls. No heap. This
  is what a shader can run (WGSL).
- **`records`**: plus records of those. A record's size is known, so a
  shader has it as a struct.
- **`data`**: plus everything with a heap: data types, closures, Int (any
  size), Text, arrays, tables, Choice (one answer or none, or several in
  continuation-passing style), Abort and operations that never return,
  the world, budgets. WebAssembly and C take this one.

`shader` (with or without `records`) makes Int an int32 that gives up past
32 bits, as a budget running out does.

## Types (`LType`)

| type | what | WebAssembly | C |
|---|---|---|---|
| `"f64"` | Float64 | f64 | double |
| `"i32"` | Bool | i32 | int32_t |
| `"int"` | Int, any size | i31, `$big` or `$huge` | `lab_int` (small, or a cell) |
| `"int32"` | Int on a GPU | i32 | (not used) |
| `"text"` | Text, UTF-8 | `$bytes` array | a cell |
| `RType` | a record | struct | struct by value |
| `DType` | a data type | a struct per case under one supertype | a cell per case |
| `FType` | a function | a closure struct holding its code | a cell |
| `AType` | std's Array | buffer and view | buffer and view cells |
| `TType` | std's Table, Hash set | wasm-table.ts | c.ts `tableC` |

A type is identified by its `key`; the same key is the same type in every
function.

## Functions (`SFunc`)

- `params`, `result`, `locals`: local `i` is parameter `i` while
  `i < params.length`, then `locals[i - params.length]`.
- `partial`: one answer or none. The function gives its answer and a
  status: 0 for an answer, 1 for none, 2 for an abort (the reason is in the
  module's `reason`, or `lab_reason` in C).
- `multi`: several answers (W4d). It takes the rest of the search as its
  last input; `answer` is the type of its answers.
- `spends`: each call spends one from the budget, since the checker
  couldn't see it end. `budgeted`: it may only be called under a budget.
- `inner`: made by the lowering, never called from outside.

## Expressions (`SExpr`)

Locals are numbered. Every expression has one value of a known type.

- **Values:** `num`, `int`, `text`, `bool`, `local`, `zero` (a type's
  default).
- **Arithmetic:** `op` (OPS: Float64, Bool and int32 operations, and
  `stop`, which ends the program with a reason). An Int's operations are
  `rt` calls.
- **Control:** `if`, `let`, `call` (`tail` true where it is the last step,
  which a printer makes a loop or a tail call), `case` (a match: the
  scrutinee goes into local `s`, then the arm for its case runs).
- **Data:** `make` and `get` for records; `new`, `field` and `tag` for
  data types; `set` for a box's field (the searches' results).
- **Functions:** `closure` (its code, its shape and what it captures),
  `cap` (one captured value, read in the code), `apply` (call a closure;
  `tmp` is the local the closure goes into).
- **The runtime:** `rt`, a runtime function by name (wasm-rt.ts gives
  every target its signature: `int.add`, `text.split`, `array.push.a0`,
  `table.put.t1`), and `world`, an operation on the world (print, read a
  file).
- **Answers:** `fail` (no answer here), `attempt` (`first`, `optional`,
  `all`, `count` over a search with one answer or none), `budget` (`first`
  around `with fuel`), `abort` (out to the nearest handler of Abort, or of
  the operation `esc` names), `handle` (that handler).
- **Gone after lowering:** `choose` and `search` are made into code once it
  is known whether a search has several answers. No printer sees them.

## The contract

What a printer may rely on:

1. **The checker has run.** Every type is known, every match covers its
   cases (an arm is `null` only where the checker ruled its case out), and
   every call's inputs have the callee's parameter types (the lowering
   refuses a definition otherwise).
2. **Effects are handled before here.** Nothing performs an effect except
   `world` (the host's operations), `fail` and `abort`, and a search with
   several answers (`multi`). Diverge has become a budget or a `spends`
   count.
3. **The meaning is the evaluator's.** Float64s are f64 everywhere, so
   numbers come out bit for bit the same. An Int is exact at any size.
   Where an engine reports an overflow nobody uses later than the
   evaluator would, it may still answer (FLOAT-VALUES-2026-11-01 §2).
4. **Representation is chosen before here.** Lists as arrays or trees,
   maps as tables or trees, are the program's own code by the time it is
   lowered (library-reps.ts). A printer prints the types it is given.
5. **A refusal is an answer.** A definition outside the profile is in
   `refused` with the reason, as a type error would be, and a printer
   never sees it.

## Who checks it

- The fuzz test (compiler/test/fuzz.test.ts, C101) runs generated
  programs on the evaluator, compiled JavaScript, WebAssembly and C,
  through the chooser's representations too, and wants the same text from
  each.
- JavaScript from the core IR (core-js.ts) runs in the fuzz test too, so
  the lowering is checked once more without a WebAssembly or C printer
  between.
- I111's agreement test (examples-agree.test.ts) runs the examples.
- Each printer's own tests (wasm.test.ts, c.test.ts, wgsl tests,
  js-scalar.test.ts).
