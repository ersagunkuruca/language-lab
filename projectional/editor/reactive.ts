// reactive.html: the two Cells programs (src/lang/cells-programs.ts) running
// live, each next to its own code. Every part of a page that runs again
// flashes, so you can see that a click runs only what read the cell it
// changed, and a counter says how many formulas and watchers ran.

import type { Code, Id } from "../src/model.ts";
import type { Names, Presentation, Style } from "../src/presentation.ts";
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import { Cells } from "../src/lang/cells.ts";
import { counterProgram, fractionsProgram } from "../src/lang/cells-programs.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { equal, runMain } from "../src/lang/run.ts";
import { mount, type Doc } from "../src/lang/ui.ts";
import { merge } from "../src/model.ts";
import { layer } from "../src/presentation.ts";
import type { UiIds } from "../src/lang/ui.ts";

function show(where: string, p: { code: Code; names: Names; main: Id; ui: UiIds }, defs: string[]) {
  const box = document.getElementById(where)!;
  const live = box.querySelector(".live")!, code = box.querySelector(".code")!, log = box.querySelector(".log")!;
  const all = merge(LIBRARY.code, p.code), names = layer<Names>(LIBRARY.names, p.names);
  const info = infer(all, names, undefined, { pins: LIBRARY.pins, hidden: LIBRARY.hidden });
  if (info.errors.length) throw new Error(info.errors.map((e) => e.message).join("\n"));
  const pres: Presentation = { names, comments: {}, hints: {}, style: blocksStyle as unknown as Style };
  code.textContent = defs.map((name) => renderBlocks(all, pres, info, p.code.defs.find((d) => names[d] === name)!)).join("\n\n");

  const cells = new Cells(equal);
  const value = runMain(all, info, p.main, { print: () => {}, names, cells });
  let before = 0, flashed = 0;
  const report = (what: string) => {
    log.textContent = `${what}: ${cells.runs - before} formulas and watchers ran${flashed ? `, ${flashed} part${flashed === 1 ? "" : "s"} of the page changed` : ""}`;
    before = cells.runs;
    flashed = 0;
  };
  const root = mount(value, {
    cells, ui: p.ui, doc: document as unknown as Doc,
    ran: (el) => {
      flashed++;
      const e = el as unknown as HTMLElement;
      e.classList.remove("ran");
      void e.offsetWidth; // restart the animation
      e.classList.add("ran");
    },
  });
  live.replaceChildren(root as unknown as HTMLElement);
  report("first run");
  // Report after each change the page makes.
  live.addEventListener("click", (e) => { if ((e.target as HTMLElement).tagName === "BUTTON") queueMicrotask(() => report("click")); });
  live.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") queueMicrotask(() => report("Enter")); });
  live.addEventListener("input", (e) => { if ((e.target as HTMLInputElement).type === "range") queueMicrotask(() => report("slider moved")); });
}

show("counter", counterProgram(), ["main"]);
show("fractions", fractionsProgram(), ["main", "CF", "square root", "root terms", "e terms", "terms", "arithmetic", "from x?"]);
