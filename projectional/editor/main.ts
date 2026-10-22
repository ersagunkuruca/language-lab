// Browser editor over the same core as the CLI demo. Code is edited by
// gestures, never by typing text, and every gesture says which file it
// changed. Every program is typed, and there is one kind of definition: a
// function, drawn as blocks and as a graph. Any function can also be run
// backwards: pick which of its ports you know, the result included, and the
// one interpreter that runs things backwards (relate.ts) works out the rest.
// A function returning Bool built from equal and and is what used to be a
// network; its result is known to be true.

import quadCode from "../examples/quadratic/code.json" with { type: "json" };
import quadShort from "../examples/quadratic/names.short.json" with { type: "json" };
import quadDescriptive from "../examples/quadratic/names.descriptive.json" with { type: "json" };
import quadComments from "../examples/quadratic/comments.json" with { type: "json" };
import quadHints from "../examples/quadratic/hints.json" with { type: "json" };
import phyCode from "../examples/physics/code.json" with { type: "json" };
import phyNames from "../examples/physics/names.default.json" with { type: "json" };
import phyComments from "../examples/physics/comments.json" with { type: "json" };
import phyLayout from "../examples/physics/layout.json" with { type: "json" };
import phyExamples from "../examples/physics/examples.json" with { type: "json" };
import quadExamples from "../examples/quadratic/examples.json" with { type: "json" };
import sortCode from "../examples/sort/code.json" with { type: "json" };
import sortNames from "../examples/sort/names.default.json" with { type: "json" };
import sortComments from "../examples/sort/comments.json" with { type: "json" };
import sortExamples from "../examples/sort/examples.json" with { type: "json" };
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
import effectsCode from "../examples/effects/code.json" with { type: "json" };
import effectsNames from "../examples/effects/names.default.json" with { type: "json" };
import effectsComments from "../examples/effects/comments.json" with { type: "json" };
import effectsExamples from "../examples/effects/examples.json" with { type: "json" };
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import mathStyle from "../styles/math.json" with { type: "json" };
import plainStyle from "../styles/plain.json" with { type: "json" };
import lispStyle from "../styles/lisp.json" with { type: "json" };
import { hashDef } from "../src/hash.ts";
import { children, freshId, get, ID_PATTERN, isPublished, merge, subtree, type Code, type Id, type Node, type NodeOf } from "../src/model.ts";
import { INT, showType as showTypeOf } from "../src/lang/types.ts";
import { formatUnit, infer as unitInfer, NAMED, type Unit } from "../src/units.ts";
import { layer, type Comments, type Hints, type Names, type Presentation, type Style } from "../src/presentation.ts";
import { relationFor } from "../src/lang/equations.ts";
import { relate, showTerm } from "../src/lang/relate.ts";
import { analyze } from "../../invertible/src/index.js";
import { renderLet } from "../src/render/letseq.ts";
import { renderNested } from "../src/render/nested.ts";
import { renderSexpr } from "../src/render/sexpr.ts";
import { Namer } from "../src/render/namer.ts";
import { BOOL, TRUE } from "../src/lang/std.ts";
import { CHOICE } from "../src/lang/types.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { needsHandling, runMain, showValue, type Value } from "../src/lang/run.ts";
import { trace, type Trace } from "../src/lang/trace.ts";
import { parseValue } from "../src/lang/values.ts";
import * as T from "./typed.ts";
import { typedGraph, type GraphView, type MenuTarget } from "./typedGraph.ts";
import { builtinName, builtinOf, definitionOf } from "./define.ts";
import { type Pos } from "./canvas.ts";
import { fromFile, toFile } from "./files.ts";
import { showPin, type Pins } from "../src/lang/signatures.ts";
import { inlinable, inlineView, type InlineView } from "./inline.ts";
import * as Top from "../src/lang/toplevel.ts";
import { LIBRARY } from "../src/lang/library.ts";
// One window per graph: the program and the definition shown.
const viewKey = () => `${doc.program}/${ui.def}`;

// ---------------------------------------------------------------- state

type Layer = "short" | "descriptive";
type StyleName = "math" | "plain" | "lisp";
type TextView = "blocks" | "nested" | "let" | "sexpr";

interface Layout {
  // Where nodes were put, in world coordinates, by `def/id`. Nodes not
  // here take the automatic place.
  at?: Record<string, Pos>;
  // Bindings shown as a let node with get nodes instead of wires.
  named?: Id[];
  // Per definition: which ports (parameters, and "out" for the result) you
  // give it when running it backwards. Choosing different ones is how you
  // invert it, and it never touches code.json.
  known: Record<Id, Id[]>;
  // Calls shown with the callee's body in place (editor/inline.ts). A view.
  inline?: Id[];
}

// The examples, and programs of your own: made new, or opened from a file.
type Program = string;
const EXAMPLES: [Program, string][] = [["numbers", "Numbers & physics"], ["sort", "Insertion sort"], ["queens", "Eight queens"], ["calculus", "Calculus"], ["backwards", "Run backwards"], ["relations", "Relations in programs"], ["effects", "Effects"]];
const isExample = (p: Program) => EXAMPLES.some(([k]) => k === p);
const MINE = "mine.";

interface Doc {
  program: Program;
  // Programs of your own have a title; the examples use their label.
  title?: string;
  // Always true now; files and saved docs from before one world say false.
  typed: boolean;
  code: Code;
  names: Record<Layer, Names>;
  comments: Comments;
  hints: Hints;
  layout: Layout;
  // Example inputs per definition, as text (src/lang/values.ts): what the
  // graph shows values for. A side table like names: never code.
  examples?: Record<Id, string[]>;
  // Changed by you since it was loaded (an example as shipped is not saved
  // as yours, so it keeps up with the shipped one).
  edited?: boolean;
  // Pins: definitions whose type is frozen (src/lang/signatures.ts).
  signatures?: Pins;
}

interface UI {
  def: Id;
  back: Id[];
  selected: Id | null;
  layer: Layer;
  // What the navigator is filtered by.
  find: string;
  style: StyleName;
  text: TextView;
  touched: string[];
  note: string;
  mode: null | "split" | "new-def";
  newKind: "function" | "value" | "type" | "effect";
  query: string;
  refused: boolean;
  output: { def: Id; lines: string[]; error?: string } | null;
  // The graph's right-click menu: what it was for, where (screen, world).
  menu: { target: MenuTarget; x: number; y: number; world: Pos } | null;
  // Definitions open as tabs over the graph, and which inspector tab shows.
  tabs: Id[];
  panel: "node" | "program" | "checks" | "files";
}

const styles: Record<StyleName, Style> = { math: mathStyle as unknown as Style, plain: plainStyle as unknown as Style, lisp: lispStyle as unknown as Style };
// v5. Since free placement, layout.at holds positions; the offsets older
// versions kept in layout.positions are ignored.
const STORE = "projectional-editor-v5";

// What every program is merged onto: the builtins, the standard library
// and the modules (src/lang/library.ts). A file holds only what's on top.
const BASE = LIBRARY.code;
const baseFor = (_typed: boolean) => BASE;

// An example is a folder of the same side tables a saved file holds
// (examples/unpack.ts writes one from a file the editor saved).
const typedDoc = (program: Program, code: Code, names: Names, comments: Comments, more: { layout?: Partial<Layout>; examples?: Record<Id, string[]> } = {}): Doc => ({
  program, typed: true,
  code: merge(BASE, code),
  names: { short: names, descriptive: {} },
  comments, hints: {},
  layout: { known: {}, ...more.layout },
  examples: more.examples,
});

const initialFor = (program: Program): Doc =>
  program === "sort" ? typedDoc("sort", sortCode as Code, sortNames, sortComments, { examples: sortExamples })
  : program === "queens" ? typedDoc("queens", queensCode as Code, queensNames, queensComments)
  : program === "calculus" ? typedDoc("calculus", calculusCode as Code, calculusNames, calculusComments)
  : program === "backwards" ? typedDoc("backwards", backwardsCode as Code, backwardsNames, backwardsComments)
  : program === "relations" ? typedDoc("relations", relationsCode as Code, relationsNames, relationsComments)
  : program === "effects" ? typedDoc("effects", effectsCode as Code, effectsNames, effectsComments, { examples: effectsExamples })
  : initial();

// The quadratic and the physics: plain arithmetic, and predicates with
// units that run in every direction.
// Each starts out run the way you'd first ask (layout.json): how far it
// falls, where the point lands.
const initial = (): Doc => {
  const d = typedDoc("numbers", merge(quadCode as Code, phyCode as Code), { ...quadShort, ...phyNames }, { ...quadComments, ...phyComments }, { layout: phyLayout, examples: { ...quadExamples, ...phyExamples } });
  return { ...d, names: { short: d.names.short, descriptive: quadDescriptive }, hints: quadHints };
};

// One document per example program; switching keeps each one's edits.
let docs: Record<Program, Doc> = {};
let doc: Doc = initial();
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
  // Programs that have left the picker (the old data-type algebra) are
  // dropped, and so are untyped ones saved before one world.
  if (saved?.docs && saved.current) {
    docs = Object.fromEntries(Object.entries(saved.docs as Record<Program, Doc>)
      .filter(([k, d]) => (isExample(k) || k.startsWith(MINE)) && d.typed)
      .map(([k, d]) => [k, isExample(k) && !d.edited ? null : onToday(d)] as const)
      .filter(([k, d]) => d && (!isExample(k) || resolves(d.code)))) as Record<Program, Doc>;
    doc = docs[saved.current] ?? (isExample(saved.current) ? initialFor(saved.current) : doc);
  }
} catch {}

// A saved program holds the library it was saved with, and the library
// moves on: builtins are renamed and removed (sum-and-difference became an
// ordinary definition in one world). So a saved program is put on today's
// library: its own nodes on top of the current one. An example you never
// changed isn't kept at all, so it's always the one shipped; one you did
// change is kept unless it uses something the library no longer has.
function onToday(d: Doc): Doc {
  const own = (id: Id) => !id.includes(".") && !id.startsWith("@");
  return { ...d, code: {
    nodes: { ...BASE.nodes, ...Object.fromEntries(Object.entries(d.code.nodes).filter(([id]) => own(id))) },
    defs: [...BASE.defs, ...d.code.defs.filter(own)],
  } };
}

// Every id a node names is there: its children, and what a ref or a solve
// refers to.
function resolves(code: Code): boolean {
  return Object.values(code.nodes).every((n) => [...children(n), ...(n.kind === "ref" ? [n.target] : n.kind === "solve" ? [n.fn] : [])].every((c) => code.nodes[c]));
}

const START: Record<Program, string> = { numbers: "fall", sort: "sort", queens: "queens", calculus: "cubic", backwards: "who was greeted", relations: "to polar", effects: "main" };
// The program's own definitions, without the standard library's.
const ownDefs = (d: Doc = doc) => d.code.defs.filter((x) => !BASE.nodes[x]);
const startDef = () => doc.code.defs.find((d) => (doc.names.short[d] ?? "") === (START[doc.program] ?? "main")) ?? ownDefs()[0] ?? doc.code.defs[0];
const titleOf = (d: Doc) => d.title ?? EXAMPLES.find(([k]) => k === d.program)?.[1] ?? "Program";

const ui: UI = {
  def: startDef(),
  back: [],
  selected: null,
  layer: "descriptive",
  find: "",
  style: "math",
  text: "blocks",
  touched: [],
  note: "A typed program. Hover anything for its type; click a hole for a palette of only what fits there. Run lets you run any function backwards.",
  mode: null,
  query: "",
  refused: false,
  output: null,
  menu: null,
  newKind: "function",
  tabs: [],
  panel: "node",
};


