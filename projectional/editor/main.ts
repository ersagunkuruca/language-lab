// Browser editor over the same core as the CLI demo. Code is edited by
// gestures, never by typing text, and every gesture says which file it
// changed. Two kinds of definitions:
//   expression defs (discriminant, root): blocks + graph, edited by
//     rename / wrap / replace / delete, with go-to-definition and inline views
//   networks (to polar, rotate): a node graph you wire freely. Which outer
//     ports are known is a choice in layout.json, and the solver derives the
//     program for that choice, so changing it runs the network backwards.

import quadCode from "../examples/quadratic/code.json" with { type: "json" };
import quadShort from "../examples/quadratic/names.short.json" with { type: "json" };
import quadDescriptive from "../examples/quadratic/names.descriptive.json" with { type: "json" };
import quadComments from "../examples/quadratic/comments.json" with { type: "json" };
import quadHints from "../examples/quadratic/hints.json" with { type: "json" };
import vecCode from "../examples/vectors/code.json" with { type: "json" };
import vecNames from "../examples/vectors/names.default.json" with { type: "json" };
import vecLayout from "../examples/vectors/layout.json" with { type: "json" };
import mathStyle from "../styles/math.json" with { type: "json" };
import plainStyle from "../styles/plain.json" with { type: "json" };
import lispStyle from "../styles/lisp.json" with { type: "json" };
import graphStyle from "../styles/graph.json" with { type: "json" };
import { evaluate } from "../src/eval.ts";
import { hashDef } from "../src/hash.ts";
import { collect, freshId, get, merge, parentOf, swapIn, type Code, type Id, type Node, type NodeData } from "../src/model.ts";
import { layer, type Comments, type Hints, type Names, type Presentation, type Style } from "../src/presentation.ts";
import { impl, prelude, preludeNames } from "../src/prelude.ts";
import { partDirections, portLabel, portsOf, relationNames, relationPrelude, RELATIONS, solveNetwork, toNetwork, type PortDirection } from "../src/relational.ts";
import { renderLet } from "../src/render/letseq.ts";
import { renderNested } from "../src/render/nested.ts";
import { renderSexpr } from "../src/render/sexpr.ts";
import { Namer } from "../src/render/namer.ts";

// ---------------------------------------------------------------- state

type Layer = "short" | "descriptive";
type StyleName = "math" | "plain" | "lisp";
type TextView = "nested" | "let" | "sexpr" | "program" | "equations";
type Pos = { x: number; y: number };

interface Layout {
  positions: Record<string, Pos>;
  // Per network: which outer ports are known. Choosing different ones is
  // how you invert it, and it never touches code.json.
  known: Record<Id, Id[]>;
  // Calls shown with the callee's body inlined. A view, not an edit.
  expanded: Id[];
}

interface Doc {
  code: Code;
  names: Record<Layer, Names>;
  comments: Comments;
  hints: Hints;
  layout: Layout;
}

interface UI {
  def: Id;
  back: Id[];
  selected: Id | null;
  layer: Layer;
  style: StyleName;
  text: TextView;
  touched: string[];
  note: string;
  mode: null | "wrap" | "replace" | "add";
  query: string;
  args: Record<Id, string>;
}

const styles: Record<StyleName, Style> = { math: mathStyle as unknown as Style, plain: plainStyle as unknown as Style, lisp: lispStyle as unknown as Style };
const STORE = "projectional-editor-v2";

const initial = (): Doc => ({
  code: merge(prelude, relationPrelude, quadCode as Code, vecCode as Code),
  names: { short: { ...quadShort, ...vecNames }, descriptive: quadDescriptive },
  comments: quadComments,
  hints: quadHints,
  layout: { positions: {}, known: (vecLayout as { known: Record<Id, Id[]> }).known, expanded: [] },
});

let doc: Doc = initial();
try {
  const saved = localStorage.getItem(STORE);
  if (saved) doc = JSON.parse(saved);
} catch {}

const startDef = () => doc.code.defs.find((d) => (doc.names.short[d] ?? "") === "to polar") ?? doc.code.defs[0];

const ui: UI = {
  def: startDef(),
  back: [],
  selected: null,
  layer: "descriptive",
  style: "math",
  text: "program",
  touched: [],
  note: "Drag from a port to another port to connect them. Drag a connected port into empty space to disconnect it.",
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
  ui.query = "";
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
  if (!doc.code.nodes[ui.def]) ui.def = doc.code.defs[0];
  ui.touched = changed;
  ui.note = `${label}: ${changed.join(", ") || "nothing"} changed back.`;
  ui.mode = null;
  save();
  render();
}

// ---------------------------------------------------------------- helpers

const node = (id: Id) => doc.code.nodes[id];
const defBody = (d: Id) => { const n = node(d); return n?.kind === "def" && n.body ? node(n.body) : null; };
const isNetwork = (d: Id) => defBody(d)?.kind === "network";
const network = () => get(doc.code, (node(ui.def) as { body: Id }).body, "network");
const known = (): Id[] => (doc.layout.known[ui.def] ?? []).filter((p) => network().params.includes(p));

const pres = (names: Names = {}, comments: Comments = doc.comments): Presentation => ({
  names: layer<Names>(preludeNames, relationNames, doc.names.short, ui.layer === "descriptive" ? doc.names.descriptive : {}, names),
  comments,
  hints: doc.hints,
  style: { ...styles[ui.style], quote: undefined },
});

const userCode = (c: Code): Code => ({ nodes: Object.fromEntries(Object.entries(c.nodes).filter(([, n]) => n.kind !== "builtin")), defs: c.defs });

const files = () => [
  { name: "code.json", get: (d: Doc) => JSON.stringify(userCode(d.code)) },
  { name: "names.short.json", get: (d: Doc) => JSON.stringify(d.names.short) },
  { name: "names.descriptive.json", get: (d: Doc) => JSON.stringify(d.names.descriptive) },
  { name: "comments.json", get: (d: Doc) => JSON.stringify(d.comments) },
  { name: "layout.json", get: (d: Doc) => JSON.stringify(d.layout) },
];

function fnv(s: string) {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return x.toString(16).padStart(8, "0");
}

