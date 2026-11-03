// Parts of the Selected panel for the part you selected (split out of
// main.ts, E228f): where it sits in a row (a list's items, a + b + c), its
// unit, and what the open definition is the same as. What they read of the
// editor comes through `SelectedHost`.
import type { Code, Id, Node } from "../ters/src/model.ts";
import type { Presentation } from "../ters/src/presentation.ts";
import type { Namer } from "../ters/src/render/namer.ts";
import { formatUnit, infer as unitInfer, NAMED, type Unit } from "../ters/src/units.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { sameAs, type Same } from "../ters/src/lang/modules.ts";
import * as T from "./typed.ts";
import { edit, h } from "./dom.ts";
import type { Doc, UI } from "./main.ts";

export interface SelectedHost {
  doc(): Doc;
  ui: UI;
  // Do an edit that was checked (main.ts applyT): false when it's refused.
  applyT(e: T.TEdit): boolean;
  typedPres(): Presentation;
  // A type parameter's binder: it takes no unit.
  isTypeParam(id: Id): boolean;
}

export function selectedParts(host: SelectedHost) {
  const { doc, ui, applyT, typedPres, isTypeParam } = host;
  const node = (id: Id) => doc().code.nodes[id];
  function unitEdit(info: T.Info, id: Id, unit: Unit | null): T.TEdit {
    const n = node(id) as Node & { unit?: Unit };
    const { unit: _, ...rest } = n;
    const next: Node = unit ? { ...rest, unit } as Node : rest as Node;
    const code: Code = { nodes: { ...doc().code.nodes, [id]: next }, defs: doc().code.defs };
    return T.guardTyped(info, code, doc().names.short, id, unit
      ? `Declared ${formatUnit(unit)}. Units are part of the type, so everything connected to it now has to agree.`
      : "Cleared the declared unit; it's inferred from what it's connected to again.");
  }

  // A list's items and the operands of a + b + c are a row (typed.ts): the
  // part you selected says where it is in it, and moves, grows or leaves it.
  // Each edit is checked when clicked.
  function rowSection(info: T.Info, id: Id): HTMLElement | null {
    const inRow = T.rowOfItem(doc().code, id), own = T.rowAt(doc().code, id);
    if (!inRow && !own) return null;
    const box = h("div", {});
    const word = (r: T.Row) => (r.kind === "list" ? "item" : "input");
    const of = (r: T.Row) => (r.kind === "list" ? "the list" : typedPres().names[r.op!] ?? "the call");
    const go = (r: T.TEdit, add = false) => { if (applyT(r) && add) document.getElementById("f-query")?.focus(); };
    if (inRow) {
      const { row, at } = inRow, n = row.items.length;
      const cant = (why: string) => ({ ok: false as const, reason: why });
      box.append(h("div", { class: "sub-head" }, `${word(row)[0].toUpperCase() + word(row).slice(1)} ${at + 1} of ${n} in ${of(row)} · code.json`), h("div", { class: "acts" },
        edit("Add one before", `A new ${word(row)} just before this`, { ok: true }, () => go(T.addItem(doc().code, doc().names.short, info, row, at), true)),
        edit("Add one after", `A new ${word(row)} just after this`, { ok: true }, () => go(T.addItem(doc().code, doc().names.short, info, row, at + 1), true)),
        edit("Earlier", "Swap it with the one before", at > 0 ? { ok: true } : cant("it's first already"), () => go(T.moveItem(doc().code, doc().names.short, info, row, at, -1))),
        edit("Later", "Swap it with the one after", at < n - 1 ? { ok: true } : cant("it's last already"), () => go(T.moveItem(doc().code, doc().names.short, info, row, at, 1))),
        edit("Take it out", `Remove this ${word(row)}; the rest close up`, { ok: true }, () => go(T.removeItem(doc().code, doc().names.short, info, row, at)), "btn danger")));
    }
    if (own) {
      if (!inRow) box.append(h("div", { class: "sub-head" }, `${own.kind === "list" ? `A list of ${own.items.length}` : `${own.items.length} inputs of ${of(own)}`} · code.json`));
      box.append(h("div", { class: "acts" }, edit(`Add ${own.kind === "list" ? "an item" : "an input"} at the end`, "A new hole at the end, to fill", { ok: true }, () => go(T.addItem(doc().code, doc().names.short, info, own, own.items.length), true))));
    }
    return box;
  }

  // Units: what inference says, and chips to declare one. A chip that would
  // make units disagree is disabled and says why, before you click it.
  const UNIT_CHIPS: [string, Unit | null][] = [["free", null], ["1", {}], ["m", { m: 1 }], ["s", { s: 1 }], ["kg", { kg: 1 }], ["A", { A: 1 }],
    ["m/s", { m: 1, s: -1 }], ["m/s²", { m: 1, s: -2 }], ...NAMED.map(([name, u]): [string, Unit] => [name, u])];

  function unitSection(info: T.Info, id: Id): HTMLElement | null {
    const n = node(id);
    const numeric = T.typeOf(info, id, {}) === "Float64";
    // An input takes a unit when it is a number or nothing says what it is
    // yet; one holding a function or a list doesn't (I138).
    const ty = info.typeOf.get(id), shape = ty && info.subst.resolve(ty);
    const declarable = (n.kind === "binder" && !isTypeParam(id) && (!shape || shape.t === "var" || numeric)) || (n.kind === "lit" && typeof n.value === "number");
    if (!declarable && !numeric) return null;
    const u = (() => { try { return unitInfer(doc().code, ui.def).unit(id); } catch { return undefined; } })();
    const declared = (n as { unit?: Unit }).unit;
    // A program that declares no units (two dice, say) keeps the chooser
    // folded away: a number there is just a number.
    const usesUnits = !!declared || Object.values(doc().code.nodes).some((x) => (x as { unit?: Unit }).unit);
    if (!usesUnits && !declarable) return null;
    const box = h(usesUnits ? "div" : "details", usesUnits ? {} : { class: "alts units" }, usesUnits ? h("div", { class: "sub-head" }, "Unit · part of its type") : h("summary", {}, "Give it a unit (m, s, kg…)"),
      h("p", { class: "hint" }, declared ? `Declared ${formatUnit(declared)}.` : u ? `Inferred ${formatUnit(u)} from what it's connected to.` : n.kind === "lit" ? "A plain number." : "Free: nothing pins it down yet, so it fits anywhere."));
    if (!declarable) return box;
    const chips = h("div", { class: "chips" });
    for (const [label, unit] of UNIT_CHIPS) {
      const on = unit === null ? !declared : !!declared && formatUnit(declared) === formatUnit(unit);
      // Checked when clicked, not when drawn: each check infers the whole
      // program again, and a chip row in a big program took seconds to show
      // every time a number was selected. A unit that doesn't fit is refused
      // with the reason, like any edit.
      const b = h("button", { class: `chip-btn${on ? " on" : ""}`, type: "button", title: `Declare ${label}` }, label);
      if (!on) b.addEventListener("click", () => applyT(unitEdit(info, id, unit)));
      chips.append(b);
    }
    box.append(chips);
    return box;
  }

  // What the open definition is the same as, by hash (SHARING.md §7, E161):
  // a library definition, or another of the program's. Shown, never
  // merged: the draft stays as it is, and the edit that moves its hash ends
  // the line. Worked out once per version of the code. Prior art: Unison's
  // codebase manager, which reports it as another name (CREDITS.md).
  const sameMemo = new WeakMap<Code, Map<Id, Same>>();
  function sameLine(namer: Namer): HTMLElement | null {
    let all = sameMemo.get(doc().code);
    if (!all) { try { all = sameAs(doc().code, LIBRARY); } catch { all = new Map(); } sameMemo.set(doc().code, all); }
    const same = all.get(ui.def);
    if (!same) return null;
    const link = (d: Id) => h("button", { type: "button", class: "link", "data-act": "goto", "data-target": d, title: "Open it" }, namer.name(d));
    const where = (d: Id) => { const m = LIBRARY.modules.find((x) => x.code.nodes[d])?.title; return m ? ` in ${m}` : " in the library"; };
    const parts: (HTMLElement | string)[] = [];
    for (const d of same.library) parts.push(...(parts.length ? [", "] : []), link(d), where(d));
    for (const d of same.drafts) parts.push(...(parts.length ? [", "] : []), link(d), " (yours)");
    return h("p", { class: "hint same", title: "The same code as this one, names aside (its meaning hash). Nothing is merged: edit this one and the line goes when it stops matching. Prior art: Unison's codebase manager names such a definition as another name for the existing one." }, "Same as ", ...parts);
  }
  return { rowSection, unitSection, sameLine };
}
