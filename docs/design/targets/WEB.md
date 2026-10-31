# Web apps: a page is a value, the browser is a world

This is the design for ROADMAP item 7, written before the code. It is the
smallest model that covers real web apps and adds no node kinds: a page is
a value of an ordinary data type, its changing parts are functions run by
the `Cells` handler (LANGUAGE.md, "Cells"), events are handlers that write
cells, and the browser is one more world, like the command line's.
Two-way binding is the language's own running backwards. Mobile is the
same app, packaged.

**Status (2026-10-30): built.** Pages are `Html` values, `lab build-web`
builds them, and the demos are the converter, two dice, Pig, Tumble, the
nested to-do and the guitar pedal, restyled in one look on 2026-10-30.
The "later" items at the end are done too: keyed lists, `inverse` over
function values, static output from `lab run`, time, randomness and HTTP,
and the editor's Run showing a page live. `lab build-app` packages a page
as a phone app (RUNNING.md). Open page work is in BACKLOG.md (L59, L98,
L99).

## Short answers

- **What is a web app?** A program whose `main` returns an `Html` value.
  `main` runs once. The parts of the page that change are functions inside
  the value, each run in its own watcher, so a click re-runs exactly the
  parts that read the cell it wrote. Nothing is diffed and there is no
  virtual DOM. This is Solid.js's model (Ryan Carniato,
  https://www.solidjs.com), which reactive.html used first with a type of
  its own; this design turned that seed into the real thing, and
  reactive.html now draws `Html` too.
- **What is `Html`?** Three ordinary types in std, a rose tree:

  ```
  type Html =
    | element(tag: Text, attributes: List Attribute, children: List Html)
    | text(shows: () -[Cells, Diverge]-> Text)
    | part(view: () -[Cells, Diverge]-> Html)   -- a piece whose shape changes
  type Attribute =
    | property(name: Text, value: () -[Cells, Diverge]-> Text)
    | on(event: Text, then: (Event) -[Cells, Update, Console, Files, Abort]-> Unit)
  type Event = event(value: Text, key: Text)
  ```

  That is all of it. `element("button", …)`, `element("svg", …)` and
  `element("my-widget", …)` are the same constructor, so every element and
  attribute the browser has is reachable, and nothing in the language
  knows HTML. Buttons, rows, columns, fields and lists are ordinary
  prelude functions that build `element`s (below), not variants: the
  uniformity rule says a button is a function, not a node kind.
