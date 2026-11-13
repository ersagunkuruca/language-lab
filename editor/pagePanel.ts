// The picture and the page a program shows above Run (split out of
// main.ts, E228e): a picture is drawn live on the GPU (editor/picture.ts),
// a page runs in a frame (page.ts), and both go on across renders. What
// they read of the editor comes through `PageHost`.
import type { Code, Id } from "../ters/src/model.ts";
import type { Presentation } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import type * as T from "./typed.ts";
import type { Doc, Program, UI } from "./main.ts";
import { h } from "./dom.ts";
import { corePageRuntimeText, coreWorkletRuntimeText, newWorker } from "./runViews.ts";
import type { CompileAsk, CompileSays } from "./runWorker.ts";
import { drawPicture, pictureEntries, type Picture } from "./picture.ts";
import { drawDrawable, drawableOf, type Built } from "./pictureDraw.ts";
import type { Cells } from "../ters/src/lang/cells.ts";
import { prebuilt, prebuiltKey } from "./prebuilt.ts";
import type { CompiledPage } from "./pageCompile.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { checkedForRun } from "./coreMain.ts";
import { PAGE_BASE, corePageFile, hasSound, pageMain, showPage, type Preview } from "../ters/src/lang/page.ts";
import type { Doc as PageDoc, Node_ } from "../ters/src/lang/html.ts";
import { eventsIn, isEvent, type LogEntry, type LogWindow, type PlacedSnapshot } from "../ters/src/lang/worldlog.ts";
// The page's log kept as a window (I239b): a snapshot every 10 seconds, the
// last 30 (about five minutes) kept, interpreted or compiled.
const LOG_WINDOW = { seconds: 10, keep: 30 };

export interface PageHost {
  doc(): Doc;
  prog(): Code;
  pres(): Presentation;
  ownDefs(): Id[];
  typesOf(): T.Info | null;
  render(): void;
  ui: UI;
  errorsIn(info: T.Info): number;
  holesIn(info: T.Info): number;
  noteOf(d: Doc): string;
  noteView(text: string): HTMLElement | null;
  titleOf(d: Doc): string;
  slug(s: string): string;
  // The signatures the page is compiled with: those held, or the program's.
  pins(): Pins;
}

