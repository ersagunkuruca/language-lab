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
import shadersCode from "../examples/shaders/code.json" with { type: "json" };
import shadersNames from "../examples/shaders/names.default.json" with { type: "json" };
import shadersComments from "../examples/shaders/comments.json" with { type: "json" };
import raymarchCode from "../examples/raymarch/code.json" with { type: "json" };
import raymarchNames from "../examples/raymarch/names.default.json" with { type: "json" };
import raymarchComments from "../examples/raymarch/comments.json" with { type: "json" };
import mandelbrotCode from "../examples/mandelbrot/code.json" with { type: "json" };
import mandelbrotNames from "../examples/mandelbrot/names.default.json" with { type: "json" };
import mandelbrotComments from "../examples/mandelbrot/comments.json" with { type: "json" };
import diceCode from "../examples/dice/code.json" with { type: "json" };
import diceNames from "../examples/dice/names.default.json" with { type: "json" };
import diceComments from "../examples/dice/comments.json" with { type: "json" };
import pedalCode from "../examples/pedal/code.json" with { type: "json" };
import pedalNames from "../examples/pedal/names.default.json" with { type: "json" };
import pedalComments from "../examples/pedal/comments.json" with { type: "json" };
import converterCode from "../examples/converter/code.json" with { type: "json" };
import converterNames from "../examples/converter/names.default.json" with { type: "json" };
import converterComments from "../examples/converter/comments.json" with { type: "json" };
import conjugateCode from "../examples/conjugate/code.json" with { type: "json" };
import conjugateNames from "../examples/conjugate/names.default.json" with { type: "json" };
import conjugateComments from "../examples/conjugate/comments.json" with { type: "json" };
import countdownCode from "../examples/countdown/code.json" with { type: "json" };
import countdownNames from "../examples/countdown/names.default.json" with { type: "json" };
import countdownDescriptive from "../examples/countdown/names.descriptive.json" with { type: "json" };
import countdownComments from "../examples/countdown/comments.json" with { type: "json" };
import countdownLayout from "../examples/countdown/layout.json" with { type: "json" };
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import mathStyle from "../styles/math.json" with { type: "json" };
import plainStyle from "../styles/plain.json" with { type: "json" };
import lispStyle from "../styles/lisp.json" with { type: "json" };
import { hashDef } from "../src/hash.ts";
import { children, freshId, get, ID_PATTERN, isPublished, merge, resolveRefs, subtree, type Code, type Id, type Node, type NodeOf } from "../src/model.ts";
import { INT } from "../src/lang/types.ts";
import { formatUnit, infer as unitInfer, NAMED, type Unit } from "../src/units.ts";
import { layer, type Comments, type Hints, type Names, type Presentation, type Style } from "../src/presentation.ts";
import { relationFor } from "../src/lang/equations.ts";
import { powers } from "../src/lang/relate.ts";
import { analyze } from "../../invertible/src/index.js";
import { renderLet } from "../src/render/letseq.ts";
import { renderNested } from "../src/render/nested.ts";
import { renderSexpr } from "../src/render/sexpr.ts";
import { Namer } from "../src/render/namer.ts";
import { BOOL, CONS, FALSE, MAP_V, NIL, SET_V, TRUE } from "../src/lang/std.ts";
import { CHOICE, DIVERGE, NUMBER, STRING, showIn, type Type } from "../src/lang/types.ts";
import { implementationKey } from "../src/lang/infer.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { fromList, needsHandling, OutOfSteps, showValue, withSteps, type Value } from "../src/lang/run.ts";
import type { RunAsk, RunSays } from "./runWorker.ts";
import { searchBackwards, type BackAsk, type Found } from "./backSearch.ts";
import { trace, type Trace } from "../src/lang/trace.ts";
import { parseValue } from "../src/lang/values.ts";
import * as T from "./typed.ts";
import { typedGraph, type GraphView, type MenuTarget } from "./typedGraph.ts";
import { builtinName, builtinOf, definitionOf } from "./define.ts";
import { type Pos } from "./canvas.ts";
import { fromFile, toFile } from "./files.ts";
import { flattened, matchRows, sameEverywhere } from "../src/lang/patterns.ts";
import { showPin, type Pins } from "../src/lang/signatures.ts";
import { inlinable, inlineView, type InlineView } from "./inline.ts";
import * as Top from "../src/lang/toplevel.ts";
import { drawPicture, pictureEntries, type Picture } from "./picture.ts";
import { PAGE_BASE, pageFile, pageMain, showPage, type Preview } from "../src/lang/page.ts";
import { browserWorld } from "../src/lang/browser.ts";
import type { Doc as PageDoc, Node_ } from "../src/lang/html.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { join, looseOf, newLoose, split, type Drafts } from "./drafts.ts";
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
  // Frames drawn folded into one box (a lambda, a let, a match arm...). A view.
  folded?: Id[];
  // Per definition: which ports (parameters, and "out" for the result) you
  // give it when running it backwards. Choosing different ones is how you
  // invert it, and it never touches code.json.
  known: Record<Id, Id[]>;
  // Calls shown with the callee's body in place (editor/inline.ts). A view.
  inline?: Id[];
  // Picked nodes grouped into a frame of their own, by the group's id, to
  // fold into one box (typedGraph.ts, BACKLOG E111). A view.
  groups?: Record<Id, Id[]>;
  // Matches drawn as the nested tree they are, not as rows of patterns
  // (PATTERNS.md). A view.
  tree?: Id[];
}

// The examples, and programs of your own: made new, or opened from a file.
type Program = string;
const EXAMPLES: [Program, string][] = [["numbers", "Numbers & physics"], ["sort", "Insertion sort"], ["queens", "Eight queens"], ["countdown", "Countdown numbers"], ["calculus", "Calculus"], ["backwards", "Run backwards"], ["conjugate", "Conjugation"], ["relations", "Relations in programs"], ["effects", "Effects"], ["shaders", "Shader: ripples"], ["raymarch", "Shader: ray marching"], ["mandelbrot", "Shader: Mandelbrot set"], ["dice", "Page: two dice"], ["converter", "Page: unit converter"], ["pedal", "Page: guitar pedal"]];
const isExample = (p: Program) => EXAMPLES.some(([k]) => k === p);
const MINE = "mine.";
// The program's own comment, in comments.json like any other: what it is,
// and whose code or ideas it uses (CREDITS.md has every one).
const PROGRAM = "program";

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
  // Loose parts (drafts.ts): definitions of their own in `code`, here with
  // the definition each belongs to, and the variables their inputs stand for.
  loose?: Record<Id, Id>;
  home?: Record<Id, Id>;
}

