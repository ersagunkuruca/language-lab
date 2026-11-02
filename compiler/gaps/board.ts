// board in three ways, in one process: the evaluator and the compiler's
// output drawing the page (main) into a fake document, and the
// hand-written ideal (board.ideal.js) drawing the same page by hand. Each
// gets the same scripted session (cards added through the quick-add field,
// moved, renamed, pointed, filtered, searched, undone and redone, a focus
// timer run for a number of frames, saved and loaded, deleted), and the
// comparison is the page after each phase. Used by bench-board.ts and by
// test/board.test.ts.

import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { Cells } from "../../ters/src/lang/cells.ts";
import { equal, runMain, type World } from "../../ters/src/lang/run.ts";
import { compiledCall, evaluatorCall, mountHtml } from "../../ters/src/lang/html.ts";
import { FakeEl, FakeText, fakeDoc } from "../../ters/test/fakedom.ts";
import { compile } from "../src/compile.ts";
import { $eq, $setCells, $setWorld } from "../src/runtime.js";
import { mount as ideal } from "./board.ideal.js";

export type Name = "evaluator" | "compiled" | "ideal";

// Frames: the page asks for one with requestAnimationFrame; frame() runs
// what's waiting, at 60 a second.
let queued: ((ms: number) => void)[] = [];
let clock = 0;
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (f: (ms: number) => void) => { queued.push(f); return queued.length; };
Object.defineProperty(FakeEl.prototype, "isConnected", { get: () => true, configurable: true });
export function frame() { clock += 1000 / 60; const q = queued; queued = []; for (const f of q) f(clock); }

// Files kept in memory, and Random from a fixed sequence, so every way
// draws the same numbers.
export function world(files: Record<string, string>): World {
  let seed = 1;
  return {
    error: () => {}, log: () => {}, input: () => "", readLine: () => null,
    readFile: (p) => { if (!(p in files)) throw new Error(`no such file: ${p}`); return files[p]; },
    writeFile: (p, t) => { files[p] = t; }, appendFile: () => {}, fileExists: (p) => p in files, listFolder: () => [],
    random: () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; },
    now: () => clock, wait: () => {}, fetchText: () => { throw new Error("board fetches nothing"); },
  };
}

