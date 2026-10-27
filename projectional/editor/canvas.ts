// The one canvas every graph in the editor is drawn on: typed programs,
// plain expressions and networks alike. It knows nothing about code; it
// gives the views the same pieces and the same gestures:
//   the world    an unbounded plane; everything is placed in its coordinates.
//                The panel is a window onto it: drag empty space to pan, use
//                the wheel to zoom, Fit to see it all. Nothing is ever pushed
//                around to make room: the window moves, not the picture.
//   wires        one curve shape, left to right (graphLayout.ts)
//   moving       drag a node's body; the view saves where it ended up
//   connecting   drag from a source onto a target; every target says ahead
//                of time whether it would take the wire, and why not
//   positions    nested groups placed by translate(); absolute positions are
//                read back by adding them up

const NS = "http://www.w3.org/2000/svg";

export function s(tag: string, attrs: Record<string, string | number> = {}, text?: string) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el as SVGElement;
}

export type Pos = { x: number; y: number };

// Screen pixels per svg unit.
export function moveScale(root: SVGSVGElement): number {
  const vb = root.viewBox.baseVal;
  const w = root.getBoundingClientRect().width;
  return vb && vb.width && w ? w / vb.width : 1;
}

// Pointer position in the svg's own units.
export function svgPoint(root: SVGSVGElement, e: { clientX: number; clientY: number }): Pos {
  const m = root.getScreenCTM()!.inverse();
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
  return { x: p.x, y: p.y };
}

// Drag to move: `move` gets the offset from where the drag began (in svg
// units), `done` whether it moved at all (a press without moving is a click).
export function moveDrag(root: SVGSVGElement, ev: PointerEvent, move: (dx: number, dy: number) => void, done: (moved: boolean) => void, scale = moveScale(root)) {
  // Measured in screen pixels and divided by the zoom: world units.
  let moved = false;
  const mv = (e: PointerEvent) => {
    const dx = (e.clientX - ev.clientX) / scale, dy = (e.clientY - ev.clientY) / scale;
    if (!moved && Math.abs(dx) + Math.abs(dy) <= 3) return;
    moved = true;
    move(dx, dy);
  };
  const up = () => {
    window.removeEventListener("pointermove", mv);
    window.removeEventListener("pointerup", up);
    if (moved) {
      // The click that follows a drag isn't a click.
      root.addEventListener("click", stop, { capture: true });
      setTimeout(() => root.removeEventListener("click", stop, { capture: true }), 0);
    }
    done(moved);
  };
  const stop = (e: Event) => e.stopPropagation();
  window.addEventListener("pointermove", mv);
  window.addEventListener("pointerup", up);
}

