// The editor's view of typed programs (src/lang/): blocks you click, holes
// that know their type, and the gestures that can't produce a type error.
//
// Every expression is a span with its node id and its inferred type, so the
// type of anything is a hover away. Edits are pure functions here; each is
// checked by re-inferring the whole program and refused if it adds an error.

import type { Code, Id, Node, NodeData, NodeOf } from "../src/model.ts";
import { children, collect, freshId, replace, subtree, swapIn } from "../src/model.ts";
import type { Names, Presentation } from "../src/presentation.ts";
import { fillings, infer, type Filling, type Info } from "../src/lang/infer.ts";
import { addVariant, fillHole } from "../src/lang/refactor.ts";
import { CONS, FALSE, NIL, TRUE } from "../src/lang/std.ts";
import { INT, showType } from "../src/lang/types.ts";
import { read as readInt } from "../src/lang/int.ts";
import type { Value } from "../src/lang/run.ts";
import { parseValue } from "../src/lang/values.ts";
import { portLabel } from "../src/lang/equations.ts";

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
  return t ? showType(info!.subst.zonk(t), names) : null;
};

// ---------------------------------------------------------------- view

export function renderTyped(code: Code, pres: Presentation, info: Info | null, defId: Id, selected: Id | null): HTMLElement {
  const names = pres.names;
  const node = (id: Id) => code.nodes[id];
  const name = (id: Id) => names[id] ?? (node(id)?.kind === "builtin" ? (node(id) as NodeOf<"builtin">).op : "?");
  const holeType = (id: Id) => { const hi = info?.holes.get(id); return hi ? showType(info!.subst.zonk(hi.expected), names) : null; };
  const errorAt = new Map((info?.errors ?? []).map((e) => [e.id, e.message]));

  // Wrap a node's rendering so it can be clicked and shows its type.
  const x = (id: Id, cls: string, ...kids: Kid[]) => {
    const t = typeOf(info, id, names);
    const err = errorAt.get(id);
    return h("span", { class: `x ${cls}${selected === id ? " sel" : ""}${err ? " err" : ""}`, "data-id": id, title: err ?? (t ? `${t}` : undefined) }, ...kids);
  };
  const bind = (id: Id) => {
    const t = typeOf(info, id, names);
    return h("span", { class: `x bnd${selected === id ? " sel" : ""}`, "data-id": id, title: t ?? undefined }, name(id), t ? h("span", { class: "ty" }, `: ${t}`) : null);
  };
  const kw = (s: string) => h("span", { class: "kw" }, s);
  const sep = (s: string) => h("span", { class: "pn" }, s);
  const list = (ids: Id[], f: (id: Id) => Kid, between = ", ") => ids.flatMap((id, i) => (i ? [sep(between), f(id)] : [f(id)]));

  const isBool = (n: NodeOf<"match">) => n.arms.length === 2 && n.arms.every((a) => [TRUE, FALSE].includes((node(a) as NodeOf<"arm">).variant));
  const isLet = (n: Node) => n.kind === "call" && node(n.fn).kind === "lambda";
  const tall = (id: Id): boolean => {
    const n = node(id);
    if (n.kind === "match" || n.kind === "fold" || n.kind === "solve" || isLet(n)) return true;
    if (n.kind === "call") return [n.fn, ...n.args].some(tall);
    if (n.kind === "lambda") return tall(n.body);
    return false;
  };
  const listItems = (id: Id): Id[] | null => {
    const items: Id[] = [];
    for (let n = node(id); ; ) {
      if (n.kind === "ref" && n.target === NIL) return items;
      if (n.kind !== "call" || node(n.fn).kind !== "ref" || (node(n.fn) as NodeOf<"ref">).target !== CONS) return null;
      items.push(n.args[0]);
      n = node(n.args[1]);
    }
  };

  // One line, with the precedence it binds at.
  const inline = (id: Id): [HTMLElement, number] => {
    const n = node(id);
    switch (n.kind) {
      case "lit": return [x(id, "lit", typeof n.value === "string" ? JSON.stringify(n.value) : String(n.value)), 100];
      case "hole": return [x(id, "hole", "□", holeType(id) ? h("span", { class: "ty" }, holeType(id)!) : null), 100];
      case "ref": {
        const t = node(n.target);
        const cls = t?.kind === "binder" ? "var" : t?.kind === "variant" ? "con" : t?.kind === "def" ? "def" : "fn";
        return [x(id, `ref ${cls}`, name(n.target)), 100];
      }
      case "lambda": return [x(id, "lam", sep("("), ...list(n.params, bind), sep(") => "), inline(n.body)[0]), 0];
      case "call": {
        const items = listItems(id);
        if (items) return [x(id, "call", sep("["), ...list(items, (i) => inline(i)[0]), sep("]")), 100];
        const f = node(n.fn);
        const nota = f.kind === "ref" ? pres.style.notation[f.target] : undefined;
        const args = n.args.map(inline);
        const paren = ([e, p]: [HTMLElement, number], ok: boolean): Kid[] => (ok ? [e] : [sep("("), e, sep(")")]);
        if (nota?.fixity === "infix" && args.length === 2) {
          const p = nota.prec ?? 5;
          const [l, r] = args;
          const lok = l[1] > p || (l[1] === p && nota.assoc !== "right");
          const rok = r[1] > p || (r[1] === p && nota.assoc !== "left" && nota.assoc !== undefined);
          return [x(id, "call", ...paren(l, lok), h("span", { class: "op x", "data-id": n.fn }, ` ${nota.glyph} `), ...paren(r, rok)), p];
        }
        if (nota?.fixity === "prefix" && args.length === 1) {
          const p = nota.prec ?? 9;
          return [x(id, "call", h("span", { class: "op x", "data-id": n.fn }, nota.glyph), ...paren(args[0], args[0][1] > p)), p];
        }
        const head = inline(n.fn);
        return [x(id, "call", ...paren(head, head[1] >= 100), sep("("), ...args.flatMap((a, i) => (i ? [sep(", "), a[0]] : [a[0]])), sep(")")), 100];
      }
      default: return [block(id), 100];
    }
  };

  const line = (...kids: Kid[]) => h("div", { class: "ln" }, ...kids);
  const indent = (...kids: Kid[]) => h("div", { class: "ind" }, ...kids);
  const hang = (head: Kid[], id: Id) => (tall(id) ? [line(...head), indent(block(id))] : [line(...head, inline(id)[0])]);

  // Lines for an expression that needs them.
  const block = (id: Id): HTMLElement => {
    const n = node(id);
    if (!tall(id)) return line(inline(id)[0]);
    if (n.kind === "call" && isLet(n)) {
      const lam = node(n.fn) as NodeOf<"lambda">;
      return x(id, "blk let", ...lam.params.flatMap((p, i) => hang(name(p) === "_" ? [] : [bind(p), sep(" = ")], n.args[i])), block(lam.body));
    }
    if (n.kind === "match" && isBool(n)) {
      const arm = (v: Id) => node(n.arms.find((a) => (node(a) as NodeOf<"arm">).variant === v)!) as NodeOf<"arm">;
      const t = arm(TRUE), f = arm(FALSE);
      return x(id, "blk", line(kw("if "), inline(n.scrutinee)[0]),
        h("div", { class: `ind x arm${selected === t.id ? " sel" : ""}`, "data-id": t.id }, ...hang([kw("then ")], t.body)),
        h("div", { class: `ind x arm${selected === f.id ? " sel" : ""}`, "data-id": f.id }, ...hang([kw("else ")], f.body)));
    }
    if (n.kind === "match" || n.kind === "fold") {
      const arms = n.arms.map((a) => {
        const arm = node(a) as NodeOf<"arm">;
        const results = arm.results.filter((r): r is Id => r !== null);
        const pat: Kid[] = [h("span", { class: "con" }, name(arm.variant)), ...(arm.binds.length ? [sep("("), ...list(arm.binds, bind), sep(")")] : [])];
        if (results.length) pat.push(kw(" with "), ...list(results, bind));
        return h("div", { class: `arm x${selected === a ? " sel" : ""}`, "data-id": a }, ...hang([...pat, sep(" → ")], arm.body));
      });
      if (n.kind === "match" && n.otherwise) arms.push(h("div", { class: "arm" }, ...hang([kw("otherwise"), sep(" → ")], n.otherwise)));
      return x(id, "blk", line(kw(`${n.kind} `), inline(n.scrutinee)[0]), indent(...arms));
    }
    if (n.kind === "lambda") return x(id, "blk", line(sep("("), ...list(n.params, bind), sep(") =>")), indent(block(n.body)));
    if (n.kind === "solve") {
      // solve polar(x = …, y = …) for length, angle
      const label = (k: string) => (k === "out" ? "result" : portLabel(code, names, n.fn, k));
      const given = Object.entries(n.given).flatMap(([k, e], i) => [...(i ? [sep(", ")] : []), h("span", { class: "pn" }, `${label(k)} = `), inline(e)[0]]);
      const wanted = Object.entries(n.binds).flatMap(([k, b], i) => [...(i ? [sep(", ")] : []), ...(name(b) === label(k) ? [] : [h("span", { class: "pn" }, `${label(k)} as `)]), bind(b)]);
      return x(id, "blk", line(kw("solve "), x(n.fn, "ref fn", name(n.fn)), sep("("), ...given, sep(")"), kw(" for "), ...wanted), block(n.body));
    }
    if (n.kind === "call") {
      const f = node(n.fn);
      if (tall(n.fn) && !n.args.some(tall)) {
        return x(id, "blk", line(kw("apply")), indent(block(n.fn)), line(kw("to "), sep("("), ...list(n.args, (a) => inline(a)[0]), sep(")")));
      }
      const head = f.kind === "ref" ? x(n.fn, "ref fn", name(f.target)) : inline(n.fn)[0];
      const comma = (i: number) => (i < n.args.length - 1 ? sep(",") : null);
      return x(id, "blk", line(head, sep("(")), indent(...n.args.map((a, i) => (tall(a) ? h("div", {}, block(a), comma(i)) : line(inline(a)[0], comma(i))))), line(sep(")")));
    }
    return line(inline(id)[0]);
  };

  const def = node(defId) as NodeOf<"def">;
  const body = def.body ? node(def.body) : null;
  const out = h("div", { class: "typed" });
  if (pres.comments[defId]) out.append(h("div", { class: "cmt" }, `-- ${pres.comments[defId]}`));
  if (body?.kind === "typedef") {
    out.append(line(kw("type "), x(defId, "def", name(defId)), ...body.params.map((p) => h("span", {}, " ", bind(p)))));
    const tt = (id: Id): string => {
      const t = node(id);
      if (t.kind === "tfun") return `(${t.params.map(tt).join(", ")}) -> ${tt(t.result)}`;
      const r = t as NodeOf<"tref">;
      return [name(r.target), ...r.args.map((a) => { const s = tt(a); return s.includes(" ") ? `(${s})` : s; })].join(" ");
    };
    out.append(indent(...body.variants.map((v) => {
      const fs = (node(v) as NodeOf<"variant">).fields;
      return h("div", { class: `ln x variant${selected === v ? " sel" : ""}`, "data-id": v }, sep("| "), h("span", { class: "con" }, name(v)),
        ...(fs.length ? [sep("("), ...list(fs, (f) => h("span", { class: `x fld${selected === f ? " sel" : ""}`, "data-id": f }, name(f), h("span", { class: "ty" }, `: ${tt((node(f) as NodeOf<"field">).type)}`))), sep(")")] : []));
    })));
    return out;
  }
  const t = typeOf(info, defId, names);
  out.append(line(x(defId, "def", name(defId)), h("span", { class: "ty big" }, t ? ` : ${t}` : "")));
  if (!body) return out;
  if (body.kind === "lambda") out.append(...hang([x(defId, "def", name(defId)), sep("("), ...list(body.params, bind), sep(") = ")], body.body));
  else out.append(...hang([x(defId, "def", name(defId)), sep(" = ")], def.body!));
  return out;
}

