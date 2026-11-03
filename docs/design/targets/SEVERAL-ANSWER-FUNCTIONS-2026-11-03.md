# Function values with several answers on the core IR (C137 design, 2026-11-03)

Two examples still don't lower to the core IR because they make a
function value whose body chooses among several answers:

- conjugate: `brighter` makes one.
- pedal: `pedal on` → `driven lows` → `drive` makes one.

Both stop at the same refusal in scalar.ts `several_`, "makes a function
that chooses among several answers (not in WebAssembly yet)". So
JavaScript, WebAssembly and C all lack it, and these two programs still
need compile.ts.

## Why only closures

A *definition* with several answers is already lowered. Once the
fixed point in `several_` marks it `multi`, it gets one more parameter,
the continuation (the rest of the search, a closure of type
`kOf(answer)`). Its body is put in continuation-passing style, and it
answers success or failure as an i32. Every call site of a definition is
known, so each one can pass the rest.

A *closure* is called through `apply` on its function type (`FType`),
and the caller knows only that type. Two closures of one type can differ:
one chooses, one doesn't. `multi` is found after lowering, so the type a
caller sees doesn't say which convention to use. That is the whole
problem. The continuations themselves already work on all three targets,
because they are closures too.

## Options

**(a) The convention comes from the type.** A function type whose effect
row has Choice gets a flag of its own in its FType (`several`, a suffix
on the key, beside the `!` that partial gives today). Every closure of
that FType takes the continuation and answers an i32. A closure of that
type whose body happens not to choose is given the convention by a
wrapper: it calls the continuation once with its answer. An `apply` on a
`several` FType counts as several answers in `cps`, like a call to a
multi definition. This is decided before lowering, from the checker's
types, so callers and closures agree. Generic code needs nothing extra:
scalar.ts already lowers a definition once per instantiation of its
types and rows (`At`), so a row variable that becomes Choice at one call
gives a several FType there, and a plain one elsewhere.

**(b) Two entry points per closure,** direct and continuation-passing.
Each apply picks the one its context needs. This is faster where a
choosing type is used in a place that wants one answer, but every
closure is twice the code, and the closure struct needs two function
slots on WebAssembly and C.

**(c) Specialise at known functions.** Where the closure given to a
higher-order function is known (conjugate's `brighter` is given in place),
copy the callee with the lambda inlined, so no function value remains.
This is defunctionalisation (Reynolds 1972) and GHC's SpecConstr. It
gives the fastest code where it applies, but not for a function kept in
a data structure or a cell.

**(d) Answers as a list.** A several closure gives back all its answers
at once. This is simple, but `first` would do all the work, and a search
with infinitely many answers would never return.

## Recommendation: (a), and (c) later where it measures

(a) reuses what multi definitions already do, on all three targets. It
needs no new runtime and follows the language's own types. A function
typed with Choice *may* choose, and its callers are written for that.
The wrapper's cost (one closure call per answer) falls only on functions
typed with Choice whose body doesn't choose. (c) is an optimisation for
afterwards, and only where conjugate's or pedal's numbers show the
closure calls.

Steps:

1. **FType gets `several`** when the resolved row holds Choice (scalar.ts
   `stype` of a function type, and its key). No change to what's lowered
   yet. A test checks that the FTypes in conjugate and pedal have it.
2. **Closures of a several FType are lowered with the continuation.**
   `several_` treats closure code as it treats a multi definition, the
   refusal goes, and a non-choosing closure of that type gets the
   one-call wrapper.
3. **`apply` on a several FType is several answers** in `cps`, passing
   the rest as the continuation. A closure that is called where one
   answer is wanted (`first`, `optional`) gets a continuation that keeps
   the first answer and stops, as for definitions.
4. **Tests:** conjugate and pedal on the core IR's JavaScript, WebAssembly
   and C against the evaluator (core-js.test.ts drops them from its
   refused list), plus fuzz seeds whose lambdas choose.

No decision is needed from Ersagun. This is how the compiler lowers what
the language already means.

Prior art: continuation-passing closures for backtracking in Prolog
compilers (BinProlog, Mercury's model_non procedures, which take a
success continuation); Koka's and Effekt's type-directed selective CPS,
which transforms only functions whose effect type needs it; Reynolds'
defunctionalisation for (c).
