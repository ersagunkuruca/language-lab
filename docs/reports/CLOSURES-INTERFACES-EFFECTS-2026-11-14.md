# Closures and interfaces, data and effects: one shape or four? (2026-11-14)

Ersagun, 2026-11-14: "Closures and interfaces are similar in a way,
right? Am I wrong to think that? It's like let, lambda and define thing.
Also maybe sum types vs effects. Shall we merge these in the underlying
language or make use of laws about these things while compiling?"

This is a design analysis, kept as written. It builds nothing. Its
proposed rows are in BACKLOG.md's Inbox (§6).

## Short answer

- **You're right.** A closure is a record of captured values with one
  function. An interface's implementation is a record of functions. When
  a program passes an implementation as a value, the compiled code holds
  exactly a record of closures (§2.1). Data and effects are the same pair
  one level over: an operation is a constructor, and a handler is a fold
  over the computation the operations build (§3.1).
- **Ters has already merged them as far as the meaning goes.** Data
  types, records, effects and interfaces are one node kind, `typedef`,
  with a flag (`effect: true`, `interface: true`). Operations are
  variants, interface operations are fields, a handler is a `match`, and
  an implementation is an ordinary definition (model.ts; SPEC §1.5). No
  interface or handler value exists at run time that isn't a record or a
  closure.
- **What stays apart is a real difference, not a kink.** A closure is
  picked by the value you hold; an implementation is picked by a type,
  before the program runs, one per type. A datum is stored; an operation
  is performed in direct style, and its shape (returns, never returns,
  answered later) tells every target what it must keep. Merging either
  pair would lose something Ersagun decided to have: zero-cost static
  dispatch with coherence (2026-10-27), and effects without monads
  (2026-10-21).
- **Recommendation: keep four readings of one shape, as now, and use
  the laws in the compiler.** Most of the laws are already passes
  (monomorphisation, closure conversion, lambda lifting, specialisation at
  a function argument, handler fusion). The probe in §2.4 found one gap
  worth a row: a *known* implementation passed as a value is still a
  record built, a field read and an indirect call. Two more laws
  (defunctionalisation for shaders, fusing `steps` with its match) are
  rows that wait for an example.

| pair | same how | apart because | law in the compiler | built? |
|---|---|---|---|---|
| closure, interface | both are records of functions | a closure is picked by value; an implementation by type, statically, one per type | monomorphisation; closure conversion; specialisation at a known record | first two yes; known record no (C224) |
| closure, data | a closure of a known set of lambdas is a case of a sum | a closure's set of cases is open; a sum's is closed | defunctionalisation | no (C225, waits) |
| data, effect | an operation is a constructor; a handler is a fold | an operation is performed in direct style, its rest implicit; rows are sets | handler fusion; case of a known constructor | yes (C64a, C64b); `steps` fusion no (C226, waits) |
| interface, effect | a handler of operations that return is an implementation | an implementation is picked by type; a handler by where the call is | evidence passing (a handler passed like a dictionary) | yes (C64b) |

## 1. The let, lambda and define pattern

The comparison with let, lambda and define is a good one, because Ters
has already settled that triple, and how it settled it is the rule for
the other pairs.

- **A `let` is a call of a lambda.** SPEC §1.5: "A `let` is a call of a
  lambda; `if` is a match on `Bool`. Neither is its own kind." The two
  meant the same thing and a reader learns nothing from the difference,
  so the language has one node and the editor shows it two ways.
- **A definition and a lambda stay apart, with a law between them.** A
  definition has an identity, a hash, a place in the side menu, and can
  be published; a lambda has none of those and may capture what is
  around it. Lambda lifting (Johnsson 1985) moves one into the other:
  the editor's "Make it a definition" (E164), the compiler's
  `lift-lets.ts` (C54) and `results-fn.ts` (L225e). The difference says
  something the reader and the checker use, so both stay, and the law is
  a tool.

So the test for a pair is:

1. **Merge into one node kind** when the meaning is the same and the
   difference tells the reader nothing (`let`, `if`, `call` and `solve`
   in L130d).
2. **Keep both, with a law between them,** when the difference says
   something the checker, a target or a reader relies on. The law then
   lives in the compiler (or the editor), never in the meaning.

