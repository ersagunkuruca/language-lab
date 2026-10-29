// The editor's page without a browser (TESTING.md, T9 and T10): editor/main.ts
// bundled as editor/build.ts bundles it, run on happy-dom's document in
// Node, and a few of Playwright's ways of reaching into a page (locator,
// click, fill, keyboard.press), so a scenario reads as it did in the
// browser smoke. happy-dom (MIT, github.com/capricorn86/happy-dom) has no
// layout: nothing here knows where anything is on screen, so a gesture by
// position (a drag, a drop, a click at a point) stays in the browser check.

import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { pageRuntime, workletRuntime } from "../cli/web.ts";

const editor = new URL("../editor/", import.meta.url).pathname;
// Unminified so a stack names the code, and with no Run worker: Node has
// none, and Run's own path is the browser check's.
const bundle = await build({
  entryPoints: [editor + "main.ts"], bundle: true, format: "iife", target: "es2022", write: false,
  define: { PAGE_RUNTIME: JSON.stringify(await pageRuntime()), RUN_WORKER: '""', WORKLET_RUNTIME: JSON.stringify(await workletRuntime()) },
});
const js = bundle.outputFiles[0].text;
// The page without its script and the web fonts, which happy-dom would fetch.
const html = readFileSync(editor + "page.html", "utf8").replace("<script>/*SCRIPT*/</script>", "").replace(/<link[^>]*fonts\.googleapis[^>]*>/g, "");

