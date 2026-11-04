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
import { corePageRuntimeText, coreWorkletRuntimeText, newWorker, pageRuntimeText, workletRuntimeText } from "./runViews.ts";
import type { CompileAsk, CompileSays } from "./runWorker.ts";
import { drawPicture, pictureEntries, type Picture } from "./picture.ts";
import { handOver, type Cells } from "../ters/src/lang/cells.ts";
import { lowerCore, usesSolver } from "../compiler/src/core-js.ts";
import { PAGE_BASE, corePageFile, hasSound, pageFile, pageMain, showPage, type Preview } from "../ters/src/lang/page.ts";
import type { Doc as PageDoc, Node_ } from "../ters/src/lang/html.ts";

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
      else drawPicture({ code, info, names: pres().names, entries, canvas: pic.canvas, status: pic.status })
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
    for: null as Code | null, root: null as globalThis.Node | null, now: null as Preview | null, program: null as Program | null,
    flashBox: h("input", { type: "checkbox" }) as HTMLInputElement,
    // A page with sound: stop everything it plays, whatever its own buttons say.
    hushBtn: h("button", { class: "btn", type: "button", "data-act": "page-hush", title: "Stop every sound this page is playing" }, "Stop sound") as HTMLButtonElement,
  };
  const sized = new WeakSet<Document>();
  const pageBox = h("div", { class: "page-box" }, page.frame, page.status,
    h("div", { class: "acts" },
      page.hushBtn,
      h("button", { class: "btn", type: "button", "data-act": "page-restart", title: "Run main again from the start: every cell back to its first value" }, "Restart"),
      h("label", { class: "hint", title: "Outline each text, attribute or part of the page when it runs again, so you can see that only what read a changed cell does" }, page.flashBox, " Outline updates"),
      h("button", { class: "btn", type: "button", "data-act": "page-tab", title: "The page compiled to JavaScript, in a tab of its own" }, "Open in a tab"),
      h("button", { class: "btn", type: "button", "data-act": "page-save", title: "The page compiled to JavaScript as one HTML file that runs anywhere, like lab build-web" }, "Save page")));
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

  function startPage(info: T.Info, main: Id) {
    page.now?.stop();
    page.now = null;
    page.root = null;
    page.for = prog();
    page.program = doc().program;
    page.status.textContent = "";
    try {
      page.now = showPage({
        code: prog(), info, names: pres().names, main, program: titleOf(doc()),
        doc: page.maker as unknown as PageDoc, store: localStorage, worklet: workletRuntimeText(), recordings: "apps/",
        frame: (f) => requestAnimationFrame(f), ran: flashRan, keepCells: true,
      });
      page.root = page.now.root as unknown as globalThis.Node;
    } catch (e) {
      page.status.textContent = `The page stopped: ${e instanceof Error ? e.message : String(e)}.`;
      return;
    }
    compilePage(main);
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
  const compiledPages = new WeakMap<Code, { program: string; core?: true } | null>(); // null: it didn't compile
  let compiling: Worker | null = null;
  function compilePage(main: Id) {
    compiling?.terminate();
    compiling = null;
    const code = prog();
    if (!page.now) return;
    if (page.now.hush || hasSound(code)) { page.status.textContent = "Interpreted: a page with sound plays from the interpreter in the editor, so it can be slower here. Open in a tab runs it compiled."; return; }
    const made = compiledPages.get(code);
    if (made !== undefined) { if (made) swapCompiled(code, made, main); return; }
    page.status.textContent = "Interpreted while the page compiles; the compiled page takes over in a few seconds, keeping what you do on it.";
    const w = (compiling = newWorker());
    const done = (m: CompileSays) => {
      w.terminate();
      if (compiling !== w) return;
      compiling = null;
      compiledPages.set(code, "program" in m ? m : null);
      if (page.for !== code) return;
      if ("program" in m) swapCompiled(code, m, main);
      else page.status.textContent = `Interpreted: the page couldn't be compiled (${m.error}).`;
    };
    w.onmessage = (e: MessageEvent<CompileSays>) => done(e.data);
    w.onerror = (e) => { e.preventDefault(); done({ error: e.message || "the compiler failed" }); };
    const ask: CompileAsk = { compilePage: true, code, names: pres().names, pins: pins(), main, core: !!corePageRuntimeText() };
    w.postMessage(ask);
  }
  // The compiled program and a fresh copy of the page runtime (cli/web.ts
  // pageRuntime) evaluated here, so the page's elements are made in the
  // same document as the interpreted page's and go into the frame the same way.
  // One printed from the core IR (E244) runs on a fresh copy of its runtime
  // (cli/web.ts corePageRuntime): its script's call of startCorePage is
  // caught, and what it was given mounted here (core-page.ts mountCorePage).
  type Mounted = { root: Node_; cells: Pick<Cells, "write" | "batch">; kept: NonNullable<Cells["kept"]>; stop(): void };
  function swapCompiled(code: Code, made: { program: string; core?: true }, main: Id) {
    type Lab = { mountPage(main: unknown, program: string, o: object): Mounted };
    type Core = { mountCorePage(...a: unknown[]): Mounted };
    let m;
    try {
      const o = { doc: page.maker, store: localStorage, frame: (f: () => void) => requestAnimationFrame(f), ran: flashRan };
      if (made.core) {
        const core = new Function(`${corePageRuntimeText()}\nreturn $core;`)() as Core & Record<string, unknown>;
        let given: unknown[] | null = null;
        new Function("$core", made.program)({ ...core, startCorePage: (...a: unknown[]) => { given = a; } });
        if (!given) throw new Error("the core IR's script started no page");
        const [tables, worlds, defs, name, , nodes] = given as unknown[];
        m = core.mountCorePage(tables, worlds, defs, name, titleOf(doc()), nodes, o);
      } else {
        const lab = new Function(`${pageRuntimeText()}\nreturn $lab;`)() as Lab;
        const defs = new Function("$lab", `${made.program}\nreturn defs;`)(lab) as Record<string, unknown>;
        m = lab.mountPage(defs[pres().names[main]], titleOf(doc()), o);
      }
      if (page.now?.kept) handOver(page.now.kept, m.kept, m.cells);
    } catch (e) {
      m?.stop();
      compiledPages.set(code, null);
      page.status.textContent = `Interpreted: the compiled page stopped (${e instanceof Error ? e.message : String(e)}).`;
      return;
    }
    const old = page.root;
    page.now?.stop();
    page.now = { root: m.root, cells: null as never, stop: m.stop };
    page.root = m.root as unknown as globalThis.Node;
    if (old?.parentNode) (old as ChildNode).replaceWith(page.root);
    page.status.textContent = "";
  }

  // The page compiled, saved or opened in a tab: printed from the core IR
  // (page.ts corePageFile, E244), as lab build-web does, or from compile.ts
  // (pageFile) where main doesn't lower there. `via` says which.
  function pageHtml(): { html: string; name: string; via: string } | null {
    const info = typesOf();
    const main = info && pageMain(ownDefs(), info, pres().names);
    if (!info || !main) return null;
    const title = titleOf(doc()), name = `${slug(title)}.html`;
    let core = corePageRuntimeText();
    let why = "this editor has no core IR runtime";
    // A sound that solves would run the evaluator's solver for every block
    // on the core IR, too slow for the audio thread: compile.ts's, as lab
    // build-web does (C137d7).
    if (core && hasSound(prog())) { try { if (usesSolver(lowerCore(prog(), info, pres().names, ownDefs()))) { why = "its sound solves, which the core IR does too slowly for the audio thread"; core = ""; } } catch { /* corePageFile says why */ } }
    if (core) {
      try { return { html: corePageFile(title, core, prog(), info, pres().names, ownDefs(), main, coreWorkletRuntimeText()), name, via: "" }; } catch (e) { why = (e as Error).message; }
    }
    return { html: pageFile(title, pageRuntimeText(), prog(), info, pres().names, main, workletRuntimeText()), name, via: ` through compile.ts (${why})` };
  }

  function savePage(open: boolean) {
    let made;
    try { made = pageHtml(); } catch (e) { ui.note = `The page couldn't be compiled: ${(e as Error).message}.`; ui.refused = true; render(); return; }
    if (!made) return;
    const url = URL.createObjectURL(new Blob([made.html], { type: "text/html" }));
    if (open) {
      window.open(url, "_blank");
      if (made.via) { ui.note = `Opened the page compiled to JavaScript${made.via}.`; render(); }
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = made.name;
      a.click();
      ui.note = `Saved the page as ${made.name}: one HTML file with the program compiled to JavaScript${made.via}. Open it in any browser, or put it on any web host.`;
      render();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return { page, pageSection, pictureSection, savePage };
}
