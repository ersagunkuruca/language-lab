# Desktop apps: macOS and Windows

Design note, 2026-11-23. Ersagun asked: "If we want to target windows and
macos apps, is that too much work? Can I make my own file browser with it
for example?" This note answers both and plans the work as rows C294 to
C300 and L282 to L284, with a file browser as the driving example. Nothing
here is built yet.

## Answer

Not too much. A desktop app is the phone apps' route again (NATIVE-APPS.md,
route A): the program through the C target, the page mounted, styled and
laid out in C (c.ts `pageC`, c-layout.ts), and a thin screen per platform
that makes boxes and texts and sends events back. All of the middle is
built and tested. What a desktop needs on top is a screen per platform,
the C runtime on Windows, and the events a mouse and keyboard give.

Sizes, against the phone shells (C199c Android = 1):

| piece | size | why |
|---|---|---|
| macOS command line (`ters native`) | 0.1 | clang and POSIX as on Linux; fibers by setjmp as on iOS |
| macOS app screen | 0.4 | AppKit is UIKit's sibling: ios-app.ts's Screen.m mostly carries over |
| Windows command line | 0.8 | the runtime assumes POSIX: threads, `stat`/`opendir`, ucontext, UTF-8 paths |
| Windows app screen | 1.2 | a new screen: Direct2D boxes, DirectWrite texts, Win32 inputs and frames |
| desktop input (both) | 0.5 | window height, hover, wheel, keys, double and right click |
| file browser's world and page | 0.5 | file info, open outside, files in a page, long lists |

So macOS is small and could be first. Windows is most of the work, and
most of that is the runtime, not the screen.

And yes, a file browser fits. Listing a folder, reading and writing files
already work in C (c-rt.ts `listFolder`, `readFile`, `readBytes`). It needs
a file's size and time, a way to open a file in its own app, files allowed
in a page, and a list of thousands of rows that stays quick.

## macOS

- **Command line.** `ters native` builds with clang on a Mac today in all
  but the fibers: ucontext is deprecated there, so the setjmp fibers iOS
  uses (`LAB_FIBER_SJLJ`) become the default on Apple. The native sweep
  (every example on every target) gains a hand-run macOS job.
- **App.** `ters build-native-app --macos` writes the same page C with a
  Screen.m over AppKit: NSViews for boxes (flipped, so y grows down as in
  the layout), NSTextFields for texts and inputs, Core Graphics for
  pictures, CVDisplayLink for frames, AVAudioEngine for sound as on iOS.
  A window, not a screen: it resizes, and the layout is told the new width
  and height. build.sh makes a `.app` with clang alone. The hand-run
  "macOS app" workflow (macos-latest, as the iOS one) builds it, starts it
  with clicks to make by a button's text, and prints what the page shows.
- **Left for a real Mac.** Gatekeeper refuses an unsigned app from the
  internet: ad-hoc signing (`codesign -s -`) runs it after a right-click
  Open; a Developer ID and notarizing is Ersagun's call, as iOS signing is.

## Windows

