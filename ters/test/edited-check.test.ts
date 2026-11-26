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
import { parentOf, subtree, type Code, type Id, type Node, withNodes } from "../src/model.ts";
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
    // What the check says of a node besides its type: a call its inputs
    // answer (x / 2), a spread, an operation's type there.
    answered: ids.filter((id) => info.answered?.has(id)),
    spread: ids.filter((id) => info.spread?.has(id)),
    ops: ids.flatMap((id) => { const x = info.opAt?.get(id); return x ? [`${id} ${t(x)}`] : []; }),
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
  return { ...code, nodes: withNodes(code.nodes, { [n.id]: n }) };
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

test("what the check before said of a node of a definition checked again is said again or dropped: a division by a 0 no longer written is no longer answered by its inputs", () => {
  // effects' `share` divides by a written 0, which its inputs answer (it
  // fails); that 0 made 0 + 0, the check doesn't answer it.
  // (Checked over the check of an edit of a number elsewhere first, as
  // the editor goes.)
  const p = loadProgram(join(root, "examples", "effects"));
  const names = p.pres.names, opts = p.options ?? checkOptions;
  const twelve = "oakkfqskoiid0jh5qkl1u3af61";
  assert.equal((p.code.nodes[twelve] as Node & { kind: "lit" }).value, 12);
  const before: Code = { ...p.code, nodes: withNodes(p.code.nodes, { [twelve]: { ...p.code.nodes[twelve], value: 13 } as Node }) };
  const info = infer(before, names, undefined, opts);
  const zero = "g5918cgi7qpdg20tgukv5ojgch", at = parentOf(p.code, zero)!;
  assert.equal((p.code.nodes[zero] as Node & { kind: "lit" }).value, 0);
  const c = p.code.nodes[at.parent] as Node & { kind: "call"; args: Id[] };
  const next: Code = { ...p.code, nodes: withNodes(p.code.nodes, {
    zzf: { id: "zzf", kind: "ref", target: "builtin.arith.add" } as Node,
    zzz: { id: "zzz", kind: "lit", value: 0 } as Node,
    zzc: { id: "zzc", kind: "call", fn: "zzf", args: [zero, "zzz"] } as Node,
    [at.parent]: { ...c, args: c.args.map((a) => (a === zero ? "zzc" : a)) },
  }) };
  const edited = inferEdited(before, next, names, info, opts);
  assert.ok(edited, "checked over the check before");
  const whole = infer(next, names, undefined, opts);
  assert.ok([...(info.answered ?? [])].some((id) => !whole.answered?.has(id)), "the edit takes an answer away");
  assert.deepEqual(seen(next, edited!, names), seen(next, whole, names));
});
