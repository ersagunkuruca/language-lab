// The node view of a typed program. Same tree as the blocks, drawn as data
// flow, left to right:
//   a call       a node; its inputs are ports, its arguments are wired in
//   a variable   a wire: every use fans out from where it's bound (a
//                function's or case's port, or a let's dot). Any binding can
//                instead be shown as named: a let node where it's bound and a
//                small get node next to every use, with no long wires. Same
//                binding, another look; it's a view (layout.json).
//   a function   a frame; its parameters are ports on the frame's left edge
//   a let        a dot on a wire, as in Blender's node editor: the value flows
//                into the dot and a wire runs from it to every use. The name
//                sits on the dot (unnamed dots show a handle, •1).
//   match, fold  a node like any call: the value, then one function per case
//                (a frame whose parameters are the case's fields and, for a
//                fold, the already-folded parts). `if` is a match on Bool.
//   a list       [3, 1, 2] is one node with an input per item
//   effects      a badge on every node whose call performs one (Choice,
//                Console, Diverge), and on handlers the effect they remove.
//
// Wiring is editing: drag a port or a dot onto an input to use that variable
// there; inputs it can't reach (out of scope, wrong type) are dimmed while
// you drag and say why. Drag a node's output onto an input to share its value
// there: that puts a dot on its wire. Click a wire to put a dot on it. Drag an
// input's wire into empty space to leave a hole there.
//
// Where things are: the automatic layout places everything; a node you move
// keeps the place you gave it (layout.json), in world coordinates, so moving
// one never moves another. Frames are drawn around whatever they hold.
// Shift-click or shift-drag picks several; dragging one of them moves them
// all. Tidy (right-click) spaces out all of them or the picked ones
// (graphLayout.ts). Where wires cross, the later one hops over (a bridge);
// where one runs under a node, the hidden stretch is drawn faintly over it
// (a tunnel). NODE-EDITOR.md says why.

import type { Code, Id, NodeOf } from "../src/model.ts";
import type { Presentation } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { ASSOCIATIVE, chainOperands, CONS, NIL, S, SIGS, TRUE, FALSE } from "../src/lang/std.ts";
import { CHOICE, DIVERGE, showIn, showType, type Type } from "../src/lang/types.ts";
import { connectDrag, infiniteCanvas, moveDrag, s, svgPoint, type Canvas, type Pos } from "./canvas.ts";
import { litLabel } from "./typed.ts";
import { arrange, crossingsOf, curve, curvePoints, frameBoxes, hopPath, overlaps, placeLabels, route, tidy, tunnels, type Box, type TFrame, type TNode, type TWire } from "./graphLayout.ts";
import { planSolve } from "../src/lang/solve.ts";
import { solveMode } from "../src/lang/modes.ts";
import { portLabel } from "../src/lang/equations.ts";
import { implementationOps, isOperation } from "../src/lang/records.ts";
import { foldFrom, looseParts, takenApart } from "../src/lang/render.ts";
import { flattened, matchRows, patternText } from "../src/lang/patterns.ts";

const tw = (t: string, px = 7.4) => t.length * px;

export type MenuTarget = { kind: "hole" | "node" | "binder" | "frame" | "space"; id?: Id };

export interface GraphHooks {
  selected: Id | null;
  select: (id: Id | null) => void;
  open: (id: Id) => void;
  // null when allowed, else why not
  canUse: (binder: Id, slot: Id) => string | null;
  use: (binder: Id, slot: Id) => void;
  clear: (slot: Id) => void;
  // A click on a wire: `at`, where the dot goes, and where the value is now
  // (kept there).
  addDot: (slot: Id, at?: { dot: Pos; keep: Record<Id, Pos> }) => void;
  // Sharing a node's output: a check per input, and the edit.
  canShare: (from: Id) => (slot: Id) => string | null;
  share: (from: Id, slot: Id) => void;
  // Where nodes were put (world coordinates), and saving some.
  at: Record<Id, Pos>;
  moved: (to: Record<Id, Pos>, note?: string) => void;
  // Bindings shown as a let node with get nodes instead of wires.
  named: Set<Id>;
  // A page's main: one Html tree, opened on its top-left like any other,
  // not on its steps (QA10 L1).
  page?: boolean;
  // Frames drawn folded into one box, and folding or unfolding one.
  folded?: Set<Id>;
  // Groups of picked nodes (and frames) drawn in a frame of their own, by
  // the group's id: a view (layout.json), folded like any other frame.
  groups?: Record<Id, Id[]>;
  // Matches drawn as the nested tree they are, not as rows of patterns
  // (PATTERNS.md). A view.
  tree?: Set<Id>;
  fold?: (frame: Id) => void;
  // The + under a list's or a + b + c's inputs: one more, at the end.
  addItem?: (row: Id) => void;
  // A value (a binding, or a node's output) dropped on a row's +.
  addFrom?: (row: Id, from: Id, binding: boolean) => void;
  // The definition's loose parts (drafts.ts), drawn beside it, each in a
  // dashed frame whose output can be wired into an empty input.
  loose?: Id[];
  // Their inputs that stand for a variable of the definition (drafts.ts).
  home?: Record<Id, Id>;
  // An input of a list or a chain dropped on another of its inputs: it
  // moves there.
  reorder?: (item: Id, onto: Id) => void;
  // Right-click: what was under the pointer, where (screen and world).
  menu?: (target: MenuTarget, screen: Pos, world: Pos) => void;
  // Values from a run on example inputs (src/lang/trace.ts), already shown
  // as text, by node and by variable.
  values?: Map<Id, string>;
}

// What the editor can ask of a drawn graph.
export interface GraphView extends Canvas {
  // Space out every node, or only these (a frame stands for what it holds).
  tidy: (only: Id[] | null) => void;
  picked: () => Id[];
  // Pick or unpick one, as shift-click does (the menu's way, for touch).
  pick: (id: Id) => void;
  // The nodes these stand for: themselves, and a frame's contents.
  expand: (ids: Id[]) => Id[];
  // The frame a node is drawn in, or a frame's own (null: none); undefined
  // when it isn't drawn.
  frameOf: (id: Id) => Id | null | undefined;
  // Where a node is drawn now, if it is.
  posOf: (id: Id) => Pos | undefined;
  unpickAll: () => void;
}

const HANDLES: Record<Id, Id> = { [S.all]: CHOICE, [S.count]: CHOICE, [S.first]: CHOICE, [S.fuel]: DIVERGE };

// When a long press last opened a menu, and when a touch last did. The
// graph is drawn again when a menu opens, so these outlive one drawing: the
// tap that ends a long press lands on the new one, and isn't a click.
let held = 0, menuAt = 0;

// Where each graph's nodes were placed when last drawn, so an edit keeps
// them there. Not saved: a reload lays the graph out afresh.
const drawnAt = new Map<string, Map<Id, Pos & { frame: Id | null }>>();
const foldedAt = new Map<string, Set<Id>>();

// The longest a title or a case's row reads before it is shortened.
const APART = 24;
// A function's frame titled by its parameters, which its dots already
// show by name: past APART it reads (…) => (Ersagun 2026-10-29).
function paramsTitle(names: string[], rest?: string): string {
  const full = `(${names.join(", ")})${rest ? ` with ${rest}` : ""} =>`;
  return full.length > APART ? `(…)${rest ? ` with ${rest}` : ""} =>` : full;
}

// Picked nodes, per graph: kept across redraws, not saved.
const pickedBy = new Map<string, Set<Id>>();