type Kid = HTMLElement | SVGElement | string | null | undefined | false;
function h(tag: string, attrs: Record<string, string | boolean | undefined> = {}, ...kids: Kid[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

function svg(tag: string, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const text = (x: number, y: number, s: string, cls: string, anchor = "middle") =>
  Object.assign(svg("text", { x, y, class: cls, "text-anchor": anchor }), { textContent: s });

function semanticHash(code = doc.code): string {
  try { return hashDef(code, ui.def); } catch { return "—"; }
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
  const out = [doc.names.short[id], doc.names.descriptive[id], preludeNames[id], relationNames[id]];
  for (const s of [...Object.values(styles), graphStyle as unknown as Style]) out.push(s.notation[id]?.glyph);
  if (n?.kind === "builtin") out.push(n.op);
  return [...new Set(out.filter((x): x is string => !!x))];
}

function arity(id: Id): number {
  const n = node(id);
  if (n.kind === "builtin") return impl[n.op as keyof typeof impl]?.length ?? 1;
  const b = defBody(id);
  return b?.kind === "lambda" ? b.params.length : 1;
}

function add(code: Code, data: NodeData): Id {
  const id = freshId();
  code.nodes[id] = { id, ...data } as Node;
  return id;
}

const isExpr = (n: Node) => n.kind === "lit" || n.kind === "ref" || n.kind === "call" || n.kind === "lambda" || n.kind === "hole";

// The def a call, ref or part refers to, if it's a user def.
function calleeDef(id: Id): Id | null {
  const n = view.code.nodes[id] ?? node(id);
  if (!n) return null;
  let t: Id | null = null;
  if (n.kind === "call") { const fn = view.code.nodes[n.fn]; t = fn?.kind === "ref" ? fn.target : null; }
  else if (n.kind === "ref") t = n.target;
  else if (n.kind === "part") t = n.fn;
  return t && node(t)?.kind === "def" ? t : null;
}

function openDef(d: Id) {
  ui.back.push(ui.def);
  ui.def = d;
  ui.selected = null;
  ui.mode = null;
  ui.touched = [];
  ui.note = `Opened ${new Namer(doc.code, pres(), d).name(d)}. Back returns to where you were.`;
  if (!isNetwork(d) && (ui.text === "program" || ui.text === "equations")) ui.text = "let";
  if (isNetwork(d) && !["program", "equations"].includes(ui.text)) ui.text = "program";
  render();
}

// ---------------------------------------------------------------- inline view

// Expanding a call shows the callee's body in place of the call, with the
// arguments substituted. It is built fresh for each render from the real code
// and never saved: copies get ids like "<original>~<call>", and names and
// comments are copied along so the inlined part reads like the original.
interface View { code: Code; names: Names; comments: Comments; origin: Map<Id, Id>; expandedFrom: Map<Id, Id> }
let view: View = { code: doc.code, names: {}, comments: doc.comments, origin: new Map(), expandedFrom: new Map() };

function buildView(): View {
  const nodes: Record<Id, Node> = { ...doc.code.nodes };
  const names: Names = {};
  const comments: Comments = { ...doc.comments };
  const origin = new Map<Id, Id>();
  const expandedFrom = new Map<Id, Id>();
  const allNames = pres().names;
  for (const callId of doc.layout.expanded) {
    const c = nodes[callId];
    if (c?.kind !== "call") continue;
    const fn = nodes[c.fn];
    if (fn?.kind !== "ref") continue;
    const lam = defBody(fn.target);
    if (lam?.kind !== "lambda") continue;
    const args = new Map(lam.params.map((p, i) => [p, c.args[i]]));
    const copy = (id: Id): Id => {
      const n = doc.code.nodes[id];
      if (n.kind === "ref" && args.has(n.target)) return args.get(n.target)!;
      const nid = `${id}~${callId}`;
      origin.set(nid, id);
      if (allNames[id] !== undefined && n.kind === "call") names[nid] = allNames[id];
      if (doc.comments[id] !== undefined) comments[nid] = doc.comments[id];
      if (n.kind === "call") nodes[nid] = { id: nid, kind: "call", fn: copy(n.fn), args: n.args.map(copy) };
      else if (n.kind === "lambda") nodes[nid] = { id: nid, kind: "lambda", params: n.params, body: copy(n.body) };
      else nodes[nid] = { ...n, id: nid } as Node;
      return nid;
    };
    const root = copy(lam.body);
    nodes[callId] = { ...nodes[root], id: callId } as Node;
    expandedFrom.set(callId, fn.target);
  }
  return { code: { nodes, defs: doc.code.defs }, names, comments, origin, expandedFrom };
}

// ---------------------------------------------------------------- gestures: expressions

function rename(id: Id, value: string) {
  const names = { ...doc.names[ui.layer] };
  if (value.trim()) names[id] = value; else delete names[id];
  const k = node(id).kind;
  const what = k === "call" ? (value.trim() ? "Named this step" : "Inlined this step") : k === "part" ? "Labelled this node" : "Renamed";
  commit({ names: { ...doc.names, [ui.layer]: names } }, [`names.${ui.layer}.json`], `${what}. Only names.${ui.layer}.json changed; the meaning hash is the same.`);
}

function setComment(id: Id, value: string) {
  const comments = { ...doc.comments };
  if (value.trim()) comments[id] = value; else delete comments[id];
  commit({ comments }, ["comments.json"], "Comment saved on the node itself, not on a line.");
}

function setLiteral(id: Id, raw: string) {
  const v = Number(raw);
  const n = node(id);
  const code = { nodes: { ...doc.code.nodes }, defs: doc.code.defs };
  if (n.kind === "part") code.nodes[id] = { ...n, value: Number.isFinite(v) ? v : 0 };
  else code.nodes[id] = { id, kind: "lit", value: raw.trim() !== "" && Number.isFinite(v) ? v : raw };
  commit({ code }, ["code.json"], "Changed a constant. That is a change in meaning, so the hash moved.");
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

function toggleExpand(callId: Id) {
  const on = doc.layout.expanded.includes(callId);
  const expanded = on ? doc.layout.expanded.filter((x) => x !== callId && !x.endsWith(`~${callId}`)) : [...doc.layout.expanded, callId];
  ui.selected = callId;
  commit({ layout: { ...doc.layout, expanded } }, ["layout.json"],
    on ? "Collapsed the inlined call. Only layout.json changed." : "Showing the definition inline. It's a view: layout.json changed, code.json didn't.");
}

function convertToNetwork() {
  const lam = defBody(ui.def);
  if (lam?.kind === "lambda") lam.params.forEach((p, i) => (ui.args[p] ??= String([1, -3, 2][i] ?? 1)));
  const { code, names } = toNetwork(doc.code, ui.def);
  const net = get(code, (code.nodes[ui.def] as { body: Id }).body, "network");
  const knownPorts = net.params.slice(0, -1);
  // Seed the result with today's answer, so ticking it known and unticking
  // an input asks a question that has an answer.
  try {
    const f = evaluate(doc.code, ui.def) as (...xs: number[]) => number;
    ui.args[net.params.at(-1)!] = fmt(f(...knownPorts.map((p) => Number(ui.args[p]))));
  } catch {}
  commit({
    code,
    names: { ...doc.names, short: { ...doc.names.short, ...names } },
    layout: { ...doc.layout, known: { ...doc.layout.known, [ui.def]: knownPorts }, expanded: doc.layout.expanded.filter((x) => node(x)?.kind === "call") },
  }, ["code.json", "names.short.json", "layout.json"],
  "Turned into a network. Every call is now a node you can rewire, and the result is an outer port you can make known to run it backwards.");
  ui.text = "program";
  render();
}

// ---------------------------------------------------------------- gestures: networks

type PortRef = { part: Id; key: string } | { ext: Id };
const portId = (p: PortRef) => ("ext" in p ? `ext|${p.ext}` : `${p.part}|${p.key}`);
const parsePort = (s: string): PortRef => {
  const [a, b] = s.split("|");
  return a === "ext" ? { ext: b } : { part: a, key: b };
};

// Networks are edited on a copy of the nodes, then tidied: a wire with fewer
// than two ends is removed.
function editNetwork(fn: (nodes: Record<Id, Node>, net: { params: Id[]; wires: Id[]; parts: Id[] }) => void, note: string, touched = ["code.json"]) {
  const nodes = { ...doc.code.nodes };
  const old = network();
  const net = { params: [...old.params], wires: [...old.wires], parts: [...old.parts] };
  fn(nodes, net);
  const ends = new Map<Id, number>();
  for (const pid of net.parts) for (const w of Object.values((nodes[pid] as { bind: Record<string, Id> }).bind)) ends.set(w, (ends.get(w) ?? 0) + 1);
  for (const w of [...net.wires]) {
    if ((ends.get(w) ?? 0) >= 2) continue;
    net.wires = net.wires.filter((x) => x !== w);
    for (const pid of net.parts) {
      const p = nodes[pid] as Extract<Node, { kind: "part" }>;
      if (Object.values(p.bind).includes(w)) nodes[pid] = { ...p, bind: Object.fromEntries(Object.entries(p.bind).filter(([, x]) => x !== w)) };
    }
  }
  nodes[old.id] = { id: old.id, kind: "network", ...net };
  commit({ code: collect({ nodes, defs: doc.code.defs }) }, touched, note);
}

const wireOf = (p: PortRef, nodes = doc.code.nodes): Id | undefined =>
  "ext" in p ? p.ext : (nodes[p.part] as Extract<Node, { kind: "part" }>).bind[p.key];

function connect(a: PortRef, b: PortRef) {
  const wa = wireOf(a), wb = wireOf(b);
  if (wa && wa === wb) return;
  if ("ext" in a && "ext" in b) {
    ui.note = "Two outer ports can't be joined directly. Put a node between them.";
    return render();
  }
  editNetwork((nodes, net) => {
    const bindPart = (p: PortRef, w: Id) => {
      if ("ext" in p) return;
      const part = nodes[p.part] as Extract<Node, { kind: "part" }>;
      nodes[p.part] = { ...part, bind: { ...part.bind, [p.key]: w } };
    };
    if (wa && wb) {
      // Merging two wires: keep an outer port if one is involved.
      const [keep, drop] = net.params.includes(wb) ? [wb, wa] : [wa, wb];
      if (net.params.includes(drop)) { ui.note = "Both wires already end at outer ports; disconnect one first."; return; }
      for (const pid of net.parts) {
        const p = nodes[pid] as Extract<Node, { kind: "part" }>;
        if (Object.values(p.bind).includes(drop)) nodes[pid] = { ...p, bind: Object.fromEntries(Object.entries(p.bind).map(([k, w]) => [k, w === drop ? keep : w])) };
      }
      net.wires = net.wires.filter((w) => w !== drop);
    } else if (wa || wb) {
      bindPart(wa ? b : a, (wa ?? wb)!);
    } else {
      const w = add({ nodes, defs: [] }, { kind: "binder" });
      net.wires.push(w);
      bindPart(a, w);
      bindPart(b, w);
    }
  }, "Connected. Wires are ids in code.json; the solver works out which way values flow.");
}

function disconnect(p: PortRef) {
  if (!wireOf(p)) return;
  editNetwork((nodes, net) => {
    if ("ext" in p) {
      for (const pid of net.parts) {
        const part = nodes[pid] as Extract<Node, { kind: "part" }>;
        nodes[pid] = { ...part, bind: Object.fromEntries(Object.entries(part.bind).filter(([, w]) => w !== p.ext)) };
      }
    } else {
      const part = nodes[p.part] as Extract<Node, { kind: "part" }>;
      const bind = { ...part.bind };
      delete bind[p.key];
      nodes[p.part] = { ...part, bind };
    }
  }, "Disconnected.");
}

function addPart(fn: Id | null, value?: number) {
  let id = "";
  editNetwork((nodes, net) => {
    id = add({ nodes, defs: [] }, value === undefined ? { kind: "part", fn, bind: {} } : { kind: "part", fn, bind: {}, value });
    net.parts.push(id);
  }, `Added ${fn ? labelOf(fn) : String(value)}. Drag from its ports to wire it in.`);
  ui.selected = id;
  render();
}

function addPort() {
  let id = "";
  const n = network().params.length + 1;
  editNetwork((nodes, net) => {
    id = add({ nodes, defs: [] }, { kind: "binder" });
    net.params.push(id);
  }, "Added an outer port. Make it known to feed a value in, or leave it unknown to read one out.", ["code.json", "names.short.json"]);
  doc.names.short = { ...doc.names.short, [id]: `port ${n}` };
  ui.selected = id;
  save();
  render();
}

function removeSelected() {
  const id = ui.selected;
  if (!id || !node(id)) return;
  const n = node(id);
  if (isNetwork(ui.def)) {
    const net = network();
    if (n.kind === "part") return editNetwork((_, nn) => { nn.parts = nn.parts.filter((x) => x !== id); }, "Deleted the node.");
    if (net.params.includes(id)) {
      return editNetwork((nodes, nn) => {
        nn.params = nn.params.filter((x) => x !== id);
        for (const pid of nn.parts) {
          const p = nodes[pid] as Extract<Node, { kind: "part" }>;
          nodes[pid] = { ...p, bind: Object.fromEntries(Object.entries(p.bind).filter(([, w]) => w !== id)) };
        }
      }, "Removed the outer port.");
    }
    if (net.wires.includes(id)) {
      return editNetwork((nodes, nn) => {
        nn.wires = nn.wires.filter((x) => x !== id);
        for (const pid of nn.parts) {
          const p = nodes[pid] as Extract<Node, { kind: "part" }>;
          nodes[pid] = { ...p, bind: Object.fromEntries(Object.entries(p.bind).filter(([, w]) => w !== id)) };
        }
      }, "Removed the wire.");
    }
    return;
  }
  if (isExpr(n) && n.kind !== "hole" && !view.origin.has(id)) replaceWith(id, { kind: "hole" }, "Deleted. A hole keeps the shape; fill it from the Fill… picker.");
}

function setKnown(port: Id, on: boolean) {
  const cur = known();
  const next = on ? [...cur, port] : cur.filter((p) => p !== port);
  commit({ layout: { ...doc.layout, known: { ...doc.layout.known, [ui.def]: next } } }, ["layout.json"],
    `${on ? "Made" : "Unmade"} ${new Namer(doc.code, pres(), ui.def).name(port)} a known input. Only layout.json changed: same code, same hash, different direction.`);
}

function labelOf(fn: Id): string {
  return new Namer(doc.code, pres(), ui.def).name(fn);
}

// ---------------------------------------------------------------- render: blocks (expression defs)

function blocks(namer: Namer, p: Presentation): HTMLElement {
  const code = view.code;
  const def = code.nodes[ui.def];
  if (def.kind !== "def") return h("div");

  const cls = (id: Id) => `${ui.selected === id ? " sel" : ""}${view.origin.has(id) ? " virtual" : ""}`;
  const pill = (id: Id, kind: string, label: string) =>
    h("button", { class: `pill ${kind}${cls(id)}`, "data-id": id, type: "button" }, label);

  const block = (id: Id): HTMLElement => {
    const n = code.nodes[id];
    const named = n.kind === "call" && p.names[id] !== undefined;
    const noted = view.comments[id] !== undefined;
    const from = view.expandedFrom.get(id);
    const box = (kind: string, ...kids: (HTMLElement | string)[]) =>
      h("div", { class: `blk ${kind}${cls(id)}${from ? " inlined" : ""}`, "data-id": id },
        from ? h("span", { class: "tag inl" }, `${namer.name(from)} inlined`) : named ? h("span", { class: "tag" }, namer.name(id)) : null,
        noted ? h("span", { class: "note-dot", title: "Has a comment" }) : null,
        ...kids);
    switch (n.kind) {
      case "lit": return pill(id, "lit", String(n.value));
      case "hole": return pill(id, "hole", "□");
      case "ref": {
        const t = code.nodes[n.target];
        return pill(id, t.kind === "binder" ? "var" : t.kind === "def" ? "def" : "op", namer.name(n.target));
      }
      case "lambda":
        return box("lam", h("span", { class: "kw" }, "λ"), ...n.params.map((b) => pill(b, "var binder", namer.name(b))), h("span", { class: "kw" }, "→"), block(n.body));
      case "call": {
        const fn = code.nodes[n.fn];
        if (fn.kind === "lambda") {
          return box("let",
            ...fn.params.map((b, i) => h("div", { class: "row" }, h("span", { class: "kw" }, "let"), pill(b, "var binder", namer.name(b)), h("span", { class: "kw" }, "="), block(n.args[i]))),
            h("div", { class: "row" }, h("span", { class: "kw" }, "in"), block(fn.body)));
        }
        if (fn.kind !== "ref") return box("op", block(n.fn), ...n.args.map(block));
        const t = code.nodes[fn.target];
        const kind = t.kind === "def" ? "def" : "op";
        const nota = p.style.notation[fn.target];
        const op = h("span", { class: "fn" }, nota?.glyph ?? namer.name(fn.target));
        if (nota?.fixity === "infix" && n.args.length === 2) return box(kind, block(n.args[0]), op, block(n.args[1]));
        if (nota?.fixity === "prefix" && n.args.length === 1) return box(kind, op, block(n.args[0]));
        return box(kind, op, ...n.args.map(block));
      }
      default: return h("span");
    }
  };

  const head = h("div", { class: "def-head" }, pill(ui.def, "def", namer.name(ui.def)), h("span", { class: "kw" }, "="));
  return h("div", { class: "def-card" }, head, def.body ? block(def.body) : h("span", { class: "kw" }, "extern"));
}

// ---------------------------------------------------------------- render: expression graph

interface GNode { key: string; label: string; sub?: string; cls: string; select: Id; ports: number }
interface GEdge { from: string; to: string; port: number }

function exprGraphModel(namer: Namer, p: Presentation) {
  const code = view.code;
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const put = (g: GNode) => { if (!nodes.has(g.key)) nodes.set(g.key, g); return g.key; };
  const glyph = (t: Id) => p.style.notation[t]?.glyph ?? namer.name(t);

  const source = (id: Id): string => {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": return put({ key: id, label: String(n.value), cls: "lit", select: id, ports: 0 });
      case "hole": return put({ key: id, label: "□", cls: "hole", select: id, ports: 0 });
      case "ref": {
        const t = code.nodes[n.target];
        if (t.kind === "binder") return put({ key: n.target, label: namer.name(n.target), cls: "var", select: n.target, ports: 0 });
        return put({ key: "g" + n.target, label: glyph(n.target), cls: "def", select: n.target, ports: 0 });
      }
      case "lambda": return put({ key: id, label: "λ " + n.params.map((b) => namer.name(b)).join(", "), cls: "lam", select: id, ports: 0 });
      case "call": {
        const fn = code.nodes[n.fn];
        if (fn.kind === "lambda") {
          n.args.forEach((a, i) => {
            const b = put({ key: fn.params[i], label: namer.name(fn.params[i]), cls: "var let", select: fn.params[i], ports: 1 });
            edges.push({ from: source(a), to: b, port: 0 });
          });
          return source(fn.body);
        }
        const label = fn.kind === "ref" ? glyph(fn.target) : "apply";
        const kind = fn.kind === "ref" && code.nodes[fn.target].kind === "def" ? "def" : "op";
        const virt = view.origin.has(id) || view.expandedFrom.has(id) ? " virtual" : "";
        const k = put({ key: id, label, sub: p.names[id], cls: kind + virt, select: id, ports: n.args.length });
        n.args.forEach((a, i) => edges.push({ from: source(a), to: k, port: i }));
        return k;
      }
      default: return put({ key: id, label: n.kind, cls: "lit", select: id, ports: 0 });
    }
  };

  const def = code.nodes[ui.def];
  if (def.kind === "def" && def.body) {
    let body = def.body;
    const b = code.nodes[body];
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

function rankLayout<T extends { key: string }>(items: T[], edges: { from: string; to: string }[], width: (t: T) => number, height: (t: T) => number, gap = 56): Map<string, Pos> {
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
  items.forEach((n) => r(n.key));
  const cols = new Map<number, T[]>();
  for (const n of items) cols.set(rank.get(n.key)!, [...(cols.get(rank.get(n.key)!) ?? []), n]);
  const pos = new Map<string, Pos>();
  let x = 20;
  for (const c of [...cols.keys()].sort((a, b) => a - b)) {
    const col = cols.get(c)!;
    let y = 20;
    for (const n of col) { pos.set(n.key, { x, y }); y += height(n) + 28; }
    x += Math.max(...col.map(width)) + gap;
  }
  return pos;
}

const lkey = (k: string) => `${ui.def}/${k}`;

function savePositions(pos: Map<string, Pos>, note: string) {
  const positions = { ...doc.layout.positions };
  for (const [k, v] of pos) positions[lkey(k)] = { x: Math.round(v.x), y: Math.round(v.y) };
  commit({ layout: { ...doc.layout, positions } }, ["layout.json"], note);
}

// Pointer drag helper: calls move with the delta in SVG units, then done.
function drag(el: Element, root: SVGSVGElement, width: number, ev: PointerEvent, move: (dx: number, dy: number, e: PointerEvent) => void, done: (moved: boolean, e: PointerEvent) => void) {
  const start = { x: ev.clientX, y: ev.clientY };
  const scale = root.getBoundingClientRect().width / width || 1;
  let moved = false;
  (el as HTMLElement).setPointerCapture?.(ev.pointerId);
  const mv = (e: PointerEvent) => {
    const dx = (e.clientX - start.x) / scale, dy = (e.clientY - start.y) / scale;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    move(dx, dy, e);
  };
  const up = (e: PointerEvent) => {
    el.removeEventListener("pointermove", mv as EventListener);
    el.removeEventListener("pointerup", up as EventListener);
    done(moved, e);
  };
  el.addEventListener("pointermove", mv as EventListener);
  el.addEventListener("pointerup", up as EventListener);
}

function exprGraph(namer: Namer, p: Presentation): SVGSVGElement {
  const { nodes, edges } = exprGraphModel(namer, p);
  const auto = rankLayout(nodes, edges, W, H);
  const pos = new Map(nodes.map((n) => [n.key, doc.layout.positions[lkey(n.key)] ?? auto.get(n.key)!]));
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const maxX = Math.max(300, ...nodes.map((n) => pos.get(n.key)!.x + W(n))) + 20;
  const maxY = Math.max(200, ...nodes.map((n) => pos.get(n.key)!.y + H(n))) + 20;
  const root = svg("svg", { viewBox: `0 0 ${maxX} ${maxY}`, width: maxX, height: maxY, class: "graph" }) as SVGSVGElement;
  const selTarget = ui.selected && view.code.nodes[ui.selected]?.kind === "ref" ? (view.code.nodes[ui.selected] as { target: Id }).target : null;

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
      if (b.ports > 1) edgeLayer.append(text(tx - 4, ty - 4, String(e.port + 1), "port", "end"));
    }
  };
  drawEdges();

  for (const n of nodes) {
    const g = svg("g", { class: `gn ${n.cls}${ui.selected === n.select || selTarget === n.select ? " sel" : ""}`, "data-id": n.select, tabindex: 0 });
    const place = () => { const q = pos.get(n.key)!; g.setAttribute("transform", `translate(${q.x},${q.y})`); };
    place();
    const round = n.cls.includes("var") ? H(n) / 2 : n.cls === "out" ? 2 : 7;
    g.append(svg("rect", { width: W(n), height: H(n), rx: round }));
    g.append(text(W(n) / 2, n.sub ? 19 : H(n) / 2 + 5, n.label, "lbl"));
    if (n.sub) g.append(text(W(n) / 2, 36, n.sub, "sub"));
    g.addEventListener("pointerdown", (ev) => {
      const orig = { ...pos.get(n.key)! };
      drag(g, root, maxX, ev, (dx, dy) => { pos.set(n.key, { x: Math.max(0, orig.x + dx), y: Math.max(0, orig.y + dy) }); place(); drawEdges(); },
        (moved) => moved ? savePositions(pos, "Moved a node. Positions live in layout.json; the code is untouched.") : select(n.select));
    });
    g.addEventListener("dblclick", () => { const d = calleeDef(n.select) ?? (node(n.select)?.kind === "def" && n.select !== ui.def ? n.select : null); if (d) openDef(d); });
    root.append(g);
  }
  return root;
}

// ---------------------------------------------------------------- render: network editor

interface NBox { key: string; id: Id; title: string; sub?: string; cls: string; left: string[]; right: string[]; value?: string }

const PW = (b: NBox, label: (k: string) => string) => {
  const side = (ks: string[]) => Math.max(0, ...ks.map((k) => label(k).length));
  return Math.max(70, b.title.length * 8.5 + 28, (side(b.left) + side(b.right)) * 7.2 + 44, (b.value?.length ?? 0) * 8 + 30);
};
const PH = (b: NBox) => 30 + Math.max(1, b.left.length, b.right.length) * 20 + (b.sub ? 12 : 0);

function networkEditor(namer: Namer, p: Presentation, values: Record<Id, number> | null): HTMLElement {
  const net = network();
  const knownSet = new Set(known());
  let dirs: Record<Id, PortDirection> = {};
  try { dirs = partDirections(doc.code, ui.def, [...knownSet]); } catch {}

  const plabel = (fn: Id | null, key: string) => portLabel(doc.code, p.names, fn, key);
  const boxes: NBox[] = [];
  const labelFor = new Map<string, (k: string) => string>();

  for (const port of net.params) {
    const isIn = knownSet.has(port);
    const v = values?.[port];
    boxes.push({ key: port, id: port, title: namer.name(port), cls: `ext ${isIn ? "in" : "out"}`, left: isIn ? [] : ["·"], right: isIn ? ["·"] : [], value: v === undefined ? undefined : fmt(v) });
    labelFor.set(port, () => "");
  }
  for (const pid of net.parts) {
    const part = node(pid) as Extract<Node, { kind: "part" }>;
    const keys = portsOf(doc.code, part.fn);
    const d = dirs[pid] ?? {};
    // Unconnected ports sit where they usually would: results right, and for
    // relations the second half of the ports right.
    const isRel = part.fn !== null && !!RELATIONS[(node(part.fn) as { op?: string }).op ?? ""];
    const usual = (k: string) => k === "out" || (isRel && keys.indexOf(k) >= keys.length / 2);
    const isOut = (k: string) => d[k] === "out" || ((d[k] ?? "free") === "free" && usual(k));
    const title = part.fn === null ? String(part.value ?? 0) : p.style.notation[part.fn]?.glyph ?? namer.name(part.fn);
    boxes.push({
      key: pid, id: pid, title, sub: p.names[pid],
      cls: `part ${part.fn === null ? "const" : node(part.fn).kind === "def" ? "def" : RELATIONS[(node(part.fn) as { op?: string }).op ?? ""] ? "rel" : "op"}`,
      left: keys.filter((k) => !isOut(k)), right: keys.filter(isOut),
    });
    labelFor.set(pid, (k) => plabel(part.fn, k));
  }

  // Wires: who's at each end. An end is "box key | port key".
  const ends = new Map<Id, string[]>();
  for (const port of net.params) ends.set(port, [`${port}|·`]);
  for (const pid of net.parts) {
    for (const [k, w] of Object.entries((node(pid) as Extract<Node, { kind: "part" }>).bind)) ends.set(w, [...(ends.get(w) ?? []), `${pid}|${k}`]);
  }

  // Layout: known outer ports left, unknown right, parts ranked by flow.
  const flow: { from: string; to: string }[] = [];
  for (const [, es] of ends) {
    const src = es.find((e) => { const [b, k] = e.split("|"); const bx = boxes.find((x) => x.key === b); return bx && (bx.right.includes(k)); });
    if (src) for (const e of es) if (e !== src) flow.push({ from: src.split("|")[0], to: e.split("|")[0] });
  }
  const sized = (b: NBox) => PW(b, labelFor.get(b.key)!);
  const inner = boxes.filter((b) => !b.cls.startsWith("ext"));
  const autoInner = rankLayout(inner, flow.filter((f) => inner.some((b) => b.key === f.from) && inner.some((b) => b.key === f.to)), sized, PH, 70);
  const extIn = boxes.filter((b) => b.cls === "ext in"), extOut = boxes.filter((b) => b.cls === "ext out");
  const innerRight = Math.max(0, ...inner.map((b) => autoInner.get(b.key)!.x + sized(b)));
  const auto = new Map<string, Pos>();
  extIn.forEach((b, i) => auto.set(b.key, { x: 20, y: 30 + i * 58 }));
  const leftW = Math.max(0, ...extIn.map(sized)) + 70;
  for (const b of inner) { const q = autoInner.get(b.key)!; auto.set(b.key, { x: q.x + leftW, y: q.y + 10 }); }
  extOut.forEach((b, i) => auto.set(b.key, { x: innerRight + leftW + 70, y: 30 + i * 58 }));

  const pos = new Map(boxes.map((b) => [b.key, doc.layout.positions[lkey(b.key)] ?? auto.get(b.key)!]));
  const byKey = new Map(boxes.map((b) => [b.key, b]));
  const extent = () => ({
    w: Math.max(480, ...boxes.map((b) => pos.get(b.key)!.x + sized(b))) + 40,
    h: Math.max(260, ...boxes.map((b) => pos.get(b.key)!.y + PH(b))) + 40,
  });
  const { w: maxX, h: maxY } = extent();
  const root = svg("svg", { viewBox: `0 0 ${maxX} ${maxY}`, width: maxX, height: maxY, class: "graph net" }) as SVGSVGElement;

  const anchor = (end: string): Pos & { side: number } => {
    const [bk, k] = end.split("|");
    const b = byKey.get(bk)!;
    const q = pos.get(bk)!;
    const top = b.cls.startsWith("ext") ? PH(b) / 2 : 30 + (b.sub ? 12 : 0) + 10;
    const li = b.left.indexOf(k), ri = b.right.indexOf(k);
    if (b.cls.startsWith("ext")) return b.right.length ? { x: q.x + sized(b), y: q.y + top, side: 1 } : { x: q.x, y: q.y + top, side: -1 };
    return li >= 0 ? { x: q.x, y: q.y + top + li * 20, side: -1 } : { x: q.x + sized(b), y: q.y + top + ri * 20, side: 1 };
  };

  const wireLayer = svg("g");
  const dragLayer = svg("g");
  root.append(wireLayer);
  const drawWires = () => {
    wireLayer.replaceChildren();
    for (const [w, es] of ends) {
      if (es.length < 2) continue;
      const src = es.find((e) => anchor(e).side === 1) ?? es[0];
      const a = anchor(src);
      for (const e of es) {
        if (e === src) continue;
        const b = anchor(e);
        const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
        const path = svg("path", { d: `M${a.x},${a.y} C${a.x + dx * a.side},${a.y} ${b.x + dx * b.side},${b.y} ${b.x},${b.y}`, class: `wire${ui.selected === w ? " sel" : ""}`, "data-wire": w });
        wireLayer.append(path);
        const hit = svg("path", { d: path.getAttribute("d")!, class: "wire-hit", "data-wire": w });
        hit.addEventListener("click", () => select(w));
        wireLayer.append(hit);
      }
      const nm = p.names[w];
      if (nm && !net.params.includes(w)) {
        const b = anchor(es.find((e) => e !== src)!);
        wireLayer.append(text((a.x + b.x) / 2, (a.y + b.y) / 2 - 6, nm, "wire-lbl"));
      }
    }
  };
  drawWires();

  for (const b of boxes) {
    const g = svg("g", { class: `nb ${b.cls}${ui.selected === b.id ? " sel" : ""}`, "data-id": b.id });
    const place = () => { const q = pos.get(b.key)!; g.setAttribute("transform", `translate(${q.x},${q.y})`); };
    place();
    const wdt = sized(b), hgt = PH(b);
    const label = labelFor.get(b.key)!;
    const isExt = b.cls.startsWith("ext");
    g.append(svg("rect", { width: wdt, height: hgt, rx: isExt ? hgt / 2 : 8, class: "body" }));
    if (isExt) {
      g.append(text(wdt / 2, hgt / 2 + (b.value ? -2 : 5), b.title, "lbl"));
      if (b.value) g.append(text(wdt / 2, hgt / 2 + 13, `= ${b.value}`, "val"));
    } else {
      g.append(text(wdt / 2, 20, b.title, "lbl"));
      if (b.sub) g.append(text(wdt / 2, 33, b.sub, "sub"));
      g.append(svg("line", { x1: 0, x2: wdt, y1: 26 + (b.sub ? 12 : 0), y2: 26 + (b.sub ? 12 : 0), class: "sep" }));
    }
    const ports = [...b.left.map((k) => [k, -1] as const), ...b.right.map((k) => [k, 1] as const)];
    for (const [k, side] of ports) {
      const end = `${b.key}|${k}`;
      const a = anchor(end);
      const q = pos.get(b.key)!;
      const px = a.x - q.x, py = a.y - q.y;
      const dir = isExt ? "" : (dirs[b.id]?.[k] ?? "free");
      const bound = isExt || !!(node(b.id) as { bind?: Record<string, Id> }).bind?.[k];
      if (!isExt) g.append(text(px + side * -8, py + 4, label(k), `plbl ${dir}`, side === -1 ? "start" : "end"));
      const dot = svg("circle", { cx: px, cy: py, r: 6, class: `dot ${dir}${bound ? " bound" : ""}`, "data-port": isExt ? `ext|${b.id}` : `${b.id}|${k}` });
      dot.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        const from = parsePort(dot.getAttribute("data-port")!);
        const line = svg("path", { class: "wire pending" });
        dragLayer.append(line);
        drag(dot, root, maxX, ev, (dx, dy) => {
          const ex = a.x + dx, ey = a.y + dy;
          line.setAttribute("d", `M${a.x},${a.y} C${a.x + 50 * side},${a.y} ${ex - 50 * side},${ey} ${ex},${ey}`);
        }, (moved, e) => {
          line.remove();
          if (!moved) return;
          const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-port]");
          if (target && target !== dot) connect(from, parsePort(target.getAttribute("data-port")!));
          else if (!target) disconnect(from);
        });
      });
      g.append(dot);
    }
    g.addEventListener("pointerdown", (ev) => {
      const orig = { ...pos.get(b.key)! };
      drag(g, root, maxX, ev, (dx, dy) => { pos.set(b.key, { x: Math.max(0, orig.x + dx), y: Math.max(0, orig.y + dy) }); place(); drawWires(); },
        (moved) => moved ? savePositions(pos, "Moved a node. Positions live in layout.json; the code is untouched.") : select(b.id));
    });
    g.addEventListener("dblclick", () => { const d = calleeDef(b.id); if (d) openDef(d); });
    root.append(g);
  }
  root.append(dragLayer);

  const bar = h("div", { class: "net-bar" },
    h("button", { class: `btn${ui.mode === "add" ? " on" : ""}`, type: "button", "data-act": "add" }, "Add node…"),
    h("button", { class: "btn", type: "button", "data-act": "add-port" }, "Add outer port"),
    h("span", { class: "legend" }, h("i", { class: "lg in" }), "input to the node", h("i", { class: "lg out" }), "solved by the node", h("i", { class: "lg free" }), "unconnected"));
  return h("div", {}, bar, ui.mode === "add" ? picker(null, namer) : null, h("div", { class: "graph-wrap" }, root));
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e6) / 1e6));

