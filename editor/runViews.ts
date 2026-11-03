// What the editor runs in and shows about a run of main, split out of
// main.ts (E228b): the runtimes the build puts in the page (the worker that
// runs main, the page and sound runtimes) and the views of how a run ended.
import type { Code, Id } from "../ters/src/model.ts";
import type { Namer } from "../ters/src/render/namer.ts";
import type { Profile, Stuck } from "./runWorker.ts";
import { h } from "./dom.ts";

declare const PAGE_RUNTIME: string; // cli/web.ts pageRuntime, put in by editor/build.ts
declare const WORKLET_RUNTIME: string; // cli/web.ts workletRuntime: a page with sound plays (AUDIO.md)
declare const RUN_WORKER: string; // editor/runWorker.ts bundled, put in by editor/build.ts
// esbuild's define writes the text at every use, so each runtime is used
// once, here (E204): three uses of the worker carried its 3 MB three times.
// (Its blob's address kept on the function, which is there before any
// line of this file runs.)
export function newWorker(): Worker { const f = newWorker as { url?: string }; return new Worker(f.url ??= URL.createObjectURL(new Blob([runtimeText("lab-run-worker") || RUN_WORKER], { type: "text/javascript" }))); }
// The site's page keeps them as text elements instead (build.ts, E204), so
// the script it parses before the first drawing is 8 MB shorter.
function runtimeText(id: string) { return document.getElementById(id)?.textContent || ""; }
export function pageRuntimeText() { return runtimeText("lab-page-runtime") || PAGE_RUNTIME; }
export function workletRuntimeText() { return runtimeText("lab-worklet-runtime") || WORKLET_RUNTIME; }

// Where a read of a text run backwards stopped (L70c): its line, marked
// at the place, and what was looked for there.
export function stuckView(st: Stuck): HTMLElement {
  const start = st.text.lastIndexOf("\n", st.at - 1) + 1, end0 = st.text.indexOf("\n", st.at);
  const end = end0 < 0 ? st.text.length : end0;
  const from = Math.max(start, st.at - 40), to = Math.min(end, st.at + 40);
  const before = st.text.slice(from, st.at), here = st.text.slice(st.at, st.at + 1), after = st.text.slice(st.at + 1, to);
  const many = st.times > 1 ? ` ${st.times} texts couldn't be read back; this is the last.` : "";
  return h("div", { class: "stuck" },
    h("p", { class: "hint" }, `Reading the text back found nothing.${many} It stops at the mark${st.expected.length ? `, where it looked for ${st.expected.join(" or ")}` : ""}.`),
    h("pre", { class: "text out stuck-at", title: st.said }, from > start ? "…" : "", before,
      h("mark", { class: "stuck-mark", title: "Where the reading stopped" }, here && here !== "\n" ? here : "⏎"), after, to < end ? "…" : ""));
}
// Where the finished run spent its time (E233): the program's own
// definitions (those in `code`), most time first, each a link to open it (`pick`). The time is
// sampled (runWorker.ts), so small shares are rough; calls are exact.
export function profileView(namer: Namer, profile: Profile, code: Code, pick: (id: Id, label: string) => HTMLElement): HTMLElement {
  const total = profile.reduce((t, p) => t + p.ms, 0);
  const rows = profile.filter((p) => code.nodes[p.def]).slice(0, 8);
  const share = (ms: number) => (total ? `${Math.round((100 * ms) / total)}%` : "");
  return h("details", { class: "profile" },
    h("summary", {}, `Where the run went: ${rows.length} of ${profile.length} definition${profile.length === 1 ? "" : "s"}`),
    h("table", { class: "profile-t" },
      h("tr", {}, h("th", {}, "definition"), h("th", {}, "calls"), h("th", { title: "About how much of the run's time was spent in it, itself (not in what it calls), sampled" }, "time")),
      ...rows.map((p) => h("tr", {}, h("td", {}, pick(p.def, namer.name(p.def))), h("td", {}, p.calls.toLocaleString("en")), h("td", {}, total ? `${share(p.ms)} · ${p.ms} ms` : "")))));
}
