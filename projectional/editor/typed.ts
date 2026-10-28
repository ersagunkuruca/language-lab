// The editor's view of typed programs (src/lang/): blocks you click, holes
// that know their type, and the gestures that can't produce a type error.
//
// Every expression is a span with its node id and its inferred type, so the
// type of anything is a hover away. Edits are pure functions here; each is
// checked by re-inferring the whole program and refused if it adds an error.

import type { Code, Id, Node, NodeData, NodeOf } from "../src/model.ts";
import { children, collect, freshId, parentOf, replace, subtree, swapIn } from "../src/model.ts";
import type { Names, Notation, Presentation } from "../src/presentation.ts";
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import { fillings, implementationKey, infer as check, type Filling, type Info } from "../src/lang/infer.ts";
import { isPublished } from "../src/model.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { B } from "../src/prelude.ts";
import { pinsOf, type Pins } from "../src/lang/signatures.ts";
import { dropLoose, setLoose, wireIn } from "./drafts.ts";
import { addVariant, fillHole } from "../src/lang/refactor.ts";
import { ARITH, ASSOCIATIVE, CONS, FALSE, NIL, SIGS, TRUE } from "../src/lang/std.ts";
import { INT, NUMBER, RATIONAL_TYPE, STRING, schemeArith, showIn, showType, type Type } from "../src/lang/types.ts";
import { ratioParts, read as readInt } from "../src/lang/int.ts";
import type { Value } from "../src/lang/run.ts";
import { parseValue } from "../src/lang/values.ts";
import { blocksOf, blocksText, litLabel, type Blk, type Piece } from "../src/lang/render.ts";
import { shape } from "../src/lang/patterns.ts";

