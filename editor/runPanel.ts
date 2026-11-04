// Run main (split out of main.ts, E228i): in a worker (editor/runWorker.ts),
// with what an example is given on the command line, the effects a program
// from a file must be allowed first, and the compiled main kept for the
// next run of the same code. What it reads of the editor comes through
// `RunHost`.
import type { LogEntry } from "../ters/src/lang/worldlog.ts";
import manifest from "./examples.json" with { type: "json" };
import FILES from "examples:files";
import type { Code, Id } from "../ters/src/model.ts";
import type { Presentation } from "../ters/src/presentation.ts";
import type { Namer } from "../ters/src/render/namer.ts";
import { FILES as FILES_EFFECT, NETWORK } from "../ters/src/lang/types.ts";
import { IO } from "../ters/src/lang/std.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import type * as T from "./typed.ts";
import { h } from "./dom.ts";
import { newWorker } from "./runViews.ts";
import type { Compiled, RunAsk, RunSays } from "./runWorker.ts";
import type { Doc, UI } from "./main.ts";

export interface RunHost {
  doc(): Doc;
  ui: UI;
  // The program as it runs (the open one with its drafts joined).
  prog(): Code;
  pres(): Presentation;
  typesOf(): T.Info | null;
  titleOf(d: Doc): string;
  render(): void;
  defNamed(name: string): Id | undefined;
  // The signatures the run checks against.
  pins(): Pins;
}

