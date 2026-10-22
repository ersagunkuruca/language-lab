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
}

type View = { x: number; y: number; z: number };

// Where each graph's window was, so editing (which redraws) doesn't move it.
const views = new Map<string, View>();

export function infiniteCanvas(key: string, cls: string): Canvas {
  const root = s("svg", { class: `${cls} canvas` }) as SVGSVGElement;
  const world = s("g", { class: "world" }) as SVGGElement;
  root.append(world);
  let view = views.get(key);
  const apply = () => { if (view) world.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.z})`); };
  const set = (v: View) => { view = v; views.set(key, v); apply(); };
  // Fit: the whole picture, centered both ways.
  const fit = () => {
    const b = world.getBBox(), r = root.getBoundingClientRect();
    if (!b.width || !r.width) return;
    const z = Math.min(1, (r.width - 32) / b.width, (r.height - 32) / b.height);
    set({ z, x: (r.width - b.width * z) / 2 - b.x * z, y: (r.height - b.height * z) / 2 - b.y * z });
  };
  apply();
  // First time this graph is shown: fit it, once it has a size.
  if (!view) requestAnimationFrame(() => { if (root.isConnected) fit(); });

  const el = document.createElement("div");
  el.className = "canvas-wrap";
  // Pan: a press on the svg that nothing in it took (a node, a port, a
  // wire). Listening on the window around the svg means every handler on
  // the svg and inside it has already had its turn.
  el.addEventListener("pointerdown", (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.shiftKey || !root.contains(ev.target as Node)) return;
    const v0 = view ?? { x: 0, y: 0, z: 1 };
    root.classList.add("panning");
    const mv = (e: PointerEvent) => set({ ...v0, x: v0.x + e.clientX - ev.clientX, y: v0.y + e.clientY - ev.clientY });
    const up = () => { root.classList.remove("panning"); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  });
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
  tools.append(
    btn("Fit", "Show the whole graph, centered", fit),
    btn("100%", "Actual size", () => { const v = view ?? { x: 16, y: 16, z: 1 }; const r = root.getBoundingClientRect(); const c = { x: r.width / 2, y: r.height / 2 }; set({ z: 1, x: c.x - ((c.x - v.x) * 1) / v.z, y: c.y - ((c.y - v.y) * 1) / v.z }); }),
  );
  el.append(root, tools);
  return { el, root, world, zoom: () => view?.z ?? 1, fit };
}
