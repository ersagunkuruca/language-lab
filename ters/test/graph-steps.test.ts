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
  removeAttribute(k: string) { this.attrs.delete(k); }
  get childNodes() { return this.children; }
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

test("statements are one in order node, an input each, the value last", () => {
  // chapters' main: otherwise → print error(usage); 2. No frame round it:
  // the node holds the steps, and its output is the 2 (Ersagun 2026-11-22).
  const { p, svg } = draw("chapters", "main");
  const match = subtree(p.code, p.named("main")).map((x) => p.code.nodes[x]).find((n) => n.kind === "match" && n.otherwise && isCall(p.code.nodes[n.otherwise]))!;
  const otherwise = (match as { otherwise: Id }).otherwise;
  assert.ok(!svg.all().some((e) => e.getAttribute("data-frame") === otherwise), "no frame round the otherwise");
  const node = svg.all().find((e) => e.tagName === "rect" && e.getAttribute("data-id") === otherwise && /\border\b/.test(e.getAttribute("class") ?? ""));
  assert.ok(node, "the otherwise is an in order node");
  const g = node!.parentElement!;
  assert.deepEqual(g.children.filter((c) => c.getAttribute("class") === "portl").map((c) => c.textContent), ["1", "2"]);
});

test("order arrows run between actions only: none from a print to the value given after it", () => {
  // ledger's usage: print error(…), then 2. One action, so no arrow.
  assert.equal(draw("ledger", "usage").svg.all().filter((e) => e.getAttribute("class") === "then").length, 0);
});

test("a case that says what the otherwise says is drawn once", () => {
  // chapters' main: a list of one gives the usage message, as otherwise does.
  const { svg } = draw("chapters", "main");
  const usage = svg.all().filter((e) => e.tagName === "text" && /usage: chapters/.test(e.textContent));
  assert.equal(usage.length, 1, "the usage message once");
});


test("a node's comment is its top line, and a folded frame's mark says the comments of the nodes it hides (QA 11-22b L3, E316)", () => {
  const p = loadProgram(join(root, "examples", "queens"));
  const safe = p.named("safe");
  const abs = subtree(p.code, safe).find((x) => { const n = p.code.nodes[x]; return isCall(n) && p.pres.names[(p.code.nodes[n.fn] as { target?: string }).target ?? ""] === "abs"; })!;
  const pres = { ...p.pres, comments: { ...p.pres.comments, [abs]: "how far apart" } };
  const svg = (folded: Set<string>) => typedGraph(p.code, pres, infer(p.code, p.pres.names), safe, {
    selected: null, select() {}, open() {}, canUse: () => null, use() {}, clear() {}, addDot() {},
    canShare: () => () => null, share() {}, at: {}, moved() {}, named: new Set(), folded, fold() {}, order: false,
  } as never).root as unknown as El;
  const notes = (e: El) => e.all().filter((x) => /\bcmt-mark\b/.test(x.getAttribute("class") ?? "")).map((x) => x.children.find((c) => c.tagName === "title")!.textContent);
  const open = svg(new Set());
  // The line above the node, its text shown, the whole on hover, and the
  // node's body drawn below it.
  const lines = open.all().filter((x) => /\bcmt-line\b/.test(x.getAttribute("class") ?? ""));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].children.find((c) => c.tagName === "title")!.textContent, "how far apart");
  assert.equal(lines[0].children.find((c) => c.tagName === "text")!.textContent, "how far apart");
  const at = (e: El) => /translate\(([-\d.]+),([-\d.]+)\)/.exec(e.getAttribute("transform") ?? "")!.slice(1).map(Number);
  const body = open.all().find((x) => x.tagName === "g" && x.children.some((c) => c.getAttribute("data-id") === abs || c.getAttribute("data-slot") === abs));
  assert.ok(body, "abs's node");
  const [lx, ly] = at(lines[0]), [bx, by] = at(body!);
  assert.equal(bx, lx);
  assert.equal(by, ly + 16);
  assert.deepEqual(notes(open), []);
  // Every frame folded: the box that holds abs says its comment.
  const frames = new Set(open.all().map((x) => x.getAttribute("data-frame")).filter((x): x is string => !!x && x !== safe));
  assert.ok(frames.size > 0);
  assert.deepEqual(notes(svg(frames)), ["how far apart"]);
});
