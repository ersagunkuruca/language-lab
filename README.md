# language-lab

Experiments with new programming language paradigms. Each experiment lives in
its own top-level folder with its own README.

- `projectional/`: the language. The program is a tree edited in a browser structure editor, [the site itself](https://ersagunkuruca.github.io/language-lab/); the checker, the evaluator, running backwards, the library and the examples (see `projectional/README.md`, and [learn.html](https://ersagunkuruca.github.io/language-lab/learn.html) to start).
- `compiler/`: compiles the typed core of `projectional/` to JavaScript, guided by its effect types (see `docs/design/targets/COMPILER.md`), to WebAssembly and native code through C, and its numeric part to WGSL for the GPU ([shaders.html](https://ersagunkuruca.github.io/language-lab/shaders.html)).
- `invertible/`: the relation solver that arithmetic runs backwards with.
- Web apps written in the language, built onto the site by `projectional/editor/build.ts` (`lab build-web`, see `docs/design/targets/WEB.md`): [the unit converter](https://ersagunkuruca.github.io/language-lab/apps/converter.html), [two dice](https://ersagunkuruca.github.io/language-lab/apps/dice.html), [Pig](https://ersagunkuruca.github.io/language-lab/apps/pig.html) (effects with handlers), [Tumble](https://ersagunkuruca.github.io/language-lab/apps/tumble.html) (a match-three puzzle), [the guitar pedal](https://ersagunkuruca.github.io/language-lab/apps/pedal.html) (live sound), [Bounce](https://ersagunkuruca.github.io/language-lab/apps/bounce.html) (one physics step over Clifford algebras, in 2D and 3D), [Constructions](https://ersagunkuruca.github.io/language-lab/apps/constructions.html) (geometry in projective geometric algebra), [Spacetime](https://ersagunkuruca.github.io/language-lab/apps/spacetime.html) (relativity and electromagnetism as rotors) and the nested to-do in [reactive.html](https://ersagunkuruca.github.io/language-lab/reactive.html).

## Goals

One goal runs through the language: programs written in plain functional
style (lists as `cons`/`nil`, numbers as `zero`/`succ`) that compile to fast
code, because how data is stored is a separate, chosen representation.
[docs/design/numbers/NUMBERS.md](docs/design/numbers/NUMBERS.md), "Where this stands",
says what of that is built and what isn't.

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