interface UI {
  def: Id;
  // On a phone, the one pane shown (the others are a tap away).
  pane: "nav" | "graph" | "text" | "side";
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
  newKind: "function" | "value" | "type" | "effect" | "interface";
  query: string;
  refused: boolean;
  output: { def: Id; lines: string[]; error?: string; running?: boolean } | null;
  // The graph's right-click menu: what it was for, where (screen, world).
  // `blocks`: opened from the Blocks pane, so the graph's layout items
  // (tidy, pick, fit) aren't offered.
  menu: { target: MenuTarget; x: number; y: number; world: Pos; blocks?: boolean } | null;
  // Definitions open as tabs over the graph, and which inspector tab shows.
  tabs: Id[];
  panel: "node" | "program" | "checks" | "files" | "guide";
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
  : program === "shaders" ? typedDoc("shaders", shadersCode as Code, shadersNames, shadersComments)
  : program === "raymarch" ? typedDoc("raymarch", raymarchCode as Code, raymarchNames, raymarchComments)
  : program === "mandelbrot" ? typedDoc("mandelbrot", mandelbrotCode as Code, mandelbrotNames, mandelbrotComments)
  : program === "dice" ? typedDoc("dice", diceCode as Code, diceNames, diceComments)
  : program === "pedal" ? typedDoc("pedal", pedalCode as Code, pedalNames, pedalComments)
  : program === "countdown" ? { ...typedDoc("countdown", countdownCode as Code, countdownNames, countdownComments, { layout: countdownLayout }), names: { short: countdownNames, descriptive: countdownDescriptive } }
  : program === "converter" ? typedDoc("converter", converterCode as Code, converterNames, converterComments)
  : program === "conjugate" ? typedDoc("conjugate", conjugateCode as Code, conjugateNames, conjugateComments)
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
  // Credits kept apart, as the editor once did, are the program's comment now.
  const { credits, ...rest } = d as Doc & { credits?: string[] };
  if (credits?.length) d = { ...rest, comments: { ...d.comments, [PROGRAM]: [d.comments[PROGRAM], ...credits].filter(Boolean).join("\n") } };
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
const ownDefs = (d: Doc = doc) => d.code.defs.filter((x) => !BASE.nodes[x] && !d.loose?.[x]);
// The program without its loose parts: what runs, compiles and is saved as
// code.json (drafts.ts). One per version of the code.
const progs = new WeakMap<Code, Code>();
const prog = (d: Doc = doc): Code => {
  if (!d.loose || !Object.keys(d.loose).length) return d.code;
  let c = progs.get(d.code);
  if (!c) progs.set(d.code, (c = split(d.code, d.loose).code));
  return c;
};
const draftsOf = (d: Doc): Drafts => split(d.code, d.loose ?? {}, d.home ?? {}).drafts;
// What's in the program proper: holes and errors in loose parts don't stop
// it running, since they never run.
const looseIds = new WeakMap<Code, Set<Id>>();
const inLoose = (id: Id): boolean => {
  if (!doc.loose || !Object.keys(doc.loose).length) return false;
  let ids = looseIds.get(doc.code);
  if (!ids) looseIds.set(doc.code, (ids = new Set(Object.keys(doc.loose).filter((d) => doc.code.nodes[d]).flatMap((d) => subtree(doc.code, d)))));
  return ids.has(id);
};
// Loose parts are called _1, _2, … in the order their definition got them.
const looseNames = (d: Doc = doc): Names => Object.fromEntries([...new Set(Object.values(d.loose ?? {}))].flatMap((o) => looseOf(d.code, d.loose ?? {}, o).map((x, i) => [x, `_${i + 1}`])));
const holesIn = (info: T.Info) => [...info.holes.keys()].filter((h) => !inLoose(h)).length;
const errorsIn = (info: T.Info) => info.errors.filter((e) => !inLoose(e.id)).length;
const defNamed = (name: string) => ownDefs().find((d) => (doc.names.short[d] ?? "") === name);
// A program opens on `main`, with the definition that shows it off in the
// next tab: a picture's colour, or else its first function, not a type.
const showcase = () => {
  const own = ownDefs(), picture = pictureEntries(own, doc.names.short), nodes = doc.code.nodes;
  const typedef = (d: Id) => { const n = nodes[d]; return n?.kind === "def" && !!n.body && nodes[n.body]?.kind === "typedef"; };
  return defNamed(START[doc.program] ?? "main") ?? (picture && Object.values(picture)[0])
    ?? own.find((d) => !typedef(d)) ?? own[0] ?? doc.code.defs[0];
};
const startDef = () => defNamed("main") ?? showcase();
const startTabs = () => [...new Set([startDef(), showcase()])];
const noteOf = (d: Doc) => d.comments[PROGRAM] ?? "";
const titleOf = (d: Doc) => d.title ?? EXAMPLES.find(([k]) => k === d.program)?.[1] ?? "Program";

// A touch screen is told about taps, long presses and pinches, not hover,
// right-click and shift.
const TOUCH = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
// One pane at a time (page.html's media query): the side pane is out of
// sight unless it's the one picked.
const onePane = () => typeof matchMedia === "function" && matchMedia("(max-width: 900px), (max-height: 500px)").matches;
const OPENING = TOUCH
  ? "A typed program. Tap anything to select it and see its type; tap a hole for a palette of only what fits there; long-press anything for a menu."
  : "A typed program. Hover anything for its type; click a hole for a palette of only what fits there.";

const ui: UI = {
  def: startDef(),
  pane: "graph",
  back: [],
  selected: null,
  layer: "descriptive",
  find: "",
  style: "math",
  text: "blocks",
  touched: [],
  note: `${OPENING} Run lets you run any function backwards.`,
  mode: null,
  query: "",
  refused: false,
  output: null,
  menu: null,
  newKind: "function",
  tabs: startTabs(),
  panel: "node",
};


const undo: Doc[] = [];
const redo: Doc[] = [];
// The program just deleted, until the next edit or switch: Undo brings it
// back, so a delete needs no "are you sure".
let deleted: Doc | null = null;
// Change the function (or Replace with) makes the function (or the part) a
// hole, then the palette fills it: one change, so one Undo. The fill that comes right after takes the
// place of the hole's step in the undo list.
let swapped: { hole: Id; at: number } | null = null;
// Wrap in… makes the part a hole the same way; the fill that comes next
// takes it back as one of its inputs (typed.ts wrapInto).
let wrapping: { hole: Id; kept: Code; info: T.Info } | null = null;

function commit(next: Partial<Doc>, touched: string[], note: string) {
  ui.menu = null;
  deleted = null;
  const filled = swapped && undo.length === swapped.at && next.code && next.code.nodes[swapped.hole] && next.code.nodes[swapped.hole].kind !== "hole";
  swapped = null;
  if (!filled) undo.push(doc);
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
  ui.tabs = startTabs();
  ui.selected = firstHole();
  ui.mode = null;
  running?.terminate();
  running = null;
  ui.output = null;
  ui.touched = [];
  ui.refused = false;
  ui.note = OPENING;
  save();
  render();
  // A program's open definition may be below the navigator's fold (pedal's
  // main): bring it into view.
  document.querySelector(".p-nav .nav-row[data-def].on")?.scrollIntoView({ block: "nearest" });
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
  // Its hole selected, with the palette showing, whichever tab was open.
  ui.selected = T.nextHole(doc.code, ui.def, ui.def) ?? null;
  ui.panel = "node";
  if (onePane()) ui.pane = "side";
  render();
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "program";

function saveFile() {
  const text = toFile({ title: titleOf(doc), typed: true, code: prog(), drafts: draftsOf(doc), names: doc.names.short, descriptive: doc.names.descriptive, comments: doc.comments, layout: doc.layout, examples: doc.examples ?? {}, signatures: doc.signatures ?? {} }, baseFor(doc.typed));
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
    addProgram({ title: x.title, typed: x.typed, code: x.drafts ? join(r.code, x.drafts) : r.code, names: { short: x.names, descriptive: x.descriptive }, comments: x.comments, hints: {}, layout: x.layout, examples: x.examples, signatures: x.signatures, loose: x.drafts?.of, home: x.drafts?.home },
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
// `then` sets what the editor shows after the edit (which definition is
// open, what's selected) before it's drawn.
// `place`: where new nodes go in the graph (layout.json), by id.
function applyT(e: T.LooseEdit, then?: () => void, place?: Record<Id, Pos>, pins?: Pins): boolean {
  const w = wrapping;
  wrapping = null;
  if (w && e.ok && e.code.nodes[w.hole] && e.code.nodes[w.hole].kind !== "hole") e = T.wrapInto(e.code, e.names, w.info, w.hole, w.kept);
  if (!e.ok) {
    ui.menu = null;
    ui.note = `Refused: ${heldReason(e.reason)}. Nothing changed.`;
    ui.touched = [];
    ui.refused = true;
    render();
    return false;
  }
  if (e.select) ui.selected = e.select;
  // A row the text draws once as the otherwise is a copy in each place it
  // stands for; an edit to it is made in all of them (patterns.ts).
  const same = sameEverywhere(doc.code, e.code, typesOf());
  if (same.places) {
    const names = { ...e.names };
    for (const [x, y] of same.copied) if (names[x]) names[y] = names[x];
    e = { ...e, code: same.code, names, note: `${e.note} Made in all ${same.places} places it stands for.` };
  }
  const note = holdType(e.code);
  then?.();
  // A node an edit removed takes its names with it, in every layer.
  const kept = (ns: Names) => Object.fromEntries(Object.entries(ns).filter(([id]) => e.code.nodes[id]));
  // An edit that sets parts loose, or wires one in, says so (drafts.ts).
  const loose = e.of ? { loose: e.of, home: e.home } : {};
  const placed = place ? { layout: { ...doc.layout, at: { ...(doc.layout.at ?? {}), ...Object.fromEntries(Object.entries(place).map(([k, v]) => [lkey(k), v])) } } } : {};
  const pinned = pins ? { signatures: { ...doc.signatures, ...pins } } : {};
  commit({ code: e.code, names: { short: kept(e.names), descriptive: kept(doc.names.descriptive) }, ...loose, ...placed, ...pinned }, ["code.json", "names.short.json", ...(e.of ? ["drafts.json"] : []), ...(place ? ["layout.json"] : []), ...(pins ? ["signatures.json"] : [])], e.note + note);
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
  if (!doc.code.nodes[ui.def] || doc.loose?.[ui.def]) ui.def = doc.loose?.[ui.def] ?? doc.code.defs[0];
  ui.touched = changed;
  ui.note = `${label}: ${changed.join(", ") || "nothing"} changed back.`;
  ui.mode = null;
  save();
  render();
}

// ---------------------------------------------------------------- helpers

const node = (id: Id) => doc.code.nodes[id];

// A definition's type doesn't loosen while a hole is open in it. Clearing
// the √ in period would leave its inputs unused, so its type would become
// (a, b) -> Float64. Until its holes are filled, the type it had stays, as a
// pin the editor holds for the session (not signatures.json); "Let it
// loosen" in its Type section drops it.
let held: Pins = {};
const hasHole = (code: Code, d: Id) => !!code.nodes[d] && subtree(code, d).some((x) => code.nodes[x].kind === "hole");
function holdType(next: Code): string {
  const d = ui.def, info = typesOf();
  if (!info || doc.signatures?.[d] || held[d] || hasHole(doc.code, d) || !hasHole(next, d)) return "";
  // An edit to its inputs changes its type on purpose.
  const inputs = (c: Code) => { const n = c.nodes[d], b = n?.kind === "def" && n.body ? c.nodes[n.body] : null; return b?.kind === "lambda" ? b.params.join() : ""; };
  if (inputs(doc.code) !== inputs(next)) return "";
  const p = T.pin(doc.code, info, {}, d, "");
  if (!p.ok || !p.pins[d]) return "";
  T.setProgramPins(doc.signatures ?? NO_PINS);
  let loose: string | null = null;
  try { loose = T.typeOf(T.infer(next, pres().names), d, pres().names); } catch { return ""; }
  const was = T.typeOf(info, d, pres().names);
  if (loose === was) return "";
  held = { ...held, [d]: p.pins[d] };
  return ` ${pres().names[d] ?? "It"} keeps its type, ${was}, while the hole is open.`;
}

// A held type isn't a pin anyone made, so a fill it refuses says so, says
// what the fill would add (an effect, mostly: die() inside a function that
// doesn't do Random), and the ways out.
function heldReason(reason: string): string {
  const d = ui.def, name = pres().names[d] ?? "it";
  const m = reason.match(/^(.*) is pinned to (.*), and this makes it (.*)$/);
  if (!m || m[1] !== name || !held[d] || doc.signatures?.[d]) return reason;
  const effects = (t: string) => new Set([...t.matchAll(/-\[([^\]]*)\]->/g)].flatMap((x) => x[1].split(", ")).filter((e) => /^[A-Z]/.test(e)));
  const had = effects(m[2]), added = [...effects(m[3])].filter((e) => !had.has(e));
  const why = added.length ? `: it would do ${added.join(" and ")} where ${name} doesn't` : "";
  return `${name} keeps its type, ${m[2]}, while it has a hole, and this would make it ${m[3]}${why}. To allow it, Let it loosen (beside the palette) so its type follows its body, or make the change where ${name} is used`;
}

function loosenButton(dname: string): HTMLElement {
  const b = h("button", { class: "btn", type: "button" }, "Let it loosen");
  b.addEventListener("click", () => { const { [ui.def]: _, ...rest } = held; held = rest; ui.note = `${dname}'s type follows its body again.`; ui.refused = false; render(); });
  return b;
}

// Type inference for typed programs, once per version of the code.
// Pins take part, so a pin or unpin with the same code checks again.
const NO_PINS: Pins = {};
const typedInfo = new WeakMap<Code, { pins: Pins; info: T.Info }>();
let heldPins: { sigs: Pins; held: Pins; all: Pins } | null = null;
function typesOf(): T.Info | null {
  // A held type lasts until its definition has no holes (filled, or undone).
  const done = Object.keys(held).filter((d) => !hasHole(doc.code, d));
  if (done.length) { held = { ...held }; for (const d of done) delete held[d]; }
  const sigs = doc.signatures ?? NO_PINS;
  if (!Object.keys(held).length) heldPins = null;
  else if (heldPins?.sigs !== sigs || heldPins.held !== held) heldPins = { sigs, held, all: { ...held, ...sigs } };
  const pins = heldPins?.all ?? sigs;
  T.setProgramPins(pins);
  const hit = typedInfo.get(doc.code);
  if (hit?.pins === pins) return hit.info;
  try { const info = T.infer(doc.code, pres().names); typedInfo.set(doc.code, { pins, info }); return info; } catch { return null; }
}
const defBody = (d: Id) => { const n = node(d); return n?.kind === "def" && n.body ? node(n.body) : null; };

const pres = (names: Names = {}, comments: Comments = doc.comments): Presentation => ({
  names: layer<Names>(LIBRARY.names, looseNames(), doc.names.short, ui.layer === "descriptive" ? doc.names.descriptive : {}, names),
  comments,
  hints: doc.hints,
  style: { ...styles[ui.style], quote: undefined },
});

const userCode = (c: Code): Code => ({ nodes: Object.fromEntries(Object.entries(c.nodes).filter(([, n]) => n.kind !== "builtin")), defs: c.defs });

const files = () => [
  { name: "code.json", get: (d: Doc) => JSON.stringify(userCode(prog(d))) },
  { name: "drafts.json", get: (d: Doc) => JSON.stringify(draftsOf(d)) },
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

// A descriptive name is a second name. A node that has only its short
// one is renamed there, so the name you give is the one the program has
// (lab and the compiler read the short names) and not a second one.
const nameLayer = (id: Id): Layer => (ui.layer === "descriptive" && doc.names.descriptive[id] === undefined ? "short" : ui.layer);

function rename(id: Id, value: string) {
  const clash = Top.nameClash(doc.code, pres().names, id, value);
  if (clash) {
    ui.note = `Refused: ${clash}. Nothing changed.`;
    ui.touched = [];
    ui.refused = true;
    return render();
  }
  const layer = nameLayer(id);
  const names = { ...doc.names[layer] };
  if (value.trim()) names[id] = value; else delete names[id];
  const k = node(id).kind;
  const what = k === "call" ? (value.trim() ? "Named this step" : "Inlined this step") : "Renamed";
  commit({ names: { ...doc.names, [layer]: names } }, [`names.${layer}.json`], `${what}. Only names.${layer}.json changed; the meaning hash is the same.`);
}

function setComment(id: Id, value: string) {
  const comments = { ...doc.comments };
  if (value.trim()) comments[id] = value; else delete comments[id];
  commit({ comments }, ["comments.json"], id === PROGRAM ? "The program's comment is saved." : "Comment saved on the node itself, not on a line.");
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
  if (!info || !id || !node(id) || (doc.code.defs.includes(id) && !doc.loose?.[id])) return;
  const n = node(id);
  if (["lit", "ref", "call", "lambda", "match", "fold", "solve"].includes(n.kind) || doc.loose?.[id]) void applyT(T.deleteOne(doc.code, doc.names.short, info, ui.def, doc.loose ?? {}, doc.home ?? {}, id));
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
  return doc.examples?.[ui.def]?.[i] ?? seeded(info, ui.def)?.[i] ?? (p === "out" && returnsBool(info, ui.def) ? "true" : "");
}

// In a program that draws a picture, a function of x, y and time is the
// picture at one pixel, so it starts at one: a point right of and above
// the middle, one second in. The picture above is the same function at
// every pixel, which is what its Run panel says.
const PIXEL: Record<string, string> = { x: "0.5", y: "0.25", time: "1", t: "1" };
function pixelSeed(def: Id): string[] | null {
  if (!pictureEntries(ownDefs(), pres().names)) return null;
  const body = defBody(def);
  if (body?.kind !== "lambda") return null;
  const names = body.params.map((p) => pres().names[p] ?? "");
  if (!names.includes("x") || !names.includes("y")) return null;
  return names.map((n) => PIXEL[n] ?? "");
}

// Until you give values of your own, a function starts with the values
// some call in the program already passes it, so it opens with values on
// its wires instead of empty boxes: numbers, texts, true and false, and
// lists of them, written the way values print; or else the values it's
// first called with when main runs (`words(cuts("abc"))`).
function seeded(info: T.Info, def: Id): string[] | null {
  const nodes = doc.code.nodes;
  const pixel = pixelSeed(def);
  if (pixel) return pixel;
  const text = (id: Id): string | null => {
    const n = nodes[id];
    if (n?.kind === "lit") return typeof n.value === "number" || /^-?\d+$/.test(n.value) ? String(n.value) : JSON.stringify(n.value);
    if (n?.kind === "ref") return n.target === TRUE ? "true" : n.target === FALSE ? "false" : n.target === NIL ? "[]" : null;
    const items: string[] = [];
    for (let m: Node | undefined = n; m?.kind === "call"; ) {
      const f = nodes[m.fn];
      if (f?.kind !== "ref" || f.target !== CONS || m.args.length !== 2) return null;
      const t = text(m.args[0]);
      if (t === null) return null;
      items.push(t);
      const rest: Node | undefined = nodes[m.args[1]];
      if (rest?.kind === "ref" && rest.target === NIL) return `[${items.join(", ")}]`;
      m = rest;
    }
    return null;
  };
  for (const n of Object.values(nodes)) {
    if (n.kind !== "call") continue;
    const f = nodes[n.fn];
    if (f?.kind !== "ref" || f.target !== def) continue;
    const args = n.args.map(text);
    if (args.length && args.every((v) => v !== null)) return args as string[];
  }
  const main = defNamed("main"), body = defBody(def);
  const got = main && body?.kind === "lambda" ? mainCalls(info, main).get(body.id) : undefined;
  // Only values that read back as themselves: a function passed in, say,
  // has no way to be typed into a box.
  const texts = got?.map((v) => showValue(v, doc.code, pres().names));
  return texts?.length && body?.kind === "lambda" && texts.length === body.params.length && texts.every((t, i) => !("error" in readPort(info, body.params[i], t))) ? texts : null;
}

// What each function was first called with when main last ran, as far as
// it got in a few steps and MAIN_MS: printing is swallowed, and the world
// (files, the network, a page's cells) isn't reached, so it stops there.
const mainRuns = new WeakMap<Code, Map<Id, Value[]>>();
const MAIN_STEPS = 100_000, MAIN_MS = 50;
function mainCalls(info: T.Info, main: Id): Map<Id, Value[]> {
  let calls = mainRuns.get(doc.code);
  if (!calls) {
    const got = new Map<Id, Value[]>();
    const body = defBody(main);
    if (body?.kind !== "lambda" || !body.params.length) {
      const end = performance.now() + MAIN_MS;
      withSteps(MAIN_STEPS, () => trace(doc.code, info, main, [], undefined, (l, args) => {
        if (!got.has(l)) got.set(l, args);
        if (performance.now() > end) throw new OutOfSteps();
      }));
    }
    mainRuns.set(doc.code, (calls = got));
  }
  return calls;
}

// A port's text read as a value, the way values print. Where a Text goes,
// what's typed is that text, quotes or not: Ersagun, or "Ersagun".
function readPort(info: T.Info, p: Id, text: string): ReturnType<typeof parseValue> {
  const def = info.typeOf.get(ui.def);
  const t = p === "out" ? (def && info.subst.resolve(def).t === "fn" ? (info.subst.resolve(def) as { ret: Type }).ret : undefined) : info.typeOf.get(p);
  const z = t ? info.subst.resolve(t) : null;
  if (z?.t === "con" && z.id === STRING && !/^\s*"/.test(text)) return { value: text };
  return parseValue(text, doc.code, pres().names);
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

interface Backwards extends Found { stopped?: boolean; plan?: { status: string; needMore: number; steps: Step[] } }

const backwardsCache = new Map<string, Backwards>();
function runBackwards(info: T.Info, known: Id[]): Backwards {
  const key = JSON.stringify([fnv(JSON.stringify(userCode(doc.code))), ui.def, known, known.map((k) => portText(info, k))]);
  const hit = backwardsCache.get(key);
  if (hit && !(hit.cut && searchingKey !== key)) return hit;
  const out: Backwards = { answers: [], more: false };
  // A port's value is written the way values print: 3, "text", [1, 2], true.
  const read = known.map((k) => [k, readPort(info, k, portText(info, k))] as const);
  const bad = read.find(([, r]) => "error" in r);
  if (bad) {
    const who = bad[0] === "out" ? "The result" : new Namer(doc.code, pres(), ui.def).name(bad[0]);
    // "fast" for a number reads as a case name nobody declared; say what fits.
    const t = bad[0] !== "out" ? info.typeOf.get(bad[0]) : undefined;
    const z = t ? info.subst.zonk(t) : null;
    const number = z?.t === "con" && z.id === NUMBER;
    return { answers: [], more: false, error: number ? `${who} needs a Float64, like 3 or 2.5.` : `${who}: ${(bad[1] as { error: string }).error}.` };
  }
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
  // A short look on the page, so the first answer shows at once; what
  // that cuts short, the worker searches to the end (BACKLOG E127).
  const until = Date.now() + 300;
  Object.assign(out, searchBackwards(doc.code, ui.def, values, pres().names, () => Date.now() > until));
  if (out.cut) searchOn(key, values, out.plan);
  backwardsCache.set(key, out);
  return out;
}

// The whole search, in a worker: one at a time, and its answers replace
// the short look's when it ends, or after a minute.
let searching: Worker | null = null, searchingKey = "";
function searchOn(key: string, values: Record<string, unknown>, plan: Backwards["plan"]) {
  searching?.terminate();
  searchingKey = key;
  const w = (searching = new Worker(URL.createObjectURL(new Blob([RUN_WORKER], { type: "text/javascript" }))));
  const done = (r: Found) => { w.terminate(); if (searching !== w) return; searching = null; searchingKey = ""; backwardsCache.set(key, { ...r, cut: false, stopped: r.cut, plan }); render(); };
  w.onmessage = (e: MessageEvent<Found>) => done(e.data);
  w.onerror = (e) => { e.preventDefault(); done({ answers: backwardsCache.get(key)?.answers ?? [], more: false, error: e.message || "the search failed" }); };
  const ask: BackAsk = { backwards: true, code: doc.code, names: pres().names, def: ui.def, values };
  w.postMessage(ask);
}

// Stop keeps the answers found so far.
function stopSearch() {
  const hit = backwardsCache.get(searchingKey);
  searching?.terminate();
  searching = null;
  if (hit) backwardsCache.set(searchingKey, { ...hit, cut: false, stopped: true });
  searchingKey = "";
  render();
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
  if (pixelSeed(ui.def) && !doc.examples?.[ui.def]) box.append(h("p", { class: "hint" }, "The picture above is this function at every pixel. Here it runs at one of them: change x, y or time to look at another."));
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
  if (missing.length) box.append(h("p", { class: "status-line" }, `Give ${missing.map((k) => k === "out" ? "the result" : namer.name(k)).join(", ")} a value, or untick ${missing.length === 1 ? "it" : "them"} to solve for ${missing.length === 1 ? "it" : "them"}.`));
  else if (r.error) box.append(h("p", { class: "status-line bad" }, r.error));
  else if (r.cut) box.append(h("p", { class: "status-line" }, r.answers.length ? "Still looking for other answers… " : "Looking for an answer… ",
    h("button", { class: "btn", type: "button", "data-act": "stop-search", title: "Keep what it has found so far" }, "Stop")));
  else if (r.stopped) box.append(h("p", { class: "status-line" }, r.answers.length ? "Stopped looking for other answers: Run again to look further." : "Stopped looking before it found an answer: give it more known ports."));
  else if (r.plan && r.plan.status !== "solved") box.append(h("p", { class: "status-line warn" }, `Not enough is known: give ${r.plan.needMore} more port${r.plan.needMore === 1 ? "" : "s"}, or it is a whole family of answers.`));
  else if (!r.answers.length) box.append(h("p", { class: "status-line bad" }, "No answer: the known values contradict each other, or would need a complex number."));
  if (r.answers.length > 1 || r.more) {
    const wanted = ports.filter((p) => !known.includes(p));
    const alt = r.answers.slice(1).map((a) => wanted.map((p) => `${p === "out" ? "result" : namer.name(p)} ${nice(a.values[p])}`).join(", "));
    box.append(h("details", { class: "alts" }, h("summary", {}, `${r.answers.length - 1}${r.more ? "+" : ""} other answer${r.answers.length > 2 || r.more ? "s" : ""} (other branches)${r.cut ? " so far" : ""}`),
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
    const [b, x] = e.k === "call" && e.f === "pow" ? e.args : [];
    if (x?.k === "num" && !x.name && Number.isInteger(x.v) && x.v >= 0) {
      const [l, lp] = show(b);
      return [powers(`${lp < 100 ? `(${l})` : l}^${x.v}`), 8];
    }
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

// A list's items and the operands of a + b + c are a row (typed.ts): the
// part you selected says where it is in it, and moves, grows or leaves it.
// Each edit is checked when clicked.
function rowSection(info: T.Info, id: Id): HTMLElement | null {
  const inRow = T.rowOfItem(doc.code, id), own = T.rowAt(doc.code, id);
  if (!inRow && !own) return null;
  const box = h("div", {});
  const word = (r: T.Row) => (r.kind === "list" ? "item" : "input");
  const of = (r: T.Row) => (r.kind === "list" ? "the list" : typedPres().names[r.op!] ?? "the call");
  const go = (r: T.TEdit, add = false) => { if (applyT(r) && add) document.getElementById("f-query")?.focus(); };
  if (inRow) {
    const { row, at } = inRow, n = row.items.length;
    const cant = (why: string) => ({ ok: false as const, reason: why });
    box.append(h("div", { class: "sub-head" }, `${cap(word(row))} ${at + 1} of ${n} in ${of(row)} · code.json`), h("div", { class: "acts" },
      edit("Add one before", `A new ${word(row)} just before this`, { ok: true }, () => go(T.addItem(doc.code, doc.names.short, info, row, at), true)),
      edit("Add one after", `A new ${word(row)} just after this`, { ok: true }, () => go(T.addItem(doc.code, doc.names.short, info, row, at + 1), true)),
      edit("Earlier", "Swap it with the one before", at > 0 ? { ok: true } : cant("it's first already"), () => go(T.moveItem(doc.code, doc.names.short, info, row, at, -1))),
      edit("Later", "Swap it with the one after", at < n - 1 ? { ok: true } : cant("it's last already"), () => go(T.moveItem(doc.code, doc.names.short, info, row, at, 1))),
      edit("Take it out", `Remove this ${word(row)}; the rest close up`, { ok: true }, () => go(T.removeItem(doc.code, doc.names.short, info, row, at)), "btn danger")));
  }
  if (own) {
    if (!inRow) box.append(h("div", { class: "sub-head" }, `${own.kind === "list" ? `A list of ${own.items.length}` : `${own.items.length} inputs of ${of(own)}`} · code.json`));
    box.append(h("div", { class: "acts" }, edit(`Add ${own.kind === "list" ? "an item" : "an input"} at the end`, "A new hole at the end, to fill", { ok: true }, () => go(T.addItem(doc.code, doc.names.short, info, own, own.items.length), true))));
  }
  return box;
}

// Units: what inference says, and chips to declare one. A chip that would
// make units disagree is disabled and says why, before you click it.
const UNIT_CHIPS: [string, Unit | null][] = [["free", null], ["1", {}], ["m", { m: 1 }], ["s", { s: 1 }], ["kg", { kg: 1 }], ["A", { A: 1 }],
  ["m/s", { m: 1, s: -1 }], ["m/s²", { m: 1, s: -2 }], ...NAMED.map(([name, u]): [string, Unit] => [name, u])];

function unitSection(info: T.Info, id: Id): HTMLElement | null {
  const n = node(id);
  const declarable = n.kind === "binder" || (n.kind === "lit" && typeof n.value === "number");
  const numeric = T.typeOf(info, id, {}) === "Float64";
  if (!declarable && !numeric) return null;
  const u = (() => { try { return unitInfer(doc.code, ui.def).unit(id); } catch { return undefined; } })();
  const declared = (n as { unit?: Unit }).unit;
  // A program that declares no units (two dice, say) keeps the chooser
  // folded away: a number there is just a number.
  const usesUnits = !!declared || Object.values(doc.code.nodes).some((x) => (x as { unit?: Unit }).unit);
  if (!usesUnits && !declarable) return null;
  const box = h(usesUnits ? "div" : "details", usesUnits ? {} : { class: "alts units" }, usesUnits ? h("div", { class: "sub-head" }, "Unit · part of its type") : h("summary", {}, "Give it a unit (m, s, kg…)"),
    h("p", { class: "hint" }, declared ? `Declared ${formatUnit(declared)}.` : u ? `Inferred ${formatUnit(u)} from what it's connected to.` : n.kind === "lit" ? "A plain number." : "Free: nothing pins it down yet, so it fits anywhere."));
  if (!declarable) return box;
  const chips = h("div", { class: "chips" });
  for (const [label, unit] of UNIT_CHIPS) {
    const on = unit === null ? !declared : !!declared && formatUnit(declared) === formatUnit(unit);
    // Checked when clicked, not when drawn: each check infers the whole
    // program again, and a chip row in a big program took seconds to show
    // every time a number was selected. A unit that doesn't fit is refused
    // with the reason, like any edit.
    const b = h("button", { class: `chip-btn${on ? " on" : ""}`, type: "button", title: `Declare ${label}` }, label);
    if (!on) b.addEventListener("click", () => applyT(unitEdit(info, id, unit)));
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
// nested, Lisp) with the chosen notation. One they can't show says so.
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
const GRAPH_HINT = TOUCH
  ? "long-press for a menu; drag a node to move it; Pick (in the menu) several to move them together; pinch to zoom; tap a wire to put a dot on it; drag from a port, dot or output onto an input to use that value there"
  : "right-click for a menu; drag a node to move it (alt-drag for a dot), shift-click or shift-drag to pick several; click a wire to put a dot on it; drag from a port, dot or output onto an input to use that value there; drag an input's wire away to leave a hole";

// The definition's loose parts, at the end of its text, each as loose: and
// the expression it is (inside, they're _1, _2, …): kept
// and type-checked, edited like the rest, never run (NODE-EDITOR.md, "Loose
// parts").
function looseBlocks(info: T.Info): HTMLElement[] {
  const parts = looseOf(doc.code, doc.loose ?? {}, ui.def);
  if (!parts.length) return [];
  return [h("div", { class: "loose-head" }, "-- loose, not used yet"), ...parts.map((x) => h("div", { class: "loose" }, T.renderTyped(doc.code, typedPres(), info, x, ui.selected, doc.home ?? {})))];
}

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
  // Its id is the program's, not the reader's: kept on hover for whoever
  // needs to find it in code.json.
  out.append(h("div", { class: "insp-head" }, h("span", { class: "kind", title: `id ${id} in code.json` }, kindLabel(id))));
  const t = T.typeOf(info, id, names);
  const hole = info.holes.get(id);
  if (hole) out.append(h("div", { class: "typeline" }, h("span", {}, "needs"), h("code", {}, typeName(info, hole.expected, names))));
  else if (t) out.append(h("div", { class: "typeline" }, h("span", {}, "type"), h("code", {}, t)));
  const err = info.errors.find((e) => e.id === id);
  if (err) out.append(h("p", { class: "status-line bad" }, err.message));
  // A type with no implementation of an interface a use needs: write one.
  if (err?.missing) out.append(h("div", { class: "acts" }, implementButton(info, err.missing.iface, err.missing.type, `Implement ${names[err.missing.iface] ?? "it"} for ${showIn(err.missing.type, names, info.subst)}`)));

  const callee = calleeDef(id) ?? (n.kind === "ref" && node(n.target)?.kind === "variant" ? info.owner.get(n.target) ?? null : null);
  // The call itself, or its head (the name clicked to select it).
  const call = inlinable(doc.code, id) ? id : n.kind === "ref" ? Object.values(doc.code.nodes).find((c) => c.kind === "call" && c.fn === id && inlinable(doc.code, c.id))?.id : undefined;
  if ((callee && callee !== ui.def) || call) out.append(h("div", { class: "acts" },
    callee && callee !== ui.def ? h("button", { class: "btn", type: "button", "data-act": "goto", "data-target": callee }, `Open ${namer.name(callee)}`) : null,
    call ? h("button", { class: "btn", type: "button", "data-act": "inline", "data-target": call, title: "Draw the call as the definition's body, in place. A view only." }, (doc.layout.inline ?? []).includes(call) ? "Collapse" : "Show inline") : null));

  if (n.kind === "binder" || n.kind === "def" || n.kind === "variant" || n.kind === "field") {
    const current = doc.names[ui.layer][id] ?? doc.names.short[id] ?? "";
    const input = h("input", { id: "f-name", type: "text", value: current, autocomplete: "off", spellcheck: "false", "data-commit": true }) as HTMLInputElement;
    input.addEventListener("change", () => rename(id, input.value));
    // Enter saves (the change) and goes back to the program.
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); toProgram(); } });
    out.append(h("label", { class: "field", for: "f-name" }, h("span", {}, `Name · names.${nameLayer(id)}.json`), input));
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

  // Nested patterns: a case's field opens into its type's cases, and a
  // match whose cases all say the same thing closes up (PATTERNS.md).
  const caseField = n.kind === "binder" && Object.values(doc.code.nodes).some((a) => a.kind === "arm" && a.binds.includes(id)) && T.dataTypeOf(doc.code, info, id);
  const joinable = n.kind === "match" ? id : n.kind === "arm" ? Object.values(doc.code.nodes).find((m) => m.kind === "match" && m.arms.includes(id))?.id : undefined;
  const join = joinable ? T.joinCases(doc.code, doc.names.short, info, joinable) : null;
  if (caseField || join?.ok) {
    const deeper = caseField ? T.matchDeeper(doc.code, doc.names.short, info, id) : null;
    out.append(h("div", { class: "sub-head" }, "Pattern · code.json"), h("div", { class: "acts" },
      deeper ? edit("Match deeper", `Open ${names[id] ?? "it"} into its cases, each row a copy of this one`, deeper, () => applyT(deeper)) : null,
      join?.ok ? edit("Join cases", "Its cases all give the same value: put that value back in their place", join, () => applyT(join)) : null));
  }
  if (hole && clip) out.append(h("div", { class: "acts" }, h("button", { class: "btn", type: "button", "data-act": "paste", title: "Ctrl+V" }, "Paste the copy here")));
  if (hole && held[ui.def] && !doc.signatures?.[ui.def]) {
    const dname = pres().names[ui.def] ?? "This definition";
    out.append(h("div", { class: "acts held" }, h("p", { class: "hint" }, `${dname} keeps its type, ${showPin(held[ui.def], pres().names)}, while it has a hole, so only what keeps it is offered. For something that changes it, let it loosen first.`), loosenButton(dname)));
  }
  if (hole) out.append(rowSection(info, id) ?? "", fillPalette(id, info, names));

  if (n.kind === "lit") {
    // A text gets a box that keeps its lines: Shift+Enter starts a new one,
    // and once it has several, Enter does too. A long text starts taller.
    const text = typeof n.value === "string" && n.of !== INT;
    const lines = String(n.value).split("\n").length;
    const multi = text && lines > 1;
    const input = (text
      ? h("textarea", { id: "f-lit", rows: String(multi || String(n.value).length > 60 ? Math.min(16, lines + 1) : 1), spellcheck: "false", class: "lit-text", title: multi ? "" : "Shift+Enter for a new line" }, String(n.value))
      : h("input", { id: "f-lit", type: "text", value: String(n.value), autocomplete: "off" })) as HTMLInputElement;
    const next = () => { const h = T.nextHole(doc.code, ui.def, id); if (h) select(h); };
    let done = false;
    const commit = () => { if (done) return; done = true; if (input.value === String(n.value)) next(); else if (applyT(T.setLit(doc.code, doc.names.short, info, id, input.value))) next(); };
    input.addEventListener("change", () => { if (input.value !== String(n.value)) commit(); });
    // Enter on an unchanged value (an empty text, say) moves on too.
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || multi) return;
      e.preventDefault();
      commit();
      toProgram();
    });
    out.append(h("label", { class: "field", for: "f-lit" }, h("span", {}, `${n.of === INT ? "Int" : typeof n.value === "number" ? "Float64" : "Text"} · code.json`), input));
  }

  const isExprNode = ["lit", "ref", "call", "lambda", "match", "fold"].includes(n.kind) && !doc.code.defs.includes(id);
  if (isExprNode) {
    const splittable = T.scopeAt(doc.code, ui.def, id).filter((b) => T.dataTypeOf(doc.code, info, b));
    out.append(h("div", { class: "sub-head" }, "Change meaning · code.json"), h("div", { class: "acts" },
      h("button", { class: "btn", type: "button", "data-act": "copy", title: "Ctrl+C; Ctrl+X cuts" }, "Copy"),
      h("button", { class: "btn", type: "button", "data-act": "t-replace", title: "Pick what goes here instead, from the palette" }, "Replace with…"),
      wrappable(id) ? h("button", { class: "btn", type: "button", "data-act": "t-wrap", title: "Put it inside a call or a function from the palette: it becomes one of its inputs" }, "Wrap in…") : null,
      h("button", { class: "btn danger", type: "button", "data-act": "t-clear" }, "Clear to a hole"),
      n.kind === "call" && doc.code.nodes[n.fn].kind !== "lambda" ? h("button", { class: "btn", type: "button", "data-act": "t-swap", title: "Keep its inputs and pick another function that takes them" }, "Change the function…") : null,
      splittable.length ? h("button", { class: `btn${ui.mode === "split" ? " on" : ""}`, type: "button", "data-act": "split" }, "Split by cases…") : null));
    // A step of an action (print this, then that): its place in the order.
    const earlier = Top.moveStep(doc.code, doc.names.short, id, -1), later = Top.moveStep(doc.code, doc.names.short, id, 1);
    const isStep = (r: Top.Top) => r.ok || !/isn't a step/.test(r.reason);
    const body = defBody(ui.def);
    if (isStep(earlier) && body?.kind === "lambda" && !body.params.length) out.append(h("div", { class: "sub-head" }, "Order of steps · code.json"), h("div", { class: "acts" },
      edit("Do it earlier", "Swap it with the step before", earlier, () => runTop(info, earlier)),
      edit("Do it later", "Swap it with the step after", later, () => runTop(info, later))));
    const row = rowSection(info, id);
    if (row) out.append(row);
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
  // References show as {name}; on the way back a {name} that is one of them,
  // or that only one node carries, becomes that node's id again.
  const raw = doc.comments[id] ?? "";
  const refs = [...raw.matchAll(new RegExp(`\\{(${ID_PATTERN})\\}`, "g"))].map((m) => m[1]);
  ta.value = resolveRefs(raw, (ref) => `{${names[ref] ?? ref}}`);
  ta.addEventListener("change", () => {
    const back = ta.value.replace(/\{([^{}]+)\}/g, (whole, nm: string) => {
      const mine = refs.find((r) => names[r] === nm);
      const all = Object.keys(names).filter((r) => names[r] === nm && doc.code.nodes[r]);
      const ref = mine ?? (all.length === 1 ? all[0] : undefined);
      return ref ? `{${ref}}` : whole;
    });
    if (back !== raw) setComment(id, back);
  });
  out.append(h("label", { class: "field", for: "f-comment" }, h("span", {}, "Comment · comments.json"), ta));
  return out;
}

// With what its type variables stand for: add is (a, a) -> a where a is a
// number type, not any a.
const typeName = (info: T.Info, t: Type, names: Names) => showIn(t, names, info.subst);

function fillLabel(f: T.Filling, info: T.Info, names: Names): [string, string, string] {
  const nm = (id: Id) => names[id] ?? id;
  switch (f.kind) {
    case "ref": return [nm(f.target), typeName(info, f.type, names), node(f.target)?.kind === "binder" ? "in scope" : node(f.target)?.kind === "variant" ? "constructors" : info.subst.resolve(f.type).t === "fn" ? "functions, not called" : "definitions"];
    case "call": return [`${nm(f.target)}(${Array.from({ length: f.arity }, () => "□").join(", ")})`, typeName(info, f.type, names), "calls"];
    case "lit": return [f.of === "number" ? "a number" : f.of === "int" ? "an integer" : "a text", f.of === "number" ? "Float64" : f.of === "int" ? "Int" : "Text", "literals"];
    case "lambda": return [`(${Array.from({ length: f.arity }, () => "□").join(", ")}) => □`, "a function you write here", "new function"];
    default: return words(f.type).effect
      ? [`handle ${nm(f.type)} in □`, `one case per operation of ${nm(f.type)}, on the computation you give next`, "case analysis"]
      : [`${f.kind} ${f.on ? nm(f.on) : "□"} · ${nm(f.type)}`, `one case per ${nm(f.type)}${f.kind === "fold" ? ", with each part already folded" : ""}${f.on ? "" : ", on a value you give next"}`, "case analysis"];
  }
}

// The symbols people type for the builtins with word names.
const SYMBOLS: Record<string, string[]> = {
  add: ["+"], subtract: ["-", "−"], negate: ["-", "−"], multiply: ["*", "·", "×"], divide: ["/", "÷"], power: ["^", "**"],
  "square root": ["√"], sqrt: ["√"], "less than": ["<"], equal: ["=", "=="], and: ["&&"], or: ["||"], not: ["!"], mod: ["%"], "join text": ["++"],
};

// Names other languages use, so a search by what something does finds it:
// insert is put, lookup is value at (BACKLOG E136).
const ALSO: Record<string, string[]> = {
  put: ["insert", "set", "update", "store"], "value at": ["lookup", "get", "find", "fetch"], "has key": ["contains", "member", "includes"],
  "remove key": ["delete", "erase"], "keys of": ["keys"], "values of": ["values"], "map size": ["size", "count", "len"], "set size": ["size", "count", "len"],
  length: ["size", "count", "len"], keep: ["filter", "where", "select"], map: ["transform", "convert each"], "for each": ["loop", "iterate", "foreach"],
  append: ["concat", "concatenate"], "join text": ["concat", "concatenate"], "add item": ["insert", "push"], "has item": ["contains", "member", "includes"],
  "remove item": ["delete", "erase"], "items of": ["elements", "to list"], smaller: ["min", "minimum"], larger: ["max", "maximum"],
  show: ["to string", "tostring", "format", "string of"], print: ["log", "output", "write", "echo", "console"], attempt: ["try", "catch"],
  sort: ["order"], sum: ["total", "add up"], "empty map": ["new map", "dictionary", "dict", "hash"], "empty set": ["new set"],
};

// A new hole's palette: the side panel's when it shows, not a pop-up over
// the graph repeating it (BACKLOG E125); a pop-up where you clicked when
// the panel is out of sight.
function paletteFor(hole: Id, m: NonNullable<UI["menu"]>) {
  ui.panel = "node";
  ui.menu = null;
  render();
  const side = document.getElementById("f-query");
  if (side?.offsetParent && !onePane()) return side.focus();
  ui.menu = { ...m, target: { kind: "hole", id: hole } };
  render();
  document.getElementById("m-query")?.focus();
}

// The step a numbered dot stands for: the value its let binds; anything
// else is its own step.
function stepAt(id: Id): Id {
  for (const n of Object.values(doc.code.nodes)) {
    const f = n.kind === "call" ? doc.code.nodes[n.fn] : undefined;
    const i = f?.kind === "lambda" ? f.params.indexOf(id) : -1;
    if (i >= 0) return (n as NodeOf<"call">).args[i];
  }
  return id;
}

// What fits a hole, once per check of the code: the right-click menu and
// the side panel show the same palette, and typing in either redraws both.
const fitting = new WeakMap<T.Info, Map<Id, T.Filling[]>>();
function fillingsAt(info: T.Info, hole: Id): T.Filling[] {
  let m = fitting.get(info);
  if (!m) fitting.set(info, (m = new Map()));
  if (!m.has(hole)) m.set(hole, T.fillings(doc.code, info, hole));
  return m.get(hole)!;
}

// Why nothing with effects goes in a hole that allows none, so a search
// for print there says so instead of finding nothing (BACKLOG E123).
function pureHole(info: T.Info, hole: Id): string {
  const hi = info.holes.get(hole), row = hi && info.subst.resolveRow(hi.row);
  if (!row || row.effs.length || row.tail !== null) return "";
  return hi.group.some((d) => doc.loose?.[d])
    ? "A loose part is a value of its own, and a value can't have effects, so print, die() and the like aren't offered. Fill the hole where the part will be used, or wire it in first."
    : "This hole can't have effects (its definition is a value, or its type says none), so print, die() and the like aren't offered.";
}

// How often each thing is referred to in the program, once per version.
const uses = new WeakMap<Code, Map<Id, number>>();
function usesIn(code: Code): Map<Id, number> {
  let m = uses.get(code);
  if (!m) {
    m = new Map();
    for (const n of Object.values(code.nodes)) if (n.kind === "ref" && !isPublished(n.id)) m.set(n.target, (m.get(n.target) ?? 0) + 1);
    uses.set(code, m);
  }
  return m;
}

function fillPalette(hole: Id, info: T.Info, names: Names, field = "f-query"): HTMLElement {
  const q = ui.query.trim().toLowerCase();
  // Most often wanted first; a function passed along uncalled last, since
  // at a hole of any type it would otherwise come before calling it.
  // Where a call's function goes (Change the function…), functions are
  // what's wanted, and they will be called.
  const head = Object.values(doc.code.nodes).some((n) => n.kind === "call" && n.fn === hole);
  // Where a function goes, writing one here is often what's meant.
  const order = [...(head ? ["functions"] : []), "in scope", "new function", "calls", "constructors", "definitions", "literals", "case analysis", "functions, not called"];
  const label = (f: T.Filling): [string, string, string] => { const l = fillLabel(f, info, names); return head && l[2] === "functions, not called" ? [l[0], l[1], "functions"] : l; };
  // Within a group, what the program calls most comes first: print in a
  // new main, not for each because it's alphabetically early.
  const used = usesIn(doc.code);
  const often = (f: T.Filling) => (f.kind === "call" || f.kind === "ref" ? used.get(f.target) ?? 0 : 0);
  const all = fillingsAt(info, hole).map((f) => ({ f, l: label(f) })).sort((a, b) => order.indexOf(a.l[2]) - order.indexOf(b.l[2]) || often(b.f) - often(a.f));
  // Rows that would read the same (show(□) for a Float64, an Int, anything)
  // say what each of their holes takes: show(□: Int).
  const seen = new Map<string, number>();
  for (const { l } of all) seen.set(l[0], (seen.get(l[0]) ?? 0) + 1);
  for (const x of all) {
    const t = x.f.kind === "call" ? info.subst.resolve(x.f.type) : null;
    if (seen.get(x.l[0])! > 1 && x.f.kind === "call" && t?.t === "fn" && t.params.length)
      x.l = [`${names[x.f.target] ?? x.f.target}(${t.params.map((p) => `□: ${typeName(info, p, names)}`).join(", ")})`, x.l[1], x.l[2]];
  }
  // Searching: names that are the text, then start with it, then have a
  // word starting with it, then contain it, and only then entries whose
  // type or description mentions it. Within each, the usual order.
  // An operator's symbol finds it too: + is add.
  // Then what it is called elsewhere (insert finds put), and last a word
  // of its comment (key finds value at: "What key holds").
  const symbol = (l: [string, string, string]) => SYMBOLS[l[0].replace(/\(.*$/, "")]?.includes(q) ?? false;
  const also = (l: [string, string, string]) => (q.length > 1 ? ALSO[l[0].replace(/\(.*$/, "")]?.find((w) => w.startsWith(q)) : undefined);
  const note = (f: T.Filling) => (q.length > 2 && (f.kind === "call" || f.kind === "ref") ? doc.comments[f.target] ?? LIBRARY.comments[f.target] ?? "" : "");
  const inNote = (f: T.Filling) => note(f).toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q));
  const rank = (x: (typeof all)[number]) => {
    const name = x.l[0].toLowerCase();
    return name === q || name.startsWith(`${q}(`) || symbol(x.l) ? 0 : name.startsWith(q) ? 1 : name.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q)) || also(x.l) ? 2 : name.includes(q) ? 3 : x.l.some((s) => s.toLowerCase().includes(q)) ? 4 : 5;
  };
  // Found by another name or by its comment, the row says which.
  const found = (x: (typeof all)[number], r: number): [string, string, string] => {
    const w = r === 2 && !x.l[0].toLowerCase().split(/[^\p{L}\p{N}]+/u).some((v) => v.startsWith(q)) ? also(x.l) : undefined;
    return w ? [x.l[0], `elsewhere called ${w} · ${x.l[1]}`, x.l[2]] : r === 5 ? [x.l[0], note(x.f).split(/(?<=\.)\s/)[0], x.l[2]] : x.l;
  };
  const shown = !q ? all : all.filter((x) => symbol(x.l) || also(x.l) || x.l.some((s) => s.toLowerCase().includes(q)) || inNote(x.f)).map((x) => { const r = rank(x); return { ...x, l: found(x, r), r }; }).sort((a, b) => a.r - b.r);
  // Unsearched, the first 40 (the rest are a search away); searched, all.
  const cap = q ? shown.length : 40;
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
    const b = h("button", { class: "opt", type: "button" }, h("span", { class: "opt-l" }, ui.query.trim()), h("span", { class: "opt-d" }, "this, written out"));
    b.addEventListener("click", runValue);
    list.append(h("div", { class: "pal-g" }, "the value typed"), b);
  }
  let group = "";
  for (const x of shown.slice(0, cap)) {
    if (x.l[2] !== group) { group = x.l[2]; list.append(h("div", { class: "pal-g" }, group)); }
    const b = h("button", { class: "opt", type: "button" }, h("span", { class: "opt-l" }, x.l[0]), h("span", { class: "opt-d" }, x.l[1]));
    b.addEventListener("click", () => run(x));
    list.append(b);
  }
  if (shown.length > cap) list.append(h("p", { class: "hint" }, `${shown.length - cap} more: type to search them.`));
  const why = !shown.length && !value && q ? T.whyNotHere(doc.code, doc.names.short, info, hole, ui.query) ?? pureHole(info, hole) : "";
  if (!shown.length && !value) list.append(h("p", { class: "hint" }, `Nothing that fits matches. ${why || "Values and arithmetic can be typed too: 3, \"text\", [1, 2], x * 2, (x) => x + 1."}`));
  return h("div", {}, h("div", { class: "sub-head" }, "Fill · only what type-checks here"), h("div", { class: "picker" }, input, list));
}

// What Wrap in… applies to: a value in an expression, not a definition's
// whole body's lambda or a step's own let.
function wrappable(id: Id): boolean {
  const n = doc.code.nodes[id];
  return !!n && ["lit", "ref", "call", "lambda", "match", "fold"].includes(n.kind) && !doc.code.defs.includes(id) && !(n.kind === "call" && doc.code.nodes[n.fn]?.kind === "lambda") && defBody(ui.def)?.id !== id;
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
  if (!pinned && held[ui.def]) {
    return h("div", { class: "pin-row" },
      h("div", { class: "sub-head" }, `Type of ${dname}`),
      h("p", { class: "hint" }, `Kept at ${showPin(held[ui.def], pres().names)} while it has a hole, so clearing a node doesn't loosen it. Fills must keep it.`),
      h("div", { class: "acts" }, loosenButton(dname)));
  }
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

// A type, picked the way it's written: what it starts with (Float64, Int, a
// data type, one of the type's own parameters) and, for one that takes
// arguments, a picker for each, nested: Pair, then Int and Text. `none`
// adds a first choice of no type at all; a type the pickers can't show
// (a function's) is kept until another is picked.
function typePicker(id: string, type: Id, names: Names, current: Id | null, changed: () => void, none?: string) {
  const heads = Top.typeHeads(doc.code, type);
  const specOf = (t: Id): Top.TypeSpec | null => {
    const n = node(t);
    if (n.kind !== "tref") return null;
    const args = n.args.map(specOf);
    return args.every(Boolean) ? { target: n.target, args: args as Top.TypeSpec[] } : null;
  };
  const kept = current ? specOf(current) : null;
  const one = (at: Top.TypeSpec | null, sid: string | undefined, top: boolean): { el: HTMLElement; spec: () => Top.TypeSpec | null } => {
    const odd = top && current && !kept ? typeText(current, names) : null;
    const select = h("select", sid ? { id: sid } : { "aria-label": "argument" },
      top && none ? h("option", { value: "none", selected: !current }, none) : null,
      odd ? h("option", { value: "kept", selected: true }, odd) : null,
      ...heads.map((x, i) => h("option", { value: String(i), selected: !odd && at?.target === x.target }, names[x.target] ?? x.target))) as HTMLSelectElement;
    if (!at && !odd && !(top && none)) select.value = "0";
    const args = h("div", { class: "type-args" });
    let parts: { el: HTMLElement; spec: () => Top.TypeSpec | null }[] = [];
    const fill = (given: Top.TypeSpec[]) => {
      const head = heads[Number(select.value)];
      parts = head ? Array.from({ length: head.arity }, (_, i) => one(given[i] ?? null, undefined, false)) : [];
      args.replaceChildren(...parts.map((p) => p.el));
    };
    fill(at?.args ?? []);
    select.addEventListener("change", (e) => { e.stopPropagation(); fill([]); changed(); });
    return {
      el: h("div", { class: "type-pick" }, select, args),
      spec: () => {
        const head = heads[Number(select.value)];
        if (!head) return null;
        const xs = parts.map((p) => p.spec());
        return xs.every(Boolean) ? { target: head.target, args: xs as Top.TypeSpec[] } : null;
      },
    };
  };
  return one(kept, id, true);
}

// Run a top-level edit; `then` adjusts what's shown once it's in.
function runTop(info: T.Info, r: Top.Top, then?: (r: Extract<Top.Top, { ok: true }>) => void) {
  // Before drawing: drawn first, a deleted definition would still be the
  // open one, with its nodes gone.
  applyT(topT(info, r), r.ok && then ? () => then(r) : undefined);
}

const row = (...kids: Kid[]) => h("div", { class: "srow" }, ...kids);
const pick = (id: Id, label: string, detail?: string) => h("button", { class: "slink", type: "button", "data-act": "goto-node", "data-target": id }, label, detail ? h("span", { class: "opt-d" }, ` ${detail}`) : null);

// An interface's implementations (INTERFACES.md): the ones there are, and
// one to write for a type that has none.
function implementFor(r: ReturnType<typeof T.implement>) {
  applyT(r, () => { if (r.ok) { ui.back = [ui.def]; ui.def = r.code.defs.at(-1)!; } }, undefined, r.ok ? r.pin : undefined);
}
function implementButton(info: T.Info, iface: Id, type: Type, label: string): HTMLElement {
  const r = T.implement(doc.code, doc.names.short, info, iface, type);
  return edit(label, "A definition of the interface's record at this type, a hole for each operation", r, () => implementFor(r));
}

// A data type's side: each interface, and how this type does it or a
// button to write how.
function interfacesOfType(info: T.Info, names: Names): HTMLElement {
  const type: Type = { t: "con", id: ui.def, args: [] }, dname = names[ui.def] ?? "this type";
  const out = h("div", {}, h("div", { class: "sub-head" }, `Interfaces ${dname} implements · code.json`));
  for (const iface of T.interfaces(doc.code)) {
    const d = info.implementations?.get(implementationKey(iface, type));
    out.append(row(d ? pick(d, names[iface] ?? iface, `by ${names[d] ?? d}`) : h("span", {}, names[iface] ?? iface), d ? null : implementButton(info, iface, type, "Implement")));
  }
  out.append(h("p", { class: "hint" }, `An interface is a set of operations, like Trig's sin and cos. Implementing one for ${dname} is a definition of what each operation does at ${dname}; then the operation works on a ${dname} wherever it's used.`));
  return out;
}

function implementationsPanel(info: T.Info, names: Names): HTMLElement {
  const iface = ui.def, dname = names[iface] ?? "this interface";
  const out = h("div", {}, h("div", { class: "sub-head" }, `Implementations of ${dname} · code.json`));
  const have = [...(info.implementations ?? new Map<string, Id>())].filter(([k]) => k.startsWith(`${iface}|`)).map(([, d]) => d);
  if (!have.length) out.append(h("p", { class: "hint" }, "None yet."));
  for (const d of have) out.append(row(pick(d, names[d] ?? d, T.typeOf(info, d, names) ?? "")));
  const types = T.implementable(doc.code, info, iface);
  if (!types.length) return out;
  const sel = h("select", { id: "f-implement" }, ...types.map((t) => h("option", { value: t }, names[t] ?? t))) as HTMLSelectElement;
  const go = h("button", { class: "btn", type: "button" }, "Implement");
  go.addEventListener("click", () => implementFor(T.implement(doc.code, doc.names.short, info, iface, { t: "con", id: sel.value, args: [] })));
  out.append(h("label", { class: "field", for: "f-implement" }, h("span", {}, "For the type"), sel), h("div", { class: "acts" }, go),
    h("p", { class: "hint" }, `How a type does ${dname}: a definition of its record at that type, with a hole for each operation. Uses of ${dname}'s operations at that type then call it directly.`));
  return out;
}

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

  if (sel === ui.def && body?.kind === "typedef" && body.interface) {
    // An interface's operations are its record's fields, each a function
    // of its type a (INTERFACES.md).
    const variant = body.variants[0], a = body.params[0];
    out.append(h("div", { class: "sub-head" }, `Operations of ${dname} · code.json`));
    for (const f of get(code, variant, "variant").fields) {
      const r = Top.removeField(code, sh, variant, f);
      out.append(row(pick(f, names[f] ?? "operation", typeText(get(code, f, "field").type, names)), edit("×", "Remove this operation", r, () => runTop(info, r), "btn mini")));
    }
    const c = textField("f-new-op", "New operation", "its name");
    const takes = h("select", { id: "f-op-takes" }, h("option", { value: "1" }, `(${names[a] ?? "a"})`), h("option", { value: "2" }, `(${names[a] ?? "a"}, ${names[a] ?? "a"})`)) as HTMLSelectElement;
    const gives = h("select", { id: "f-op-gives" }, ...([[a, names[a] ?? "a"], [BOOL, "Bool"], [STRING, "Text"], [NUMBER, "Float64"]] as [Id, string][]).map(([v, l]) => h("option", { value: v }, l))) as HTMLSelectElement;
    const add = h("button", { class: "btn", type: "button" }, "Add the operation");
    add.addEventListener("click", () => runTop(info, Top.addOperation(code, sh, ui.def, c.input.value, +takes.value, gives.value === a ? null : gives.value)));
    c.input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
    out.append(c.el, h("label", { class: "field", for: "f-op-takes" }, h("span", {}, "Takes"), takes), h("label", { class: "field", for: "f-op-gives" }, h("span", {}, "Gives"), gives), h("div", { class: "acts" }, add),
      h("p", { class: "hint" }, `Every implementation of ${dname} gets a hole for a new operation.`), implementationsPanel(info, names));
  } else if (sel === ui.def && body?.kind === "typedef") {
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
    if (!body.effect && !body.params.length) out.append(interfacesOfType(info, names));
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
  } else if (innerLambda(sel)) {
    const lam = innerLambda(sel)!;
    out.append(h("div", { class: "sub-head" }, "Inputs of this function · code.json"));
    if (!lam.params.length) out.append(h("p", { class: "hint" }, "None."));
    lam.params.forEach((p) => out.append(paramRow(info, names, p, lam.id)));
    const c = textField("f-new-input", "New input", "its name");
    const add = h("button", { class: "btn", type: "button" }, "Add the input");
    add.addEventListener("click", () => runTop(info, Top.addParameter(code, sh, lam.id, c.input.value)));
    c.input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
    out.append(c.el, h("div", { class: "acts" }, add), h("p", { class: "hint" }, "What it's passed to has to take the new inputs, or the edit is refused."));
    return out;
  } else if (n?.kind === "binder" && innerLambda(inputOf(sel))) {
    out.append(h("div", { class: "sub-head" }, "Input of a function · code.json"), paramRow(info, names, sel, inputOf(sel)!));
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
    const t = typePicker("f-new-field-type", type, names, null, () => {});
    const add = h("button", { class: "btn", type: "button" }, `Add the ${w.field}`);
    add.addEventListener("click", () => { const sp = t.spec(); if (sp) runTop(info, Top.addField(code, sh, type, sel, c.input.value, sp)); });
    out.append(c.el, h("label", { class: "field", for: "f-new-field-type" }, h("span", {}, "Holding"), t.el), h("div", { class: "acts" }, add),
      h("p", { class: "hint" }, w.effect ? "Every call of it gets a hole for a new input, and every case that handles it a name." : "Every place that makes this case gets a hole for a new field, and every arm for it a name."));
    if (w.effect) {
      // What the handler answers it with: the value the call gives back.
      const now = n.returns ? typeText(n.returns, names) : null;
      const r = typePicker("f-returns", type, names, n.returns ?? null, () => {
        const sp = r.spec();
        if (sp || (r.el.querySelector("select") as HTMLSelectElement).value === "none") runTop(info, Top.setReturns(code, sh, sel, sp));
      }, "nothing: it never returns");
      out.append(h("label", { class: "field", for: "f-returns" }, h("span", {}, "Gives back"), r.el),
        h("p", { class: "hint" }, now ? `A call of ${names[sel] ?? "it"} is worth the ${now} its handler answers with.` : `Like abort: performing ${names[sel] ?? "it"} ends what performs it, and the handler's case gives the result instead.`));
      // Answered later (ANSWERED-LATER.md): the case gets the rest too.
      if (n.returns) {
        const cb = h("input", { id: "f-later", type: "checkbox", checked: !!n.later }) as HTMLInputElement;
        cb.addEventListener("change", () => runTop(info, Top.setLater(code, sh, sel, cb.checked)));
        out.append(h("label", { class: "field check", for: "f-later" }, cb, h("span", {}, "Answered later")),
          h("p", { class: "hint" }, n.later ? `Its handler's case also gets the rest of the computation, written ${names[sel] ?? "it"}(…) with rest: it may resume it once, now or later, or drop it. A generator's yield, a page's fetch.` : "Tick it to let the handler answer later: its case also gets the rest of the computation, to resume once, now or later, or drop."));
      }
    }
    out.append(h("div", { class: "acts" }, edit(`Remove this ${w.case}`, `Remove this ${w.case} from the ${w.effect ? "effect" : "type"}`, Top.removeCase(code, sh, type, sel), () => runTop(info, Top.removeCase(code, sh, type, sel), () => { ui.selected = null; }), "btn danger")));
    return out;
  } else if (n?.kind === "field") {
    const variant = Object.values(code.nodes).find((v) => v.kind === "variant" && v.fields.includes(sel)) as NodeOf<"variant">;
    const type = info.owner.get(sel)!;
    const t = typePicker("f-field-type", type, names, n.type, () => { const sp = t.spec(); if (sp) runTop(info, Top.setFieldType(code, sh, sel, sp)); });
    const w = words(type);
    out.append(h("div", { class: "sub-head" }, `${cap(w.field)} of `, pick(variant.id, names[variant.id] ?? `a ${w.case}`), " · code.json"),
      h("label", { class: "field", for: "f-field-type" }, h("span", {}, "Holding"), t.el),
      h("div", { class: "acts" }, edit(`Remove this ${w.field}`, `Remove it from the ${w.case}`, Top.removeField(code, sh, variant.id, sel), () => runTop(info, Top.removeField(code, sh, variant.id, sel), () => { ui.selected = variant.id; }), "btn danger")));
    return out;
  } else return null;

  const del = own.length > 1 ? Top.deleteDefinition(code, sh, ui.def) : { ok: false as const, reason: "it's the program's only definition" };
  // Duplicating checks the whole program, so it's worked out on the click.
  const typeDef = code.nodes[(code.nodes[ui.def] as NodeOf<"def">).body ?? ""]?.kind === "typedef";
  const dup = () => { const r = T.duplicate(code, sh, info, ui.def); if (r.ok) { ui.def = r.select!; ui.back = []; } applyT(r); };
  out.append(h("div", { class: "acts" },
    edit(`Duplicate ${dname}`, "A copy to change, next to it; the original stays as it is", typeDef ? { ok: false, reason: "the copy's cases would share the original's names: make a new type with + New definition" } : { ok: true }, dup),
    edit(`Delete ${dname}`, "Delete this definition", del, () => runTop(info, del, (r) => { ui.def = r.select; ui.selected = null; ui.back = []; }), "btn danger")));
  return out;
}

function paramRow(info: T.Info, names: Names, p: Id, of: Id = ui.def) {
  const code = doc.code, sh = doc.names.short;
  const mv = (by: -1 | 1) => Top.moveParameter(code, sh, of, p, by);
  const rm = Top.removeParameter(code, sh, of, p, true);
  return row(pick(p, names[p] ?? "input"),
    edit("↑", "Move earlier", mv(-1), () => runTop(info, mv(-1)), "btn mini"),
    edit("↓", "Move later", mv(1), () => runTop(info, mv(1)), "btn mini"),
    // A used input can go too: its uses become holes, to fill or clear.
    edit("×", T.usesOf(code, p).length ? "Remove this input: where it's used becomes a hole" : "Remove this input", rm, () => runTop(info, rm, (r) => { ui.selected = r.select !== of ? r.select : of === ui.def ? null : of; }), "btn mini"));
}

// A function written inside a body, (x) => …, passed to map or keep say:
// not a definition's own, and not a let (a function applied right where it
// is written, drawn as dots). Its inputs are edited like a definition's.
function innerLambda(id: Id | null): NodeOf<"lambda"> | null {
  const n = id ? node(id) : null;
  if (n?.kind !== "lambda" || n.id === defBody(ui.def)?.id) return null;
  return Object.values(doc.code.nodes).some((c) => c.kind === "call" && c.fn === n.id) ? null : n;
}
const inputOf = (binder: Id) => Object.values(doc.code.nodes).find((l) => l.kind === "lambda" && l.params.includes(binder))?.id ?? null;

// + New: a function (with its inputs), a value, or a data type.
function newDefinitionForm(info: T.Info): HTMLElement {
  const name = textField("f-def-name", "Name", "what to call it");
  const kind = ui.newKind;
  const extra = kind === "function" ? textField("f-def-inputs", "Inputs", "names, separated by commas (none for an action)")
    : kind === "type" ? textField("f-def-case", "First case", "a name, e.g. circle")
    : kind === "effect" ? textField("f-def-case", "First operation", "a name, e.g. ask")
    : kind === "interface" ? textField("f-def-case", "First operation", "a name, e.g. sin") : null;
  const go = h("button", { class: "btn", type: "button" }, "Create");
  go.addEventListener("click", () => {
    const shape: Top.Shape = kind === "function" ? { kind, params: (extra!.input.value).split(",").map((x) => x.trim()).filter(Boolean) }
      : kind === "type" ? { kind, firstCase: extra!.input.value }
      : kind === "effect" || kind === "interface" ? { kind, firstOperation: extra!.input.value } : { kind: "value" };
    runTop(info, Top.newDefinition(doc.code, doc.names.short, name.input.value, shape), (r) => {
      ui.back = [ui.def];
      ui.def = r.code.defs.at(-1)!;
      ui.selected = kind === "type" || kind === "effect" || kind === "interface" ? null : r.select;
      ui.mode = null;
    });
  });
  for (const f of [name, extra]) f?.input.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
  return h("div", { class: "insp" },
    h("div", { class: "sub-head" }, "New definition · code.json"),
    seg("new-kind", kind, [["function", "Function"], ["value", "Value"], ["type", "Data type"], ["effect", "Effect"], ["interface", "Interface"]]),
    h("p", { class: "hint" }, kind === "function" ? "Takes inputs and gives back a value; with no inputs it's an action you can run."
      : kind === "value" ? "One value, computed once."
      : kind === "type" ? "Cases, each with fields: like an enum whose cases carry data."
      : kind === "interface" ? "Operations a type can have, like Trig's sin and cos: written once for any type a, and each type that implements it says what they do there. Uses resolve to that type's definitions before running."
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
  // The program's comment, as a definition has one: what it is, and whose
  // code or ideas it uses, links as links.
  const shown = noteView(noteOf(doc));
  if (shown) out.append(shown);
  const ta = h("textarea", { id: "f-program-comment", rows: "4", placeholder: "What this program is. Whose code it adapts or whose idea it follows: who, and a link." }) as HTMLTextAreaElement;
  ta.value = noteOf(doc);
  ta.addEventListener("change", () => { if (ta.value !== noteOf(doc)) setComment(PROGRAM, ta.value); });
  out.append(h("label", { class: "field", for: "f-program-comment" }, h("span", {}, "Comment · comments.json"), ta));
  return out;
}

// A comment shown as text, a paragraph a line, links as links.
function noteView(text: string): HTMLElement | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const linked = (line: string) => line.split(/(https?:\/\/[^\s]+[^\s.,;:)])/).map((part, i) =>
    i % 2 ? h("a", { href: part, target: "_blank", rel: "noopener" }, part.replace(/^https?:\/\//, "").replace(/\/$/, "")) : part);
  return h("div", { class: "note" }, ...lines.map((l) => h("p", {}, ...linked(l))));
}

// The graph, with any calls shown inline. Their copies are a view, so every
// edit that would land in one is refused with where to make it instead.
let view: InlineView | null = null;
// The graph last drawn, so the menu can ask it to tidy.
let graph: GraphView | null = null;
// Nodes to bring on screen once the next render has drawn them: what an
// edit just put somewhere the window may not reach.
let revealNext: ((id: Id) => boolean) | null = null;
const WHOLE = () => true;
function revealDrawn() {
  if (!revealNext) return;
  // After the frame, so the graph drawn last (a gesture may render twice)
  // has its size.
  requestAnimationFrame(() => {
    const want = revealNext, g = graph;
    revealNext = null;
    if (want && g) g.reveal(want === WHOLE ? [g.world] : [...g.world.querySelectorAll("[data-id]")].filter((e) => want(e.getAttribute("data-id")!)));
  });
}
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
    addDot: (slot, at) => { if (!viewOnly(slot)) hooks.addDot(slot, at); },
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

// Every value of the definition (its inputs and its steps' dots) as let and
// get nodes, or every one as wires (BACKLOG E112). A view.
const bindersOf = (d: Id) => subtree(doc.code, d).filter((b) => node(b)?.kind === "binder" && pres().names[b] !== "_");
function allNamed(on: boolean) {
  const bs = new Set(bindersOf(ui.def)), now = doc.layout.named ?? [];
  commit({ layout: { ...doc.layout, named: on ? [...new Set([...now, ...bs])] : now.filter((b) => !bs.has(b)) } }, ["layout.json"],
    on ? "Every value is a let node, with a get node at each use. Same program, another look: only layout.json changed."
      : "Every value is wires again, from where it's bound to every use. Only layout.json changed.");
}

// Picked nodes grouped into a frame of their own, folded into one box, or
// the group taken away: a view (BACKLOG E111). The graph draws a group only
// when everything in it is in one frame.
function groupable(picked: Id[]): string | undefined {
  const frameOf = (id: Id): Id | null | undefined => graph?.frameOf(id);
  const where = picked.map(frameOf);
  return where.some((w) => w === undefined || w !== where[0]) ? "pick nodes inside one frame" : undefined;
}

function groupPicked(picked: Id[]) {
  if (picked.length < 2 || groupable(picked)) return;
  const g = `group-${freshId()}`;
  graph?.unpickAll();
  commit({ layout: { ...doc.layout, groups: { ...(doc.layout.groups ?? {}), [g]: picked }, folded: [...(doc.layout.folded ?? []), g] } }, ["layout.json"],
    `Grouped ${picked.length} into one box, which names what it holds; wires in end on its left, values out leave on its right. Unfold it (▸) to see them in their frame, or Ungroup from its menu. Only layout.json changed.`);
}

function ungroup(g: Id) {
  const { [g]: _, ...groups } = doc.layout.groups ?? {};
  commit({ layout: { ...doc.layout, groups, folded: (doc.layout.folded ?? []).filter((x) => x !== g) } }, ["layout.json"], "Ungrouped: what it held stays where it was. Only layout.json changed.");
}

// A frame drawn folded into one box, or open. A view.
function toggleFolded(f: Id) {
  const now = doc.layout.folded ?? [];
  const on = now.includes(f);
  // Unfolded where it was dragged, it makes room instead of landing on others.
  const room = on ? graph?.room(f) ?? {} : {};
  const at = Object.keys(room).length ? { at: { ...(doc.layout.at ?? {}), ...Object.fromEntries(Object.entries(room).map(([k, v]) => [lkey(k), v])) } } : {};
  commit({ layout: { ...doc.layout, ...at, folded: on ? now.filter((x) => x !== f) : [...now, f] } }, ["layout.json"],
    on ? Object.keys(at).length ? "Unfolded, a little way off: where the box was, the frame would have covered other nodes. Only layout.json changed."
      : "Unfolded: what the frame holds is back where it was. Only layout.json changed."
      : "Folded into one box: wires in end on its left, values out leave on its right. Click ▸ to unfold. Only layout.json changed.");
}

// ---------------------------------------------------------------- the graph's menu
//
// Right-click in the graph: what you can do right there. On a hole, the
// same palette as the side panel; on empty space, add a value; on a node,
// a binding or a frame, what applies to it. Tidying and putting nodes
// back only change layout.json.

function graphMenu(info: T.Info): HTMLElement | null {
  const m = ui.menu;
  if (!m) return null;
  const { kind, id } = m.target;
  const picked = graph?.picked() ?? [];
  const inGraph = !m.blocks;
  // What an item does, or why it can't, is written under it: a tooltip
  // never shows on a greyed item, nor on a phone.
  const item = (label: string, act: string, hint = "", disabled?: string) =>
    h("button", { class: "ctx-item", type: "button", role: "menuitem", "data-menu": act, "data-target": id, disabled: !!disabled },
      label, disabled || hint ? h("span", { class: `ctx-why${disabled ? " cant" : ""}` }, disabled ? `Can't: ${disabled}` : hint) : null);
  const rows: (HTMLElement | null)[] = [];
  const names = typedPres().names;
  const head = (t: string) => h("div", { class: "ctx-head" }, t);
  // A step of an action, by its node or its numbered dot: its place in
  // the order, as the panel's Order of steps.
  const stepRows = (at: Id) => {
    const v = stepAt(at), body = defBody(ui.def);
    const earlier = Top.moveStep(doc.code, doc.names.short, v, -1), later = Top.moveStep(doc.code, doc.names.short, v, 1);
    const isStep = (r: Top.Top) => r.ok || !/isn't a step/.test(r.reason);
    if (!isStep(earlier) || body?.kind !== "lambda" || body.params.length) return [];
    return [item("Do it earlier", "step-earlier", "Swap it with the step before", earlier.ok ? undefined : earlier.reason), item("Do it later", "step-later", "Swap it with the step after", later.ok ? undefined : later.reason)];
  };
  if (kind === "hole" && id) {
    rows.push(fillPalette(id, info, names, "m-query"));
  } else if (kind === "space") {
    const r = T.addStep(doc.code, doc.names.short, info, ui.def);
    rows.push(inGraph ? item("Add a value here…", "add", "A new loose value (a hole to fill) here: fill it, then drag its output onto an input")
      : item("Add a value at the start…", "add", "A new named value (a hole to fill) as the definition's first step: fill it, then use it by name", r.ok ? undefined : r.reason));
  } else if (kind === "binder" && id) {
    const on = (doc.layout.named ?? []).includes(id);
    rows.push(head(names[id] ?? "a value"));
    if (names[id] !== "_" && inGraph) rows.push(item(on ? "Show as wires" : "Show as let and get nodes", "named", on ? "Wires from here to every use" : "A let node here and a small get node at every use, instead of long wires"));
    rows.push(item("Name it…", "name"));
    rows.push(...stepRows(id));
    if (T.isDot(doc.code, ui.def, id) && inGraph) rows.push(item(picked.includes(id) ? "Unpick" : "Pick", "pick", "A picked dot drags to move, not to wire (alt-drag does the same)"));
    if (T.isDot(doc.code, ui.def, id)) { const r = T.removeDot(doc.code, doc.names.short, info, ui.def, id); rows.push(item("Remove the dot", "undot", "Put the value back on its one wire", r.ok ? undefined : r.reason)); }
  } else if ((kind === "node" || kind === "frame") && id) {
    const d = calleeDef(id);
    if (d && d !== ui.def) rows.push(item(`Open ${new Namer(doc.code, typedPres(), d).name(d)}`, "goto"));
    const code = view?.code ?? doc.code;
    if (kind === "frame") rows.push((doc.layout.folded ?? []).includes(id) ? item("Unfold", "fold", "Show what it holds again") : item("Fold into one box", "fold", "Hide what it holds; its wires in and out stay"));
    if (inlinable(code, id)) rows.push(item((doc.layout.inline ?? []).includes(id) ? "Collapse" : "Show inline", "inline", "Draw the call as the definition's body, in place. A view only."));
    const dot = T.addDot(doc.code, doc.names.short, info, ui.def, id);
    if (kind === "node") rows.push(item("Put a dot on its wire", "dot", "Share this value: a dot you can wire to other inputs", dot.ok ? undefined : dot.reason));
    if (kind === "node") { const r = T.addStep(doc.code, doc.names.short, info, ui.def, id); rows.push(item("Add a value before this…", "add-before", "A new named value (a hole to fill) worked out just before this, so this can use it. Inside a match, only in that arm", r.ok ? undefined : r.reason)); }
    // Its place in a list, or among a + b + c's inputs.
    const inRow = T.rowOfItem(doc.code, id), own = T.rowAt(doc.code, id);
    if (inRow) {
      const w = inRow.row.kind === "list" ? "item" : "input", last = inRow.at === inRow.row.items.length - 1;
      rows.push(item(`Add an ${w} after this…`, "row-after", "A new hole just after it, to fill"),
        item("Move it earlier", "row-earlier", "Swap it with the one before", inRow.at ? undefined : "it's first already"),
        item("Move it later", "row-later", "Swap it with the one after", last ? "it's last already" : undefined),
        item(`Take it out of the ${inRow.row.kind === "list" ? "list" : "call"}`, "row-out", "The rest close up"));
    }
    if (own) rows.push(item(`Add ${own.kind === "list" ? "an item" : "an input"} at the end…`, "row-end", "A new hole at the end, to fill"));
    if (doc.code.nodes[id] && doc.code.nodes[id].kind !== "hole" && !doc.code.defs.includes(id)) rows.push(item("Replace with…", "replace", "Pick what goes here instead, from the palette"));
    if (wrappable(id)) rows.push(item("Wrap in…", "wrap", "Put it inside a call or a function from the palette: it becomes one of its inputs"));
    if (doc.code.nodes[id] && doc.code.nodes[id].kind !== "hole") rows.push(item("Clear it (leave a hole)", "clear", "A hole of the same type stays in its place"));
    if (doc.code.nodes[id] && doc.code.nodes[id].kind !== "hole") rows.push(item("Delete it", "delete", "Only this node: a hole stays in its place, and what's wired into it is kept, loose"));
    const n = doc.code.nodes[id];
    if (n?.kind === "call" && doc.code.nodes[n.fn].kind !== "lambda") rows.push(item("Change the function…", "swap", "Keep its inputs and pick another function that takes them"));
    if (kind === "node") rows.push(...stepRows(id));
    if (kind === "node" && T.simplify(doc.code, doc.names.short, info, id)?.ok) rows.push(item("Simplify", "simplify", "The same meaning, written shorter: one list instead of append"));
    if (kind === "frame") rows.push(item("Tidy what's inside", "tidy-frame", "Space out the nodes in this frame"));
    if (kind === "node" && n?.kind === "match" && (doc.layout.tree ?? []).includes(id)) rows.push(item("Draw as rows of patterns", "tree", "One row per case, however deep: [date, account, cents, memo], as the text reads it"));
    else if (kind === "node" && n?.kind === "match" && flattened(matchRows(doc.code, info, n))) rows.push(item("Draw as nested matches", "tree", "The decision tree as it is stored: one match per level, to see the order it decides in"));
    if (kind === "frame" && doc.layout.groups?.[id]) rows.push(item("Ungroup", "ungroup", "Take the frame away: what it holds stays where it is"));
    if (inGraph) rows.push(item("Back to the automatic place", "reset-one", picked.length > 1 ? "Forget where the picked nodes were dragged: back where Tidy everything puts them" : "Forget where it was dragged: back where Tidy everything puts it"));
    if (inGraph) rows.push(item(picked.includes(id) ? "Unpick" : "Pick", "pick", "Mark it, to move and tidy it together with other marked nodes (shift-click does the same)"));
  }
  if (kind !== "hole" && inGraph) {
    rows.push(h("div", { class: "ctx-sep" }));
    if (picked.length > 1) rows.push(item(`Tidy the ${picked.length} picked`, "tidy-picked", "Space out only the picked nodes: no overlaps, off the wires"));
    if (picked.length > 1) rows.push(item(`Group the ${picked.length} picked into one box`, "group-picked", "A frame around them, folded: one box naming what it holds. A view only; unfold or ungroup it from its menu", groupable(picked)));
    const bs = bindersOf(ui.def), allOn = bs.length > 0 && bs.every((b) => (doc.layout.named ?? []).includes(b));
    rows.push(allOn ? item("Show every value as wires", "named-none", "Wires from each let to every use, instead of let and get nodes")
      : item("Show every value as let and get nodes", "named-all", "A let node where each value is bound and a small get node at each use: no long wires", bs.length ? undefined : "it has no values to show"));
    rows.push(item("Tidy everything", "tidy-all", "Lay it all out afresh, the same every time: columns from the inputs to the result, each call's inputs in the order of its ports, folded frames as one box"));
    rows.push(item("Fit", "fit", "Zoom so the whole definition shows"));
  }
  // Kept on the screen: at most as tall as its CSS lets it be (440px, then it scrolls).
  const tall = kind === "hole" ? 420 : Math.min(440, 16 + rows.length * 58);
  const left = Math.max(8, Math.min(m.x + 10, window.innerWidth - 330)), top = Math.max(8, Math.min(m.y + 10, window.innerHeight - tall - 8));
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
    case "add": case "add-before": {
      // On the graph's canvas a new value is a loose part, where you clicked
      // (NODE-EDITOR.md "Loose parts", rule 7): no step, no name.
      if (act === "add" && m && !m.blocks) {
        const x = newLoose(doc.code, doc.loose ?? {}, ui.def);
        ui.selected = x.hole;
        revealNext = (id) => id === x.hole || id === x.def;
        commit({ code: x.code, loose: x.of, home: doc.home ?? {}, layout: { ...doc.layout, at: { ...(doc.layout.at ?? {}), [lkey(x.def)]: { x: Math.round(m.world.x), y: Math.round(m.world.y) } } } },
          ["drafts.json", "layout.json"], "Added a loose value: fill its hole, then drag its output onto an input. Until then it's kept apart, in drafts.json.");
        return paletteFor(x.hole, m);
      }
      const r = T.addStep(doc.code, doc.names.short, info, ui.def, act === "add-before" ? target : undefined);
      if (!r.ok || !m) return void applyT(r);
      const hole = r.select!, w = m.world;
      ui.selected = hole;
      revealNext = (id) => id === hole || id === r.dot;
      // From the graph's canvas the new node sits where you clicked; from
      // the blocks it has no place to keep, so the layout places it.
      const placed = m.blocks ? doc.layout : { ...doc.layout, at: { ...(doc.layout.at ?? {}), [lkey(hole)]: { x: Math.round(w.x), y: Math.round(w.y) }, [lkey(r.dot!)]: { x: Math.round(w.x) + 110, y: Math.round(w.y) + 6 } } };
      commit({ code: r.code, names: { ...doc.names, short: r.names }, layout: placed },
        ["code.json", "names.short.json", ...(placed === doc.layout ? [] : ["layout.json"])], m.blocks ? `Added a value ${act === "add" ? "as the first step" : "just before this"}: fill its hole, then use it by name.` : r.note);
      return paletteFor(hole, m);
    }
    case "named": return toggleNamed(target!);
    case "named-all": return allNamed(true);
    case "named-none": return allNamed(false);
    case "fold": return toggleFolded(target!);
    case "name": { select(target!); document.getElementById("f-name")?.focus(); return; }
    case "undot": return void applyT(T.removeDot(doc.code, doc.names.short, info, ui.def, target!));
    case "goto": { const d = calleeDef(target!); if (d) openDef(d); return; }
    case "inline": return toggleInline(target!);
    case "dot": return void applyT(T.addDot(doc.code, doc.names.short, info, ui.def, target!));
    case "clear": return void applyT(T.toHole(doc.code, doc.names.short, info, target!));
    case "step-earlier": case "step-later": return runTop(info, Top.moveStep(doc.code, doc.names.short, stepAt(target!), act === "step-earlier" ? -1 : 1));
    case "simplify": return void applyT(T.simplify(doc.code, doc.names.short, info, target!) ?? { ok: false, reason: "nothing to simplify" });
    case "delete": return void applyT(T.deleteOne(doc.code, doc.names.short, info, ui.def, doc.loose ?? {}, doc.home ?? {}, target!));
    case "wrap": {
      const kept = doc.code;
      const r = T.toHole(doc.code, doc.names.short, info, target!);
      if (!applyT(r.ok ? { ...r, note: "Pick what to wrap it in: a call takes it as one of its inputs, a new function as its body. Undo puts it back." } : r)) return;
      swapped = { hole: target!, at: undo.length };
      wrapping = { hole: target!, kept, info };
      if (m) { ui.menu = { ...m, target: { kind: "hole", id: target! } }; render(); document.getElementById("m-query")?.focus(); }
      else { ui.selected = target!; render(); document.getElementById("f-query")?.focus(); }
      return;
    }
    case "swap": case "replace": {
      // Change the function: the function becomes a hole and the inputs stay
      // where they are, so the palette offers what takes them. Replace with:
      // the part itself becomes the hole, and the palette offers what fits.
      const fn = act === "swap" ? (doc.code.nodes[target!] as NodeOf<"call">).fn : target!;
      const r = T.toHole(doc.code, doc.names.short, info, fn);
      const note = act === "swap" ? "The function is a hole now and its inputs stayed: pick another from the palette." : "Pick what goes here from the palette. Undo puts back what was here.";
      if (!applyT(r.ok ? { ...r, note } : r)) return;
      swapped = { hole: fn, at: undo.length };
      if (m) { ui.menu = { ...m, target: { kind: "hole", id: fn } }; render(); document.getElementById("m-query")?.focus(); }
      // From the call's panel: the hole is selected, so the panel is its palette.
      else { ui.selected = fn; render(); document.getElementById("f-query")?.focus(); }
      return;
    }
    case "row-after": case "row-earlier": case "row-later": case "row-out": case "row-end": {
      const inRow = T.rowOfItem(doc.code, target!), own = T.rowAt(doc.code, target!), sh = doc.names.short;
      const r = act === "row-end" ? own && T.addItem(doc.code, sh, info, own, own.items.length)
        : !inRow ? null
        : act === "row-after" ? T.addItem(doc.code, sh, info, inRow.row, inRow.at + 1)
        : act === "row-out" ? T.removeItem(doc.code, sh, info, inRow.row, inRow.at)
        : T.moveItem(doc.code, sh, info, inRow.row, inRow.at, act === "row-earlier" ? -1 : 1);
      if (!r || !applyT(r)) return;
      // A new item is a hole: its menu is the palette, where the old one was.
      if ((act === "row-after" || act === "row-end") && m && r.ok && r.select) { ui.menu = { ...m, target: { kind: "hole", id: r.select } }; render(); document.getElementById("m-query")?.focus(); }
      return;
    }
    case "pick": { graph?.pick(target!); ui.menu = null; return render(); }
    case "tidy-all": return graph?.tidy(null);
    case "tidy-picked": return graph?.tidy(graph.picked());
    case "group-picked": return groupPicked(graph?.picked() ?? []);
    case "ungroup": return ungroup(target!);
    case "tree": {
      const now = doc.layout.tree ?? [], on = now.includes(target!);
      return commit({ layout: { ...doc.layout, tree: on ? now.filter((x) => x !== target) : [...now, target!] } }, ["layout.json"],
        on ? "Drawn as rows of patterns, as the text reads it. Only layout.json changed." : "Drawn as the nested matches it is stored as. Only layout.json changed.");
    }
    case "tidy-frame": return graph?.tidy([target!]);
    case "reset-one": { const p = graph?.picked() ?? []; return forget(p.length > 1 ? graph!.expand(p) : graph?.expand([target!]) ?? [target!]); }
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
  // The whole graph, which grows (or shrinks) by the callee's body.
  revealNext = WHOLE;
  commit({ layout: { ...doc.layout, inline } }, ["layout.json"],
    on ? "Collapsed the call. Only layout.json changed." : "Showing the definition inline: the call is drawn as its body, with the arguments flowing into its inputs. It's a view: layout.json changed, code.json didn't.");
}

// The loose part `id` stands for: the part itself, or the node that is its
// result (what its frame's end is wired from).
function loosePart(id: Id): Id | undefined {
  const of = doc.loose ?? {};
  if (of[id]) return id;
  return Object.keys(of).find((d) => {
    const b = (node(d) as NodeOf<"def"> | undefined)?.body, n = b ? node(b) : undefined;
    return (n?.kind === "lambda" ? n.body : b) === id;
  });
}

// A drop on an input wires it, and a value already there is set loose.
const useOver = (info: T.Info, b: Id, slot: Id) =>
  T.over(doc.code, doc.names.short, info, ui.def, doc.loose ?? {}, doc.home ?? {}, slot, b, (c, n, i) => T.useVar(c, n, i, ui.def, b, slot));
const shareOver = (info: T.Info, from: Id, slot: Id) =>
  T.over(doc.code, doc.names.short, info, ui.def, doc.loose ?? {}, doc.home ?? {}, slot, from, (c, n, i) => T.share(c, n, i, ui.def, from, slot));

function graphHooks(info: T.Info) {
  return {
    selected: ui.selected,
    select: (id: Id | null) => select(id),
    open: (id: Id) => { const d = calleeDef(id); if (d && d !== ui.def) openDef(d); },
    canUse: (b: Id, slot: Id) => { const r = useOver(info, b, slot); return r.ok ? null : r.reason; },
    use: (b: Id, slot: Id) => void applyT(useOver(info, b, slot)),
    clear: (slot: Id) => void applyT(T.unwire(doc.code, doc.names.short, info, ui.def, doc.loose ?? {}, doc.home ?? {}, slot)),
    // A dot put on a wire by a click sits where you clicked, and nothing
    // else moves (BACKLOG E109).
    addDot: (slot: Id, at?: { dot: Pos; keep: Record<Id, Pos> }) => {
      const e = T.addDot(doc.code, doc.names.short, info, ui.def, slot);
      void applyT(e, undefined, at && e.ok && e.select ? { ...at.keep, [e.select]: at.dot } : undefined);
    },
    canShare: (from: Id) => {
      // A loose part goes into an empty input, by its frame's end or by its
      // own last node's output (BACKLOG E120).
      const part = loosePart(from);
      if (part) return (slot: Id) => {
        if (node(slot)?.kind !== "hole") return "drop it on an empty input";
        const r = T.wireLoose(doc.code, doc.names.short, info, ui.def, doc.loose ?? {}, doc.home ?? {}, part, slot);
        return r.ok ? null : r.reason;
      };
      const p = T.prepareShare(doc.code, doc.names.short, info, ui.def, from);
      if ("reason" in p) return () => p.reason;
      return (slot: Id) => {
        if (slot === from) return "that's where it already goes";
        // A filled input: the check is the same drop on the hole it leaves.
        const r = node(slot)?.kind === "hole" ? T.useVar(p.code, p.names, p.info, ui.def, p.dot, slot) : shareOver(info, from, slot);
        return r.ok ? null : r.reason;
      };
    },
    share: (from: Id, slot: Id) => {
      const part = loosePart(from);
      void applyT(part
        ? T.wireLoose(doc.code, doc.names.short, info, ui.def, doc.loose ?? {}, doc.home ?? {}, part, slot)
        : shareOver(info, from, slot));
    },
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
    loose: looseOf(doc.code, doc.loose ?? {}, ui.def),
    home: doc.home ?? {},
    folded: new Set(doc.layout.folded ?? []),
    fold: toggleFolded,
    groups: doc.layout.groups,
    tree: new Set(doc.layout.tree ?? []),
    menu: (target: MenuTarget, at: Pos, world: Pos) => { ui.menu = { target, x: at.x, y: at.y, world }; ui.query = ""; render(); document.getElementById("m-query")?.focus(); },
    reorder: (item: Id, onto: Id) => {
      const a = T.rowOfItem(doc.code, item), b = T.rowOfItem(doc.code, onto);
      if (a && b && a.row.root === b.row.root) applyT(T.moveItemTo(doc.code, doc.names.short, info, a.row, a.at, b.at));
    },
    addFrom: (row: Id, from: Id, binding: boolean) => { const r = T.rowAt(doc.code, row); if (r) applyT(T.addItemFrom(doc.code, doc.names.short, info, ui.def, r, from, binding)); },
    addItem: (row: Id) => { const r = T.rowAt(doc.code, row); if (r && applyT(T.addItem(doc.code, doc.names.short, info, r, r.items.length))) document.getElementById("f-query")?.focus(); },
  };
}

// A value as the Run panel shows it. A map or a set is a table, a row per
// entry in key order, as the blocks draw one written out
// (DATA-STRUCTURES.md); anything else is its text.
function valueView(v: Value): HTMLElement {
  const text = (x: Value) => h("code", {}, showValue(x, doc.code, pres().names));
  const tag = typeof v === "object" && v !== null && "tag" in v ? v.tag : null;
  if ((tag === MAP_V || tag === SET_V) && fromList((v as { fields: Value[] }).fields[0]).length) {
    const rows = fromList((v as { fields: Value[] }).fields[0]).map((e) => (tag === MAP_V ? (e as { fields: Value[] }).fields : [e]));
    return h("table", { class: "vtable" }, ...rows.map((cells) => h("tr", {}, ...cells.map((c) => h("td", {}, text(c))))));
  }
  return text(v);
}

function typedRunPanel(namer: Namer, info: T.Info): HTMLElement {
  const box = h("div", { class: "run" });
  const t = info.typeOf.get(ui.def);
  const z = t ? info.subst.zonk(t) : null;
  const action = z?.t === "fn" && z.params.length === 0;
  // A value (no inputs, not a function) runs like an action: asked for,
  // then its result and the values on its wires show.
  const value = !!z && z.t !== "fn";
  const body = defBody(ui.def);
  if (!body || body.kind === "typedef") return h("p", { class: "hint" }, body?.kind === "typedef" && body.effect ? "An effect doesn't run; functions perform its operations, and a handler answers them." : "A data type doesn't run; its constructors are called from functions.");
  // An action that performs an effect nothing answers yet runs only inside
  // a handler: say where, instead of a Run that can only fail.
  const needs = action ? needsHandling(z).filter((e) => e !== CHOICE) : [];
  // One that may give no answer, or several, runs inside what picks: Run
  // would only say so after the fact. Its values still show, the first
  // answer's.
  const choice = action && needsHandling(z).includes(CHOICE);
  // A page's main is the page: it is running above, and printing what it
  // gives back would only show the page's insides.
  if (action && !errorsIn(info) && !holesIn(info) && pageMain(ownDefs(), info, pres().names) === ui.def) {
    box.append(h("p", { class: "hint" }, `${namer.name(ui.def)} is the page above: it runs there, and Restart runs it again from the start.`));
  } else if (needs.length) {
    const effs = needs.map((e) => pres().names[e] ?? e).join(" and ");
    box.append(h("p", { class: "hint" }, `${namer.name(ui.def)} performs ${effs}, and nothing here answers it. To run it, call it inside `, h("code", {}, `handle ${effs}`), "."));
  } else if (choice) {
    box.append(h("p", { class: "hint" }, `${namer.name(ui.def)} may give no answer, or more than one (Choice), so it doesn't run as it is. To run it, say which you want: call it inside `,
      h("code", {}, "first(…, else …)"), ", ", h("code", {}, "all"), ", ", h("code", {}, "count"), " or ", h("code", {}, "optional"), "."));
  } else if (action) {
    const going = ui.output?.def === ui.def && ui.output.running;
    box.append(going ? h("button", { class: "btn", type: "button", "data-act": "t-stop" }, `Stop ${namer.name(ui.def)}`)
      : h("button", { class: "btn", type: "button", "data-act": "t-run" }, `Run ${namer.name(ui.def)}`));
    if (ui.output?.def === ui.def) {
      box.append(h("pre", { class: "text out" }, ui.output.lines.join("\n") || (going ? "Running…" : "(no output)")));
      if (ui.output.error) box.append(h("p", { class: "status-line bad" }, ui.output.error));
    }
  } else if (z?.t === "fn") box.append(backwardsPanel(namer, info));
  // Values on the wires: a function shows them for the values above; an
  // action, once you ask (it may take a while, and its printing is left out).
  const ex = doc.examples?.[ui.def];
  const tr = traced(info);
  if ((action || value) && !needs.length) box.append(h("div", { class: "acts" },
    h("button", { class: "btn", type: "button", "data-act": "t-values", title: "Run it and show what every node made, printing left out" }, ex ? "Update values" : "Show values"),
    ex ? h("button", { class: "btn", type: "button", "data-act": "t-novalues" }, "Hide values") : null));
  else if (z?.t === "fn") box.append(h("p", { class: "hint" }, ex ? "The graph shows what every node makes of these values. They're saved in examples.json, not in the code."
    : "The graph shows what every node makes of these values. Change one to keep values of your own, in examples.json, not in the code."));
  if (tr?.result !== undefined && (action || value)) box.append(h("div", { class: "hint" }, choice ? "Its first answer: " : "Gives ", valueView(tr.result)));
  // A hole isn't a failure: it is where the program isn't written yet.
  // Nor is a run on values you didn't give: they're only a starting point.
  if (tr?.error) box.append(tr.error.message === "reached a hole"
    ? h("p", { class: "hint" }, "Values show once the holes on their way are filled.")
    : !doc.examples?.[ui.def] ? h("p", { class: "hint" }, `No values on the wires: ${tr.error.message}.`)
    : h("p", { class: "status-line bad" }, `Values stopped: ${tr.error.message}.`));
  return box;
}

// A program with a colour, or a red, green and blue, of (x, y, time) is a
// picture (editor/picture.ts): drawn live on the GPU above Run, and drawn
// again after every edit. When the compiler can't take it to the GPU, its
// reason shows instead. The canvas outlives renders, so the drawing goes on.
const pic = { canvas: h("canvas", { class: "picture" }) as HTMLCanvasElement, status: h("p", { class: "hint pic-status" }), for: null as Code | null, now: null as Picture | null };
const picNote = h("div", {});
const picBox = h("div", { class: "picture-box" }, picNote, pic.canvas, pic.status);
function pictureSection(info: T.Info | null): HTMLElement | null {
  const entries = pictureEntries(ownDefs(), pres().names);
  if (!entries || !info) { pic.now?.stop(); pic.now = null; pic.for = null; return null; }
  picNote.replaceChildren(noteView(noteOf(doc)) ?? "");
  if (pic.for !== prog()) {
    const code = pic.for = prog();
    pic.now?.stop();
    pic.now = null;
    pic.canvas.hidden = false;
    pic.status.textContent = "Drawing…";
    const shown = (e: unknown) => { pic.canvas.hidden = true; pic.status.textContent = `Can't draw the picture: ${e instanceof Error ? e.message : String(e)}.`; };
    if (errorsIn(info)) shown(new Error("the program has errors; fix them first"));
    else drawPicture({ code, info, names: pres().names, entries, canvas: pic.canvas, status: pic.status })
      .then((p) => { if (pic.for === code) pic.now = p; else p.stop(); },
        (e) => { if (pic.for === code) shown(holesIn(info) ? new Error("the program has holes; fill them first") : e); });
  }
  return picBox;
}

// A program whose main takes nothing and returns an Html is a page
// (WEB.md): shown live above Run, run by the evaluator, and run again from
// the start after every edit. Its own <style> and its body rules need a
// document of their own, so it's drawn in a frame. The editor redraws
// everything on each change, which empties a frame put back in the page, so
// the page's elements are made in a document that outlives renders and are
// put back into the frame each time; their listeners and watchers go with
// them, and what you typed into the page stays.
declare const PAGE_RUNTIME: string; // cli/web.ts pageRuntime, put in by editor/build.ts
declare const WORKLET_RUNTIME: string; // cli/web.ts workletRuntime: a page with sound plays (AUDIO.md)
const page = {
  frame: h("iframe", { class: "page", title: "The page main returns, running" }) as HTMLIFrameElement,
  status: h("p", { class: "hint" }),
  // Where the page's elements are made (adopted into the frame's document).
  maker: document.implementation.createHTMLDocument("page"),
  for: null as Code | null, root: null as globalThis.Node | null, now: null as Preview | null, program: null as Program | null,
  flashBox: h("input", { type: "checkbox" }) as HTMLInputElement,
  // A page with sound: stop everything it plays, whatever its own buttons say.
  hushBtn: h("button", { class: "btn", type: "button", "data-act": "page-hush", title: "Stop every sound this page is playing" }, "Stop sound") as HTMLButtonElement,
};
const sized = new WeakSet<Document>();
const pageBox = h("div", { class: "page-box" }, page.frame, page.status,
  h("div", { class: "acts" },
    page.hushBtn,
    h("button", { class: "btn", type: "button", "data-act": "page-restart", title: "Run main again from the start: every cell back to its first value" }, "Restart"),
    h("label", { class: "hint", title: "Outline each text, attribute or part of the page when it runs again, so you can see that only what read a changed cell does" }, page.flashBox, " Outline updates"),
    h("button", { class: "btn", type: "button", "data-act": "page-tab", title: "The page compiled to JavaScript, in a tab of its own" }, "Open in a tab"),
    h("button", { class: "btn", type: "button", "data-act": "page-save", title: "The page compiled to JavaScript as one HTML file that runs anywhere, like lab build-web" }, "Save page")));
function pageSection(info: T.Info | null): HTMLElement | null {
  const main = info && !errorsIn(info) && !holesIn(info) ? pageMain(ownDefs(), info, pres().names) : null;
  if (!main || !info) { leavePage(); return null; }
  if (page.for !== prog()) {
    leavePage();
    const kept = keptPages.get(doc.program);
    keptPages.delete(doc.program);
    if (kept?.for === prog()) Object.assign(page, kept, { program: doc.program });
    else { kept?.now?.stop(); startPage(info, main); }
  }
  // Chrome drops every event listener in a frame's document when the frame
  // leaves the page, and this redraw takes the frame out and puts it back.
  // So the page goes back to the document that outlives renders first: its
  // buttons keep their handlers.
  if (page.root && page.root.ownerDocument !== page.maker) page.maker.body.append(page.maker.adoptNode(page.root));
  page.hushBtn.hidden = !page.now?.hush;
  // Put back in the frame once the frame is in the page again.
  queueMicrotask(() => {
    const d = page.frame.contentDocument;
    if (!d || !page.root || d.body.contains(page.root)) return;
    // The look a saved page has (page.ts PAGE_BASE), and a frame as tall
    // as the page, up to most of the window; past that it scrolls.
    if (!d.getElementById("lab-base")) d.head.append(Object.assign(d.createElement("style"), { id: "lab-base", textContent: PAGE_BASE }));
    d.body.replaceChildren(page.root);
    if (!sized.has(d)) {
      sized.add(d);
      // What's done on the page is said in the status bar too, as an edit
      // is. Only the bar's text changes: the page is left as it is.
      const say = (note: string) => {
        ui.note = note;
        ui.touched = [];
        ui.refused = false;
        const bar = document.querySelector<HTMLElement>(".status[role=status]");
        if (bar) { bar.textContent = ui.note; bar.className = "status"; }
      };
      d.addEventListener("click", (e) => {
        const b = (e.target as Element).closest?.("button, a, input[type=checkbox]");
        const label = b?.textContent?.trim() || b?.getAttribute("aria-label");
        if (!label) return;
        say(`Clicked “${label}” on the page.`);
      });
      // And what's typed or set in a field, once it's in (Enter, leaving
      // the field, letting go of a slider).
      d.addEventListener("change", (e) => {
        const f = e.target as HTMLInputElement;
        if (!f.matches?.("input:not([type=checkbox]):not([type=button]), textarea, select")) return;
        const name = f.labels?.[0]?.textContent?.trim() || f.getAttribute("aria-label") || f.placeholder || f.name;
        const what = f.value === "" ? "Emptied" : f.type === "range" || f.tagName === "SELECT" ? `Set ${f.value} in` : `Typed ${f.value} in`;
        say(`${what} ${name ? `“${name}”` : "a field"} on the page.`);
      });
      new ResizeObserver(() => { page.frame.style.height = `${Math.min(Math.max(Math.ceil(d.body.getBoundingClientRect().bottom) + 2, 120), Math.round(innerHeight * 0.7))}px`; }).observe(d.body);
    }
  });
  return pageBox;
}

// A page goes on while another program is shown, so coming back finds it
// as it was: its cells, what was typed. An edit to its program starts it
// again, as before.
const keptPages = new Map<Program, { for: Code; root: globalThis.Node | null; now: Preview | null }>();
function leavePage() {
  if (page.for && page.program && page.program !== doc.program) {
    // A page left for another program goes on, but silent: nothing plays
    // from a page that isn't shown.
    page.now?.hush?.();
    // Out of the frame before the frame goes, so its buttons keep their handlers.
    if (page.root && page.root.ownerDocument !== page.maker) page.maker.body.append(page.maker.adoptNode(page.root));
    keptPages.get(page.program)?.now?.stop();
    keptPages.set(page.program, { for: page.for, root: page.root, now: page.now });
  } else page.now?.stop();
  page.now = null;
  page.root = null;
  page.for = null;
}

function startPage(info: T.Info, main: Id) {
  page.now?.stop();
  page.now = null;
  page.root = null;
  page.for = prog();
  page.program = doc.program;
  page.status.textContent = "";
  try {
    page.now = showPage({
      code: prog(), info, names: pres().names, main, program: titleOf(doc),
      doc: page.maker as unknown as PageDoc, store: localStorage, worklet: WORKLET_RUNTIME, recordings: "apps/",
      frame: (f) => requestAnimationFrame(f),
      ran: (n: Node_) => {
        if (!page.flashBox.checked) return;
        const e = (n as unknown as globalThis.Node).nodeType === Node.ELEMENT_NODE ? n as unknown as HTMLElement : (n as unknown as globalThis.Node).parentElement;
        // A part's own element takes no space (display: contents): its children flash.
        for (const x of e?.tagName === "LAB-PART" ? [...e.children] as HTMLElement[] : e ? [e] : []) {
          x.style.outline = "2px solid #e8a33d";
          setTimeout(() => { x.style.outline = ""; }, 400);
        }
      },
    });
    page.root = page.now.root as unknown as globalThis.Node;
  } catch (e) {
    page.status.textContent = `The page stopped: ${e instanceof Error ? e.message : String(e)}.`;
  }
}

// The page compiled (page.ts pageFile): saved, or opened in a tab.
function pageHtml(): { html: string; name: string } | null {
  const info = typesOf();
  const main = info && pageMain(ownDefs(), info, pres().names);
  if (!info || !main) return null;
  return { html: pageFile(titleOf(doc), PAGE_RUNTIME, prog(), info, pres().names, main, WORKLET_RUNTIME), name: `${slug(titleOf(doc))}.html` };
}

function savePage(open: boolean) {
  let made;
  try { made = pageHtml(); } catch (e) { ui.note = `The page couldn't be compiled: ${(e as Error).message}.`; ui.refused = true; render(); return; }
  if (!made) return;
  const url = URL.createObjectURL(new Blob([made.html], { type: "text/html" }));
  if (open) window.open(url, "_blank");
  else {
    const a = document.createElement("a");
    a.href = url;
    a.download = made.name;
    a.click();
    ui.note = `Saved the page as ${made.name}: one HTML file with the program compiled to JavaScript. Open it in any browser, or put it on any web host.`;
    render();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

// The world a run here sees: the browser's, as a page has (files in
// localStorage under the program's name, the clock, randomness, fetching
// that waits for nothing), so Run and values work on a page's definitions.
const editorWorld = () => browserWorld(localStorage, titleOf(doc));
// Values on the wires leave printing out, as the button says.
const quietWorld = () => browserWorld(localStorage, titleOf(doc), { log: () => {}, error: () => {} } as unknown as Console);

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
  // One that reaches the world (prints, writes a file, fetches) runs only
  // when asked (Show values), never just because it's finished being written.
  if (z?.t === "fn" && z.eff.effs.some((e) => e !== CHOICE && e !== DIVERGE) && !doc.examples?.[ui.def]) return null;
  const key = `${ui.def}\u0000${texts.join("\u0000")}`;
  let m = traces.get(doc.code);
  if (!m) traces.set(doc.code, (m = new Map()));
  if (!m.has(key)) {
    const params = (defBody(ui.def) as NodeOf<"lambda">).params;
    const args = texts.map((t, i) => readPort(info, params[i], t));
    m.set(key, args.some((a) => "error" in a) ? { values: new Map(), error: { id: ui.def, message: "a value doesn't read as one" } }
      : trace(doc.code, info, ui.def, args.map((a) => (a as { value: Value }).value), quietWorld()));
  }
  return m.get(key)!;
}

// Run main in a worker (editor/runWorker.ts): the page keeps drawing, the
// printing shows as it comes, and Stop ends it.
declare const RUN_WORKER: string; // editor/runWorker.ts bundled, put in by editor/build.ts
let running: Worker | null = null;
function stopRun(why?: string) {
  running?.terminate();
  running = null;
  if (ui.output?.running) { ui.output = { ...ui.output, running: false, error: why ?? ui.output.error }; render(); }
}
function runTyped() {
  stopRun();
  const def = ui.def, title = titleOf(doc), prefix = `lab:${title}:`;
  const files: [string, string][] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix)) files.push([k, localStorage.getItem(k)!]); } } catch { /* no storage */ }
  const w = (running = new Worker(URL.createObjectURL(new Blob([RUN_WORKER], { type: "text/javascript" }))));
  const ask: RunAsk = { code: prog(), names: pres().names, pins: heldPins?.all ?? doc.signatures ?? NO_PINS, def, title, files };
  ui.output = { def, lines: [], running: true };
  w.onmessage = (e: MessageEvent<RunSays>) => {
    if (running !== w || !ui.output) return;
    const m = e.data;
    if ("lines" in m) { ui.output = { ...ui.output, lines: [...ui.output.lines, ...m.lines] }; render(); return; }
    try { for (const [k, v] of m.files) localStorage.setItem(k, v); } catch { /* no storage */ }
    const lines = "done" in m && m.shown !== "unit" ? [...ui.output.lines, `→ ${m.shown}`] : ui.output.lines;
    ui.output = { def, lines, error: "error" in m ? m.error : undefined, running: false };
    running = null;
    w.terminate();
    render();
  };
  w.onerror = (e) => { e.preventDefault(); stopRun(e.message || "the run failed"); };
  w.postMessage(ask);
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

// On a narrow screen a cycling group shows only its choice, and tapping it
// goes to the next (the top bar then fits without scrolling).
const cycling = (el: HTMLElement) => (el.classList.add("cycle"), el);
function seg(name: string, value: string, options: [string, string][]) {
  return h("div", { class: "seg", role: "group", "aria-label": name },
    ...options.map(([v, label]) => h("button", { type: "button", class: v === value ? "on" : "", "data-set": name, "data-value": v, "aria-pressed": String(v === value) }, label)));
}

// The keyboard back in the program, after an edit made from a field: Tab
// goes on from the part just edited.
function toProgram() {
  const blocks = document.querySelector<HTMLElement>(".blocks-wrap");
  if (blocks) blocks.focus({ preventScroll: true });
  else (document.activeElement as HTMLElement | null)?.blur();
}

// The graph's menu for the selected part, from the keyboard (Shift+F10, the
// Menu key, or Enter on a call), next to where the part is drawn; its first
// item, or the one named, takes the focus. Arrows move through it.
function menuForSelected(focus?: string) {
  const id = ui.selected;
  if (!id) return;
  const el = document.querySelector(`.p-graph svg.canvas [data-id="${id}"]`) ?? document.querySelector(".blocks-wrap .sel");
  const r = el?.getBoundingClientRect() ?? { left: 40, bottom: 40 };
  const blocks = !!el?.closest(".blocks-wrap");
  const kind: MenuTarget["kind"] = blocks ? blocksKind(id) : el?.closest("[data-src]") ? "binder" : el?.closest("[data-frame]") && id !== ui.def ? "frame" : "node";
  ui.menu = { target: { kind, id }, x: r.left, y: r.bottom, world: { x: 0, y: 0 }, blocks };
  ui.query = "";
  render();
  const items = [...document.querySelectorAll<HTMLElement>(".ctx-menu .ctx-item:not(:disabled)")];
  (items.find((b) => b.dataset.menu === focus) ?? items[0])?.focus();
}

// What a part of the Blocks pane is, for its menu.
const blocksKind = (id: Id): MenuTarget["kind"] => {
  const k = doc.code.nodes[id]?.kind;
  return k === "hole" ? "hole" : k === "binder" ? "binder" : "node";
};

// The part of the Blocks pane a click or right-click is on. An operator
// stands for its call, as in the graph, where + is the call's own node.
function blocksHit(t: EventTarget | null): Id | null {
  const hit = (t as HTMLElement | null)?.closest?.<HTMLElement>(".blocks-wrap [data-id]");
  if (!hit) return null;
  const call = hit.classList.contains("op") || hit.classList.contains("head") ? hit.parentElement?.closest<HTMLElement>("[data-id]") : null;
  return (call ?? hit).dataset.id!;
}

function select(id: Id | null) {
  // Re-rendering on a repeat click would detach the element before its
  // dblclick fires, and go-to-definition is a dblclick.
  // One pane at a time: a hole's palette is in the side pane, so show it,
  // also when the hole was selected already (a new program's is).
  const toPalette = !!id && doc.code.nodes[id]?.kind === "hole" && onePane() && ui.pane !== "side";
  if (ui.selected === id) { if (toPalette) { ui.pane = "side"; render(); } return; }
  ui.mode = null; ui.query = "";
  ui.selected = id;
  if (toPalette) ui.pane = "side";
  render();
}

// ---------------------------------------------------------------- guide
//
// Every graph uses the same few things, so they're explained once, each with
// a sample drawn with the graph's own styles. One word per thing, used
// everywhere: if two things look the same, they are the same.

const GUIDE_SEEN = "projectional-guide-seen";
// The guide is a tab in the side column, open on a first visit, so the
// graph keeps its room.
try { if (!localStorage.getItem(GUIDE_SEEN)) { ui.panel = "guide"; localStorage.setItem(GUIDE_SEEN, "1"); } } catch { ui.panel = "guide"; }

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
      "The effects a node has; a definition's type lists them too, between the arrows: (Float64) -[Random]-> Float64. Choice: several answers, or none. Random: draws numbers (die). Time: reads the clock. Abort: stops with a reason. Log: debugging output. Console: reads and prints. Files: reads and writes files. Network: reads from the web. Cells and Update: a page's state. Diverge: might not finish. And effects you declare (+ New definition, Effect). “handles …” marks a node that takes care of one, so it stops there: first or all for Choice, seeded for Random, a handle match for Abort, Log and yours."],
    ["Solve", pic(80, ...box(12, "polar", "cn rel"), svg("circle", { cx: 12, cy: 20, r: 5, class: "inp" }), svg("circle", { cx: 68, cy: 20, r: 6, class: "reroute" })),
      "Any function run backwards: you give it some of its ports (inputs, left) and it works out the rest (dots, right). A function that says true or false, built from equal and and, is a set of equations, so it runs in every direction. Run does the same for the definition you're looking at."],
  ];
  return h("section", { class: "guide", "aria-label": "Guide" },
    h("p", { class: "hint" }, "One program, two views: the graph above and the text below (Blocks, or Steps, Nested and Lisp to read it other ways). Click anything in either to select it: Selected, in this panel, shows its type and what you can do with it. Delete or Clear to a hole leaves a hole (□); a hole's panel lists only what fits there, and you can type a value or arithmetic too: 3, \"hi\", [1, 2], x * 2, (x) => x + 1. Replace with… does both in one step. Copy, Cut and Paste (Ctrl+C, X, V) move whole parts between holes. An item of a list, or one input of a + b + c, can be added beside, moved earlier or later, or taken out from its panel; in the graph, the + under a node's inputs adds one at the end. An action's steps (print this, then that) run top to bottom: in the graph they're numbered in one column with a dashed line from each to the next, and Do it earlier or later, on a step's menu or in its panel, moves one. In the blocks, Tab steps through the parts, Enter edits one, Shift+F10 opens its menu; double-click a name to open its definition."),
    h("p", { class: "hint" }, "While a definition has a hole, its type is kept as it was, so a fill that would change it (one that does Random where it didn't, say) isn't offered. The hole's panel says so; Let it loosen there lets the type follow the body again."),
    h("p", { class: "hint" }, "Run, above, runs main, or the definition you're looking at backwards: tick the ports you know and it works out the rest. Show values writes what each part computes into the graph."),
    h("div", { class: "guide-items" }, ...items.map(([t, p, d]) => h("div", { class: "guide-item" }, p, h("div", {}, h("strong", {}, t), h("p", {}, d))))),
    h("p", { class: "hint" }, "Right-click in the graph for a menu: fill a hole, add a value, tidy, show a binding as let and get nodes. Long wires? Right-click the empty canvas and pick “Show every value as let and get nodes”: each value gets a let node where it's bound and a small get node at each use. Drag a node to move it (that only changes layout.json); shift-click or shift-drag to pick several. Where wires cross, one hops over the other; where one passes under a node, it shows faintly over it. Double-click a node to open the function it calls. Every change goes through the same checks, so if something would break the program, it's refused and the status line says why."),
    h("p", { class: "hint" }, "Delete takes out one node: its place becomes a hole, and whatever was wired into it is kept, loose, in a dashed frame beside the graph and at the end of the text as _1, _2, …. Loose parts are type-checked but never run, and are saved in drafts.json, not code.json. Drag a loose part's output onto an empty input to wire it back in; dragging a wire off an input leaves its value loose too; Delete on a loose part throws it away."),
    h("p", { class: "hint" }, "Where a program adapts someone's code or follows someone's idea, its comments say so: a definition's, or the program's own (in the Program tab, and above a picture). Credits, in the menu, lists every influence and source of the language itself."));
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

// Another program's definitions, by name, so the search finds them too.
const namesOf = new WeakMap<Doc, [Id, string][]>();
function defNames(d: Doc): [Id, string][] {
  let out = namesOf.get(d);
  if (!out) {
    const named = { ...d.names.short, ...(ui.layer === "descriptive" ? d.names.descriptive : {}) };
    out = d.code.defs.filter((x) => { const n = d.code.nodes[x]; return !BASE.nodes[x] && n?.kind === "def" && n.body; }).map((x): [Id, string] => [x, named[x] ?? x]);
    namesOf.set(d, out);
  }
  return out;
}
// An example not opened yet is read as shipped, without saving it.
const shipped = new Map<Program, Doc>();
const otherDoc = (k: Program) => docs[k] ?? (isExample(k) ? shipped.get(k) ?? shipped.set(k, initialFor(k)).get(k)! : null);

function navigator(p: Presentation) {
  const row = (attrs: Record<string, string>, on: boolean, ...kids: Kid[]) =>
    h("button", { type: "button", class: `nav-row${on ? " on" : ""}`, "aria-current": on ? "true" : "false", ...attrs }, ...kids);
  const defs = ownDefs().filter((d) => defBody(d));
  const list = h("div", { class: "nav-list" });
  for (const [k, label] of programList()) {
    list.append(row({ "data-set": "program", "data-value": k }, false, label));
    // Shown only while a search matches them: another program's definitions.
    if (k !== doc.program) {
      const other = otherDoc(k);
      if (other) list.append(h("div", { class: "nav-defs found", role: "group", "aria-label": `Definitions in ${label}` },
        ...defNames(other).map(([d, name]) => row({ "data-goto": d, "data-program": k, hidden: "" }, false, name))));
      continue;
    }
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
    for (const r of list.querySelectorAll<HTMLElement>(".nav-row")) {
      const hit = r.textContent!.toLowerCase().includes(q);
      r.hidden = r.dataset.goto ? !q || !hit : !!q && !r.classList.contains("open") && !hit && !r.dataset.act;
    }
    // A program shows while one of its definitions is found.
    for (const g of list.querySelectorAll<HTMLElement>(".nav-defs.found"))
      if (g.querySelector(".nav-row:not([hidden])")) (g.previousElementSibling as HTMLElement).hidden = false;
  };
  find.addEventListener("input", filter);
  find.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { find.value = ""; filter(); }
    const first = (sel: string) => list.querySelector<HTMLElement>(`${sel}:not([hidden]):not([data-act])`);
    const r = e.key === "Enter" ? first(".nav-defs:not(.found) .nav-row") ?? first(".nav-defs.found .nav-row") ?? first(".nav-row:not(.open)") : null;
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
const MAX_TABS = 6;
// Open tabs, most recently shown first.
let seen: Id[] = [];

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
// Whatever selects something (a click, a menu's edit, a new program's
// hole) shows it: the side column leaves the Guide for the Selected tab.
let shownSelected: Id | null = null;
function render() {
  if (ui.selected && ui.selected !== shownSelected && ui.panel === "guide") ui.panel = "node";
  shownSelected = ui.selected;
  try { draw(); revealDrawn(); } catch (e) {
    console.error(e);
    document.getElementById("app")!.replaceChildren(
      h("header", { class: "bar" }, h("div", { class: "controls" },
        seg("program", doc.program, [...EXAMPLES, ...Object.values({ ...docs, [doc.program]: doc }).filter((d) => d.program.startsWith(MINE)).map((d): [string, string] => [d.program, titleOf(d)])]),
        h("div", { class: "seg history" },
          h("button", { type: "button", "data-act": "undo", disabled: !undo.length && !deleted }, "Undo"),
          h("button", { type: "button", "data-act": "reset", disabled: !isExample(doc.program) }, "Reset")))),
      h("p", { class: "status refused", role: "status" }, `The editor failed to draw this program (${e instanceof Error ? e.message : String(e)}). It's a bug in the editor, not your program: Undo, Reset to the example, or open another program.`));
  }
}

const SCROLLERS = [".graph-wrap", ".p-text .body", ".blocks-wrap", ".side", ".nav-list"];

function draw() {
  const app = document.getElementById("app")!;
  const p = pres();
  const namer = new Namer(doc.code, p, ui.def);
  // Everything that scrolls keeps its place across a redraw, so a click that
  // only changes the selection leaves the text where it was.
  const scroll = SCROLLERS.map((q) => [...document.querySelectorAll(q)].map((g) => [g.scrollLeft, g.scrollTop]));
  const focused = document.activeElement?.id;
  const info = typesOf();
  if (!info) { app.replaceChildren(h("p", { class: "status refused" }, "This program can't be type-checked. Undo, or Reset to the example.")); return; }
  T.setDisplayNames(p.names);

  // Open definitions are tabs; the one shown is always among them. Past
  // MAX_TABS, opening one closes the one looked at longest ago, so the strip
  // fits its pane instead of running off it.
  ui.tabs = ui.tabs.filter((d) => defBody(d));
  if (!ui.tabs.includes(ui.def)) ui.tabs.splice(Math.min(ui.tabs.length, openAt + 1), 0, ui.def);
  seen = [ui.def, ...seen.filter((d) => d !== ui.def && ui.tabs.includes(d))];
  if (ui.tabs.length > MAX_TABS) { const keep = new Set(seen.slice(0, MAX_TABS)); ui.tabs = ui.tabs.filter((d) => keep.has(d)); }
  openAt = ui.tabs.indexOf(ui.def);
  const tab = (d: Id) => h("div", { class: `tab${d === ui.def ? " on" : ""}` },
    h("button", { type: "button", class: "t-open", "data-tab": d, title: namer.name(d), "aria-current": d === ui.def ? "true" : "false" }, namer.name(d)),
    ui.tabs.length > 1 ? h("button", { type: "button", class: "t-close", "data-close-tab": d, "aria-label": `Close ${namer.name(d)}` }, "×") : null);
  const textView = ui.text === "blocks"
    ? h("div", { class: "blocks-wrap", tabindex: "0", "aria-label": "The program: Tab steps through its parts, Enter edits one, Shift+F10 or the Menu key opens its menu" }, T.renderTyped(doc.code, typedPres(), info, ui.def, ui.selected), ...looseBlocks(info))
    : h("pre", { class: "text" }, textPanel(info));
  const panels: [UI["panel"], string, () => Kid[]][] = [
    ["node", ui.mode === "new-def" ? "New" : ui.selected ? "Selected" : "Definition", () => [typedInspector(namer, typedPres(), info), definitionPanel(p)]],
    ["program", "Program", () => [programPanel()]],
    ["checks", "Checks", () => [typedChecks(namer, info)]],
    ["files", "Files", () => [filesPanel()]],
    ["guide", "Guide", () => [guide()]],
  ];
  const shown = panels.find(([k]) => k === ui.panel) ?? panels[0];

  app.replaceChildren(
    h("header", { class: "bar" },
      h("div", { class: "brand" }, h("strong", {}, "Language Lab"), h("span", {}, "the program is the tree")),
      h("div", { class: "controls" },
        ui.back.length ? h("button", { class: "btn back", type: "button", "data-act": "back" }, `← ${new Namer(doc.code, p, ui.back.at(-1)!).name(ui.back.at(-1)!)}`) : null,
        cycling(seg("layer", ui.layer, [["short", "Short names"], ["descriptive", "Descriptive"]])),
        cycling(seg("style", ui.style, [["math", "a · b"], ["plain", "a * b"], ["lisp", "(* a b)"]])),
        h("div", { class: "seg history" },
          h("button", { type: "button", "data-act": "undo", disabled: !undo.length && !deleted }, "Undo"),
          h("button", { type: "button", "data-act": "redo", disabled: !redo.length }, "Redo"),
          h("button", { type: "button", "data-act": "reset", disabled: !isExample(doc.program), title: isExample(doc.program) ? "Back to the example as shipped" : "Your own program has nothing to go back to; Undo steps back" }, "Reset")),
        // On a phone held upright they're behind More, so the bar fits.
        h("button", { class: "btn more", type: "button", "data-act": "more", "aria-expanded": "false" }, "More"),
        h("div", { class: "links" },
          h("a", { class: "btn", href: "guide.html", title: "A hands-on guide: one program changed step by step (GUIDE.md); it links on to the tutorial" }, "Learn"),
          h("a", { class: "btn", href: "tutorial.html#credits" }, "Credits"),
          h("a", { class: "btn", href: "reactive.html", title: "Reactivity and values on demand, through the Cells effect" }, "Cells")))),
    h("main", { class: "grid is-typed", style: dockStyle(), "data-pane": ui.pane },
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
            ui.text === "blocks" ? h("span", { class: "hint" }, TOUCH ? "tap a part for its type; tap a □ to fill it; double-tap a name to open it" : "hover for types; click a □ to fill it; double-click a name to open it") : null),
          h("div", { class: "body" }, textView))),
      h("div", { class: "gutter", "data-gutter": "side-w", style: "grid-area: g2", "aria-hidden": "true" }),
      h("aside", { class: "side" },
        h("section", { class: "panel" }, h("h2", {}, "Run"), pictureSection(info), pageSection(info), typedRunPanel(namer, info)),
        h("section", { class: "panel", "aria-label": shown[1] },
          h("div", { class: "ins-tabs", role: "tablist" }, ...panels.map(([k, label]) =>
            h("button", { type: "button", role: "tab", class: k === shown[0] ? "on" : "", "aria-selected": String(k === shown[0]), "data-panel": k }, label))),
          ...shown[2]()))),
    h("div", { class: `status${ui.touched.length ? " live" : ""}${ui.refused ? " refused" : ""}`, role: "status", title: ui.note }, ui.note),
    // At phone width one pane at a time, picked here (page.html).
    h("nav", { class: "panes", "aria-label": "Panes" }, ...([["nav", "Programs"], ["graph", "Graph"], ["text", "Text"], ["side", "Run"]] as const).map(([k, label]) =>
      h("button", { type: "button", class: k === ui.pane ? "on" : "", "aria-pressed": String(k === ui.pane), "data-pane": k }, label))),
  );
  SCROLLERS.forEach((q, k) => document.querySelectorAll(q).forEach((g, i) => { if (scroll[k][i]) [g.scrollLeft, g.scrollTop] = scroll[k][i]; }));
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
    const all = [...(set.parentElement?.children ?? [])] as HTMLElement[];
    const shut = set.classList.contains("on") && set.parentElement?.classList.contains("cycle") && all.some((b) => b !== set && getComputedStyle(b).display === "none");
    (ui as unknown as Record<string, string>)[k] = shut ? all[(all.indexOf(set) + 1) % all.length].dataset.value! : set.dataset.value!;
    if (k !== "text") { ui.touched = []; ui.note = k === "layer" ? "Switched names layer. Same code, different words." : "Switched notation. Same code, different symbols and precedence."; }
    return render();
  }
  // A definition found in another program: open it there.
  const found = t.closest<HTMLElement>("[data-goto]");
  if (found) {
    switchProgram(found.dataset.program!);
    if (node(found.dataset.goto!)) { ui.find = ""; openDef(found.dataset.goto!); ui.back = []; }
    return;
  }
  const def = t.closest<HTMLElement>("[data-def]");
  if (def) { openDef(def.dataset.def!); ui.back = []; ui.pane = "graph"; return render(); }
  const tb = t.closest<HTMLElement>("[data-tab]");
  if (tb) { if (tb.dataset.tab !== ui.def) { openDef(tb.dataset.tab!); ui.back = []; render(); } return; }
  const close = t.closest<HTMLElement>("[data-close-tab]");
  if (close) {
    const d = close.dataset.closeTab!, i = ui.tabs.indexOf(d);
    ui.tabs = ui.tabs.filter((x) => x !== d);
    if (d === ui.def) { openDef(ui.tabs[Math.max(0, i - 1)]); ui.back = []; }
    return render();
  }
  const pane = t.closest<HTMLElement>(".panes [data-pane]");
  if (pane) { ui.pane = pane.dataset.pane as UI["pane"]; return render(); }
  const panel = t.closest<HTMLElement>("[data-panel]");
  if (panel) { ui.panel = panel.dataset.panel as UI["panel"]; return render(); }
  const act = t.closest<HTMLElement>("[data-act]");
  if (act) {
    const a = act.dataset.act;
    if (a === "undo") return travel(undo, redo, "Undid");
    if (a === "redo") return travel(redo, undo, "Redid");
    if (a === "reset") { undo.push(doc); doc = initialFor(doc.program); ui.def = startDef(); ui.tabs = startTabs(); ui.back = []; ui.selected = null; ui.touched = files().map((f) => f.name); ui.note = "Back to the example programs."; save(); return render(); }
    if (a === "back") { ui.def = ui.back.pop()!; ui.selected = null; ui.mode = null; ui.note = "Back."; return render(); }
    if (a === "goto") return openDef(act.dataset.target!);
    if (a === "inline") return toggleInline(act.dataset.target!);
    if (a === "named") return toggleNamed(act.dataset.target!);
    if (a === "goto-node") return select(act.dataset.target!);
    // The form is in the side panel's first tab: show it, whichever tab
    // (the Guide, on a first visit) was open.
    if (a === "new-def") { ui.mode = ui.mode === "new-def" ? null : "new-def"; if (ui.mode) { ui.panel = "node"; if (onePane()) ui.pane = "side"; } render(); document.getElementById("f-def-name")?.focus(); return; }
    if (a === "new-program") return newProgram();
    if (a === "copy") return copySelected();
    if (a === "t-values") return showValues();
    if (a === "t-novalues") return hideValues();
    if (a === "paste") return pasteIntoSelected();
    if (a === "open-file") return openFile();
    if (a === "stop-search") return stopSearch();
    if (a === "save-file") return saveFile();
    if (a === "delete-program") return deleteProgram();
    if (a === "t-swap" && ui.selected) return menuAction("swap", ui.selected);
    if (a === "t-replace" && ui.selected) return menuAction("replace", ui.selected);
    if (a === "t-wrap" && ui.selected) return menuAction("wrap", ui.selected);
    if (a === "t-clear" && ui.selected && typesOf()) return void applyT(T.toHole(doc.code, doc.names.short, typesOf()!, ui.selected));
    if (a === "more") { const open = !!document.querySelector(".bar")?.classList.toggle("more-open"); act.setAttribute("aria-expanded", String(open)); return; }
    if (a === "split") { ui.mode = ui.mode === "split" ? null : "split"; return render(); }
    if (a === "t-run" && typesOf()) return runTyped();
    if (a === "t-stop") return stopRun("Stopped.");
    if (a === "page-restart") { page.for = null; ui.note = "Started the page again: every cell is back to its first value."; return render(); }
    if (a === "page-hush") { page.now?.hush?.(); ui.note = "Stopped every sound the page was playing."; return render(); }
    if (a === "page-tab" || a === "page-save") return savePage(a === "page-tab");
    if (a === "t-undot" && ui.selected && typesOf()) return void applyT(T.removeDot(doc.code, doc.names.short, typesOf()!, ui.def, ui.selected));
    return;
  }
  const hit = blocksHit(t);
  if (hit && Date.now() - blocksHeld < 800) return;
  if (hit) { e.stopPropagation(); return select(hit); }
});

