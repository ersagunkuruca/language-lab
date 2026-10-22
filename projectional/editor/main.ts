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
import phyCode from "../examples/physics/code.json" with { type: "json" };
import phyNames from "../examples/physics/names.default.json" with { type: "json" };
import phyComments from "../examples/physics/comments.json" with { type: "json" };
import phyLayout from "../examples/physics/layout.json" with { type: "json" };
import queensCode from "../examples/queens/code.json" with { type: "json" };
import queensNames from "../examples/queens/names.default.json" with { type: "json" };
import queensComments from "../examples/queens/comments.json" with { type: "json" };
import calculusCode from "../examples/calculus/code.json" with { type: "json" };
import calculusNames from "../examples/calculus/names.default.json" with { type: "json" };
import calculusComments from "../examples/calculus/comments.json" with { type: "json" };
import backwardsCode from "../examples/backwards/code.json" with { type: "json" };
import backwardsNames from "../examples/backwards/names.default.json" with { type: "json" };
import backwardsComments from "../examples/backwards/comments.json" with { type: "json" };
import relationsCode from "../examples/relations/code.json" with { type: "json" };
import relationsNames from "../examples/relations/names.default.json" with { type: "json" };
import relationsComments from "../examples/relations/comments.json" with { type: "json" };
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import mathStyle from "../styles/math.json" with { type: "json" };
import plainStyle from "../styles/plain.json" with { type: "json" };
import lispStyle from "../styles/lisp.json" with { type: "json" };
import graphStyle from "../styles/graph.json" with { type: "json" };
import { evaluate } from "../src/eval.ts";
import { hashDef } from "../src/hash.ts";
import { get, merge, parentOf, subtree, type Code, type Id, type Node, type NodeData, type NodeOf } from "../src/model.ts";
import { showType as showTypeOf } from "../src/lang/types.ts";
import { check, CLASSES, type Problem } from "../src/check.ts";
import * as E from "../src/edits.ts";
import { formatUnit, infer, NAMED, portTerm, type Inference, type Unit } from "../src/units.ts";
import { layer, type Comments, type Hints, type Names, type Presentation, type Style } from "../src/presentation.ts";
import { impl, prelude, preludeNames } from "../src/prelude.ts";
import { atomViews, isVariadic, partDirections, portLabel, portsOf, relationNames, relationPrelude, RELATIONS, solveNetwork, toNetwork, VARIADIC, type PortDirection } from "../src/relational.ts";
import { renderLet } from "../src/render/letseq.ts";
import { renderNested } from "../src/render/nested.ts";
import { renderSexpr } from "../src/render/sexpr.ts";
import { Namer } from "../src/render/namer.ts";
import { std, stdNames } from "../src/lang/std.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { runMain, showValue } from "../src/lang/run.ts";
import * as T from "./typed.ts";
import { typedGraph } from "./typedGraph.ts";
import { builtinName, builtinOf, definitionOf } from "./define.ts";
import { connectDrag, infiniteCanvas, moveDrag, type Pos } from "./canvas.ts";
// One window per graph: the program and the definition shown.
const viewKey = () => `${doc.program}/${ui.def}`;

// ---------------------------------------------------------------- state

type Layer = "short" | "descriptive";
type StyleName = "math" | "plain" | "lisp";
type TextView = "nested" | "let" | "sexpr" | "program" | "equations";

interface Layout {
  positions: Record<string, Pos>;
  // Per network: which outer ports are known. Choosing different ones is
  // how you invert it, and it never touches code.json.
  known: Record<Id, Id[]>;
  // Calls shown with the callee's body inlined. A view, not an edit.
  expanded: Id[];
}

type Program = "numbers" | "queens" | "calculus" | "backwards" | "relations";
const PROGRAMS: Program[] = ["numbers", "queens", "calculus", "backwards", "relations"];

interface Doc {
  program: Program;
  // Typed programs (src/lang/) get the typed block view and palette.
  typed: boolean;
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
  mode: null | "wrap" | "replace" | "add" | "split" | "case";
  query: string;
  args: Record<Id, string>;
  refused: boolean;
  output: { def: Id; lines: string[]; error?: string } | null;
  caseFields: Id[];
}

const styles: Record<StyleName, Style> = { math: mathStyle as unknown as Style, plain: plainStyle as unknown as Style, lisp: lispStyle as unknown as Style };
// v5: tree nodes keep an offset from the automatic layout, not a position.
const STORE = "projectional-editor-v5";

const typedDoc = (program: Program, code: Code, names: Names, comments: Comments): Doc => ({
  program, typed: true,
  code: merge(prelude, relationPrelude, std, code),
  names: { short: names, descriptive: {} },
  comments, hints: {},
  layout: { positions: {}, known: {}, expanded: [] },
});

const initialFor = (program: Program): Doc =>
  program === "queens" ? typedDoc("queens", queensCode as Code, queensNames, queensComments)
  : program === "calculus" ? typedDoc("calculus", calculusCode as Code, calculusNames, calculusComments)
  : program === "backwards" ? typedDoc("backwards", backwardsCode as Code, backwardsNames, backwardsComments)
  : program === "relations" ? typedDoc("relations", relationsCode as Code, relationsNames, relationsComments)
  : initial();

const initial = (): Doc => ({
  program: "numbers", typed: false,
  code: merge(prelude, relationPrelude, quadCode as Code, vecCode as Code, phyCode as Code),
  names: { short: { ...quadShort, ...vecNames, ...phyNames }, descriptive: quadDescriptive },
  comments: { ...quadComments, ...phyComments },
  hints: quadHints,
  layout: { positions: {}, known: { ...(vecLayout as { known: Record<Id, Id[]> }).known, ...(phyLayout as { known: Record<Id, Id[]> }).known }, expanded: [] },
});

// One document per example program; switching keeps each one's edits.
let docs: Partial<Record<Program, Doc>> = {};
let doc: Doc = initial();
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
  // Programs that have left the picker (the old data-type algebra) are dropped.
  if (saved?.docs && saved.current) {
    docs = Object.fromEntries(Object.entries(saved.docs).filter(([k]) => PROGRAMS.includes(k as Program)));
    doc = docs[saved.current as Program] ?? doc;
  }
} catch {}

const START: Record<Program, string> = { numbers: "fall", queens: "queens", calculus: "cubic", backwards: "who was greeted", relations: "to polar" };
const startDef = () => doc.code.defs.find((d) => (doc.names.short[d] ?? "") === START[doc.program]) ?? doc.code.defs[0];

const ui: UI = {
  def: startDef(),
  back: [],
  selected: null,
  layer: "descriptive",
  style: "math",
  text: "program",
  touched: [],
  note: "Drag from a port: the ports it can legally reach light up, the rest say why not. Drag a connected port into empty space to disconnect it.",
  mode: null,
  query: "",
  args: {},
  refused: false,
  output: null,
  caseFields: [],
};

// Sensible starting values for the physics example: thrown down at 5 m/s.
{
  const fall = doc.code.defs.find((d) => doc.names.short[d] === "fall");
  const d = fall ? doc.code.nodes[fall] : null;
  const b = d?.kind === "def" && d.body ? doc.code.nodes[d.body] : null;
  if (b?.kind === "network") b.params.forEach((port, i) => (ui.args[port] = ["29.62", "5", "9.81", "2"][i]));
  const period = doc.code.defs.find((d) => doc.names.short[d] === "period");
  const pd = period ? doc.code.nodes[period] : null;
  const lam = pd?.kind === "def" && pd.body ? doc.code.nodes[pd.body] : null;
  if (lam?.kind === "lambda") lam.params.forEach((x, i) => (ui.args[x] = ["1", "9.81"][i]));
}

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
  ui.refused = false;
  save();
  render();
}

