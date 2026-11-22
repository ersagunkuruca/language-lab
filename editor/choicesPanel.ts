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
  // A walk is one row however its list is made (QA 11-22c L1): what
  // makes it is a fact, said on hover.
  const made = kind === "schedule" ? / *, its list made by (.*)$/.exec(about) : null;
  if (made) return { id: m[1], kind, held, about: about.slice(0, made.index), pick, among, facts: [`its list made by ${made[1]}`, ...facts], target };
  return { id: m[1], kind, held, about, pick, among, facts, target };
}

export const SECTIONS: [string, ChoiceKind[]][] = [["Representation", ["representation"]], ["Algorithm", ["way", "mode plan"]], ["Placement", ["place"]], ["Schedule", ["schedule"]]];

const SETTLE = 700;

export interface ChoicesHost {
  code(): Code;
  names(): Names;
  pins(): Pins;
  // The types held (E292, L280c), by id: the row each is stored as.
  held(): Record<Id, string>;
  // What the program needs before the compiler can choose (its type
  // errors, its holes), or null (QA 11-22c M1).
  blocked(): string | null;
  // Whether choices for an edited version are wanted now: the tab is
  // open, or the open definition had a badge (QA 11-22c M2). A program's
  // first are always wanted, for its badges.
  wanted(last: readonly Choice[]): boolean;
  main(): Id | undefined;
  render(): void;
}

// What the panel and the badges read: the entries for the code shown, or
// the last version's while this one is worked out (`working`). `would`:
// for a held type, the row the compiler would pick instead.
export interface Choices { entries: Choice[]; would: Map<Id, string>; refused?: string; blocked?: string; working: boolean; failed: boolean }
type Got = { main: Id; entries: Choice[]; would: Map<Id, string>; refused?: string };

