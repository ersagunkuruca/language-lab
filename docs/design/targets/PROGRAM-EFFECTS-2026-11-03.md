# A program's own effects across function values on the core IR (C137 design, 2026-11-03)

After C137c21, two of the examples that don't lower to the core IR fail
on a program's own effect:

- **pig.** `written into : (Cell (List Text), () -[Say, …]-> a) -[…]-> a`
  answers Say by adding the line to a cell. The core IR's message is
  "written into takes or gives a function with effects (Say, …)". The code
  it handles is a function value given as an input, and its case
  performs something itself (it writes the cell).
- **tumble.** `at once` runs `move`, which performs Animate down a
  recursive `cascade`. Animate is answered later, at most once
  (ANSWERED-LATER.md). `at once`'s case answers each `animate` at once
  and puts the step in front of what the rest gives, so the steps come out
  as a list. The message is "move has effects (Animate)". The case uses
  the answer of the rest, so it doesn't resume in tail position.

Today the core IR handles a program's own effect in one way only, by
fusion (handlers.ts, C64b). A handler whose cases answer in place and
perform nothing, around code it can see, is written into that code, and
the handler disappears. Pig's `quietly` goes this way. `written into`
doesn't, because its case writes a cell. `at once` doesn't either,
because its case uses the rest's answer. So two shapes of handler are
missing: a case that resumes in tail position but has effects of its
own, and a case that uses the rest.

## Options

**(a) Selective, by the handler's shape.**
- *Evidence passing* when every case resumes in tail position (Xie and
  Leijen, ICFP 2021; what Koka and Effekt compile to). A function whose
  row holds the effect gets one more input, the handler's cases as a
  closure, and a perform calls it. That closure may write cells, print,
  or perform anything its row allows, so pig lowers. A function value of
  type `() -[Say, …]-> a` carries the same input in its FType, beside
  `several` (SEVERAL-ANSWER-FUNCTIONS-2026-11-03.md).
- *Continuation passing* when a case uses the rest. This is the same
  machinery as several answers: the performer is put in CPS, and the case
  gets the rest as a closure. Animate is one-shot by its declaration, so
  the rest is called at most once, and nothing needs copying. tumble
  lowers.

**(b) Extend fusion.** Write effectful cases into the code they handle
too, copying each definition reached. This works for pig, where the code
is a lambda written in place. It doesn't work for tumble: a case that
uses the rest of a recursive performer can't be written in without the
rest as a value, which is (a)'s continuation anyway.

**(c) Native stacks.** JavaScript generators (compile.ts's `$handleG`),
WebAssembly stack switching, or ucontext in C. This is direct, but it
isn't uniform: WebAssembly's stack switching isn't in every engine yet,
ucontext isn't portable C, and the core IR would print three different
mechanisms.

**(d) Refuse, and keep compile.ts for these two.** Then compile.ts can't
be retired, which is C137's whole point.

## Recommendation: (a)

Each half reuses something the core IR already has: closures carried
with a function type (FType), and the continuation-passing style it uses
for several answers. That gives one mechanism on all three targets. It
also keeps fusion as the fast path for the handlers it covers. Evidence
passing is chosen only where fusion fails, and CPS only where a case
uses the rest. The handler's shape is read off its arms (does each case
call its rest in tail position?), so nothing is written in the program.

Steps:

1. **Classify** each handler fusion leaves: tail-resumptive or not. Do it
   in handlers.ts beside fusion, with a test over the examples.
2. **Evidence:** scalar.ts lowers a tail-resumptive handler as a closure
   of its cases. Functions and function types whose row holds the effect
   take it as an input, and a perform calls it. Test: pig on the core
   IR's JavaScript, WebAssembly and C against the evaluator.
3. **CPS for a case that uses the rest:** the performer and what it calls
   get a continuation, as `several_` does for several answers. The case is
   given the rest as a closure and called at the perform. Test: tumble's
   `at once` on all three targets.
4. **compile.ts's last examples:** once conjugate and pedal (the
   several-answers design) and pig and tumble lower, core-js.test.ts's
   refused list is empty, and C137(d) can start retiring compile.ts.

No decision is needed from Ersagun. This is how the compiler lowers what
the language already means.

Prior art: Xie and Leijen's generalized evidence passing (ICFP 2021) and
Koka's compiler; Effekt's lexical effect handlers (Brachthäuser et al.)
and its selective CPS; Hillerström and Lindley's CPS translation of
effect handlers; the existing fusion's credits (handlers.ts).
