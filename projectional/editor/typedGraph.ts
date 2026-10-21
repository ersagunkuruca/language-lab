// The node view of a typed program. Same tree as the blocks, drawn as data
// flow, left to right:
//   a call       a node; its inputs are ports, its arguments are wired in
//   a variable   a wire: every use fans out from where it's bound (a
//                function's or case's port, or a let's dot)
//   a function   a region; its parameters are ports on the region's left edge
//   a let        a dot on a wire, as in Blender's node editor: the value flows
//                into the dot and a wire runs from it to every use. The name
//                is an optional label (unnamed dots show a handle, •1).
//   match, fold  a node like any call: the value, then one function per case
//                (a frame whose parameters are the case's fields and, for a
//                fold, the already-folded parts). `if` is a match on Bool.
//   effects      a badge on every node whose call performs one (Choice,
//                Console, Diverge), and on handlers the effect they remove.
//
// Wiring is editing: drag a port or a dot onto an input to use that variable
// there; inputs it can't reach (out of scope, wrong type) are dimmed while
// you drag and say why. Drag a node's output onto an input to share its value
// there: that puts a dot on its wire. Click a wire to put a dot on it. Drag an
// input's wire into empty space to leave a hole there.
//
// Drag a node to move it. The automatic layout places everything; a moved
// node keeps an offset from that place (layout.json), so edits elsewhere
// don't scatter it. What it feeds into keeps it inside: a node can't leave
// its function or case, and frames grow to hold what's dragged out.
// Drawn on the shared canvas (canvas.ts), like networks.

import type { Code, Id, NodeOf } from "../src/model.ts";
import type { Presentation } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { S, SIGS, TRUE, FALSE } from "../src/lang/std.ts";
import { CHOICE, DIVERGE, showType, type Type } from "../src/lang/types.ts";
import { absOf, connectDrag, curve, moveDrag, s, type Pos } from "./canvas.ts";
import { planSolve } from "../src/lang/solve.ts";
import { portLabel } from "../src/relational.ts";

const tw = (t: string, px = 7.4) => t.length * px;

// A laid-out piece: its group, how far it reaches right (w) and down (h), and
// left (x0) and up (y0) when something inside was dragged past its origin.
interface L { g: SVGGElement; w: number; h: number; outY: number; id?: Id; x0?: number; y0?: number }

export interface GraphHooks {
  selected: Id | null;
  select: (id: Id) => void;
  open: (id: Id) => void;
  // null when allowed, else why not
  canUse: (binder: Id, slot: Id) => string | null;
  use: (binder: Id, slot: Id) => void;
  clear: (slot: Id) => void;
  addDot: (slot: Id) => void;
  // Sharing a node's output: a check per input, and the edit.
  canShare: (from: Id) => (slot: Id) => string | null;
  share: (from: Id, slot: Id) => void;
  // Offsets from the automatic layout, and saving one.
  offsets: Record<Id, Pos>;
  moved: (id: Id, off: Pos) => void;
}

const HANDLES: Record<Id, Id> = { [S.all]: CHOICE, [S.count]: CHOICE, [S.first]: CHOICE, [S.fuel]: DIVERGE };

export function typedGraph(code: Code, pres: Presentation, info: Info | null, defId: Id, hooks: GraphHooks): SVGSVGElement {
  const root = s("svg", { class: "tgraph" }) as SVGSVGElement;
  const draw = (offsets: Record<Id, Pos>) => root.replaceChildren(...build(code, pres, info, defId, hooks, offsets, root));
  draw(hooks.offsets);
  interact(root, hooks, draw);
  return root;
}

