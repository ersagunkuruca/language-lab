// A page program shown live, the way the editor previews one (WEB.md): its
// `main` run by the evaluator against the browser's world (browser.ts) and
// its Html mounted (html.ts) into whatever element the caller gives it.
// What `lab build-web` does with compiled code, without compiling, so the
// preview can follow every edit. Files go to localStorage under the
// program's name, like the built page's; the clock runs on the frames the
// caller hands out, and stops when the preview does.

import type { Code, Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import { browserWorld, type Store } from "./browser.ts";
import { Cells } from "./cells.ts";
import { evaluatorCall, mountHtml, type Doc, type Node_ } from "./html.ts";
import { equal, pageProblem, runMain } from "./run.ts";

// The definition a page starts from: the one named `main` that returns an
// Html and takes nothing. Null when the program has none, so it isn't a page.
export function pageMain(defs: Id[], info: Info, names: Names): Id | null {
  const main = defs.find((d) => names[d] === "main");
  return main && !pageProblem(info, main, names) ? main : null;
}

export interface PageOptions {
  code: Code;
  info: Info;
  names: Names;
  main: Id;
  // Whose files these are: localStorage entries are `lab:<program>:path`.
  program: string;
  doc: Doc;
  store: Store;
  // Where the page's printing and logging go.
  console?: Pick<Console, "log" | "error">;
  // Asks for the next animation frame (requestAnimationFrame in a browser).
  frame: (f: () => void) => void;
  // Each time a part runs again: a preview can flash it.
  ran?: (el: Node_) => void;
}

export interface Preview {
  root: Node_;
  cells: Cells;
  // Stops the clock: nothing on this page runs on frames any more.
  stop(): void;
}

// Throws when main can't run (an error, an unhandled effect), with why.
export function showPage(o: PageOptions): Preview {
  const problem = pageProblem(o.info, o.main, o.names);
  if (problem) throw new Error(problem);
  const out = o.console ?? console;
  let stopped = false;
  const cells = new Cells(equal);
  const world = browserWorld(o.store, o.program, out as Console, { cells, frame: (f) => { if (!stopped) o.frame(() => { if (!stopped) f(); }); } });
  const value = runMain(o.code, o.info, o.main, { print: (line) => out.log(line), names: o.names, cells, world });
  const root = mountHtml(value, { cells, doc: o.doc, call: evaluatorCall, ran: o.ran });
  return { root, cells, stop: () => { stopped = true; } };
}