// `key` names the window onto this graph, so redrawing keeps where you were.
// How far down and across a page's first rows reach, in world units:
// about a pane at the zoom a graph opens at.
const PAGE_ROWS = 900, PAGE_COLS = 1000;
export function typedGraph(code: Code, pres: Presentation, info: Info | null, defId: Id, hooks: GraphHooks, key = defId): GraphView {
  const scene = build(code, pres, info, defId, hooks);
  // An action opens on its steps, the column they run down: the
  // definition's own, not those of an action inside it. A page doesn't.
  const depth = (u: Id) => { let n = 0; for (let f = scene.items.get(u)?.frame ?? scene.frames.get(u)?.parent ?? null; f; f = scene.frames.get(f)?.parent ?? null) n++; return n; };
  const top = Math.min(...[...scene.items.keys()].map(depth));
  const steps = hooks.page ? [] : (scene.chains ?? []).find((c) => c.every((u) => depth(u) === top)) ?? [];
  const at = (id: Id) => canvas.world.querySelector(`[data-id="${CSS.escape(id)}"]`);
  // A page's tree opens on its first rows: the leftmost node of a pane's
  // height from the top at the left, the topmost at the top (QA
  // 2026-10-31 L1).
  const firstRows = () => {
    // A frame shares its id with what it draws: not a node.
    const els = [...scene.items.keys()].map(at).filter((e): e is Element => !!e && !e.classList.contains("rg"));
    const a = canvas.world.getScreenCTM()?.a ?? 1, bs = els.map((e) => e.getBoundingClientRect());
    const top = Math.min(...bs.map((b) => b.top));
    const left = Math.min(...bs.filter((b) => b.top < top + PAGE_ROWS * a).map((b) => b.left));
    return els.filter((_, i) => bs[i].left < left + PAGE_COLS * a && bs[i].top < top + PAGE_ROWS * a);
  };
  const canvas = infiniteCanvas(key, "tgraph", () => (hooks.page ? firstRows() : steps.map(at).filter((e): e is Element => !!e)));
  const picked = pickedBy.get(key) ?? new Set<Id>();
  pickedBy.set(key, picked);
  for (const l of hooks.loose ?? []) {
    const part = build(code, pres, info, l, hooks, true);
    for (const k of ["items", "frames", "sources"] as const) for (const [id, v] of part[k] as Map<Id, never>) (scene[k] as Map<Id, never>).set(id, v);
    scene.wires.push(...part.wires.map((w) => ({ ...w, cls: `${w.cls} faded` })));
    for (const id of part.lit) scene.lit.add(id);
    scene.faded ??= new Set();
    for (const id of part.items.keys()) scene.faded.add(id);
  }
  for (const [g, members] of Object.entries(hooks.groups ?? {})) group(scene, g, members);
  autoArrange(scene, hooks.folded);
  for (const p of [...picked]) if (!scene.items.has(p) && !scene.frames.has(p)) picked.delete(p);
  const shown = (at: Record<Id, Pos>) => fold(scene, at, hooks.folded);
  // An edit doesn't lay the graph out again (Ersagun 2026-10-27: no tidy
  // whenever I do anything): what was drawn stays where it was, and only
  // what's new gets a place, spaced out from the rest. Tidy everything is
  // still on the menu.
  const last = drawnAt.get(key);
  if (last) {
    // A node now in another frame (a group made a function) is placed
    // afresh too: its old place was in the frame it left.
    const fresh = new Set([...scene.items.keys()].filter((k) => (!last.has(k) || last.get(k)!.frame !== (scene.items.get(k)!.frame ?? null)) && !hooks.at[k]));
    // A new node starts where the fresh layout puts it relative to the
    // nearest node that stays along the wires (what it feeds, mostly),
    // moved as that node was.
    const arranged = new Map([...scene.items].map(([k, it]) => [k, it.auto]));
    const next = new Map<Id, Id[]>();
    for (const w of scene.wires) {
      const a = "item" in w.from ? w.from.item : null, b = "item" in w.to ? w.to.item : null;
      if (a && b) { next.set(a, [...(next.get(a) ?? []), b]); next.set(b, [...(next.get(b) ?? []), a]); }
    }
    for (const k of fresh) {
      const seen = new Set([k]);
      let ring = [k], near: Id | undefined;
      while (ring.length && !near) {
        ring = ring.flatMap((x) => next.get(x) ?? []).filter((x) => !seen.has(x) && (seen.add(x), true));
        near = ring.find((x) => last.has(x) && !fresh.has(x));
      }
      if (!near) continue;
      const a = arranged.get(k)!, was = hooks.at[near] ?? last.get(near)!, now = arranged.get(near)!;
      scene.items.get(k)!.auto = { x: a.x + was.x - now.x, y: a.y + was.y - now.y };
    }
    for (const [k, it] of scene.items) { const p = last.get(k); if (p && !fresh.has(k) && !hooks.at[k]) it.auto = { x: p.x, y: p.y }; }
    // Spaced out only nearby: a node inside a frame of kept nodes can be
    // pushed off without end as the frame grows around it, so a place far
    // from where it started is not taken.
    if (fresh.size && fresh.size < scene.items.size)
      for (const [k, p] of Object.entries(tidyScene(shown(hooks.at), hooks.at, fresh))) {
        const it = scene.items.get(k);
        if (it && fresh.has(k) && Math.hypot(p.x - it.auto.x, p.y - it.auto.y) < 600) it.auto = p;
      }
  }
  // A frame just unfolded opens where its box was, so what it now covers
  // is spaced out from it (I57); the frame and its contents stay put.
  const wasFolded = foldedAt.get(key);
  const opened = [...(wasFolded ?? [])].filter((f) => scene.frames.has(f) && !hooks.folded?.has(f));
  if (last && opened.length) {
    const view = shown(hooks.at), { pos, boxes } = placeAll(view, hooks.at);
    const inside = (fr: Id | null | undefined, f: Id) => { for (let p = fr; p; p = scene.frames.get(p)?.parent ?? null) if (p === f) return true; return false; };
    const covered = new Set<Id>();
    for (const f of opened) {
      const b = boxes.get(f);
      if (!b) continue;
      for (const [k, it] of view.items) {
        const q = pos.get(k);
        if (!q || hooks.at[k] || !scene.items.has(k) || inside(it.frame, f)) continue;
        if (q.x < b.x + b.w && q.x + it.w > b.x && q.y < b.y + b.h && q.y + it.h > b.y) covered.add(k);
      }
    }
    if (covered.size) for (const [k, p] of Object.entries(tidyScene(view, hooks.at, covered))) if (covered.has(k)) scene.items.get(k)!.auto = p;
  }
  foldedAt.set(key, new Set(hooks.folded ?? []));
  drawnAt.set(key, new Map([...scene.items].map(([k, it]) => [k, { ...it.auto, frame: it.frame ?? null }])));
  const draw = (at: Record<Id, Pos>) => canvas.world.replaceChildren(...render(shown(at), hooks, at, picked));
  draw(hooks.at);
  interact(canvas, scene, hooks, picked, draw);
  return {
    ...canvas,
    picked: () => [...picked],
    pick: (id) => { if (!picked.delete(id)) picked.add(id); },
    unpickAll: () => picked.clear(),
    frameOf: (id) => scene.items.get(id)?.frame ?? (scene.frames.has(id) ? scene.frames.get(id)!.parent : undefined),
    posOf: (id) => { const it = scene.items.get(id); return it ? hooks.at[id] ?? { x: it.auto.x, y: it.auto.y } : undefined; },
    expand: (ids) => [...expand(scene, ids)],
    tidy: (only) => {
      const moved = only?.length === 1 && scene.frames.has(only[0]) ? arrangeInside(scene, hooks.at, hooks.folded, only[0])
        : only ? unfoldMoves(scene, hooks.at, tidyScene(shown(hooks.at), hooks.at, expand(scene, only)))
        : changed(scene, hooks.at, arrangeAll(scene, hooks.folded));
      const n = Object.keys(moved).length;
      const frame = only?.length === 1 && scene.frames.has(only[0]);
      hooks.moved(moved, n ? `Tidied ${frame ? "what's inside" : only ? "those nodes" : "the graph"}: ${n} moved. Only layout.json changed.` : only && !frame ? "Already tidy: nothing overlaps." : "Already tidy: laying it out again moves nothing.");
    },
  };
}

// ---------------------------------------------------------------- the scene
//
// The graph as flat lists: items (anything drawn at one place: a node, a
// pill, a dot), frames (drawn around what they hold), and wires between
// ends. The automatic layout gives every item a place; saved places win.

type End =
  | { item: Id; dx: number; dy: number }   // a point on an item
  | { frame: Id; port: number; right?: boolean } // a frame's parameter port; right: one of its results
  | { frameOut: Id };                      // a frame's output, on its right edge
interface Item {
  key: Id;
  frame: Id | null;
  w: number; h: number;
  auto: Pos;
  draw: (g: SVGGElement) => void;
  out?: Pos;            // where its value leaves, for the value chip
  value?: Id;           // whose value the chip shows
  solid: boolean;       // wires running under it are drawn as tunnels
  label?: Box;          // words drawn outside it (a dot's name), relative to it
  name?: string;        // what it is called, for a folded box that holds it
}
interface Frame { id: Id; parent: Id | null; title: string; cls: string; binders: Id[]; labels: string[]; results?: Id[]; resultLabels?: string[]; out: End | null; pad: [number, number, number, number]; minH: number; minW: number }
interface Wire { from: End; to: End; cls: string; edge?: Id; use?: { dot: Id; ref: Id }; flow: boolean }
interface Scene {
  items: Map<Id, Item>;
  frames: Map<Id, Frame>;
  wires: Wire[];
  sources: Map<Id, End>;     // where each binder's value comes from
  result: End | null;        // the definition's result
  defId: Id;
  lit: Set<Id>;              // highlighted with the selection: a binding's uses
  faded?: Set<Id>;           // items of loose parts, drawn faded
  chains?: Id[][];           // an action's steps, in the order they run
  then?: [End, End][];       // from each step to the next
}

// A laid-out piece, in its own coordinates: how far it reaches, where its
// output is (as a point for the layout and an end for wires), and where
// each of its items goes.
interface Sub { w: number; h: number; outX: number; outY: number; out: End; at: Map<Id, Pos> }
const shift = (into: Map<Id, Pos>, sub: Sub, x: number, y: number) => { for (const [k, p] of sub.at) into.set(k, { x: p.x + x, y: p.y + y }); };