export function pagePanels(host: PageHost) {
  const { doc, prog, pres, ownDefs, typesOf, render, ui, errorsIn, holesIn, noteOf, noteView, titleOf, slug, pins } = host;
  // A program with a colour, or a red, green and blue, of (x, y, time) is a
  // picture (editor/picture.ts): drawn live on the GPU above Run, and drawn
  // again after every edit. When the compiler can't take it to the GPU, its
  // reason shows instead. The canvas outlives renders, so the drawing goes on.
  const pic = { canvas: h("canvas", { class: "picture", role: "img", "aria-label": "The program's picture, drawn live" }) as HTMLCanvasElement, status: h("p", { class: "hint pic-status", role: "status" }), for: null as Code | null, now: null as Picture | null };
  const picNote = h("div", {});
  const picBox = h("div", { class: "picture-box" }, picNote, pic.canvas, pic.status);
  function pictureSection(info: T.Info | null): HTMLElement | null {
    const entries = pictureEntries(ownDefs(), pres().names);
    if (!entries || !info) { pic.now?.stop(); pic.now = null; pic.for = null; return null; }
    picNote.replaceChildren(noteView(noteOf(doc())) ?? "");
    if (pic.for !== prog()) {
      const code = pic.for = prog();
      pic.now?.stop();
      pic.now = null;
      pic.canvas.hidden = false;
      pic.status.textContent = "Drawing…";
      const shown = (e: unknown) => { pic.canvas.hidden = true; pic.status.textContent = `Can't draw the picture: ${e instanceof Error ? e.message : String(e)}.`; };
      if (errorsIn(info)) shown(new Error("the program has errors; fix them first"));
      // As shipped, the picture was compiled when the site was built
      // (prebuilt.ts, E245): drawn from that, with no compiling here.
      else prebuilt<Built>(prebuiltKey("picture", code, entries, pins()))
        .then((built) => (pic.for !== code ? Promise.reject(new Error("redrawn")) : built ? drawDrawable(drawableOf(built), { canvas: pic.canvas, status: pic.status })
          : drawPicture({ code, info, names: pres().names, entries, canvas: pic.canvas, status: pic.status })))
        .then((p) => { if (pic.for === code) pic.now = p; else p.stop(); },
          (e) => { if (pic.for === code) shown(holesIn(info) ? new Error("the program has holes; fill them first") : e); });
    }
    return picBox;
  }

  // A program whose main takes nothing and returns an Html is a page
  // (WEB.md): shown live above Run, run by the evaluator, and run again from
  // the start after every edit. Its own <style> and its body rules need a
  // document of their own, so it's drawn in a frame. The editor redraws
  // everything on each change, which empties a frame put back in the page, so
  // the page's elements are made in a document that outlives renders and are
  // put back into the frame each time; their listeners and watchers go with
  // them, and what you typed into the page stays.
  const page = {
    frame: h("iframe", { class: "page", title: "The page main returns, running" }) as HTMLIFrameElement,
    status: h("p", { class: "hint", role: "status" }),
    // Where the page's elements are made (adopted into the frame's document).
    maker: document.implementation.createHTMLDocument("page"),
    // What the page was started with, to build the interpreted page again.
    started: null as { info: T.Info; main: Id } | null,
    for: null as Code | null, root: null as globalThis.Node | null, now: null as Preview | null, program: null as Program | null,
    // This run's log (C172e): the world's answers and the events its
    // handlers were given, in order, from the interpreted page and then
    // the compiled one that takes over.
    log: [] as LogEntry[],
    flashBox: h("input", { type: "checkbox" }) as HTMLInputElement,
    // A page with sound: stop everything it plays, whatever its own buttons say.
    hushBtn: h("button", { class: "btn", type: "button", "data-act": "page-hush", title: "Stop every sound this page is playing" }, "Stop sound") as HTMLButtonElement,
  };
  const sized = new WeakSet<Document>();
  // Stepping through the page's log (I239e, WORLD-LOG-WINDOW.md §3).
  const stepsBox = h("div", { class: "page-steps" });
  const pageBox = h("div", { class: "page-box" }, page.frame, page.status, stepsBox,
    h("div", { class: "acts" },
      page.hushBtn,
      h("button", { class: "btn", type: "button", "data-act": "page-restart", title: "Run main again from the start: every cell back to its first value" }, "Restart"),
      h("label", { class: "hint", title: "Outline each text, attribute or part of the page when it runs again, so you can see that only what read a changed cell does" }, page.flashBox, " Outline updates"),
      h("button", { class: "btn", type: "button", "data-act": "page-tab", title: "The page compiled to JavaScript, in a tab of its own" }, "Open in a tab"),
      h("button", { class: "btn", type: "button", "data-act": "page-save", title: "The page compiled to JavaScript as one HTML file that runs anywhere, like ters build-web" }, "Save page"),
      h("button", { class: "btn", type: "button", "data-act": "page-log", title: "This run's log as a JSON file: every event the page's handlers were given and every answer of the world, in order" }, "Save run log")));
  // The program version a page will run for once the edit has drawn.
  let pageSoon: Code | null = null;
  function pageSection(info: T.Info | null): HTMLElement | null {
    const main = info && !errorsIn(info) && !holesIn(info) ? pageMain(ownDefs(), info, pres().names) : null;
    if (!main || !info) { leavePage(); return null; }
    if (page.for !== prog() && page.program === doc().program && !keptPages.has(doc().program)) {
      // An edit to the page's program: the edit draws first and the page runs
      // again just after, so the page's run (2 s in Spacetime) doesn't hold
      // the edit back. Till then the page as it was stays.
      const want = prog();
      if (pageSoon !== want) {
        pageSoon = want;
        const go = () => {
          if (pageSoon !== want) return;
          pageSoon = null;
          if (prog() !== want || page.for === want) return;
          leavePage();
          startPage(info, main);
          render();
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(go, 0)); else setTimeout(go, 0);
      }
    } else if (page.for !== prog()) {
      leavePage();
      const kept = keptPages.get(doc().program);
      keptPages.delete(doc().program);
      if (kept?.for === prog()) Object.assign(page, kept, { program: doc().program });
      else { kept?.now?.stop(); startPage(info, main); }
    }
    // Chrome drops every event listener in a frame's document when the frame
    // leaves the page, and this redraw takes the frame out and puts it back.
    // So the page goes back to the document that outlives renders first: its
    // buttons keep their handlers.
    if (page.root && page.root.ownerDocument !== page.maker) page.maker.body.append(page.maker.adoptNode(page.root));
    page.hushBtn.hidden = !page.now?.hush;
    drawSteps();
    // Put back in the frame once the frame is in the page again.
    queueMicrotask(() => {
      const d = page.frame.contentDocument;
      if (!d || !page.root || d.body.contains(page.root)) return;
      // The look a saved page has (page.ts PAGE_BASE), and a frame as tall
      // as the page, up to most of the window; past that it scrolls.
      if (!d.getElementById("lab-base")) d.head.append(Object.assign(d.createElement("style"), { id: "lab-base", textContent: PAGE_BASE }));
      d.body.replaceChildren(page.root);
      if (!sized.has(d)) {
        sized.add(d);
        // What's done on the page is said in the status bar too, as an edit
        // is. Only the bar's text changes: the page is left as it is.
        const say = (note: string) => {
          ui.note = note;
          ui.touched = [];
          ui.refused = false;
          const bar = document.querySelector<HTMLElement>(".status[role=status]");
          if (bar) { bar.textContent = ui.note; bar.className = "status"; }
        };
        d.addEventListener("click", (e) => {
          const b = (e.target as Element).closest?.("button, a, input[type=checkbox]");
          const label = b?.textContent?.trim() || b?.getAttribute("aria-label");
          if (!label) return;
          say(`Clicked “${label}” on the page.`);
        });
        // And what's typed or set in a field, once it's in (Enter, leaving
        // the field, letting go of a slider).
        d.addEventListener("change", (e) => {
          const f = e.target as HTMLInputElement;
          if (!f.matches?.("input:not([type=checkbox]):not([type=button]), textarea, select")) return;
          const name = f.labels?.[0]?.textContent?.trim() || f.getAttribute("aria-label") || f.placeholder || f.name;
          const what = f.value === "" ? "Emptied" : f.type === "range" || f.tagName === "SELECT" ? `Set ${f.value} in` : `Typed ${f.value} in`;
          say(`${what} ${name ? `“${name}”` : "a field"} on the page.`);
        });
        new ResizeObserver(() => { page.frame.style.height = `${Math.min(Math.max(Math.ceil(d.body.getBoundingClientRect().bottom) + 2, 120), Math.round(innerHeight * 0.7))}px`; }).observe(d.body);
      }
    });
    return pageBox;
  }

  // A page goes on while another program is shown, so coming back finds it
  // as it was: its cells, what was typed. An edit to its program starts it
  // again, as before.
  const keptPages = new Map<Program, { for: Code; root: globalThis.Node | null; now: Preview | null }>();
  function leavePage() {
    if (page.for && page.program && page.program !== doc().program) {
      // A page left for another program goes on, but silent: nothing plays
      // from a page that isn't shown.
      page.now?.hush?.();
      // Out of the frame before the frame goes, so its buttons keep their handlers.
      if (page.root && page.root.ownerDocument !== page.maker) page.maker.body.append(page.maker.adoptNode(page.root));
      keptPages.get(page.program)?.now?.stop();
      keptPages.set(page.program, { for: page.for, root: page.root, now: page.now });
    } else page.now?.stop();
    page.now = null;
    page.root = null;
    page.for = null;
  }

  // The interpreted page, with its log kept as a window: the last five
  // minutes or so, from snapshots ten seconds apart (I239b,
  // WORLD-LOG-WINDOW.md), so a page open for an hour keeps no more. With
  // `stepFrom`, built from the compiled page's snapshots and stepped at
  // the log's last event (I239f).
  function interpreted(info: T.Info, main: Id, stepFrom?: ReturnType<NonNullable<Preview["stepFrom"]>>): Preview {
    return showPage({
      log: page.log, window: LOG_WINDOW, stepFrom,
      code: prog(), info, names: pres().names, main, program: titleOf(doc()),
      doc: page.maker as unknown as PageDoc, store: localStorage, worklet: coreWorkletRuntimeText(), recordings: "apps/",
      frame: (f) => requestAnimationFrame(f), ran: flashRan, keepCells: true, stopped: (e) => sayStopped("A handler stopped", e),
    });
  }
  function startPage(info: T.Info, main: Id) {
    page.now?.stop();
    page.now = null;
    page.root = null;
    page.for = prog();
    page.program = doc().program;
    page.status.textContent = "";
    page.log = [];
    page.started = { info, main };
    try {
      page.now = interpreted(info, main);
      page.root = page.now.root as unknown as globalThis.Node;
    } catch (e) {
      sayStopped("The page stopped", e);
      return;
    }
    compilePage(main);
  }
  // A stop said under the page: why, and where when the compiled page
  // knows (C143: its stops carry the node and its definition), as Run's
  // panel offers for main (C143f).
  function sayStopped(what: string, e: unknown) {
    const at = e && typeof e === "object" ? e as { node?: unknown; def?: unknown; reason?: unknown } : {};
    const why = e instanceof Error ? e.message : at.reason !== undefined ? `aborted: ${String(at.reason)}` : String(e);
    page.status.replaceChildren(`${what}: ${why}.`);
    if (typeof at.node === "string" && typeof at.def === "string" && doc().code.nodes[at.def])
      page.status.append(" ", h("button", { class: "btn mini", type: "button", "data-act": "goto-stop", "data-def": at.def, "data-target": at.node }, "Show where it stopped"));
  }
  // Each time a part of the page runs again, outlined when "Outline updates" is on.
  function flashRan(n: Node_) {
    if (!page.flashBox.checked) return;
    const e = (n as unknown as globalThis.Node).nodeType === Node.ELEMENT_NODE ? n as unknown as HTMLElement : (n as unknown as globalThis.Node).parentElement;
    // A part's own element takes no space (display: contents): its children flash.
    for (const x of e?.tagName === "LAB-PART" ? [...e.children] as HTMLElement[] : e ? [e] : []) {
      x.style.outline = "2px solid #e8a33d";
      setTimeout(() => { x.style.outline = ""; }, 400);
    }
  }

  // The preview runs compiled, as "Open in a tab" does (I97). The evaluator
  // walks the program's tree on every step, which an animation feels: Bounce
  // drew 8 frames a second here and 60 in a tab. So the page shows at once,
  // interpreted, while the same program is compiled off the editor's thread
  // (runWorker.ts, a few seconds for a big one), and the compiled page takes
  // its place when it's ready. What was done on the page meanwhile goes
  // with it: the cells that changed are handed across (cells.ts handOver,
  // I109). Once per version of the program: Restart swaps it in at once. A
  // page with sound stays interpreted, since here its sound plays from the
  // evaluator's page (audio-page.ts), and the status line says so. Runs and inspection don't use the page, so they don't change.
  const compiledPages = new WeakMap<Code, CompiledPage | null>(); // null: it didn't compile
  let compiling: Worker | null = null;
  function compilePage(main: Id) {
    compiling?.terminate();
    compiling = null;
    asks++;
    const code = prog();
    if (!page.now || !corePageRuntimeText()) return;
    if (page.now.hush || hasSound(code)) { page.status.textContent = "Interpreted: a page with sound plays from the interpreter in the editor, so it can be slower here. Open in a tab runs it compiled."; return; }
    const made = compiledPages.get(code);
    if (made !== undefined) { if (made) swapCompiled(code, made); return; }
    page.status.textContent = "Interpreted while the page compiles; the compiled page takes over in a few seconds, keeping what you do on it.";
    // A shipped example as shipped was compiled when the site was built
    // (prebuilt.ts, E245): that program, then, and no compiling here.
    const asked = ++asks;
    void prebuilt<CompiledPage>(prebuiltKey("page", code, { main }, pins())).then((got) => {
      if (asked !== asks) return;
      if (!got) return compileHere(code, main);
      compiledPages.set(code, got);
      if (page.for === code) swapCompiled(code, got);
    });
  }
  let asks = 0;

  // Pause, step back and on, and go on from here: the interpreted page
  // shown as it was after the window's first n events (page.ts Steps,
  // I239c), from the snapshot nearest before. The window keeps about
  // five minutes; the compiled page keeps no snapshots yet, so while it
  // shows there's nothing to step by.
  let stepTimer = 0;
  function stepTo(n: number) {
    const steps = page.now?.steps;
    if (!steps) return;
    const was = steps.at;
    try { steps.to(Math.max(steps.from(), Math.min(n, steps.events()))); }
    catch (e) {
      // The replay went another way: back to the step it was at, or, from
      // a page going on, on again from its end, nothing dropped.
      sayStopped("Stepping stopped", e);
      try { if (was !== null) steps.to(was); else throw e; }
      catch { steps.at = steps.events(); steps.resume(); page.status.append(" The page goes on; Restart runs it afresh if it doesn't show what it did."); }
    }
    drawSteps();
  }
  // The compiled page keeps snapshots but doesn't step: the interpreted
  // page is built from them, stepped at the log's last event, in its place.
  function pauseCompiled() {
    const from = page.now?.stepFrom?.(), started = page.started;
    if (!from || !started) return;
    const old = page.root;
    page.now!.stop();
    try { page.now = interpreted(started.info, started.main, from); }
    catch (e) { sayStopped("Couldn't pause the page", e); page.now = null; page.root = null; page.for = null; render(); return; }
    page.root = page.now.root as unknown as globalThis.Node;
    if (old?.parentNode) (old as ChildNode).replaceWith(page.root);
    page.status.textContent = "";
    drawSteps();
  }
  // Whichever page shows when it's pressed.
  function pause() {
    const steps = page.now?.steps;
    if (steps) stepTo(steps.events()); else pauseCompiled();
  }
  function goOn() {
    page.now?.steps?.resume();
    page.status.textContent = "";
    drawSteps();
    // It goes on interpreted: the compiled page, handed these cells, starts
    // from its first ones (told to the Language lane); Restart runs it
    // compiled again.
    if (compiledPages.get(prog())) page.status.textContent = "Interpreted since it was paused, so it can be slower here; Restart runs it compiled again.";
  }
  // How far back the window reaches, in its snapshots' seconds.
  function reach(): string {
    const kept = page.now?.window?.snapshots.length ?? page.now?.stepFrom?.().snapshots.length ?? 1;
    const s = Math.max(1, kept) * LOG_WINDOW.seconds, most = LOG_WINDOW.keep * LOG_WINDOW.seconds;
    const say = (t: number) => (t >= 60 ? `${Math.round(t / 6) / 10} min` : `${t} s`);
    return s >= most ? `back about ${say(most)}, as far as the window keeps` : `back at most ${say(s)}`;
  }
  function drawSteps() {
    const steps = page.now?.steps;
    if (!page.root) { stepsBox.replaceChildren(); return; }
    const btn = (label: string, title: string, run: () => void, off?: string) => {
      const b = h("button", { class: "btn", type: "button", title: off ? `Can't: ${off}` : title, "aria-disabled": off ? "true" : undefined }, label);
      if (!off) b.addEventListener("click", run);
      return b;
    };
    if (!steps || steps.at === null) {
      const can = steps || page.now?.stepFrom;
      if (!can) { stepsBox.replaceChildren(btn("Pause", "", () => {}, "this page keeps no window of its log to step through")); return; }
      stepsBox.replaceChildren(
        btn("Pause", `Stop the page here, then step back and on through what it was given: ${reach()}`, pause),
        h("span", { class: "hint" }, `Steps ${reach()}.`));
      return;
    }
    const n = steps.events(), at = steps.at, from = steps.from();
    const log = page.now!.window!.log, evs = [...eventsIn(log)];
    const last = at > from ? evs[at - 1] : null;
    const slider = h("input", { type: "range", min: String(from), max: String(n), step: "1", value: String(at), "aria-label": "How many of the window's events the page has been given" }) as HTMLInputElement;
    slider.addEventListener("input", () => {
      cancelAnimationFrame(stepTimer);
      stepTimer = requestAnimationFrame(() => stepTo(Number(slider.value)));
    });
    stepsBox.replaceChildren(
      btn("◀ Back", "The page one event earlier", () => stepTo(at - 1), at > from ? undefined : "this is as far back as the window reaches"),
      slider,
      btn("On ▶", "The page one event later", () => stepTo(at + 1), at < n ? undefined : "this is the last event the page was given"),
      btn("Go on from here", "The page runs again from this moment; what it was given after it is dropped", goOn),
      h("span", { class: "hint" }, `Paused after ${at - from} of ${n - from} events${last ? ` (the last: ${last.name})` : ", as far back as the window reaches"}. The page hears nothing till it goes on.`));
  }
  function compileHere(code: Code, main: Id) {
    const w = (compiling = newWorker());
    const done = (m: CompileSays) => {
      w.terminate();
      if (compiling !== w) return;
      compiling = null;
      compiledPages.set(code, "program" in m ? m : null);
      if (page.for !== code) return;
      if ("program" in m) swapCompiled(code, m);
      else page.status.textContent = `Interpreted: the page couldn't be compiled (${m.error}).`;
    };
    w.onmessage = (e: MessageEvent<CompileSays>) => done(e.data);
    w.onerror = (e) => { e.preventDefault(); done({ error: e.message || "the compiler failed" }); };
    const ask: CompileAsk = { compilePage: true, code, names: pres().names, pins: pins(), main };
    w.postMessage(ask);
  }
  // The program printed from the core IR (E244) runs on a fresh copy of its
  // runtime (cli/web.ts corePageRuntime), evaluated here, so the page's
  // elements are made in the same document as the interpreted page's and go
  // into the frame the same way: its script's call of startCorePage is
  // caught, and what it was given mounted here (core-page.ts mountCorePage).
  type Mounted = { root: Node_; cells: Pick<Cells, "write" | "batch">; kept: NonNullable<Cells["kept"]>; window?: LogWindow<PlacedSnapshot>; stop(): void };
  function swapCompiled(code: Code, made: CompiledPage) {
    // Not while the page is stepped through: it takes over when the page
    // goes on (goOn).
    if (page.now?.steps?.at != null) return;
    type Core = { mountCorePage(...a: unknown[]): Mounted };
    let m;
    try {
      const o = { doc: page.maker, store: localStorage, frame: (f: () => void) => requestAnimationFrame(f), ran: flashRan, stopped: (e: unknown) => sayStopped("A handler of the compiled page stopped", e), log: page.log, window: LOG_WINDOW, handFrom: page.now?.kept ?? undefined };
      const core = new Function(`${corePageRuntimeText()}\nreturn $core;`)() as Core & Record<string, unknown>;
      let given: unknown[] | null = null;
      new Function("$core", made.program)({ ...core, startCorePage: (...a: unknown[]) => { given = a; } });
      if (!given) throw new Error("the core IR's script started no page");
      const [tables, worlds, defs, name, , nodes] = given as unknown[];
      m = core.mountCorePage(tables, worlds, defs, name, titleOf(doc()), nodes, o);
    } catch (e) {
      m?.stop();
      compiledPages.set(code, null);
      sayStopped("Interpreted: the compiled page stopped", e);
      return;
    }
    const old = page.root;
    page.now?.stop();
    // Its log a window too, which an interpreted page built at its last
    // event steps through (I239f, page.ts showPage stepFrom).
    const mounted = m;
    page.now = { root: m.root, cells: null as never, stop: m.stop, window: undefined, stepFrom: mounted.window && (() => ({ firsts: mounted.kept.map((k) => k.first), snapshots: mounted.window!.snapshots })) };
    page.root = m.root as unknown as globalThis.Node;
    if (old?.parentNode) (old as ChildNode).replaceWith(page.root);
    page.status.textContent = "";
    drawSteps();
  }

  // The page compiled, saved or opened in a tab: printed from the core IR
  // (page.ts corePageFile, E244), as ters build-web does. Throws with why
  // when main doesn't lower there.
  function pageHtml(): { html: string; name: string } | null {
    const info = typesOf();
    const main = info && pageMain(ownDefs(), info, pres().names);
    if (!info || !main) return null;
    const title = titleOf(doc()), name = `${slug(title)}.html`;
    const core = corePageRuntimeText();
    if (!core) throw new Error("this editor has no core IR runtime");
    // Stored as ters build-web stores it (C197): its lists and Maps chosen.
    const r = checkedForRun(prog(), pres().names, main);
    const own = r.code.defs.filter((d) => !LIBRARY.code.nodes[d]);
    return { html: corePageFile(title, core, r.code, r.info, r.names, own, main, coreWorkletRuntimeText()), name };
  }

  function savePage(open: boolean) {
    let made;
    try { made = pageHtml(); } catch (e) { ui.note = `The page couldn't be compiled: ${(e as Error).message}.`; ui.refused = true; render(); return; }
    if (!made) return;
    const url = URL.createObjectURL(new Blob([made.html], { type: "text/html" }));
    if (open) {
      window.open(url, "_blank");
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = made.name;
      a.click();
      ui.note = `Saved the page as ${made.name}: one HTML file with the program compiled to JavaScript. Open it in any browser, or put it on any web host.`;
      render();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  // The run's log, saved (C172e): what the page was given and what the
  // world answered it, for a replay to give it again.
  function saveLog() {
    const events = [...eventsIn(page.log)].length, answers = page.log.filter((x) => !isEvent(x) && !x.write).length;
    const url = URL.createObjectURL(new Blob([JSON.stringify(page.log, (_, v) => (v instanceof Uint8Array ? [...v] : v), 1)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(titleOf(doc()))}-run.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    const left = page.now?.window?.dropped ? " Its earlier part had left the log, which keeps the last five minutes: a replay of this file starts from the page as main draws it, so it may go another way." : "";
    ui.note = `Saved this run's log: ${events} event${events === 1 ? "" : "s"} the page's handlers were given and ${answers} answer${answers === 1 ? "" : "s"} of the world, in order.${left}`;
    render();
  }
  return { page, pageSection, pictureSection, savePage, saveLog };
}
