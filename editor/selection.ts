// What is selected and how it moves (split out of main.ts, E228q):
// selecting a part, the part it is in (Alt+↑, "↑ what it's in"), what a
// click in the Blocks pane is on, and the menu for the selected part from
// the keyboard. What it reads of the editor comes through
// `SelectionHost`.
import { isCall, isUse, SCHEMA, type Code, type Id, type Node } from "../ters/src/model.ts";
import type { Presentation } from "../ters/src/presentation.ts";
import * as T from "./typed.ts";
import type { MenuTarget } from "./typedGraph.ts";
import type { Doc, UI } from "./main.ts";

// Each node's parent, once per version of the code: an arm's is the
// match or fold holding it, which parentOf doesn't know (I134); one walk
// of the nodes, not one per step (I135).
const parents = new WeakMap<Code, Map<Id, { parent: Id; slot: string; index?: number }>>();
export function parentsOf(code: Code) {
  let m = parents.get(code);
  if (m) return m;
  m = new Map();
  const set = (c: Id | null | undefined, parent: Id, slot: string, index?: number) => { if (c && !m!.has(c)) m!.set(c, { parent, slot, ...(index !== undefined ? { index } : {}) }); };
  // Every child slot of every kind, as model.ts SCHEMA lists them (E228o),
  // not a list of kinds of its own: a slot a kind gains is known here too.
  for (const n of Object.values(code.nodes)) {
    for (const [slot, how] of Object.entries(SCHEMA[n.kind] ?? {})) {
      if (how !== "child") continue;
      const v = (n as unknown as Record<string, unknown>)[slot];
      if (typeof v === "string") set(v, n.id, slot);
      else if (Array.isArray(v)) v.forEach((c, i) => typeof c === "string" && set(c, n.id, slot, i));
      else if (v && typeof v === "object") Object.values(v).forEach((c) => typeof c === "string" && set(c, n.id, slot));
    }
  }
  parents.set(code, m);
  return m;
}

export interface SelectionHost {
  doc(): Doc;
  ui: UI;
  render(): void;
  typesOf(): T.Info | null;
  typedPres(): Presentation;
  kindLabel(id: Id): string;
  onePane(): boolean;
  touch: boolean;
}

export function selection(host: SelectionHost) {
  const { doc, ui, render, typesOf, typedPres, kindLabel, onePane, touch: TOUCH } = host;
  const node = (id: Id): Node | undefined => doc().code.nodes[id];

  // The expression a part is in, one step out: past the arm or let that
  // only holds it, never the definition itself.
  function enclosing(id: Id): Id | null {
    const ps = parentsOf(doc().code), up = (x: Id) => ps.get(x) ?? null;
    // Only what a view draws: a call merged into its chain (0.5 · g · t · t
    // is one ·) or a match read as a longer pattern is passed over (I139).
    const views = document.querySelector(".blocks-wrap [data-id], .p-graph [data-id]");
    const drawn = (x: Id) => !views || !!document.querySelector(`.blocks-wrap [data-id="${CSS.escape(x)}"], .p-graph [data-id="${CSS.escape(x)}"]`);
    for (let at = up(id), hops = 0; at && hops < 16; at = up(at.parent), hops++) {
      const n = node(at.parent);
      if (!n || n.kind === "def" || at.parent === ui.def) return null;
      // A let's call and its function only hold steps; a definition's own
      // function is the definition.
      const letCall = (c: Node | undefined) => isCall(c) && node(c.fn)?.kind === "lambda";
      if (letCall(n)) continue;
      if (n.kind === "lambda") { const o = up(n.id); const on = o ? node(o.parent) : undefined; if (!o || on?.kind === "def" || (letCall(on) && o.slot === "fn")) continue; }
      if ((["call", "match", "fold", "lambda"].includes(n.kind) || isUse(n)) && drawn(n.id)) return n.id;
    }
    return null;
  }

  // The graph's menu for the selected part, from the keyboard (Shift+F10, the
  // Menu key, or Enter on a call), next to where the part is drawn; its first
  // item, or the one named, takes the focus. Arrows move through it.
  function menuForSelected(focus?: string) {
    const id = ui.selected;
    if (!id) return;
    const el = document.querySelector(`.p-graph svg.canvas [data-id="${id}"]`) ?? document.querySelector(".blocks-wrap .sel");
    const r = el?.getBoundingClientRect() ?? { left: 40, bottom: 40 };
    const blocks = !!el?.closest(".blocks-wrap");
    const kind: MenuTarget["kind"] = blocks ? blocksKind(id) : el?.closest("[data-src]") ? "binder" : el?.closest("[data-frame]") && id !== ui.def ? "frame" : "node";
    ui.menu = { target: { kind, id }, x: r.left, y: r.bottom, world: { x: 0, y: 0 }, blocks };
    ui.query = "";
    render();
    const items = [...document.querySelectorAll<HTMLElement>(".ctx-menu .ctx-item:not(:disabled)")];
    (items.find((b) => b.dataset.menu === focus) ?? items[0])?.focus();
  }

  // What a part of the Blocks pane is, for its menu.
  const blocksKind = (id: Id): MenuTarget["kind"] => {
    const k = doc().code.nodes[id]?.kind;
    return k === "hole" ? "hole" : k === "binder" ? "binder" : "node";
  };

  // The part of the Blocks pane a click or right-click is on. An operator
  // stands for its call, as in the graph, where + is the call's own node.
  function blocksHit(t: EventTarget | null): Id | null {
    const hit = (t as HTMLElement | null)?.closest?.<HTMLElement>(".blocks-wrap [data-id]");
    if (!hit) return null;
    const call = hit.classList.contains("op") || hit.classList.contains("head") ? hit.parentElement?.closest<HTMLElement>("[data-id]") : null;
    return (call ?? hit).dataset.id!;
  }

  function select(id: Id | null) {
    // Re-rendering on a repeat click would detach the element before its
    // dblclick fires, and go-to-definition is a dblclick.
    // One pane at a time: a hole's palette is in the side pane, so show it,
    // also when the hole was selected already (a new program's is).
    const toPalette = !!id && doc().code.nodes[id]?.kind === "hole" && onePane() && ui.pane !== "side";
    if (ui.selected === id) { if (toPalette) { ui.pane = "side"; render(); } return; }
    ui.mode = null; ui.query = "";
    ui.selected = id;
    if (toPalette) ui.pane = "side";
    // One pane at a time on a touch screen: the Selected panel is in the
    // other pane and there's no hover, so what was tapped and its type go on
    // the status line, where the tap is (E203).
    else if (id && TOUCH && onePane()) {
      const info = typesOf(), names = typedPres().names, n = doc().code.nodes[id];
      const t = info ? T.typeOf(info, id, names) : null;
      const head = isCall(n) ? doc().code.nodes[n.fn] : n;
      const name = head?.kind === "ref" ? names[head.target] : names[id];
      if (n) { ui.note = `${kindLabel(id)}${name ? ` ${name}` : ""}${t ? ` : ${t}` : ""}. Its panel is in Run & more.`; ui.refused = false; }
    }
    render();
  }

  return { enclosing, menuForSelected, blocksKind, blocksHit, select };
}
