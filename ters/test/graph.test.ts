// The graph's coordinate math, on a tiny stand-in for the DOM: a node put
// somewhere is drawn exactly there and nothing else moves (positions are
// free, not offsets from what a node feeds), every frame around it grows to
// hold it, a frame's parameters stay on its left edge, every wire still
// ends on the output it comes from, and a binding shown as let and get
// nodes has no wires to its uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import type { Id } from "../src/model.ts";
import { isCall } from "../src/model.ts";
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

const p = loadProgram(join(root, "examples", "queens"));
const info = infer(p.code, p.pres.names);
const def = p.named("queens");
const draw = (at: Record<Id, { x: number; y: number }>, named: Id[] = [], folded: Id[] = []) => typedGraph(p.code, p.pres, info, def, {
  selected: null, select() {}, open() {}, canUse: () => null, use() {}, clear() {}, addDot() {},
  canShare: () => () => null, share() {}, at, moved() {}, named: new Set(named), folded: new Set(folded),
}).root as unknown as El;

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
const safe = Object.values(calls).find((n) => isCall(n) && calls[n.fn].kind === "ref" && p.pres.names[(calls[n.fn] as { target: Id }).target] === "safe")!.id;

const frameOf = (svg: El, id: Id) => svg.all().find((e) => e.getAttribute("data-frame") === id)!;
const box = (svg: El, el: El) => { const a = at(svg, el); return { ...a, w: Number(el.getAttribute("width")), h: Number(el.getAttribute("height")) }; };

for (const to of [{ x: 400, y: 300 }, { x: -90, y: -40 }, { x: 20, y: 500 }]) {
  test(`a node put at (${to.x}, ${to.y}) is drawn there, nothing else moves, and its frames hold it`, () => {
    const before = draw({}), after = draw({ [safe]: to });
    assert.deepEqual(at(after, grabbed(after, safe)), to);
    // Every other node stays where it was.
    for (const e of before.all().filter((e) => e.getAttribute("data-move") && e.getAttribute("data-move") !== safe && !e.getAttribute("data-frame"))) {
      const id = e.getAttribute("data-move")!;
      assert.deepEqual(at(after, grabbed(after, id)), at(before, e), `${id} moved`);
    }
    // Every frame around it holds it.
    const b = box(after, grabbed(after, safe));
    const around: Id[] = [];
    for (const n of Object.values(calls)) if ((n.kind === "lambda" || n.kind === "arm") && JSON.stringify(n).length && contains(n.id, safe)) around.push(n.id);
    around.push(def);
    for (const f of around.map((id) => frameOf(after, id)).filter(Boolean)) {
      const fb = box(after, f);
      assert.ok(fb.x <= b.x && fb.y <= b.y, "frame starts above and left of the node");
      assert.ok(fb.x + fb.w >= b.x + b.w && fb.y + fb.h >= b.y + b.h, "frame ends below and right of it");
    }
  });
}

// Is `inner` somewhere under `outer` in the tree?
function contains(outer: Id, inner: Id): boolean {
  const n = calls[outer] as unknown as Record<string, unknown>;
  const kids = Object.values(n).flatMap((v) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v) : [])).filter((k): k is Id => typeof k === "string" && k in calls && k !== outer);
  return kids.some((k) => k === inner || (calls[k].kind !== "def" && contains(k, inner)));
}

test("a frame's parameters sit on its left edge", () => {
  const svg = draw({ [safe]: { x: -200, y: 40 } });
  const arm = Object.values(calls).find((n) => n.kind === "arm" && contains(n.id, safe) && n.binds.length) as { id: Id; binds: Id[] };
  const f = box(svg, frameOf(svg, arm.id));
  for (const b of arm.binds) {
    const c = svg.all().find((e) => e.tagName === "circle" && e.getAttribute("data-src") === b && /\bsrc\b/.test(e.getAttribute("class") ?? ""))!;
    assert.equal(at(svg, c).x, f.x);
  }
});

test("a binding shown as let and get nodes has get nodes and no wires to its uses", () => {
  const column = Object.keys(p.pres.names).find((id) => p.pres.names[id] === "column" && calls[id]?.kind === "binder" && contains(def, id))!;
  const wires = draw({}).all().filter((e) => /\buse-hit\b/.test(e.getAttribute("class") ?? "") && calls[e.getAttribute("data-id")!]?.kind === "ref" && (calls[e.getAttribute("data-id")!] as { target: Id }).target === column);
  assert.ok(wires.length >= 2, "as wires, it has a wire per use");
  const svg = draw({}, [column]);
  assert.equal(svg.all().filter((e) => /\buse-hit\b/.test(e.getAttribute("class") ?? "") && (calls[e.getAttribute("data-id")!] as { target?: Id }).target === column).length, 0);
  assert.equal(svg.all().filter((e) => /\bget\b/.test(e.getAttribute("class") ?? "")).length, wires.length);
  assert.ok(svg.all().some((e) => /\bletn\b/.test(e.getAttribute("class") ?? "") && e.getAttribute("data-id") === column), "a let node where it's bound");
});

