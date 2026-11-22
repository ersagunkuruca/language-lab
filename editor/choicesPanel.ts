// The Choices tab (E292): the program's choices for main as `ters choices`
// writes them (L280a, CHOICES-2026-11-20.md), under the four kinds:
// Representation, Algorithm, Placement and Schedule. Each entry is its
// pick among the implementations of the same meaning, auto (the
// compiler's, picked again when its facts change) or held. Worked out in
// a worker of its own (choicesFor.ts), a few seconds for a bigger
// program, kept per version of the code; the last answer shows while an
// edit's is worked out. A badge on each node an entry is about, in the
// graph and the blocks, opens its row here.
import type { Code, Id } from "../ters/src/model.ts";
import { parentLookup } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { h } from "./dom.ts";
import { newWorker } from "./runViews.ts";
import { sendCode } from "./runCode.ts";
import type { ChoicesAsk, ChoicesSays } from "./runWorker.ts";

export type ChoiceKind = "representation" | "way" | "mode plan" | "place" | "schedule";
export interface Choice {
  id: Id;
  kind: ChoiceKind;
  held: boolean;
  // What it is about (Nat, tick's map), what was picked, and what it was
  // picked among; the facts the pick read, and the target.
  about: string;
  pick: string;
  among: string[];
  facts: string[];
  target: string;
}

const LINE = /^(\S+) (representation|way|mode plan|place|schedule): (.*)$/;
// An entry as `ters choices` writes it (cli/choices.ts), or null.
export function parseChoice(line: string): Choice | null {
  const held = line.startsWith("held "), m = LINE.exec(held ? line.slice(5) : line);
  if (!m) return null;
  const kind = m[2] as ChoiceKind, [head, ...rest] = m[3].split("; ");
  // `Nat as int`; the others `about: pick`.
  const cut = kind === "representation" ? head.indexOf(" as ") : head.lastIndexOf(": ");
  const about = cut < 0 ? head : head.slice(0, cut), pick = cut < 0 ? "" : head.slice(cut + (kind === "representation" ? 4 : 2));
  const among = rest.find((p) => p.startsWith("among "))?.slice(6).split(", ") ?? [];
  const target = rest.find((p) => p.startsWith("target "))?.slice(7) ?? "";
  const facts = rest.filter((p) => !p.startsWith("among ") && !p.startsWith("target "));
  return { id: m[1], kind, held, about, pick, among, facts, target };
}

export const SECTIONS: [string, ChoiceKind[]][] = [["Representation", ["representation"]], ["Algorithm", ["way", "mode plan"]], ["Placement", ["place"]], ["Schedule", ["schedule"]]];

export interface ChoicesHost {
  code(): Code;
  names(): Names;
  pins(): Pins;
  main(): Id | undefined;
  render(): void;
}

// What the panel and the badges read: the entries for the code shown, or
// the last version's while this one is worked out (`working`).
export interface Choices { entries: Choice[]; working: boolean; failed: boolean }

export function choicesOf(host: ChoicesHost) {
  const answers = new WeakMap<Code, { main: Id; entries: Choice[] } | "failed">();
  let last: { main: Id; entries: Choice[] } | null = null;
  let worker: Worker | null = null, working: Code | null = null, next: Code | null = null;
  const ask = (code: Code, main: Id) => {
    if (working) { next = code; return; }
    working = code;
    const a: ChoicesAsk = { choices: true, code: sendCode(code), names: host.names(), pins: host.pins(), main };
    const settle = (got: { main: Id; entries: Choice[] } | "failed") => {
      answers.set(code, got);
      if (got !== "failed") last = got;
      working = null;
      const n = next;
      next = null;
      if (n && !answers.has(n)) { const m = host.main(); if (m && host.code() === n) ask(n, m); }
      host.render();
    };
    const w = (worker ??= newWorker());
    w.onmessage = (e: MessageEvent<ChoicesSays>) => settle("error" in e.data ? "failed" : { main, entries: e.data.choices.map(parseChoice).filter((c): c is Choice => !!c) });
    w.onerror = (e) => { e.preventDefault(); w.terminate(); worker = null; settle("failed"); };
    w.postMessage(a);
  };
  return (): Choices | null => {
    const code = host.code(), main = host.main();
    if (!main) return null;
    const got = answers.get(code);
    if (got === "failed") return { entries: last?.main === main ? last.entries : [], working: false, failed: true };
    if (got) return { entries: got.entries, working: false, failed: false };
    if (working !== code && next !== code) ask(code, main);
    return { entries: last?.main === main ? last.entries : [], working: true, failed: false };
  };
}

