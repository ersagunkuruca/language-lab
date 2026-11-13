// A page from JavaScript printed from the core IR (C137c9, `ters build-web
// --core`): the evaluator's cells and mount (html.ts) and the browser's
// world (browser.ts), as page-runtime.ts gives compile.ts's pages, with
// the printed functions called as core-js.ts calls them.

import { equal, type Value } from "../../ters/src/lang/run.ts";
import { Cells, handOver, nodeOf } from "../../ters/src/lang/cells.ts";
import { browserWorld, pageStorage, type Store } from "../../ters/src/lang/browser.ts";
import { mountHtml, type Doc, type Node_ } from "../../ters/src/lang/html.ts";
import { recordingWorld, soundPlayer } from "../../ters/src/lang/audio-page.ts";
import { coreCall, coreRuntime, type HostOps, type TableSpec } from "./core-rt.ts";
import { pageWorker } from "./branches-rt.ts";
import type { Hosts } from "../../ters/src/lang/hosts.ts";
import type { Code } from "../../ters/src/model.ts";
import { budget, heardInto, logged, LogWindow, type LogEntry, type PlacedSnapshot } from "../../ters/src/lang/worldlog.ts";

type Defs = Record<string, (...xs: unknown[]) => unknown>;

// `defs` makes the printed functions from the runtime; `main` is the
// page's, by its printed name; `program` names the page's files in
// localStorage (browser.ts); `code`, the program's nodes when a solve
// needs them; `worklet`, a page with sound's audio thread script
// (core-sound.ts), which plays its `listen` nodes (C137d4).
// `hosts`: its hosts/js.js's answers and the operations they answer.
export function startCorePage(tables: TableSpec[], worlds: string[], defs: (R: ReturnType<typeof coreRuntime>) => Defs, main: string, program: string, code?: Code, worklet?: string, hosts?: { answers: Hosts; ops: HostOps }): void {
  // A worker the page started for its maps (C61 c′, branches-rt.ts): the
  // functions made, answering the runs it is sent, and no page drawn.
  if (typeof document === "undefined") {
    defs(coreRuntime(tables, worlds, { print: (line: string) => console.log(line) }, code, undefined, hosts?.ops));
    pageWorker();
    return;
  }
  const cells = new Cells(equal);
  // What main is answered is kept for the audio thread's run of it (L60).
  // The run's log (C172f), as the editor's preview keeps it (C172e), when
  // the page is opened with ?ters-log: in globalThis.tersLog, which the
  // console can copy out (copy(JSON.stringify(tersLog))).
  const log = typeof location !== "undefined" && /[?&]ters-log(?:[=&]|$)/.test(location.search) ? ((globalThis as { tersLog?: LogEntry[] }).tersLog = []) : undefined;
  if (log) console.info("ters: this run's log is in tersLog; copy(JSON.stringify(tersLog)) copies it");
  const browser = browserWorld(pageStorage(), program, console, { cells, frame: (f) => requestAnimationFrame(f) });
  // Its events and answers up to MAIN_LOG_CAP, then the log says it
  // stopped (I239d): a compiled page's log is for the evaluator to replay
  // from the start, so it is capped rather than kept as a window.
  const cap = budget();
  const world = recordingWorld(log ? logged(browser, log, { seeded: true, budget: cap }).world : browser);
  // A handler run that's taken back prints nothing (cells.ts attempt).
  const rt = { print: (line: string) => cells.later(() => console.log(line)), world, cells, hosts: hosts?.answers };
  const fns = defs(coreRuntime(tables, worlds, rt, code, undefined, hosts?.ops));
  const doc = document as unknown as Doc & { body: { append(n: Node_): void } };
  const run = () => fns[main]() as Value;
  const sound = worklet ? soundPlayer(cells, worklet, run, undefined, world) : null;
  doc.body.append(mountHtml((sound ? sound.page : run()) as never, { cells, doc, call: coreCall, listen: sound?.listen, heard: log && heardInto(log, undefined, cap) }));
}

// The same page mounted where the caller says (E244): the editor's
// preview, which swaps the compiled page in for the interpreted one and
// hands over what was done on it (cells.ts handOver), as page-runtime.ts
// mountPage does for compile.ts's. `kept` is the cells made while main ran,
// in order; `stop` ends its frames. `handFrom`: the interpreted page's
// cells, what was done on it handed over (cells.ts handOver). Given a `window`, its log is kept as
// one (I239f, WORLD-LOG-WINDOW.md §2), each snapshot its cells' values in
// the order they were made (as handOver carries them) and the
// generator's state, so the interpreted page can be built at a snapshot
// and stepped from there (page.ts showPage `stepFrom`).
export function mountCorePage(tables: TableSpec[], worlds: string[], defs: (R: ReturnType<typeof coreRuntime>) => Defs, main: string, program: string, code: Code | undefined, o: { doc: Doc; store: Store; frame: (f: () => void) => void; ran?: (el: Node_) => void; stopped?: (e: unknown) => void; log?: LogEntry[]; window?: { seconds: number; keep: number; clock?: () => number }; handFrom?: NonNullable<Cells["kept"]> }): { root: Node_; cells: Cells; kept: NonNullable<Cells["kept"]>; window?: LogWindow<PlacedSnapshot>; stop(): void } {
  let stopped = false;
  const cells = new Cells(equal);
  // The run's log (C172e), as page.ts showPage keeps it: as a window, or
  // capped (I239d).
  const browser = browserWorld(o.store, program, console, { cells, frame: (f) => { if (!stopped) o.frame(() => { if (!stopped) f(); }); } });
  const cap = o.window ? undefined : budget();
  const logging = o.log ? logged(browser, o.log, { seeded: true, budget: cap, quiet: () => stopped }) : null;
  const world = logging ? logging.world : browser;
  let made: NonNullable<Cells["kept"]> = [];
  // Where this page's part of the log starts: the interpreted page's comes before.
  const start = o.log?.length ?? 0;
  const window = o.log && o.window && logging ? new LogWindow<PlacedSnapshot>(o.log, () => ({ cells: made.map((k) => (nodeOf(k.cell)?.disposed ?? true) ? undefined : cells.peek(k.cell)), random: logging.random.state() }), o.window) : undefined;
  const rt = { print: (line: string) => cells.later(() => console.log(line)), world, cells };
  const fns = defs(coreRuntime(tables, worlds, rt, code));
  cells.kept = [];
  const heard = o.log && heardInto(o.log, window, cap);
  const root = mountHtml(fns[main]() as never, { cells, doc: o.doc, call: coreCall, ran: o.ran, stopped: o.stopped, heard: heard && ((...a: Parameters<typeof heard>) => { if (!stopped) heard(...a); }) });
  const kept = cells.kept;
  made = kept;
  cells.kept = null;
  if (o.handFrom) handOver(o.handFrom, kept, cells);
  // Its start as a snapshot too, as page.ts keeps it: the cells as handed
  // over, the generator as main left it.
  if (window) window.snapshots[0] = { at: start, state: window.take() };
  return { root, cells, kept, window, stop: () => { stopped = true; } };
}