function build(code: Code, pres: Presentation, info: Info | null, defId: Id, hooks: GraphHooks, loose = false): Scene {
  const names = pres.names;
  const node = (id: Id) => code.nodes[id];
  const name = (id: Id) => names[id] ?? (node(id)?.kind === "builtin" ? (node(id) as NodeOf<"builtin">).op : "?");
  const typeOf = (id: Id) => { const t = info?.typeOf.get(id); return t ? showIn(t, names, info!.subst) : ""; };
  const sel = (id: Id) => (hooks.selected === id ? " sel" : "");
  const errs = new Set((info?.errors ?? []).map((e) => e.id));
  const dotOf = (id: Id): Id | null => {
    const n = node(id);
    return n?.kind === "ref" && node(n.target)?.kind === "binder" ? n.target : null;
  };
  const named = (b: Id) => hooks.named.has(b) && name(b) !== "_";
  // A loose part's own result: its output wires the part back in, even
  // when it is a lone pill (a literal has no other output).
  const lp = loose ? looseParts(code, defId, hooks.home ?? {}) : null;
  const looseTop = lp?.expr;
  const titled = (el: SVGElement, t: string) => { if (t) el.append(s("title", {}, t)); return el; };

  const items = new Map<Id, Item>();
  const frames = new Map<Id, Frame>();
  const wires: Wire[] = [];
  const sources = new Map<Id, End>();
  const chains: Id[][] = [], then: [End, End][] = [];
  const usesOf = new Map<Id, Id[]>();
  let frame: Id | null = null;   // the frame being laid out

  const item = (key: Id, w: number, h: number, draw: (g: SVGGElement) => void, extra: Partial<Item> = {}): Sub => {
    items.set(key, { key, frame, w, h, auto: { x: 0, y: 0 }, draw, solid: true, ...extra });
    return { w, h, outX: w, outY: h / 2, out: { item: key, dx: w, dy: h / 2 }, at: new Map([[key, { x: 0, y: 0 }]]) };
  };
  // A use of a binding wired into (item, dx, dy): a wire from its source,
  // or nothing here when the use is drawn as a get node.
  const useAt = (ref: Id, dot: Id, to: End) => {
    // The source is filled in once every source is known.
    wires.push({ from: { item: "", dx: 0, dy: 0 }, to, cls: "use", use: { dot, ref }, flow: false });
    usesOf.set(dot, [...(usesOf.get(dot) ?? []), ref]);
  };

  const effectsOf = (call: NodeOf<"call">): { does: string[]; handles?: string } => {
    // Effects this call itself brings in: from the callee's own signature,
    // not from the row it was unified with here.
    const f = node(call.fn);
    if (f.kind !== "ref" || !info) return { does: [] };
    let t: Type | undefined;
    if (SIGS[f.target]) t = SIGS[f.target](info.subst.clone());
    else if (info.schemes.get(f.target)) t = info.schemes.get(f.target)!.type;
    const z = t ? info.subst.zonk(t) : null;
    const does = z?.t === "fn" ? z.eff.effs.map(name) : [];
    const handles = HANDLES[f.target] ? name(HANDLES[f.target]) : undefined;
    return { does, handles };
  };

  const holeType = (id: Id) => { const hi = info?.holes.get(id); return hi ? showIn(hi.expected, names, info!.subst) : ""; };

  const pill = (id: Id, text: string, cls: string, src?: Id, more?: string): Sub => {
    const w = Math.max(28, tw(text) + 18), h = 24;
    return item(id, w, h, (g) => {
      const r = titled(s("rect", { width: w, height: h, rx: 12, class: `pill ${cls}${sel(id)}${errs.has(id) ? " err" : ""}`, "data-id": id }), [typeOf(id), more].filter(Boolean).join("\n\n"));
      g.append(r, s("text", { x: w / 2, y: 16, class: "pl", "text-anchor": "middle" }, text));
      if (src) r.setAttribute("data-src", src);
      if (cls.includes("hole")) r.setAttribute("data-slot", id);
      else r.setAttribute("data-move", id);
      if (id === looseTop && !cls.includes("hole")) g.append(titled(s("circle", { cx: w, cy: h / 2, r: 5, class: "outp", "data-out": id }), "Drag onto an empty input to wire this part in"));
    // A literal says its value already; a hole has none.
    }, { value: cls.includes("hole") || cls === "lit" ? undefined : id, out: { x: w, y: h / 2 } });
  };

  // A use that isn't wired straight into a call's input: a small end for
  // the wire, or a get node.
  const useNode = (ref: Id, dot: Id): Sub => {
    if (named(dot)) {
      const sub = pill(ref, name(dot), "var get");
      const it = items.get(ref)!;
      it.value = undefined;
      const draw = it.draw;
      it.draw = (g) => {
        draw(g);
        const r = g.firstChild as SVGElement;
        r.setAttribute("data-slot", ref);
        titled(r, `${name(dot)}${typeOf(ref) ? ` : ${typeOf(ref)}` : ""}: a get node, a use of ${name(dot)}. Drag its dot to use ${name(dot)} elsewhere too`);
        g.append(s("circle", { cx: it.w, cy: it.h / 2, r: 4, class: "src", "data-src": dot }));
      };
      usesOf.set(dot, [...(usesOf.get(dot) ?? []), ref]);
      return sub;
    }
    const sub = item(ref, 10, 18, (g) => g.append(titled(s("circle", { cx: 5, cy: 9, r: 4, class: `inp use${sel(ref)}`, "data-slot": ref, "data-id": ref }), `${name(dot)}${typeOf(ref) ? ` : ${typeOf(ref)}` : ""}`)), { solid: false });
    useAt(ref, dot, { item: ref, dx: 1, dy: 9 });
    return sub;
  };

  // An input's argument: laid out to its left, or (a variable shown as a
  // wire) nothing, the wire comes from the variable's source.
  const arg = (a: Id): Sub | null => {
    const d = dotOf(a);
    if (d && !named(d)) return null;
    return lay(a);
  };

  const lay = (id: Id): Sub => {
    const n = node(id);
    const d = dotOf(id);
    if (d) return useNode(id, d);
    switch (n.kind) {
      // A text node is clipped shorter than in the blocks: a node is read
      // at a glance, and the whole text is on hover (Ersagun 2026-10-29).
      case "lit": { const l = litLabel(n.value, 18); return pill(id, l.short, "lit", undefined, l.full); }
      case "hole": return pill(id, `□ ${holeType(id)}`.trim(), "hole");
      case "ref": {
        const t = node(n.target);
        return pill(id, name(n.target), t?.kind === "variant" ? "con" : "fnref");
      }
      case "lambda": {
        // (y) => (angle) => … is one function of two things to the reader:
        // one frame with both parameters.
        const params = [...n.params];
        let body = n.body;
        for (let b = node(body); b?.kind === "lambda"; b = node(body)) { params.push(...b.params); body = b.body; }
        // A function of nothing is an action, run when what it's given to
        // asks: first(queens(8), else nil) in the text.
        return region(id, params.length ? paramsTitle(params.map(name)) : "action", params, body, "lam");
      }
      case "match": case "fold": return cases(id, n);
      case "call": {
        if (node(n.fn).kind === "lambda") return letRegion(n);
        // A fold to a function, applied to its starts: one fold node with
        // a port per start, each case's frame given them by name, as the
        // text reads it (fold placed from distance = 1).
        const from = foldFrom(code, n, name);
        return from ? cases(id, from.fold, { args: n.args, lams: new Map(from.arms.map((x) => [x.arm.id, x.lam])) }) : call(id, n);
      }
      case "solve": return solve(id, n);
      default: return pill(id, n.kind, "lit");
    }
  };

  // [3, 1, 2] is cons(3, cons(1, cons(2, nil))): drawn as the one list it
  // is, an input per item, as the text shows it.
  const listItems = (id: Id): Id[] | null => {
    const out: Id[] = [];
    for (let n = node(id); ; n = node((n as NodeOf<"call">).args[1])) {
      if (n.kind === "ref" && n.target === NIL) return out;
      const f = n.kind === "call" ? node(n.fn) : null;
      if (f?.kind !== "ref" || f.target !== CONS || n.kind !== "call" || dotOf(n.args[1])) return null;
      out.push(n.args[0]);
    }
  };

  // Arguments stacked in a column left of a box, each wired into its input.
  // `box` is drawn at (bx, by); portY gives each input's height on it.
  const withArgs = (inputs: Id[], kids: (Sub | null)[], bw: number, bh: number, boxKey: Id, portY: (i: number, by: number) => number, cls: (i: number) => string = () => ""): { sub: Omit<Sub, "out" | "outX" | "outY">; bx: number; by: number } => {
    const gap = 8;
    const ks = kids.map((k) => k ?? { w: 0, h: 18 });
    const colW = Math.max(0, ...ks.map((k) => k.w));
    const kidsH = ks.reduce((a, k) => a + k.h, 0) + gap * Math.max(0, ks.length - 1);
    const h = Math.max(kidsH, bh);
    const bx = kids.length ? colW + 34 : 0, by = (h - bh) / 2;
    const at = new Map<Id, Pos>();
    at.set(boxKey, { x: bx, y: by });
    let y = (h - kidsH) / 2;
    kids.forEach((k, i) => {
      const to: End = { item: boxKey, dx: 0, dy: portY(i, 0) };
      if (!k) {
        const dt = dotOf(inputs[i]);
        if (dt) useAt(inputs[i], dt, to);
      } else {
        shift(at, k, colW - k.w, y);
        wires.push({ from: k.out, to, cls: cls(i), edge: inputs[i], flow: true });
      }
      y += ks[i].h + gap;
    });
    return { sub: { w: bx + bw, h, at }, bx, by };
  };

  // A call: arguments stacked on the left, wired into the node's inputs.
  const call = (id: Id, n: NodeOf<"call">): Sub => {
    const f = node(n.fn);
    const nota = f.kind === "ref" ? pres.style.notation[f.target] : undefined;
    const list = listItems(id);
    // A field read is labelled .x, so what's wired in reads as p.x.
    const field = f.kind === "ref" && node(f.target)?.kind === "field" && !isOperation(code, f.target);
    // An implementation is drawn as the interface at its type, one input
    // per operation, named (BACKLOG E152): not as a call of its record.
    const ops = implementationOps(code, n.fn);
    const at = ops ? /^(\S+) (.+)$/.exec(typeOf(id)) : null;
    const label = list ? "list" : at ? `${at[1]} at ${at[2]}` : f.kind === "ref" ? (nota?.glyph?.trim() || `${field ? "." : ""}${name(f.target)}`) : "apply";
    // a ++ b ++ c is one ++ node with three inputs, as the text writes it;
    // an inner ++ with a dot on it stays its own node.
    const inputs = list ?? chainOperands(code, id, (a) => !!dotOf(a)) ?? (f.kind === "ref" ? n.args : [n.fn, ...n.args]);
    // An input with nothing in it is drawn as an empty port, not a node
    // (NODE-EDITOR.md "Loose parts", rule 3): click it for the palette.
    const empty = (a: Id) => node(a)?.kind === "hole";
    const kids = inputs.map((a) => (empty(a) ? null : arg(a)));
    const eff = effectsOf(n);
    const badge = [...eff.does, ...(eff.handles ? [`handles ${eff.handles}`] : [])].join(" · ");
    const portNames = ops && ops.length === n.args.length ? ops.map(name) : null;
    const bw = Math.max(44, tw(label, 8.2) + 24, badge ? tw(badge, 6.4) + 16 : 0, portNames ? Math.max(...portNames.map((l) => tw(l, 6.6))) + 30 : 0);
    // A list, or a chain of one operation, takes one more input at its +.
    const grows = !!hooks.addItem && (!!list || (f.kind === "ref" && ASSOCIATIVE.has(f.target) && n.args.length === 2));
    const plus = grows ? 16 : 0;
    const bh = portNames ? 30 + inputs.length * 20 : Math.max(30, inputs.length * 18 + 12) + (badge ? 14 : 0) + plus;
    const top = badge ? 14 : 0;
    const portY = (i: number) => (portNames ? 30 + i * 20 : top + ((bh - top - plus) / (inputs.length + 1)) * (i + 1));
    item(id, bw, bh, (g) => {
      g.append(titled(s("rect", { width: bw, height: bh, rx: 7, class: `cn${eff.does.length ? " eff" : ""}${eff.handles ? " handler" : ""}${sel(id)}${errs.has(id) ? " err" : ""}`, "data-id": id, "data-move": id }), typeOf(id)));
      if (badge) g.append(s("text", { x: bw / 2, y: 11, class: "badge", "text-anchor": "middle" }, badge));
      g.append(s("text", { x: bw / 2, y: portNames ? 19 : top + (bh - top) / 2 + 5, class: "cl", "text-anchor": "middle" }, label));
      portNames?.forEach((l, i) => g.append(s("text", { x: 9, y: portY(i) + 4, class: "portl" }, l)));
      inputs.forEach((a, i) => g.append(empty(a)
        ? titled(s("circle", { cx: 0, cy: portY(i), r: 5, class: `inp empty${sel(a)}${errs.has(a) ? " err" : ""}`, "data-slot": a, "data-id": a }), `${holeType(a) ? `${holeType(a)}: ` : ""}empty. Click it for the palette, or drag a value onto it`)
        : titled(s("circle", { cx: 0, cy: portY(i), r: 5, class: "inp", "data-slot": a }), typeOf(a))));
      if (grows) {
        const add = s("g", { class: "add-inp", "data-add": id });
        add.append(s("circle", { cx: 0, cy: bh - 11, r: 6 }), s("text", { x: 0, y: bh - 7.5, "text-anchor": "middle" }, "+"));
        g.append(titled(add, list ? "Add an item at the end" : "Add an input at the end"));
      }
      g.append(titled(s("circle", { cx: bw, cy: bh / 2, r: 5, class: "outp", "data-out": id }), "Drag onto another input to share this value there"));
    }, { value: id, out: { x: bw, y: bh / 2 }, name: label === "list" || label === "apply" ? undefined : field ? label.slice(1) : label });
    const { sub, bx, by } = withArgs(inputs, kids, bw, bh, id, portY);
    return { ...sub, outX: bx + bw, outY: by + bh / 2, out: { item: id, dx: bw, dy: bh / 2 } };
  };

  // A frame: binder ports on its left edge, the body inside, out on the right.
  const PAD = 10, HEAD = 20;
  const portsW = (binders: Id[]) => Math.max(0, ...binders.map((b) => tw(name(b), 6.8) + 18));
  // A definition's results (RESULTS.md) are ports on its right edge, one
  // output each, as a network's outer ports were before #41.
  const region = (id: Id, title: string, binders: Id[], body: Id, cls: string, results: Id[] = []): Sub => {
    const outer = frame;
    frame = id;
    const pw = portsW(binders), ph = Math.max(binders.length, results.length && results.length + 1) * 22;
    binders.forEach((b, i) => sources.set(b, { frame: id, port: i }));
    results.forEach((b, i) => sources.set(b, { frame: id, port: i, right: true }));
    const b = lay(body);
    frame = outer;
    const bx = Math.max(pw + 14, PAD), innerH = Math.max(ph + 8, b.h);
    const by = HEAD + (innerH - b.h) / 2;
    const at = new Map<Id, Pos>();
    shift(at, b, bx, by);
    const rw = results.length ? portsW(results) + 14 : 22;
    const w = Math.max(bx + b.w + rw, tw(title, 6.6) + 20), h = HEAD + innerH + PAD;
    frames.set(id, { id, parent: outer, title, cls, binders, labels: binders.map(name), ...(results.length ? { results, resultLabels: results.map(name) } : {}), out: b.out, pad: [bx, HEAD, rw, PAD], minH: HEAD + ph + 8 + PAD, minW: tw(title, 6.6) + 36 });
    return { w, h, outX: w, outY: by + b.outY, out: { frameOut: id }, at };
  };

  // A relation used in one direction: the given ports are inputs on the
  // left, the solved ones are sources on the right (all from the same
  // solution), and what follows uses them. The badge says whether it's
  // pure: Choice when the solver can find several answers or none.
  const solve = (id: Id, n: NodeOf<"solve">): Sub => {
    const label = (k: string) => (k === "out" ? "result" : portLabel(code, names, n.fn, k));
    const boundKeys = Object.keys(n.binds);
    // Used the way the definition declares (RESULTS.md), it reads as a
    // call with one output per result, and its relation holding (= true)
    // goes without saying; another direction says "solve".
    const fd = code.nodes[n.fn]?.kind === "def" ? (code.nodes[n.fn] as NodeOf<"def">) : null;
    const declared = !!fd?.results?.length && fd.results.length === boundKeys.length && fd.results.every((r) => boundKeys.includes(r));
    const holds = (v: Id) => { const t = code.nodes[v]; return t?.kind === "ref" && t.target === "std.bool.true"; };
    const fl = fd?.body && code.nodes[fd.body]?.kind === "lambda" ? (code.nodes[fd.body] as NodeOf<"lambda">).params : [];
    const at = (k: string) => (fl.includes(k) ? fl.indexOf(k) : fl.length);
    const givenKeys = Object.keys(n.given).filter((k) => !(declared && k === "out" && holds(n.given[k]))).sort((a, b) => at(a) - at(b));
    const inputs = givenKeys.map((k) => n.given[k]);
    const kids = inputs.map(arg);
    // Its mode (MODES.md, E160): how many answers it can give and whether
    // it ends, from the analysis the relational search runs by; the
    // solver's plan says the same of a builtin's equations.
    let badge = "", why = "";
    try {
      const plan = planSolve(code, n);
      const v = plan.mode === "relational" ? solveMode(code, n, names) : null;
      if (v) {
        const { fail, many } = v.answers;
        badge = `${fail || many ? "Choice · " : ""}${many ? (fail ? "any number of answers" : "one answer or more") : fail ? "one answer or none" : "one answer"}${v.ends ? "" : " · may not end"}${v.stuck.length ? " · stuck" : ""}`;
        why = [...v.loops.map((l) => `May not end: ${l}`), ...v.stuck.map((x) => `Stuck: ${x}`)].join("\n");
      } else badge = plan.status === "underdetermined" ? `needs ${plan.needMore} more` : plan.unique ? "one answer" : `Choice${plan.many ? " · several answers" : ""}${plan.canFail ? " · may have none" : ""}`;
    } catch {}
    const choice = /Choice|needs|stuck|may not end/.test(badge);
    const title = `${declared ? "" : "solve "}${pres.style.notation[n.fn]?.glyph?.trim() || name(n.fn)}`;
    const rows = Math.max(givenKeys.length, boundKeys.length);
    const lw = Math.max(0, ...givenKeys.map((k) => tw(label(k), 6.6))), rw = Math.max(0, ...boundKeys.map((k) => tw(label(k), 6.6)));
    const bw = Math.max(70, tw(title, 8.2) + 24, tw(badge, 6.4) + 16, lw + rw + 36);
    const top = 34;
    const bh = top + rows * 20 + 6;
    const portY = (i: number) => top + i * 20 + 8;
    boundKeys.forEach((k, i) => sources.set(n.binds[k], { item: id, dx: bw + 6, dy: portY(i) }));
    item(id, bw, bh, (g) => {
      g.append(titled(s("rect", { width: bw, height: bh, rx: 7, class: `cn rel${choice ? " eff" : ""}${sel(id)}${errs.has(id) ? " err" : ""}`, "data-id": id, "data-move": id }), typeOf(id)));
      g.append(titled(s("text", { x: bw / 2, y: 12, class: "badge", "text-anchor": "middle" }, badge), why));
      g.append(s("text", { x: bw / 2, y: 27, class: "cl", "text-anchor": "middle" }, title));
      givenKeys.forEach((k, i) => {
        g.append(titled(s("circle", { cx: 0, cy: portY(i), r: 5, class: "inp", "data-slot": n.given[k] }), typeOf(n.given[k])));
        g.append(s("text", { x: 9, y: portY(i) + 4, class: "portl" }, label(k)));
      });
      boundKeys.forEach((k, i) => {
        const b = n.binds[k];
        g.append(s("text", { x: bw - 9, y: portY(i) + 4, class: "portl", "text-anchor": "end" }, name(b) === label(k) ? label(k) : `${label(k)} → ${name(b)}`));
        g.append(titled(s("circle", { cx: bw, cy: portY(i), r: 6, class: `src${sel(b)}`, "data-src": b, "data-id": b }), `${name(b)}${typeOf(b) ? ` : ${typeOf(b)}` : ""}`));
      });
    }, { name: title });
    const { sub, bx } = withArgs(inputs, kids, bw, bh, id, portY);
    const body = lay(n.body);
    const x = bx + bw + 40, y = Math.max(0, (sub.h - body.h) / 2);
    shift(sub.at, body, x, y);
    return { w: Math.max(sub.w, x + body.w), h: Math.max(sub.h, y + body.h), outX: x + body.outX, outY: y + body.outY, out: body.out, at: sub.at };
  };

  // A let: each value flows into its dot; wires from the dot run to the
  // uses. A dot nothing reads (`_ = print(…)`) is a step done for its
  // effect, before what follows. Shown named, the dot is a let node.
  const letRegion = (n: NodeOf<"call">): Sub => {
    // A run of lets is one column of steps, then what they lead to.
    const steps: [Id, Id][] = [];
    let rest: Id = n.id;
    for (let c = node(rest); c.kind === "call" && node(c.fn).kind === "lambda"; c = node(rest)) {
      const lam = node(c.fn) as NodeOf<"lambda">;
      lam.params.forEach((p, i) => steps.push([p, (c as NodeOf<"call">).args[i]]));
      rest = lam.body;
    }
    const at = new Map<Id, Pos>();
    const vals = steps.map(([, v]) => lay(v));
    const colW = Math.max(0, ...vals.map((v) => v.w));
    // Steps done only for their effects (print this, then that) read top
    // to bottom, the last one included: nothing flows sideways, so each
    // starts at the left edge, as lines of text do. Lets line up on the
    // right, where their dots are.
    const sequence = steps.every(([b]) => name(b) === "_");
    let y = 0, w = 0, h = 0, right = 0;
    vals.forEach((v, i) => {
      const b = steps[i][0];
      const silent = name(b) === "_";
      const vx = sequence ? 0 : colW - v.w;
      shift(at, v, vx, y);
      const py = y + v.outY, x = (sequence ? vx + v.outX : Math.max(colW, vx + v.outX)) + 22;
      if (named(b)) {
        // A let node: `name =`, its value wired in; its uses are get nodes.
        const label = `${name(b)} =`;
        const bw = Math.max(44, tw(label, 8.2) + 20), bh = 26;
        item(b, bw, bh, (g) => {
          g.append(titled(s("rect", { width: bw, height: bh, rx: 7, class: `cn letn${sel(b)}`, "data-id": b, "data-move": b }), `${name(b)}${typeOf(b) ? ` : ${typeOf(b)}` : ""}: a let node. Its uses are get nodes; drag its dot to use it elsewhere`));
          g.append(s("text", { x: bw / 2, y: 17, class: "cl", "text-anchor": "middle" }, label));
          g.append(s("circle", { cx: 0, cy: bh / 2, r: 5, class: "inp" }));
          g.append(titled(s("circle", { cx: bw, cy: bh / 2, r: 5, class: `src${sel(b)}`, "data-src": b, "data-id": b }), "Drag onto an input to use it there"));
        }, { value: b, out: { x: bw, y: bh / 2 } });
        at.set(b, { x, y: py - bh / 2 });
        wires.push({ from: v.out, to: { item: b, dx: 0, dy: bh / 2 }, cls: "", flow: true });
        sources.set(b, { item: b, dx: bw, dy: bh / 2 });
        right = Math.max(right, x + bw);
      } else {
        const r = silent ? (sequence ? 8 : 4) : 6;
        const t = silent ? (sequence ? `Step ${i + 1} of ${steps.length + 1}, done for its effect; then step ${i + 2}. Right-click the step to do it earlier or later` : "a step done for its effect; nothing reads it") : `${name(b)}${typeOf(b) ? ` : ${typeOf(b)}` : ""}. Drag from here to use it; right-click to show it as a let node`;
        item(b, 2 * r, 2 * r, (g) => {
          g.append(titled(s("circle", { cx: r, cy: r, r, class: `reroute${silent ? " silent" : ""}${sel(b)}`, "data-src": b, "data-id": b, "data-move": b }), t));
          if (silent && sequence) g.append(s("text", { x: r, y: r + 3.5, class: "stepn", "text-anchor": "middle" }, String(i + 1)));
          if (!silent) g.append(s("text", { x: r, y: -4, class: `dotl${names[b] === undefined ? " anon" : ""}`, "text-anchor": "middle" }, name(b)));
        }, { value: silent ? undefined : b, out: { x: 2 * r, y: r }, solid: false, label: silent ? undefined : { x: r - tw(name(b), 6.8) / 2, y: -16, w: tw(name(b), 6.8), h: 14 } });
        at.set(b, { x, y: py - r });
        // The dot shows the value; the node feeding it needn't say it again.
        if (!silent && "item" in v.out && items.get(v.out.item)) items.get(v.out.item)!.value = undefined;
        wires.push({ from: v.out, to: { item: b, dx: 0, dy: r }, cls: "", flow: true });
        sources.set(b, { item: b, dx: 2 * r, dy: r });
        right = Math.max(right, x + 2 * r + (silent ? 0 : tw(name(b), 6.8) / 2));
      }
      w = Math.max(w, right);
      h = Math.max(h, y + v.h);
      y += v.h + 18;
    });
    const valsH = Math.max(0, y - 18);
    const body = lay(rest);
    // An action's steps run top to bottom: they keep that order in one
    // column wherever the layout puts them, and a dashed line leads from
    // each to the next (Ersagun 2026-10-26: "are they run in sequence?").
    if (sequence && steps.length) {
      const unit = (e: End) => ("item" in e ? e.item : "frameOut" in e ? e.frameOut : null);
      chains.push([...vals.map((v) => unit(v.out)), unit(body.out)].filter((u): u is Id => !!u));
      const dot = (b: Id): [End, End] => [{ item: b, dx: 8, dy: 16 }, { item: b, dx: 8, dy: 0 }];
      steps.forEach(([b], i) => then.push([dot(b)[0], i + 1 < steps.length ? dot(steps[i + 1][0])[1] : body.out]));
    }
    const bx = sequence ? 0 : right + 26;
    const by = sequence ? y : Math.max(0, (Math.max(valsH, body.h) - body.h) / 2);
    shift(at, body, bx, by);
    return { w: Math.max(w, bx + body.w), h: Math.max(h, valsH, by + body.h), outX: bx + body.outX, outY: by + body.outY, out: body.out, at };
  };

  // if, match and fold are ordinary nodes: the value goes in first, then one
  // function per case, each drawn as a frame whose parameters are that
  // case's fields (and, for a fold, the parts already folded). Only the
  // chosen case's function runs.
  const cases = (id: Id, n: NodeOf<"match"> | NodeOf<"fold">, from?: { args: Id[]; lams: Map<Id, NodeOf<"lambda">> }): Sub => {
    let armNodes = n.arms.map((a) => node(a) as NodeOf<"arm">);
    const isIf = n.kind === "match" && armNodes.length === 2 && armNodes.every((a) => [TRUE, FALSE].includes(a.variant));
    // An if reads then, else, whatever order the arms were stored in.
    if (isIf) armNodes = [...armNodes].sort((a, b) => (a.variant === TRUE ? -1 : b.variant === TRUE ? 1 : 0));
    const type = armNodes[0] && info?.owner.get(armNodes[0].variant);
    // A match on an effect's operations handles that effect (LANGUAGE.md,
    // "Effects you define"), and says so, as the blocks and text do.
    const typeBody = type && (node(type) as NodeOf<"def">)?.body ? node((node(type) as NodeOf<"def">).body!) : null;
    const handles = n.kind === "match" && typeBody?.kind === "typedef" && !!typeBody.effect;
    // One case on a one-case type only takes the value apart, as the text's
    // halves(front, back) = split(tail) does; its function runs next.
    const apart = n.kind === "match" && takenApart(code, info, n);
    const starts = from ? from.lams.get(armNodes[0].id)!.params : [];
    // Taking a value apart names its fields once, on the frame that gets
    // them; the node itself says only whose, when they'd make it long
    // (Ersagun 2026-10-29).
    const fields = apart ? `${name(armNodes[0].variant)}(${armNodes[0].binds.map(name).join(", ")}) =` : "";
    const title = from ? `fold${type ? ` ${name(type)}` : ""} from ${starts.map(name).join(", ")}` : isIf ? "if" : apart ? (fields.length > APART ? `${name(armNodes[0].variant)}(…) =` : fields) : `${handles ? "handle" : n.kind}${type ? ` ${name(type)}` : ""}`;
    const labels = [isIf ? "condition" : "value"];
    const inputs: Id[] = [n.scrutinee];
    const kids: (Sub | null)[] = [arg(n.scrutinee)];
    from?.args.forEach((a, i) => { labels.push(name(starts[i])); inputs.push(a); kids.push(arg(a)); });
    const values = inputs.length;
    // A case that only takes one of its fields apart further draws as one
    // row per inner case, the way the text reads it: one port and one frame
    // per row, its names all on that frame's left (PATTERNS.md).
    const all = n.kind === "match" && !handles && !isIf && !apart && !hooks.tree?.has(id) ? matchRows(code, info, n) : null;
    const rows = all && flattened(all) ? all : null;
    for (const r of rows ?? []) {
      const pat = patternText(r.pat, name, name);
      labels.push(pat.length > APART ? `${pat.slice(0, APART - 1)}…` : pat);
      inputs.push(r.at);
      kids.push(region(r.at, paramsTitle(r.binds.map(name)), r.binds, r.body, "arm"));
    }
    for (const arm of rows ? [] : armNodes) {
      const results = arm.results.filter((r): r is Id => r !== null);
      const lam = from?.lams.get(arm.id);
      const params = [...arm.binds, ...results, ...(lam?.params ?? [])];
      labels.push(isIf ? (arm.variant === TRUE ? "then" : "else") : apart ? "then" : name(arm.variant));
      inputs.push(arm.id);
      // An operation answered later binds the rest after its inputs, read as
      // the text reads it: (item) with rest (ANSWERED-LATER.md).
      const op = handles ? node(arm.variant) : null;
      const later = op?.kind === "variant" && op.later && arm.binds.length === op.fields.length + 1;
      kids.push(region(arm.id, later ? paramsTitle(arm.binds.slice(0, -1).map(name), name(arm.binds.at(-1)!)) : paramsTitle(params.map(name)), params, lam ? lam.body : arm.body, "arm"));
    }
    if (n.kind === "match" && n.otherwise) { labels.push("otherwise"); inputs.push(n.otherwise); kids.push(lay(n.otherwise)); }
    const lw = Math.max(0, ...labels.map((l) => tw(l, 6.6)));
    const bw = Math.max(64, tw(title, 8.2) + 24, lw + 30);
    const bh = 30 + inputs.length * 20;
    const portY = (i: number) => 30 + i * 20;
    item(id, bw, bh, (g) => {
      g.append(titled(s("rect", { width: bw, height: bh, rx: 7, class: `cn case${sel(id)}${errs.has(id) ? " err" : ""}`, "data-id": id, "data-move": id }), typeOf(id)));
      g.append(s("text", { x: bw / 2, y: 19, class: "cl", "text-anchor": "middle" }, title));
      labels.forEach((l, i) => {
        const value = i < values;
        g.append(titled(s("circle", { cx: 0, cy: portY(i), r: 5, class: value ? "inp" : "inp fn", ...(value || (n.kind === "match" && n.otherwise === inputs[i]) ? { "data-slot": inputs[i] } : {}) }), value ? (i ? `${l} starts as this` : typeOf(n.scrutinee)) : `the function for ${l}`));
        g.append(s("text", { x: 9, y: portY(i) + 4, class: "portl" }, l));
      });
      g.append(titled(s("circle", { cx: bw, cy: bh / 2, r: 5, class: "outp" }), typeOf(id)));
    }, { value: id, out: { x: bw, y: bh / 2 }, name: title });
    const { sub, bx, by } = withArgs(inputs, kids, bw, bh, id, portY, (i) => (i < values ? "" : "fn"));
    // Only the value's wire can take a dot: a case's function isn't a value.
    for (const wr of wires) if (wr.to && "item" in wr.to && wr.to.item === id && wr.cls === "fn") wr.edge = undefined;
    return { ...sub, outX: bx + bw, outY: by + bh / 2, out: { item: id, dx: bw, dy: bh / 2 } };
  };

  // A data type: each case is a constructor, so it's drawn as one: a node
  // whose inputs are its fields and whose output is a value of the type.
  const typeText = (tid: Id): string => {
    const t = node(tid);
    if (t.kind === "tfun") return `(${t.params.map(typeText).join(", ")}) -> ${typeText(t.result)}`;
    const r = t as NodeOf<"tref">;
    return [name(r.target), ...r.args.map((a) => { const x = typeText(a); return x.includes(" ") ? `(${x})` : x; })].join(" ");
  };
  const typeFrame = (td: NodeOf<"typedef">): Sub => {
    // An effect is a typedef too: its cases are its operations, and each
    // says what it gives back to whoever performs it.
    const title = td.interface ? `interface ${name(defId)}: its operations` : td.effect ? `effect ${name(defId)}: one operation per case` : `type ${name(defId)}: one constructor per case`;
    frames.set(defId, { id: defId, parent: null, title, cls: "def", binders: [], labels: [], out: null, pad: [22, 30, 22, 14], minH: 0, minW: tw(title, 6.6) + 24 });
    frame = defId;
    const at = new Map<Id, Pos>();
    let y = 30, w = 0;
    // An interface: one node per operation, saying its type. Its record's
    // constructor is what an implementation calls, not part of the
    // interface's own picture (BACKLOG E141).
    if (td.interface) for (const f of td.variants.flatMap((v) => (node(v) as NodeOf<"variant">).fields)) {
      const label = typeText((node(f) as NodeOf<"field">).type);
      const bw = Math.max(64, tw(name(f), 8.2) + 24, tw(label, 6.6) + 22), bh = 48;
      const k = item(f, bw, bh, (g) => {
        g.append(titled(s("rect", { width: bw, height: bh, rx: 7, class: `cn${sel(f)}`, "data-id": f, "data-move": f }), `${name(f)}: an operation of ${name(defId)}, ${label}. Each implementation says how its type does it`));
        g.append(s("text", { x: bw / 2, y: 19, class: "cl", "text-anchor": "middle" }, name(f)));
        g.append(s("text", { x: 9, y: 38, class: "portl" }, label));
      });
      shift(at, k, 22, y);
      w = Math.max(w, 22 + bw + 22);
      y += bh + 12;
    }
    else for (const v of td.variants) {
      const { fields: fs, returns } = node(v) as NodeOf<"variant">;
      const labels = fs.map((f) => `${name(f)}: ${typeText((node(f) as NodeOf<"field">).type)}`);
      const gives = returns ? `returns ${typeText(returns)}` : "";
      const bw = Math.max(64, tw(name(v), 8.2) + 24, ...labels.map((l) => tw(l, 6.6) + 22), gives ? tw(gives, 6.6) + 22 : 0);
      const bh = Math.max(30, 28 + fs.length * 18) + (gives ? 18 : 0);
      const k = item(v, bw, bh, (g) => {
        g.append(titled(s("rect", { width: bw, height: bh, rx: 7, class: `cn${sel(v)}`, "data-id": v, "data-move": v }), td.effect ? `${name(v)}: an operation of ${name(defId)}${gives ? `; it ${gives}` : ""}` : `${name(v)}: makes a ${name(defId)}`));
        g.append(s("text", { x: bw / 2, y: 19, class: "cl", "text-anchor": "middle" }, name(v)));
        fs.forEach((f, i) => {
          g.append(titled(s("circle", { cx: 0, cy: 32 + i * 18, r: 5, class: `inp${sel(f)}`, "data-id": f }), labels[i]));
          g.append(s("text", { x: 9, y: 36 + i * 18, class: "portl" }, labels[i]));
        });
        if (gives) g.append(s("text", { x: 9, y: 36 + fs.length * 18, class: "portl" }, gives));
        g.append(titled(s("circle", { cx: bw, cy: bh / 2, r: 5, class: "outp" }), name(defId)));
      });
      shift(at, k, 22, y);
      w = Math.max(w, 22 + bw + 22);
      y += bh + 12;
    }
    frame = null;
    return { w, h: y, outX: w, outY: y / 2, out: { frameOut: defId }, at };
  };

  // The definition itself: its parameters, its body, its result.
  const def = node(defId) as NodeOf<"def">;
  const body = def.body ? node(def.body) : null;
  // A definition with results is titled by the direction it declares, as
  // the text shows it: its inputs, the effects of finding them, the results.
  const resultsType = (d: NodeOf<"def">, l: NodeOf<"lambda">) => {
    const effs = info?.directions?.get(defId), bare = (p: Id) => typeOf(p).split(" where ")[0];
    if (!effs || !l.params.every((p) => typeOf(p))) return typeOf(defId);
    const ins = l.params.filter((p) => !d.results!.includes(p));
    return `(${ins.map(bare).join(", ")}) ${effs.length ? `-[${effs.map(name).join(", ")}]->` : "->"} ${d.results!.map((r) => `${name(r)}: ${bare(r)}`).join(", ")}`;
  };
  let top: Sub;
  if (lp) top = region(defId, `loose : ${typeOf(lp.expr)}, not used yet`, lp.params, lp.expr, "loose");
  else if (body?.kind === "lambda" && def.results?.length) top = region(defId, `${name(defId)} : ${resultsType(def, body)}`, body.params.filter((p) => !def.results!.includes(p)), body.body, "def", def.results.filter((r) => body.params.includes(r)));
  else if (body?.kind === "lambda") top = region(defId, `${name(defId)} : ${typeOf(defId)}`, body.params, body.body, "def");
  else if (body?.kind === "typedef") top = typeFrame(body);
  else if (body) top = lay(def.body!);
  else top = pill(defId, `${name(defId)}: nothing yet`, "lit");
  for (const [k, p] of top.at) items.get(k)!.auto = p;

  // Use wires get their source now that every source is known; uses whose
  // binding is shown named are get nodes and have no wire.
  const all: Wire[] = [];
  for (const w of wires) {
    if (!w.use) { all.push(w); continue; }
    const src = sources.get(w.use.dot);
    if (src) all.push({ ...w, from: src });
  }
  // What lights up with the selection: a binding and all its uses.
  const lit = new Set<Id>();
  const sb = hooks.selected ? (usesOf.has(hooks.selected) ? hooks.selected : dotOf(hooks.selected)) : null;
  if (sb) { lit.add(sb); for (const u of usesOf.get(sb) ?? []) lit.add(u); }
  return { items, frames, wires: all, sources, result: body?.kind === "typedef" ? null : top.out, defId, lit, chains, then };
}