// Drag to connect: a dashed line follows the pointer; every element matching
// `targets` is marked .can or .cannot up front, and hovering one that can't
// take the wire shows why. `drop` gets the target under the pointer (or
// null for empty space) if the pointer moved.
export function connectDrag(root: SVGSVGElement, ev: PointerEvent, targets: string, verdict: ((t: Element) => string | null) | null, drop: (target: Element | null, e: PointerEvent) => void) {
  const a = svgPoint(root, ev);
  const line = s("path", { class: "wire-pending" });
  const why = s("text", { class: "why" });
  root.append(line, why);
  const verdicts = new Map<Element, string | null>();
  if (verdict) {
    for (const t of root.querySelectorAll(targets)) {
      const r = verdict(t);
      verdicts.set(t, r);
      t.classList.add(r ? "cannot" : "can");
    }
    root.classList.add("dragging");
  }
  let moved = false;
  const move = (e: PointerEvent) => {
    const b = svgPoint(root, e);
    if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 4) moved = true;
    line.setAttribute("d", `M${a.x},${a.y} L${b.x},${b.y}`);
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(targets);
    const reason = over ? verdicts.get(over) : null;
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
    for (const t of verdicts.keys()) t.classList.remove("can", "cannot");
    if (!moved) return;
    drop(document.elementFromPoint(e.clientX, e.clientY)?.closest(targets) ?? null, e);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// ---------------------------------------------------------------- the world

export interface Canvas {
  el: HTMLElement;          // the window: put it in the page
  root: SVGSVGElement;      // the svg filling it; drag feedback is drawn here
  world: SVGGElement;       // the plane: draw everything in here
  zoom: () => number;       // screen pixels per world unit
  fit: () => void;
  reveal: (els: Element[]) => void;
}

type View = { x: number; y: number; z: number };

// Where each graph's window was, so editing (which redraws) doesn't move it.
const views = new Map<string, View>();
// The smallest zoom a graph first opens at: labels still legible.
const READABLE = 0.6;
// The height the Fit / zoom pill takes at the bottom of the window.
const PILL = 36;
// The map's size: at most this, and at most a fifth of the window's width.
const MAP = { w: 168, h: 112 };
// Whether the map is shown, as last chosen with its button. Unchosen, it
// is shown where there's room for it: not on a phone's graph.
const MAP_KEY = "lab:map";
const mapChoice = (): boolean | null => { try { const v = localStorage.getItem(MAP_KEY); return v === null ? null : v === "on"; } catch { return null; } };

// `start`: what the first view starts on when the picture is wider or
// taller than the window (an action's steps), instead of its top-left.
export function infiniteCanvas(key: string, cls: string, start?: () => Element[]): Canvas {
  const root = s("svg", { class: `${cls} canvas` }) as SVGSVGElement;
  const world = s("g", { class: "world" }) as SVGGElement;
  root.append(world);
  let view = views.get(key);
  let shown = (_z: number) => {};
  let mapped = () => {};
  const apply = () => { if (view) { world.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.z})`); shown(view.z); mapped(); } };
  const set = (v: View) => { view = v; views.set(key, v); apply(); };
  // Fit: the whole picture, centered both ways. Readable: never smaller than
  // READABLE, and a side that doesn't fit then starts at its top or left
  // edge, the rest a pan away.
  const fit = (readable = false) => {
    const b = world.getBBox(), r = root.getBoundingClientRect();
    if (!b.width || !r.width) return;
    // The bottom strip is the Fit / zoom pill's, so nothing is fitted under it.
    const high = r.height - PILL;
    let z = Math.min(1, (r.width - 32) / b.width, (high - 32) / b.height);
    if (readable) z = Math.max(z, READABLE);
    const place = (room: number, size: number, at: number) => (size * z <= room - 32 ? (room - size * z) / 2 : 16) - at * z;
    let x = place(r.width, b.width, b.x), y = place(high, b.height, b.y);
    // Too wide: the picture's right edge at the right (the start and what
    // it leads to), what feeds it to its left, unless that hides the start's
    // left edge; too tall: the start's top at the top.
    const on = readable ? startBox() : null;
    if (on && b.width * z > r.width - 32) x = Math.max(16 - on.l * z, r.width - 16 - (b.x + b.width) * z);
    if (on && b.height * z > high - 32) y = 16 - on.t * z;
    set({ z, x, y });
  };
  // The start's box in world units.
  const startBox = () => {
    const els = start?.() ?? [], m = world.getScreenCTM()?.inverse();
    if (!els.length || !m) return null;
    const pt = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(m);
    const bs = els.map((e) => e.getBoundingClientRect()).map((c) => ({ a: pt(c.left, c.top), b: pt(c.right, c.bottom) }));
    return { l: Math.min(...bs.map((c) => c.a.x)), t: Math.min(...bs.map((c) => c.a.y)) };
  };
  // Reveal: pan the least that brings these on screen. Bigger than the
  // window (a call shown inline grows by its callee's body), zoom out first,
  // as far as READABLE; past that, their top-left corner comes first.
  const reveal = (els: Element[]) => {
    if (!els.length || !view) return;
    const r = root.getBoundingClientRect(), m = 24;
    const bs = els.map((e) => e.getBoundingClientRect());
    const box = { l: Math.min(...bs.map((b) => b.left)), t: Math.min(...bs.map((b) => b.top)), r: Math.max(...bs.map((b) => b.right)), b: Math.max(...bs.map((b) => b.bottom)) };
    const f = Math.min((r.width - 2 * m) / (box.r - box.l), (r.height - 2 * m) / (box.b - box.t));
    if (f < 1 && view.z > READABLE) {
      // Zoom about the box's centre, then pan as below.
      const z = Math.max(READABLE, view.z * f), k = z / view.z;
      const cx = (box.l + box.r) / 2 - r.left, cy = (box.t + box.b) / 2 - r.top;
      set({ z, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k });
      const w = (box.r - box.l) * k, hgt = (box.b - box.t) * k;
      Object.assign(box, { l: r.left + cx - w / 2, r: r.left + cx + w / 2, t: r.top + cy - hgt / 2, b: r.top + cy + hgt / 2 });
    }
    const shift = (lo: number, hi: number, min: number, max: number) => (hi > max - m ? Math.max(max - m - hi, min + m - lo) : lo < min + m ? min + m - lo : 0);
    const dx = shift(box.l, box.r, r.left, r.right), dy = shift(box.t, box.b, r.top, r.bottom);
    if (dx || dy) set({ ...view, x: view.x + dx, y: view.y + dy });
  };
  apply();
  // First time this graph is shown: fit it readably, once it has a size.
  if (!view) requestAnimationFrame(() => { if (root.isConnected) fit(true); });

  const el = document.createElement("div");
  el.className = "canvas-wrap";
  // Pan: a press on the svg that nothing in it took (a node, a port, a
  // wire). Listening on the window around the svg means every handler on
  // the svg and inside it has already had its turn.
  el.addEventListener("pointerdown", (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.shiftKey || !root.contains(ev.target as Node) || fingers.size > 1) return;
    const v0 = view ?? { x: 0, y: 0, z: 1 }, began = pinches;
    root.classList.add("panning");
    // A second finger makes it a pinch, which takes over from here.
    const mv = (e: PointerEvent) => { if (pinches === began && e.pointerId === ev.pointerId) set({ ...v0, x: v0.x + e.clientX - ev.clientX, y: v0.y + e.clientY - ev.clientY }); };
    const up = () => { root.classList.remove("panning"); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  });
  // Pinch: two fingers zoom about the point between them, and pan with it.
  const fingers = new Map<number, { clientX: number; clientY: number }>();
  let pinch: { d: number; at: Pos; v: View } | null = null, pinches = 0;
  const two = () => { const [a, b] = [...fingers.values()]; return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), at: svgPoint(root, { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }) }; };
  root.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    fingers.set(e.pointerId, e);
    if (fingers.size === 2) { pinches++; pinch = { ...two(), v: view ?? { x: 0, y: 0, z: 1 } }; }
  });
  // A touch's events stay with the element it began on, inside the svg.
  root.addEventListener("pointermove", (e) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, e);
    if (!pinch || fingers.size !== 2) return;
    const now = two(), v = pinch.v;
    const z = Math.min(3, Math.max(0.15, v.z * now.d / Math.max(1, pinch.d)));
    set({ z, x: now.at.x - ((pinch.at.x - v.x) * z) / v.z, y: now.at.y - ((pinch.at.y - v.y) * z) / v.z });
  });
  const lift = (e: PointerEvent) => { fingers.delete(e.pointerId); if (fingers.size < 2) pinch = null; };
  root.addEventListener("pointerup", lift);
  root.addEventListener("pointercancel", lift);
  // Zoom about the pointer.
  root.addEventListener("wheel", (e) => {
    e.preventDefault();
    const v = view ?? { x: 0, y: 0, z: 1 };
    const p = svgPoint(root, e);
    const z = Math.min(3, Math.max(0.15, v.z * Math.exp(-e.deltaY * 0.0015)));
    set({ z, x: p.x - ((p.x - v.x) * z) / v.z, y: p.y - ((p.y - v.y) * z) / v.z });
  }, { passive: false });

  const btn = (label: string, title: string, f: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", f);
    return b;
  };
  const tools = document.createElement("div");
  tools.className = "canvas-tools";
  // The zoom button shows the zoom; clicking it goes back to actual size.
  const zoom = btn("100%", "Actual size", () => { const v = view ?? { x: 16, y: 16, z: 1 }; const r = root.getBoundingClientRect(); const c = { x: r.width / 2, y: r.height / 2 }; set({ z: 1, x: c.x - ((c.x - v.x) * 1) / v.z, y: c.y - ((c.y - v.y) * 1) / v.z }); });
  shown = (z) => {
    const pc = Math.round(z * 100);
    zoom.textContent = `${pc}%`;
    zoom.title = pc === 100 ? "Actual size" : `Zoomed to ${pc}%: click for actual size (100%)`;
  };
  shown(view?.z ?? 1);
  zoom.className += " zoom";
  tools.append(btn("Fit", "Show the whole graph, centered", () => fit()), zoom);
  // The map sits on the graph, so it can be put away and brought back.
  const mapBtn = btn("Map", "", () => {
    on = !wanted();
    try { localStorage.setItem(MAP_KEY, on ? "on" : "off"); } catch { /* no storage */ }
    mapped();
  });
  let on: boolean | null = mapChoice();
  // Unchosen, it's shown where there's room for it, and not over the
  // picture: its corner has to be clear of what's drawn when the graph is
  // first shown. Decided once, so it doesn't come and go while panning.
  let auto: boolean | null = null;
  const size = () => { const w = Math.min(MAP.w, Math.round(root.getBoundingClientRect().width / 5)); return { w, h: Math.round((w * MAP.h) / MAP.w) }; };
  const clear = () => {
    const r = root.getBoundingClientRect(), { w, h } = size();
    const c = { l: r.right - 10 - w, t: r.bottom - 10 - h, r: r.right - 10, b: r.bottom - 10 };
    return ![...world.querySelectorAll("[data-move]")].some((el) => { const b = el.getBoundingClientRect(); return b.right > c.l && b.left < c.r && b.bottom > c.t && b.top < c.b; });
  };
  const wanted = () => { const r = root.getBoundingClientRect(); return on ?? (auto ??= r.width >= 600 && r.height >= 400 && clear()); };
  mapBtn.className += " map-toggle";
  tools.append(mapBtn);

  // The map: the whole picture small, with the window on it as a frame,
  // shown only while part of the picture is out of the window, so it is
  // also the sign that there's more. Click or drag on it to look there.
  // The picture is copied in, not drawn through <use>: rules like
  // `.tgraph .rg` don't reach into a <use>'s copy, which left frames black.
  // The copy keeps classes (so the same rules style it) and drops ids and
  // data-* (so nothing finds it instead of the real one).
  const map = s("svg", { class: "minimap", width: MAP.w, height: MAP.h }) as SVGSVGElement;
  const shrink = s("g", { class: cls }) as SVGGElement;
  let stale = true;
  const copy = () => {
    const c = world.cloneNode(true) as SVGGElement;
    c.removeAttribute("transform");
    for (const e of [c, ...c.querySelectorAll("*")]) for (const a of [...e.attributes]) if (a.name === "id" || a.name.startsWith("data-")) e.removeAttribute(a.name);
    shrink.replaceChildren(c);
    stale = false;
  };
  const frame = s("rect", { class: "minimap-view", rx: 2 });
  map.append(shrink, frame);
  let whole: DOMRect | null = null, k = 1, at = { x: 0, y: 0 };
  mapped = () => {
    const r = root.getBoundingClientRect();
    mapBtn.hidden = true;
    if (!view || !whole || !whole.width || !r.width) { map.setAttribute("display", "none"); return; }
    const sx = -view.x / view.z, sy = -view.y / view.z, sw = r.width / view.z, sh = (r.height - PILL) / view.z;
    const out = whole.x < sx - 1 || whole.y < sy - 1 || whole.x + whole.width > sx + sw + 1 || whole.y + whole.height > sy + sh + 1;
    // The button is there while there's more than the window shows.
    mapBtn.hidden = !out;
    const showing = out && wanted();
    mapBtn.className = `btn map-toggle${showing ? " on" : ""}`;
    mapBtn.title = showing ? "Hide the map of the whole graph" : "Show a map of the whole graph";
    map.setAttribute("display", showing ? "inline" : "none");
    if (!showing) return;
    const { w, h } = size();
    map.setAttribute("width", String(w));
    map.setAttribute("height", String(h));
    k = Math.min((w - 8) / whole.width, (h - 8) / whole.height);
    at = { x: (w - whole.width * k) / 2 - whole.x * k, y: (h - whole.height * k) / 2 - whole.y * k };
    if (stale) copy();
    shrink.setAttribute("transform", `translate(${at.x},${at.y}) scale(${k})`);
    Object.entries({ x: at.x + sx * k, y: at.y + sy * k, width: sw * k, height: sh * k }).forEach(([a, v]) => frame.setAttribute(a, String(v)));
  };
  // (Tests draw graphs in a DOM without observers, and need no map.)
  if (typeof MutationObserver !== "undefined") new MutationObserver(() => { whole = root.isConnected ? world.getBBox() : null; stale = true; mapped(); }).observe(world, { childList: true });
  // Look at the point under the pointer: it goes to the window's middle.
  const look = (e: PointerEvent) => {
    if (!view) return;
    const m = map.getBoundingClientRect(), r = root.getBoundingClientRect();
    const wx = (e.clientX - m.left - at.x) / k, wy = (e.clientY - m.top - at.y) / k;
    set({ ...view, x: r.width / 2 - wx * view.z, y: (r.height - PILL) / 2 - wy * view.z });
  };
  map.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    look(e);
    const up = () => { window.removeEventListener("pointermove", look); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", look);
    window.addEventListener("pointerup", up);
  });
  map.setAttribute("display", "none");
  el.append(root, tools, map);
  return { el, root, world, zoom: () => view?.z ?? 1, fit, reveal };
}
