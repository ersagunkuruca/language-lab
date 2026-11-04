// The palette (split out of main.ts, E228l): what fits a hole, found a
// frame after the hole is drawn, its rows labelled and ordered, a search
// by name, symbol, other names and comments, and what's typed read as a
// value once typing pauses. What it reads of the editor comes through
// `PaletteHost`.
import { isCall, subtree, type Code, type Id, type NodeOf } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import { showIn, type Type } from "../ters/src/lang/types.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import * as T from "./typed.ts";
import { h } from "./dom.ts";
import type { Doc, UI } from "./main.ts";

// With what its type variables stand for: add is (a, a) -> a where a is a
// number type, not any a.
export const typeName = (info: T.Info, t: Type, names: Names) => showIn(t, names, info.subst);

export interface PaletteHost {
  doc(): Doc;
  ui: UI;
  // Do an edit that was checked (main.ts applyT).
  applyT(e: T.LooseEdit): boolean;
  render(): void;
  // The definitions whose type is held while they have a hole (E179).
  held(): Record<Id, unknown>;
  heldReason(reason: string): string;
  loosenButton(dname: string): HTMLElement;
  makeNamed(info: T.Info, name: string): HTMLElement;
  implementButton(info: T.Info, iface: Id, type: Type, label: string): HTMLElement;
  ownDefs(): Id[];
  shownNames(): Names;
  words(type: Id): { effect: boolean; case: string; cases: string; field: string; fields: string };
}