// ---------------------------------------------------------------- groups
//
// A group is a frame that holds what was picked: nodes, and frames with
// what they hold, all from one frame. It is drawn, laid out, moved and
// folded as a frame is, and changes nothing but the view (BACKLOG E111).
// A group whose members aren't all here, or aren't all in one frame, isn't
// drawn.

function group(scene: Scene, g: Id, members: Id[]) {
  const where = members.map((m) => scene.items.get(m)?.frame ?? (scene.frames.has(m) ? scene.frames.get(m)!.parent : undefined));
  if (members.length < 2 || where.some((w) => w === undefined || w !== where[0])) return;
  const parent = where[0] ?? null;
  scene.frames.set(g, { id: g, parent, title: "group", cls: "group", binders: [], labels: [], out: null, pad: [12, 26, 12, 12], minH: 0, minW: 80 });
  for (const m of members) {
    const it = scene.items.get(m);
    if (it) it.frame = g;
    else scene.frames.set(m, { ...scene.frames.get(m)!, parent: g });
  }
}

// ---------------------------------------------------------------- folding
//
// A folded frame is drawn as one box where the frame was: what it holds
// is hidden, a wire between the inside and the outside starts at the
// box's right edge (a value leaving) or ends at its left edge (a value
// coming in), and wires wholly inside are not drawn. It has no place of
// its own: it sits where its contents put the frame, so moving it moves
// them, and unfolding finds them where they were. A view: layout.json.
// (Influence: Houdini's minimized network boxes.)

