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
import { resolveRefs, subtree } from "../model.ts";
import type { Notation, Presentation } from "../presentation.ts";
import { atom, type R } from "../render/expr.ts";
import { portLabel } from "./equations.ts";
import type { Info } from "./infer.ts";
import { matchRows, patternText, sharedOtherwise } from "./patterns.ts";
import { paramName } from "./refactor.ts";
import { chainOperands, CONS, FALSE, NIL, TRUE } from "./std.ts";
import { showIn, showType } from "./types.ts";

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

export function renderBlocks(code: Code, pres: Presentation, info: Info | null, defId: Id): string {
  const names = pres.names;
  // A binder nobody named is called for its type (items, x, event), as the
  // editor names a new parameter; only what isn't a binder shows its id.
  const given = new Map<Id, string>();
  const base = (id: Id) => names[id] ?? given.get(id) ?? (code.nodes[id]?.kind === "builtin" ? (code.nodes[id] as NodeOf<"builtin">).op : `?${id.slice(0, 4)}`);
  const quote = (s: string) => (pres.style.quote && !plain.test(s) ? pres.style.quote[0] + s + pres.style.quote[1] : s);
  const shown = new Map<Id, string>();
  const inScope: Id[] = [];
  const nameOf = (id: Id) => quote(shown.get(id) ?? base(id));
  const enter = (ids: Id[]) => {
    for (const id of ids) {
      if (!names[id]) given.set(id, paramName(info?.typeOf.get(id), names));
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
  // A match whose arms are an effect's operations handles it.
  const isHandler = (n: NodeOf<"match">) => {
    const owner = n.arms.length ? info?.owner.get((node(n.arms[0]) as NodeOf<"arm">).variant) : undefined;
    const d = owner ? node(owner) : null;
    return d?.kind === "def" && !!d.body && !!(node(d.body) as { effect?: true }).effect;
  };

  const takesApart = (n: NodeOf<"match">) => takenApart(code, info, n);

  // Steps before a value: lets, and values taken apart.
  const hasSteps = (id: Id) => { const n = node(id); return isLet(n) || (n.kind === "match" && takesApart(n)); };

  // An argument that is an action, a function of nothing, is drawn as what
  // it does, as Scala draws a by-name parameter: count(queens(8)), not
  // count(() => queens(8)). The callee still decides when, and whether, it
  // runs; the tree keeps the lambda.
  const byName = (id: Id): Id => { const n = node(id); return n.kind === "lambda" && n.params.length === 0 ? n.body : id; };
  const word = (nota: Notation | undefined, i: number) => (nota?.words?.[i] ? `${nota.words[i]} ` : "");

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
      case "lit": return atom(typeof n.value === "string" && n.of === undefined ? JSON.stringify(n.value) : String(n.value));
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
        const ops = chainOperands(code, id);
        const args = (ops ?? n.args).map(inline);
        if (nota?.fixity === "infix" && ops) {
          // a ++ b ++ c: one chain, whichever way the pairs nest.
          const p = nota.prec ?? 5;
          return { text: args.map((a) => paren(a, a.prec > p)).join(` ${nota.glyph} `), prec: p };
        }
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
        // A field read is drawn as p.x: it is still the field's projection
        // called on p, the way it runs backwards.
        if (f.kind === "ref" && node(f.target)?.kind === "field" && args.length === 1) return atom(`${paren(args[0], args[0].prec >= 100)}.${nameOf(f.target)}`);
        const head = inline(n.fn);
        return atom(`${paren(head, head.prec >= 100)}(${ops ? args.map((a) => a.text).join(", ") : n.args.map((a, i) => word(nota, i) + inline(byName(a)).text).join(", ")})`);
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
      // A step done for what it does, that nothing reads, is just the step.
      const unread = (p: Id) => base(p) === "_" || (!names[p] && !subtree(code, lam.body).some((x) => (node(x) as { target?: Id }).target === p));
      const lines = lam.params.flatMap((p, i) => block(n.args[i], ind, unread(p) ? "" : `${labels[i]} = `));
      enter(lam.params);
      const rest = block(lam.body, ind, lead);
      leave(lam.params);
      return [...lines, ...rest];
    }
    if (n.kind === "match" && isBool(n)) {
      const arm = (v: Id) => node(n.arms.find((a) => (node(a) as NodeOf<"arm">).variant === v)!) as NodeOf<"arm">;
      const t = arm(TRUE).body, f = arm(FALSE).body;
      if (!tall(n.scrutinee) && !tall(t) && !tall(f)) return [`${ind}${lead}if ${inline(n.scrutinee).text} then ${inline(t).text} else ${inline(f).text}`];
      // A tall condition goes under the if, deeper than then and else, so
      // its own arms can't be read as the branches:
      //   if match t
      //       symbol(m) → m = "+"
      //       otherwise → false
      //     then …
      // A let would read as a comparison after the if, so it starts below.
      const below = hasSteps(n.scrutinee);
      const cond = block(n.scrutinee, ind + (below ? "    " : "  "), "");
      const head = below ? [`${ind}${lead}if`, ...cond] : [`${ind}${lead}if ${cond[0].trimStart()}`, ...cond.slice(1)];
      // A branch with steps before its value gets then/else on a line of
      // its own, so the steps are inside the branch, not before the word.
      const branch = (b: Id, word: string) => (hasSteps(b) ? [`${ind}  ${word}`, ...block(b, ind + "    ", "")] : block(b, ind + "  ", `${word} `));
      return [...head, ...branch(t, "then"), ...branch(f, "else")];
    }
    // A match with one case on a type with one case always matches: it is
    // taking the value apart, drawn as a let, pair(x, y) = centre.
    if (n.kind === "match" && takesApart(n)) {
      const arm = node(n.arms[0]) as NodeOf<"arm">;
      enter(arm.binds);
      const pat = `${base(arm.variant)}(${arm.binds.map(nameOf).join(", ")}) = `;
      leave(arm.binds);
      const lines = block(n.scrutinee, ind, pat);
      enter(arm.binds);
      const rest = block(arm.body, ind, lead);
      leave(arm.binds);
      return [...lines, ...rest];
    }
    if (n.kind === "match" || n.kind === "fold") {
      const out = [`${ind}${lead}${n.kind === "match" && isHandler(n) ? "handle" : n.kind} ${inline(n.scrutinee).text}`];
      // A case whose body only takes one of its fields apart further reads
      // as one row per inner case: nested patterns (patterns.ts).
      if (n.kind === "match" && !isHandler(n)) {
        const { rows, otherwise } = sharedOtherwise(code, matchRows(code, info, n), n.otherwise ?? undefined);
        for (const row of rows) {
          enter(row.binds);
          out.push(...hang(row.body, ind + "  ", `${patternText(row.pat, nameOf, base)} → `));
          leave(row.binds);
        }
        if (otherwise) out.push(...hang(otherwise, ind + "  ", "otherwise → "));
        return out;
      }
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
      // An operator's operands one under another, each after the operator:
      //   show(…)
      //   ++ " · "
      //   ++ handle …
      const nota = f.kind === "ref" ? pres.style.notation[f.target] : undefined;
      const ops = chainOperands(code, id) ?? n.args;
      if (nota?.fixity === "infix" && ops.length >= 2) {
        const p = nota.prec ?? 5;
        const one = (a: Id, lead: string) => {
          if (!tall(a)) return [`${ind}${lead}${paren(inline(a), inline(a).prec > p)}`];
          const lines = block(a, ind, "");
          // An if on one line takes in everything after its else, so as an
          // operand it is bracketed: (if c < 0 then "-" else "") ++ …
          const an = node(a);
          return lines.length === 1 && an.kind === "match" && isBool(an) ? [`${ind}${lead}(${lines[0].slice(ind.length)})`] : block(a, ind, lead);
        };
        return ops.flatMap((a, i) => one(a, i ? `${nota.glyph} ` : lead));
      }
      if (n.args.every((a) => !tall(a)) && tall(n.fn)) return [...block(n.fn, ind, `${lead}apply `), `${ind}  to (${n.args.map((a) => inline(a).text).join(", ")})`];
      const args = ops.map((a, i) => {
        const lines = block(ops === n.args ? byName(a) : a, ind + "  ", ops === n.args ? word(nota, i) : "");
        if (i < ops.length - 1) lines[lines.length - 1] += ",";
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
  if (comment) out.push(`-- ${resolveRefs(comment, nameOf)}`);
  if (body?.kind === "typedef") {
    enter(body.params);
    const head = `${body.effect ? "effect" : "type"} ${nameOf(defId)}${body.params.map((p) => " " + nameOf(p)).join("")}`;
    out.push(head);
    for (const v of body.variants) {
      const vn = node(v) as NodeOf<"variant">;
      const fs = vn.fields.map((f) => `${nameOf(f)}: ${typeText((node(f) as NodeOf<"field">).type)}`);
      out.push(`  | ${nameOf(v)}${fs.length ? `(${fs.join(", ")})` : ""}${vn.returns ? ` returns ${typeText(vn.returns)}` : ""}`);
    }
    return out.join("\n");
  }
  const t = info?.typeOf.get(defId);
  if (t) out.push(`${nameOf(defId)} : ${showIn(t, names, info!.subst)}`);
  if (!body) return [...out, `${nameOf(defId)} = extern`].join("\n");
  if (body.kind === "lambda") {
    enter(body.params);
    out.push(...hang(body.body, "", `${nameOf(defId)}(${body.params.map(nameOf).join(", ")}) = `));
    leave(body.params);
  } else out.push(...hang(def.body!, "", `${nameOf(defId)} = `));
  return out.join("\n");

  function typeText(id: Id): string {
    const n = node(id);
    if (n.kind === "tfun") return `(${n.params.map(typeText).join(", ")}) ${n.effects?.length ? `-[${n.effects.map(nameOf).join(", ")}]->` : "->"} ${typeText(n.result)}`;
    const r = n as NodeOf<"tref">;
    return [nameOf(r.target), ...r.args.map((a) => { const s = typeText(a); return s.includes(" ") ? `(${s})` : s; })].join(" ");
  }
}