type El = HTMLElement;
type Text = string | RegExp;
const matches = (t: string, want: Text) => typeof want === "string" ? t.includes(want) : want.test(t);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A fresh editor. `saved` is what an earlier visit left in localStorage.
export function openEditor(saved?: string) {
  const window = new Window({ url: "http://localhost/index.html", width: 1400, height: 1000, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const errors: string[] = [];
  const w = window as unknown as Record<string, unknown> & { HTMLCanvasElement: { prototype: { getContext: unknown } } };
  window.console.error = (...a: unknown[]) => errors.push(a.map((x) => x instanceof Error ? x.stack ?? x.message : String(x)).join(" "));
  window.addEventListener("error", (e) => { const { error, message } = e as unknown as { error?: Error; message?: string }; errors.push(String(error?.stack ?? message)); });
  // What Node has and happy-dom doesn't pass on, a worker that never
  // answers, and no canvas to draw on (a shader's preview says so).
  w.structuredClone = structuredClone;
  w.Worker = class { onmessage = null; onerror = null; postMessage() {} terminate() {} addEventListener() {} };
  w.HTMLCanvasElement.prototype.getContext = () => null;
  // No layout: scrolling into view does nothing, and the graph's pan and
  // zoom is none (the pointer's place is its place in the graph).
  const proto = (window.Element as unknown as { prototype: Record<string, unknown> }).prototype;
  proto.scrollIntoView = proto.scrollIntoViewIfNeeded = () => {};
  const svg = window as unknown as Record<string, { prototype: object } | undefined>;
  Object.defineProperty((svg.SVGGraphicsElement ?? svg.SVGElement)!.prototype, "transform", { configurable: true, get: () => ({ baseVal: { consolidate: () => null } }) });
  window.localStorage.clear();
  if (saved) window.localStorage.setItem("projectional-editor-v5", saved);
  window.document.body.innerHTML = html;
  window.eval(js);
  const doc = window.document as unknown as Document;

  const fire = (el: Element, type: string, init: Record<string, unknown> = {}) => {
    const Ctor = /^(pointer)/.test(type) ? window.PointerEvent : /^(mouse|click|contextmenu|dblclick)/.test(type) ? window.MouseEvent : /^key/.test(type) ? window.KeyboardEvent : /^focus|^blur/.test(type) ? window.FocusEvent : window.Event;
    el.dispatchEvent(new (Ctor as unknown as typeof Event)(type, { bubbles: true, cancelable: true, composed: true, ...init }) as Event);
  };
  // A click as a person makes it: pointer and mouse down and up, then click
  // (or the context menu, for the right button), at the middle of nowhere.
  const press = (el: Element, right = false) => {
    const button = right ? 2 : 0;
    fire(el, "pointerdown", { button, isPrimary: true, pointerId: 1, pointerType: "mouse" });
    fire(el, "mousedown", { button });
    (el as El).focus?.();
    fire(el, "pointerup", { button, isPrimary: true, pointerId: 1, pointerType: "mouse" });
    fire(el, "mouseup", { button });
    if (right) fire(el, "contextmenu", { button });
    else if (typeof (el as El).click === "function") (el as El).click();
    else fire(el, "click", { button });
  };

  // Playwright's :text-is("…") (the whole text) and :has-text("…") (part
  // of it), which CSS lacks: the elements they match are marked first.
  const pseudo = (selector: string) => {
    let n = 0;
    return selector.replace(/:(text-is|has-text|text)\((["'])(.*?)\2\)/g, (_, kind: string, _q: string, want: string) => {
      const mark = `data-pw-${n++}`;
      for (const e of doc.querySelectorAll(`[${mark}]`)) e.removeAttribute(mark);
      for (const e of doc.querySelectorAll("*")) {
        const t = (e.textContent ?? "").trim();
        if (kind === "text-is" ? t === want : kind === "text" ? t.toLowerCase().includes(want.toLowerCase()) : t.includes(want)) e.setAttribute(mark, "");
      }
      return `[${mark}]`;
    });
  };
  const layout = (what: string) => { throw new Error(`${what} needs a browser's layout`); };
  class Locator {
    selector: string; text?: Text; pick: (els: El[]) => El[]; within?: Locator;
    constructor(selector: string, text?: Text, pick: (els: El[]) => El[] = (e) => e, within?: Locator) {
      this.selector = selector; this.text = text; this.pick = pick; this.within = within;
    }
    all(): El[] {
      const roots: ParentNode[] = this.within ? this.within.all() : [doc];
      const selector = pseudo(this.selector);
      let els = roots.flatMap((r) => [...r.querySelectorAll(selector)] as El[]);
      if (this.text !== undefined) els = els.filter((e) => matches(e.textContent ?? "", this.text!));
      return this.pick(els);
    }
    first() { return new Locator(this.selector, this.text, (e) => this.pick(e).slice(0, 1), this.within); }
    last() { return new Locator(this.selector, this.text, (e) => this.pick(e).slice(-1), this.within); }
    nth(i: number) { return new Locator(this.selector, this.text, (e) => this.pick(e).slice(i, i + 1), this.within); }
    locator(selector: string, o: { hasText?: Text } = {}) { return new Locator(selector, o.hasText, undefined, this); }
    async count() { return this.all().length; }
    // As Playwright's: waits for the element, and fails if it never comes.
    async one(timeout = 2000): Promise<El> {
      for (let t = 0; ; t += 20) {
        const el = this.all()[0];
        if (el) return el;
        if (t >= timeout) throw new Error(`no ${this.selector}${this.text ? ` with ${this.text}` : ""}`);
        await sleep(20);
      }
    }
    async click(o: { button?: "right"; timeout?: number } = {}) { press(await this.one(o.timeout), o.button === "right"); await settle(); }
    async fill(value: string, o: { timeout?: number } = {}) {
      const el = await this.one(o.timeout) as HTMLInputElement;
      el.focus(); el.value = value;
      fire(el, "input"); fire(el, "change");
      await settle();
    }
    async selectOption(v: string | { label: string }, o: { timeout?: number } = {}) {
      const el = await this.one(o.timeout) as HTMLSelectElement;
      const opt = [...el.options].find((op) => typeof v === "string" ? op.value === v : op.textContent?.trim() === v.label);
      if (!opt) throw new Error(`no option ${JSON.stringify(v)}`);
      el.value = opt.value;
      fire(el, "input"); fire(el, "change");
      await settle();
    }
    async dispatchEvent(type: string, init: Record<string, unknown> = {}, o: { timeout?: number } = {}) { fire(await this.one(o.timeout), type, init); await settle(); }
    async focus() { (await this.one()).focus(); }
    tap(o: { timeout?: number } = {}) { return this.click(o); }
    async scrollIntoViewIfNeeded() { await this.one(); }
    async check(o: { timeout?: number } = {}) { const el = await this.one(o.timeout) as HTMLInputElement; if (!el.checked) await this.click(o); }
    async press(key: string, o: { timeout?: number } = {}) { (await this.one(o.timeout)).focus(); await keyboard.press(key); }
    async isDisabled(o: { timeout?: number } = {}) { return (await this.one(o.timeout)).hasAttribute("disabled"); }
    async isChecked(o: { timeout?: number } = {}) { return (await this.one(o.timeout) as HTMLInputElement).checked; }
    async inputValue(o: { timeout?: number } = {}) { return (await this.one(o.timeout) as HTMLInputElement).value; }
    async allTextContents() { return this.all().map((e) => e.textContent ?? ""); }
    async boundingBox(): Promise<null> { return layout("boundingBox"); }
    async evaluate(): Promise<never> { return layout("evaluate"); }
    async evaluateAll(): Promise<never> { return layout("evaluateAll"); }
    async innerText(o: { timeout?: number } = {}) { return (await this.one(o.timeout)).innerText; }
    async textContent() { return (await this.one()).textContent; }
    async allInnerTexts() { return this.all().map((e) => e.innerText); }
    async getAttribute(name: string, o: { timeout?: number } = {}) { return (await this.one(o.timeout)).getAttribute(name); }
    async isVisible() { return this.all().length > 0; }
    async waitFor(o: { timeout?: number; state?: "attached" | "detached" } = {}) {
      if (o.state === "detached") { for (let t = 0; this.all().length; t += 20) { if (t >= (o.timeout ?? 2000)) throw new Error(`${this.selector} stayed`); await sleep(20); } return; }
      await this.one(o.timeout);
    }
  }
  // Lets the page's own timers and promises run after a gesture.
  const settle = () => sleep(0);
  const KEYS: Record<string, string> = { Escape: "Escape", Enter: "Enter", Tab: "Tab", F10: "F10", ArrowDown: "ArrowDown", ArrowUp: "ArrowUp", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Delete: "Delete", Backspace: "Backspace" };
  const keyboard = {
    async press(combo: string) {
      const parts = combo.split("+"), key = parts.pop()!;
      const mods = { shiftKey: parts.includes("Shift"), ctrlKey: parts.includes("Control"), metaKey: parts.includes("Meta"), altKey: parts.includes("Alt") };
      const at = (doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : doc.body) as Element;
      fire(at, "keydown", { key: KEYS[key] ?? key, ...mods });
      fire(at, "keyup", { key: KEYS[key] ?? key, ...mods });
      await settle();
    },
    // Into the focused field, a character at a time.
    async type(text: string) {
      const at = doc.activeElement as HTMLInputElement | null;
      for (const ch of text) {
        if (!at) break;
        fire(at, "keydown", { key: ch });
        if ("value" in at) { at.value += ch; fire(at, "input"); }
        fire(at, "keyup", { key: ch });
      }
      await settle();
    },
  };
  return {
    doc, errors, keyboard, window,
    locator: (selector: string, o: { hasText?: Text } = {}) => new Locator(selector, o.hasText),
    texts: (selector: string) => [...doc.querySelectorAll(selector)].map((e) => e.textContent ?? ""),
    close: async () => { await window.happyDOM.abort(); await window.happyDOM.close(); },
  };
}
export type EditorPage = ReturnType<typeof openEditor>;