const FOLDH = 44;
// The longest name, and the longest line, a folded box lists.
const HOLDN = 14, HOLDS = 24;
function fold(scene: Scene, at: Record<Id, Pos>, folded?: Set<Id>): Scene {
  const parent = (f: Id) => scene.frames.get(f)?.parent ?? null;
  // The outermost folded frame among f and the frames around it.
  const hider = (f: Id | null): Id | null => {
    let out: Id | null = null;
    for (let p = f; p; p = parent(p)) if (folded?.has(p) && p !== scene.defId) out = p;
    return out;
  };
  if (![...scene.frames.keys()].some((f) => hider(f))) return scene;
  const { boxes } = placeAll(scene, at);
  // A box says what it holds: the calls inside, the first few by name,
  // in a line short enough not to widen the box (Ersagun 2026-10-29).
  const holds = (f: Id) => {
    const inside = [...scene.items.values()].filter((it) => hider(it.frame) === f);
    const count = new Map<string, number>();
    for (const it of inside) if (it.name) count.set(it.name, (count.get(it.name) ?? 0) + 1);
    const names = [...count].map(([n, k]) => `${n.length > HOLDN ? `${n.slice(0, HOLDN - 1)}…` : n}${k > 1 ? ` ×${k}` : ""}`);
    if (!names.length) return `${inside.length} node${inside.length === 1 ? "" : "s"} inside`;
    let line = names[0];
    for (const n of names.slice(1)) { if (line.length + n.length + 2 > HOLDS) return `${line}, …`; line += `, ${n}`; }
    return line;
  };
  const size = (f: Frame) => ({ w: Math.max(f.minW, tw(f.title, 6.6) + 44, tw(holds(f.id), 6.4) + 20), h: FOLDH });
  const items = new Map<Id, Item>();
  for (const it of scene.items.values()) if (!hider(it.frame)) items.set(it.key, it);
  const frames = new Map<Id, Frame>();
  for (const f of scene.frames.values()) {
    const by = hider(f.id);
    if (!by) { frames.set(f.id, f); continue; }
    if (by !== f.id) continue;
    const b = boxes.get(f.id)!, { w, h } = size(f);
    items.set(f.id, {
      key: f.id, frame: f.parent, w, h, auto: { x: b.x, y: b.y }, solid: true,
      draw: (g) => g.append(
        s("rect", { width: w, height: h, rx: 9, class: `rg ${f.cls} folded`, "data-id": f.id, "data-move": f.id, "data-frame": f.id }),
        s("text", { x: 10, y: 16, class: "rt" }, f.title),
        s("text", { x: 10, y: 34, class: "fold-n" }, holds(f.id)),
        foldToggle(w - 16, 16, f.id, "▸", "Unfold"),
      ),
    });
  }
  // Where an end is drawn now, and the folded box it is inside, if any.
  const edge = (f: Id, from: boolean): End => ({ item: f, dx: from ? items.get(f)!.w : 0, dy: FOLDH / 2 });
  const map = (e: End, from: boolean): { e: End; in: Id | null } => {
    if ("item" in e) { const f = hider(scene.items.get(e.item)?.frame ?? null); return f ? { e: edge(f, from), in: f } : { e, in: null }; }
    if ("frame" in e) { const f = hider(e.frame); return f ? { e: edge(f, from), in: f } : { e, in: null }; }
    const f = hider(parent(e.frameOut));
    if (f) return { e: edge(f, from), in: f };
    return hider(e.frameOut) ? { e: edge(e.frameOut, true), in: null } : { e, in: null };
  };
  const wires: Wire[] = [];
  for (const w of scene.wires) {
    const a = map(w.from, true), b = map(w.to, false);
    if (a.in && a.in === b.in) continue;
    wires.push({ ...w, from: a.e, to: b.e });
  }
  // An action's step-to-step dashes, the same: inside one folded box they
  // go with it (they used to be drawn from the graph's corner, I61).
  const then: [End, End][] = [];
  for (const [x, y] of scene.then ?? []) {
    const a = map(x, true), b = map(y, false);
    if (!(a.in && a.in === b.in)) then.push([a.e, b.e]);
  }
  for (const f of frames.values()) if (f.out) { const o = map(f.out, true); if (o.in) frames.set(f.id, { ...f, out: o.e }); }
  const sources = new Map<Id, End>();
  for (const [k, e] of scene.sources) { const m = map(e, true); if (!m.in) sources.set(k, m.e); }
  return { ...scene, items, frames, wires, then, sources, result: scene.result && map(scene.result, true).e };
}