// ---------------------------------------------------------------- edits

export type TEdit = { ok: true; code: Code; names: Names; select?: Id; note: string } | { ok: false; reason: string };

// Names for messages: the library's and the presentation's, under the
// program's own (which are what edits change and store).
let display: Names = {};
export const setDisplayNames = (n: Names) => { display = n; };

// Accept only if the program has no more type errors than before.
export function guardTyped(before: Info, code: Code, names: Names, select: Id | undefined, note: string): TEdit {
  const after = infer(code, { ...display, ...names });
  if (after.errors.length > before.errors.length) return { ok: false, reason: after.errors.at(-1)!.message };
  return { ok: true, code, names, select, note };
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
// constructor calls), type-checked like any other filling.
export function fillValue(code: Code, names: Names, info: Info, hole: Id, text: string, defId?: Id): TEdit {
  const r = parseValue(text, code, { ...display, ...names });
  if ("error" in r) return { ok: false, reason: r.error };
  const nodes = { ...code.nodes };
  const build = (v: Value, at?: Id): Id => {
    const id = at ?? freshId();
    if (typeof v === "number" || typeof v === "string") nodes[id] = { id, kind: "lit", value: v };
    else if (typeof v === "object" && "tag" in v) {
      const fn = v.fields.length ? freshId() : id;
      nodes[fn] = { id: fn, kind: "ref", target: v.tag };
      if (v.fields.length) nodes[id] = { id, kind: "call", fn, args: v.fields.map((x) => build(x)) };
    } else throw new Error("only plain values can be written out");
    return id;
  };
  build(r.value, hole);
  const next = { nodes, defs: code.defs };
  const after = defId ? nextHole(next, defId, hole) : undefined;
  return guardTyped(info, next, names, after ?? hole, `Filled with ${text.trim()}.`);
}

// The next hole after `id` in reading order, or the first one.
// Reading order is the order the views show: the tree's, except that a
// match on a Bool reads as if/then/else, so its true case comes first.
function readingOrder(code: Code, root: Id): Id[] {
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

export function setLit(code: Code, names: Names, info: Info, id: Id, raw: string): TEdit {
  const old = code.nodes[id] as NodeOf<"lit">;
  if (old.of === INT) {
    // Any size; digits are kept as text when they don't fit a safe integer.
    const [n] = readInt(raw.trim());
    if (n === undefined) return { ok: false, reason: "this is a whole number; that isn't one" };
    return guardTyped(info, replace(code, id, () => ({ kind: "lit", value: typeof n === "number" ? n : String(n), of: INT })), names, id, "Changed a literal.");
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
function copyTree(code: Code, nodes: Record<Id, Node>, names: Names, root: Id): Id {
  const map = new Map<Id, Id>();
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

// Put a dot on the wire out of `slot`: its value moves to a dot at the start
// of the innermost body around it (a function's, a case's, a let's), where
// everything after can reach it, and the wire runs from the dot to where the
// value was. Nothing in scope changes on the way up: only bodies bind names.
export function addDot(code: Code, names: Names, info: Info, defId: Id, slot: Id): TEdit {
  const cur = code.nodes[slot];
  if (!cur) return { ok: false, reason: "nothing there" };
  if (cur.kind === "hole") return { ok: false, reason: "a hole has no value to share yet" };
  if (cur.kind === "ref" && code.nodes[cur.target]?.kind === "binder") return { ok: false, reason: "that wire already comes from a variable: drag from it instead" };
  const walk = (n: Id, r: Id): Id | null => {
    if (n === slot) return r;
    const x = code.nodes[n];
    switch (x?.kind) {
      case "lambda": return walk(x.body, x.body);
      case "call": for (const c of [x.fn, ...x.args]) { const f = walk(c, r); if (f) return f; } return null;
      case "match": case "fold": {
        const f = walk(x.scrutinee, r);
        if (f) return f;
        for (const a of x.arms) { const ab = (code.nodes[a] as NodeOf<"arm">).body; const g = walk(ab, ab); if (g) return g; }
        return x.kind === "match" && x.otherwise ? walk(x.otherwise, x.otherwise) : null;
      }
      case "solve": for (const g of Object.values(x.given)) { const f = walk(g, r); if (f) return f; } return walk(x.body, x.body);
      default: return null;
    }
  };
  const def = code.nodes[defId] as NodeOf<"def">;
  const at = def.body ? walk(def.body, def.body) : null;
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

export { fillings, infer, type Filling, type Info };
