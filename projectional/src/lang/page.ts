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
import { compile } from "../../../compiler/src/compile.ts";
import { HTML_V } from "./std.ts";
import { soundPlayer } from "./audio-page.ts";

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
  // workletRuntime (cli/web.ts) prebuilt: given it, a page with sound plays
  // in the preview (AUDIO.md, "Playing a sound from the editor").
  worklet?: string;
  // Where recordings are read from, when not beside the page (the editor's: apps/).
  recordings?: string;
}

export interface Preview {
  root: Node_;
  cells: Cells;
  // Stops the clock and any sound: nothing on this page runs on frames,
  // and nothing plays, any more.
  stop(): void;
  // A page with sound: stops what plays, and the page stays.
  hush?: () => void;
}

// Throws when main can't run (an error, an unhandled effect), with why.
export function showPage(o: PageOptions): Preview {
  const problem = pageProblem(o.info, o.main, o.names);
  if (problem) throw new Error(problem);
  const out = o.console ?? console;
  let stopped = false;
  const cells = new Cells(equal);
  const world = browserWorld(o.store, o.program, out as Console, { cells, frame: (f) => { if (!stopped) o.frame(() => { if (!stopped) f(); }); } });
  const run = () => runMain(o.code, o.info, o.main, { print: (line) => out.log(line), names: o.names, cells, world });
  const sound = o.worklet && hasSound(o.code) ? soundPlayer(cells, workletFile(o.worklet, o.code, o.info, o.names, o.main), run, o.recordings) : null;
  const value = sound ? sound.page : run();
  const root = mountHtml(value, { cells, doc: o.doc, call: evaluatorCall, ran: o.ran, listen: sound?.listen });
  return { root, cells, stop: () => { stopped = true; sound?.stop(); }, hush: sound ? () => sound.hush() : undefined };
}

// A page as one HTML file around its scripts: what `lab build-web` writes,
// and what the editor's "Save page" gives you. Nothing is loaded from
// anywhere else.
export function pageShell(title: string, ...scripts: string[]): string {
  return pageDocument(title, "", ...scripts);
}

// The same document with `body` already drawn in it: `lab run` on a page
// gives this with no scripts, the page as static HTML.
export function pageDocument(title: string, body: string, ...scripts: string[]): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<!-- ${esc(title)}, built from a program in the language (projectional/WEB.md). -->
</head>
<body>
${body ? `${body}\n` : ""}${scripts.map((js) => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`).join("\n")}
</body>
</html>
`;
}

// The same page made without a bundler, in a browser: `runtime` is
// page-runtime.ts prebuilt as a script that sets `$lab` (cli/web.ts
// pageRuntime), and the program is compiled to a script that takes its
// helpers from there. Bigger than `lab build-web`'s, which keeps only what
// the program uses, and the same page.
// A page with sound also gives `worklet`, workletRuntime (cli/web.ts)
// prebuilt, and plays: its program for the audio thread is made here too.
export function pageFile(title: string, runtime: string, code: Code, info: Info, names: Names, main: Id, worklet?: string): string {
  const name = names[main];
  const program = compile(code, info, names, { runtime: "$lab", exports: [name], link: "global" });
  const sound = worklet && hasSound(code) ? `, ${JSON.stringify(workletFile(worklet, code, info, names, main))}` : "";
  return pageShell(title, runtime, `(() => {\n${program}\n$lab.startPage(defs[${JSON.stringify(name)}], ${JSON.stringify(title)}${sound});\n})();`);
}

// Does the program play sound (a `listen` attribute anywhere)?
export const hasSound = (code: Code) => Object.values(code.nodes).some((n) => n.kind === "ref" && n.target === HTML_V.listen);

// The script the audio thread runs for a page with sound (AUDIO.md, A4),
// made in a browser: `runtime` is cli/web.ts workletRuntime, and the
// program, compiled here, takes its helpers from it and runs main again
// there (audio-worklet.ts startSound). The editor plays a page's sound
// with it: audio-page.ts soundPlayer(cells, workletFile(…), main) gives
// the page to mount and the `listen` hook (html.ts Mount.listen) that
// plays it.
export function workletFile(runtime: string, code: Code, info: Info, names: Names, main: Id): string {
  const name = names[main];
  const program = compile(code, info, names, { runtime: "$lab", exports: [name], link: "global" });
  return `${runtime}\n(() => {\n${program}\n$lab.startSound(defs[${JSON.stringify(name)}]);\n})();`;
}
