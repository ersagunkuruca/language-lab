// Shared pieces for the text-ish views: applying a notation, parenthesizing
// by precedence, and attaching comments. Parentheses are computed here, at
// display time; the tree never contains them.

import type { Code, Id, Node } from "../model.ts";
import type { Presentation } from "../presentation.ts";
import type { Namer } from "./namer.ts";

export interface R { text: string; prec: number }
export const ATOM = 100;
export const atom = (text: string): R => ({ text, prec: ATOM });

const paren = (r: R, ok: boolean) => (ok ? r.text : `(${r.text})`);

export function callText(pres: Presentation, namer: Namer, fn: Node, args: R[], fnText: () => R): R {
  const head = fn.kind === "ref" ? fn.target : null;
  const nota = head ? pres.style.notation[head] : undefined;
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
  const name = head ? nota?.glyph ?? namer.name(head) : paren(fnText(), fnText().prec === ATOM);
  return atom(`${name}(${args.map((a) => a.text).join(", ")})`);
}

// Comments that can't sit on their own line are shown as numbered footnotes.
export class Footnotes {
  private notes: string[] = [];
  private pres: Presentation;
  private namer: Namer;

  constructor(pres: Presentation, namer: Namer) {
    this.pres = pres;
    this.namer = namer;
  }

  mark(id: Id, r: R): R {
    const c = comment(this.pres, this.namer, id);
    if (c === undefined) return r;
    this.notes.push(c);
    return atom(`${paren(r, r.prec === ATOM)}[${this.notes.length}]`);
  }

  lines(): string[] {
    return this.notes.map((c, i) => `  [${i + 1}] ${c}`);
  }
}

// Comments are structured too: "{3fa2c19e}" inside a comment is a reference
// to that node and is shown with its current display name, so renaming a
// variable updates the prose that talks about it.
export function comment(pres: Presentation, namer: Namer, id: Id): string | undefined {
  const c = pres.style.comments === false ? undefined : pres.comments[id];
  return c?.replace(/\{([0-9a-f]{8})\}/g, (_, ref) => namer.name(ref));
}

export function lambdaText(code: Code, namer: Namer, params: Id[], body: R): R {
  return { text: `(${params.map((p) => namer.name(p)).join(", ")}) => ${body.text}`, prec: 0 };
}