// Each call's output circle, and the wire leaving it, must meet, however far
// its arguments were dragged (to the right of the call, for instance).
test("wires leave from the outputs they belong to, after any move", () => {
  const offsets: Record<Id, { x: number; y: number }> = {};
  for (const n of Object.values(calls)) if (isCall(n) && calls[n.fn].kind === "ref") offsets[n.id] = { x: 260, y: 20 };
  const svg = draw(offsets);
  const outs = svg.all().filter((e) => e.tagName === "circle" && /\boutp\b/.test(e.getAttribute("class") ?? "")).map((c) => at(svg, c));
  const starts = svg.all().filter((e) => e.tagName === "path" && /^tw\b/.test(e.getAttribute("class") ?? "") && !/use/.test(e.getAttribute("class") ?? ""))
    .map((w) => { const m = /^M([-\d.e]+),([-\d.e]+)/.exec(w.getAttribute("d")!)!; const p = at(svg, w); return { x: p.x + Number(m[1]), y: p.y + Number(m[2]) }; });
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
  // Every wire that starts at a node's output height starts at its circle.
  for (const o of outs) {
    const same = starts.filter((p) => Math.abs(p.y - o.y) < 0.5 && p.x >= o.x - 0.5);
    if (same.length) assert.ok(same.some((p) => near(p, o)), `a wire near the output at (${o.x}, ${o.y}) doesn't start on it`);
  }
});

test("a folded frame is one box where the frame was, with its wires in on the left and out on the right", () => {
  const open = draw({});
  // The biggest frame around safe, other than the definition's.
  const around = Object.values(calls).filter((n) => (n.kind === "lambda" || n.kind === "arm") && contains(n.id, safe) && frameOf(open, n.id));
  const f = around.map((n) => n.id).sort((a, b) => box(open, frameOf(open, b)).w - box(open, frameOf(open, a)).w)[0];
  const was = box(open, frameOf(open, f));
  const svg = draw({}, [], [f]);
  assert.equal(grabbed(svg, safe), undefined, "what it holds is hidden");
  const folded = frameOf(svg, f);
  assert.match(folded.getAttribute("class")!, /\bfolded\b/);
  const b = box(svg, folded);
  assert.deepEqual({ x: b.x, y: b.y }, { x: was.x, y: was.y });
  const ends = svg.all().filter((e) => e.tagName === "path" && /^tw\b/.test(e.getAttribute("class") ?? "")).map((w) => {
    const n = w.getAttribute("d")!.match(/-?[\d.]+(e-?\d+)?/g)!.map(Number);
    return { from: { x: n[0], y: n[1] }, to: { x: n.at(-2)!, y: n.at(-1)! } };
  });
  const on = (q: { x: number; y: number }, x: number) => Math.abs(q.x - x) < 0.5 && Math.abs(q.y - (b.y + b.h / 2)) < 0.5;
  assert.ok(ends.some((e) => on(e.to, b.x)), "a wire comes in on the left");
  assert.ok(ends.some((e) => on(e.from, b.x + b.w)), "a wire goes out on the right");
  assert.ok(ends.length < open.all().filter((e) => e.tagName === "path" && /^tw\b/.test(e.getAttribute("class") ?? "")).length, "wires inside are not drawn");
});

const labelsOf = (example: string, d: string) => {
  const l = loadProgram(join(root, "examples", example));
  const svg = typedGraph(l.code, l.pres, infer(l.code, l.pres.names), l.named(d), {
    selected: null, select() {}, open() {}, canUse: () => null, use() {}, clear() {}, addDot() {},
    canShare: () => () => null, share() {}, at: {}, moved() {}, named: new Set(), folded: new Set(),
  }).root as unknown as El;
  return svg.all().filter((e) => /^(cl|portl|rt)$/.test(e.getAttribute("class") ?? "")).map((e) => e.textContent);
};

test("a field read is labelled .field, so what's wired into it reads as p.field", () => {
  const labels = labelsOf("ledger", "larger");
  assert.ok(labels.includes(".cents") && labels.includes(".name"), labels.join(" "));
  assert.ok(!labels.includes("cents") && !labels.includes("name"), labels.join(" "));
});

test("a value of a one-case type taken apart is drawn as the let of its fields, then what runs next", () => {
  const labels = labelsOf("countdown", "results");
  assert.ok(labels.includes("halves(front, back) =") && labels.includes("found(expr, value) ="), labels.join(" | "));
  assert.ok(!labels.includes("match Halves") && !labels.includes("match Found"), labels.join(" | "));
  assert.ok(labelsOf("countdown", "valid").includes("match Op"));
});

test("an action handed to a handler is a frame titled action, not () =>", () => {
  const labels = labelsOf("queens", "main");
  assert.ok(labels.includes("action") && !labels.includes("() =>"), labels.join(" | "));
  assert.ok(labels.includes("(board) =>"), labels.join(" | "));
});