That is also the TWO LANDSCAPES rule from the effects review of
2026-10-24: ideas clean in the language, target kinks in the compiler,
and keep things simple. Below, each pair is put through the test.

## 2. Closures and interfaces

### 2.1 The same thing at run time

A closure is code plus what it captured. The core IR spells it out:
`closure` is "its code, its shape and what it captures" (CORE-IR.md),
a struct whose first field is the code on WebAssembly and a cell on C.
That is an object with one method.

An interface is a record type of functions (INTERFACES.md): `Trig a =
trig(sin, cos, tan, exp, log)`. Its value, when a program passes one
(`half through(how, x)` in `ters/test/interfaces.test.ts`), is a record
whose fields are closures. Lowered, it is literally that: `halving at
float64` becomes `make Halving(closure half f, closure twice f)`, and
`half through` becomes `get half` then `apply` (probe, §2.4). A record of
closures that share what they captured is an object in the OCaml or
JavaScript sense.

This is old and well loved. "Closures are a poor man's objects" and "objects
are a poor man's closures" is a koan of the Scheme community (usually
told of Norman Adams and Christian Queinnec, written down by Anton van
Straaten). Reynolds (1975) set procedural data (objects) against
user-defined types (abstract data types) as complementary; Cook (2009)
made the same split sharp: an object is known by what you can ask of it,
an abstract type by its representation.

### 2.2 What is different in Ters

The record is only the shape. What an *interface* adds is how the record
is chosen:

1. **Who picks.** You call the closure you hold. An interface's
   operation, `sin(x)`, is resolved by the checker from `x`'s type,
   before anything runs (SPEC §4.6). Nothing is passed.
2. **Coherence.** Two closures of one type are fine. Two implementations
   of one interface at one type are an error that names both
   (INTERFACES.md step 1), so a program can't quietly change what `+`
   means at a library's type. Dual and Complex once hashed equal and
   merged their operations; the fix (a `unique` salt) only matters
   because the choice is by type.
3. **What is captured.** A closure captures values from the running
   program. An implementation captures nothing but other implementations:
   `arithmetic at duo : Arithmetic (Duo a)` (L219) is a function from
   `a`'s implementation to `Duo a`'s, which *is* a closure, over
   dictionaries, and the checker runs it before the program does.

In Cook's terms, Ters's interfaces are type classes, on the abstract-type
side (Wadler and Blott 1989), and closures are on the object side. The
record of functions a program passes by hand is where the two meet, and
it needs no feature of its own.

### 2.3 Merging, considered

