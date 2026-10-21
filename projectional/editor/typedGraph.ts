// The node view of a typed program. Same tree as the blocks, drawn as data
// flow, left to right:
//   a call       a node; its inputs are ports, its arguments are wired in
//   a variable   a pill naming it (a "get" node), draggable onto any input
//   a function   a region; its parameters are ports on the region's left edge
//   a let        a dot on a wire, as in Blender's node editor: the value flows
//                into the dot and a wire runs from it to every use. The name
//                is an optional label (unnamed dots show a handle, •1).
//   match, fold  a region with one sub-region per case. The thing matched on
//                flows into a diamond, and each case's fields (and, for a fold,
//                the already-folded parts) are ports on that case's left edge.
//   effects      a badge on every node whose call performs one (Choice,
//                Console, Diverge), and on handlers the effect they remove.
//
// Wiring is editing: drag a variable (a region port or a pill) onto an input
// to use that variable there; inputs it can't reach (out of scope, wrong type)
// are dimmed while you drag and say why. Drag an input's wire into empty
// space to leave a hole there. Click a wire to put a dot on it; then drag
// from the dot to share that value with other inputs.

import type { Code, Id, NodeOf } from "../src/model.ts";
import type { Presentation } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { S, SIGS, TRUE, FALSE } from "../src/lang/std.ts";
import { CHOICE, DIVERGE, showType, type Type } from "../src/lang/types.ts";

const NS = "http://www.w3.org/2000/svg";
function s(tag: string, attrs: Record<string, string | number> = {}, text?: string) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el as SVGElement;
}
const tw = (t: string, px = 7.4) => t.length * px;

interface L { g: SVGGElement; w: number; h: number; outY: number }

export interface GraphHooks {
  selected: Id | null;
  select: (id: Id) => void;
  open: (id: Id) => void;
  // null when allowed, else why not
  canUse: (binder: Id, slot: Id) => string | null;
  use: (binder: Id, slot: Id) => void;
  clear: (slot: Id) => void;
  addDot: (slot: Id) => void;
}

const HANDLES: Record<Id, Id> = { [S.all]: CHOICE, [S.count]: CHOICE, [S.first]: CHOICE, [S.fuel]: DIVERGE };

