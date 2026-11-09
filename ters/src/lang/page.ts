// A page program shown live, the way the editor previews one (WEB.md): its
// `main` run by the evaluator against the browser's world (browser.ts) and
// its Html mounted (html.ts) into whatever element the caller gives it.
// What `ters build-web` does with compiled code, without compiling, so the
// preview can follow every edit. Files go to localStorage under the
// program's name, like the built page's; the clock runs on the frames the
// caller hands out, and stops when the preview does.

import type { PlainRequest, PlainResponse } from "./network.ts";
import type { Code, Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import { browserWorld, type Store } from "./browser.ts";
import { Cells } from "./cells.ts";
import { evaluatorCall, mountHtml, replayEvent, type Doc, type Node_ } from "./html.ts";
import { equal, pageProblem, runMain } from "./run.ts";
import { corePageScript, coreSoundScript, lowerCore } from "../../../compiler/src/core-js.ts";
import type { CoreIR } from "../../../compiler/src/scalar.ts";
import { HTML_V } from "./std.ts";
import { LIBRARY } from "./library.ts";
import { withLibraryRepresentations } from "./library-reps.ts";
import { recordingWorld, soundPlayer } from "./audio-page.ts";
import { heardInto, logged, replaying, WentAnotherWay, type LogEntry } from "./worldlog.ts";

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
  // coreWorkletRuntime (cli/web.ts) prebuilt: given it, a page with sound
  // plays in the preview (AUDIO.md, "Playing a sound from the editor"),
  // main run again on the audio thread from the core IR.
  worklet?: string;
  // Where recordings are read from, when not beside the page (the editor's: apps/).
  recordings?: string;
  // How the page fetches (a test's; by default the browser's).
  fetch?: (url: string) => Promise<string>;
  // And for send request (L191b).
  send?: (request: PlainRequest) => Promise<PlainResponse>;
  // How the page waits (a test's; by default setTimeout): C40.
  after?: (ms: number) => Promise<void>;
  // Where the run's log goes (C172e): the world's answers (worldlog.ts)
  // and, in their places among them, the events its handlers are given
  // (`{ op: "event", args: [name, value, key, x, y, seconds] }`).
  log?: LogEntry[];
  // A run's log to replay (C172g): the world answers as it says, and
  // after main has drawn the page, each event it logged is given again,
  // in order, to the handler of the element it was given to. Frames come
  // only from the log then.
  replay?: LogEntry[];
  // Keep the cells the page starts with, for handOver (cells.ts).
  keepCells?: boolean;
  // A handler that stopped (html.ts Mount).
  stopped?: (e: unknown) => void;
}

export interface Preview {
  root: Node_;
  cells: Cells;
  // The cells it started with, when asked (keepCells).
  kept?: Cells["kept"];
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
  // The cells main and the first drawing make, for handOver (cells.ts).
  if (o.keepCells) cells.kept = [];
  const browser = browserWorld(o.store, o.program, out as Console, { cells, frame: (f) => { if (!stopped) o.frame(() => { if (!stopped) f(); }); }, fetch: o.fetch, send: o.send, after: o.after });
  const answered = o.replay ? replaying(o.replay.filter((e) => e.op !== "event"), browser) : browser;
  const world = recordingWorld(o.log ? logged(answered, o.log).world : answered);
  const run = () => runMain(o.code, o.info, o.main, { print: (line) => cells.later(() => out.log(line)), names: o.names, cells, world });
  const sound = o.worklet && hasSound(o.code) ? soundPlayer(cells, soundFile(o.worklet, o.code, o.info, o.names, o.main), run, o.recordings, world) : null;
  const value = sound ? sound.page : run();
  const root = mountHtml(value, { cells, doc: o.doc, call: evaluatorCall, ran: o.ran, listen: sound?.listen, stopped: o.stopped, heard: o.log && heardInto(o.log) });
  const kept = cells.kept;
  cells.kept = null;
  if (o.replay) replayEvents(root, o.replay);
  return { root, cells, kept, stop: () => { stopped = true; sound?.stop(); }, hush: sound ? () => sound.hush() : undefined };
}

