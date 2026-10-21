// The graph's coordinate math, on a tiny stand-in for the DOM: a node moved
// by an offset lands exactly that far from where it was, every frame around
// it grows to hold it (left and up too), and a frame's parameters stay on
// its left edge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import type { Id } from "../src/model.ts";
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
(globalThis as unknown as { document: unknown }).document = { createElementNS: (_: string, tag: string) => new El(tag) };
const { typedGraph } = await import("../editor/typedGraph.ts");

const p = loadProgram(join(root, "examples", "queens"));
const info = infer(p.code, p.pres.names);
const def = p.named("queens");
const draw = (offsets: Record<Id, { x: number; y: number }>) => typedGraph(p.code, p.pres, info, def, {
  selected: null, select() {}, open() {}, canUse: () => null, use() {}, clear() {}, addDot() {},
  canShare: () => () => null, share() {}, offsets, moved() {},
}) as unknown as El;

// Top-left corner of an element in the picture's coordinates.
const at = (svg: El, el: El) => {
  let x = Number(el.getAttribute("x") ?? el.getAttribute("cx") ?? 0), y = Number(el.getAttribute("y") ?? el.getAttribute("cy") ?? 0);
  for (let e: El | null = el; e && e !== svg; e = e.parentElement) {
    const m = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(e.getAttribute("transform") ?? "");
    if (m) { x += Number(m[1]); y += Number(m[2]); }
  }
  return { x, y };
};
const grabbed = (svg: El, id: Id) => svg.all().find((e) => e.getAttribute("data-move") === id)!;
const frames = (svg: El, el: El) => { const out: El[] = []; for (let e = el.parentElement; e; e = e.parentElement) for (const c of e.children) if (/\brg\b/.test(c.getAttribute("class") ?? "")) out.push(c); return out; };

const calls = p.code.nodes;
const safe = Object.values(calls).find((n) => n.kind === "call" && calls[n.fn].kind === "ref" && p.pres.names[(calls[n.fn] as { target: Id }).target] === "safe")!.id;

for (const off of [{ x: 120, y: 80 }, { x: -90, y: -40 }, { x: -170, y: 30 }]) {
  test(`a node moved by (${off.x}, ${off.y}) lands there, inside every frame around it`, () => {
    const before = draw({}), after = draw({ [safe]: off });
    const a = at(before, grabbed(before, safe)), b = at(after, grabbed(after, safe));
    assert.deepEqual({ x: b.x - a.x, y: b.y - a.y }, off);
    const r = grabbed(after, safe);
    const w = Number(r.getAttribute("width")), h = Number(r.getAttribute("height"));
    for (const f of frames(after, r)) {
      const fa = at(after, f);
      assert.ok(fa.x <= b.x && fa.y <= b.y, "frame starts above and left of the node");
      assert.ok(fa.x + Number(f.getAttribute("width")) >= b.x + w && fa.y + Number(f.getAttribute("height")) >= b.y + h, "frame ends below and right of it");
    }
    // Parameters sit on their frame's left edge.
    for (const src of after.all().filter((e) => e.tagName === "circle" && /\bsrc\b/.test(e.getAttribute("class") ?? ""))) {
      const f = src.parentElement!.children.find((c) => /\brg\b/.test(c.getAttribute("class") ?? ""));
      if (f) assert.equal(at(after, src).x, at(after, f).x);
    }
  });
}