const undo: Doc[] = [];
const redo: Doc[] = [];
// The program just deleted, until the next edit or switch: Undo brings it
// back, so a delete needs no "are you sure".
let deleted: Doc | null = null;

function commit(next: Partial<Doc>, touched: string[], note: string) {
  ui.menu = null;
  deleted = null;
  undo.push(doc);
  redo.length = 0;
  doc = { ...doc, ...next, edited: true };
  ui.touched = touched;
  ui.note = note;
  ui.mode = null;
  ui.query = "";
  ui.refused = false;
  save();
  render();
}

function save() {
  docs[doc.program] = doc;
  try { localStorage.setItem(STORE, JSON.stringify({ current: doc.program, docs })); } catch {}
}

function switchProgram(p: Program) {
  if (p === doc.program) return;
  deleted = null;
  save();
  doc = docs[p] ?? initialFor(p);
  showProgram();
}

function showProgram() {
  undo.length = 0;
  redo.length = 0;
  ui.def = startDef();
  ui.back = [];
  ui.tabs = [];
  ui.selected = firstHole();
  ui.mode = null;
  ui.output = null;
  ui.touched = [];
  ui.refused = false;
  ui.note = "A typed program. Hover anything for its type; click a hole for a palette of only what fits there.";
  save();
  render();
}

// ---------------------------------------------------------------- programs and files

function addProgram(d: Omit<Doc, "program">, note: string) {
  const id = `${MINE}${freshId()}`;
  // Two programs with one title would be two rows you can't tell apart.
  const titles = new Set(Object.values({ ...docs, [doc.program]: doc }).map(titleOf));
  if (d.title) { let t = d.title, k = 2; while (titles.has(t)) t = `${d.title} (${k++})`; d = { ...d, title: t }; }
  docs[id] = { ...d, program: id };
  switchProgram(id);
  ui.note = note;
  render();
}

// A new program is one empty action, main, ready to fill.
function newProgram() {
  const n = Object.keys(docs).filter((k) => k.startsWith(MINE)).length + 1;
  const empty = typedDoc(MINE, { nodes: {}, defs: [] }, {}, {});
  const r = Top.newDefinition(empty.code, {}, "main", { kind: "function", params: [] });
  if (!r.ok) return;
  addProgram({ ...empty, title: `Untitled ${n}`, code: r.code, names: { short: r.names, descriptive: {} } },
    "A new program with one empty action, main. Fill its hole from the palette; + New adds definitions and data types.");
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "program";

function saveFile() {
  const text = toFile({ title: titleOf(doc), typed: true, code: doc.code, names: doc.names.short, descriptive: doc.names.descriptive, comments: doc.comments, layout: doc.layout, examples: doc.examples ?? {}, signatures: doc.signatures ?? {} }, baseFor(doc.typed));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = `${slug(titleOf(doc))}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  ui.touched = [];
  ui.note = `Saved ${titleOf(doc)} as ${a.download}: code, names, comments and layout in one file. Open it here again with Open file.`;
  render();
}

function openFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = fromFile(await f.text(), baseFor);
    if ("error" in r) { ui.note = `Can't open ${f.name}: ${r.error}. Nothing changed.`; ui.refused = true; ui.touched = []; return render(); }
    const x = r.file;
    if (!x.typed) { ui.note = `Can't open ${f.name}: it's from before every program was typed, and its networks are gone. Nothing changed.`; ui.refused = true; ui.touched = []; return render(); }
    addProgram({ title: x.title, typed: x.typed, code: r.code, names: { short: x.names, descriptive: x.descriptive }, comments: x.comments, hints: {}, layout: x.layout, examples: x.examples, signatures: x.signatures },
      `Opened ${f.name} as a program of your own. Edits are kept in this browser; Save file writes them out.`);
  });
  input.click();
}

function deleteProgram() {
  if (!doc.program.startsWith(MINE)) return;
  const gone = titleOf(doc);
  const was = doc;
  delete docs[doc.program];
  doc = docs[EXAMPLES[0][0]] ?? initialFor(EXAMPLES[0][0]);
  showProgram();
  deleted = was;
  ui.note = `Deleted ${gone} from this browser. Undo brings it back.`;
  render();
}

function undeleteProgram() {
  const d = deleted;
  if (!d) return;
  docs[d.program] = d;
  switchProgram(d.program);
  ui.note = `Brought ${titleOf(d)} back.`;
  render();
}

function renameProgram(title: string) {
  if (!title.trim() || !doc.program.startsWith(MINE)) return;
  doc = { ...doc, title: title.trim() };
  save();
  ui.note = "Renamed the program.";
  render();
}

// ---------------------------------------------------------------- copy and paste

// One clipboard for every program, kept with the programs in this browser.
const CLIP = "projectional-clipboard";
let clip: T.Clip | null = (() => { try { return JSON.parse(localStorage.getItem(CLIP) ?? "null"); } catch { return null; } })();

const copyable = (id: Id | null): id is Id => {
  const n = id ? node(id) : null;
  return !!n && ["lit", "ref", "call", "lambda", "match", "fold", "solve"].includes(n.kind) && !doc.code.defs.includes(id!);
};

function copySelected(cut = false) {
  if (!copyable(ui.selected)) return;
  clip = T.copyOf(doc.code, { ...pres().names, ...doc.names.short }, ui.selected);
  try { localStorage.setItem(CLIP, JSON.stringify(clip)); } catch {}
  if (cut && typesOf()) {
    if (applyT(T.toHole(doc.code, doc.names.short, typesOf()!, ui.selected))) ui.note = "Cut it: copied, and left a hole. Select a hole and paste to put it there.";
    return render();
  }
  ui.touched = [];
  ui.note = "Copied. Select a hole (here or in another definition or program) and paste: Ctrl+V, or Paste in the panel.";
  render();
}

function pasteIntoSelected() {
  const info = typesOf();
  if (!clip || !info || !ui.selected) return;
  applyT(T.paste(doc.code, doc.names.short, info, ui.def, clip, ui.selected));
}

