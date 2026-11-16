// Dragging sideways on a number literal's field changes its value, as on
// a number field in Unity's inspector (influence, ters/CREDITS.md; E272).
// A click without a drag still edits the text.
//
// The rate is fixed when the drag starts, from the value's size: about a
// hundredth of its order of magnitude a pixel (0.01 for 3.5, 1 for 250),
// an integer at least a tenth of a step a pixel and only ever whole, as is
// a Float64 written whole unless Alt is held. Shift
// is ten times coarser, Alt ten times finer, and pressing either mid-drag
// goes on from the value reached, with no jump. Escape puts back the
// value the drag began with.

// Per pixel, and the value's quantum: floats land on multiples of the
// rate's own place (start + k·q), integers on whole numbers.
export function scrubRate(start: number, int: boolean): number {
  const mag = start === 0 || !Number.isFinite(start) ? 0 : Math.floor(Math.log10(Math.abs(start)));
  const rate = 10 ** (mag - 2);
  return int ? Math.max(0.1, rate) : rate;
}

export const scale = (e: { shiftKey: boolean; altKey: boolean }) => (e.shiftKey ? 10 : 1) * (e.altKey ? 0.1 : 1);

// How a drag from `start` moves while these keys are held. A Float64
// written whole (8, 100) steps by whole numbers too, as an Int does,
// until Alt asks for the digits after the point.
export function scrubStep(start: number, int: boolean, e: { shiftKey: boolean; altKey: boolean }): { rate: number; int: boolean } {
  const by = (r: number, k: number) => Number((r * k).toPrecision(12));
  if (int || Number.isInteger(start) && !e.altKey) return { rate: by(scrubRate(start, true), scale(e)), int: true };
  // Alt on a whole Float64 is its first step into the digits, not finer still.
  return { rate: by(scrubRate(start, false), Number.isInteger(start) ? scale({ ...e, altKey: false }) : scale(e)), int: false };
}

// The value `dx` pixels from where the drag (or its last modifier
// change) was at `start`.
export function scrubbed(start: number, dx: number, rate: number, int: boolean): number {
  if (int) return start + Math.round(dx * rate);
  // 15 digits: 0.1 + 0.2 is 0.3, not 0.30000000000000004.
  return Number((start + Math.round(dx) * rate).toPrecision(15));
}

export type Scrubber = {
  // The value to start from, or null when this literal isn't a plain
  // number (a fraction, an integer past 2⁵³).
  value(): number | null;
  int: boolean;
  // A new value mid-drag; false stops the drag (the edit was refused).
  set(v: number): boolean;
  // The drag ended: kept, or put back (Escape, or the touch became a scroll).
  end(kept: boolean): void;
  // A press that didn't move: edit the text.
  click(): void;
};

// Presses on `el` scrub. Listeners go on the window, since the editor
// redraws the field under the pointer on every change.
export function scrubbable(el: HTMLElement, s: Scrubber) {
  el.classList.add("scrub");
  el.addEventListener("pointerdown", (down) => {
    if (down.button !== 0 || !down.isPrimary || document.activeElement === el) return;
    const v0 = s.value();
    if (v0 === null) return;
    // No focus, no text selection: a press that doesn't move focuses below.
    down.preventDefault();
    const slop = down.pointerType === "touch" ? 8 : 3;
    let at = v0, from = v0, x0 = down.clientX, k = scale(down), going = false, done = false;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId) return;
      if (!going) {
        if (Math.abs(e.clientX - down.clientX) < slop) return;
        going = true;
        x0 = e.clientX;
        document.documentElement.classList.add("scrubbing");
      }
      // A modifier pressed or let go: on from here.
      const k2 = scale(e);
      if (k2 !== k) { from = at; x0 = e.clientX; k = k2; }
      const step = scrubStep(v0, s.int, e);
      const v = scrubbed(from, e.clientX - x0, step.rate, step.int);
      if (v === at) return;
      at = v;
      if (!s.set(v)) finish(true);
    };
    const finish = (kept: boolean) => {
      if (done) return;
      done = true;
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", cancel);
      removeEventListener("keydown", key, true);
      document.documentElement.classList.remove("scrubbing");
      if (going) s.end(kept);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId) return;
      const clicked = !going;
      finish(true);
      if (clicked) s.click();
    };
    const cancel = (e: PointerEvent) => { if (e.pointerId === down.pointerId) finish(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && going) { e.preventDefault(); e.stopPropagation(); finish(false); } };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", cancel);
    addEventListener("keydown", key, true);
  });
}
