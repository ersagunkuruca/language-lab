// A page from JavaScript printed from the core IR (C137c9, `lab build-web
// --core`): the evaluator's cells and mount (html.ts) and the browser's
// world (browser.ts), as page-runtime.ts gives compile.ts's pages, with
// the printed functions called as core-js.ts calls them.

import { equal, type Value } from "../../ters/src/lang/run.ts";
import { Cells } from "../../ters/src/lang/cells.ts";
import { browserWorld, pageStorage, type Store } from "../../ters/src/lang/browser.ts";
import { mountHtml, type Doc, type Node_ } from "../../ters/src/lang/html.ts";
import { recordingWorld, soundPlayer } from "../../ters/src/lang/audio-page.ts";
import { coreCall, coreRuntime, type HostOps, type TableSpec } from "./core-rt.ts";
import type { Hosts } from "../../ters/src/lang/hosts.ts";
import type { Code } from "../../ters/src/model.ts";

type Defs = Record<string, (...xs: unknown[]) => unknown>;

// `defs` makes the printed functions from the runtime; `main` is the
// page's, by its printed name; `program` names the page's files in
// localStorage (browser.ts); `code`, the program's nodes when a solve
// needs them; `worklet`, a page with sound's audio thread script
// (core-sound.ts), which plays its `listen` nodes (C137d4).
// `hosts`: its hosts/js.js's answers and the operations they answer.
export function startCorePage(tables: TableSpec[], worlds: string[], defs: (R: ReturnType<typeof coreRuntime>) => Defs, main: string, program: string, code?: Code, worklet?: string, hosts?: { answers: Hosts; ops: HostOps }): void {
  const cells = new Cells(equal);
  // What main is answered is kept for the audio thread's run of it (L60).
  const world = recordingWorld(browserWorld(pageStorage(), program, console, { cells, frame: (f) => requestAnimationFrame(f) }));
  // A handler run that's taken back prints nothing (cells.ts attempt).
  const rt = { print: (line: string) => cells.later(() => console.log(line)), world, cells, hosts: hosts?.answers };
  const fns = defs(coreRuntime(tables, worlds, rt, code, undefined, hosts?.ops));
  const doc = document as unknown as Doc & { body: { append(n: Node_): void } };
  const run = () => fns[main]() as Value;
  const sound = worklet ? soundPlayer(cells, worklet, run, undefined, world) : null;
  doc.body.append(mountHtml((sound ? sound.page : run()) as never, { cells, doc, call: coreCall, listen: sound?.listen }));
}

// The same page mounted where the caller says (E244): the editor's
// preview, which swaps the compiled page in for the interpreted one and
// hands over what was done on it (cells.ts handOver), as page-runtime.ts
// mountPage does for compile.ts's. `kept` is the cells made while main ran,
// in order; `stop` ends its frames.
export function mountCorePage(tables: TableSpec[], worlds: string[], defs: (R: ReturnType<typeof coreRuntime>) => Defs, main: string, program: string, code: Code | undefined, o: { doc: Doc; store: Store; frame: (f: () => void) => void; ran?: (el: Node_) => void }): { root: Node_; cells: Cells; kept: NonNullable<Cells["kept"]>; stop(): void } {
  let stopped = false;
  const cells = new Cells(equal);
  const world = browserWorld(o.store, program, console, { cells, frame: (f) => { if (!stopped) o.frame(() => { if (!stopped) f(); }); } });
  const rt = { print: (line: string) => cells.later(() => console.log(line)), world, cells };
  const fns = defs(coreRuntime(tables, worlds, rt, code));
  cells.kept = [];
  const root = mountHtml(fns[main]() as never, { cells, doc: o.doc, call: coreCall, ran: o.ran });
  const kept = cells.kept;
  cells.kept = null;
  return { root, cells, kept, stop: () => { stopped = true; } };
}