export function typedGraph(code: Code, pres: Presentation, info: Info | null, defId: Id, hooks: GraphHooks): SVGSVGElement {
  const names = pres.names;
  const node = (id: Id) => code.nodes[id];
  const name = (id: Id) => names[id] ?? (node(id)?.kind === "builtin" ? (node(id) as NodeOf<"builtin">).op : "?");
  const typeOf = (id: Id) => { const t = info?.typeOf.get(id); return t ? showType(info!.subst.zonk(t), names) : ""; };
  const sel = (id: Id) => (hooks.selected === id ? " sel" : "");
  const errs = new Set((info?.errors ?? []).map((e) => e.id));
  // Dots: the binders of lets. A use of one is drawn as a wire from it.
  const dots = new Map<Id, { el: SVGElement; x: number; y: number }>();
  const uses: { dot: Id; ref: Id; el: SVGElement; x: number; y: number }[] = [];
  const dotOf = (id: Id): Id | null => {
    const n = node(id);
    return n?.kind === "ref" && isLetBinder(n.target) ? n.target : null;
  };
  const letBinders = new Set<Id>();
  for (const n of Object.values(code.nodes)) if (n.kind === "call" && node(n.fn)?.kind === "lambda") for (const p of (node(n.fn) as NodeOf<"lambda">).params) letBinders.add(p);
  const isLetBinder = (b: Id) => letBinders.has(b);

  const group = (): SVGGElement => s("g") as SVGGElement;
  const place = (l: L, x: number, y: number) => { l.g.setAttribute("transform", `translate(${x},${y})`); return l; };
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.max(16, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  };
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
    return { g, w, h, outY: h / 2 };
  };

  // Where a dot's wire ends when the use isn't an input of a call.
  const stub = (id: Id, dot: Id): L => {
    const g = group();
    g.append(titled(s("circle", { cx: 5, cy: 9, r: 4, class: `inp use${sel(id)}`, "data-slot": id, "data-id": id }), `${name(dot)}${typeOf(id) ? ` : ${typeOf(id)}` : ""}`));
    uses.push({ dot, ref: id, el: g, x: 1, y: 9 });
    return { g, w: 10, h: 18, outY: 9 };
  };

  const lay = (id: Id): L => {
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
    const h = Math.max(kidsH, bh);
    const bx = kids.length ? colW + 34 : 0, by = (h - bh) / 2;
    const g = group();
    let y = (h - kidsH) / 2;
    const top = badge ? 14 : 0;
    const portY = (i: number) => by + top + ((bh - top) / (inputs.length + 1)) * (i + 1);
    kids.forEach((k, i) => {
      const d = dotOf(inputs[i]);
      if (d) uses.push({ dot: d, ref: inputs[i], el: g, x: bx, y: portY(i) });
      else {
        place(k, colW - k.w, y);
        g.append(k.g);
        wire(g, colW, y + k.outY, bx, portY(i), "", inputs[i]);
      }
      y += k.h + gap;
    });
    const box = titled(s("rect", { x: bx, y: by, width: bw, height: bh, rx: 7, class: `cn${eff.does.length ? " eff" : ""}${eff.handles ? " handler" : ""}${sel(id)}${errs.has(id) ? " err" : ""}`, "data-id": id }), typeOf(id));
    g.append(box);
    if (badge) g.append(s("text", { x: bx + bw / 2, y: by + 11, class: "badge", "text-anchor": "middle" }, badge));
    g.append(s("text", { x: bx + bw / 2, y: by + top + (bh - top) / 2 + 5, class: "cl", "text-anchor": "middle" }, label));
    inputs.forEach((a, i) => g.append(titled(s("circle", { cx: bx, cy: portY(i), r: 5, class: "inp", "data-slot": a }), typeOf(a))));
    g.append(s("circle", { cx: bx + bw, cy: by + bh / 2, r: 4, class: "outp" }));
    return { g, w: bx + bw, h, outY: by + bh / 2 };
  };

  // Binder ports on a region's left edge; the body inside; out on the right.
  const PAD = 10, HEAD = 20;
  const ports = (g: SVGGElement, binders: Id[], y0: number) => {
    let w = 0;
    binders.forEach((b, i) => {
      const y = y0 + i * 22 + 11;
      const label = name(b);
      g.append(titled(s("circle", { cx: 0, cy: y, r: 6, class: `src${sel(b)}`, "data-src": b, "data-id": b }), typeOf(b)));
      g.append(s("text", { x: 10, y: y + 4, class: "portl" }, label));
      w = Math.max(w, tw(label, 6.8) + 18);
    });
    return { w, h: binders.length * 22 };
  };
  const frame = (g: SVGGElement, id: Id, title: string, w: number, h: number, cls: string, selectable = true) => {
    const r = s("rect", { width: w, height: h, rx: 9, class: `rg ${cls}${sel(id)}` });
    if (selectable) r.setAttribute("data-id", id);
    titled(r, typeOf(id));
    g.prepend(r);
    g.append(s("text", { x: 10, y: 14, class: "rt" }, title));
  };

  const region = (id: Id, title: string, binders: Id[], body: Id, cls: string): L => {
    const g = group();
    const p = ports(g, binders, HEAD + 4);
    const b = lay(body);
    const bx = Math.max(p.w + 14, PAD), innerH = Math.max(p.h + 8, b.h);
    const h = HEAD + innerH + PAD, w = Math.max(bx + b.w + 22, tw(title, 6.6) + 20);
    place(b, bx, HEAD + (innerH - b.h) / 2);
    g.append(b.g);
    const outY = HEAD + (innerH - b.h) / 2 + b.outY;
    wire(g, bx + b.w, outY, w, outY);
    frame(g, id, title, w, h, cls);
    g.append(s("circle", { cx: w, cy: outY, r: 4, class: "outp" }));
    return { g, w, h, outY };
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
    let y = 0;
    const dotX = colW + 22;
    vals.forEach((v, i) => {
      const b = steps[i][0];
      const silent = name(b) === "_";
      place(v, colW - v.w, y);
      g.append(v.g);
      const py = y + v.outY;
      wire(g, colW, py, dotX, py);
      const t = silent ? "a step done for its effect; nothing reads it" : `${name(b)}${typeOf(b) ? ` : ${typeOf(b)}` : ""}. Drag from here to use it; select it to name it`;
      g.append(titled(s("circle", { cx: dotX, cy: py, r: silent ? 4 : 6, class: `reroute${silent ? " silent" : ""}${sel(b)}`, "data-src": b, "data-id": b }), t));
      if (!silent) g.append(s("text", { x: dotX, y: py - 10, class: `dotl${names[b] === undefined ? " anon" : ""}`, "text-anchor": "middle" }, name(b)));
      dots.set(b, { el: g, x: dotX, y: py });
      y += v.h + 18;
    });
    const valsH = Math.max(0, y - 18);
    const body = lay(rest);
    const bx = dotX + labW;
    const h = Math.max(valsH, body.h);
    const by = (h - body.h) / 2;
    place(body, bx, by);
    g.append(body.g);
    return { g, w: bx + body.w, h, outY: by + body.outY };
  };

  // match / fold: the value flows into a diamond, which fans out to one
  // sub-region per case; each case's result flows to the region's output.
  const cases = (id: Id, n: NodeOf<"match"> | NodeOf<"fold">): L => {
    const g = group();
    const scr = lay(n.scrutinee);
    const isIf = n.kind === "match" && n.arms.length === 2 && n.arms.every((a) => [TRUE, FALSE].includes((node(a) as NodeOf<"arm">).variant));
    const arms = n.arms.map((a) => {
      const arm = node(a) as NodeOf<"arm">;
      const results = arm.results.filter((r): r is Id => r !== null);
      const title = isIf ? (arm.variant === TRUE ? "then" : "else") : `${name(arm.variant)}${results.length ? " (with folded parts)" : ""}`;
      return region(a, title, [...arm.binds, ...results], arm.body, "arm");
    });
    if (n.kind === "match" && n.otherwise) arms.push(lay(n.otherwise));
    const armW = Math.max(0, ...arms.map((a) => a.w));
    const armsH = arms.reduce((s, a) => s + a.h, 0) + 8 * Math.max(0, arms.length - 1);
    const innerH = Math.max(scr.h, armsH);
    const sy = HEAD + 4 + (innerH - scr.h) / 2;
    place(scr, PAD, sy);
    g.append(scr.g);
    const dx = PAD + scr.w + 30, dy = sy + scr.outY;
    wire(g, PAD + scr.w, dy, dx - 12, dy, "", n.scrutinee);
    const ax = dx + 34;
    let y = HEAD + 4 + (innerH - armsH) / 2;
    const w = ax + armW + 26;
    const outY = HEAD + 4 + innerH / 2;
    arms.forEach((a) => {
      place(a, ax, y);
      g.append(a.g);
      wire(g, dx + 12, dy, ax, y + 12, "fan");
      wire(g, ax + a.w, y + a.outY, w, outY);
      y += a.h + 8;
    });
    const label = isIf ? "if" : n.kind;
    g.append(titled(s("path", { d: `M${dx - 12},${dy} L${dx},${dy - 12} L${dx + 12},${dy} L${dx},${dy + 12} Z`, class: `dia${sel(id)}`, "data-id": id }), typeOf(id)));
    g.append(s("circle", { cx: dx - 12, cy: dy, r: 5, class: "inp", "data-slot": n.scrutinee }));
    const h = HEAD + innerH + PAD + 4;
    frame(g, id, label, w, h, n.kind);
    g.append(s("circle", { cx: w, cy: outY, r: 4, class: "outp" }));
    return { g, w, h, outY };
  };

  // The definition itself: its parameters, its body, its result.
  const def = node(defId) as NodeOf<"def">;
  const body = def.body ? node(def.body) : null;
  let top: L;
  if (body?.kind === "lambda") top = region(defId, `${name(defId)} : ${typeOf(defId)}`, body.params, body.body, "def");
  else if (body && body.kind !== "typedef") top = lay(def.body!);
  else top = pill(defId, `type ${name(defId)}: see the blocks`, "lit");
  const M = 14;
  const W = top.w + M * 2 + 40, H = top.h + M * 2;
  const svgEl = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "tgraph" }) as SVGSVGElement;
  place(top, M + 8, M);
  svgEl.append(top.g);
  svgEl.append(s("text", { x: M + 8 + top.w + 8, y: M + top.outY + 4, class: "portl" }, "result"));

  // Wires from each dot to its uses, drawn last, in the picture's coordinates.
  const abs = (el: Element, x: number, y: number) => {
    for (let e: Element | null = el; e && e !== svgEl; e = e.parentElement) {
      const m = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(e.getAttribute("transform") ?? "");
      if (m) { x += Number(m[1]); y += Number(m[2]); }
    }
    return { x, y };
  };
  const shared = s("g", { class: "uses" });
  for (const u of uses) {
    const d = dots.get(u.dot);
    if (!d) continue;
    const a = abs(d.el, d.x, d.y), b = abs(u.el, u.x, u.y);
    const path = curve(a.x + 6, a.y, b.x, b.y);
    shared.append(titled(s("path", { d: path, class: "use-hit", "data-id": u.ref }), `${name(u.dot)}: click to select this use`), s("path", { d: path, class: `tw use${hooks.selected === u.dot || hooks.selected === u.ref ? " lit" : ""}` }));
  }
  svgEl.append(shared);

  interact(svgEl, hooks);
  return svgEl;
}

