// Drawing an `Html` value (std.ts, WEB.md) on a page, the way Solid.js does
// (Ryan Carniato, https://www.solidjs.com): `main` runs once and returns the
// page, whose changing parts are functions. Each one runs in a watcher of
// the Cells handler (cells.ts), so when a cell it read changes, that one
// function runs again and sets one text, one attribute, or redraws one
// part. Nothing is diffed and nothing else is redrawn.
//
// The same mount draws the evaluator's values and compiled ones: `call` is
// how a function of the program is called (the evaluator's functions give a
// stream of results, compiled ones their one result). The page is anything
// shaped like the few DOM calls used here, so tests draw into a fake one.

import { nfc } from "./border.ts";
import { KEPT, Pending, type Cells, type CellNode } from "./cells.ts";
import { fromList, OutOfSteps, PAGE_STEPS, withSteps, type Data, type Value } from "./run-values.ts";
import { FALSE, HTML_V, MARK_V, TRUE } from "./std-ids.ts";
import { FOREIGN_VIEW } from "./hosts.ts";

export interface Node_ { textContent: string | null }
export interface El extends Node_ {
  value?: string;
  checked?: boolean;
  append(...nodes: Node_[]): void;
  replaceChildren(...nodes: Node_[]): void;
  // Where a host has them, a part that drew the same list element again
  // moves only the children that changed (C287); else all are put again.
  insertBefore?(node: Node_, before: Node_ | null): void;
  removeChild?(node: Node_): void;
  addEventListener(type: string, f: (e: { key?: string; target?: unknown }) => void): void;
  setAttribute(name: string, value: string): void;
  removeAttribute?(name: string): void;
  // A canvas's (paint, G2); a host without one paints nothing.
  getContext?(kind: "2d"): Context2D | null;
  width?: number;
  height?: number;
}
// The part of a canvas's 2D context that painting marks uses.
export interface Context2D {
  fillStyle: unknown; strokeStyle: unknown; lineWidth: number; font: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; arc(x: number, y: number, r: number, a: number, b: number): void; fill(): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; stroke(): void;
  fillText(text: string, x: number, y: number): void;
  // For a rendered frame (G9b), drawn on the CPU.
  createImageData?(w: number, h: number): { data: Uint8ClampedArray };
  putImageData?(image: { data: Uint8ClampedArray }, x: number, y: number): void;
}
export interface Doc {
  createElement(tag: string): El;
  createElementNS?(ns: string, tag: string): El;
  createTextNode(text: string): Node_;
}

export interface Mount {
  cells: Cells;
  doc: Doc;
  call: (f: Value, ...args: Value[]) => Value;
  // Each time a watcher runs again (not the first time), with its node: a
  // page can flash it.
  ran?: (el: Node_, node: CellNode) => void;
  // The step budget of each update (run.ts, withSteps).
  steps?: number;
  // And its time, in ms (E319d): the editor's preview runs a page on the
  // editor's thread, so an update that runs past it stops as one out of
  // steps does. A page in a tab of its own has none.
  within?: number;
  // What plays an element's sound (audio-page.ts), when the page can.
  // A sound's listen, and the cell it plays while when the element has a
  // `listening while` too (I336).
  listen?: (el: El, a: Data, on?: Value) => void;
  // A handler that stopped (an Abort, an overflow), beside the console's
  // line: the editor's preview says it under the page, and where (C143).
  stopped?: (e: unknown) => void;
  // Each event a handler is given, before it runs (C172e: a page's run
  // logs its events beside the world's answers): the event's name and
  // what the handler is given of it (Given).
  // `path`: where its element is under the page's root (pathOf), so a
  // replay finds it again (C172g).
  heard?: (name: string, at: Given, path: number[]) => void;
  // False while the page is stepped through its log (I239c): what the
  // person and the browser do (a click, a frame) isn't given to it then.
  live?: () => boolean;
}


