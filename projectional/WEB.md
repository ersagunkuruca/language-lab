# Web apps: a page is a value, the browser is a world

This is the design for ROADMAP item 7, written before the code. It is the
smallest model that covers real web apps and adds no node kinds: a page is
a value of an ordinary data type, its changing parts are functions run by
the `Cells` handler (LANGUAGE.md, "Cells"), events are handlers that write
cells, and the browser is one more world, like the command line's.
Two-way binding is the language's own running backwards. Mobile is the
same app, packaged.

## Short answers

- **What is a web app?** A program whose `main` returns an `Html` value.
  `main` runs once. The parts of the page that change are functions inside
  the value, each run in its own watcher, so a click re-runs exactly the
  parts that read the cell it wrote. Nothing is diffed and there is no
  virtual DOM. This is Solid.js's model (Ryan Carniato,
  https://www.solidjs.com), which `src/lang/ui.ts` and reactive.html
  already use; this design turns that seed into the real thing.
- **What is `Html`?** Three ordinary types in std, a rose tree:

  ```
  type Html =
    | element(tag: Text, attributes: List Attribute, children: List Html)
    | text(shows: () -[Cells]-> Text)
    | part(view: () -[Cells]-> Html)            -- a piece whose shape changes
  type Attribute =
    | property(name: Text, value: () -[Cells]-> Text)
    | on(event: Text, then: (Event) -[Cells, Update]-> Unit)
  type Event = event(value: Text, key: Text, checked: Bool)
  ```

  That is all of it. `element("button", …)`, `element("svg", …)` and
  `element("my-widget", …)` are the same constructor, so every element and
  attribute the browser has is reachable, and nothing in the language
  knows HTML. Buttons, rows, columns, fields and lists are ordinary
  prelude functions that build `element`s (below), not variants: the
  uniformity rule says a button is a function, not a node kind.
