// The block view: what a typed program looks like to someone who reads code
// as indented blocks. Case analyses become indented arms, `if` is just how a
// match on Bool is shown, an immediately applied function is shown as
// `name = value` lines, and every definition is headed by its inferred type
// (inferred, not written: the type is a view too).
//
// Naming is scope-aware: two binders get a subscript only when both are
// visible at the same point and the outer one is used there, since that's
// the only time they could be confused on screen.
//
// One walk draws a definition as lines of pieces in indented groups
// (blocksOf). The text prints them (renderBlocks), and the editor's Blocks
// pane draws them as spans you click (editor/typed.ts), so the two read
// the same: one printer. A piece with an id stands for that node.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { children, resolveRefs, subtree } from "../model.ts";
import type { Notation, Presentation } from "../presentation.ts";
import { portLabel } from "./equations.ts";
import type { Info } from "./infer.ts";
import { matchRows, patternWith, sharedOtherwise, type Pat } from "./patterns.ts";
import { paramName } from "./refactor.ts";
import { implementationOps, isOperation } from "./records.ts";
import { chainOperands, CONS, FALSE, MAP as MAP_TYPE, NIL, PAIR_V, S, SET_TYPE, TRUE } from "./std.ts";
import { showIn } from "./types.ts";

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const plain = /^[\p{L}_][\p{L}\p{N}_'′]*$/u;

// A match with one case, on a type with one case, that names the fields:
// it always matches, so it only takes the value apart (an effect's one
// operation is handled, not taken apart).
export function takenApart(code: Code, info: Info | null, n: NodeOf<"match">): boolean {
  if (n.arms.length !== 1 || n.otherwise) return false;
  const arm = code.nodes[n.arms[0]] as NodeOf<"arm">;
  const owner = info?.owner.get(arm.variant);
  const td = owner ? code.nodes[(code.nodes[owner] as NodeOf<"def">).body!] : null;
  return arm.binds.length > 0 && arm.results.every((r) => r === null) && td?.kind === "typedef" && td.variants.length === 1 && !td.effect;
}

// A piece of a line. `pane` pieces are only drawn in the editor (the type
// beside a name, a hole's type), not printed.
export interface Part { id?: Id; cls: string; title?: string; pane?: true; kids: Piece[] }
export type Piece = string | Part;
// A line, or a group of them indented `pad` spaces; either can stand for a
// node.
export type Blk = { line: Piece[]; id?: Id; cls?: string } | { kids: Blk[]; pad: number; id?: Id; cls?: string };

export const pieceText = (ps: Piece[]): string => ps.map((p) => (typeof p === "string" ? p : p.pane ? "" : pieceText(p.kids))).join("");
export const blocksText = (bs: Blk[], ind = ""): string[] => bs.flatMap((b) => ("line" in b ? [ind + pieceText(b.line)] : blocksText(b.kids, ind + " ".repeat(b.pad))));

export function renderBlocks(code: Code, pres: Presentation, info: Info | null, defId: Id): string {
  return blocksText(blocksOf(code, pres, info, defId)).join("\n");
}

// A literal as drawn in the graph and the blocks pane. A long or multiline
// text (a page's CSS, say) shows its first line, clipped, and how many
// lines it has, so it doesn't stretch its view; hovering shows all of it,
// and the inspector edits all of it. The printed text has all of it.
const SHORT = 32;
export function litLabel(v: string | number | boolean, max = SHORT): { short: string; full?: string } {
  if (typeof v !== "string") return { short: String(v) };
  const lines = v.split("\n");
  if (lines.length === 1 && v.length <= max) return { short: JSON.stringify(v) };
  const first = lines.find((l) => l.trim()) ?? "";
  const clip = first.trim().length > max ? `${first.trim().slice(0, max - 1)}…` : `${first.trim()}${lines.length > 1 ? "…" : ""}`;
  return { short: `${JSON.stringify(clip).slice(0, -1)}"${lines.length > 1 ? ` · ${lines.length} lines` : ""}`, full: v };
}

type I = { p: Piece[]; prec: number };
const ATOM = 100;
const part = (cls: string, kids: Piece[], id?: Id, title?: string): Part => ({ cls, kids, ...(id ? { id } : {}), ...(title ? { title } : {}) });
const kw = (s: string) => part("kw", [s]);
const pn = (s: string) => part("pn", [s]);
const ln = (...line: Piece[]): Blk => ({ line });
const grp = (kids: Blk[], pad = 2, id?: Id, cls?: string): Blk => ({ kids, pad, ...(id ? { id } : {}), ...(cls ? { cls } : {}) });
const commas = (ps: Piece[][]): Piece[] => ps.flatMap((p, i) => (i ? [pn(", "), ...p] : p));
const trimEnd = (ps: Piece[]): Piece[] => {
  if (!ps.length) return ps;
  const last = ps[ps.length - 1];
  return [...ps.slice(0, -1), typeof last === "string" ? last.trimEnd() : { ...last, kids: trimEnd(last.kids) }];
};
// The first line of some blocks, and the rest without it.
const splitFirst = (bs: Blk[]): [Piece[], Blk[]] => {
  const [b, ...rest] = bs;
  if ("line" in b) return [b.line, rest];
  const [first, inner] = splitFirst(b.kids);
  return [first, [...(inner.length ? [{ ...b, kids: inner }] : []), ...rest]];
};
const appendLast = (bs: Blk[], p: Piece): Blk[] => {
  const b = bs[bs.length - 1];
  return [...bs.slice(0, -1), "line" in b ? { ...b, line: [...b.line, p] } : { ...b, kids: appendLast(b.kids, p) }];
};

// `pane`: drawn for the editor, where a long text is clipped and cases
// that say the same thing stay separate rows, each its own node to edit.
// A loose part (editor/drafts.ts) that used variables of its definition
// takes them as inputs: a lambda at its top whose parameters all stand for
// one (`home`, input → variable). Any other lambda there is the part
// itself, a function.
export function looseParts(code: Code, def: Id, home: Record<Id, Id>): { params: Id[]; expr: Id } | null {
  const d = code.nodes[def];
  if (d?.kind !== "def" || !d.body) return null;
  const b = code.nodes[d.body];
  return b?.kind === "lambda" && b.params.length && b.params.every((p) => home[p]) ? { params: b.params, expr: b.body } : { params: [], expr: d.body };
}

// A fold to a function, applied to starting values: a fold with
// accumulators (BACKLOG E62), when every case is a function of the same
// inputs, by name. queens' safe: fold placed from distance = 1.
export function foldFrom(code: Code, n: NodeOf<"call">, nameOf: (id: Id) => string): { fold: NodeOf<"fold">; arms: { arm: NodeOf<"arm">; lam: NodeOf<"lambda"> }[] } | null {
  const f = code.nodes[n.fn];
  if (f?.kind !== "fold" || !n.args.length) return null;
  const arms = f.arms.map((a) => { const arm = code.nodes[a] as NodeOf<"arm">, lam = code.nodes[arm.body]; return { arm, lam: lam.kind === "lambda" ? lam : null }; });
  if (!arms.length || arms.some((x) => x.lam?.params.length !== n.args.length)) return null;
  const ok = arms.every((x) => x.lam!.params.every((p, i) => nameOf(p) === nameOf(arms[0].lam!.params[i])));
  return ok ? { fold: f, arms: arms as { arm: NodeOf<"arm">; lam: NodeOf<"lambda"> }[] } : null;
}

// `loose`: the definition is a loose part, with its inputs' `home`.
export function blocksOf(code: Code, pres: Presentation, info: Info | null, defId: Id, opts: { pane?: boolean; loose?: Record<Id, Id> } = {}): Blk[] {
  const names = pres.names;
  const pane = !!opts.pane;
  // A binder nobody named is called for its type (items, x, event), as the
  // editor names a new parameter; only what isn't a binder shows its id.
  const given = new Map<Id, string>();
  const base = (id: Id) => names[id] ?? given.get(id) ?? (code.nodes[id]?.kind === "builtin" ? (code.nodes[id] as NodeOf<"builtin">).op : `?${id.slice(0, 4)}`);
  const quote = (s: string) => (pres.style.quote && !plain.test(s) ? pres.style.quote[0] + s + pres.style.quote[1] : s);
  const shown = new Map<Id, string>();
  const inScope: Id[] = [];
  const owner = new Map<Id, Id>();
  for (const id of subtree(code, defId)) for (const c of children(code.nodes[id])) owner.set(c, id);
  const usedUnder = (o: Id, id: Id) => { const at = owner.get(id); return !at || owner.get(o) === at || subtree(code, at).some((x) => { const n = code.nodes[x]; return n.kind === "ref" && n.target === o; }); };
  const nameOf = (id: Id) => quote(shown.get(id) ?? base(id));
  const enter = (ids: Id[]) => {
    for (const id of ids) {
      if (!names[id]) given.set(id, paramName(info?.typeOf.get(id), names));
      const b = base(id);
      // An outer one of the same name counts only if it's used where this
      // one is bound: part = (speed, time) => … reads plainly (QA8 L2).
      const clash = inScope.filter((o) => base(o) === b && usedUnder(o, id)).length;
      shown.set(id, clash ? b + String(clash + 1).split("").map((d) => SUB[+d]).join("") : b);
      inScope.push(id);
    }
  };
  const leave = (ids: Id[]) => ids.forEach(() => inScope.pop());
  const typeAt = (id: Id) => { const t = info?.typeOf.get(id); return t ? showIn(t, names, info!.subst) : null; };
  // A name, with its type beside it in the pane.
  const bind = (id: Id): Part => { const t = typeAt(id); return part("bnd", [nameOf(id), ...(t ? [{ cls: "ty", pane: true as const, kids: [`: ${t}`] }] : [])], id); };
  const con = (id: Id) => part("con", [base(id)]);
  const pattern = (p: Pat): Piece[] => patternWith<Piece>(p, bind, con, pn);

  const node = (id: Id) => code.nodes[id];
  const isBool = (n: NodeOf<"match">) => n.arms.length === 2 && n.arms.every((a) => [TRUE, FALSE].includes((node(a) as NodeOf<"arm">).variant));
  const isLet = (n: Node): boolean => n.kind === "call" && node(n.fn).kind === "lambda";
  // A match whose arms are an effect's operations handles it.
  const isHandler = (n: NodeOf<"match">) => {
    const owner = n.arms.length ? info?.owner.get((node(n.arms[0]) as NodeOf<"arm">).variant) : undefined;
    const d = owner ? node(owner) : null;
    return d?.kind === "def" && !!d.body && !!(node(d.body) as { effect?: true }).effect;
  };

  const takesApart = (n: NodeOf<"match">) => takenApart(code, info, n);
  const fromFold = (n: NodeOf<"call">) => (n.args.some(tall) ? null : foldFrom(code, n, base));

  // Steps before a value: lets, and values taken apart.
  const hasSteps = (id: Id) => { const n = node(id); return isLet(n) || (n.kind === "match" && takesApart(n)); };

  // An argument that is an action, a function of nothing, is drawn as what
  // it does, as Scala draws a by-name parameter: count(queens(8)), not
  // count(() => queens(8)). The callee still decides when, and whether, it
  // runs; the tree keeps the lambda, and the pane can still select it.
  const byName = (id: Id): Id => { const n = node(id); return n.kind === "lambda" && n.params.length === 0 ? n.body : id; };
  const word = (nota: Notation | undefined, i: number): Piece[] => (nota?.words?.[i] ? [kw(`${nota.words[i]} `)] : []);

  // Does this expression need lines of its own?
  const tall = (id: Id): boolean => {
    const n = node(id);
    if (n.kind === "match" || n.kind === "fold" || n.kind === "solve" || isLet(n)) return true;
    if (n.kind === "call") return [n.fn, ...n.args].some(tall);
    if (n.kind === "lambda") return tall(n.body);
    return false;
  };

  const paren = (r: I, ok: boolean): Piece[] => (ok ? r.p : [pn("("), ...r.p, pn(")")]);
  const atom = (...p: Piece[]): I => ({ p, prec: ATOM });

  // cons(a, cons(b, nil)) is shown as [a, b]: a list is a notation for
  // nested constructors, nothing more.
  const listItems = (id: Id): Id[] | null => {
    const items: Id[] = [];
    for (let n = node(id); ; ) {
      if (n.kind === "ref" && n.target === NIL) return items;
      if (n.kind !== "call" || node(n.fn).kind !== "ref" || (node(n.fn) as NodeOf<"ref">).target !== CONS) return null;
      items.push(n.args[0]);
      n = node(n.args[1]);
    }
  };

  // One line.
  const inline = (id: Id): I => {
    const n = node(id);
    switch (n.kind) {
      case "lit": {
        // A number written as text (1/2 at Rational) is a number.
        if (typeof n.value !== "string" || n.of !== undefined) return atom(part("lit", [String(n.value)], id));
        if (pane) { const l = litLabel(n.value); return atom(part("lit", [l.short], id, l.full)); }
        return atom(part("lit", [JSON.stringify(n.value)], id));
      }
      case "hole": {
        const hi = info?.holes.get(id);
        // Beside each hole its type alone: "where a is a number type" said
        // on every hole of □ + □ is noise, and the hover says it in full.
        return atom(part("hole", ["□", ...(hi ? [{ cls: "ty", pane: true as const, kids: [showIn(hi.expected, names, info!.subst).replace(/ where .*$/s, "")] }] : [])], id));
      }
      case "ref": {
        const nota = pres.style.notation[n.target];
        const t = node(n.target);
        const cls = t?.kind === "binder" ? "var" : t?.kind === "variant" ? "con" : t?.kind === "def" ? "def" : "fn";
        return atom(part(`ref ${cls}`, [nota && nota.fixity === "call" ? nota.glyph : nameOf(n.target)], id));
      }
      case "lambda": {
        enter(n.params);
        const params = n.params.map(bind);
        const body = inline(n.body).p;
        leave(n.params);
        return { p: [part("lam", [pn("("), ...commas(params.map((b) => [b])), pn(") => "), ...body], id)], prec: 0 };
      }
      case "call": {
        const items = listItems(id);
        if (items) return atom(part("call", [pn("["), ...commas(items.map((i) => inline(i).p)), pn("]")], id));
        const f = node(n.fn);
        const nota = f.kind === "ref" ? pres.style.notation[f.target] : undefined;
        const ops = chainOperands(code, id);
        const args = (ops ?? n.args).map(inline);
        const op = (s: string) => part("op", [s], n.fn);
        if (nota?.fixity === "infix" && ops) {
          // a ++ b ++ c: one chain, whichever way the pairs nest.
          const p = nota.prec ?? 5;
          return { p: [part("call", args.flatMap((a, i) => [...(i ? [op(` ${nota.glyph} `)] : []), ...paren(a, a.prec > p)]), id)], prec: p };
        }
        if (nota?.fixity === "infix" && args.length === 2) {
          const p = nota.prec ?? 5;
          const [l, r] = args;
          const lok = l.prec > p || (l.prec === p && nota.assoc !== "right");
          const rok = r.prec > p || (r.prec === p && nota.assoc !== "left" && nota.assoc !== undefined);
          return { p: [part("call", [...paren(l, lok), op(` ${nota.glyph} `), ...paren(r, rok)], id)], prec: p };
        }
        if (nota?.fixity === "prefix" && args.length === 1) {
          const p = nota.prec ?? 9;
          return { p: [part("call", [op(nota.glyph), ...paren(args[0], args[0].prec > p)], id)], prec: p };
        }
        // A field read is drawn as p.x: it is still the field's projection
        // called on p, the way it runs backwards.
        if (f.kind === "ref" && node(f.target)?.kind === "field" && !isOperation(code, f.target) && args.length === 1) return atom(part("call", [...paren(args[0], args[0].prec >= ATOM), pn("."), part("ref fn", [nameOf(f.target)], n.fn)], id));
        // A named function's name stands for its call, as an operator's
        // glyph does: clicking it picks the whole call (the editor's
        // Change the function is how the name itself is replaced).
        const named = inline(n.fn);
        const head = f.kind === "ref" ? { ...named, p: named.p.map((x) => (typeof x === "string" ? x : { ...x, cls: `${x.cls} head` })) } : named;
        const shownArgs = ops ? args.map((a) => a.p) : n.args.map((a, i) => {
          const b = byName(a), kids = [...word(nota, i), ...inline(b).p];
          return b === a ? kids : [part("lam byname", kids, a)];
        });
        return atom(part("call", [...paren(head, head.prec >= ATOM), pn("("), ...commas(shownArgs), pn(")")], id));
      }
      default: return atom(part(n.kind, [`‹${n.kind}›`], id));
    }
  };

  // A map or a set built from a list written out reads as a table, one
  // row per entry, keys left (DATA-STRUCTURES.md): what it is, not the
  // pairs it is spelled with. Found by its type, whatever builds it.
  const table = (id: Id): { fn: Id; rows: { at: Id; cells: Id[] }[] } | null => {
    const n = node(id), t = info?.typeOf.get(id);
    const r = t ? info!.subst.resolve(t) : null;
    if (n.kind !== "call" || n.args.length !== 1 || r?.t !== "con" || (r.id !== MAP_TYPE && r.id !== SET_TYPE)) return null;
    const items = listItems(n.args[0]);
    if (!items?.length) return null;
    const rows = items.map((x) => {
      const c = node(x);
      if (r.id === SET_TYPE) return { at: x, cells: [x] };
      return c.kind === "call" && node(c.fn).kind === "ref" && (node(c.fn) as NodeOf<"ref">).target === PAIR_V ? { at: x, cells: c.args } : null;
    });
    return rows.every((x) => x) ? { fn: n.fn, rows: rows as { at: Id; cells: Id[] }[] } : null;
  };

  // Lines for an expression. `lead` is what goes before it on its first
  // line ("x = ", "→ ").
  const block = (id: Id, lead: Piece[]): Blk[] => {
    const n = node(id);
    // A block you can click.
    const hold = (kids: Blk[], cls = "blk") => [grp(kids, 0, id, cls)];
    // An implementation reads as its operations, one a line (area: …): it
    // is the interface's record at a type, which no one calls by name.
    const ops = n.kind === "call" ? implementationOps(code, n.fn) : null;
    if (ops && n.kind === "call" && ops.length === n.args.length) {
      const lines = n.args.flatMap((a, i) => block(a, [part("fld", [nameOf(ops[i])], ops[i]), pn(": ")]));
      return hold(lead.length ? [ln(...trimEnd(lead)), grp(lines)] : lines);
    }
    const tab = table(id);
    if (tab && !tab.rows.some((r) => r.cells.some(tall))) {
      //   as map
      //     "one" → 1
      //     "two" → 2
      const cells = tab.rows.map((r) => r.cells.map((c) => inline(c).p));
      const wide = Math.max(...cells.map((c) => pieceText(c[0]).length));
      const rows = tab.rows.map((r, i): Blk => {
        const [k, v] = cells[i];
        return { line: v ? [...k, " ".repeat(wide - pieceText(k).length), pn(" → "), ...v] : k, id: r.at, cls: "entry" };
      });
      return hold([ln(...lead, ...inline(tab.fn).p), grp(rows)], "blk table");
    }
    const items = listItems(id);
    if (items && (tall(id) || pieceText(inline(id).p).length > 70)) {
      // A list of tall items (a page's elements) is still a list: [ … ],
      // one item under another, as on one line.
      const rows = items.flatMap((x, i) => (i < items.length - 1 ? appendLast(block(x, []), pn(",")) : block(x, [])));
      return hold([ln(...lead, pn("[")), grp(rows), ln(pn("]"))]);
    }
    if (!tall(id)) return [ln(...lead, ...inline(id).p)];
    if (n.kind === "call" && isLet(n)) {
      // A run of steps is one column, each step its own line: x = …, then
      // the next, not each one nested inside the one before (the right-
      // nested lets are how the tree holds an order, not how it reads).
      const lam = node(n.fn) as NodeOf<"lambda">;
      // The values can't see the names they're bound to, so show them first.
      enter(lam.params);
      const labels = lam.params.map(bind);
      leave(lam.params);
      // A step done for what it does, that nothing reads, is just the step.
      const unread = (p: Id) => base(p) === "_" || (!names[p] && !subtree(code, lam.body).some((x) => (node(x) as { target?: Id }).target === p));
      const steps = lam.params.flatMap((p, i) => block(n.args[i], unread(p) ? [] : [labels[i], pn(" = ")]));
      enter(lam.params);
      const rest = block(lam.body, lead);
      leave(lam.params);
      return [...hold(steps, "step"), ...rest];
    }
    if (n.kind === "match" && isBool(n)) {
      const arm = (v: Id) => node(n.arms.find((a) => (node(a) as NodeOf<"arm">).variant === v)!) as NodeOf<"arm">;
      const t = arm(TRUE), f = arm(FALSE);
      if (!tall(n.scrutinee) && !tall(t.body) && !tall(f.body)) {
        return [ln(...lead, part("blk", [kw("if "), ...inline(n.scrutinee).p, part("arm", [kw(" then "), ...inline(t.body).p], t.id), part("arm", [kw(" else "), ...inline(f.body).p], f.id)], id))];
      }
      // A tall condition goes under the if, deeper than then and else, so
      // its own arms can't be read as the branches:
      //   if match t
      //       symbol(m) → m = "+"
      //       otherwise → false
      //     then …
      // A let would read as a comparison after the if, so it starts below.
      let head: Blk[];
      if (hasSteps(n.scrutinee)) head = [ln(...lead, kw("if")), grp(block(n.scrutinee, []), 4)];
      else {
        const [first, rest] = splitFirst(block(n.scrutinee, []));
        head = [ln(...lead, kw("if "), ...first), ...(rest.length ? [grp(rest)] : [])];
      }
      // A branch with steps before its value gets then/else on a line of
      // its own, so the steps are inside the branch, not before the word.
      const branch = (a: NodeOf<"arm">, w: string) => grp(hasSteps(a.body) ? [ln(kw(w)), grp(block(a.body, []))] : block(a.body, [kw(`${w} `)]), 2, a.id, "arm");
      return hold([...head, branch(t, "then"), branch(f, "else")]);
    }
    // A match with one case on a type with one case always matches: it is
    // taking the value apart, drawn as a let, pair(x, y) = centre.
    if (n.kind === "match" && takesApart(n)) {
      const arm = node(n.arms[0]) as NodeOf<"arm">;
      enter(arm.binds);
      const pat = [part("arm", pattern({ con: arm.variant, args: arm.binds.map((v) => ({ v })) }), arm.id), pn(" = ")];
      leave(arm.binds);
      const lines = block(n.scrutinee, pat);
      enter(arm.binds);
      const rest = block(arm.body, lead);
      leave(arm.binds);
      return [...hold(lines, "step"), ...rest];
    }
    if (n.kind === "match" || n.kind === "fold") {
      const handles = n.kind === "match" && isHandler(n);
      const arms: Blk[] = [];
      const row = (body: Id, head: Piece[], at?: Id) => arms.push(grp(hang(body, [...head, pn(" → ")]), 0, at, "arm"));
      if (n.kind === "match" && !handles) {
        // A case whose body only takes one of its fields apart further reads
        // as one row per inner case: nested patterns (patterns.ts). Cases
        // that say the same thing read once, as the otherwise; in the pane,
        // editing it edits every copy (sameEverywhere).
        const { rows, otherwise, folded } = sharedOtherwise(code, matchRows(code, info, n), n.otherwise ?? undefined);
        const copies = folded.length + (folded.length && n.otherwise ? 1 : 0);
        for (const r of rows) {
          enter(r.binds);
          row(r.body, pattern(r.pat), r.at);
          leave(r.binds);
        }
        if (otherwise) row(otherwise, [copies && pane ? part("kw", ["otherwise"], undefined, `The same in ${copies} places: changing it changes every one`) : kw("otherwise")]);
      } else {
        for (const a of n.arms) {
          const arm = node(a) as NodeOf<"arm">;
          // An operation answered later binds the rest after its fields,
          // read like a fold's folded values: yield(item) with rest.
          const op = node(arm.variant) as NodeOf<"variant">;
          const later = handles && op.later && arm.binds.length === op.fields.length + 1;
          const fields = later ? arm.binds.slice(0, -1) : arm.binds;
          const results = later ? [arm.binds[arm.binds.length - 1]] : arm.results.filter((r): r is Id => r !== null);
          enter([...fields, ...results]);
          row(arm.body, [...pattern({ con: arm.variant, args: fields.map((v) => ({ v })) }), ...(results.length ? [kw(" with "), ...commas(results.map((r) => [bind(r)]))] : [])], a);
          leave([...fields, ...results]);
        }
        if (n.kind === "match" && n.otherwise) row(n.otherwise, [kw("otherwise")]);
      }
      return hold([ln(...lead, kw(`${handles ? "handle" : n.kind} `), ...inline(n.scrutinee).p), grp(arms)]);
    }
    if (n.kind === "solve") {
      // A use of a definition with results, in the direction it declares
      // (RESULTS.md): length, angle = polar(x, y), the results side by side.
      const f = node(n.fn);
      const lam = f?.kind === "def" && f.results && f.body ? node(f.body) : null;
      if (f?.kind === "def" && f.results && lam?.kind === "lambda") {
        const results = f.results, ins = lam.params.filter((p) => !results.includes(p));
        const outTrue = node(n.given.out)?.kind === "ref" && (node(n.given.out) as NodeOf<"ref">).target === TRUE;
        const declared = Object.keys(n.given).length === ins.length + 1 && ins.every((p) => p in n.given) && Object.keys(n.binds).length === results.length && results.every((r) => r in n.binds);
        // Another direction names what it's given, and its results are
        // the ports it binds, in the definition's order.
        const ports = lam.params, other = Object.keys(n.given).every((k) => k === "out" || ports.includes(k)) && Object.keys(n.binds).every((k) => ports.includes(k));
        if (outTrue && (declared || other)) {
          const order = declared ? results : ports.filter((p) => p in n.binds);
          const bound = order.map((r) => n.binds[r]);
          const args = declared ? ins.map((p) => inline(n.given[p]).p) : ports.filter((p) => p in n.given).map((p) => [pn(`${portLabel(code, names, n.fn, p)} = `), ...inline(n.given[p]).p]);
          enter(bound);
          const out = hold([ln(...lead, ...commas(bound.map((b) => [bind(b)])), pn(" = "), part("ref fn", [nameOf(n.fn)], n.fn), pn("("), ...commas(args), pn(")")), grp(block(n.body, []))]);
          leave(bound);
          return out;
        }
      }
      // solve polar(x = …, y = …) for length, angle as r, θ
      const label = (k: string) => (k === "out" ? "result" : portLabel(code, names, n.fn, k));
      const givenArgs = commas(Object.entries(n.given).map(([k, e]) => [pn(`${label(k)} = `), ...inline(e).p]));
      const bound = Object.values(n.binds);
      enter(bound);
      const wanted = commas(Object.entries(n.binds).map(([k, b]) => (nameOf(b) === label(k) ? [bind(b)] : [pn(`${label(k)} as `), bind(b)])));
      const out = hold([ln(...lead, kw("solve "), part("ref fn", [nameOf(n.fn)], n.fn), pn("("), ...givenArgs, pn(")"), kw(" for "), ...wanted), grp(block(n.body, []))]);
      leave(bound);
      return out;
    }
    if (n.kind === "lambda") {
      enter(n.params);
      const out = hold([ln(...lead, pn("("), ...commas(n.params.map((p) => [bind(p)])), pn(") =>")), grp(block(n.body, []))]);
      leave(n.params);
      return out;
    }
    if (n.kind === "call") {
      // A call with a tall argument: the tall parts go on their own lines.
      const f = node(n.fn);
      const head = f.kind === "ref" ? [part("ref fn", [nameOf(f.target)], n.fn)] : [pn("("), ...inline(n.fn).p, pn(")")];
      // An operator's operands one under another, each after the operator:
      //   show(…)
      //   ++ " · "
      //   ++ handle …
      const nota = f.kind === "ref" ? pres.style.notation[f.target] : undefined;
      const ops = chainOperands(code, id) ?? n.args;
      if (nota?.fixity === "infix" && ops.length >= 2) {
        const p = nota.prec ?? 5;
        const one = (a: Id, lead: Piece[]): Blk[] => {
          if (!tall(a)) { const r = inline(a); return [ln(...lead, ...paren(r, r.prec > p))]; }
          const lines = block(a, []);
          // An if on one line takes in everything after its else, so as an
          // operand it is bracketed: (if c < 0 then "-" else "") ++ …
          const an = node(a);
          return lines.length === 1 && "line" in lines[0] && an.kind === "match" && isBool(an) ? [ln(...lead, pn("("), ...lines[0].line, pn(")"))] : block(a, lead);
        };
        return hold(ops.flatMap((a, i) => one(a, i ? [part("op", [`${nota.glyph} `], n.fn)] : lead)));
      }
      // A fold to a function, applied: what queens' safe does to thread a
      // distance through the fold. It reads as a fold with an accumulator,
      // from its starting value, each case given the accumulator by name:
      //   fold placed from distance = 1
      //     cons(queen, others) with ‹others safe› → … ‹others safe›(distance + 1)
      // When every case is a function of the same inputs, by name. Two or
      // more: from (from = zero′, r = ‹if zero›()).
      const from = fromFold(n);
      if (from) {
        const starts = n.args.map((a) => inline(a).p);
        const arms: Blk[] = from.arms.map(({ arm, lam }) => {
          const results = arm.results.filter((r): r is Id => r !== null);
          enter([...arm.binds, ...results, ...lam.params]);
          const b = grp(hang(lam.body, [...pattern({ con: arm.variant, args: arm.binds.map((v) => ({ v })) }), ...(results.length ? [kw(" with "), ...commas(results.map((r) => [bind(r)]))] : []), pn(" → ")]), 0, arm.id, "arm");
          leave([...arm.binds, ...results, ...lam.params]);
          return b;
        });
        const inits = commas(from.arms[0].lam.params.map((x, i) => [bind(x), pn(" = "), ...starts[i]]));
        const many = n.args.length > 1 ? [pn("("), ...inits, pn(")")] : inits;
        return hold([ln(...lead, kw("fold "), ...inline(f.kind === "fold" ? f.scrutinee : n.fn).p, kw(" from "), ...many), grp(arms)]);
      }
      if (n.args.every((a) => !tall(a)) && tall(n.fn)) return hold([...block(n.fn, [...lead, kw("apply ")]), grp([ln(kw("to "), pn("("), ...commas(n.args.map((a) => inline(a).p)), pn(")"))])]);
      const args = ops.map((a, i) => {
        const b = ops === n.args ? byName(a) : a;
        const lines = b === a ? block(a, ops === n.args ? word(nota, i) : []) : [grp(block(b, word(nota, i)), 0, a, "lam byname")];
        return i < ops.length - 1 ? appendLast(lines, pn(",")) : lines;
      });
      return hold([ln(...lead, ...head, pn("(")), grp(args.flat()), ln(pn(")"))]);
    }
    return [ln(...lead, ...inline(id).p)];
  };
  const hang = (id: Id, head: Piece[]): Blk[] => (tall(id) ? [ln(...trimEnd(head)), grp(block(id, []))] : block(id, head));

  const def = node(defId) as NodeOf<"def">;
  const body = def.body ? node(def.body) : null;
  const out: Blk[] = [];
  const self = () => part("def", [nameOf(defId)], defId);
  const comment = pres.comments[defId];
  if (comment) out.push({ line: [`-- ${resolveRefs(comment, nameOf)}`], cls: "cmt" });
  if (body?.kind === "typedef") {
    enter(body.params);
    out.push(ln(kw(`${body.effect ? "effect" : body.interface ? "interface" : "type"} `), self(), ...body.params.flatMap((p) => [" ", bind(p)])));
    // An interface reads as its operations and their types: its one case
    // is how it is held, a record, not something anyone writes.
    if (body.interface) {
      out.push(grp((node(body.variants[0]) as NodeOf<"variant">).fields.map((f) => ({ line: [part("fld", [nameOf(f), part("ty", [` : ${typeText((node(f) as NodeOf<"field">).type)}`])], f)], id: f, cls: "variant" }))));
      return out;
    }
    out.push(grp(body.variants.map((v) => {
      const vn = node(v) as NodeOf<"variant">;
      const fs = vn.fields.map((f) => [part("fld", [nameOf(f), part("ty", [`: ${typeText((node(f) as NodeOf<"field">).type)}`])], f)]);
      return { line: [pn("| "), con(v), ...(fs.length ? [pn("("), ...commas(fs), pn(")")] : []), ...(vn.returns ? [kw(" returns "), part("ty", [typeText(vn.returns)])] : []), ...(vn.returns && vn.later ? [kw(", later")] : [])], id: v, cls: "variant" };
    })));
    return out;
  }
  // A loose part (editor/drafts.ts) reads as the expression it is, with the
  // variables it uses by their names: not as a function named _1.
  const lp = opts.loose && body ? looseParts(code, defId, opts.loose) : null;
  if (lp) {
    const { params, expr } = lp;
    enter(params);
    out.push(...hang(expr, [part("def", ["loose"], defId), pn(": ")]));
    leave(params);
    return out;
  }
  // A definition with results shows the direction it declares: its inputs,
  // the effects of finding its results, and the results by name.
  const shape = def.results && body?.kind === "lambda" ? body : null;
  const effs = info?.directions?.get(defId);
  const t = shape && effs && shape.params.every((p) => typeAt(p))
    ? `(${shape.params.filter((p) => !def.results!.includes(p)).map(typeAt).join(", ")}) ${effs.length ? `-[${effs.map(nameOf).join(", ")}]->` : "->"} ${def.results!.map((r) => `${nameOf(r)}: ${typeAt(r)}`).join(", ")}`
    : typeAt(defId);
  if (t) out.push(ln(self(), part("ty big", [` : ${t}`])));
  if (!body) return [...out, ln(self(), pn(" = "), kw("extern"))];
  if (body.kind === "lambda") {
    enter(body.params);
    // A definition with results shows them after its inputs (RESULTS.md),
    // and when each is an expression of the inputs, `= e1, e2` for
    // `r1 = e1 and r2 = e2`.
    const results = def.results ?? [];
    const head = [self(), pn("("), ...commas(body.params.filter((p) => !results.includes(p)).map((p) => [bind(p)])), pn(")")];
    const each = results.length ? givenBy(body.body, results) : null;
    if (each) out.push(ln(...head, pn(" → "), ...commas(results.map((r) => [bind(r)])), pn(" = "), ...commas(each.map((e) => inline(e).p))));
    else out.push(...hang(body.body, results.length ? [...head, pn(" → "), ...commas(results.map((r) => [bind(r)])), pn(" = ")] : [...head, pn(" = ")]));
    leave(body.params);
  } else out.push(...hang(def.body!, [self(), pn(" = ")]));
  return out;

  // The expression each result equals, in order, when the body is just
  // `r1 = e1 and r2 = e2 …` with no result inside any e; null otherwise.
  function givenBy(b: Id, results: Id[]): Id[] | null {
    const parts: Id[] = [];
    const calls = (n: Node, f: Id) => n.kind === "call" && n.args.length === 2 && node(n.fn)?.kind === "ref" && (node(n.fn) as NodeOf<"ref">).target === f;
    const flat = (id: Id) => { const n = node(id); if (calls(n, S.and) && n.kind === "call") { flat(n.args[0]); flat(n.args[1]); } else parts.push(id); };
    flat(b);
    if (parts.length !== results.length) return null;
    const isRef = (id: Id, r: Id) => { const n = node(id); return n.kind === "ref" && n.target === r; };
    const mentions = (id: Id) => subtree(code, id).some((x) => { const n = node(x); return n.kind === "ref" && results.includes(n.target); });
    const out = results.map((r, i) => {
      const n = node(parts[i]);
      if (!calls(n, S.equal) || n.kind !== "call") return null;
      const [a, c] = n.args;
      const e = isRef(a, r) ? c : isRef(c, r) ? a : null;
      return e && !mentions(e) ? e : null;
    });
    return out.every((e): e is Id => e !== null) ? out : null;
  }

  function typeText(id: Id): string {
    const n = node(id);
    if (n.kind === "tfun") return `(${n.params.map(typeText).join(", ")}) ${n.effects?.length ? `-[${n.effects.map(nameOf).join(", ")}]->` : "->"} ${typeText(n.result)}`;
    const r = n as NodeOf<"tref">;
    return [nameOf(r.target), ...r.args.map((a) => { const s = typeText(a); return s.includes(" ") ? `(${s})` : s; })].join(" ");
  }
}