// A use with no body (L211) gives its produced ports: saved programs are
// moved to it as a let of the use, each read of an old binder becoming a
// part read of the let's binder (a plain read for one port). The graph draws
// each produced port as an output on the use, wired straight to what reads
// it, with no dot for the let.
test("a use with no body has an output per produced port, wired to what reads each", async () => {
  const { answerKeys } = await import("../src/lang/ports.ts");
  const { tuplePart } = await import("../src/lang/std.ts");
  const l = loadProgram(join(root, "examples", "backwards"));
  const nodes = l.code.nodes;
  const moved: { def: Id; use: Id; dot: Id; ports: number; readers: [Id, number][] }[] = [];
  // The library's uses are in today's shape (L211i): a use with no body,
  // given to a let of its value, each read of a port a part of the value.
  for (const d of l.code.defs) {
    for (const id of under(nodes, d)) {
      const n = nodes[id];
      if (n.kind !== "call" || n.given || n.args.length !== 1) continue;
      const lam = nodes[n.fn], use = nodes[n.args[0]];
      if (lam?.kind !== "lambda" || lam.params.length !== 1 || use?.kind !== "call" || !use.given || use.body !== undefined) continue;
      const dot = lam.params[0], ports = answerKeys(l.code, use as never);
      if (ports.length < 1 || ports.length > 8) continue;
      const readers: [Id, number][] = [];
      for (const r of Object.values(nodes)) {
        if (ports.length === 1) { if (r.kind === "ref" && r.target === dot) readers.push([r.id, 0]); continue; }
        if (r.kind !== "call" || r.given || r.args.length !== 1) continue;
        const f = nodes[r.fn], from = nodes[r.args[0]];
        if (f?.kind !== "ref" || from?.kind !== "ref" || from.target !== dot) continue;
        const i = ports.findIndex((_, k) => tuplePart(ports.length, k) === f.target);
        if (i >= 0) readers.push([r.id, i]);
      }
      moved.push({ def: d, use: use.id, dot, ports: ports.length, readers });
    }
    // A use whose body only gave its one port is the use itself.
    for (const id of under(nodes, d)) {
      const u = nodes[id];
      if (u.kind !== "call" || !u.given || u.body !== undefined || moved.some((m) => m.use === id)) continue;
      const ports = answerKeys(l.code, u as never);
      if (ports.length === 1) moved.push({ def: d, use: id, dot: "", ports: 1, readers: [] });
    }
  }
  assert.ok(moved.some((m) => m.ports > 1) && moved.some((m) => m.ports === 1), JSON.stringify(moved));
  const info = infer(l.code, l.pres.names);
  for (const m of moved) {
    const svg = typedGraph(l.code, l.pres, info, m.def, {
      selected: null, select() {}, open() {}, canUse: () => null, use() {}, clear() {}, addDot() {},
      canShare: () => () => null, share() {}, at: {}, moved() {}, named: new Set(), folded: new Set(),
    }).root as unknown as El;
    assert.equal(svg.all().filter((e) => e.getAttribute("data-src") === m.dot).length, 0, `no dot for ${m.dot}`);
    const use = grabbed(svg, m.use);
    assert.ok(use, `${m.use} is drawn`);
    const outs = use.parentElement!.children.filter((e) => e.tagName === "circle" && /\boutp\b/.test(e.getAttribute("class") ?? "")).map((c) => at(svg, c)).sort((a, b) => a.y - b.y);
    assert.equal(outs.length, m.ports, `an output per produced port on ${m.use}`);
    for (const [r, i] of m.readers) {
      const w = svg.all().find((e) => e.tagName === "path" && e.getAttribute("class") === "use-hit" && e.getAttribute("data-id") === r);
      assert.ok(w, `a wire to ${r}`);
      const mm = /^M([-\d.e]+),([-\d.e]+)/.exec(w!.getAttribute("d")!)!, o = at(svg, w!), start = { x: o.x + Number(mm[1]), y: o.y + Number(mm[2]) };
      assert.ok(Math.abs(outs[i].x - start.x) < 0.5 && Math.abs(outs[i].y - start.y) < 0.5, `the wire to ${r} starts on port ${i} of ${m.use}`);
    }
  }
});

// Every node under a definition, the definition included.
function under(nodes: Record<Id, unknown>, top: Id): Id[] {
  const out: Id[] = [], seen = new Set<Id>([top]), todo = [top];
  while (todo.length) {
    const id = todo.pop()!;
    out.push(id);
    const n = nodes[id] as Record<string, unknown>;
    for (const [k, v] of Object.entries(n)) {
      if (k === "target" || k === "id") continue;
      for (const c of Array.isArray(v) ? v : typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v) : []) if (typeof c === "string" && c in nodes && !seen.has(c)) { seen.add(c); todo.push(c); }
    }
  }
  return out;
}
