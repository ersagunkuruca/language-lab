// The graph's menu (split out of main.ts, E228n): right-click in the
// graph or the Blocks pane, and what you can do right there. On a hole,
// the same palette as the side panel; on empty space, add a value; on a
// node, a binding or a frame, what applies to it. Tidying and putting
// nodes back only change layout.json. What it reads of the editor, and
// the few things it sets there, come through `GraphMenuHost`.
import { isCall, isUse, type Call, type Code, type Id, type Node } from "../ters/src/model.ts";
import type { Names, Presentation } from "../ters/src/presentation.ts";
import { Namer } from "../ters/src/render/namer.ts";
import { flattened, matchRows } from "../ters/src/lang/patterns.ts";
import * as Top from "../ters/src/lang/toplevel.ts";
import * as T from "./typed.ts";
import { h } from "./dom.ts";
import { inlinable, type InlineView } from "./inline.ts";
import { newLoose } from "./drafts.ts";
import type { GraphView } from "./typedGraph.ts";
import type { Doc, UI } from "./main.ts";

export interface GraphMenuHost {
  doc(): Doc;
  ui: UI;
  graph(): GraphView | null;
  view(): InlineView | null;
  undo: Doc[];
  applyT(e: T.LooseEdit): boolean;
  commit(next: Partial<Doc>, touched: string[], note: string): void;
  render(): void;
  select(id: Id | null): void;
  openDef(d: Id): void;
  calleeDef(id: Id): Id | null;
  typesOf(): T.Info | null;
  typedPres(): Presentation;
  defBody(d: Id): Node | null;
  stepAt(id: Id): Id;
  lkey(k: string): string;
  isNamed(b: Id): boolean;
  bindersOf(d: Id): Id[];
  fnSet(id: Id, picked: Id[]): { members: Id[]; what: string; group?: Id } | null;
  groupable(picked: Id[]): string | undefined;
  groupPicked(picked: Id[]): void;
  groupToFunction(info: T.Info, g: Id, definition?: boolean): void;
  ungroup(g: Id): void;
  partCalls(id: Id): Id[];
  wrappable(id: Id): boolean;
  graphFolded(): Set<Id>;
  toggleFolded(f: Id): void;
  toggleInline(call: Id): void;
  toggleNamed(b: Id): void;
  allNamed(on: boolean): void;
  paletteFor(hole: Id, m: NonNullable<UI["menu"]>): void;
  runTop(info: T.Info, r: Top.Top): void;
  fillPalette(hole: Id, info: T.Info, names: Names, field?: string): HTMLElement;
  // What main.ts keeps for the next render: the parts to scroll to, the
  // hole a swap made, the part being wrapped.
  setReveal(f: (id: Id) => boolean): void;
  setSwapped(s: { hole: Id; at: number }): void;
  setWrapping(w: { hole: Id; kept: Code; info: T.Info; graph: boolean }): void;
}

