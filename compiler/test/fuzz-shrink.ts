// A generated definition that differs cut down (T18c, EPHYRA-LESSONS-2026-11-27):
// one part of its body at a time is replaced by a part under it (a call
// by one of its arguments, a match by one of its arms' bodies, a function
// written in place by its body), kept when the program still checks and
// the same engine still differs on that definition, until no cut is kept
// or the budget runs out. Cuts only delete, so what is left is a part of
// what was generated and stays typed when the checker says so. Only that
// definition is compiled and compared while cutting.
//
// Influence: the deletion-only, type-keeping reducers of Ephyra's OCaml
// and rustc harnesses (datadog-labs/ephyra, case-studies), which compile
// only the configuration that failed while shrinking; delta debugging
// (Zeller and Hildebrandt, 2002) behind them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { children, withNodes, type Code, type Id, type Node } from "../../ters/src/model.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { checkOptions } from "../../ters/src/lang/load.ts";
import { renderBlocks } from "../../ters/src/lang/render.ts";
import type { program } from "./fuzz-programs.ts";

type Program = ReturnType<typeof program>;
type Difference = { i: number; j: number; engine: string; text: string };

// The parts a cut may replace, and put in another's place.
const EXPRESSION = new Set(["call", "match", "lambda", "ref", "lit"]);

// What may stand in for the node at `at`: the expressions under it, at most
// two levels down (an arm's body under a match), nearest first.
function standIns(nodes: Record<Id, Node>, at: Id): Id[] {
  const out: Id[] = [];
  for (const c of children(nodes[at])) {
    if (EXPRESSION.has(nodes[c].kind)) out.push(c);
    else for (const g of children(nodes[c])) if (EXPRESSION.has(nodes[g].kind)) out.push(g);
  }
  return out;
}

// The nodes of the definition's body a cut may replace, from the top.
function cutPlaces(nodes: Record<Id, Node>, def: Id): Id[] {
  const out: Id[] = [];
  const walk = (id: Id, top: boolean) => {
    const n = nodes[id];
    if (!top && (n.kind === "call" || n.kind === "match" || n.kind === "lambda")) out.push(id);
    for (const c of children(n)) walk(c, n.kind === "def");
  };
  walk(def, true);
  return out;
}

const size = (nodes: Record<Id, Node>, id: Id): number => 1 + children(nodes[id]).reduce((n, c) => n + size(nodes, c), 0);

export const nodesUnder = size;

export async function shrunk(p: Program, first: Difference, differs: (q: Program, i: number) => Promise<Difference[]>, budget = { ms: 120_000, tries: 400 }): Promise<string> {
  const def = p.defs[first.i].def, start = Date.now();
  const same = (ds: Difference[]) => ds.some((d) => d.i === first.i && d.engine === first.engine);
  let q = p, tries = 0, kept = 0, last = first;
  const before = size(p.code.nodes, def);
  cutting: for (;;) {
    for (const at of cutPlaces(q.code.nodes, def)) for (const by of standIns(q.code.nodes, at)) {
      if (tries >= budget.tries || Date.now() - start > budget.ms) break cutting;
      tries++;
      const code: Code = { ...q.code, nodes: withNodes(q.code.nodes, { [at]: { ...q.code.nodes[by], id: at } as Node }) };
      const info = infer(code, q.names, undefined, checkOptions);
      if (info.errors.length) continue;
      const candidate = { ...q, code, info };
      let ds: Difference[];
      try { ds = await differs(candidate, first.i); } catch { continue; }
      if (!same(ds)) continue;
      q = candidate; kept++; last = ds.find((d) => d.i === first.i && d.engine === first.engine)!;
      continue cutting;
    }
    break;
  }
  const pres = { names: q.names, comments: {}, hints: {}, style: JSON.parse(readFileSync(join(import.meta.dirname, "../../ters/styles/blocks.json"), "utf8")) };
  return [
    `cut down (T18c): ${kept} of ${tries} cuts kept in ${((Date.now() - start) / 1000).toFixed(1)} s, ${before} nodes to ${size(q.code.nodes, def)}${tries >= budget.tries || Date.now() - start > budget.ms ? " (budget spent)" : ""}`,
    `  ${last.text}`,
    renderBlocks(q.code, pres, q.info, def).replace(/^/gm, "  "),
  ].join("\n");
}
