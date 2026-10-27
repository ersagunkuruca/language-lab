# Interfaces and implementations (design note, 2026-10-27)

BACKLOG L40b, from ALGEBRA-TABLES.md "the question". **Step 1 is built**
(L40e, `test/interfaces.test.ts`). Ersagun, 2026-10-27:
a type's operations should be "a separate thing, because if it is separate
you can add more interface implementations later, not just + * - /. For
example for dual numbers we will probably need implementations of sin,
cos, tan, exp etc." And: dynamic dispatch "is an indirection that brings
down the performance of the code a bunch. So I want to brainstorm a way to
handle that to have 0 cost if possible, or minimal cost if not." He agreed
to the outline below the same morning.

## Short answer

- **An interface is a record type of functions**, marked as one. `Trig a`
  has the fields `sin`, `cos`, `tan`, `exp`, `log`, each `(a) -> a`. Its
  fields are its operations: `sin(x)` is a use of Trig's `sin` field.
- **An implementation is an ordinary definition of that record type at
  one type.** A definition whose type is `Trig Dual` is how Dual does
  Trig. Nothing on the Dual type changes, so anyone can add an
  implementation later, for any interface, without touching the type.
- **There is one implementation per (interface, type)**, the coherence
  rule. A second one is an error that names both.
- **Uses are resolved before the program runs**, the way `+` is today
  (arith.ts). A generic definition is copied once per type it is used at
  (monomorphisation), and `sin` at Dual becomes a direct call of Dual's
  sine. No record exists at run time, so nothing is looked up. Static
  dispatch costs nothing.
- **Dynamic dispatch happens only when the program asks for it**, by
  passing an implementation as a value. That is an ordinary record of
  functions, so it needs no new feature, and its cost is visible where it
  is written: one call through a field.

## Why a record of functions

The language already has every part of this:

- A one-variant typedef is a record, and a ref to one of its fields is
  that field's projection (model.ts).
- A typedef can already carry a flag that changes what its parts mean.
  An effect is a typedef with `effect: true` whose variants are its
  operations. An interface is a typedef with `interface: true` whose
  fields are its operations. Same node kinds, one more flag.
- Implementations are definitions, so they are stored by id, hashed,
  published, renamed and translated like any other. Names stay
  presentation. Renaming `dual sine` changes nothing, and neither does
  translating "sin".

This is what Haskell's type classes mean: a class is the type of a
dictionary of functions, and an instance is a dictionary (Wadler and
Blott, 1989). Haskell usually passes the dictionary at run time and
optimises it away when it can. Here it is the other way round. The
dictionary is resolved away always, and passed at run time only when the
program writes it. That is Rust's split: traits are monomorphised, and
`dyn Trait` is the indirection you ask for.

## How it reads

```
interface Trig a = trig(sin: (a) -> a, cos: (a) -> a, tan: (a) -> a, exp: (a) -> a, log: (a) -> a)

trig at float64 = trig(builtin sin, builtin cos, builtin tan, builtin exp, builtin log)

dual sine(d)   = dual(sin(value(d)), cos(value(d)) · slope(d))
dual cosine(d) = dual(cos(value(d)), −sin(value(d)) · slope(d))
...
trig at dual = trig(dual sine, dual cosine, dual tangent, dual exp, dual log)

wave(x) = sin(x) · cos(x)            // (a) -> a where a has Trig and is a number type
wave(3.0)                            // Float64: builtin sin and cos
wave(dual(3.0, 1.0))                 // Dual: the value and the derivative
```

`wave` is written once. Its type says which interfaces its variable
needs, as types print `where a is a number type` today. Each use picks
its type, and each type its implementation.

## How it is resolved

The checker and arith.ts grow from what `+` already does:

1. **The checker.** Using an interface's field puts a constraint on the
   type variable: "a has Trig". A scheme carries its constraints, as it
   carries `arith` and `ordered` now. When the type is known (Dual, a
   closed type) the checker looks for its implementation. If there is
   none it reports "Dual has no Trig" at the use. A variable still open at
   the end is Float64, as for numbers today, so `wave` alone runs in the
   Run pane.
2. **Finding implementations.** The implementations in scope are the
   definitions whose type is an interface at a closed type: the program's
   own, and the prelude's and pinned modules'. They form a table from
   (interface, type) to definition, built once per check. Two entries for
   one pair is an error that names both. A program can't quietly change
   what `sin` means at a type the library already covers.
