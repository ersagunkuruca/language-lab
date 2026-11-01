# language-lab: home of Ters

**Ters** is the language this repo builds. *Ters* is Turkish for "reverse" or
"inside out", because its definitions run backwards as well as forwards, and it
rhymes with *terse*. The repo keeps the name language-lab: experiments with new
programming language paradigms, each in its own top-level folder with its own
README.

- `editor/`: the browser structure editor the program is edited in, [the site itself](https://ersagunkuruca.github.io/language-lab/). It has no packages of its own and borrows `ters/`'s (`npm ci` in `ters/`, then `npm run build-editor`).
- `ters/`: Ters, the language. The program is a tree, not text; the checker, the evaluator, running backwards, the library and the examples (see `ters/README.md`, and [learn.html](https://ersagunkuruca.github.io/language-lab/learn.html) to start).
- `compiler/`: compiles the typed core of `ters/` to JavaScript, guided by its effect types (see `docs/design/targets/COMPILER.md`), to WebAssembly and native code through C, and its numeric part to WGSL for the GPU ([shaders.html](https://ersagunkuruca.github.io/language-lab/shaders.html)).
- `invertible/`: the relation solver that arithmetic runs backwards with.
- Web apps written in the language, built onto the site by `editor/build.ts` (`lab build-web`, see `docs/design/targets/WEB.md`): [the unit converter](https://ersagunkuruca.github.io/language-lab/apps/converter.html), [two dice](https://ersagunkuruca.github.io/language-lab/apps/dice.html), [Pig](https://ersagunkuruca.github.io/language-lab/apps/pig.html) (effects with handlers), [Tumble](https://ersagunkuruca.github.io/language-lab/apps/tumble.html) (a match-three puzzle), [the guitar pedal](https://ersagunkuruca.github.io/language-lab/apps/pedal.html) (live sound), [Bounce](https://ersagunkuruca.github.io/language-lab/apps/bounce.html) (one physics step over Clifford algebras, in 2D and 3D), [Constructions](https://ersagunkuruca.github.io/language-lab/apps/constructions.html) (geometry in projective geometric algebra), [Spacetime](https://ersagunkuruca.github.io/language-lab/apps/spacetime.html) (relativity and electromagnetism as rotors) and the nested to-do in [reactive.html](https://ersagunkuruca.github.io/language-lab/reactive.html).

## Goals

Each goal says whether it's built, partly built, or a rule we hold to.

- **No text syntax.** A program is a tree, edited structurally in the
  editor. There is no parser, on purpose, so there are no syntax errors and
  no arguments about formatting. *Built.*
- **Names and comments live apart from the program.** The code refers to
  everything by an id. Names, comments and notation sit in side tables, so a
  rename never breaks anything, and how code reads (operators, infix or
  prefix, nesting) is a view you choose. *Built; more views to come.*
- **Definitions run both ways.** The same definition computes forwards or
  solves backwards for its inputs, as with a relation
  ([BACKWARDS.md](docs/language/BACKWARDS.md)). *Built for arithmetic and
  search.*
- **Effects are in the types.** Randomness, input and output show in a
  function's type and are answered by handlers. *Built.*
- **Plain style, fast code.** Programs are written in plain functional style
  (lists as `cons`/`nil`, numbers as `zero`/`succ`) and compile to fast code,
  because how data is stored is a separate representation the compiler
  picks. You never select it yourself.
  [NUMBERS.md](docs/design/numbers/NUMBERS.md), "Where this stands", says
  what is built. *Partly built: today on compiled JavaScript only.*
- **One uniform system.** No special node kinds and no special cases: a
  feature that needs one is rethought instead. *A rule we hold to.*
- **Targets don't bend the language.** Ters runs in the evaluator and
  compiles to JavaScript, WebAssembly, native code through C, GPU shaders,
  web pages, phone apps and live audio. Each target's quirks stay in how it
  is hosted and never change what the language means. *Targets built; the
  rule holds.*
- **Tests in the language.** A test is a definition that checks, run by
  `lab test`. *Built.*

## Docs

[the docs index](docs/README.md) lists every document by what you'd read it for, with
how much of each is built.

## Planning

Open work from every source is in [BACKLOG.md](BACKLOG.md): what each lane
does next at the top, then each lane's items by theme. Finished items are in
[DONE.md](docs/process/DONE.md); how work is picked and run is in [WORKFLOW.md](docs/process/WORKFLOW.md).

## Credits

The language is Ersagun's experiment, but many of its ideas were had before,
and some code is adapted from other people's work (Inigo Quilez's distance
functions in the ray-marching shader, Gosper's continued-fraction arithmetic,
Solid.js's reactivity, miniKanren's search, Unison's hashing, and more).
[docs/language/CREDITS.md](docs/language/CREDITS.md) lists every influence,
prior work and adaptation we know of, feature by feature, and the rule for
crediting new ones.
