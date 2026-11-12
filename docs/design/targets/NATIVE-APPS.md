# Native apps per platform

Design note for BACKLOG.md C199 (Ersagun 2026-11-09: "Mobile is a goal.
Stretch goal is native compilation on each platform instead of webview
stuff."). Written 2026-11-10 by Language lane B. The last section is the
plan, as rows C199a to C199e.

**Status.** Route A chosen (Ersagun, 2026-11-10). C199a to C199d are
done: cells in C and WebAssembly, a page's Html mounted from C on a view
host, dice as an Android APK with no webview, and its layout and style in
C, and C199e, the same page on an iPhone simulator with UIKit's views. Today a phone runs a Ters page in a webview:
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
- **C199c. The Android shell.** Done: `ters build-native-app <program> -o
  folder` writes a Gradle project (ters/cli/native-app.ts). Its C is the
  page's with a JNI screen after it, each call a call of MainActivity's
  method of that name, views named by numbers, texts crossing as UTF-16.
  MainActivity is Java, so Gradle needs no Kotlin plugin; clicks, typing,
  Enter and frames (Choreographer) come back as `ters_page_event`. The C and
  JNI half runs on a desktop JVM against a stand-in MainActivity
  (compiler/test/c-native-app.test.ts); the "Android app" workflow with
  `kind: native` builds the APK. Example: dice as an APK, installed by
  Ersagun.
- **C199d. Layout and style.** Done: rather than Yoga, a style and layout
  engine in C (compiler/src/c-layout.ts), so Android and iOS share it and it
  needs no C++. It sits between `pageC`'s mount (a `ters_host` that keeps
  the tree) and the platform's `ters_ui` (make a box or a text, place it,
  paint it with a colour, rounded corners and a border, give it a font,
  measure a text, size the page). Style comes from the page's own style
  elements and style attributes: simple selectors (tag, #id, .class,
  :root, *), specificity and order, custom properties, prefers-color-scheme
  and box-sizing. Layout is block and inline flow with wrapping, flex rows
  and columns with gap and wrap, grids of fixed, fr, auto and minmax
  columns, absolute positions and display: contents. Texts are measured by
  the platform (Android's StaticLayout). After each event or frame the page
  is styled and laid out again, and the screen hears only what changed.
  What isn't in the subset (hover, transitions, sibling combinators) is
  left out, and `ters build-native-app` lists it (C205, ters/cli/native-
  check.ts); an element a box doesn't mean (an image, a video, a menu, a
  checkbox, a text in a picture) is refused at build time, naming it. Example: dice's chart, bars and fair marks land where
  Chromium puts them at 360 wide (compiler/test/c-page.test.ts, the
  headless screen `page: "ui-headless"`), and the JNI screen on the
  stand-in tells the same places (c-native-app.test.ts).
- **C199e. The iOS shell.** Done: `ters build-native-app --ios` writes
  the same page C as Android's with Screen.m, the screen in Objective-C
  over UIKit rather than Swift, since it takes ters_ui's C calls with no
  bridge (ters/cli/ios-app.ts). Boxes are UIViews (borders on single
  sides as layers, overflow: auto as a box whose bounds move under a pan),
  texts UILabels with CSS's line height, inputs UITextFields and
  UITextViews, pictures drawn with Core Graphics, frames on CADisplayLink,
  pause and resume from the app's notifications (iOS has no back button).
  Fibers switch by setjmp (LAB_FIBER_SJLJ), as iOS has no ucontext.
  build.sh builds the simulator's app with clang alone, no Xcode project.
  The hand-run "iOS app" workflow (macos-latest, free on the public repo)
  builds it, installs it on an iPhone simulator and starts it with
  `-ters-taps`, which taps buttons by their text and prints what the page
  shows and where. Example: dice on an iPhone simulator rolls, and
  throws a hundred (2026-11-12). Left for a phone: signing with a team in
  Xcode, and an icon.
- **C217. A page's sound.** Done: the C page keeps each `listen` (its input
  and block function) and plays it on the platform's audio thread, AAudio
  on Android and AVAudioEngine on iOS, which ask `ters_sound_play` for
  samples at the device's rate; the block function runs 128 at a time
  with the page's own cells, the page's thread and the audio thread taking
  turns under one lock (`ters_page_lock`). Streams are stopped and nodes
  detached off the lock, since that waits for a callback that may be
  waiting for it. A recording the page names ships in the app (Android's
  assets, the iOS bundle) and is read as WAV in C; the microphone is asked
  for when a page listens to it, and plays silence till it is allowed.
  Once a second the app logs each sound's loudness in and out and how
  much it changed what came in. Example: pedal's A strum plays on the
  Android emulator and the iPhone simulator, Clean changing nearly
  nothing and Harder changing more (2026-11-12).
