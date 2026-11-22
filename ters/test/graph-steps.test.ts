// The graph draws an action's steps in the order they run (Ersagun
// 2026-11-22: chapters' main, "the action ordering … is broken in both
// views"; "weird decisions for the last action").
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import type { Id } from "../src/model.ts";
import { isCall, subtree } from "../src/model.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";

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
  append(...els: El[]) { this.children.push(...this.adopt(els)); }
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

const draw = (folder: string, def: string) => {
  const p = loadProgram(join(root, "examples", folder));
  const svg = typedGraph(p.code, p.pres, infer(p.code, p.pres.names), p.named(def), {
    selected: null, select() {}, open() {}, canUse: () => null, use() {}, clear() {}, addDot() {},
    canShare: () => () => null, share() {}, at: {}, moved() {}, named: new Set(), folded: new Set(), order: true,
  } as never).root as unknown as El;
  return { p, svg };
};

test("a step with no name that nothing reads is numbered as a step, not a let called ?", () => {
  // ledger's usage, written as text: print error(…), then 2.
  const { svg } = draw("ledger", "usage");
  const titles = svg.all().map((e) => e.children.find((c) => c.tagName === "title")?.textContent ?? "");
  assert.ok(titles.some((t) => t.startsWith("Step 1 of 2")), "the print is step 1");
  assert.ok(!svg.all().some((e) => /\bdotl\b/.test(e.getAttribute("class") ?? "") && e.textContent === "?"), "no dot called ?");
});

test("a case whose value comes after steps is framed: its steps don't read as the definition's own", () => {
  // chapters' main: otherwise → print error(usage), then 2.
  const { p, svg } = draw("chapters", "main");
  const match = subtree(p.code, p.named("main")).map((x) => p.code.nodes[x]).find((n) => n.kind === "match" && n.otherwise && isCall(p.code.nodes[n.otherwise]))!;
  const otherwise = (match as { otherwise: Id }).otherwise;
  assert.ok(svg.all().some((e) => e.getAttribute("data-frame") === otherwise), "the otherwise case has a frame");
});
