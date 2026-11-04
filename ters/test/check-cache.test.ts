// Group results kept between checks (L215a, check-cache.ts) must give what
// a check from scratch gives: random edits to the examples, each checked
// with the cache and without, compared node by node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { infer, type Info } from "../src/lang/infer.ts";
import { CheckCache } from "../src/lang/check-cache.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { checkOptions, loadProgram } from "../src/lang/load.ts";
import { OverMap, showIn } from "../src/lang/types.ts";
import { subtree, type Code, type Id, type Node } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";

const own = <V>(m: Map<Id, V> | undefined): [Id, V][] => (m ? [...(m instanceof OverMap ? m.own() : m.entries())] : []);
const ownSet = (x: Set<Id> | undefined, under: Set<Id> | undefined) => [...(x ?? [])].filter((id) => !under?.has(id)).sort();
const seen = (info: Info, names: Names) => {
  const t = (x: Parameters<typeof showIn>[0]) => showIn(x, names, info.subst);
  return {
    errors: info.errors.map((e) => `${e.id} ${e.message}`).sort(),
    types: own(info.typeOf).map(([id, x]) => `${id} ${t(x)}`).sort(),
    schemes: own(info.schemes).filter(([d]) => info.layer?.schemes.get(d) !== info.schemes.get(d)).map(([d, sc]) => `${d} ${t(sc.type)}`).sort(),
    opAt: own(info.opAt).map(([id, x]) => `${id} ${t(x)}`).sort(),
    divergent: [...info.divergent].sort(),
    holes: [...info.holes.keys()].sort(),
    answered: ownSet(info.answered, info.layer?.answered),
    spread: ownSet(info.spread, info.layer?.spread),
    reshape: own(info.reshape).map(([id, r]) => `${id} ${r.size} ${r.tupled}`).sort(),
    embedded: [...(info.embedded ?? [])].map(([id, e]) => `${id} ${e.def} ${t(e.from)} ${t(e.to)}`).sort(),
    implementations: [...(info.implementations ?? [])].map(([k, d]) => `${k} ${d}`).sort(),
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
// reference pointed at another definition, or an expression made a hole.
function edit(code: Code, mine: Id[], r: () => number): Code {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const nodes = mine.flatMap((d) => subtree(code, d)).map((id) => code.nodes[id]);
  const lits = nodes.filter((n) => n.kind === "lit" && typeof n.value === "number");
  const refs = nodes.filter((n) => n.kind === "ref" && mine.includes(n.target));
  const exprs = nodes.filter((n) => n.kind === "call" || n.kind === "lit" || n.kind === "ref");
  const kind = r();
  let n: Node;
  if (kind < 0.4 && lits.length) { const l = pick(lits) as Node & { kind: "lit"; value: number }; n = { ...l, value: pick([0, 1, 2, 0.5, 7, -3, l.value + 1]) }; }
  else if (kind < 0.8 && refs.length) n = { ...(pick(refs) as Node & { kind: "ref" }), target: pick(mine) };
  else n = { id: pick(exprs).id, kind: "hole" } as Node;
  return { ...code, nodes: { ...code.nodes, [n.id]: n } };
}

const libDefs = new Set(LIBRARY.code.defs);
const RUNS: [string, number][] = process.env.CHECK_CACHE_RUNS ? JSON.parse(process.env.CHECK_CACHE_RUNS) : [["physics", 2], ["raymarch", 3]];
const EDITS = Number(process.env.CHECK_CACHE_EDITS ?? 6);
for (const [example, seed] of RUNS) test(`${example}: random edits checked with kept groups are checked as from scratch`, () => {
  const p = loadProgram(join(root, "examples", example));
  const names = p.pres.names;
  const mine = p.code.defs.filter((d) => !libDefs.has(d) && p.code.nodes[d]?.kind === "def");
  const cache = new CheckCache();
  const opts = { ...checkOptions, cache };
  const r = random(seed);
  let code = p.code;
  for (let i = 0; i < EDITS; i++) {
    const cached = seen(infer(code, names, undefined, opts), names);
    assert.deepEqual(cached, seen(infer(code, names, undefined, checkOptions), names), `edit ${i}`);
    // Each third edit starts again from the example, so most are one edit away.
    code = edit(i % 3 === 2 ? p.code : code, mine, r);
  }
  assert.ok(cache.hits > 0, "some groups were kept");
});

test("checking the same program again checks none of its groups", () => {
  const p = loadProgram(join(root, "examples", "raymarch"));
  const cache = new CheckCache();
  const opts = { ...checkOptions, cache };
  infer(p.code, p.pres.names, undefined, opts);
  const { misses } = cache;
  infer(p.code, p.pres.names, undefined, opts);
  assert.equal(cache.misses, misses);
});