// Every change to code.json goes through edits.ts, which refuses an edit
// that would introduce an error. A refusal changes nothing and says why.
function apply(e: E.Edit, note: string, extra: Partial<Doc> = {}, touched = ["code.json"]): boolean {
  if (!e.ok) {
    ui.note = `Refused: ${e.reason}. Nothing changed.`;
    ui.touched = [];
    ui.refused = true;
    render();
    return false;
  }
  if (e.select) ui.selected = e.select;
  commit({ code: e.code, ...extra }, touched, note);
  return true;
}

function save() {
  docs[doc.program] = doc;
  try { localStorage.setItem(STORE, JSON.stringify({ current: doc.program, docs })); } catch {}
}

function switchProgram(p: Program) {
  if (p === doc.program) return;
  save();
  doc = docs[p] ?? initialFor(p);
  undo.length = 0;
  redo.length = 0;
  ui.def = startDef();
  ui.back = [];
  ui.selected = null;
  ui.mode = null;
  ui.output = null;
  ui.touched = [];
  ui.refused = false;
  ui.note = doc.typed
    ? "A typed program. Hover anything for its type; click a hole for a palette of only what fits there."
    : "Drag from a port: the ports it can legally reach light up, the rest say why not.";
  save();
  render();
}

function applyT(e: T.TEdit): boolean {
  // Plain programs also have units, which only check.ts knows about.
  if (e.ok && !doc.typed) { const g = E.guard(doc.code, e.code); if (!g.ok) e = { ok: false, reason: g.reason }; }
  if (!e.ok) {
    ui.note = `Refused: ${e.reason}. Nothing changed.`;
    ui.touched = [];
    ui.refused = true;
    render();
    return false;
  }
  if (e.select) ui.selected = e.select;
  const short = e.names;
  commit({ code: e.code, names: { ...doc.names, short: short } }, ["code.json", "names.short.json"], e.note);
  return true;
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

// Unit inference and the checker, once per version of the code.
const inferred = new WeakMap<Code, Map<Id, Inference | null>>();
function unitsOf(def: Id): Inference | null {
  let m = inferred.get(doc.code);
  if (!m) inferred.set(doc.code, (m = new Map()));
  if (!m.has(def)) { try { m.set(def, infer(doc.code, def)); } catch { m.set(def, null); } }
  return m.get(def)!;
}
// Type inference for typed programs, once per version of the code.
const typedInfo = new WeakMap<Code, T.Info>();
function typesOf(): T.Info | null {
  if (!doc.typed) return null;
  let i = typedInfo.get(doc.code);
  if (!i) { try { i = T.infer(doc.code, pres().names); typedInfo.set(doc.code, i); } catch { return null; } }
  return i;
}
// The graph draws plain programs with the same renderer, so they're
// inferred too; network definitions are skipped by the type checker.
function inferAny(): T.Info | null {
  let i = typedInfo.get(doc.code);
  if (!i) { try { i = T.infer(doc.code, pres().names); typedInfo.set(doc.code, i); } catch { return null; } }
  return i;
}
const checked = new WeakMap<Code, Problem[]>();
function problems(): Problem[] {
  let ps = checked.get(doc.code);
  if (!ps) checked.set(doc.code, (ps = check(doc.code)));
  return ps;
}
const defBody = (d: Id) => { const n = node(d); return n?.kind === "def" && n.body ? node(n.body) : null; };
const isNetwork = (d: Id) => defBody(d)?.kind === "network";
const network = () => get(doc.code, (node(ui.def) as { body: Id }).body, "network");
const known = (): Id[] => (doc.layout.known[ui.def] ?? []).filter((p) => network().params.includes(p));

const pres = (names: Names = {}, comments: Comments = doc.comments): Presentation => ({
  names: layer<Names>(preludeNames, relationNames, stdNames, doc.names.short, ui.layer === "descriptive" ? doc.names.descriptive : {}, names),
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
  apply(E.setLiteral(doc.code, id, raw), "Changed a constant. That is a change in meaning, so the hash moved.");
}

function wrap(sel: Id, fn: Id) {
  apply(E.wrap(doc.code, sel, fn), `Wrapped in ${aliases(fn)[0]}. One slot per parameter, so the arity is right by construction; the wrapped part kept its ids.`);
}

function replaceWith(sel: Id, data: NodeData, label: string) {
  apply(E.replaceWith(doc.code, sel, data), label);
}

function setUnit(id: Id, unit: Unit | null) {
  apply(E.setUnit(doc.code, id, unit), unit ? `Declared ${formatUnit(unit)}. Units are part of the meaning, so the hash moved; everything wired to it now has to agree.` : "Cleared the declared unit; it's inferred from the wiring again.");
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

type PortRef = E.PortRef;
const portId = (p: PortRef) => ("ext" in p ? `ext|${p.ext}` : `${p.part}|${p.key}`);
const parsePort = (s: string): PortRef => {
  const [a, b] = s.split("|");
  return a === "ext" ? { ext: b } : { part: a, key: b };
};

const wireOf = (p: PortRef, code = doc.code): Id | undefined => E.wireOf(code, p);

function connect(a: PortRef, b: PortRef) {
  apply(E.connect(doc.code, ui.def, a, b), "Connected. Wires are ids in code.json; the solver works out which way values flow.");
}

function disconnect(p: PortRef) {
  if (!wireOf(p)) return;
  apply(E.disconnect(doc.code, ui.def, p), "Disconnected.");
}

function addPart(fn: Id | null, value?: number) {
  apply(E.addPart(doc.code, ui.def, fn, value), `Added ${fn ? labelOf(fn) : String(value)}. Drag from its ports to wire it in.`);
}

function addPort() {
  const n = network().params.length + 1;
  const e = E.addPort(doc.code, ui.def);
  if (e.ok) apply(e, "Added an outer port. Make it known to feed a value in, or leave it unknown to read one out.",
    { names: { ...doc.names, short: { ...doc.names.short, [e.created!]: `port ${n}` } } }, ["code.json", "names.short.json"]);
}

function removeSelected() {
  const id = ui.selected;
  if (!id || !node(id)) return;
  const n = node(id);
  if (isNetwork(ui.def)) {
    const net = network();
    const what = n.kind === "part" ? "Deleted the node." : net.params.includes(id) ? "Removed the outer port." : "Removed the wire.";
    if (n.kind === "part" || net.params.includes(id) || net.wires.includes(id)) { ui.selected = null; apply(E.remove(doc.code, ui.def, id), what); }
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

// ---------------------------------------------------------------- render: network editor

interface NBox { key: string; id: Id; title: string; sub?: string; cls: string; left: string[]; right: string[]; value?: string; unit?: string }

const PW = (b: NBox, label: (k: string) => string) => {
  const side = (ks: string[]) => Math.max(0, ...ks.map((k) => label(k).length));
  return Math.max(70, b.title.length * 8.5 + 28, (side(b.left) + side(b.right)) * 7.2 + 44, (b.value?.length ?? 0) * 8 + 30);
};
const PH = (b: NBox) => 30 + Math.max(1, b.left.length, b.right.length) * 20 + (b.sub ? 12 : 0);

// "a = total − b" with the wires' names in place of the port keys.
function atomFormula(namer: Namer, p: Presentation, part: Extract<Node, { kind: "part" }>, atom: { port: string; text: string }): string {
  const name = (k: string) => (part.bind[k] ? wireName(namer, p, part.bind[k]) : k);
  return `${name(atom.port)} = ${atom.text.replace(/\b(total|product|[a-z])\b/g, name)}`;
}

function networkEditor(namer: Namer, p: Presentation, values: Record<Id, number> | null): HTMLElement {
  const net = network();
  const knownSet = new Set(known());
  let dirs: Record<Id, PortDirection> = {};
  try { dirs = partDirections(doc.code, ui.def, [...knownSet]); } catch {}
  let views: ReturnType<typeof atomViews> = {};
  try { views = atomViews(doc.code, ui.def, dirs); } catch {}
  const inf = unitsOf(ui.def);
  const unitAt = (term: string) => { const u = inf?.unit(term); return u ? formatUnit(u) : ""; };

  const plabel = (fn: Id | null, key: string) => portLabel(doc.code, p.names, fn, key);
  const boxes: NBox[] = [];
  const labelFor = new Map<string, (k: string) => string>();
  const sizeLabel = new Map<string, (k: string) => string>();

  for (const port of net.params) {
    const isIn = knownSet.has(port);
    const v = values?.[port];
    const u = unitAt(port);
    boxes.push({ key: port, id: port, title: namer.name(port), cls: `ext ${isIn ? "in" : "out"}`, left: isIn ? [] : ["·"], right: isIn ? ["·"] : [], value: v === undefined ? undefined : fmt(v) + (u && u !== "1" ? ` ${u}` : ""), unit: v === undefined ? u : undefined });
    labelFor.set(port, () => "");
  }
  for (const pid of net.parts) {
    const part = node(pid) as Extract<Node, { kind: "part" }>;
    const keys = portsOf(doc.code, part.fn, part.bind);
    const d = dirs[pid] ?? {};
    // Unconnected ports sit where they usually would: results right, and for
    // relations the second half of the ports right.
    const isRel = part.fn !== null && !!RELATIONS[(node(part.fn) as { op?: string }).op ?? ""];
    const usual = (k: string) => k === "out" || k === "total" || k === "product" || (isRel && keys.indexOf(k) >= keys.length / 2);
    const isOut = (k: string) => d[k] === "out" || ((d[k] ?? "free") === "free" && usual(k));
    // A sum has no fixed symbol: it shows +, − or neg for the port it
    // computes, so flipping which outer ports are known redraws it.
    const atom = isVariadic(doc.code, part.fn) ? views[pid] : undefined;
    const atomGlyph = isVariadic(doc.code, part.fn) ? (atom?.symbol ?? ((node(part.fn!) as { op: string }).op === "sum" ? "Σ" : "Π")) : null;
    const title = part.fn === null ? String(part.value ?? 0) + (part.unit ? ` ${formatUnit(part.unit)}` : "") : atomGlyph ?? p.style.notation[part.fn]?.glyph ?? namer.name(part.fn);
    boxes.push({
      key: pid, id: pid, title, sub: p.names[pid] ?? (atom ? atomFormula(namer, p, part, atom) : undefined),
      cls: `part ${part.fn === null ? "const" : node(part.fn).kind === "def" ? "def" : atomGlyph ? "atom" : RELATIONS[(node(part.fn) as { op?: string }).op ?? ""] ? "rel" : "op"}`,
      left: keys.filter((k) => !isOut(k)), right: keys.filter(isOut),
    });
    labelFor.set(pid, (k) => plabel(part.fn, k));
    sizeLabel.set(pid, (k) => { const u = unitAt(portTerm(doc.code, pid, k)); return plabel(part.fn, k) + (u && u !== "1" ? ` ${u}` : ""); });
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
  const sized = (b: NBox) => PW(b, sizeLabel.get(b.key) ?? labelFor.get(b.key)!);
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
  const canvas = infiniteCanvas(viewKey(), "graph net");
  const root = canvas.root;

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
  canvas.world.append(wireLayer);
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
      const second = b.value ? `= ${b.value}` : b.unit ? `[${b.unit}]` : "";
      g.append(text(wdt / 2, hgt / 2 + (second ? -2 : 5), b.title, "lbl"));
      if (second) g.append(text(wdt / 2, hgt / 2 + 13, second, b.value ? "val" : "val unit"));
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
      if (!isExt) {
        const t = text(px + side * -8, py + 4, label(k), `plbl ${dir}`, side === -1 ? "start" : "end");
        const u = unitAt(portTerm(doc.code, b.id, k));
        if (u && u !== "1") { const ts = svg("tspan", { class: "punit" }); ts.textContent = side === -1 ? ` ${u}` : `${u} `; side === -1 ? t.append(ts) : t.prepend(ts); }
        g.append(t);
      }
      const dot = svg("circle", { cx: px, cy: py, r: 6, class: `dot ${dir}${bound ? " bound" : ""}`, "data-port": isExt ? `ext|${b.id}` : `${b.id}|${k}` });
      dot.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        const from = parsePort(dot.getAttribute("data-port")!);
        // Ask edits.ts about every other port before the drag starts, so
        // the ones that would be refused can say so while you hover.
        connectDrag(root, ev, "[data-port]", (other) => {
          if (other === dot) return "that's the same port";
          const r = E.connect(doc.code, ui.def, from, parsePort(other.getAttribute("data-port")!));
          return r.ok ? null : r.reason;
        }, (target) => {
          if (target && target !== dot) connect(from, parsePort(target.getAttribute("data-port")!));
          else if (!target) disconnect(from);
        });
      });
      g.append(dot);
    }
    g.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      const orig = { ...pos.get(b.key)! };
      moveDrag(root, ev, (dx, dy) => { pos.set(b.key, { x: Math.round(orig.x + dx), y: Math.round(orig.y + dy) }); place(); drawWires(); },
        (moved) => moved ? savePositions(pos, "Moved a node. Positions live in layout.json; the code is untouched.") : select(b.id), canvas.zoom());
    });
    g.addEventListener("dblclick", () => { const d = calleeDef(b.id); if (d) openDef(d); });
    canvas.world.append(g);
  }

  const bar = h("div", { class: "net-bar" },
    h("button", { class: `btn${ui.mode === "add" ? " on" : ""}`, type: "button", "data-act": "add" }, "Add node…"),
    h("button", { class: "btn", type: "button", "data-act": "add-port" }, "Add outer port"),
    h("span", { class: "legend" }, h("i", { class: "lg in" }), "given to the node", h("i", { class: "lg out" }), "solved by the node", h("i", { class: "lg free" }), "not connected", h("span", { class: "punit" }, "m/s"), "inferred unit"));
  return h("div", {}, bar, ui.mode === "add" ? picker(null, namer) : null, canvas.el);
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
    if (isVariadic(doc.code, part.fn)) {
      const { total } = VARIADIC[(t as { op: keyof typeof VARIADIC }).op];
      const terms = Object.keys(part.bind).filter((k) => k !== total).sort().map((k) => w(part.bind[k]));
      return `${terms.join(total === "total" ? " + " : " · ") || (total === "total" ? "0" : "1")} = ${w(part.bind[total])}`;
    }
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
  return ({ lit: "Literal", ref: "Reference", lambda: "Function", hole: "Hole", builtin: "Builtin", network: "Network", match: "Match", fold: "Fold", arm: "Case" } as Record<string, string>)[n.kind] ?? n.kind;
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
    const inf = unitsOf(ui.def);
    for (const k of portsOf(doc.code, n.fn, n.bind)) {
      const w = n.bind[k];
      const u = inf?.unit(portTerm(doc.code, id, k));
      list.append(h("div", { class: "prow" }, h("span", { class: `pdir ${dirs[k] ?? "free"}` }, dirs[k] === "in" ? "in" : dirs[k] === "out" ? "out" : "—"),
        h("span", {}, portLabel(doc.code, p.names, n.fn, k), u ? h("span", { class: "punit" }, ` ${formatUnit(u)}`) : null),
        h("span", { class: "pw" }, w ? namer.name(w) : isVariadic(doc.code, n.fn) && !Object.values(VARIADIC).some((v) => v.total === k) ? "spare: connect to add a term" : "not connected")));
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

  const unitBox = unitSection(id, n);
  if (unitBox) out.append(unitBox);

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

// Units: what inference says, and chips to declare one. A chip that would
// contradict the wiring is disabled and says why, before you click it.
const UNIT_CHIPS: [string, Unit | null][] = [["free", null], ["1", {}], ["m", { m: 1 }], ["s", { s: 1 }], ["kg", { kg: 1 }], ["rad", { rad: 1 }], ["A", { A: 1 }],
  ["m/s", { m: 1, s: -1 }], ["m/s²", { m: 1, s: -2 }], ...NAMED.map(([name, u]): [string, Unit] => [name, u])];

function unitSection(id: Id, n: Node): HTMLElement | null {
  const declarable = n.kind === "binder" || (n.kind === "part" && n.fn === null);
  const termOf = n.kind === "part" ? (n.fn === null ? n.bind.out ?? `${id}:out` : null) : id;
  if (!termOf && !declarable) return null;
  if (!declarable && !isExpr(n)) return null;
  const inf = unitsOf(ui.def);
  const u = termOf ? inf?.unit(termOf) : undefined;
  const declared = (n as { unit?: Unit }).unit;
  const box = h("div", {}, h("div", { class: "sub-head" }, "Unit · the type of this value"),
    h("p", { class: "hint" }, declared ? `Declared ${formatUnit(declared)}.` : u ? `Inferred ${formatUnit(u)} from what it's wired to.` : "Free: nothing pins it down yet, so it fits anywhere."));
  if (!declarable) return box;
  const chips = h("div", { class: "chips" });
  for (const [label, unit] of UNIT_CHIPS) {
    const on = unit === null ? !declared : !!declared && formatUnit(declared) === formatUnit(unit);
    const r = on ? { ok: true } : E.allowed(E.setUnit(doc.code, id, unit));
    const b = h("button", { class: `chip-btn${on ? " on" : ""}`, type: "button", disabled: !r.ok, title: r.ok ? `Declare ${label}` : `Can't: ${r.reason}` }, label);
    if (r.ok && !on) b.addEventListener("click", () => setUnit(id, unit));
    chips.append(b);
  }
  box.append(chips);
  return box;
}

function picker(sel: Id | null, namer: Namer): HTMLElement {
  const q = ui.query.trim().toLowerCase();
  const match = (strs: string[]) => !q || strs.some((s) => s.toLowerCase().includes(q));
  type Opt = { label: string; detail: string; run: () => void; why?: string };
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
      if (match(al)) opts.push({ label: namer.name(f), detail: al.filter((a) => a !== namer.name(f)).join("  "), run: () => wrap(sel, f), why: refusal(E.wrap(doc.code, sel, f)) });
    }
  } else if (sel) {
    for (const b of scopeAt(sel)) {
      if (match(aliases(b))) opts.push({ label: namer.name(b), detail: `variable ${b}`, run: () => replaceWith(sel, { kind: "ref", target: b }, `Now refers to ${namer.name(b)} by id.`), why: refusal(E.replaceWith(doc.code, sel, { kind: "ref", target: b })) });
    }
    for (const d of defs) {
      if (isNetwork(d) || !match(aliases(d))) continue;
      opts.push({ label: namer.name(d), detail: `definition ${d}`, run: () => replaceWith(sel, { kind: "ref", target: d }, `Now refers to ${namer.name(d)} by id.`), why: refusal(E.replaceWith(doc.code, sel, { kind: "ref", target: d })) });
    }
    if (isNum) opts.unshift({ label: String(num), detail: "number", run: () => replaceWith(sel, { kind: "lit", value: num }, "Replaced with a literal."), why: refusal(E.replaceWith(doc.code, sel, { kind: "lit", value: num })) });
    // A call to anything with the right number of holes, so it can't be
    // called with the wrong number of arguments.
    for (const f of [...builtins.filter((b) => (node(b) as { op: string }).op in impl), ...defs.filter((d) => !isNetwork(d))]) {
      const al = aliases(f);
      if (q && match(al)) opts.push({ label: `${namer.name(f)}(${Array.from({ length: E.arity(doc.code, f) }, () => "□").join(", ")})`, detail: "call", run: () => apply(E.callWithHoles(doc.code, sel, f), "Replaced with a call; one hole per parameter."), why: refusal(E.callWithHoles(doc.code, sel, f)) });
    }
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
  // An exact name match goes first, so Enter picks what you typed.
  const exact = (o: Opt) => (o.label.toLowerCase() === q || o.detail.toLowerCase().split(/\s+/).includes(q) ? 0 : 1);
  opts.sort((a, b) => exact(a) - exact(b));
  const usable = opts.filter((o) => !o.why);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && usable[0]) usable[0].run(); if (e.key === "Escape") { ui.mode = null; render(); } });
  const list = h("div", { class: "opts" });
  [...usable, ...opts.filter((o) => o.why)].slice(0, 14).forEach((o) => {
    const b = h("button", { class: `opt${o.why ? " no" : ""}`, type: "button", disabled: !!o.why, title: o.why ? `Can't: ${o.why}` : undefined },
      h("span", { class: "opt-l" }, o.label), h("span", { class: "opt-d" }, o.why ? `can't: ${o.why}` : o.detail));
    if (!o.why) b.addEventListener("click", o.run);
    list.append(b);
  });
  if (!opts.length) list.append(h("p", { class: "hint" }, "Nothing matches."));
  return h("div", { class: "picker" }, input, list);
}