// What a handler is given of an event: what was typed or chosen, the key,
// where the pointer is, the seconds since the frame before, and the keys
// held with it (C312), Ctrl 1, Shift 2, Alt 4, Meta (Cmd) 8.
export type Given = [value: string, key: string, x: number, y: number, seconds: number, held?: number];
export const HELD = { ctrl: 1, shift: 2, alt: 4, meta: 8 } as const;
const heldOf = (ev: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }) => (ev.ctrlKey ? 1 : 0) | (ev.shiftKey ? 2 : 0) | (ev.altKey ? 4 : 0) | (ev.metaKey ? 8 : 0);
// A Bool as the code a page runs on has it: the evaluator's data, compiled
// code's JavaScript boolean.
const bool = (m: Mount, b: number): Value => (m.call === evaluatorCall ? { tag: b ? TRUE : FALSE, fields: [] } : (!!b as unknown as Value));
// Where each drawn node is: its parent and its place among the parent's
// children as drawn, and each element's children, so an event's element
// can be named by its path from the page's root and found again in a
// replay of the page's run (C172g). And each element's handlers, by event.
const placed = new WeakMap<Node_, { parent: Node_; i: number }>();
const kidsOf = new WeakMap<Node_, Node_[]>();
const handlersOf = new WeakMap<Node_, Map<string, (at: Given) => void>>();
const place = (parent: Node_, kids: Node_[], from = 0) => { kidsOf.set(parent, kids); for (let i = from; i < kids.length; i++) placed.set(kids[i], { parent, i }); };
export function pathOf(n: Node_): number[] {
  const path: number[] = [];
  for (let p = placed.get(n); p && kidsOf.get(p.parent)?.[p.i] === n; n = p.parent, p = placed.get(n)) path.unshift(p.i);
  return path;
}
export const nodeAt = (root: Node_, path: number[]): Node_ | undefined => path.reduce<Node_ | undefined>((n, i) => (n ? kidsOf.get(n)?.[i] : undefined), root);
// A logged event given again (C172g): the handler of `name` on the element
// at `path`, given what it was given then. False where there is none.
export function replayEvent(root: Node_, name: string, path: number[], at: Given): boolean {
  const f = (() => { const n = nodeAt(root, path); return n && handlersOf.get(n)?.get(name); })();
  if (!f) return false;
  f(at);
  return true;
}

// What a part of the page shows when its update ran out of steps: a
// formula that never ends is typed Diverge, and this is the page handling it.
export const STUCK = "didn't finish";
// How many times the time a first draw that ran past it gets when it runs
// again (I371).
const AGAIN_TIMES = 4;
// A frame's work past which the preview waits as long again (everyFrame).
const HALVED_FROM_MS = 8;

// A view with no answer (its Choice gave none: x / 0, say) shows nothing
// there, as Ersagun decided for L125b: a view only reads, so nothing is
// done on a path that is abandoned. A handler handles its own Choice.
export class NoAnswer extends Error { constructor() { super("no value"); } }
// The evaluator's way of calling: the first result of the stream.
export const evaluatorCall = (f: Value, ...args: Value[]): Value => {
  for (const v of (f as (...a: Value[]) => Iterable<Value>)(...args)) return v;
  throw new NoAnswer();
};
// Compiled code gives a value, or a stream of answers when it searches.
// A function that may wait (C40) is a generator too, one that yields
// nothing when it doesn't wait and returns its value (a page's handlers
// are, since their row holds Wait): that value is the answer (I165).
export const compiledCall = (f: Value, ...args: Value[]): Value => {
  const r = (f as (...a: Value[]) => Value)(...args) as unknown;
  if (r && typeof r === "object" && typeof (r as Iterator<Value>).next === "function" && Symbol.iterator in (r as object)) {
    const first = (r as Iterator<Value>).next();
    if (!first.done || first.value !== undefined) return first.value;
    throw new NoAnswer();
  }
  return r as Value;
};
// A view's value, or null when it has no answer.
const viewOf = (call: Mount["call"], f: Value): Value | null => { try { return call(f); } catch (e) { if (e instanceof NoAnswer) return null; throw e; } };

const SVG = "http://www.w3.org/2000/svg";

