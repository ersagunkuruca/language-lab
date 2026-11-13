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
import { carried, Cells, nodeOf } from "./cells.ts";
const cellGone = (c: Value): boolean => nodeOf(c)?.disposed ?? true;
import { evaluatorCall, mountHtml, replayEvent, type Doc, type Node_ } from "./html.ts";
import { equal, pageProblem, runMain, type Value, type World } from "./run.ts";
import { corePageScript, coreSoundScript, lowerCore } from "../../../compiler/src/core-js.ts";
import type { CoreIR } from "../../../compiler/src/scalar.ts";
import { HTML_V } from "./std.ts";
import { LIBRARY } from "./library.ts";
import { withLibraryRepresentations } from "./library-reps.ts";
import { recordingWorld, soundPlayer } from "./audio-page.ts";
import { eventsIn, heardInto, isEvent, logged, LogWindow, replaying, WentAnotherWay, type LogEntry, type PlacedSnapshot, type Snapshot } from "./worldlog.ts";
// A page as a snapshot keeps it (I239b).
export interface PageSnapshot { cells: [Value, Value][]; random: number[] }

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
  // How the person answers a permission (a test's; by default the browser asks).
  permission?: (what: string) => Promise<boolean>;
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
  // The log kept as a window (I239b, WORLD-LOG-WINDOW.md): a snapshot
  // every `seconds`, the last `keep` kept. `clock` is a test's.
  window?: { seconds: number; keep: number; clock?: () => number };
  // A handler that stopped (html.ts Mount).
  stopped?: (e: unknown) => void;
  // The compiled page's window to step through (I239f): `log` is its log
  // and `window` the rules it was kept by; `firsts`, the values its cells
  // were made with, in order; `snapshots`, its window's. The page is
  // built stepped, at the log's last event, from the nearest snapshot
  // whose cells it can take (cells.ts carried).
  stepFrom?: { firsts: unknown[]; snapshots: Snapshot<PlacedSnapshot>[] };
}

export interface Preview {
  root: Node_;
  cells: Cells;
  // The cells it started with, when asked (keepCells).
  kept?: Cells["kept"];
  // Its log's window and snapshots, when asked (window), and stepping
  // through it (I239c).
  window?: LogWindow<PageSnapshot>;
  steps?: Steps;
  // A compiled page's (I239f): what an interpreted page built to step
  // through its log takes (PageOptions `stepFrom`).
  stepFrom?: () => NonNullable<PageOptions["stepFrom"]>;
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
  if (o.keepCells || (o.log && o.window)) cells.kept = [];
  const browser = browserWorld(o.store, o.program, out as Console, { cells, frame: (f) => { if (!stopped) o.frame(() => { if (!stopped) f(); }); }, fetch: o.fetch, send: o.send, after: o.after, permission: o.permission });
  const answered = o.replay ? replaying(o.replay.filter((e) => !isEvent(e)), browser) : browser;
  // While the page is stepped through its log (I239c), the world answers
  // from the log and nothing new is logged: `asking` is which world.
  // A page built to step through a compiled page's log starts stepped:
  // main's reads answered live, nothing heard or logged.
  let stepping = !!o.stepFrom, asking: World = o.stepFrom ? browser : answered;
  const switched = Object.fromEntries(Object.keys(answered).map((op) => [op, (...a: unknown[]) => (asking as unknown as Record<string, (...a: unknown[]) => unknown>)[op](...a)])) as unknown as World;
  // The seed too: a step from the run's start draws again from the
  // seed the log has, and a live page from the browser's own draw.
  switched.randomSeed = () => (asking.randomSeed ? asking.randomSeed() : Math.floor(asking.random() * 4294967296));
  const logging = o.log ? logged(o.window ? switched : answered, o.log, { seeded: true, quiet: () => stepping }) : null;
  const world = recordingWorld(logging ? logging.world : answered);
  // A snapshot: the value of each cell main and the first drawing made,
  // and where the generator is. What later cells hold follows from them.
  let made: NonNullable<Cells["kept"]> = [];
  const window = o.log && o.window && logging ? new LogWindow<PageSnapshot>(o.log, () => ({ cells: made.filter((k) => !cellGone(k.cell)).map((k) => [k.cell, cells.peek(k.cell)]), random: logging.random.state() }), o.window) : undefined;
  const run = () => runMain(o.code, o.info, o.main, { print: (line) => cells.later(() => out.log(line)), names: o.names, cells, world });
  const sound = o.worklet && hasSound(o.code) ? soundPlayer(cells, soundFile(o.worklet, o.code, o.info, o.names, o.main), run, o.recordings, world) : null;
  const value = sound ? sound.page : run();
  const root = mountHtml(value, { cells, doc: o.doc, call: evaluatorCall, ran: o.ran, listen: sound?.listen, stopped: o.stopped, heard: o.log && ((h) => (...a: Parameters<typeof h>) => { if (!stepping) h(...a); })(heardInto(o.log, window)), live: () => !stepping });
  const kept = cells.kept;
  made = kept ?? [];
  cells.kept = null;
  if (o.replay) replayEvents(root, o.replay);
  // The run's start as a snapshot too: the cells' first values and the
  // generator as main left it, since a step replays from the first event.
  if (window && !o.stepFrom) window.snapshots[0].state = window.take();
  if (window && o.stepFrom) window.snapshots = takenUp(o.stepFrom, made);
  const steps = window && logging ? stepper(window, root, cells, made, logging.random, browser, (s, w) => { stepping = s; asking = w ?? answered; }) : undefined;
  if (steps && o.stepFrom) steps.to(steps.events());
  return { root, cells, kept: o.keepCells ? kept : undefined, window, steps, stop: () => { stopped = true; sound?.stop(); }, hush: sound ? () => sound.hush() : undefined };
}