- **What do events do?** An `on` handler gets the `Event` (the target's
  value, or `"true"`/`"false"` for a checkbox, and the key) and may read
  and write cells, print to the browser console, and save files (which
  can fail, so `Abort`: the page logs it and carries on). Since time,
  randomness and HTTP it may also read the clock, draw random numbers and
  fetch. Its row is `PAGE_HANDLER` in std.ts, and a view's (a text, a
  part, an attribute's value: `Cells, Diverge, Time, Network, Log`) is
  `PAGE_VIEW`, each named once and checked against what the runtime
  handles. They are closed on purpose: the runtime runs views and handlers
  after `main` has returned, so no handler written in the program is
  around them, and an effect of the program's own is handled inside the
  view or handler. Both may `log`: a log line is for whoever debugs the
  page, and goes to the browser console (a view's once per run). A
  handler can't search unhandled (the world isn't
  touched under an open `Choice`), and a view can't write or print. Those are the guarantees Solid only warns about at run time.
  **They needed one checker fix first** (PR #102), found while writing
  this: a function type inside a data type had no effect row (infer.ts
  gave it a fresh one each time), so a printing function put in a field
  and called back out under `Choice` passed the checker. Now a field's
  function type lists its effects, and one that lists none is pure.
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
  writes back what `inverse(view, typed)` finds. "Setters are
  projections run backwards" (REVIEW.md §5.3) becomes a working page: a
  temperature converter has one cell and two forward functions; typing in
  either field runs that function backwards. **Input with no preimage is
  invalid input**: `show` backwards accepts only spellings `show` itself
  produces, so the field just keeps what was typed, marked invalid, and
  the cell doesn't change. Validation is free.
- **Static sites?** The same value, printed. Rendering an `Html` with
  every function called once is a fold to text, and `lab run` on a page
  program prints that: a whole HTML document, every text, part and
  attribute drawn once, handlers left out (server-side rendering without
  a server; `htmlText` in html.ts). Text inside `<style>` and `<script>`
  goes in as it is, since entities aren't read there.
- **Mobile?** Packaging, not language: the HTML file plus a web manifest is
  an installable PWA, and Capacitor (Ionic) wraps the same file as an iOS
  or Android app. `lab build-app <program> -o folder` (cli/app.ts) writes
  both: `folder/www` holds the page, a web app manifest, a service worker
  that keeps every file so it opens offline (its cache named by what it
  keeps, so a new build replaces it), and two icons in the program's
  colour; `folder` itself is a Capacitor project whose config points at
  www/, so `npx cap add android` and `npx cap run android` make the app
  (its README.md has the steps). Chromium finds the dice app installable
  and reloads it offline. Device features (camera, location, notifications) become
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
On the page a part is a `<lab-part>` element styled `display: contents`,
so it holds its piece without taking part in the layout.

A function that reads no cell runs once and is never watched, so a static
page costs one call per text. The types tell the two apart only at run
time (a function's row says it *may* read cells), which is the same as
Solid, and costs nothing because an unread watcher is never woken.

**Lists.** `part(() => ul(map(read(todos), row)))` redraws every row when
the list changes: correct, and fine for tens of items. `for each(todos,
row, ul)` keeps rows the way Solid's `<For>` does (prior art). It is an
html-module function, so `Html` gained no variant:

```
for each(items, row, inside) = let rows = each(items, row) in part(() => inside(read(rows)))
```

`each` (cells.ts) is Solid's `mapArray`: a formula over the list that
keeps what `row` made of an item still there (by equality) and calls `row`
only for new items, each in an owner of its own, so a cell the row makes
lives as long as its item. The part still runs again when the list
changes, but the rows it gets back are the same values, and the mount
(html.ts) draws a value it has drawn before as the same nodes, moved, with
their watchers. So a row keeps its count, its focus and what's typed in
it. Two equal items get a row each.

### The widgets are functions

In the html module (`library/html.json`, from `src/lang/html-source.ts`),
written in the language (LANGUAGE.md "Pages: web apps" lists it):

```
div(children: List Html) : Html = element("div", nil, children)     -- and p, span, h1, section, …
words(t: Text) : Html           = text(() => t)
button(label: Text, then)       = element("button", [on("click", then)], [words(label)])
with(attributes, html) : Html   = html with these attributes after its own
styled(style: Text, html)       = with([attribute("style", style)], html)    -- classed, named alike
rule(selector, declarations)    = selector ++ " { " ++ declarations ++ " }"
style sheet(rules: List Text)   = element("style", nil, [words(joined(rules, "\n"))])
```

An element takes only its children, since most have no attributes; the
attributes wrap it, so `styled("color: #777", p([words("Credits…")]))`
reads as what it is. A style sheet is a list of rules, shown rule by rule
and kept in a definition of its own, rather than one long text. The
declarations of a rule stay text: a node per property would make the
graph busier, not calmer. Moving `examples/dice` and `examples/converter`
onto it took the dice page from 475 nodes to 382, and the converter's
`main` from a style literal of over 2,000 characters and nested `element` calls to
a page you can read (its style sheet is the definition `page style`).

The programs on reactive.html moved onto Html in their own PR, and the
DSL-local `UI` type in `cells-programs.ts` and `src/lang/ui.ts` are gone:
one way to make a page.

### Two-way binding, worked out

```
celsius = cell(20)
as fahrenheit(c: Float64) : Text = show(c × 9 / 5 + 32)
as celsius(c: Float64) : Text    = show(c)

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
`shows`, which now prints what was typed. The field doesn't disturb text
the user is in the middle of typing: the mount sets an input's `value`
only when it differs from what the input already shows, which is Svelte's
rule for `bind:value` (Rich Harris).

A `solve` names a definition, not a function value (LANGUAGE.md, "solve"),
so the prelude has one definition that calls a function it's given,
`applied(f, x) = f(x)`, and `inverse(f, y) = solve applied(f = f, out = y)
for x` (BACKLOG.md L14). With it the binding is written once: the
converter's `field(caption, view, name, quantity)` reads back with
`inverse(view, typed)`, and its ten `from °C`-style definitions are gone.
`inverse` has type `((a) -[e]-> b, b) -[Choice, Diverge, e]-> a`: what f
does comes out where inverse is called, so a function that prints, handed
to it, is refused there (it would print while a Choice is open), and one
that writes a cell is refused when it runs (relate.ts: cells only run
forward). Diverge because the checker can't see which f it will be; the
modes see it at the call (MODES.md).

Records work the same way: a field showing `name(read(person))` edits
with `set` (records.ts), which is the projection run backwards with the
rest of the person given. That is a lens (Foster, Greenwald, Moore, Pierce
and Schmitt, "Combinators for bidirectional tree transformations", TOPLAS
2007) that nobody writes.

## The runtime

- **Mount** (`src/lang/html.ts`, generalised from the old `ui.ts`): walks the `Html`, creates DOM
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
  dependency, as for `lab compile`), and writes one HTML file. There is
  no stylesheet of its own: a program's styles are a `style` element in
  its page, like any other element.
- **Preview** (`src/lang/page.ts`): `showPage` runs a page's `main` with
  the evaluator against the browser world and mounts it into any
  document, so the editor can show a page live and redraw it after each
  edit without compiling. `stop()` ends its clock. `pageMain` finds the
  `main` that makes a program a page. The evaluator is slow for an
  animation (Bounce drew 7 frames a second), so the editor shows this at
  once and compiles the same program off its thread
  (`editor/runWorker.ts`, as Save page does); when that's ready, a fresh
  copy of page-runtime's `mountPage` mounts the compiled page in its
  place, as fast as in a tab (I97). A page with sound stays evaluated.
- **Save page** (`src/lang/page.ts` pageFile): the same one-file page
  made in a browser, with no bundler. `cli/web.ts` pageRuntime prebuilds
  `src/lang/page-runtime.ts` (runtime, mount, browser world, startPage) as
  a script that sets `$lab`; the program is compiled with
  `link: "global"`, a plain script taking its helpers from `$lab`. About
  100 KB more than `lab build-web`'s, which keeps only what it uses.
- **What `main` may do**: return `Html`; take no arguments; use `Cells`,
  `Update`, `Console`, `Files` (run.ts `pageProblem` says why not).

## The order of the work, one PR each

1. This document.
1. (bug, before the rest) Effect rows on function types inside data types.
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
lists (done: `for each`); `solve` over function values (done: the
prelude's `inverse`); static output (done: `lab run`); time, randomness
and HTTP world effects (done); the editor showing a page program live,
like its shader picture (done: Run shows the page).

## Credits

- Fine-grained reactivity with no virtual DOM: Solid.js (Ryan Carniato,
  MIT), after S.js (Adam Haile). The update algorithm in cells.ts is
  Milo's Reactively (credited there).
- The rejected alternative, and the style an app may still follow: the Elm
  architecture (Evan Czaplicki).
- Elements as `(tag, attributes, children)`: HyperScript's `h()` (Dominic
  Tarr), as every virtual-DOM library since uses it.
- The html module, each tag a function: Elm's Html module (Evan
  Czaplicki); markup as plain data: Hiccup (James Reeves). Prior art.
- Two-way binding: Svelte's `bind:value` (Rich Harris) for when an
  input's value is set; lenses (Foster et al., 2007) for "a setter is a projection
  run backwards".
- Mobile packaging: Capacitor (Ionic), and PWAs (web app manifests, W3C).