// An attribute a page may set from its data (C140, BLIND-SPOTS-2026-11-03
// §2): not one that runs script. An event is `on(…)`, never an `on…`
// attribute holding code; a link, source or form target isn't a
// `javascript:` (or `vbscript:`) address, nor `data:` other than an image;
// `srcdoc` (a page inside, scripts and all) isn't set; and a name is a
// name, so static HTML can't be broken out of. The browser drops spaces
// and controls in an address's scheme, so they are dropped before looking.
// Influence: Elm's virtual DOM (elm/virtual-dom, Evan Czaplicki) leaves out
// `on…` attributes and `javascript:` addresses set as attributes.
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "background", "cite", "ping"]);
export function unsafeAttribute(name: string, value: string): string | null {
  if (!/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(name)) return `"${name}" isn't an attribute's name`;
  const n = name.toLowerCase();
  if (n.startsWith("on")) return `${name} would run its text as script: an event is on("${n.slice(2)}", …)`;
  if (n === "srcdoc") return "srcdoc would run the page inside, scripts and all";
  if (URL_ATTRIBUTES.has(n)) {
    const v = value.replace(/[\u0000-\u0020]/g, "").toLowerCase();
    if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return `${name} would run script (${v.slice(0, v.indexOf(":") + 1)})`;
    if (v.startsWith("data:") && (!v.startsWith("data:image/") || v.startsWith("data:image/svg"))) return `${name} would open data that isn't an image`;
  }
  return null;
}

// Properties the page reads back from the element itself, so they are set
// as properties: what the user typed or ticked replaces the attribute.
const LIVE = new Set(["value", "checked"]);

// What each mount has drawn of the values `each` keeps (cells.ts): drawn
// again, a kept row is the same nodes, watchers and all, moved to its new
// place, which is how a list keeps rows by identity (Solid's <For>).
const drawn = new WeakMap<Mount, WeakMap<object, Node_>>();
// The kept rows drawn before, and the new elements holding one, with their
// children: when a part runs again, what it says it drew is only what is
// new, not the kept rows it moved (a reorder draws nothing).
const moved = new WeakSet<Node_>();
const holding = new WeakMap<Node_, Node_[]>();
// What each element's children were drawn from, by value (redrawn).
const drewFrom = new WeakMap<Node_, Value[]>();
const fresh = (n: Node_): Node_[] => moved.has(n) ? [] : holding.get(n)?.flatMap(fresh) ?? [n];

// Held waits (C61 c′) not yet over, and the events that came meanwhile.
const held = { n: 0, queue: [] as (() => void)[], frames: new Map<unknown, Given>() };

// A part drawn again as the same element with no attributes, a list's
// `ul` with its rows (for each), say (C287): the element stays and only
// the children that changed are put in or taken out. A card added to a
// long list puts one row on the page, not every row again. Its children
// that aren't kept rows were the part's, gone with its last run, and are
// drawn again, so they change too.
function redrawn(e: El, was: Value | null, v: Value, m: Mount, svg: boolean): boolean {
  const a = was as Data | null, b = v as Data;
  if (!a || typeof b !== "object" || b === null || a.tag !== HTML_V.element || b.tag !== HTML_V.element || a.fields[0] !== b.fields[0]) return false;
  if (KEPT.has(a as object) || KEPT.has(b as object) || fromList(a.fields[1]).length || fromList(b.fields[1]).length || !e.insertBefore || !e.removeChild) return false;
  const old = kidsOf.get(e);
  if (!old) return false;
  const inSvg = svg || b.fields[0] === "svg";
  // The kept rows it drew before, the same values in the same places at
  // either end (C354: a card added at the end of 2000), are the same nodes,
  // as mountHtml would find them: only the ones between are mounted.
  const xs = fromList(b.fields[2]), drew = drewFrom.get(e);
  const same = (i: number, j: number) => { const x = xs[j]; if (!drew || x !== drew[i] || typeof x !== "object" || x === null) return false; const o = KEPT.get(x); return !!o && !o.disposed; };
  let k = 0;
  while (k < old.length && k < xs.length && same(k, k)) k++;
  let end = 0;
  while (end < old.length - k && end < xs.length - k && same(old.length - 1 - end, xs.length - 1 - end)) end++;
  const kids = new Array<Node_>(xs.length);
  for (let i = 0; i < k; i++) { kids[i] = old[i]; moved.add(old[i]); }
  for (let i = k; i < xs.length - end; i++) kids[i] = mountHtml(xs[i], m, inSvg);
  for (let i = 0; i < end; i++) { const x = old[old.length - 1 - i]; kids[xs.length - 1 - i] = x; moved.add(x); }
  drewFrom.set(e, xs);
  while (k < old.length && k < kids.length && old[k] === kids[k]) k++;
  while (end < old.length - k && end < kids.length - k && old[old.length - 1 - end] === kids[kids.length - 1 - end]) end++;
  const before = end ? kids[kids.length - end] : null;
  for (let i = k; i < old.length - end; i++) if (placed.get(old[i])?.parent === e) e.removeChild(old[i]);
  for (let i = k; i < kids.length - end; i++) e.insertBefore(kids[i], before);
  place(e, kids, k);
  if (kids.some((x) => moved.has(x) || holding.has(x))) holding.set(e, kids); else holding.delete(e);
  return true;
}