// Stepping a page through the window of its log (I239c,
// WORLD-LOG-WINDOW.md §3): `to(n)` shows the page as it was after the
// window's first n events, from the snapshot nearest before (the run's
// start restores the cells' first values), the events after it given
// again with the world answering from the log. Meanwhile the page hears
// nothing live and logs nothing. `resume()` goes on from there: what the
// log had after it is dropped, as a debugger's run from a breakpoint
// leaves the old future.
// `from()` is the first event a step can reach: 0, or past it when the
// snapshots before were dropped or can't be taken up (I239f).
export interface Steps { events(): number; from(): number; at: number | null; to(n: number): void; resume(): void }

// A compiled page's snapshots as the interpreted page's (I239f): each
// cell's value carried to the cell made at the same place (cells.ts
// carried). One holding what can't be carried (a function changed since)
// is left out; a step goes from the one before. Throws when the two pages
// made different cells, or none can be taken up.
function takenUp(from: { firsts: unknown[]; snapshots: Snapshot<PlacedSnapshot>[] }, made: NonNullable<Cells["kept"]>): Snapshot<PageSnapshot>[] {
  if (from.firsts.length !== made.length) throw new Error(`the compiled page made ${from.firsts.length} cells and the interpreted page ${made.length}, so it can't be stepped`);
  const out: Snapshot<PageSnapshot>[] = [];
  for (const s of from.snapshots) {
    if (!s.state) { out.push({ at: s.at, state: null }); continue; }
    const cells: [Value, Value][] = [];
    let ok = true;
    s.state.cells.forEach((v, i) => {
      if (v === undefined || !ok) return;
      const c = carried(from.firsts[i], made[i].first, v);
      if (c) cells.push([made[i].cell, c.value]); else ok = false;
    });
    if (ok) out.push({ at: s.at, state: { cells, random: s.state.random } });
  }
  if (!out.length) throw new Error("the compiled page's snapshots hold functions made since the page started, so the interpreted page can't take them up");
  return out;
}
// The events before log entry `at`: where a snapshot there starts.
const before = (evs: { at: number }[], at: number): number => { const i = evs.findIndex((e) => e.at >= at); return i < 0 ? evs.length : i; };
function stepper(w: LogWindow<PageSnapshot>, root: Node_, cells: Cells, made: NonNullable<Cells["kept"]>, random: { state(): number[]; set(s: number[]): void }, browser: World, set: (stepping: boolean, world?: World) => void): Steps {
  const log = w.log;
  const s: Steps = {
    at: null,
    events: () => [...eventsIn(log)].length,
    from: () => { const evs = [...eventsIn(log)]; return before(evs, w.snapshots[0].at); },
    to(n) {
      const evs = [...eventsIn(log)];
      if (n < 0 || n > evs.length) throw new RangeError(`the log has ${evs.length} events`);
      const snap = [...w.snapshots].reverse().find((x) => before(evs, x.at) <= n);
      if (!snap) throw new RangeError(`a step can go back to event ${s.from()}, not ${n}: the window keeps nothing earlier to start from`);
      // The cells put back. What the page's views read of the world
      // meanwhile (now(), off the clock's cell, put back too) the page
      // answers itself: the log has only what its handlers asked.
      set(true, browser);
      const back = snap.state ? snap.state.cells : made.map((k) => [k.cell, k.first] as [Value, Value]);
      cells.batch(() => { for (const [c, v] of back) if (!cellGone(c)) cells.write(c, v); });
      random.set(snap.state ? snap.state.random : []);
      // From the segment's first event: what main asked before it is
      // in the cells already.
      const first = before(evs, snap.at);
      // A handler's failure is taken back on the page (cells.ts attempt),
      // so the replay's own is kept here and said after.
      let wrong: unknown = null;
      const from = replaying(log.slice(evs[first]?.at ?? log.length).filter((e) => !isEvent(e)), browser) as unknown as Record<string, (...a: unknown[]) => unknown>;
      set(true, Object.fromEntries(Object.entries(from).map(([op, f]) => [op, typeof f !== "function" ? f : (...a: unknown[]) => { try { return f(...a); } catch (e) { wrong ??= e; throw e; } }])) as unknown as World);
      for (const e of evs.slice(first, n)) {
        if (!replayEvent(root, e.name, e.path, e.given)) throw new WentAnotherWay(`stepping went another way at entry ${e.at + 1}: the page has no ${e.name} handler where the log's event was given`);
        if (wrong) throw wrong;
      }
      // Shown: what the views read from now on (the clock's frames) the
      // page answers live, as while the cells were put back.
      set(true, browser);
      s.at = n;
    },
    resume() {
      if (s.at === null) return;
      const evs = [...eventsIn(log)], next = evs[s.at];
      if (next) {
        // A run of frames stepped into keeps the frames before.
        const e = log[next.at], k = evs.slice(0, s.at).filter((x) => x.at === next.at).length;
        if (e.op === "frames" && k > 0) { e.seconds!.length = k; log.length = next.at + 1; }
        else log.length = next.at;
        w.snapshots = w.snapshots.filter((x) => x.at === 0 || x.at < log.length);
      }
      s.at = null;
      set(false);
    },
  };
  return s;
}

// The logged events given again, in order (C172g). One whose element
// isn't there any more stops the replay, saying which.
export function replayEvents(root: Node_, log: LogEntry[]): void {
  for (const e of eventsIn(log)) {
    if (!replayEvent(root, e.name, e.path, e.given)) throw new WentAnotherWay(`the replay went another way at entry ${e.at + 1}: the page has no ${e.name} handler where the log's event was given`);
  }
}

// A page as one HTML file around its scripts: what `ters build-web` writes,
// and what the editor's "Save page" gives you. Nothing is loaded from
// anywhere else.
export function pageShell(title: string, ...scripts: string[]): string {
  return pageDocument(title, "", ...scripts);
}

// What a page looks like before its own style (page-base.ts).
export { PAGE_BASE } from "./page-base.ts";
import { PAGE_BASE } from "./page-base.ts";

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