// A touch held still on the blocks for half a second opens the part's
// menu, as in the graph: iOS has no right-click. Where the browser has its
// own long press (Android), ours comes first and the browser's is dropped;
// the tap that ends the press doesn't also select.
let blocksHeld = 0;
document.addEventListener("pointerdown", (ev) => {
  if (ev.pointerType !== "touch" || !(ev.target as HTMLElement).closest?.(".blocks-wrap")) return;
  const at = { x: ev.clientX, y: ev.clientY }, t = ev.target as HTMLElement;
  const mv = (e: PointerEvent) => { if (Math.hypot(e.clientX - at.x, e.clientY - at.y) > 8) stop(); };
  const timer = setTimeout(() => {
    stop();
    blocksHeld = Date.now();
    t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
  }, 500);
  const stop = () => { clearTimeout(timer); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); };
  window.addEventListener("pointermove", mv);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
});

// Right-click in the Blocks pane: the graph's menu for that part.
document.addEventListener("contextmenu", (e) => {
  if (e.isTrusted && Date.now() - blocksHeld < 1000 && (e.target as HTMLElement | null)?.closest?.(".blocks-wrap")) { e.preventDefault(); return; }
  const id = blocksHit(e.target);
  // Empty space in the blocks: what the graph's canvas offers there.
  if (!id && (e.target as HTMLElement | null)?.closest?.(".blocks-wrap")) {
    e.preventDefault();
    ui.menu = { target: { kind: "space" }, x: e.clientX, y: e.clientY, world: { x: 0, y: 0 }, blocks: true };
    ui.query = "";
    render();
    document.querySelector<HTMLElement>(".ctx-menu .ctx-item:not(:disabled)")?.focus();
    return;
  }
  if (!id) return;
  e.preventDefault();
  ui.selected = id;
  ui.mode = null;
  ui.menu = { target: { kind: blocksKind(id), id }, x: e.clientX, y: e.clientY, world: { x: 0, y: 0 }, blocks: true };
  ui.query = "";
  render();
  if (blocksKind(id) === "hole") document.getElementById("m-query")?.focus();
  else document.querySelector<HTMLElement>(".ctx-menu .ctx-item:not(:disabled)")?.focus();
});