export function graphMenu(host: GraphMenuHost) {
  const { doc, ui, graph, view, undo, applyT, commit, render, select, openDef, calleeDef, typesOf, typedPres, defBody, stepAt, lkey, isNamed, bindersOf, fnSet,
    groupable, groupPicked, groupToFunction, ungroup, partCalls, wrappable, graphFolded, toggleFolded, toggleInline, toggleNamed, allNamed, paletteFor, runTop, fillPalette,
    setReveal, setSwapped, setWrapping } = host;
  let menuGen = 0;
  function menuFor(info: T.Info): HTMLElement | null {
    const m = ui.menu;
    if (!m) return null;
    const { kind, id } = m.target;
    const picked = graph()?.picked() ?? [];
    const inGraph = !m.blocks;
    // What an item does, or why it can't, is written under it: a tooltip
    // never shows on a greyed item, nor on a phone.
    // `disabled` can be a check to run when the item is pointed at: an edit
    // tried against the whole program takes a few hundred milliseconds, and
    // a menu asks several (Ersagun 2026-11-01: the menu was slow). Until it
    // has run the item is there to press; pressed early, the edit itself
    // says why it can't.
    const gen = ++menuGen;
    const item = (label: string, act: string, hint = "", disabled?: string | (() => string | undefined)) => {
      const now = typeof disabled === "function" ? undefined : disabled;
      const why = now || hint ? h("span", { class: `ctx-why${now ? " cant" : ""}` }, now ? `Can't: ${now}` : hint) : null;
      const b = h("button", { class: "ctx-item", type: "button", role: "menuitem", "data-menu": act, "data-target": id, disabled: !!now }, label, why) as HTMLButtonElement;
      if (typeof disabled === "function") {
        let done = false;
        const check = () => {
          if (done || gen !== menuGen) return;
          done = true;
          // A check that throws can't do it either (BACKLOG I123).
          let r: string | undefined;
          try { r = disabled(); } catch (e) { r = (e as Error).message; }
          if (!r) return;
          b.disabled = true;
          if (why) { why.className = "ctx-why cant"; why.textContent = `Can't: ${r}`; } else b.append(h("span", { class: "ctx-why cant" }, `Can't: ${r}`));
        };
        // Checked when pointed at or reached by the keyboard, not all at
        // once: each tries the edit on the whole program, a few hundred
        // milliseconds apiece, and a menu asked up to two seconds of them
        // before it settled (BACKLOG I128). Pressed unchecked, the edit
        // itself says why it can't.
        b.addEventListener("pointerenter", check);
        b.addEventListener("focus", check);
      }
      return b;
    };
    const why = (f: () => { ok: boolean; reason?: string }) => () => { const r = f(); return r.ok ? undefined : r.reason; };
    const rows: (HTMLElement | null)[] = [];
    const names = typedPres().names;
    const head = (t: string) => h("div", { class: "ctx-head" }, t);
    // A step of an action, by its node or its numbered dot: its place in
    // the order, as the panel's Order of steps.
    const stepRows = (at: Id) => {
      const v = stepAt(at), body = defBody(ui.def);
      const earlier = Top.moveStep(doc().code, doc().names.short, v, -1), later = Top.moveStep(doc().code, doc().names.short, v, 1);
      const isStep = (r: Top.Top) => r.ok || !/isn't a step/.test(r.reason);
      if (!isStep(earlier) || body?.kind !== "lambda" || body.params.length) return [];
      return [item("Do it earlier", "step-earlier", "Swap it with the step before", earlier.ok ? undefined : earlier.reason), item("Do it later", "step-later", "Swap it with the step after", later.ok ? undefined : later.reason)];
    };
    if (kind === "hole" && id) {
      rows.push(fillPalette(id, info, names, "m-query"));
    } else if (kind === "space") {
      rows.push(inGraph ? item("Add a value here…", "add", "A new loose value (a hole to fill) here: fill it, then drag its output onto an input")
        : item("Add a value at the start…", "add", "A new named value (a hole to fill) as the definition's first step: fill it, then use it by name", why(() => T.addStep(doc().code, doc().names.short, info, ui.def))));
    } else if (kind === "binder" && id) {
      const on = isNamed(id);
      rows.push(head(names[id] ?? "a value"));
      if (names[id] !== "_" && inGraph) rows.push(item(on ? "Show as wires" : "Show as let and get nodes", "named", on ? "Wires from here to every use" : "A let node here and a small get node at every use, instead of long wires"));
      rows.push(item("Name it…", "name"));
      rows.push(...stepRows(id));
      if (T.isDot(doc().code, ui.def, id) && inGraph) rows.push(item(picked.includes(id) ? "Unpick" : "Pick", "pick", "A picked dot drags to move, not to wire (alt-drag does the same)"));
      if (T.isDot(doc().code, ui.def, id)) rows.push(item("Remove the dot", "undot", "Put the value back on its one wire", why(() => T.removeDot(doc().code, doc().names.short, info, ui.def, id))));
    } else if ((kind === "node" || kind === "frame") && id) {
      const d = calleeDef(id);
      if (d && d !== ui.def) rows.push(item(`Open ${new Namer(doc().code, typedPres(), d).name(d)}`, "goto"));
      const code = view()?.code ?? doc().code;
      if (kind === "frame") rows.push(graphFolded().has(id) ? item("Unfold", "fold", "Show what it holds again") : item("Fold into one box", "fold", "Hide what it holds; its wires in and out stay"));
      if (inlinable(code, id)) rows.push(item((doc().layout.inline ?? []).includes(id) ? "Collapse" : "Show inline", "inline", "Draw the call as the definition's body, in place. A view only."));
      if (kind === "node") rows.push(item("Put a dot on its wire", "dot", "Share this value: a dot you can wire to other inputs", why(() => T.addDot(doc().code, doc().names.short, info, ui.def, id))));
      // A step of an action gets a step before it, not a value (QA8 M1).
      // So does a function's whole body that is one action (E190).
      const oneAction = kind === "node" && !stepRows(id).length && T.addActionStep(doc().code, doc().names.short, info, id).ok;
      if (kind === "node" && (stepRows(id).length || oneAction)) rows.push(item("Add a step before this…", "step-before", "A new step (a hole to fill) just before this one, done before it", why(() => T.addActionStep(doc().code, doc().names.short, info, stepAt(id)))));
      else if (kind === "node") rows.push(item("Add a value before this…", "add-before", "A new named value (a hole to fill), put before this so that this, and everything after it here, can use it. Inside a case of a match, it goes at the start of that case", why(() => T.addStep(doc().code, doc().names.short, info, ui.def, id))));
      // Its place in a list, or among a + b + c's inputs.
      const inRow = T.rowOfItem(doc().code, id), own = T.rowAt(doc().code, id);
      if (inRow) {
        const w = inRow.row.kind === "list" ? "item" : "input", last = inRow.at === inRow.row.items.length - 1;
        rows.push(item(`Add an ${w} after this…`, "row-after", "A new hole just after it, to fill"),
          item("Move it earlier", "row-earlier", "Swap it with the one before", inRow.at ? undefined : "it's first already"),
          item("Move it later", "row-later", "Swap it with the one after", last ? "it's last already" : undefined),
          item(`Take it out of the ${inRow.row.kind === "list" ? "list" : "call"}`, "row-out", "The rest close up"));
      }
      if (own) rows.push(item(`Add ${own.kind === "list" ? "an item" : "an input"} at the end…`, "row-end", "A new hole at the end, to fill"));
      if (doc().code.nodes[id] && doc().code.nodes[id].kind !== "hole" && !doc().code.defs.includes(id)) rows.push(item("Replace with…", "replace", "Pick what goes here instead, from the palette"));
      // In the graph a wrap is a node put on the wire out of this one; in the
      // text it reads as wrapping (Ersagun 2026-10-28).
      if (wrappable(id)) rows.push(inGraph ? item("Insert a node after it…", "wrap", "Pick a call from the palette: this node's value goes into one of its inputs, and its result goes on to wherever this node's value went")
        : item("Wrap in…", "wrap", "Put it inside a call or a function from the palette: it becomes one of its inputs"));
      if (doc().code.nodes[id] && doc().code.nodes[id].kind !== "hole") rows.push(item("Clear it (leave a hole)", "clear", "A hole of the same type stays in its place"));
      if (doc().code.nodes[id] && doc().code.nodes[id].kind !== "hole") rows.push(item("Delete it", "delete", "Only this node: a hole stays in its place, and what's wired into it is kept, loose"));
      const n = doc().code.nodes[id];
      if (isCall(n) && doc().code.nodes[n.fn].kind !== "lambda") rows.push(item("Change the function…", "swap", "Keep its inputs and pick another function that takes them"));
      // Turn a call around (E168): an input swaps sides with the result.
      const turn = isCall(n) ? T.turnable(doc().code, id) : null;
      const pName = (p: Id) => names[p] ?? "it";
      // Only the inputs that can stand for the result (I129).
      if (turn) turn.params.forEach((p, k) => T.turnMismatch(doc().code, names, info, id, k) || rows.push(item(`Work out ${pName(p)} from the result`, `turn-${k}`, `Turn it around: what goes into ${pName(p)} becomes the result given, and the node gives ${pName(p)} instead. Changes the code; Undo puts it back`, why(() => T.turnAround(doc().code, doc().names.short, info, id, k)))));
      if (isUse(n)) rows.push(item("Use it forwards", "turn-back", "The call again: the result given goes back into the input it works out", why(() => T.turnBack(doc().code, doc().names.short, info, id))));
      if (kind === "node") rows.push(...stepRows(id));
      // Cases that share this value, read once as the otherwise: each can
      // have its own (BACKLOG I117); an edit here is otherwise made in all.
      if (kind === "node") for (const [i, c] of T.sharedCases(doc().code, doc().names.short, info, id).slice(0, 8).entries())
        rows.push(item(`Give ${c.label} its own body`, `own-case-${i}`, `Only ${c.label}: a hole to fill there, the other cases keep this value`));
      if (kind === "node" && T.simplify(doc().code, doc().names.short, info, id)?.ok) rows.push(item("Simplify", "simplify", "The same meaning, written shorter: one list instead of append"));
      if (kind === "frame") rows.push(item("Tidy what's inside", "tidy-frame", "Space out the nodes in this frame"));
      if (kind === "node" && n?.kind === "match" && (doc().layout.tree ?? []).includes(id)) rows.push(item("Draw as rows of patterns", "tree", "One row per case, however deep: [date, account, cents, memo], as the text reads it"));
      else if (kind === "node" && n?.kind === "match" && flattened(matchRows(doc().code, info, n))) rows.push(item("Draw as nested matches", "tree", "The decision tree as it is stored: one match per level, to see the order it decides in"));
      // Any function inside a definition can become one in the side menu
      // (E164, Ersagun 2026-11-01).
      if (kind === "frame" && n?.kind === "lambda" && (doc().code.nodes[ui.def] as { body?: Id } | undefined)?.body !== id)
        rows.push(item("Make it a definition", "lambda-def", "This function as a definition of its own, in the side menu: what it uses from around it becomes its first inputs. Changes the code; Undo puts it back", why(() => T.liftToDefinition(doc().code, doc().names.short, info, ui.def, id))));
      if (kind === "frame" && doc().layout.groups?.[id]) {
        const members = doc().layout.groups![id];
        rows.push(item("Make it a function", "group-fn", "A function, part, of what comes in, called right here: name it, fold it, reuse it. Changes the code; Undo puts it back", why(() => T.makeFunction(doc().code, doc().names.short, info, ui.def, members))));
        rows.push(item("Make it a definition", "group-def", "The same function, as a definition of its own in the side menu, called right here. Changes the code; Undo puts it back", why(() => T.definitionFrom(doc().code, doc().names.short, info, ui.def, members))));
        rows.push(item("Ungroup", "ungroup", "Take the frame away: what it holds stays where it is"));
      }
      if (inGraph) rows.push(item("Back to the automatic place", "reset-one", picked.length > 1 ? "Forget where the picked nodes were dragged: back where Tidy everything puts them" : "Forget where it was dragged: back where Tidy everything puts it"));
      if (inGraph) rows.push(item(picked.includes(id) ? "Unpick" : "Pick", "pick", "Add it to the picked nodes (shift-click does the same): picked nodes move, tidy and become a function together. A plain click only selects it, to show it in the side panel"));
    }
    // The Blocks pane has no picking: a part made a function or a
    // definition takes it with everything written inside it, and a function
    // written in place can be made a definition, as from its frame in the
    // graph (E208).
    if (kind === "node" && !inGraph && id) {
      const members = partCalls(id);
      if (members.length) rows.push(h("div", { class: "ctx-sep" }),
        item("Make it a function", "part-fn", "This part and everything in it become a function of the values it takes in, called right here. Changes the code; Undo puts it back", why(() => T.makeFunction(doc().code, doc().names.short, info, ui.def, members))),
        item("Make it a definition", "part-def", "The same function, as a definition of its own in the side menu, called right here. Changes the code; Undo puts it back", why(() => T.definitionFrom(doc().code, doc().names.short, info, ui.def, members))));
      if (doc().code.nodes[id]?.kind === "lambda" && (doc().code.nodes[ui.def] as { body?: Id } | undefined)?.body !== id)
        rows.push(item("Make it a definition", "lambda-def", "This function as a definition of its own, in the side menu: what it uses from around it becomes its first inputs. Changes the code; Undo puts it back", why(() => T.liftToDefinition(doc().code, doc().names.short, info, ui.def, id))));
    }
    if (kind !== "hole" && inGraph) {
      rows.push(h("div", { class: "ctx-sep" }));
      if (picked.length > 1) rows.push(item(`Tidy the ${picked.length} picked`, "tidy-picked", "Space out only the picked nodes: no overlaps, off the wires"));
      // Make it a function, on what's picked or the group this node is in:
      // the same one action wherever a set of nodes is (Ersagun 2026-10-27:
      // "I can't find a Make it a function option").
      // Both are on every node's menu, so they can be found: they take the
      // picked nodes, the group, or just this node (Ersagun 2026-10-27).
      const set = id ? fnSet(id, picked) : null;
      if (set && kind !== "frame") {
        rows.push(item("Make it a function", "picked-fn", `${set.what} (shift-click to pick more) become a function of the values they take in, called right here; then you can name it and use it elsewhere. Changes the code; Undo puts it back`, why(() => T.makeFunction(doc().code, doc().names.short, info, ui.def, set.members))));
        rows.push(item("Make it a definition", "picked-def", `${set.what}: a function as above, but a definition of its own in the side menu, called right here. Changes the code; Undo puts it back`, why(() => T.definitionFrom(doc().code, doc().names.short, info, ui.def, set.members))));
        if (!set.group) rows.push(item("Group into one box", "group-picked", `${set.what} (shift-click to pick more): drawn as one closed box that lists what it holds. Only the drawing changes; open or ungroup it from its menu`, groupable(set.members)));
      }
      const bs = bindersOf(ui.def), allOn = bs.length > 0 && bs.every(isNamed);
      rows.push(allOn ? item("Show every value as wires", "named-none", "Wires from each let to every use, instead of let and get nodes")
        : item("Show every value as let and get nodes", "named-all", "A let node where each value is bound and a small get node at each use: no long wires", bs.length ? undefined : "it has no values to show"));
      rows.push(item("Tidy everything", "tidy-all", "Lay it all out afresh, the same every time: columns from the inputs to the result, each call's inputs in the order of its ports and the call centred on them (the layout's sources are in Credits), folded frames as one box"));
      rows.push(item("Fit", "fit", "Zoom so the whole definition shows"));
    }
    // Nodes picked: what's done with them comes first, not below the fold
    // of a menu that scrolls (Ersagun 2026-10-27: "No such options").
    if (picked.length) {
      const first = rows.filter((r) => ["picked-fn", "picked-def", "group-picked"].includes(r?.dataset.menu ?? ""));
      rows.splice(0, rows.length, ...first, h("div", { class: "ctx-sep" }), ...rows.filter((r) => !first.includes(r)));
    }
    // Kept on the screen: at most as tall as its CSS lets it be (440px, then it scrolls).
    const tall = kind === "hole" ? 420 : Math.min(440, 16 + rows.length * 58);
    const left = Math.max(8, Math.min(m.x + 10, window.innerWidth - 330)), top = Math.max(8, Math.min(m.y + 10, window.innerHeight - tall - 8));
    return h("div", { class: "ctx-menu", role: "menu", style: `left:${left}px;top:${top}px` }, ...rows);
  }

  function menuAction(act: string, target: Id | undefined) {
    const info = typesOf();
    const m = ui.menu;
    ui.menu = null;
    if (!info) return render();
    const forget = (keys: Id[]) => {
      const at = { ...(doc().layout.at ?? {}) };
      for (const k of keys) delete at[lkey(k)];
      commit({ layout: { ...doc().layout, at } }, ["layout.json"], "Back to the automatic place. Only the layout changed.");
    };
    const own = /^own-case-(\d+)$/.exec(act);
    if (own && target) { const c = T.sharedCases(doc().code, doc().names.short, info, target)[+own[1]]; if (c) applyT(T.ownBody(doc().code, doc().names.short, info, c)); return; }
    const turn = /^turn-(\d+)$/.exec(act);
    if (turn && target) { applyT(T.turnAround(doc().code, doc().names.short, info, target, +turn[1])); return; }
    switch (act) {
      case "add": case "add-before": {
        // On the graph's canvas a new value is a loose part, where you clicked
        // (NODE-EDITOR.md "Loose parts", rule 7): no step, no name.
        if (act === "add" && m && !m.blocks) {
          const x = newLoose(doc().code, doc().loose ?? {}, ui.def);
          ui.selected = x.hole;
          setReveal((id) => id === x.hole || id === x.def);
          commit({ code: x.code, loose: x.of, home: doc().home ?? {}, layout: { ...doc().layout, at: { ...(doc().layout.at ?? {}), [lkey(x.def)]: { x: Math.round(m.world.x), y: Math.round(m.world.y) } } } },
            ["drafts.json", "layout.json"], "Added a loose value: fill its hole, then drag its output onto an input. Until then it's kept apart, as a draft.");
          return paletteFor(x.hole, m);
        }
        const r = T.addStep(doc().code, doc().names.short, info, ui.def, act === "add-before" ? target : undefined);
        if (!r.ok || !m) return void applyT(r);
        const hole = r.select!, w = m.world;
        ui.selected = hole;
        setReveal((id) => id === hole || id === r.dot);
        // From the graph's canvas the new node sits where you clicked; from
        // the blocks it has no place to keep, so the layout places it.
        const placed = m.blocks ? doc().layout : { ...doc().layout, at: { ...(doc().layout.at ?? {}), [lkey(hole)]: { x: Math.round(w.x), y: Math.round(w.y) }, [lkey(r.dot!)]: { x: Math.round(w.x) + 110, y: Math.round(w.y) + 6 } } };
        commit({ code: r.code, names: { ...doc().names, short: r.names }, layout: placed },
          ["code.json", "names.short.json", ...(placed === doc().layout ? [] : ["layout.json"])], m.blocks ? `Added a value ${act === "add" ? "as the first step" : "before this, so this and what comes after it can use it"}: fill its hole, then use it by name.` : r.note);
        return paletteFor(hole, m);
      }
      case "named": return toggleNamed(target!);
      case "named-all": return allNamed(true);
      case "named-none": return allNamed(false);
      case "fold": return toggleFolded(target!);
      case "name": { select(target!); document.getElementById("f-name")?.focus(); return; }
      case "undot": return void applyT(T.removeDot(doc().code, doc().names.short, info, ui.def, target!));
      case "goto": { const d = calleeDef(target!); if (d) openDef(d); return; }
      case "inline": return toggleInline(target!);
      case "dot": return void applyT(T.addDot(doc().code, doc().names.short, info, ui.def, target!));
      case "clear": return void applyT(T.toHole(doc().code, doc().names.short, info, target!));
      case "step-before": {
        const r = T.addActionStep(doc().code, doc().names.short, info, stepAt(target!));
        if (!applyT(r) || !r.ok || !m) return;
        return paletteFor(r.select!, m);
      }
      case "step-earlier": case "step-later": return runTop(info, Top.moveStep(doc().code, doc().names.short, stepAt(target!), act === "step-earlier" ? -1 : 1));
      case "simplify": return void applyT(T.simplify(doc().code, doc().names.short, info, target!) ?? { ok: false, reason: "nothing to simplify" });
      case "delete": return void applyT(T.deleteOne(doc().code, doc().names.short, info, ui.def, doc().loose ?? {}, doc().home ?? {}, target!));
      case "wrap": {
        const kept = doc().code;
        const r = T.toHole(doc().code, doc().names.short, info, target!);
        const inGraph = !!m && !m.blocks;
        if (!applyT(r.ok ? { ...r, note: inGraph ? "Pick the node to insert after it: a call takes it as one of its inputs, a new function as its body. Escape or Undo puts it back."
          : "Pick what to wrap it in: a call takes it as one of its inputs, a new function as its body. Escape or Undo puts it back." } : r)) return;
        setSwapped({ hole: target!, at: undo.length });
        setWrapping({ hole: target!, kept, info, graph: inGraph });
        if (m) { ui.menu = { ...m, target: { kind: "hole", id: target! } }; render(); document.getElementById("m-query")?.focus(); }
        else { ui.selected = target!; render(); document.getElementById("f-query")?.focus(); }
        return;
      }
      case "swap": case "replace": {
        // Change the function: the function becomes a hole and the inputs stay
        // where they are, so the palette offers what takes them. Replace with:
        // the part itself becomes the hole, and the palette offers what fits.
        const fn = act === "swap" ? (doc().code.nodes[target!] as Call).fn : target!;
        const r = T.toHole(doc().code, doc().names.short, info, fn);
        const note = act === "swap" ? "The function is a hole now and its inputs stayed: pick another from the palette. Escape puts it back." : "Pick what goes here from the palette. Escape or Undo puts back what was here.";
        if (!applyT(r.ok ? { ...r, note } : r)) return;
        setSwapped({ hole: fn, at: undo.length });
        if (m) { ui.menu = { ...m, target: { kind: "hole", id: fn } }; render(); document.getElementById("m-query")?.focus(); }
        // From the call's panel: the hole is selected, so the panel is its palette.
        else { ui.selected = fn; render(); document.getElementById("f-query")?.focus(); }
        return;
      }
      case "row-after": case "row-earlier": case "row-later": case "row-out": case "row-end": {
        const inRow = T.rowOfItem(doc().code, target!), own = T.rowAt(doc().code, target!), sh = doc().names.short;
        const r = act === "row-end" ? own && T.addItem(doc().code, sh, info, own, own.items.length)
          : !inRow ? null
          : act === "row-after" ? T.addItem(doc().code, sh, info, inRow.row, inRow.at + 1)
          : act === "row-out" ? T.removeItem(doc().code, sh, info, inRow.row, inRow.at)
          : T.moveItem(doc().code, sh, info, inRow.row, inRow.at, act === "row-earlier" ? -1 : 1);
        if (!r || !applyT(r)) return;
        // A new item is a hole: its menu is the palette, where the old one was.
        if ((act === "row-after" || act === "row-end") && m && r.ok && r.select) { ui.menu = { ...m, target: { kind: "hole", id: r.select } }; render(); document.getElementById("m-query")?.focus(); }
        return;
      }
      case "pick": { graph()?.pick(target!); ui.menu = null; return render(); }
      case "tidy-all": return graph()?.tidy(null);
      case "tidy-picked": return graph()?.tidy(graph()!.picked());
      case "group-picked": return groupPicked(fnSet(target!, graph()?.picked() ?? [])?.members ?? []);
      case "ungroup": return ungroup(target!);
      case "group-fn": return groupToFunction(info, target!);
      case "group-def": return groupToFunction(info, target!, true);
      case "lambda-def": return applyT(T.liftToDefinition(doc().code, doc().names.short, info, ui.def, target!));
      case "turn-back": return applyT(T.turnBack(doc().code, doc().names.short, info, target!));
      case "picked-def": {
        const set = fnSet(target!, graph()?.picked() ?? []);
        if (!set) return;
        if (set.group) return groupToFunction(info, set.group, true);
        graph()?.unpickAll();
        return applyT(T.definitionFrom(doc().code, doc().names.short, info, ui.def, set.members));
      }
      case "part-fn": return applyT(T.makeFunction(doc().code, doc().names.short, info, ui.def, partCalls(target!)));
      case "part-def": return applyT(T.definitionFrom(doc().code, doc().names.short, info, ui.def, partCalls(target!)));
      case "picked-fn": {
        const set = fnSet(target!, graph()?.picked() ?? []);
        if (!set) return;
        if (set.group) return groupToFunction(info, set.group);
        graph()?.unpickAll();
        return applyT(T.makeFunction(doc().code, doc().names.short, info, ui.def, set.members));
      }
      case "tree": {
        const now = doc().layout.tree ?? [], on = now.includes(target!);
        return commit({ layout: { ...doc().layout, tree: on ? now.filter((x) => x !== target) : [...now, target!] } }, ["layout.json"],
          on ? "Drawn as rows of patterns, as the text reads it. Only the layout changed." : "Drawn as the nested matches it is stored as. Only the layout changed.");
      }
      case "tidy-frame": return graph()?.tidy([target!]);
      case "reset-one": { const p = graph()?.picked() ?? []; return forget(p.length > 1 ? graph()!.expand(p) : graph()?.expand([target!]) ?? [target!]); }
      case "fit": { render(); graph()?.fit(); return; }
    }
    render();
  }

  return { graphMenu: menuFor, menuAction };
}