export function mountHtml(v: Value, m: Mount, svg = false): Node_ {
  const owner = typeof v === "object" && v !== null ? KEPT.get(v) : undefined;
  if (!owner || owner.disposed) return draw(v, m, svg);
  let mine = drawn.get(m);
  if (!mine) drawn.set(m, (mine = new WeakMap()));
  const before = mine.get(v as object);
  if (before) { moved.add(before); return before; }
  // Its watchers belong to the row, not to the part drawing it, so they
  // last as long as the item does.
  const node = m.cells.under(owner, () => draw(v, m, svg));
  mine.set(v as object, node);
  return node;
}

function draw(v: Value, m: Mount, svg: boolean): Node_ {
  const { doc, cells } = m;
  const d = v as Data;
  // A view the host drew (L235, hosts.ts): its own node, as it is.
  const foreign = (d as { [FOREIGN_VIEW]?: Node_ })[FOREIGN_VIEW];
  if (foreign) return foreign;
  const steps = m.steps ?? PAGE_STEPS;
  // `timedOut`: how many times an update was found past its time. A
  // handler that stops reads it against its count before, since an update
  // run after it stopped (its cells' flush) can start a budget of its own.
  let timedOut = 0;
  const budget = <T>(f: () => T, times = 1): T => {
    if (!m.within) return withSteps(steps, f);
    const end = performance.now() + m.within * times;
    return withSteps(steps, f, () => performance.now() > end && ++timedOut > 0);
  };
  cells.around = (update) => budget(update);
  const watch = (e: Node_, label: string, run: () => void, stuck: () => void = () => {}, made: () => Node_[] = () => [e]) => {
    let first = true, again: Value | undefined, tries = 0;
    const node: CellNode = cells.watch(() => {
      if (again) cells.read(again);
      const timed = timedOut;
      // Something it asked for isn't here yet: it keeps what it shows, and
      // runs again when that lands (it read the cell that says so). One
      // that ran out of steps says so; it runs again when a cell it read
      // before stopping changes.
      try { budget(run, AGAIN_TIMES ** tries); } catch (e) {
        if (e instanceof OutOfSteps) {
          stuck();
          // A first draw past its time, not its steps, runs again once the
          // page has drawn, with more time, once (I371): a slow machine,
          // or the work a page does once when it starts (its constants,
          // made the first time a view reads them), passed the time on
          // the editor's thread, and nothing it read was going to change.
          if (first && timedOut !== timed && tries < 1) {
            tries++;
            const cell = (again ??= cells.cell(0, "again"));
            cells.read(cell);
            setTimeout(() => { if (!node.disposed) cells.write(cell, tries); }, 0);
          }
          return;
        }
        if (!(e instanceof Pending)) throw e;
        return;
      }
      if (!first && m.ran) for (const x of made()) m.ran(x, node);
      first = false;
    }, label);
  };
  switch (d.tag) {
    case HTML_V.text: {
      const t = doc.createTextNode("");
      // A text that comes out the same ran, but the page shows no change:
      // moving an item runs the count again, and the count is the same.
      let changed = true;
      watch(t, "text", () => {
        const v = viewOf(m.call, d.fields[0]), now = v === null ? "" : String(v);
        changed = now !== t.textContent;
        if (changed) t.textContent = now;
      }, () => { t.textContent = STUCK; }, () => (changed ? [t] : []));
      return t;
    }
    case HTML_V.part: {
      // An element that doesn't take part in the layout, or inside a
      // picture an SVG group, so a part can redraw some shapes and not the
      // rest (I88). What it draws belongs to its watcher, whose next run
      // disposes of it first.
      const inSvg = svg && !!doc.createElementNS;
      const e = inSvg ? doc.createElementNS!(SVG, "g") : doc.createElement("lab-part");
      if (!inSvg) e.setAttribute("style", "display: contents");
      let now: Node_ | undefined, was: Value | null = null;
      watch(e, "part", () => {
        const v = viewOf(m.call, d.fields[0]);
        if (v === null) { now = undefined; e.replaceChildren(); place(e, []); }
        else if (!(now && redrawn(now as El, was, v, m, svg))) { e.replaceChildren((now = mountHtml(v, m, svg))); place(e, [now]); }
        was = v;
      }, () => { e.replaceChildren((now = doc.createTextNode(STUCK))); place(e, [now]); was = null; }, () => (now ? fresh(now) : []));
      return e;
    }
    case HTML_V.element: {
      const tag = String(d.fields[0]);
      const inSvg = svg || tag === "svg";
      const e = inSvg && doc.createElementNS ? doc.createElementNS(SVG, tag) : doc.createElement(tag);
      let focus = false;
      for (const a of fromList(d.fields[1]) as Data[]) {
        const name = String(a.fields[0]);
        if (a.tag === HTML_V.property) {
          if (name === "autofocus") focus = true;
          // Out of steps, an attribute keeps its last value.
          watch(e, name, () => {
            const v = viewOf(m.call, a.fields[1]);
            if (v === null) { if (name !== "value" && name !== "checked") e.removeAttribute?.(name); return; }
            const value = String(v);
            if (name === "checked") e.checked = value === "true";
            // Svelte's rule for bind:value (Rich Harris): leave the field
            // alone when it already shows this, so typing isn't disturbed.
            else if (name === "value") { if (e.value !== value) e.value = value; }
            else {
              // One that runs script is left off, with the reason (C140).
              const why = unsafeAttribute(name, value);
              if (why) { e.removeAttribute?.(name); console.warn(`a page's attribute was left off: ${why}`); }
              else e.setAttribute(name, value);
              // A box marked reveal is scrolled into view, the least
              // that shows it (a list's chosen row moved by the keys,
              // C320b), once it's on the page.
              if (name === "reveal" && value !== "false") queueMicrotask(() => (e as El & { scrollIntoView?: (o: object) => void }).scrollIntoView?.({ block: "nearest" }));
            }
          });
        } else if (a.tag === HTML_V.on) {
          const then = a.fields[1];
          const handle = (ev: { key?: string; target?: unknown; clientX?: number; clientY?: number; seconds?: number; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; preventDefault?: () => void }) => {
            if (m.live && !m.live()) return;
            const target = (ev.target ?? e) as El & { type?: string };
            // A key a page listens for on an element that isn't for typing
            // (a game's canvas, G2b) is the page's: the arrows and space
            // move the player, not the page under it.
            if ((name === "keydown" || name === "keyup") && SCROLL_KEYS.has(ev.key ?? "") && !TYPED.has(String((target as { tagName?: string }).tagName ?? "").toLowerCase())) ev.preventDefault?.();
            // What was typed enters in NFC (L214a, border.ts).
            const value = target.type === "checkbox" ? String(!!target.checked) : nfc(String(target.value ?? ""));
            const [x, y] = pointer(e, ev);
            given([value, ev.key ?? "", x, y, ev.seconds ?? 0, heldOf(ev)]);
          };
          const given = ([value, key, x, y, seconds, h = 0]: Given) => {
            // While a held wait's run is away (C61 c′), an event waits its
            // turn, and frames are one, their seconds added up: as they'd
            // have come had the run not waited.
            if (held.n) {
              const q = name === "frame" ? held.frames.get(given) : undefined;
              if (q) q[4] += seconds;
              else {
                const a: Given = [value, key, x, y, seconds, h];
                if (name === "frame") held.frames.set(given, a);
                held.queue.push(() => { held.frames.delete(given); given(a); });
              }
              return;
            }
            m.heard?.(name, [value, key, x, y, seconds, h], pathOf(e));
            // One batch per event: the page updates once, after every write.
            // A handler that fetched what hasn't come stops there, what it
            // did so far kept, and goes on from the fetch when the reply
            // lands (L59: the evaluator keeps its machine, Pending.resume).
            // Where it can't be kept (compiled code, or a fetch inside a
            // builtin's call) the run is taken back (its writes undone, its
            // printing never done: cells.ts attempt) and runs again from
            // the start, with the same event, so it still happens once.
            // What it fetches is remembered for this event alone (L59c,
            // browser.ts): the next click asks again.
            const event = {};
            const fire = (run: () => unknown) => {
              const was = cells.event, timed = timedOut;
              cells.event = event;
              try {
                cells.attempt(() => budget(run), (e) => e instanceof Pending && !e.resume);
              } catch (err) {
                // A wait (C40) can't be asked again from the start (its
                // timer would start again), so a run that can't go on from
                // it says so instead.
                if (err instanceof Pending && err.hold && err.resume) {
                  const go = err.resume;
                  held.n++;
                  err.ready.then(() => {
                    try { fire(() => { for (const v of go()) return v; }); } finally {
                      held.n--;
                      cells.release();
                      while (!held.n && held.queue.length) held.queue.shift()!();
                    }
                  });
                } else if (err instanceof Pending && !err.resume && !err.again) console.error(`${name} handler waits, and this page can't go on from a wait yet: it runs in the editor's preview (C40)`);
                else if (err instanceof Pending) { const go = err.resume; err.ready.then(() => fire(go ? () => { for (const v of go()) return v; } : run)); }
                // Past its time (the editor's preview, E319d): said under the
                // page, not in the console a frame at a time.
                else if (err instanceof OutOfSteps && timedOut !== timed && m.stopped) m.stopped(err);
                else if (err instanceof OutOfSteps) { if (!(err as { quiet?: boolean }).quiet) console.error(`${name} handler ${STUCK}`); }
                else { console.error(err); m.stopped?.(err); }
              } finally { cells.event = was; }
            };
            fire(() => m.call(then, { tag: HTML_V.event, fields: [value, key, x, y, seconds, bool(m, h & HELD.ctrl), bool(m, h & HELD.shift), bool(m, h & HELD.alt), bool(m, h & HELD.meta)] }));
          };
          let hs = handlersOf.get(e);
          if (!hs) handlersOf.set(e, (hs = new Map()));
          hs.set(name, given);
          // "frame": once each time the browser draws, while the element is
          // on the page, so a simulation steps without a hidden CSS
          // animation to listen to (I80). Elsewhere it never comes. It
          // says how many seconds passed since the frame before, so a
          // simulation can keep to real time whatever the frame rate.
          if (name === "frame") everyFrame(e, (seconds) => handle({ seconds }), !!m.within);
          else if (PLATFORM_EVENTS.has(name)) platformEvent(e, name, () => handle({}));
          else e.addEventListener(name, handle);
        } else if (a.tag === HTML_V.paint) {
          // A canvas's marks (G2): painted in order, all again whenever a
          // cell the view read changes. Out of steps, it keeps what it
          // painted last.
          watch(e, "paint", () => paintMarks(e, viewOf(m.call, a.fields[0])));
        } else if (a.tag === HTML_V.render) {
          // A frame (G9b, FRAMES.md): drawn on the CPU here, again whenever
          // a cell its view read changes.
          if (!RENDER) throw new Error("this page was made without what renders frames");
          const render = RENDER;
          watch(e, "render", () => render(e, viewOf(m.call, a.fields[0]), m.call));
        } else if (a.tag === HTML_V.listeningWhile) {
          // Read by the listen beside it.
        } else if (a.tag === HTML_V.listen || a.tag === HTML_V.listenStereo) {
          const on = (fromList(d.fields[1]) as Data[]).find((b) => b.tag === HTML_V.listeningWhile);
          if (m.listen) m.listen(e, a, on?.fields[0]);
          else console.warn("this page can't play sound here: build it with ters build-web");
        } else throw new Error(`not an attribute: ${a.tag}`);
      }
      const xs = fromList(d.fields[2]), kids = xs.map((c) => mountHtml(c, m, inSvg));
      e.append(...kids);
      place(e, kids);
      drewFrom.set(e, xs);
      // A browser focuses an autofocus field only as the page loads; one a
      // click opens later gets it here, once it's on the page.
      if (focus) queueMicrotask(() => (e as El & { focus?: () => void }).focus?.());
      if (kids.some((k) => moved.has(k) || holding.has(k))) holding.set(e, kids);
      return e;
    }
    default: throw new Error(`not Html: ${d.tag}`);
  }
}

