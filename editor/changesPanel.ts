// The Changes tab (E255c, docs/design/tools/DIFF.md): the program against
// a base, as `ters diff` reads it. The base is the last version marked
// Reviewed (kept in this browser), else the version it was opened as: an
// example as shipped, a file as opened, your own program as it was when
// the page showed it first. The changed definitions are listed with their
// changed lines; while the tab shows, the open definition's added and
// changed nodes are marked in its blocks and graph. It reads the code and
// never changes it. What it reads of the editor comes through
// `ChangesHost`.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names, Style } from "../ters/src/presentation.ts";
import type { Info } from "../ters/src/lang/infer.ts";
import { diffPrograms, type DiffLine, type ProgramDiff, type Version } from "../ters/src/diff.ts";
import { h } from "./dom.ts";
import type { Doc, UI } from "./main.ts";

export interface ChangesHost {
  doc(): Doc;
  ui: UI;
  // The names a version is shown with (library's, its modules', its own).
  namesOf(d: Doc): Names;
  // The program's check: the open one's is the editor's own.
  infoOf(d: Doc): Info | null;
  style(): Style;
  ownDefs(d: Doc): Id[];
  // A doc as kept in this browser (its own nodes), and back on today's library.
  keep(d: Doc): Doc;
  restore(d: Doc): Doc;
  // An example as shipped; null for a program of your own.
  shipped(d: Doc): Doc | null;
  key: string;
}

type Mark = "added" | "changed";

