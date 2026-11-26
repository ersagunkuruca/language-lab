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
  // The comment is the node's top row: inside the node's own group and
  // box, the box grown upward by the row, the whole comment on hover.
  const rows = open.all().filter((x) => /\bcmt-row\b/.test(x.getAttribute("class") ?? ""));
  assert.equal(rows.length, 1);
  // Cut to the box's width (abs is narrow), the whole on hover.
  assert.match(rows[0].children.find((c) => c.tagName === "text")!.textContent, /^how.*…$/);
  const node = open.all().find((x) => x.tagName === "g" && x.children.includes(rows[0]))!;
  assert.ok(node.children.some((c) => c.getAttribute("data-id") === abs || c.getAttribute("data-slot") === abs), "in abs's own node");
  const box = node.children.find((c) => c.tagName === "rect")!;
  assert.equal(Number(box.getAttribute("y")), -16);
  assert.match(box.children.find((c) => c.tagName === "title")?.textContent ?? "", /^how far apart/);
  assert.equal(open.all().filter((x) => /\bcmt-line\b/.test(x.getAttribute("class") ?? "")).length, 0, "no line floating above a node");
  assert.deepEqual(notes(open), []);
  // Every frame folded: the box that holds abs says its comment.
  const frames = new Set(open.all().map((x) => x.getAttribute("data-frame")).filter((x): x is string => !!x && x !== safe));
  assert.ok(frames.size > 0);
  assert.deepEqual(notes(svg(frames)), ["how far apart"]);
});

test("a frame's own comment is its top row too, open or folded, and a folded frame around it counts it (I381)", () => {
  const hooks = (folded: Set<string>) => ({
    selected: null, select() {}, open() {}, canUse: () => null, use() {}, clear() {}, addDot() {},
    canShare: () => () => null, share() {}, at: {}, moved() {}, named: new Set(), folded, fold() {}, order: false,
  }) as never;
  // A definition with a frame inside another: their boxes one inside the other.
  const box = (r: El) => ["x", "y", "width", "height"].map((k) => Number(r.getAttribute(k)));
  const within = (a: El, b: El) => { const [ax, ay, aw, ah] = box(a), [bx, by, bw, bh] = box(b); return a !== b && ax >= bx && ay >= by && ax + aw <= bx + bw && ay + ah <= by + bh; };
  const found = (() => {
    for (const ex of ["queens", "countdown", "pond-page"]) {
      const p = loadProgram(join(root, "examples", ex));
      for (const def of p.own.defs) {
        const e = typedGraph(p.code, p.pres, infer(p.code, p.pres.names), def, hooks(new Set())).root as unknown as El;
        const rects = e.all().filter((x) => x.tagName === "rect" && x.getAttribute("data-frame") && x.getAttribute("data-frame") !== def);
        const pair = rects.flatMap((a) => rects.filter((b) => within(a, b)).map((b) => [a, b]))[0];
        if (pair) return { p, def, inner: pair[0].getAttribute("data-frame")!, outer: pair[1].getAttribute("data-frame")! };
      }
    }
  })();
  assert.ok(found, "a frame inside another");
  const { p, def, inner, outer } = found;
  const pres = { ...p.pres, comments: { ...p.pres.comments, [inner]: "one queen against the others" } };
  const svg = (folded: Set<string>) => typedGraph(p.code, pres, infer(p.code, p.pres.names), def, hooks(folded)).root as unknown as El;
  const rowsOf = (e: El) => e.all().filter((x) => /\bcmt-row\b/.test(x.getAttribute("class") ?? "") && /^one queen/.test(x.children.find((c) => c.tagName === "text")?.textContent ?? ""));
  // Open: the row inside the frame's box, at its top, the title below it,
  // the whole comment on hover.
  const open = svg(new Set());
  const rows = rowsOf(open);
  assert.equal(rows.length, 1);
  const rect = open.all().find((x) => x.tagName === "rect" && x.getAttribute("data-frame") === inner)!;
  const [x, y] = box(rect);
  const rowY = Number(rows[0].children.find((c) => c.tagName === "text")!.getAttribute("y"));
  assert.ok(rowY > y && rowY < y + 16, "in the box's top row");
  assert.match(rect.children.find((c) => c.tagName === "title")?.textContent ?? "", /one queen against the others/);
  const title = open.all().find((c) => c.tagName === "text" && /\brt\b/.test(c.getAttribute("class") ?? "") && Number(c.getAttribute("x")) === x + 10 && Number(c.getAttribute("y")) > y && Number(c.getAttribute("y")) < y + 40)!;
  assert.ok(Number(title.getAttribute("y")) > rowY, "the title under the comment");
  // Folded: the folded box's own top row.
  const folded = svg(new Set([inner]));
  const fr = rowsOf(folded);
  assert.equal(fr.length, 1);
  const g = folded.all().find((x) => x.tagName === "g" && x.children.includes(fr[0]))!;
  assert.ok(g.children.some((c) => c.getAttribute("data-frame") === inner), "in the folded box's own group");
  // Folded inside a folded frame: that one's mark says it.
  const marks = svg(new Set([outer])).all().filter((x) => /\bcmt-mark\b/.test(x.getAttribute("class") ?? "")).map((x) => x.children.find((c) => c.tagName === "title")!.textContent);
  assert.ok(marks.some((m) => m.includes("one queen against the others")), marks.join(" | "));
});
