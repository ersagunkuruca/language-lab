// A definition's structure (split out of main.ts, E228m): its inputs, a
// data type's cases and fields, an effect's or an interface's operations,
// the implementations a type has, the type pickers they use, and the
// + New definition form. What it reads of the editor comes through
// `StructureHost`.
import { get, isCall, isPublished, type Id, type Node, type NodeOf } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pos } from "./canvas.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { NUMBER, STRING, type Type } from "../ters/src/lang/types.ts";
import { BOOL } from "../ters/src/lang/std.ts";
import { implementationKey } from "../ters/src/lang/infer.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import * as Top from "../ters/src/lang/toplevel.ts";
import * as T from "./typed.ts";
import { edit, h, type Kid } from "./dom.ts";
import { typeName } from "./palette.ts";
import type { Doc, UI } from "./main.ts";

export interface StructureHost {
  doc(): Doc;
  ui: UI;
  // Do an edit that was checked (main.ts applyT).
  applyT(e: T.LooseEdit, then?: () => void, place?: Record<Id, Pos>, pins?: Pins): boolean;
  render(): void;
  topT(info: T.Info, r: Top.Top): T.TEdit;
  defBody(d: Id): Node | null;
  defNamed(name: string): Id | undefined;
  ownDefs(): Id[];
  typeText(tid: Id, names: Names): string;
  pinRow(info: T.Info, dname: string): HTMLElement;
  textField(id: string, label: string, placeholder: string, value?: string): { el: HTMLElement; input: HTMLInputElement };
  seg(name: string, value: string, options: [string, string][]): HTMLElement;
}

