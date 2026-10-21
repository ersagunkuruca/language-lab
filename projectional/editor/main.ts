// Browser editor over the same core as the CLI demo. The tree is edited by
// gestures (select, rename, wrap, replace, delete), never by typing code, and
// every gesture is labelled with the file it changes.

import codeFile from "../examples/quadratic/code.json" with { type: "json" };
import shortNames from "../examples/quadratic/names.short.json" with { type: "json" };
import descriptiveNames from "../examples/quadratic/names.descriptive.json" with { type: "json" };
import commentsFile from "../examples/quadratic/comments.json" with { type: "json" };
import hintsFile from "../examples/quadratic/hints.json" with { type: "json" };
import mathStyle from "../styles/math.json" with { type: "json" };
import plainStyle from "../styles/plain.json" with { type: "json" };
import lispStyle from "../styles/lisp.json" with { type: "json" };
import graphStyle from "../styles/graph.json" with { type: "json" };
import { evaluate } from "../src/eval.ts";
import { hashDef } from "../src/hash.ts";
import { collect, freshId, merge, parentOf, subtree, swapIn, type Code, type Id, type Node, type NodeData } from "../src/model.ts";
import { layer, type Comments, type Hints, type Names, type Presentation, type Style } from "../src/presentation.ts";
import { impl, prelude, preludeNames } from "../src/prelude.ts";
import { renderLet } from "../src/render/letseq.ts";
import { renderNested } from "../src/render/nested.ts";
import { renderSexpr } from "../src/render/sexpr.ts";
import { Namer } from "../src/render/namer.ts";

// ---------------------------------------------------------------- state

type Layer = "short" | "descriptive";
type StyleName = "math" | "plain" | "lisp";
type TextView = "nested" | "let" | "sexpr";
type Pos = { x: number; y: number };

interface Doc {
  code: Code;
  names: Record<Layer, Names>;
  comments: Comments;
  hints: Hints;
  layout: Record<string, Pos>;
}

interface UI {
  def: Id;
  selected: Id | null;
  layer: Layer;
  style: StyleName;
  text: TextView;
  touched: string[];
  note: string;
  mode: null | "wrap" | "replace";
  query: string;
  args: Record<Id, string>;
}

const styles: Record<StyleName, Style> = { math: mathStyle as unknown as Style, plain: plainStyle as unknown as Style, lisp: lispStyle as unknown as Style };
const STORE = "projectional-editor-v1";

const initial = (): Doc => ({
  code: merge(prelude, codeFile as Code),
  names: { short: shortNames, descriptive: descriptiveNames },
  comments: commentsFile,
  hints: hintsFile,
  layout: {},
});

let doc: Doc = initial();
try {
  const saved = localStorage.getItem(STORE);
  if (saved) doc = JSON.parse(saved);
} catch {}

const ui: UI = {
  def: doc.code.defs[1] ?? doc.code.defs[0],
  selected: null,
  layer: "descriptive",
  style: "math",
  text: "let",
  touched: [],
  note: "Select anything in the blocks or the graph.",
  mode: null,
  query: "",
  args: {},
};

const undo: Doc[] = [];
const redo: Doc[] = [];

function commit(next: Partial<Doc>, touched: string[], note: string) {
  undo.push(doc);
  redo.length = 0;
  doc = { ...doc, ...next };
  ui.touched = touched;
  ui.note = note;
  ui.mode = null;
  save();
  render();
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(doc)); } catch {}
}

function travel(from: Doc[], to: Doc[], label: string) {
  const d = from.pop();
  if (!d) return;
  to.push(doc);
  const changed = files().filter((f) => f.get(d) !== f.get(doc)).map((f) => f.name);
  doc = d;
  if (ui.selected && !doc.code.nodes[ui.selected]) ui.selected = null;
  ui.touched = changed;
  ui.note = `${label}: ${changed.join(", ") || "nothing"} changed back.`;
  ui.mode = null;
  save();
  render();
}

// ---------------------------------------------------------------- helpers

const pres = (): Presentation => ({
  names: layer<Names>(preludeNames, doc.names.short, ui.layer === "descriptive" ? doc.names.descriptive : {}),
  comments: doc.comments,
  hints: doc.hints,
  style: { ...styles[ui.style], quote: undefined },
});

const node = (id: Id) => doc.code.nodes[id];
const userCode = (c: Code): Code => ({ nodes: Object.fromEntries(Object.entries(c.nodes).filter(([, n]) => n.kind !== "builtin")), defs: c.defs });