document.addEventListener("dblclick", (e) => {
  const hit = (e.target as HTMLElement).closest<HTMLElement>(".blocks-wrap [data-id]");
  if (!hit) return;
  const d = calleeDef(hit.dataset.id!);
  if (d) openDef(d);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ui.menu) { ui.menu = null; render(); return toProgram(); }
  if (ui.menu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    const items = [...document.querySelectorAll<HTMLElement>(".ctx-menu .ctx-item:not(:disabled)")];
    if (items.length) {
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
    return;
  }
  const field = (e.target as HTMLElement).closest<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  const typing = !!field;
  if (e.key === "Escape" && !typing && ui.selected) return select(null);
  // In a field that saves on Enter (data-commit) whose text is what was
  // last saved (a rename just made, say), the browser has nothing of its own to undo, so the
  // editor's Undo takes it: the rename itself is undone.
  const committed = !!field && field.matches("[data-commit]") && field.value === field.defaultValue;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && (!typing || committed)) {
    e.preventDefault();
    return e.shiftKey ? travel(redo, undo, "Redid") : travel(undo, redo, "Undid");
  }
  if ((e.metaKey || e.ctrlKey) && !typing) {
    const k = e.key.toLowerCase();
    if (k === "c" || k === "x") { if (copyable(ui.selected)) { e.preventDefault(); copySelected(k === "x"); } return; }
    if (k === "v" && clip && ui.selected) { e.preventDefault(); return pasteIntoSelected(); }
  }
  // The keyboard reaches the program: Tab and Shift+Tab step through its
  // parts in reading order (holes included), Enter goes to what edits the
  // part (the palette on a hole, the value of a literal). Past the last
  // part, Tab leaves the program as usual.
  const inProgram = !typing && (document.activeElement === document.body || !!(e.target as HTMLElement).closest(".blocks-wrap, .p-graph"));
  if (e.key === "Tab" && inProgram && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // The order the blocks read in, or without them the tree's. An
    // operator's glyph stands for the function it calls, not a part here.
    const blocks = [...document.querySelectorAll<HTMLElement>(".blocks-wrap [data-id]:not(.op):not(.head)")].map((el) => el.dataset.id!);
    const shown = [...new Set(blocks.length ? blocks : T.readingOrder(doc.code, ui.def).filter((id) => document.querySelector(`.p-graph [data-id="${id}"]`)))].filter((id) => id !== ui.def);
    const at = ui.selected ? shown.indexOf(ui.selected) : -1;
    const next = e.shiftKey ? (at < 0 ? shown.length - 1 : at - 1) : at + 1;
    if (next >= 0 && next < shown.length) {
      e.preventDefault();
      select(shown[next]);
      document.querySelector<HTMLElement>(".blocks-wrap")?.focus({ preventScroll: true });
      document.querySelector(".blocks-wrap .sel")?.scrollIntoView({ block: "nearest" });
    }
    return;
  }
  if (inProgram && ui.selected && (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) {
    e.preventDefault();
    return menuForSelected();
  }
  if (e.key === "Enter" && inProgram && ui.selected) {
    const edit = document.querySelector<HTMLElement>("#f-query, #f-lit");
    e.preventDefault();
    // A hole or a literal is edited in place; anything else offers what
    // can be done to it: Change the function first for a call, Replace
    // with first for anything else.
    if (edit) edit.focus();
    else menuForSelected(doc.code.nodes[ui.selected]?.kind === "call" ? "swap" : "replace");
    return;
  }
  if (!typing && (e.key === "Delete" || e.key === "Backspace") && ui.selected) {
    e.preventDefault();
    removeSelected();
  }
});

render();