export function structure(host: StructureHost) {
  const { doc, ui, applyT, render, topT, defBody, defNamed, ownDefs, typeText, pinRow, textField, seg } = host;
  const node = (id: Id) => doc().code.nodes[id];
  // A type, picked the way it's written: what it starts with (Float64, Int, a
  // data type, one of the type's own parameters) and, for one that takes
  // arguments, a picker for each, nested: Pair, then Int and Text. `none`
  // adds a first choice of no type at all; a type the pickers can't show
  // (a function's) is kept until another is picked.
  // A field's type as the pickers write one: a tref of trefs, or null.
  function typeSpecOf(t: Id): Top.TypeSpec | null {
    const n = node(t);
    if (n?.kind !== "tref") return null;
    const args = n.args.map(typeSpecOf);
    return args.every(Boolean) ? { target: n.target, args: args as Top.TypeSpec[] } : null;
  }

  function typePicker(id: string, type: Id, names: Names, current: Id | null, changed: () => void, none?: string, variant?: Id) {
    // The program's own types before the library's, and a name both have
    // marked on the library's (E217).
    const all = Top.typeHeads(doc().code, type, variant), mine = (x: { target: Id }) => LIBRARY.code.nodes[x.target]?.kind !== "def";
    const heads = [...all.filter(mine), ...all.filter((x) => !mine(x))];
    const label = (x: { target: Id }) => {
      const n = names[x.target] ?? x.target;
      return !mine(x) && heads.some((y) => y !== x && (names[y.target] ?? y.target) === n) ? `${n} · library` : n;
    };
    const specOf = (t: Id): Top.TypeSpec | null => {
      const n = node(t);
      if (n.kind !== "tref") return null;
      const args = n.args.map(specOf);
      return args.every(Boolean) ? { target: n.target, args: args as Top.TypeSpec[] } : null;
    };
    const kept = current ? specOf(current) : null;
    const one = (at: Top.TypeSpec | null, sid: string | undefined, top: boolean): { el: HTMLElement; spec: () => Top.TypeSpec | null } => {
      const odd = top && current && !kept ? typeText(current, names) : null;
      const select = h("select", sid ? { id: sid } : { "aria-label": "argument" },
        top && none ? h("option", { value: "none", selected: !current }, none) : null,
        odd ? h("option", { value: "kept", selected: true }, odd) : null,
        ...heads.map((x, i) => h("option", { value: String(i), selected: !odd && at?.target === x.target }, label(x)))) as HTMLSelectElement;
      if (!at && !odd && !(top && none)) select.value = "0";
      const args = h("div", { class: "type-args" });
      let parts: { el: HTMLElement; spec: () => Top.TypeSpec | null }[] = [];
      const fill = (given: Top.TypeSpec[]) => {
        const head = heads[Number(select.value)];
        parts = head ? Array.from({ length: head.arity }, (_, i) => one(given[i] ?? null, undefined, false)) : [];
        args.replaceChildren(...parts.map((p) => p.el));
      };
      fill(at?.args ?? []);
      select.addEventListener("change", (e) => { e.stopPropagation(); fill([]); changed(); });
      return {
        el: h("div", { class: "type-pick" }, select, args),
        spec: () => {
          const head = heads[Number(select.value)];
          if (!head) return null;
          const xs = parts.map((p) => p.spec());
          return xs.every(Boolean) ? { target: head.target, args: xs as Top.TypeSpec[] } : null;
        },
      };
    };
    return one(kept, id, true);
  }

  // Run a top-level edit; `then` adjusts what's shown once it's in.
  // A call typed of a name nothing has yet (E180): a definition of that
  // name, its inputs named after what the call gives it (a name typed there,
  // or in1, in2…), its body a hole. The typed text stays, and reads now.
  function makeNamed(info: T.Info, name: string): HTMLElement {
    const ins = T.callInputs(ui.query, name) ?? [];
    // A name typed there, or in1, in2… as Make a function names them: one
    // word, so it reads without ‹ › (I143).
    const named = ins.map((x, i) => /^[\p{L}_][\p{L}\p{N}_' ]*$/u.test(x) && !ins.slice(0, i).includes(x));
    const unnamed = named.filter((n) => !n).length;
    let k = 0;
    const params = ins.map((x, i) => (named[i] ? x : unnamed > 1 ? `in${++k}` : "in"));
    const b = h("button", { class: "btn", type: "button" }, `Make a definition named ${name}`);
    b.title = `${name}(${params.join(", ")}), its body a hole to fill later; what's typed here then reads`;
    b.addEventListener("click", () => {
      const keep = ui.query, at = ui.selected, was = doc();
      runTop(info, Top.newDefinition(doc().code, doc().names.short, name, { kind: "function", params }));
      if (doc() === was) return;
      // Back at the hole it was typed in, the typed text kept.
      ui.selected = at;
      ui.query = keep;
      ui.note = `Made ${name}(${params.join(", ")}), its body a hole to fill later. Enter fills this one with what's typed.`;
      render();
      const f = document.getElementById("f-query") as HTMLInputElement | null;
      f?.focus();
    });
    return b;
  }

  function runTop(info: T.Info, r: Top.Top, then?: (r: Extract<Top.Top, { ok: true }>) => void) {
    // Before drawing: drawn first, a deleted definition would still be the
    // open one, with its nodes gone.
    applyT(topT(info, r), r.ok && then ? () => then(r) : undefined);
  }

  const row = (...kids: Kid[]) => h("div", { class: "srow" }, ...kids);
  const pick = (id: Id, label: string, detail?: string) => h("button", { class: "slink", type: "button", "data-act": "goto-node", "data-target": id }, label, detail ? h("span", { class: "opt-d" }, ` ${detail}`) : null);

  // An interface's implementations (INTERFACES.md): the ones there are, and
  // one to write for a type that has none.
  function implementFor(r: ReturnType<typeof T.implement>) {
    applyT(r, () => { if (r.ok) { ui.back = [ui.def]; ui.def = r.code.defs.at(-1)!; } }, undefined, r.ok ? r.pin : undefined);
  }
  function implementButton(info: T.Info, iface: Id, type: Type, label: string): HTMLElement {
    const r = T.implement(doc().code, doc().names.short, info, iface, type);
    return edit(label, "A definition of the interface's record at this type, a hole for each operation", r, () => implementFor(r));
  }

  // A data type's side: each interface, and how this type does it or a
  // button to write how.
  function interfacesOfType(info: T.Info, names: Names): HTMLElement {
    const type: Type = { t: "con", id: ui.def, args: [] }, dname = names[ui.def] ?? "this type";
    const out = h("div", {}, h("div", { class: "sub-head" }, `Interfaces ${dname} implements · code.json`));
    for (const iface of T.interfaces(doc().code)) {
      const d = info.implementations?.get(implementationKey(iface, type));
      // Worked out when clicked, not on every draw: one per interface cost a
      // whole check each, 0.4 s a draw of a new type (E196).
      const go = d ? null : h("button", { class: "btn", type: "button", title: "A definition of the interface's record at this type, a hole for each operation" }, "Implement");
      go?.addEventListener("click", () => implementFor(T.implement(doc().code, doc().names.short, info, iface, type)));
      out.append(row(d ? pick(d, names[iface] ?? iface, `by ${names[d] ?? d}`) : h("span", {}, names[iface] ?? iface), go));
    }
    out.append(h("p", { class: "hint" }, `An interface is a set of operations, like Trig's sin and cos. Implementing one for ${dname} is a definition of what each operation does at ${dname}; then the operation works on a ${dname} wherever it's used.`));
    return out;
  }

  function implementationsPanel(info: T.Info, names: Names): HTMLElement {
    const iface = ui.def, dname = names[iface] ?? "this interface";
    const out = h("div", {}, h("div", { class: "sub-head" }, `Implementations of ${dname} · code.json`));
    const have = [...(info.implementations ?? new Map<string, Id>())].filter(([k]) => k.startsWith(`${iface}|`)).map(([, d]) => d);
    if (!have.length) out.append(h("p", { class: "hint" }, "None yet."));
    for (const d of have) out.append(row(pick(d, names[d] ?? d, T.typeOf(info, d, names) ?? "")));
    const types = T.implementable(doc().code, info, iface);
    if (!types.length) return out;
    const sel = h("select", { id: "f-implement" }, ...types.map((t, i) => h("option", { value: String(i) }, typeName(info, t, names)))) as HTMLSelectElement;
    const go = h("button", { class: "btn", type: "button" }, "Implement");
    go.addEventListener("click", () => implementFor(T.implement(doc().code, doc().names.short, info, iface, types[+sel.value])));
    out.append(h("label", { class: "field", for: "f-implement" }, h("span", {}, "For the type"), sel), h("div", { class: "acts" }, go),
      h("p", { class: "hint" }, `How a type does ${dname}: a definition of its record at that type, with a hole for each operation. Uses of ${dname}'s operations at that type then call it directly.`));
    return out;
  }

  // What an interface's operation takes, (a) or (a, a), and what it gives.
  function operationPickers(a: Id, names: Names, inputs = 1, gave: Id = a) {
    const an = names[a] ?? "a";
    const takes = h("select", { id: "f-op-takes" }, ...[1, 2].map((k) => h("option", { value: String(k), selected: k === inputs }, `(${Array(k).fill(an).join(", ")})`))) as HTMLSelectElement;
    const gives = h("select", { id: "f-op-gives" }, ...([[a, an], [BOOL, "Bool"], [STRING, "Text"], [NUMBER, "Float64"]] as [Id, string][]).map(([v, l]) => h("option", { value: v, selected: v === gave }, l))) as HTMLSelectElement;
    return { takes, gives };
  }

  // A data type's words, or an effect's: an effect's cases are operations,
  // and their fields are what each is given.
  function words(type: Id) {
    const effect = !!(defBody(type) as { effect?: true } | null)?.effect;
    return effect ? { effect, case: "operation", cases: "operations", field: "input", fields: "inputs" } : { effect, case: "case", cases: "cases", field: "field", fields: "fields" };
  }
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

  function structurePanel(info: T.Info, names: Names): HTMLElement | null {
    const code = doc().code, sh = doc().names.short;
    const sel = ui.selected ?? ui.def;
    const n = node(sel);
    const body = defBody(ui.def);
    const own = ownDefs();
    const dname = names[ui.def] ?? "this definition";
    const out = h("div", { class: "structure" });

    if (sel === ui.def && body?.kind === "typedef" && body.interface) {
      // An interface's operations are its record's fields, each a function
      // of its type a (INTERFACES.md).
      const variant = body.variants[0], a = body.params[0];
      out.append(h("div", { class: "sub-head" }, `Operations of ${dname} · code.json`));
      for (const f of get(code, variant, "variant").fields) {
        const r = Top.removeField(code, sh, variant, f);
        out.append(row(pick(f, names[f] ?? "operation", typeText(get(code, f, "field").type, names)), edit("×", "Remove this operation", r, () => runTop(info, r), "btn mini")));
      }
      const c = textField("f-new-op", "New operation", "its name");
      const { takes, gives } = operationPickers(a, names);
      const add = h("button", { class: "btn", type: "button" }, "Add the operation");
      add.addEventListener("click", () => runTop(info, Top.addOperation(code, sh, ui.def, c.input.value, +takes.value, gives.value === a ? null : gives.value)));
      c.input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
      out.append(c.el, h("label", { class: "field", for: "f-op-takes" }, h("span", {}, "Takes"), takes), h("label", { class: "field", for: "f-op-gives" }, h("span", {}, "Gives"), gives), h("div", { class: "acts" }, add),
        h("p", { class: "hint" }, `Every implementation of ${dname} gets a hole for a new operation.`), implementationsPanel(info, names));
    } else if (sel === ui.def && body?.kind === "typedef") {
      // How it's stored, when the program writes representations for it:
      // the compiler's choice for what main does, shown and never asked for
      // (REPRESENTATIONS.md; Ersagun 2026-10-30: "I want the compiler to choose").
      const st = T.storedAs(code, info, names, ownDefs(), ui.def, defNamed("main") ?? null);
      if (st) out.append(h("p", { class: "hint stored" }, `Stored as ${st.rep} when main runs: the compiler's choice, the cheapest for the jobs main uses (${st.jobs.map((j) => names[j] ?? j).join(", ")}).`));
      // `unique` (model.ts): kept apart from a type of the same shape when
      // hashed. Shown, not set here: it is written in text (E209).
      if (body.unique) out.append(h("p", { class: "hint" }, `Unique as “${body.unique}”: kept apart from any other type of the same shape when the program is hashed, as Unison's unique type is.`));
      // An effect is a data type whose cases are operations: the same panel,
      // in its words.
      const w = words(ui.def);
      if (!body.row) out.append(typeParams(info, names, ui.def, body.params, w.effect ? "effect" : "type"));
      out.append(h("div", { class: "sub-head" }, `${cap(w.cases)} of ${dname} · code.json`));
      for (const v of body.variants) {
        const fs = get(code, v, "variant").fields;
        out.append(row(pick(v, names[v] ?? w.case, fs.length ? `(${fs.map((f) => names[f] ?? w.field).join(", ")})` : ""),
          edit("×", `Remove this ${w.case}`, { ok: true }, () => runTop(info, Top.removeCase(code, sh, ui.def, v)), "btn mini")));
      }
      const c = textField("f-new-case", `New ${w.case}`, "its name");
      const add = h("button", { class: "btn", type: "button" }, `Add the ${w.case}`);
      // The type stays selected, so the next case is typed straight after
      // (E183); select a case to give it fields.
      add.addEventListener("click", () => {
        const at = ui.selected;
        if (!applyT(T.addCase(code, sh, info, ui.def, c.input.value, []))) return;
        ui.selected = at;
        render();
        (document.getElementById("f-new-case") as HTMLInputElement | null)?.focus();
      });
      c.input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
      out.append(h("p", { class: "hint" }, body.effect
        ? "Calling an operation performs it; a match on the computation that performs it handles it, one case per operation, and every such match gets a case for a new one. Select an operation to give it inputs and say what it gives back."
        : "Every match and fold over this type gets an arm for a new case, with a hole to fill. Select a case to give it fields."), c.el, h("div", { class: "acts" }, add));
      if (!body.effect && !body.params.length) out.append(interfacesOfType(info, names));
    } else if (sel === ui.def && isPublished(ui.def)) {
      // A published definition is read-only; copying it in is how you change it.
      const r = T.copyIntoProgram(code, sh, info, ui.def, dname);
      out.append(h("div", { class: "sub-head" }, `${dname} is published`),
        h("p", { class: "hint" }, `It's named by its content (${ui.def.slice(0, 9)}…), so it can't change. Copy it into this program to edit your own version; this program's calls switch to the copy.`),
        h("div", { class: "acts" }, edit("Copy into my program", "A copy of your own, used by this program", r, () => { if (r.ok) { ui.def = r.select!; ui.back = []; applyT(r); } })));
      return out;
    } else if (sel === ui.def) {
      out.append(pinRow(info, dname));
      // A way of an interface's operation (E210): which, what it costs, and
      // back to an ordinary definition.
      const way = (node(ui.def) as NodeOf<"def">).way;
      if (way) {
        const cost = (node(ui.def) as NodeOf<"def">).cost;
        const iface = info.owner.get(way);
        const ci = h("input", { id: "f-way-cost", type: "number", min: "0", step: "1", value: cost == null ? "" : String(cost), placeholder: "1", autocomplete: "off" }) as HTMLInputElement;
        ci.addEventListener("change", () => runTop(info, Top.setWay(code, sh, ui.def, { cost: ci.value.trim() === "" ? null : Number(ci.value) })));
        out.append(h("div", { class: "sub-head" }, "A way of ", pick(way, names[way] ?? "an operation"), iface ? " in " : "", iface ? pick(iface, names[iface] ?? "its interface") : "", " · code.json"),
          h("label", { class: "field", for: "f-way-cost" }, h("span", {}, "Cost"), ci),
          h("p", { class: "hint" }, `What it costs besides what it uses (the usual is 1): the compiler takes the cheapest way that ends in what an implementation gives.`),
          h("div", { class: "acts" }, edit("Make it ordinary", `No longer a way of ${names[way] ?? "the operation"}: a definition like any other`, { ok: true }, () => runTop(info, Top.setWay(code, sh, ui.def, null)))));
      }
      // An implementation: how each operation is worked out, the
      // compiler's pick, shown and never asked for (WAYS.md step 5, L96;
      // Ersagun 2026-10-30: "I want the compiler to choose").
      const picks = T.waysOfImplementation(code, ui.def);
      if (picks?.some((p) => !p.given || p.way)) {
        out.append(h("div", { class: "sub-head" }, "How each operation is worked out · the compiler's pick"));
        for (const p of picks) out.append(row(pick(p.field, names[p.field] ?? "operation",
          p.missing ? "left to its ways, and none ends in what it gives" : p.way ? `by ${names[p.way] ?? "a way"}${p.given ? ", cheaper than as written" : ""}` : "as written")));
        out.append(h("p", { class: "hint" }, "The cheapest way that ends in what this implementation gives: an operation left to its ways is worked out from the others, and a way can beat one written here when it costs less."));
      }
      const params = body?.kind === "lambda" ? body.params : [];
      out.append(h("div", { class: "sub-head" }, `Inputs of ${dname} · code.json`));
      if (!params.length) {
        out.append(h("p", { class: "hint" }, body?.kind === "lambda" ? "None: it's an action, run where it's called, each time." : "None: it's a value, computed once. Adding an input makes it a function."));
        // One into the other (E181): symbols() everywhere becomes symbols.
        if (body && body.kind !== "typedef" && !(body.kind === "lambda" && body.results?.length)) {
          const turn = h("button", { class: "btn", type: "button" }, body.kind === "lambda" ? "Make it a value" : "Make it an action");
          turn.title = body.kind === "lambda" ? `Computed once; its calls ${dname}() read ${dname}` : `Run where it's called; its reads call ${dname}()`;
          turn.addEventListener("click", () => runTop(info, Top.toggleValue(code, sh, ui.def)));
          out.append(h("div", { class: "acts" }, turn));
        }
      }
      params.forEach((p) => out.append(paramRow(info, names, p)));
      const c = textField("f-new-input", "New input", "its name");
      const add = h("button", { class: "btn", type: "button" }, "Add the input");
      add.addEventListener("click", () => runTop(info, Top.addParameter(code, sh, ui.def, c.input.value)));
      c.input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
      out.append(c.el, h("div", { class: "acts" }, add), h("p", { class: "hint" }, "Every call gets a hole for a new input, so none is missing an argument."));
    } else if (n?.kind === "binder" && body?.kind === "lambda" && body.params.includes(sel)) {
      out.append(h("div", { class: "sub-head" }, `Input of ${dname} · code.json`), paramRow(info, names, sel));
      return out;
    } else if (innerLambda(sel)) {
      const lam = innerLambda(sel)!;
      out.append(h("div", { class: "sub-head" }, "Inputs of this function · code.json"));
      if (!lam.params.length) out.append(h("p", { class: "hint" }, "None."));
      lam.params.forEach((p) => out.append(paramRow(info, names, p, lam.id)));
      const c = textField("f-new-input", "New input", "its name");
      const add = h("button", { class: "btn", type: "button" }, "Add the input");
      add.addEventListener("click", () => runTop(info, Top.addParameter(code, sh, lam.id, c.input.value)));
      c.input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
      out.append(c.el, h("div", { class: "acts" }, add), h("p", { class: "hint" }, "What it's passed to has to take the new inputs, or the edit is refused."));
      return out;
    } else if (n?.kind === "binder" && innerLambda(inputOf(sel))) {
      out.append(h("div", { class: "sub-head" }, "Input of a function · code.json"), paramRow(info, names, sel, inputOf(sel)!));
      return out;
    } else if (n?.kind === "variant") {
      const type = info.owner.get(sel)!;
      const w = words(type);
      out.append(h("div", { class: "sub-head" }, `${cap(w.fields)} of ${names[sel] ?? `this ${w.case}`} · code.json`));
      const fs = n.fields;
      if (!fs.length) out.append(h("p", { class: "hint" }, w.effect ? "None: performing it takes nothing." : "None: it's a constant."));
      // A field several cases share (L168): which others have it (E227).
      const td = node((node(type) as NodeOf<"def">).body!) as NodeOf<"typedef">;
      const rootOf = (f: Id) => (node(f) as NodeOf<"field">).same ?? f;
      const sharers = (f: Id) => td.variants.filter((v) => v !== sel && (node(v) as NodeOf<"variant">).fields.some((x) => rootOf(x) === rootOf(f)));
      for (const f of fs) {
        const others = w.effect ? [] : sharers(f);
        out.append(row(pick(f, names[f] ?? w.field, typeText(get(code, f, "field").type, names)),
          others.length ? h("span", { class: "chip", title: `The same field: .${names[f] ?? w.field} reads and sets it on any of these cases` }, `also in ${others.map((v) => names[v] ?? v).join(", ")}`) : null,
          edit("×", `Remove this ${w.field}`, Top.removeField(code, sh, sel, f), () => runTop(info, Top.removeField(code, sh, sel, f)), "btn mini")));
      }
      const c = textField("f-new-field", `New ${w.field}`, "its name");
      const t = typePicker("f-new-field-type", type, names, null, () => {}, undefined, w.effect ? sel : undefined);
      const add = h("button", { class: "btn", type: "button" }, `Add the ${w.field}`);
      add.addEventListener("click", () => { const sp = t.spec(); if (sp) runTop(info, Top.addField(code, sh, type, sel, c.input.value, sp)); });
      // Or another case's field, the same one (L168, E227): one not here yet,
      // that isn't itself another's.
      const mine = new Set(fs.map(rootOf));
      const theirs = w.effect ? [] : td.variants.filter((v) => v !== sel).flatMap((v) => (node(v) as NodeOf<"variant">).fields.filter((f) => !(node(f) as NodeOf<"field">).same && !mine.has(f)).map((f) => [v, f] as const));
      const same = theirs.map(([v, f]) => {
        const spec = typeSpecOf(get(code, f, "field").type);
        const r = spec ? Top.addField(code, sh, type, sel, names[f] ?? "field", spec) : { ok: false as const, reason: "its type can't be written here" };
        const shared: Top.Top = r.ok ? (() => { const made = (r.code.nodes[sel] as NodeOf<"variant">).fields.at(-1)!; return { ...r, code: { ...r.code, nodes: { ...r.code.nodes, [made]: { ...(r.code.nodes[made] as NodeOf<"field">), same: f } } }, note: `${r.note} It is ${names[v] ?? v}'s ${names[f] ?? "field"}, the same one: .${names[f] ?? "field"} reads it on either case.` }; })() : r;
        return edit(`${names[f] ?? "field"}, as ${names[v] ?? v}'s`, `The same field as ${names[v] ?? v}'s ${names[f] ?? "field"} (${typeText(get(code, f, "field").type, names)})`, shared, () => runTop(info, shared));
      });
      out.append(c.el, h("label", { class: "field", for: "f-new-field-type" }, h("span", {}, "Holding"), t.el), h("div", { class: "acts" }, add),
        same.length ? h("div", { class: "acts" }, h("span", { class: "hint" }, "Or another case's, the same field:"), ...same) : "",
        h("p", { class: "hint" }, w.effect ? "Every call of it gets a hole for a new input, and every case that handles it a name." : "Every place that makes this case gets a hole for a new field, and every arm for it a name."));
      if (w.effect) {
        // What the handler answers it with: the value the call gives back.
        const now = n.returns ? typeText(n.returns, names) : null;
        const r = typePicker("f-returns", type, names, n.returns ?? null, () => {
          const sp = r.spec();
          if (sp || (r.el.querySelector("select") as HTMLSelectElement).value === "none") runTop(info, Top.setReturns(code, sh, sel, sp));
        }, "nothing: it never returns", sel);
        out.append(h("label", { class: "field", for: "f-returns" }, h("span", {}, "Gives back"), r.el),
          h("p", { class: "hint" }, now ? `A call of ${names[sel] ?? "it"} is worth the ${now} its handler answers with.` : `Like abort: performing ${names[sel] ?? "it"} ends what performs it, and the handler's case gives the result instead.`));
        // Answered later (ANSWERED-LATER.md): the case gets the rest too.
        if (n.returns) {
          const cb = h("input", { id: "f-later", type: "checkbox", checked: !!n.later }) as HTMLInputElement;
          cb.addEventListener("change", () => runTop(info, Top.setLater(code, sh, sel, cb.checked)));
          out.append(h("label", { class: "field check", for: "f-later" }, cb, h("span", {}, "Answered later")),
            h("p", { class: "hint" }, n.later ? `Its handler's case also gets the rest of the computation, written ${names[sel] ?? "it"}(…) with rest: it may resume it once, now or later, or drop it. A generator's yield, a page's fetch.` : "Tick it to let the handler answer later: its case also gets the rest of the computation, to resume once, now or later, or drop."));
        }
      }
      // Private (L79, E209): the program that declares the type builds it;
      // a program using the type builds one with its functions.
      if (!w.effect && !(defBody(type) as NodeOf<"typedef"> | null)?.interface) {
        const cb = h("input", { id: "f-private", type: "checkbox", checked: !!n.private }) as HTMLInputElement;
        cb.addEventListener("change", () => runTop(info, Top.setPrivate(code, sh, sel, cb.checked)));
        out.append(h("label", { class: "field check", for: "f-private" }, cb, h("span", {}, "Private")),
          h("p", { class: "hint" }, n.private ? `Only this program builds a ${names[sel] ?? "case"}: a program that uses ${names[type] ?? "the type"} builds one with this program's functions, so they can keep a rule (a sorted list, a checked range).` : `Tick it to let only this program build a ${names[sel] ?? "case"}, so its functions can keep a rule; others still read and match it.`));
      }
      // An operation's own type, fresh at each call (`await : Ticket a → a`).
      if (w.effect) out.append(typeParams(info, names, type, n.params ?? [], "operation", sel));
      out.append(h("div", { class: "acts" }, edit(`Remove this ${w.case}`, `Remove this ${w.case} from the ${w.effect ? "effect" : "type"}`, Top.removeCase(code, sh, type, sel), () => runTop(info, Top.removeCase(code, sh, type, sel), () => { ui.selected = null; }), "btn danger")));
      return out;
    } else if (n?.kind === "field" && (defBody(info.owner.get(sel) ?? "") as { interface?: true } | null)?.interface) {
      // An interface's operation: what it takes and gives (BACKLOG E142).
      const iface = info.owner.get(sel)!, td = defBody(iface) as NodeOf<"typedef">, a = td.params[0];
      const was = code.nodes[n.type] as NodeOf<"tfun">;
      const gave = (code.nodes[was.result] as NodeOf<"tref">).target;
      const { takes, gives } = operationPickers(a, names, was.params.length, gave);
      const change = h("button", { class: "btn", type: "button" }, "Change");
      change.addEventListener("click", () => runTop(info, Top.setOperation(code, sh, iface, sel, +takes.value, gives.value === a ? null : gives.value)));
      const variant = td.variants[0];
      out.append(h("div", { class: "sub-head" }, "Operation of ", pick(iface, names[iface] ?? "the interface"), " · code.json"),
        h("label", { class: "field", for: "f-op-takes" }, h("span", {}, "Takes"), takes), h("label", { class: "field", for: "f-op-gives" }, h("span", {}, "Gives"), gives),
        h("div", { class: "acts" }, change, edit("Remove this operation", `Remove it from ${names[iface] ?? "the interface"}`, Top.removeField(code, sh, variant, sel), () => runTop(info, Top.removeField(code, sh, variant, sel), () => { ui.selected = iface; }), "btn danger")),
        h("p", { class: "hint" }, "An implementation's part for it becomes a hole when what it takes or gives changes."));
      // Its ways (WAYS.md, E210): definitions that compute it from the
      // interface's other operations, so an implementation can leave it to
      // them; the compiler picks the cheapest that ends in what's given.
      const op = names[sel] ?? "it", ways = code.defs.filter((d) => (code.nodes[d] as NodeOf<"def">).way === sel);
      out.append(h("div", { class: "sub-head" }, `Ways of ${op} · code.json`));
      if (!ways.length) out.append(h("p", { class: "hint" }, `None: each implementation gives ${op}. A way computes it from ${names[iface] ?? "the interface"}'s other operations, so an implementation can leave it to its ways.`));
      for (const d of ways) { const cost = (code.nodes[d] as NodeOf<"def">).cost; out.append(row(pick(d, names[d] ?? "a way", cost != null ? `cost ${cost}` : ""))); }
      const wc = textField("f-new-way", "New way", "its name, or one is made");
      const addWay = h("button", { class: "btn", type: "button" }, "Add a way");
      addWay.addEventListener("click", () => runTop(info, Top.addWay(code, sh, iface, sel, wc.input.value), (r) => { ui.back = [ui.def]; ui.def = r.select; ui.selected = null; }));
      wc.input.addEventListener("keydown", (e) => { if (e.key === "Enter") addWay.click(); });
      out.append(wc.el, h("div", { class: "acts" }, addWay));
      return out;
    } else if (n?.kind === "field") {
      const variant = Object.values(code.nodes).find((v) => v.kind === "variant" && v.fields.includes(sel)) as NodeOf<"variant">;
      const type = info.owner.get(sel)!;
      const t = typePicker("f-field-type", type, names, n.type, () => { const sp = t.spec(); if (sp) runTop(info, Top.setFieldType(code, sh, sel, sp)); });
      const w = words(type);
      out.append(h("div", { class: "sub-head" }, `${cap(w.field)} of `, pick(variant.id, names[variant.id] ?? `a ${w.case}`), " · code.json"),
        h("label", { class: "field", for: "f-field-type" }, h("span", {}, "Holding"), t.el),
        h("div", { class: "acts" }, edit(`Remove this ${w.field}`, `Remove it from the ${w.case}`, Top.removeField(code, sh, variant.id, sel), () => runTop(info, Top.removeField(code, sh, variant.id, sel), () => { ui.selected = variant.id; }), "btn danger")));
      return out;
    } else return null;

    const del = own.length > 1 ? Top.deleteDefinition(code, sh, ui.def) : { ok: false as const, reason: "it's the program's only definition" };
    // Duplicating checks the whole program, so it's worked out on the click.
    const typeDef = code.nodes[(code.nodes[ui.def] as NodeOf<"def">).body ?? ""]?.kind === "typedef";
    const dup = () => { const r = T.duplicate(code, sh, info, ui.def); if (r.ok) { ui.def = r.select!; ui.back = []; } applyT(r); };
    out.append(h("div", { class: "acts" },
      edit(`Duplicate ${dname}`, "A copy to change, next to it; the original stays as it is", typeDef ? { ok: false, reason: "the copy's cases would share the original's names: make a new type with + New definition" } : { ok: true }, dup),
      edit(`Delete ${dname}`, "Delete this definition", del, () => runTop(info, del, (r) => { ui.def = r.select; ui.selected = null; ui.back = []; }), "btn danger")));
    return out;
  }

  // A data type's, an effect's or an operation's type parameters (E198):
  // each removable while no type names it, and a new one added by name (a,
  // then b, … when none is given). Selecting one renames it.
  function typeParams(info: T.Info, names: Names, type: Id, params: Id[], what: "type" | "effect" | "operation", variant?: Id): HTMLElement {
    const code = doc().code, sh = doc().names.short;
    const whose = names[variant ?? type] ?? `this ${what}`;
    const out = h("div", {}, h("div", { class: "sub-head" }, `Type parameters of ${whose} · code.json`));
    if (!params.length) out.append(h("p", { class: "hint" }, what === "operation" ? "None: its inputs and what it gives back use the effect's types." : `None: ${whose} holds the same types wherever it's used. A type parameter makes it generic, like List a.`));
    for (const p of params) {
      const r = Top.removeTypeParameter(code, sh, type, p);
      out.append(row(pick(p, names[p] ?? "a"), edit("×", "Remove this type parameter", r, () => runTop(info, r), "btn mini")));
    }
    const id = variant ? "f-new-op-param" : "f-new-type-param";
    const c = textField(id, "New type parameter", "a lower-case name, or a, b, … if empty");
    const add = h("button", { class: "btn", type: "button" }, "Add the type parameter");
    add.addEventListener("click", () => runTop(info, Top.addTypeParameter(code, sh, type, c.input.value, variant)));
    c.input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
    out.append(c.el, h("div", { class: "acts" }, add));
    return out;
  }

  function paramRow(info: T.Info, names: Names, p: Id, of: Id = ui.def) {
    const code = doc().code, sh = doc().names.short;
    const mv = (by: -1 | 1) => Top.moveParameter(code, sh, of, p, by);
    const rm = Top.removeParameter(code, sh, of, p, true);
    return row(pick(p, names[p] ?? "input"),
      edit("↑", "Move earlier", mv(-1), () => runTop(info, mv(-1)), "btn mini"),
      edit("↓", "Move later", mv(1), () => runTop(info, mv(1)), "btn mini"),
      // A used input can go too: its uses become holes, to fill or clear.
      edit("×", T.usesOf(code, p).length ? "Remove this input: where it's used becomes a hole" : "Remove this input", rm, () => runTop(info, rm, (r) => { ui.selected = r.select !== of ? r.select : of === ui.def ? null : of; }), "btn mini"));
  }

  // A function written inside a body, (x) => …, passed to map or keep say:
  // not a definition's own, and not a let (a function applied right where it
  // is written, drawn as dots). Its inputs are edited like a definition's.
  function innerLambda(id: Id | null): NodeOf<"lambda"> | null {
    const n = id ? node(id) : null;
    if (n?.kind !== "lambda" || n.id === defBody(ui.def)?.id) return null;
    return Object.values(doc().code.nodes).some((c) => isCall(c) && c.fn === n.id) ? null : n;
  }
  const inputOf = (binder: Id) => Object.values(doc().code.nodes).find((l) => l.kind === "lambda" && l.params.includes(binder))?.id ?? null;

  // The library's type (data, effect or interface) of that name, if any.
  function libraryTypeNamed(name: string): Id | undefined {
    return LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name && (LIBRARY.code.nodes[d] as NodeOf<"def">).body !== undefined && LIBRARY.code.nodes[(LIBRARY.code.nodes[d] as NodeOf<"def">).body!]?.kind === "typedef");
  }

  // + New: a function (with its inputs), a value, or a data type.
  function newDefinitionForm(info: T.Info): HTMLElement {
    const name = textField("f-def-name", "Name", "what to call it");
    const kind = ui.newKind;
    const extra = kind === "function" ? textField("f-def-inputs", "Inputs", "names, separated by commas (none for an action)")
      : kind === "type" ? textField("f-def-case", "First case", "a name, e.g. circle")
      : kind === "effect" ? textField("f-def-case", "First operation", "a name, e.g. ask")
      : kind === "interface" ? textField("f-def-case", "First operation", "a name, e.g. sin") : null;
    const go = h("button", { class: "btn", type: "button" }, "Create");
    go.addEventListener("click", () => {
      const shape: Top.Shape = kind === "function" ? { kind, params: (extra!.input.value).split(",").map((x) => x.trim()).filter(Boolean) }
        : kind === "type" ? { kind, firstCase: extra!.input.value }
        : kind === "effect" || kind === "interface" ? { kind, firstOperation: extra!.input.value } : { kind: "value" };
      // A type named like one of the library's would read as either, in the
      // type pickers and in every message after (E217: clinic's own Event
      // beside std's). Renaming refuses it the same way (Top.nameClash).
      const lib = kind === "type" || kind === "effect" || kind === "interface" ? libraryTypeNamed(name.input.value.trim()) : null;
      if (lib) { ui.note = `Refused: the library has a type named ${name.input.value.trim()}${LIBRARY.comments[lib] ? ` (${LIBRARY.comments[lib].split(/[.:]/)[0]})` : ""}; two would read the same. Nothing changed.`; ui.refused = true; ui.touched = []; return render(); }
      runTop(info, Top.newDefinition(doc().code, doc().names.short, name.input.value, shape), (r) => {
        ui.back = [ui.def];
        ui.def = r.code.defs.at(-1)!;
        ui.selected = kind === "type" || kind === "effect" || kind === "interface" ? null : r.select;
        ui.mode = null;
      });
    });
    for (const f of [name, extra]) f?.input.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
    return h("div", { class: "insp" },
      h("div", { class: "sub-head" }, "New definition · code.json"),
      seg("new-kind", kind, [["function", "Function"], ["value", "Value"], ["type", "Data type"], ["effect", "Effect"], ["interface", "Interface"]]),
      h("p", { class: "hint" }, kind === "function" ? "Takes inputs and gives back a value; with no inputs it's an action you can run."
        : kind === "value" ? "One value, computed once."
        : kind === "type" ? "Cases, each with fields: like an enum whose cases carry data."
        : kind === "interface" ? "Operations a type can have, like Trig's sin and cos: written once for any type a, and each type that implements it says what they do there. Uses resolve to that type's definitions before running."
        : "Operations a computation can ask for, like a data type whose cases are requests. Calling one performs it; whoever runs the computation answers it with a match, one case per operation."),
      name.el, extra?.el ?? null,
      h("div", { class: "acts" }, go, h("button", { class: "btn", type: "button", "data-act": "new-def" }, "Cancel")));
  }
  return { implementButton, makeNamed, newDefinitionForm, pick, row, runTop, structurePanel, words };
}
