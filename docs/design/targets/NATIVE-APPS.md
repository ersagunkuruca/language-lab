# Native apps per platform

Design note for BACKLOG.md C199 (Ersagun 2026-11-09: "Mobile is a goal.
Stretch goal is native compilation on each platform instead of webview
stuff."). Written 2026-11-10 by Language lane B. The last section is the
plan, as rows C199a to C199e.

**Status.** Route A chosen (Ersagun, 2026-11-10). C199a and C199b are done:
cells in C and WebAssembly, and a page's Html mounted from C on a view
host, checked against html.ts on a headless host. Today a phone runs a Ters page in a webview:
`ters build-app` makes an installable web app that is also a Capacitor
project (WEB.md "Mobile", C198), and the hand-run "Android app" workflow
(#2146) builds its debug APK.

## What a page is today

A page is a program whose main gives an `Html` value built from cells
(ters/src/lang/cells.ts, `Cells`) and event handlers. In JavaScript,
core-page.ts `startCorePage` runs the program and mounts the `Html` through
html.ts `mountHtml`, which needs only a small host:

- `Doc`: `createElement`, `createElementNS`, `createTextNode`;
- `El`: `append`, `replaceChildren`, `addEventListener`, `setAttribute`,
  `removeAttribute`, `value`, `checked`.

When a cell changes, the parts of the page that read it are rebuilt and
remounted through the same host. Style is CSS: dice's page has 55 spans,
12 divs and 3 buttons, laid out with flex and gap, coloured through CSS
variables, with `prefers-color-scheme`, transitions, `position` and
`border-radius`.

So a native app needs three things a webview gives for free: the program
running outside JavaScript, a host for `Doc` and `El` made of native views,
and layout and style without a browser.

## What the targets already give

- **C** (NATIVE.md, `ters native`) runs whole programs: records, lists as
  two-ended arrays, closures, handlers, fibers, budgets, counted cells with
  reuse in place, and since L101 and C201 maps and togethers on a thread
  pool. It has no `Cells` and no `Html` yet. Android's NDK and iOS's Xcode
  both build C as it is, so one C file serves both platforms.
- **WebAssembly** (WASM.md) runs the same programs. On a phone it would
  need a runtime (wasm3, WAMR) inside the app. That is one more layer than C
  for no gain, since both phones build C anyway.
- **JavaScript** needs a JS engine. Hermes or JavaScriptCore with native
  views is React Native's route. It works, but it is the webview's engine
  without the webview, and the program stays interpreted or JIT-less on
  iOS.

## Routes

**A. C program, thin native shell, a view host in C.** The program goes
through the C target. A C "view host" interface mirrors `Doc` and `El`
(create a view of a kind, set an attribute, append, replace children,
listen for an event), and each platform implements it once in its own
language: Kotlin through JNI on Android, Swift on iOS. Layout is flexbox
through Yoga (C++, MIT, used by React Native and Litho), and style is a CSS
subset that `ters` checks at build time and refuses otherwise, as the C
target refuses code it can't print.

- Good: one compiler path for every platform, the one `ters native`
  already tests; fast, threaded code; the shell is small and written once
  per platform, not per program; `mountHtml`'s host shape already says what
  the C interface needs.
- Cost: `Cells` and the `Html` mount in C (new runtime code, the size of
  cells.ts); a style subset with its own checks; the JNI and Swift glue.

**B. Kotlin and Swift printers from the core IR.** Two new printers, each
printing a program and its page as Compose or SwiftUI code.

- Good: the most "native" result: real Compose and SwiftUI views, the
  platforms' own tools for debugging.
- Cost: two whole new targets, each with numbers, lists, closures,
  handlers, cells and budgets to port and keep in step. That is the
  "features ported to five paths" drag the 11-05 progress review named.
  Compose and SwiftUI also each own state their own way, which fights
  `Cells`.

**C. Kotlin Multiplatform with Compose Multiplatform.** One Kotlin printer
for both phones.

- Good: one new target instead of two.
- Cost: still a whole new target; Compose Multiplatform on iOS draws its
  own widgets with Skia, so it is not the platform's own UI on iOS either.

**D. Flutter or Dart.** Dart printer, Flutter widgets.

- Cost: a new target, and Flutter draws everything itself: native code, but
  not native views.

## Recommendation: route A

It adds no new language target. Every feature the C target gets
(arrays in place, threads, handlers) reaches the phone with no extra work,
and the native part is a fixed shell, not a printer. It keeps the "two
landscapes" rule: the page stays `Html` and cells in Ters, and the platform
kinks stay in the shell and the view host.

What a page's parts become under route A:

- **Cells** become a C runtime with the same meaning as cells.ts: a cell
  holds a value, reads are recorded, and a write marks its readers dirty
  and rebuilds them in one batch. Keys and paths (`Step`) port as data.
- **Html** becomes calls on the view host: `div`, `span` and `button`
  become the platform's container, text and button views (on Android:
  `LinearLayout` or a Yoga-backed `ViewGroup`, `TextView`, `Button`; on
  iOS: `UIView`, `UILabel`, `UIButton`). An element kind the host doesn't
  know is a build-time refusal naming it.
- **Events**: the shell calls one exported C function,
  `ters_event(view, kind, value)`, on the UI thread. The program's handler
  runs, writes cells, and the rebuild calls back into the host. The program
  owns the UI thread only while a handler runs, so a long handler should go
  to the pool (as `together` does now).
- **Style**: the subset dice needs first: flex direction, gap, padding,
  margin, sizes, colours (with variables resolved at build time), border
  radius, font size and weight, and light and dark through the platform's
  own setting. Transitions and `position` come later or are refused.

## Plan

- **C199a. Cells in C.** Done: the lowering makes a cell a box holding a
  closure of nothing, one giving what was written or the formula, so C and
  WebAssembly need no new runtime (scalar.ts `cellOp`). A formula runs at
  each read, which gives what cells.ts's gives, since it can only read
  cells. Knowing which readers a write wakes, so a page rebuilds only
  those, comes with the mount (C199b), as do each, paths and edits.
  Example: a counter written three times and a formula over it read as
  the evaluator reads them (compiler/test/c-cells.test.ts).
- **C199b. The Html mount in C over a view host.** Done: c.ts `pageC`
  mounts main's Html through `ters_host`, a struct of function pointers
  (element, text, set text, set and remove attribute, append, clear,
  listen, gone), and keeps a tree of what it drew. The shell calls
  `ters_page_start(host)` once and `ters_page_event(handler, value, key,
  x, y, seconds)` for each event. Rather than cells.ts's watchers, each
  event runs every text, attribute and part again and tells the host only
  what changed; a part's new Html is laid over what it drew where the tags
  and attributes match, so a field keeps its place. With C199a's cells
  read at each call this gives what the watchers give, at the cost of
  running every view per event, which a page of dice's size doesn't feel.
  Example: dice, and a counter with a todo list, print what html.ts's mount
  prints on the tests' fake document, before and after clicks and typing
  (compiler/test/c-page.test.ts, the headless host `page: "headless"`).
- **C199c. The Android shell.** A Kotlin `Activity` with a JNI view host
  and the program's C built by the NDK, plus an `ters build-native-app`
  command writing the Gradle project; the "Android app" workflow builds the
  APK, since containers can't reach the Android SDK. Example: dice as an
  APK with no webview, installed by Ersagun.
- **C199d. Layout and style.** Yoga for flexbox, and the style subset
  checked at build time, with a refusal naming each property it can't map.
  Example: dice's layout and colours on the phone match the web page, in
  light and dark.
- **C199e. The iOS shell.** A Swift view host over UIKit. Building and
  testing it needs a macOS runner, which costs about ten times a Linux
  minute against the $20 Actions budget, so it waits for Ersagun's call.
  Example: dice on an iPhone simulator.
