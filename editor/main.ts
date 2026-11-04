// Browser editor over the same core as the CLI demo. Code is edited by
// gestures, never by typing text, and every gesture says which file it
// changed. Every program is typed, and there is one kind of definition: a
// function, drawn as blocks and as a graph. Any function can also be run
// backwards: pick which of its ports you know, the result included, and the
// one interpreter that runs things backwards (relate.ts) works out the rest.
// A function returning Bool built from equal and and is what used to be a
// network; its result is known to be true.

import { outlineProgram } from "../ters/src/lang/cells-programs.ts";
import manifest from "./examples.json" with { type: "json" };
import FILES from "examples:files";
import blocksStyle from "../ters/styles/blocks.json" with { type: "json" };
import mathStyle from "../ters/styles/math.json" with { type: "json" };
import plainStyle from "../ters/styles/plain.json" with { type: "json" };
import lispStyle from "../ters/styles/lisp.json" with { type: "json" };
import { children, freshId, ID_PATTERN, isCall, isUse, useTarget, type Call, merge, parentOf, resolveRefs, subtree, type Code, type Id, type Node, type NodeOf } from "../ters/src/model.ts";
import { INT } from "../ters/src/lang/types.ts";
import { layer, type Comments, type Hints, type Names, type Presentation, type Style } from "../ters/src/presentation.ts";
import { implementationOps, isOperation } from "../ters/src/lang/records.ts";
import { renderLet } from "../ters/src/render/letseq.ts";
import { renderNested } from "../ters/src/render/nested.ts";
import { renderSexpr } from "../ters/src/render/sexpr.ts";
import { Namer } from "../ters/src/render/namer.ts";
import { BOOL, CHECK, CONS, onTodaysIds, SOME, TRUE } from "../ters/src/lang/std.ts";
import { CHOICE, DIVERGE, WORLD, showIn, type Type } from "../ters/src/lang/types.ts";
import { renderBlocks } from "../ters/src/lang/render.ts";
import { needsHandling, OutOfSteps, type Data, type Value } from "../ters/src/lang/run.ts";
import type { Profile, Stuck } from "./runWorker.ts";
import { hostSkeleton } from "../ters/src/lang/hosts.ts";
import { trace, type Trace } from "../ters/src/lang/trace.ts";
import * as T from "./typed.ts";
import { typedGraph, type GraphView, type MenuTarget } from "./typedGraph.ts";
import { builtinName, builtinOf, definitionOf } from "./define.ts";
import { follow, type Pos } from "./canvas.ts";
import { edit, h, type Kid } from "./dom.ts";
import { guide } from "./guide.ts";
import { navigatorPanel } from "./navigator.ts";
import { runPanel } from "./runPanel.ts";
import { seeds } from "./seeds.ts";
import { backwards } from "./backwards.ts";
import { selectedParts } from "./selectedParts.ts";
import { palette, typeName } from "./palette.ts";
import { structure } from "./structure.ts";
import { parentsOf, selection } from "./selection.ts";
import { filesPanels, fnv, userCode } from "./filesPanel.ts";
import { graphMenu as graphMenuOf } from "./graphMenu.ts";
import { shower } from "./shown.ts";
import { pagePanels } from "./pagePanel.ts";
import { lawPanel, profileView, stuckView, valueView } from "./runViews.ts";
import { fromFile, toFile } from "../ters/src/files.ts";
import { flattened, matchRows, sameEverywhere } from "../ters/src/lang/patterns.ts";
import { showPin, type Pins } from "../ters/src/lang/signatures.ts";
import { inlinable, inlineView, type InlineView } from "./inline.ts";
import * as Top from "../ters/src/lang/toplevel.ts";
import { pictureEntries } from "./picture.ts";
import type { Saved } from "../ters/src/lang/tests.ts";
import { algebrasOf, describeMask, maskOfValue, type Algebra } from "../ters/src/lang/grades.ts";
import { pageMain } from "../ters/src/lang/page.ts";
import { browserWorld } from "../ters/src/lang/browser.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
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
  // Bindings shown as wires instead of a let node with get nodes, which
  // is how every named binding is drawn otherwise (Ersagun 2026-10-27,
  // E157). An unnamed dot on a wire stays a dot unless listed in `named`.
  wired?: Id[];
  named?: Id[];
  // Frames drawn folded into one box (a lambda, a let, a match arm...). A view.
  folded?: Id[];
  // Framed parts that start folded in the graph (deepFunctions) and were opened.
  unfolded?: Id[];
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
  // Tuple wires drawn fanned out, a strand per part (E167c), by the value
  // they carry. A view.
  fanned?: Id[];
  // Nodes made bigger by hand, by `def/id` (BACKLOG I49). Never smaller
  // than what they show. A view.
  size?: Record<string, { w: number; h: number }>;
}

// The examples, and programs of your own: made new, or opened from a file.
export type Program = string;
// The example programs, in the picker's order (editor/examples.json, E205).
const EXAMPLES: [Program, string][] = manifest.programs.filter((p) => p.editor !== false).map((p) => [p.program, p.label]);
const isExample = (p: Program) => EXAMPLES.some(([k]) => k === p);
const MINE = "mine.";
// The program's own comment, in comments.json like any other: what it is,
// and whose code or ideas it uses (CREDITS.md has every one).
const PROGRAM = "program";

export interface Doc {
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
  // graph shows values for. A side table like names: never code. With an
  // answer accepted (T7d), a list of inputs and answers instead (tests.ts
  // Saved), the first the one Run shows.
  examples?: Record<Id, string[] | Saved[]>;
  // Changed by you since it was loaded (an example as shipped is not saved
  // as yours, so it keeps up with the shipped one).
  edited?: boolean;
  // Pins: definitions whose type is frozen (src/lang/signatures.ts).
  signatures?: Pins;
  // Loose parts (drafts.ts): definitions of their own in `code`, here with
  // the definition each belongs to, and the variables their inputs stand for.
  loose?: Record<Id, Id>;
  home?: Record<Id, Id>;
  // Opened from a file (E229): before its main first touches the network
  // or files, Run asks which of them to allow. `allowed` is what was said.
  opened?: boolean;
  allowed?: Id[];
  denied?: Id[];
}

