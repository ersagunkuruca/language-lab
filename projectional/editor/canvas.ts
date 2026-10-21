// The one canvas every graph in the editor is drawn on: typed programs,
// plain expressions and networks alike. It knows nothing about code; it
// gives the views the same pieces and the same gestures:
//   wires        one curve shape, left to right
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

export const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = Math.max(16, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
};

// A point inside nested translated groups, in the coordinates of `root`.
export function absOf(root: Element, el: Element, x: number, y: number): Pos {
  for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
    const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)/.exec(e.getAttribute("transform") ?? "");
    if (m) { x += Number(m[1]); y += Number(m[2]); }
  }
  return { x, y };
}

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
export function moveDrag(root: SVGSVGElement, ev: PointerEvent, move: (dx: number, dy: number) => void, done: (moved: boolean) => void) {
  // Measured in screen pixels, scaled once: the picture may grow or shift
  // its origin while you drag, which would skew svg-unit deltas.
  const scale = moveScale(root);
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
