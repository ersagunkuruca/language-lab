#!/usr/bin/env node
// ters: the language on the command line (once `lab`).
//
//   ters run <program> [arguments…]       run `main` with the evaluator; a page
//                                        prints as static HTML (WEB.md)
//   ters compile <program> [-o out.mjs]   compile to a JavaScript module that runs `main`
//     through the core IR (compiler/src/core-js.ts, C137), as WebAssembly and C are
//   ters native <program> [-o out]        compile to a native program through C (NATIVE.md)
//   ters wasi <program> [-o out.wasm]     compile to a WASI command, WebAssembly with GC
//   ters check <program>                  type-check, and list the definitions with their types
//   ters hosts <program> [--c]            print a hosts/js.js (or with --c a hosts/c.c) to start from: the program's own effects (FOREIGN.md)
//   ters test <program> [--fresh]         run the tests: definitions whose row has Check (TESTS-IN-THE-LANGUAGE.md);
//                                        results kept by hash in .lab/checks.json, --fresh ignores them
//   ters build-web <program> [-o app.html]  a page: one HTML file, opened anywhere (WEB.md)
//   ters build-app <program> [-o folder]  a page as an installable, offline app, and a Capacitor project
//   ters mcp [program]                    an MCP server on stdin/stdout (mcp/server.ts)
//   ters publish <program> <name…> [-o module.json]
//                                        publish definitions as their next versions in a module (SHARING.md §1)
//   ters upgrade <program>                move a program onto its modules' newest versions, if its tests pass (§2)
//   ters downgrade <program> <name>       back to the version before, from the program's store (§4b)
//   ters broken <module.json> <name> <n> <reason…>  mark a version broken in the module's signed log (§4)
//   ters fetch <program> <url>            a module from any host into the program's modules, checked by hash (§4)
//   ters diff <before> <after>            what changed, by definition, line by line by node id
//                                        (two programs: diff.ts, DIFF.md), or a JSON file's ids (merge-files.ts)
//   ters merge <base> <ours> <theirs> [path]
//                                        git's merge driver for program files: id by id, ours
//                                        written with theirs taken in (SHARING.md §6)
//   ters render <program> in.wav [-o out.wav] [--block n] [--compiled]
//                                        play a sound over a WAV file (AUDIO.md)
//
// A program is a file saved by the editor (Save file), or a folder of side
// tables like ters/examples/sort. `main` gets the arguments as a list
// of texts (or nothing, if it takes none) and returns the exit code; an
// Abort nothing handles prints its reason and exits with 1 (LANGUAGE.md,
// "The world"). `--main <name>` picks another entry point.
//
// A program that writes representations (REPRESENTATIONS.md) runs and
// compiles on the representation the chooser picks for each type `main` uses, e.g.
// Peano Nat stored as an Int. `--as-defined` runs the definitions instead.

// The commands are in main.ts, read after the sources' types are stripped
// through a kept copy (src/stripped.ts, I193): stripping every source again
// was a quarter of a short command's time.
import "../src/stripped.ts";
await import("./main.ts");