// The entries by the node they are about, for the badges: what each says,
// on hover.
export function choiceMarks(c: Choices | null): Map<Id, string> {
  const out = new Map<Id, string>();
  for (const e of c?.entries ?? []) {
    const line = `${e.about}: ${e.pick}`;
    out.set(e.id, out.has(e.id) ? `${out.get(e.id)}\n${line}` : line);
  }
  return out;
}

// The tab: a section per kind with entries, each row what it is about,
// its pick among the others, and auto or held. `open`: the row a badge
// opened, scrolled to and marked. A row about a node of the program opens
// it.
export function choicesPanel(c: Choices | null, code: Code, open: Id | null): HTMLElement {
  const box = h("div", { class: "choices" });
  if (!c) { box.append(h("p", { class: "empty", title: "The compiler's choices are made for main" }, "No main")); return box; }
  if (c.failed && !c.entries.length) { box.append(h("p", { class: "status-line warn", title: "The worker working them out failed" }, "No choices")); return box; }
  if (!c.entries.length) { box.append(h("p", { class: "empty" }, c.working ? "Working out…" : "None")); return box; }
  if (c.working) box.append(h("p", { class: "hint" }, "Updating…"));
  const up = parentLookup(code);
  const defOf = (id: Id) => { let at: Id | undefined = id; for (let i = 0; at !== undefined && code.nodes[at]?.kind !== "def" && i < 10000; i++) at = up(at); return at; };
  for (const [title, kinds] of SECTIONS) {
    // Entries that read the same (a map the compiler copied, each copy
    // its own id) are one row, with a count.
    const rows = new Map<string, Choice[]>();
    for (const e of c.entries) if (kinds.includes(e.kind)) { const k = JSON.stringify([e.about, e.pick, e.among, e.held]); rows.set(k, [...(rows.get(k) ?? []), e]); }
    if (!rows.size) continue;
    box.append(h("section", { class: "choice-kind" }, h("h3", {}, title), ...[...rows.values()].map((same) => {
      const e = same.find((x) => code.nodes[x.id]) ?? same[0], ids = same.map((x) => x.id);
      const d = code.nodes[e.id] ? defOf(e.id) : undefined;
      const about = d === undefined ? h("span", { class: "choice-about" }, e.about)
        : h("button", { class: "link choice-about", type: "button", ...(d === e.id ? { "data-act": "goto", "data-target": d } : { "data-act": "goto-stop", "data-def": d, "data-target": e.id }) }, e.about);
      // The pick among the others: `worker threads when slow` is the
      // `worker threads` among them, when slow said on hover.
      const at = e.among.findIndex((a) => e.pick === a || e.pick.startsWith(`${a} `) || e.pick.startsWith(`${a},`));
      const chips = at < 0 ? [e.pick || "—", ...e.among] : e.among, on = Math.max(at, 0);
      return h("div", { class: `choice${open && ids.includes(open) ? " on" : ""}`, "data-choice-row": ids.join(" "), title: [...e.facts, `target ${e.target}`].join("\n") },
        h("div", { class: "choice-head" }, h("span", {}, about, same.length > 1 ? h("span", { class: "choice-n" }, ` ×${same.length}`) : null), h("span", { class: `choice-state${e.held ? " held" : ""}` }, e.held ? "Held" : "Auto")),
        h("div", { class: "file-chips" }, ...chips.map((a, i) => h("span", { class: `chip-btn${i === on ? " on" : ""}`, ...(i === on && a !== e.pick ? { title: e.pick } : {}) }, a))));
    })));
  }
  return box;
}