- **What do events do?** An `on` handler gets the `Event` (the target's
  value, the key, whether it's checked) and may read and write cells. Its
  row `[Cells, Update]` is the whole story: it can't print, can't search
  (`Update` is world, so a write under `Choice` is already refused), and a
  view (`() -[Cells]-> Text`) can't write. Those are the guarantees Solid
  only warns about at run time.
- **Where is the state?** In cells, made by `main` before it returns the
  page. There is no `update(model, msg)` function and no message type.
  The Elm architecture (Evan Czaplicki, https://guide.elm-lang.org/architecture/)
  is the other honest model; it needs a diff because `view` rebuilds the
  whole tree, and the language already has fine-grained cells, so we take
  Solid's side. An app that wants one model and pure updates writes one
  cell holding a record and handlers that `write(model, step(read(model),
  …))`: Elm's shape, as a style, with no runtime support needed.
- **What is the browser?** A world, the way Node is for `lab run`
  (`src/lang/world.ts`). Its handler implements the same world operations
  with the browser's means: `print` appends to the browser console,
  `read file`/`write file` read and write `localStorage` keys (so a todo
  list that saves itself uses the same `write file` as a command-line
  program), and `read input`/`read line` abort ("a page has no standard
  input"). No new effects in this step; time, randomness and HTTP come
  later as world effects for every target at once (ROADMAP item 3's open
  list).
- **What comes out?** `lab build-web <program> -o app.html`: one HTML file
  with the compiled program, its runtime and the mount in one `<script>`.
  No server, no build step for the reader, opens from `file://`.
- **And two-way binding?** A field shows `view(read(c))` and, when edited,
  writes back what `solve view(result = typed) for x` finds. "Setters are
  projections run backwards" (REVIEW.md §5.3) becomes a working page: a
  temperature converter has one cell and two forward functions; typing in
  either field runs that function backwards. **Input with no preimage is
  invalid input**: `show` backwards accepts only spellings `show` itself
  produces, so the field just keeps what was typed, marked invalid, and
  the cell doesn't change. Validation is free.
- **Static sites?** The same value, printed. Rendering an `Html` with
  every function called once is a fold to text; `lab run` on a page
  program will print that (server-side rendering without a server). It is
  listed here so the type doesn't rule it out, and comes after the app.
- **Mobile?** Packaging, not language: the HTML file plus a web manifest is
  an installable PWA, and Capacitor (Ionic) wraps the same file as an iOS
  or Android app. Device features (camera, location, notifications) become
  world operations in that world's handler. Nothing mobile-specific enters
  the language (REVIEW.md §7.4).

## The value, in more detail

### Why a function per changing part

The first run builds every element once. A `text` and a `property` whose
function read cells get a watcher (cells.ts `watch`); when one of those
cells changes, the watcher runs the function again and sets one text node
or one attribute. A `part` is a watcher that owns everything it drew: its
next run disposes of those watchers (Solid's owner tree, already in
cells.ts) and draws again. `part` is Solid's `<Show>` and `<For>` at once.

A function that reads no cell runs once and is never watched, so a static
page costs one call per text. The types tell the two apart only at run
time (a function's row says it *may* read cells), which is the same as
Solid, and costs nothing because an unread watcher is never woken.

**Lists.** `part(() => column(map(read(todos), row of)))` redraws every row
when the list changes. That is correct and fine for tens of items; it is
the one place Solid does better (`<For>` keeps rows by identity). A keyed
`for each(items: Cell (List a), row: (a) -[Cells]-> Html)` that reuses rows
whose item is still there is the follow-up, and it needs `Html` only to
gain no variant: it is a prelude function over a `part` per row once
formulas can be made per item. It is noted, not built, in this step.

### The widgets are functions

In the prelude, written in the language:

```
button(label: Text, click: () -[Cells, Update]-> Unit) : Html
  = element("button", [on("click", e => click())], [text(() => label)])
row(items: List Html) : Html      = element("div", [class("row")], items)
column(items: List Html) : Html   = element("div", [class("column")], items)
class(name: Text) : Attribute     = property("class", () => name)
label(t: Text) : Html             = text(() => t)
```

The four UI programs on reactive.html move onto this in their own PR, and
the DSL-local `UI` type in `cells-programs.ts` goes away: one way to make a
page.

### Two-way binding, worked out

```
celsius = cell(20)
as fahrenheit(c: Number) : Text = show(c × 9 / 5 + 32)
as celsius(c: Number) : Text    = show(c)

field(shows: () -[Cells]-> Text, edit: (Text) -[Cells, Update]-> Bool) : Html
  -- an <input>: its value property shows `shows`; on "input" it calls
  -- `edit` with the typed text, and marks itself invalid when edit says no

field(() => as fahrenheit(read(celsius)),
      t => match optional(() => solve as fahrenheit(result = t) for c → c)
             some(c) → write(celsius, c); true
             none    → false)
```

`as fahrenheit` backwards goes through `show` backwards (a parser) and the
arithmetic (the equation solver), so "68" gives 20 and "68.0" or "hot"
give nothing. Typing in the Fahrenheit field writes `celsius`, which
re-runs the Celsius field's `shows`, and the Fahrenheit field's own
`shows`, which now prints what was typed. The field doesn't overwrite text
the user is in the middle of typing: the mount skips setting `value` on
the focused input when it equals what `edit` just accepted (this is the
same rule every two-way binding library has; Svelte's `bind:value`, by
Rich Harris, documents it).

A `solve` names a definition, not a function value (LANGUAGE.md, "solve"),
so the binding is written at each field rather than once as a library
`bind(cell, view)`. Letting `solve` take a function parameter (relate.ts
can already run a known function value backwards) would make `bind` one
prelude function; that is a checker change for later, recorded in
ROADMAP.md.

Records work the same way: a field showing `name(read(person))` edits
with `set` (records.ts), which is the projection run backwards with the
rest of the person given. That is a lens (Foster, Greenwald, Moore, Pierce
and Schmitt, "Combinators for bidirectional tree transformations", TOPLAS
2007) that nobody writes.

## The runtime

- **Mount** (`src/lang/ui.ts`, generalised): walks the `Html`, creates DOM
  nodes, puts each function in a watcher, and adds listeners that run a
  handler inside `cells.batch`, so several writes update the page once.
  It calls functions through one adapter so the same mount runs the
  evaluator's values (functions are streams) and compiled ones (plain
  functions); the evaluator-vs-compiled tests draw both into a fake
  document and compare the HTML after each event.
- **Browser world** (`src/lang/browser.ts`): the `World` for a page. Files
  are `localStorage` under a prefix named after the program, so two apps
  on one origin don't share files by accident.
- **`lab build-web`** (cli/lab.ts): compiles the program, bundles it with
  the runtime, the mount and the browser world by esbuild (already a dev
  dependency, as for `lab compile`), and writes one HTML file with a
  small default stylesheet for the prelude's classes. A program's own
  styles are a `style` element in its page, like any other element.
- **What `main` may do**: return `Html`; take no arguments; use `Cells`,
  `Update` (only inside handlers, by the types), `Console`, `Files`.
  `mainProblem` gets a web variant that says so.

## The order of the work, one PR each

1. This document.
2. `Html`, `Attribute`, `Event` in std; mount over them for both calling
   conventions; the browser world; `lab build-web`; differential tests
   (evaluator and compiled draw the same page and react the same to the
   same events in a fake document).
3. An original app in the language, built by `editor/build.ts` to
   `apps/<name>.html`: a unit converter whose fields bind by running
   backwards, with a short todo list saved to `localStorage` if it fits
   without bundling. Screenshot in the thread.
4. Tests and docs: ROADMAP.md ticked, LANGUAGE.md "Web apps", the widget
   functions in the prelude.

Later, each on its own: reactive.html's programs moved onto `Html`; keyed
lists; `solve` over function values (one generic `bind`); static output
from `lab run`; time, randomness and HTTP world effects; the editor
showing a page program live, like its shader picture.

## Credits

- Fine-grained reactivity with no virtual DOM: Solid.js (Ryan Carniato,
  MIT), after S.js (Adam Haile). The update algorithm in cells.ts is
  Milo's Reactively (credited there).
- The rejected alternative, and the style an app may still follow: the Elm
  architecture (Evan Czaplicki).
- Elements as `(tag, attributes, children)`: HyperScript's `h()` (Dominic
  Tarr), as every virtual-DOM library since uses it.
- Two-way binding: Svelte's `bind:value` (Rich Harris) for the focused-
  input rule; lenses (Foster et al., 2007) for "a setter is a projection
  run backwards".
- Mobile packaging: Capacitor (Ionic), and PWAs (web app manifests, W3C).