// The keys that scroll a page, and the elements that are for typing.
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "PageUp", "PageDown", "Home", "End"]);
const TYPED = new Set(["input", "textarea", "select"]);

// The marks a canvas paints (std.ts Mark), on its 2D context, in its own
// units. A compiled record's fields are f0, f1, … and the evaluator's are
// in fields, so each is read either way.
// What renders a frame on a canvas (frame-render.ts), given by a page that
// renders one (page.ts, and a compiled page's script: core-js.ts
// corePageScript), so a page that renders none carries none of it.
type Render = (e: El, v: Value | null, call: Mount["call"]) => void;
let RENDER: Render | undefined;
export const useRender = (f: Render): void => { RENDER = f; };

function paintMarks(e: El, v: Value | null): void {
  const c = e.getContext?.("2d");
  if (!c || v === null) return;
  c.clearRect(0, 0, e.width ?? 0, e.height ?? 0);
  for (const mk of fromList(v) as Data[]) {
    const o = mk as unknown as Record<string, unknown>;
    const f = (i: number) => o[`f${i}`] ?? mk.fields[i];
    const n = (i: number) => Number(f(i));
    switch (mk.tag) {
      case MARK_V.disk: c.fillStyle = String(f(3)); c.beginPath(); c.arc(n(0), n(1), n(2), 0, 2 * Math.PI); c.fill(); break;
      case MARK_V.rectangle: c.fillStyle = String(f(4)); c.fillRect(n(0), n(1), n(2), n(3)); break;
      case MARK_V.segment: c.strokeStyle = String(f(5)); c.lineWidth = n(4); c.beginPath(); c.moveTo(n(0), n(1)); c.lineTo(n(2), n(3)); c.stroke(); break;
      case MARK_V.writing: c.fillStyle = String(f(4)); c.font = `${n(3)}px system-ui, sans-serif`; c.fillText(String(f(2)), n(0), n(1)); break;
    }
  }
}

