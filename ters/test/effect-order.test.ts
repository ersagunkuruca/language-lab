// The order effects run in, in the graph (E265): with the overlay on,
// each call whose row isn't empty is numbered in the order it runs (SPEC
// 5.1: a call's inputs left to right, then the call; one step, then the
// next), so `print(show(random()) ++ show(random()))` says the left
// random runs first. A view: the code is the same with it on or off.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";
import { plainNodes, subtree } from "../src/model.ts";

class El {
  attrs = new Map<string, string>();
  children: El[] = [];
  parentElement: El | null = null;
  textContent = "";
  tagName: string;
  constructor(tag: string) { this.tagName = tag; }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  private adopt(els: El[]) { for (const e of els) { e.parentElement?.children.splice(e.parentElement.children.indexOf(e), 1); e.parentElement = this; } return els; }
  append(...els: (El | string)[]) { for (const e of els) { if (typeof e === "string") this.textContent += e; else this.children.push(...this.adopt([e])); } }
  prepend(...els: El[]) { this.children.unshift(...this.adopt(els)); }
  replaceChildren(...els: El[]) { this.children = []; this.append(...els); }
  addEventListener() {}
  get firstChild() { return this.children[0] ?? null; }
  all(): El[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
(globalThis as unknown as { document: unknown }).document = { createElementNS: (_: string, tag: string) => new El(tag), createElement: (tag: string) => new El(tag), documentElement: { classList: { contains: () => false, toggle() {}, add() {} } } };
(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} };
const { typedGraph } = await import("../../editor/typedGraph.ts");

function program(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "effect-order-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(dir, "names.default.json"), "{}");
  const s = new Session(dir);
  s.define("main", "function", []);
  s.replace(/□#(\w+)/.exec(s.view("main"))![1], body);
  return s;
}
// Each numbered call, by the order its number gives, as [call's label, n].
function numbered(s: Session, order = true, folded?: Set<string>) {
  const def = s.own.find((d) => s.name(d) === "main")!;
  const svg = typedGraph(s.code, { names: s.allNames, comments: {}, hints: {}, style: { view: "blocks", notation: {} } } as never, s.info, def, {
    selected: null, select() {}, open() {}, canUse: () => null, use() {}, clear() {}, addDot() {},
    canShare: () => () => null, share() {}, at: {}, moved() {}, named: new Set(), order, folded,
  }).root as unknown as El;
  const out: [string, number][] = [];
  for (const g of svg.all().filter((e) => e.getAttribute("class") === "effn")) {
    const box = g.parentElement!, label = box.children.find((c) => c.getAttribute("class") === "cl")?.textContent ?? "";
    const n = g.all().find((e) => e.tagName === "text")!.textContent;
    out.push([label || box.children.find((c) => c.getAttribute("class") === "rt")?.textContent || "", /^\d+$/.test(n) ? Number(n) : (n as unknown as number)]);
  }
  return out.sort((a, b) => a[1] - b[1]);
}

test("calls with effects are numbered in the order they run: inputs left to right, then the call, then the next step", () => {
  const s = program('print(show(random()) ++ show(now()))\nprint("done")');
  // random is ++'s first input, so it runs before now (SPEC 5.1).
  assert.deepEqual(numbered(s), [["random", 1], ["now", 2], ["print", 3], ["print", 4]]);
  // Swapped, so are the numbers.
  const t = program('print(show(now()) ++ show(random()))');
  assert.deepEqual(numbered(t), [["now", 1], ["random", 2], ["print", 3]]);
});

test("off, nothing is numbered, and turning it on changes no code", () => {
  const s = program('print(show(random()))');
  const before = JSON.stringify({ ...s.code, nodes: plainNodes(s.code.nodes) });
  assert.deepEqual(numbered(s, false), []);
  assert.equal(numbered(s).length, 2);
  assert.equal(JSON.stringify({ ...s.code, nodes: plainNodes(s.code.nodes) }), before);
});

test("a function written in place numbers its own calls from 1, as it runs when it's called", () => {
  const s = program('print("start")\nfor each([1, 2], (i) => print(show(i)))');
  const n = numbered(s);
  assert.deepEqual(n.filter(([l]) => l === "print").map(([, k]) => k).sort(), [1, 1]);
});

test("what a call runs then and there, first's or a handler's thunk, is numbered on", () => {
  const s = program('print(first(show(random()), else "none"))\nprint(show(now()))');
  assert.deepEqual(numbered(s), [["random", 1], ["print", 2], ["now", 3], ["print", 4]]);
});

// QA 11-15 Q2: folded, a frame hides its calls, so the box says their numbers.
test("a folded frame says the numbers of the calls with effects inside it", () => {
  const s = program('print("start")\nfor each([1, 2], (i) => print(show(i) ++ show(random())))');
  const def = s.own.find((d) => s.name(d) === "main")!;
  const fn = subtree(s.code, def).find((x) => { const n = s.code.nodes[x]; return n.kind === "lambda" && n.params.length === 1 && s.name(n.params[0]) === "i"; })!;
  assert.deepEqual(numbered(s).map(([, k]) => k).sort(), [1, 1, 2]);
  const shut = numbered(s, true, new Set([fn]));
  // The prints inside are hidden: the box stands for them, 1–2.
  assert.deepEqual(shut.map(([, k]) => k), [1, "1–2" as unknown as number]);
});

// QA 11-15 Q3: one count of the order at a time. The steps are the in
// order node's inputs, numbered there, on or off; the effects' own numbers
// are the overlay's, on only when it is.
test("with the effects numbered, the steps are still the in order node's inputs", () => {
  const s = program('print("a")\nprint("b")\nprint("c")');
  const def = s.own.find((d) => s.name(d) === "main")!;
  const ports = (order: boolean) => (typedGraph(s.code, { names: s.allNames, comments: {}, hints: {}, style: { view: "blocks", notation: {} } } as never, s.info, def, {
    selected: null, select() {}, open() {}, canUse: () => null, use() {}, clear() {}, addDot() {},
    canShare: () => () => null, share() {}, at: {}, moved() {}, named: new Set(), order,
  }).root as unknown as El).all().filter((e) => e.getAttribute("class") === "portl" && e.parentElement?.children.some((c) => /\border\b/.test(c.getAttribute("class") ?? ""))).map((e) => e.textContent);
  assert.deepEqual(ports(false), ["1", "2", "3"]);
  assert.deepEqual(ports(true), ["1", "2", "3"]);
  assert.deepEqual(numbered(s).map(([, k]) => k), [1, 2, 3]);
});
