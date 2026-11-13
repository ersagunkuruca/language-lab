// A definition that gives an Html but isn't the page (a helper drawing a
// part of it, dice's `bars`): Run draws what it gives, as the page would,
// instead of printing the value's insides (I256; main had this, QA10 M1).
// It is drawn in a frame of its own, with the page's own style when the
// program is a page (the style is main's, so a part alone has none), and
// it is only a picture: its buttons and fields answer nothing here.
import type { Id } from "../ters/src/model.ts";
import type * as T from "./typed.ts";
import { h } from "./dom.ts";
import { Cells } from "../ters/src/lang/cells.ts";
import { equal, type Value } from "../ters/src/lang/run.ts";
import { HTML } from "../ters/src/lang/std.ts";
import { evaluatorCall, mountHtml, type Doc } from "../ters/src/lang/html.ts";
import { PAGE_BASE } from "../ters/src/lang/page-base.ts";

// Does `def` give an Html (a function's result, or a value)?
export function givesHtml(info: T.Info, def: Id): boolean {
  const t = info.typeOf.get(def);
  if (!t) return false;
  const z = info.subst.zonk(t);
  const r = z.t === "fn" ? info.subst.zonk(z.ret) : z;
  return r.t === "con" && r.id === HTML;
}

export function htmlPart(v: Value, name: string): HTMLElement {
  const frame = h("iframe", { class: "html-part", title: `What ${name} gives, drawn as the page draws it` }) as HTMLIFrameElement;
  const note = h("p", { class: "hint" }, `What ${name} gives is a part of a page, drawn here as the page draws it; open main to see it in the page.`);
  // Filled once the frame is in the editor: before, it has no document.
  queueMicrotask(() => {
    const d = frame.contentDocument;
    if (!d) return;
    // The page's own style, where it is running above.
    const page = document.querySelector<HTMLIFrameElement>("iframe.page")?.contentDocument;
    const styles = [PAGE_BASE, ...[...page?.querySelectorAll("style") ?? []].filter((s) => s.id !== "lab-base").map((s) => s.textContent ?? "")];
    d.head.append(...styles.map((css) => Object.assign(d.createElement("style"), { textContent: css })));
    try {
      d.body.append(mountHtml(v, { cells: new Cells(equal), doc: d as unknown as Doc, call: evaluatorCall }) as unknown as Node);
    } catch (e) {
      note.textContent = `What ${name} gives is a part of a page, and it doesn't draw on its own here (${(e as Error).message}); open main to see it in the page.`;
      frame.hidden = true;
      return;
    }
    frame.style.height = `${Math.min(Math.max(Math.ceil(d.documentElement.getBoundingClientRect().height) + 2, 60), Math.round(innerHeight * 0.6))}px`;
  });
  return h("div", { class: "html-part-box" }, frame, note);
}