// Where the pointer is, in the element's own units (I87): inside a
// picture, its SVG units, so a point lands where it's drawn; elsewhere,
// CSS pixels from the element's top-left. 0, 0 when the event has no
// pointer (a key, a frame), or when it has none that is finite (an element
// scaled to nothing, whose transform has no inverse): a Float64 is finite
// (L125f).
function pointer(e: El, ev: { clientX?: number; clientY?: number }): [number, number] {
  const [x, y] = pointerRaw(e, ev);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : [0, 0];
}
function pointerRaw(e: El, ev: { clientX?: number; clientY?: number }): [number, number] {
  if (typeof ev.clientX !== "number" || typeof ev.clientY !== "number") return [0, 0];
  const g = e as El & { getScreenCTM?: () => DOMMatrix | null; getBoundingClientRect?: () => { left: number; top: number } };
  const m = g.getScreenCTM?.();
  if (m) { const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()); return [p.x, p.y]; }
  const r = g.getBoundingClientRect?.() as { left: number; top: number; width?: number; height?: number } | undefined;
  if (!r) return [0, 0];
  // A canvas (G2): in its own units, as its marks are painted.
  if (e.getContext && r.width && r.height && e.width && e.height) return [(ev.clientX - r.left) * e.width / r.width, (ev.clientY - r.top) * e.height / r.height];
  return [ev.clientX - r.left, ev.clientY - r.top];
}