export interface UI {
  def: Id;
  // The definition whose Run is asking what a program from a file may do (E229).
  allowing?: Id | null;
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
  output: { def: Id; lines: string[]; error?: string; running?: boolean; stuck?: Stuck; profile?: Profile; compiled?: boolean } | null;
  // What Run gives a program that reads standard input, by program (I168).
  stdin?: Record<string, string>;
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
// A program's own ids: the library's are dotted (`std.map`) or `@`-named.
const own = (id: Id) => !id.includes(".") && !id.startsWith("@");

// What every program is merged onto: the builtins, the standard library
// and the modules (src/lang/library.ts). A file holds only what's on top.
const BASE = LIBRARY.code;
const baseFor = (_typed: boolean) => BASE;

// An example is a folder of the same side tables a saved file holds
// (examples/unpack.ts writes one from a file the editor saved).
const typedDoc = (program: Program, code: Code, names: Names, comments: Comments, more: { layout?: Partial<Layout>; examples?: Record<Id, string[] | Saved[]> } = {}): Doc => ({
  program, typed: true,
  code: merge(BASE, code),
  names: { short: names, descriptive: {} },
  comments, hints: {},
  layout: { known: {}, ...more.layout },
  examples: more.examples,
});

// One from its folders (examples/unpack.ts writes one), merged in order,
// or one built in code.
const BUILT: Record<Program, () => Doc> = { outline: () => outlineDoc() };
const initialFor = (program: Program): Doc => {
  const m = manifest.programs.find((p) => p.program === program && p.editor !== false) ?? manifest.programs[0];
  if (m.built) return BUILT[m.program]();
  // With today's ids, as lab run reads a folder (load.ts): sheet still says
  // std's Pair, which is Tuple2 now (L139), and pointed at nothing (E212).
  const fs = (m.folders ?? []).map((f) => onTodaysIds(FILES(f)));
  const all = <K extends keyof (typeof fs)[number]>(k: K) => fs.some((f) => f[k]) ? Object.assign({}, ...fs.map((f) => f[k])) : undefined;
  const d = typedDoc(m.program, fs.map((f) => f.code as Code).reduce((a, b) => merge(a, b)), all("names") ?? {}, all("comments") ?? {}, { layout: all("layout"), examples: all("examples") });
  return { ...d, names: { short: d.names.short, descriptive: all("descriptive") ?? {} }, hints: all("hints") ?? {} };
};

// The nested to-do outline is built in src/lang/cells-programs.ts, where
// reactive.html runs it too (BACKLOG L100, I35).
function outlineDoc(): Doc {
  const p = outlineProgram();
  return typedDoc("outline", p.code, p.names, { program: "Textbook: path-tracked stores and keyed rows, after Solid's createStore and mapArray, MobX and Immer's patches (STABLE-REFERENCES.md, Prior art). Our own: plain Item data in one cell, every button an edit at a path, the top-level rows an each that follows the edits, so ticking an item makes only its row again (BACKLOG L98, L99a, L100)." });
}

// The quadratic and the physics: plain arithmetic, and predicates with
// units that run in every direction.
// Each starts out run the way you'd first ask (layout.json): how far it
// falls, where the point lands.
const initial = (): Doc => initialFor("numbers");

// An embed (`?embed&program=sort&def=insert`): one definition's blocks
// and Run, for a page that teaches with the editor in an iframe. It starts
// from the example as shipped and keeps nothing, so the editor's own
// programs (localStorage) are neither read nor written.
const ASKED = new URLSearchParams(typeof location === "object" ? location.search : "");
const EMBED = ASKED.has("embed");
// `&readonly`: the code can't change; Run's inputs still can.
const READONLY = EMBED && ASKED.has("readonly");
// An embed's tab: its code (graph and blocks) or Run.
let embedTab: "code" | "run" = "code";

// One document per example program; switching keeps each one's edits.
let docs: Record<Program, Doc> = {};
let doc: Doc = EMBED ? initialFor(ASKED.get("program") ?? "numbers") : initial();
if (!EMBED) try {
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
// `&code=…`: an embed of a program carried in the link itself (Copy embed
// link, in the Program panel), drawn once it's unpacked.
let unpacking = EMBED && ASKED.has("code");
if (unpacking) void unpackSnippet(ASKED.get("code")!).then((p) => {
  doc = typedDoc("snippet", p.code, p.names, p.comments);
  showProgram();
  ui.def = defNamed(ASKED.get("def") ?? "") || ui.def;
  ui.tabs = [ui.def];
  missingAsked();
}, () => { ui.note = UNREADABLE; ui.refused = true; }).finally(() => { unpacking = false; render(); });
// `?program=sort&def=insert` (an embed's Open in the editor) opens that
// example, with your edits to it if you made any.
if (!EMBED && isExample(ASKED.get("program") ?? "")) doc = docs[ASKED.get("program")!] ?? initialFor(ASKED.get("program")!);

// A saved program holds the library it was saved with, and the library
// moves on: builtins are renamed and removed (sum-and-difference became an
// ordinary definition in one world). So a saved program is put on today's
// library: its own nodes on top of the current one. An example you never
// changed isn't kept at all, so it's always the one shipped; one you did
// change is kept unless it uses something the library no longer has.
function onToday(d: Doc): Doc {
  // Credits kept apart, as the editor once did, are the program's comment now.
  const { credits, ...rest } = d as Doc & { credits?: string[] };
  if (credits?.length) d = { ...rest, comments: { ...d.comments, [PROGRAM]: [d.comments[PROGRAM], ...credits].filter(Boolean).join("\n") } };
  // Renamed library ids (std's Pair is Tuple2, L139) read as today's, as
  // load.ts and files.ts do; else its own nodes would name ids that are gone.
  d = { ...d, code: onTodaysIds(d.code), names: onTodaysIds(d.names) };
  return { ...d, code: {
    nodes: { ...BASE.nodes, ...Object.fromEntries(Object.entries(d.code.nodes).filter(([id]) => own(id))) },
    defs: [...BASE.defs, ...d.code.defs.filter(own)],
  } };
}

// Every id a node names is there: its children, and what a ref or a solve
// refers to.
function resolves(code: Code): boolean {
  return Object.values(code.nodes).every((n) => [...children(n), ...(n.kind === "ref" ? [n.target] : isUse(n) ? [useTarget(code.nodes, n)] : [])].every((c) => code.nodes[c]));
}

const START: Record<Program, string> = Object.fromEntries(manifest.programs.flatMap((p) => (p.start ? [[p.program, p.start]] : [])));
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

// A first visit opens on the definition that shows the first program off
// (Numbers & physics' fall, four lines run in any direction), not on its
// main, which is the hardest page of it (E235, from the outsider read).
const firstVisit = (() => { try { return !EMBED && !ASKED.get("program") && !localStorage.getItem("projectional-guide-seen"); } catch { return false; } })();
const ui: UI = {
  def: defNamed(ASKED.get("def") ?? "") || (firstVisit ? showcase() : startDef()),
  pane: "graph",
  back: [],
  selected: null,
  layer: "descriptive",
  find: "",
  style: "math",
  text: "blocks",
  touched: [],
  note: READONLY ? "Read-only: Run's inputs change, the code doesn't. Open in the editor to change it." : EMBED ? OPENING : `${OPENING} Run lets you run any function backwards.`,
  mode: null,
  query: "",
  refused: false,
  output: null,
  menu: null,
  newKind: "function",
  tabs: startTabs(),
  panel: "node",
};

// A link naming a program or a definition that isn't there says so, rather
// than quietly showing another one.
function missingAsked(): string {
  const program = ASKED.get("program"), def = ASKED.get("def");
  const gone = [
    program && !ASKED.has("code") && !isExample(program) ? `There's no example called "${program}", so this is ${titleOf(doc)}.` : "",
    def && !defNamed(def) ? `${titleOf(doc)} has no definition called "${def}", so this is ${doc.names.short[ui.def] ?? "another"}.` : "",
  ].filter(Boolean).join(" ");
  if (gone) { ui.note = gone; ui.refused = true; }
  return gone;
}
if (!ASKED.has("code")) missingAsked();


const undo: Doc[] = [];
const redo: Doc[] = [];
// Undo keeps the last UNDO_MAX versions (E202: every one, with its
// caches, was ~5 MB an edit in Constructions, a gigabyte in an hour). The
// caches (inference, traces, runs, layouts) are WeakMaps keyed by a
// version's Code, so a version further back than WARM gets a Code of its
// own, the same nodes under a new key: its caches go, and an Undo that far
// back works them out again. The last few steps stay as quick as ever.
const UNDO_MAX = 200, WARM = 4;
function keepUndo() {
  if (undo.length > UNDO_MAX) undo.splice(0, undo.length - UNDO_MAX);
  const i = undo.length - 1 - WARM;
  const d = i >= 0 ? undo[i] : null;
  if (!d || cold.has(d)) return;
  const c: Doc = { ...d, code: { nodes: d.code.nodes, defs: d.code.defs } };
  const at = openWith.get(d);
  if (at) openWith.set(c, at);
  cold.add(c);
  undo[i] = c;
}
const cold = new WeakSet<Doc>();
// The program just deleted, until the next edit or switch: Undo brings it
// back, so a delete needs no "are you sure".
let deleted: Doc | null = null;
// Change the function (or Replace with) makes the function (or the part) a
// hole, then the palette fills it: one change, so one Undo. The fill that comes right after takes the
// place of the hole's step in the undo list.
let swapped: { hole: Id; at: number } | null = null;
// Wrap in… makes the part a hole the same way; the fill that comes next
// takes it back as one of its inputs (typed.ts wrapInto).
let wrapping: { hole: Id; kept: Code; info: T.Info; graph: boolean } | null = null;

// The definition open at each version, so Undo and Redo go back to it
// (E193): Undo of + New definition to the one open before, Redo to the
// new one.
const openWith = new WeakMap<Doc, Id>();
// The one open before an edit's own step changed it (applyT's `then`).
let openBefore: Id | null = null;
// How the program's types are stored when main runs (E230), and which way
// works out each field left to its ways (E230b), once per version of the
// code: an edit that changes one says so in its note.
type Chosen = { stored: Map<Id, { rep: string; jobs: string[] }>; ways: ReturnType<typeof T.waysChosen> };
const storedCache = new WeakMap<Code, Chosen>();
const NOTHING_CHOSEN: Chosen = { stored: new Map(), ways: new Map() };
// `checked`: only from a check already made (before an edit, typesOf would
// let go of a type held for the hole the edit is about to make).
function storedNow(checked = false): Chosen {
  let s = storedCache.get(doc.code);
  if (!s) {
    const info = checked ? typedInfo.get(doc.code)?.info : typesOf();
    if (!info && checked) return NOTHING_CHOSEN;
    try { s = info ? { stored: T.storedAll(doc.code, info, pres().names, ownDefs(), defNamed("main") ?? null), ways: info.errors.length ? new Map() : T.waysChosen(doc.code, info, ownDefs()) } : NOTHING_CHOSEN; } catch { s = NOTHING_CHOSEN; }
    storedCache.set(doc.code, s);
  }
  return s;
}
// "Stack is now stored as …", "plus of Vec is now worked out by …", for
// each choice the edit changed.
function storageChanges(before: Chosen): string {
  const after = storedNow(), names = pres().names;
  const said: string[] = [];
  for (const [type, a] of after.stored) {
    const b = before.stored.get(type);
    if (b && b.rep !== a.rep) said.push(`${names[type] ?? "A type"} is now stored as ${a.rep}, not ${b.rep}: main's jobs on it are now ${a.jobs.map((j) => names[j] ?? j).join(", ")}.`);
  }
  const way = (w: Id | null) => (w ? `by ${names[w] ?? "a way"}` : "as written");
  for (const [k, a] of after.ways) {
    const b = before.ways.get(k);
    if (b && b.way !== a.way) said.push(`${names[a.field] ?? "A field"} of ${names[a.impl] ?? "an implementation"} is now worked out ${way(a.way)}, not ${way(b.way)}: the cheapest way now.`);
  }
  return said.join(" ");
}
function commit(next: Partial<Doc>, touched: string[], note: string) {
  ui.menu = null;
  if (READONLY && (next.code || next.names)) {
    ui.note = "This snippet is read-only: Open in the editor to change it.";
    ui.refused = true;
    return render();
  }
  deleted = null;
  const filled = swapped && undo.length === swapped.at && next.code && next.code.nodes[swapped.hole] && next.code.nodes[swapped.hole].kind !== "hole";
  swapped = null;
  if (!filled) { openWith.set(doc, openBefore ?? ui.def); undo.push(doc); keepUndo(); }
  openBefore = null;
  redo.length = 0;
  // A program with a choice of how a type is stored (two representations
  // or more) is told when an edit changes the choice.
  const stored = next.code && next.code !== doc.code ? storedNow(true) : null;
  doc = { ...doc, ...next, edited: true };
  ui.touched = touched;
  ui.note = note;
  if (stored && (stored.stored.size || stored.ways.size)) { const changed = storageChanges(stored); if (changed) ui.note = `${note} ${changed}`; }
  ui.mode = null;
  ui.query = "";
  ui.refused = false;
  save();
  render();
}

// What a doc keeps in this browser: its own nodes only. The library under
// them (1.4 M characters) is put back by onToday when it's read, so a copy
// of it in every saved doc only filled the store (E197). One per version.
const keptCode = new WeakMap<Code, Code>();
const kept = (d: Doc): Doc => {
  let code = keptCode.get(d.code);
  if (!code) keptCode.set(d.code, (code = { nodes: Object.fromEntries(Object.entries(d.code.nodes).filter(([id]) => own(id))), defs: d.code.defs.filter(own) }));
  return { ...d, code };
};
const UNSAVED = "Not kept in this browser: its storage is full. Save file keeps this program; deleting a program you no longer need makes room.";

function save() {
  docs[doc.program] = doc;
  if (EMBED) return;
  // An example as shipped isn't kept: it opens from the page again (I160:
  // opening every example one after another filled the store, 5 MB).
  const all = Object.fromEntries(Object.entries(docs).filter(([k, d]) => k.startsWith(MINE) || d.edited).map(([k, d]) => [k, kept(d)]));
  try { localStorage.setItem(STORE, JSON.stringify({ current: doc.program, docs: all, held })); }
  catch { ui.note = ui.note ? `${ui.note} ${UNSAVED}` : UNSAVED; }
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
  endRun();
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
    addProgram({ opened: true, title: x.title, typed: x.typed, code: x.drafts ? join(r.code, x.drafts) : r.code, names: { short: x.names, descriptive: x.descriptive }, comments: x.comments, hints: {}, layout: x.layout, examples: x.examples, signatures: x.signatures, loose: x.drafts?.of, home: x.drafts?.home },
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
  return !!n && (["lit", "ref", "call", "lambda", "match", "fold"].includes(n.kind) || isUse(n)) && !doc.code.defs.includes(id!);
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
function applyT(e: T.LooseEdit, then?: () => void, place?: Record<Id, Pos>, pins?: Pins, layout?: Doc["layout"]): boolean {
  const w = wrapping;
  wrapping = null;
  if (w && e.ok && e.code.nodes[w.hole] && e.code.nodes[w.hole].kind !== "hole") e = T.wrapInto(e.code, e.names, w.info, w.hole, w.kept, w.graph);
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
  const same = e.own ? { places: 0, code: e.code, copied: [] } : sameEverywhere(doc.code, e.code, typesOf());
  if (same.places) {
    const names = { ...e.names };
    for (const [x, y] of same.copied) if (names[x]) names[y] = names[x];
    e = { ...e, code: same.code, names, note: `${e.note} Made in all ${same.places} places it stands for.` };
  }
  const note = holdType(e.code);
  openBefore = ui.def;
  then?.();
  // A node an edit removed takes its names with it, in every layer.
  const kept = (ns: Names) => Object.fromEntries(Object.entries(ns).filter(([id]) => e.code.nodes[id]));
  // An edit that sets parts loose, or wires one in, says so (drafts.ts).
  const loose = e.of ? { loose: e.of, home: e.home } : {};
  const base = layout ?? doc.layout;
  const placed = place ? { layout: { ...base, at: { ...(base.at ?? {}), ...Object.fromEntries(Object.entries(place).map(([k, v]) => [lkey(k), v])) } } } : layout ? { layout } : {};
  const pinned = pins ? { signatures: { ...doc.signatures, ...pins } } : {};
  commit({ code: e.code, names: { short: kept(e.names), descriptive: kept(doc.names.descriptive) }, ...loose, ...placed, ...pinned }, ["code.json", "names.short.json", ...(e.of ? ["drafts.json"] : []), ...(place || layout ? ["layout.json"] : []), ...(pins ? ["signatures.json"] : [])], e.note + note);
  return true;
}

// Escape while Replace with…, Change the function or Wrap in… waits for
// a pick puts back what was there, as if it never began (QA8 M2).
function cancelPick(): boolean {
  if (!swapped || undo.length !== swapped.at || doc.code.nodes[swapped.hole]?.kind !== "hole") return false;
  swapped = null;
  wrapping = null;
  ui.menu = null;
  travel(undo, redo, "Cancelled");
  redo.pop();
  ui.note = "Cancelled: what was there is back.";
  render();
  return true;
}

function travel(from: Doc[], to: Doc[], label: string) {
  if (from === undo && !from.length && deleted) return undeleteProgram();
  const d = from.pop();
  if (!d) return;
  openWith.set(doc, ui.def);
  to.push(doc);
  const changed = files().filter((f) => f.get(d) !== f.get(doc)).map((f) => f.name);
  doc = d;
  if (ui.selected && !doc.code.nodes[ui.selected]) ui.selected = null;
  const was = openWith.get(d);
  if (was && doc.code.nodes[was] && was !== ui.def) { ui.def = was; ui.selected = null; }
  if (!doc.code.nodes[ui.def] || doc.loose?.[ui.def]) ui.def = doc.loose?.[ui.def] ?? startDef();
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
// pin the editor holds (not signatures.json), kept with the saved programs
// so a reload doesn't drop it unsaid (E179); "Let it loosen" in its Type
// section, or beside a fill it refuses, drops it.
let held: Pins = (() => { if (EMBED) return {}; try { return JSON.parse(localStorage.getItem(STORE) ?? "null")?.held ?? {}; } catch { return {}; } })();
const hasHole = (code: Code, d: Id) => !!code.nodes[d] && subtree(code, d).some((x) => code.nodes[x].kind === "hole");
function holdType(next: Code): string {
  const d = ui.def, info = typesOf();
  if (!info || doc.signatures?.[d] || held[d] || hasHole(doc.code, d) || !hasHole(next, d)) return "";
  // An edit to its inputs changes its type on purpose.
  const inputs = (c: Code) => { const n = c.nodes[d], b = n?.kind === "def" && n.body ? c.nodes[n.body] : null; return b?.kind === "lambda" ? b.params.join() : ""; };
  if (inputs(doc.code) !== inputs(next)) return "";
  const p = T.pin(doc.code, info, {}, d, "");
  if (!p.ok || !p.pins[d]) return "";
  const sigs = doc.signatures ?? NO_PINS;
  T.setProgramPins(sigs);
  let loose: string | null = null;
  // The edit's own check, when it was made with these same pins (nothing
  // else held), is the check without the hold: a second whole check of a
  // big program was a second of Clear (I162).
  try { loose = T.typeOf(T.guardedInfo(next, sigs) ?? T.infer(next, pres().names), d, pres().names); } catch { return ""; }
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
  b.addEventListener("click", () => { const { [ui.def]: _, ...rest } = held; held = rest; ui.note = `${dname}'s type follows its body again.`; ui.refused = false; save(); render(); });
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
  try { const info = T.guardedInfo(doc.code, pins) ?? T.infer(doc.code, pres().names); typedInfo.set(doc.code, { pins, info }); return info; } catch { return null; }
}
const defBody = (d: Id) => { const n = node(d); return n?.kind === "def" && n.body ? node(n.body) : null; };

// The names every view reads, built once per version of what they come
// from: merging the library's every name cost a few ms a call, and the Run
// panel calls it hundreds of times a render (QA9 M1). Read only.
let shown: { from: unknown[]; names: Names } | null = null;
function shownNames(): Names {
  const from = [doc.code, doc.loose, doc.names.short, doc.names.descriptive, ui.layer];
  if (!shown || from.some((x, i) => x !== shown!.from[i]))
    shown = { from, names: layer<Names>(LIBRARY.names, looseNames(), doc.names.short, ui.layer === "descriptive" ? doc.names.descriptive : {}) };
  return shown.names;
}
const pres = (names: Names = {}, comments: Comments = doc.comments): Presentation => ({
  names: Object.keys(names).length ? layer<Names>(shownNames(), names) : shownNames(),
  comments,
  hints: doc.hints,
  style: { ...styles[ui.style], quote: undefined },
});

const { files, filesPanel } = filesPanels({ doc: () => doc, ui, undo, prog: (d) => prog(d), draftsOf: (d) => draftsOf(d) });

// The def a call, ref or solve refers to, if it's a user def.
function calleeDef(id: Id): Id | null {
  const n = node(id);
  if (!n) return null;
  let t: Id | null = null;
  if (isUse(n)) t = useTarget(doc.code.nodes, n);
  else if (isCall(n)) { const fn = node(n.fn); t = fn?.kind === "ref" ? fn.target : null; }
  else if (n.kind === "ref") t = n.target;
  return t && node(t)?.kind === "def" ? t : null;
}

// Opening a definition with holes selects the first: that's where work is.
const firstHole = () => T.nextHole(doc.code, ui.def, ui.def) ?? null;

function openDef(d: Id) {
  ui.back.push(ui.def);
  ui.def = d;
  ui.selected = firstHole();
  ui.mode = null;
  // What was typed was for the hole left behind (E173).
  ui.query = "";
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

function removeSelected() {
  const info = typesOf();
  const id = ui.selected;
  if (!info || !id || !node(id) || (doc.code.defs.includes(id) && !doc.loose?.[id])) return;
  const n = node(id);
  if (["lit", "ref", "call", "lambda", "match", "fold"].includes(n.kind) || isUse(n) || doc.loose?.[id]) void applyT(T.deleteOne(doc.code, doc.names.short, info, ui.def, doc.loose ?? {}, doc.home ?? {}, id));
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

// The values a definition opens with (editor/seeds.ts, E228j).
const { mainCopies, pixelSeed, readPort, seeded } = seeds({
  doc: () => doc, ui, pres: () => pres(), ownDefs: () => ownDefs(), defBody: (d) => defBody(d), defNamed, render: () => render(),
});

// Run backwards (editor/backwards.ts, E228k).
const { LIMIT, backwardsPanel, knownPorts, portText, runBackwards, stopSearch } = backwards({
  doc: () => doc, ui, pres: () => pres(), render: () => render(), commit, portsOfDef, returnsBool, seeded, pixelSeed, readPort,
  traced: (info) => traced(info), kindOf: (info, v) => kindOf(info, v), handledForArgs: (z) => handledForArgs(z), userCode, fnv,
});

// ---------------------------------------------------------------- side panels

// A data type's, an effect's or an operation's type parameter (E198): a
// binder, but of a type, so nothing about values (units, wires) applies.
const typeParams_ = new WeakMap<Code, Set<Id>>();
const isTypeParam = (id: Id) => {
  let ps = typeParams_.get(doc.code);
  if (!ps) typeParams_.set(doc.code, (ps = new Set(Object.values(doc.code.nodes).flatMap((n) => (n.kind === "typedef" || n.kind === "variant") ? n.params ?? [] : []))));
  return ps.has(id);
};
function kindLabel(id: Id): string {
  const n = node(id);
  if (n.kind === "binder" && isTypeParam(id)) return "Type parameter";
  if (n.kind === "binder") return T.isDot(doc.code, ui.def, id) ? "Dot" : "Variable";
  if (n.kind === "def") return "Definition";
  if (isCall(n)) return node(n.fn)?.kind === "lambda" ? "Let" : implementationOps(doc.code, n.fn) ? "Implementation" : "Step (call)";
  if (n.kind === "field" && isOperation(doc.code, id)) return "Operation";
  return ({ lit: "Literal", ref: "Reference", lambda: "Function", hole: "Hole", builtin: "Builtin", match: "Match", fold: "Fold", arm: "Arm", variant: "Case", field: "Field", solve: "Solve" } as Record<string, string>)[n.kind] ?? n.kind;
}

const { implementButton, makeNamed, newDefinitionForm, pick, row, runTop, structurePanel, words } = structure({
  doc: () => doc, ui, applyT: (e, then, place, pins) => applyT(e, then, place, pins), render: () => render(), topT: (i, r) => topT(i, r), defBody: (d) => defBody(d), defNamed: (n) => defNamed(n),
  ownDefs: () => ownDefs(), typeText: (t, n) => typeText(t, n), pinRow, textField, seg,
});
const { fillPalette } = palette({
  doc: () => doc, ui, applyT: (e) => applyT(e), render: () => render(), held: () => held, heldReason, loosenButton, makeNamed, implementButton,
  ownDefs: () => ownDefs(), shownNames, words,
});
const { rowSection, unitSection, sameLine } = selectedParts({ doc: () => doc, ui, applyT, typedPres: () => typedPres(), isTypeParam: (id) => isTypeParam(id) });

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
// The same names object while the program, the definition and the names
// are, so what is kept by the names (shown types, E200b) is kept.
let handled: { from: unknown[]; names: Names } | null = null;
const withHandles = (p: Presentation): Presentation => {
  const from = [doc.code, ui.def, p.names];
  if (!handled || from.some((x, i) => x !== handled!.from[i])) handled = { from, names: { ...T.dotHandles(doc.code, ui.def, p.names), ...p.names } };
  return { ...p, names: handled.names };
};
const typedPres = (): Presentation => withHandles(blocksPres());
// A definition's blocks, kept while only the selection changes (E200b):
// the selection is a class, moved on the kept element.
let blocksKept: { from: unknown[]; el: HTMLElement } | null = null;
function blocksOf(info: T.Info): HTMLElement {
  const p = typedPres();
  const from = [doc.code, info, ui.def, p.names, p.comments, p.hints, doc.layout.groups, doc.layout.folded];
  if (!blocksKept || from.some((x, i) => x !== blocksKept!.from[i])) return (blocksKept = { from, el: T.renderTyped(doc.code, p, info, ui.def, ui.selected, undefined, doc.layout.groups, doc.layout.folded) }).el;
  for (const e of blocksKept.el.querySelectorAll(".sel")) e.classList.remove("sel");
  if (ui.selected) for (const e of blocksKept.el.querySelectorAll(`[data-id="${CSS.escape(ui.selected)}"]`)) e.classList.add("sel");
  return blocksKept.el;
}
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
  // What this part is in, a whole a + b around its b, one step out
  // (E183b): Alt+↑ does the same.
  const outer = enclosing(id);
  const upBtn = outer ? h("button", { class: "btn mini", type: "button", title: "Select what this is in (Alt+↑)", "data-act": "goto-node", "data-target": outer }, "↑ what it's in") : null;
  out.append(h("div", { class: "insp-head" }, h("span", { class: "kind", title: `id ${id} in code.json` }, kindLabel(id))), ...(upBtn ? [h("div", { class: "acts up" }, upBtn)] : []));
  const t = T.typeOf(info, id, names);
  const hole = info.holes.get(id);
  if (hole) out.append(h("div", { class: "typeline" }, h("span", {}, "needs"), h("code", {}, typeName(info, hole.expected, names))));
  // A hole in an implementation is one operation at its type: say which,
  // since the hole's type alone doesn't (BACKLOG E153).
  const up = hole ? parentsOf(doc.code).get(id) ?? null : null;
  const upn = up?.slot === "args" ? node(up.parent) : null;
  const ops = isCall(upn) ? implementationOps(doc.code, upn.fn) : null;
  const at = ops ? /^(\S+) (.+)$/.exec(T.typeOf(info, up!.parent, names) ?? "") : null;
  if (ops && at && up?.index !== undefined) out.append(h("p", { class: "hint" }, `This is ${names[ops[up.index]] ?? "an operation"} at ${at[2]}: what ${at[1]}'s ${names[ops[up.index]] ?? "operation"} does for a ${at[2]}. Write it as a function, or pick one that fits.`));
  else if (t) out.append(h("div", { class: "typeline" }, h("span", {}, "type"), h("code", {}, t)));
  // Which of a shared name's meanings a call took (E223).
  const took = T.tookType(doc.code, info, names, id);
  if (took) out.append(h("div", { class: "typeline", title: "Several things have this name: this is the one the types picked" }, h("span", {}, "calls"), h("code", {}, took)));
  const err = info.errors.find((e) => e.id === id);
  if (err) out.append(h("p", { class: "status-line bad" }, err.message));
  // A type with no implementation of an interface a use needs: write one.
  if (err?.missing) out.append(h("div", { class: "acts" }, implementButton(info, err.missing.iface, err.missing.type, `Implement ${names[err.missing.iface] ?? "it"} for ${showIn(err.missing.type, names, info.subst)}`)));

  const callee = calleeDef(id) ?? (n.kind === "ref" && node(n.target)?.kind === "variant" ? info.owner.get(n.target) ?? null : null);
  // The call itself, or its head (the name clicked to select it).
  const call = inlinable(doc.code, id) ? id : n.kind === "ref" ? Object.values(doc.code.nodes).find((c) => isCall(c) && c.fn === id && inlinable(doc.code, c.id))?.id : undefined;
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
    // Next to the definition it embeds, as well as in the Program tab.
    if (n.kind === "def" && id === ui.def) out.append(h("div", { class: "acts" }, h("button", { class: "btn", type: "button", "data-act": "embed-link", title: "A link for an iframe on another page: this definition's graph, blocks and Run" }, "Copy embed link")));
  }

  // A predicate's results (RESULTS.md): the ports it gives from the others,
  // so it reads and is used as `x, y = polar(length, angle)`.
  const fnBody = n.kind === "def" && n.body ? node(n.body) : null;
  const dt = n.kind === "def" ? info.typeOf.get(id) : undefined, rt = dt ? info.subst.resolve(dt) : null;
  if (n.kind === "def" && fnBody?.kind === "lambda" && fnBody.params.length > 1 && rt?.t === "fn" && info.subst.resolve(rt.ret).t === "con" && (info.subst.resolve(rt.ret) as { id: Id }).id === BOOL) {
    const rs = n.results ?? [];
    out.append(h("div", { class: "sub-head" }, "Results · code.json"),
      h("p", { class: "hint" }, rs.length ? `Gives ${rs.map((r) => names[r] ?? r).join(", ")} from the other ports. Click a port to make it an input or a result.` : "A true or false of its ports. Make some of them results, and it reads as a function that gives them: x, y = polar(length, angle)."),
      h("div", { class: "acts" }, ...fnBody.params.map((q) => {
        const on = rs.includes(q);
        const b = h("button", { class: `btn${on ? " on" : ""}`, type: "button", "aria-pressed": String(on), title: on ? "A result: click to make it an input" : "An input: click to make it a result" }, `${on ? "→ " : ""}${names[q] ?? q}`);
        b.addEventListener("click", () => applyT(T.setResults(doc.code, doc.names.short, info, id, on ? rs.filter((r) => r !== q) : [...rs, q])));
        return b;
      })));
    // Its other directions (POLAR.md, E210b): definitions over the same
    // ports that give others of them, used by a solve given those.
    if (rs.length) {
      const dirs = doc.code.defs.filter((d) => (node(d) as NodeOf<"def">).direction === id);
      const want = new Set(fnBody.params.map((q, i) => (rs.includes(q) ? -1 : i)).filter((i) => i >= 0));
      const ticks = fnBody.params.map((q, i) => {
        const cb = h("input", { type: "checkbox", id: `f-dir-${i}`, checked: want.has(i) }) as HTMLInputElement;
        return { cb, el: h("label", { class: "field check", for: `f-dir-${i}` }, cb, h("span", {}, names[q] ?? `port ${i + 1}`)) };
      });
      const go = h("button", { class: "btn", type: "button" }, "Add a direction");
      go.addEventListener("click", () => runTop(info, Top.addDirection(doc.code, doc.names.short, id, ticks.flatMap((t, i) => (t.cb.checked ? [i] : [])), ""), (r) => { ui.back = [ui.def]; ui.def = r.select; ui.selected = null; }));
      out.append(h("div", { class: "sub-head" }, "Other directions · code.json"),
        h("p", { class: "hint" }, dirs.length ? "Each gives other ports from the rest; a solve given those uses it instead of searching." : `None: a solve of ${names[id] ?? "it"} given its results searches. A direction says how to work out other ports from the rest, as unpolar does for polar.`),
        ...dirs.map((d) => row(pick(d, names[d] ?? "a direction", `gives ${((node(d) as NodeOf<"def">).results ?? []).map((r) => names[r] ?? "?").join(", ")}`))),
        h("p", { class: "hint" }, "The ports a new direction gives:"), ...ticks.map((t) => t.el), h("div", { class: "acts" }, go));
    }
  }
  // A direction of a relation (E210b): which, and back to ordinary.
  if (n.kind === "def" && n.direction) {
    const r = Top.dropDirection(doc.code, doc.names.short, id);
    out.append(h("div", { class: "sub-head" }, "A direction of ", pick(n.direction, names[n.direction] ?? "a relation"), " · code.json"),
      h("p", { class: "hint" }, `The same ports as ${names[n.direction] ?? "it"}, in the same order: a solve of it given this one's inputs calls this instead of searching. They must agree; the law tests check it.`),
      h("div", { class: "acts" }, edit("Make it ordinary", "No longer a direction: a definition like any other, with its results", r, () => runTop(info, r))));
  }

  // A dot: a let's binder, the shared output of its value.
  if (n.kind === "binder" && T.isDot(doc.code, ui.def, id)) {
    const k = T.usesOf(doc.code, id).length;
    const r = T.removeDot(doc.code, doc.names.short, info, ui.def, id);
    out.append(h("div", { class: "sub-head" }, "Dot · code.json"),
      h("p", { class: "hint" }, `${k === 0 ? "Nothing reads it: it is a step done for its effect." : `Feeds ${k} input${k === 1 ? "" : "s"}.`} Drag from the dot in the graph to any input it can reach to share it there. A name is optional${doc.names.short[id] === undefined ? `; without one it shows as ${names[id]}` : ""}.`),
      h("div", { class: "acts" }, h("button", { class: "btn", type: "button", "data-act": "t-undot", disabled: !r.ok, title: r.ok ? "Put the value back on its one wire" : `Can't: ${r.reason}` }, "Remove the dot")));
  }
  if (n.kind === "binder" && names[id] !== "_" && !isTypeParam(id)) {
    const on = isNamed(id);
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
  // A match on values (L164c) takes another value's arm, before the
  // otherwise: its value a literal of the examined type to change (E225).
  const byValue = joinable ? valueArmAdded(joinable) : null;
  if (byValue) out.append(h("div", { class: "sub-head" }, "Values · code.json"), h("div", { class: "acts" },
    edit("Add a value", "Another value's case, before the otherwise: its value and its body to fill", byValue, () => applyT(byValue))));
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

  const isExprNode = ["lit", "ref", "call", "lambda", "match", "fold"].includes(n.kind) && !isUse(n) && !doc.code.defs.includes(id);
  if (isExprNode) {
    const splittable = T.scopeAt(doc.code, ui.def, id).filter((b) => T.dataTypeOf(doc.code, info, b));
    // An input whose type nothing fixes yet splits as any data type the
    // program has, or a list, an optional or a Bool: the split fixes it
    // (BACKLOG I116, MCP-TRIAL-2026-11-01 #6).
    const open = T.scopeAt(doc.code, ui.def, id).filter((b) => T.untyped(info, b));
    const kinds = open.length ? [...new Set([...ownDefs().filter((d) => { const b = defBody(d); return b?.kind === "typedef" && !b.effect && !b.interface; }), ...[CONS, TRUE, SOME].map((v) => info.owner.get(v)).filter((x): x is Id => !!x)])] : [];
    const guessed = open.flatMap((b) => kinds.map((k) => ({ b, k })));
    out.append(h("div", { class: "sub-head" }, "Change meaning · code.json"), h("div", { class: "acts" },
      h("button", { class: "btn", type: "button", "data-act": "copy", title: "Ctrl+C; Ctrl+X cuts" }, "Copy"),
      h("button", { class: "btn", type: "button", "data-act": "t-replace", title: "Pick what goes here instead, from the palette" }, "Replace with…"),
      wrappable(id) ? h("button", { class: "btn", type: "button", "data-act": "t-wrap", title: "Put it inside a call or a function from the palette: it becomes one of its inputs" }, "Wrap in…") : null,
      h("button", { class: "btn danger", type: "button", "data-act": "t-clear" }, "Clear to a hole"),
      isCall(n) && doc.code.nodes[n.fn].kind !== "lambda" ? h("button", { class: "btn", type: "button", "data-act": "t-swap", title: "Keep its inputs and pick another function that takes them" }, "Change the function…") : null,
      splittable.length || guessed.length ? h("button", { class: `btn${ui.mode === "split" ? " on" : ""}`, type: "button", "data-act": "split" }, "Split by cases…") : null));
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
      for (const { b, k } of guessed) {
        const r = T.splitOn(doc.code, doc.names.short, info, id, b, k);
        const btn = h("button", { class: `opt${r.ok ? "" : " no"}`, type: "button", disabled: !r.ok, title: r.ok ? `${namer.name(b)} has no type yet: this makes it a ${names[k] ?? "data type"}` : `Can't: ${r.reason}` },
          h("span", { class: "opt-l" }, `${namer.name(b)} as ${names[k] ?? "?"}`), h("span", { class: "opt-d" }, r.ok ? `one case per ${names[k] ?? "variant"}` : `can't: ${r.reason}`));
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

// A match on values with one more arm: a literal like its first arm's,
// its body a hole. Null for a match on cases.
function valueArmAdded(match: Id): (T.TEdit & { ok: true }) | null {
  const m = node(match);
  const first = m?.kind === "match" ? (node(m.arms[0]) as NodeOf<"arm"> | undefined) : undefined;
  const v = first?.value ? node(first.value) : null;
  if (m?.kind !== "match" || v?.kind !== "lit") return null;
  const nodes = { ...doc.code.nodes }, value = freshId(), arm = freshId(), body = freshId();
  nodes[value] = typeof v.value === "string" && v.of !== INT ? { id: value, kind: "lit", value: "" } : { id: value, kind: "lit", value: 0, ...(v.of ? { of: v.of } : {}) };
  nodes[body] = { id: body, kind: "hole" };
  nodes[arm] = { id: arm, kind: "arm", variant: value, value, binds: [], results: [], body };
  nodes[match] = { ...m, arms: [...m.arms, arm] };
  return { ok: true, code: { nodes, defs: doc.code.defs }, names: doc.names.short, select: value, note: "Added a value's case: give its value, then fill its body." };
}

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
    const f = isCall(n) ? doc.code.nodes[n.fn] : undefined;
    const i = f?.kind === "lambda" ? f.params.indexOf(id) : -1;
    if (i >= 0) return (n as Call).args[i];
  }
  return id;
}

// Selecting, and the part a part is in (editor/selection.ts, E228q).
const { enclosing, menuForSelected, blocksKind, blocksHit, select } = selection({
  doc: () => doc, ui, render: () => render(), typesOf: () => typesOf(), typedPres: () => typedPres(), kindLabel: (id) => kindLabel(id), onePane: () => onePane(), touch: TOUCH,
});

// What Wrap in… applies to: a value in an expression, not a definition's
// whole body's lambda or a step's own let.
function wrappable(id: Id): boolean {
  const n = doc.code.nodes[id];
  return !!n && ["lit", "ref", "call", "lambda", "match", "fold"].includes(n.kind) && !isUse(n) && !doc.code.defs.includes(id) && !(isCall(n) && doc.code.nodes[n.fn]?.kind === "lambda") && defBody(ui.def)?.id !== id;
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
    h("button", { class: "btn", type: "button", "data-act": "embed-link", title: "A link for an iframe on another page: the open definition's blocks and Run" }, "Copy embed link"),
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
  // The program's own effects are answered by a host file outside a
  // handler (FOREIGN.md, L69c): what it gives, read-only, as lab hosts
  // writes it.
  const effects = ownEffects();
  if (effects.length) {
    const host = h("textarea", { id: "f-host", rows: "8", readonly: "", spellcheck: "false" }) as HTMLTextAreaElement;
    host.value = hostSkeleton(doc.code, pres().names, effects);
    out.append(h("label", { class: "field", for: "f-host" }, h("span", {}, "Host · hosts/js.js"), host),
      h("p", { class: "hint" }, `What this program's own ${effects.length === 1 ? "effect" : "effects"} (${effects.map((e) => pres().names[e] ?? e).join(", ")}) ${effects.length === 1 ? "does" : "do"} outside a handler is answered by hosts/js.js beside the program, when it runs with lab run or is built with lab build-web. The editor keeps no host file: this is the one lab hosts writes, to fill in.`));
  }
  return out;
}
// The effects the program declares itself.
function ownEffects(): Id[] {
  return ownDefs().filter((d) => { const b = defBody(d); return b?.kind === "typedef" && !!b.effect; });
}

// A link that embeds the open definition (?embed). An example as shipped
// is named; anything else travels in the link: the program's own nodes,
// names and comments as JSON, deflated, in base64url.
const OWN = (id: Id) => !id.includes(".") && !id.startsWith("@");
async function embedLink(): Promise<string> {
  const base = location.href.split(/[?#]/)[0], def = encodeURIComponent(doc.names.short[ui.def] ?? "");
  if (isExample(doc.program) && !doc.edited) return `${base}?embed&program=${encodeURIComponent(doc.program)}&def=${def}`;
  const json = JSON.stringify({
    code: { nodes: Object.fromEntries(Object.entries(doc.code.nodes).filter(([id]) => OWN(id))), defs: doc.code.defs.filter(OWN) },
    names: Object.fromEntries(Object.entries(doc.names.short).filter(([id]) => OWN(id))),
    comments: doc.comments,
  });
  const packed = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  let bin = "";
  packed.forEach((b) => { bin += String.fromCharCode(b); });
  return `${base}?embed&def=${def}&code=${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
// A code= that doesn't unpack was most likely cut short or changed on the way.
const UNREADABLE = "This link's code can't be read: it may have been cut short or changed when it was copied. Copy embed link, in the Program panel, makes a new one.";
async function unpackSnippet(text: string): Promise<{ code: Code; names: Names; comments: Comments }> {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text());
}
async function copyEmbedLink() {
  const link = await embedLink();
  const copied = await window.navigator.clipboard?.writeText(link).then(() => true, () => false);
  ui.note = `${copied ? "Copied" : "Here's"} a link that embeds ${doc.names.short[ui.def] ?? "this definition"} (add &readonly to stop edits): ${link}`;
  ui.refused = false;
  render();
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
const isNamed = (b: Id) => (doc.layout.named ?? []).includes(b) || (pres().names[b] !== undefined && !(doc.layout.wired ?? []).includes(b));
const asNamed = (bs: Set<Id>, on: boolean): Partial<Layout> => {
  const wired = (doc.layout.wired ?? []).filter((b) => !bs.has(b)), named = (doc.layout.named ?? []).filter((b) => !bs.has(b));
  return on ? { wired, named: [...named, ...bs] } : { wired: [...wired, ...bs], named };
};
function toggleNamed(b: Id) {
  const on = isNamed(b);
  commit({ layout: { ...doc.layout, ...asNamed(new Set([b]), !on) } }, ["layout.json"],
    on ? "Back to wires: one wire from where it's bound to every use. Only the layout changed."
      : "Shown as a let node, with a get node next to every use instead of long wires. Same binding, another look: only the layout changed.");
}

// Every value of the definition (its inputs and its steps' dots) as let and
// get nodes, or every one as wires (BACKLOG E112). A view.
const bindersOf = (d: Id) => subtree(doc.code, d).filter((b) => node(b)?.kind === "binder" && pres().names[b] !== "_");
function allNamed(on: boolean) {
  commit({ layout: { ...doc.layout, ...asNamed(new Set(bindersOf(ui.def)), on) } }, ["layout.json"],
    on ? "Every value is a let node, with a get node at each use. Same program, another look: only the layout changed."
      : "Every value is wires again, from where it's bound to every use. Only the layout changed.");
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
  if (!picked.length || groupable(picked)) return;
  const g = `group-${freshId()}`;
  graph?.unpickAll();
  commit({ layout: { ...doc.layout, groups: { ...(doc.layout.groups ?? {}), [g]: picked }, folded: [...(doc.layout.folded ?? []), g] } }, ["layout.json"],
    `Grouped ${picked.length} into one box, which names what it holds; wires in end on its left, values out leave on its right. Unfold it (▸) to see them in their frame, or Ungroup from its menu. Only the layout changed.`);
}

// The nodes Make it a function takes from a right-click on `id`: the
// picked ones, when it's among them, or else the group it's in, or else
// just it.
function fnSet(id: Id, picked: Id[]): { members: Id[]; what: string; group?: Id } | null {
  if (picked.includes(id)) return { members: picked, what: picked.length > 1 ? `The ${picked.length} picked` : "This node" };
  // A menu opened on a node beside the picked ones takes it with them.
  if (picked.length) return { members: [...picked, id], what: `The ${picked.length} picked and this one` };
  const g = Object.entries(doc.layout.groups ?? {}).find(([, ms]) => ms.includes(id) || ms.some((m) => subtree(doc.code, m).includes(id)));
  if (g) return { members: g[1], what: "The group it's in", group: g[0] };
  return doc.code.nodes[id] ? { members: [id], what: "This node" } : null;
}

// A part of the Blocks pane as the nodes a function is made of: the calls
// written inside it, itself first (E208). A name or a number alone is
// none: there's nothing to make a function of.
function partCalls(id: Id): Id[] {
  return subtree(doc.code, id).filter((x) => isCall(doc.code.nodes[x]));
}

function ungroup(g: Id) {
  const { [g]: _, ...groups } = doc.layout.groups ?? {};
  commit({ layout: { ...doc.layout, groups, folded: (doc.layout.folded ?? []).filter((x) => x !== g) } }, ["layout.json"], "Ungrouped: what it held stays where it was. Only the layout changed.");
}

// A group made a function called where it was (BACKLOG E146): the code
// changes, and the group's frame gives way to the function's own, folded
// if the group was.
function groupToFunction(info: T.Info, g: Id, definition = false) {
  const members = doc.layout.groups?.[g];
  if (!members) return;
  const r = (definition ? T.definitionFrom : T.makeFunction)(doc.code, doc.names.short, info, ui.def, members);
  const { [g]: _, ...groups } = doc.layout.groups ?? {};
  const was = doc.layout.folded ?? [];
  const folded = was.filter((x) => x !== g);
  applyT(r, undefined, undefined, undefined, { ...doc.layout, groups, folded });
}

// A framed part (a function, an action, a case of a match or a fold)
// whose body is more than BIG deep or wide starts folded in the graph
// (Ersagun 2026-10-29: "max(recursive depth, recursive breadth) of a
// lambda decides whether it is folded by default. All framed parts").
// Both count the nodes the graph draws, through the frames inside: depth
// is the longest chain from the body's result to a leaf, breadth the most
// nodes side by side at one level. A call's function is the call's node,
// not one below it. `x * 2 + 1` is 3 deep and 2 wide and stays open;
// `f(g(h(x)))` is 4 deep and starts folded, and so does `f(a, b, c, d)`,
// 4 wide. The definition's own frame never folds. Opened, it stays open:
// layout.json's unfolded.
const BIG = 3;
const deepCache = new WeakMap<Code, Map<Id, Id[]>>();
function deepFunctions(def: Id): Id[] {
  const byDef = deepCache.get(doc.code) ?? new Map<Id, Id[]>();
  deepCache.set(doc.code, byDef);
  if (byDef.has(def)) return byDef.get(def)!;
  const out: Id[] = [];
  const kids = (id: Id): Id[] => {
    const n = node(id);
    if (!n) return [];
    // A use's parts as a solve's were: what it's given, its body.
    if (isUse(n)) return children(n).filter((c) => node(c)?.kind !== "binder" && c !== (n as { fn?: Id }).fn);
    switch (n.kind) {
      case "call": return node(n.fn)?.kind === "ref" ? n.args : [n.fn, ...n.args];
      case "lambda": case "arm": return [n.body];
      case "match": return [n.scrutinee, ...n.arms, ...(n.otherwise ? [n.otherwise] : [])];
      default: return children(n).filter((c) => node(c)?.kind !== "binder");
    }
  };
  const big = (body: Id) => {
    let level = [body], deep = 0, wide = 0;
    while (level.length) { deep++; wide = Math.max(wide, level.length); level = level.flatMap(kids); }
    return Math.max(deep, wide) > BIG;
  };
  // A function given its arguments on the spot is a let, drawn as dots, not a frame.
  const walk = (id: Id, top: boolean) => {
    const n = node(id);
    if (!n) return;
    if (n.kind === "lambda") {
      let body = n.body;
      for (let b = node(body); b?.kind === "lambda"; b = node(body)) body = b.body;
      if (!top && big(body)) out.push(id);
      return walk(body, false);
    }
    if (isCall(n) && node(n.fn)?.kind === "lambda") { n.args.forEach((a) => walk(a, false)); return walk((node(n.fn) as NodeOf<"lambda">).body, false); }
    if (n.kind === "arm" && big(n.body)) out.push(id);
    for (const c of children(n)) walk(c, false);
  };
  const b = defBody(def);
  if (b) walk(b.id, true);
  byDef.set(def, out);
  return out;
}

// What the graph draws folded: what was folded, and deep functions not opened.
function graphFolded(): Set<Id> {
  const open = new Set(doc.layout.unfolded ?? []);
  return new Set([...(doc.layout.folded ?? []), ...deepFunctions(ui.def).filter((f) => !open.has(f))]);
}

// A frame drawn folded into one box, or open. A view.
function toggleFolded(f: Id) {
  const now = doc.layout.folded ?? [];
  const on = graphFolded().has(f), deep = deepFunctions(ui.def).includes(f);
  const opened = (doc.layout.unfolded ?? []).filter((x) => x !== f);
  const unfolded = on && deep ? [...opened, f] : opened;
  // Opened, it's selected, so it's drawn over its neighbours.
  if (on && doc.code.nodes[f]) ui.selected = f;
  commit({ layout: { ...doc.layout, folded: on ? now.filter((x) => x !== f) : deep ? now : [...now, f], ...(unfolded.length || doc.layout.unfolded ? { unfolded } : {}) } }, ["layout.json"],
    on ? "Unfolded where the box was, drawn over its neighbours while it's selected. Only the layout changed."
      : "Folded into one box: wires in end on its left, values out leave on its right. Click ▸ to unfold. Only the layout changed.");
}

// ---------------------------------------------------------------- the graph's menu
// Right-click in the graph or the Blocks pane (editor/graphMenu.ts, E228n).
const { graphMenu, menuAction } = graphMenuOf({
  doc: () => doc, ui, graph: () => graph, view: () => view, undo, applyT: (e) => applyT(e), commit, render, select, openDef, calleeDef, typesOf, typedPres, defBody, stepAt, lkey, isNamed,
  bindersOf, fnSet, groupable, groupPicked, groupToFunction, ungroup, partCalls, wrappable, graphFolded, toggleFolded, toggleInline, toggleNamed, allNamed, paletteFor, runTop, fillPalette,
  setReveal: (f) => { revealNext = f; }, setSwapped: (s) => { swapped = s; }, setWrapping: (w) => { wrapping = w; },
});

function toggleInline(call: Id) {
  const now = doc.layout.inline ?? [];
  const on = now.includes(call);
  // Collapsing a call collapses what was shown inline inside it too.
  const inline = on ? now.filter((x) => x !== call && !x.endsWith(`~${call}`)) : [...now, call];
  ui.selected = call;
  // The whole graph, which grows (or shrinks) by the callee's body.
  revealNext = WHOLE;
  commit({ layout: { ...doc.layout, inline } }, ["layout.json"],
    on ? "Collapsed the call. Only the layout changed." : "Showing the definition inline: the call is drawn as its body, with the arguments flowing into its inputs. It's a view: the layout changed, the code didn't.");
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

// A multivector of an algebra the program writes down, in words: "a
// vector", "even (a rotor or motor)", or its blades (GRADES.md, L43d).
const algebrasFor = new WeakMap<T.Info, Map<Id, Algebra>>();
function kindOf(info: T.Info, v: Value): string | null {
  const d = v as Data;
  if (!d || typeof d !== "object" || !("tag" in d)) return null;
  let as = algebrasFor.get(info);
  if (!as) { try { as = algebrasOf(doc.code, info); } catch { as = new Map(); } algebrasFor.set(info, as); }
  const alg = [...as.values()].find((a) => a.variant === d.tag && d.fields.length === a.parts && d.fields.every((x) => typeof x === "number"));
  return alg ? describeMask(alg, maskOfValue(v)) : null;
}

function graphHooks(info: T.Info) {
  return {
    selected: ui.selected,
    page: pageMain(ownDefs(), info, pres().names) === ui.def,
    select: (id: Id | null) => select(id),
    open: (id: Id) => { const d = calleeDef(id); if (d && d !== ui.def) openDef(d); },
    turn: (id: Id) => {
      const up = parentOf(doc.code, id);
      if (up?.slot === "args" && T.turnable(doc.code, up.parent)) return (applyT(T.turnAround(doc.code, doc.names.short, info, up.parent, up.index!)), true);
      // The use itself (one with no body, L211), or the one binding id.
      const s = isUse(doc.code.nodes[id]) ? doc.code.nodes[id] : Object.values(doc.code.nodes).find((n) => isUse(n) && Object.values(n.binds ?? {}).includes(id));
      return s ? (applyT(T.turnBack(doc.code, doc.names.short, info, s.id)), true) : false;
    },
    // Whether a wire can go there, asked for each input a drag passes: the
    // edit wired straight in, one check, not Delete's loose part and then
    // the wire (two more). The loose part never stops a program (I161).
    canUse: (b: Id, slot: Id) => { const r = T.useVar(doc.code, doc.names.short, info, ui.def, b, slot); return r.ok ? null : r.reason; },
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
        // A filled input is checked on the drop: the check here runs on
        // every input passed over, and swapping costs several checks.
        if (node(slot)?.kind !== "hole") return null;
        const r = T.looseOver(doc.code, doc.names.short, info, ui.def, doc.loose ?? {}, doc.home ?? {}, part, slot);
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
      if (!part) return void applyT(shareOver(info, from, slot));
      // Wired in, the part's last node takes the input's id: it stays drawn
      // where it was, not where the input's old value was (Ersagun
      // 2026-10-27: the two "teleported" into each other's places).
      const b = (node(part) as NodeOf<"def">).body, n = b ? node(b) : undefined;
      const root = n?.kind === "lambda" ? n.body : b;
      const was = root ? graph?.posOf(root) : undefined;
      void applyT(T.looseOver(doc.code, doc.names.short, info, ui.def, doc.loose ?? {}, doc.home ?? {}, part, slot), undefined, was ? { [slot]: was } : undefined);
    },
    values: (() => {
      const tr = traced(info);
      const show = shower(doc.code, info, pres().names);
      return tr ? new Map([...tr.values].map(([id, v]) => [id, show(v, true)])) : undefined;
    })(),
    kinds: (() => {
      const tr = traced(info);
      if (!tr) return undefined;
      const out = new Map<Id, string>();
      for (const [id, v] of tr.values) { const k = kindOf(info, v); if (k) out.set(id, k); }
      return out;
    })(),
    at: Object.fromEntries(Object.entries(doc.layout.at ?? {}).filter(([k]) => k.startsWith(`${ui.def}/`)).map(([k, v]) => [k.slice(ui.def.length + 1), v])),
    moved: (to: Record<Id, Pos>, note?: string) => {
      const n = Object.keys(to).length;
      if (!n) { ui.note = note ?? "Nothing moved."; ui.touched = []; return render(); }
      commit({ layout: { ...doc.layout, at: { ...(doc.layout.at ?? {}), ...Object.fromEntries(Object.entries(to).map(([k, v]) => [lkey(k), v])) } } }, ["layout.json"],
        note ?? `Moved ${n === 1 ? "a node" : `${n} nodes`}. Where nodes sit is layout; the code is untouched.`);
    },
    sizes: Object.fromEntries(Object.entries(doc.layout.size ?? {}).filter(([k]) => k.startsWith(`${ui.def}/`)).map(([k, v]) => [k.slice(ui.def.length + 1), v])),
    resized: (id: Id, to: { w: number; h: number } | null) => {
      const { [lkey(id)]: _, ...rest } = doc.layout.size ?? {};
      commit({ layout: { ...doc.layout, size: to ? { ...rest, [lkey(id)]: to } : rest } }, ["layout.json"],
        to ? "Resized a node. Its size is layout, not code; double-click the corner to give it its own size again." : "The node has its own size again.");
    },
    spread: (to: Record<Id, Pos>, sizes: Record<Id, { w: number; h: number } | null>) => {
      const size = { ...(doc.layout.size ?? {}) };
      for (const [id, z] of Object.entries(sizes)) { if (z) size[lkey(id)] = z; else delete size[lkey(id)]; }
      const n = Object.keys(to).length, r = Object.values(sizes).filter(Boolean).length;
      commit({ layout: { ...doc.layout, at: { ...(doc.layout.at ?? {}), ...Object.fromEntries(Object.entries(to).map(([k, v]) => [lkey(k), v])) }, size } }, ["layout.json"],
        `Spread the picked: ${n === 1 ? "a node" : `${n} nodes`} moved${r ? `, ${r} resized` : ""}. Only the layout changed; hold Shift while dragging a corner to resize them too.`);
    },
    named: new Set(bindersOf(ui.def).filter(isNamed)),
    loose: looseOf(doc.code, doc.loose ?? {}, ui.def),
    home: doc.home ?? {},
    folded: graphFolded(),
    fold: toggleFolded,
    groups: doc.layout.groups,
    tree: new Set(doc.layout.tree ?? []),
    fanned: new Set(doc.layout.fanned ?? []),
    fan: (v: Id) => {
      const now = doc.layout.fanned ?? [], on = now.includes(v);
      commit({ layout: { ...doc.layout, fanned: on ? now.filter((x) => x !== v) : [...now, v] } }, ["layout.json"],
        on ? "Bundled into one wire. Only the layout changed." : "Fanned out, a wire per part. Only the layout changed.");
    },
    menu: (target: MenuTarget, at: Pos, world: Pos) => { ui.menu = { target, x: at.x, y: at.y, world }; ui.query = ""; render(); document.getElementById("m-query")?.focus(); },
    reorder: (item: Id, onto: Id) => {
      const a = T.rowOfItem(doc.code, item), b = T.rowOfItem(doc.code, onto);
      if (a && b && a.row.root === b.row.root) applyT(T.moveItemTo(doc.code, doc.names.short, info, a.row, a.at, b.at));
    },
    addFrom: (row: Id, from: Id, binding: boolean) => { const r = T.rowAt(doc.code, row); if (r) applyT(T.addItemFrom(doc.code, doc.names.short, info, ui.def, r, from, binding)); },
    addItem: (row: Id) => { const r = T.rowAt(doc.code, row); if (r && applyT(T.addItem(doc.code, doc.names.short, info, r, r.items.length))) document.getElementById("f-query")?.focus(); },
  };
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
  if (!body || body.kind === "typedef") return h("p", { class: "hint" }, body?.kind === "typedef" && body.interface ? "An interface doesn't run; each implementation says how its type does the operations, and functions call them." : body?.kind === "typedef" && body.effect ? "An effect doesn't run; functions perform its operations, and a handler answers them." : "A data type doesn't run; its constructors are called from functions.");
  // A test (its row has Check) runs as lab test runs it: on its saved
  // inputs, then on small values, and a failing expect shows here with the
  // inputs it failed on (T7d).
  if (z?.t === "fn" && z.eff.effs.includes(CHECK) && !errorsIn(info) && !holesIn(info)) return lawPanel(info, box, { code: prog(), names: pres().names, def: ui.def, examples: doc.examples ?? {}, world: quietWorld() });
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
    // The program's own effect is the host's to answer outside a handler
    // (FOREIGN.md, L69c), and the editor has no host file.
    const own = needs.filter((e) => ownEffects().includes(e));
    if (own.length === needs.length) box.append(h("p", { class: "hint" }, `${namer.name(ui.def)} needs its host: it performs ${effs}, this program's own effect, which hosts/js.js beside the program answers when it runs with lab run. The editor has no host file, so it doesn't run here; the Program tab shows what one gives. Or call it inside `, h("code", {}, `handle ${effs}`), "."));
    else box.append(h("p", { class: "hint" }, `${namer.name(ui.def)} performs ${effs}, and nothing here answers it. To run it, call it inside `, h("code", {}, `handle ${effs}`), "."));
  } else if (choice) {
    box.append(h("p", { class: "hint" }, `${namer.name(ui.def)} may give no answer, or more than one (Choice), so it doesn't run as it is. To run it, say which you want: call it inside `,
      h("code", {}, "first(…, else …)"), ", ", h("code", {}, "all"), ", ", h("code", {}, "count"), " or ", h("code", {}, "optional"), "."));
  } else if (action || value && ui.def === defNamed("main") || z?.t === "fn" && z.params.length === 1 && runGiven()) {
    // main runs whatever it is: a value's Run gives the value. One that
    // reads the command line runs on the example's own arguments (E212).
    const going = ui.output?.def === ui.def && ui.output.running;
    const given = action || value ? null : runGiven();
    const label = [namer.name(ui.def), ...given?.args ?? []].join(" ");
    if (readsInput() && !going && ui.allowing !== ui.def) box.append(stdinBox(), h("p", { class: "hint" }, `What ${namer.name(ui.def)} reads as standard input, as lab run reads what is piped to it.`));
    box.append(going ? h("button", { class: "btn", type: "button", "data-act": "t-stop" }, `Stop ${namer.name(ui.def)}`)
      : ui.allowing === ui.def ? permissionsPanel(namer, permissionsAsked(ui.def)) : h("button", { class: "btn", type: "button", "data-act": "t-run" }, `Run ${label}`));
    if (given) box.append(h("p", { class: "hint" }, `As lab run gives it: ${given.args.join(", ")}. ${Object.keys(given.files).join(", ")} ${Object.keys(given.files).length > 1 ? "come" : "comes"} with the example; what the run writes stays in this browser.`));
    if (ui.output?.def === ui.def) {
      // What it prints is read out as it comes (a log), and a failure at once.
      box.append(h("pre", { class: "text out", role: "log", "aria-live": "polite", "aria-label": `What ${namer.name(ui.def)} printed` }, ui.output.lines.join("\n") || (going ? "Running…" : "(no output)")));
      if (ui.output.error) box.append(h("p", { class: "status-line bad", role: "alert" }, ui.output.error));
      if (ui.output.stuck) box.append(stuckView(ui.output.stuck));
      if (ui.output.profile) box.append(profileView(namer, ui.output.profile, doc.code, pick));
      if (ui.output.compiled) box.append(h("p", { class: "hint", title: "main compiled to JavaScript, as Open in a tab and lab compile do: the same output, much faster than the evaluator, but with no record of where the run went" }, "Ran compiled."));
    }
  } else if (z?.t === "fn" && z.eff.effs.some((e) => WORLD.includes(e))) {
    // Run backwards is a search, and a search would touch the world once
    // per guess: say so, instead of a panel that can only fail.
    const effs = z.eff.effs.filter((e) => WORLD.includes(e)).map((e) => pres().names[e] ?? e).join(" and ");
    box.append(h("p", { class: "hint" }, `${namer.name(ui.def)} performs ${effs}, which can't be undone, so it doesn't run backwards: it runs forwards where it's called.`));
  } else if (z?.t === "fn") box.append(backwardsPanel(namer, info));
  // Values on the wires: a function shows them for the values above; an
  // action, once you ask (it may take a while, and its printing is left out).
  const ex = doc.examples?.[ui.def];
  const tr = traced(info);
  if ((action || value) && !needs.length) box.append(h("div", { class: "acts" },
    h("button", { class: "btn", type: "button", "data-act": "t-values", title: "Run it and show what every node made, printing left out" }, ex ? "Update values" : "Show values"),
    ex ? h("button", { class: "btn", type: "button", "data-act": "t-novalues" }, "Hide values") : null));
  else if (z?.t === "fn" && !EMBED) box.append(h("p", { class: "hint" }, ex ? "The graph shows what every node makes of these values. They're saved in examples.json, not in the code."
    : "The graph shows what every node makes of these values. Change one to keep values of your own, in examples.json, not in the code."));
  if (tr?.result !== undefined && (action || value)) box.append(h("div", { class: "hint" }, choice ? "Its first answer: " : "Gives ", valueView(tr.result, doc.code, pres().names, shower(doc.code, info, pres().names))));
  // A hole isn't a failure: it is where the program isn't written yet.
  // Nor is a run on values you didn't give: they're only a starting point.
  // Nor the graph's own time limit (E207): Run main runs it in full. Nor
  // standard input, which a page hasn't (calc's main reads it, E211).
  if (tr?.error) box.append(tr.error.message === "reached a hole"
    ? h("p", { class: "hint" }, "Values show once the holes on their way are filled.")
    : !doc.examples?.[ui.def] || LIMIT.test(tr.error.message) || /the graph waits|has no standard input/.test(tr.error.message) ? h("p", { class: "hint" }, `No values on the wires: ${tr.error.message}.`)
    : h("p", { class: "status-line bad" }, `Values stopped: ${tr.error.message}.`));
  return box;
}

const { page, pageSection, pictureSection, savePage } = pagePanels({
  doc: () => doc, prog: () => prog(), pres: () => pres(), ownDefs: () => ownDefs(), typesOf, render, ui,
  errorsIn, holesIn, noteOf, noteView, titleOf, slug, pins: () => heldPins?.all ?? doc.signatures ?? NO_PINS,
});

// An action's values come from running it, so they're asked for.
function showValues() {
  commit({ examples: { ...(doc.examples ?? {}), [ui.def]: [] } }, ["examples.json"], "Values on the wires: each node shows what it made. Printing is left out.");
}

function hideValues() {
  const examples = { ...(doc.examples ?? {}) };
  delete examples[ui.def];
  commit({ examples }, ["examples.json"], "Values hidden.");
}

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

// The effects a definition handles for a function it's given (Pig's `hold
// at` answers the Decide its `game` performs): given main's own function,
// a run here can't handle them, since that function performs them in
// main's run (BACKLOG I124).
function handledForArgs(z: Type | null): Id[] {
  if (z?.t !== "fn") return [];
  const own = new Set(z.eff.effs);
  return [...new Set(z.params.flatMap((p) => (p.t === "fn" ? p.eff.effs : [])))].filter((e) => !own.has(e) && e !== CHOICE && e !== DIVERGE);
}

function traced(info: T.Info): Trace | null {
  const texts = traceInputs(info);
  if (!texts) return null;
  // What performs an effect of your own has values only inside a handler.
  const t = info.typeOf.get(ui.def);
  const z = t ? info.subst.zonk(t) : null;
  if (z?.t === "fn" && needsHandling(z).some((e) => e !== CHOICE)) return null;
  if (handledForArgs(z).length) return null;
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
      : boundedTrace(info, args.map((a) => (a as { value: Value }).value)));
  }
  return m.get(key)!;
}

// Values on the wires come from a run on the page's own thread, so one
// on values nobody gave (main's, say) stops after TRACE_MS: Countdown's
// solutions, opened with main's numbers, would otherwise hold the page for
// the whole search (BACKLOG I23). Values you gave, and a definition with
// no inputs, get longer, GIVEN_MS (E207): one that loops is already kept
// from running here (the termination check says it might not finish, and
// that stays so), but one that finishes after minutes held the page, on
// every version of the code.
const TRACE_MS = 200, GIVEN_MS = 3000;
function boundedTrace(info: T.Info, args: Value[]): Trace {
  const body = defBody(ui.def), copy = body ? mainCopies.get(doc.code)?.get(body.id) : undefined;
  const given = !!doc.examples?.[ui.def] || !(body as NodeOf<"lambda">).params.length;
  if (given && info.divergent.has(ui.def)) return trace(doc.code, info, ui.def, args, quietWorld(), undefined, !!copy);
  const ms = given ? GIVEN_MS : TRACE_MS, end = performance.now() + ms;
  const slow = () => Object.assign(new OutOfSteps(), { message: `it runs longer than the ${given ? `${ms / 1000} s` : `${ms} ms`} the graph waits; Run main runs it in full` });
  return trace(doc.code, info, ui.def, args, quietWorld(), () => { if (performance.now() > end) throw slow(); }, !!copy);
}

// Run main (editor/runPanel.ts, E228i).
const { stopRun, endRun, runGiven, permissionsAsked, permissionsPanel, runTyped, readsInput, stdinBox } = runPanel({
  doc: () => doc, ui, prog: () => prog(), pres: () => pres(), typesOf: () => typesOf(), titleOf, render: () => render(),
  defNamed, pins: () => heldPins?.all ?? doc.signatures ?? NO_PINS,
});

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

// The button the keyboard goes to when the one it was on is gone.
const FOCUS_NEXT: Record<string, string> = { "t-run": "t-stop", "t-stop": "t-run", "t-allow-run": "t-stop" };

// On a narrow screen a cycling group shows only its choice, and tapping it
// goes to the next (the top bar then fits without scrolling).
const cycling = (el: HTMLElement) => (el.classList.add("cycle"), el);
// What each switch is for, said where it's hovered (E234: "layer" and
// "style" said nothing).
const SEG_TITLES: Record<string, string> = {
  layer: "Which names to show: short ones, or longer descriptive ones. Same code either way",
  style: "How the text writes operators: a · b, a * b, or (* a b). Same code either way",
};
function seg(name: string, value: string, options: [string, string][]) {
  return h("div", { class: "seg", role: "group", "aria-label": SEG_TITLES[name] ?? name, ...(SEG_TITLES[name] ? { title: SEG_TITLES[name] } : {}) },
    ...options.map(([v, label]) => h("button", { type: "button", class: v === value ? "on" : "", "data-set": name, "data-value": v, "aria-pressed": String(v === value) }, label)));
}

// The keyboard back in the program, after an edit made from a field: Tab
// goes on from the part just edited.
function toProgram() {
  const blocks = document.querySelector<HTMLElement>(".blocks-wrap");
  if (blocks) blocks.focus({ preventScroll: true });
  else (document.activeElement as HTMLElement | null)?.blur();
}


// ---------------------------------------------------------------- guide
//
// Every graph uses the same few things, so they're explained once, each with
// a sample drawn with the graph's own styles. One word per thing, used
// everywhere: if two things look the same, they are the same.

const GUIDE_SEEN = "projectional-guide-seen";
// The guide is a tab in the side column, open on a first visit, so the
// graph keeps its room.
if (!EMBED) try { if (!localStorage.getItem(GUIDE_SEEN)) { ui.panel = "guide"; localStorage.setItem(GUIDE_SEEN, "1"); } } catch { ui.panel = "guide"; }


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

const { navigator } = navigatorPanel({
  doc: () => doc, docs: () => docs, ui, ownDefs: () => ownDefs(), defBody: (d) => defBody(d), titleOf, initialFor: (k) => initialFor(k), isExample: (k) => isExample(k),
  examples: () => EXAMPLES, mine: MINE, isLibrary: (id) => !!BASE.nodes[id],
});

// The dock's sizes: the outline's and the side's widths and the text pane's
// height. Dragging a gutter sets them; this browser remembers them.
const DOCK = "projectional-dock";
const dock: Record<string, number> = (() => { try { return JSON.parse(localStorage.getItem(DOCK) ?? "{}"); } catch { return {}; } })();
// A page shown in Run gets a wider side of its own, page-w, so it isn't a
// narrow strip five screens tall (QA10 M1); dragging it sets that width.
const PAGE_W = 560;
const dockStyle = (page: boolean) => Object.entries({ ...dock, ...(page ? { "side-w": dock["page-w"] ?? PAGE_W } : {}) })
  .filter(([k]) => k !== "page-w").map(([k, v]) => `--${k}: ${v}px`).join("; ");
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
  const limit = k === "text-h" ? [80, grid.clientHeight - 200] : k === "nav-w" ? [140, 420] : [240, k === "page-w" ? 960 : 640];
  g.classList.add("dragging");
  const mv = (ev: PointerEvent) => {
    const d = k === "text-h" ? e.clientY - ev.clientY : k === "nav-w" ? ev.clientX - e.clientX : e.clientX - ev.clientX;
    dock[k] = Math.round(Math.min(limit[1], Math.max(limit[0], start + d)));
    grid.style.setProperty(`--${k === "page-w" ? "side-w" : k}`, `${dock[k]}px`);
  };
  follow(e, mv, () => {
    g.classList.remove("dragging");
    try { localStorage.setItem(DOCK, JSON.stringify(dock)); } catch {}
  });
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
    // A right-click menu that can't be built takes only itself away: the
    // program is drawn again without it, and the status line says what broke.
    if (ui.menu) {
      ui.menu = null;
      ui.note = `That menu failed to open (${e instanceof Error ? e.message : String(e)}). It's a bug in the editor; the program is untouched.`;
      ui.refused = true;
      return render();
    }
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
  // A button that had the keyboard keeps it across the redraw, or hands it
  // to the one standing in for it: Run becomes Stop and back (E231c).
  const act = (document.activeElement as HTMLElement | null)?.dataset?.act;
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
    ? h("div", { class: "blocks-wrap", tabindex: "0", "aria-label": "The program: Tab steps through its parts, Enter edits one, Shift+F10 or the Menu key opens its menu" }, blocksOf(info), ...looseBlocks(info))
    : h("pre", { class: "text" }, textPanel(info));
  const panels: [UI["panel"], string, () => Kid[]][] = [
    ["node", ui.mode === "new-def" ? "New" : ui.selected ? "Selected" : "Definition", () => [typedInspector(namer, typedPres(), info), definitionPanel(p)]],
    ["program", "Program", () => [programPanel()]],
    ["checks", "Checks", () => [typedChecks(namer, info)]],
    ["files", "Files", () => [filesPanel()]],
    ["guide", "Guide", () => [guide()]],
  ];
  const shown = panels.find(([k]) => k === ui.panel) ?? panels[0];
  // The program is a page, shown in Run (pageSection): the side is wider.
  const onPage = !errorsIn(info) && !holesIn(info) && !!pageMain(ownDefs(), info, pres().names);
  const status = h("div", { class: `status${ui.touched.length ? " live" : ""}${ui.refused ? " refused" : ""}`, role: "status", title: ui.note }, ui.note);
  const restore = () => {
    SCROLLERS.forEach((q, k) => document.querySelectorAll(q).forEach((g, i) => { if (scroll[k][i]) [g.scrollLeft, g.scrollTop] = scroll[k][i]; }));
    if (focused) document.getElementById(focused)?.focus();
    else if (act) {
      const q = (a: string) => document.querySelector<HTMLElement>(`[data-act="${a}"]`);
      (q(act) ?? q(FOCUS_NEXT[act] ?? ""))?.focus({ preventScroll: true });
    }
  };

  // Embedded: the definition's graph over its blocks, as the editor shows
  // both, with what's selected (a hole's palette) under them; Run is the
  // other tab, so the frame needn't hold everything at once (Ersagun
  // 2026-10-30: "The embeds are too tall").
  if (EMBED && unpacking) return void app.replaceChildren(h("p", { class: "status" }, "Opening the snippet…"));
  if (EMBED) {
    app.replaceChildren(
      h("main", { class: "embed" },
        h("div", { class: "text-head" }, h("h2", {}, namer.name(ui.def)),
          h("a", { class: "btn open", href: `${location.href.split(/[?#]/)[0]}?${ASKED.has("code") ? `code=${ASKED.get("code")}` : `program=${encodeURIComponent(doc.program)}`}&def=${encodeURIComponent(doc.names.short[ui.def] ?? "")}`, target: "_blank", rel: "noopener" }, "Open in the editor")),
        h("div", { class: "ins-tabs", role: "tablist" }, ...([["code", "Code"], ["run", "Run"]] as const).map(([k, label]) =>
          h("button", { type: "button", role: "tab", class: k === embedTab ? "on" : "", "aria-selected": String(k === embedTab), "data-embed-tab": k }, label))),
        ...(embedTab === "run"
          // The page runs only in its main's embed: a data type's embed
          // (Tumble's Board) has nothing to restart or save.
          ? [h("section", { class: "panel" }, pictureSection(info), pageMain(ownDefs(), info, pres().names) === ui.def ? pageSection(info) : null, typedRunPanel(namer, info))]
          : [h("section", { class: "panel p-graph", "aria-label": "Graph" }, h("div", { class: "graph-host" }, graphOf(info))),
            h("section", { class: "panel p-text", "aria-label": "Text" }, h("div", { class: "body" }, textView)),
            ui.selected && !READONLY ? h("section", { class: "panel", "aria-label": "Selected" }, typedInspector(namer, typedPres(), info)) : null])),
      // The opening hint takes a line of a small frame: only a real note shows.
      ...(ui.note === OPENING ? [] : [status]));
    return restore();
  }

  app.replaceChildren(
    h("header", { class: "bar" },
      h("div", { class: "brand" }, h("strong", {}, "Ters"), h("span", { title: "A program is stored as a tree of nodes, not as text: the graph and the text below are two views of that one tree" }, "the program is the tree")),
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
          h("a", { class: "btn", href: "learn.html", title: "Learn the language: pick where to start, from a five-year-old's first steps to the whole language (LEARN.md)" }, "Learn"),
          h("a", { class: "btn", href: "tutorial.html#credits" }, "Credits"),
          h("a", { class: "btn", href: "reactive.html", title: "Another page of examples: values that update by themselves when what they depend on changes, as in a spreadsheet (the Cells effect)" }, "Cells")))),
    h("main", { class: "grid is-typed", style: dockStyle(onPage), "data-pane": ui.pane },
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
          sameLine(namer),
          h("div", { class: "body" }, textView))),
      h("div", { class: "gutter", "data-gutter": onPage ? "page-w" : "side-w", style: "grid-area: g2", "aria-hidden": "true" }),
      h("aside", { class: "side" },
        // A helper's own Run comes first; the page, still running, sits
        // under it (I76).
        h("section", { class: "panel" }, h("h2", {}, "Run"), pictureSection(info),
          ...(info && pageMain(ownDefs(), info, pres().names) !== ui.def ? [typedRunPanel(namer, info), pageSection(info)] : [pageSection(info), typedRunPanel(namer, info)])),
        h("section", { class: "panel", "aria-label": shown[1] },
          h("div", { class: "ins-tabs", role: "tablist" }, ...panels.map(([k, label]) =>
            h("button", { type: "button", role: "tab", class: k === shown[0] ? "on" : "", "aria-selected": String(k === shown[0]), "data-panel": k }, label))),
          ...shown[2]()))),
    status,
    // At phone width one pane at a time, picked here (page.html).
    h("nav", { class: "panes", "aria-label": "Panes" }, ...([["nav", "Programs"], ["graph", "Graph"], ["text", "Text"], ["side", "Run & more"]] as const).map(([k, label]) =>
      h("button", { type: "button", class: k === ui.pane ? "on" : "", "aria-pressed": String(k === ui.pane), "data-pane": k }, label))),
  );
  restore();
}