- **(a) Implementations as ordinary values found implicitly** (Scala's
  implicits; OCaml's modular implicits, White, Bour and Yallop 2014).
  An implementation becomes a value in scope that the checker passes for
  you. Gains: one concept fewer, local instances. Loses: coherence
  (two in scope can disagree), and zero cost becomes something the
  optimiser usually manages instead of something the language promises.
  Ersagun asked for the promise (2026-10-27). **Not recommended.**
- **(b) Closures as instances of a one-operation interface** (Java's
  functional interfaces: a lambda is an instance of a single-method
  interface). Every function type would need an interface named for it,
  and a lambda would need the interface it is checked against. Ters's
  function types are structural and inferred, so this adds names and
  takes nothing away. **Not recommended.**
- **(c) As now.** An interface is a typedef with a flag; an
  implementation is a definition; dynamic dispatch is a record passed
  by hand. When L256 (a value packed with its implementation, `List
  (some Shape)`) is built, build it as what it is: a record of closures
  that captured the value, an existential as an object (Pierce, *Types
  and Programming Languages*, ch. 24; Läufer 1996 for type classes with
  existential types). No new run-time kind. **Recommended.**

### 2.4 The laws, and what the compiler does today

A probe (a throwaway test against `lowerCore`, not committed) lowered
three small definitions and read the core IR:

- **Monomorphisation.** Built (arith.ts `implement`, INTERFACES.md step
  3): `quarter` at Float64 calls `half f` directly, no record built
  (`interfaces.test.ts` checks it).
- **Closure conversion.** Built: the core IR's `closure`, `cap` and
  `apply` (CORE-IR.md); WasmGC structs and `call_ref`, C cells and
  function pointers (WASM.md).
- **Lambda lifting.** Built: `lift-lets.ts`, `results-fn.ts`, E164.
- **A closure made and called right there.** Built: `closure here(y) =
  let f = (z) => z + y in f(4)` lowers to `4 + y`, no closure.
- **Specialisation at a function argument.** Built: `closure-args.ts`
  (C30) copies a definition for a lambda written where it is called
  (Chin and Darlington's higher-order removal; GHC's SpecConstr).
- **Specialisation at a known record of functions. Not built.**
  `passed along(y) = half through(halving at float64, y)` lowers to: build
  the `Halving` record of two closures, call `half through`, which reads
  the `half` field and calls it through `apply`. Everything is known when
  compiling, so this should be `half f(y)`. INTERFACES.md says "the
  compiler may still resolve it (a constant field projection), but the
  program doesn't count on that"; today it doesn't. This is
  closure-args.ts's law for a record of closures instead of one closure,
  GHC's specialisation of dictionary arguments. **Row C224.**
- **Defunctionalisation. Not built** (Reynolds 1972; Danvy and Nielsen,
  "Defunctionalization at work", 2001). Where every lambda of a function
  type is known (the whole program is), a function value can be a datum
  of a sum with one case per lambda, holding its captures, and calling it
  a `match` that runs the case's body. WGSL has no function pointers, so a
  shader today runs only closures that are "specialized away"
  (COMPILER.md's table), so a shader can't run one picked at run time,
  such as a distance function chosen per object. Defunctionalised, it runs, and
  WebAssembly and C get a switch in place of an indirect call.
  SEVERAL-ANSWER-FUNCTIONS-2026-11-03 named it as option (c) and left it
  for when numbers show the calls. **Row C225, waits for an example.**

## 3. Data and effects

### 3.1 The same thing, read as data

An effect is a data type whose cases are operations (SPEC §6.1), and a
handler is a `match` on them (§6.2). Read as data, a computation that
performs `E` is a tree: each node is one of `E`'s operations, with a
child for each answer the rest could be given. That tree is the free
monad of `E` (or the freer one, Kiselyov and Ishii 2015), and a deep
handler is a fold over it: one arm per operation, applied all the way
down. That is the theory effect handlers come from (Plotkin and Pretnar
2009, 2013: a handler is a homomorphism out of the free model).

Ters already has the data side in the library, with functions both ways:

| computed (an effect) | stored (data) | across |
|---|---|---|
| `Choice` | `Optional a` | `optional(action)`; `value of(o)` |
| `Abort` | `Outcome` | `attempt(action)`; a match that aborts |
| any `E` | `Steps of E R ε` (L229) | `steps of E(c)`; a case that resumes the rest |

`steps` is exactly the free-monad view, one layer at a time (a shallow
handler, Hillerström and Lindley 2018), derived from `E` with no new
node kind.

### 3.2 What is different

1. **Direct style.** Performing `ask(q)` gives an answer and carries on.
   With data you build `ask(q, rest)` and write the rest yourself, which
   is a monad's bind. LANGUAGE.md's "Effects, and why not monads" is the
   reason Ters has effects at all: `map` stays one function, not `map`
   and `mapM`.
2. **Rows are sets.** Effects combine in any order, and a function's row
   is inferred. Free monads combine by a sum of their operations, which
   needs injections (Swierstra, "Data types à la carte", 2008) or an
   order of layers that changes the meaning.
3. **The shape is on the operation.** ANSWERED-LATER.md "Why declared on
   the operation" is the argument: the place an operation is performed
   must know whether its rest may be kept. Every operation as data would
   make every rest a value, so every effectful function would need a
   suspendable copy on every target.
4. **Choice has a fixed search order.** SPEC §7.4 fixes the order of a
   search's answers. As a free monad, the order would be whatever the
   handler chooses, and two engines could disagree.
5. **A datum is stored; a performance isn't.** A datum can be put in a
   list and compared; an operation happens. Folding the other way (every
   data type an effect, every match a handler) would make storing
   impossible.

### 3.3 Merging, considered

- **(a) Effects as data everywhere** (the freer-monad style of Haskell's
  effect libraries): monads in the language, a step built per operation,
  and the shapes lost. **Not recommended.**
- **(b) Data as effects:** nothing to store. **Not recommended.**
- **(c) As now,** one typedef with a flag, and the derived data forms
  (`Optional`, `Outcome`, `Steps`) as the bridge, so a program that wants
  the computation as data asks for it where it wants it. **Recommended.**

### 3.4 The laws, and what the compiler does today

- **Handler fusion.** Built: a handler whose cases answer and perform
  nothing, around code the compiler can see, is written into that code
  (C64a, C64b, `compiler/src/handlers.ts`). In the free-monad reading this
  is fold fusion: the tree is never built because the fold is applied as
  it would be made (Wu and Schrijvers, "Fusion for free", 2015).
- **The three shapes as three conventions.** Built: an operation that
  returns is a call (Koka's `fun`), one that never returns an escape
  (Koka's `final ctl`), one answered later a generator or a fiber
  (ANSWERED-LATER.md; C40, C44b).
- **Case of a known constructor** (Peyton Jones and Santos, "A
  transformation-based optimiser for Haskell", 1998). Mostly there: the
  probe's `match some(y + 1) | some(v) → v · 3 | otherwise 0` lowers to a
  let and an `if`. The `if` still tests Optional's niche (`not (v = v)`)
  on a value that can't be the niche; one comparison, and the gain is too
  small for a row.
- **`steps` fused with the match that reads it. Not built.** `match
  steps of Work(worker(3)) | …` builds a `Steps` datum per operation and
  takes it apart at once; the generated handler and the match could be
  one, case of a known constructor across a handler. crew is the only
  program that steps today and its time isn't in the steps. **Row C226,
  waits for an example.**

## 4. The cross-links

The two pairs aren't separate. The four make a square, with a known law
on every side:

```
                 picked by type, statically
     interface ─────────────────────────────── closure
  (record of ops)   monomorphisation /          (record of captures,
        │           closure conversion            one op)
        │                                           │
  evidence passing                           defunctionalisation /
  (a handler passed                           refunctionalisation
   like a dictionary)                               │
        │                                           │
     effect  ──────────────────────────────── data (a sum)
  (ops performed)   free monad / handler as fold   (cases stored)
```

- **Closures and data:** defunctionalisation turns the closures of a
  function type into a sum and one `apply`; refunctionalisation turns it
  back (Reynolds 1972; Danvy and Millikin, "Refunctionalization at
  work", 2009).
- **Interfaces and effects:** a handler whose operations all return and
  whose cases only answer *is* an implementation, chosen by where the
  call is instead of by type: dynamic scope with static types, the
  implicit parameters of Lewis, Shields, Meijer and Launchbury (2000).
  Evidence passing (Xie and Leijen 2021) compiles such handlers as
  dictionary passing, which is what C64b does. Going the other way,
  Haskell's mtl writes effects as type classes and gets their speed by
  specialisation, at the cost of handlers that are ordinary values.
- **The top row and the bottom row:** closures and interfaces are known
  by what you can ask of them (codata); data and effect operations by how
  they are made (data). Downen, Sullivan, Ariola and Peyton Jones,
  "Codata in action" (2019), show the moves between the two as
  defunctionalisation and its inverse.

Could interfaces and effects merge? An interface could be read as an
effect handled by type, or an effect as an interface found by scope. Each
reading drops what makes the other useful: coherence and zero cost on one
side; aborting, resuming later and many answers on the other. Same
conclusion: keep both, and the compiler already uses the law between them.

## 5. Recommendation

1. **The language keeps four readings of one shape, as it is today.**
   One node kind (`typedef`) with a flag; no node kind added or removed;
   SPEC unchanged. This is the same answer as for `let` and `lambda`:
   where the difference says nothing, Ters already merged (all four share
   the node, the editor's panels, the hash, and the record or datum at
   run time); where it says something (who picks, how a target runs it),
   it stays.
2. **The laws live in the compiler**, each a pass that changes no answer
   and is checked by the agreement and fuzz tests. Most are built. The one
   gap with a program in hand today is C224.
3. **L256, when it is built, is a record of closures** that captured the
   value, not a new kind of value.
4. **Say it once in the docs** (L260), so a reader of LANGUAGE.md sees
   the four as one idea with the bridges between them, instead of meeting
   effects, interfaces and records in three places.

Nothing here needs a decision from Ersagun unless he wants a merge after
all; the recommendation is to change nothing in the language.

## 6. Proposed rows

Added to BACKLOG.md's Inbox; none is built.

| id | item | pri | size |
|---|---|---|---|
| C224 | A known record of functions given to a definition: copy the definition for it, so a field read and call become a direct call (closure-args.ts's law for a record of closures; GHC's dictionary specialisation). Example: `half through(halving at float64, y)` builds the record and calls through it (§2.4) | P3 | M |
| C225 | Defunctionalisation: where every lambda of a function type is known, a function value as a sum of its lambdas' captures and a call as a match, so a shader can run a function chosen at run time and WebAssembly and C switch instead of calling indirectly (Reynolds 1972). Waits for an example (a shader picking a distance function per object) | P3 | L |
| C226 | `steps of E(c)` matched at once: the generated handler and the match made one, so no `Steps` datum is built per operation (case of a known constructor across a handler). Waits for an example whose time is in its steps | P3 | M |
| L260 | LANGUAGE.md: one short section on records, sums, effects and interfaces as one typedef with four readings, and the bridges (`optional`, `attempt`, `steps`, a record passed by hand), from this note | P3 | S |

## Credits

Every idea here has prior art; none of the four readings is new.

- **Prior art: closures and objects as one thing.** The koan "objects are
  a poor man's closures" (Norman Adams, Christian Queinnec; Anton van
  Straaten's telling); John C. Reynolds, "User-defined types and
  procedural data structures as complementary approaches to data
  abstraction" (1975); William R. Cook, "On understanding data
  abstraction, revisited" (OOPSLA 2009); OCaml's objects beside its
  closures, and its first-class modules.
- **Influence: interfaces as dictionaries.** Philip Wadler and Stephen
  Blott, "How to make ad-hoc polymorphism less ad hoc" (POPL 1989), as
  INTERFACES.md already credits; Rust's traits and `dyn Trait`.
- **Considered, rejected: implementations as implicit values.** Scala's
  implicits; Leo White, Frédéric Bour and Jeremy Yallop, "Modular
  implicits" (ML Workshop 2014). Java 8's functional interfaces for
  lambdas.
- **Prior art: existentials as objects.** Benjamin C. Pierce, *Types and
  Programming Languages* (2002), ch. 24; Konstantin Läufer, "Type classes
  with existential types" (JFP 1996).
- **Prior art: defunctionalisation and refunctionalisation.** John C.
  Reynolds, "Definitional interpreters for higher-order programming
  languages" (1972); Olivier Danvy and Lasse R. Nielsen,
  "Defunctionalization at work" (PPDP 2001); Olivier Danvy and Kevin
  Millikin, "Refunctionalization at work" (2009).
- **Influence: handlers as folds over the free model.** Gordon Plotkin
  and Matija Pretnar, "Handlers of algebraic effects" (ESOP 2009) and
  "Handling algebraic effects" (LMCS 2013); Oleg Kiselyov and Hiromi
  Ishii, "Freer monads, more extensible effects" (2015); Wouter
  Swierstra, "Data types à la carte" (2008); Daniel Hillerström and Sam
  Lindley, "Shallow effect handlers" (APLAS 2018).
- **Prior art: handler fusion and evidence passing.** Nicolas Wu and Tom
  Schrijvers, "Fusion for free" (MPC 2015); Ningning Xie and Daan Leijen,
  "Generalized evidence passing for effect handlers" (ICFP 2021); Koka's
  `fun`, `final ctl` and `ctl` (Daan Leijen).
- **Prior art: handlers as dynamically scoped implementations.** Jeffrey
  R. Lewis, Mark B. Shields, Erik Meijer and John Launchbury, "Implicit
  parameters: dynamic scoping with static types" (POPL 2000); Haskell's
  mtl for effects as type classes.
- **Prior art: data and codata.** Paul Downen, Zachary Sullivan, Zena M.
  Ariola and Simon Peyton Jones, "Codata in action" (ESOP 2019).
- **Prior art: the compiler laws.** Thomas Johnsson, "Lambda lifting"
  (1985); Wei-Ngan Chin and John Darlington, higher-order removal (1996);
  GHC's SpecConstr and dictionary specialisation; Simon Peyton Jones and
  André Santos, "A transformation-based optimiser for Haskell" (1998), for
  case of a known constructor.