type Kid = HTMLElement | string | null | undefined | false;
function h(tag: string, attrs: Record<string, string | boolean | undefined> = {}, ...kids: Kid[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

export const typeOf = (info: Info | null, id: Id, names: Names): string | null => {
  const t = info?.typeOf.get(id);
  return t ? showIn(t, names, info!.subst) : null;
};

// ---------------------------------------------------------------- view

// The pane draws what the blocks text prints (render.ts blocksOf), so the
// two can't drift apart: a piece that stands for a node is a span you can
// click, with its type on hover; a group of lines is a box.
export function renderTyped(code: Code, pres: Presentation, info: Info | null, defId: Id, selected: Id | null, loose?: Record<Id, Id>, groups: Groups = {}, folded: Id[] = []): HTMLElement {
  const errorAt = new Map((info?.errors ?? []).map((e) => [e.id, e.message]));
  const cls = (id: Id | undefined, c: string | undefined) => (id ? `x ${c ?? ""}${selected === id ? " sel" : ""}${errorAt.has(id) ? " err" : ""}` : c);
  const title = (id: Id | undefined, more?: string) => {
    const said = id ? errorAt.get(id) ?? ownTypeOf(id) ?? undefined : undefined;
    return said && more ? `${said}\n\n${more}` : said ?? more;
  };
  // A name of a definition hovers as the definition's own type. Its type
  // here has the caller's effects in its row (range inside a seeded action
  // reads -[Random]->), which reads as if range drew numbers itself; where
  // it's used at other types, those follow, without the caller's effects.
  const ownTypeOf = (id: Id) => {
    const n = code.nodes[id];
    if (n?.kind !== "ref" || !info) return typeOf(info, id, pres.names);
    const own = info.schemes.get(n.target)?.type ?? SIGS[n.target]?.(info.subst.clone());
    const here = typeOf(info, id, pres.names);
    if (!own) return here;
    // A generic one (+ on Float64s) says what it is here too.
    const mine = showType(own, pres.names), bare = (t: string | null) => t?.replace(/ -\[[^\]]*\]->/g, " ->");
    return here && bare(here) !== bare(mine) ? `${mine}\nhere: ${bare(here)}` : mine;
  };
  // What only the pane shows (a name's type, a hole's) is marked aside.
  const piece = (p: Piece): Kid => (typeof p === "string" ? p : h("span", { class: `${cls(p.id, p.cls)}${p.pane ? " aside" : ""}`, "data-id": p.id, title: title(p.id, p.title) }, ...p.kids.map(piece)));
  const draw = (b: Blk): HTMLElement => {
    const g = grouped.get(b);
    if (g) {
      const shut = folded.includes(g), n = blocksText([b]).length;
      const head = h("div", { class: "grp-t", "data-fold": g, title: shut ? "Unfold: show its lines (the graph's group unfolds too)" : "Fold into one line (the graph's group folds too)" },
        `${shut ? "▸" : "▾"} group`, shut ? h("span", { class: "grp-n" }, ` · ${n} line${n === 1 ? "" : "s"}`) : null);
      return h("div", { class: `grp${shut ? " folded" : ""}` }, head, ...(shut || !("kids" in b) ? [] : b.kids.map(draw)));
    }
    if ("line" in b) return h("div", { class: `ln${b.id ? ` ${cls(b.id, b.cls)}` : b.cls ? ` ${b.cls}` : ""}`, "data-id": b.id }, ...b.line.map(piece));
    const c = [b.pad ? "ind" : "", cls(b.id, b.cls) ?? ""].filter(Boolean).join(" ");
    return h("div", { class: c || undefined, "data-id": b.id, style: b.pad && b.pad !== 2 ? `padding-left: ${b.pad * 11}px` : undefined }, ...b.kids.map(draw));
  };
  const grouped = new WeakMap<Blk, Id>();
  return h("div", { class: "typed" }, ...groupBlocks(blocksOf(code, pres, info, defId, { pane: true, loose }), groups, grouped).map(draw));
}

// A group the graph draws (BACKLOG E111) is bracketed in the blocks too
// (E145): the lines that hold its members, from the first to the last, in
// the innermost block that holds them all. A view, like the graph's: the
// code doesn't change, and folding it here folds it there.
export type Groups = Record<Id, Id[]>;
export function groupBlocks(bs: Blk[], groups: Groups, mark: WeakMap<Blk, Id>): Blk[] {
  // A group in a group stands for what it holds.
  const members = (g: Id, seen = new Set<Id>()): Set<Id> => {
    seen.add(g);
    return new Set((groups[g] ?? []).flatMap((m) => (groups[m] && !seen.has(m) ? [...members(m, seen)] : [m])));
  };
  const ids = (b: Blk, out = new Set<Id>()): Set<Id> => {
    if (b.id) out.add(b.id);
    const piece = (p: Piece) => { if (typeof p !== "string") { if (p.id) out.add(p.id); p.kids.forEach(piece); } };
    if ("line" in b) b.line.forEach(piece);
    else b.kids.forEach((k) => ids(k, out));
    return out;
  };
  const wrap = (list: Blk[], g: Id, want: Set<Id>): Blk[] | null => {
    const hits = list.map((b, i) => ([...ids(b)].some((x) => want.has(x)) ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return null;
    const one = list[hits[0]];
    // All in one block, and not the block itself: look inside it.
    if (hits.length === 1 && "kids" in one && !(one.id && want.has(one.id))) {
      const inner = wrap(one.kids, g, want);
      if (inner) return list.map((b, i) => (i === hits[0] ? { ...one, kids: inner } : b));
    }
    const box: Blk = { kids: list.slice(hits[0], hits[hits.length - 1] + 1), pad: 0 };
    mark.set(box, g);
    return [...list.slice(0, hits[0]), box, ...list.slice(hits[hits.length - 1] + 1)];
  };
  // Inner groups first, so an outer one brackets theirs.
  const order = Object.keys(groups).sort((a, b) => members(a).size - members(b).size);
  return order.reduce((acc, g) => wrap(acc, g, members(g)) ?? acc, bs);
}

// ---------------------------------------------------------------- edits

// missing: refused because a type has no implementation of an interface
// the edit needs, so the editor can offer to write one (BACKLOG E140).
export type TEdit = { ok: true; code: Code; names: Names; select?: Id; note: string } | { ok: false; reason: string; missing?: Info["errors"][number]["missing"] };

// Names for messages: the library's and the presentation's, under the
// program's own (which are what edits change and store).
let display: Names = {};
export const setDisplayNames = (n: Names) => { display = n; };

// Accept only if the program has no more type errors than before.
// Every program is checked with the modules' pins, and without offering
// their helpers.
// The program's own pins (signatures.ts) join the modules'; a pin of a
// definition that's gone is dropped.
let programPins: Pins = {};
export const setProgramPins = (p: Pins) => { programPins = p; };
export const infer = (code: Code, names: Names = {}): Info => {
  const own = Object.fromEntries(Object.entries(programPins).filter(([d]) => code.nodes[d]?.kind === "def"));
  return check(code, names, undefined, { pins: { ...LIBRARY.pins, ...own }, hidden: LIBRARY.hidden });
};

// A published definition is named by its content, so it can't change: an
// edit that would change one is refused.
const published = Object.values(LIBRARY.code.nodes).filter((n) => isPublished(n.id));
export function changesPublished(code: Code): Id | null {
  const n = published.find((n) => code.nodes[n.id] !== n && JSON.stringify(code.nodes[n.id]) !== JSON.stringify(n));
  return n ? n.id.split(":")[0] : null;
}

export function guardTyped(before: Info, code: Code, names: Names, select: Id | undefined, note: string): TEdit {
  const lib = changesPublished(code);
  if (lib) return { ok: false, reason: `${names[lib] ?? display[lib] ?? "that"} is published in a module: it is named by what it says, so it can't change` };
  const after = infer(code, { ...display, ...names });
  if (after.errors.length > before.errors.length) { const e = nearest(code, after.errors, select); return { ok: false, reason: e.message, ...(e.missing ? { missing: e.missing } : {}) }; }
  return { ok: true, code, names, select, note };
}

// The error to give as the reason: the one at or inside what the edit put
// in, else at the nearest node around it, else the last. One change can
// set off errors further away too (a unit carried on to where it's added
// to another), but the reader looks where they changed it.
function nearest(code: Code, errors: Info["errors"], at: Id | undefined): Info["errors"][number] {
  if (at && code.nodes[at]) {
    const inside = new Set(subtree(code, at));
    const hit = errors.find((e) => inside.has(e.id));
    if (hit) return hit;
    for (let p = parentOf(code, at); p; p = parentOf(code, p.parent)) {
      const up = errors.find((e) => e.id === p!.parent);
      if (up) return up;
    }
  }
  return errors.at(-1)!;
}

export function fill(code: Code, names: Names, info: Info, hole: Id, f: Filling, label: string, defId?: Id): TEdit {
  const e = fillHole(code, names, hole, f, display);
  // Select the next hole in reading order, so filling goes on where it
  // should: inside what was just placed, else further on, else from the top.
  // A literal stays selected, to type its value.
  const next = defId && f.kind !== "lit" ? nextHole(e.code, defId, hole) : undefined;
  return guardTyped(info, e.code, e.names, next ?? hole, `Filled with ${label}.${defId && f.kind !== "lit" && !next ? " No holes left in this definition." : ""}`);
}

// Fill a hole with a value written out, the way values print: 3, "text",
// [3, 1, 2], circle(2). It becomes the code that builds it (literals and
// constructor calls), type-checked like any other filling. Arithmetic on
// values reads too: 1 + 2 is add(1, 2), and so do the names in scope
// there, the hole's inputs and lets first: x * 2 in double(x). A call
// reads as it prints, sqrt(x + 1), so it takes one fill, not two.
export function fillValue(code: Code, names: Names, info: Info, hole: Id, text: string, defId?: Id): TEdit {
  const all = { ...display, ...names };
  const scope = new Map<string, Id>();
  for (const d of code.defs) if (all[d]) scope.set(all[d], d);
  for (const b of defId ? scopeAt(code, defId, hole) : []) if (all[b]) scope.set(all[b], b);
  const r = typedOut(text, code, all, scope);
  if ("error" in r) return { ok: false, reason: r.error };
  // A name alone is already in the palette's list.
  if ("ref" in r) return { ok: false, reason: "a name alone is listed already" };
  // A whole number where an Int goes is an Int: 0 in slice's position. And
  // where a Rational goes, a whole number or one over another is a
  // fraction: 1/2 is one half, not 0.5.
  const whole = (v: Value): boolean => typeof v === "number" ? Number.isInteger(v) : typeof v === "object" && v !== null && "tag" in v && v.fields.some(whole);
  const wholes = (t: Typed): boolean => "value" in t ? whole(t.value) : "args" in t ? t.args.some(wholes) : "body" in t && wholes(t.body);
  // A name several things share (show, length) is each of them in turn,
  // and the first that type-checks there is the one meant.
  let first: TEdit | undefined;
  for (const t of readings(r)) {
    // Whole numbers first at what their places take: a plain literal would
    // fit an Int's place too (it's some Number), but read as a Float64 it
    // couldn't hold 12345678901234567890 exactly.
    if (wholes(t)) {
      const fit = written(code, names, info, hole, text, t, true, defId);
      if (fit.ok) return fit;
      first ??= fit;
    }
    const plain = written(code, names, info, hole, text, t, false, defId);
    if (plain.ok) return plain;
    first ??= plain;
  }
  return first!;
}

// Why a function named in full doesn't go where a call's function goes
// (Change the function…): what the checker says, a unit that doesn't
// match, say, rather than nothing (BACKLOG E126). Null when it fits, or
// isn't a name.
export function whyNotHere(code: Code, names: Names, info: Info, hole: Id, text: string): string | null {
  const all = { ...display, ...names };
  const target = Object.keys(all).find((d) => all[d] === text.trim() && code.nodes[d]);
  if (!target || !Object.values(code.nodes).some((n) => n.kind === "call" && n.fn === hole)) return null;
  const r = fill(code, names, info, hole, { kind: "ref", target, type: { t: "var", v: -1 } }, text.trim());
  return r.ok ? null : `${text.trim()} doesn't fit here: ${r.reason}`;
}

// Simplifications that keep the meaning, offered on a node's menu when
// they apply (BACKLOG E98): append of two lists written out is the one list
// [a, b, c], and appending [] changes nothing. One edit, one Undo. (A cons
// onto a list written out needs none: it already reads [x, a].)
export function simplify(code: Code, names: Names, info: Info, id: Id): TEdit | null {
  const n = code.nodes[id];
  if (n?.kind !== "call" || n.args.length !== 2) return null;
  const f = code.nodes[n.fn];
  if (f?.kind !== "ref" || !isPublished(f.target) || ({ ...display, ...names })[f.target] !== "append") return null;
  // A list written out: its cons cells, and the nil that ends them.
  const cells = (l: Id): { cells: Id[]; nil: Id } | null => {
    const out: Id[] = [];
    for (let at = l; ; ) {
      const c = code.nodes[at];
      if (c?.kind === "ref" && c.target === NIL) return { cells: out, nil: at };
      if (c?.kind !== "call" || (code.nodes[c.fn] as NodeOf<"ref">)?.target !== CONS) return null;
      out.push(at);
      at = c.args[1];
    }
  };
  const [front, back] = n.args, a = cells(front), b = cells(back);
  if (!a && !(b && !b.cells.length)) return null;
  let next: Code, root: Id, gone: Id[];
  if (a && !a.cells.length) { root = back; gone = [front]; next = code; }
  else if (b && !b.cells.length) { root = front; gone = [back]; next = code; }
  else if (a && b) {
    const last = code.nodes[a.cells.at(-1)!] as NodeOf<"call">;
    next = { ...code, nodes: { ...code.nodes, [last.id]: { ...last, args: [last.args[0], back] } } };
    root = front; gone = [a.nil];
  } else return null;
  next = swapIn(next, id, root);
  for (const g of [id, n.fn, ...gone]) delete next.nodes[g];
  return guardTyped(info, next, names, root, a && b && a.cells.length && b.cells.length ? "Simplified: one list, written out." : "Simplified: appending an empty list changes nothing.");
}

// Each way to read what's typed, one id per called name: at most 16.
function readings(t: Typed): Typed[] {
  if ("params" in t) return readings(t.body).map((body) => ({ params: t.params, body }));
  if (!("op" in t)) return [t];
  let out: Typed[][] = [[]];
  for (const a of t.args) out = out.flatMap((done) => readings(a).map((x) => [...done, x])).slice(0, 16);
  return (t.alts ?? [t.op]).flatMap((op) => out.map((args) => ({ op, args }))).slice(0, 16);
}

// What's typed, as values at the leaves of the operators the blocks draw
// (< ≤ = ++ + − · / …). Split at the last operator of the loosest kind
// outside brackets and text, so 1 − 2 − 3 is (1 − 2) − 3; a − with nothing
// before it negates. A leaf may be a name in scope.
// A leaf may also be a call written the way it prints, f(a, b), of a
// definition, a builtin or a constructor: `alts` when several share the name.
// A function written out, (x, y) => x + y or () => 0, is its inputs (new
// binders, in scope in its body) and its body.
type Typed = { value: Value } | { ref: Id } | { op: Id; args: Typed[]; alts?: Id[] } | { params: { id: Id; name: string }[]; body: Typed };
// The operators are read from the notation itself (styles/blocks.json),
// loosest first: each glyph is every function drawn with it, and the first
// that type-checks is the one meant. The generic arithmetic comes first, so
// + − × typed over Ints are Int's. Each also reads the way a keyboard
// types it: <= for ≤, * for ·. (^ groups to the right, which this split
// doesn't, so it isn't read yet.)
const KEYS: Record<string, string> = { "-": "−", "*": "·", "×": "·", "÷": "/", "<=": "≤", ">=": "≥" };
const glyphs = (fixity: string) => {
  const by = new Map<string, { prec: number; ids: Id[] }>();
  for (const [id, n] of Object.entries(blocksStyle.notation) as [Id, Notation][]) {
    if (n.fixity !== fixity || /^\p{L}/u.test(n.glyph) || n.glyph === "^") continue;
    const g = by.get(n.glyph) ?? { prec: n.prec ?? 5, ids: [] };
    g.ids.push(id);
    by.set(n.glyph, g);
  }
  for (const g of by.values()) g.ids.sort((a, b) => +b.startsWith("builtin.arith.") - +a.startsWith("builtin.arith."));
  return by;
};
const INFIX = glyphs("infix");
const OPS: [string, Id[]][][] = [...new Set([...INFIX.values()].map((g) => g.prec))].sort((a, b) => a - b).map((prec) => {
  const level = [...INFIX].filter(([, g]) => g.prec === prec).map(([glyph, g]): [string, Id[]] => [glyph, g.ids]);
  const keyed = Object.entries(KEYS).flatMap(([key, glyph]): [string, Id[]][] => (INFIX.get(glyph)?.prec === prec ? [[key, INFIX.get(glyph)!.ids]] : []));
  // Longest first: <= before <, ++ before +.
  return [...level, ...keyed].sort((a, b) => b[0].length - a[0].length);
});
const NEGATE = glyphs("prefix").get("−")?.ids ?? [ARITH.neg];
function typedOut(text: string, code: Code, names: Names, scope: Map<string, Id>): Typed | { error: string } {
  const t = text.trim();
  const named = scope.get(t);
  if (named) return { ref: named };
  const r = parseValue(text, code, names);
  if (!("error" in r)) return { value: r.value };
  // => binds loosest: (x) => x + 1 is a function of x, not (x) => x, plus 1.
  const fn = /^\(([^()]*)\)\s*=>\s*(\S[\s\S]*)$/.exec(t);
  if (fn) {
    const words = fn[1].trim() ? fn[1].split(",").map((w) => w.trim()) : [];
    if (words.every((w) => /^[^\s()[\],"=<>]+( [^\s()[\],"=<>]+)*$/u.test(w)) && new Set(words).size === words.length) {
      const params = words.map((name) => ({ id: freshId(), name }));
      const inner = new Map(scope);
      for (const p of params) inner.set(p.name, p.id);
      const body = typedOut(fn[2], code, names, inner);
      return "error" in body ? body : { params, body };
    }
  }
  for (const level of OPS) {
    let depth = 0, quoted = false;
    for (let i = t.length - 1; i > 0; i--) {
      const c = t[i];
      if (c === '"' && t[i - 1] !== "\\") quoted = !quoted;
      if (quoted) continue;
      if (")]".includes(c)) depth++;
      else if ("([".includes(c)) depth--;
      const op = depth === 0 ? level.find(([sym]) => t.slice(i - sym.length + 1, i + 1) === sym) : undefined;
      if (!op) continue;
      const left = t.slice(0, i - op[0].length + 1).trimEnd();
      if (!left || OPS.flat().some(([sym]) => left.endsWith(sym))) continue;
      const a = typedOut(left, code, names, scope), b = typedOut(t.slice(i + 1), code, names, scope);
      const alts = op[1].filter((id) => code.nodes[id]);
      if (!("error" in a) && !("error" in b) && alts.length) return { op: alts[0], args: [a, b], alts };
    }
  }
  const neg = /^[-−]\s*(.+)$/s.exec(t);
  if (neg) {
    const a = typedOut(neg[1], code, names, scope);
    const alts = NEGATE.filter((id) => code.nodes[id]);
    if (!("error" in a) && alts.length) return { op: alts[0], args: [a], alts };
  }
  if (t.startsWith("(") && t.endsWith(")")) { const inner = typedOut(t.slice(1, -1), code, names, scope); if (!("error" in inner)) return inner; }
  // A name may be several words, as fraction(3), or quoted as the blocks
  // draw it, ‹show numbers›(x).
  const call = /^‹?([^()[\],"‹›]+?)›?\s*\((.*)\)$/s.exec(t);
  const parts = call ? topLevel(call[2]) : undefined;
  if (call && parts) {
    call[1] = call[1].trim();
    const named = scope.get(call[1]);
    // Out of scope, a binder or a field isn't something to call, except an
    // interface's operation: double(x) (BACKLOG E139). An operation comes
    // before a constructor of the same name, as the palette offers it.
    const callable = (id: Id) => !["binder", "field"].includes(code.nodes[id]?.kind) || isOperation(code, id);
    const alts = [...new Set([...(named ? [named] : []), ...Object.keys(names).filter((id) => names[id] === call[1] && callable(id))])]
      .sort((x, y) => +isOperation(code, y) - +isOperation(code, x));
    const args = parts.map((a) => typedOut(a, code, names, scope));
    if (alts.length && args.every((a) => !("error" in a))) return { op: alts[0], args: args as Typed[], alts };
  }
  return r;
}

// A field of an interface's record is one of its operations (INTERFACES.md).
function isOperation(code: Code, id: Id): boolean {
  if (code.nodes[id]?.kind !== "field") return false;
  const v = Object.values(code.nodes).find((n) => n.kind === "variant" && n.fields.includes(id));
  return !!v && Object.values(code.nodes).some((n) => n.kind === "typedef" && n.interface && n.variants.includes(v.id));
}

// The arguments of a call, split at its own commas: none inside brackets
// or text. Undefined when the brackets don't close where they should.
function topLevel(text: string): string[] | undefined {
  const out: string[] = [];
  let depth = 0, quoted = false, from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if ("([".includes(c)) depth++;
    else if (")]".includes(c) && --depth < 0) return undefined;
    else if (c === "," && depth === 0) { out.push(text.slice(from, i)); from = i + 1; }
  }
  if (depth || quoted) return undefined;
  const last = text.slice(from);
  return last.trim() || out.length ? [...out, last] : [];
}

// `fit`: each whole number is written at the number type its place
// expects, Int or Rational (or a Float64 where nothing says): as fraction(1)
// + 1/2 is an Int, then a fraction. One whole number over another is one
// value, a fraction where a Rational goes. Found by checking the filling
// with those places left open, then filling each as its hole expects.
function written(code: Code, names: Names, info: Info, hole: Id, text: string, typed: Typed, fit: boolean, defId?: Id): TEdit {
  const nodes = { ...code.nodes };
  // Typed alone, an Int is read from the text, so one past 2⁵³ stays exact.
  const exact = /^\s*-?\d+\s*$/.test(text) ? readInt(text.trim())[0] : undefined;
  const open = new Map<Id, { n: number } | { p: number; q: number }>();
  const isWhole = (t: Typed) => ("value" in t && typeof t.value === "number" && Number.isInteger(t.value) ? t.value : null);
  const build = (v: Value, place?: Id): Id => {
    const id = place ?? freshId();
    if (fit && typeof v === "number" && Number.isInteger(v)) { open.set(id, { n: v }); nodes[id] = { id, kind: "hole" }; }
    else if (typeof v === "number" || typeof v === "string") nodes[id] = { id, kind: "lit", value: v };
    else if (typeof v === "object" && "tag" in v) {
      const fn = v.fields.length ? freshId() : id;
      nodes[fn] = { id: fn, kind: "ref", target: v.tag };
      if (v.fields.length) nodes[id] = { id, kind: "call", fn, args: v.fields.map((x) => build(x)) };
    } else throw new Error("only plain values can be written out");
    return id;
  };
  const call = (op: Id, args: Id[], place?: Id): Id => {
    const id = place ?? freshId(), fn = freshId();
    nodes[fn] = { id: fn, kind: "ref", target: op };
    nodes[id] = { id, kind: "call", fn, args };
    return id;
  };
  const nn: Names = { ...names };
  const tree = (t: Typed, place?: Id): Id => {
    if ("value" in t) return build(t.value, place);
    if ("params" in t) {
      const id = place ?? freshId();
      for (const p of t.params) { nodes[p.id] = { id: p.id, kind: "binder" }; nn[p.id] = p.name; }
      nodes[id] = { id, kind: "lambda", params: t.params.map((p) => p.id), body: tree(t.body) };
      return id;
    }
    if ("ref" in t) { const id = place ?? freshId(); nodes[id] = { id, kind: "ref", target: t.ref }; return id; }
    const [p, q] = t.args.map(isWhole);
    if (fit && t.op === B.div && t.args.length === 2 && p !== null && q !== null) {
      const id = place ?? freshId();
      open.set(id, { p, q });
      nodes[id] = { id, kind: "hole" };
      return id;
    }
    return call(t.op, t.args.map((a) => tree(a)), place);
  };
  tree(typed, hole);
  if (open.size) {
    const seen = check({ nodes, defs: code.defs }, names);
    for (const [id, w] of open) {
      const e = seen.holes.get(id)?.expected;
      const of = e?.t === "con" && (e.id === INT || e.id === RATIONAL_TYPE) ? e.id : undefined;
      const lit = (v: number | string, at = of) => { const x = freshId(); nodes[x] = { id: x, kind: "lit", value: v, ...(at ? { of: at } : {}) }; return x; };
      if ("n" in w) {
        const n = of && exact !== undefined ? exact : w.n;
        nodes[id] = { id, kind: "lit", value: typeof n === "number" ? n : String(n), ...(of ? { of } : {}) };
      } else if (of === RATIONAL_TYPE) nodes[id] = { id, kind: "lit", value: `${w.p}/${w.q}`, of };
      else call(B.div, [lit(w.p, undefined), lit(w.q, undefined)], id);
    }
  }
  const next = { nodes, defs: code.defs };
  const after = defId ? nextHole(next, defId, hole) : undefined;
  return guardTyped(info, next, nn, after ?? hole, `Filled with ${text.trim()}.`);
}

// The next hole after `id` in reading order, or the first one.
// Reading order is the order the views show: the tree's, except that a
// match on a Bool reads as if/then/else, so its true case comes first.
export function readingOrder(code: Code, root: Id): Id[] {
  const out: Id[] = [];
  const walk = (id: Id) => {
    const n = code.nodes[id];
    if (!n) return;
    out.push(id);
    const cs = children(n);
    if (n.kind === "match") {
      const t = cs.findIndex((c) => (code.nodes[c] as NodeOf<"arm">).variant === TRUE);
      const f = cs.findIndex((c) => (code.nodes[c] as NodeOf<"arm">).variant === FALSE);
      if (t >= 0 && f >= 0 && f < t) [cs[t], cs[f]] = [cs[f], cs[t]];
    }
    cs.forEach(walk);
  };
  walk(root);
  return out;
}

export function nextHole(code: Code, defId: Id, id: Id): Id | undefined {
  const order = readingOrder(code, defId);
  const holes = order.filter((x) => code.nodes[x].kind === "hole");
  const at = order.indexOf(id);
  return holes.find((h) => order.indexOf(h) > at) ?? holes[0];
}

export function toHole(code: Code, names: Names, info: Info, id: Id): TEdit {
  return guardTyped(info, replace(code, id, () => ({ kind: "hole" })), names, id, "Cleared to a hole. It knows its type: pick from the palette to fill it.");
}

// Wrap in…: a part was made a hole (`kept` is the program from before),
// and the hole has just been filled with a call or a function. The part
// goes back into the first of its empty inputs where it type-checks; where
// a function of nothing goes, as () => the part. One edit with the fill.
export function wrapInto(code: Code, names: Names, before: Info, at: Id, kept: Code): TEdit {
  const wrapper = code.nodes[at];
  const slots = wrapper?.kind === "call" ? wrapper.args : wrapper?.kind === "lambda" ? [wrapper.body] : [];
  const open = slots.filter((x) => code.nodes[x]?.kind === "hole");
  if (!open.length) return { ok: false, reason: "that has no empty input to put it in" };
  const part = freshId();
  const base: Code = { nodes: { ...code.nodes }, defs: code.defs };
  for (const x of subtree(kept, at)) base.nodes[x] = kept.nodes[x];
  base.nodes[at] = code.nodes[at];
  const { id: _, ...was } = kept.nodes[at];
  base.nodes[part] = { ...was, id: part } as Node;
  let last: TEdit | null = null;
  for (const slot of open) {
    for (const thunk of [false, true]) {
      const next = replace(base, slot, () => (thunk ? { kind: "lambda", params: [], body: part } : was as NodeData));
      if (!thunk) delete next.nodes[part];
      const r = guardTyped(before, next, names, at, wrapper.kind === "lambda" ? "Wrapped it in a function: it is the body." : `Wrapped it in the call: it is one of its inputs${thunk ? ", as () => it, since a function of nothing goes there" : ""}.`);
      if (r.ok) return r;
      last ??= r;
    }
  }
  return { ok: false, reason: `it doesn't go in any of its inputs (${last && !last.ok ? last.reason : "none fits"})` };
}

// What's wired into a node: the parts that would be left lying if it were
// taken out. A call's inputs (and a step's body), a function's body, what a
// case looks at and what each case gives, a relation's givens and body.
export function inputsOf(code: Code, id: Id): Id[] {
  const n = code.nodes[id];
  switch (n?.kind) {
    case "call": { const f = code.nodes[n.fn]; return [...n.args, ...(f?.kind === "lambda" ? [f.body] : [])]; }
    case "lambda": return [n.body];
    case "match": return [n.scrutinee, ...n.arms.map((a) => (code.nodes[a] as NodeOf<"arm">).body), ...(n.otherwise ? [n.otherwise] : [])];
    case "fold": return [n.scrutinee, ...n.arms.map((a) => (code.nodes[a] as NodeOf<"arm">).body)];
    case "solve": return [...Object.values(n.given), n.body];
    default: return [];
  }
}

export type LooseEdit = TEdit & { of?: Record<Id, Id>; home?: Record<Id, Id> };

// A loose part's new inputs are called what the variables they stand for are.
const inputNames = (names: Names, was: Record<Id, Id>, now: Record<Id, Id>): Names =>
  ({ ...names, ...Object.fromEntries(Object.entries(now).filter(([p, v]) => !was[p] && names[v] !== undefined).map(([p, v]) => [p, names[v]])) });

// The definition `id` is written in: a loose part, or `def`.
const holder = (code: Code, of: Record<Id, Id>, def: Id, id: Id): Id => Object.keys(of).find((l) => code.nodes[l] && subtree(code, l).includes(id)) ?? def;

// Delete one node (NODE-EDITOR.md, "Loose parts", rule 4): its place is a
// hole, and what was wired into it is kept, loose. Deleting a loose part
// (its root) throws it away.
export function deleteOne(code: Code, names: Names, info: Info, def: Id, of: Record<Id, Id>, home: Record<Id, Id>, id: Id): LooseEdit {
  const at = holder(code, of, def, id);
  const lb = of[at] ? code.nodes[at] as NodeOf<"def"> : null;
  const root = lb?.body ? (code.nodes[lb.body].kind === "lambda" ? (code.nodes[lb.body] as NodeOf<"lambda">).body : lb.body) : null;
  if (lb && (id === at || id === root)) {
    const r = dropLoose(code, of, home, at);
    return { ok: true, code: r.code, names, of: r.of, home: r.home, note: "Threw the loose part away. Undo brings it back." };
  }
  const owner = of[at] ?? def;
  let c = code, o = of, hm = home, kept = 0;
  for (const r of inputsOf(code, id)) {
    if (!c.nodes[r] || c.nodes[r].kind === "hole") continue;
    const x = setLoose(c, o, hm, owner, r, scopeAt(c, at, r));
    c = x.code; o = x.of; hm = x.home; kept++;
  }
  const e = guardTyped(info, replace(c, id, () => ({ kind: "hole" })), inputNames(names, home, hm), id, kept
    ? `Deleted it. What was wired into it is kept, loose, at the end of the text: wire it back in, or delete it too.`
    : "Deleted it: a hole is left. It knows its type: pick from the palette to fill it.");
  return e.ok ? { ...e, of: o, home: hm } : e;
}

// Pull a value off its input (rule 5): the input is a hole, the value lies loose.
export function unwire(code: Code, names: Names, info: Info, def: Id, of: Record<Id, Id>, home: Record<Id, Id>, slot: Id): LooseEdit {
  if (code.nodes[slot]?.kind === "hole") return { ok: false, reason: "nothing is wired in there" };
  const at = holder(code, of, def, slot);
  // The value moves out under a new id, so the hole can keep the input's.
  const moved = freshId();
  const nodes = { ...code.nodes, [moved]: { ...code.nodes[slot], id: moved } as Node };
  const x = setLoose({ ...code, nodes }, of, home, of[at] ?? def, moved, scopeAt(code, at, slot));
  const e = guardTyped(info, replace(x.code, slot, () => ({ kind: "hole" })), inputNames(names, home, x.home), slot, "Took it off: the input is a hole, and the value lies loose at the end of the text.");
  return e.ok ? { ...e, of: x.of, home: x.home } : e;
}

// Wire a loose part into a hole: it's part of the definition again.
export function wireLoose(code: Code, names: Names, info: Info, def: Id, of: Record<Id, Id>, home: Record<Id, Id>, part: Id, hole: Id): LooseEdit {
  if (code.nodes[hole]?.kind !== "hole") return { ok: false, reason: "drop it on an empty input" };
  const at = holder(code, of, def, hole);
  if (at === part) return { ok: false, reason: "that's inside the part itself" };
  const x = wireIn(code, of, home, part, hole, scopeAt(code, at, hole));
  if (!x) return { ok: false, reason: "that isn't a loose part" };
  const e = guardTyped(info, x.code, names, hole, "Wired it in: it's part of the definition again.");
  return e.ok ? { ...e, of: x.of, home: x.home } : e;
}

// A loose part dropped on an input that has a value: the value there is
// set loose in its place, as any drop on a filled input does (Ersagun
// 2026-10-27: after a dot he couldn't wire things back where they were).
export function looseOver(code: Code, names: Names, info: Info, def: Id, of: Record<Id, Id>, home: Record<Id, Id>, part: Id, slot: Id): LooseEdit {
  const cur = code.nodes[slot];
  if (!cur || cur.kind === "hole") return wireLoose(code, names, info, def, of, home, part, slot);
  if (subtree(code, slot).includes(part)) return { ok: false, reason: "that's part of what's there now" };
  // A variable or a literal alone is nothing to keep: it's just replaced.
  if (cur.kind === "ref" || cur.kind === "lit") {
    const c = replace(code, slot, () => ({ kind: "hole" }));
    const w = wireLoose(c, names, infer(c, { ...display, ...names }), def, of, home, part, slot);
    return !w.ok ? w : cur.kind === "ref" ? settleDot(w, def, cur.target) : { ...w, note: `${w.note} The ${showLit(cur)} that was there is gone; Undo brings it back.` };
  }
  const u = unwire(code, names, info, def, of, home, slot);
  if (!u.ok) return u;
  const w = wireLoose(u.code, u.names, infer(u.code, { ...display, ...u.names }), def, u.of ?? of, u.home ?? home, part, slot);
  return w.ok ? { ...w, note: `${w.note} What was there lies loose at the end of the text.` } : w;
}

const showLit = (n: NodeOf<"lit">): string => (typeof n.value === "string" && n.of === STRING ? JSON.stringify(n.value) : String(n.value));

// A dot nobody named that a rewire leaves with one use goes back on its
// one wire: it was only there to share the value.
function settleDot<E extends Extract<LooseEdit, { ok: true }>>(e: E, def: Id, dot: Id): E {
  if (e.names[dot] !== undefined || !isDot(e.code, def, dot) || usesOf(e.code, dot).length !== 1) return e;
  const r = removeDot(e.code, e.names, infer(e.code, { ...display, ...e.names }), def, dot);
  return r.ok ? { ...e, code: r.code, names: r.names, note: `${e.note} The dot it left with one use is gone, the value back on its wire.` } : e;
}

// Wire into an input that already has a value (rule 5): the value there is
// taken off first and lies loose, so a drop swaps and nothing is lost.
// `wire` is the drop itself (useVar, share), on the code with the hole.
export function over(code: Code, names: Names, info: Info, def: Id, of: Record<Id, Id>, home: Record<Id, Id>, slot: Id, from: Id, wire: (code: Code, names: Names, info: Info) => TEdit): LooseEdit {
  const cur = code.nodes[slot];
  if (cur?.kind === "ref" && cur.target === from) return { ok: false, reason: "already that" };
  // A variable alone is nothing to keep: it's just replaced.
  if (!cur || cur.kind === "hole") return wire(code, names, info);
  if (cur.kind === "ref") { const w = wire(code, names, info); return w.ok ? settleDot({ ...w, of, home }, def, cur.target) : w; }
  // Nor is a number or a text typed in: it's replaced, and Undo brings it
  // back (Ersagun 2026-10-27: a 600 set loose was in the way).
  if (cur.kind === "lit") { const w = wire(code, names, info); return w.ok ? { ...w, of, home, note: `${w.note} The ${showLit(cur)} that was there is gone; Undo brings it back.` } : w; }
  if (subtree(code, slot).includes(from)) return { ok: false, reason: "that's part of what's there now" };
  const u = unwire(code, names, info, def, of, home, slot);
  if (!u.ok) return u;
  const w = wire(u.code, u.names, infer(u.code, { ...display, ...u.names }));
  return w.ok ? { ...w, of: u.of, home: u.home, note: `${w.note} What was there lies loose at the end of the text.` } : w;
}

export function setLit(code: Code, names: Names, info: Info, id: Id, raw: string): TEdit {
  const old = code.nodes[id] as NodeOf<"lit">;
  if (old.of === INT) {
    // Any size; digits are kept as text when they don't fit a safe integer.
    const [n] = readInt(raw.trim());
    if (n === undefined) return { ok: false, reason: "this is a whole number; that isn't one" };
    return guardTyped(info, replace(code, id, () => ({ kind: "lit", value: typeof n === "number" ? n : String(n), of: INT })), names, id, "Changed a literal.");
  }
  if (old.of === RATIONAL_TYPE) {
    // A fraction: a whole number, or one over another (L75).
    const parts = ratioParts(raw.trim());
    if (!parts) return { ok: false, reason: "this is a fraction: a whole number, or top/bottom with the bottom not 0" };
    const [p, q] = parts;
    return guardTyped(info, replace(code, id, () => ({ kind: "lit", value: q === 1n && Number.isSafeInteger(Number(p)) ? Number(p) : `${p}/${q}`, of: RATIONAL_TYPE })), names, id, "Changed a literal.");
  }
  const v = typeof old.value === "number" ? Number(raw) : raw;
  if (typeof v === "number" && !Number.isFinite(v)) return { ok: false, reason: "this is a number; that isn't one" };
  return guardTyped(info, replace(code, id, () => ({ ...old, kind: "lit", value: v })), names, id, "Changed a literal.");
}

// Binders visible at `id`: lambda params, let names, arm bindings.
export function scopeAt(code: Code, defId: Id, id: Id): Id[] {
  const def = code.nodes[defId] as NodeOf<"def">;
  let found: Id[] | null = null;
  const walk = (n: Id, scope: Id[]) => {
    if (found) return;
    if (n === id) { found = scope; return; }
    const x = code.nodes[n];
    switch (x.kind) {
      case "lambda": walk(x.body, [...scope, ...x.params]); return;
      case "call":
        if (code.nodes[x.fn].kind === "lambda") {
          x.args.forEach((a) => walk(a, scope));
          const lam = code.nodes[x.fn] as NodeOf<"lambda">;
          if (lam.id === id) { found = scope; return; }
          walk(lam.body, [...scope, ...lam.params]);
        } else [x.fn, ...x.args].forEach((a) => walk(a, scope));
        return;
      case "match": case "fold":
        walk(x.scrutinee, scope);
        for (const a of x.arms) {
          const arm = code.nodes[a] as NodeOf<"arm">;
          if (a === id) { found = scope; return; }
          walk(arm.body, [...scope, ...arm.binds, ...arm.results.filter((r): r is Id => r !== null)]);
        }
        if (x.kind === "match" && x.otherwise) walk(x.otherwise, scope);
        return;
      case "solve":
        Object.values(x.given).forEach((g) => walk(g, scope));
        walk(x.body, [...scope, ...Object.values(x.binds)]);
        return;
    }
  };
  if (def.body) walk(def.body, []);
  return found ?? [];
}

// The data type a binder holds, if it's one with cases.
export function dataTypeOf(code: Code, info: Info, b: Id): Id | null {
  const t = info.typeOf.get(b);
  if (!t) return null;
  const r = info.subst.resolve(t);
  return r.t === "con" && [...info.owner.values()].includes(r.id) ? r.id : null;
}

// Copy a subtree with fresh ids, binders included (refs to them follow).
function copyTree(code: Code, nodes: Record<Id, Node>, names: Names, root: Id, map = new Map<Id, Id>()): Id {
  const go = (id: Id): Id => {
    const n = code.nodes[id];
    if (n.kind === "ref") return mk({ kind: "ref", target: map.get(n.target) ?? n.target });
    if (n.kind === "binder") { const nid = mk({ kind: "binder" }); map.set(id, nid); if (names[id] !== undefined) names[nid] = names[id]; return nid; }
    switch (n.kind) {
      case "call": { const fn = go(n.fn); return mk({ kind: "call", fn, args: n.args.map(go) }); }
      case "lambda": { const params = n.params.map(go); return mk({ kind: "lambda", params, body: go(n.body) }); }
      case "match": { const s = go(n.scrutinee); const arms = n.arms.map(go); return mk({ kind: "match", scrutinee: s, arms, otherwise: n.otherwise ? go(n.otherwise) : null }); }
      case "fold": { const s = go(n.scrutinee); return mk({ kind: "fold", scrutinee: s, arms: n.arms.map(go) }); }
      case "arm": { const binds = n.binds.map(go); const results = n.results.map((r) => (r ? go(r) : null)); return mk({ kind: "arm", variant: n.variant, binds, results, body: go(n.body) }); }
      case "solve": {
        const given = Object.fromEntries(Object.entries(n.given).map(([k, v]) => [k, go(v)]));
        const binds = Object.fromEntries(Object.entries(n.binds).map(([k, v]) => [k, go(v)]));
        return mk({ kind: "solve", fn: map.get(n.fn) ?? n.fn, given, binds, body: go(n.body) });
      }
      default: return mk({ ...n, id: undefined } as unknown as NodeData);
    }
  };
  const mk = (d: NodeData): Id => { const id = freshId(); const { id: _, ...rest } = d as NodeData & { id?: Id }; nodes[id] = { id, ...rest } as Node; return id; };
  return go(root);
}

// ---------------------------------------------------------------- copy and paste
//
// A copied piece is its nodes and the names of what it binds. Pasted into a
// hole it gets fresh ids, so the copy is a new piece with the same shape;
// variables it binds itself come along, variables from outside are kept
// where the hole can see them and become holes where it can't, and anything
// the program doesn't have (a definition from another program) becomes a
// hole too. Then it's type-checked like any other edit.

export interface Clip { nodes: Record<Id, Node>; root: Id; names: Names }

export function copyOf(code: Code, names: Names, id: Id): Clip {
  const ids = subtree(code, id);
  return { nodes: Object.fromEntries(ids.map((x) => [x, code.nodes[x]])), root: id, names: Object.fromEntries(ids.filter((x) => names[x] !== undefined).map((x) => [x, names[x]])) };
}

export function paste(code: Code, names: Names, info: Info, defId: Id, clip: Clip, hole: Id): TEdit {
  if (code.nodes[hole]?.kind !== "hole") return { ok: false, reason: "select a hole to paste into" };
  const scope = new Set(scopeAt(code, defId, hole));
  const nodes = { ...code.nodes };
  const nn = { ...names };
  const map = new Map<Id, Id>();
  let lost = 0;
  const mk = (d: NodeData, id = freshId()): Id => { nodes[id] = { id, ...d } as Node; return id; };
  const bind = (b: Id): Id => { const nb = mk({ kind: "binder" }); map.set(b, nb); if (clip.names[b] !== undefined) nn[nb] = clip.names[b]; return nb; };
  const go = (id: Id, at = freshId()): Id => {
    const n = clip.nodes[id];
    switch (n.kind) {
      case "ref": {
        if (map.has(n.target)) return mk({ kind: "ref", target: map.get(n.target)! }, at);
        const t = code.nodes[n.target];
        if (!t || (t.kind === "binder" && !scope.has(n.target))) { lost++; return mk({ kind: "hole" }, at); }
        return mk({ kind: "ref", target: n.target }, at);
      }
      case "call": { const fn = go(n.fn); return mk({ kind: "call", fn, args: n.args.map((a) => go(a)) }, at); }
      case "lambda": { const params = n.params.map(bind); return mk({ kind: "lambda", params, body: go(n.body) }, at); }
      case "match": case "fold": {
        if (n.arms.some((a) => !code.nodes[(clip.nodes[a] as NodeOf<"arm">).variant])) { lost++; return mk({ kind: "hole" }, at); }
        const scrutinee = go(n.scrutinee);
        const arms = n.arms.map((a) => {
          const arm = clip.nodes[a] as NodeOf<"arm">;
          const binds = arm.binds.map(bind);
          const results = arm.results.map((r) => (r ? bind(r) : null));
          return mk({ kind: "arm", variant: arm.variant, binds, results, body: go(arm.body) });
        });
        return n.kind === "match" ? mk({ kind: "match", scrutinee, arms, otherwise: n.otherwise ? go(n.otherwise) : null }, at) : mk({ kind: "fold", scrutinee, arms }, at);
      }
      case "solve": {
        if (!code.nodes[n.fn]) { lost++; return mk({ kind: "hole" }, at); }
        const given = Object.fromEntries(Object.entries(n.given).map(([k, g]) => [k, go(g)]));
        const binds = Object.fromEntries(Object.entries(n.binds).map(([k, b]) => [k, bind(b)]));
        return mk({ kind: "solve", fn: n.fn, given, binds, body: go(n.body) }, at);
      }
      case "lit": return mk({ kind: "lit", value: n.value }, at);
      default: return mk({ kind: "hole" }, at);
    }
  };
  // The root takes the hole's id, so what was attached to the hole stays.
  go(clip.root, hole);
  const note = `Pasted a copy.${lost ? ` ${lost} part${lost === 1 ? "" : "s"} that can't be reached here became hole${lost === 1 ? "" : "s"}.` : ""}`;
  return guardTyped(info, { nodes, defs: code.defs }, nn, hole, note);
}

// Case split: replace an expression by a match on a variable, with one arm
// per case of its type, each starting as a copy of the expression. The
// arms come from the type, so no case is missing; each copy can then be
// changed for its case.
export function splitOn(code: Code, names: Names, info: Info, expr: Id, on: Id): TEdit {
  const type = dataTypeOf(code, info, on);
  if (!type) return { ok: false, reason: "that variable's type has no cases" };
  const nodes = { ...code.nodes };
  const nn = { ...names };
  const td = code.nodes[(code.nodes[type] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  const mk = (d: NodeData): Id => { const id = freshId(); nodes[id] = { id, ...d } as Node; return id; };
  const arms = td.variants.map((v) => {
    const binds = (code.nodes[v] as NodeOf<"variant">).fields.map((f) => { const b = mk({ kind: "binder" }); nn[b] = names[f] ?? display[f] ?? "field"; return b; });
    return mk({ kind: "arm", variant: v, binds, results: binds.map(() => null), body: copyTree(code, nodes, nn, expr) });
  });
  const scrutinee = mk({ kind: "ref", target: on });
  const next = replace({ nodes, defs: code.defs }, expr, () => ({ kind: "match", scrutinee, arms, otherwise: null }));
  return guardTyped(info, next, nn, expr, `Split on ${names[on] ?? "it"}: one case per ${display[type] ?? names[type] ?? "variant"}, each a copy to change.`);
}

// Nested patterns (PATTERNS.md "Editing"). Match deeper: a field in a
// row's pattern opens into its type's cases, each row starting as a copy
// of the row's body. Split on it, from the field.
export function matchDeeper(code: Code, names: Names, info: Info, field: Id): TEdit {
  const arm = Object.values(code.nodes).find((n): n is NodeOf<"arm"> => n.kind === "arm" && n.binds.includes(field));
  if (!arm) return { ok: false, reason: "it isn't a field of a case" };
  if (subtree(code, arm.body).some((x) => (code.nodes[x] as { target?: Id }).target === field)) return { ok: false, reason: `its row reads ${names[field] ?? "it"} whole, so it can't open into its cases` };
  const r = splitOn(code, names, info, arm.body, field);
  return r.ok ? { ...r, note: `Matched deeper on ${names[field] ?? "it"}: its place in the pattern opens into its cases, each a copy to change.` } : r;
}

// Join cases, its inverse: a match whose cases all give the same value,
// reading none of their own fields, is that value.
export function joinCases(code: Code, names: Names, info: Info, match: Id): TEdit {
  const m = code.nodes[match];
  if (m?.kind !== "match") return { ok: false, reason: "it isn't a match" };
  const arms = m.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
  const bodies = [...arms.map((a) => a.body), ...(m.otherwise ? [m.otherwise] : [])];
  if (!bodies.length || !parentOf(code, match)) return { ok: false, reason: "it has nothing to join" };
  const reads = (root: Id, binds: Id[]) => subtree(code, root).some((x) => binds.includes((code.nodes[x] as { target?: Id }).target!));
  if (arms.some((a) => reads(a.body, a.binds))) return { ok: false, reason: "a case reads its own fields" };
  if (new Set(bodies.map((b) => shape(code, b))).size > 1) return { ok: false, reason: "its cases give different values" };
  return guardTyped(info, collect(swapIn(code, match, bodies[0])), names, bodies[0], `Joined the cases: they all gave ${bodies.length > 1 ? "the same value" : "one value"}, so the match is gone and its place in the pattern closes up.`);
}

// Use a variable in an input: the input's current contents are replaced by
// a reference to it. Refused when it isn't in scope there or doesn't fit.
export function useVar(code: Code, names: Names, info: Info, defId: Id, binder: Id, slot: Id): TEdit {
  const cur = code.nodes[slot];
  if (cur?.kind === "ref" && cur.target === binder) return { ok: false, reason: "already that" };
  if (!scopeAt(code, defId, slot).includes(binder)) return { ok: false, reason: `${display[binder] ?? names[binder] ?? "it"} isn't in scope here` };
  const next = collect(replace(code, slot, () => ({ kind: "ref", target: binder })));
  return guardTyped(info, next, names, slot, `Wired ${display[binder] ?? names[binder] ?? "the variable"} in. Same as picking it from the palette: by id, type-checked.`);
}

// ---------------------------------------------------------------- dots
//
// A let is a dot on a wire, as in a node editor: one value, branching to
// every place that uses it. In the tree that is `let b = value in body`,
// where the binder b *is* the dot: the shared output. Its name lives in
// names.json like any other, so it can have none; then the views show a
// handle (•1, •2) that is never stored.

const lets = (code: Code, defId: Id): NodeOf<"call">[] => {
  const out: NodeOf<"call">[] = [];
  const def = code.nodes[defId] as NodeOf<"def">;
  const stack = def.body ? [def.body] : [];
  while (stack.length) {
    const n = code.nodes[stack.pop()!];
    if (!n) continue;
    if (n.kind === "call" && code.nodes[n.fn]?.kind === "lambda") out.push(n);
    if (n.kind === "call") stack.push(...[...n.args, n.fn].reverse());
    else if (n.kind === "lambda") stack.push(n.body);
    else if (n.kind === "match" || n.kind === "fold") stack.push(...(n.kind === "match" && n.otherwise ? [n.otherwise] : []), ...[...n.arms].reverse(), n.scrutinee);
    else if (n.kind === "arm") stack.push(n.body);
    else if (n.kind === "solve") stack.push(n.body, ...Object.values(n.given).reverse());
  }
  return out;
};

export const isDot = (code: Code, defId: Id, b: Id) => lets(code, defId).some((l) => (code.nodes[l.fn] as NodeOf<"lambda">).params.includes(b));

// Display handles for dots without a name, in reading order.
export function dotHandles(code: Code, defId: Id, names: Names): Names {
  const out: Names = {};
  let k = 0;
  for (const l of lets(code, defId)) for (const p of (code.nodes[l.fn] as NodeOf<"lambda">).params) if (names[p] === undefined) out[p] = `•${++k}`;
  return out;
}

export const usesOf = (code: Code, b: Id): Id[] => Object.values(code.nodes).filter((n) => n.kind === "ref" && n.target === b).map((n) => n.id);

// The innermost body around `slot` (a function's, a case's, a let's): a
// let put there sees what `slot` sees, since only bodies bind names.
function bodyAround(code: Code, defId: Id, slot: Id): Id | null {
  return bodiesAround(code, defId, slot)?.at(-1) ?? null;
}

// Every body on the way down to `slot`, outermost first.
function bodiesAround(code: Code, defId: Id, slot: Id): Id[] | null {
  const walk = (n: Id, r: Id[]): Id[] | null => {
    if (n === slot) return r;
    const x = code.nodes[n];
    switch (x?.kind) {
      case "lambda": return walk(x.body, [...r, x.body]);
      case "call": for (const c of [x.fn, ...x.args]) { const f = walk(c, r); if (f) return f; } return null;
      case "match": case "fold": {
        const f = walk(x.scrutinee, r);
        if (f) return f;
        for (const a of x.arms) { const ab = (code.nodes[a] as NodeOf<"arm">).body; const g = walk(ab, [...r, ab]); if (g) return g; }
        return x.kind === "match" && x.otherwise ? walk(x.otherwise, [...r, x.otherwise]) : null;
      }
      case "solve": for (const g of Object.values(x.given)) { const f = walk(g, r); if (f) return f; } return walk(x.body, [...r, x.body]);
      default: return null;
    }
  };
  const def = code.nodes[defId] as NodeOf<"def">;
  return def?.body ? walk(def.body, [def.body]) : null;
}

// Where the run of steps `slot` is in starts: the definition's body, or a
// case's, not counting the bodies of functions passed as values (first's
// else, a map's function). A value added there is in scope for every step
// of the run, as a let written at the top of the block would be (Ersagun
// 2026-10-27: a value added before 300 in colour wasn't in scope at 600
// or 299).
function stepAround(code: Code, defId: Id, slot: Id): Id | null {
  const walk = (n: Id, at: Id): Id | null => {
    if (n === slot) return at;
    const x = code.nodes[n];
    switch (x?.kind) {
      // A function passed as a value: its body is no step of this one.
      case "lambda": return walk(x.body, at);
      case "call": {
        const f = code.nodes[x.fn];
        // A let: the steps after it are the same run of steps.
        if (f?.kind === "lambda") { const b = walk(f.body, at); if (b) return b; }
        else { const b = walk(x.fn, at); if (b) return b; }
        for (const a of x.args) { const b = walk(a, at); if (b) return b; }
        return null;
      }
      case "match": case "fold": {
        const f = walk(x.scrutinee, at);
        if (f) return f;
        for (const a of x.arms) { const ab = (code.nodes[a] as NodeOf<"arm">).body; const g = walk(ab, ab); if (g) return g; }
        return x.kind === "match" && x.otherwise ? walk(x.otherwise, x.otherwise) : null;
      }
      case "solve": for (const g of Object.values(x.given)) { const f = walk(g, at); if (f) return f; } return walk(x.body, x.body);
      default: return null;
    }
  };
  const def = code.nodes[defId] as NodeOf<"def">;
  const top = def?.body ? code.nodes[def.body] : null;
  if (!top) return null;
  return top.kind === "lambda" ? walk(top.body, top.body) : walk(top.id, top.id);
}

// Put a dot on the wire out of `slot`: its value moves to a dot at the start
// of the innermost body around it (a function's, a case's, a let's), where
// everything after can reach it, and the wire runs from the dot to where the
// value was. Nothing in scope changes on the way up: only bodies bind names.
export function addDot(code: Code, names: Names, info: Info, defId: Id, slot: Id): TEdit {
  const cur = code.nodes[slot];
  if (!cur) return { ok: false, reason: "nothing there" };
  if (cur.kind === "hole") return { ok: false, reason: "a hole has no value to share yet" };
  if (cur.kind === "ref" && code.nodes[cur.target]?.kind === "binder") return { ok: false, reason: "that wire already comes from a variable: drag from it instead" };
  const at = bodyAround(code, defId, slot);
  if (!at) return { ok: false, reason: "that isn't inside this definition" };
  const dot = freshId(), use = freshId(), lam = freshId(), let_ = freshId();
  // Point the body's parent at the let first, then the value's at the use,
  // so each node has exactly one parent when the next swap looks.
  let next = swapIn(code, at, let_);
  if (at !== slot) next = swapIn(next, slot, use);
  next.nodes[dot] = { id: dot, kind: "binder" };
  next.nodes[use] = { id: use, kind: "ref", target: dot };
  next.nodes[lam] = { id: lam, kind: "lambda", params: [dot], body: at === slot ? use : at };
  next.nodes[let_] = { id: let_, kind: "call", fn: lam, args: [slot] };
  return guardTyped(info, next, names, dot, "Put a dot on that wire. Drag from the dot to any input it can reach to use the same value there; naming it is optional.");
}

// A group made into a function, called where it was (BACKLOG E146): the
// group's nodes become the body of a function named part, defined in the
// innermost body around them (where it sees what they saw), and called in
// their place. What's wired into the group from outside becomes the
// call's inputs, in reading order. Undo puts it back.
// Several values out (E149) leave together as a record of their own type,
// Part results, made at the end of part; where each was, its field is read.
export function makeFunction(code: Code, names: Names, info: Info, defId: Id, members: Id[]): TEdit & { fn?: Id } {
  const inDef = new Set(subtree(code, defId));
  const kinds = ["lit", "ref", "call", "lambda", "match", "fold", "hole"];
  if (members.some((m) => code.nodes[m]?.kind === "binder")) return { ok: false, reason: "a dot is in the group: a function's body can't hold a dot the rest still uses. Leave the dot out of the group" };
  const own = members.filter((m) => inDef.has(m) && kinds.includes(code.nodes[m]?.kind));
  if (!own.length) return { ok: false, reason: "nothing in the group is part of this definition" };
  // A frame in the group (a function, a match) brings all it holds.
  const region = new Set(own.flatMap((m) => (["lambda", "match", "fold"].includes(code.nodes[m].kind) ? subtree(code, m) : [m])));
  const parent = (id: Id) => parentOf(code, id)?.parent;
  // In the order the text reads: a let's value before what follows it.
  const order: Id[] = [];
  const walk = (id: Id) => {
    const n = code.nodes[id];
    if (!n) return;
    order.push(id);
    const cs = children(n);
    (n.kind === "call" && code.nodes[n.fn]?.kind === "lambda" ? [...n.args, n.fn] : cs).forEach(walk);
  };
  walk(defId);
  const roots = [...region].filter((m) => kinds.includes(code.nodes[m].kind) && !region.has(parent(m) ?? "")).sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const one = roots.length === 1;
  if (one && code.nodes[roots[0]].kind === "lambda" && region.size === subtree(code, roots[0]).length) return { ok: false, reason: "it's a function already" };
  // What comes in: each child of the group's nodes that isn't in it.
  // A literal, a called function and a definition's name stay in: they're
  // drawn on the node, not wired to it.
  const wire = (x: Id) => { const n = code.nodes[x]; return kinds.includes(n?.kind) && n.kind !== "lit" && !(n.kind === "ref" && code.nodes[n.target]?.kind !== "binder") && parentOf(code, x)?.slot !== "fn"; };
  const inputs = roots.flatMap((r) => readingOrder(code, r)).filter((x) => !region.has(x) && region.has(parent(x) ?? "") && wire(x));
  // Where part goes: the innermost body around every value out.
  const paths = roots.map((r) => bodiesAround(code, defId, r));
  if (paths.some((p) => !p)) return { ok: false, reason: "that isn't inside this definition" };
  let at: Id | null = null;
  for (let i = 0; paths.every((p) => p![i] !== undefined && p![i] === paths[0]![i]); i++) at = paths[0]![i];
  if (!at) return { ok: false, reason: "that isn't inside this definition" };
  // What comes in must be there already where part is called.
  const seen = new Set(scopeAt(code, defId, at));
  const late = inputs.flatMap((x) => subtree(code, x)).map((x) => code.nodes[x]).find((n) => n.kind === "ref" && code.nodes[n.target]?.kind === "binder" && !seen.has(n.target) && !subtree(code, inputs.find((i) => subtree(code, i).includes(n.id))!).includes(n.target));
  if (late) return { ok: false, reason: `${names[(late as NodeOf<"ref">).target] ?? "a value"} comes in, but it's worked out after the first value going out: put it in the group, or group less` };
  // Each value out's type, for the record's fields.
  const spec = (t: Type): { target: Id; args: unknown[] } | null => { const r = info.subst.resolve(t); if (r.t !== "con") return null; const as = r.args.map(spec); return as.every(Boolean) ? { target: r.id, args: as } : null; };
  const types = one ? [] : roots.map((r) => { const t = info.typeOf.get(r); return t ? spec(t) : null; });
  if (types.some((t) => !t)) return { ok: false, reason: "a value going out is a function, or of no one type yet: for now several values out each hold a plain type" };
  const fn = freshId(), lam = freshId(), call = freshId(), fref = freshId(), outer = freshId(), let_ = freshId();
  // The same variable wired in twice (time · time) is one input.
  const keyOf = (x: Id) => { const n = code.nodes[x]; return n.kind === "ref" && code.nodes[n.target]?.kind === "binder" ? `v ${n.target}` : x; };
  const firsts = inputs.filter((x, i) => inputs.findIndex((y) => keyOf(y) === keyOf(x)) === i);
  const params = firsts.map(() => freshId());
  const nn: Names = { ...names, [fn]: "part" };
  // Each input takes the name of what comes in (speed, not speed₂): inside
  // part the outer one isn't used, so the plain name reads right (QA8 L2).
  firsts.forEach((x, i) => { const n = code.nodes[x]; const nm = n.kind === "ref" ? names[n.target] : undefined; if (nm && nm !== "_") nn[params[i]] = nm; });
  let next = swapIn(code, at, let_);
  // Where each value out was: the call itself, or its field of the record.
  const p = freshId(), pLet = freshId(), pLam = freshId();
  const ctor = freshId(), tdef = freshId(), fields = roots.map(() => freshId());
  const outs = one ? [call] : roots.map((_, i) => freshId());
  roots.forEach((r, i) => { if (r !== at) next = swapIn(next, r, outs[i]); });
  for (const x of inputs) {
    const r = freshId();
    next = swapIn(next, x, r);
    next.nodes[r] = { id: r, kind: "ref", target: params[firsts.findIndex((y) => keyOf(y) === keyOf(x))] };
  }
  for (const q of params) next.nodes[q] = { id: q, kind: "binder" };
  next.nodes[fn] = { id: fn, kind: "binder" };
  next.nodes[fref] = { id: fref, kind: "ref", target: fn };
  next.nodes[call] = { id: call, kind: "call", fn: fref, args: firsts };
  const rest = roots.includes(at) ? outs[roots.indexOf(at)] : at;
  if (one) next.nodes[lam] = { id: lam, kind: "lambda", params, body: roots[0] };
  else {
    // The record: Part results, one field per value out, named for where
    // it went (drift, drop) or by its place.
    const names_ = roots.map((r, i) => { const at_ = parentOf(code, r); const l = at_ && code.nodes[at_.parent]; const f = l?.kind === "call" && code.nodes[l.fn]?.kind === "lambda" ? (code.nodes[l.fn] as NodeOf<"lambda">).params[at_!.index ?? 0] : undefined; return f && names[f] && names[f] !== "_" ? names[f] : `value ${i + 1}`; });
    const { nodes, add } = { nodes: next.nodes, add: (n: NodeData) => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; } };
    const build = (t: { target: Id; args: unknown[] }): Id => add({ kind: "tref", target: t.target, args: (t.args as { target: Id; args: unknown[] }[]).map(build) });
    fields.forEach((f, i) => { nodes[f] = { id: f, kind: "field", type: build(types[i]!) }; nn[f] = names_[i]; });
    nodes[ctor] = { id: ctor, kind: "variant", fields };
    const td = add({ kind: "typedef", params: [], variants: [ctor] });
    nodes[tdef] = { id: tdef, kind: "def", body: td };
    let tname = "Part results";
    for (let k = 2; Object.values(names).includes(tname); k++) tname = `Part results ${k}`;
    nn[tdef] = tname;
    nn[ctor] = tname.toLowerCase();
    next = { nodes, defs: [...next.defs, tdef] };
    const mk = freshId(), cref = freshId();
    nodes[cref] = { id: cref, kind: "ref", target: ctor };
    nodes[mk] = { id: mk, kind: "call", fn: cref, args: roots };
    nodes[lam] = { id: lam, kind: "lambda", params, body: mk };
    roots.forEach((_, i) => {
      const fr = freshId(), pr = freshId();
      nodes[fr] = { id: fr, kind: "ref", target: fields[i] };
      nodes[pr] = { id: pr, kind: "ref", target: p };
      nodes[outs[i]] = { id: outs[i], kind: "call", fn: fr, args: [pr] };
    });
    nodes[p] = { id: p, kind: "binder" };
    nn[p] = "results";
    nodes[pLam] = { id: pLam, kind: "lambda", params: [p], body: rest };
    nodes[pLet] = { id: pLet, kind: "call", fn: pLam, args: [call] };
  }
  next.nodes[outer] = { id: outer, kind: "lambda", params: [fn], body: one ? (at === roots[0] ? call : at) : pLet };
  next.nodes[let_] = { id: let_, kind: "call", fn: outer, args: [lam] };
  params.forEach((q, i) => { const x = code.nodes[firsts[i]]; nn[q] = x.kind === "ref" && names[x.target] ? names[x.target] : `in${params.length > 1 ? i + 1 : ""}`; });
  const what = one ? "" : ` Its ${roots.length} values go out together as Part results, and each is read where it was.`;
  const r = guardTyped(info, collect(next), nn, fn, `Made it a function, part, called where it was${firsts.length ? ` with what came in: ${firsts.length} input${firsts.length === 1 ? "" : "s"}` : ""}.${what} Name it, fold it, or Undo to put it back.`);
  return r.ok ? { ...r, fn: lam } : r;
}

// A new value of its own, not wired anywhere yet: a dot holding a hole, as
// the first step of the definition's body (where everything in it can
// reach it). Fill the hole, then drag from the dot to wherever the value
// goes. It's how the graph adds a node in empty space without a node that
// belongs to nothing: every node is still part of the tree.
// With `before`, the step goes just before that part instead (one arm of a
// match, say: print the usage, then return 2).
export function addStep(code: Code, names: Names, info: Info, defId: Id, before?: Id): TEdit & { dot?: Id } {
  const def = code.nodes[defId] as NodeOf<"def">;
  const top = def?.body ? code.nodes[def.body] : null;
  if (!top) return { ok: false, reason: "this definition has no body yet: fill it first" };
  if (top.kind === "typedef") return { ok: false, reason: "a data type has no steps; add a case or a field instead" };
  if (before !== undefined && (!["lit", "ref", "call", "lambda", "match", "fold", "hole"].includes(code.nodes[before]?.kind) || !subtree(code, defId).includes(before)))
    return { ok: false, reason: "a step goes before a value of this definition" };
  const at = (before !== undefined ? stepAround(code, defId, before) : null) ?? (top.kind === "lambda" ? top.body : def.body!);
  const dot = freshId(), hole = freshId(), lam = freshId(), let_ = freshId();
  const next = swapIn(code, at, let_);
  next.nodes[dot] = { id: dot, kind: "binder" };
  next.nodes[hole] = { id: hole, kind: "hole" };
  next.nodes[lam] = { id: lam, kind: "lambda", params: [dot], body: at };
  next.nodes[let_] = { id: let_, kind: "call", fn: lam, args: [hole] };
  const r = guardTyped(info, next, names, hole, "Added a value: a dot holding a hole. Fill the hole, then drag from the dot to where the value goes.");
  return r.ok ? { ...r, dot } : r;
}

// An action's steps are a chain of lets (toplevel.ts, step order): a new
// step just before `step` is one more let, of a hole whose value nobody
// names, around the let `step` is the value of, or around the last step.
export function addActionStep(code: Code, names: Names, info: Info, step: Id): TEdit {
  const one = (id: Id | undefined) => { const n = id ? code.nodes[id] : undefined; return n?.kind === "lambda" && n.params.length === 1; };
  const at = parentOf(code, step), p = at ? code.nodes[at.parent] : undefined;
  const x = at?.slot === "args" && p?.kind === "call" && p.args.length === 1 && one(p.fn) ? p.id
    : at?.slot === "body" && one(at.parent) && Object.values(code.nodes).some((c) => c.kind === "call" && c.fn === at.parent && c.args.length === 1) ? step
    : null;
  if (!x) return { ok: false, reason: "it isn't a step of an action" };
  const b = freshId(), hole = freshId(), lam = freshId(), let_ = freshId();
  const next = swapIn(code, x, let_);
  next.nodes[b] = { id: b, kind: "binder" };
  next.nodes[hole] = { id: hole, kind: "hole" };
  next.nodes[lam] = { id: lam, kind: "lambda", params: [b], body: x };
  next.nodes[let_] = { id: let_, kind: "call", fn: lam, args: [hole] };
  return guardTyped(info, next, { ...names, [b]: "_" }, hole, "Added a step before it: fill the hole with what to do there.");
}

// The reverse: a dot with one wire out goes back to being a plain wire.
export function removeDot(code: Code, names: Names, info: Info, defId: Id, dot: Id): TEdit {
  const l = lets(code, defId).find((c) => (code.nodes[c.fn] as NodeOf<"lambda">).params.includes(dot));
  if (!l) return { ok: false, reason: "that isn't a dot" };
  const uses = usesOf(code, dot);
  if (uses.length === 0) return { ok: false, reason: "nothing reads this dot; it is there for what its value does. Clear the value to drop it" };
  if (uses.length > 1) return { ok: false, reason: `it feeds ${uses.length} places; disconnect all but one first` };
  const lam = code.nodes[l.fn] as NodeOf<"lambda">;
  const i = lam.params.indexOf(dot);
  const value = l.args[i];
  let next: Code = { nodes: { ...code.nodes }, defs: code.defs };
  next.nodes[lam.id] = { ...lam, params: lam.params.filter((_, j) => j !== i) };
  next.nodes[l.id] = { ...l, args: l.args.filter((_, j) => j !== i) };
  next = swapIn(next, uses[0], value);
  if (lam.params.length === 1) next = swapIn(next, l.id, (next.nodes[lam.id] as NodeOf<"lambda">).body);
  const nn = { ...names };
  delete nn[dot];
  return guardTyped(info, collect(next), nn, value, "Removed the dot: the value is back on its one wire.");
}

// Drag a node's output onto another input: the value gets a dot (or uses
// the one it has) and the input is wired from it. The first step is the
// same for every input, so the editor checks each one against `prepare`.
export function prepareShare(code: Code, names: Names, info: Info, defId: Id, from: Id): { dot: Id; code: Code; names: Names; info: Info } | { reason: string } {
  const owner = lets(code, defId).find((l) => l.args.includes(from));
  if (owner) return { dot: (code.nodes[owner.fn] as NodeOf<"lambda">).params[owner.args.indexOf(from)], code, names, info };
  const r = addDot(code, names, info, defId, from);
  if (!r.ok) return { reason: r.reason };
  return { dot: r.select!, code: r.code, names: r.names, info: infer(r.code, { ...display, ...r.names }) };
}

export function share(code: Code, names: Names, info: Info, defId: Id, from: Id, slot: Id): TEdit {
  const p = prepareShare(code, names, info, defId, from);
  if ("reason" in p) return { ok: false, reason: p.reason };
  if (slot === from) return { ok: false, reason: "that's where it already goes" };
  const r = useVar(p.code, p.names, p.info, defId, p.dot, slot);
  return r.ok ? { ...r, select: p.dot, note: "Shared it: the value now has a dot, wired to both inputs." } : r;
}

export function addCase(code: Code, names: Names, info: Info, type: Id, name: string, fields: { name: string; type: Id }[]): TEdit {
  if (!name.trim()) return { ok: false, reason: "a case needs a name" };
  const before = new Set(info.holes.keys());
  const e = addVariant(code, names, type, name.trim(), fields);
  const r = guardTyped(info, e.code, e.names, e.variant, "");
  if (!r.ok) return r;
  const holes = [...infer(e.code, { ...display, ...e.names }).holes.keys()].filter((k) => !before.has(k)).length;
  return { ...r, note: `Added ${name.trim()}. ${holes ? `${holes} match${holes === 1 ? "" : "es"} and fold${holes === 1 ? "" : "s"} got a new case with a hole to fill, so none is missing a case.` : "Nothing matches on this type yet."}` };
}

export { fillings, litLabel, type Filling, type Info };

// ---------------------------------------------------------------- pins and copies
//
// A pin freezes the type the checker gives a definition now, so it becomes
// an interface (src/lang/signatures.ts): an edit inside that would change
// it is refused at the definition, and callers are checked against the pin.
// Pins are a side table like names (signatures in the file), so pinning
// never changes the code.

export type PinEdit = { ok: true; pins: Pins; note: string } | { ok: false; reason: string };

export function pin(code: Code, info: Info, pins: Pins, def: Id, name: string): PinEdit {
  if (isPublished(def)) return { ok: false, reason: `${name} is published, so it's pinned already` };
  if (subtree(code, def).some((x) => code.nodes[x].kind === "hole")) return { ok: false, reason: `${name} has holes: fill them first, so the pin promises the type it will have` };
  if (info.errors.some((e) => subtree(code, def).includes(e.id))) return { ok: false, reason: `${name} has a type error to fix first` };
  const p = pinsOf(info, [def]);
  if (!p[def]) return { ok: false, reason: `${name} has no type yet` };
  return { ok: true, pins: { ...pins, ...p }, note: `Pinned ${name} at ${showType(p[def].type, display, schemeArith(p[def]))}: edits inside it must keep that type, and callers see only it.` };
}

export function unpin(pins: Pins, def: Id, name: string): PinEdit {
  if (!pins[def]) return { ok: false, reason: `${name} isn't pinned` };
  const { [def]: _, ...rest } = pins;
  return { ok: true, pins: rest, note: `Unpinned ${name}: its type follows its body again.` };
}

// ---------------------------------------------------------------- implementations
//
// An implementation of an interface (INTERFACES.md) is a definition of the
// interface's record at one type: trig at dual = trig(dual sine, …). Made
// here with a hole for each operation and pinned to Trig Dual, so each
// hole's palette offers only the functions that fit that operation there.

const TYPE = (id: Id): Type => ({ t: "con", id, args: [] });

// The types an interface could be implemented for, that don't have it yet:
// Float64, Int, Text, closed data types (no type inputs), and a List of
// each of the first three (BACKLOG E143). An implementation is at one
// whole type (INTERFACES.md): List Float64 and List Text each get their
// own, as there's no one for every List a yet.
export function implementable(code: Code, info: Info, iface: Id): Type[] {
  const plain = code.defs.filter((d) => {
    const b = code.nodes[(code.nodes[d] as NodeOf<"def">).body ?? ""];
    return b?.kind === "typedef" && !b.params.length && !b.effect && !b.interface;
  });
  const base = [NUMBER, INT, STRING];
  const lists: Type[] = code.nodes["std.list"] ? base.map((b) => ({ t: "con", id: "std.list", args: [TYPE(b)] })) : [];
  return [...[...base, ...plain].map(TYPE), ...lists].filter((t) => !info.implementations?.has(implementationKey(iface, t)));
}

// Every interface there is, the library's and the program's.
export function interfaces(code: Code): Id[] {
  return code.defs.filter((d) => (code.nodes[(code.nodes[d] as NodeOf<"def">).body ?? ""] as { interface?: true } | undefined)?.interface);
}

export function implement(code: Code, names: Names, info: Info, iface: Id, type: Type): TEdit & { pin?: Pins } {
  const td = code.nodes[(code.nodes[iface] as NodeOf<"def">)?.body ?? ""];
  if (td?.kind !== "typedef" || !td.interface) return { ok: false, reason: "only an interface is implemented" };
  const all: Names = { ...LIBRARY.names, ...display, ...names };
  const at = showType(type, all);
  if (info.implementations?.has(implementationKey(iface, type))) return { ok: false, reason: `${at} has ${all[iface]} already` };
  const variant = td.variants[0];
  const ops = (code.nodes[variant] as NodeOf<"variant">).fields;
  const nodes = { ...code.nodes };
  const add = (n: NodeData) => { const id = freshId(); nodes[id] = { id, ...n } as Node; return id; };
  const holes = ops.map(() => add({ kind: "hole" }));
  const def = add({ kind: "def", body: add({ kind: "call", fn: add({ kind: "ref", target: variant }), args: holes }) });
  const taken = new Set(Object.values(all));
  let label = `${(all[iface] ?? "it").toLowerCase()} at ${at.toLowerCase()}`;
  for (let k = 2; taken.has(label); k++) label = `${(all[iface] ?? "it").toLowerCase()} at ${at.toLowerCase()} ${k}`;
  const nn = { ...names, [def]: label };
  const r = guardTyped(info, { nodes, defs: [...code.defs, def] }, nn, holes[0] ?? def, "");
  if (!r.ok) return r;
  const pin: Pins = { [def]: { vars: [], rows: [], type: { t: "con", id: iface, args: [type] } } };
  return { ...r, pin, note: `New definition ${label}: how ${at} does ${all[iface]}, one hole for each of its ${ops.length} operation${ops.length === 1 ? "" : "s"} (${ops.map((o) => all[o]).join(", ")}). Each palette offers what fits at ${at}.` };
}

// ---------------------------------------------------------------- rows
//
// A list is cons(a, cons(b, nil)), shown [a, b]; a chain of one operation
// where grouping doesn't matter, a ++ (b ++ c), is shown as one call with
// every operand side by side. Either way its parts are edited as a row:
// add one, move one, take one out. The program keeps its pairs; these edits
// rewire them, so the meaning changes only where you asked.

export interface Row { kind: "list" | "chain"; root: Id; op?: Id; items: Id[]; spine: Id[] }

const consOf = (code: Code, id: Id): NodeOf<"call"> | null => {
  const n = code.nodes[id];
  const f = n?.kind === "call" ? code.nodes[n.fn] : undefined;
  return n?.kind === "call" && f?.kind === "ref" && f.target === CONS && n.args.length === 2 ? n : null;
};
const opOf = (code: Code, id: Id): Id | null => {
  const n = code.nodes[id];
  const f = n?.kind === "call" && n.args.length === 2 ? code.nodes[n.fn] : undefined;
  return f?.kind === "ref" && ASSOCIATIVE.has(f.target) ? f.target : null;
};

// The row `root` is, if it is one. spine[i] is the cons holding items[i],
// and spine[items.length] the nil that ends the list.
export function rowAt(code: Code, root: Id): Row | null {
  const n = code.nodes[root];
  if ((n?.kind === "ref" && n.target === NIL) || consOf(code, root)) {
    const items: Id[] = [], spine: Id[] = [];
    for (let at = root; ; ) {
      const c = consOf(code, at);
      spine.push(at);
      if (c) { items.push(c.args[0]); at = c.args[1]; continue; }
      const end = code.nodes[at];
      return end?.kind === "ref" && end.target === NIL ? { kind: "list", root, items, spine } : null;
    }
  }
  const op = opOf(code, root);
  if (!op) return null;
  const items: Id[] = [];
  const walk = (a: Id) => { if (a !== root && opOf(code, a) !== op) items.push(a); else for (const b of (code.nodes[a] as NodeOf<"call">).args) walk(b); };
  walk(root);
  return { kind: "chain", root, op, items, spine: [] };
}

// The row `id` is an item of, and where.
export function rowOfItem(code: Code, id: Id): { row: Row; at: number } | null {
  const up = parentOf(code, id);
  if (!up || up.slot !== "args") return null;
  let root = up.parent;
  if (consOf(code, root) && up.index === 0) {
    for (let p = parentOf(code, root); p && p.slot === "args" && p.index === 1 && consOf(code, p.parent); p = parentOf(code, root)) root = p.parent;
  } else {
    const op = opOf(code, root);
    if (!op) return null;
    for (let p = parentOf(code, root); p && p.slot === "args" && opOf(code, p.parent) === op; p = parentOf(code, root)) root = p.parent;
  }
  const row = rowAt(code, root);
  const at = row ? row.items.indexOf(id) : -1;
  return row && at >= 0 ? { row, at } : null;
}

const itemWord = (row: Row) => (row.kind === "list" ? "item" : "input");

// A new hole in the row, before items[at] (at the end when at is its length).
export function addItem(code: Code, names: Names, info: Info, row: Row, at: number): TEdit {
  const hole = freshId(), pair = freshId(), head = freshId();
  let next: Code;
  let made: Node;
  if (row.kind === "list") {
    const tail = row.spine[at];
    if (!parentOf(code, tail)) return { ok: false, reason: "this list has nowhere to grow" };
    next = swapIn(code, tail, pair);
    made = { id: pair, kind: "call", fn: head, args: [hole, tail] };
    next.nodes[head] = { id: head, kind: "ref", target: CONS };
  } else {
    const last = at >= row.items.length;
    const beside = row.items[last ? row.items.length - 1 : at];
    next = swapIn(code, beside, pair);
    made = { id: pair, kind: "call", fn: head, args: last ? [beside, hole] : [hole, beside] };
    next.nodes[head] = { id: head, kind: "ref", target: row.op! };
  }
  next.nodes[pair] = made;
  next.nodes[hole] = { id: hole, kind: "hole" };
  const where = at >= row.items.length ? "at the end" : at === 0 ? "first" : `as the ${ordinal(at + 1)}`;
  return guardTyped(info, next, names, hole, `A new ${itemWord(row)} ${where}: fill its hole.`);
}

// A value dropped on a row's +: a new item at the end, wired to that value.
// From a binding (a dot or a parameter) it's one more use; from a node's
// output, the value is shared, as a drop on a hole shares it.
export function addItemFrom(code: Code, names: Names, info: Info, defId: Id, row: Row, from: Id, binding: boolean): TEdit {
  const a = addItem(code, names, info, row, row.items.length);
  if (!a.ok) return a;
  const now = infer(a.code, { ...display, ...a.names });
  const r = binding ? useVar(a.code, a.names, now, defId, from, a.select!) : share(a.code, a.names, now, defId, from, a.select!);
  return r.ok ? { ...r, note: `Added it to the ${row.kind === "list" ? "list" : "call"} as a new ${itemWord(row)} at the end.` } : r;
}

// Take items[at] out of the row.
export function removeItem(code: Code, names: Names, info: Info, row: Row, at: number): TEdit {
  let next: Code;
  if (row.kind === "list") {
    const cell = row.spine[at];
    if (!parentOf(code, cell)) return { ok: false, reason: "this list can't lose its first item here" };
    next = swapIn(code, cell, consOf(code, cell)!.args[1]);
  } else {
    const item = row.items[at];
    const up = parentOf(code, item)!;
    const pair = code.nodes[up.parent] as NodeOf<"call">;
    if (!parentOf(code, up.parent)) return { ok: false, reason: "this has nowhere to put what's left" };
    next = swapIn(code, up.parent, pair.args[up.index === 0 ? 1 : 0]);
  }
  return guardTyped(info, collect(next), names, undefined, `Took the ${ordinal(at + 1)} ${itemWord(row)} out.`);
}

// Swap items[at] with its neighbour `by` away (-1 earlier, 1 later).
export function moveItem(code: Code, names: Names, info: Info, row: Row, at: number, by: -1 | 1): TEdit {
  const other = at + by;
  if (other < 0 || other >= row.items.length) return { ok: false, reason: by < 0 ? "it's first already" : "it's last already" };
  const r = moveItemTo(code, names, info, row, at, other);
  return r.ok ? { ...r, note: `Moved it ${by < 0 ? "earlier" : "later"}.` } : r;
}

// Take items[from] out and put it back at `to`; the others keep their order.
// Each place in the row keeps its pair (cons or call); only what the pairs
// hold moves.
export function moveItemTo(code: Code, names: Names, info: Info, row: Row, from: number, to: number): TEdit {
  if (from === to) return { ok: false, reason: "it's there already" };
  const order = [...row.items];
  const [it] = order.splice(from, 1);
  order.splice(to, 0, it);
  const places = row.items.map((i) => parentOf(code, i)!);
  const next: Code = { nodes: { ...code.nodes }, defs: code.defs };
  places.forEach((p, i) => {
    const n = next.nodes[p.parent] as NodeOf<"call">;
    const args = [...n.args];
    args[p.index!] = order[i];
    next.nodes[p.parent] = { ...n, args };
  });
  return guardTyped(info, next, names, it, `Moved it to be the ${ordinal(to + 1)}.`);
}

const ordinal = (n: number) => (["first", "second", "third", "fourth", "fifth"][n - 1] ?? `${n}th`);

// A copy of one of the program's own functions or values, under fresh ids,
// placed right after it, to change without touching the original. Recursive
// calls in the copy call the copy.
export function duplicate(code: Code, names: Names, info: Info, def: Id): TEdit {
  const d = code.nodes[def];
  if (d?.kind !== "def" || !d.body || !code.defs.includes(def)) return { ok: false, reason: "only a definition is duplicated" };
  if (isPublished(def)) return { ok: false, reason: "it comes from the library: Copy into the program instead" };
  if (code.nodes[d.body].kind === "typedef") return { ok: false, reason: "the copy's cases would share the original's names: make a new type with + New definition" };
  const nodes = { ...code.nodes };
  const nn = { ...names };
  const copy = freshId();
  const body = copyTree(code, nodes, nn, d.body, new Map([[def, copy]]));
  nodes[copy] = { id: copy, kind: "def", body };
  const name = names[def] ?? "it";
  const taken = new Set(code.defs.map((x) => names[x]));
  let label = `${name} copy`;
  for (let k = 2; taken.has(label); k++) label = `${name} copy ${k}`;
  nn[copy] = label;
  const at = code.defs.indexOf(def) + 1;
  const next: Code = { nodes, defs: [...code.defs.slice(0, at), copy, ...code.defs.slice(at)] };
  return guardTyped(info, next, nn, copy, `Duplicated ${name} as ${label}: change it freely, ${name} stays as it was.`);
}

// A published definition can't change (it is named by what it says). To
// change one, copy it into the program: a new definition with the same body
// under fresh ids, which the program's own calls now use. Recursive calls
// in the copy call the copy. The library's version stays as it was.
export function copyIntoProgram(code: Code, names: Names, info: Info, def: Id, name: string): TEdit {
  const d = code.nodes[def];
  if (d?.kind !== "def" || !d.body || !isPublished(def)) return { ok: false, reason: "only a published definition is copied in; your own you can edit" };
  const nodes = { ...code.nodes };
  const nn = { ...names };
  const copy = freshId();
  // Names of what the copy binds come from the library's names.
  const all: Names = { ...LIBRARY.names, ...display, ...names };
  const body = copyTree(code, nodes, all, d.body, new Map([[def, copy]]));
  for (const id of Object.keys(nodes)) if (!code.nodes[id] && all[id] !== undefined) nn[id] = all[id];
  nodes[copy] = { id: copy, kind: "def", body };
  const taken = new Set(Object.values({ ...display, ...names }));
  let label = `my ${name}`;
  for (let k = 2; taken.has(label); k++) label = `my ${name} ${k}`;
  nn[copy] = label;
  // The program's own calls switch to the copy; the library's don't.
  let uses = 0;
  for (const n of Object.values(code.nodes)) {
    if (n.kind === "ref" && n.target === def && !LIBRARY.code.nodes[n.id]) { nodes[n.id] = { ...n, target: copy }; uses++; }
  }
  const next: Code = { nodes, defs: [...code.defs, copy] };
  return guardTyped(info, next, nn, copy, `Copied ${name} into the program as ${label}${uses ? `; the ${uses === 1 ? "call" : `${uses} calls`} here now use it` : ""}. Edit it freely: the published ${name} is unchanged.`);
}
