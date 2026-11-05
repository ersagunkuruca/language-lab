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
import { base, checkOptions, loadProgram } from "../src/lang/load.ts";
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

test("a program on the library's layer checks as the same nodes off it (E253)", () => {
  // On its layer, the check's scans read the library's picks, made once,
  // and look only at the program's own nodes.
  for (const example of ["tumble", "constructions"]) {
    const p = loadProgram(join(root, "examples", example));
    const plain: Code = { nodes: { ...p.code.nodes }, defs: [...p.code.defs] };
    assert.deepEqual(seen(infer(p.code, p.pres.names, undefined, checkOptions), p.pres.names), seen(infer(plain, p.pres.names, undefined, checkOptions), p.pres.names), example);
  }
});

test("a program on the library's layer finds its units' conflicts as off it (E253b)", () => {
  // Whether a program declares a unit is a pick, read on the layer from the
  // library's: physics with a length declared as a time.
  const p = loadProgram(join(root, "examples", "physics"));
  const id = "488golel4ceggodsb7h00un604";
  const own: Code = { nodes: { ...p.own.nodes, [id]: { ...p.own.nodes[id], unit: { s: 1 } } as Node }, defs: p.own.defs };
  const code = base(own), plain: Code = { nodes: { ...code.nodes }, defs: [...code.defs] };
  const on = seen(infer(code, p.pres.names, undefined, checkOptions), p.pres.names);
  assert.ok(on.errors.some((e) => /unit/.test(e)), JSON.stringify(on.errors));
  assert.deepEqual(on, seen(infer(plain, p.pres.names, undefined, checkOptions), p.pres.names));
});

test("the editor checks a program merged onto the library on its layer, as off it (E253d)", async () => {
  const T = await import("../../editor/typed.ts");
  const { layerOf, merge } = await import("../src/model.ts");
  const p = loadProgram(join(root, "examples", "constructions"));
  const code = merge(LIBRARY.code, p.own), plain: Code = { nodes: { ...code.nodes }, defs: [...code.defs] };
  const on = seen(T.infer(code, p.pres.names), p.pres.names);
  assert.equal(layerOf(code), LIBRARY.code);
  assert.deepEqual(on, seen(infer(plain, p.pres.names, undefined, checkOptions), p.pres.names));
});

test("a hole's fillings on the library's layer are those off it (E253e)", async () => {
  const Top = await import("../src/lang/toplevel.ts");
  const { fillings } = await import("../src/lang/infer.ts");
  const p = loadProgram(join(root, "examples", "sort"));
  const r = Top.newDefinition(p.code, p.pres.names, "double", { kind: "function", params: ["x"] });
  assert.ok(r.ok);
  const plain: Code = { nodes: { ...r.code.nodes }, defs: [...r.code.defs] };
  const offers = (code: Code) => {
    const info = infer(code, r.names, undefined, checkOptions);
    const hole = subtree(code, code.defs.at(-1)!).find((id) => info.holes.has(id))!;
    return fillings(code, info, hole).map((f) => `${f.kind} ${"target" in f ? f.target : ""} ${"arity" in f ? f.arity : ""}`);
  };
  // The program's own nodes, put back on the library's layer.
  const own: Code = { nodes: Object.fromEntries(Object.entries(r.code.nodes).filter(([id]) => !LIBRARY.code.nodes[id])), defs: r.code.defs.filter((d) => !LIBRARY.code.nodes[d]) };
  const on = offers(base(own));
  assert.ok(on.length > 100, String(on.length));
  assert.deepEqual(on, offers(plain));
});

// L215c: a value that isn't an implementation is a group like the others,
// so an edit to a constant rechecks only what reads it; an implementation
// is still what every group may be resolved through, so an edit to one
// rechecks everything (here, compare at Priority has no Ordered after it).
test("an edit to a constant keeps other groups; an edit to an implementation rechecks them", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { COMPARE, INT_OPS, ORDERED_V, SHOW_ANY } = await import("../src/lang/std.ts");
  const { INT } = await import("../src/lang/types.ts");
  const { baseNames } = await import("../src/lang/load.ts");
  const k = new Lang(LIBRARY.code);
  const P = k.type("Priority", [], [["priority", [["level", () => k.tref(INT)]]]]);
  const level = (x: Id, f: (l: Id) => Id) => k.match(x, [{ variant: P.v.priority, names: ["level"], body: ([l]) => f(l) }]);
  const higher = k.def("higher");
  k.define(higher, k.fn(["a", "b"], (a, b) => level(a, (la) => level(b, (lb) => k.call(INT_OPS.less, lb, la)))));
  const impl = k.def("ordered at priority");
  k.define(impl, k.call(ORDERED_V, k.x(higher)));
  const limit = k.def("limit");
  k.define(limit, k.int(3));
  const compared = k.def("compared");
  k.define(compared, k.fn(["a"], (a) => k.call(SHOW_ANY, k.call(COMPARE, a, k.call(P.v.priority, k.int(2))))));
  const capped = k.def("capped");
  k.define(capped, k.fn(["n"], (n) => k.call(INT_OPS.less, n, k.x(limit))));
  const code0 = base(k.code);
  const names = { ...baseNames(), ...k.names, };
  const cache = new CheckCache();
  const opts = { ...checkOptions, cache };
  const check = (code: Code) => {
    const cached = seen(infer(code, names, undefined, opts), names);
    assert.deepEqual(cached, seen(infer(code, names, undefined, checkOptions), names));
    return cached;
  };
  assert.deepEqual(check(code0).errors, []);
  // The constant changed: `compared` is kept, `capped` is checked again.
  const lit = (code0.nodes[limit] as Node & { body: Id }).body;
  const hits = cache.hits;
  check({ ...code0, nodes: { ...code0.nodes, [lit]: { ...code0.nodes[lit], value: 4 } as Node } });
  assert.ok(cache.hits > hits, "the groups that don't read limit are kept");
  // The implementation changed (another order): every group is checked again.
  const hits2 = cache.hits;
  const lower = k.def("lower");
  k.define(lower, k.fn(["a", "b"], (a, b) => level(a, (la) => level(b, (lb) => k.call(INT_OPS.less, la, lb)))));
  const code1 = base(k.code);
  const body = (code1.nodes[impl] as Node & { body: Id }).body, call = code1.nodes[body] as Node & { args: Id[] };
  check({ ...code1, nodes: { ...code1.nodes, [call.args[0]]: { id: call.args[0], kind: "ref", target: lower } as Node } });
  assert.equal(cache.hits, hits2, "no group is kept across an implementation's edit");
});

test("a program's own pins, made anew, don't check the library again (T14f)", () => {
  // The editor holds a type while a hole is filled, making the object of
  // pins anew each time with the library's the same: the library's kept
  // check is found by the library's own pins.
  const p = loadProgram(join(root, "examples", "physics"));
  const a = infer(p.code, p.pres.names, undefined, { ...checkOptions, pins: { ...checkOptions.pins } });
  const b = infer(p.code, p.pres.names, undefined, { ...checkOptions, pins: { ...checkOptions.pins } });
  assert.ok(a.layer && a.layer === b.layer);
});