- **Command line.** clang for Windows with MinGW-w64's headers (llvm-mingw),
  so the C stays one file with few `#ifdef`s. In the runtime: threads as a
  small Win32 layer under the pool's few pthread calls (or winpthreads),
  files through the wide calls (`_wstat`, `FindFirstFileW`, `_wfopen`)
  with UTF-8 converted at the edge, fibers as Win32 fibers
  (`CreateFiber`, `SwitchToFiber`; a stack switched by hand breaks
  Windows' unwinding), the console set to UTF-8, and `\r\n` left alone.
  Checked by the native sweep on a hand-run windows-latest job.
- **App.** `ters build-native-app --windows` writes the page C with a
  screen in C over Win32: one window drawn with Direct2D (boxes, rounded
  corners, borders, pictures), texts measured and drawn by DirectWrite,
  inputs as EDIT controls placed over it, frames by a timer at the
  display's rate, dark mode from the system setting, sound by WASAPI. It
  builds with clang alone into an `.exe`; the hand-run "Windows app"
  workflow builds it, clicks by text and prints what the page shows.
- **Left for a real PC.** SmartScreen warns about an unsigned `.exe`;
  signing is Ersagun's call.

## A desktop's input

A phone shell sends taps, typing, Enter and frames. A desktop also has:

- a window's height as well as its width (`ters_ui_resize` gains it);
- the pointer over a box: `:hover` joins the CSS subset, and `pointerenter`
  and `pointerleave` reach handlers;
- the wheel and trackpad, scrolling the box under the pointer;
- keys beyond Enter (arrows, Escape, letters with Ctrl or Cmd), focus moved
  with Tab, and a key a page doesn't handle doing what the platform does;
- double click and right click (`dblclick`, `contextmenu`).

These are the web page's own events, so a page means the same in a
browser and in an app.

## The file browser

**Example: `folders`**, an original page program. Two panes: on the left
the folders above the current one and those inside it; on the right its
files with name, size and modified time, sorted by a click on a column's
head, filtered by typing, moved through with the arrow keys. Enter or a
double click opens a folder, or a file in its own app. A text file shows
its first lines beside the list. Writes (rename, move to the bin) are a
later step, each asked before it's done.

What it needs from the language and targets:

- **L282. A file's info.** `file info(path)`: its kind (file, folder,
  link), size in bytes and modified time, failing with the reason as
  reading a file does. In the evaluator, C (`stat`, Windows' wide stat),
  WASI (`path_filestat_get`) and the browser's stored files; in a run's
  log like the other world answers.
- **L283. Open outside.** `open outside(path)` hands a file or folder to
  the platform's own app (`open` on macOS, `ShellExecuteW` on Windows,
  `xdg-open` on Linux, an intent on Android). It changes nothing in the
  program's world, but it is an effect a run's log records and `--allow`
  names.
- **L284. Files in a page.** A page's handlers today get no files. In an
  app they read the disk; in a browser the browser's stored files, or a
  folder the person picks (the File System Access API's
  `showDirectoryPicker`, Chromium only); in the editor a sample folder.
  The page asks for files as it asks for the microphone, and a target that
  can't give them says so at build time.
- **C300. Long lists.** A folder of 10,000 files is 10,000 rows. A C page
  runs every view again after each event (C199b) and lays out the whole
  page again (C199d). Measured first on `folders` with 10,000 rows; if a
  key press takes over 16 ms, rerun only the views that read a changed
  cell and lay out only what moved, or lay out only the rows in view.

## Prior art

The route is React Native's desktop ports (react-native-macos,
react-native-windows), which also put one layout engine under each
platform's own views; ours is in C and shared with the phones. Prior art,
nothing adapted.

## Rows

| id | item | size |
|---|---|---|
| C294 | `ters native` on macOS: setjmp fibers by default on Apple, native sweep on a hand-run macOS job | S |
| C295 | macOS app: `build-native-app --macos`, Screen.m over AppKit, resizable window, "macOS app" workflow; example dice, then folders | M |
| C296 | `ters native` on Windows: llvm-mingw, Win32 threads, wide file calls, Win32 fibers, UTF-8 console; native sweep on a hand-run Windows job | L |
| C297 | Windows app: `build-native-app --windows`, Direct2D and DirectWrite screen, EDIT inputs, frames, dark mode, "Windows app" workflow; sound (WASAPI) a part of its own; example dice, then folders | L |
| C298 | Desktop input in the C page and both screens: height, hover, wheel, keys and focus, double and right click | M |
| C299 | `folders`, the file browser example: built as a page, run in the editor on a sample folder, then as a macOS and a Windows app | M |
| C300 | Long lists in a C page: measure folders at 10,000 rows, then rerun and lay out only what changed | M |
| L282 | `file info(path)`: kind, size, modified time, on every target | S |
| L283 | `open outside(path)`: a file or folder to the platform's own app | S |
| L284 | Files in a page: disk in an app, stored or picked folder in a browser, a sample folder in the editor | M |

Order: L282, C294, C295 (macOS dice), L283, L284, C298, C299 (folders on
macOS), C300, then C296, C297 (Windows dice, then folders).