function foldToggle(x: number, y: number, f: Id, glyph: string, title: string): SVGElement {
  const t = s("text", { x, y, class: "fold-t", "data-fold": f }, glyph);
  t.append(s("title", {}, title));
  return t;
}

// What tidy says of a folded box, said of what it holds: they move with it.
// Exact for a layout worked out in steps (arrangeAll): rounding there made
// each pass start a pixel off the last, so a graph opened a pixel away
// from where Tidy everything puts it (I56).
function unfoldMoves(scene: Scene, at: Record<Id, Pos>, moved: Record<Id, Pos>, exact = false): Record<Id, Pos> {
  const out: Record<Id, Pos> = {};
  const { pos, boxes } = placeAll(scene, at);
  for (const [k, p] of Object.entries(moved)) {
    if (scene.items.has(k)) { out[k] = p; continue; }
    const b = boxes.get(k);
    if (!b) continue;
    // A box's place can be fractional: contents that round to where they
    // are haven't moved.
    for (const c of expand(scene, [k])) {
      const q = pos.get(c)!;
      if (exact) { out[c] = { x: q.x + p.x - b.x, y: q.y + p.y - b.y }; continue; }
      const x = Math.round(q.x + p.x - b.x), y = Math.round(q.y + p.y - b.y);
      if (x !== Math.round(q.x) || y !== Math.round(q.y)) out[c] = { x, y };
    }
  }
  return out;
}

// ---------------------------------------------------------------- drawing

const HEADH = 20;
interface Placed { pos: Map<Id, Pos>; boxes: Map<Id, Box>; point: (e: End) => Pos }
function placeAll(scene: Scene, at: Record<Id, Pos>): Placed {
  const pos = new Map<Id, Pos>();
  for (const [k, it] of scene.items) pos.set(k, at[k] ?? it.auto);
  const fb = frameBoxes(
    [...scene.items.values()].map((it) => ({ id: it.key, ...pos.get(it.key)!, w: it.w, h: it.h, frame: it.frame })),
    [...scene.frames.values()].map((f) => ({ id: f.id, parent: f.parent, pad: f.pad, minH: f.minH })),
  );
  for (const [id, b] of fb) { const f = scene.frames.get(id)!; if (b.w < f.minW) b.w = f.minW; }
  const point = (e: End): Pos => {
    if ("item" in e) { const p = pos.get(e.item) ?? { x: 0, y: 0 }; return { x: p.x + e.dx, y: p.y + e.dy }; }
    if ("frame" in e) { const b = fb.get(e.frame)!; return { x: b.x + (e.right ? b.w : 0), y: b.y + HEADH + 4 + e.port * 22 + 11 }; }
    const b = fb.get(e.frameOut)!, f = scene.frames.get(e.frameOut)!;
    // Below the result ports, when there are some, so the two don't meet.
    const y = f.out ? point(f.out).y : b.y + b.h / 2;
    return { x: b.x + b.w, y: f.results?.length ? Math.max(y, b.y + HEADH + 4 + f.results.length * 22 + 11) : y };
  };
  return { pos, boxes: fb, point };
}