export function runPanel(host: RunHost) {
  const { doc, ui, prog, pres, typesOf, titleOf, render, defNamed, pins } = host;
  // Run main in a worker (editor/runWorker.ts): the page keeps drawing, the
  // printing shows as it comes, and Stop ends it.
  let running: Worker | null = null;
  function stopRun(why?: string) {
    running?.terminate();
    running = null;
    if (ui.output?.running) { ui.output = { ...ui.output, running: false, error: why ?? ui.output.error }; render(); }
  }
  // What `lab run` would be given for an example whose main reads the
  // command line (examples.json "run", E212): its arguments, and its files,
  // shipped beside it. Only for main as the example has it: a program of
  // one's own, or main taking other inputs, gets none.
  function runGiven(): { args: string[]; files: Record<string, string> } | null {
    const m = manifest.programs.find((p) => p.program === doc().program && p.editor !== false);
    if (!m?.run || doc().title || ui.def !== defNamed("main")) return null;
    return { args: m.run.args, files: m.folders?.[0] ? FILES(m.folders[0]).data ?? {} : {} };
  }
  // main as compiled by its last run, and the code it was compiled from.
  let compiledFor: { code: Code; def: Id; args?: string[]; compiled: Compiled } | null = null;
  // The world effects Run asks about for a program opened from a file
  // (E229): what it can reach outside the page. Console only prints here,
  // and Random and Time read nothing of yours.
  const ASKED_EFFECTS: [Id, string][] = [[NETWORK, "reads web pages and other addresses on the internet"], [FILES_EFFECT, "reads and writes its files, kept in this browser"]];
  function permissionsAsked(def: Id): Id[] {
    if (!doc().opened) return [];
    const info = typesOf(), t = info?.typeOf.get(def);
    const z = t && info ? info.subst.zonk(t) : null;
    const effs = z?.t === "fn" ? z.eff.effs : [];
    return ASKED_EFFECTS.map(([e]) => e).filter((e) => effs.includes(e));
  }
  function permissionsPanel(namer: Namer, effs: Id[]): HTMLElement {
    const names = pres().names;
    return h("div", { class: "allow" },
      h("p", { class: "hint" }, `${titleOf(doc())} came from a file. Before ${namer.name(ui.def)} runs, say what it may do; what you don't allow fails with a reason when the program tries it.`),
      ...ASKED_EFFECTS.filter(([e]) => effs.includes(e)).map(([e, what]) => h("label", { class: "field check" },
        h("input", { type: "checkbox", "data-allow": e, ...(doc().allowed?.includes(e) ? { checked: "" } : {}) }), h("span", {}, `${names[e] ?? e}: ${what}`))),
      h("div", { class: "acts" }, h("button", { class: "btn", type: "button", "data-act": "t-allow-run" }, `Run ${namer.name(ui.def)}`)));
  }
  // Does the program read standard input (calc's sums)? Run gives it what
  // is typed in a box, as lab run gives it a pipe (I168).
  const reading = new WeakMap<Code, boolean>();
  function readsInput(): boolean {
    const code = doc().code;
    let r = reading.get(code);
    if (r === undefined) reading.set(code, (r = Object.values(code.nodes).some((n) => n.kind === "ref" && (n.target === IO.readInput || n.target === IO.readLine) && !LIBRARY.code.nodes[n.id])));
    return r;
  }
  function stdinBox(): HTMLElement {
    const ta = h("textarea", { id: "t-stdin", rows: "3", spellcheck: "false", "aria-label": "Standard input" }) as HTMLTextAreaElement;
    ta.value = ui.stdin?.[doc().program] ?? "";
    ta.addEventListener("input", () => { ui.stdin = { ...ui.stdin, [doc().program]: ta.value }; });
    return h("label", { class: "field stdin" }, h("span", {}, "Standard input"), ta);
  }

  // `replay`: a run's log of the world's answers (E232b): the run answered
  // from it alone, its writes checked against it, so it does the same
  // again, or says where an edited program went another way.
  // `until`: only that many answers, then pause, to see where the run was
  // (E232c).
  function runTyped(replay?: LogEntry[], until?: number) {
    stopRun();
    const def = ui.def, title = titleOf(doc()), prefix = `lab:${title}:`;
    const files: [string, string][] = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix)) files.push([k, localStorage.getItem(k)!]); } } catch { /* no storage */ }
    // An example's own files (budget.txt…) are there until a run writes one
    // of the same name (E212).
    const given = runGiven();
    if (given) for (const [name, text] of Object.entries(given.files)) if (!files.some(([k]) => k === prefix + name)) files.push([prefix + name, text]);
    const w = (running = newWorker());
    const code = prog(), same = compiledFor && compiledFor.code === code && compiledFor.def === def && JSON.stringify(compiledFor.args) === JSON.stringify(given?.args);
    // A program from a file runs with only what was allowed (E229).
    const asked = permissionsAsked(def), deny = asked.filter((e) => !doc().allowed?.includes(e));
    const stdin = readsInput() ? ui.stdin?.[doc().program] ?? "" : undefined;
    const ask: RunAsk = { code, names: pres().names, pins: pins(), def, title, files, args: given?.args, ...(same ? { compiled: compiledFor!.compiled } : {}), ...(deny.length ? { deny } : {}), ...(stdin !== undefined && !replay ? { stdin } : {}), ...(replay ? { replay, ...(until !== undefined ? { until } : {}) } : {}) };
    ui.output = { def, lines: [], running: true };
    w.onmessage = (e: MessageEvent<RunSays>) => {
      if (running !== w || !ui.output) return;
      const m = e.data;
      if ("lines" in m) { ui.output = { ...ui.output, lines: [...ui.output.lines, ...m.lines] }; render(); return; }
      try { for (const [k, v] of m.files) localStorage.setItem(k, v); } catch { /* no storage */ }
      const lines = "done" in m && m.shown !== "unit" ? [...ui.output.lines, `→ ${m.shown}`] : ui.output.lines;
      ui.output = { def, lines, error: "error" in m ? m.error : undefined, running: false, ...(m.stuck ? { stuck: m.stuck } : {}), ...("profile" in m && m.profile?.length ? { profile: m.profile } : {}), ...(m.compiled || m.core ? { compiled: true } : {}), ...(replay ? { answers: replay, replayed: true } : m.answers?.length ? { answers: m.answers } : {}), ...(m.paused ? { paused: until, error: undefined } : {}) };
      // The compiled main is kept for the next run of this same code (E238).
      compiledFor = m.compiled ? { code: ask.code, def, args: ask.args, compiled: m.compiled } : null;
      running = null;
      w.terminate();
      render();
    };
    w.onerror = (e) => { e.preventDefault(); stopRun(e.message || "the run failed"); };
    w.postMessage(ask);
    render();
  }

  // Ends a run without a word: opening another program.
  const endRun = () => { running?.terminate(); running = null; };
  return { stopRun, endRun, runGiven, permissionsAsked, permissionsPanel, runTyped, readsInput, stdinBox };
}
