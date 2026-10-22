# language-lab

Experiments with new programming language paradigms. Each experiment lives in
its own top-level folder with its own README.

- `compiler/`: compiles the typed core of `projectional/` to JavaScript, guided by its effect types (see `projectional/COMPILER.md`), and its numeric part to WebAssembly and to WGSL for the GPU ([shaders.html](https://ersagunkuruca.github.io/language-lab/shaders.html)).

## Credits

The language is Ersagun's experiment, but many of its ideas were had before,
and some code is adapted from other people's work (Inigo Quilez's distance
functions in the ray-marching shader, Gosper's continued-fraction arithmetic,
Solid.js's reactivity, miniKanren's search, Unison's hashing, and more).
[projectional/CREDITS.md](projectional/CREDITS.md) lists every influence,
prior work and adaptation we know of, feature by feature, and the rule for
crediting new ones.