export function choicesOf(host: ChoicesHost) {
  // By version of the code, then by what is held.
  const answers = new WeakMap<Code, Map<string, Got | "failed">>();
  let last: Got | null = null;
  let worker: Worker | null = null, working: { code: Code; held: string } | null = null, next = false;
  const heldKey = () => JSON.stringify(Object.entries(host.held()).sort());
  const ask = (code: Code, main: Id) => {
    if (working) { next = true; return; }
    const held = heldKey();
    working = { code, held };
    const a: ChoicesAsk = { choices: true, code: sendCode(code), names: host.names(), pins: host.pins(), held: Object.entries(host.held()), main };
    const settle = (got: Got | "failed") => {
      if (!answers.has(code)) answers.set(code, new Map());
      answers.get(code)!.set(held, got);
      if (got !== "failed") last = got;
      working = null;
      if (next) { next = false; const m = host.main(), c = host.code(); if (m && !answers.get(c)?.has(heldKey())) ask(c, m); }
      host.render();
    };
    const w = (worker ??= newWorker());
    w.onmessage = (e: MessageEvent<ChoicesSays>) => settle("error" in e.data ? "failed" : { main, entries: e.data.choices.map(parseChoice).filter((c): c is Choice => !!c), would: new Map(e.data.would), ...(e.data.refused ? { refused: e.data.refused } : {}) });
    w.onerror = (e) => { e.preventDefault(); w.terminate(); worker = null; settle("failed"); };
    w.postMessage(a);
  };
  // Asked once edits settle (QA 11-22c M2: each one cost a page program 3
  // to 5 s of the worker), and only when wanted; a render after that, the
  // tab opened, asks again.
  let waiting: { code: Code; held: string; timer: ReturnType<typeof setTimeout> } | null = null;
  const later = (code: Code, held: string, main: Id, last: readonly Choice[] | null) => {
    if (waiting?.code === code && waiting.held === held) return;
    if (waiting) clearTimeout(waiting.timer);
    const timer = setTimeout(() => {
      waiting = null;
      if (host.code() === code && heldKey() === held && (!last || host.wanted(last))) ask(code, main);
    }, SETTLE);
    waiting = { code, held, timer };
  };
  return (): Choices | null => {
    const code = host.code(), main = host.main();
    if (!main) return null;
    const blocked = host.blocked();
    if (blocked) return { entries: [], would: new Map(), blocked, working: false, failed: false };
    const held = heldKey(), got = answers.get(code)?.get(held);
    const kept = last?.main === main ? last : null;
    if (got === "failed") return { entries: kept?.entries ?? [], would: new Map(), working: false, failed: true };
    if (got) return { entries: got.entries, would: got.would, refused: got.refused, working: false, failed: false };
    if (working?.code !== code || working.held !== held) later(code, held, main, kept?.entries ?? null);
    return { entries: kept?.entries ?? [], would: kept?.would ?? new Map(), working: true, failed: false };
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
  if (c.blocked) { box.append(h("p", { class: "status-line warn", title: "The compiler chooses once the program checks; Checks lists what's wrong" }, `Waits on ${c.blocked}`)); return box; }
  if (c.failed && !c.entries.length) { box.append(h("p", { class: "status-line warn", title: "The worker working them out failed" }, "No choices")); return box; }
  if (!c.entries.length) { box.append(h("p", { class: "empty" }, c.working ? "Working out…" : "None")); return box; }
  if (c.working) box.append(h("p", { class: "hint" }, "Updating…"));
  // What is held can't be (a run is refused the same): said first, the
  // compiler's own picks below, each with its row to hold another.
  if (c.refused) box.append(h("p", { class: "status-line bad", role: "alert", title: c.refused }, "Held choice refused · ", h("span", { class: "hint" }, c.refused)));
  const up = parentLookup(code);
  const defOf = (id: Id) => { let at: Id | undefined = id; for (let i = 0; at !== undefined && code.nodes[at]?.kind !== "def" && i < 10000; i++) at = up(at); return at; };
  for (const [title, kinds] of SECTIONS) {
    // Entries that read the same (a map the compiler copied, each copy
    // its own id) are one row, with a count.
    const rows = new Map<string, Choice[]>();
    for (const e of c.entries) if (kinds.includes(e.kind)) { const k = JSON.stringify([e.about, e.pick, e.among, e.held]); rows.set(k, [...(rows.get(k) ?? []), e]); }
    if (!rows.size) continue;
    box.append(h("section", { class: "choice-kind" }, h("h4", {}, title), ...[...rows.values()].map((same) => {
      const e = same.find((x) => code.nodes[x.id]) ?? same[0], ids = same.map((x) => x.id);
      const d = code.nodes[e.id] ? defOf(e.id) : undefined;
      const about = d === undefined ? h("span", { class: "choice-about" }, e.about)
        : h("button", { class: "link choice-about", type: "button", ...(d === e.id ? { "data-act": "goto", "data-target": d } : { "data-act": "goto-stop", "data-def": d, "data-target": e.id }) }, e.about);
      // The pick among the others: `worker threads when slow` is the
      // `worker threads` among them, when slow said on hover.
      const at = e.among.findIndex((a) => e.pick === a || e.pick.startsWith(`${a} `) || e.pick.startsWith(`${a},`));
      const chips = at < 0 ? [e.pick || "—", ...e.among] : e.among, on = Math.max(at, 0);
      // A whole type's row can be held (L280c); a split (`array of List
      // from a, b`) is the compiler's to make.
      const holdable = e.kind === "representation" && at >= 0, would = c.would.get(e.id);
      return h("div", { class: `choice${open && ids.includes(open) ? " on" : ""}`, "data-choice-row": ids.join(" "), title: [...e.facts, `target ${e.target}`].join("\n") },
        h("div", { class: "choice-head" }, h("span", { class: "choice-name" }, about, same.length > 1 ? h("span", { class: "choice-n" }, `×${same.length}`) : null), e.held ? h("button", { class: "link choice-state held", type: "button", "data-act": "choice-release", "data-of": e.id, title: "Let the compiler pick again" }, "Held") : h("span", { class: "choice-state" }, "Auto")),
        h("div", { class: "file-chips" }, ...chips.map((a, i) => i !== on && holdable
          ? h("button", { class: "chip-btn", type: "button", "data-act": "choice-hold", "data-of": e.id, "data-rep": a, title: `Store ${e.about} as ${a}` }, a)
          : h("span", { class: `chip-btn${i === on ? " on" : ""}`, ...(i === on && a !== e.pick ? { title: e.pick } : {}) }, a))),
        would ? h("p", { class: "status-line warn", title: `Held as ${e.pick}; with nothing held, the compiler picks ${would}` }, `Compiler would pick ${would}`) : null);
    })));
  }
  return box;
}