// ---------------------------------------------------------------- solver text

// Print the solver's expression trees with our names and notation.
type SExpr = { k: "num"; v: number; name?: string } | { k: "var"; name: string } | { k: "call"; f: string; args: SExpr[] };

// Unnamed wires read as w1, w2, ... in their order in the network.
function wireName(namer: Namer, p: Presentation, id: Id): string {
  const wires = isNetwork(ui.def) ? network().wires : [];
  if (p.names[id] === undefined && wires.includes(id)) return `w${wires.indexOf(id) + 1}`;
  return namer.name(id);
}

function solverPrinter(namer: Namer, p: Presentation) {
  const varName = (n: string): string => {
    if (n.startsWith("#k")) return "k" + n.slice(2).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[+d] ?? d).join("");
    let m = n.match(/^([0-9a-f]{8})$/);
    if (m) return wireName(namer, p, m[1]);
    m = n.match(/^([0-9a-f]{8}):(.+)$/);
    if (m) { const part = node(m[1]) as Extract<Node, { kind: "part" }>; return `${part?.fn ? labelOf(part.fn) : "const"}.${portLabel(doc.code, p.names, part?.fn ?? null, m[2])}`; }
    m = n.match(/^(.*?)\d+\.(.+)$/);
    if (m) return `${/^[0-9a-f]{8}$/.test(m[1]) ? namer.name(m[1]) : m[1]}.${varName(m[2])}`;
    return n;
  };
  const glyphs: Record<string, [string, number]> = { add: ["+", 6], sub: ["−", 6], mul: ["·", 7], div: ["/", 7], pow: ["^", 8] };
  const show = (e: SExpr): [string, number] => {
    if (e.k === "num") return [e.name ?? fmt(e.v), e.v < 0 ? 5 : 100];
    if (e.k === "var") return [varName(e.name), 100];
    if (e.f in glyphs && e.args.length === 2) {
      const [g, pr] = glyphs[e.f];
      const [l, lp] = show(e.args[0]), [r, rp] = show(e.args[1]);
      return [`${lp < pr ? `(${l})` : l} ${g} ${rp <= pr && e.f !== "add" && e.f !== "mul" ? `(${r})` : rp < pr ? `(${r})` : r}`, pr];
    }
    if (e.f === "neg") { const [a, ap] = show(e.args[0]); return [`−${ap < 9 ? `(${a})` : a}`, 9]; }
    return [`${e.f === "sqrt" ? "√" : e.f}(${e.args.map((a) => show(a)[0]).join(", ")})`, 100];
  };
  return { expr: (e: SExpr) => show(e)[0], name: varName };
}

