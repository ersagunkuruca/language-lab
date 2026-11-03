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

// A button for an edit: checked when drawn (`r`), it says why it can't be
// done instead of doing it, and runs `run` when clicked. One that can't is
// aria-disabled, not disabled (E231a): it stays in the Tab order, so the
// keyboard reaches it and a screen reader reads why, as a mouse's hover does.
export function edit(label: string, title: string, r: { ok: true } | { ok: false; reason: string }, run: () => void, cls = "btn") {
  const b = h("button", { class: cls, type: "button", "aria-disabled": r.ok ? undefined : "true", title: r.ok ? title : `Can't: ${r.reason}`, "aria-description": r.ok ? undefined : `Can't: ${r.reason}` }, label);
  if (r.ok) b.addEventListener("click", run);
  return b;
}