// A press outside the menu closes it, before anything else sees the press.
document.addEventListener("pointerdown", (e) => {
  if (ui.menu && !(e.target as HTMLElement).closest(".ctx-menu")) { ui.menu = null; document.querySelector(".ctx-menu")?.remove(); }
}, true);

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const mi = t.closest<HTMLElement>("[data-menu]");
  if (mi) return menuAction(mi.dataset.menu!, mi.dataset.target || undefined);
  // A group's title in the blocks folds it, there and in the graph.
  const fold = t.closest<HTMLElement>(".blocks-wrap [data-fold]");
  if (fold) return toggleFolded(fold.dataset.fold!);
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
  const etab = t.closest<HTMLElement>("[data-embed-tab]");
  if (etab) { embedTab = etab.dataset.embedTab as typeof embedTab; return render(); }
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
    if (a === "embed-link") return void copyEmbedLink();
    if (a === "delete-program") return deleteProgram();
    if (a === "t-swap" && ui.selected) return menuAction("swap", ui.selected);
    if (a === "t-replace" && ui.selected) return menuAction("replace", ui.selected);
    if (a === "t-wrap" && ui.selected) return menuAction("wrap", ui.selected);
    if (a === "t-clear" && ui.selected && typesOf()) return void applyT(T.toHole(doc.code, doc.names.short, typesOf()!, ui.selected));
    if (a === "more") { const open = !!document.querySelector(".bar")?.classList.toggle("more-open"); act.setAttribute("aria-expanded", String(open)); return; }
    if (a === "split") { ui.mode = ui.mode === "split" ? null : "split"; return render(); }
    if (a === "t-run" && typesOf()) {
      // A program opened from a file asks first (E229), once.
      const asked = permissionsAsked(ui.def);
      if (asked.some((e) => !doc.allowed?.includes(e) && !doc.denied?.includes(e))) { ui.allowing = ui.def; return render(); }
      return runTyped();
    }
    if (a === "t-allow-run") {
      const boxes = [...document.querySelectorAll<HTMLInputElement>("[data-allow]")];
      doc = { ...doc, allowed: boxes.filter((b) => b.checked).map((b) => b.dataset.allow!), denied: boxes.filter((b) => !b.checked).map((b) => b.dataset.allow!) };
      docs[doc.program] = doc;
      ui.allowing = null;
      save();
      return runTyped();
    }
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
  if (e.key === "Escape" && cancelPick()) return toProgram();
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
  // In a field whose text is still what it was drawn with (a rename just
  // saved, the palette's empty search box on a hole just added: I127), the
  // browser has nothing of its own to undo, so the editor's Undo takes it:
  // the rename, or the hole, is undone.
  const committed = !!field && field.value === field.defaultValue;
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
  if (inProgram && ui.selected && e.altKey && e.key === "ArrowUp") {
    const outer = enclosing(ui.selected);
    if (outer) { e.preventDefault(); select(outer); }
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
    else menuForSelected(isCall(doc.code.nodes[ui.selected]) ? "swap" : "replace");
    return;
  }
  if (!typing && (e.key === "Delete" || e.key === "Backspace") && ui.selected) {
    e.preventDefault();
    removeSelected();
  }
});

// A snippet's Open in the editor (`?code=…`) becomes a program of your
// own, and the link is dropped from the address so a reload doesn't add it twice.
if (!EMBED && ASKED.has("code")) void unpackSnippet(ASKED.get("code")!).then((p) => {
  history.replaceState(null, "", location.pathname);
  addProgram({ ...typedDoc(MINE, p.code, p.names, p.comments), title: "Snippet" }, "Opened the snippet from the link as a program of your own. Edits are kept in this browser.");
  ui.def = defNamed(ASKED.get("def") ?? "") || ui.def;
  missingAsked();
  render();
}, () => { ui.note = UNREADABLE; ui.refused = true; render(); });

render();
