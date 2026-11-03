// What the editor runs in and shows about a run of main, split out of
// main.ts (E228b, E228g): the runtimes the build puts in the page (the
// worker that runs main, the page and sound runtimes), the views of how a
// run ended, a value as Run shows it, and a test's results.
import type { Code, Id } from "../ters/src/model.ts";
import type { Namer } from "../ters/src/render/namer.ts";
import type { Profile, Stuck } from "./runWorker.ts";
import { h } from "./dom.ts";
import type { Names } from "../ters/src/presentation.ts";
import { fromList, showValue, type Value, type World } from "../ters/src/lang/run.ts";
import { MAP_V, SET_V } from "../ters/src/lang/std.ts";
import { runTests, savedFrom, type TestResult } from "../ters/src/lang/tests.ts";
import type * as T from "./typed.ts";
import type { Doc } from "./main.ts";

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
      h("tr", {}, h("th", { scope: "col" }, "definition"), h("th", { scope: "col" }, "calls"), h("th", { scope: "col", title: "About how much of the run's time was spent in it, itself (not in what it calls), sampled" }, "time")),
      ...rows.map((p) => h("tr", {}, h("td", {}, pick(p.def, namer.name(p.def))), h("td", {}, p.calls.toLocaleString("en")), h("td", {}, total ? `${share(p.ms)} · ${p.ms} ms` : "")))));
}

// A value as the Run panel shows it. A map or a set is a table, a row per
// entry in key order, as the blocks draw one written out
// (DATA-STRUCTURES.md); anything else is its text.
export function valueView(v: Value, code: Code, names: Names): HTMLElement {
  const text = (x: Value) => h("code", {}, showValue(x, code, names, true));
  const tag = typeof v === "object" && v !== null && "tag" in v ? v.tag : null;
  if ((tag === MAP_V || tag === SET_V) && fromList((v as { fields: Value[] }).fields[0]).length) {
    const rows = fromList((v as { fields: Value[] }).fields[0]).map((e) => (tag === MAP_V ? (e as { fields: Value[] }).fields : [e]));
    return h("table", { class: "vtable" }, ...rows.map((cells) => h("tr", {}, ...cells.map((c) => h("td", {}, text(c))))));
  }
  return text(v);
}

// A test's results, once per version of the code and its saved values.
const lawRuns = new WeakMap<Code, Map<string, TestResult>>();
export function lawPanel(info: T.Info, box: HTMLElement, at: { code: Code; names: Names; def: Id; examples: NonNullable<Doc["examples"]>; world: World }): HTMLElement {
  let m = lawRuns.get(at.code);
  if (!m) lawRuns.set(at.code, (m = new Map()));
  const key = `${at.def}\u0000${JSON.stringify(at.examples[at.def] ?? null)}`;
  let r = m.get(key);
  if (!r) {
    try { r = runTests(at.code, info, at.names, [at.def], savedFrom(at.examples), { world: at.world })[0]; }
    catch (e) { r = { def: at.def, name: "", cases: 0, failures: [], error: (e as Error).message }; }
    m.set(key, r);
  }
  const cases = `${r.cases} case${r.cases === 1 ? "" : "s"}`;
  box.append(h("p", { class: "hint" }, "A test: it performs Check. It runs on its saved inputs, then on small values of each input's type, smallest first, as lab test runs it."));
  if (r.error) box.append(h("p", { class: "status-line bad" }, `The test stopped: ${r.error}.`));
  else if (!r.failures.length) box.append(h("p", { class: "status-line accepted" }, `✓ Every expect held, in ${cases}.`));
  else {
    box.append(h("p", { class: "status-line bad" }, `${r.failures.length} of ${cases} failed. The first is the smallest.`));
    box.append(h("ul", { class: "law-failures" }, ...r.failures.slice(0, 5).map((f) => h("li", {}, `${f.inputs.join(", ") || "no inputs"}: ${f.what.join("; ")}`))));
  }
  return box;
}
