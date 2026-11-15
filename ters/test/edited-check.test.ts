// An edited program checked over the check of the program it was edited
// from (I304, infer.ts inferEdited) must give what a check from scratch
// gives: random edits to the examples, one after another, each checked
// both ways and compared over every node of the program's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { infer, inferEdited, type Info } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { checkOptions, loadProgram } from "../src/lang/load.ts";
import { showIn } from "../src/lang/types.ts";
import { subtree, type Code, type Id, type Node } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";

const libDefs = new Set(LIBRARY.code.defs);
const seen = (code: Code, info: Info, names: Names) => {
  const t = (x: Parameters<typeof showIn>[0]) => showIn(x, names, info.subst);
  const mine = code.defs.filter((d) => !libDefs.has(d));
  const ids = mine.flatMap((d) => subtree(code, d));
  return {
    errors: info.errors.map((e) => `${e.id} ${e.message}`).sort(),
    schemes: mine.flatMap((d) => { const s = info.schemes.get(d); return s ? [`${d} ${t(s.type)}`] : []; }),
    types: ids.flatMap((id) => { const x = info.typeOf.get(id); return x ? [`${id} ${t(x)}`] : []; }),
    holes: ids.flatMap((id) => { const h = info.holes.get(id); return h ? [`${id} ${t(h.expected)}`] : []; }),
    divergent: mine.filter((d) => info.divergent.has(d)),
  };
};

// A small seeded generator (mulberry32), so a failure can be run again.
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// One random edit to the program's own definitions: a number changed, a
// reference pointed at another definition, an expression made a hole, or
// a hole filled again with a number.
function edit(code: Code, mine: Id[], r: () => number): Code {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const nodes = mine.flatMap((d) => subtree(code, d)).map((id) => code.nodes[id]);
  const lits = nodes.filter((n) => n.kind === "lit" && typeof n.value === "number");
  const refs = nodes.filter((n) => n.kind === "ref" && mine.includes(n.target));
  const holes = nodes.filter((n) => n.kind === "hole");
  const exprs = nodes.filter((n) => n.kind === "call" || n.kind === "lit" || n.kind === "ref");
  const kind = r();
  let n: Node;
  if (kind < 0.3 && lits.length) { const l = pick(lits) as Node & { kind: "lit"; value: number }; n = { ...l, value: pick([0, 1, 2, 0.5, 7, -3, l.value + 1]) }; }
  else if (kind < 0.6 && refs.length) n = { ...(pick(refs) as Node & { kind: "ref" }), target: pick(mine) };
  else if (kind < 0.8 && holes.length) n = { id: pick(holes).id, kind: "lit", value: pick([0, 1, 2.5]) } as Node;
  else if (exprs.length) n = { id: pick(exprs).id, kind: "hole" } as Node;
  else return code;
  return { ...code, nodes: { ...code.nodes, [n.id]: n } };
}

const RUNS: [string, number][] = process.env.EDITED_RUNS ? JSON.parse(process.env.EDITED_RUNS) : [["tumble", 5], ["sort", 7], ["wc", 476], ["buffer", 92], ["collatz", 84]];
const EDITS = Number(process.env.EDITED_EDITS ?? 12);
for (const [example, seed] of RUNS) test(`${example}: random edits checked over the check before are checked as from scratch`, () => {
  const p = loadProgram(join(root, "examples", example));
  const names = p.pres.names;
  const mine = p.code.defs.filter((d) => !libDefs.has(d) && p.code.nodes[d]?.kind === "def");
  const r = random(seed);
  let code = p.code, info = infer(code, names, undefined, checkOptions), quick = 0;
  for (let i = 0; i < EDITS; i++) {
    const next = edit(code, mine, r);
    const edited = inferEdited(code, next, names, info, checkOptions);
    const whole = infer(next, names, undefined, checkOptions);
    if (edited) { quick++; assert.deepEqual(seen(next, edited, names), seen(next, whole, names), `edit ${i}`); }
    code = next;
    info = edited ?? whole;
  }
  // (A program that declares units is always checked whole.)
  if (!process.env.EDITED_RUNS) assert.ok(quick > 0, "some edits were checked over the check before");
});