// Every change to code.json goes through the type checker (typed.ts),
// which refuses an edit that would introduce an error, units included. A
// refusal changes nothing and says why.
function applyT(e: T.TEdit): boolean {
  if (!e.ok) {
    ui.menu = null;
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
  if (from === undo && !from.length && deleted) return undeleteProgram();
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

// Type inference for typed programs, once per version of the code.
// Pins take part, so a pin or unpin with the same code checks again.
const NO_PINS: Pins = {};
const typedInfo = new WeakMap<Code, { pins: Pins; info: T.Info }>();
function typesOf(): T.Info | null {
  const pins = doc.signatures ?? NO_PINS;
  T.setProgramPins(pins);
  const hit = typedInfo.get(doc.code);
  if (hit?.pins === pins) return hit.info;
  try { const info = T.infer(doc.code, pres().names); typedInfo.set(doc.code, { pins, info }); return info; } catch { return null; }
}
const defBody = (d: Id) => { const n = node(d); return n?.kind === "def" && n.body ? node(n.body) : null; };

const pres = (names: Names = {}, comments: Comments = doc.comments): Presentation => ({
  names: layer<Names>(LIBRARY.names, doc.names.short, ui.layer === "descriptive" ? doc.names.descriptive : {}, names),
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
  { name: "examples.json", get: (d: Doc) => JSON.stringify(d.examples ?? {}) },
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

// The def a call, ref or solve refers to, if it's a user def.
function calleeDef(id: Id): Id | null {
  const n = node(id);
  if (!n) return null;
  let t: Id | null = null;
  if (n.kind === "call") { const fn = node(n.fn); t = fn?.kind === "ref" ? fn.target : null; }
  else if (n.kind === "ref") t = n.target;
  else if (n.kind === "solve") t = n.fn;
  return t && node(t)?.kind === "def" ? t : null;
}

// Opening a definition with holes selects the first: that's where work is.
const firstHole = () => T.nextHole(doc.code, ui.def, ui.def) ?? null;

function openDef(d: Id) {
  ui.back.push(ui.def);
  ui.def = d;
  ui.selected = firstHole();
  ui.mode = null;
  ui.touched = [];
  ui.note = `Opened ${new Namer(doc.code, pres(), d).name(d)}. Back returns to where you were.`;
  render();
}

// ---------------------------------------------------------------- gestures

function rename(id: Id, value: string) {
  const names = { ...doc.names[ui.layer] };
  if (value.trim()) names[id] = value; else delete names[id];
  const k = node(id).kind;
  const what = k === "call" ? (value.trim() ? "Named this step" : "Inlined this step") : "Renamed";
  commit({ names: { ...doc.names, [ui.layer]: names } }, [`names.${ui.layer}.json`], `${what}. Only names.${ui.layer}.json changed; the meaning hash is the same.`);
}

function setComment(id: Id, value: string) {
  const comments = { ...doc.comments };
  if (value.trim()) comments[id] = value; else delete comments[id];
  commit({ comments }, ["comments.json"], "Comment saved on the node itself, not on a line.");
}

// A unit is part of a number's type, so declaring one goes through the
// same check as any other edit: one that would make units disagree is
// refused.
function unitEdit(info: T.Info, id: Id, unit: Unit | null): T.TEdit {
  const n = node(id) as Node & { unit?: Unit };
  const { unit: _, ...rest } = n;
  const next: Node = unit ? { ...rest, unit } as Node : rest as Node;
  const code: Code = { nodes: { ...doc.code.nodes, [id]: next }, defs: doc.code.defs };
  return T.guardTyped(info, code, doc.names.short, id, unit
    ? `Declared ${formatUnit(unit)}. Units are part of the type, so everything connected to it now has to agree.`
    : "Cleared the declared unit; it's inferred from what it's connected to again.");
}

function removeSelected() {
  const info = typesOf();
  const id = ui.selected;
  if (!info || !id || !node(id) || doc.code.defs.includes(id)) return;
  const n = node(id);
  if (["lit", "ref", "call", "lambda", "match", "fold", "solve"].includes(n.kind)) void applyT(T.toHole(doc.code, doc.names.short, info, id));
}

// ---------------------------------------------------------------- run backwards
//
// Any function can be run from any of its ports: its parameters and its
// result. Which ones you know is a view (layout.json), not code, and the one
// interpreter that runs things backwards (relate.ts) does the rest. A
// function returning Bool, built from equal and and, is what used to be a
// network: its result is known to be true, and it solves for whatever ports
// you leave unknown.

const lkey = (k: string) => `${ui.def}/${k}`;
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e6) / 1e6));

// The ports of the definition shown: its parameters, then "out".
function portsOfDef(d: Id): Id[] {
  const b = defBody(d);
  return b?.kind === "lambda" ? [...b.params, "out"] : [];
}

const returnsBool = (info: T.Info, d: Id) => {
  const t = info.typeOf.get(d);
  const z = t ? info.subst.zonk(t) : null;
  return z?.t === "fn" && z.ret.t === "con" && z.ret.id === BOOL;
};

// Known ports: as chosen in layout.json, else the usual direction.
function knownPorts(info: T.Info): Id[] {
  const ports = portsOfDef(ui.def);
  const chosen = doc.layout.known[ui.def];
  if (chosen) return chosen.filter((p) => ports.includes(p));
  // A function runs forward; a predicate solves for its last parameter.
  return returnsBool(info, ui.def) ? [...ports.slice(0, -2), "out"] : ports.slice(0, -1);
}

// One set of values per definition, by port (its inputs, then "out"),
// kept in examples.json: what you give it, whichever way it runs. The
// graph shows what every node makes of them.
function portText(info: T.Info, p: Id): string {
  const i = portsOfDef(ui.def).indexOf(p);
  return doc.examples?.[ui.def]?.[i] ?? (p === "out" && returnsBool(info, ui.def) ? "true" : "");
}

function setPortText(p: Id, text: string) {
  const ports = portsOfDef(ui.def);
  const cur = ports.map((_, i) => doc.examples?.[ui.def]?.[i] ?? "");
  cur[ports.indexOf(p)] = text;
  while (cur.length && cur.at(-1) === "") cur.pop();
  ui.touched = [];
  commit({ examples: { ...(doc.examples ?? {}), [ui.def]: cur } }, ["examples.json"], "Ran it again with that value. Values live in examples.json, never in the code.");
}

function setKnown(info: T.Info, port: Id, on: boolean) {
  const cur = knownPorts(info);
  const next = on ? [...cur, port] : cur.filter((p) => p !== port);
  const name = port === "out" ? "the result" : new Namer(doc.code, pres(), ui.def).name(port);
  commit({ layout: { ...doc.layout, known: { ...doc.layout.known, [ui.def]: next } } }, ["layout.json"],
    `${on ? "Gave" : "Asked for"} ${name}. Only layout.json changed: same code, same hash, another direction.`);
}

interface Backwards { answers: { values: Record<string, string>; free: string[]; residual: string[] }[]; more: boolean; error?: string; plan?: { status: string; needMore: number; steps: Step[] } }

const backwardsCache = new Map<string, Backwards>();
function runBackwards(info: T.Info, known: Id[]): Backwards {
  const key = JSON.stringify([fnv(JSON.stringify(userCode(doc.code))), ui.def, known, known.map((k) => portText(info, k))]);
  const hit = backwardsCache.get(key);
  if (hit) return hit;
  const out: Backwards = { answers: [], more: false };
  // A port's value is written the way values print: 3, "text", [1, 2], true.
  const read = known.map((k) => [k, parseValue(portText(info, k), doc.code, pres().names)] as const);
  const bad = read.find(([, r]) => "error" in r);
  if (bad) return { answers: [], more: false, error: `${bad[0] === "out" ? "The result" : new Namer(doc.code, pres(), ui.def).name(bad[0])}: ${(bad[1] as { error: string }).error}.` };
  const values = Object.fromEntries(read.map(([k, r]) => [k, (r as { value: Value }).value]));
  // When it reads as equations, the solver's plan for this direction is
  // the program it derives, shown as text.
  try {
    const { rel, predicate } = relationFor(doc.code, ui.def);
    const given = known.filter((k) => !(predicate && k === "out"));
    if (!predicate || (known.includes("out") && values.out && (values.out as { tag?: string }).tag === TRUE)) {
      const a = analyze(rel as never, given) as unknown as { status: string; needMore: number; steps: Step[] };
      out.plan = a;
    }
  } catch {}
  let steps = 0;
  try {
    // Periodic answers (an angle plus any number of turns) that land on
    // the same values count once.
    const seen = new Set<string>();
    let tries = 0;
    for (const a of relate(doc.code, ui.def, values, { spend: () => ++steps < 20000 })) {
      const shown = Object.fromEntries(Object.entries(a.values).map(([k, v]) => [k, showTerm(v)]));
      const key = JSON.stringify(Object.values(shown).map((v) => (/^-?\d/.test(v) ? fmt(Number(v)) : v)));
      if (seen.has(key)) { if (++tries > 64) break; continue; }
      seen.add(key);
      if (out.answers.length === 6) { out.more = true; break; }
      out.answers.push({ values: shown, free: a.free, residual: a.residual });
    }
    if (steps >= 20000) out.error = "Stopped searching: this direction may go on forever. Give it more known ports.";
  } catch (e) { out.error = (e as Error).message; }
  backwardsCache.set(key, out);
  return out;
}

function backwardsPanel(namer: Namer, info: T.Info): HTMLElement {
  const box = h("div", { class: "run" });
  const ports = portsOfDef(ui.def);
  const known = knownPorts(info);
  const pred = returnsBool(info, ui.def);
  const missing = known.filter((k) => !portText(info, k).trim());
  const r: Backwards = missing.length ? { answers: [], more: false } : runBackwards(info, known);
  const units = (() => { try { return unitInfer(doc.code, ui.def); } catch { return null; } })();
  const unitOf = (p: Id) => { const u = p === "out" ? null : units?.unit(p); return u && Object.keys(u).length ? ` ${formatUnit(u)}` : ""; };
  box.append(h("p", { class: "hint" }, pred
    ? "A function that says true or false: what used to be a network. Tick the ports you know and it solves for the rest, keeping it true."
    : "Tick the ports you know, the result included, and it works out the others: this function, run backwards."));
  const nice = (v: string) => (/^-?\d/.test(v) ? fmt(Number(v)) : v.replace(/^std\.bool\./, ""));
  for (const p of ports) {
    const on = known.includes(p);
    const id = `f-port-${p}`;
    const label = p === "out" ? (pred ? "holds" : "result") : namer.name(p);
    const cb = h("input", { type: "checkbox", checked: on, title: on ? "Known: you give it. Untick to solve for it." : "Solved for. Tick to give it instead." }) as HTMLInputElement;
    cb.addEventListener("change", () => setKnown(info, p, cb.checked));
    const shown = r.answers[0]?.values[p];
    // Left free: every value fits (the angle of the origin).
    const any = !!r.answers[0]?.free.includes(p) && shown !== undefined && /^_\d+$/.test(shown);
    const input = on
      ? h("input", { id, type: "text", value: portText(info, p), autocomplete: "off", spellcheck: "false" }) as HTMLInputElement
      : h("output", { class: shown === undefined ? "none" : "", title: any ? "Any value fits here" : "" }, shown === undefined ? "?" : any ? "any" : nice(shown));
    if (on) (input as HTMLInputElement).addEventListener("change", () => setPortText(p, (input as HTMLInputElement).value));
    box.append(h("label", { class: `port-row${on ? " known" : ""}` }, cb, h("span", { class: "pname" }, label), input, h("span", { class: "unit" }, unitOf(p))));
  }
  if (missing.length) box.append(h("p", { class: "status-line warn" }, `Give ${missing.map((k) => k === "out" ? "the result" : namer.name(k)).join(", ")} a value, or untick ${missing.length === 1 ? "it" : "them"} to solve for ${missing.length === 1 ? "it" : "them"}.`));
  else if (r.error) box.append(h("p", { class: "status-line bad" }, r.error));
  else if (r.plan && r.plan.status !== "solved") box.append(h("p", { class: "status-line warn" }, `Not enough is known: give ${r.plan.needMore} more port${r.plan.needMore === 1 ? "" : "s"}, or it is a whole family of answers.`));
  else if (!r.answers.length) box.append(h("p", { class: "status-line bad" }, "No answer: the known values contradict each other, or would need a complex number."));
  if (r.answers.length > 1 || r.more) {
    const wanted = ports.filter((p) => !known.includes(p));
    const alt = r.answers.slice(1).map((a) => wanted.map((p) => `${p === "out" ? "result" : namer.name(p)} ${nice(a.values[p])}`).join(", "));
    box.append(h("details", { class: "alts" }, h("summary", {}, `${r.answers.length - 1}${r.more ? "+" : ""} other answer${r.answers.length > 2 || r.more ? "s" : ""} (other branches)`),
      h("ul", {}, ...alt.map((a) => h("li", {}, a)))));
  }
  const residual = r.answers[0]?.residual ?? [];
  if (residual.length) box.append(h("p", { class: "hint" }, `Left over: ${residual.join("; ")}`));
  if (r.plan?.status === "solved") box.append(h("details", { class: "alts" }, h("summary", {}, "The program it derives for this direction"),
    h("pre", { class: "text" }, programText(namer, pres(), r.plan.steps))));
  return box;
}

// ---------------------------------------------------------------- solver text

// Print the solver's expression trees with our names and notation.
type SExpr = { k: "num"; v: number; name?: string } | { k: "var"; name: string } | { k: "call"; f: string; args: SExpr[] };

function solverPrinter(namer: Namer) {
  const varName = (n: string): string => {
    if (n.startsWith("#k")) return "k" + n.slice(2).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[+d] ?? d).join("");
    if (n === "out") return "result";
    // A parameter, or an unknown of `for some` (its binder, numbered).
    const m = n.match(new RegExp(`^(${ID_PATTERN})(?:\\.\\d+)?$`));
    if (m) return namer.name(m[1]);
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

function programText(namer: Namer, _p: Presentation, steps: Step[]): string {
  const pr = solverPrinter(namer);
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

// ---------------------------------------------------------------- side panels

function kindLabel(id: Id): string {
  const n = node(id);
  if (n.kind === "binder") return T.isDot(doc.code, ui.def, id) ? "Dot" : "Variable";
  if (n.kind === "def") return "Definition";
  if (n.kind === "call") return node(n.fn)?.kind === "lambda" ? "Let" : "Step (call)";
  return ({ lit: "Literal", ref: "Reference", lambda: "Function", hole: "Hole", builtin: "Builtin", match: "Match", fold: "Fold", arm: "Arm", variant: "Case", field: "Field", solve: "Solve" } as Record<string, string>)[n.kind] ?? n.kind;
}

// Units: what inference says, and chips to declare one. A chip that would
// make units disagree is disabled and says why, before you click it.
const UNIT_CHIPS: [string, Unit | null][] = [["free", null], ["1", {}], ["m", { m: 1 }], ["s", { s: 1 }], ["kg", { kg: 1 }], ["A", { A: 1 }],
  ["m/s", { m: 1, s: -1 }], ["m/s²", { m: 1, s: -2 }], ...NAMED.map(([name, u]): [string, Unit] => [name, u])];

function unitSection(info: T.Info, id: Id): HTMLElement | null {
  const n = node(id);
  const declarable = n.kind === "binder" || (n.kind === "lit" && typeof n.value === "number");
  const numeric = T.typeOf(info, id, {}) === "Number";
  if (!declarable && !numeric) return null;
  const u = (() => { try { return unitInfer(doc.code, ui.def).unit(id); } catch { return undefined; } })();
  const declared = (n as { unit?: Unit }).unit;
  const box = h("div", {}, h("div", { class: "sub-head" }, "Unit · part of its type"),
    h("p", { class: "hint" }, declared ? `Declared ${formatUnit(declared)}.` : u ? `Inferred ${formatUnit(u)} from what it's connected to.` : n.kind === "lit" ? "A plain number." : "Free: nothing pins it down yet, so it fits anywhere."));
  if (!declarable) return box;
  const chips = h("div", { class: "chips" });
  for (const [label, unit] of UNIT_CHIPS) {
    const on = unit === null ? !declared : !!declared && formatUnit(declared) === formatUnit(unit);
    const r = on ? { ok: true as const } : unitEdit(info, id, unit);
    const b = h("button", { class: `chip-btn${on ? " on" : ""}`, type: "button", disabled: !r.ok, title: r.ok ? `Declare ${label}` : `Can't: ${(r as { reason: string }).reason}` }, label);
    if (r.ok && !on) b.addEventListener("click", () => applyT(unitEdit(info, id, unit)));
    chips.append(b);
  }
  box.append(chips);
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

// The same tree printed: as blocks text, or in the classic shapes (steps,
// nested, Lisp) with the chosen notation. Those three don't know cases or
// folds yet, and say so.
function textPanel(info: T.Info): string {
  try {
    if (ui.text === "blocks") return renderBlocks(doc.code, typedPres(), info, ui.def);
    const fn = { nested: renderNested, let: renderLet, sexpr: renderSexpr }[ui.text];
    return fn(doc.code, withHandles(pres()), ui.def);
  } catch (e) { return `This view can't show this definition yet (${(e as Error).message}); Blocks can.`; }
}


// ---------------------------------------------------------------- typed programs

const blocksPres = (): Presentation => ({ ...pres(), style: { ...(blocksStyle as unknown as Style) } });
// Typed views: unnamed dots get a handle (•1, •2) for display only.
const withHandles = (p: Presentation): Presentation => ({ ...p, names: { ...T.dotHandles(doc.code, ui.def, p.names), ...p.names } });
const typedPres = (): Presentation => withHandles(blocksPres());
const GRAPH_HINT = "right-click for a menu; drag a node to move it (alt-drag for a dot), shift-click or shift-drag to pick several; click a wire to put a dot on it; drag from a port, dot or output onto an input to use that value there; drag an input's wire away to leave a hole";

function typedInspector(namer: Namer, p: Presentation, info: T.Info): HTMLElement {
  if (ui.mode === "new-def") return newDefinitionForm(info);
  const id = ui.selected ?? ui.def;
  const shownFrom = view?.from.get(id);
  if (shownFrom && id.includes("~")) {
    const call = id.split("~").at(-1)!;
    return h("div", { class: "insp" }, h("p", { class: "hint" }, `Shown inline from ${namer.name(shownFrom)}. This is a view: to change it, open the definition.`),
      h("div", { class: "acts" },
        h("button", { class: "btn", type: "button", "data-act": "goto", "data-target": shownFrom }, `Open ${namer.name(shownFrom)}`),
        inlinable(view!.code, id) ? h("button", { class: "btn", type: "button", "data-act": "inline", "data-target": id }, (doc.layout.inline ?? []).includes(id) ? "Collapse" : "Show inline") : null,
        h("button", { class: "btn", type: "button", "data-act": "inline", "data-target": call }, "Collapse the call")));
  }
  if (!node(id)) return h("div", { class: "empty" }, "Nothing selected. Click anything in the blocks; a hole (□) opens a palette of what fits.");
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
  // The call itself, or its head (the name clicked to select it).
  const call = inlinable(doc.code, id) ? id : n.kind === "ref" ? Object.values(doc.code.nodes).find((c) => c.kind === "call" && c.fn === id && inlinable(doc.code, c.id))?.id : undefined;
  if ((callee && callee !== ui.def) || call) out.append(h("div", { class: "acts" },
    callee && callee !== ui.def ? h("button", { class: "btn", type: "button", "data-act": "goto", "data-target": callee }, `Open ${namer.name(callee)}`) : null,
    call ? h("button", { class: "btn", type: "button", "data-act": "inline", "data-target": call, title: "Draw the call as the definition's body, in place. A view only." }, (doc.layout.inline ?? []).includes(call) ? "Collapse" : "Show inline") : null));

  if (n.kind === "binder" || n.kind === "def" || n.kind === "variant" || n.kind === "field") {
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
  if (n.kind === "binder" && names[id] !== "_") {
    const on = (doc.layout.named ?? []).includes(id);
    out.append(h("div", { class: "sub-head" }, "Shown as · layout.json"),
      h("p", { class: "hint" }, on ? "A let node, and a get node next to every use: no long wires." : "Wires from where it's bound to every use."),
      h("div", { class: "acts" }, h("button", { class: "btn", type: "button", "data-act": "named", "data-target": id }, on ? "Show as wires" : "Show as let and get nodes")));
  }

  if (hole && clip) out.append(h("div", { class: "acts" }, h("button", { class: "btn", type: "button", "data-act": "paste", title: "Ctrl+V" }, "Paste the copy here")));
  if (hole) out.append(fillPalette(id, info, names));

  if (n.kind === "lit") {
    const input = h("input", { id: "f-lit", type: "text", value: String(n.value), autocomplete: "off" }) as HTMLInputElement;
    input.addEventListener("change", () => { if (applyT(T.setLit(doc.code, doc.names.short, info, id, input.value))) { const h = T.nextHole(doc.code, ui.def, id); if (h) select(h); } });
    // Enter on an unchanged value (an empty text, say) moves on too.
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value === String(n.value)) { const h = T.nextHole(doc.code, ui.def, id); if (h) select(h); } });
    out.append(h("label", { class: "field", for: "f-lit" }, h("span", {}, `${n.of === INT ? "Int" : typeof n.value === "number" ? "Number" : "Text"} · code.json`), input));
  }

  const isExprNode = ["lit", "ref", "call", "lambda", "match", "fold"].includes(n.kind) && !doc.code.defs.includes(id);
  if (isExprNode) {
    const splittable = T.scopeAt(doc.code, ui.def, id).filter((b) => T.dataTypeOf(doc.code, info, b));
    out.append(h("div", { class: "sub-head" }, "Change meaning · code.json"), h("div", { class: "acts" },
      h("button", { class: "btn", type: "button", "data-act": "copy", title: "Ctrl+C; Ctrl+X cuts" }, "Copy"),
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

  const units = unitSection(info, id);
  if (units) out.append(units);

  // Inputs, cases and fields, when this is one (or the definition itself).
  const structure = structurePanel(info, names);
  if (structure) out.append(structure);

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
    case "ref": return [nm(f.target), typeName(info, f.type, names), node(f.target)?.kind === "binder" ? "in scope" : node(f.target)?.kind === "variant" ? "constructors" : info.subst.resolve(f.type).t === "fn" ? "functions, not called" : "definitions"];
    case "call": return [`${nm(f.target)}(${Array.from({ length: f.arity }, () => "□").join(", ")})`, typeName(info, f.type, names), "calls"];
    case "lit": return [f.of === "number" ? "a number" : f.of === "int" ? "an integer" : "a text", f.of === "number" ? "Number" : f.of === "int" ? "Int" : "Text", "literals"];
    case "lambda": return [`(${Array.from({ length: f.arity }, () => "□").join(", ")}) => □`, "a function", "literals"];
    default: return words(f.type).effect
      ? [`handle ${nm(f.type)} in □`, `one case per operation of ${nm(f.type)}, on the computation you give next`, "case analysis"]
      : [`${f.kind} ${f.on ? nm(f.on) : "□"} · ${nm(f.type)}`, `one case per ${nm(f.type)}${f.kind === "fold" ? ", with each part already folded" : ""}${f.on ? "" : ", on a value you give next"}`, "case analysis"];
  }
}

function fillPalette(hole: Id, info: T.Info, names: Names, field = "f-query"): HTMLElement {
  const q = ui.query.trim().toLowerCase();
  // Most often wanted first; a function passed along uncalled last, since
  // at a hole of any type it would otherwise come before calling it.
  const order = ["in scope", "calls", "constructors", "definitions", "literals", "case analysis", "functions, not called"];
  const all = T.fillings(doc.code, info, hole).map((f) => ({ f, l: fillLabel(f, info, names) })).sort((a, b) => order.indexOf(a.l[2]) - order.indexOf(b.l[2]));
  const shown = all.filter(({ l }) => !q || l.some((s) => s.toLowerCase().includes(q)));
  const input = h("input", { id: field, type: "search", value: ui.query, autocomplete: "off", spellcheck: "false", placeholder: `${all.length} things fit here. Search…` }) as HTMLInputElement;
  input.addEventListener("input", () => {
    ui.query = input.value;
    const at = input.selectionStart;
    render();
    const again = document.getElementById(field) as HTMLInputElement | null;
    again?.focus();
    if (again && at !== null) again.setSelectionRange(at, at);
  });
  // What's typed may itself be a value: 3, "hi", [3, 1, 2], circle(2).
  // Offered first, and only if it fits. A bare case name is already listed.
  const typed = q && !all.some(({ l }) => l[0].toLowerCase() === q) ? T.fillValue(doc.code, doc.names.short, info, hole, ui.query, ui.def) : null;
  const value = typed?.ok ? typed : null;
  const run = (x: (typeof all)[number]) => { ui.query = ""; applyT(T.fill(doc.code, doc.names.short, info, hole, x.f, x.l[0], ui.def)); };
  const runValue = () => { ui.query = ""; applyT(value!); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { if (value) runValue(); else if (shown[0]) run(shown[0]); } });
  const list = h("div", { class: "opts palette" });
  if (value) {
    const b = h("button", { class: "opt", type: "button" }, h("span", { class: "opt-l" }, ui.query.trim()), h("span", { class: "opt-d" }, "this value, written out"));
    b.addEventListener("click", runValue);
    list.append(h("div", { class: "pal-g" }, "the value typed"), b);
  }
  let group = "";
  for (const x of shown.slice(0, 40)) {
    if (x.l[2] !== group) { group = x.l[2]; list.append(h("div", { class: "pal-g" }, group)); }
    const b = h("button", { class: "opt", type: "button" }, h("span", { class: "opt-l" }, x.l[0]), h("span", { class: "opt-d" }, x.l[1]));
    b.addEventListener("click", () => run(x));
    list.append(b);
  }
  if (!shown.length && !value) list.append(h("p", { class: "hint" }, "Nothing that fits matches. Values can be typed too: 3, \"text\", [1, 2]."));
  return h("div", {}, h("div", { class: "sub-head" }, "Fill · only what type-checks here"), h("div", { class: "picker" }, input, list));
}

// ---------------------------------------------------------------- structure
//
// Above the expressions: definitions, their inputs, data types, their cases
// and fields (src/lang/toplevel.ts). Each edit keeps every call, constructor
// and arm in step, and goes through the same type check as filling a hole.

const topT = (info: T.Info, r: Top.Top): T.TEdit => (r.ok ? T.guardTyped(info, r.code, r.names, r.select, r.note) : r);

// A button for an edit that may be refused: disabled, with the reason, when
// it would be.
// Pin or unpin the definition's type: a side table, so not a code edit.
function pinRow(info: T.Info, dname: string) {
  const pins = doc.signatures ?? {};
  const pinned = pins[ui.def];
  const r = pinned ? T.unpin(pins, ui.def, dname) : T.pin(doc.code, info, pins, ui.def, dname);
  const run = () => { if (r.ok) commit({ signatures: r.pins }, ["signatures.json"], r.note); };
  return h("div", { class: "pin-row" },
    h("div", { class: "sub-head" }, `Type of ${dname} · signatures.json`),
    h("p", { class: "hint" }, pinned ? `Pinned at ${showPin(pinned, pres().names)}: edits inside must keep it, and callers see only it.` : "Not pinned: its type is whatever its body makes it. Pin it to make that type a promise."),
    h("div", { class: "acts" }, edit(pinned ? "Unpin" : "Pin this type", pinned ? "Let the type follow the body again" : "Freeze the type it has now", r, run)));
}

function edit(label: string, title: string, r: { ok: true } | { ok: false; reason: string }, run: () => void, cls = "btn") {
  const b = h("button", { class: cls, type: "button", disabled: !r.ok, title: r.ok ? title : `Can't: ${r.reason}` }, label);
  b.addEventListener("click", run);
  return b;
}

function textField(id: string, label: string, placeholder: string, value = "") {
  const input = h("input", { id, type: "text", value, placeholder, autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  return { input, el: h("label", { class: "field", for: id }, h("span", {}, label), input) };
}

const typeText = (tid: Id, names: Names): string => {
  const t = node(tid);
  if (t.kind === "tfun") return `(${t.params.map((p) => typeText(p, names)).join(", ")}) -> ${typeText(t.result, names)}`;
  const r = t as NodeOf<"tref">;
  return [names[r.target] ?? r.target, ...r.args.map((a) => { const s = typeText(a, names); return s.includes(" ") ? `(${s})` : s; })].join(" ");
};
const specText = (t: Top.TypeSpec, names: Names): string =>
  [names[t.target] ?? t.target, ...t.args.map((a) => { const s = specText(a, names); return s.includes(" ") ? `(${s})` : s; })].join(" ");

function typeChoice(id: string, type: Id, names: Names, current: string | null) {
  const specs = Top.fieldTypes(doc.code, type);
  const select = h("select", { id }, ...specs.map((t, i) => h("option", { value: String(i), selected: specText(t, names) === current }, specText(t, names)))) as HTMLSelectElement;
  return { select, spec: () => specs[Number(select.value)] };
}

// Run a top-level edit; `then` adjusts what's shown once it's in.
function runTop(info: T.Info, r: Top.Top, then?: (r: Extract<Top.Top, { ok: true }>) => void) {
  if (applyT(topT(info, r)) && r.ok && then) { then(r); render(); }
}

const row = (...kids: Kid[]) => h("div", { class: "srow" }, ...kids);
const pick = (id: Id, label: string, detail?: string) => h("button", { class: "slink", type: "button", "data-act": "goto-node", "data-target": id }, label, detail ? h("span", { class: "opt-d" }, ` ${detail}`) : null);

// A data type's words, or an effect's: an effect's cases are operations,
// and their fields are what each is given.
function words(type: Id) {
  const effect = !!(defBody(type) as { effect?: true } | null)?.effect;
  return effect ? { effect, case: "operation", cases: "operations", field: "input", fields: "inputs" } : { effect, case: "case", cases: "cases", field: "field", fields: "fields" };
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function structurePanel(info: T.Info, names: Names): HTMLElement | null {
  const code = doc.code, sh = doc.names.short;
  const sel = ui.selected ?? ui.def;
  const n = node(sel);
  const body = defBody(ui.def);
  const own = ownDefs();
  const dname = names[ui.def] ?? "this definition";
  const out = h("div", { class: "structure" });

  if (sel === ui.def && body?.kind === "typedef") {
    // An effect is a data type whose cases are operations: the same panel,
    // in its words.
    const w = words(ui.def);
    out.append(h("div", { class: "sub-head" }, `${cap(w.cases)} of ${dname} · code.json`));
    for (const v of body.variants) {
      const fs = get(code, v, "variant").fields;
      out.append(row(pick(v, names[v] ?? w.case, fs.length ? `(${fs.map((f) => names[f] ?? w.field).join(", ")})` : ""),
        edit("×", `Remove this ${w.case}`, Top.removeCase(code, sh, ui.def, v), () => runTop(info, Top.removeCase(code, sh, ui.def, v)), "btn mini")));
    }
    const c = textField("f-new-case", `New ${w.case}`, "its name");
    const add = h("button", { class: "btn", type: "button" }, `Add the ${w.case}`);
    add.addEventListener("click", () => applyT(T.addCase(code, sh, info, ui.def, c.input.value, [])));
    c.input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
    out.append(h("p", { class: "hint" }, body.effect
      ? "Calling an operation performs it; a match on the computation that performs it handles it, one case per operation, and every such match gets a case for a new one. Select an operation to give it inputs and say what it gives back."
      : "Every match and fold over this type gets an arm for a new case, with a hole to fill. Select a case to give it fields."), c.el, h("div", { class: "acts" }, add));
  } else if (sel === ui.def && isPublished(ui.def)) {
    // A published definition is read-only; copying it in is how you change it.
    const r = T.copyIntoProgram(code, sh, info, ui.def, dname);
    out.append(h("div", { class: "sub-head" }, `${dname} is published`),
      h("p", { class: "hint" }, `It's named by its content (${ui.def.slice(0, 9)}…), so it can't change. Copy it into this program to edit your own version; this program's calls switch to the copy.`),
      h("div", { class: "acts" }, edit("Copy into my program", "A copy of your own, used by this program", r, () => { if (r.ok) { ui.def = r.select!; ui.back = []; applyT(r); } })));
    return out;
  } else if (sel === ui.def) {
    out.append(pinRow(info, dname));
    const params = body?.kind === "lambda" ? body.params : [];
    out.append(h("div", { class: "sub-head" }, `Inputs of ${dname} · code.json`));
    if (!params.length) out.append(h("p", { class: "hint" }, body?.kind === "lambda" ? "None: it's an action, run on its own." : "None: it's a value. Adding an input makes it a function."));
    params.forEach((p) => out.append(paramRow(info, names, p)));
    const c = textField("f-new-input", "New input", "its name");
    const add = h("button", { class: "btn", type: "button" }, "Add the input");
    add.addEventListener("click", () => runTop(info, Top.addParameter(code, sh, ui.def, c.input.value)));
    c.input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
    out.append(c.el, h("div", { class: "acts" }, add), h("p", { class: "hint" }, "Every call gets a hole for a new input, so none is missing an argument."));
  } else if (n?.kind === "binder" && body?.kind === "lambda" && body.params.includes(sel)) {
    out.append(h("div", { class: "sub-head" }, `Input of ${dname} · code.json`), paramRow(info, names, sel));
    return out;
  } else if (n?.kind === "variant") {
    const type = info.owner.get(sel)!;
    const w = words(type);
    out.append(h("div", { class: "sub-head" }, `${cap(w.fields)} of ${names[sel] ?? `this ${w.case}`} · code.json`));
    const fs = n.fields;
    if (!fs.length) out.append(h("p", { class: "hint" }, w.effect ? "None: performing it takes nothing." : "None: it's a constant."));
    for (const f of fs) {
      out.append(row(pick(f, names[f] ?? w.field, typeText(get(code, f, "field").type, names)),
        edit("×", `Remove this ${w.field}`, Top.removeField(code, sh, sel, f), () => runTop(info, Top.removeField(code, sh, sel, f)), "btn mini")));
    }
    const c = textField("f-new-field", `New ${w.field}`, "its name");
    const t = typeChoice("f-new-field-type", type, names, null);
    const add = h("button", { class: "btn", type: "button" }, `Add the ${w.field}`);
    add.addEventListener("click", () => runTop(info, Top.addField(code, sh, type, sel, c.input.value, t.spec())));
    out.append(c.el, h("label", { class: "field", for: "f-new-field-type" }, h("span", {}, "Holding"), t.select), h("div", { class: "acts" }, add),
      h("p", { class: "hint" }, w.effect ? "Every call of it gets a hole for a new input, and every case that handles it a name." : "Every place that makes this case gets a hole for a new field, and every arm for it a name."));
    if (w.effect) {
      // What the handler answers it with: the value the call gives back.
      const specs = Top.fieldTypes(code, type);
      const now = n.returns ? typeText(n.returns, names) : null;
      const r = h("select", { id: "f-returns" }, h("option", { value: "", selected: !now }, "nothing: it never returns"),
        ...specs.map((sp, i) => h("option", { value: String(i), selected: specText(sp, names) === now }, specText(sp, names)))) as HTMLSelectElement;
      r.addEventListener("change", () => runTop(info, Top.setReturns(code, sh, sel, r.value === "" ? null : specs[Number(r.value)])));
      out.append(h("label", { class: "field", for: "f-returns" }, h("span", {}, "Gives back"), r),
        h("p", { class: "hint" }, now ? `A call of ${names[sel] ?? "it"} is worth the ${now} its handler answers with.` : `Like abort: performing ${names[sel] ?? "it"} ends what performs it, and the handler's case gives the result instead.`));
    }
    out.append(h("div", { class: "acts" }, edit(`Remove this ${w.case}`, `Remove this ${w.case} from the ${w.effect ? "effect" : "type"}`, Top.removeCase(code, sh, type, sel), () => runTop(info, Top.removeCase(code, sh, type, sel), () => { ui.selected = null; }), "btn danger")));
    return out;
  } else if (n?.kind === "field") {
    const variant = Object.values(code.nodes).find((v) => v.kind === "variant" && v.fields.includes(sel)) as NodeOf<"variant">;
    const type = info.owner.get(sel)!;
    const t = typeChoice("f-field-type", type, names, typeText(n.type, names));
    t.select.addEventListener("change", () => runTop(info, Top.setFieldType(code, sh, sel, t.spec())));
    const w = words(type);
    out.append(h("div", { class: "sub-head" }, `${cap(w.field)} of `, pick(variant.id, names[variant.id] ?? `a ${w.case}`), " · code.json"),
      h("label", { class: "field", for: "f-field-type" }, h("span", {}, "Holding"), t.select),
      h("div", { class: "acts" }, edit(`Remove this ${w.field}`, `Remove it from the ${w.case}`, Top.removeField(code, sh, variant.id, sel), () => runTop(info, Top.removeField(code, sh, variant.id, sel), () => { ui.selected = variant.id; }), "btn danger")));
    return out;
  } else return null;

  const del = own.length > 1 ? Top.deleteDefinition(code, sh, ui.def) : { ok: false as const, reason: "it's the program's only definition" };
  out.append(h("div", { class: "acts" }, edit(`Delete ${dname}`, "Delete this definition", del, () => runTop(info, del, (r) => { ui.def = r.select; ui.selected = null; ui.back = []; }), "btn danger")));
  return out;
}

function paramRow(info: T.Info, names: Names, p: Id) {
  const code = doc.code, sh = doc.names.short;
  const mv = (by: -1 | 1) => Top.moveParameter(code, sh, ui.def, p, by);
  return row(pick(p, names[p] ?? "input"),
    edit("↑", "Move earlier", mv(-1), () => runTop(info, mv(-1)), "btn mini"),
    edit("↓", "Move later", mv(1), () => runTop(info, mv(1)), "btn mini"),
    edit("×", "Remove this input", Top.removeParameter(code, sh, ui.def, p), () => runTop(info, Top.removeParameter(code, sh, ui.def, p), () => { ui.selected = null; }), "btn mini"));
}

// + New: a function (with its inputs), a value, or a data type.
function newDefinitionForm(info: T.Info): HTMLElement {
  const name = textField("f-def-name", "Name", "what to call it");
  const kind = ui.newKind;
  const extra = kind === "function" ? textField("f-def-inputs", "Inputs", "names, separated by commas (none for an action)")
    : kind === "type" ? textField("f-def-case", "First case", "a name, e.g. circle")
    : kind === "effect" ? textField("f-def-case", "First operation", "a name, e.g. ask") : null;
  const go = h("button", { class: "btn", type: "button" }, "Create");
  go.addEventListener("click", () => {
    const shape: Top.Shape = kind === "function" ? { kind, params: (extra!.input.value).split(",").map((x) => x.trim()).filter(Boolean) }
      : kind === "type" ? { kind, firstCase: extra!.input.value }
      : kind === "effect" ? { kind, firstOperation: extra!.input.value } : { kind: "value" };
    runTop(info, Top.newDefinition(doc.code, doc.names.short, name.input.value, shape), (r) => {
      ui.back = [ui.def];
      ui.def = r.code.defs.at(-1)!;
      ui.selected = kind === "type" || kind === "effect" ? null : r.select;
      ui.mode = null;
    });
  });
  for (const f of [name, extra]) f?.input.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
  return h("div", { class: "insp" },
    h("div", { class: "sub-head" }, "New definition · code.json"),
    seg("new-kind", kind, [["function", "Function"], ["value", "Value"], ["type", "Data type"], ["effect", "Effect"]]),
    h("p", { class: "hint" }, kind === "function" ? "Takes inputs and gives back a value; with no inputs it's an action you can run."
      : kind === "value" ? "One value, computed once."
      : kind === "type" ? "Cases, each with fields: like an enum whose cases carry data."
      : "Operations a computation can ask for, like a data type whose cases are requests. Calling one performs it; whoever runs the computation answers it with a match, one case per operation."),
    name.el, extra?.el ?? null,
    h("div", { class: "acts" }, go, h("button", { class: "btn", type: "button", "data-act": "new-def" }, "Cancel")));
}

// Which program this is, and its file.
function programPanel(): HTMLElement {
  const mine = doc.program.startsWith(MINE);
  const out = h("div", { class: "insp" });
  if (mine) {
    const t = textField("f-title", "Title", "", titleOf(doc));
    t.input.addEventListener("change", () => renameProgram(t.input.value));
    out.append(t.el);
  } else out.append(h("p", { class: "hint" }, `${titleOf(doc)} is an example. Reset brings it back; Save file makes a copy you can open as your own.`));
  out.append(h("div", { class: "acts" },
    h("button", { class: "btn", type: "button", "data-act": "new-program" }, "New program"),
    h("button", { class: "btn", type: "button", "data-act": "open-file" }, "Open file…"),
    h("button", { class: "btn", type: "button", "data-act": "save-file" }, "Save file"),
    mine ? h("button", { class: "btn danger", type: "button", "data-act": "delete-program" }, "Delete") : null),
    h("p", { class: "hint" }, "Every edit is kept in this browser as you go. A file holds the code, names, comments and layout together."));
  return out;
}

// The graph, with any calls shown inline. Their copies are a view, so every
// edit that would land in one is refused with where to make it instead.
let view: InlineView | null = null;
// The graph last drawn, so the menu can ask it to tidy.
let graph: GraphView | null = null;
function graphOf(info: T.Info): HTMLElement {
  const calls = (doc.layout.inline ?? []).filter((c) => c.includes("~") || node(c));
  const p = typedPres();
  view = calls.length ? inlineView(doc.code, p.names, calls) : null;
  if (!view) return (graph = typedGraph(doc.code, p, info, ui.def, graphHooks(info), viewKey())).el;
  const v = view;
  const vinfo = T.infer(v.code, v.names);
  const hooks = graphHooks(info);
  const viewOnly = (id: Id) => (v.from.has(id) && id.includes("~") ? `this is shown inline from ${p.names[v.from.get(id)!] ?? "its definition"}: open it to change it` : null);
  return (graph = typedGraph(v.code, { ...p, names: v.names }, vinfo, ui.def, {
    ...hooks,
    canUse: (b, slot) => viewOnly(slot) ?? hooks.canUse(b, slot),
    use: (b, slot) => { if (!viewOnly(slot)) hooks.use(b, slot); },
    clear: (slot) => { if (!viewOnly(slot)) hooks.clear(slot); },
    addDot: (slot) => { if (!viewOnly(slot)) hooks.addDot(slot); },
    canShare: (from) => { const r = viewOnly(from); if (r) return () => r; const c = hooks.canShare(from); return (slot) => viewOnly(slot) ?? c(slot); },
    share: (from, slot) => { if (!viewOnly(from) && !viewOnly(slot)) hooks.share(from, slot); },
  }, viewKey())).el;
}

// A binding shown as wires, or as a let node with get nodes. A view.
function toggleNamed(b: Id) {
  const now = doc.layout.named ?? [];
  const on = now.includes(b);
  commit({ layout: { ...doc.layout, named: on ? now.filter((x) => x !== b) : [...now, b] } }, ["layout.json"],
    on ? "Back to wires: one wire from where it's bound to every use. Only layout.json changed."
      : "Shown as a let node, with a get node next to every use instead of long wires. Same binding, another look: only layout.json changed.");
}

// ---------------------------------------------------------------- the graph's menu
//
// Right-click in the graph: what you can do right there. On a hole, the
// same palette as the side panel; on empty space, add a value; on a node,
// a binding or a frame, what applies to it. Tidy and Reset only change
// layout.json.

function graphMenu(info: T.Info): HTMLElement | null {
  const m = ui.menu;
  if (!m) return null;
  const { kind, id } = m.target;
  const picked = graph?.picked() ?? [];
  const item = (label: string, act: string, hint = "", disabled?: string) =>
    h("button", { class: "ctx-item", type: "button", role: "menuitem", "data-menu": act, "data-target": id, disabled: !!disabled, title: disabled ? `Can't: ${disabled}` : hint }, label);
  const rows: (HTMLElement | null)[] = [];
  const names = typedPres().names;
  const head = (t: string) => h("div", { class: "ctx-head" }, t);
  if (kind === "hole" && id) {
    rows.push(fillPalette(id, info, names, "m-query"));
  } else if (kind === "space") {
    const r = T.addStep(doc.code, doc.names.short, info, ui.def);
    rows.push(item("Add a value here…", "add", "A new dot holding a hole, here: fill it, then wire the dot in", r.ok ? undefined : r.reason));
  } else if (kind === "binder" && id) {
    const on = (doc.layout.named ?? []).includes(id);
    rows.push(head(names[id] ?? "a value"));
    if (names[id] !== "_") rows.push(item(on ? "Show as wires" : "Show as let and get nodes", "named", on ? "Wires from here to every use" : "A let node here and a small get node at every use, instead of long wires"));
    rows.push(item("Name it…", "name"));
    if (T.isDot(doc.code, ui.def, id)) { const r = T.removeDot(doc.code, doc.names.short, info, ui.def, id); rows.push(item("Remove the dot", "undot", "Put the value back on its one wire", r.ok ? undefined : r.reason)); }
  } else if ((kind === "node" || kind === "frame") && id) {
    const d = calleeDef(id);
    if (d && d !== ui.def) rows.push(item(`Open ${new Namer(doc.code, typedPres(), d).name(d)}`, "goto"));
    const code = view?.code ?? doc.code;
    if (inlinable(code, id)) rows.push(item((doc.layout.inline ?? []).includes(id) ? "Collapse" : "Show inline", "inline", "Draw the call as the definition's body, in place. A view only."));
    const dot = T.addDot(doc.code, doc.names.short, info, ui.def, id);
    if (kind === "node") rows.push(item("Put a dot on its wire", "dot", "Share this value: a dot you can wire to other inputs", dot.ok ? undefined : dot.reason));
    if (doc.code.nodes[id] && doc.code.nodes[id].kind !== "hole") rows.push(item("Clear it (leave a hole)", "clear"));
    if (kind === "frame") rows.push(item("Tidy what's inside", "tidy-frame", "Space out the nodes in this frame"));
    rows.push(item("Back to the automatic place", "reset-one", picked.length > 1 ? "For the picked nodes" : "Forget where it was put"));
  }
  if (kind !== "hole") {
    rows.push(h("div", { class: "ctx-sep" }));
    if (picked.length > 1) rows.push(item(`Tidy the ${picked.length} picked`, "tidy-picked", "Space out only the picked nodes: no overlaps, off the wires"));
    rows.push(item("Tidy everything", "tidy-all", "Space out every node: no overlaps, nodes off wires, inputs left of what they feed"));
    rows.push(item("Reset the layout", "reset-all", "Every node back to the automatic place"));
    rows.push(item("Fit", "fit"));
  }
  const left = Math.max(8, Math.min(m.x + 10, window.innerWidth - 330)), top = Math.max(8, Math.min(m.y + 10, window.innerHeight - (kind === "hole" ? 420 : 280)));
  return h("div", { class: "ctx-menu", role: "menu", style: `left:${left}px;top:${top}px` }, ...rows);
}

function menuAction(act: string, target: Id | undefined) {
  const info = typesOf();
  const m = ui.menu;
  ui.menu = null;
  if (!info) return render();
  const forget = (keys: Id[]) => {
    const at = { ...(doc.layout.at ?? {}) };
    for (const k of keys) delete at[lkey(k)];
    commit({ layout: { ...doc.layout, at } }, ["layout.json"], "Back to the automatic place. Only layout.json changed.");
  };
  switch (act) {
    case "add": {
      const r = T.addStep(doc.code, doc.names.short, info, ui.def);
      if (!r.ok || !m) return void applyT(r);
      const hole = r.select!, w = m.world;
      ui.selected = hole;
      commit({ code: r.code, names: { ...doc.names, short: r.names }, layout: { ...doc.layout, at: { ...(doc.layout.at ?? {}), [lkey(hole)]: { x: Math.round(w.x), y: Math.round(w.y) }, [lkey(r.dot!)]: { x: Math.round(w.x) + 110, y: Math.round(w.y) + 6 } } } },
        ["code.json", "names.short.json", "layout.json"], r.note);
      ui.menu = { ...m, target: { kind: "hole", id: hole } };
      render();
      document.getElementById("m-query")?.focus();
      return;
    }
    case "named": return toggleNamed(target!);
    case "name": { select(target!); document.getElementById("f-name")?.focus(); return; }
    case "undot": return void applyT(T.removeDot(doc.code, doc.names.short, info, ui.def, target!));
    case "goto": { const d = calleeDef(target!); if (d) openDef(d); return; }
    case "inline": return toggleInline(target!);
    case "dot": return void applyT(T.addDot(doc.code, doc.names.short, info, ui.def, target!));
    case "clear": return void applyT(T.toHole(doc.code, doc.names.short, info, target!));
    case "tidy-all": return graph?.tidy(null);
    case "tidy-picked": return graph?.tidy(graph.picked());
    case "tidy-frame": return graph?.tidy([target!]);
    case "reset-one": { const p = graph?.picked() ?? []; return forget(p.length > 1 ? graph!.expand(p) : graph?.expand([target!]) ?? [target!]); }
    case "reset-all": {
      const at = Object.fromEntries(Object.entries(doc.layout.at ?? {}).filter(([k]) => !k.startsWith(`${ui.def}/`)));
      return commit({ layout: { ...doc.layout, at } }, ["layout.json"], "Every node is back where the automatic layout puts it. Only layout.json changed.");
    }
    case "fit": { render(); graph?.fit(); return; }
  }
  render();
}

function toggleInline(call: Id) {
  const now = doc.layout.inline ?? [];
  const on = now.includes(call);
  // Collapsing a call collapses what was shown inline inside it too.
  const inline = on ? now.filter((x) => x !== call && !x.endsWith(`~${call}`)) : [...now, call];
  ui.selected = call;
  commit({ layout: { ...doc.layout, inline } }, ["layout.json"],
    on ? "Collapsed the call. Only layout.json changed." : "Showing the definition inline: the call is drawn as its body, with the arguments flowing into its inputs. It's a view: layout.json changed, code.json didn't.");
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
    values: (() => {
      const tr = traced(info);
      return tr ? new Map([...tr.values].map(([id, v]) => [id, showValue(v, doc.code, pres().names)])) : undefined;
    })(),
    at: Object.fromEntries(Object.entries(doc.layout.at ?? {}).filter(([k]) => k.startsWith(`${ui.def}/`)).map(([k, v]) => [k.slice(ui.def.length + 1), v])),
    moved: (to: Record<Id, Pos>, note?: string) => {
      const n = Object.keys(to).length;
      if (!n) { ui.note = note ?? "Nothing moved."; ui.touched = []; return render(); }
      commit({ layout: { ...doc.layout, at: { ...(doc.layout.at ?? {}), ...Object.fromEntries(Object.entries(to).map(([k, v]) => [lkey(k), v])) } } }, ["layout.json"],
        note ?? `Moved ${n === 1 ? "a node" : `${n} nodes`}. Where nodes sit lives in layout.json; the code is untouched.`);
    },
    named: new Set(doc.layout.named ?? []),
    menu: (target: MenuTarget, at: Pos, world: Pos) => { ui.menu = { target, x: at.x, y: at.y, world }; ui.query = ""; render(); document.getElementById("m-query")?.focus(); },
  };
}

function typedRunPanel(namer: Namer, info: T.Info): HTMLElement {
  const box = h("div", { class: "run" });
  const t = info.typeOf.get(ui.def);
  const z = t ? info.subst.zonk(t) : null;
  const action = z?.t === "fn" && z.params.length === 0;
  const body = defBody(ui.def);
  if (!body || body.kind === "typedef") return h("p", { class: "hint" }, body?.kind === "typedef" && body.effect ? "An effect doesn't run; functions perform its operations, and a handler answers them." : "A data type doesn't run; its constructors are called from functions.");
  // An action that performs an effect nothing answers yet runs only inside
  // a handler: say where, instead of a Run that can only fail.
  const needs = action ? needsHandling(z).filter((e) => e !== CHOICE) : [];
  if (needs.length) {
    const effs = needs.map((e) => pres().names[e] ?? e).join(" and ");
    box.append(h("p", { class: "hint" }, `${namer.name(ui.def)} performs ${effs}, and nothing here answers it. To run it, call it inside `, h("code", {}, `handle ${effs}`), "."));
  } else if (action) {
    box.append(h("button", { class: "btn", type: "button", "data-act": "t-run" }, `Run ${namer.name(ui.def)}`));
    if (ui.output?.def === ui.def) {
      box.append(h("pre", { class: "text out" }, ui.output.lines.join("\n") || "(no output)"));
      if (ui.output.error) box.append(h("p", { class: "status-line bad" }, ui.output.error));
    }
  } else if (z?.t === "fn") box.append(backwardsPanel(namer, info));
  // Values on the wires: a function shows them for the values above; an
  // action, once you ask (it may take a while, and its printing is left out).
  const ex = doc.examples?.[ui.def];
  const tr = traced(info);
  if (action && !needs.length) box.append(h("div", { class: "acts" },
    h("button", { class: "btn", type: "button", "data-act": "t-values", title: "Run it and show what every node made, printing left out" }, ex ? "Update values" : "Show values"),
    ex ? h("button", { class: "btn", type: "button", "data-act": "t-novalues" }, "Hide values") : null));
  else if (z?.t === "fn") box.append(h("p", { class: "hint" }, "The graph shows what every node makes of these values. They're saved in examples.json, not in the code."));
  if (tr?.result !== undefined && action) box.append(h("p", { class: "hint" }, "Gives ", h("code", {}, showValue(tr.result, doc.code, pres().names))));
  if (tr?.error) box.append(h("p", { class: "status-line bad" }, `Values stopped: ${tr.error.message}.`));
  return box;
}

// An action's values come from running it, so they're asked for.
function showValues() {
  commit({ examples: { ...(doc.examples ?? {}), [ui.def]: [] } }, ["examples.json"], "Values on the wires: each node shows what it made. Printing is left out.");
}

function hideValues() {
  const examples = { ...(doc.examples ?? {}) };
  delete examples[ui.def];
  commit({ examples }, ["examples.json"], "Values hidden.");
}

// The run on the examples, once per version of the code and examples.
const traces = new WeakMap<Code, Map<string, Trace>>();
// The inputs the graph shows values for: the values given, and for the
// ports solved for, the first answer. None until every input has one.
function traceInputs(info: T.Info): string[] | null {
  const body = defBody(ui.def);
  if (body?.kind !== "lambda") return doc.examples?.[ui.def] ? [] : null;
  const known = knownPorts(info);
  const answer = known.length === portsOfDef(ui.def).length - 1 && !known.includes("out") ? null : runBackwards(info, known).answers[0];
  const texts = body.params.map((p) => (known.includes(p) ? portText(info, p) : answer?.values[p] ?? ""));
  return texts.every((t) => t.trim()) ? texts : null;
}

function traced(info: T.Info): Trace | null {
  const texts = traceInputs(info);
  if (!texts) return null;
  // What performs an effect of your own has values only inside a handler.
  const t = info.typeOf.get(ui.def);
  const z = t ? info.subst.zonk(t) : null;
  if (z?.t === "fn" && needsHandling(z).some((e) => e !== CHOICE)) return null;
  const key = `${ui.def}\u0000${texts.join("\u0000")}`;
  let m = traces.get(doc.code);
  if (!m) traces.set(doc.code, (m = new Map()));
  if (!m.has(key)) {
    const args = texts.map((t) => parseValue(t, doc.code, pres().names));
    m.set(key, args.some((a) => "error" in a) ? { values: new Map(), error: { id: ui.def, message: "a value doesn't read as one" } }
      : trace(doc.code, info, ui.def, args.map((a) => (a as { value: Value }).value)));
  }
  return m.get(key)!;
}

function runTyped(info: T.Info) {
  const lines: string[] = [];
  let error: string | undefined;
  try {
    const v = runMain(doc.code, info, ui.def, { print: (line) => lines.push(line), names: pres().names });
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
  if (ui.selected !== id) { ui.mode = null; ui.query = ""; }
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
      "Something that computes a value: a function call, an if, a match, a fold. Inputs are the hollow circles on its left, its output is the filled circle on its right."],
    ["Wire", pic(80, wire(10, 70), svg("circle", { cx: 10, cy: 20, r: 4, class: "outp" }), svg("circle", { cx: 70, cy: 20, r: 5, class: "inp" })),
      "Carries a value from an output to an input. Drag from an output or a dot onto an input to make one; drag an input's wire into empty space to remove it."],
    ["Dot", pic(80, svg("path", { d: "M22,24 C46,24 46,10 72,10", class: "tw use" }), svg("path", { d: "M22,24 C46,24 46,36 72,36", class: "tw use" }), svg("circle", { cx: 16, cy: 24, r: 6, class: "reroute" }), text(16, 12, "a", "dotl")),
      "Where a value starts and branches out to every place that uses it. A function's parameters are dots on its frame's left edge; a dot on a wire is a let. Click any wire to put a dot on it; select a dot to name it, or leave it unnamed (•1). Right-click it to show it as a let node with a small get node at every use instead of wires."],
    ["Frame", pic(80, svg("rect", { x: 4, y: 3, width: 72, height: 34, rx: 9, class: "rg lam" }), text(12, 15, "(x) =>", "rt", "start"), svg("circle", { cx: 4, cy: 26, r: 6, class: "reroute" })),
      "A function that hasn't been called yet: its parameters are the dots on its left, what it gives back leaves on its right. Each case of an if, match or fold is a frame wired into that node."],
    ["Hole", pic(80, svg("rect", { x: 10, y: 8, width: 56, height: 24, rx: 12, class: "pill hole" }), text(38, 24, "□", "pl")),
      "A value not filled in yet. It knows its type; select it and the side panel lists only what fits. The program runs until it reaches one."],
    ["Badge", pic(80, svg("rect", { x: 12, y: 2, width: 56, height: 36, rx: 7, class: "cn eff" }), text(40, 13, "Choice", "badge"), text(40, 31, "fail", "cl")),
      "The effects a node has. Choice: several answers, or none. Abort: stops with a reason. Log: debugging output. Console: reads and prints. Files: reads and writes files. Diverge: might not finish. And effects you declare (+ New definition, Effect). “handles …” marks a node that takes care of one, so it stops there: first or all for Choice, a handle match for Abort, Log and yours."],
    ["Solve", pic(80, ...box(12, "polar", "cn rel"), svg("circle", { cx: 12, cy: 20, r: 5, class: "inp" }), svg("circle", { cx: 68, cy: 20, r: 6, class: "reroute" })),
      "Any function run backwards: you give it some of its ports (inputs, left) and it works out the rest (dots, right). A function that says true or false, built from equal and and, is a set of equations, so it runs in every direction. Run does the same for the definition you're looking at."],
  ];
  return h("section", { class: "guide", "aria-label": "Guide" },
    h("div", { class: "guide-items" }, ...items.map(([t, p, d]) => h("div", { class: "guide-item" }, p, h("div", {}, h("strong", {}, t), h("p", {}, d))))),
    h("p", { class: "hint" }, "Right-click in the graph for a menu: fill a hole, add a value, tidy, show a binding as let and get nodes. Drag a node to move it (that only changes layout.json); shift-click or shift-drag to pick several. Where wires cross, one hops over the other; where one passes under a node, it shows faintly over it. Double-click a node to open the function it calls. Every change goes through the same checks, so if something would break the program, it's refused and the status line says why."));
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

// Programs and their definitions are one outline, the same rows at two
// depths: the open program lists its definitions under it. It scrolls on
// its own and filters as you type, so it stays one column however many
// programs and definitions there are.
const programList = (): [Program, string][] => [...EXAMPLES, ...Object.values({ ...docs, [doc.program]: doc }).filter((d) => d.program.startsWith(MINE)).map((d): [string, string] => [d.program, titleOf(d)])];

function navigator(p: Presentation) {
  const row = (attrs: Record<string, string>, on: boolean, ...kids: Kid[]) =>
    h("button", { type: "button", class: `nav-row${on ? " on" : ""}`, "aria-current": on ? "true" : "false", ...attrs }, ...kids);
  const defs = ownDefs().filter((d) => defBody(d));
  const list = h("div", { class: "nav-list" });
  for (const [k, label] of programList()) {
    list.append(row({ "data-set": "program", "data-value": k }, false, label));
    if (k !== doc.program) continue;
    list.lastElementChild!.classList.add("open");
    list.append(h("div", { class: "nav-defs", role: "group", "aria-label": `Definitions in ${label}` },
      ...defs.map((d) => row({ "data-def": d }, d === ui.def, defBody(d)?.kind === "typedef" ? h("span", { class: "netmark", title: "data type" }, "▤ ") : null, p.names[d] ?? d)),
      row({ "data-act": "new-def", title: "A new function, value or data type" }, ui.mode === "new-def", "+ New definition")));
  }
  list.append(row({ "data-act": "new-program" }, false, "+ New program"));
  const find = h("input", { id: "nav-find", class: "nav-find", type: "search", placeholder: "Find a program or definition", "aria-label": "Find a program or definition", value: ui.find, autocomplete: "off" }) as HTMLInputElement;
  // Filtering hides rows; it doesn't redraw the program.
  const filter = () => {
    const q = find.value.trim().toLowerCase();
    ui.find = find.value;
    for (const r of list.querySelectorAll<HTMLElement>(".nav-row")) r.hidden = !!q && !r.classList.contains("open") && !r.textContent!.toLowerCase().includes(q) && !r.dataset.act;
  };
  find.addEventListener("input", filter);
  find.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { find.value = ""; filter(); }
    const first = (sel: string) => list.querySelector<HTMLElement>(`${sel}:not([hidden]):not([data-act])`);
    const r = e.key === "Enter" ? first(".nav-defs .nav-row") ?? first(".nav-row:not(.open)") : null;
    // A program found is opened with all its definitions showing.
    if (r && !r.dataset.def) ui.find = "";
    r?.click();
  });
  filter();
  return h("nav", { class: "panel p-nav", "aria-label": "Programs and definitions" }, h("h2", {}, "Programs"), find, list);
}

// The dock's sizes: the outline's and the side's widths and the text pane's
// height. Dragging a gutter sets them; this browser remembers them.
const DOCK = "projectional-dock";
const dock: Record<string, number> = (() => { try { return JSON.parse(localStorage.getItem(DOCK) ?? "{}"); } catch { return {}; } })();
const dockStyle = () => Object.entries(dock).map(([k, v]) => `--${k}: ${v}px`).join("; ");
// The shown definition's tab: a newly opened one goes right after it.
let openAt = -1;

document.addEventListener("pointerdown", (e) => {
  const g = (e.target as HTMLElement).closest<HTMLElement>("[data-gutter]");
  if (!g || e.button !== 0) return;
  e.preventDefault();
  const k = g.dataset.gutter!, grid = g.closest<HTMLElement>(".grid")!;
  const pane = k === "text-h" ? grid.querySelector<HTMLElement>(".p-text")! : grid.querySelector<HTMLElement>(k === "nav-w" ? ".p-nav" : ".side")!;
  const r = pane.getBoundingClientRect();
  const start = k === "text-h" ? r.height : r.width;
  const limit = k === "text-h" ? [80, grid.clientHeight - 200] : k === "nav-w" ? [140, 420] : [240, 640];
  g.classList.add("dragging");
  const mv = (ev: PointerEvent) => {
    const d = k === "text-h" ? e.clientY - ev.clientY : k === "nav-w" ? ev.clientX - e.clientX : e.clientX - ev.clientX;
    dock[k] = Math.round(Math.min(limit[1], Math.max(limit[0], start + d)));
    grid.style.setProperty(`--${k}`, `${dock[k]}px`);
  };
  const up = () => {
    g.classList.remove("dragging");
    window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
    try { localStorage.setItem(DOCK, JSON.stringify(dock)); } catch {}
  };
  window.addEventListener("pointermove", mv);
  window.addEventListener("pointerup", up);
});

// A view that throws leaves the page as it was, so every click after it
// fails too. Say what broke and keep the way out: the program picker, Undo,
// and Reset to the example as shipped.
function render() {
  try { draw(); } catch (e) {
    console.error(e);
    document.getElementById("app")!.replaceChildren(
      h("header", { class: "bar" }, h("div", { class: "controls" },
        seg("program", doc.program, [...EXAMPLES, ...Object.values({ ...docs, [doc.program]: doc }).filter((d) => d.program.startsWith(MINE)).map((d): [string, string] => [d.program, titleOf(d)])]),
        h("div", { class: "seg" },
          h("button", { type: "button", "data-act": "undo", disabled: !undo.length && !deleted }, "Undo"),
          h("button", { type: "button", "data-act": "reset", disabled: !isExample(doc.program) }, "Reset")))),
      h("p", { class: "status refused", role: "status" }, `The editor failed to draw this program (${e instanceof Error ? e.message : String(e)}). It's a bug in the editor, not your program: Undo, Reset to the example, or open another program.`));
  }
}

function draw() {
  const app = document.getElementById("app")!;
  const p = pres();
  const namer = new Namer(doc.code, p, ui.def);
  const scroll = [...document.querySelectorAll(".graph-wrap")].map((g) => [g.scrollLeft, g.scrollTop]);
  const focused = document.activeElement?.id;
  const info = typesOf();
  if (!info) { app.replaceChildren(h("p", { class: "status refused" }, "This program can't be type-checked. Undo, or Reset to the example.")); return; }
  T.setDisplayNames(p.names);

  // Open definitions are tabs; the one shown is always among them.
  ui.tabs = ui.tabs.filter((d) => defBody(d));
  if (!ui.tabs.includes(ui.def)) ui.tabs.splice(Math.min(ui.tabs.length, openAt + 1), 0, ui.def);
  openAt = ui.tabs.indexOf(ui.def);
  const tab = (d: Id) => h("div", { class: `tab${d === ui.def ? " on" : ""}` },
    h("button", { type: "button", class: "t-open", "data-tab": d, "aria-current": d === ui.def ? "true" : "false" }, namer.name(d)),
    ui.tabs.length > 1 ? h("button", { type: "button", class: "t-close", "data-close-tab": d, "aria-label": `Close ${namer.name(d)}` }, "×") : null);
  const textView = ui.text === "blocks"
    ? h("div", { class: "blocks-wrap" }, T.renderTyped(doc.code, typedPres(), info, ui.def, ui.selected))
    : h("pre", { class: "text" }, textPanel(info));
  const panels: [UI["panel"], string, () => Kid[]][] = [
    ["node", ui.mode === "new-def" ? "New" : ui.selected ? "Selected" : "Definition", () => [typedInspector(namer, typedPres(), info), definitionPanel(p)]],
    ["program", "Program", () => [programPanel()]],
    ["checks", "Checks", () => [typedChecks(namer, info)]],
    ["files", "Files", () => [filesPanel()]],
  ];
  const shown = panels.find(([k]) => k === ui.panel) ?? panels[0];

  app.replaceChildren(
    h("header", { class: "bar" },
      h("div", { class: "brand" }, h("strong", {}, "Language Lab"), h("span", {}, "the program is the tree")),
      h("div", { class: "controls" },
        ui.back.length ? h("button", { class: "btn back", type: "button", "data-act": "back" }, `← ${new Namer(doc.code, p, ui.back.at(-1)!).name(ui.back.at(-1)!)}`) : null,
        seg("layer", ui.layer, [["short", "Short names"], ["descriptive", "Descriptive"]]),
        seg("style", ui.style, [["math", "a · b"], ["plain", "a * b"], ["lisp", "(* a b)"]]),
        h("div", { class: "seg" },
          h("button", { type: "button", "data-act": "undo", disabled: !undo.length && !deleted }, "Undo"),
          h("button", { type: "button", "data-act": "redo", disabled: !redo.length }, "Redo"),
          h("button", { type: "button", "data-act": "reset", disabled: !isExample(doc.program), title: isExample(doc.program) ? "Back to the example as shipped" : "Your own program has nothing to go back to; Undo steps back" }, "Reset")),
        h("button", { class: `btn${guideOpen ? " on" : ""}`, type: "button", "data-act": "guide" }, guideOpen ? "Hide the guide" : "Guide"),
        h("a", { class: "btn", href: "tutorial.html" }, "Tutorial"),
        h("a", { class: "btn", href: "reactive.html", title: "Reactivity and values on demand, through the Cells effect" }, "Cells"))),
    ...(guideOpen ? [guide()] : []),
    h("main", { class: "grid is-typed", style: dockStyle() },
      navigator(p),
      graphMenu(info),
      h("div", { class: "gutter", "data-gutter": "nav-w", style: "grid-area: g1", "aria-hidden": "true" }),
      h("div", { class: "center" },
        h("section", { class: "panel p-graph", "aria-label": "Graph" },
          h("div", { class: "tabs" }, ...ui.tabs.map(tab), h("span", { class: "hint", title: GRAPH_HINT }, GRAPH_HINT)),
          h("div", { class: "graph-host" }, graphOf(info))),
        h("div", { class: "gutter row", "data-gutter": "text-h", "aria-hidden": "true" }),
        h("section", { class: "panel p-text", "aria-label": "Text" },
          h("div", { class: "text-head" }, h("h2", {}, "Text"),
            seg("text", ui.text, [["blocks", "Blocks"], ["let", "Steps"], ["nested", "Nested"], ["sexpr", "Lisp"]]),
            ui.text === "blocks" ? h("span", { class: "hint" }, "hover for types; click a □ to fill it; double-click a name to open it") : null),
          h("div", { class: "body" }, textView))),
      h("div", { class: "gutter", "data-gutter": "side-w", style: "grid-area: g2", "aria-hidden": "true" }),
      h("aside", { class: "side" },
        h("section", { class: "panel", "aria-label": shown[1] },
          h("div", { class: "ins-tabs", role: "tablist" }, ...panels.map(([k, label]) =>
            h("button", { type: "button", role: "tab", class: k === shown[0] ? "on" : "", "aria-selected": String(k === shown[0]), "data-panel": k }, label))),
          ...shown[2]()),
        h("section", { class: "panel" }, h("h2", {}, "Run"), typedRunPanel(namer, info)))),
    h("div", { class: `status${ui.touched.length ? " live" : ""}${ui.refused ? " refused" : ""}`, role: "status" }, ui.note),
  );
  document.querySelectorAll(".graph-wrap").forEach((g, i) => { if (scroll[i]) [g.scrollLeft, g.scrollTop] = scroll[i]; });
  if (focused) document.getElementById(focused)?.focus();
}

// A press outside the menu closes it, before anything else sees the press.
document.addEventListener("pointerdown", (e) => {
  if (ui.menu && !(e.target as HTMLElement).closest(".ctx-menu")) { ui.menu = null; document.querySelector(".ctx-menu")?.remove(); }
}, true);

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const mi = t.closest<HTMLElement>("[data-menu]");
  if (mi) return menuAction(mi.dataset.menu!, mi.dataset.target || undefined);
  const set = t.closest<HTMLElement>("[data-set]");
  if (set) {
    if (set.dataset.set === "program") return switchProgram(set.dataset.value!);
    if (set.dataset.set === "new-kind") { ui.newKind = set.dataset.value as UI["newKind"]; return render(); }
    const k = set.dataset.set as "layer" | "style" | "text";
    (ui as unknown as Record<string, string>)[k] = set.dataset.value!;
    if (k !== "text") { ui.touched = []; ui.note = k === "layer" ? "Switched names layer. Same code, different words." : "Switched notation. Same code, different symbols and precedence."; }
    return render();
  }
  const def = t.closest<HTMLElement>("[data-def]");
  if (def) { openDef(def.dataset.def!); ui.back = []; return render(); }
  const tb = t.closest<HTMLElement>("[data-tab]");
  if (tb) { if (tb.dataset.tab !== ui.def) { openDef(tb.dataset.tab!); ui.back = []; render(); } return; }
  const close = t.closest<HTMLElement>("[data-close-tab]");
  if (close) {
    const d = close.dataset.closeTab!, i = ui.tabs.indexOf(d);
    ui.tabs = ui.tabs.filter((x) => x !== d);
    if (d === ui.def) { openDef(ui.tabs[Math.max(0, i - 1)]); ui.back = []; }
    return render();
  }
  const panel = t.closest<HTMLElement>("[data-panel]");
  if (panel) { ui.panel = panel.dataset.panel as UI["panel"]; return render(); }
  const act = t.closest<HTMLElement>("[data-act]");
  if (act) {
    const a = act.dataset.act;
    if (a === "undo") return travel(undo, redo, "Undid");
    if (a === "redo") return travel(redo, undo, "Redid");
    if (a === "reset") { undo.push(doc); doc = initialFor(doc.program); ui.def = startDef(); ui.back = []; ui.selected = null; ui.touched = files().map((f) => f.name); ui.note = "Back to the example programs."; save(); return render(); }
    if (a === "back") { ui.def = ui.back.pop()!; ui.selected = null; ui.mode = null; ui.note = "Back."; return render(); }
    if (a === "goto") return openDef(act.dataset.target!);
    if (a === "inline") return toggleInline(act.dataset.target!);
    if (a === "named") return toggleNamed(act.dataset.target!);
    if (a === "goto-node") return select(act.dataset.target!);
    if (a === "new-def") { ui.mode = ui.mode === "new-def" ? null : "new-def"; render(); document.getElementById("f-def-name")?.focus(); return; }
    if (a === "new-program") return newProgram();
    if (a === "copy") return copySelected();
    if (a === "t-values") return showValues();
    if (a === "t-novalues") return hideValues();
    if (a === "paste") return pasteIntoSelected();
    if (a === "open-file") return openFile();
    if (a === "save-file") return saveFile();
    if (a === "delete-program") return deleteProgram();
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
  if (e.key === "Escape" && ui.menu) { ui.menu = null; return render(); }
  const typing = (e.target as HTMLElement).closest("input, textarea");
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
    e.preventDefault();
    return e.shiftKey ? travel(redo, undo, "Redid") : travel(undo, redo, "Undid");
  }
  if ((e.metaKey || e.ctrlKey) && !typing) {
    const k = e.key.toLowerCase();
    if (k === "c" || k === "x") { if (copyable(ui.selected)) { e.preventDefault(); copySelected(k === "x"); } return; }
    if (k === "v" && clip && ui.selected) { e.preventDefault(); return pasteIntoSelected(); }
  }
  if (!typing && (e.key === "Delete" || e.key === "Backspace") && ui.selected) {
    e.preventDefault();
    removeSelected();
  }
});

render();
