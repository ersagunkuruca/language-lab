# language-lab: home of Ters

**Ters** is a programming language you edit as a tree instead of typing as
text, and whose definitions run backwards as well as forwards. *Ters* is
Turkish for "reverse" or "inside out", and it rhymes with *terse*. It is
Ersagun's experiment, and the only one in this repo for now; the repo keeps
its older name, language-lab.

To try it, open [the editor](https://ersagunkuruca.github.io/language-lab/)
and start with [the learn page](https://ersagunkuruca.github.io/language-lab/learn.html).

## What is here

- `editor/`: the editor, a web page where you build a program by picking
  pieces rather than typing text. It is [the site itself](https://ersagunkuruca.github.io/language-lab/).
- `ters/`: the language: the type checker, the evaluator (which runs a
  program directly), the code that runs definitions backwards, the standard
  library and the examples. See `ters/README.md`.
- `compiler/`: turns a checked program into JavaScript, WebAssembly, or C
  for native programs, and its arithmetic into GPU shaders (WGSL, the web's
  shader language; [shaders.html](https://ersagunkuruca.github.io/language-lab/shaders.html)).
- `invertible/`: the solver that finds the inputs of an arithmetic
  formula from its result, which is how arithmetic runs backwards.

Web apps written in Ters, built onto the site:
[the unit converter](https://ersagunkuruca.github.io/language-lab/apps/converter.html),
[two dice](https://ersagunkuruca.github.io/language-lab/apps/dice.html),
[Pig](https://ersagunkuruca.github.io/language-lab/apps/pig.html) (a dice game),
[Tumble](https://ersagunkuruca.github.io/language-lab/apps/tumble.html) (a match-three puzzle),
[the guitar pedal](https://ersagunkuruca.github.io/language-lab/apps/pedal.html) (live sound),
[Bounce](https://ersagunkuruca.github.io/language-lab/apps/bounce.html) (balls bouncing, in 2D and 3D),
[Constructions](https://ersagunkuruca.github.io/language-lab/apps/constructions.html) (geometry of points and lines),
[Compass](https://ersagunkuruca.github.io/language-lab/apps/compass.html) (ruler and compass, with circles),
[Spacetime](https://ersagunkuruca.github.io/language-lab/apps/spacetime.html) (special relativity you can drag)
and the nested to-do list in [reactive.html](https://ersagunkuruca.github.io/language-lab/reactive.html).
Bounce, Constructions, Compass and Spacetime do their geometry in Clifford
algebras, one algebra for rotations, reflections and motions. The same
pages build as phone apps: a web app (`ters build-app`), or a native
Android or iPhone app drawn with the phone's own views, with no web view
(`ters build-native-app`, [NATIVE-APPS.md](docs/design/targets/NATIVE-APPS.md)).

## The `ters` command

`ters` is Ters's command line, `ters/cli/ters.ts`. After `npm ci` in `ters/`,
run it as `npm run ters -- <command>` there (or `node cli/ters.ts <command>`).
Without a clone, `ters` is one file the site serves (Node 22.18 is all it
needs): `curl -LO https://ersagunkuruca.github.io/language-lab/ters.mjs`,
then `node ters.mjs <command>`. `node ters.mjs git-setup` in another
repository makes its `git diff` and merges read program files
([DIFF.md](docs/design/tools/DIFF.md)).
`ters` with no command lists every command. The main ones:

- `ters run` runs a saved program's `main`, compiled, or with the
  evaluator where it doesn't compile; `ters check` lists its errors and each
  definition's type; `ters test` runs its tests.
- `ters compile` turns it into a JavaScript module, `ters native` into a
  native program through C, and `ters wasi` into a WebAssembly command.
  `ters build-web` builds a page as one HTML file, and `ters build-app` and
  `ters build-native-app` build it as a phone app.
- `ters diff` says what changed between two versions of a program,
  definition by definition and node by node, and `ters git-setup` makes
  this clone's `git diff` and merges use it on program files
  ([DIFF.md](docs/design/tools/DIFF.md)).
- `ters mcp` is an MCP server, so a language model can view, edit, run and
  test a program ([MCP.md](docs/design/tools/MCP.md)).
- `ters publish`, `ters fetch` and `ters upgrade` share definitions as
  versioned modules ([SHARING.md](docs/design/sharing/SHARING.md)).

[RUNNING.md](docs/learn/RUNNING.md) says how each way of running a program
works.

## Building

The editor has no packages of its own and uses `ters/`'s: run `npm ci` in
`ters/`, then `npm run build-editor`. `ters build-web <program>` builds
one app as a page, and `editor/build.ts` builds every app onto the site
(`docs/design/targets/WEB.md`). Open the built site over http (for example
`python3 -m http.server` at the repo's root, where it is built): opened from disk, the editor can't read
what the build compiled, so Run compiles on the page, a few times slower.

## Goals

Each goal says whether it's built, partly built, or a rule we hold to.

- **No text syntax.** A program is a tree, edited structurally in the
  editor. There is no parser, on purpose, so there are no syntax errors and
  no arguments about formatting. *Built.*
- **Names and comments live apart from the program.** The code refers to
  everything by an id. Names, comments and notation are kept in separate
  files beside the program, so a rename never breaks anything, and how code reads (operators, infix or
  prefix, nesting) is a view you choose. A program is saved as JSON, one
  node per line, so a change reads well in git, and `ters diff` shows it
  by definition ([SAVED-FORMAT.md](docs/design/tools/SAVED-FORMAT.md)).
  *Built; more views to come.*
- **Definitions run both ways.** The same definition computes forwards or
  solves backwards for its inputs, as with a relation
  ([BACKWARDS.md](docs/language/BACKWARDS.md)). *Built: arithmetic is
  solved directly, and anything else by searching for inputs that fit.*
- **Effects are in the types.** Randomness, input and output show in a
  function's type and are answered by handlers. *Built.*
- **Plain style, fast code.** Programs are written in plain functional style
  (lists as `cons`/`nil`, numbers as `zero`/`succ`) and compile to fast code.
  How a value is stored in memory (its representation: a list as an array,
  a `succ`/`zero` number as a machine integer) is chosen by the compiler,
  never by the program. *Partly built, on every target: numbers as machine
  integers, maps as balanced trees or hash tables, sets as balanced trees, and lists as
  arrays where the program reads them by position, chosen from how the
  program uses them. The rest is in
  [NUMBERS.md](docs/design/numbers/NUMBERS.md), "Where this stands".*
- **One uniform system.** A program is made of a few kinds of nodes
  (calls, functions, references, data types). No feature gets a kind of
  its own or a special case: a feature that needs one is rethought instead. *A rule we hold to.*
- **Targets don't bend the language.** Ters runs in the evaluator and
  compiles to JavaScript, WebAssembly, native code through C, GPU shaders,
  web pages, phone apps and live audio. Each target's quirks stay in how it
  is hosted and never change what the language means. *Targets built; the
  rule holds.*
- **Tests in the language.** A test is a definition that checks something,
  run by `ters test`. *Built.*

## Docs

[the docs index](docs/README.md) lists every document by what you'd read it for, with
how much of each is built.

## Planning

Open work from every source is in [BACKLOG.md](BACKLOG.md): what is being
worked on next at the top, then the open items by theme. Finished items are in
[DONE.md](docs/process/DONE.md); how work is picked and run is in [WORKFLOW.md](docs/process/WORKFLOW.md).

## Credits

The language is Ersagun's experiment, but many of its ideas were had before,
and some code is adapted from other people's work: Inigo Quilez's distance
functions in the ray-marching shader, Gosper's continued-fraction arithmetic
(for exact real numbers), Solid.js's reactivity (pages that update
themselves), miniKanren's search (running definitions backwards), Unison's
hashing (naming each definition by a hash of its content), and more.
[docs/language/CREDITS.md](docs/language/CREDITS.md) lists every influence,
prior work and adaptation we know of, feature by feature, and the rule for
crediting new ones.