export function palette(host: PaletteHost) {
  const { doc, ui, applyT, render, held, heldReason, loosenButton, makeNamed, implementButton, ownDefs, shownNames, words } = host;
  const BASE = LIBRARY.code;
  const node = (id: Id) => doc().code.nodes[id];

  function fillLabel(f: T.Filling, info: T.Info, names: Names): [string, string, string] {
    const nm = (id: Id) => names[id] ?? id;
    switch (f.kind) {
      case "ref": return [nm(f.target), typeName(info, f.type, names), node(f.target)?.kind === "binder" ? "in scope" : node(f.target)?.kind === "variant" ? "constructors" : info.subst.resolve(f.type).t === "fn" ? "functions, not called" : "definitions"];
      case "call": return [`${nm(f.target)}(${Array.from({ length: f.arity }, () => "□").join(", ")})`, typeName(info, f.type, names), "calls"];
      case "lit": return [f.of === "number" ? "a number" : f.of === "int" ? "an integer" : "a text", f.of === "number" ? "Float64" : f.of === "int" ? "Int" : "Text", "literals"];
      case "lambda": return [`(${Array.from({ length: f.arity }, () => "□").join(", ")}) => □`, "a function you write here", "new function"];
      case "use": {
        const d = node(f.target) as NodeOf<"def">, ps = (node(d.body!) as NodeOf<"lambda">).params;
        return [`${d.results!.map(nm).join(", ")} = ${nm(f.target)}(${ps.filter((q) => !d.results!.includes(q)).map(() => "□").join(", ")})`, `its results, named, in what you write next`, "results"];
      }
      // A record with one field new (E214): machine with pc changed.
      case "set": return [`${nm(f.on)} with ${nm(f.field)} changed`, `set((…) ↦ ….${nm(f.field)}, ${nm(f.on)}, □): the same ${nm(f.type)}, only its ${nm(f.field)} new`, "one field changed"];
      // A match on values (E225): match op · by value.
      case "values": return [`match ${nm(f.on)} · by value`, `a case per ${f.type === "type.string" ? "Text" : nm(f.type)} value you write, then otherwise`, "case analysis"];
      default: return words(f.type).effect
        ? [`handle ${nm(f.type)} in □`, `one case per operation of ${nm(f.type)}, on the computation you give next`, "case analysis"]
        : [`${f.kind} ${f.on ? nm(f.on) : "□"} · ${nm(f.type)}`, `one case per ${nm(f.type)}${f.kind === "fold" ? ", with each part already folded" : ""}${f.on ? "" : ", on a value you give next"}`, "case analysis"];
    }
  }

  // The symbols people type for the builtins with word names.
  const SYMBOLS: Record<string, string[]> = {
    add: ["+"], subtract: ["-", "−"], negate: ["-", "−"], multiply: ["*", "·", "×"], divide: ["/", "÷"], power: ["^", "**"],
    "square root": ["√"], sqrt: ["√"], "less than": ["<"], equal: ["=", "=="], and: ["&&"], or: ["||"], not: ["!"], mod: ["%"], "join text": ["++"],
  };

  // Names other languages use, so a search by what something does finds it:
  // insert is put, lookup is value at (BACKLOG E136).
  const ALSO: Record<string, string[]> = {
    put: ["insert", "set", "update", "store"], "value at": ["lookup", "get", "find", "fetch"], "has key": ["contains", "member", "includes"],
    "remove key": ["delete", "erase"], "keys of": ["keys"], "values of": ["values"], "map size": ["size", "count", "len"], "set size": ["size", "count", "len"],
    length: ["size", "count", "len"], keep: ["filter", "where", "select"], map: ["transform", "convert each"], "for each": ["loop", "iterate", "foreach"],
    append: ["concat", "concatenate"], "join text": ["concat", "concatenate"], "add item": ["insert", "push"], "has item": ["contains", "member", "includes"],
    "remove item": ["delete", "erase"], "items of": ["elements", "to list"], smaller: ["min", "minimum"], larger: ["max", "maximum"],
    show: ["to string", "tostring", "format", "string of"], print: ["log", "output", "write", "echo", "console"], attempt: ["try", "catch"],
    sort: ["order"], sum: ["total", "add up"], "empty map": ["new map", "dictionary", "dict", "hash"], "empty set": ["new set"],
    sqrt: ["square root", "root"], "square root": ["sqrt", "root"], abs: ["absolute value", "magnitude", "modulus"], floor: ["round down"],
    log: ["ln", "natural log", "logarithm"], exp: ["exponential", "e to the"], sin: ["sine"], cos: ["cosine"], tan: ["tangent"],
    power: ["pow", "exponent", "raise to"], mod: ["remainder", "modulo"], negate: ["minus", "opposite"],
  };

  // What fits a hole, once per check of the code: the right-click menu and
  // the side panel show the same palette, and typing in either redraws both.
  const fitting = new WeakMap<T.Info, Map<Id, T.Filling[]>>();
  function fillingsAt(info: T.Info, hole: Id): T.Filling[] {
    let m = fitting.get(info);
    if (!m) fitting.set(info, (m = new Map()));
    if (!m.has(hole)) m.set(hole, T.fillings(doc().code, info, hole));
    return m.get(hole)!;
  }

  // Why nothing with effects goes in a hole that allows none, so a search
  // for print there says so instead of finding nothing (BACKLOG E123).
  function pureHole(info: T.Info, hole: Id): string {
    const hi = info.holes.get(hole), row = hi && info.subst.resolveRow(hi.row);
    if (!row || row.effs.length || row.tail !== null) return "";
    return hi.group.some((d) => doc().loose?.[d])
      ? "A loose part is a value of its own, and a value can't have effects, so print, die() and the like aren't offered. Fill the hole where the part will be used, or wire it in first."
      : "This hole can't have effects (its definition is a value, or its type says none), so print, die() and the like aren't offered.";
  }

  // How often each thing is referred to in the program, once per version.
  const uses = new WeakMap<Code, Map<Id, number>>();
  function usesIn(code: Code): Map<Id, number> {
    let m = uses.get(code);
    if (!m) {
      m = new Map();
      // The program's own uses: the library's (std's representations call
      // extended less, add, … hundreds of times) put those first in a new
      // program's palette (I141).
      for (const d of ownDefs()) for (const x of subtree(code, d)) { const n = code.nodes[x]; if (n?.kind === "ref") m.set(n.target, (m.get(n.target) ?? 0) + 1); }
      uses.set(code, m);
    }
    return m;
  }

  const STARTERS = ["print", "show", "map", "keep", "fold", "for each", "length", "range", "join", "sum", "read file", "write file", "read line", "first", "item at", "sort", "count"];
  const starter = (name: string) => { const i = STARTERS.indexOf(name); return i < 0 ? STARTERS.length : i; };
  const labels = new WeakMap<T.Filling, { key: Names; l: [string, string, string] }>();
  let finding: { info: T.Info; hole: Id } | null = null;
  function fillPalette(hole: Id, info: T.Info, names: Names, field = "f-query"): HTMLElement {
    const q = ui.query.trim().toLowerCase();
    // Most often wanted first; a function passed along uncalled last, since
    // at a hole of any type it would otherwise come before calling it.
    // Where a call's function goes (Change the function…), functions are
    // what's wanted, and they will be called.
    const head = Object.values(doc().code.nodes).some((n) => isCall(n) && n.fn === hole);
    // Where a function goes, writing one here is often what's meant.
    // What a representation is written with (match by, match as written)
    // comes last: it's for writing one, not for a program's values (I141).
    const order = [...(head ? ["functions"] : []), "in scope", "one field changed", "new function", "calls", "constructors", "definitions", "literals", "case analysis", "functions, not called", "for representations"];
    // A row's label, once per filling while the names stay (I135: every key
    // labelled every filling again, a type shown for each).
    const label = (f: T.Filling): [string, string, string] => {
      const was = labels.get(f), key = shownNames();
      const l = was?.key === key ? was.l : fillLabel(f, info, names);
      if ((f.kind === "call" || f.kind === "ref") && f.target.startsWith("builtin.representation.")) l[2] = "for representations";
      if (was?.key !== key) labels.set(f, { key, l });
      return head && l[2] === "functions, not called" ? [l[0], l[1], "functions"] : l;
    };
    // Within a group, what the program calls most comes first: print in a
    // new main, not for each because it's alphabetically early.
    const used = usesIn(doc().code);
    const often = (f: T.Filling) => (f.kind === "call" || f.kind === "ref" ? used.get(f.target) ?? 0 : 0);
    // Then, as in a new program where nothing is called yet, the program's
    // own definitions, then what a program first reaches for, then the rest
    // (E224: a new main listed extended less, extended add and extended
    // negate first of 935 calls).
    const reach = (f: T.Filling) => (f.kind !== "call" && f.kind !== "ref" ? STARTERS.length : !LIBRARY.code.nodes[f.target] && !f.target.startsWith("builtin.") ? -1 : starter(names[f.target] ?? LIBRARY.names[f.target] ?? ""));
    // A hole draws first and lists what fits a moment later, once the frame
    // that shows it is painted: finding it tries every candidate there (a
    // new definition's in physics about 0.8 s, I136; the hole a Delete
    // leaves in Bounce 0.83 s, E201), and it was in the same frame as the
    // edit. Known already (the same version of the code), it's listed at
    // once, and so it is in a menu opened to change something, which is
    // there to show the list.
    const later = field === "f-query" && !fitting.get(info)?.has(hole);
    if (later && (finding?.info !== info || finding.hole !== hole)) {
      const at = (finding = { info, hole }), was = doc();
      const go = () => { if (finding !== at) return; finding = null; if (doc() !== was || (ui.selected !== hole && !document.getElementById(field))) return; fillingsAt(info, hole); render(); };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(go, 0)); else setTimeout(go, 0);
    }
    const all = (later ? [] : fillingsAt(info, hole)).map((f) => ({ f, l: label(f) })).sort((a, b) => order.indexOf(a.l[2]) - order.indexOf(b.l[2]) || often(b.f) - often(a.f) || reach(a.f) - reach(b.f));
    // Of two meanings of one name in a group, the Int one first: positions
    // and counts are Ints, so `range` for a list's indices is range at Int.
    const base = (x: (typeof all)[number]) => (x.f.kind === "call" || x.f.kind === "ref" ? `${x.l[2]}\n${x.l[0].split("(")[0]}` : null);
    const isInt = (x: (typeof all)[number]) => (x.f.kind === "call" || x.f.kind === "ref") && x.f.target.startsWith("builtin.int.");
    const ints = new Set(all.filter(isInt).map(base));
    for (let i = 0; i < all.length; i++) {
      const k = base(all[i]);
      if (!k || !ints.has(k) || isInt(all[i])) continue;
      const j = all.findIndex((y, n) => n > i && isInt(y) && base(y) === k);
      if (j > i) all.splice(i, 0, ...all.splice(j, 1));
    }
    // Console's print performed by name reads, and does, what builtin print
    // does (L145): one row for both (E184).
    const plain = new Set(all.filter((x) => !((x.f.kind === "call" || x.f.kind === "ref") && x.f.target.startsWith("effect."))).map((x) => `${x.l[0]}\n${x.l[1]}`));
    for (let i = all.length - 1; i >= 0; i--) { const x = all[i]; if ((x.f.kind === "call" || x.f.kind === "ref") && x.f.target.startsWith("effect.") && plain.has(`${x.l[0]}\n${x.l[1]}`)) all.splice(i, 1); }
    // Rows that would read the same (show(□) for a Float64, an Int, anything)
    // say what each of their holes takes: show(□: Int).
    const seen = new Map<string, number>();
    for (const { l } of all) seen.set(l[0], (seen.get(l[0]) ?? 0) + 1);
    for (const x of all) {
      const t = x.f.kind === "call" ? info.subst.resolve(x.f.type) : null;
      if (seen.get(x.l[0])! > 1 && x.f.kind === "call" && t?.t === "fn" && t.params.length)
        x.l = [`${names[x.f.target] ?? x.f.target}(${t.params.map((p) => `□: ${typeName(info, p, names)}`).join(", ")})`, x.l[1], x.l[2]];
    }
    // A definition of the program's own named like the library's (values
    // of) says it's its own, beside the library's (E182).
    const alike = new Map<string, Set<Id>>();
    const called = (x: (typeof all)[number]) => (x.f.kind === "call" || x.f.kind === "ref" ? names[x.f.target] : undefined);
    for (const x of all) { const n = called(x); if (n && (x.f.kind === "call" || x.f.kind === "ref")) alike.set(n, (alike.get(n) ?? new Set()).add(x.f.target)); }
    for (const x of all) { const n = called(x); if (n && (x.f.kind === "call" || x.f.kind === "ref") && alike.get(n)!.size > 1 && doc().code.defs.includes(x.f.target) && !BASE.nodes[x.f.target]) x.l = [x.l[0], `this program's own · ${x.l[1]}`, x.l[2]]; }
    // Searching: names that are the text, then start with it, then have a
    // word starting with it, then contain it, and only then entries whose
    // type or description mentions it. Within each, the usual order.
    // An operator's symbol finds it too: + is add.
    // Then what it is called elsewhere (insert finds put), and last a word
    // of its comment (key finds value at: "What key holds").
    const symbol = (l: [string, string, string]) => SYMBOLS[l[0].replace(/\(.*$/, "")]?.includes(q) ?? false;
    const also = (l: [string, string, string]) => (q.length > 1 ? ALSO[l[0].replace(/\(.*$/, "")]?.find((w) => w.startsWith(q)) : undefined);
    const note = (f: T.Filling) => (q.length > 2 && (f.kind === "call" || f.kind === "ref") ? doc().comments[f.target] ?? LIBRARY.comments[f.target] ?? "" : "");
    const inNote = (f: T.Filling) => { const n = note(f).toLowerCase(); return q.includes(" ") ? n.includes(q) : n.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q)); };
    const rank = (x: (typeof all)[number]) => {
      const name = x.l[0].toLowerCase();
      // A value of the name before a call of it: unit, the case, before
      // unit(□), a function of the same name (E188). A function itself still
      // comes after its call: random() before random.
      return name === q && !/->/.test(x.l[1]) ? -1 : name.startsWith(`${q}(`) || symbol(x.l) ? 0 : name.startsWith(q) ? 1 : name.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q)) || also(x.l) ? 2 : name.includes(q) ? 3 : x.l.some((s) => s.toLowerCase().includes(q)) ? 4 : 5;
    };
    // Found by another name or by its comment, the row says which.
    const found = (x: (typeof all)[number], r: number): [string, string, string] => {
      const w = r === 2 && !x.l[0].toLowerCase().split(/[^\p{L}\p{N}]+/u).some((v) => v.startsWith(q)) ? also(x.l) : undefined;
      return w ? [x.l[0], `elsewhere called ${w} · ${x.l[1]}`, x.l[2]] : r === 5 ? [x.l[0], note(x.f).split(/(?<=\.)\s/)[0], x.l[2]] : x.l;
    };
    const shown = !q ? all : all.filter((x) => symbol(x.l) || also(x.l) || x.l.some((s) => s.toLowerCase().includes(q)) || inNote(x.f)).map((x) => { const r = rank(x); return { ...x, l: found(x, r), r }; }).sort((a, b) => a.r - b.r);
    // Unsearched, the first 40 (the rest are a search away); searched, all.
    const cap = q ? shown.length : 40;
    const input = h("input", { id: field, type: "search", value: ui.query, autocomplete: "off", spellcheck: "false", "aria-label": "Search what fits this hole", "aria-controls": `${field}-list`, placeholder: later ? "Working out what fits here…" : `${all.length} things fit here. Search…` }) as HTMLInputElement;
    // Typing redraws the list on every key, but what's typed is read (a
    // whole check per reading) only once typing pauses (E173: 81 keys took
    // 114 s). Enter reads it at once.
    const again = (read: boolean) => {
      readingPaused = !read;
      const cur = (document.getElementById(field) as HTMLInputElement | null) ?? input;
      const at = cur.selectionStart, had = document.activeElement === cur;
      render();
      const next = document.getElementById(field) as HTMLInputElement | null;
      if (had) next?.focus();
      if (next && at !== null) next.setSelectionRange(at, at);
    };
    input.addEventListener("input", () => {
      ui.query = input.value;
      clearTimeout(typingTimer);
      again(false);
      // The field is drawn again on each key: the one on the page now.
      typingTimer = setTimeout(() => { const cur = document.getElementById(field) as HTMLInputElement | null; if (cur && cur.value === ui.query) again(true); else readingPaused = false; }, TYPING_PAUSE);
    });
    // What's typed may itself be a value: 3, "hi", [3, 1, 2], circle(2).
    // Offered first, and only if it fits. A bare case name is already listed.
    // Read once per program, hole and text: a redraw reads it from the cache.
    const pending = readingPaused;
    const typed = q && !all.some(({ l }) => l[0].toLowerCase() === q) ? (pending ? peekTyped(info, hole, ui.query) : readTyped(info, hole, ui.query)) ?? null : null;
    const value = typed?.ok ? typed : null;
    const run = (x: (typeof all)[number]) => { ui.query = ""; applyT(T.fill(doc().code, doc().names.short, info, hole, x.f, x.l[0], ui.def)); };
    const runValue = () => { ui.query = ""; applyT(value!); };
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (pending || readingPaused) {
        // Not read yet: read it now, then take the first row, as Enter does.
        clearTimeout(typingTimer);
        ui.query = input.value;
        again(true);
        document.getElementById(field)?.closest(".picker")?.querySelector<HTMLButtonElement>(".palette .opt")?.click();
        return;
      }
      if (value) runValue(); else if (shown[0]) run(shown[0]);
    });
    const list = h("div", { class: "opts palette", id: `${field}-list`, role: "group", "aria-label": "What fits here" });
    if (later) list.append(h("p", { class: "hint" }, "Finding what fits…"));
    if (value?.choices) {
      // A field several types have, on a value nothing has settled: which
      // type's is meant is asked, not picked (E186).
      list.append(h("div", { class: "pal-g" }, "the value typed, read as"), h("p", { class: "hint" }, "More than one type has these fields, and nothing here says which: pick one."));
      for (const c of value.choices) {
        const b = h("button", { class: "opt", type: "button" }, h("span", { class: "opt-l" }, ui.query.trim()), h("span", { class: "opt-d" }, c.label));
        b.addEventListener("click", () => { ui.query = ""; applyT(c.edit); });
        list.append(b);
      }
    } else if (value) {
      const b = h("button", { class: "opt", type: "button" }, h("span", { class: "opt-l" }, ui.query.trim()), h("span", { class: "opt-d" }, "this, written out"));
      b.addEventListener("click", runValue);
      list.append(h("div", { class: "pal-g" }, "the value typed"), b);
    }
    let group = "";
    for (const x of shown.slice(0, cap)) {
      if (x.l[2] !== group) { group = x.l[2]; list.append(h("div", { class: "pal-g" }, group)); }
      const b = h("button", { class: "opt", type: "button" }, h("span", { class: "opt-l" }, x.l[0]), h("span", { class: "opt-d" }, x.l[1]));
      b.addEventListener("click", () => run(x));
      list.append(b);
    }
    if (shown.length > cap) list.append(h("p", { class: "hint" }, `${shown.length - cap} more: type to search them.`));
    const whyKey = `why ${hole} ${ui.query}`, whyRead = () => T.whyNotHere(doc().code, doc().names.short, info, hole, ui.query);
    const why = !later && !shown.length && !value && q ? (pending ? peekCached<string | null>(info, whyKey) : cachedTyped(info, whyKey, whyRead)) ?? pureHole(info, hole) : "";
    // What's typed is refused because its type has no implementation of an
    // interface it needs: say so, and offer to write one (BACKLOG E140).
    const lacks = typed && !typed.ok ? typed.missing : undefined;
    if (lacks) list.append(h("p", { class: "hint" }, `${ui.query.trim()} doesn't fit here: ${typed!.ok ? "" : typed!.reason}.`), h("div", { class: "acts" }, implementButton(info, lacks.iface, lacks.type, `Implement ${names[lacks.iface] ?? "it"} for ${showIn(lacks.type, names, info.subst)}`)));
    // Refused, it says why (E174): the reading's own reason, when the text
    // is an expression or nothing listed matches it.
    else if (typed && !typed.ok && !value && !why && (!shown.length || /[^\p{L}\p{N}_' ]/u.test(q))) {
      // Refused because the definition's type is held while it has a hole:
      // the way out is offered right there (E179).
      const reason = heldReason(typed.reason.replace(/\.$/, ""));
      const loosen = held()[ui.def] && reason !== typed.reason.replace(/\.$/, "") ? h("div", { class: "acts" }, loosenButton(names[ui.def] ?? "It")) : null;
      const missing = /^there's no function named (.+?)(?:;|$)/.exec(typed.reason)?.[1];
      list.prepend(h("p", { class: "hint refused" }, `${ui.query.trim()} doesn't fit here: ${reason}.`), ...(loosen ? [loosen] : []), ...(missing ? [h("div", { class: "acts" }, makeNamed(info, missing))] : []));
    }
    else if (!shown.length && !value && later) list.append(h("p", { class: "hint" }, "Working out what fits here…"));
    else if (!shown.length && !value && pending && q) list.append(h("p", { class: "hint" }, "Reading what's typed…"));
    else if (!shown.length && !value) list.append(h("p", { class: "hint" }, `Nothing that fits matches. ${why || "Values and arithmetic can be typed too: 3, \"text\", [1, 2], x * 2, (x) => x + 1."}`));
    // By keyboard (E231d): Down from the search goes into the list, Up and
    // Down move through it, Home and End to its ends, and Up from its first
    // row back to the search.
    const picker = h("div", { class: "picker" }, input, list);
    picker.addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const opts = [...picker.querySelectorAll<HTMLButtonElement>(".palette .opt")];
      const at = opts.indexOf(document.activeElement as HTMLButtonElement);
      if (e.target === input ? e.key !== "ArrowDown" || !opts.length : at < 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.target === input) return opts[0].focus();
      if (e.key === "ArrowUp" && at === 0) return input.focus();
      opts[e.key === "Home" ? 0 : e.key === "End" ? opts.length - 1 : Math.min(opts.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))].focus();
    });
    return h("div", {}, h("div", { class: "sub-head" }, "Fill · only what type-checks here"), picker);
  }

  // Typed text in the palette, read once (E173): per program, hole, text
  // and definition, so a redraw, a blur or a click elsewhere doesn't read it
  // again. Its checked program (any edit, a type held or let go) or its
  // names changing start a new cache.
  const TYPING_PAUSE = 250;
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  const typedReads = new WeakMap<object, { names: Names; m: Map<string, unknown> }>();
  function cachedTyped<R>(info: T.Info, key: string, read: () => R): R {
    let c = typedReads.get(info);
    if (!c || c.names !== doc().names.short) typedReads.set(info, (c = { names: doc().names.short, m: new Map() }));
    if (!c.m.has(key)) c.m.set(key, read());
    return c.m.get(key) as R;
  }
  let readingPaused = false;
  function peekCached<R>(info: T.Info, key: string): R | undefined {
    const c = typedReads.get(info);
    return c && c.names === doc().names.short ? (c.m.get(key) as R | undefined) : undefined;
  }
  const peekTyped = (info: T.Info, hole: Id, text: string) => peekCached<T.TEdit>(info, `fill ${ui.def} ${hole} ${text}`);
  const readTyped = (info: T.Info, hole: Id, text: string) => cachedTyped(info, `fill ${ui.def} ${hole} ${text}`, () => T.fillValue(doc().code, doc().names.short, info, hole, text, ui.def));

  return { fillPalette, fillingsAt };
}