// Calls `tick` once a frame from when `e` is first on the page until it
// leaves it (a redraw that drops it, the page closing), with the seconds
// since the frame before: 0 the first time, then the browser's frame time
// (requestAnimationFrame's timestamp) less the last one.
// The platform's own moments (L236, WEB.md "The platform's moments"),
// heard with `on` like an element's events, by an element while it is on
// the page, with one meaning on every platform; each shell maps its own
// events to them. "back": the back button or gesture, kept by the page
// rather than leaving it (a browser's popstate, the page keeping a history
// entry of its own so the first back stays; Android's onBackPressed).
// "pause": the page no longer seen (visibilitychange to hidden; onPause).
// "resume": seen again (visible; onResume).
export const PLATFORM_EVENTS = new Set(["back", "pause", "resume"]);
interface Win {
  addEventListener?(type: string, f: () => void): void;
  removeEventListener?(type: string, f: () => void): void;
  history?: { pushState(data: unknown, title: string): void };
  document?: { visibilityState?: string; addEventListener?(type: string, f: () => void): void; removeEventListener?(type: string, f: () => void): void };
}
let ownEntry = false;
function platformEvent(e: El, name: string, fire: () => void, w: Win = globalThis as Win) {
  // Heard while the element is on the page: once it was and isn't, it stops.
  let seen = false;
  const gone = () => { const on = (e as El & { isConnected?: boolean }).isConnected; if (on !== false) seen = true; return on === false && seen; };
  if (name === "back") {
    if (!w.addEventListener || !w.history) return;
    if (!ownEntry) { ownEntry = true; w.history.pushState({ ters: true }, ""); }
    const f = () => {
      if (gone()) { w.removeEventListener?.("popstate", f); return; }
      w.history!.pushState({ ters: true }, "");
      fire();
    };
    w.addEventListener("popstate", f);
    return;
  }
  const d = w.document;
  if (!d?.addEventListener) return;
  const f = () => {
    if (gone()) { d.removeEventListener?.("visibilitychange", f); return; }
    if ((d.visibilityState === "hidden") === (name === "pause")) fire();
  };
  d.addEventListener("visibilitychange", f);
}

