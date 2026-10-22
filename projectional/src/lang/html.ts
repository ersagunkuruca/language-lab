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

import type { Cells, CellNode } from "./cells.ts";
import type { Data, Value } from "./run.ts";
import { fromList } from "./run.ts";
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
}

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

export function mountHtml(v: Value, m: Mount, svg = false): Node_ {
  const { doc, cells } = m;
  const d = v as Data;
  const watch = (e: Node_, label: string, run: () => void) => {
    let first = true;
    const node: CellNode = cells.watch(() => {
      run();
      if (!first) m.ran?.(e, node);
      first = false;
    }, label);
  };
  switch (d.tag) {
    case HTML_V.text: {
      const t = doc.createTextNode("");
      watch(t, "text", () => { t.textContent = String(m.call(d.fields[0])); });
      return t;
    }
    case HTML_V.part: {
      // An element that doesn't take part in the layout; what it draws
      // belongs to its watcher, whose next run disposes of it first.
      const e = doc.createElement("lab-part");
      e.setAttribute("style", "display: contents");
      watch(e, "part", () => { e.replaceChildren(mountHtml(m.call(d.fields[0]), m, svg)); });
      return e;
    }
    case HTML_V.element: {
      const tag = String(d.fields[0]);
      const inSvg = svg || tag === "svg";
      const e = inSvg && doc.createElementNS ? doc.createElementNS(SVG, tag) : doc.createElement(tag);
      for (const a of fromList(d.fields[1]) as Data[]) {
        const name = String(a.fields[0]);
        if (a.tag === HTML_V.property) {
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
            try {
              cells.batch(() => m.call(then, { tag: HTML_V.event, fields: [value, ev.key ?? ""] }));
            } catch (err) { console.error(err); }
          });
        } else throw new Error(`not an attribute: ${a.tag}`);
      }
      e.append(...fromList(d.fields[2]).map((c) => mountHtml(c, m, inSvg)));
      return e;
    }
    default: throw new Error(`not Html: ${d.tag}`);
  }
}

// The page as HTML text, every function called once: what a static site
// is, and what the tests compare. Handlers are left out.
export function htmlText(v: Value, call: Mount["call"]): string {
  const d = v as Data;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  switch (d.tag) {
    case HTML_V.text: return esc(String(call(d.fields[0])));
    case HTML_V.part: return htmlText(call(d.fields[0]), call);
    case HTML_V.element: {
      const attrs = (fromList(d.fields[1]) as Data[]).filter((a) => a.tag === HTML_V.property)
        .map((a) => ` ${a.fields[0]}="${esc(String(call(a.fields[1])))}"`).join("");
      return `<${d.fields[0]}${attrs}>${fromList(d.fields[2]).map((c) => htmlText(c, call)).join("")}</${d.fields[0]}>`;
    }
    default: throw new Error(`not Html: ${d.tag}`);
  }
}