// The logged events given again, in order (C172g). One whose element
// isn't there any more stops the replay, saying which.
export function replayEvents(root: Node_, log: LogEntry[]): void {
  log.forEach((e, i) => {
    if (e.op !== "event") return;
    const [name, value, key, x, y, seconds, path] = e.args as [string, string, string, number, number, number, number[]];
    if (!replayEvent(root, name, path ?? [], [value, key, x, y, seconds])) throw new WentAnotherWay(`the replay went another way at entry ${i + 1}: the page has no ${name} handler where the log's event was given`);
  });
}

// A page as one HTML file around its scripts: what `ters build-web` writes,
// and what the editor's "Save page" gives you. Nothing is loaded from
// anywhere else.
export function pageShell(title: string, ...scripts: string[]): string {
  return pageDocument(title, "", ...scripts);
}

// What a page looks like before its own style: a readable font, some room,
// buttons and fields that look like the editor's. All of it in :where(), so
// it weighs nothing and any rule of the page's own wins.
export const PAGE_BASE = [
  ":where(body) { margin: 0; padding: 16px; font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1d2229; background: #fff; }",
  ":where(h1) { font-size: 1.4em; margin: 0 0 0.5em; } :where(h2) { font-size: 1.15em; margin: 1em 0 0.4em; }",
  ":where(button) { font: inherit; font-size: 0.93em; padding: 5px 13px; margin: 2px 4px 2px 0; border: 1px solid #c8ced7; border-radius: 8px; background: #f3f5f8; color: inherit; cursor: pointer; }",
  ":where(button:hover) { background: #e7ebf1; } :where(button:active) { background: #dce2ea; }",
  ":where(input, select, textarea) { font: inherit; padding: 4px 8px; border: 1px solid #c8ced7; border-radius: 6px; }",
  ":where(img, svg, canvas, video) { max-width: 100%; }",
].join("\n");

// The same document with `body` already drawn in it: `ters run` on a page
// gives this with no scripts, the page as static HTML.
export function pageDocument(title: string, body: string, ...scripts: string[]): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<!-- ${esc(title)}, built from a program in the language (docs/design/targets/WEB.md). -->
<style>
${PAGE_BASE}
</style>
</head>
<body>
${body ? `${body}\n` : ""}${scripts.map((js) => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`).join("\n")}
</body>
</html>
`;
}

// The page printed from the core IR (C137d6), made without a bundler, in
// a browser (the editor's Save page): `runtime` is cli/web.ts corePageRuntime
// prebuilt, and a page with sound gives `worklet`, coreWorkletRuntime.
// Throws when main isn't compiled through the core IR, with why.
export function corePageFile(title: string, runtime: string, code: Code, info: Info, names: Names, own: Id[], main: Id, worklet?: string): string {
  const ir = lowerCore(code, info, names, own);
  const why = ir.refused.get(main);
  if (why) throw new Error(`${names[main] ?? "main"} isn't compiled through the core IR: it ${why}`);
  const sound = worklet && hasSound(code) ? coreWorkletFile(worklet, ir, names[main]) : undefined;
  return pageShell(title, runtime, corePageScript(ir, names[main], "$core", title, sound, undefined, true));
}
// The audio thread's script for it: `runtime` is coreWorkletRuntime.
export const coreWorkletFile = (runtime: string, ir: CoreIR, name: string): string => `${runtime}\n${coreSoundScript(ir, name, "$core")}`;
// The same for the preview's page (showPage), or why main isn't compiled
// through the core IR.
// Its lists stored as `ters build-web` stores them (C197): a page splits,
// its sound's lists arrays beside the page's Html lists as written (C196).
// The page itself still runs as written, here, while it is edited.
export function soundFile(runtime: string, code0: Code, info0: Info, names0: Names, main: Id): string {
  const c = withLibraryRepresentations(code0, info0, names0, main, code0.defs.filter((d) => !LIBRARY.code.nodes[d]), [], { hostMaps: true });
  const stored = c.chosen.length && c.info && !c.info.errors.length;
  const [code, info, names] = stored ? [c.code, c.info!, c.names] : [code0, info0, names0];
  const ir = lowerCore(code, info, names, [main]);
  const why = ir.refused.get(main);
  if (why) throw new Error(`${names[main] ?? "main"}'s sound isn't compiled through the core IR: it ${why}`);
  return coreWorkletFile(runtime, ir, names[main]);
}

// Does the program play sound (a `listen` attribute anywhere)?
export const hasSound = (code: Code) => Object.values(code.nodes).some((n) => n.kind === "ref" && n.target === HTML_V.listen);