// Clicks select; double-click opens a definition; dragging from a variable
// wires it into an input; dragging from an input into space clears it.
function interact(root: SVGSVGElement, hooks: GraphHooks) {
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
    const slot = start.closest("circle.inp")?.getAttribute("data-slot");
    if (!src && !slot) return;
    ev.preventDefault();
    const pt = (e: PointerEvent) => {
      const m = root.getScreenCTM()!.inverse();
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
      return { x: p.x, y: p.y };
    };
    const a = pt(ev);
    const line = s("path", { class: "tw pending" });
    const why = s("text", { class: "why" });
    root.append(line, why);
    const verdict = new Map<Element, string | null>();
    if (src) {
      for (const target of root.querySelectorAll("[data-slot]")) {
        const r = hooks.canUse(src, target.getAttribute("data-slot")!);
        verdict.set(target, r);
        target.classList.add(r ? "cannot" : "can");
      }
      root.classList.add("dragging");
    }
    let moved = false;
    const move = (e: PointerEvent) => {
      const b = pt(e);
      if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 4) moved = true;
      line.setAttribute("d", `M${a.x},${a.y} L${b.x},${b.y}`);
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-slot]");
      const reason = over ? verdict.get(over) : null;
      why.textContent = reason ?? "";
      why.setAttribute("x", String(b.x + 10));
      why.setAttribute("y", String(b.y - 8));
      line.classList.toggle("bad", !!reason);
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      line.remove();
      why.remove();
      root.classList.remove("dragging");
      for (const t of verdict.keys()) t.classList.remove("can", "cannot");
      if (!moved) return;
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const target = over?.closest("[data-slot]")?.getAttribute("data-slot");
      if (src && target) hooks.use(src, target);
      else if (slot && !target) hooks.clear(slot);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}