function build(code: Code, pres: Presentation, info: Info | null, defId: Id, hooks: GraphHooks, offsets: Record<Id, Pos>, svgEl: SVGSVGElement): SVGElement[] {
  const names = pres.names;
  const node = (id: Id) => code.nodes[id];
  const name = (id: Id) => names[id] ?? (node(id)?.kind === "builtin" ? (node(id) as NodeOf<"builtin">).op : "?");
  const typeOf = (id: Id) => { const t = info?.typeOf.get(id); return t ? showType(info!.subst.zonk(t), names) : ""; };
  const sel = (id: Id) => (hooks.selected === id ? " sel" : "");
  const errs = new Set((info?.errors ?? []).map((e) => e.id));
  // Where each variable comes from (a port or a dot), and its uses: every
  // use is drawn as a wire from its source, so a value used twice fans out.
  const dots = new Map<Id, { el: SVGElement; x: number; y: number }>();
  const uses: { dot: Id; ref: Id; el: SVGElement; x: number; y: number }[] = [];
  const dotOf = (id: Id): Id | null => {
    const n = node(id);
    return n?.kind === "ref" && node(n.target)?.kind === "binder" ? n.target : null;
  };

  const group = (): SVGGElement => s("g") as SVGGElement;
  // Put a node where the layout says, moved by its saved offset. Returns
  // where it went; containers grow (in every direction) to hold it.
  const place = (l: L, x: number, y: number): Pos => {
    const o = (l.id && offsets[l.id]) || { x: 0, y: 0 };
    const p = { x: x + o.x, y: y + o.y };
    l.g.setAttribute("transform", `translate(${p.x},${p.y})`);
    return p;
  };
  // Mark the shape you grab to move a node.
  const grab = (el: SVGElement, id: Id) => { el.setAttribute("data-move", id); return el; };
  // `edge`: the node whose value runs along this wire; clicking it puts a
  // dot there. Only for values worth sharing (not holes or variables).
  const wire = (g: SVGGElement, x1: number, y1: number, x2: number, y2: number, cls = "", edge?: Id) => {
    const d = curve(x1, y1, x2, y2);
    const e = edge ? node(edge) : null;
    if (e && e.kind !== "hole" && !(e.kind === "ref" && node(e.target)?.kind === "binder")) {
      g.prepend(s("path", { d, class: "edge-hit", "data-edge": edge! }), s("path", { d, class: `tw ${cls}`, "data-edge": edge! }));
      (g.firstChild as SVGElement).append(s("title", {}, "Click to put a dot on this wire"));
    } else g.prepend(s("path", { d, class: `tw ${cls}` }));
  };
  const titled = (el: SVGElement, t: string) => { if (t) el.append(s("title", {}, t)); return el; };

  // Effects this call itself brings in: from the callee's own signature,
  // not from the row it was unified with here (that also carries whatever
  // the surrounding code does).
  const effectsOf = (call: NodeOf<"call">): { does: string[]; handles?: string } => {
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

  const pill = (id: Id, text: string, cls: string, src?: Id): L => {
    const g = group();
    const w = Math.max(28, tw(text) + 18), h = 24;
    const r = titled(s("rect", { width: w, height: h, rx: 12, class: `pill ${cls}${sel(id)}${errs.has(id) ? " err" : ""}`, "data-id": id }), typeOf(id));
    g.append(r, s("text", { x: w / 2, y: 16, class: "pl", "text-anchor": "middle" }, text));
    if (src) r.setAttribute("data-src", src);
    if (cls.includes("hole")) r.setAttribute("data-slot", id);
    else grab(r, id);
    return { g, w, h, outY: h / 2 };
  };

  // Where a dot's wire ends when the use isn't an input of a call.
  const stub = (id: Id, dot: Id): L => {
    const g = group();
    g.append(titled(s("circle", { cx: 5, cy: 9, r: 4, class: `inp use${sel(id)}`, "data-slot": id, "data-id": id }), `${name(dot)}${typeOf(id) ? ` : ${typeOf(id)}` : ""}`));
    uses.push({ dot, ref: id, el: g, x: 1, y: 9 });
    return { g, w: 10, h: 18, outY: 9 };
  };

  const lay = (id: Id): L => ({ ...layNode(id), id });
  const layNode = (id: Id): L => {
    const n = node(id);
    const d = dotOf(id);
    if (d) return stub(id, d);
    switch (n.kind) {
      case "lit": return pill(id, typeof n.value === "string" ? JSON.stringify(n.value) : String(n.value), "lit");
      case "hole": {
        const hi = info?.holes.get(id);
        return pill(id, `□ ${hi ? showType(info!.subst.zonk(hi.expected), names) : ""}`.trim(), "hole");
      }
      case "ref": {
        const t = node(n.target);
        return t?.kind === "binder" ? pill(id, name(n.target), "var", n.target) : pill(id, name(n.target), t?.kind === "variant" ? "con" : "fnref");
      }
      case "lambda": return region(id, `(${n.params.map(name).join(", ")}) =>`, n.params, n.body, "lam");
      case "match": case "fold": return cases(id, n);
      case "call": return node(n.fn).kind === "lambda" ? letRegion(id, n) : call(id, n);
      case "solve": return solve(id, n);
      default: return pill(id, n.kind, "lit");
    }
  };

  // A call: arguments stacked on the left, wired into the node's inputs.
  const call = (id: Id, n: NodeOf<"call">): L => {
    const f = node(n.fn);
    const nota = f.kind === "ref" ? pres.style.notation[f.target] : undefined;
    const label = f.kind === "ref" ? (nota?.glyph?.trim() || name(f.target)) : "apply";
    const inputs = f.kind === "ref" ? n.args : [n.fn, ...n.args];
    const kids = inputs.map((a): L => (dotOf(a) ? { g: group(), w: 0, h: 18, outY: 9 } : lay(a)));
    const eff = effectsOf(n);
    const badge = [...eff.does, ...(eff.handles ? [`handles ${eff.handles}`] : [])].join(" · ");
    const gap = 8;
    const colW = Math.max(0, ...kids.map((k) => k.w));
    const kidsH = kids.reduce((a, k) => a + k.h, 0) + gap * Math.max(0, kids.length - 1);
    const bw = Math.max(44, tw(label, 8.2) + 24, badge ? tw(badge, 6.4) + 16 : 0);
    const bh = Math.max(30, inputs.length * 18 + 12) + (badge ? 14 : 0);
    let h = Math.max(kidsH, bh);
    const bx = kids.length ? colW + 34 : 0, by = (h - bh) / 2;
    const g = group();
    let y = (h - kidsH) / 2;
    const top = badge ? 14 : 0;
    const portY = (i: number) => by + top + ((bh - top) / (inputs.length + 1)) * (i + 1);
    let w = bx + bw, x0 = 0, y0 = 0;
    kids.forEach((k, i) => {
      const d = dotOf(inputs[i]);
      if (d) uses.push({ dot: d, ref: inputs[i], el: g, x: bx, y: portY(i) });
      else {
        const p = place(k, colW - k.w, y);
        g.append(k.g);
        wire(g, p.x + k.w, p.y + k.outY, bx, portY(i), "", inputs[i]);
        w = Math.max(w, p.x + k.w);
        h = Math.max(h, p.y + k.h);
        x0 = Math.min(x0, p.x + (k.x0 ?? 0));
        y0 = Math.min(y0, p.y + (k.y0 ?? 0));
      }
      y += k.h + gap;
    });
    const box = titled(grab(s("rect", { x: bx, y: by, width: bw, height: bh, rx: 7, class: `cn${eff.does.length ? " eff" : ""}${eff.handles ? " handler" : ""}${sel(id)}${errs.has(id) ? " err" : ""}`, "data-id": id }), id), typeOf(id));
    g.append(box);
    if (badge) g.append(s("text", { x: bx + bw / 2, y: by + 11, class: "badge", "text-anchor": "middle" }, badge));
    g.append(s("text", { x: bx + bw / 2, y: by + top + (bh - top) / 2 + 5, class: "cl", "text-anchor": "middle" }, label));
    inputs.forEach((a, i) => g.append(titled(s("circle", { cx: bx, cy: portY(i), r: 5, class: "inp", "data-slot": a }), typeOf(a))));
    g.append(titled(s("circle", { cx: bx + bw, cy: by + bh / 2, r: 5, class: "outp", "data-out": id }), "Drag onto another input to share this value there"));
    return { g, w, h, x0, y0, outY: by + bh / 2 };
  };

  // Binder ports on a region's left edge; the body inside; out on the right.
  const PAD = 10, HEAD = 20;
  const portsW = (binders: Id[]) => Math.max(0, ...binders.map((b) => tw(name(b), 6.8) + 18));
  const ports = (g: SVGGElement, binders: Id[], x: number, y0: number) => {
    binders.forEach((b, i) => {
      const y = y0 + i * 22 + 11;
      g.append(titled(s("circle", { cx: x, cy: y, r: 6, class: `src${sel(b)}`, "data-src": b, "data-id": b }), typeOf(b)));
      g.append(s("text", { x: x + 9, y: y - 6, class: "portl" }, name(b)));
      dots.set(b, { el: g, x, y });
    });
  };
  // A frame spans (x0, y0) to (x1, y1) in its group; x0, y0 go negative when
  // something inside was dragged up or left past where the frame began.
  const frame = (g: SVGGElement, id: Id, title: string, x0: number, y0: number, x1: number, y1: number, cls: string) => {
    const r = s("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 9, class: `rg ${cls}${sel(id)}`, "data-id": id });
    if (id !== defId) grab(r, id);
    titled(r, typeOf(id));
    g.prepend(r);
    g.append(s("text", { x: x0 + 10, y: y0 + 14, class: "rt" }, title));
  };

  const region = (id: Id, title: string, binders: Id[], body: Id, cls: string): L => {
    const g = group();
    const pw = portsW(binders), ph = binders.length * 22;
    const b = lay(body);
    const bx = Math.max(pw + 14, PAD), innerH = Math.max(ph + 8, b.h);
    const at = place(b, bx, HEAD + (innerH - b.h) / 2);
    g.append(b.g);
    // The parameters stay on the frame's left edge, however far it grew.
    const x0 = Math.min(0, at.x + (b.x0 ?? 0) - bx), y0 = Math.min(0, at.y + (b.y0 ?? 0) - HEAD);
    ports(g, binders, x0, y0 + HEAD + 4);
    const h = Math.max(y0 + HEAD + innerH + PAD, at.y + b.h + PAD), w = Math.max(at.x + b.w + 22, x0 + tw(title, 6.6) + 20);
    const outY = at.y + b.outY;
    wire(g, at.x + b.w, outY, w, outY);
    frame(g, id, title, x0, y0, w, h, cls);
    g.append(s("circle", { cx: w, cy: outY, r: 4, class: "outp" }));
    return { g, w, h, outY, id, x0, y0 };
  };

  // A relation used in one direction: the given ports are inputs on the left,
  // the solved ones are sources on the right (all from the same solution),
  // and what follows uses them. The badge says whether it's pure: Choice when
  // the solver can find several answers or none.
  const solve = (id: Id, n: NodeOf<"solve">): L => {
    const label = (k: string) => (k === "out" ? "result" : portLabel(code, names, n.fn, k));
    const givenKeys = Object.keys(n.given), boundKeys = Object.keys(n.binds);
    const inputs = givenKeys.map((k) => n.given[k]);
    const kids = inputs.map((a): L => (dotOf(a) ? { g: group(), w: 0, h: 18, outY: 9 } : lay(a)));
    let badge = "";
    try {
      const plan = planSolve(code, n);
      badge = plan.status === "underdetermined" ? `needs ${plan.needMore} more` : plan.unique ? "one answer" : `Choice${plan.many ? " · several answers" : ""}${plan.canFail ? " · may have none" : ""}`;
    } catch {}
    const choice = /Choice|needs/.test(badge);
    const title = `solve ${pres.style.notation[n.fn]?.glyph?.trim() || name(n.fn)}`;
    const rows = Math.max(givenKeys.length, boundKeys.length);
    const lw = Math.max(0, ...givenKeys.map((k) => tw(label(k), 6.6))), rw = Math.max(0, ...boundKeys.map((k) => tw(label(k), 6.6)));
    const bw = Math.max(70, tw(title, 8.2) + 24, tw(badge, 6.4) + 16, lw + rw + 36);
    const top = 34;
    const bh = top + rows * 20 + 6;
    const gap = 8;
    const colW = Math.max(0, ...kids.map((k) => k.w));
    const kidsH = kids.reduce((a, k) => a + k.h, 0) + gap * Math.max(0, kids.length - 1);
    const g = group();
    let h = Math.max(kidsH, bh);
    const bx = kids.length ? colW + 34 : 0, by = (h - bh) / 2;
    const portY = (i: number) => by + top + i * 20 + 8;
    let w = bx + bw, x0 = 0, y0 = 0;
    let y = (h - kidsH) / 2;
    kids.forEach((k, i) => {
      const d = dotOf(inputs[i]);
      if (d) uses.push({ dot: d, ref: inputs[i], el: g, x: bx, y: portY(i) });
      else {
        const p = place(k, colW - k.w, y);
        g.append(k.g);
        wire(g, p.x + k.w, p.y + k.outY, bx, portY(i), "", inputs[i]);
        w = Math.max(w, p.x + k.w);
        h = Math.max(h, p.y + k.h);
        x0 = Math.min(x0, p.x + (k.x0 ?? 0));
        y0 = Math.min(y0, p.y + (k.y0 ?? 0));
      }
      y += k.h + gap;
    });
    g.append(titled(grab(s("rect", { x: bx, y: by, width: bw, height: bh, rx: 7, class: `cn rel${choice ? " eff" : ""}${sel(id)}${errs.has(id) ? " err" : ""}`, "data-id": id }), id), typeOf(id)));
    g.append(s("text", { x: bx + bw / 2, y: by + 12, class: "badge", "text-anchor": "middle" }, badge));
    g.append(s("text", { x: bx + bw / 2, y: by + 27, class: "cl", "text-anchor": "middle" }, title));
    givenKeys.forEach((k, i) => {
      g.append(titled(s("circle", { cx: bx, cy: portY(i), r: 5, class: "inp", "data-slot": n.given[k] }), typeOf(n.given[k])));
      g.append(s("text", { x: bx + 9, y: portY(i) + 4, class: "portl" }, label(k)));
    });
    boundKeys.forEach((k, i) => {
      const b = n.binds[k];
      const py = portY(i);
      g.append(s("text", { x: bx + bw - 9, y: py + 4, class: "portl", "text-anchor": "end" }, name(b) === label(k) ? label(k) : `${label(k)} → ${name(b)}`));
      g.append(titled(s("circle", { cx: bx + bw, cy: py, r: 6, class: `src${sel(b)}`, "data-src": b, "data-id": b }), `${name(b)}${typeOf(b) ? ` : ${typeOf(b)}` : ""}`));
      dots.set(b, { el: g, x: bx + bw, y: py });
    });
    const body = lay(n.body);
    const at = place(body, bx + bw + 40 + Math.max(0, ...boundKeys.map((k) => tw(name(n.binds[k]), 6.8))), Math.max(0, (h - body.h) / 2));
    g.append(body.g);
    return { g, w: Math.max(w, at.x + body.w), h: Math.max(h, at.y + body.h), x0: Math.min(x0, at.x + (body.x0 ?? 0)), y0: Math.min(y0, at.y + (body.y0 ?? 0)), outY: at.y + body.outY };
  };

  // A let: each value flows into its dot; wires from the dots run to the
  // uses. No box: the dot is the whole construct. A dot nothing reads
  // (`_ = print(…)`) is a step done for its effect, before what follows.
  const letRegion = (_id: Id, n: NodeOf<"call">): L => {
    // A run of lets is one column of steps, then what they lead to.
    const steps: [Id, Id][] = [];
    let rest: Id = n.id;
    for (let c = node(rest); c.kind === "call" && node(c.fn).kind === "lambda"; c = node(rest)) {
      const lam = node(c.fn) as NodeOf<"lambda">;
      lam.params.forEach((p, i) => steps.push([p, (c as NodeOf<"call">).args[i]]));
      rest = lam.body;
    }
    const g = group();
    const vals = steps.map(([, v]) => lay(v));
    const colW = Math.max(0, ...vals.map((v) => v.w));
    const labW = Math.max(0, ...steps.map(([p]) => (name(p) === "_" ? 0 : tw(name(p), 6.8) / 2))) + 26;
    let y = 0, w = 0, h = 0, x0 = 0, y0 = 0;
    vals.forEach((v, i) => {
      const b = steps[i][0];
      const silent = name(b) === "_";
      const at = place(v, colW - v.w, y);
      g.append(v.g);
      // The dot rides along with its value.
      const py = at.y + v.outY, dotX = Math.max(colW, at.x + v.w) + 22;
      wire(g, at.x + v.w, py, dotX, py);
      w = Math.max(w, dotX + labW);
      h = Math.max(h, at.y + v.h);
      x0 = Math.min(x0, at.x + (v.x0 ?? 0));
      y0 = Math.min(y0, at.y + (v.y0 ?? 0));
      const t = silent ? "a step done for its effect; nothing reads it" : `${name(b)}${typeOf(b) ? ` : ${typeOf(b)}` : ""}. Drag from here to use it; select it to name it`;
      g.append(titled(s("circle", { cx: dotX, cy: py, r: silent ? 4 : 6, class: `reroute${silent ? " silent" : ""}${sel(b)}`, "data-src": b, "data-id": b }), t));
      if (!silent) g.append(s("text", { x: dotX, y: py - 10, class: `dotl${names[b] === undefined ? " anon" : ""}`, "text-anchor": "middle" }, name(b)));
      dots.set(b, { el: g, x: dotX, y: py });
      y += v.h + 18;
    });
    const valsH = Math.max(0, y - 18);
    const body = lay(rest);
    const bx = colW + 22 + labW;
    const at = place(body, bx, Math.max(0, (Math.max(valsH, body.h) - body.h) / 2));
    g.append(body.g);
    return { g, w: Math.max(w, at.x + body.w), h: Math.max(h, valsH, at.y + body.h), x0: Math.min(x0, at.x + (body.x0 ?? 0)), y0: Math.min(y0, at.y + (body.y0 ?? 0)), outY: at.y + body.outY };
  };

  // if, match and fold are ordinary nodes: the value goes in first, then one
  // function per case, each drawn as a frame whose parameters are that
  // case's fields (and, for a fold, the parts already folded). Only the
  // chosen case's function runs. A case can't be missing: there is one
  // input per case of the type.
  const cases = (id: Id, n: NodeOf<"match"> | NodeOf<"fold">): L => {
    const armNodes = n.arms.map((a) => node(a) as NodeOf<"arm">);
    const isIf = n.kind === "match" && armNodes.length === 2 && armNodes.every((a) => [TRUE, FALSE].includes(a.variant));
    const type = armNodes[0] && info?.owner.get(armNodes[0].variant);
    const title = isIf ? "if" : `${n.kind}${type ? ` ${name(type)}` : ""}`;
    const ins: { label: string; slot?: Id; kid: L | null; ref?: Id }[] = [];
    const sd = dotOf(n.scrutinee);
    ins.push({ label: isIf ? "condition" : "value", slot: n.scrutinee, kid: sd ? null : lay(n.scrutinee), ref: sd ? n.scrutinee : undefined });
    for (const arm of armNodes) {
      const results = arm.results.filter((r): r is Id => r !== null);
      const params = [...arm.binds, ...results];
      const label = isIf ? (arm.variant === TRUE ? "then" : "else") : name(arm.variant);
      ins.push({ label, kid: region(arm.id, `(${params.map(name).join(", ")}) =>`, params, arm.body, "arm") });
    }
    if (n.kind === "match" && n.otherwise) ins.push({ label: "otherwise", kid: lay(n.otherwise) });

    const gap = 8;
    const kids = ins.map((x) => x.kid ?? { g: group(), w: 0, h: 18, outY: 9 });
    const colW = Math.max(0, ...kids.map((k) => k.w));
    const kidsH = kids.reduce((a, k) => a + k.h, 0) + gap * Math.max(0, kids.length - 1);
    const lw = Math.max(0, ...ins.map((x) => tw(x.label, 6.6)));
    const bw = Math.max(64, tw(title, 8.2) + 24, lw + 30);
    const bh = 30 + ins.length * 20;
    let h = Math.max(kidsH, bh);
    const bx = colW + 34;
    const g = group();
    // Line each input up with its case where there's room; never overlap.
    let y = (h - kidsH) / 2;
    const by = (h - bh) / 2;
    const portY = (i: number) => by + 30 + i * 20;
    let w = bx + bw, x0 = 0, y0 = 0;
    kids.forEach((k, i) => {
      const x = ins[i];
      if (x.ref) uses.push({ dot: dotOf(x.ref)!, ref: x.ref, el: g, x: bx, y: portY(i) });
      else {
        const p = place(k, colW - k.w, y);
        g.append(k.g);
        wire(g, p.x + k.w, p.y + k.outY, bx, portY(i), i ? "fn" : "", x.slot);
        w = Math.max(w, p.x + k.w);
        h = Math.max(h, p.y + k.h);
        x0 = Math.min(x0, p.x + (k.x0 ?? 0));
        y0 = Math.min(y0, p.y + (k.y0 ?? 0));
      }
      y += k.h + gap;
    });
    g.append(titled(grab(s("rect", { x: bx, y: by, width: bw, height: bh, rx: 7, class: `cn case${sel(id)}${errs.has(id) ? " err" : ""}`, "data-id": id }), id), typeOf(id)));
    g.append(s("text", { x: bx + bw / 2, y: by + 19, class: "cl", "text-anchor": "middle" }, title));
    ins.forEach((x, i) => {
      g.append(titled(s("circle", { cx: bx, cy: portY(i), r: 5, class: i ? "inp fn" : "inp", ...(x.slot ? { "data-slot": x.slot } : {}) }), i ? `the function for ${x.label}` : typeOf(n.scrutinee)));
      g.append(s("text", { x: bx + 9, y: portY(i) + 4, class: "portl" }, x.label));
    });
    g.append(titled(s("circle", { cx: bx + bw, cy: by + bh / 2, r: 5, class: "outp" }), typeOf(id)));
    return { g, w, h, x0, y0, outY: by + bh / 2 };
  };

  // The definition itself: its parameters, its body, its result.
  const def = node(defId) as NodeOf<"def">;
  const body = def.body ? node(def.body) : null;
  let top: L;
  if (body?.kind === "lambda") top = region(defId, `${name(defId)} : ${typeOf(defId)}`, body.params, body.body, "def");
  else if (body && body.kind !== "typedef") top = lay(def.body!);
  else top = pill(defId, `type ${name(defId)}: see the blocks`, "lit");
  const M = 14;
  // Anything dragged above or left of the whole picture moves its origin.
  const at = place(top, M + 8 - (top.x0 ?? 0), M - (top.y0 ?? 0));
  const W = at.x + top.w + M + 48, H = at.y + top.h + M;
  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svgEl.setAttribute("width", String(W));
  svgEl.setAttribute("height", String(H));
  const result = s("text", { x: at.x + top.w + 8, y: at.y + top.outY + 4, class: "portl" }, "result");

  // Wires from each source to its uses, drawn last, in the picture's
  // coordinates. The groups aren't in the svg yet, so start from top.g.
  const shared = s("g", { class: "uses" });
  const holder = s("g");
  holder.append(top.g);
  for (const u of uses) {
    const d = dots.get(u.dot);
    if (!d) continue;
    const a = absOf(holder, d.el, d.x, d.y), b = absOf(holder, u.el, u.x, u.y);
    const path = curve(a.x + 6, a.y, b.x, b.y);
    shared.append(titled(s("path", { d: path, class: "use-hit", "data-id": u.ref }), `${name(u.dot)}: click to select this use`), s("path", { d: path, class: `tw use${hooks.selected === u.dot || hooks.selected === u.ref ? " lit" : ""}` }));
  }
  return [top.g, result, shared];
}

// Clicks select; double-click opens a definition. Dragging: a node's body
// moves it; a port or dot wires that variable into an input; a node's output
// shares its value with an input; an input dragged into space is cleared.
function interact(root: SVGSVGElement, hooks: GraphHooks, draw: (offsets: Record<Id, Pos>) => void) {
  root.addEventListener("click", (e) => {
    const edge = (e.target as Element).closest("[data-edge]");
    if (edge) return hooks.addDot(edge.getAttribute("data-edge")!);
    const t = (e.target as Element).closest("[data-id]");
    if (t) hooks.select(t.getAttribute("data-id")!);
  });
  root.addEventListener("dblclick", (e) => {
    const t = (e.target as Element).closest("[data-id]");
    if (t) hooks.open(t.getAttribute("data-id")!);
  });
  root.addEventListener("pointerdown", (ev) => {
    const start = ev.target as Element;
    const src = start.closest("[data-src]")?.getAttribute("data-src");
    const out = start.closest("[data-out]")?.getAttribute("data-out");
    const slot = start.closest("circle.inp")?.getAttribute("data-slot");
    const mv = start.closest("[data-move]")?.getAttribute("data-move");
    if (src || out || slot) {
      ev.preventDefault();
      const check = src ? (t: string) => hooks.canUse(src, t) : out ? hooks.canShare(out) : null;
      connectDrag(root, ev, "[data-slot]", check && ((t) => check(t.getAttribute("data-slot")!)), (target) => {
        const to = target?.getAttribute("data-slot");
        if (src && to) hooks.use(src, to);
        else if (out && to) hooks.share(out, to);
        else if (slot && !to) hooks.clear(slot);
      });
    } else if (mv) {
      ev.preventDefault();
      const o = hooks.offsets[mv] ?? { x: 0, y: 0 };
      let now = o;
      moveDrag(root, ev, (dx, dy) => { now = { x: Math.round(o.x + dx), y: Math.round(o.y + dy) }; draw({ ...hooks.offsets, [mv]: now }); },
        (moved) => { if (moved) hooks.moved(mv, now); });
    }
  });
}
