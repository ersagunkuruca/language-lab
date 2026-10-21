// The block view: what a typed program looks like to someone who reads code
// as indented blocks. Case analyses become indented arms, `if` is just how a
// match on Bool is shown, an immediately applied function is shown as
// `name = value` lines, and every definition is headed by its inferred type
// (inferred, not written: the type is a view too).
//
// Naming is scope-aware: two binders get a subscript only when both are
// visible at the same point, since that's the only time they could be
// confused on screen.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import type { Presentation } from "../presentation.ts";
import { atom, type R } from "../render/expr.ts";
import { portLabel } from "../relational.ts";
import type { Info } from "./infer.ts";
import { CONS, FALSE, NIL, TRUE } from "./std.ts";
import { showType } from "./types.ts";

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const plain = /^[\p{L}_][\p{L}\p{N}_'′]*$/u;

export function renderBlocks(code: Code, pres: Presentation, info: Info | null, defId: Id): string {
  const names = pres.names;
  const base = (id: Id) => names[id] ?? (code.nodes[id]?.kind === "builtin" ? (code.nodes[id] as NodeOf<"builtin">).op : `?${id.slice(0, 4)}`);
  const quote = (s: string) => (pres.style.quote && !plain.test(s) ? pres.style.quote[0] + s + pres.style.quote[1] : s);
  const shown = new Map<Id, string>();
  const inScope: Id[] = [];
  const nameOf = (id: Id) => quote(shown.get(id) ?? base(id));
  const enter = (ids: Id[]) => {
    for (const id of ids) {
      const b = base(id);
      const clash = inScope.filter((o) => base(o) === b).length;
      shown.set(id, clash ? b + String(clash + 1).split("").map((d) => SUB[+d]).join("") : b);
      inScope.push(id);
    }
  };
  const leave = (ids: Id[]) => ids.forEach(() => inScope.pop());

  const node = (id: Id) => code.nodes[id];
  const isBool = (n: NodeOf<"match">) => n.arms.length === 2 && n.arms.every((a) => [TRUE, FALSE].includes((node(a) as NodeOf<"arm">).variant));
  const isLet = (n: Node): boolean => n.kind === "call" && node(n.fn).kind === "lambda";

  // Does this expression need lines of its own?
  const tall = (id: Id): boolean => {
    const n = node(id);
    if (n.kind === "match" || n.kind === "fold" || n.kind === "solve" || isLet(n)) return true;
    if (n.kind === "call") return [n.fn, ...n.args].some(tall);
    if (n.kind === "lambda") return tall(n.body);
    return false;
  };

  const paren = (r: R, ok: boolean) => (ok ? r.text : `(${r.text})`);

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
  const inline = (id: Id): R => {
    const n = node(id);
    switch (n.kind) {
      case "lit": return atom(typeof n.value === "string" ? JSON.stringify(n.value) : String(n.value));
      case "hole": return atom("□");
      case "ref": {
        const nota = pres.style.notation[n.target];
        return atom(nota && nota.fixity === "call" ? nota.glyph : nameOf(n.target));
      }
      case "lambda": {
        enter(n.params);
        const body = inline(n.body).text;
        leave(n.params);
        return { text: `(${n.params.map(nameOf).join(", ")}) => ${body}`, prec: 0 };
      }
      case "call": {
        const items = listItems(id);
        if (items) return atom(`[${items.map((i) => inline(i).text).join(", ")}]`);
        const f = node(n.fn);
        const nota = f.kind === "ref" ? pres.style.notation[f.target] : undefined;
        const args = n.args.map(inline);
        if (nota?.fixity === "infix" && args.length === 2) {
          const p = nota.prec ?? 5;
          const [l, r] = args;
          const lok = l.prec > p || (l.prec === p && nota.assoc !== "right");
          const rok = r.prec > p || (r.prec === p && nota.assoc !== "left" && nota.assoc !== undefined);
          return { text: `${paren(l, lok)} ${nota.glyph} ${paren(r, rok)}`, prec: p };
        }
        if (nota?.fixity === "prefix" && args.length === 1) {
          const p = nota.prec ?? 9;
          return { text: `${nota.glyph}${paren(args[0], args[0].prec > p)}`, prec: p };
        }
        const head = inline(n.fn);
        return atom(`${paren(head, head.prec >= 100)}(${args.map((a) => a.text).join(", ")})`);
      }
      default: return atom(`‹${n.kind}›`);
    }
  };

  // Lines for an expression in a block. `lead` is what goes before it on
  // its first line ("return ", "x = ", "→ ").
  const block = (id: Id, ind: string, lead: string): string[] => {
    const n = node(id);
    const items = listItems(id);
    if (items && (tall(id) || inline(id).text.length > 70)) {
      return [`${ind}${lead}[`, ...items.flatMap((x, i) => {
        const lines = block(x, ind + "  ", "");
        if (i < items.length - 1) lines[lines.length - 1] += ",";
        return lines;
      }), `${ind}]`];
    }
    if (!tall(id)) return [ind + lead + inline(id).text];
    if (n.kind === "call" && isLet(n)) {
      const lam = node(n.fn) as NodeOf<"lambda">;
      // The values can't see the names they're bound to, so show them first.
      enter(lam.params);
      const labels = lam.params.map(nameOf);
      leave(lam.params);
      const lines = lam.params.flatMap((p, i) => block(n.args[i], ind, base(p) === "_" ? "" : `${labels[i]} = `));
      enter(lam.params);
      const rest = block(lam.body, ind, lead);
      leave(lam.params);
      return [...lines, ...rest];
    }
    if (n.kind === "match" && isBool(n)) {
      const arm = (v: Id) => node(n.arms.find((a) => (node(a) as NodeOf<"arm">).variant === v)!) as NodeOf<"arm">;
      const cond = inline(n.scrutinee).text;
      const t = arm(TRUE).body, f = arm(FALSE).body;
      if (!tall(t) && !tall(f)) return [`${ind}${lead}if ${cond} then ${inline(t).text} else ${inline(f).text}`];
      return [`${ind}${lead}if ${cond}`, ...block(t, ind + "  ", "then "), ...block(f, ind + "  ", "else ")];
    }
    if (n.kind === "match" || n.kind === "fold") {
      const out = [`${ind}${lead}${n.kind} ${inline(n.scrutinee).text}`];
      for (const a of n.arms) {
        const arm = node(a) as NodeOf<"arm">;
        const results = arm.results.filter((r): r is Id => r !== null);
        enter([...arm.binds, ...results]);
        const pat = arm.binds.length ? `${base(arm.variant)}(${arm.binds.map(nameOf).join(", ")})` : base(arm.variant);
        const head = `${pat}${results.length ? ` with ${results.map(nameOf).join(", ")}` : ""} → `;
        out.push(...hang(arm.body, ind + "  ", head));
        leave([...arm.binds, ...results]);
      }
      if (n.kind === "match" && n.otherwise) out.push(...hang(n.otherwise, ind + "  ", "otherwise → "));
      return out;
    }
    if (n.kind === "solve") {
      // solve polar(x = …, y = …) for length, angle as r, θ
      const label = (k: string) => (k === "out" ? "result" : portLabel(code, names, n.fn, k));
      const given = Object.entries(n.given).map(([k, e]) => `${label(k)} = ${inline(e).text}`).join(", ");
      const bound = Object.values(n.binds);
      enter(bound);
      const wanted = Object.entries(n.binds).map(([k, b]) => (nameOf(b) === label(k) ? label(k) : `${label(k)} as ${nameOf(b)}`)).join(", ");
      const out = [`${ind}${lead}solve ${nameOf(n.fn)}(${given}) for ${wanted}`, ...block(n.body, ind + "  ", "")];
      leave(bound);
      return out;
    }
    if (n.kind === "lambda") {
      enter(n.params);
      const out = [`${ind}${lead}(${n.params.map(nameOf).join(", ")}) =>`, ...block(n.body, ind + "  ", "")];
      leave(n.params);
      return out;
    }
    if (n.kind === "call") {
      // A call with a tall argument: the tall parts go on their own lines.
      const f = node(n.fn);
      const head = f.kind === "ref" ? nameOf(f.target) : `(${inline(n.fn).text})`;
      if (n.args.every((a) => !tall(a)) && tall(n.fn)) return [...block(n.fn, ind, `${lead}apply `), `${ind}  to (${n.args.map((a) => inline(a).text).join(", ")})`];
      const args = n.args.map((a, i) => {
        const lines = block(a, ind + "  ", "");
        if (i < n.args.length - 1) lines[lines.length - 1] += ",";
        return lines;
      });
      return [`${ind}${lead}${head}(`, ...args.flat(), `${ind})`];
    }
    return [ind + lead + inline(id).text];
  };
  const hang = (id: Id, ind: string, head: string) => (tall(id) ? [ind + head.trimEnd(), ...block(id, ind + "  ", "")] : block(id, ind, head));

  const def = node(defId) as NodeOf<"def">;
  const body = def.body ? node(def.body) : null;
  const out: string[] = [];
  const comment = pres.comments[defId];
  if (comment) out.push(`-- ${comment}`);
  if (body?.kind === "typedef") {
    enter(body.params);
    const head = `type ${nameOf(defId)}${body.params.map((p) => " " + nameOf(p)).join("")}`;
    out.push(head);
    for (const v of body.variants) {
      const fs = (node(v) as NodeOf<"variant">).fields.map((f) => `${nameOf(f)}: ${typeText((node(f) as NodeOf<"field">).type)}`);
      out.push(`  | ${nameOf(v)}${fs.length ? `(${fs.join(", ")})` : ""}`);
    }
    return out.join("\n");
  }
  const t = info?.typeOf.get(defId);
  if (t) out.push(`${nameOf(defId)} : ${showType(t, names)}`);
  if (!body) return [...out, `${nameOf(defId)} = extern`].join("\n");
  if (body.kind === "lambda") {
    enter(body.params);
    out.push(...hang(body.body, "", `${nameOf(defId)}(${body.params.map(nameOf).join(", ")}) = `));
    leave(body.params);
  } else out.push(...hang(def.body!, "", `${nameOf(defId)} = `));
  return out.join("\n");

  function typeText(id: Id): string {
    const n = node(id);
    if (n.kind === "tfun") return `(${n.params.map(typeText).join(", ")}) -> ${typeText(n.result)}`;
    const r = n as NodeOf<"tref">;
    return [nameOf(r.target), ...r.args.map((a) => { const s = typeText(a); return s.includes(" ") ? `(${s})` : s; })].join(" ");
  }
}
