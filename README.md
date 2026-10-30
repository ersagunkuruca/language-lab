# language-lab

Experiments with new programming language paradigms. Each experiment lives in
its own top-level folder with its own README.

- `compiler/`: compiles the typed core of `projectional/` to JavaScript, guided by its effect types (see `projectional/COMPILER.md`), and its numeric part to WebAssembly and to WGSL for the GPU ([shaders.html](https://ersagunkuruca.github.io/language-lab/shaders.html)).
- `apps/`: web apps written in the language and built by `projectional/editor/build.ts` (`lab build-web`, see `projectional/WEB.md`), e.g. [apps/converter.html](https://ersagunkuruca.github.io/language-lab/apps/converter.html), [apps/dice.html](https://ersagunkuruca.github.io/language-lab/apps/dice.html), [apps/pig.html](https://ersagunkuruca.github.io/language-lab/apps/pig.html) (effects with handlers) and [apps/tumble.html](https://ersagunkuruca.github.io/language-lab/apps/tumble.html) (a match-three puzzle).

## Goals

One goal runs through the language: programs written in plain functional
style (lists as `cons`/`nil`, numbers as `zero`/`succ`) that compile to fast
code, because how data is stored is a separate, chosen representation.
[projectional/NUMBERS.md](projectional/NUMBERS.md), "Where this stands",
says what of that is built and what isn't.

## Planning

Open work from every source is in [BACKLOG.md](BACKLOG.md): what each lane
does next at the top, then each lane's items by theme. Finished items are in
[DONE.md](DONE.md); how work is picked and run is in [WORKFLOW.md](WORKFLOW.md).

## Credits

The language is Ersagun's experiment, but many of its ideas were had before,
and some code is adapted from other people's work (Inigo Quilez's distance
functions in the ray-marching shader, Gosper's continued-fraction arithmetic,
Solid.js's reactivity, miniKanren's search, Unison's hashing, and more).
[projectional/CREDITS.md](projectional/CREDITS.md) lists every influence,
prior work and adaptation we know of, feature by feature, and the rule for
crediting new ones.
