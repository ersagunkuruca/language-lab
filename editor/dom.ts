// Making the editor's HTML elements: h("div", { class: "x" }, kid, …).
// An attribute that's undefined or false is left out, true is written as
// present (""); a kid that's null, undefined or false is left out.

export type Kid = HTMLElement | SVGElement | string | null | undefined | false;

export function h(tag: string, attrs: Record<string, string | boolean | undefined> = {}, ...kids: Kid[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}