const files = () => [
  { name: "code.json", get: (d: Doc) => JSON.stringify(userCode(d.code)) },
  { name: "names.short.json", get: (d: Doc) => JSON.stringify(d.names.short) },
  { name: "names.descriptive.json", get: (d: Doc) => JSON.stringify(d.names.descriptive) },
  { name: "comments.json", get: (d: Doc) => JSON.stringify(d.comments) },
  { name: "layout.json", get: (d: Doc) => JSON.stringify(d.layout) },
];

function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function h(tag: string, attrs: Record<string, string | boolean | undefined> = {}, ...kids: (Node_ | string | null | undefined | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}
type Node_ = HTMLElement | SVGElement;

function svg(tag: string, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function semanticHash(): string {
  try { return hashDef(doc.code, ui.def); } catch (e) { return "—"; }
}

// Binders visible at `id`: the params of every enclosing lambda.
function scopeAt(id: Id): Id[] {
  const out: Id[] = [];
  let cur: Id | null = id;
  while (cur) {
    const at = parentOf(doc.code, cur);
    if (!at) break;
    const p = node(at.parent);
    // Covers lets too: a let is an applied lambda, so its names are visible in
    // its body and not in the values bound.
    if (p.kind === "lambda" && at.slot === "body") out.unshift(...p.params);
    cur = at.parent;
  }
  return out;
}

// Every way a thing can be called: any layer's name, any style's glyph, its op.
function aliases(id: Id): string[] {
  const n = node(id);
  const out = [doc.names.short[id], doc.names.descriptive[id], preludeNames[id]];
  for (const s of [...Object.values(styles), graphStyle as unknown as Style]) out.push(s.notation[id]?.glyph);
  if (n?.kind === "builtin") out.push(n.op);
  return [...new Set(out.filter((x): x is string => !!x))];
}

function arity(id: Id): number {
  const n = node(id);
  if (n.kind === "builtin") return impl[n.op as keyof typeof impl].length;
  if (n.kind === "def" && n.body) {
    const b = node(n.body);
    if (b.kind === "lambda") return b.params.length;
  }
  return 1;
}

function add(code: Code, data: NodeData): Id {
  const id = freshId();
  code.nodes[id] = { id, ...data } as Node;
  return id;
}

const isExpr = (n: Node) => n.kind === "lit" || n.kind === "ref" || n.kind === "call" || n.kind === "lambda" || n.kind === "hole";

// ---------------------------------------------------------------- gestures

function rename(id: Id, value: string) {
  const names = { ...doc.names[ui.layer] };
  if (value.trim()) names[id] = value; else delete names[id];
  const what = node(id).kind === "call" ? (value.trim() ? "Named this step" : "Inlined this step") : "Renamed";
  commit({ names: { ...doc.names, [ui.layer]: names } }, [`names.${ui.layer}.json`], `${what}. Only names.${ui.layer}.json changed; the meaning hash is the same.`);
}

function setComment(id: Id, value: string) {
  const comments = { ...doc.comments };
  if (value.trim()) comments[id] = value; else delete comments[id];
  commit({ comments }, ["comments.json"], "Comment saved on the node itself, not on a line.");
}

function setLiteral(id: Id, raw: string) {
  const v = Number(raw);
  const value = raw.trim() !== "" && Number.isFinite(v) ? v : raw;
  const code = { nodes: { ...doc.code.nodes, [id]: { id, kind: "lit", value } as Node }, defs: doc.code.defs };
  commit({ code }, ["code.json"], "Changed a literal. That is a change in meaning, so the hash moved.");
}

function wrap(sel: Id, fn: Id) {
  // Point the parent at the new call first, so `sel` has exactly one parent
  // when we look it up.
  const call = freshId();
  const code = swapIn(doc.code, sel, call);
  const n = arity(fn);
  const args = [sel, ...Array.from({ length: Math.max(0, n - 1) }, () => add(code, { kind: "hole" }))];
  code.nodes[call] = { id: call, kind: "call", fn: add(code, { kind: "ref", target: fn }), args };
  ui.selected = n > 1 ? args[1] : call;
  commit({ code }, ["code.json"], `Wrapped in ${aliases(fn)[0]}. The wrapped part kept its ids, so its names and comments came along.`);
}

function replaceWith(sel: Id, data: NodeData, label: string) {
  let code = { nodes: { ...doc.code.nodes }, defs: doc.code.defs };
  const id = add(code, data);
  code = collect(swapIn(code, sel, id));
  ui.selected = id;
  commit({ code }, ["code.json"], label);
}

// ---------------------------------------------------------------- render: blocks

function blocks(namer: Namer, p: Presentation): HTMLElement {
  const def = node(ui.def);
  if (def.kind !== "def") return h("div");

  const pill = (id: Id, cls: string, text: string) =>
    h("button", { class: `pill ${cls}${ui.selected === id ? " sel" : ""}`, "data-id": id, type: "button" }, text);

  const block = (id: Id): HTMLElement => {
    const n = node(id);
    const named = n.kind === "call" && p.names[id] !== undefined;
    const noted = doc.comments[id] !== undefined;
    const wrapEl = (cls: string, ...kids: (HTMLElement | string)[]) =>
      h("div", { class: `blk ${cls}${ui.selected === id ? " sel" : ""}`, "data-id": id },
        named ? h("span", { class: "tag" }, namer.name(id)) : null,
        noted ? h("span", { class: "note-dot", title: "Has a comment" }) : null,
        ...kids);
    switch (n.kind) {
      case "lit": return pill(id, "lit", String(n.value));
      case "hole": return pill(id, "hole", "□");
      case "ref": {
        const t = node(n.target);
        return pill(id, t.kind === "binder" ? "var" : t.kind === "def" ? "def" : "op", namer.name(n.target));
      }
      case "lambda":
        return wrapEl("lam", h("span", { class: "kw" }, "λ"), ...n.params.map((b) => pill(b, "var binder", namer.name(b))), h("span", { class: "kw" }, "→"), block(n.body));
      case "call": {
        const fn = node(n.fn);
        if (fn.kind === "lambda") {
          return wrapEl("let",
            ...fn.params.flatMap((b, i) => [h("div", { class: "row" }, h("span", { class: "kw" }, "let"), pill(b, "var binder", namer.name(b)), h("span", { class: "kw" }, "="), block(n.args[i]))]),
            h("div", { class: "row" }, h("span", { class: "kw" }, "in"), block(fn.body)));
        }
        if (fn.kind !== "ref") return wrapEl("op", block(n.fn), ...n.args.map(block));
        const t = node(fn.target);
        const cat = t.kind === "def" ? "def" : "op";
        const nota = p.style.notation[fn.target];
        const op = h("span", { class: "fn" }, nota?.glyph ?? namer.name(fn.target));
        if (nota?.fixity === "infix" && n.args.length === 2) return wrapEl(cat, block(n.args[0]), op, block(n.args[1]));
        if (nota?.fixity === "prefix" && n.args.length === 1) return wrapEl(cat, op, block(n.args[0]));
        return wrapEl(cat, op, ...n.args.map(block));
      }
      default: return h("span");
    }
  };

  const head = h("div", { class: "def-head" }, pill(ui.def, "def", namer.name(ui.def)), h("span", { class: "kw" }, "="));
  return h("div", { class: "def-card" }, head, def.body ? block(def.body) : h("span", { class: "kw" }, "extern"));
}

// ---------------------------------------------------------------- render: graph

interface GNode { key: string; label: string; sub?: string; cls: string; select: Id; ports: number }
interface GEdge { from: string; to: string; port: number }

function graphModel(namer: Namer, p: Presentation) {
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const put = (g: GNode) => { if (!nodes.has(g.key)) nodes.set(g.key, g); return g.key; };
  const glyph = (t: Id) => p.style.notation[t]?.glyph ?? namer.name(t);

  const source = (id: Id): string => {
    const n = node(id);
    switch (n.kind) {
      case "lit": return put({ key: id, label: String(n.value), cls: "lit", select: id, ports: 0 });
      case "hole": return put({ key: id, label: "□", cls: "hole", select: id, ports: 0 });
      case "ref": {
        const t = node(n.target);
        if (t.kind === "binder") return put({ key: n.target, label: namer.name(n.target), cls: "var", select: n.target, ports: 0 });
        return put({ key: "g" + n.target, label: glyph(n.target), cls: "def", select: n.target, ports: 0 });
      }
      case "lambda": return put({ key: id, label: "λ " + n.params.map((b) => namer.name(b)).join(", "), cls: "lam", select: id, ports: 0 });
      case "call": {
        const fn = node(n.fn);
        if (fn.kind === "lambda") {
          n.args.forEach((a, i) => {
            const b = put({ key: fn.params[i], label: namer.name(fn.params[i]), cls: "var let", select: fn.params[i], ports: 1 });
            edges.push({ from: source(a), to: b, port: 0 });
          });
          return source(fn.body);
        }
        const label = fn.kind === "ref" ? glyph(fn.target) : "apply";
        const cls = fn.kind === "ref" && node(fn.target).kind === "def" ? "def" : "op";
        const k = put({ key: id, label, sub: p.names[id], cls, select: id, ports: n.args.length });
        n.args.forEach((a, i) => edges.push({ from: source(a), to: k, port: i }));
        return k;
      }
      default: return put({ key: id, label: n.kind, cls: "lit", select: id, ports: 0 });
    }
  };

  const def = node(ui.def);
  if (def.kind === "def" && def.body) {
    let body = def.body;
    const b = node(body);
    if (b.kind === "lambda") {
      b.params.forEach((x) => put({ key: x, label: namer.name(x), cls: "var param", select: x, ports: 0 }));
      body = b.body;
    }
    const out = put({ key: "out", label: namer.name(ui.def), cls: "out", select: ui.def, ports: 1 });
    edges.push({ from: source(body), to: out, port: 0 });
  }
  return { nodes: [...nodes.values()], edges };
}

const W = (g: GNode) => Math.max(48, g.label.length * 8.5 + 26, (g.sub?.length ?? 0) * 7 + 20);
const H = (g: GNode) => Math.max(g.sub ? 46 : 32, g.ports * 16 + 8);

function autoLayout(nodes: GNode[], edges: GEdge[]): Map<string, Pos> {
  const rank = new Map<string, number>();
  const inc = (k: string) => edges.filter((e) => e.to === k).map((e) => e.from);
  const r = (k: string, seen = new Set<string>()): number => {
    if (rank.has(k)) return rank.get(k)!;
    if (seen.has(k)) return 0;
    seen.add(k);
    const v = Math.max(-1, ...inc(k).map((s) => r(s, seen))) + 1;
    rank.set(k, v);
    return v;
  };
  nodes.forEach((n) => r(n.key));
  const cols = new Map<number, GNode[]>();
  for (const n of nodes) cols.set(rank.get(n.key)!, [...(cols.get(rank.get(n.key)!) ?? []), n]);
  const pos = new Map<string, Pos>();
  let x = 20;
  for (const c of [...cols.keys()].sort((a, b) => a - b)) {
    const col = cols.get(c)!;
    col.forEach((n, i) => pos.set(n.key, { x, y: 20 + i * 64 }));
    x += Math.max(...col.map(W)) + 56;
  }
  return pos;
}

// Saved positions are keyed by def + graph key, so each def has its own layout.
const lkey = (k: string) => `${ui.def}/${k}`;

function graph(namer: Namer, p: Presentation): SVGSVGElement {
  const { nodes, edges } = graphModel(namer, p);
  const auto = autoLayout(nodes, edges);
  const pos = new Map(nodes.map((n) => [n.key, doc.layout[lkey(n.key)] ?? auto.get(n.key)!]));
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const maxX = Math.max(300, ...nodes.map((n) => pos.get(n.key)!.x + W(n))) + 20;
  const maxY = Math.max(200, ...nodes.map((n) => pos.get(n.key)!.y + H(n))) + 20;
  const root = svg("svg", { viewBox: `0 0 ${maxX} ${maxY}`, width: maxX, height: maxY, class: "graph" }) as SVGSVGElement;

  const selectedTarget = ui.selected && node(ui.selected)?.kind === "ref" ? (node(ui.selected) as { target: Id }).target : null;
  const edgeLayer = svg("g");
  root.append(edgeLayer);
  const drawEdges = () => {
    edgeLayer.replaceChildren();
    for (const e of edges) {
      const a = byKey.get(e.from)!, b = byKey.get(e.to)!;
      const pa = pos.get(e.from)!, pb = pos.get(e.to)!;
      const sx = pa.x + W(a), sy = pa.y + H(a) / 2;
      const tx = pb.x, ty = pb.y + (H(b) * (e.port + 1)) / (Math.max(1, b.ports) + 1);
      const dx = Math.max(30, Math.abs(tx - sx) / 2);
      edgeLayer.append(svg("path", { d: `M${sx},${sy} C${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`, class: "wire" }));
      if (b.ports > 1) edgeLayer.append(Object.assign(svg("text", { x: tx - 4, y: ty - 4, class: "port", "text-anchor": "end" }), { textContent: String(e.port + 1) }));
    }
  };
  drawEdges();

  for (const n of nodes) {
    const g = svg("g", { class: `gn ${n.cls}${ui.selected === n.select || selectedTarget === n.select ? " sel" : ""}`, "data-id": n.select, tabindex: 0 });
    const place = () => { const q = pos.get(n.key)!; g.setAttribute("transform", `translate(${q.x},${q.y})`); };
    place();
    const round = n.cls.includes("var") ? H(n) / 2 : n.cls === "out" ? 2 : 7;
    g.append(svg("rect", { width: W(n), height: H(n), rx: round }));
    g.append(Object.assign(svg("text", { x: W(n) / 2, y: n.sub ? 19 : H(n) / 2 + 5, "text-anchor": "middle", class: "lbl" }), { textContent: n.label }));
    if (n.sub) g.append(Object.assign(svg("text", { x: W(n) / 2, y: 36, "text-anchor": "middle", class: "sub" }), { textContent: n.sub }));

    g.addEventListener("pointerdown", (ev) => {
      const start = { x: ev.clientX, y: ev.clientY };
      const orig = { ...pos.get(n.key)! };
      const scale = root.getBoundingClientRect().width / maxX || 1;
      let moved = false;
      g.setPointerCapture(ev.pointerId);
      const move = (e: PointerEvent) => {
        const dx = (e.clientX - start.x) / scale, dy = (e.clientY - start.y) / scale;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        pos.set(n.key, { x: Math.max(0, orig.x + dx), y: Math.max(0, orig.y + dy) });
        place();
        drawEdges();
      };
      const up = () => {
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        if (moved) {
          const layout = { ...doc.layout };
          for (const [k, v] of pos) layout[lkey(k)] = { x: Math.round(v.x), y: Math.round(v.y) };
          commit({ layout }, ["layout.json"], "Moved a node. Positions live in layout.json; the code is untouched.");
        } else select(n.select);
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
    });
    root.append(g);
  }
  return root;
}

// ---------------------------------------------------------------- render: inspector

function kindLabel(id: Id): string {
  const n = node(id);
  if (n.kind === "binder") return "Variable";
  if (n.kind === "def") return "Definition";
  if (n.kind === "call") {
    const fn = node(n.fn);
    return fn.kind === "lambda" ? "Let" : "Step (call)";
  }
  return { lit: "Literal", ref: "Reference", lambda: "Function", hole: "Hole", builtin: "Builtin" }[n.kind] ?? n.kind;
}

function inspector(namer: Namer, p: Presentation): HTMLElement {
  const id = ui.selected;
  if (!id || !node(id)) return h("div", { class: "empty" }, "Nothing selected. Click a block or a graph node.");
  const n = node(id);
  const out = h("div", { class: "insp" });
  out.append(h("div", { class: "insp-head" }, h("span", { class: "kind" }, kindLabel(id)), h("code", { class: "nid" }, id)));

  if (n.kind === "ref") {
    const t = n.target;
    out.append(h("p", { class: "hint" }, "Points at ", h("code", {}, t), ` (${namer.name(t)}) by id. Renaming that changes every reference at once, because there is nothing else to change.`));
    if (node(t).kind === "binder" || node(t).kind === "def") {
      out.append(h("button", { class: "btn ghost", type: "button", "data-act": "goto", "data-target": t }, "Select what it points at"));
    }
  }

  const nameable = n.kind === "binder" || n.kind === "def" || n.kind === "call";
  if (nameable) {
    const current = doc.names[ui.layer][id] ?? (ui.layer === "descriptive" ? doc.names.short[id] : "") ?? "";
    const label = n.kind === "call" ? "Step name" : "Name";
    const input = h("input", { id: "f-name", type: "text", value: current ?? "", placeholder: n.kind === "call" ? "unnamed step" : "", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
    input.addEventListener("change", () => rename(id, input.value));
    out.append(h("label", { class: "field", for: "f-name" }, h("span", {}, `${label} · names.${ui.layer}.json`), input));
    out.append(h("p", { class: "hint" }, n.kind === "call"
      ? "A named step gets its own line in the let view and a label in the graph. Clearing the name inlines it again."
      : "Any text works, spaces and symbols included. Two things may share a name."));
  }

  if (n.kind === "lit") {
    const input = h("input", { id: "f-lit", type: "text", value: String(n.value), autocomplete: "off" }) as HTMLInputElement;
    input.addEventListener("change", () => setLiteral(id, input.value));
    out.append(h("label", { class: "field", for: "f-lit" }, h("span", {}, "Value · code.json"), input));
  }

  const ta = h("textarea", { id: "f-comment", rows: "2", placeholder: "Add a note to this node" }) as HTMLTextAreaElement;
  ta.value = doc.comments[id] ?? "";
  ta.addEventListener("change", () => setComment(id, ta.value));
  out.append(h("label", { class: "field", for: "f-comment" }, h("span", {}, "Comment · comments.json"), ta));
  out.append(h("p", { class: "hint" }, "Write {", h("i", {}, "id"), "} to mention a node; it shows that node's current name."));

  if (isExpr(n)) {
    const acts = h("div", { class: "acts" });
    acts.append(
      h("button", { class: `btn${ui.mode === "wrap" ? " on" : ""}`, type: "button", "data-act": "wrap" }, "Wrap in…"),
      h("button", { class: `btn${ui.mode === "replace" ? " on" : ""}`, type: "button", "data-act": "replace" }, n.kind === "hole" ? "Fill…" : "Replace with…"),
      n.kind !== "hole" ? h("button", { class: "btn danger", type: "button", "data-act": "delete" }, "Delete") : "",
    );
    out.append(h("div", { class: "sub-head" }, "Change meaning · code.json"), acts);
    if (ui.mode) out.append(picker(id, namer));
  }
  return out;
}

function picker(sel: Id, namer: Namer): HTMLElement {
  const q = ui.query.trim().toLowerCase();
  const match = (strs: string[]) => !q || strs.some((s) => s.toLowerCase().includes(q));
  type Opt = { label: string; detail: string; run: () => void };
  const opts: Opt[] = [];

  if (ui.mode === "wrap") {
    const fns = [...Object.values(doc.code.nodes).filter((n) => n.kind === "builtin").map((n) => n.id),
      ...doc.code.defs.filter((d) => d !== ui.def && node(d).kind === "def" && (node(d) as { body: Id | null }).body)];
    for (const f of fns) {
      const al = aliases(f);
      if (match(al)) opts.push({ label: namer.name(f), detail: al.filter((a) => a !== namer.name(f)).join("  ") , run: () => wrap(sel, f) });
    }
  } else {
    for (const b of scopeAt(sel)) {
      if (match(aliases(b))) opts.push({ label: namer.name(b), detail: `variable ${b}`, run: () => replaceWith(sel, { kind: "ref", target: b }, `Now refers to ${namer.name(b)} by id.`) });
    }
    for (const d of doc.code.defs) {
      if (d === ui.def || !match(aliases(d))) continue;
      opts.push({ label: namer.name(d), detail: `definition ${d}`, run: () => replaceWith(sel, { kind: "ref", target: d }, `Now refers to ${namer.name(d)} by id.`) });
    }
    const num = Number(ui.query);
    if (ui.query.trim() !== "" && Number.isFinite(num)) {
      opts.unshift({ label: String(num), detail: "number", run: () => replaceWith(sel, { kind: "lit", value: num }, "Replaced with a literal.") });
    }
    if (match(["hole", "empty", "□"])) opts.push({ label: "□", detail: "empty hole", run: () => replaceWith(sel, { kind: "hole" }, "Replaced with a hole.") });
  }

  const input = h("input", { id: "f-query", type: "search", value: ui.query, autocomplete: "off", spellcheck: "false",
    placeholder: ui.mode === "wrap" ? "Search by any name or symbol: *, ×, multiply…" : "Variable, definition or number" }) as HTMLInputElement;
  input.addEventListener("input", () => {
    ui.query = input.value;
    const pos = input.selectionStart;
    render();
    const again = document.getElementById("f-query") as HTMLInputElement | null;
    again?.focus();
    if (again && pos !== null) again.setSelectionRange(pos, pos);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && opts[0]) opts[0].run(); if (e.key === "Escape") { ui.mode = null; render(); } });
  const list = h("div", { class: "opts" });
  opts.slice(0, 12).forEach((o) => {
    const b = h("button", { class: "opt", type: "button" }, h("span", { class: "opt-l" }, o.label), h("span", { class: "opt-d" }, o.detail));
    b.addEventListener("click", o.run);
    list.append(b);
  });
  if (!opts.length) list.append(h("p", { class: "hint" }, "Nothing matches."));
  return h("div", { class: "picker" }, input, list);
}

// ---------------------------------------------------------------- render: side panels

function filesPanel(): HTMLElement {
  const box = h("div", { class: "files" });
  const meaning = semanticHash();
  const prevMeaning = (() => {
    const prev = undo.at(-1);
    if (!prev) return meaning;
    try { return hashDef(prev.code, ui.def); } catch { return "—"; }
  })();
  box.append(h("div", { class: `meaning${meaning !== prevMeaning ? " moved" : ""}` },
    h("span", {}, "Meaning hash"), h("code", {}, meaning),
    h("span", { class: "chip" }, meaning === prevMeaning ? "same as before last edit" : "changed by last edit")));
  for (const f of files()) {
    const txt = f.get(doc);
    box.append(h("div", { class: `file${ui.touched.includes(f.name) ? " hot" : ""}` },
      h("span", { class: "fname" }, f.name), h("code", {}, fnv(txt)), h("span", { class: "fsize" }, `${txt.length} B`)));
  }
  const orphans = [...Object.keys(doc.comments), ...Object.keys(doc.names.short), ...Object.keys(doc.names.descriptive)].filter((id) => !doc.code.nodes[id]).length;
  if (orphans) box.append(h("p", { class: "hint" }, `${orphans} name or comment entr${orphans === 1 ? "y points" : "ies point"} at deleted nodes. They are kept so undo can bring them back.`));
  return box;
}

function runPanel(namer: Namer): HTMLElement {
  const def = node(ui.def);
  const box = h("div", { class: "run" });
  if (def.kind !== "def" || !def.body) return box;
  const body = node(def.body);
  const params = body.kind === "lambda" ? body.params : [];
  const defaults = [1, -3, 2];
  const vals = params.map((b, i) => ui.args[b] ?? String(defaults[i] ?? 1));
  const row = h("div", { class: "args" });
  params.forEach((b, i) => {
    const input = h("input", { id: `arg-${b}`, type: "text", inputmode: "decimal", value: vals[i], "aria-label": namer.name(b) }) as HTMLInputElement;
    input.addEventListener("change", () => { ui.args[b] = input.value; render(); });
    row.append(h("label", { class: "arg", for: `arg-${b}` }, h("span", {}, namer.name(b)), input));
  });
  let result: string;
  let failed = false;
  try {
    const f = evaluate(doc.code, ui.def);
    const v = typeof f === "function" ? f(...vals.map(Number)) : f;
    result = typeof v === "number" ? String(Math.round(v * 1e9) / 1e9) : String(v);
  } catch (e) {
    result = (e as Error).message;
    failed = true;
  }
  box.append(row, h("div", { class: "result" }, h("span", {}, `${namer.name(ui.def)}(…) =`), h("code", { class: failed ? "err" : undefined }, result)));
  return box;
}

function textPanel(p: Presentation): HTMLElement {
  const fn = { nested: renderNested, let: renderLet, sexpr: renderSexpr }[ui.text];
  let txt: string;
  try { txt = fn(doc.code, p, ui.def); } catch (e) { txt = (e as Error).message; }
  return h("pre", { class: "text" }, txt);
}

// ---------------------------------------------------------------- frame

function seg(name: string, value: string, options: [string, string][]) {
  return h("div", { class: "seg", role: "group", "aria-label": name },
    ...options.map(([v, label]) => h("button", { type: "button", class: v === value ? "on" : "", "data-set": name, "data-value": v, "aria-pressed": String(v === value) }, label)));
}

function select(id: Id | null) {
  if (ui.selected !== id) { ui.mode = null; ui.query = ""; }
  ui.selected = id;
  render();
}

function render() {
  const app = document.getElementById("app")!;
  const p = pres();
  const namer = new Namer(doc.code, p, ui.def);
  const scrollGraph = document.querySelector(".graph-wrap")?.scrollLeft ?? 0;
  const focused = document.activeElement?.id;

  const defTabs = h("div", { class: "seg", role: "group", "aria-label": "Definition" },
    ...doc.code.defs.map((d) => h("button", { type: "button", class: d === ui.def ? "on" : "", "data-def": d }, new Namer(doc.code, p, d).name(d))));

  app.replaceChildren(
    h("header", { class: "bar" },
      h("div", { class: "brand" }, h("strong", {}, "Projectional"), h("span", {}, "the program is the tree")),
      h("div", { class: "controls" },
        defTabs,
        seg("layer", ui.layer, [["short", "Short names"], ["descriptive", "Descriptive"]]),
        seg("style", ui.style, [["math", "a · b"], ["plain", "a * b"], ["lisp", "(* a b)"]]),
        h("div", { class: "seg" },
          h("button", { type: "button", "data-act": "undo", disabled: !undo.length }, "Undo"),
          h("button", { type: "button", "data-act": "redo", disabled: !redo.length }, "Redo"),
          h("button", { type: "button", "data-act": "reset" }, "Reset")))),
    h("div", { class: `status${ui.touched.length ? " live" : ""}`, role: "status" }, ui.note),
    h("main", { class: "grid" },
      h("section", { class: "panel p-blocks" }, h("h2", {}, "Blocks"), h("div", { class: "blocks-wrap" }, blocks(namer, p))),
      h("section", { class: "panel p-graph" }, h("h2", {}, "Graph ", h("small", {}, "drag nodes; positions save to layout.json")), h("div", { class: "graph-wrap" }, graph(namer, p))),
      h("section", { class: "panel p-text" }, h("div", { class: "text-head" }, h("h2", {}, "Text views"), seg("text", ui.text, [["let", "Steps"], ["nested", "Nested"], ["sexpr", "Lisp"]])), textPanel(p)),
      h("aside", { class: "side" },
        h("section", { class: "panel" }, h("h2", {}, "Selected"), inspector(namer, p)),
        h("section", { class: "panel" }, h("h2", {}, "Files"), filesPanel()),
        h("section", { class: "panel" }, h("h2", {}, "Run"), runPanel(namer)))),
  );
  const gw = document.querySelector(".graph-wrap");
  if (gw) gw.scrollLeft = scrollGraph;
  if (focused) document.getElementById(focused)?.focus();
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const set = t.closest<HTMLElement>("[data-set]");
  if (set) {
    const k = set.dataset.set as "layer" | "style" | "text";
    (ui as unknown as Record<string, string>)[k] = set.dataset.value!;
    if (k !== "text") { ui.touched = []; ui.note = k === "layer" ? "Switched names layer. Same code, different words." : "Switched notation. Same code, different symbols and precedence."; }
    return render();
  }
  const def = t.closest<HTMLElement>("[data-def]");
  if (def) { ui.def = def.dataset.def!; ui.selected = null; ui.mode = null; return render(); }
  const act = t.closest<HTMLElement>("[data-act]");
  if (act) {
    const a = act.dataset.act;
    if (a === "undo") return travel(undo, redo, "Undid");
    if (a === "redo") return travel(redo, undo, "Redid");
    if (a === "reset") { undo.push(doc); doc = initial(); ui.selected = null; ui.touched = files().map((f) => f.name); ui.note = "Back to the example program."; save(); return render(); }
    if (a === "goto") return select(act.dataset.target!);
    if (a === "wrap" || a === "replace") { ui.mode = ui.mode === a ? null : a; ui.query = ""; render(); document.getElementById("f-query")?.focus(); return; }
    if (a === "delete" && ui.selected) return replaceWith(ui.selected, { kind: "hole" }, "Deleted. A hole keeps the shape; fill it from the Fill… picker.");
    return;
  }
  const hit = t.closest<HTMLElement>(".blocks-wrap [data-id]");
  if (hit) { e.stopPropagation(); return select(hit.dataset.id!); }
});

document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).closest("input, textarea");
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
    e.preventDefault();
    return e.shiftKey ? travel(redo, undo, "Redid") : travel(undo, redo, "Undid");
  }
  if (!typing && (e.key === "Delete" || e.key === "Backspace") && ui.selected && isExpr(node(ui.selected)) && node(ui.selected).kind !== "hole") {
    e.preventDefault();
    replaceWith(ui.selected, { kind: "hole" }, "Deleted. A hole keeps the shape; fill it from the Fill… picker.");
  }
  if (!typing && e.key === "Enter" && (e.target as HTMLElement).closest(".gn")) select((e.target as HTMLElement).closest<HTMLElement>(".gn")!.dataset.id!);
});

// Start with something selected so the inspector shows what it can do.
{
  const d = node(ui.def);
  const body = d.kind === "def" && d.body ? node(d.body) : null;
  if (body?.kind === "lambda") ui.selected = subtree(doc.code, body.body).find((id) => doc.names.descriptive[id]) ?? null;
}
render();