// `halved`: on the editor's thread (the preview, whose updates have a time,
// `within`), a frame's work takes at most half of it: one that took d ms
// waits d ms more before asking for the next, so a simulation slower than
// the screen steps less often and the editor still answers (I367: moths'
// 3000 at a third of the speed held the editor's clicks past their time).
// Its seconds are the time that passed, so it keeps to real time.
function everyFrame(e: El, tick: (seconds: number) => void, halved = false) {
  const raf = (globalThis as { requestAnimationFrame?: (f: (ms?: number) => void) => number }).requestAnimationFrame;
  if (!raf) return;
  let seen = false;
  let last: number | null = null;
  const step = (ms?: number) => {
    const on = (e as El & { isConnected?: boolean }).isConnected;
    const now = typeof ms === "number" ? ms : null;
    // In a document nothing shows (the editor's page left for another
    // program waits there, pagePanel.ts leavePage): no frames till it's
    // shown again, and the first one then starts the clock afresh. Run on
    // the editor's thread, a frame there was work nobody saw (E319k).
    if (on && (e as El & { ownerDocument?: { defaultView?: unknown } }).ownerDocument?.defaultView === null) { last = null; raf(step); return; }
    if (on) {
      seen = true;
      const seconds = last === null || now === null ? 0 : Math.max(0, (now - last) / 1000);
      last = now;
      const began = performance.now();
      tick(seconds);
      const took = performance.now() - began;
      if (halved && took > HALVED_FROM_MS) { setTimeout(() => raf(step), took); return; }
    } else if (seen) return;
    raf(step);
  };
  raf(step);
}

// The page as HTML text, every function called once: what a static site
// is, and what the tests compare. Handlers are left out.
export function htmlText(v: Value, call: Mount["call"], raw = false): string {
  const d = v as Data;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  switch (d.tag) {
    // Inside <style> and <script> text isn't read for entities: it goes in
    // as it is, with only a closing tag kept from ending it early.
    case HTML_V.text: { const v = viewOf(call, d.fields[0]), t = v === null ? "" : String(v); return raw ? t.replace(/<\//g, "<\\/") : esc(t); }
    case HTML_V.part: { const v = viewOf(call, d.fields[0]); return v === null ? "" : htmlText(v, call, raw); }
    case HTML_V.element: {
      const attrs = (fromList(d.fields[1]) as Data[]).filter((a) => a.tag === HTML_V.property)
        .flatMap((a) => { const v = viewOf(call, a.fields[1]); return v === null || unsafeAttribute(String(a.fields[0]), String(v)) ? [] : [` ${a.fields[0]}="${esc(String(v))}"`]; }).join("");
      const rawText = d.fields[0] === "style" || d.fields[0] === "script";
      return `<${d.fields[0]}${attrs}>${fromList(d.fields[2]).map((c) => htmlText(c, call, rawText)).join("")}</${d.fields[0]}>`;
    }
    default: throw new Error(`not Html: ${d.tag}`);
  }
}