const refusal = (e: E.Edit) => (e.ok ? undefined : e.reason);

// ---------------------------------------------------------------- render: side panels

// Every kind of error, and what happens to it here. Most can't be made at
// all; the ones that can are listed so you can click through to them.
function checksPanel(namer: Namer): HTMLElement {
  const ps = problems().filter((x) => x.def === ui.def);
  const box = h("div", { class: "checks" });
  for (const c of CLASSES) {
    const mine = ps.filter((x) => x.cls === c.cls);
    const bad = mine.some((x) => x.severity === "error");
    const state = bad ? "bad" : mine.length ? "gap" : c.cls === "runtime" ? "later" : "ok";
    const row = h("div", { class: `chk ${state}` },
      h("span", { class: "chk-n" }, mine.length ? String(mine.length) : state === "later" ? "…" : "0"),
      h("span", { class: "chk-t" }, c.title, h("small", {}, c.how)));
    box.append(row);
    for (const x of mine.slice(0, 4)) {
      const b = h("button", { class: "chk-item", type: "button", "data-act": "goto-node", "data-target": x.id }, `${namer.name(x.id)}: ${x.message}`);
      box.append(b);
    }
  }
  return box;
}

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
    const pu = unitsOf(ui.def)?.unit(b);
    row.append(h("label", { class: "arg", for: `arg-${b}` }, h("span", {}, namer.name(b), pu && Object.keys(pu).length ? h("span", { class: "punit" }, ` ${formatUnit(pu)}`) : null), input));
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
  const u = unitsOf(ui.def)?.unit(body.kind === "lambda" ? body.body : def.body);
  if (u && !failed && Object.keys(u).length) result += ` ${formatUnit(u)}`;
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
    const inf = unitsOf(ui.def);
    const withUnit = (port: Id, x: number) => { const u = inf?.unit(port); return fmt(x) + (u && Object.keys(u).length ? ` ${formatUnit(u)}` : ""); };
    for (const port of wanted) box.append(h("div", { class: "result" }, h("span", {}, namer.name(port)), h("code", {}, withUnit(port, s.canonical![port]))));
    if (s.solutions.length > 1) {
      const alt = s.solutions.slice(1, 6).map((sol) => wanted.map((p) => `${namer.name(p)} ${withUnit(p, sol.values[p])}`).join(", "));
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


// ---------------------------------------------------------------- typed programs

const blocksPres = (): Presentation => ({ ...pres(), style: { ...(blocksStyle as unknown as Style) } });
// Typed views: unnamed dots get a handle (•1, •2) for display only.
const withHandles = (p: Presentation): Presentation => ({ ...p, names: { ...T.dotHandles(doc.code, ui.def, p.names), ...p.names } });
const typedPres = (): Presentation => withHandles(blocksPres());
const GRAPH_HINT = "drag a node to move it; click a wire to put a dot on it; drag from a port, dot or output onto an input to use that value there; drag an input's wire away to leave a hole";

function typedInspector(namer: Namer, p: Presentation, info: T.Info): HTMLElement {
  const id = ui.selected;
  if (!id || !node(id)) return h("div", { class: "empty" }, "Nothing selected. Click anything in the blocks; a hole (□) opens a palette of what fits.");
  const n = node(id);
  const names = p.names;
  const out = h("div", { class: "insp" });
  out.append(h("div", { class: "insp-head" }, h("span", { class: "kind" }, kindLabel(id)), h("code", { class: "nid" }, id.length > 10 ? id.slice(0, 10) + "…" : id)));
  const t = T.typeOf(info, id, names);
  const hole = info.holes.get(id);
  if (hole) out.append(h("div", { class: "typeline" }, h("span", {}, "needs"), h("code", {}, typeName(info, hole.expected, names))));
  else if (t) out.append(h("div", { class: "typeline" }, h("span", {}, "type"), h("code", {}, t)));
  const err = info.errors.find((e) => e.id === id);
  if (err) out.append(h("p", { class: "status-line bad" }, err.message));

  const callee = calleeDef(id) ?? (n.kind === "ref" && node(n.target)?.kind === "variant" ? info.owner.get(n.target) ?? null : null);
  if (callee && callee !== ui.def) out.append(h("div", { class: "acts" }, h("button", { class: "btn", type: "button", "data-act": "goto", "data-target": callee }, `Open ${namer.name(callee)}`)));

  if (n.kind === "binder" || n.kind === "def" || n.kind === "variant") {
    const current = doc.names[ui.layer][id] ?? doc.names.short[id] ?? "";
    const input = h("input", { id: "f-name", type: "text", value: current, autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
    input.addEventListener("change", () => rename(id, input.value));
    out.append(h("label", { class: "field", for: "f-name" }, h("span", {}, `Name · names.${ui.layer}.json`), input));
  }

  // A dot: a let's binder, the shared output of its value.
  if (n.kind === "binder" && T.isDot(doc.code, ui.def, id)) {
    const k = T.usesOf(doc.code, id).length;
    const r = T.removeDot(doc.code, doc.names.short, info, ui.def, id);
    out.append(h("div", { class: "sub-head" }, "Dot · code.json"),
      h("p", { class: "hint" }, `${k === 0 ? "Nothing reads it: it is a step done for its effect." : `Feeds ${k} input${k === 1 ? "" : "s"}.`} Drag from the dot in the graph to any input it can reach to share it there. A name is optional${doc.names.short[id] === undefined ? `; without one it shows as ${names[id]}` : ""}.`),
      h("div", { class: "acts" }, h("button", { class: "btn", type: "button", "data-act": "t-undot", disabled: !r.ok, title: r.ok ? "Put the value back on its one wire" : `Can't: ${r.reason}` }, "Remove the dot")));
  }

  if (hole) out.append(fillPalette(id, info, names));

  if (n.kind === "lit") {
    const input = h("input", { id: "f-lit", type: "text", value: String(n.value), autocomplete: "off" }) as HTMLInputElement;
    input.addEventListener("change", () => applyT(T.setLit(doc.code, doc.names.short, info, id, input.value)));
    out.append(h("label", { class: "field", for: "f-lit" }, h("span", {}, `${typeof n.value === "number" ? "Number" : "Text"} · code.json`), input));
  }

  const isExprNode = ["lit", "ref", "call", "lambda", "match", "fold"].includes(n.kind) && !doc.code.defs.includes(id);
  if (isExprNode) {
    const splittable = T.scopeAt(doc.code, ui.def, id).filter((b) => T.dataTypeOf(doc.code, info, b));
    out.append(h("div", { class: "sub-head" }, "Change meaning · code.json"), h("div", { class: "acts" },
      h("button", { class: "btn danger", type: "button", "data-act": "t-clear" }, "Clear to a hole"),
      splittable.length ? h("button", { class: `btn${ui.mode === "split" ? " on" : ""}`, type: "button", "data-act": "split" }, "Split by cases…") : null));
    if (ui.mode === "split") {
      const list = h("div", { class: "opts" });
      for (const b of splittable) {
        const ty = T.dataTypeOf(doc.code, info, b)!;
        const r = T.splitOn(doc.code, doc.names.short, info, id, b);
        const btn = h("button", { class: `opt${r.ok ? "" : " no"}`, type: "button", disabled: !r.ok, title: r.ok ? undefined : `Can't: ${r.reason}` },
          h("span", { class: "opt-l" }, namer.name(b)), h("span", { class: "opt-d" }, r.ok ? `one case per ${names[ty] ?? "variant"}` : `can't: ${r.reason}`));
        if (r.ok) btn.addEventListener("click", () => applyT(r));
        list.append(btn);
      }
      out.append(h("p", { class: "hint" }, "Replaces this with a match on the variable you pick: one arm per case of its type, each starting as a copy of what's here."), list);
    }
  }

  // Data types: add a case. Every fold and match over the type gets a hole
  // arm for it, so nothing is left without the new case.
  const typeDef = n.kind === "def" && defBody(id)?.kind === "typedef" ? id : n.kind === "variant" ? info.owner.get(id) ?? null : null;
  if (typeDef) out.append(addCasePanel(typeDef, info, names));

  const ta = h("textarea", { id: "f-comment", rows: "2", placeholder: "Add a note to this node" }) as HTMLTextAreaElement;
  ta.value = doc.comments[id] ?? "";
  ta.addEventListener("change", () => setComment(id, ta.value));
  out.append(h("label", { class: "field", for: "f-comment" }, h("span", {}, "Comment · comments.json"), ta));
  return out;
}

const typeName = (info: T.Info, t: Parameters<T.Info["subst"]["zonk"]>[0], names: Names) => showTypeOf(info.subst.zonk(t), names);

function fillLabel(f: T.Filling, info: T.Info, names: Names): [string, string, string] {
  const nm = (id: Id) => names[id] ?? id;
  switch (f.kind) {
    case "ref": return [nm(f.target), typeName(info, f.type, names), node(f.target)?.kind === "binder" ? "in scope" : node(f.target)?.kind === "variant" ? "constructors" : "definitions"];
    case "call": return [`${nm(f.target)}(${Array.from({ length: f.arity }, () => "□").join(", ")})`, typeName(info, f.type, names), "calls"];
    case "lit": return [f.of === "number" ? "a number" : "a text", f.of === "number" ? "Number" : "Text", "literals"];
    case "lambda": return [`(${Array.from({ length: f.arity }, () => "□").join(", ")}) => □`, "a function", "literals"];
    default: return [`${f.kind} ${nm(f.on)}`, `one case per ${nm(f.type)}${f.kind === "fold" ? ", with each part already folded" : ""}`, "case analysis"];
  }
}

function fillPalette(hole: Id, info: T.Info, names: Names): HTMLElement {
  const q = ui.query.trim().toLowerCase();
  const all = T.fillings(doc.code, info, hole).map((f) => ({ f, l: fillLabel(f, info, names) }));
  const shown = all.filter(({ l }) => !q || l.some((s) => s.toLowerCase().includes(q)));
  const input = h("input", { id: "f-query", type: "search", value: ui.query, autocomplete: "off", spellcheck: "false", placeholder: `${all.length} things fit here. Search…` }) as HTMLInputElement;
  input.addEventListener("input", () => {
    ui.query = input.value;
    const at = input.selectionStart;
    render();
    const again = document.getElementById("f-query") as HTMLInputElement | null;
    again?.focus();
    if (again && at !== null) again.setSelectionRange(at, at);
  });
  const run = (x: (typeof all)[number]) => { ui.query = ""; applyT(T.fill(doc.code, doc.names.short, info, hole, x.f, x.l[0])); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && shown[0]) run(shown[0]); });
  const list = h("div", { class: "opts palette" });
  let group = "";
  for (const x of shown.slice(0, 40)) {
    if (x.l[2] !== group) { group = x.l[2]; list.append(h("div", { class: "pal-g" }, group)); }
    const b = h("button", { class: "opt", type: "button" }, h("span", { class: "opt-l" }, x.l[0]), h("span", { class: "opt-d" }, x.l[1]));
    b.addEventListener("click", () => run(x));
    list.append(b);
  }
  if (!shown.length) list.append(h("p", { class: "hint" }, "Nothing that fits matches."));
  return h("div", {}, h("div", { class: "sub-head" }, "Fill · only what type-checks here"), h("div", { class: "picker" }, input, list));
}

function addCasePanel(type: Id, info: T.Info, names: Names): HTMLElement {
  const td = get(doc.code, defBody(type)!.id, "typedef");
  // Field types to pick from: the ones this type already uses.
  const fieldTypes = new Map<string, Id>();
  const tt = (tid: Id): string => {
    const t = node(tid);
    if (t.kind === "tfun") return `(${t.params.map(tt).join(", ")}) -> ${tt(t.result)}`;
    const r = t as NodeOf<"tref">;
    return [names[r.target] ?? r.target, ...r.args.map(tt)].join(" ");
  };
  for (const v of td.variants) for (const f of get(doc.code, v, "variant").fields) {
    const k = tt(get(doc.code, f, "field").type);
    if (!fieldTypes.has(k)) fieldTypes.set(k, get(doc.code, f, "field").type);
  }
  const nameIn = h("input", { id: "f-case", type: "text", placeholder: "name of the new case", autocomplete: "off" }) as HTMLInputElement;
  const chips = h("div", { class: "chips" });
  ui.caseFields.forEach((tid, i) => {
    const b = h("button", { class: "chip-btn on", type: "button", title: "Remove this field" }, `${tt(tid)} ×`);
    b.addEventListener("click", () => { ui.caseFields.splice(i, 1); render(); });
    chips.append(b);
  });
  for (const [label, tid] of fieldTypes) {
    const b = h("button", { class: "chip-btn", type: "button" }, `+ ${label}`);
    b.addEventListener("click", () => { ui.caseFields.push(tid); render(); });
    chips.append(b);
  }
  const go = h("button", { class: "btn", type: "button" }, "Add the case");
  go.addEventListener("click", () => {
    const fields = ui.caseFields.map((tid, i) => ({ name: ui.caseFields.length > 1 ? ["left", "right", "third"][i] ?? `field ${i + 1}` : "of", type: tid }));
    if (applyT(T.addCase(doc.code, doc.names.short, info, type, nameIn.value, fields))) ui.caseFields = [];
  });
  nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
  return h("div", {}, h("div", { class: "sub-head" }, `Add a case to ${names[type] ?? "this type"}`),
    h("p", { class: "hint" }, "Every match and fold over this type gets an arm for it with a hole to fill, so no case can be missing."),
    h("label", { class: "field", for: "f-case" }, h("span", {}, "Name"), nameIn),
    h("div", { class: "hint" }, "Fields:"), chips, h("div", { class: "acts" }, go));
}

function graphHooks(info: T.Info) {
  return {
    selected: ui.selected,
    select: (id: Id) => select(id),
    open: (id: Id) => { const d = calleeDef(id); if (d && d !== ui.def) openDef(d); },
    canUse: (b: Id, slot: Id) => { const r = T.useVar(doc.code, doc.names.short, info, ui.def, b, slot); return r.ok ? null : r.reason; },
    use: (b: Id, slot: Id) => void applyT(T.useVar(doc.code, doc.names.short, info, ui.def, b, slot)),
    clear: (slot: Id) => void applyT(T.toHole(doc.code, doc.names.short, info, slot)),
    addDot: (slot: Id) => void applyT(T.addDot(doc.code, doc.names.short, info, ui.def, slot)),
    canShare: (from: Id) => {
      const p = T.prepareShare(doc.code, doc.names.short, info, ui.def, from);
      if ("reason" in p) return () => p.reason;
      return (slot: Id) => { if (slot === from) return "that's where it already goes"; const r = T.useVar(p.code, p.names, p.info, ui.def, p.dot, slot); return r.ok ? null : r.reason; };
    },
    share: (from: Id, slot: Id) => void applyT(T.share(doc.code, doc.names.short, info, ui.def, from, slot)),
    offsets: Object.fromEntries(Object.entries(doc.layout.positions).filter(([k]) => k.startsWith(`${ui.def}/`)).map(([k, v]) => [k.slice(ui.def.length + 1), v])),
    moved: (id: Id, off: Pos) => commit({ layout: { ...doc.layout, positions: { ...doc.layout.positions, [lkey(id)]: off } } }, ["layout.json"], "Moved a node. Where it sits lives in layout.json; the code is untouched."),
  };
}

function typedRunPanel(namer: Namer, info: T.Info): HTMLElement {
  const box = h("div", { class: "run" });
  const t = info.typeOf.get(ui.def);
  const z = t ? info.subst.zonk(t) : null;
  const action = z?.t === "fn" && z.params.length === 0;
  const main = doc.code.defs.find((d) => doc.names.short[d] === "main");
  if (!action) {
    box.append(h("p", { class: "hint" }, "Only an action (no inputs) runs on its own."),
      main ? h("button", { class: "btn", type: "button", "data-act": "goto", "data-target": main }, "Open main") : "");
    return box;
  }
  box.append(h("button", { class: "btn", type: "button", "data-act": "t-run" }, `Run ${namer.name(ui.def)}`));
  if (ui.output?.def === ui.def) {
    box.append(h("pre", { class: "text out" }, ui.output.lines.join("\n") || "(no output)"));
    if (ui.output.error) box.append(h("p", { class: "status-line bad" }, ui.output.error));
  }
  return box;
}

function runTyped(info: T.Info) {
  const lines: string[] = [];
  let error: string | undefined;
  try {
    const v = runMain(doc.code, info, ui.def, { print: (line) => lines.push(line) });
    const shown = showValue(v, doc.code, pres().names);
    if (shown !== "unit") lines.push(`→ ${shown}`);
  } catch (e) { error = (e as Error).message; }
  ui.output = { def: ui.def, lines, error };
  render();
}

// The kinds of error in a typed program, and what stops each one.
const TYPED_CLASSES: { key: string; title: string; how: string }[] = [
  { key: "-", title: "Syntax, unknown names, name clashes", how: "impossible: no text; references are ids" },
  { key: "-", title: "Wrong number of arguments", how: "impossible: a call gets one hole per input" },
  { key: "type", title: "Type mismatches", how: "prevented: the palette only offers what fits, and edits that add one are refused" },
  { key: "-", title: "Missing cases", how: "impossible: arms come from the type; adding a case adds arms" },
  { key: "-", title: "null / undefined", how: "impossible: there is no null; absence is the Choice effect" },
  { key: "effect", title: "Unhandled effects", how: "checked: effect rows; main can only print" },
  { key: "diverge", title: "Might not terminate", how: "inferred: recursion on a smaller part is total, the rest carries Diverge" },
  { key: "hole", title: "Holes", how: "allowed while editing; each knows its type" },
  { key: "runtime", title: "Domain errors", how: "only found by running: ÷ 0 fails in evaluate, √ of a negative is NaN" },
];

function typedChecks(namer: Namer, info: T.Info): HTMLElement {
  const def = node(ui.def) as NodeOf<"def">;
  const mine = new Set(def.body ? subtree(doc.code, def.body) : []);
  const errs = info.errors.filter((e) => mine.has(e.id) || e.id === ui.def);
  const holes = [...info.holes.keys()].filter((k) => mine.has(k));
  const box = h("div", { class: "checks" });
  for (const c of TYPED_CLASSES) {
    const items = c.key === "type" ? errs.filter((e) => !/performs/.test(e.message)) : c.key === "effect" ? errs.filter((e) => /performs/.test(e.message))
      : c.key === "hole" ? holes.map((id) => ({ id, message: `needs ${typeName(info, info.holes.get(id)!.expected, pres().names)}` })) : [];
    const div = c.key === "diverge" && info.divergent.has(ui.def);
    const bad = (c.key === "type" || c.key === "effect") && items.length;
    const state = bad ? "bad" : items.length || div ? "gap" : c.key === "runtime" ? "later" : "ok";
    box.append(h("div", { class: `chk ${state}` },
      h("span", { class: "chk-n" }, div ? "∞" : items.length ? String(items.length) : state === "later" ? "…" : "0"),
      h("span", { class: "chk-t" }, c.title, h("small", {}, div ? "this definition carries Diverge: run it under with fuel" : c.how))));
    for (const x of items.slice(0, 4)) box.append(h("button", { class: "chk-item", type: "button", "data-act": "goto-node", "data-target": x.id }, `${node(x.id)?.kind === "hole" ? "□" : namer.name(x.id)}: ${x.message}`));
  }
  return box;
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

// ---------------------------------------------------------------- guide
//
// Every graph uses the same few things, so they're explained once, each with
// a sample drawn with the graph's own styles. One word per thing, used
// everywhere: if two things look the same, they are the same.

const GUIDE_SEEN = "projectional-guide-seen";
let guideOpen = (() => { try { return !localStorage.getItem(GUIDE_SEEN); } catch { return true; } })();

function guide(): HTMLElement {
  const pic = (w: number, ...els: SVGElement[]) => { const r = svg("svg", { viewBox: `0 0 ${w} 40`, width: w, height: 40, class: "tgraph" }); r.append(...els); return r; };
  const box = (x: number, label: string, cls = "cn") => [svg("rect", { x, y: 6, width: 56, height: 28, rx: 7, class: cls }), text(x + 28, 25, label, "cl")];
  const wire = (x1: number, x2: number, y = 20, cls = "tw") => svg("path", { d: `M${x1},${y} C${(x1 + x2) / 2},${y} ${(x1 + x2) / 2},${y} ${x2},${y}`, class: cls });
  const items: [string, SVGElement, string][] = [
    ["Node", pic(80, ...box(12, "add"), svg("circle", { cx: 12, cy: 20, r: 5, class: "inp" }), svg("circle", { cx: 68, cy: 20, r: 5, class: "outp" })),
      "Something that computes a value: a function call, an if, a match, a fold, a relation. Inputs are the hollow circles on its left, its output is the filled circle on its right."],
    ["Wire", pic(80, wire(10, 70), svg("circle", { cx: 10, cy: 20, r: 4, class: "outp" }), svg("circle", { cx: 70, cy: 20, r: 5, class: "inp" })),
      "Carries a value from an output to an input. Drag from an output or a dot onto an input to make one; drag an input's wire into empty space to remove it."],
    ["Dot", pic(80, svg("path", { d: "M22,24 C46,24 46,10 72,10", class: "tw use" }), svg("path", { d: "M22,24 C46,24 46,36 72,36", class: "tw use" }), svg("circle", { cx: 16, cy: 24, r: 6, class: "reroute" }), text(16, 12, "a", "dotl")),
      "Where a value starts and branches out to every place that uses it. A function's parameters are dots on its frame's left edge; a dot on a wire is a let. Click any wire to put a dot on it; select a dot to name it, or leave it unnamed (•1)."],
    ["Frame", pic(80, svg("rect", { x: 4, y: 3, width: 72, height: 34, rx: 9, class: "rg lam" }), text(12, 15, "(x) =>", "rt", "start"), svg("circle", { cx: 4, cy: 26, r: 6, class: "reroute" })),
      "A function that hasn't been called yet: its parameters are the dots on its left, what it gives back leaves on its right. Each case of an if, match or fold is a frame wired into that node."],
    ["Hole", pic(80, svg("rect", { x: 10, y: 8, width: 56, height: 24, rx: 12, class: "pill hole" }), text(38, 24, "□", "pl")),
      "A value not filled in yet. It knows its type; select it and the side panel lists only what fits. The program runs until it reaches one."],
    ["Badge", pic(80, svg("rect", { x: 12, y: 2, width: 56, height: 36, rx: 7, class: "cn eff" }), text(40, 13, "Choice", "badge"), text(40, 31, "fail", "cl")),
      "The effects a node has. Choice: it can give several answers, or none. Console: it prints. Diverge: it might not finish. “handles Choice” marks a node that takes care of it, so the effect stops there."],
    ["Relation", pic(80, ...box(12, "polar", "cn rel"), svg("circle", { cx: 12, cy: 20, r: 5, class: "inp" }), svg("circle", { cx: 68, cy: 20, r: 6, class: "reroute" })),
      "A node with no fixed direction, like x² + y² = r². You choose which ports you give it (inputs, left) and it solves for the rest (dots, right). In a network you choose by marking outer ports as known."],
  ];
  return h("section", { class: "guide", "aria-label": "Guide" },
    h("div", { class: "guide-items" }, ...items.map(([t, p, d]) => h("div", { class: "guide-item" }, p, h("div", {}, h("strong", {}, t), h("p", {}, d))))),
    h("p", { class: "hint" }, "Drag a node to move it (that only changes layout.json). Double-click a node to open the function it calls. Every change goes through the same checks, so if something would break the program, it's refused and the status line says why."));
}

// A built-in isn't a black box: show its equation, its code, and every
// direction the solver can run it in (editor/define.ts).
function definitionPanel(p: Presentation): HTMLElement | null {
  const fn = builtinOf(doc.code, ui.selected);
  const d = fn ? definitionOf(doc.code, fn) : null;
  if (!fn || !d) return null;
  return h("div", { class: "define" },
    h("div", { class: "sub-head" }, `How ${builtinName(p.names, fn, d)} is defined`),
    h("p", { class: "hint" }, "It's built in: this equation is the whole definition. Give it any of the port sets below and the solver works out the rest."),
    ...d.equations.map((e) => h("pre", { class: "eq" }, e)),
    h("ul", { class: "ways" }, ...d.ways.map((w) => h("li", {}, h("span", { class: "given" }, `given ${w.given.join(", ")}`), ...w.steps.map((t) => h("code", {}, t)), w.several ? h("span", { class: "hint" }, " several answers") : null))));
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
  const info = typesOf();
  const typed = !!info && !net;
  if (info) T.setDisplayNames(p.names);

  const defTabs = h("div", { class: "seg", role: "group", "aria-label": "Definition" },
    ...doc.code.defs.filter((d) => defBody(d) && !d.startsWith("std.")).map((d) => h("button", { type: "button", class: d === ui.def ? "on" : "", "data-def": d },
      isNetwork(d) ? h("span", { class: "netmark", title: "network" }, "◇ ") : defBody(d)?.kind === "typedef" ? h("span", { class: "netmark", title: "data type" }, "▤ ") : null, p.names[d] ?? d)));

  const values = solved?.canonical ?? null;
  const main = typed
    ? [
      h("section", { class: "panel p-graph" }, h("h2", {}, "Graph ", h("small", {}, GRAPH_HINT)),
        typedGraph(doc.code, typedPres(), info, ui.def, graphHooks(info!), viewKey()).el),
      h("section", { class: "panel p-blocks" }, h("h2", {}, "Blocks ", h("small", {}, "hover for types; click a □ to fill it; double-click a name to open it")),
        h("div", { class: "blocks-wrap" }, T.renderTyped(doc.code, typedPres(), info, ui.def, ui.selected))),
      h("section", { class: "panel p-text" }, h("div", { class: "text-head" }, h("h2", {}, "As text"), h("small", {}, "the same tree, printed")),
        h("pre", { class: "text" }, (() => { try { return renderBlocks(doc.code, typedPres(), info, ui.def); } catch (e) { return (e as Error).message; } })())),
    ]
    : net
    ? [
      h("section", { class: "panel p-net" }, h("h2", {}, `${namer.name(ui.def)} `, h("small", {}, "drag between ports to wire; drag a wired port into empty space to unwire")), networkEditor(namer, p, values)),
      h("section", { class: "panel p-text" }, h("div", { class: "text-head" }, h("h2", {}, "Derived program"), seg("text", ui.text, [["program", "For these inputs"], ["equations", "Equations"]])), textPanel(namer, p, solved)),
    ]
    : [
      h("section", { class: "panel p-blocks" }, h("h2", {}, "Blocks"), h("div", { class: "blocks-wrap" }, blocks(namer, p))),
      h("section", { class: "panel p-graph" }, h("h2", {}, "Graph ", h("small", {}, GRAPH_HINT)), h("div", {}, (() => {
        const gi = inferAny();
        return gi ? typedGraph(doc.code, withHandles(p), gi, ui.def, graphHooks(gi), viewKey()).el : h("p", { class: "hint" }, "This definition can't be drawn.");
      })())),
      h("section", { class: "panel p-text" }, h("div", { class: "text-head" }, h("h2", {}, "Text views"), seg("text", ui.text, [["let", "Steps"], ["nested", "Nested"], ["sexpr", "Lisp"]])), textPanel(namer, p, null)),
    ];

  app.replaceChildren(
    h("header", { class: "bar" },
      h("div", { class: "brand" }, h("strong", {}, "Projectional"), h("span", {}, "the program is the tree")),
      h("div", { class: "controls" },
        seg("program", doc.program, [["numbers", "Numbers & networks"], ["queens", "Eight queens"], ["calculus", "Calculus"], ["backwards", "Run backwards"], ["relations", "Relations in programs"]]),
        ui.back.length ? h("button", { class: "btn back", type: "button", "data-act": "back" }, `← ${new Namer(doc.code, p, ui.back.at(-1)!).name(ui.back.at(-1)!)}`) : null,
        defTabs,
        seg("layer", ui.layer, [["short", "Short names"], ["descriptive", "Descriptive"]]),
        seg("style", ui.style, [["math", "a · b"], ["plain", "a * b"], ["lisp", "(* a b)"]]),
        h("div", { class: "seg" },
          h("button", { type: "button", "data-act": "undo", disabled: !undo.length }, "Undo"),
          h("button", { type: "button", "data-act": "redo", disabled: !redo.length }, "Redo"),
          h("button", { type: "button", "data-act": "reset" }, "Reset")),
        h("button", { class: `btn${guideOpen ? " on" : ""}`, type: "button", "data-act": "guide" }, guideOpen ? "Hide the guide" : "Guide"),
        h("a", { class: "btn", href: "tutorial.html" }, "Tutorial"))),
    ...(guideOpen ? [guide()] : []),
    h("div", { class: `status${ui.touched.length ? " live" : ""}${ui.refused ? " refused" : ""}`, role: "status" }, ui.note),
    h("main", { class: `grid${net ? " is-net" : typed ? " is-typed" : ""}` },
      ...main,
      h("aside", { class: "side" },
        h("section", { class: "panel" }, h("h2", {}, "Selected"), typed ? typedInspector(namer, typedPres(), info!) : inspector(namer, p), definitionPanel(p)),
        h("section", { class: "panel" }, h("h2", {}, "Run"), typed ? typedRunPanel(namer, info!) : net ? netRunPanel(namer, solved!) : exprRunPanel(namer)),
        h("section", { class: "panel" }, h("h2", {}, "Checks ", h("small", {}, "what can go wrong, and what stops it")), typed ? typedChecks(namer, info!) : checksPanel(namer)),
        h("section", { class: "panel" }, h("h2", {}, "Files"), filesPanel()))),
  );
  document.querySelectorAll(".graph-wrap").forEach((g, i) => { if (scroll[i]) [g.scrollLeft, g.scrollTop] = scroll[i]; });
  if (focused) document.getElementById(focused)?.focus();
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const set = t.closest<HTMLElement>("[data-set]");
  if (set) {
    if (set.dataset.set === "program") return switchProgram(set.dataset.value as Program);
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
    if (a === "reset") { undo.push(doc); doc = initialFor(doc.program); ui.def = startDef(); ui.back = []; ui.selected = null; ui.touched = files().map((f) => f.name); ui.note = "Back to the example programs."; save(); return render(); }
    if (a === "back") { const d = ui.back.pop()!; ui.def = d; ui.selected = null; ui.mode = null; ui.note = "Back."; ui.text = isNetwork(d) ? "program" : "let"; return render(); }
    if (a === "goto") return openDef(act.dataset.target!);
    if (a === "goto-node") return select(act.dataset.target!);
    if (a === "expand") return toggleExpand(act.dataset.target!);
    if (a === "to-network") return convertToNetwork();
    if (a === "add-port") return addPort();
    if (a === "wrap" || a === "replace" || a === "add") { ui.mode = ui.mode === a ? null : a; ui.query = ""; render(); document.getElementById("f-query")?.focus(); return; }
    if (a === "delete") return removeSelected();
    if (a === "t-clear" && ui.selected && typesOf()) return void applyT(T.toHole(doc.code, doc.names.short, typesOf()!, ui.selected));
    if (a === "split") { ui.mode = ui.mode === "split" ? null : "split"; return render(); }
    if (a === "t-run" && typesOf()) return runTyped(typesOf()!);
    if (a === "guide") { guideOpen = !guideOpen; try { localStorage.setItem(GUIDE_SEEN, "1"); } catch {} return render(); }
    if (a === "t-undot" && ui.selected && typesOf()) return void applyT(T.removeDot(doc.code, doc.names.short, typesOf()!, ui.def, ui.selected));
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
