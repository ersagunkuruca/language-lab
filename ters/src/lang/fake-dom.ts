// A document small enough to read: what html.ts's mount needs, plus a way
// to fire events and print the page, so tests can draw a page and click on
// it without a browser, and `ters choices --measure` can run one (L280d).

import type { Doc, El, Node_ } from "./html.ts";

type Listener = (e: { key?: string; target?: unknown }) => void;

export class FakeText implements Node_ {
  textContent: string | null;
  constructor(text: string) { this.textContent = text; }
}

export class FakeEl implements El {
  tag: string;
  attrs = new Map<string, string>();
  kids: (FakeEl | FakeText)[] = [];
  listeners = new Map<string, Listener[]>();
  value = "";
  checked = false;
  type?: string;
  // On the page: below an element marked `connected` (the page's root,
  // where a run of no browser draws it), as a browser's isConnected is.
  parent?: FakeEl;
  connected?: boolean;
  get isConnected(): boolean { let e: FakeEl | undefined = this; while (e && !e.connected) e = e.parent; return !!e; }
  set isConnected(on: boolean) { this.connected = on; }
  constructor(tag: string) { this.tag = tag; }
  get textContent(): string { return this.kids.map((k) => k.textContent).join(""); }
  set textContent(t: string | null) { this.leave(this.kids); this.kids = [new FakeText(t ?? "")]; }
  private adopt(nodes: Node_[]) { for (const n of nodes) if (n instanceof FakeEl) n.parent = this; return nodes as (FakeEl | FakeText)[]; }
  private leave(nodes: (FakeEl | FakeText)[]) { for (const n of nodes) if (n instanceof FakeEl && n.parent === this) n.parent = undefined; }
  append(...nodes: Node_[]) { this.kids.push(...this.adopt(nodes)); }
  replaceChildren(...nodes: Node_[]) { this.leave(this.kids); this.kids = [...this.adopt(nodes)]; }
  insertBefore(node: Node_, before: Node_ | null) {
    const at = before ? this.kids.indexOf(before as FakeEl | FakeText) : -1;
    this.kids.splice(at < 0 ? this.kids.length : at, 0, ...this.adopt([node]));
  }
  removeChild(node: Node_) { const at = this.kids.indexOf(node as FakeEl | FakeText); if (at >= 0) this.leave(this.kids.splice(at, 1)); }
  addEventListener(type: string, f: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]); }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
    if (name === "type") this.type = value;
  }
  // What a person does: types into a field (the value changes, then
  // "input" fires), presses a key, clicks.
  fire(type: string, e: { key?: string } = {}) { for (const f of this.listeners.get(type) ?? []) f({ ...e, target: this }); }
  type_(text: string) { this.value = text; this.fire("input"); }
  // The first element below (or at) this one with the attribute id = `id`.
  find(id: string): FakeEl {
    const go = (e: FakeEl): FakeEl | null => (e.attrs.get("id") === id ? e : e.kids.reduce<FakeEl | null>((r, k) => r ?? (k instanceof FakeEl ? go(k) : null), null));
    const r = go(this);
    if (!r) throw new Error(`no element with id ${id}`);
    return r;
  }
  // The page as HTML, live values included (an input's value, a box's tick).
  html(): string {
    const attrs = [...this.attrs].map(([k, v]) => ` ${k}="${v}"`).join("")
      + (this.tag === "input" ? ` value="${this.value}"${this.checked ? " checked" : ""}` : "");
    return `<${this.tag}${attrs}>${this.kids.map((k) => (k instanceof FakeEl ? k.html() : k.textContent)).join("")}</${this.tag}>`;
  }
}

export const fakeDoc = (): Doc => ({
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (_, tag) => new FakeEl(tag),
  createTextNode: (text) => new FakeText(text),
});