type Eq = { lhs: SExpr; rhs: SExpr };
interface RawStep { type: string; x?: string; xs?: string[]; eq?: Eq; eqs?: Eq[]; branches?: { expr: SExpr; params: string[]; guards: SExpr[] }[]; exprs?: Record<string, SExpr>; tear?: string; residual?: Eq; inner?: RawStep[] }
interface Step { kind: string; raw: RawStep }

function programText(namer: Namer, p: Presentation, steps: Step[]): string {
  const pr = solverPrinter(namer, p);
  const eq = (e: Eq) => `${pr.expr(e.lhs)} = ${pr.expr(e.rhs)}`;
  const line = (s: RawStep, pad = ""): string => {
    if (s.type === "check") return `${pad}check  ${eq(s.eq!)}`;
    if (s.type === "solve") {
      const params = [...new Set(s.branches!.flatMap((b) => b.params))];
      const alts = s.branches!.map((b) => pr.expr(b.expr) + (b.guards.length ? `  if ${b.guards.map((g) => `${pr.expr(g)} ≥ 0`).join(", ")}` : ""));
      return `${pad}${pr.name(s.x!)} = ${alts.join(`\n${pad}      or  `)}${params.length ? `      (${params.map(pr.name).join(", ")} any integer)` : ""}`;
    }
    if (s.type === "linear") return s.xs!.map((x) => `${pad}${pr.name(x)} = ${pr.expr(s.exprs![x])}`).join("\n");
    // Tearing: guess one unknown, compute the rest from it, then search the
    // guess for values that make the one leftover equation hold.
    if (s.type === "tear") return [`${pad}guess ${pr.name(s.tear!)}`, ...s.inner!.map((st) => line(st, pad + "  ")), `${pad}keep the ${pr.name(s.tear!)} where ${eq(s.residual!)}`].join("\n");
    return `${pad}${s.xs!.map(pr.name).join(", ")} ≈ solve numerically { ${s.eqs!.map(eq).join(" ; ")} }`;
  };
  return steps.map(({ raw }) => line(raw)).join("\n");
}