export function changesPanels(host: ChangesHost) {
  const { doc, ui } = host;
  const opened = new Map<string, Doc>();
  let reviewed: Record<string, { at: string; doc: Doc }> = {};
  try { reviewed = JSON.parse(localStorage.getItem(host.key) ?? "{}") ?? {}; } catch {}
  const restored = new Map<string, Doc>(), shippedOf = new Map<string, Doc | null>();
  const keepReviewed = () => { try { localStorage.setItem(host.key, JSON.stringify(reviewed)); } catch {} };

  // What a program is compared with, and what that is called.
  function base(): { doc: Doc; what: string } {
    const d = doc(), r = reviewed[d.program];
    if (r) {
      let b = restored.get(r.at + d.program);
      if (!b) { try { b = host.restore(r.doc); } catch { b = d; } restored.set(r.at + d.program, b); }
      return { doc: b, what: `the version marked Reviewed ${new Date(r.at).toLocaleString()}` };
    }
    if (!shippedOf.has(d.program)) shippedOf.set(d.program, host.shipped(d));
    const shipped = shippedOf.get(d.program);
    if (shipped) return { doc: shipped, what: "the example as shipped" };
    return { doc: opened.get(d.program) ?? d, what: "the version opened" };
  }

  const infos = new WeakMap<Code, Info | null>();
  const version = (d: Doc): Version => {
    let info = infos.get(d.code);
    if (info === undefined) infos.set(d.code, (info = host.infoOf(d)));
    return { code: d.code, own: host.ownDefs(d), names: host.namesOf(d), comments: d.comments, info, style: host.style() };
  };

  // One diff per pair of versions and their names.
  let kept: { from: unknown[]; diff: ProgramDiff } | null = null;
  function diff(): { diff: ProgramDiff; before: Doc; what: string } {
    const b = base(), a = doc();
    const from = [b.doc, a.code, a.comments, host.namesOf(a), host.namesOf(b.doc), host.style()];
    if (!kept || from.some((x, i) => x !== kept!.from[i])) kept = { from, diff: diffPrograms(version(b.doc), version(a)) };
    return { diff: kept.diff, before: b.doc, what: b.what };
  }

  // The open definition's nodes the base hasn't (added) or has otherwise
  // (changed): the per-node status the blocks and graph are marked with.
  function marks(): Map<Id, Mark> {
    const out = new Map<Id, Mark>();
    const { before } = diff(), after = doc().code, d = ui.def;
    const was = before.code;
    const isDef = (id: Id) => after.defs.includes(id);
    const stack = [d], seen = new Set<Id>();
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = after.nodes[id];
      if (!n) continue;
      if (!was.nodes[id]) out.set(id, "added");
      else if (id !== d && JSON.stringify(was.nodes[id]) !== JSON.stringify(n)) out.set(id, "changed");
      for (const v of Object.values(n)) for (const s of Array.isArray(v) ? v : [v]) if (typeof s === "string" && after.nodes[s] && !isDef(s)) stack.push(s);
    }
    return out;
  }

  // Marks on what's drawn under `root`, or none when the tab isn't showing.
  function markChanges(root: ParentNode) {
    for (const e of root.querySelectorAll(".chg-added, .chg-changed")) e.classList.remove("chg-added", "chg-changed");
    if (ui.panel !== "changes") return;
    const m = marks();
    if (!m.size) return;
    for (const e of root.querySelectorAll<Element>(".blocks-wrap [data-id], .p-graph [data-id]")) {
      const s = m.get(e.getAttribute("data-id")!);
      if (s) e.classList.add(`chg-${s}`);
    }
  }

  const MARK: Record<DiffLine["status"], string> = { same: " ", changed: "~", moved: ">", added: "+", removed: "-" };
  // A definition's changed lines with one line round each, `…` between.
  function lines(ls: DiffLine[]): HTMLElement {
    const near = new Set<number>();
    ls.forEach((l, i) => { if (l.status !== "same") for (let k = i - 1; k <= i + 1; k++) near.add(k); });
    const pre = h("pre", { class: "chg-lines" });
    let gap = false;
    ls.forEach((l, i) => {
      if (!near.has(i)) { if (!gap) pre.append(h("div", { class: "chg-gap" }, "…")); gap = true; return; }
      gap = false;
      pre.append(h("div", { class: `chg-line ${l.status}` }, `${MARK[l.status]} ${l.text}`));
      if (l.was !== undefined) pre.append(h("div", { class: "chg-was" }, `  was: ${l.was.trim()}`));
    });
    return pre;
  }

  function changesPanel(): HTMLElement {
    const { diff: d, what } = diff();
    const r = reviewed[doc().program];
    const box = h("div", { class: "changes" },
      h("p", { class: "hint" }, `Compared with ${what}. While this tab shows, the open definition's added parts are green and its changed ones amber, in the blocks and the graph.`),
      h("div", { class: "row" },
        h("button", { class: "btn", type: "button", "data-act": "mark-reviewed", title: "Compare with this version from now on" }, "Mark reviewed"),
        r ? h("button", { class: "btn", type: "button", "data-act": "forget-reviewed", title: "Compare with the version opened (an example as shipped) again" }, "Forget reviewed") : null));
    const nothing = !d.defs.length && !d.renamed.length && !d.comments.length;
    if (nothing) { box.append(h("p", { class: "chg-none" }, "No changes.")); return box; }
    for (const x of d.defs) {
      const head = x.status === "removed"
        ? h("div", { class: "chg-def removed" }, h("span", { class: "chip" }, "removed"), h("span", {}, x.name))
        : h("button", { type: "button", class: `chg-def ${x.status}${x.def === ui.def ? " on" : ""}`, "data-def": x.def }, h("span", { class: "chip" }, x.status), h("span", {}, x.name));
      box.append(head);
      if (x.status === "changed") box.append(x.lines.every((l) => l.status === "same")
        ? h("p", { class: "hint" }, "Nothing its view shows: its nodes differ, as when a call moves to another version of a library definition.")
        : lines(x.lines));
    }
    const renames = new Map<string, number>();
    for (const x of d.renamed) { const k = `Renamed ${x.from} to ${x.to}`; renames.set(k, (renames.get(k) ?? 0) + 1); }
    for (const [k, n] of renames) box.append(h("p", { class: "chg-note" }, n > 1 ? `${k} (${n} places)` : k));
    for (const c of d.comments) box.append(h("p", { class: "chg-note" }, c.from === undefined ? `Comment on ${c.on} added: ${c.to}` : c.to === undefined ? `Comment on ${c.on} removed` : `Comment on ${c.on}: ${c.to} (was: ${c.from})`));
    return box;
  }

  return {
    changesPanel,
    markChanges,
    // The version a program was opened as, the first time it's shown.
    opened(d: Doc) { if (!opened.has(d.program)) opened.set(d.program, d); },
    markReviewed() { const d = doc(); reviewed = { ...reviewed, [d.program]: { at: new Date().toISOString(), doc: host.keep(d) } }; keepReviewed(); },
    forgetReviewed() { const { [doc().program]: _, ...rest } = reviewed; reviewed = rest; keepReviewed(); },
  };
}
