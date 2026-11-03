// A page from JavaScript printed from the core IR (C137c9, `lab build-web
// --core`): the evaluator's cells and mount (html.ts) and the browser's
// world (browser.ts), as page-runtime.ts gives compile.ts's pages, with
// the printed functions called as core-js.ts calls them.

import { equal } from "../../ters/src/lang/run.ts";
import { Cells } from "../../ters/src/lang/cells.ts";
import { browserWorld, pageStorage } from "../../ters/src/lang/browser.ts";
import { mountHtml, type Doc, type Node_ } from "../../ters/src/lang/html.ts";
import { coreCall, coreRuntime, type TableSpec } from "./core-rt.ts";
import type { Code } from "../../ters/src/model.ts";

type Defs = Record<string, (...xs: unknown[]) => unknown>;

// `defs` makes the printed functions from the runtime; `main` is the
// page's, by its printed name; `program` names the page's files in
// localStorage (browser.ts); `code`, the program's nodes when a solve
// needs them.
export function startCorePage(tables: TableSpec[], worlds: string[], defs: (R: ReturnType<typeof coreRuntime>) => Defs, main: string, program: string, code?: Code): void {
  const cells = new Cells(equal);
  const world = browserWorld(pageStorage(), program, console, { cells, frame: (f) => requestAnimationFrame(f) });
  // A handler run that's taken back prints nothing (cells.ts attempt).
  const rt = { print: (line: string) => cells.later(() => console.log(line)), world, cells };
  const fns = defs(coreRuntime(tables, worlds, rt, code));
  const doc = document as unknown as Doc & { body: { append(n: Node_): void } };
  doc.body.append(mountHtml(fns[main]() as never, { cells, doc, call: coreCall }));
}
