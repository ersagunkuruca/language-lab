// Drawing a UI value (cells-programs.ts, `UI`) on a page, the way Solid
// does: the program runs once and gives a description of the page, whose
// changing parts are functions. Each one runs inside a watcher (cells.ts),
// so when a cell it read changes, that function runs again and only its
// own element changes. Nothing is diffed and nothing else is redrawn.
//
// The page is anything shaped like the DOM's few calls used here, so tests
// can draw into a fake one.

import type { Id } from "../model.ts";
import { Cells, type CellNode } from "./cells.ts";
import type { Data, Fn, Value } from "./run.ts";
import { fromList } from "./run.ts";

export type UiIds = Record<"text" | "button" | "entry" | "slider" | "row" | "column" | "dynamic", Id>;

export interface El {
  textContent: string | null;
  className: string;
  value?: string;
  append(...nodes: El[]): void;
  replaceChildren(...nodes: El[]): void;
  addEventListener(type: string, f: (e: { key?: string }) => void): void;
  setAttribute(name: string, value: string): void;
}
export interface Doc { createElement(tag: string): El }

export interface Mount {
  cells: Cells;
  ui: UiIds;
  doc: Doc;
  // Each time a watcher runs again (not the first time), with its element:
  // the page flashes it.
  ran?: (el: El, node: CellNode) => void;
}

const call = (f: Value, ...args: Value[]): Value => {
  for (const v of (f as Fn)(...args)) return v;
  throw new Error("no value");
};

export function mount(v: Value, m: Mount): El {
  const { doc, cells, ui } = m;
  const d = v as Data;
  const el = (tag: string, cls: string) => { const e = doc.createElement(tag); e.className = cls; return e; };
  // A watcher on `e`, reporting its later runs.
  const watch = (e: El, label: string, run: () => void) => {
    let first = true;
    const node: CellNode = cells.watch(() => {
      run();
      if (!first) m.ran?.(e, node);
      first = false;
    }, label);
    return node;
  };
  const guard = (f: () => void) => () => {
    try { f(); } catch (err) { console.error(err); }
  };
  switch (d.tag) {
    case ui.text: {
      const e = el("span", "ui-text");
      watch(e, "text", () => { e.textContent = String(call(d.fields[0])); });
      return e;
    }
    case ui.button: {
      const e = el("button", "ui-button");
      e.textContent = String(d.fields[0]);
      e.setAttribute("type", "button");
      e.addEventListener("click", guard(() => cells.batch(() => call(d.fields[1]))));
      return e;
    }
    case ui.entry: {
      const e = el("input", "ui-entry");
      e.setAttribute("placeholder", String(d.fields[0]));
      e.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" || !e.value) return;
        const text = e.value;
        e.value = "";
        guard(() => cells.batch(() => call(d.fields[1], text)))();
      });
      return e;
    }
    case ui.slider: {
      const [label, low, high, cell] = d.fields;
      const e = el("label", "ui-slider");
      const name = el("span", "ui-slider-label");
      name.textContent = String(label);
      const input = el("input", "");
      input.setAttribute("type", "range");
      input.setAttribute("min", String(low));
      input.setAttribute("max", String(high));
      input.setAttribute("step", "1");
      const out = el("output", "");
      watch(out, "slider", () => { const x = cells.read(cell); input.value = String(x); out.textContent = String(x); });
      input.addEventListener("input", guard(() => cells.batch(() => cells.write(cell, Number(input.value)))));
      e.append(name, input, out);
      return e;
    }
    case ui.row: case ui.column: {
      const e = el("div", d.tag === ui.row ? "ui-row" : "ui-column");
      e.append(...fromList(d.fields[0]).map((x) => mount(x, m)));
      return e;
    }
    case ui.dynamic: {
      const e = el("div", "ui-dynamic");
      // The parts drawn inside belong to this watcher's run: the next run
      // disposes of them before drawing new ones.
      watch(e, "part", () => { e.replaceChildren(mount(call(d.fields[0]), m)); });
      return e;
    }
    default: throw new Error(`not a UI value: ${d.tag}`);
  }
}