function render(scene: Scene, hooks: GraphHooks, at: Record<Id, Pos>, picked: Set<Id>): SVGElement[] {
  const { pos, boxes, point } = placeAll(scene, at);
  const depth = (f: Id | null): number => (f ? 1 + depth(scene.frames.get(f)!.parent) : 0);

  // What's selected is drawn over what isn't, with the frames around it up
  // to the outermost under the definition: an unfolded frame doesn't hide
  // under its neighbours (Ersagun 2026-10-29). Each layer below has a
  // second group drawn after all of the first.
  const parentOf = (f: Id) => scene.frames.get(f)?.parent ?? null;
  const chosen = hooks.selected ?? null;
  let top: Id | null = chosen && scene.frames.has(chosen) ? chosen : chosen ? scene.items.get(chosen)?.frame ?? null : null;
  while (top && parentOf(top) && parentOf(top) !== scene.defId) top = parentOf(top);
  if (top === scene.defId) top = null;
  const within = (f: Id | null): boolean => { for (let p = f; p; p = parentOf(p)) if (p === top) return true; return false; };
  const liftItem = (k: Id) => k === chosen || within(scene.items.get(k)?.frame ?? null);
  const lifted = (e: End) => ("item" in e ? liftItem(e.item) : within("frame" in e ? e.frame : e.frameOut));
  const pair = (cls?: string) => { const a = s("g", cls ? { class: cls } : {}), b = s("g", cls ? { class: cls } : {}); return (up: boolean) => (up ? b : a); };

  // Frames, outermost first, so inner ones sit on top.
  const frameL = pair("frames"), portL = pair("ports");
  const sel = (id: Id) => (hooks.selected === id ? " sel" : "");
  for (const f of [...scene.frames.values()].sort((a, b) => depth(a.parent) - depth(b.parent))) {
    const frameG = frameL(within(f.id)), portG = portL(within(f.id));
    const b = boxes.get(f.id)!;
    const r = s("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 9, class: `rg ${f.cls}${sel(f.id)}${picked.has(f.id) ? " picked" : ""}`, "data-id": f.id, "data-frame": f.id });
    if (f.id !== scene.defId) r.setAttribute("data-move", f.id);
    frameG.append(r, s("text", { x: b.x + 10, y: b.y + 14, class: "rt" }, f.title));
    if (f.id !== scene.defId && hooks.fold) frameG.append(foldToggle(b.x + b.w - 16, b.y + 14, f.id, "▾", "Fold into one box"));
    const port = (right: boolean) => (bd: Id, i: number) => {
      const p = point({ frame: f.id, port: i, right });
      portG.append(s("circle", { cx: p.x, cy: p.y, r: 6, class: `src${right ? " res" : ""}${sel(bd)}${scene.lit.has(bd) ? " lit" : ""}`, "data-src": bd, "data-id": bd }));
    };
    f.binders.forEach(port(false));
    f.results?.forEach(port(true));
    if (f.out) {
      const o = point({ frameOut: f.id });
      portG.append(f.cls === "loose"
        ? (() => { const c = s("circle", { cx: o.x, cy: o.y, r: 5, class: "outp", "data-out": f.id }); c.append(s("title", {}, "Drag onto an empty input to wire this part in")); return c; })()
        : s("circle", { cx: o.x, cy: o.y, r: 4, class: "outp" }));
    }
  }

  // Wires: each as points, so crossings can be found; a wire that crosses
  // one drawn before it hops over it.
  const wireL = pair("wires");
  const marks = s("g", { class: "tunnels" });
  const solid: { key: Id; box: Box }[] = [];
  for (const it of scene.items.values()) if (it.solid) { const p = pos.get(it.key)!; solid.push({ key: it.key, box: { x: p.x, y: p.y, w: it.w, h: it.h } }); }
  const endItem = (e: End) => ("item" in e ? e.item : null);
  const drawn: { pts: ReturnType<typeof curvePoints> }[] = [];
  const titles: Box[] = [...scene.frames.values()].map((f) => { const b = boxes.get(f.id)!; return { x: b.x + 6, y: b.y + 2, w: tw(f.title, 6.6) + 8, h: 16 }; });
  const all = [...scene.wires];
  // A frame's own result wire: from what it holds to its right edge.
  for (const f of scene.frames.values()) if (f.out) all.push({ from: f.out, to: { frameOut: f.id }, cls: "", flow: false });
  // Frames a wire neither starts nor ends in are in its way too, however
  // tall (BACKLOG E110); it doesn't tunnel under one, though: a frame is a
  // background.
  const open = [...scene.frames.keys()].map((k) => boxes.get(k)!);
  const touches = (q: Pos, b: Box) => q.x >= b.x - 2 && q.x <= b.x + b.w + 2 && q.y >= b.y - 2 && q.y <= b.y + b.h + 2;
  for (const w of all) {
    const a = point(w.from), b = point(w.to);
    const ends = new Set([endItem(w.from), endItem(w.to)]);
    const others = solid.filter((x) => !ends.has(x.key)).map((x) => x.box);
    // Around the nodes in the way, where it can; under them (a tunnel) where not.
    const walls = open.filter((f) => !touches(a, f) && !touches(b, f)).map((f) => ({ ...f, reach: f.h }));
    const { pts, bent } = route(a, b, [...others, ...walls], drawn.map((d) => d.pts), titles);
    const hops = crossingsOf(pts, drawn.map((d) => d.pts));
    const d = hops.length || bent ? hopPath(pts, hops) : curve(a.x, a.y, b.x, b.y);
    drawn.push({ pts });
    const wireG = wireL(lifted(w.from) && lifted(w.to));
    if (w.use) {
      const on = hooks.selected === w.use.dot || hooks.selected === w.use.ref;
      wireG.append(s("path", { d, class: "use-hit", "data-id": w.use.ref }), s("path", { d, class: `tw use${on ? " lit" : ""}` }));
    } else if (w.edge) {
      wireG.append(s("path", { d, class: "edge-hit", "data-edge": w.edge }), s("path", { d, class: `tw ${w.cls}`, "data-edge": w.edge }));
    } else wireG.append(s("path", { d, class: `tw ${w.cls}` }));
    // Under a node: the hidden stretch, drawn faintly over it.
    for (const run of tunnels(pts, others)) {
      marks.append(s("path", { d: `M${run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")}`, class: `tunnel${w.use ? " use" : ""}` }));
    }
  }

  // From each step of an action to the next: straight, dashed, under the items.
  for (const [a0, b0] of scene.then ?? []) {
    const a = point(a0), b = point(b0), wireG = wireL(lifted(a0) && lifted(b0));
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / l, uy = (b.y - a.y) / l;
    const head = (k: number) => `${(b.x - ux * 6 + k * uy * 3.5).toFixed(1)},${(b.y - uy * 6 - k * ux * 3.5).toFixed(1)}`;
    wireG.append(s("path", { d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}`, class: "then" }), s("path", { d: `M${head(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)} L${head(-1)}`, class: "then head" }));
  }

  // Items.
  const itemL = pair("items");
  for (const it of scene.items.values()) {
    const itemG = itemL(liftItem(it.key));
    const p = pos.get(it.key)!;
    const g = s("g", { transform: `translate(${p.x},${p.y})` }) as SVGGElement;
    if (scene.faded?.has(it.key)) g.classList.add("faded");
    it.draw(g);
    // A folded frame is drawn as an item: selected, it's outlined like one.
    if (hooks.selected === it.key) g.querySelector("rect.folded")?.classList.add("sel");
    if (picked.has(it.key)) g.prepend(s("rect", { x: -4, y: -4, width: it.w + 8, height: it.h + 8, rx: 9, class: "picked" }));
    if (scene.lit.has(it.key)) g.classList.add("lit");
    itemG.append(g);
  }
  // Frame parameter names, above everything in their frame.
  const nameL = pair();
  for (const f of scene.frames.values()) {
    f.binders.forEach((bd, i) => {
      const p = point({ frame: f.id, port: i });
      nameL(within(f.id)).append(s("text", { x: p.x + 9, y: p.y - 6, class: "portl halo" }, f.labels[i]));
    });
    f.results?.forEach((bd, i) => {
      const p = point({ frame: f.id, port: i, right: true });
      nameL(within(f.id)).append(s("text", { x: p.x - 9, y: p.y - 6, class: "portl halo", "text-anchor": "end" }, f.resultLabels![i]));
    });
  }

  // The definition's result.
  const out = s("g");
  if (scene.result) { const r = point(scene.result); out.append(s("text", { x: r.x + 8, y: r.y + 4, class: "portl halo" }, "frameOut" in scene.result && scene.frames.get(scene.result.frameOut)?.results?.length ? "holds" : "result")); }

  // Values: chips near the output they label, placed where they cover no
  // node and no other chip. With no room, a chip shrinks to a dot; hover it.
  const vals = s("g", { class: "vals" });
  if (hooks.values) {
    const want: { text: string; full: string; at: Pos; w: number; h: number; left?: boolean }[] = [];
    const add = (id: Id, at: Pos, left = false) => {
      const v = hooks.values!.get(id);
      if (v === undefined) return;
      const text = v.length > 24 ? `${v.slice(0, 23)}…` : v;
      want.push({ text, full: v, at, w: tw(text, 6.4) + 8, h: 15, left });
    };
    for (const it of scene.items.values()) if (it.value && it.out) { const p = pos.get(it.key)!; add(it.value, { x: p.x + it.out.x, y: p.y + it.out.y }); }
    for (const f of scene.frames.values()) f.binders.forEach((bd, i) => add(bd, point({ frame: f.id, port: i }), true));
    for (const f of scene.frames.values()) f.results?.forEach((bd, i) => add(bd, point({ frame: f.id, port: i, right: true })));
    for (const [b, e] of scene.sources) if ("item" in e && e.item !== b && !scene.items.has(b)) add(b, point(e));
    // Nodes, and the words already on the picture: parameter names, frame
    // titles, the result.
    const obstacles = solid.map((x) => x.box);
    for (const f of scene.frames.values()) {
      const b = boxes.get(f.id)!;
      obstacles.push({ x: b.x + 6, y: b.y + 2, w: tw(f.title, 6.2) + 8, h: 16 });
      f.labels.forEach((l, i) => { const p = point({ frame: f.id, port: i }); obstacles.push({ x: p.x + 6, y: p.y - 17, w: tw(l, 6.8) + 6, h: 14 }); });
    }
    if (scene.result) { const r = point(scene.result); obstacles.push({ x: r.x + 6, y: r.y - 8, w: 50, h: 16 }); }
    for (const it of scene.items.values()) if (it.label) { const p = pos.get(it.key)!; obstacles.push({ ...it.label, x: p.x + it.label.x, y: p.y + it.label.y }); }
    const spots = placeLabels(want, obstacles);
    want.forEach((v, i) => {
      const sp = spots[i];
      if (sp) {
        const g = s("g", { class: "val", transform: `translate(${sp.x},${sp.y})` });
        g.append(s("rect", { width: v.w, height: v.h, rx: 4 }), s("text", { x: 4, y: 11 }, v.text), s("title", {}, v.full));
        vals.append(g);
      } else vals.append(s("circle", { cx: v.at.x + 5, cy: v.at.y - 7, r: 3, class: "val-more" }, ), s("title", {}, v.full));
    });
    // A title can't hang off a circle that's a sibling: put it inside.
    for (const c of vals.querySelectorAll("circle.val-more")) { const t = c.nextElementSibling; if (t?.tagName === "title") c.append(t); }
  }
  return [...[false, true].flatMap((up) => [frameL(up), wireL(up), portL(up), ...(up ? [] : [marks]), itemL(up), nameL(up)]), out, vals];
}

// ---------------------------------------------------------------- tidy

// Items to move together: a frame stands for everything inside it.
function expand(scene: Scene, ids: Id[]): Set<Id> {
  const out = new Set<Id>();
  const inside = (it: Item, f: Id) => { for (let p = it.frame; p; p = scene.frames.get(p)?.parent ?? null) if (p === f) return true; return false; };
  for (const id of ids) {
    if (scene.items.has(id)) out.add(id);
    if (scene.frames.has(id)) for (const it of scene.items.values()) if (inside(it, id)) out.add(it.key);
  }
  return out;
}

// The scene as tidy and arrange see it: boxes, frames and wires.
function asLayout(scene: Scene, at: Record<Id, Pos>) {
  const { pos, boxes } = placeAll(scene, at);
  const nodes: TNode[] = [...scene.items.values()].map((it) => ({ id: it.key, ...pos.get(it.key)!, w: it.w, h: it.h, frame: it.frame }));
  const frames: TFrame[] = [...scene.frames.values()].map((f) => ({ id: f.id, parent: f.parent, pad: f.pad, minH: f.minH }));
  const wires: TWire[] = [];
  for (const w of scene.wires) {
    const end = (e: End): [string, number, number] | null => {
      if ("item" in e) return [e.item, e.dx, e.dy];
      if ("frame" in e) { const b = boxes.get(e.frame); return b ? [e.frame, e.right ? b.w : 0, HEADH + 4 + e.port * 22 + 11] : null; }
      const b = boxes.get(e.frameOut);
      return b ? [e.frameOut, b.w, b.h / 2] : null;
    };
    const a = end(w.from), b = end(w.to);
    if (a && b) wires.push({ from: a[0], fx: a[1], fy: a[2], to: b[0], tx: b[1], ty: b[2], flow: w.flow });
  }
  return { pos, nodes, frames, wires };
}

// A graph nobody has moved is drawn as Tidy everything draws it, so the
// two are one layout: folded frames are laid out as the boxes they are
// drawn as, after their contents are laid out inside them.
function autoArrange(scene: Scene, folded?: Set<Id>) {
  // Twice: arrange breaks ties by where things already are, and Tidy
  // everything starts from this layout, not from the one the graph was
  // built with, so one pass left it moving a pixel here and there (I56).
  for (let i = 0; i < 2; i++) for (const [k, p] of Object.entries(arrangeAll(scene, folded))) scene.items.get(k)!.auto = p;
}

// Where everything goes, laid out afresh: each folded frame's contents as
// they'd be with it open and the folded frames inside it shut, innermost
// first, then the whole with every folded frame as the box it's drawn as.
function arrangeAll(scene: Scene, folded?: Set<Id>): Record<Id, Pos> {
  const cur: Record<Id, Pos> = {};
  const { nodes, frames, wires } = asLayout(scene, {});
  for (const [k, p] of arrange(nodes, frames, wires, scene.chains)) cur[k] = p;
  if (!folded?.size) return cur;
  const parent = (f: Id) => scene.frames.get(f)?.parent ?? null;
  const depth = (f: Id) => { let n = 0; for (let p = parent(f); p; p = parent(p)) n++; return n; };
  const inside = (fr: Id | null, f: Id) => { for (let p = fr; p; p = parent(p)) if (p === f) return true; return false; };
  for (const f of [...folded].filter((g) => scene.frames.has(g)).sort((a, b) => depth(b) - depth(a))) {
    const shut = new Set([...folded].filter((g) => g !== f && !inside(f, g)));
    for (const [k, p] of Object.entries(unfoldMoves(scene, cur, tidyScene(fold(scene, cur, shut), cur, null), true)))
      if (inside(scene.items.get(k)?.frame ?? null, f)) cur[k] = p;
  }
  Object.assign(cur, unfoldMoves(scene, cur, tidyScene(fold(scene, cur, folded), cur, null), true));
  return cur;
}

// What moved from where it's drawn now.
function changed(scene: Scene, at: Record<Id, Pos>, to: Record<Id, Pos>): Record<Id, Pos> {
  const { pos } = placeAll(scene, at);
  const out: Record<Id, Pos> = {};
  for (const [k, p] of Object.entries(to)) { const o = pos.get(k); if (!o || Math.round(o.x) !== Math.round(p.x) || Math.round(o.y) !== Math.round(p.y)) out[k] = { x: Math.round(p.x), y: Math.round(p.y) }; }
  return out;
}

// Tidy what's inside a frame lays its contents out afresh, as Tidy
// everything would (arrange, steps and folded frames included), and keeps
// the frame's corner where it is.
function arrangeInside(scene: Scene, at: Record<Id, Pos>, folded: Set<Id> | undefined, f: Id): Record<Id, Pos> {
  const fresh = arrangeAll(scene, folded);
  const was = placeAll(scene, at).boxes.get(f), now = placeAll(scene, { ...at, ...fresh }).boxes.get(f);
  if (!was || !now) return {};
  const to: Record<Id, Pos> = {};
  for (const k of expand(scene, [f])) to[k] = { x: fresh[k].x + was.x - now.x, y: fresh[k].y + was.y - now.y };
  return changed(scene, at, to);
}

// Tidy everything lays it all out afresh (arrange), the same every time;
// tidying some only spaces those out from where they are.
function tidyScene(scene: Scene, at: Record<Id, Pos>, only: Set<Id> | null): Record<Id, Pos> {
  const { pos, nodes, frames, wires } = asLayout(scene, at);
  if (only) return Object.fromEntries(tidy(nodes, frames, wires, only));
  const moved: Record<Id, Pos> = {};
  for (const [k, p] of arrange(nodes, frames, wires, scene.chains)) { const o = pos.get(k)!; if (p.x !== o.x || p.y !== o.y) moved[k] = p; }
  return moved;
}

// ---------------------------------------------------------------- gestures

// Clicks select (shift-click picks several); double-click opens a
// definition. Dragging: a node's body moves it (and every other picked
// node); a port or dot wires that variable into an input; a node's output
// shares its value with an input; an input dragged into space is cleared;
// shift-drag on empty space picks what the box touches. Right-click asks
// the editor for a menu.
function interact(canvas: Canvas, scene: Scene, hooks: GraphHooks, picked: Set<Id>, draw: (at: Record<Id, Pos>) => void) {
  const root = canvas.root;
  // A click on empty space deselects; a press that panned doesn't.
  let down = { x: 0, y: 0 };
  root.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  root.addEventListener("click", (e) => {
    if (Date.now() - menuAt < 800) return;
    const folding = (e.target as Element).closest("[data-fold]")?.getAttribute("data-fold");
    if (folding) return hooks.fold?.(folding);
    const edge = (e.target as Element).closest("[data-edge]");
    if (edge && !e.shiftKey) {
      // A dot can change how the rest would be laid out (its let wraps the
      // part of the body that uses it), so everything stays where it is now,
      // and the dot's middle goes on the click; a dot is 12 across. Tidy
      // everything lays it out afresh.
      const w = world(canvas, e), { pos } = placeAll(scene, hooks.at);
      const keep = Object.fromEntries([...pos].filter(([k]) => !hooks.at[k]).map(([k, q]) => [k, { x: Math.round(q.x), y: Math.round(q.y) }]));
      return hooks.addDot(edge.getAttribute("data-edge")!, { dot: { x: Math.round(w.x - 6), y: Math.round(w.y - 6) }, keep });
    }
    const t = (e.target as Element).closest("[data-move], [data-id]");
    if (e.shiftKey) {
      const k = t?.getAttribute("data-move") ?? t?.getAttribute("data-id");
      if (k && (scene.items.has(k) || scene.frames.has(k))) { picked.has(k) ? picked.delete(k) : picked.add(k); draw(hooks.at); }
      return;
    }
    const id = (e.target as Element).closest("[data-id]")?.getAttribute("data-id");
    if (id) { if (picked.size) picked.clear(); hooks.select(id); }
    else if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) { if (picked.size) { picked.clear(); draw(hooks.at); } hooks.select(null); }
  });
  root.addEventListener("dblclick", (e) => {
    const t = (e.target as Element).closest("[data-id]");
    if (t) hooks.open(t.getAttribute("data-id")!);
  });
  // A touch held still for half a second is a right-click: iOS has none.
  // Where the browser has its own (Android), the first of the two wins.
  let letGo = () => {}, waiting = false;
  root.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "touch") return;
    // A second finger is a pinch, not a long press.
    if (waiting) return letGo();
    const at = { x: ev.clientX, y: ev.clientY }, t = ev.target as Element;
    const mv = (e: PointerEvent) => { if (Math.hypot(e.clientX - at.x, e.clientY - at.y) > 8) letGo(); };
    const timer = setTimeout(() => {
      letGo();
      held = Date.now();
      t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
    }, 500);
    waiting = true;
    letGo = () => { waiting = false; clearTimeout(timer); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", letGo); window.removeEventListener("pointercancel", letGo); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", letGo);
    window.addEventListener("pointercancel", letGo);
  });
  root.addEventListener("contextmenu", (e) => {
    if (!hooks.menu) return;
    e.preventDefault();
    letGo();
    if (e.isTrusted && Date.now() - held < 1000) return;
    // Ours (a long press) or the browser's from a touch: a tap will follow.
    if (!e.isTrusted || (e as PointerEvent).pointerType === "touch") menuAt = Date.now();
    const el = e.target as Element;
    const hole = el.closest(".pill.hole, circle.inp.empty")?.getAttribute("data-slot");
    // A let node is its value's name: the same menu as a dot's.
    const src = el.closest("[data-src]")?.getAttribute("data-src") ?? el.closest("rect.letn")?.getAttribute("data-id");
    const fr = el.closest("[data-frame]")?.getAttribute("data-frame");
    const id = el.closest("[data-id]")?.getAttribute("data-id");
    const slot = el.closest("[data-slot]")?.getAttribute("data-slot");
    const target: MenuTarget = hole ? { kind: "hole", id: hole }
      : src ? { kind: "binder", id: src }
      : fr && fr !== scene.defId ? { kind: "frame", id: fr }
      : id && !fr ? { kind: "node", id }
      : slot ? { kind: "node", id: slot }
      : { kind: "space" };
    hooks.menu(target, { x: e.clientX, y: e.clientY }, world(canvas, e));
  });
  root.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const start = ev.target as Element;
    const add = start.closest("[data-add]")?.getAttribute("data-add");
    if (add && hooks.addItem) { ev.preventDefault(); hooks.addItem(add); return; }
    // A step done only for its effect has no value to wire: a drag moves it.
    const src = start.closest("[data-src]:not(.silent)")?.getAttribute("data-src");
    const out = start.closest("[data-out]")?.getAttribute("data-out");
    const slot = start.closest("circle.inp")?.getAttribute("data-slot");
    const mv = start.closest("[data-move]")?.getAttribute("data-move");
    // Alt-drag moves anything, dots included (a plain drag from a dot wires),
    // and so does a drag from a picked dot: the way to move one by touch.
    if (!ev.altKey && !(src && mv && picked.has(src)) && (src || out || slot)) {
      ev.preventDefault();
      const check = src ? (t: string) => hooks.canUse(src, t) : out ? hooks.canShare(out) : null;
      // A value can also go on a list's or a chain's +: a new item, wired to it.
      const targets = (src || out) && hooks.addFrom ? "[data-slot], [data-add]" : "[data-slot]";
      connectDrag(root, ev, targets, check && ((t) => (t.hasAttribute("data-add") ? null : check(t.getAttribute("data-slot")!))), (target) => {
        const to = target?.getAttribute("data-slot");
        const row = target?.getAttribute("data-add");
        if (row && (src || out)) hooks.addFrom?.(row, (src ?? out)!, !!src);
        else if (src && to) hooks.use(src, to);
        else if (out && to) hooks.share(out, to);
        else if (slot && !to) hooks.clear(slot);
        else if (slot && to && to !== slot) hooks.reorder?.(slot, to);
      });
    } else if (mv) {
      ev.preventDefault();
      const group = picked.has(mv) && picked.size > 1 ? [...picked] : [mv];
      const keys = [...expand(scene, group)];
      const { pos } = placeAll(scene, hooks.at);
      const from = new Map(keys.map((k) => [k, pos.get(k)!]));
      let now: Record<Id, Pos> = {};
      moveDrag(root, ev, (dx, dy) => {
        now = Object.fromEntries(keys.map((k) => [k, { x: Math.round(from.get(k)!.x + dx), y: Math.round(from.get(k)!.y + dy) }]));
        draw({ ...hooks.at, ...now });
      }, (moved) => { if (moved) hooks.moved(now); }, canvas.zoom());
    } else if (ev.shiftKey && !start.closest("[data-id]")) {
      // Pick with a box.
      ev.preventDefault();
      const a = world(canvas, ev);
      const box = s("rect", { class: "marquee" });
      canvas.world.append(box);
      const mv2 = (e: PointerEvent) => {
        const b = world(canvas, e);
        box.setAttribute("x", String(Math.min(a.x, b.x))); box.setAttribute("y", String(Math.min(a.y, b.y)));
        box.setAttribute("width", String(Math.abs(b.x - a.x))); box.setAttribute("height", String(Math.abs(b.y - a.y)));
      };
      const up = (e: PointerEvent) => {
        window.removeEventListener("pointermove", mv2);
        window.removeEventListener("pointerup", up);
        const b = world(canvas, e);
        const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
        const { pos } = placeAll(scene, hooks.at);
        for (const it of scene.items.values()) { const p = pos.get(it.key)!; if (overlaps(r, { x: p.x, y: p.y, w: it.w, h: it.h })) picked.add(it.key); }
        draw(hooks.at);
      };
      window.addEventListener("pointermove", mv2);
      window.addEventListener("pointerup", up);
    }
  });
}

// The pointer in world coordinates.
function world(canvas: Canvas, e: { clientX: number; clientY: number }): Pos {
  const p = svgPoint(canvas.root, e);
  const m = canvas.world.transform.baseVal.consolidate()?.matrix;
  if (!m) return p;
  return { x: (p.x - m.e) / m.a, y: (p.y - m.f) / m.d };
}