3. **Resolving** (arith.ts). Generic definitions are copied per type, as
   now. A use of a field at a type becomes the implementation's argument
   for that field. When the implementation is a constructor call whose
   arguments are refs, as above, that is the ref itself, so `sin(d)` at
   Dual is a direct call of `dual sine`. Otherwise the argument is lifted
   into a definition of its own first. After this pass no runner sees an
   interface: the evaluator, relate.ts, compiled JS, WASM, C and the GPU
   get plain calls. That is why the GPU keeps working.

**What it costs, said plainly.** Running costs nothing. A call through an
interface is the same direct call you would have written by hand, and the
JavaScript engine or the C compiler can inline it. The price is paid in
code size and compile time: a generic definition used at three types is
three copies. C++ templates and Rust pay the same. The copies are only
the ones the program uses, and Hindley-Milner has no polymorphic
recursion, so the copying always ends.

## Dynamic dispatch, on request

Sometimes the type is only known while running: a list of shapes of
different kinds, or a plugin. Then the program passes the implementation
as a value, because an implementation is just a record:

```
draw all(shapes, how) = map(shapes, (s) => match how { drawing(draw) => draw(s) })
```

Here `how` is an ordinary parameter of a record type, taken apart with a
match. (A ref to the field itself is the interface's operation, resolved
before running, so a record passed along is reached through its case.)
Calling `draw` is one indirect call, written where you can see it. If the record is known when compiling, the compiler may
still resolve it (a constant field projection), but the program doesn't
count on that.

A later step packs a value with its implementation, Rust's `dyn Trait`
or Haskell's existential types, so `List (some Shape)` can hold different
types. That is a convenience over the record, and it waits until a
program needs it.

## What changes for `+ − · <`

`+ − · −x <` become the operations of two std interfaces, `Arithmetic`
and `Ordered`. arith.ts's tables become implementations:

- AT: Float64's and Int's builtins.
- PRELUDE_AT: Rational's `add fractions` and Complex's `multiply
  complex`.
- BUILTIN_AT: Algebraic's builtins.

The special case goes: a type you write yourself joins `·` by defining
`arithmetic at quaternion = arithmetic(..., table product(quaternion
table), ...)`. This answers ALGEBRA-TABLES.md's question. The answer is
neither a field on the type nor names in its module, but a separate
implementation found by its type.

The rule that a record of Float64s does `+` part by part stays, as a
built-in implementation used when the record type has none of its own,
the way Haskell derives one. A quaternion that has its own `·` uses it,
and a colour keeps the rule. Literals at a type need one more operation,
"from a fraction" (Haskell's `fromRational`). It goes in `Arithmetic`, so
`2` at a quaternion means something.

## Steps

1. **Interfaces in the checker and arith.ts. Built.**
   - The `interface` flag on typedefs (model.ts; `Lang.interface` in the
     DSL), and constraints in schemes and pins (`Scheme.needs`). Types
     print `where a has Halving`.
   - The table of implementations, with the coherence error
     (`Info.implementations`). An implementation must be written as the
     record itself, `halving(…)`.
   - Resolution to direct calls (arith.ts `implement`): a field given as
     a ref is used as it is, and anything else becomes a definition of
     its own.
   - An open whole literal is an Int only when Int has every interface
     it needs. Otherwise it is a Float64, as Haskell's defaulting tries
     each type in turn.
   - Tests: an interface at Float64 and at a record, evaluated and
     compiled; the resolved program has no interface left; a missing
     implementation, and two at once; a pin keeps what it needs; an
     implementation passed as a value.
2. **`Trig` in std**, with Float64's implementation as the builtins.
   `sin` and friends become generic the way `+` did, and the per-type
   ones stay for programs already written.
3. **Dual numbers** in the prelude, with `Arithmetic` from
   `table product(dual table)` and `Trig` from the chain rule. A
   derivative by dual numbers is tested against derive.ts (L45).
4. **`+ − · <` move onto `Arithmetic` and `Ordered`.** AT, PRELUDE_AT
   and BUILTIN_AT become implementations. Quaternions join (L42, L43).
5. **The editor** (lane E): the "interface" toggle on a type, as the
   "effect" one, and `where a has Trig` in types.
6. **A value packed with its implementation**, when a program needs it.

## Prior art

- Philip Wadler and Stephen Blott, "How to make ad-hoc polymorphism less
  ad hoc" (POPL 1989): type classes, with instances as dictionaries.
- Rust's traits: monomorphised by default, `dyn Trait` for dynamic
  dispatch on request, and coherence (one impl per trait and type).
- C++ templates and MLton's whole-program monomorphisation (already
  credited for arith.ts).
- Scala's implicits and ML modules, which treat an implementation as an
  ordinary value.