function equationsText(namer: Namer, p: Presentation): string {
  const net = network();
  const w = (x: Id | undefined) => (x ? wireName(namer, p, x) : "·");
  return net.parts.map((pid) => {
    const part = node(pid) as Extract<Node, { kind: "part" }>;
    if (part.fn === null) return `${w(part.bind.out)} = ${part.value}`;
    const t = node(part.fn);
    const nota = p.style.notation[part.fn];
    if (t.kind === "builtin" && t.op in impl) {
      const args = portsOf(doc.code, part.fn).filter((k) => k !== "out").map((k) => w(part.bind[k]));
      const rhs = nota?.fixity === "infix" && args.length === 2 ? `${args[0]} ${nota.glyph} ${args[1]}` : `${nota?.glyph ?? labelOf(part.fn)}(${args.join(", ")})`;
      return `${w(part.bind.out)} = ${rhs}`;
    }
    return `${labelOf(part.fn)}(${portsOf(doc.code, part.fn).map((k) => `${portLabel(doc.code, p.names, part.fn, k)}: ${w(part.bind[k])}`).join(", ")})`;
  }).join("\n");
}

// ---------------------------------------------------------------- render: inspector

function kindLabel(id: Id): string {
  const n = view.code.nodes[id];
  if (view.expandedFrom.has(id)) return "Inlined call";
  if (view.origin.has(id)) return "Inlined (view only)";
  if (isNetwork(ui.def)) {
    const net = network();
    if (net.params.includes(id)) return "Outer port";
    if (net.wires.includes(id)) return "Wire";
  }
  if (n.kind === "binder") return "Variable";
  if (n.kind === "def") return isNetwork(id) ? "Network" : "Definition";
  if (n.kind === "part") return n.fn === null ? "Constant" : "Node";
  if (n.kind === "call") return node(n.fn)?.kind === "lambda" ? "Let" : "Step (call)";
  return { lit: "Literal", ref: "Reference", lambda: "Function", hole: "Hole", builtin: "Builtin", network: "Network" }[n.kind] ?? n.kind;
}