export function program() {
  const p = loadProgram(join(import.meta.dirname, "board"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`board has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  const main = p.code.defs.find((d) => p.pres.names[d] === "main")!;
  return { code: p.code, info, names: p.pres.names, main };
}

export type Mount = () => FakeEl;

export async function ways(): Promise<Record<Name, Mount>> {
  const { code, info, names, main } = program();
  const dir = mkdtempSync(join(tmpdir(), "board-"));
  const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
  writeFileSync(join(dir, "board.js"), compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled = (await import(pathToFileURL(join(dir, "board.js")).href)).defs.main as () => unknown;
  return {
    evaluator: () => {
      const cells = new Cells(equal);
      const v = runMain(code, info, main, { print: () => {}, names, cells, world: world({}) });
      return mountHtml(v, { cells, doc: fakeDoc(), call: evaluatorCall }) as FakeEl;
    },
    compiled: () => {
      const cells = new Cells($eq);
      $setCells(cells);
      $setWorld(world({}));
      return mountHtml(compiled() as never, { cells, doc: fakeDoc(), call: compiledCall }) as FakeEl;
    },
    ideal: () => ideal(fakeDoc(), world({})) as FakeEl,
  };
}

// The page as HTML without the parts' own wrappers (<lab-part>), which only
// say where a part was drawn again.
export function shown(root: FakeEl): string {
  const go = (n: FakeEl | FakeText): string => {
    if (!(n instanceof FakeEl)) return n.textContent ?? "";
    const inner = n.kids.map(go).join("");
    if (n.tag === "lab-part") return inner;
    const attrs = [...n.attrs].map(([k, v]) => ` ${k}="${v}"`).join("") + (n.tag === "input" ? ` value="${n.value}"` : "");
    return `<${n.tag}${attrs}>${inner}</${n.tag}>`;
  };
  return go(root);
}

// Every element below root (itself included) whose class has `cls`.
export function all(root: FakeEl, cls: string): FakeEl[] {
  const out: FakeEl[] = [];
  const go = (e: FakeEl) => { if ((e.attrs.get("class") ?? "").split(" ").includes(cls)) out.push(e); for (const k of e.kids) if (k instanceof FakeEl) go(k); };
  go(root);
  return out;
}
export function button(root: FakeEl, label: string): FakeEl {
  let r: FakeEl | null = null;
  const go = (e: FakeEl) => { if (r) return; if (e.tag === "button" && e.textContent === label) { r = e; return; } for (const k of e.kids) if (k instanceof FakeEl) go(k); };
  go(root);
  if (!r) throw new Error(`no button ${label}`);
  return r;
}
const input = (e: FakeEl): FakeEl => (e.tag === "input" ? e : e.kids.find((k): k is FakeEl => k instanceof FakeEl && k.tag === "input") ?? (() => { throw new Error("no input"); })());
const tagged = (root: FakeEl, tag: string): FakeEl => {
  let r: FakeEl | null = null;
  const go = (e: FakeEl) => { if (r) return; if (e.tag === tag) { r = e; return; } for (const k of e.kids) if (k instanceof FakeEl) go(k); };
  go(root);
  return r!;
};

// The session: phases, each a name and what a person does.
export function session(n: number): [string, (root: FakeEl) => void][] {
  const first = (root: FakeEl, stage: string) => all(all(root, `stage-${stage}`)[0], "card")[0];
  const key = (root: FakeEl, k: string) => tagged(root, "main").fire("keydown", { key: k });
  return [
    ["add", (root) => { const q = input(all(root, "quick")[0]); for (let i = 0; i < n; i++) { q.type_(`Card ${i} #t${i % 7} +${1 + (i % 5)}`); q.fire("keydown", { key: "Enter" }); } }],
    ["move", (root) => { for (let i = 0; i < Math.min(10, n); i++) button(first(root, "todo"), "→").fire("click"); }],
    ["points", (root) => { for (let i = 0; i < 3; i++) button(first(root, "doing"), "+").fire("click"); }],
    ["rename", (root) => { const t = input(all(first(root, "todo"), "title")[0]); t.value = "Renamed"; t.fire("change"); }],
    ["filter", (root) => { button(all(root, "filters")[0], n > 3 ? "#t3" : "#code").fire("click"); }],
    ["all", (root) => { button(root, "All").fire("click"); }],
    ["search", (root) => { input(all(root, "search")[0]).type_("Card 1"); }],
    ["search cleared", (root) => { input(all(root, "search")[0]).type_(""); }],
    ["undo", (root) => { for (let i = 0; i < 5; i++) key(root, "z"); }],
    ["redo", (root) => { for (let i = 0; i < 2; i++) key(root, "y"); }],
    ["focus", (root) => { button(first(root, "doing"), "Focus").fire("click"); for (let i = 0; i < 120; i++) frame(); }],
    ["pause", (root) => { button(root, "Pause").fire("click"); for (let i = 0; i < 10; i++) frame(); button(root, "Stop").fire("click"); }],
    ["idle frames", () => { for (let i = 0; i < 120; i++) frame(); }],
    ["save, load", (root) => { button(root, "Save").fire("click"); button(root, "Load").fire("click"); }],
    ["pick", (root) => { button(root, "Pick one for me").fire("click"); }],
    ["delete", (root) => { for (let i = 0; i < 5 && first(root, "todo"); i++) button(first(root, "todo"), "✕").fire("click"); }],
  ];
}

// Runs the session on one way: the page after each phase, and the time
// each phase took.
export function run(mount: Mount, n: number): { pages: string[]; ms: number[] } {
  queued = []; // the pages drawn before stop here
  const t0 = performance.now();
  const root = mount();
  const pages = [shown(root)], ms = [performance.now() - t0];
  for (const [, act] of session(n)) {
    const t = performance.now();
    act(root);
    frame();
    ms.push(performance.now() - t);
    pages.push(shown(root));
  }
  return { pages, ms };
}
