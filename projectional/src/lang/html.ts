// Drawing an `Html` value (std.ts, WEB.md) on a page, the way Solid.js does
// (Ryan Carniato, https://www.solidjs.com): `main` runs once and returns the
// page, whose changing parts are functions. Each one runs in a watcher of
// the Cells handler (cells.ts), so when a cell it read changes, that one
// function runs again and sets one text, one attribute, or redraws one
// part. Nothing is diffed and nothing else is redrawn.
//
// The same mount draws the evaluator's values and compiled ones: `call` is
// how a function of the program is called (the evaluator's functions give a
// stream of results, compiled ones their one result). The page is anything
// shaped like the few DOM calls used here, so tests draw into a fake one.

import { KEPT, Pending, type Cells, type CellNode } from "./cells.ts";
import type { Data, Value } from "./run.ts";
import { fromList, OutOfSteps, PAGE_STEPS, withSteps } from "./run.ts";
import { HTML_V } from "./std.ts";

export interface Node_ { textContent: string | null }
export interface El extends Node_ {
  value?: string;
  checked?: boolean;
  append(...nodes: Node_[]): void;
  replaceChildren(...nodes: Node_[]): void;
  addEventListener(type: string, f: (e: { key?: string; target?: unknown }) => void): void;
  setAttribute(name: string, value: string): void;
}
export interface Doc {
  createElement(tag: string): El;
  createElementNS?(ns: string, tag: string): El;
  createTextNode(text: string): Node_;
}

export interface Mount {
  cells: Cells;
  doc: Doc;
  call: (f: Value, ...args: Value[]) => Value;
  // Each time a watcher runs again (not the first time), with its node: a
  // page can flash it.
  ran?: (el: Node_, node: CellNode) => void;
  // The step budget of each update (run.ts, withSteps).
  steps?: number;
  // What plays an element's sound (audio-page.ts), when the page can.
  listen?: (el: El, a: Data) => void;
}

// What a part of the page shows when its update ran out of steps: a
// formula that never ends is typed Diverge, and this is the page handling it.
export const STUCK = "didn't finish";

// The evaluator's way of calling: the first result of the stream.
export const evaluatorCall = (f: Value, ...args: Value[]): Value => {
  for (const v of (f as (...a: Value[]) => Iterable<Value>)(...args)) return v;
  throw new Error("no value");
};
export const compiledCall = (f: Value, ...args: Value[]): Value => (f as (...a: Value[]) => Value)(...args);

const SVG = "http://www.w3.org/2000/svg";

// Properties the page reads back from the element itself, so they are set
// as properties: what the user typed or ticked replaces the attribute.
const LIVE = new Set(["value", "checked"]);

// What each mount has drawn of the values `each` keeps (cells.ts): drawn
// again, a kept row is the same nodes, watchers and all, moved to its new
// place, which is how a list keeps rows by identity (Solid's <For>).
const drawn = new WeakMap<Mount, WeakMap<object, Node_>>();
// The kept rows drawn before, and the new elements holding one, with their
// children: when a part runs again, what it says it drew is only what is
// new, not the kept rows it moved (a reorder draws nothing).
const moved = new WeakSet<Node_>();
const holding = new WeakMap<Node_, Node_[]>();
const fresh = (n: Node_): Node_[] => moved.has(n) ? [] : holding.get(n)?.flatMap(fresh) ?? [n];

export function mountHtml(v: Value, m: Mount, svg = false): Node_ {
  const owner = typeof v === "object" && v !== null ? KEPT.get(v) : undefined;
  if (!owner || owner.disposed) return draw(v, m, svg);
  let mine = drawn.get(m);
  if (!mine) drawn.set(m, (mine = new WeakMap()));
  const before = mine.get(v as object);
  if (before) { moved.add(before); return before; }
  // Its watchers belong to the row, not to the part drawing it, so they
  // last as long as the item does.
  const node = m.cells.under(owner, () => draw(v, m, svg));
  mine.set(v as object, node);
  return node;
}

