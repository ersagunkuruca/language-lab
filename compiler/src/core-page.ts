// A page from JavaScript printed from the core IR (C137c9, `lab build-web
// --core`): the evaluator's cells and mount (html.ts) and the browser's
// world (browser.ts), as page-runtime.ts gives compile.ts's pages, with
// the printed functions called as core-js.ts calls them.

import { equal, type Value } from "../../ters/src/lang/run.ts";
import { Cells } from "../../ters/src/lang/cells.ts";
import { browserWorld, pageStorage } from "../../ters/src/lang/browser.ts";
import { mountHtml, type Doc, type Node_ } from "../../ters/src/lang/html.ts";
import { recordingWorld, soundPlayer } from "../../ters/src/lang/audio-page.ts";
import { coreCall, coreRuntime, type TableSpec } from "./core-rt.ts";
import type { Code } from "../../ters/src/model.ts";

type Defs = Record<string, (...xs: unknown[]) => unknown>;

// `defs` makes the printed functions from the runtime; `main` is the
// page's, by its printed name; `program` names the page's files in
// localStorage (browser.ts); `code`, the program's nodes when a solve
// needs them; `worklet`, a page with sound's audio thread script
// (core-sound.ts), which plays its `listen` nodes (C137d4).
export function startCorePage(tables: TableSpec[], worlds: string[], defs: (R: ReturnType<typeof coreRuntime>) => Defs, main: string, program: string, code?: Code, worklet?: string): void {
  const cells = new Cells(equal);
  // What main is answered is kept for the audio thread's run of it (L60).
  const world = recordingWorld(browserWorld(pageStorage(), program, console, { cells, frame: (f) => requestAnimationFrame(f) }));
  // A handler run that's taken back prints nothing (cells.ts attempt).
  const rt = { print: (line: string) => cells.later(() => console.log(line)), world, cells };
  const fns = defs(coreRuntime(tables, worlds, rt, code));
  const doc = document as unknown as Doc & { body: { append(n: Node_): void } };
  const run = () => fns[main]() as Value;
  const sound = worklet ? soundPlayer(cells, worklet, run, undefined, world) : null;
  doc.body.append(mountHtml((sound ? sound.page : run()) as never, { cells, doc, call: coreCall, listen: sound?.listen }));
}
