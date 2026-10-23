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
import { evaluatorCall, mountHtml, type Doc } from "../src/lang/html.ts";
import { merge } from "../src/model.ts";
import { layer } from "../src/presentation.ts";

function show(where: string, p: { code: Code; names: Names; main: Id }, defs: string[]) {
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
  const root = mountHtml(value, {
    cells, doc: document as unknown as Doc, call: evaluatorCall,
    ran: (el) => {
      flashed++;
      // A text that ran flashes its element; a part, what it drew.
      const n = el as unknown as Node;
      const e = (n.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element).tagName === "LAB-PART" ? (n as Element).firstElementChild : n) as HTMLElement | null;
      if (!e) return;
      e.classList.remove("ran");
      void e.offsetWidth; // restart the animation
      e.classList.add("ran");
    },
  });
  live.replaceChildren(root as unknown as Node);
  report("first run");
  // Report after each change the page makes.
  live.addEventListener("click", (e) => { if ((e.target as HTMLElement).tagName === "BUTTON") queueMicrotask(() => report("click")); });
  live.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") queueMicrotask(() => report("Enter")); });
  live.addEventListener("input", (e) => { if ((e.target as HTMLInputElement).type === "range") queueMicrotask(() => report("slider moved")); });
}

show("counter", counterProgram(), ["main"]);
show("fractions", fractionsProgram(), ["main", "CF", "square root", "root terms", "e terms", "terms", "arithmetic", "from x?"]);