function inspector(namer: Namer, p: Presentation): HTMLElement {
  const id = ui.selected;
  if (!id || !view.code.nodes[id]) return h("div", { class: "empty" }, isNetwork(ui.def) ? "Nothing selected. Click a node, a port or a wire." : "Nothing selected. Click a block or a graph node.");
  const n = view.code.nodes[id];
  const out = h("div", { class: "insp" });
  out.append(h("div", { class: "insp-head" }, h("span", { class: "kind" }, kindLabel(id)), h("code", { class: "nid" }, id.length > 8 ? id.slice(0, 8) + "…" : id)));

  // Views of other code: only navigation.
  const virtualOf = view.origin.get(id);
  if (virtualOf || view.expandedFrom.has(id)) {
    const src = view.expandedFrom.get(id) ?? view.expandedFrom.get(id.split("~")[1]);
    const call = view.expandedFrom.has(id) ? id : id.split("~")[1];
    out.append(h("p", { class: "hint" }, `Shown inline from ${src ? namer.name(src) : "its definition"}. This is a view: to change it, edit the definition.`));
    out.append(h("div", { class: "acts" },
      src ? h("button", { class: "btn", type: "button", "data-act": "goto", "data-target": src }, "Open definition") : null,
      h("button", { class: "btn", type: "button", "data-act": "expand", "data-target": call }, "Collapse")));
    return out;
  }

  const callee = calleeDef(id);
  if (n.kind === "ref") {
    out.append(h("p", { class: "hint" }, "Points at ", h("code", {}, n.target), ` (${namer.name(n.target)}) by id.`));
    if (node(n.target).kind === "binder") out.append(h("button", { class: "btn ghost", type: "button", "data-act": "goto-node", "data-target": n.target }, "Select what it points at"));
  }
  if (callee) {
    const expandable = n.kind === "call" && defBody(callee)?.kind === "lambda";
    out.append(h("div", { class: "acts" },
      h("button", { class: "btn", type: "button", "data-act": "goto", "data-target": callee }, `Open ${namer.name(callee)}`),
      expandable ? h("button", { class: "btn", type: "button", "data-act": "expand", "data-target": id }, "Show inline") : null));
  }

  const net = isNetwork(ui.def) ? network() : null;
  const nameable = n.kind === "binder" || n.kind === "def" || n.kind === "call" || n.kind === "part";
  if (nameable) {
    const current = doc.names[ui.layer][id] ?? (ui.layer === "descriptive" ? doc.names.short[id] : "") ?? "";
    const label = n.kind === "call" ? "Step name" : n.kind === "part" ? "Label" : "Name";
    const input = h("input", { id: "f-name", type: "text", value: current ?? "", placeholder: n.kind === "call" ? "unnamed step" : n.kind === "part" ? "optional" : "", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
    input.addEventListener("change", () => rename(id, input.value));
    out.append(h("label", { class: "field", for: "f-name" }, h("span", {}, `${label} · names.${ui.layer}.json`), input));
    if (n.kind === "call") out.append(h("p", { class: "hint" }, "A named step gets its own line in the let view and a label in the graph. Clearing the name inlines it again."));
  }

  if (net?.params.includes(id)) {
    const on = known().includes(id);
    const box = h("input", { id: "f-known", type: "checkbox", checked: on }) as HTMLInputElement;
    box.addEventListener("change", () => setKnown(id, box.checked));
    out.append(h("label", { class: "check", for: "f-known" }, box, h("span", {}, "Known (an input) · layout.json")));
    out.append(h("p", { class: "hint" }, on ? "Its value comes in from outside. Untick to solve for it instead." : "The solver works it out. Tick to feed it a value instead; that inverts the network."));
    out.append(h("div", { class: "acts" }, h("button", { class: "btn danger", type: "button", "data-act": "delete" }, "Remove port")));
  } else if (net?.wires.includes(id)) {
    out.append(h("div", { class: "acts" }, h("button", { class: "btn danger", type: "button", "data-act": "delete" }, "Remove wire")));
  }

  if (n.kind === "part") {
    const dirs = (() => { try { return partDirections(doc.code, ui.def, known())[id] ?? {}; } catch { return {}; } })();
    const list = h("div", { class: "ports" });
    for (const k of portsOf(doc.code, n.fn)) {
      const w = n.bind[k];
      list.append(h("div", { class: "prow" }, h("span", { class: `pdir ${dirs[k] ?? "free"}` }, dirs[k] === "in" ? "in" : dirs[k] === "out" ? "out" : "—"),
        h("span", {}, portLabel(doc.code, p.names, n.fn, k)), h("span", { class: "pw" }, w ? namer.name(w) : "not connected")));
    }
    out.append(h("div", { class: "sub-head" }, "Ports (direction comes from the wiring)"), list);
    if (n.fn === null) {
      const input = h("input", { id: "f-lit", type: "text", value: String(n.value ?? 0), autocomplete: "off" }) as HTMLInputElement;
      input.addEventListener("change", () => setLiteral(id, input.value));
      out.append(h("label", { class: "field", for: "f-lit" }, h("span", {}, "Value · code.json"), input));
    }
    out.append(h("div", { class: "acts" }, h("button", { class: "btn danger", type: "button", "data-act": "delete" }, "Delete node")));
  }

  if (n.kind === "lit") {
    const input = h("input", { id: "f-lit", type: "text", value: String(n.value), autocomplete: "off" }) as HTMLInputElement;
    input.addEventListener("change", () => setLiteral(id, input.value));
    out.append(h("label", { class: "field", for: "f-lit" }, h("span", {}, "Value · code.json"), input));
  }

  if (n.kind === "def" && id === ui.def && defBody(id)?.kind === "lambda") {
    out.append(h("div", { class: "sub-head" }, "Run it backwards"),
      h("p", { class: "hint" }, "Turning it into a network makes every call a node you can rewire, and its result a port you can make known."),
      h("button", { class: "btn", type: "button", "data-act": "to-network" }, "Turn into a network"));
  }

  const ta = h("textarea", { id: "f-comment", rows: "2", placeholder: "Add a note to this node" }) as HTMLTextAreaElement;
  ta.value = doc.comments[id] ?? "";
  ta.addEventListener("change", () => setComment(id, ta.value));
  out.append(h("label", { class: "field", for: "f-comment" }, h("span", {}, "Comment · comments.json"), ta));

  if (isExpr(n)) {
    out.append(h("div", { class: "sub-head" }, "Change meaning · code.json"), h("div", { class: "acts" },
      h("button", { class: `btn${ui.mode === "wrap" ? " on" : ""}`, type: "button", "data-act": "wrap" }, "Wrap in…"),
      h("button", { class: `btn${ui.mode === "replace" ? " on" : ""}`, type: "button", "data-act": "replace" }, n.kind === "hole" ? "Fill…" : "Replace with…"),
      n.kind !== "hole" ? h("button", { class: "btn danger", type: "button", "data-act": "delete" }, "Delete") : ""));
    if (ui.mode === "wrap" || ui.mode === "replace") out.append(picker(id, namer));
  }
  return out;
}

function picker(sel: Id | null, namer: Namer): HTMLElement {
  const q = ui.query.trim().toLowerCase();
  const match = (strs: string[]) => !q || strs.some((s) => s.toLowerCase().includes(q));
  type Opt = { label: string; detail: string; run: () => void };
  const opts: Opt[] = [];
  const builtins = Object.values(doc.code.nodes).filter((n) => n.kind === "builtin").map((n) => n.id);
  const defs = doc.code.defs.filter((d) => d !== ui.def && defBody(d));
  const num = Number(ui.query);
  const isNum = ui.query.trim() !== "" && Number.isFinite(num);

  if (ui.mode === "add") {
    if (isNum) opts.push({ label: String(num), detail: "constant", run: () => addPart(null, num) });
    for (const f of [...builtins, ...defs]) {
      const al = aliases(f);
      const kind = node(f).kind === "def" ? (isNetwork(f) ? "network" : "definition") : RELATIONS[(node(f) as { op: string }).op] ? "relation" : "";
      if (match([...al, kind])) opts.push({ label: namer.name(f), detail: [kind, ...al.filter((a) => a !== namer.name(f))].filter(Boolean).join("  "), run: () => addPart(f) });
    }
  } else if (ui.mode === "wrap" && sel) {
    for (const f of [...builtins.filter((b) => (node(b) as { op: string }).op in impl), ...defs.filter((d) => !isNetwork(d))]) {
      const al = aliases(f);
      if (match(al)) opts.push({ label: namer.name(f), detail: al.filter((a) => a !== namer.name(f)).join("  "), run: () => wrap(sel, f) });
    }
  } else if (sel) {
    for (const b of scopeAt(sel)) {
      if (match(aliases(b))) opts.push({ label: namer.name(b), detail: `variable ${b}`, run: () => replaceWith(sel, { kind: "ref", target: b }, `Now refers to ${namer.name(b)} by id.`) });
    }
    for (const d of defs) {
      if (isNetwork(d) || !match(aliases(d))) continue;
      opts.push({ label: namer.name(d), detail: `definition ${d}`, run: () => replaceWith(sel, { kind: "ref", target: d }, `Now refers to ${namer.name(d)} by id.`) });
    }
    if (isNum) opts.unshift({ label: String(num), detail: "number", run: () => replaceWith(sel, { kind: "lit", value: num }, "Replaced with a literal.") });
    if (match(["hole", "empty", "□"])) opts.push({ label: "□", detail: "empty hole", run: () => replaceWith(sel, { kind: "hole" }, "Replaced with a hole.") });
  }

  const input = h("input", { id: "f-query", type: "search", value: ui.query, autocomplete: "off", spellcheck: "false",
    placeholder: ui.mode === "add" ? "polar, +, ×, rotate, or a number…" : ui.mode === "wrap" ? "Search by any name or symbol: *, ×, multiply…" : "Variable, definition or number" }) as HTMLInputElement;
  input.addEventListener("input", () => {
    ui.query = input.value;
    const at = input.selectionStart;
    render();
    const again = document.getElementById("f-query") as HTMLInputElement | null;
    again?.focus();
    if (again && at !== null) again.setSelectionRange(at, at);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && opts[0]) opts[0].run(); if (e.key === "Escape") { ui.mode = null; render(); } });
  const list = h("div", { class: "opts" });
  opts.slice(0, 14).forEach((o) => {
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
  const prev = undo.at(-1);
  const prevMeaning = prev && prev.code.nodes[ui.def] ? (() => { try { return hashDef(prev.code, ui.def); } catch { return "—"; } })() : meaning;
  box.append(h("div", { class: `meaning${meaning !== prevMeaning ? " moved" : ""}` },
    h("span", {}, "Meaning hash"), h("code", {}, meaning),
    h("span", { class: "chip" }, meaning === prevMeaning ? "same as before last edit" : "changed by last edit")));
  for (const f of files()) {
    const txt = f.get(doc);
    box.append(h("div", { class: `file${ui.touched.includes(f.name) ? " hot" : ""}` },
      h("span", { class: "fname" }, f.name), h("code", {}, fnv(txt)), h("span", { class: "fsize" }, `${txt.length} B`)));
  }
  return box;
}

function exprRunPanel(namer: Namer): HTMLElement {
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
    result = typeof v === "number" ? fmt(v) : String(v);
  } catch (e) {
    result = (e as Error).message;
    failed = true;
  }
  box.append(row, h("div", { class: "result" }, h("span", {}, `${namer.name(ui.def)}(…) =`), h("code", { class: failed ? "err" : undefined }, result)));
  return box;
}

interface Solved { status: string; needMore: number; steps: Step[]; solutions: { values: Record<Id, number> }[]; canonical: Record<Id, number> | null; error?: string }

function solveCurrent(): Solved {
  const net = network();
  const ks = known();
  const defaults = [1, 1, 0.5, 1, 1];
  const values = Object.fromEntries(ks.map((p) => [p, Number(ui.args[p] ?? defaults[net.params.indexOf(p)] ?? 1)]));
  try {
    return solveNetwork(doc.code, ui.def, values) as unknown as Solved;
  } catch (e) {
    return { status: "error", needMore: 0, steps: [], solutions: [], canonical: null, error: (e as Error).message };
  }
}

function netRunPanel(namer: Namer, s: Solved): HTMLElement {
  const net = network();
  const ks = known();
  const box = h("div", { class: "run" });
  const defaults = [1, 1, 0.5, 1, 1];
  const row = h("div", { class: "args" });
  for (const port of ks) {
    const val = ui.args[port] ?? String(defaults[net.params.indexOf(port)] ?? 1);
    const input = h("input", { id: `arg-${port}`, type: "text", inputmode: "decimal", value: val, "aria-label": namer.name(port) }) as HTMLInputElement;
    input.addEventListener("change", () => { ui.args[port] = input.value; render(); });
    row.append(h("label", { class: "arg", for: `arg-${port}` }, h("span", {}, namer.name(port)), input));
  }
  if (!ks.length) row.append(h("p", { class: "hint" }, "No known ports yet. Select an outer port and tick Known."));
  box.append(h("div", { class: "sub-head" }, "Known"), row);

  const wanted = net.params.filter((p) => !ks.includes(p));
  if (s.error) box.append(h("p", { class: "status-line bad" }, s.error));
  else if (s.status !== "solved") box.append(h("p", { class: "status-line warn" }, `Not enough is known. Make ${s.needMore || "more"} more port${s.needMore === 1 ? "" : "s"} known.`));
  else if (!s.solutions.length) box.append(h("p", { class: "status-line bad" }, s.steps.some((x) => x.raw.type === "newton" || x.raw.type === "tear")
    ? "No solution found. Part of this direction is found by numeric search, and the search came up empty. Often that means there is none (for example, a root the + branch can't produce)."
    : "No solution: the known values contradict each other, or need a complex number."));
  else {
    box.append(h("div", { class: "sub-head" }, "Solved"));
    for (const port of wanted) box.append(h("div", { class: "result" }, h("span", {}, namer.name(port)), h("code", {}, fmt(s.canonical![port]))));
    if (s.solutions.length > 1) {
      const alt = s.solutions.slice(1, 6).map((sol) => wanted.map((p) => `${namer.name(p)} ${fmt(sol.values[p])}`).join(", "));
      box.append(h("details", { class: "alts" }, h("summary", {}, `${s.solutions.length - 1} other solution${s.solutions.length > 2 ? "s" : ""} (other branches)`),
        ...alt.map((a) => h("div", { class: "alt" }, a))));
      box.append(h("p", { class: "hint" }, "The first one is canonical: every multi-valued inverse took its principal branch."));
    }
  }
  return box;
}

function textPanel(namer: Namer, p: Presentation, s: Solved | null): HTMLElement {
  if (s) {
    let txt: string;
    if (ui.text === "equations") txt = equationsText(namer, p);
    else if (s.error) txt = s.error;
    else if (s.status !== "solved") txt = `Underdetermined: make ${s.needMore} more port${s.needMore === 1 ? "" : "s"} known to get a program.`;
    else txt = programText(namer, p, s.steps);
    return h("pre", { class: "text" }, txt);
  }
  const fn = { nested: renderNested, let: renderLet, sexpr: renderSexpr }[ui.text as "nested" | "let" | "sexpr"] ?? renderLet;
  let txt: string;
  try { txt = fn(view.code, pres(view.names, view.comments), ui.def); } catch (e) { txt = (e as Error).message; }
  return h("pre", { class: "text" }, txt);
}

// ---------------------------------------------------------------- frame

function seg(name: string, value: string, options: [string, string][]) {
  return h("div", { class: "seg", role: "group", "aria-label": name },
    ...options.map(([v, label]) => h("button", { type: "button", class: v === value ? "on" : "", "data-set": name, "data-value": v, "aria-pressed": String(v === value) }, label)));
}

function select(id: Id | null) {
  // Re-rendering on a repeat click would detach the element before its
  // dblclick fires, and go-to-definition is a dblclick.
  if (ui.selected === id) return;
  if (ui.selected !== id && ui.mode !== "add") { ui.mode = null; ui.query = ""; }
  ui.selected = id;
  render();
}

function render() {
  view = buildView();
  const app = document.getElementById("app")!;
  const p = pres(view.names, view.comments);
  const namer = new Namer(view.code, p, ui.def);
  const scroll = [...document.querySelectorAll(".graph-wrap")].map((g) => [g.scrollLeft, g.scrollTop]);
  const focused = document.activeElement?.id;
  const net = isNetwork(ui.def);
  const solved = net ? solveCurrent() : null;

  const defTabs = h("div", { class: "seg", role: "group", "aria-label": "Definition" },
    ...doc.code.defs.filter((d) => defBody(d)).map((d) => h("button", { type: "button", class: d === ui.def ? "on" : "", "data-def": d },
      isNetwork(d) ? h("span", { class: "netmark", title: "network" }, "◇ ") : null, new Namer(doc.code, p, d).name(d))));

  const values = solved?.canonical ?? null;
  const main = net
    ? [
      h("section", { class: "panel p-net" }, h("h2", {}, `${namer.name(ui.def)} `, h("small", {}, "drag between ports to wire; drag a wired port into empty space to unwire")), networkEditor(namer, p, values)),
      h("section", { class: "panel p-text" }, h("div", { class: "text-head" }, h("h2", {}, "Derived program"), seg("text", ui.text, [["program", "For these inputs"], ["equations", "Equations"]])), textPanel(namer, p, solved)),
    ]
    : [
      h("section", { class: "panel p-blocks" }, h("h2", {}, "Blocks"), h("div", { class: "blocks-wrap" }, blocks(namer, p))),
      h("section", { class: "panel p-graph" }, h("h2", {}, "Graph ", h("small", {}, "double-click a call to open its definition")), h("div", { class: "graph-wrap" }, exprGraph(namer, p))),
      h("section", { class: "panel p-text" }, h("div", { class: "text-head" }, h("h2", {}, "Text views"), seg("text", ui.text, [["let", "Steps"], ["nested", "Nested"], ["sexpr", "Lisp"]])), textPanel(namer, p, null)),
    ];

  app.replaceChildren(
    h("header", { class: "bar" },
      h("div", { class: "brand" }, h("strong", {}, "Projectional"), h("span", {}, "the program is the tree")),
      h("div", { class: "controls" },
        ui.back.length ? h("button", { class: "btn back", type: "button", "data-act": "back" }, `← ${new Namer(doc.code, p, ui.back.at(-1)!).name(ui.back.at(-1)!)}`) : null,
        defTabs,
        seg("layer", ui.layer, [["short", "Short names"], ["descriptive", "Descriptive"]]),
        seg("style", ui.style, [["math", "a · b"], ["plain", "a * b"], ["lisp", "(* a b)"]]),
        h("div", { class: "seg" },
          h("button", { type: "button", "data-act": "undo", disabled: !undo.length }, "Undo"),
          h("button", { type: "button", "data-act": "redo", disabled: !redo.length }, "Redo"),
          h("button", { type: "button", "data-act": "reset" }, "Reset")))),
    h("div", { class: `status${ui.touched.length ? " live" : ""}`, role: "status" }, ui.note),
    h("main", { class: `grid${net ? " is-net" : ""}` },
      ...main,
      h("aside", { class: "side" },
        h("section", { class: "panel" }, h("h2", {}, "Selected"), inspector(namer, p)),
        h("section", { class: "panel" }, h("h2", {}, "Run"), net ? netRunPanel(namer, solved!) : exprRunPanel(namer)),
        h("section", { class: "panel" }, h("h2", {}, "Files"), filesPanel()))),
  );
  document.querySelectorAll(".graph-wrap").forEach((g, i) => { if (scroll[i]) [g.scrollLeft, g.scrollTop] = scroll[i]; });
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
  if (def) { openDef(def.dataset.def!); ui.back = []; return render(); }
  const act = t.closest<HTMLElement>("[data-act]");
  if (act) {
    const a = act.dataset.act;
    if (a === "undo") return travel(undo, redo, "Undid");
    if (a === "redo") return travel(redo, undo, "Redid");
    if (a === "reset") { undo.push(doc); doc = initial(); ui.def = startDef(); ui.back = []; ui.selected = null; ui.touched = files().map((f) => f.name); ui.note = "Back to the example programs."; save(); return render(); }
    if (a === "back") { const d = ui.back.pop()!; ui.def = d; ui.selected = null; ui.mode = null; ui.note = "Back."; ui.text = isNetwork(d) ? "program" : "let"; return render(); }
    if (a === "goto") return openDef(act.dataset.target!);
    if (a === "goto-node") return select(act.dataset.target!);
    if (a === "expand") return toggleExpand(act.dataset.target!);
    if (a === "to-network") return convertToNetwork();
    if (a === "add-port") return addPort();
    if (a === "wrap" || a === "replace" || a === "add") { ui.mode = ui.mode === a ? null : a; ui.query = ""; render(); document.getElementById("f-query")?.focus(); return; }
    if (a === "delete") return removeSelected();
    return;
  }
  const hit = t.closest<HTMLElement>(".blocks-wrap [data-id]");
  if (hit) { e.stopPropagation(); return select(hit.dataset.id!); }
});

document.addEventListener("dblclick", (e) => {
  const hit = (e.target as HTMLElement).closest<HTMLElement>(".blocks-wrap [data-id]");
  if (!hit) return;
  const d = calleeDef(hit.dataset.id!);
  if (d) openDef(d);
});

document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).closest("input, textarea");
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
    e.preventDefault();
    return e.shiftKey ? travel(redo, undo, "Redid") : travel(undo, redo, "Undid");
  }
  if (!typing && (e.key === "Delete" || e.key === "Backspace") && ui.selected) {
    e.preventDefault();
    removeSelected();
  }
});

// Start with the polar node selected so its port directions are on show.
{
  const b = defBody(ui.def);
  if (b?.kind === "network") ui.selected = b.parts[0] ?? null;
}
render();