function draw(v: Value, m: Mount, svg: boolean): Node_ {
  const { doc, cells } = m;
  const d = v as Data;
  const steps = m.steps ?? PAGE_STEPS;
  cells.around = (update) => withSteps(steps, update);
  const watch = (e: Node_, label: string, run: () => void, stuck: () => void = () => {}, made: () => Node_[] = () => [e]) => {
    let first = true;
    const node: CellNode = cells.watch(() => {
      // Something it asked for isn't here yet: it keeps what it shows, and
      // runs again when that lands (it read the cell that says so). One
      // that ran out of steps says so; it runs again when a cell it read
      // before stopping changes.
      try { withSteps(steps, run); } catch (e) {
        if (e instanceof OutOfSteps) { stuck(); return; }
        if (!(e instanceof Pending)) throw e;
        return;
      }
      if (!first) for (const x of made()) m.ran?.(x, node);
      first = false;
    }, label);
  };
  switch (d.tag) {
    case HTML_V.text: {
      const t = doc.createTextNode("");
      watch(t, "text", () => { t.textContent = String(m.call(d.fields[0])); }, () => { t.textContent = STUCK; });
      return t;
    }
    case HTML_V.part: {
      // An element that doesn't take part in the layout; what it draws
      // belongs to its watcher, whose next run disposes of it first.
      const e = doc.createElement("lab-part");
      e.setAttribute("style", "display: contents");
      let now: Node_ | undefined;
      watch(e, "part", () => { e.replaceChildren((now = mountHtml(m.call(d.fields[0]), m, svg))); }, () => { e.replaceChildren((now = doc.createTextNode(STUCK))); }, () => (now ? fresh(now) : []));
      return e;
    }
    case HTML_V.element: {
      const tag = String(d.fields[0]);
      const inSvg = svg || tag === "svg";
      const e = inSvg && doc.createElementNS ? doc.createElementNS(SVG, tag) : doc.createElement(tag);
      for (const a of fromList(d.fields[1]) as Data[]) {
        const name = String(a.fields[0]);
        if (a.tag === HTML_V.property) {
          // Out of steps, an attribute keeps its last value.
          watch(e, name, () => {
            const value = String(m.call(a.fields[1]));
            if (name === "checked") e.checked = value === "true";
            // Svelte's rule for bind:value (Rich Harris): leave the field
            // alone when it already shows this, so typing isn't disturbed.
            else if (name === "value") { if (e.value !== value) e.value = value; }
            else e.setAttribute(name, value);
          });
        } else if (a.tag === HTML_V.on) {
          const then = a.fields[1];
          e.addEventListener(name, (ev) => {
            const target = (ev.target ?? e) as El & { type?: string };
            const value = target.type === "checkbox" ? String(!!target.checked) : String(target.value ?? "");
            // One batch per event: the page updates once, after every write.
            // A handler that fetched what hasn't come is taken back (its
            // writes undone, its printing never done: cells.ts attempt) and
            // runs again from the start when the reply lands, with the same
            // event, so what it did before the fetch happens once.
            const fire = () => {
              try {
                cells.attempt(() => withSteps(steps, () => m.call(then, { tag: HTML_V.event, fields: [value, ev.key ?? ""] })), (e) => e instanceof Pending);
              } catch (err) {
                if (err instanceof Pending) err.ready.then(fire);
                else if (err instanceof OutOfSteps) console.error(`${name} handler ${STUCK}`);
                else console.error(err);
              }
            };
            fire();
          });
        } else if (a.tag === HTML_V.listen) {
          if (m.listen) m.listen(e, a);
          else console.warn("this page can't play sound here: build it with lab build-web");
        } else throw new Error(`not an attribute: ${a.tag}`);
      }
      const kids = fromList(d.fields[2]).map((c) => mountHtml(c, m, inSvg));
      e.append(...kids);
      if (kids.some((k) => moved.has(k) || holding.has(k))) holding.set(e, kids);
      return e;
    }
    default: throw new Error(`not Html: ${d.tag}`);
  }
}

// The page as HTML text, every function called once: what a static site
// is, and what the tests compare. Handlers are left out.
export function htmlText(v: Value, call: Mount["call"], raw = false): string {
  const d = v as Data;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  switch (d.tag) {
    // Inside <style> and <script> text isn't read for entities: it goes in
    // as it is, with only a closing tag kept from ending it early.
    case HTML_V.text: { const t = String(call(d.fields[0])); return raw ? t.replace(/<\//g, "<\\/") : esc(t); }
    case HTML_V.part: return htmlText(call(d.fields[0]), call, raw);
    case HTML_V.element: {
      const attrs = (fromList(d.fields[1]) as Data[]).filter((a) => a.tag === HTML_V.property)
        .map((a) => ` ${a.fields[0]}="${esc(String(call(a.fields[1])))}"`).join("");
      const rawText = d.fields[0] === "style" || d.fields[0] === "script";
      return `<${d.fields[0]}${attrs}>${fromList(d.fields[2]).map((c) => htmlText(c, call, rawText)).join("")}</${d.fields[0]}>`;
    }
    default: throw new Error(`not Html: ${d.tag}`);
  }
}
