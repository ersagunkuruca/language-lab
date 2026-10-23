# Archive

Programs kept for what they show, not as programs to run. Nothing here is in
the editor's program list, and the tests that walk every example (save and
open, evaluator against compiler, shaders) skip this folder because it has no
`code.json` of its own.

- `compose`: Ersagun's first example, `a = ((d) => b(c(d, e(f, d))))(g(h))`.
  It predates the typed core: `b`, `c`, `e`, `f`, `g` and `h` are definitions
  with no body, so `lab check` reports six "no body to check" errors. It is
  still the clearest picture of one tree drawn as nested calls, lets and
  s-expressions, so `src/demo.ts` and `test/core.test.ts` use it for that.
